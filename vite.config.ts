// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { resolve } from "node:path";
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/tanstack/vite";

// @lovable.dev/mcp-js compares Vite's `config.root` (always forward slashes) with `path.resolve()`
// output (backslashes on Windows), so `vite dev` and `vite build` throw
// "routesDir ... must resolve under ..." on Windows. Hand the plugin a native-separator root.
// On Linux/macOS `resolve(root)` returns the same string, so this is a no-op there.
const mcp = mcpPlugin();
const originalConfigResolved = mcp.configResolved;
if (typeof originalConfigResolved === "function") {
  mcp.configResolved = function (config) {
    return originalConfigResolved.call(this, { ...config, root: resolve(config.root) });
  };
}

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    plugins: [mcp],
  },
});
