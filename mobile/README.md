# PacedMind mobile companion

This is the iOS/Android native project for testing the hosted planner. It uses Expo and React Native WebView, with native navigation, a share sheet, Android back handling and connection recovery. It does not run Node, SQLite, Claude Code or Codex on a phone. Agents still run on the account's computers.

**This is a development scaffold, not a submission-ready app.** [Store readiness](../stores/README.md) records remaining engineering and account requirements. In particular, device testing of authentication, native notifications, account deletion with a subscription, and Apple's minimum functionality review remain open. Existing PWA web push is not an implementation of native push.

## Run and validate

Use Node 22.13 or newer (the Expo SDK and React Native requirements also apply):

```sh
cd mobile
npm ci
npm run check
npm run bundle
npx expo install --check
npx expo start
```

`bundle` builds JavaScript bundles for both mobile platforms. It does not compile Swift/Kotlin, create a signed binary or prove that a device works. `npm run android` needs an Android SDK/JDK and an emulator or device. `npm run ios` needs a Mac, Xcode and CocoaPods. `npm run prebuild` generates the ignored native projects from the checked-in configuration. Preserve intentional native changes as Expo config plugins before regenerating them.

The default origin is `https://app.pacedmind.com`. Set `PACEDMIND_MOBILE_ORIGIN` to an HTTPS staging origin for testing; paths, credentials, queries and cleartext origins are rejected. Test with a dedicated account. Do not put credentials or Supabase tokens in Expo configuration: it ships to every user.

The root `npm run icons` generates mobile icons from the existing brand geometry. The approved source image stays unchanged. The iOS asset is opaque at 1024 × 1024; the Android foreground leaves room for launcher masks.

## Authentication and navigation

The planner retains its normal HttpOnly cookie session in the app's WebView. There is no JavaScript message bridge, token injection, filesystem access, camera, microphone or geolocation permission. The server identifies `PacedMindNative/1.0` only to show account status without purchase controls; this marker never authorizes access.

Only the configured HTTPS origin stays in the WebView. External HTTPS pages ask before opening the system browser. Other protocols, credential-bearing URLs and local files are blocked. The share sheet strips queries and fragments and accepts only planner routes, so it cannot export a sign-in callback.

Google sign-in and email confirmation/recovery open the system browser. The return URL includes `native=1`: the hosted callback sends it to `/auth/native` without exchanging the authorization code. Its **Open PacedMind** link returns that short-lived code through `pacedmind://auth/callback`. The native handler accepts only that exact route, rejects token fields, and loads the configured HTTPS callback without `native=1`; only the WebView has the HttpOnly PKCE verifier cookie needed to exchange the code. Session/access/refresh tokens never cross the custom scheme. The scheme cannot establish a session without a matching verifier, even if another app intercepts the authorization code.

This requires deploying the matching hosted callback and allowing the native-marked callback URL in Supabase's redirect allowlist. Test OAuth success/cancellation, verification/recovery emails, expired/replayed codes and killed-app returns on real devices. The custom scheme needs a native development or preview build; Expo Go does not register PacedMind's scheme. Verified universal/app links remain future hardening and need owner-controlled domain association files and signing identities.

## Native builds

After reserving the package/bundle IDs and linking an Expo project, set the public values described in `.env.example`. Keep IDs stable after the first upload. EAS project linking and account enrollment are owner actions; this checkout does neither automatically.

`eas.json` has internal preview builds (Android APK and iOS simulator) and production builds (Android AAB, iOS device archive). There is deliberately no auto-submit configuration. From `mobile/`:

```sh
npx eas-cli@24.8.0 build --platform android --profile preview
npx eas-cli@24.8.0 build --platform ios --profile preview
```

These commands send the project to Expo's build service and may incur account usage; alternatively build locally with the native toolchains. They are instructions, not actions performed by this change. Check all remaining prerequisites before production builds:

```sh
node ../scripts/check-store-readiness.mjs --platform mobile --strict
```

The strict check intentionally fails while release prerequisites remain. Nothing here publishes an app, creates a store account, enables production billing or sends notifications.
