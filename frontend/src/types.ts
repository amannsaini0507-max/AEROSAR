/* ==========================================================================
   WebSocket contract types.

   The *Msg interfaces mirror the locked ROS 2 message definitions in the
   master document §7.1 (aerosar_msgs) field-for-field, in snake_case, so the
   backend bridge (Member 4) can forward them with no renaming. Anything that
   is NOT in §7.1 is marked "EXTENSION" and is optional — the dashboard still
   works if it never arrives. See WS_CONTRACT.md for the prose version.
   ========================================================================== */

/** builtin_interfaces/Time as JSON, an ISO-8601 string, or epoch seconds/ms. */
export type RosStamp = string | number | { sec: number; nanosec: number };

export type PriorityLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type HazardType = 'fire' | 'smoke' | 'flood' | 'debris' | 'damaged_structure' | 'landslide';
export type MissionStateName = 'IDLE' | 'SEARCHING' | 'RETURNING' | 'COMPLETE';
export type NavMode = 'GPS_NAV' | 'GPS_DENIED';

export const HAZARD_TYPES: HazardType[] = ['fire', 'smoke', 'flood', 'debris', 'damaged_structure', 'landslide'];

/** aerosar_msgs/Detection — `/perception/detection` (final, fused, geotagged). */
export interface DetectionMsg {
  id: string;
  detection_type: string; // "person" or a hazard class
  confidence: number;
  bbox_x?: number;
  bbox_y?: number;
  bbox_w?: number;
  bbox_h?: number;
  thermal_confirmed: boolean;
  latitude: number;
  longitude: number;
  altitude?: number;
  stamp: RosStamp;
}

/** aerosar_msgs/Hazard — `/perception/hazard`. */
export interface HazardMsg {
  id: string;
  hazard_type: HazardType | string;
  confidence: number;
  latitude: number;
  longitude: number;
  stamp: RosStamp;
}

/** aerosar_msgs/RiskScore — `/rescue/risk_score`. */
export interface RiskScoreMsg {
  detection_id: string;
  score: number;
  priority_level: PriorityLevel;
  reason: string;
}

/** `/rescue/priority` — ranked RiskScore list, highest priority first. */
export interface PriorityMsg {
  ranked: RiskScoreMsg[];
}

/** aerosar_msgs/Alert — `/alerts/emergency`. */
export interface AlertMsg {
  alert_id: string;
  /** §7.1: SURVIVOR_DETECTED | HAZARD_DETECTED | CRITICAL_PRIORITY | LINK_LOST | LINK_RESTORED.
   *  §10.4 also asks for GPS_LOST | GPS_RESTORED. Unknown values render as INFO. */
  alert_type: string;
  message: string;
  latitude?: number;
  longitude?: number;
  stamp: RosStamp;
}

/** aerosar_msgs/MissionStatus — `/mission/status` (~1 Hz). */
export interface MissionStatusMsg {
  mission_id: string;
  state: MissionStateName;
  battery_percent: number;
  coverage_percent: number;
  link_connected: boolean;
  stamp: RosStamp;
  /** EXTENSION (§10.4 / §14.2 "Mode"): needs team sign-off to add to MissionStatus.msg. */
  nav_mode?: NavMode;
}

/** EXTENSION: drone position for the map marker, relayed from `/gps/fix` (or SLAM pose). */
export interface DronePoseMsg {
  latitude: number;
  longitude: number;
  altitude?: number;
  heading_deg?: number;
  speed_mps?: number;
  gps_fix?: boolean;
  stamp: RosStamp;
}

/** EXTENSION (§13, §14.5): offline queue / sync engine state from the backend. */
export interface SyncStatusMsg {
  state: 'CONNECTED' | 'OFFLINE' | 'SYNCING';
  queued_events?: number;
  synced_events?: number;
}

/** EXTENSION (§12): safe route as ordered [lat, lng] waypoints. */
export interface RouteMsg {
  survivor_id?: string;
  points: [number, number][];
}

/** EXTENSION (§14.3): where to get the live feed (MJPEG / HTTP image URLs). */
export interface VideoStatusMsg {
  rgb_url?: string | null;
  thermal_url?: string | null;
}

/** EXTENSION (§14.3): a single JPEG frame pushed over the socket. */
export interface VideoFrameMsg {
  channel: 'rgb' | 'thermal';
  jpeg_base64: string;
}

export type ServerMessage =
  | { type: 'detection'; data: DetectionMsg }
  | { type: 'hazard'; data: HazardMsg }
  | { type: 'risk_score'; data: RiskScoreMsg }
  | { type: 'priority'; data: PriorityMsg }
  | { type: 'alert'; data: AlertMsg }
  | { type: 'mission_status'; data: MissionStatusMsg }
  | { type: 'drone_pose'; data: DronePoseMsg }
  | { type: 'sync_status'; data: SyncStatusMsg }
  | { type: 'route'; data: RouteMsg }
  | { type: 'video_status'; data: VideoStatusMsg }
  | { type: 'video_frame'; data: VideoFrameMsg }
  | { type: 'batch'; data: ServerMessage[] };

/* ---------- Normalised client-side model (camelCase, times in epoch ms) ---------- */

export type DisplayLevel = PriorityLevel | 'INFO';

export interface Survivor {
  id: string;
  confidence: number;
  thermalConfirmed: boolean;
  lat: number;
  lng: number;
  altitude?: number;
  /** When the drone detected it (drone clock) — used for ordering (§13.6). */
  time: number;
  /** When the dashboard received it. */
  receivedAt: number;
  /** Order in which survivors were first seen; gives stable "Survivor #n" labels. */
  seq: number;
}

export interface Hazard {
  id: string;
  hazardType: string;
  confidence: number;
  lat: number;
  lng: number;
  time: number;
  receivedAt: number;
}

export interface Risk {
  detectionId: string;
  score: number;
  level: PriorityLevel;
  reason: string;
}

export interface AlertItem {
  id: string;
  alertType: string;
  level: DisplayLevel;
  message: string;
  lat?: number;
  lng?: number;
  time: number;
  receivedAt: number;
}

export interface MissionStatus {
  missionId: string;
  state: MissionStateName;
  battery: number;
  coverage: number;
  linkConnected: boolean;
  navMode?: NavMode;
  time: number;
  receivedAt: number;
}

export interface DronePose {
  lat: number;
  lng: number;
  altitude?: number;
  heading?: number;
  speed?: number;
  gpsFix?: boolean;
  time: number;
}

export type SocketState = 'connecting' | 'open' | 'closed';
export type FeedSource = 'simulator' | 'websocket';

export interface VideoState {
  rgbUrl: string | null;
  thermalUrl: string | null;
  rgbFrame: string | null;
  thermalFrame: string | null;
}

export interface MissionModel {
  source: FeedSource;
  socket: SocketState;
  survivors: Record<string, Survivor>;
  hazards: Record<string, Hazard>;
  risks: Record<string, Risk>;
  /** Ranked survivor ids from the backend's priority message, if it sends one. */
  ranking: string[] | null;
  alerts: AlertItem[];
  mission: MissionStatus | null;
  missionStartedAt: number | null;
  pose: DronePose | null;
  track: [number, number][];
  sync: SyncStatusMsg | null;
  route: RouteMsg | null;
  video: VideoState;
  lastMessageAt: number | null;
  messageCounts: Record<string, number>;
  survivorSeq: number;
}
