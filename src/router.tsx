import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { deferTransitionerUntilMounted } from "@/lib/router-mount";

export const getRouter = () => {
  // supabase-js already retries failed GET reads itself, so React Query's default of 3 more rounds
  // stacked into ~16 requests (~40 s) before a load error showed. One retry is enough.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1 } } });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  deferTransitionerUntilMounted(router);

  return router;
};
