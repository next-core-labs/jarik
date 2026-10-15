import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import { escapeHtml } from "@/lib/escape-html";
import { HOME_ARCH_PIN_HTML, serviceSquareHtml } from "@/lib/map-markers";
import { addBrandTiles, htmlIcon } from "@/lib/map-style";
import type { NearbyPlace } from "@/lib/nearby-places.functions";
import { cn } from "@/lib/utils";

/**
 * خريطة صغيرة لموقع الوحدة التقريبي وأقرب الخدمات — تُحمّل ديناميكيًا في صفحة العرض العامة.
 * The unit is the red arch inside a dashed "approximate" circle (its exact spot is shared only after
 * contacting the office); services are neutral glyph squares.
 */
export default function NearbyPlacesMap({
  lat,
  lng,
  places,
  className,
}: {
  lat: number;
  lng: number;
  places: NearbyPlace[];
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const placesLayerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const map = L.map(containerRef.current, { scrollWheelZoom: false, zoomControl: false }).setView(
      [lat, lng],
      15,
    );
    L.control.zoom({ position: "bottomleft" }).addTo(map);
    addBrandTiles(L, map);

    L.circle([lat, lng], {
      radius: 260,
      color: "#EC3013",
      weight: 1.5,
      dashArray: "4 4",
      fillColor: "#EC3013",
      fillOpacity: 0.1,
      interactive: false,
    }).addTo(map);
    L.marker([lat, lng], { icon: htmlIcon(L, HOME_ARCH_PIN_HTML), title: "موقع العرض التقريبي" })
      .bindPopup('<div dir="rtl">موقع العرض التقريبي</div>')
      .addTo(map);

    placesLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      placesLayerRef.current = null;
    };
  }, [lat, lng]);

  useEffect(() => {
    const layer = placesLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    // أسماء الخدمات القريبة تأتي من مصدر خارجي (OSM) — تُهرَّب قبل إدراجها بـ innerHTML الخاص بـ
    // تلميح Leaflet، بنفس الأسلوب المتّبع بخريطة الإشغال الداخلية.
    for (const p of places) {
      L.marker([p.lat, p.lng], { icon: htmlIcon(L, serviceSquareHtml(p.kind)) })
        .bindTooltip(escapeHtml(p.name), { direction: "top" })
        .addTo(layer);
    }
  }, [places, lat, lng]);

  return (
    <div
      ref={containerRef}
      dir="ltr"
      className={cn("isolate h-72 w-full overflow-hidden bg-[#ECEAE6]", className)}
    />
  );
}
