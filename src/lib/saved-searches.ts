import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { publicSar } from "@/lib/format";
import { translate, type Locale } from "@/lib/i18n";
import type { MarketFilters } from "@/lib/market";

/**
 * تنبيهات البحث المحفوظ: المسجّل يحفظ فلاتر بحثه من سوق العروض (saved_searches، RLS صفوفه هو فقط
 * وبحد 10)، وكل ساعة تفحص notify_saved_search_matches العروض الجديدة وتبعث إشعارًا داخليًا.
 */
export type SavedSearch = Tables<"saved_searches">;

/** البحث لا يُحفظ مرتين (فهرس فريد) — الواجهة تعرضها رسالة ودّية بدل خطأ. */
export const DUPLICATE_CODE = "23505";

/** The signed-in user's id; undefined until the stored session has been read (favorites.ts style). */
export function useUserId(): string | null | undefined {
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

export function useSavedSearches() {
  const userId = useUserId();
  const qc = useQueryClient();
  const key = ["saved-searches", userId] as const;

  const list = useQuery({
    queryKey: key,
    enabled: Boolean(userId),
    staleTime: 60_000,
    queryFn: async (): Promise<SavedSearch[]> => {
      const { data, error } = await supabase
        .from("saved_searches")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const save = useMutation({
    mutationFn: async (f: MarketFilters) => {
      const { error } = await supabase.from("saved_searches").insert({
        text_query: f.text.trim().slice(0, 120),
        purpose: f.purpose,
        unit_type: f.unitType,
        min_rooms: f.minRooms,
        furnished: f.furnished,
        max_price: f.maxPrice,
      });
      if (error) throw Object.assign(new Error(error.message), { code: error.code });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("saved_searches").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  return { userId, list, save, remove };
}

/** وصف بحث محفوظ بكلمات المستخدم: «للإيجار · شقة · 3+ غرف · حتى 50,000 ر.س · "الملقا"». */
export function savedSearchLabel(s: SavedSearch, locale: Locale): string {
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);
  const parts = [
    s.purpose === "rent" ? t("tab_rent") : s.purpose === "sale" ? t("tab_sale") : t("tab_all"),
    s.unit_type || null,
    s.min_rooms > 0 ? (locale === "en" ? `${s.min_rooms}+ rooms` : `${s.min_rooms}+ غرف`) : null,
    s.furnished === "yes"
      ? t("filter_furnished_yes")
      : s.furnished === "no"
        ? t("filter_furnished_no")
        : null,
    s.max_price != null
      ? locale === "en"
        ? `up to ${publicSar(Number(s.max_price), locale)}`
        : `حتى ${publicSar(Number(s.max_price), locale)}`
      : null,
    s.text_query ? `«${s.text_query}»` : null,
  ].filter(Boolean);
  return parts.join(" · ");
}
