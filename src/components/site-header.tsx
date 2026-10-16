import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { LayoutDashboard, Menu } from "lucide-react";

import { JarakLogo, JarakSymbol } from "@/components/jarak-logo";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { langSearch, translate, useLocale } from "@/lib/i18n";

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
/** The same links in the phone menu: full-width rows, the active one marked by the red bar. */
const MENU_ITEM =
  "flex h-12 items-center border-b border-border px-1 text-base font-medium text-muted-foreground transition-colors hover:text-foreground";
const MENU_ITEM_ACTIVE = {
  className: "font-bold text-foreground shadow-[inset_-3px_0_0_var(--color-primary)] ps-3",
};

/**
 * Header of the public pages (offers market, listing, owner and office pages): a white 64px bar
 * with the horizontal lockup, underlined nav tabs, an AR/EN toggle and an ink sign-in button. The
 * language is the page's ?lang (useLocale), and every header link carries it, so an English visitor
 * stays in English from page to page.
 */
export function SiteHeader() {
  const [locale, setLocale] = useLocale();
  const search = langSearch(locale);
  const signedIn = useIsSignedIn();
  const [menuOpen, setMenuOpen] = useState(false);
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);
  const links = [
    { to: "/", label: t("nav_market"), exact: true },
    { to: "/requests-market", label: t("nav_requests"), exact: false },
    { to: "/offices", label: t("nav_offices"), exact: false },
  ] as const;
  return (
    <header className="relative z-20 h-16 shrink-0 border-b border-border bg-card text-foreground">
      <div className="flex h-full items-center gap-2 px-3 sm:gap-5 sm:px-5">
        <Link
          to="/"
          search={search}
          className="flex shrink-0 items-center"
          aria-label={locale === "en" ? "Jarak" : "جارك"}
        >
          <JarakLogo size="sm" className="hidden sm:inline-flex" />
          <JarakSymbol className="size-[34px] sm:hidden" />
        </Link>
        {/* Phones: the three tabs don't fit beside the logo and buttons, so they move into a menu. */}
        <nav className="hidden h-full min-w-0 flex-1 items-stretch overflow-x-auto sm:flex">
          {links.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              search={search}
              className={NAV_TAB}
              activeProps={NAV_TAB_ACTIVE}
              activeOptions={{ exact: l.exact }}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="flex-1 sm:hidden" />
        <div className="flex shrink-0 items-center gap-2">
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger
              className="flex size-10 items-center justify-center border border-border transition-colors hover:bg-muted sm:hidden"
              aria-label={locale === "ar" ? "القائمة" : "Menu"}
            >
              <Menu className="size-5" />
            </SheetTrigger>
            <SheetContent
              side={locale === "ar" ? "right" : "left"}
              dir={locale === "ar" ? "rtl" : "ltr"}
              className="w-72 p-5"
            >
              <SheetTitle className="mt-8 mb-2 flex items-center gap-2">
                <JarakSymbol className="size-7" />
                <span className="font-display text-lg font-bold">جارك</span>
              </SheetTitle>
              <nav className="flex flex-col">
                {links.map((l) => (
                  <Link
                    key={l.to}
                    to={l.to}
                    search={search}
                    className={MENU_ITEM}
                    activeProps={MENU_ITEM_ACTIVE}
                    activeOptions={{ exact: l.exact }}
                    onClick={() => setMenuOpen(false)}
                  >
                    {l.label}
                  </Link>
                ))}
              </nav>
            </SheetContent>
          </Sheet>
          <button
            type="button"
            onClick={() => setLocale(locale === "ar" ? "en" : "ar")}
            className="flex h-10 items-center border border-border px-2.5 font-[Archivo] text-sm font-semibold transition-colors hover:bg-muted sm:px-3"
            aria-label="Switch language"
          >
            {locale === "ar" ? "EN" : "عربي"}
          </button>
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
