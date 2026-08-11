/**
 * Domain model for the PestGuard Companion app.
 *
 * These types mirror the wire format described in the Project 43 Mobile & AI
 * Integration proposal (§6, Data Flow and Communication Protocol):
 *
 *   Nano  --UART JSON-->  ESP32  --MQTT-->  Cloud  --realtime-->  App
 *
 * The Nano emits a compact line such as:
 *   {"evt":"detect","class":"rodent","conf":0.87,"batt":78}
 * The gateway enriches it with node id, timestamp and RSSI before publishing.
 */

// ---------------------------------------------------------------------------
// Pests
// ---------------------------------------------------------------------------

export type PestClass =
  | 'rodent'
  | 'bird'
  | 'insect'
  | 'bat'
  | 'unknown';

export interface PestProfile {
  id: PestClass;
  label: string;
  latin: string;
  emoji: string;
  /** Dominant acoustic band the Goertzel detector locks onto, in Hz. */
  bandHz: [number, number];
  description: string;
  cropRisk: 'low' | 'moderate' | 'high' | 'severe';
  /** Deterrent programme the firmware selects for this class. */
  recommendedPattern: DeterrentPattern;
  /** Hours of day (0-23) this species is typically most active. */
  peakHours: number[];
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type EventType =
  | 'detect' // Goertzel band-energy match crossed threshold
  | 'deter' // ultrasonic / strobe / buzzer fired
  | 'heartbeat' // periodic battery + uptime report
  | 'config_ack' // node acknowledged a remote configuration push
  | 'online' // gateway (re)connected to the broker
  | 'offline' // MQTT last-will fired
  | 'fault'; // self-test failure reported by the node

export type DeterrentChannel = 'ultrasonic' | 'strobe' | 'buzzer';

/** Four band energies the Goertzel detector reports, normalised 0..1. */
export interface BandEnergies {
  b1: number; // 2–6 kHz   — rodent gnawing / low chatter
  b2: number; // 6–12 kHz  — rodent ultrasonic vocalisation fundamentals
  b3: number; // 12–20 kHz — insect stridulation harmonics
  b4: number; // 20–40 kHz — bat echolocation / rodent USV upper band
}

export interface PestEvent {
  id: string;
  nodeId: string;
  type: EventType;
  /** Epoch milliseconds, UTC. */
  ts: number;
  /** Class asserted on-node by the Goertzel detector. */
  rawClass: PestClass;
  /** Class after the cloud classifier refined it (§5.3). */
  aiClass?: PestClass;
  /** On-node confidence, 0..1. */
  rawConfidence: number;
  /** Cloud classifier confidence, 0..1. */
  aiConfidence?: number;
  /** Per-class probability vector produced by the cloud classifier. */
  aiProbabilities?: Record<PestClass, number>;
  bands: BandEnergies;
  /** Milliseconds the signature stayed above threshold. */
  dwellMs: number;
  batteryPct: number;
  batteryVolts: number;
  /** Gateway link RSSI in dBm (Wi-Fi) or CSQ-derived dBm (GSM). */
  rssi: number;
  deterrentChannels?: DeterrentChannel[];
  deterrentDurationMs?: number;
  /** Set once a human confirms or rejects the label — feeds retraining. */
  groundTruth?: PestClass | 'false_alarm';
  /** True while the event is queued on the gateway and not yet in the cloud. */
  pendingSync?: boolean;
  note?: string;
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

export type NodeStatus = 'armed' | 'disarmed' | 'deterring' | 'offline' | 'fault';
export type LinkType = 'wifi' | 'gsm' | 'ble';
export type DeterrentPattern = 'sweep' | 'pulse' | 'burst' | 'random' | 'silent';

export interface QuietHours {
  enabled: boolean;
  /** Minutes from midnight, local node time. */
  startMin: number;
  endMin: number;
  /** During quiet hours, suppress buzzer + strobe but keep ultrasonic. */
  ultrasonicOnly: boolean;
}

export interface NodeConfig {
  /** Goertzel magnitude threshold, 0..100. Higher = less sensitive. */
  sensitivity: number;
  pattern: DeterrentPattern;
  /** Ultrasonic PWM duty, 0..100 (D9). */
  intensity: number;
  /** Seconds the deterrent runs per trigger. */
  deterrentDurationSec: number;
  /** Seconds of enforced silence after a deterrent burst. */
  cooldownSec: number;
  channels: Record<DeterrentChannel, boolean>;
  quietHours: QuietHours;
  /** Seconds between heartbeat frames on the UART link. */
  heartbeatSec: number;
  /** Let the AI layer push adaptive threshold suggestions automatically. */
  autoThreshold: boolean;
}

export interface DeterrentNode {
  id: string;
  name: string;
  zone: string;
  status: NodeStatus;
  link: LinkType;
  rssi: number;
  batteryPct: number;
  batteryVolts: number;
  /** Estimated days until the pack hits the 3.2 V cutoff (regression, §5.3). */
  batteryDaysRemaining: number;
  solarAssisted: boolean;
  lat: number;
  lon: number;
  /** Normalised 0..1 position for the schematic field map. */
  mapX: number;
  mapY: number;
  firmwareVersion: string;
  gatewayFirmware: string;
  uptimeSec: number;
  lastSeen: number;
  lastDetection: number | null;
  /** Events buffered on the ESP32 awaiting a connection window. */
  queuedEvents: number;
  config: NodeConfig;
  installedAt: number;
  hardware: {
    mcu: string;
    gateway: string;
    mic: string;
    cellCount: number;
  };
}

// ---------------------------------------------------------------------------
// Alerts & notifications
// ---------------------------------------------------------------------------

export type AlertSeverity = 'info' | 'warning' | 'critical';
export type AlertKind =
  | 'detection'
  | 'predictive'
  | 'battery'
  | 'connectivity'
  | 'maintenance'
  | 'threshold';

export interface Alert {
  id: string;
  kind: AlertKind;
  severity: AlertSeverity;
  title: string;
  body: string;
  nodeId?: string;
  eventId?: string;
  ts: number;
  read: boolean;
  /** Populated for AI-generated alerts so the app can show its reasoning. */
  aiRationale?: string;
}

// ---------------------------------------------------------------------------
// Users & roles
// ---------------------------------------------------------------------------

export type UserRole = 'owner' | 'technician' | 'supervisor';

export interface Permissions {
  viewDashboard: boolean;
  armDisarm: boolean;
  editConfig: boolean;
  provisionNodes: boolean;
  manageUsers: boolean;
  exportData: boolean;
  labelEvents: boolean;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  farmId: string;
  avatarColor: string;
  lastActive: number;
}

// ---------------------------------------------------------------------------
// AI layer outputs
// ---------------------------------------------------------------------------

export interface Classification {
  label: PestClass;
  confidence: number;
  probabilities: Record<PestClass, number>;
  /** Which features moved the decision most — shown in the event detail page. */
  topFeatures: { name: string; contribution: number }[];
  modelVersion: string;
}

export interface AnomalyResult {
  nodeId: string;
  /** Observed detections in the trailing window. */
  observed: number;
  /** Seasonal-baseline expectation for the same window. */
  expected: number;
  /** Standardised residual — |z| >= 2 is flagged. */
  z: number;
  isAnomaly: boolean;
  direction: 'rising' | 'falling' | 'stable';
  /** 0..1 — used to rank Predictive Alerts. */
  severity: number;
  horizonDays: number;
  projected: number;
}

export interface BatteryForecast {
  nodeId: string;
  /** Volts per day, from least-squares fit over the heartbeat history. */
  slopeVoltsPerDay: number;
  interceptVolts: number;
  /** Coefficient of determination for the fit, 0..1. */
  r2: number;
  daysRemaining: number;
  depletionTs: number;
  confidence: 'low' | 'medium' | 'high';
  recommendation: string;
}

export interface ThresholdSuggestion {
  nodeId: string;
  current: number;
  suggested: number;
  falseAlarmRate: number;
  expectedFalseAlarmRate: number;
  rationale: string;
}

// ---------------------------------------------------------------------------
// Connectivity
// ---------------------------------------------------------------------------

export type ConnectionState = 'connecting' | 'connected' | 'degraded' | 'offline';

export interface GatewayLink {
  state: ConnectionState;
  /** Where the app is pointed: a device address on the LAN, or a broker URL. */
  broker: string;
  /**
   * How the app is actually reaching the hardware. 'HTTP' means direct REST
   * polling to the node; 'WS' means the live WebSocket is up as well.
   */
  protocol: 'HTTP' | 'WS' | 'MQTT' | 'HTTPS' | 'SMS';
  /** Round-trip latency of the last publish/ack, ms. */
  latencyMs: number;
  lastMessageTs: number;
  messagesIn: number;
  messagesOut: number;
  /** Events held in the app's local outbox while offline. */
  outbox: number;
}

export interface Farm {
  id: string;
  name: string;
  zones: string[];
  areaHectares: number;
  crop: string;
  timezone: string;
  centerLat: number;
  centerLon: number;
}
