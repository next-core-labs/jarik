import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import { HOME_ARCH_PIN_HTML } from "@/lib/map-markers";
import { addBrandTiles, htmlIcon } from "@/lib/map-style";
import type { LatLng } from "@/lib/location-input";

/** Riyadh, for a property with no location yet. */
const DEFAULT_CENTER: LatLng = { lat: 24.7136, lng: 46.6753 };

/**
 * «حدّد الموقع على الخريطة»: tap the map to drop the pin, drag it to adjust. `flyTo` moves the view
 * (search result, «موقعي الحالي») without the map re-mounting. Loaded with React.lazy: Leaflet needs
 * the browser.
 */
export default function LocationPickerMap({
  value,
  onChange,
  flyTo,
}: {
  value: LatLng | null;
  onChange: (point: LatLng) => void;
  flyTo: { point: LatLng; zoom: number; key: number } | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Places (or moves) the pin; dragging it reports the new point.
  const placeMarker = (map: L.Map, point: LatLng) => {
    if (markerRef.current) {
      markerRef.current.setLatLng([point.lat, point.lng]);
      return;
    }
    const marker = L.marker([point.lat, point.lng], {
      icon: htmlIcon(L, HOME_ARCH_PIN_HTML),
      draggable: true,
      title: "موقع العقار — اسحبه للتعديل",
    }).addTo(map);
    marker.on("dragend", () => {
      const p = marker.getLatLng();
      onChangeRef.current({ lat: round(p.lat), lng: round(p.lng) });
    });
    markerRef.current = marker;
  };

  useEffect(() => {
    if (!containerRef.current) return;
    const start = value ?? DEFAULT_CENTER;
    const map = L.map(containerRef.current, { zoomControl: false }).setView(
      [start.lat, start.lng],
      value ? 16 : 11,
    );
    L.control.zoom({ position: "bottomleft" }).addTo(map);
    addBrandTiles(L, map);
    if (value) placeMarker(map, value);
    map.on("click", (e: L.LeafletMouseEvent) => {
      const point = { lat: round(e.latlng.lat), lng: round(e.latlng.lng) };
      placeMarker(map, point);
      onChangeRef.current(point);
    });
    mapRef.current = map;
    // A dialog animates in: measure again once it has its final size.
    const t = setTimeout(() => map.invalidateSize(), 250);
    return () => {
      clearTimeout(t);
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // Mounted once per dialog opening; later changes come through the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The field was typed or pasted: follow it.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // Field cleared, invalid or outside Saudi Arabia: no pin (an old one would look like a choice).
    if (!value) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }
    const current = markerRef.current?.getLatLng();
    if (current && round(current.lat) === value.lat && round(current.lng) === value.lng) return;
    placeMarker(map, value);
    map.setView([value.lat, value.lng], Math.max(map.getZoom(), 16));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value?.lat, value?.lng]);

  useEffect(() => {
    if (flyTo && mapRef.current)
      mapRef.current.flyTo([flyTo.point.lat, flyTo.point.lng], flyTo.zoom);
  }, [flyTo]);

  return (
    <div
      ref={containerRef}
      dir="ltr"
      className="isolate h-64 w-full cursor-crosshair overflow-hidden rounded-md border border-border bg-[#ECEAE6]"
      role="application"
      aria-label="خريطة لتحديد موقع العقار — اضغط لوضع الدبوس"
    />
  );
}

/** Six decimals ≈ 10 cm — plenty, and what the field shows. */
function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
