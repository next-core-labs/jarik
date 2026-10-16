let stopSettling: (() => void) | null = null;

/**
 * Smooth-scroll a section to the top (under the sticky bar, via its scroll-margin-top), and keep
 * re-aiming while the page settles: the lazy map and the charts above #units and #map change height
 * mid-scroll, which used to leave those headings under the top edge. Stops after a couple of
 * seconds, or as soon as the reader scrolls on their own.
 */
export function scrollToSection(el: HTMLElement) {
  stopSettling?.();
  const aim = () => el.scrollIntoView({ behavior: "smooth", block: "start" });
  aim();
  if (typeof ResizeObserver === "undefined") return;
  const observer = new ResizeObserver(aim);
  observer.observe(document.body);
  const userEvents = ["wheel", "touchstart", "keydown", "pointerdown"] as const;
  const stop = () => {
    observer.disconnect();
    window.clearTimeout(timer);
    for (const type of userEvents) window.removeEventListener(type, stop);
    if (stopSettling === stop) stopSettling = null;
  };
  const timer = window.setTimeout(stop, 2500);
  for (const type of userEvents) window.addEventListener(type, stop, { passive: true });
  stopSettling = stop;
}
