import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, LayoutDashboard } from "lucide-react";

import jarakLogo from "@/assets/jarak-logo.png";
import { supabase } from "@/integrations/supabase/client";
import { translate, useLocale, type Locale } from "@/lib/i18n";

/** null until the stored session has been read (avoids flashing the wrong button). */
export function useIsSignedIn(): boolean | null {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(({ data }) => {
      if (alive) setSignedIn(Boolean(data.session));
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedIn(Boolean(session));
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);
  return signedIn;
}

/**
 * Header of the public pages (offers market, listing, owner and office pages). The AR/EN toggle
 * only appears where a caller passes `locale`/`onLocaleChange` (today: the marketplace homepage
 * and the unit listing page) — every other public page keeps its current Arabic-only header
 * unchanged.
 */
export function SiteHeader({
  locale = "ar",
  onLocaleChange,
}: {
  locale?: Locale;
  onLocaleChange?: (l: Locale) => void;
}) {
  const signedIn = useIsSignedIn();
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);
  return (
    <header className="bg-sidebar text-sidebar-foreground">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
        <Link to="/" className="flex items-center gap-2">
          <img
            src={jarakLogo}
            alt="جارك"
            width={40}
            height={40}
            className="size-10 bg-background p-1"
          />
          <span className="font-display text-lg font-bold">جارك</span>
        </Link>
        <nav className="flex items-center gap-1 text-sm whitespace-nowrap sm:gap-2">
          <Link
            to="/"
            className="rounded-md px-3 py-2 transition-colors hover:bg-sidebar-accent"
            activeProps={{ className: "bg-sidebar-accent" }}
            activeOptions={{ exact: true }}
          >
            {t("nav_market")}
          </Link>
          <Link
            to="/requests-market"
            className="rounded-md px-3 py-2 transition-colors hover:bg-sidebar-accent"
            activeProps={{ className: "bg-sidebar-accent" }}
          >
            {t("nav_requests")}
          </Link>
          <Link
            to="/offices"
            className="hidden rounded-md px-3 py-2 transition-colors hover:bg-sidebar-accent sm:block"
            activeProps={{ className: "bg-sidebar-accent" }}
          >
            {t("nav_offices")}
          </Link>
          {onLocaleChange ? (
            <button
              type="button"
              onClick={() => onLocaleChange(locale === "ar" ? "en" : "ar")}
              className="rounded-md border border-sidebar-foreground/30 px-2 py-1.5 text-xs font-medium transition-colors hover:bg-sidebar-accent"
              aria-label="Switch language"
            >
              {locale === "ar" ? "EN" : "عربي"}
            </button>
          ) : null}
          {signedIn ? (
            <Link
              to="/dashboard"
              className="inline-flex items-center gap-2 rounded-md bg-sidebar-primary px-3 py-2 font-medium text-sidebar-primary-foreground transition-opacity hover:opacity-90"
            >
              <LayoutDashboard className="size-4" />
              {t("nav_dashboard")}
            </Link>
          ) : (
            <Link
              to="/auth"
              className="inline-flex items-center gap-2 rounded-md bg-sidebar-primary px-3 py-2 font-medium text-sidebar-primary-foreground transition-opacity hover:opacity-90"
            >
              <span className="sm:hidden">{locale === "ar" ? "دخول" : "In"}</span>
              <span className="hidden sm:inline">{t("nav_signin")}</span>
              <ArrowLeft className="size-4" />
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}

/** Subtle geometric pattern used behind the hero and profile bands. */
export const bandPatternStyle = {
  backgroundImage:
    // The second radial highlight used the old brass-gold accent (oklch(0.68 0.1 80)) — updated
    // to the exact brand red (#EC3013) so it reads correctly against the new ink header background.
    "radial-gradient(circle at 20% 20%, oklch(1 0 0 / 0.07) 0, transparent 40%), radial-gradient(circle at 85% 70%, rgba(236, 48, 19, 0.16) 0, transparent 45%), repeating-linear-gradient(45deg, oklch(1 0 0 / 0.035) 0 2px, transparent 2px 22px), repeating-linear-gradient(-45deg, oklch(1 0 0 / 0.035) 0 2px, transparent 2px 22px)",
} as const;
