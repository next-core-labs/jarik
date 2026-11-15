import { useEffect, useState } from "react";

/**
 * Which portal an account that is BOTH owner and tenant is using right now. The owner and tenant
 * dashboards set it; the pages they share (/messages, /documents, /notifications…) keep it, so the
 * menu, the conversations and the payments shown stay on the side the person chose instead of
 * flipping to the tenant view whenever the URL doesn't start with /owner.
 */
export type PortalSide = "owner" | "tenant";

const KEY = "jarak:portal-side";

/** The side a URL belongs to, or null for a shared page. */
export function sideFromPath(pathname: string): PortalSide | null {
  if (pathname.startsWith("/owner")) return "owner";
  if (pathname.startsWith("/tenant")) return "tenant";
  return null;
}

function remembered(): PortalSide | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "owner" || v === "tenant" ? v : null;
  } catch {
    return null;
  }
}

/** The current side: the URL's when it has one (and remembered), else the last one used. */
export function usePortalSide(pathname: string): PortalSide {
  const fromPath = sideFromPath(pathname);
  const [last, setLast] = useState<PortalSide | null>(null);
  useEffect(() => {
    if (fromPath) {
      try {
        localStorage.setItem(KEY, fromPath);
      } catch {
        // storage blocked: the side follows the URL only
      }
      setLast(fromPath);
    } else {
      setLast(remembered());
    }
  }, [fromPath]);
  return fromPath ?? last ?? "tenant";
}
