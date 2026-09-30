/**
 * Geodetic and Local ENU Coordinate Transformations (JS Twin of aerosar_core/geo.py).
 * Single origin of truth for client-side simulator and tactical map.
 */

export const BASE_LAT = 26.9124;
export const BASE_LON = 75.7873;
export const BASE_ALT = 1.5;

export const LAT_SCALE = 111320.0;

export function lonScaleAt(lat: number): number {
  return LAT_SCALE * Math.cos((lat * Math.PI) / 180.0);
}

export function geodeticToEnu(
  lat: number,
  lon: number,
  alt = BASE_ALT,
  refLat = BASE_LAT,
  refLon = BASE_LON,
  refAlt = BASE_ALT
): [number, number, number] {
  const scaleLon = lonScaleAt(refLat);
  const x = (lon - refLon) * scaleLon;
  const y = (lat - refLat) * LAT_SCALE;
  const z = alt - refAlt;
  return [x, y, z];
}

export function enuToGeodetic(
  x: number,
  y: number,
  z = 0.0,
  refLat = BASE_LAT,
  refLon = BASE_LON,
  refAlt = BASE_ALT
): [number, number, number] {
  const scaleLon = lonScaleAt(refLat);
  const lat = refLat + y / LAT_SCALE;
  const lon = refLon + x / scaleLon;
  const alt = refAlt + z;
  return [lat, lon, alt];
}

export function geoDistanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const avgLat = (lat1 + lat2) / 2.0;
  const scaleLon = lonScaleAt(avgLat);
  const dy = (lat2 - lat1) * LAT_SCALE;
  const dx = (lon2 - lon1) * scaleLon;
  return Math.hypot(dx, dy);
}
