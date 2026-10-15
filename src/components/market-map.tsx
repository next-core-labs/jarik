import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import { listingPrice, type Listing } from "@/lib/market";
import { ORIGIN_DOT_HTML, clusterHtml, pinPrice, pricePinHtml } from "@/lib/map-markers";
import { addBrandTiles, htmlIcon } from "@/lib/map-style";

export type MapBounds = { south: number; west: number; north: number; east: number };
type Located = Listing & { lat: number; lng: number };

/** Riyadh, for a market with no located offers yet. */
const DEFAULT_VIEW: [number, number] = [24.7136, 46.6753];
/** Below street level, pins that would overlap (closer than CELL px) merge into a counted circle;
 *  from this zoom on every offer gets its own price pin. */
const PINS_ONLY_ZOOM = 16;
const CELL = 64;

/**
 * The marketplace map: a price pin per located offer (ink = rent, framed = sale, red = hovered or
 * selected — the one red element), ink count circles where pins would overlap (or share one
 * spot), and the visitor's origin with the search radius. Loaded lazily, client-only (Leaflet touches `window`).
 *
 * `fitKey` refits the view when it changes (new origin/radius, first data); plain filter changes
 * keep the visitor's viewport.
 */
export default function MarketMap({
  listings,
  hotId,
  origin,
  radiusKm,
  fitKey,
  onHover,
  onSelect,
  onUserMove,
  onSpot,
  boundsRef,
}: {
  listings: Listing[];
  hotId: string | null;
  origin: { lat: number; lng: number } | null;
  radiusKm: number;
  fitKey: string;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
  /** The visitor dragged or zoomed the map themselves. */
  onUserMove: () => void;
  /** A cluster of offers at one exact spot was clicked — zooming can never separate them (the
   *  public coordinates are rounded to ~1 km), so the page lists them instead. */
  onSpot: (bounds: MapBounds) => void;
  /** Kept current with the visible area, for "search this area". */
  boundsRef: React.MutableRefObject<MapBounds | null>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const pinsRef = useRef<L.LayerGroup | null>(null);
  const originRef = useRef<L.LayerGroup | null>(null);
  const markersRef = useRef(new Map<string, { marker: L.Marker; listing: Located }>());
  const clustersRef = useRef<{ marker: L.Marker; ids: Set<string>; count: number }[]>([]);
  const hotRef = useRef<string | null>(hotId);
  // Callbacks read through refs so a new identity never rebuilds the map.
  const handlers = useRef({ onHover, onSelect, onUserMove, onSpot });
  handlers.current = { onHover, onSelect, onUserMove, onSpot };
  // True while the map moves on its own (fitting to results/radius), so that move is not mistaken
  // for the visitor's and doesn't offer "search this area".
  const autoMoveRef = useRef(false);

  const located = listings.filter((l): l is Located => l.lat != null && l.lng != null);
  const locatedRef = useRef(located);
  locatedRef.current = located;

  function pinIcon(l: Located, hot: boolean) {
    return htmlIcon(L, pricePinHtml(pinPrice(listingPrice(l)), l.purpose, hot));
  }

  function drawPins() {
    const map = mapRef.current;
    const layer = pinsRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    markersRef.current.clear();
    clustersRef.current = [];
    const zoom = map.getZoom();

    const addPin = (l: Located) => {
      const hot = l.id === hotRef.current;
      const marker = L.marker([l.lat, l.lng], {
        icon: pinIcon(l, hot),
        zIndexOffset: hot ? 1000 : 0,
        keyboard: true,
        title: String(listingPrice(l)),
      });
      marker.on("click", () => handlers.current.onSelect(l.id));
      marker.on("mouseover", () => handlers.current.onHover(l.id));
      marker.on("mouseout", () => handlers.current.onHover(null));
      marker.addTo(layer);
      markersRef.current.set(l.id, { marker, listing: l });
    };

    // Greedy distance clustering: each offer joins the first group whose seed is within `cell` px,
    // so two pins can never sit side by side across a grid edge. At street level only offers at the
    // very same spot still share a marker.
    const cell = zoom >= PINS_ONLY_ZOOM ? 1 : CELL;
    const groups: { x: number; y: number; items: Located[] }[] = [];
    for (const l of locatedRef.current) {
      const p = map.project([l.lat, l.lng], zoom);
      const near = groups.find((g) => Math.abs(g.x - p.x) < cell && Math.abs(g.y - p.y) < cell);
      if (near) near.items.push(l);
      else groups.push({ x: p.x, y: p.y, items: [l] });
    }
    for (const { items } of groups) {
      const [first] = items;
      if (!first) continue;
      if (items.length === 1) {
        addPin(first);
        continue;
      }
      const lat = items.reduce((a, l) => a + l.lat, 0) / items.length;
      const lng = items.reduce((a, l) => a + l.lng, 0) / items.length;
      const ids = new Set(items.map((l) => l.id));
      const oneSpot = items.every((l) => l.lat === first.lat && l.lng === first.lng);
      const marker = L.marker([lat, lng], {
        icon: htmlIcon(L, clusterHtml(items.length, ids.has(hotRef.current ?? ""))),
        keyboard: true,
        title: String(items.length),
      })
        .on("click", () => {
          if (oneSpot || zoom >= PINS_ONLY_ZOOM) {
            const d = 1e-6;
            handlers.current.onSpot({
              south: first.lat - d,
              north: first.lat + d,
              west: first.lng - d,
              east: first.lng + d,
            });
          } else {
            map.setView([lat, lng], Math.min(zoom + 2, PINS_ONLY_ZOOM));
          }
        })
        .addTo(layer);
      clustersRef.current.push({ marker, ids, count: items.length });
    }
  }

  // Build the map once.
  useEffect(() => {
    if (!containerRef.current) return;
    const map = L.map(containerRef.current, { zoomControl: false }).setView(DEFAULT_VIEW, 11);
    L.control.zoom({ position: "bottomleft" }).addTo(map);
    addBrandTiles(L, map);
    originRef.current = L.layerGroup().addTo(map);
    pinsRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    const markers = markersRef.current;

    const syncBounds = () => {
      const b = map.getBounds();
      boundsRef.current = {
        south: b.getSouth(),
        west: b.getWest(),
        north: b.getNorth(),
        east: b.getEast(),
      };
    };
    map.on("moveend", syncBounds);
    map.on("zoomend", drawPins);
    // Markers are rebuilt on zoom, so a pin hovered while zooming would never get its mouseout.
    map.on("zoomstart", () => handlers.current.onHover(null));
    map.on("movestart", () => {
      if (!autoMoveRef.current) handlers.current.onUserMove();
    });
    syncBounds();

    // The panel around the map changes size (bottom sheet, window resize) — keep tiles filling it.
    const resize = new ResizeObserver(() => map.invalidateSize());
    resize.observe(containerRef.current);
    return () => {
      resize.disconnect();
      map.remove();
      mapRef.current = null;
      pinsRef.current = null;
      originRef.current = null;
      markers.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Redraw pins when the result set changes.
  const pinsKey = located.map((l) => l.id).join(",");
  useEffect(() => {
    drawPins();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinsKey]);

  // Light up the hovered/selected pin without rebuilding the layer.
  useEffect(() => {
    const prev = hotRef.current;
    hotRef.current = hotId;
    for (const id of [prev, hotId]) {
      const entry = id ? markersRef.current.get(id) : undefined;
      if (!entry) continue;
      const hot = id === hotId;
      entry.marker.setIcon(pinIcon(entry.listing, hot));
      entry.marker.setZIndexOffset(hot ? 1000 : 0);
    }
    // An offer hidden inside a cluster lights the cluster instead.
    for (const c of clustersRef.current) {
      if ((prev && c.ids.has(prev)) || (hotId && c.ids.has(hotId))) {
        c.marker.setIcon(htmlIcon(L, clusterHtml(c.count, Boolean(hotId && c.ids.has(hotId)))));
      }
    }
  }, [hotId]);

  // Origin + radius circle, and the view fit.
  useEffect(() => {
    const map = mapRef.current;
    const layer = originRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    autoMoveRef.current = true;
    map.once("moveend", () => (autoMoveRef.current = false));
    // A fit to the view it already shows fires no moveend — release the flag anyway.
    const release = setTimeout(() => (autoMoveRef.current = false), 1200);
    if (origin) {
      L.marker([origin.lat, origin.lng], {
        interactive: false,
        icon: htmlIcon(L, ORIGIN_DOT_HTML),
      }).addTo(layer);
      if (radiusKm > 0) {
        const circle = L.circle([origin.lat, origin.lng], {
          radius: radiusKm * 1000,
          color: "#EC3013",
          weight: 2,
          fillColor: "#EC3013",
          fillOpacity: 0.05,
          interactive: false,
        }).addTo(layer);
        map.fitBounds(circle.getBounds(), { padding: [24, 24] });
      } else {
        map.setView([origin.lat, origin.lng], 12);
      }
      return () => clearTimeout(release);
    }
    const pts = locatedRef.current.map((l) => [l.lat, l.lng] as [number, number]);
    if (pts.length > 0) map.fitBounds(L.latLngBounds(pts).pad(0.15), { maxZoom: 15 });
    return () => clearTimeout(release);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  return <div ref={containerRef} dir="ltr" className="absolute inset-0 z-0 isolate bg-[#ECEAE6]" />;
}
