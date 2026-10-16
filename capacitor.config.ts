// Android + iOS shells (Capacitor). The site is SSR + server functions on the Cloudflare Worker,
// so the apps load the live site rather than a static bundle: every deploy (`npm run deploy`)
// reaches the apps too, and only native changes (this file, plugins, icons) need `npm run cap:sync`
// and a new store build. `capacitor/www` only holds the page shown when the site can't be reached.
// Setup, Supabase redirect URL and store builds: DEPLOY.md → Part C.
import type { CapacitorConfig } from "@capacitor/cli";

// Set CAP_SERVER_URL=http://<your LAN IP>:8080 to point a dev build at `npm run dev`.
const serverUrl = process.env.CAP_SERVER_URL || "https://jarak-ksa.com";

const config: CapacitorConfig = {
  appId: "com.jarakksa.app",
  appName: "جارك",
  webDir: "capacitor/www",
  server: {
    url: serverUrl,
    cleartext: serverUrl.startsWith("http://"),
    errorPath: "offline.html",
    // www redirects to the apex; anything else (Supabase storage, WhatsApp, maps) opens outside.
    allowNavigation: ["www.jarak-ksa.com"],
  },
  ios: {
    // The site doesn't use viewport-fit=cover, so let iOS keep it clear of the notch/home bar.
    contentInset: "automatic",
    backgroundColor: "#F3F2F2",
  },
  android: {
    backgroundColor: "#F3F2F2",
  },
  plugins: {
    SystemBars: {
      insetsHandling: "native",
      // Dark icons on the plaster background.
      style: "LIGHT",
    },
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: "#F3F2F2",
      showSpinner: false,
    },
  },
};

export default config;
