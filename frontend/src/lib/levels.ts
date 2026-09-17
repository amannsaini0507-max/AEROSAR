import type { DisplayLevel, PriorityLevel } from '../types';

/**
 * One place for urgency → display mapping, so the map, alert feed, and priority
 * list always agree (master doc §14.4: CRITICAL red, HIGH orange, MEDIUM
 * yellow, LOW gray/blue).
 */
export const LEVEL_ORDER: Record<DisplayLevel, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 };

export const LEVEL_LABEL: Record<DisplayLevel, string> = {
  CRITICAL: 'Critical',
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
  INFO: 'Info'
};

/** CSS custom property for each level, defined in index.css. */
export const LEVEL_VAR: Record<DisplayLevel, string> = {
  CRITICAL: 'var(--prio-critical)',
  HIGH: 'var(--prio-high)',
  MEDIUM: 'var(--prio-medium)',
  LOW: 'var(--prio-low)',
  INFO: 'var(--prio-info)'
};

/** Hex versions for Leaflet markers (which are HTML strings, not React). */
export const LEVEL_HEX: Record<DisplayLevel | 'UNSCORED', string> = {
  CRITICAL: '#e5484d',
  HIGH: '#f07b1f',
  MEDIUM: '#e9b21a',
  LOW: '#7d8fb3',
  INFO: '#5b7fff',
  UNSCORED: '#aab2c2'
};

export function isPriorityLevel(v: unknown): v is PriorityLevel {
  return v === 'LOW' || v === 'MEDIUM' || v === 'HIGH' || v === 'CRITICAL';
}

/**
 * Alert.msg has no severity field, so severity is derived from alert_type.
 * Unknown types (e.g. a "MISSION_STARTED" someone adds later) show as INFO
 * rather than being dropped.
 */
export function alertLevel(alertType: string): DisplayLevel {
  switch (alertType) {
    case 'CRITICAL_PRIORITY':
      return 'CRITICAL';
    case 'SURVIVOR_DETECTED':
      return 'HIGH';
    case 'LINK_LOST':
    case 'GPS_LOST':
      return 'MEDIUM';
    default:
      return 'INFO';
  }
}

export const HAZARD_LABEL: Record<string, string> = {
  fire: 'Fire',
  smoke: 'Smoke',
  flood: 'Flood',
  debris: 'Debris',
  damaged_structure: 'Damaged structure',
  landslide: 'Landslide'
};

export const HAZARD_HEX: Record<string, string> = {
  fire: '#e5484d',
  smoke: '#8a8f98',
  flood: '#2f8fc4',
  debris: '#a0785a',
  damaged_structure: '#7a6fd0',
  landslide: '#b8860b'
};

export function hazardLabel(type: string): string {
  return HAZARD_LABEL[type] ?? type.replace(/_/g, ' ');
}
