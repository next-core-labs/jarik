import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import { escapeHtml } from "@/lib/escape-html";
import { arNum } from "@/lib/format";
import { occupancyColor, serviceSquareHtml } from "@/lib/map-markers";
import { addBrandTiles, htmlIcon } from "@/lib/map-style";
import type { NearbyPlace } from "@/lib/nearby-places.functions";
import { cn } from "@/lib/utils";

export type MapProperty = {
  /** Needed only when the map is selectable (onSelect / selectedId). */
  id?: string;
  name: string;
  city: string | null;
  district: string | null;
  lat: number;
  lng: number;
  unitsCount: number;
  occupied: number;
  vacant: number;
  sold: number;
  /** Annual rent of the occupied units (the owner dashboard uses the lease's contracted rent). */
  rent: number;
};

const RADIUS = 11;
const SELECTED_RADIUS = 15;

/**
 * خريطة تفاعلية للعقارات بألوان الإشغال — تُحمّل ديناميكيًا بعد فتح الصفحة.
 *
 * Optional, for the owner dashboard: clicking a property selects it (onSelect), the selected one
 * is enlarged and flown to, and `nearby` overlays the services around it.
 */
export default function UnitsMap({
  properties,
  selectedId = null,
  onSelect,
  nearby = [],
  className,
}: {
  properties: MapProperty[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  nearby?: NearbyPlace[];
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const boundsRef = useRef<L.LatLngBounds | null>(null);
  const markersRef = useRef(new Map<string, L.CircleMarker>());
  const nearbyLayerRef = useRef<L.LayerGroup | null>(null);
  // Read through a ref so a new callback identity never rebuilds the map.
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, { scrollWheelZoom: true }).setView(
      [24.7136, 46.6753],
      10,
    );
    addBrandTiles(L, map);

    const group = L.featureGroup();
    const markers = markersRef.current;
    for (const p of properties) {
      // Green means "fully occupied" — a property with nothing occupied and nothing vacant
      // (fully sold, or every unit under maintenance) is neither, so it falls back to gray rather
      // than misreporting a green "fully occupied" property that has no tenants at all.
      const color = occupancyColor(p);
      const marker = L.circleMarker([p.lat, p.lng], {
        radius: RADIUS,
        color,
        fillColor: color,
        fillOpacity: 0.75,
        weight: 2,
      }).bindPopup(
        // Leaflet renders string popups with innerHTML, and name/city/district are user-entered.
        `<div dir="rtl" style="font-family:inherit"><b>${escapeHtml(p.name)}</b><br/>` +
          `${escapeHtml([p.city, p.district ? `حي ${p.district}` : null].filter(Boolean).join(" · "))}<br/>` +
          `الوحدات: ${arNum(p.unitsCount)} · مشغولة: ${arNum(p.occupied)} · شاغرة: ${arNum(p.vacant)}` +
          (p.sold > 0 ? ` · مباعة: ${arNum(p.sold)}` : "") +
          `<br/>` +
          // `rent` is the annual rent of the occupied units (what is due), not what was collected.
          `الإيجار السنوي للوحدات المشغولة: ${arNum(Math.round(p.rent))} ر.س</div>`,
      );
      if (p.id) {
        const id = p.id;
        markers.set(id, marker);
        marker.on("click", () => onSelectRef.current?.(id));
      }
      marker.addTo(map);
      group.addLayer(marker);
    }
    if (group.getLayers().length > 0) {
      boundsRef.current = group.getBounds().pad(0.3);
      map.fitBounds(boundsRef.current);
    }
    nearbyLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      boundsRef.current = null;
      nearbyLayerRef.current = null;
      markers.clear();
    };
  }, [properties]);

  // Selection: enlarge the chosen marker and fly to it; clearing it returns to the whole portfolio.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const [id, marker] of markersRef.current) {
      const on = id === selectedId;
      marker.setStyle({ weight: on ? 4 : 2, fillOpacity: on ? 0.95 : 0.75 });
      marker.setRadius(on ? SELECTED_RADIUS : RADIUS);
      if (on) marker.bringToFront();
    }
    const chosen = selectedId ? markersRef.current.get(selectedId) : undefined;
    if (chosen) map.flyTo(chosen.getLatLng(), Math.max(map.getZoom(), 15), { duration: 0.6 });
    else if (boundsRef.current) map.flyToBounds(boundsRef.current, { duration: 0.6 });
  }, [selectedId, properties]);

  useEffect(() => {
    const layer = nearbyLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    // Neutral glyph squares, not circles: shape tells a service from a property, and the glyph
    // (م مسجد · د مدرسة · س سوق) tells services apart without a second colour on the map.
    // Place names come from OSM (external) — escaped before Leaflet's innerHTML popup.
    for (const p of nearby) {
      L.marker([p.lat, p.lng], {
        icon: htmlIcon(L, serviceSquareHtml(p.kind)),
        title: p.name,
      })
        .bindPopup(`<div dir="rtl">${escapeHtml(p.name)}</div>`)
        .addTo(layer);
    }
  }, [nearby, properties]);

  return (
    <div
      ref={containerRef}
      dir="ltr"
      // isolate: Leaflet's panes use z-indexes up to 1000, which would otherwise paint over
      // sticky page chrome.
      className={cn(
        "isolate h-[520px] w-full overflow-hidden rounded-md border border-border bg-[#ECEAE6]",
        className,
      )}
    />
  );
}
