import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import { escapeHtml } from "@/lib/escape-html";
import type { NearbyPlace } from "@/lib/nearby-places.functions";

const COLOR_BY_KIND: Record<NearbyPlace["kind"], string> = {
  school: "#2563eb",
  mosque: "#16a34a",
  market: "#d97706",
  other: "#64748b",
};

/** خريطة صغيرة لموقع الوحدة التقريبي وأقرب الخدمات — تُحمّل ديناميكيًا في صفحة العرض العامة. */
export default function NearbyPlacesMap({
  lat,
  lng,
  places,
}: {
  lat: number;
  lng: number;
  places: NearbyPlace[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, { scrollWheelZoom: false }).setView([lat, lng], 14);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap",
    }).addTo(map);

    L.circleMarker([lat, lng], {
      radius: 12,
      color: "#9f1239",
      fillColor: "#9f1239",
      fillOpacity: 0.85,
      weight: 2,
    })
      .bindPopup('<div dir="rtl">موقع العرض التقريبي</div>')
      .addTo(map);

    // أسماء الخدمات القريبة تأتي من مصدر خارجي (OSM) — تُهرَّب قبل إدراجها بـ innerHTML الخاص بـ
    // نافذة Leaflet المنبثقة، بنفس الأسلوب المتّبع بخريطة الإشغال الداخلية.
    for (const p of places) {
      L.circleMarker([p.lat, p.lng], {
        radius: 7,
        color: COLOR_BY_KIND[p.kind],
        fillColor: COLOR_BY_KIND[p.kind],
        fillOpacity: 0.8,
        weight: 1.5,
      })
        .bindPopup(`<div dir="rtl">${escapeHtml(p.name)}</div>`)
        .addTo(map);
    }

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [lat, lng, places]);

  return (
    <div
      ref={containerRef}
      dir="ltr"
      className="h-72 w-full overflow-hidden rounded-md border border-border"
    />
  );
}
