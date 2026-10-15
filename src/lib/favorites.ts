import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";

/**
 * Saved listings (the heart). Signed-in visitors keep them in `listing_favorites` (RLS: own rows
 * only); signed-out visitors keep them in this browser, and those are merged into the account the
 * first time they sign in here. One shared store, so every heart on the page agrees.
 */

const STORAGE_KEY = "jarak-favorites";
const MAX_LOCAL = 500;

// ── Browser store (signed-out) ────────────────────────────────────────────────────────────────
let localIds: string[] | null = null;
const listeners = new Set<() => void>();

function readLocal(): string[] {
  if (localIds) return localIds;
  try {
    const raw = typeof window === "undefined" ? null : localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    localIds = Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    localIds = [];
  }
  return localIds;
}

function writeLocal(ids: string[]) {
  localIds = ids.slice(0, MAX_LOCAL);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(localIds));
  } catch {
    // Private mode / blocked storage: favourites last for this visit only.
  }
  listeners.forEach((l) => l());
}

const EMPTY: string[] = [];
function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== STORAGE_KEY) return;
    localIds = null;
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

// ── Session ─────────────────────────────────────────────────────────────────────────────────
/** The signed-in user's id; undefined until the stored session has been read. */
function useUserId(): string | null | undefined {
  const [userId, setUserId] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(({ data }) => {
      if (alive) setUserId(data.session?.user.id ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUserId(session?.user.id ?? null);
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);
  return userId;
}

export function useFavorites() {
  const userId = useUserId();
  const qc = useQueryClient();
  const local = useSyncExternalStore(subscribe, readLocal, () => EMPTY);
  const key = ["favorites", userId] as const;

  const remote = useQuery({
    queryKey: key,
    enabled: Boolean(userId),
    staleTime: 60_000,
    queryFn: async (): Promise<string[]> => {
      // Bring this browser's favourites into the account once, then keep the account's list.
      const pending = readLocal();
      if (pending.length > 0 && userId) {
        // One insert each: a listing that has since left the market fails the RLS check on its own
        // without sinking the rest. Duplicates (23505) and those failures are both fine to drop.
        const results = await Promise.all(
          pending.map((unit_id) =>
            supabase.from("listing_favorites").insert({ user_id: userId, unit_id }),
          ),
        );
        const unreachable = results.some(
          (r) => r.error && !["23505", "42501"].includes(r.error.code ?? ""),
        );
        if (!unreachable) writeLocal([]);
      }
      const { data, error } = await supabase
        .from("listing_favorites")
        .select("unit_id")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((r) => r.unit_id);
    },
  });

  const toggleRemote = useMutation({
    mutationFn: async ({ id, on }: { id: string; on: boolean }) => {
      if (!userId) return;
      const { error } = on
        ? await supabase.from("listing_favorites").insert({ user_id: userId, unit_id: id })
        : await supabase.from("listing_favorites").delete().eq("user_id", userId).eq("unit_id", id);
      if (error && error.code !== "23505") throw error;
    },
    onMutate: async ({ id, on }) => {
      await qc.cancelQueries({ queryKey: key });
      const before = qc.getQueryData<string[]>(key);
      qc.setQueryData<string[]>(key, (ids = []) =>
        on ? [id, ...ids.filter((x) => x !== id)] : ids.filter((x) => x !== id),
      );
      return { before };
    },
    onError: (_e, _v, ctx) => {
      qc.setQueryData(key, ctx?.before);
      toast.error("تعذّر حفظ المفضلة — حاول مرة أخرى");
    },
  });

  const ids = useMemo(
    () => new Set(userId ? (remote.data ?? []) : local),
    [userId, remote.data, local],
  );

  const toggle = useCallback(
    (id: string) => {
      const on = !ids.has(id);
      if (userId) toggleRemote.mutate({ id, on });
      else
        writeLocal(
          on ? [id, ...readLocal().filter((x) => x !== id)] : readLocal().filter((x) => x !== id),
        );
    },
    [ids, userId, toggleRemote],
  );

  return { ids, has: (id: string) => ids.has(id), toggle, signedIn: Boolean(userId) };
}
