import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Bell, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { userErrorMessage } from "@/lib/auth-errors";
import { translate, type Locale } from "@/lib/i18n";
import type { MarketFilters } from "@/lib/market";
import { DUPLICATE_CODE, savedSearchLabel, useSavedSearches } from "@/lib/saved-searches";

/**
 * جرس «تنبيهات البحث» في سوق العروض: يحفظ فلاتر البحث الحالية ويدير المحفوظ منها. التنبيه نفسه
 * يصل إشعارًا داخليًا كل ساعة من notify_saved_search_matches (migration 20261118110000).
 */
export function SavedSearchBell({ filters, locale }: { filters: MarketFilters; locale: Locale }) {
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);
  const { userId, list, save, remove } = useSavedSearches();
  const [open, setOpen] = useState(false);
  const searches = list.data ?? [];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-9 shrink-0 gap-1.5 text-[13px] font-semibold"
          aria-label={t("ss_title")}
        >
          <Bell className="size-4" aria-hidden />
          {t("ss_title")}
          {searches.length > 0 ? (
            <span className="tabular-nums text-muted-foreground">({searches.length})</span>
          ) : null}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("ss_title")}</DialogTitle>
          <DialogDescription>{t("ss_note")}</DialogDescription>
        </DialogHeader>

        {userId === null ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">{t("ss_signin")}</p>
            <Button asChild className="w-full">
              <Link to="/auth" search={{ next: "/" }}>
                {t("ss_signin_cta")}
              </Link>
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <Button
              className="w-full"
              disabled={save.isPending || userId === undefined}
              onClick={() =>
                save.mutate(filters, {
                  onSuccess: () => toast.success(t("ss_saved")),
                  onError: (e) =>
                    (e as { code?: string }).code === DUPLICATE_CODE
                      ? toast.info(t("ss_duplicate"))
                      : toast.error(userErrorMessage(e as Error, t("ss_error"))),
                })
              }
            >
              <Bell className="size-4" aria-hidden />
              {save.isPending ? t("ss_saving") : t("ss_save_current")}
            </Button>

            {searches.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground">{t("ss_empty")}</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                <p className="text-xs font-semibold text-muted-foreground">{t("ss_saved_list")}</p>
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {searches.map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-2 px-3 py-2">
                      <span className="min-w-0 truncate text-sm">
                        {savedSearchLabel(s, locale)}
                      </span>
                      <button
                        type="button"
                        aria-label={t("ss_delete")}
                        title={t("ss_delete")}
                        disabled={remove.isPending}
                        onClick={() =>
                          remove.mutate(s.id, { onSuccess: () => toast.success(t("ss_deleted")) })
                        }
                        className="grid size-8 shrink-0 place-items-center text-muted-foreground transition-colors hover:text-red-text disabled:opacity-50"
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
