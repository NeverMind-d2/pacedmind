# Distribution and store submissions

Requirements reviewed on **30 September 2026**. This dossier distinguishes prepared source/configuration from a signed, tested release. No store application or release has been submitted. Run the read-only report from the repository root:

```sh
node scripts/check-store-readiness.mjs
node scripts/check-store-readiness.mjs --platform mobile --strict
node scripts/check-store-readiness.mjs --platform windows --strict
```

The strict form exits unsuccessfully until every applicable item in [readiness.json](readiness.json) has completion evidence. Keep evidence as a short reference to a build, device test or private account record, never as credentials in Git. The check validates the local scaffold and records human review; it cannot certify store acceptance.

## What each platform runs

| Platform | Prepared route | Remaining before submission or release |
| --- | --- | --- |
| Windows | Existing Electron/NSIS app; new signed, immutable EXE preparation for Microsoft Store | Trusted signing identity, Store registration/listing, immutable hosting, clean-machine installer and upgrade checks |
| macOS direct download | Existing universal Developer ID app, notarized DMG | Mac toolchain, certificate/notary profile, Apple silicon and Intel tests |
| Mac App Store | Architecture decision documented | A separate sandboxed companion or a redesigned sandbox-compatible launcher; no MAS package is claimed |
| iOS/iPadOS | [Native Expo companion](../mobile/README.md), PKCE code handoff, pinned dependencies, icons and build profiles | Authentication/device QA, useful native features, review of billing/privacy/deletion, signed device build |
| Android | Same native companion, APK preview/AAB production, target API 36 | Signing, native compatibility/auth/device QA, declarations and applicable closed testing |

The web app uses Server Actions, request cookies and a running Next.js server. It cannot be packaged as a static export without replacing that architecture. Phones therefore use the hosted service. The PWA remains available independently; adding a manifest does not produce App Store or Play binaries.

## Windows

The Microsoft Store accepts existing EXE/MSI installers as well as MSIX. The existing installer route preserves `Organizer.Desktop`, `%LOCALAPPDATA%\Programs\Organizer` and `%APPDATA%\Organizer`. It avoids introducing MSIX data redirection while local agent integrations rely on the user's real profile. Microsoft requires a signed offline installer and an immutable installer URL. [Microsoft's distribution guide](https://learn.microsoft.com/en-us/windows/apps/distribute-through-store/how-to-distribute-your-win32-app-through-microsoft-store), [signing and distribution](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/choose-distribution-path).

Install Windows SDK SignTool, make the trusted code-signing certificate available in the current user's certificate store, and set its thumbprint (not the private key) in PowerShell:

```powershell
$env:PACEDMIND_WINDOWS_CERT_SHA1 = 'your 40-character certificate thumbprint'
$env:PACEDMIND_SIGNTOOL = 'C:\path\to\signtool.exe'
npm run release -- --store
```

This requires a clean, landed checkout, packages without installing, signs and verifies executable/DLL/native-module files, signs NSIS's generated uninstaller through electron-builder's signing hook, then signs the installer. It produces `dist/release/PacedMind-Windows-<version>-<hash>.exe` and a JSON record with SHA-256, `/S` silent switches and the preserved app ID. It does not upload. The ordinary downloadable release remains unchanged. The signing hook follows the pinned [electron-builder v26 interface](https://www.electron.build/v26/docs/win/).

Host that exact named file on an immutable HTTPS URL and enter it in Partner Center; `/download/windows` changes with every release and is unsuitable. Record the URL in the private submission notes. On clean machines verify `/S` install and uninstall, exit codes, relaunch behavior, upgrades from an existing installation, preserved data, notifications and both agent terminals. Check that the installed uninstaller and all packaged PE files are signed. EXE distribution does not provide Store-managed updates: establish the update procedure before launch.

## macOS

The existing `npm run release -- --no-upload` flow builds a universal app, signs it with Developer ID, notarizes it and the DMG, staples the tickets and checks Gatekeeper. See [deployment instructions](../deploy/README.md). Build this on a Mac and test the actual artifact; JavaScript checks on Windows cannot verify signing or runtime behavior.

The Mac App Store requires a sandboxed MAS build. The current app launches terminals and arbitrary user-installed agent tools, reads their configuration and serves a local Node process. Its current hardened-runtime entitlement is not an App Sandbox entitlement. A new entitlement plist alone does not make those behaviors compatible. A cloud companion with a separate bundle identity is the plausible store route, pending product choice and implementation. [Electron's MAS guidance](https://www.electronjs.org/docs/latest/tutorial/mac-app-store-submission-guide).

## iOS and Android product decisions

The companion deliberately exposes existing account access without price selectors, checkout buttons or payment banners. This is a starting point for reviewing Apple's companion-app exception and Google's consumption-only policy; it is not an exemption or approval. Audit other surfaces (including help links and account deletion messages), subscription cancellation and every target storefront before submitting. If selling Cloud within mobile is required, add StoreKit/Play Billing, receipt validation, restore purchases and server-verified entitlements. Existing Stripe entitlements are not an in-app purchase implementation. [Apple review rules, sections 3.1.3(f), 4.2 and 4.8](https://developer.apple.com/app-store/review/guidelines/), [Google payments policy](https://support.google.com/googleplay/android-developer/answer/9858738).

Apple expects functionality beyond a repackaged website. The current shell's tabs, sharing and retry state are useful infrastructure, but do not establish eligibility. Implement a useful native surface such as task-aware notifications with actions and a widget, then include it in review notes and device tests. Native APNs/FCM registration is not implemented; browser VAPID subscriptions cannot be assumed to work inside a WebView.

Google sign-in uses the system browser. The native-marked callback now hands a short-lived PKCE authorization code back to the app; only its WebView has the verifier cookie to exchange it. No session/access/refresh tokens cross the custom scheme. Deploy both sides and verify the Supabase redirect allowlist, real-device browser returns and email verification/recovery. Assess Sign in with Apple requirements if offering Google on iOS. Test OAuth accounts, email/password accounts, optional 2FA enrollment, enforced challenges after enrollment, sign-out and revoked devices.

Google Play currently requires new phone apps/updates to target Android 16/API 36. Also inspect native library alignment for 16 KB pages using the release AAB, not only the JavaScript bundle. Recheck requirements when submitting. [Target API requirements](https://support.google.com/googleplay/android-developer/answer/11926878), [16 KB support](https://developer.android.com/guide/practices/page-sizes). New personal Play accounts can require 12 testers opted in continuously for 14 days before production access; the owner's Console determines the applicable requirement. [Closed testing](https://support.google.com/googleplay/android-developer/answer/14151465).

## Listing material and declarations

Suggested name: **PacedMind**. Category: **Productivity**. Mobile short description: **Plan your tasks and follow your agent sessions.** Longer starting copy:

> Keep your tasks, projects and calendar together. Plan your day, follow the progress of Claude Code and Codex sessions on your computers, and review their reports. PacedMind on your phone uses your PacedMind Cloud account. Agent sessions run on your own computers.

Only add claims for features verified in the release. Capture real native phone/tablet screenshots; do not submit the website hero images as device evidence. Provide an owner-controlled support contact, a dedicated review account with sample data, instructions for optional 2FA, and a demo computer or safe demonstration of remote actions. Do not put review passwords or TOTP secrets in this repository. Complete age/content ratings and accessibility declarations from the app actually submitted.

Before archiving iOS, confirm the selected Xcode image and SDK satisfy Apple's [current upload requirements](https://developer.apple.com/app-store/submitting/); a successful JavaScript export does not establish that.

Existing public destinations are [privacy](https://pacedmind.com/privacy), [terms](https://pacedmind.com/terms) and [documentation](https://pacedmind.com/docs). Review legal copy for the mobile product and the optional-2FA model before deployment. Current data categories to review against the release include email/account identifiers, user-written tasks/calendar/reports, computer/session metadata, authentication/security records and subscription state. If native push is added, include device push tokens and provider delivery. Complete Apple App Privacy, privacy manifests/required-reason APIs and Google Data safety from the actual app plus every SDK. Do not mark “no data collected” or “no tracking” merely because the wrapper has no analytics package.

Verify in-app deletion and the outside-the-app [deletion instructions](https://pacedmind.com/delete-account) prepared under `site/app/delete-account/`. That page must be deployed and checked before entering its URL in Play Console. The app deletes accounts from Settings, but cancellation requirements, unsubscribed accounts, optional MFA and browser handoff still need end-to-end verification. [Apple account deletion](https://developer.apple.com/support/offering-account-deletion-in-your-app/), [Google account deletion](https://support.google.com/googleplay/android-developer/answer/13327111).
