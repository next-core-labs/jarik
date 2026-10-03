import type { AppRole } from "@/lib/use-role";

export type PortalDestination = {
  role: "office" | "owner" | "tenant";
  label: string;
  path: string;
};

/** أين يوصل هذا الحساب بعد الدخول، لكل "هوية" يملكها (موظف/مالك/مستأجر) — قد تكون أكثر من واحدة. */
export function portalDestinations(roles: AppRole[]): PortalDestination[] {
  const out: PortalDestination[] = [];
  if (roles.some((r) => r === "admin" || r === "staff")) {
    out.push({ role: "office", label: "مكتب", path: "/dashboard" });
  }
  if (roles.includes("owner")) out.push({ role: "owner", label: "مالك", path: "/owner-dashboard" });
  if (roles.includes("tenant"))
    out.push({ role: "tenant", label: "مستأجر", path: "/tenant-dashboard" });
  return out;
}

/** وجهة واحدة بعد الدخول: مباشرة لو هوية واحدة بس، أو شاشة الاختيار لو أكثر من هوية لنفس الحساب. */
export function resolvePostLoginPath(roles: AppRole[]): string {
  const dests = portalDestinations(roles);
  if (dests.length === 0) return "/portal"; // e.g. technician-only, or no role at all yet
  if (dests.length === 1) return dests[0]!.path;
  return "/choose-role";
}
