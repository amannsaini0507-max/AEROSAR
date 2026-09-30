import { useEffect, useRef } from 'react';
import L from 'leaflet';
import type { MissionModel } from '../types';
import type { Theme } from '../hooks/useTheme';
import { HAZARD_HEX, LEVEL_HEX, LEVEL_LABEL, hazardLabel } from '../lib/levels';
import { arrivedLate, formatClock } from '../lib/time';
import { BASE_LAT, BASE_LON } from '../lib/geo';

const HAZARD_ZONE_RADIUS_M = 8;

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Creates a 24x24 canvas raster data URL for the drone heading arrow (Zero SVG). */
function createDroneCanvasDataUrl(heading: number, gpsDenied: boolean): string {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  ctx.save();
  ctx.translate(16, 16);
  ctx.rotate((heading * Math.PI) / 180.0);

  // Outer glow / circle
  ctx.fillStyle = gpsDenied ? '#ff3b30' : '#00e5ff';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;

  // Drone chevron arrow
  ctx.beginPath();
  ctx.moveTo(0, -12);
  ctx.lineTo(9, 10);
  ctx.lineTo(0, 5);
  ctx.lineTo(-9, 10);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.restore();
  return canvas.toDataURL();
}

function droneCanvasIcon(heading: number, gpsDenied: boolean) {
  return L.icon({
    iconUrl: createDroneCanvasDataUrl(heading, gpsDenied),
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
}

function survivorIcon(color: string, selected: boolean, label: string) {
  return L.divIcon({
    className: '',
    html: `<span class="map-survivor${selected ? ' is-selected' : ''}" style="--pin:${color}">${label}</span>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    popupAnchor: [0, -14],
  });
}

function hazardIcon(color: string) {
  return L.divIcon({
    className: '',
    html: `<span class="map-hazard" style="--pin:${color}"></span>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
    popupAnchor: [0, -10],
  });
}

/** Local procedural canvas tile layer: 100% offline, zero network dependence. */
class LocalGridTileLayer extends L.GridLayer {
  theme: Theme = 'dark';

  setTheme(theme: Theme) {
    this.theme = theme;
    this.redraw();
  }

  createTile(coords: L.Coords): HTMLElement {
    const tile = document.createElement('canvas');
    tile.width = 256;
    tile.height = 256;
    const ctx = tile.getContext('2d');
    if (!ctx) return tile;

    const isDark = this.theme === 'dark';
    ctx.fillStyle = isDark ? '#0d1117' : '#f0f3f6';
    ctx.fillRect(0, 0, 256, 256);

    // Fine grid
    ctx.strokeStyle = isDark ? '#1b222c' : '#e1e5eb';
    ctx.lineWidth = 1;
    for (let x = 0; x <= 256; x += 32) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 256);
      ctx.stroke();
    }
    for (let y = 0; y <= 256; y += 32) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(256, y);
      ctx.stroke();
    }

    // Outer boundary
    ctx.strokeStyle = isDark ? '#263140' : '#ccd2da';
    ctx.strokeRect(0, 0, 256, 256);

    return tile;
  }
}

interface Props {
  model: MissionModel;
  theme: Theme;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

export default function MapPanel({ model, theme, selectedId, onSelect }: Props) {
  const mapDivRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const canvasRendererRef = useRef<L.Canvas | null>(null);
  const gridLayerRef = useRef<LocalGridTileLayer | null>(null);
  const survivorMarkers = useRef<Map<string, L.Marker>>(new Map());
  const hazardMarkers = useRef<Map<string, { marker: L.Marker; zone: L.Circle }>>(new Map());
  const droneMarkerRef = useRef<L.Marker | null>(null);
  const trackRef = useRef<L.Polyline | null>(null);
  const routeRef = useRef<L.Polyline | null>(null);
  const followRef = useRef(true);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  // Rate-limiting ref: update Leaflet at most 5 Hz (200 ms interval)
  const lastUpdateRef = useRef<number>(0);

  // Initialize Map with preferCanvas: true
  useEffect(() => {
    if (!mapDivRef.current || mapRef.current) return;

    // Strict Canvas Renderer to guarantee ZERO SVG vectors
    const canvasRenderer = L.canvas({ padding: 0.5 });
    canvasRendererRef.current = canvasRenderer;

    const map = L.map(mapDivRef.current, {
      preferCanvas: true,
      renderer: canvasRenderer,
      zoomControl: true,
      center: [BASE_LAT, BASE_LON],
      zoom: 19,
      maxZoom: 22,
      minZoom: 16,
    });
    mapRef.current = map;

    // Local procedural grid basemap (Zero network tiles)
    const gridLayer = new LocalGridTileLayer();
    gridLayer.addTo(map);
    gridLayerRef.current = gridLayer;

    trackRef.current = L.polyline([], {
      renderer: canvasRenderer,
      className: 'map-track',
      weight: 2,
      color: '#00e5ff',
      opacity: 0.75,
    }).addTo(map);

    const stopFollowing = () => {
      followRef.current = false;
    };
    map.on('dragstart', stopFollowing);
    map.getContainer().addEventListener('wheel', stopFollowing, { passive: true });

    return () => {
      map.remove();
      mapRef.current = null;
      survivorMarkers.current.clear();
      hazardMarkers.current.clear();
      droneMarkerRef.current = null;
      routeRef.current = null;
    };
  }, []);

  // Update theme on local grid basemap
  useEffect(() => {
    if (gridLayerRef.current) {
      gridLayerRef.current.setTheme(theme);
    }
  }, [theme]);

  // Survivors layer
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const seen = new Set<string>();

    Object.values(model.survivors).forEach((s) => {
      seen.add(s.id);
      const risk = model.risks[s.id];
      const color = risk ? LEVEL_HEX[risk.level] : LEVEL_HEX.UNSCORED;
      const icon = survivorIcon(color, s.id === selectedId, String(s.seq));
      const popup = `
        <div class="popup-title">Survivor #${s.seq} · ${risk ? LEVEL_LABEL[risk.level] : 'Unscored'}${risk ? ` ${risk.score.toFixed(2)}` : ''}</div>
        ${risk ? `<div class="popup-reason">${escapeHtml(risk.reason)}</div>` : ''}
        <div class="popup-meta">Confidence ${s.confidence.toFixed(2)}${s.thermalConfirmed ? ' · thermal-confirmed' : ''}</div>
        <div class="popup-meta">Detected ${formatClock(s.time)}${arrivedLate(s) ? ' · synced after reconnect' : ''}</div>
        <div class="popup-meta">${s.lat.toFixed(6)}, ${s.lng.toFixed(6)}</div>`;
      const existing = survivorMarkers.current.get(s.id);
      if (existing) {
        existing.setLatLng([s.lat, s.lng]).setIcon(icon).setPopupContent(popup);
        existing.setZIndexOffset(s.id === selectedId ? 900 : risk?.level === 'CRITICAL' ? 600 : 300);
      } else {
        const marker = L.marker([s.lat, s.lng], { icon, title: `Survivor #${s.seq}`, zIndexOffset: 300 })
          .bindPopup(popup)
          .on('click', () => onSelectRef.current(s.id))
          .addTo(map);
        survivorMarkers.current.set(s.id, marker);
      }
    });

    survivorMarkers.current.forEach((m, id) => {
      if (!seen.has(id)) {
        m.remove();
        survivorMarkers.current.delete(id);
      }
    });
  }, [model.survivors, model.risks, selectedId]);

  // Hazards layer
  useEffect(() => {
    const map = mapRef.current;
    const renderer = canvasRendererRef.current;
    if (!map || !renderer) return;
    const seen = new Set<string>();

    Object.values(model.hazards).forEach((h) => {
      seen.add(h.id);
      const color = HAZARD_HEX[h.hazardType] ?? '#8a8f98';
      const popup = `
        <div class="popup-title">Hazard · ${escapeHtml(hazardLabel(h.hazardType))}</div>
        <div class="popup-meta">Confidence ${h.confidence.toFixed(2)} · detected ${formatClock(h.time)}</div>`;
      const existing = hazardMarkers.current.get(h.id);
      if (existing) {
        existing.marker.setLatLng([h.lat, h.lng]).setPopupContent(popup);
        existing.zone.setLatLng([h.lat, h.lng]);
      } else {
        const zone = L.circle([h.lat, h.lng], {
          renderer,
          radius: HAZARD_ZONE_RADIUS_M,
          color,
          weight: 1,
          fillColor: color,
          fillOpacity: 0.18,
          interactive: false,
        }).addTo(map);
        const marker = L.marker([h.lat, h.lng], { icon: hazardIcon(color), title: hazardLabel(h.hazardType), zIndexOffset: -200 })
          .bindPopup(popup)
          .addTo(map);
        hazardMarkers.current.set(h.id, { marker, zone });
      }
    });

    hazardMarkers.current.forEach((entry, id) => {
      if (!seen.has(id)) {
        entry.marker.remove();
        entry.zone.remove();
        hazardMarkers.current.delete(id);
      }
    });
  }, [model.hazards]);

  // Drone pose & track rate-limited to <= 5 Hz
  useEffect(() => {
    const now = Date.now();
    if (now - lastUpdateRef.current < 190) return; // 5 Hz budget check
    lastUpdateRef.current = now;

    const map = mapRef.current;
    if (!map) return;

    trackRef.current?.setLatLngs(model.track);
    if (!model.pose) {
      droneMarkerRef.current?.remove();
      droneMarkerRef.current = null;
      return;
    }

    const pos: [number, number] = [model.pose.lat, model.pose.lng];
    const icon = droneCanvasIcon(model.pose.heading ?? 0, model.mission?.navMode === 'GPS_DENIED');
    if (!droneMarkerRef.current) {
      droneMarkerRef.current = L.marker(pos, { icon, zIndexOffset: 1000, interactive: false }).addTo(map);
    } else {
      droneMarkerRef.current.setLatLng(pos).setIcon(icon);
    }
  }, [model.pose, model.track, model.mission?.navMode]);

  // Safe Route layer
  useEffect(() => {
    const map = mapRef.current;
    const renderer = canvasRendererRef.current;
    if (!map || !renderer) return;

    routeRef.current?.remove();
    routeRef.current = model.route?.points?.length
      ? L.polyline(model.route.points, {
          renderer,
          className: 'map-route',
          weight: 4,
          color: '#00e676',
          dashArray: '8 7',
        }).addTo(map)
      : null;
  }, [model.route]);

  function fitAll() {
    const map = mapRef.current;
    if (!map) return;
    const pts: [number, number][] = [
      ...Object.values(model.survivors).map((s) => [s.lat, s.lng] as [number, number]),
      ...Object.values(model.hazards).map((h) => [h.lat, h.lng] as [number, number]),
      ...(model.pose ? [[model.pose.lat, model.pose.lng] as [number, number]] : []),
      ...model.track,
    ];
    if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.15), { maxZoom: 20 });
  }

  return (
    <section className="panel dashboard__map" aria-label="Tactical Disaster Map">
      <div className="panel__head">
        <span className="panel__title">Disaster Tactical Map</span>
        <span className="panel__head-right">
          <span className="panel__count">
            {Object.keys(model.survivors).length} survivors, {Object.keys(model.hazards).length} hazards
          </span>
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              followRef.current = true;
              onSelectRef.current(null);
              fitAll();
            }}
          >
            Fit all
          </button>
        </span>
      </div>
      <div className="panel__body">
        <div ref={mapDivRef} className="map-canvas" />
        <div className="map-legend">
          <div className="map-legend__item">
            <span className="legend-survivor" /> Survivor (color = priority)
          </div>
          <div className="map-legend__item">
            <span className="legend-hazard" /> Hazard + zone
          </div>
          <div className="map-legend__item">
            <span className="legend-drone">▲</span> Drone + track
          </div>
          {model.route && (
            <div className="map-legend__item">
              <span className="legend-route" /> Safe route
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
