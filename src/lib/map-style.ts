import type * as Leaflet from "leaflet";

/**
 * Jark map style on standard OpenStreetMap tiles: the tile pane is desaturated and warmed toward
 * the design system's map keys (land #ECEAE6, roads white/#DEDAD4, labels #6E6A66), so pins and the
 * one red element carry the colour. Map containers set `bg-[#ECEAE6]` so unloaded tiles read as land.
 */
export const MAP_LAND = "#ECEAE6";
const TILE_FILTER = "grayscale(1) sepia(.12) brightness(1.04) contrast(.92)";

export function addBrandTiles(L: typeof Leaflet, map: Leaflet.Map): Leaflet.TileLayer {
  const layer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap",
    maxZoom: 19,
  }).addTo(map);
  const pane = map.getPane("tilePane");
  if (pane) pane.style.filter = TILE_FILTER;
  return layer;
}

/** A divIcon whose HTML positions itself (pins translate to their own anchor). */
export function htmlIcon(L: typeof Leaflet, html: string): Leaflet.DivIcon {
  return L.divIcon({ className: "", iconSize: [0, 0], html });
}
