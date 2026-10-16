// Inside the Android/iOS apps (capacitor.config.ts) the live site runs in a native WebView with the
// Capacitor bridge injected. Plugins are imported lazily so the web and SSR bundles never load them.
import { Capacitor } from "@capacitor/core";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

// Must match the URL scheme in ios/App/App/Info.plist and android/app/src/main/AndroidManifest.xml,
// and be listed under Supabase → Authentication → URL Configuration → Redirect URLs.
export const NATIVE_AUTH_CALLBACK = "com.jarakksa.app://auth-callback";
const NEXT_KEY = "jarak:native-oauth-next";

export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}

// Google refuses to sign in inside an embedded WebView, so the native apps run OAuth in the system
// browser sheet and come back through the app's URL scheme (handled in initNativeApp).
export async function nativeOAuthSignIn(provider: "google", next?: string | null) {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: NATIVE_AUTH_CALLBACK, skipBrowserRedirect: true },
  });
  if (error || !data.url) return { error: error ?? new Error("No OAuth URL") };
  try {
    sessionStorage.setItem(NEXT_KEY, next ?? "");
  } catch {
    // storage blocked: fall back to the home page after sign-in
  }
  const { Browser } = await import("@capacitor/browser");
  await Browser.open({ url: data.url, presentationStyle: "popover" });
  return { error: null };
}

export async function nativeShare(title: string, url: string) {
  const { Share } = await import("@capacitor/share");
  await Share.share({ title, url, dialogTitle: title });
}

async function finishOAuth(callbackUrl: string) {
  const { Browser } = await import("@capacitor/browser");
  await Browser.close().catch(() => {});

  const url = new URL(callbackUrl);
  const params = new URLSearchParams(url.hash.slice(1) || url.search.slice(1));
  const code = params.get("code");
  const access_token = params.get("access_token");
  const refresh_token = params.get("refresh_token");

  const { error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : access_token && refresh_token
      ? await supabase.auth.setSession({ access_token, refresh_token })
      : { error: new Error(params.get("error_description") ?? "Sign-in cancelled") };
  if (error) {
    toast.error("تعذّر تسجيل الدخول");
    return;
  }

  let next = "";
  try {
    next = sessionStorage.getItem(NEXT_KEY) ?? "";
    sessionStorage.removeItem(NEXT_KEY);
  } catch {
    // ignore
  }
  window.location.href = next || "/dashboard";
}

// Called once from the root component. Returns a cleanup function.
export function initNativeApp(): () => void {
  if (!isNativeApp()) return () => {};
  let removed = false;
  const handles: { remove: () => Promise<void> }[] = [];

  void import("@capacitor/app").then(async ({ App }) => {
    const urlOpen = await App.addListener("appUrlOpen", ({ url }) => {
      if (url.startsWith(NATIVE_AUTH_CALLBACK)) void finishOAuth(url);
    });
    if (removed) void urlOpen.remove();
    else handles.push(urlOpen);
  });

  return () => {
    removed = true;
    handles.forEach((h) => void h.remove());
  };
}
