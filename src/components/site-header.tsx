import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { LayoutDashboard } from "lucide-react";

import { JarakLogo, JarakSymbol } from "@/components/jarak-logo";
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

/** A nav tab of the public header: the active page carries the 3px red underline (the header's
 *  one red element — the brand bar under "you are here"). */
const NAV_TAB =
  "flex h-16 items-center px-2 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground sm:px-4 sm:text-[15px]";
const NAV_TAB_ACTIVE = {
  className: "font-bold text-foreground shadow-[inset_0_-3px_0_var(--color-primary)]",
};

/**
 * Header of the public pages (offers market, listing, owner and office pages): a white 64px bar
 * with the horizontal lockup, underlined nav tabs, and an ink sign-in button. The AR/EN toggle only
 * appears where a caller passes `locale`/`onLocaleChange` (today: the marketplace homepage and the
 * unit listing page) — every other public page stays Arabic-only.
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
    <header className="relative z-20 h-16 shrink-0 border-b border-border bg-card text-foreground">
      <div className="flex h-full items-center gap-2 px-3 sm:gap-5 sm:px-5">
        <Link to="/" className="flex shrink-0 items-center" aria-label="جارك">
          <JarakLogo size="sm" className="hidden sm:inline-flex" />
          <JarakSymbol className="size-[34px] sm:hidden" />
        </Link>
        <nav className="flex h-full min-w-0 flex-1 items-stretch overflow-x-auto">
          <Link
            to="/"
            className={NAV_TAB}
            activeProps={NAV_TAB_ACTIVE}
            activeOptions={{ exact: true }}
          >
            {t("nav_market")}
          </Link>
          <Link to="/requests-market" className={NAV_TAB} activeProps={NAV_TAB_ACTIVE}>
            {t("nav_requests")}
          </Link>
          <Link to="/offices" className={NAV_TAB} activeProps={NAV_TAB_ACTIVE}>
            {t("nav_offices")}
          </Link>
        </nav>
        <div className="flex shrink-0 items-center gap-2">
          {onLocaleChange ? (
            <button
              type="button"
              onClick={() => onLocaleChange(locale === "ar" ? "en" : "ar")}
              className="flex h-10 items-center border border-border px-2.5 font-[Archivo] text-sm font-semibold transition-colors hover:bg-muted sm:px-3"
              aria-label="Switch language"
            >
              {locale === "ar" ? "EN" : "عربي"}
            </button>
          ) : null}
          {signedIn ? (
            <Link
              to="/dashboard"
              className="flex h-10 items-center gap-2 border border-border px-3 text-sm font-semibold transition-colors hover:bg-muted"
            >
              <LayoutDashboard className="size-4" />
              {t("nav_dashboard")}
            </Link>
          ) : (
            <Link
              to="/auth"
              className="flex h-10 items-center bg-foreground px-4 text-[15px] font-semibold text-background transition-colors hover:bg-foreground/90"
            >
              {t("nav_signin")}
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

/** Ink band backdrop for the hero and profile bands: one oversized stone symbol (the two homes)
 *  bleeding off the far edge, as on the social covers — flat, no gradients. Sits at the inline end
 *  (left in RTL) so it never runs behind the band's heading. */
const BAND_SYMBOL =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="#F3F2F2" fill-opacity="0.045">' +
      '<path fill-rule="evenodd" d="M8 94V38A20 20 0 0 1 48 38V82H94V94Z M20 94V64A8 8 0 0 1 36 64V94Z"/>' +
      '<path fill-rule="evenodd" d="M54 76V52A18 18 0 0 1 90 52V76Z M64 76V62A8 8 0 0 1 80 62V76Z"/>' +
      "</svg>",
  );

export const bandPatternStyle = {
  backgroundImage: `url("${BAND_SYMBOL}")`,
  backgroundRepeat: "no-repeat",
  backgroundPosition: "left 4% top 30%",
  backgroundSize: "auto 150%",
} as const;
