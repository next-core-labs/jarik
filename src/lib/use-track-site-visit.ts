import { useEffect, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";

import { trackSiteVisit } from "@/lib/office-tools.functions";

const VISITOR_ID_KEY = "jarak-visitor-id";

/** معرّف زائر مجهول ثابت بالمتصفح (بلا أي بيانات شخصية) — لحساب "أشخاص فريدين" لا مجرد عدد
 * مشاهدات صفحات. يفشل بهدوء لمتصفح خاص/localStorage محظور — يرجع معرّفًا جديدًا بكل مرة، يعني
 * الزائر ذاك يُحسب أكثر من مرة (تقليل دقة العدّ، لا كسر بالميزة). */
function getVisitorId(): string {
  try {
    const existing = localStorage.getItem(VISITOR_ID_KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    localStorage.setItem(VISITOR_ID_KEY, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

/** يسجّل زيارة الصفحة العامة الحالية مرة وحدة لكل تحميل فعلي بالمتصفح — عمدًا بدون تسجيل بالخادم
 * (loader/SSR) حتى ما تُحتسب زيارات بوتات معاينة الروابط (واتساب وغيره) كزيارات حقيقية، نفس مبدأ
 * تتبّع مشاهدة صفحة الوحدة بـunit.$unitId.tsx. */
export function useTrackSiteVisit(path: string) {
  const track = useServerFn(trackSiteVisit);
  const tracked = useRef(false);
  useEffect(() => {
    if (tracked.current) return;
    tracked.current = true;
    track({ data: { path, visitorId: getVisitorId() } }).catch(() => {});
  }, [path, track]);
}
