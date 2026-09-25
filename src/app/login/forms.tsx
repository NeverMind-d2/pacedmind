"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type FormEvent, type ReactNode } from "react";
import {
  confirmEnrollAction, recoveryCodeAction, sendResetAction, setNewPasswordAction, signInAction, signOutAction, signUpAction,
  startEnrollAction, verifyAction, type Enrollment,
} from "../auth/actions";
import { Button, cx } from "@/components/ui";

type Result = { ok: boolean; error?: string; message?: string } | undefined;
type Note = { text: string; error: boolean } | null;

export const field =
  "h-9 w-full rounded-md border border-line2 bg-input px-3 text-[13px] text-fg outline-none placeholder:text-dim focus:border-line-strong";
const codeField = cx(field, "text-center font-mono text-[18px] tracking-[0.4em]");

function Card({ title, children, onSubmit }: { title: string; children: ReactNode; onSubmit: (e: FormEvent) => void }) {
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 rounded-xl border border-line bg-panel p-6">
      <h1 className="text-[15px] font-semibold text-strong">{title}</h1>
      {children}
    </form>
  );
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12px] text-mut">{label}</span>
      {children}
      {hint && <span className="text-[11.5px] leading-relaxed text-mut2">{hint}</span>}
    </label>
  );
}

function Message({ note }: { note: Note }) {
  if (!note) return null;
  return (
    <p role={note.error ? "alert" : "status"}
      className={cx("rounded-md border px-3 py-2 text-[12.5px] leading-relaxed", note.error ? "border-line-strong text-fg" : "border-line2 text-fg3")}>
      {note.text}
    </p>
  );
}

/** Runs an action and shows its error or message; a successful sign-in step redirects and returns nothing. */
function useRun(initial: Note = null) {
  const [note, setNote] = useState<Note>(initial);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<Result>, after?: (r: NonNullable<Result>) => void) =>
    start(async () => {
      const r = await fn();
      if (!r) return;
      if (!r.ok) setNote({ text: r.error ?? "Something went wrong.", error: true });
      else {
        if (r.message) setNote({ text: r.message, error: false });
        after?.(r);
      }
    });
  return { note, setNote, pending, run };
}

/* ---------- email and password ---------- */

type Mode = "signin" | "signup" | "reset";

export function LoginForm({ initialError }: { initialError: string | null }) {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const { note, setNote, pending, run } = useRun(initialError ? { text: initialError, error: true } : null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (mode === "signin") return run(() => signInAction(email, password));
    if (mode === "reset") return run(() => sendResetAction(email));
    if (password !== confirm) return setNote({ text: "The two passwords don't match.", error: true });
    run(() => signUpAction(email, password));
  };
  const switchTo = (m: Mode) => {
    setMode(m);
    setNote(null);
    setPassword("");
    setConfirm("");
  };
  const title = mode === "signin" ? "Sign in" : mode === "signup" ? "Create your account" : "Reset your password";

  return (
    <Card title={title} onSubmit={submit}>
      <Field label="Email">
        <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={field}
          placeholder="you@example.com" maxLength={254} />
      </Field>
      {mode !== "reset" && (
        <Field label="Password" hint={mode === "signup" ? "At least 12 characters. A passphrase of a few words works well." : undefined}>
          <input type="password" required autoComplete={mode === "signin" ? "current-password" : "new-password"} value={password}
            onChange={(e) => setPassword(e.target.value)} className={field} maxLength={72} minLength={mode === "signup" ? 12 : undefined} />
        </Field>
      )}
      {mode === "signup" && (
        <Field label="Password again">
          <input type="password" required autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={field} maxLength={72} />
        </Field>
      )}
      {mode === "signup" && (
        <p className="text-[12px] leading-relaxed text-mut2">
          After confirming your email you&apos;ll set up an authenticator app. Every sign-in asks for its code, because PacedMind can start
          agents on your computer.
        </p>
      )}
      <Message note={note} />
      <Button type="submit" variant="primary" disabled={pending} className="h-9 justify-center text-[13px]">
        {mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Email me a link"}
      </Button>
      <div className="flex flex-col items-center gap-2 border-t border-line pt-4 text-[12.5px] text-mut2">
        {mode === "signin" && (
          <>
            <button type="button" onClick={() => switchTo("reset")} className="text-mut hover:text-fg2">Forgot your password?</button>
            <span>New to PacedMind? <button type="button" onClick={() => switchTo("signup")} className="font-medium text-fg2 hover:text-strong">Create an account</button></span>
          </>
        )}
        {mode !== "signin" && (
          <button type="button" onClick={() => switchTo("signin")} className="font-medium text-fg2 hover:text-strong">Back to sign in</button>
        )}
      </div>
    </Card>
  );
}

/* ---------- the code from the authenticator ---------- */

export function VerifyForm({ factors, backupCodes, next }: { factors: { id: string; name: string }[]; backupCodes: boolean; next: string | null }) {
  const [factorId, setFactorId] = useState(factors[0]?.id ?? "");
  const [code, setCode] = useState("");
  const [useBackup, setUseBackup] = useState(false);
  const { note, pending, run } = useRun();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(() => (useBackup ? recoveryCodeAction(code, next) : verifyAction(code, factorId, next)));
  };

  return (
    <Card title="Two-factor code" onSubmit={submit}>
      {factors.length > 1 && !useBackup && (
        <Field label="Authenticator">
          <select value={factorId} onChange={(e) => setFactorId(e.target.value)} className={field}>
            {factors.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </Field>
      )}
      <Field label={useBackup ? "Backup code" : "Code from your authenticator app"}>
        <input autoFocus required value={code} onChange={(e) => setCode(useBackup ? e.target.value : e.target.value.replace(/\D/g, "").slice(0, 6))}
          inputMode={useBackup ? "text" : "numeric"} autoComplete="one-time-code" className={useBackup ? field : codeField}
          placeholder={useBackup ? "xxxx-xxxx-xxxx-xxxx" : "000000"} maxLength={useBackup ? 40 : 6} />
      </Field>
      <Message note={note} />
      <Button type="submit" variant="primary" disabled={pending} className="h-9 justify-center text-[13px]">Continue</Button>
      <div className="flex flex-col items-center gap-2 border-t border-line pt-4 text-[12.5px] text-mut2">
        {backupCodes && (
          <button type="button" onClick={() => { setUseBackup(!useBackup); setCode(""); }} className="text-mut hover:text-fg2">
            {useBackup ? "Use the authenticator app" : "Use a backup code"}
          </button>
        )}
        <button type="button" onClick={() => run(() => signOutAction().then(() => undefined))} className="text-mut hover:text-fg2">Sign out</button>
      </div>
    </Card>
  );
}

/* ---------- setting up an authenticator ---------- */

export function SetupForm({ first, email }: { first: boolean; email: string }) {
  const router = useRouter();
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState("");
  const [current, setCurrent] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [done, setDone] = useState(false);
  const { note, setNote, pending, run } = useRun();

  // The first authenticator starts right away; another one after a code from one you already have.
  useEffect(() => {
    if (!first) return;
    let live = true;
    startEnrollAction().then((r) => {
      if (!live) return;
      if (r.ok && r.enrollment) setEnrollment(r.enrollment);
      else setNote({ text: r.error ?? "Couldn't start setting up the app.", error: true });
    });
    return () => {
      live = false;
    };
  }, [first, setNote]);

  if (!first && !enrollment) {
    const begin = (e: FormEvent) => {
      e.preventDefault();
      run(() => startEnrollAction(current), (r) => {
        const withEnrollment = r as typeof r & { enrollment?: Enrollment };
        if (withEnrollment.enrollment) setEnrollment(withEnrollment.enrollment);
      });
    };
    return (
      <Card title="Add another authenticator" onSubmit={begin}>
        <Field label="Code from an authenticator you already have">
          <input autoFocus required value={current} onChange={(e) => setCurrent(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric"
            autoComplete="one-time-code" className={codeField} placeholder="000000" maxLength={6} />
        </Field>
        <Message note={note} />
        <Button type="submit" variant="primary" disabled={pending || current.length !== 6} className="h-9 justify-center text-[13px]">Continue</Button>
      </Card>
    );
  }

  if (done) {
    return (
      <div className="flex flex-col gap-4 rounded-xl border border-line bg-panel p-6">
        <h1 className="text-[15px] font-semibold text-strong">Two-factor sign-in is on</h1>
        <p className="text-[12.5px] leading-relaxed text-fg3">
          If you lose this phone you lose access to your account, so add a second authenticator now: another phone, a tablet or a password
          manager that makes codes. You can also do it later in Settings.
        </p>
        <div className="flex gap-2">
          <Button type="button" onClick={() => router.push("/login/setup?add=1")} className="h-9 flex-1 justify-center">Add a second one</Button>
          <Button type="button" variant="primary" onClick={() => router.push("/today")} className="h-9 flex-1 justify-center">Continue</Button>
        </div>
      </div>
    );
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!enrollment) return;
    run(() => confirmEnrollAction(enrollment.factorId, code), () => (first ? setDone(true) : router.push("/settings")));
  };

  return (
    <Card title={first ? "Set up two-factor sign-in" : "Add another authenticator"} onSubmit={submit}>
      <ol className="flex list-decimal flex-col gap-2 pl-4 text-[12.5px] leading-relaxed text-fg3">
        <li>Open an authenticator app: Google Authenticator, Microsoft Authenticator, 1Password, Bitwarden or similar.</li>
        <li>Scan this code, or type the key by hand.</li>
        <li>Enter the 6-digit code the app shows.</li>
      </ol>
      <div className="flex flex-col items-center gap-3">
        <div className="flex h-[184px] w-[184px] items-center justify-center rounded-lg bg-white p-2">
          {enrollment
            ? /* eslint-disable-next-line @next/next/no-img-element -- a data: URI SVG made by Supabase */
              <img src={enrollment.qr} alt={`QR code for PacedMind (${email})`} width={168} height={168} />
            : <span className="text-[12px] text-neutral-500">Preparing…</span>}
        </div>
        {enrollment && (
          <button type="button" onClick={() => setShowSecret(!showSecret)} className="text-[12px] text-mut hover:text-fg2">
            {showSecret ? "Hide the key" : "Can't scan it? Show the key"}
          </button>
        )}
        {enrollment && showSecret && (
          <code className="select-all break-all rounded-md border border-line2 bg-input px-3 py-2 text-center font-mono text-[12.5px] text-fg2">
            {enrollment.secret.replace(/(.{4})/g, "$1 ").trim()}
          </code>
        )}
      </div>
      <Field label="Code from the app">
        <input required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric"
          autoComplete="one-time-code" className={codeField} placeholder="000000" maxLength={6} />
      </Field>
      <Message note={note} />
      <Button type="submit" variant="primary" disabled={pending || !enrollment} className="h-9 justify-center text-[13px]">Turn on</Button>
      {first && (
        <div className="flex justify-center border-t border-line pt-4">
          <button type="button" onClick={() => run(() => signOutAction().then(() => undefined))} className="text-[12.5px] text-mut hover:text-fg2">Sign out</button>
        </div>
      )}
    </Card>
  );
}

/* ---------- a new password after an email link ---------- */

export function NewPasswordForm() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const { note, setNote, pending, run } = useRun();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (password !== confirm) return setNote({ text: "The two passwords don't match.", error: true });
    run(() => setNewPasswordAction(password));
  };
  return (
    <Card title="Choose a new password" onSubmit={submit}>
      <Field label="New password" hint="At least 12 characters. Other devices are signed out when it changes.">
        <input type="password" required autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={field}
          minLength={12} maxLength={72} autoFocus />
      </Field>
      <Field label="New password again">
        <input type="password" required autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={field} maxLength={72} />
      </Field>
      <Message note={note} />
      <Button type="submit" variant="primary" disabled={pending} className="h-9 justify-center text-[13px]">Save password</Button>
    </Card>
  );
}
