// Plain TanStack Start + Vite build, deployed to Cloudflare Workers through nitro's
// `cloudflare-module` preset (it writes .output/server/wrangler.json, merged with ./wrangler.jsonc).
import { existsSync, readFileSync } from "node:fs";
import { defineConfig, loadEnv } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { nitro } from "nitro/vite";

// Server-only secrets (service role key, AI key, …) live in the git-ignored .dev.vars, the same
// file wrangler uses. `vite dev` only reads .env*, so copy .dev.vars into process.env here.
// Variables already set in the shell win.
function loadDevVars() {
  const path = `${process.cwd()}/.dev.vars`;
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^\s*([A-Za-z0-9_]+)\s*=\s*"?(.*?)"?\s*$/.exec(line);
    if (m && m[2] && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2];
  }
}

export default defineConfig(({ command, mode }) => {
  if (command === "serve") loadDevVars();

  // Bake the public VITE_* values (Supabase URL + publishable key) into both the client and the
  // SSR bundle, so the Worker never depends on them being set as runtime variables.
  const publicEnv = loadEnv(mode, process.cwd(), "VITE_");
  const define = Object.fromEntries(
    Object.entries(publicEnv).map(([key, value]) => [
      `import.meta.env.${key}`,
      JSON.stringify(value),
    ]),
  );

  return {
    define,
    css: { transformer: "lightningcss" },
    resolve: {
      alias: { "@": `${process.cwd()}/src` },
      dedupe: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "@tanstack/react-query",
        "@tanstack/query-core",
      ],
    },
    optimizeDeps: {
      include: [
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
      ],
    },
    server: { host: "::", port: 8080 },
    plugins: [
      tailwindcss(),
      tsConfigPaths({ projects: ["./tsconfig.json"] }),
      tanstackStart({
        // Server-only modules can never be pulled into the browser bundle.
        importProtection: {
          behavior: "error",
          client: { files: ["**/server/**"], specifiers: ["server-only"] },
        },
        // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
        server: { entry: "server" },
      }),
      command === "build" &&
        nitro({
          preset: "cloudflare-module",
          cloudflare: { nodeCompat: true, deployConfig: true },
        }),
      viteReact(),
    ],
  };
});
