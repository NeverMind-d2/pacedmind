import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, BackHandler, Linking, Platform, Pressable, Share, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import { StatusBar } from "expo-status-bar";
import Constants from "expo-constants";
import { nativeCallbackUrl, navigationDecision, shareableUrl, validateOrigin } from "./navigation.cjs";

const origin = validateOrigin(Constants.expoConfig.extra.origin);
const tabs = [["Today", "/today"], ["Inbox", "/inbox"], ["Sessions", "/sessions"], ["Settings", "/settings"]];

function Companion() {
  const browser = useRef(null);
  const handledCallback = useRef(null);
  const [source, setSource] = useState(`${origin}/today`);
  const [navigation, setNavigation] = useState(0);
  const [currentUrl, setCurrentUrl] = useState(source);
  const [canGoBack, setCanGoBack] = useState(false);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const shareUrl = shareableUrl(currentUrl, origin);
  useEffect(() => {
    let active = true;
    const finishSignIn = (url) => {
      const callback = nativeCallbackUrl(url, origin);
      if (!active || !callback || handledCallback.current === callback) return;
      handledCallback.current = callback;
      setFailed(false);
      setSource(callback);
      setCurrentUrl(callback);
      setNavigation((value) => value + 1);
    };
    Linking.getInitialURL().then((url) => { if (url) finishSignIn(url); }).catch(() => {});
    const subscription = Linking.addEventListener("url", ({ url }) => finishSignIn(url));
    return () => { active = false; subscription.remove(); };
  }, []);
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!canGoBack || failed) return false;
      browser.current?.goBack();
      return true;
    });
    return () => subscription.remove();
  }, [canGoBack, failed]);

  function openExternal(url) {
    if (navigationDecision(url, origin) !== "external") return;
    Alert.alert("Open in your browser?", new URL(url).hostname, [
      { text: "Cancel", style: "cancel" },
      { text: "Open", onPress: () => Linking.openURL(url).catch(() => Alert.alert("This link could not be opened.")) },
    ]);
  }

  function navigate(url) {
    const decision = navigationDecision(url, origin);
    if (decision === "external") openExternal(url);
    return decision === "internal";
  }

  function go(path) {
    setFailed(false);
    setSource(`${origin}${path}`);
    setCurrentUrl(`${origin}${path}`);
    // Next can change the current URL without changing the native source prop. A fresh WebView makes
    // every tab selection load its destination; the platform's persistent cookie store stays intact.
    setNavigation((value) => value + 1);
  }

  function reload() {
    setFailed(false);
    setSource(currentUrl);
    setNavigation((value) => value + 1);
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Text accessibilityRole="header" style={styles.title}>PacedMind</Text>
        {loading && !failed && <ActivityIndicator color="#ffffff" accessibilityLabel="Loading" />}
        <Pressable accessibilityRole="button" accessibilityLabel="Reload page" onPress={reload} style={styles.button}>
          <Text style={styles.buttonText}>Reload</Text>
        </Pressable>
        {shareUrl && <Pressable accessibilityRole="button" accessibilityLabel="Share this page" onPress={() => Share.share(Platform.OS === "ios" ? { url: shareUrl } : { message: shareUrl }).catch(() => {})} style={styles.button}>
          <Text style={styles.buttonText}>Share</Text>
        </Pressable>}
      </View>
      <View style={styles.content}>
        <WebView
          key={navigation}
          ref={browser}
          source={{ uri: source }}
          style={styles.webview}
          applicationNameForUserAgent="PacedMindNative/1.0"
          originWhitelist={["*"]}
          onShouldStartLoadWithRequest={(request) => request.isTopFrame === false
            ? navigationDecision(request.url, origin) !== "block" : navigate(request.url)}
          onOpenWindow={({ nativeEvent }) => {
            if (navigationDecision(nativeEvent.targetUrl, origin) === "internal") {
              setSource(nativeEvent.targetUrl);
              setCurrentUrl(nativeEvent.targetUrl);
              setNavigation((value) => value + 1);
            }
            else openExternal(nativeEvent.targetUrl);
          }}
          onNavigationStateChange={(state) => {
            if (navigationDecision(state.url, origin) === "internal") setCurrentUrl(state.url);
            setCanGoBack(state.canGoBack);
          }}
          onLoadStart={() => setLoading(true)}
          onLoadEnd={() => setLoading(false)}
          onError={() => { setFailed(true); setLoading(false); }}
          onHttpError={({ nativeEvent }) => {
            if (nativeEvent.url === currentUrl && nativeEvent.statusCode >= 500) setFailed(true);
          }}
          onContentProcessDidTerminate={() => { setFailed(true); setLoading(false); }}
          onRenderProcessGone={() => { setFailed(true); setLoading(false); }}
          javaScriptCanOpenWindowsAutomatically={false}
          setSupportMultipleWindows
          allowFileAccess={false}
          allowFileAccessFromFileURLs={false}
          allowUniversalAccessFromFileURLs={false}
          mixedContentMode="never"
          thirdPartyCookiesEnabled={false}
          sharedCookiesEnabled={false}
          mediaCapturePermissionGrantType="deny"
          geolocationEnabled={false}
          webviewDebuggingEnabled={false}
          allowsBackForwardNavigationGestures
          // All origins go through the policy above. No onMessage, injectedJavaScript or native token bridge.
        />
        {failed && <View style={styles.failure} accessibilityLiveRegion="polite">
          <Text style={styles.title}>PacedMind could not load</Text>
          <Text style={styles.message}>Check your connection and try again. Your plans stay in your account.</Text>
          <Pressable accessibilityRole="button" onPress={reload} style={styles.retry}>
            <Text style={styles.buttonText}>Try again</Text>
          </Pressable>
        </View>}
      </View>
      <View style={styles.tabs}>
        {tabs.map(([label, path]) => <Pressable key={path} accessibilityRole="tab" accessibilityState={{ selected: currentUrl.startsWith(`${origin}${path}`) }} onPress={() => go(path)} style={styles.tab}>
          <Text style={styles.buttonText}>{label}</Text>
        </Pressable>)}
      </View>
    </SafeAreaView>
  );
}

export default function App() {
  return <SafeAreaProvider><Companion /></SafeAreaProvider>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#111111" },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, gap: 8, minHeight: 52 },
  title: { color: "#ffffff", fontSize: 18, fontWeight: "600", flexShrink: 1, marginRight: "auto" },
  button: { minHeight: 44, justifyContent: "center", paddingHorizontal: 8 },
  buttonText: { color: "#ffffff", fontSize: 14 },
  content: { flex: 1 },
  webview: { flex: 1, backgroundColor: "#111111" },
  failure: { ...StyleSheet.absoluteFillObject, backgroundColor: "#111111", justifyContent: "center", alignItems: "center", padding: 28, gap: 18 },
  message: { color: "#cccccc", fontSize: 16, textAlign: "center", lineHeight: 24 },
  retry: { minHeight: 48, paddingHorizontal: 24, backgroundColor: "#333333", borderRadius: 8, justifyContent: "center" },
  tabs: { flexDirection: "row", borderTopWidth: 1, borderTopColor: "#333333" },
  tab: { flex: 1, minHeight: 52, alignItems: "center", justifyContent: "center" },
});
