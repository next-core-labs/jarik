import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";

import { cn } from "@/lib/utils";
import { scrollToSection } from "@/components/owner-dashboard/scroll-to-section";

export type SectionLink = { id: string; label: string; count?: number };

/**
 * Sticky in-page navigation for the long owner dashboard: one tab per section, the one in view
 * marked (aria-current), with a count where the section is a to-do list. Plain #anchors, so the
 * sidebar's /owner-dashboard#… links and these tabs land on the same place.
 */
export function SectionNav({ links }: { links: SectionLink[] }) {
  const navigate = useNavigate();
  const [active, setActive] = useState(links[0]?.id ?? "");

  useEffect(() => {
    const sections = links
      .map((l) => document.getElementById(l.id))
      .filter((el): el is HTMLElement => !!el);
    if (sections.length === 0) return;
    // The active section is the last one whose top has scrolled past the band just under the bar.
    const pick = () => {
      const line = 120;
      let current = sections[0]!.id;
      for (const el of sections) if (el.getBoundingClientRect().top <= line) current = el.id;
      // At the very bottom, a short last section can never reach the line — mark it anyway.
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) {
        current = sections[sections.length - 1]!.id;
      }
      setActive(current);
    };
    pick();
    window.addEventListener("scroll", pick, { passive: true });
    window.addEventListener("resize", pick);
    return () => {
      window.removeEventListener("scroll", pick);
      window.removeEventListener("resize", pick);
    };
  }, [links]);

  return (
    <nav
      aria-label="أقسام لوحة المالك"
      className="sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur"
    >
      <ul className="-mb-px flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {links.map((l) => {
          const on = l.id === active;
          return (
            <li key={l.id} className="shrink-0">
              <a
                href={`#${l.id}`}
                aria-current={on ? "location" : undefined}
                onClick={(e) => {
                  const el = document.getElementById(l.id);
                  if (!el) return;
                  e.preventDefault();
                  // Update the hash through the router, not history.replaceState: the router patches
                  // replaceState, and its scroll restoration then jumped the window back to where
                  // the smooth scroll had got to (and dropped the router's history state).
                  void navigate({
                    to: ".",
                    search: true,
                    hash: l.id,
                    replace: true,
                    resetScroll: false,
                    hashScrollIntoView: false,
                  });
                  scrollToSection(el);
                  setActive(l.id);
                }}
                className={cn(
                  "flex h-12 items-center gap-2 border-b-2 px-3 text-sm transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  on
                    ? "border-foreground font-semibold text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {l.label}
                {l.count ? (
                  <span
                    className={cn(
                      "grid h-5 min-w-5 place-items-center px-1 text-[11px] font-semibold tabular-nums",
                      on ? "bg-foreground text-background" : "bg-foreground/10 text-foreground",
                    )}
                  >
                    {l.count.toLocaleString("ar-SA")}
                  </span>
                ) : null}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
