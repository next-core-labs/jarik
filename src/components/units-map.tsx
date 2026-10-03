import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import { escapeHtml } from "@/lib/escape-html";

export type MapProperty = {
  name: string;
  city: string | null;
  district: string | null;
  lat: number;
  lng: number;
  unitsCount: number;
  occupied: number;
  vacant: number;
  sold: number;
  rent: number;
};

/** خريطة تفاعلية للعقارات بألوان الإشغال — تُحمّل ديناميكيًا بعد فتح الصفحة. */
export default function UnitsMap({ properties }: { properties: MapProperty[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, { scrollWheelZoom: true }).setView(
      [24.7136, 46.6753],
      10,
    );
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap",
    }).addTo(map);

    const group = L.featureGroup();
    for (const p of properties) {
      // Green means "fully occupied" — a property with nothing occupied and nothing vacant
      // (fully sold, or every unit under maintenance) is neither, so it falls back to gray rather
      // than misreporting a green "fully occupied" property that has no tenants at all.
      const color =
        p.unitsCount === 0
          ? "#64748b"
          : p.vacant > 0
            ? "#d97706"
            : p.occupied > 0
              ? "#16a34a"
              : "#64748b";
      const marker = L.circleMarker([p.lat, p.lng], {
        radius: 11,
        color,
        fillColor: color,
        fillOpacity: 0.75,
        weight: 2,
      }).bindPopup(
        // Leaflet renders string popups with innerHTML, and name/city/district are user-entered.
        `<div dir="rtl" style="font-family:inherit"><b>${escapeHtml(p.name)}</b><br/>` +
          `${escapeHtml([p.city, p.district ? `حي ${p.district}` : null].filter(Boolean).join(" · "))}<br/>` +
          `الوحدات: ${p.unitsCount} · مشغولة: ${p.occupied} · شاغرة: ${p.vacant}` +
          (p.sold > 0 ? ` · مباعة: ${p.sold}` : "") +
          `<br/>` +
          `إيجارات محصّلة سنويًا: ${Math.round(p.rent).toLocaleString("ar-SA")} ر.س</div>`,
      );
      marker.addTo(map);
      group.addLayer(marker);
    }
    if (group.getLayers().length > 0) {
      map.fitBounds(group.getBounds().pad(0.3));
    }
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [properties]);

  return (
    <div
      ref={containerRef}
      dir="ltr"
      className="h-[520px] w-full overflow-hidden rounded-md border border-border"
    />
  );
}
