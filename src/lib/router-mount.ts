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

// Router signature since @tanstack/router-core 1.171: `expected` lists the matches the render must
// acknowledge, and the promise says whether one did. Before mount nothing renders to acknowledge
// it, so resolve false — the same answer router-core's own default gives.
type StartTransition = (fn: () => void, expected: never) => Promise<boolean>;

export function deferTransitionerUntilMounted(router: { startTransition: StartTransition }) {
  const beforeMount: StartTransition = async (fn) => {
    startTransition(fn);
    return false;
  };
  let installed = beforeMount;
  Object.defineProperty(router, "startTransition", {
    configurable: true,
    get: () => (mountedRouters.has(router) ? installed : beforeMount),
    set: (fn: StartTransition) => {
      installed = fn;
    },
  });
}
