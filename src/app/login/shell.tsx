import type { ReactNode } from "react";
import { BrandWordmark } from "@/components/brand-wordmark";
import { LiveRefresh } from "@/components/live-refresh";

/**
 * The frame around the sign-in pages: the wordmark, a line of context and the form. It scrolls by itself,
 * since the app's body doesn't (its panels do), and on a phone the form is taller than the screen.
 */
export function AuthShell({ note, children }: { note: ReactNode; children: ReactNode }) {
  return (
    <main className="h-full overflow-y-auto bg-bg">
      <div className="flex min-h-full items-center justify-center px-4 py-10 sm:py-16">
        <div className="flex w-full max-w-[380px] flex-col gap-8">
          <div className="flex flex-col items-center gap-3 text-center">
            <BrandWordmark className="w-[168px]" />
            <p className="text-balance text-[13px] leading-relaxed text-mut">{note}</p>
          </div>
          {children}
        </div>
      </div>
      {/* Moves on by itself when sign-in finishes elsewhere, e.g. an email link opened in a browser. */}
      <LiveRefresh />
    </main>
  );
}
