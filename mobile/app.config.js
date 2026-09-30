/* eslint-disable @typescript-eslint/no-require-imports */
const { version } = require("./package.json");
const { validateOrigin } = require("./navigation.cjs");

const origin = validateOrigin(process.env.PACEDMIND_MOBILE_ORIGIN || "https://app.pacedmind.com");
module.exports = {
  expo: {
    name: "PacedMind",
    slug: "pacedmind",
    scheme: "pacedmind",
    platforms: ["ios", "android"],
    version,
    ...(process.env.EXPO_OWNER ? { owner: process.env.EXPO_OWNER } : {}),
    orientation: "default",
    userInterfaceStyle: "dark",
    icon: "./assets/icon.png",
    ios: {
      bundleIdentifier: process.env.PACEDMIND_IOS_BUNDLE_ID || "com.pacedmind.mobile",
      buildNumber: "1",
      supportsTablet: true,
      infoPlist: {
        // HTTPS only. No arbitrary-load ATS exception and no camera/location permissions.
        NSAppTransportSecurity: { NSAllowsArbitraryLoads: false },
      },
    },
    android: {
      package: process.env.PACEDMIND_ANDROID_PACKAGE || "com.pacedmind.mobile",
      versionCode: 1,
      permissions: [],
      blockedPermissions: [
        "android.permission.RECORD_AUDIO", "android.permission.CAMERA",
        "android.permission.READ_EXTERNAL_STORAGE", "android.permission.WRITE_EXTERNAL_STORAGE",
        "android.permission.SYSTEM_ALERT_WINDOW",
      ],
      allowBackup: false,
      adaptiveIcon: { foregroundImage: "./assets/adaptive-icon.png", backgroundColor: "#000000" },
    },
    plugins: [["expo-build-properties", {
      android: { compileSdkVersion: 36, targetSdkVersion: 36, usesCleartextTraffic: false },
    }]],
    updates: { enabled: false },
    extra: {
      origin,
      ...(process.env.EXPO_PROJECT_ID ? { eas: { projectId: process.env.EXPO_PROJECT_ID } } : {}),
    },
  },
};
