import { startTransition } from "react";

// TanStack Router's <Transitioner> installs `router.startTransition` while it renders, and that
// function calls its own setState. On a cold load the router keeps loading (the auth gate, match
// updates) while React is still hydrating, so an update landing between the Transitioner's first
// render and its commit hits a component that hasn't mounted yet — React's dev error "Can't
// perform a React state update on a component that hasn't mounted yet". Until the root has
// committed (markRouterMounted, called from __root.tsx), those updates run in a plain React
// transition instead; afterwards the Transitioner's own function is used as usual.
const mountedRouters = new WeakSet<object>();

export function markRouterMounted(router: object) {
  mountedRouters.add(router);
}

export function deferTransitionerUntilMounted(router: {
  startTransition: (fn: () => void) => void;
}) {
  const beforeMount = (fn: () => void) => startTransition(fn);
  let installed = beforeMount;
  Object.defineProperty(router, "startTransition", {
    configurable: true,
    get: () => (mountedRouters.has(router) ? installed : beforeMount),
    set: (fn: (fn: () => void) => void) => {
      installed = fn;
    },
  });
}
