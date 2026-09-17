import { useEffect, useRef } from 'react';
import L from 'leaflet';
import type { MissionModel } from '../types';
import type { Theme } from '../hooks/useTheme';
import { HAZARD_HEX, LEVEL_HEX, LEVEL_LABEL, hazardLabel } from '../lib/levels';
import { arrivedLate, formatClock } from '../lib/time';
import { ORIGIN } from '../mock/scenario';

/** Hazard.msg has no footprint, so zones are drawn at a fixed indicative radius. */
const HAZARD_ZONE_RADIUS_M = 10;

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function survivorIcon(color: string, selected: boolean, label: string) {
  return L.divIcon({
    className: '',
    html: `<span class="map-survivor${selected ? ' is-selected' : ''}" style="--pin:${color}">${label}</span>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    popupAnchor: [0, -14]
  });
}

function hazardIcon(color: string) {
  return L.divIcon({
    className: '',
    html: `<span class="map-hazard" style="--pin:${color}"></span>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
    popupAnchor: [0, -10]
  });
}

function droneIcon(heading: number, gpsDenied: boolean) {
  return L.divIcon({
    className: '',
    html: `<span class="map-drone${gpsDenied ? ' is-denied' : ''}" style="transform:rotate(${heading}deg)"><svg viewBox="0 0 24 24" width="24" height="24"><path d="M12 2 L20 21 L12 16 L4 21 Z"/></svg></span>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12]
  });
}

function tileUrlFor(theme: Theme) {
  return theme === 'dark'
    ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
    : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
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
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const survivorMarkers = useRef<Map<string, L.Marker>>(new Map());
  const hazardMarkers = useRef<Map<string, { marker: L.Marker; zone: L.Circle }>>(new Map());
  const droneMarkerRef = useRef<L.Marker | null>(null);
  const trackRef = useRef<L.Polyline | null>(null);
  const routeRef = useRef<L.Polyline | null>(null);
  const followRef = useRef(true); // auto-fit until the operator pans/zooms by hand
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  // create map once
  useEffect(() => {
    if (!mapDivRef.current || mapRef.current) return;
    const map = L.map(mapDivRef.current, { zoomControl: true, center: [ORIGIN.lat + 0.0004, ORIGIN.lng + 0.0005], zoom: 18 });
    mapRef.current = map;
    trackRef.current = L.polyline([], { className: 'map-track', weight: 2, opacity: 0.7 }).addTo(map);
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
      followRef.current = true;
    };
  }, []);

  // base tiles follow the theme; if the venue has no internet the grid background still shows
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    tileLayerRef.current?.remove();
    tileLayerRef.current = L.tileLayer(tileUrlFor(theme), {
      attribution: '&copy; OpenStreetMap &copy; CARTO',
      subdomains: 'abcd',
      maxZoom: 21,
      maxNativeZoom: 20
    }).addTo(map);
    tileLayerRef.current.bringToBack();
  }, [theme]);

  // survivors: color = backend priority level
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
        const marker = L.marker([s.lat, s.lng], { icon, keyboard: true, title: `Survivor #${s.seq}`, zIndexOffset: 300 })
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

  // hazards: square markers + shaded indicative zone
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
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
          radius: HAZARD_ZONE_RADIUS_M,
          color,
          weight: 1,
          fillColor: color,
          fillOpacity: 0.18,
          interactive: false
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

  // drone + track
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    trackRef.current?.setLatLngs(model.track);
    if (!model.pose) {
      droneMarkerRef.current?.remove();
      droneMarkerRef.current = null;
      return;
    }
    const pos: [number, number] = [model.pose.lat, model.pose.lng];
    const icon = droneIcon(model.pose.heading ?? 0, model.mission?.navMode === 'GPS_DENIED');
    if (!droneMarkerRef.current) {
      droneMarkerRef.current = L.marker(pos, { icon, zIndexOffset: 1000, interactive: false }).addTo(map);
    } else {
      droneMarkerRef.current.setLatLng(pos).setIcon(icon);
    }
  }, [model.pose, model.track, model.mission?.navMode]);

  // keep everything in view while following
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !followRef.current) return;
    const points: [number, number][] = [
      ...Object.values(model.survivors).map((s) => [s.lat, s.lng] as [number, number]),
      ...Object.values(model.hazards).map((h) => [h.lat, h.lng] as [number, number]),
      ...(model.pose ? [[model.pose.lat, model.pose.lng] as [number, number]] : []),
      ...model.track.filter((_, i) => i % 10 === 0)
    ];
    if (points.length === 0) return;
    const bounds = L.latLngBounds(points).pad(0.15);
    const targetZoom = Math.min(19, map.getBoundsZoom(bounds));
    if (!map.getBounds().contains(bounds) || map.getZoom() < targetZoom - 0.5) {
      map.fitBounds(bounds, { maxZoom: 19, animate: true });
    }
  }, [model.survivors, model.hazards, model.pose, model.track]);

  // safe route (optional — §12.5 says the map must work without it)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    routeRef.current?.remove();
    routeRef.current = model.route?.points?.length
      ? L.polyline(model.route.points, { className: 'map-route', weight: 4, dashArray: '8 7' }).addTo(map)
      : null;
  }, [model.route]);

  // fly to a survivor picked from the priority list
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedId) return;
    const s = model.survivors[selectedId];
    if (!s) return;
    followRef.current = false;
    map.flyTo([s.lat, s.lng], Math.max(map.getZoom(), 19), { duration: 0.6 });
    survivorMarkers.current.get(selectedId)?.openPopup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  function fitAll() {
    const map = mapRef.current;
    if (!map) return;
    const pts: [number, number][] = [
      ...Object.values(model.survivors).map((s) => [s.lat, s.lng] as [number, number]),
      ...Object.values(model.hazards).map((h) => [h.lat, h.lng] as [number, number]),
      ...model.track
    ];
    if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.15), { maxZoom: 19 });
  }

  return (
    <section className="panel dashboard__map" aria-label="Disaster map">
      <div className="panel__head">
        <span className="panel__title">Disaster map</span>
        <span className="panel__head-right">
          <span className="panel__count">
            {Object.keys(model.survivors).length} survivors, {Object.keys(model.hazards).length} hazards
          </span>
          <button type="button" className="link-btn" onClick={() => { followRef.current = true; onSelectRef.current(null); fitAll(); }}>
            Fit all
          </button>
        </span>
      </div>
      <div className="panel__body">
        <div ref={mapDivRef} className="map-canvas" />
        <div className="map-legend">
          <div className="map-legend__item"><span className="legend-survivor" /> Survivor (color = priority)</div>
          <div className="map-legend__item"><span className="legend-hazard" /> Hazard + zone</div>
          <div className="map-legend__item"><span className="legend-drone">▲</span> Drone + track</div>
          {model.route && <div className="map-legend__item"><span className="legend-route" /> Safe route</div>}
        </div>
      </div>
    </section>
  );
}
