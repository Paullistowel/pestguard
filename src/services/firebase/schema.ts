/**
 * Firebase Realtime Database schema — PestGuard / Pest Deterrent System.
 *
 * These types were derived by reading the live database, not by design:
 *
 *   GET https://pest-deterrent-system-7-default-rtdb.firebaseio.com/pestDetector.json
 *   {"device1":{"alarm":false,"distance":74.16,"lastUpdate":0,
 *               "led1":false,"led2":false,"led3":false,
 *               "sound":0,"status":"idle","test":true}}
 *
 * Every field below exists on the device today. Nothing here is invented, and
 * the paths match what the ESP32 already reads and writes, so the sketch does
 * not need to change for the app to control it.
 *
 * ---------------------------------------------------------------------------
 * THE CONFIRMATION PROBLEM
 * ---------------------------------------------------------------------------
 * The current schema has one field per actuator — `led1` is both "what the app
 * asked for" and "what the hardware is doing". That makes genuine confirmation
 * impossible: when the app writes `led1: true` and reads `led1: true` back, it
 * is reading its own write echoed by Firebase, not a report from the ESP32.
 *
 * So the app treats a plain field as UNCONFIRMED and says so, rather than
 * claiming a success it cannot observe. If the sketch additionally mirrors what
 * it actually applied under `state/`, the app upgrades automatically to real
 * confirmation. `SUGGESTED_ESP32_ADDITIONS` at the bottom of this file is the
 * exact code for that, and it is additive — nothing existing breaks.
 */

export const DB_ROOT = 'pestDetector';
export const DEFAULT_DEVICE_ID = 'device1';

// ---------------------------------------------------------------------------
// Live schema
// ---------------------------------------------------------------------------

/** Actuators the app can command. All boolean, all already in the database. */
export const ACTUATOR_KEYS = ['alarm', 'led1', 'led2', 'led3'] as const;
export type ActuatorKey = (typeof ACTUATOR_KEYS)[number];

/** Sensors the ESP32 reports. */
export const SENSOR_KEYS = ['distance', 'sound'] as const;
export type SensorKey = (typeof SENSOR_KEYS)[number];

/** The device node exactly as it exists in the database today. */
export interface DeviceNode {
  /** Buzzer / alarm output. */
  alarm?: boolean;
  led1?: boolean;
  led2?: boolean;
  led3?: boolean;
  /** Ultrasonic rangefinder reading, centimetres. */
  distance?: number;
  /** Sound-sensor reading. Raw ADC or level depending on the sketch. */
  sound?: number;
  /** Free-text device state, e.g. "idle". */
  status?: string;
  /**
   * Heartbeat. Currently 0 in the live database, which means the sketch is not
   * writing it yet — so online/offline cannot be determined until it does.
   * See SUGGESTED_ESP32_ADDITIONS.
   */
  lastUpdate?: number;
  /** Present in the live data. Purpose unknown; surfaced read-only. */
  test?: boolean;

  // --- Optional, only present once the sketch is extended ------------------
  //
  // Everything below is absent from the live database today. The app writes
  // these and shows them, but flags each as "not yet read by the device" until
  // the field appears in the node — which only happens once the sketch reads
  // it back. That keeps a control that does nothing visibly distinct from one
  // that works.

  /** Actual applied state, written by the ESP32. Enables real confirmation. */
  state?: Partial<Record<ActuatorKey, boolean>>;
  /** 'auto' = ESP32 runs its own logic; 'manual' = app drives the outputs. */
  mode?: DeviceMode;
  /** Master enable. When false the ESP32 should suppress all deterrent output. */
  enabled?: boolean;
  /** Trigger distance in cm — closer than this counts as a detection. */
  distanceThreshold?: number;
  /** Trigger sound level — louder than this counts as a detection. */
  soundThreshold?: number;
}

export type DeviceMode = 'auto' | 'manual';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

export const paths = {
  device: (id: string) => `${DB_ROOT}/${id}`,
  field: (id: string, key: string) => `${DB_ROOT}/${id}/${key}`,
  state: (id: string) => `${DB_ROOT}/${id}/state`,
  stateField: (id: string, key: ActuatorKey) => `${DB_ROOT}/${id}/state/${key}`,
  mode: (id: string) => `${DB_ROOT}/${id}/mode`,
  enabled: (id: string) => `${DB_ROOT}/${id}/enabled`,
  distanceThreshold: (id: string) => `${DB_ROOT}/${id}/distanceThreshold`,
  soundThreshold: (id: string) => `${DB_ROOT}/${id}/soundThreshold`,
  lastUpdate: (id: string) => `${DB_ROOT}/${id}/lastUpdate`,
} as const;

// ---------------------------------------------------------------------------
// Presentation metadata
// ---------------------------------------------------------------------------

export interface ActuatorMeta {
  key: ActuatorKey;
  label: string;
  description: string;
  icon: string;
  /** Token name on the palette, resolved by the screen. */
  tone: 'danger' | 'warning' | 'info' | 'primary';
}

export const ACTUATORS: ActuatorMeta[] = [
  {
    key: 'alarm',
    label: 'Alarm / Buzzer',
    description: 'Audible deterrent. The loudest output and the one neighbours notice.',
    icon: 'volume-high',
    tone: 'danger',
  },
  // Keys stay led1/led2/led3 to match the database exactly. The labels follow
  // the green/yellow/red naming used in the project's own documentation.
  {
    key: 'led1',
    label: 'Green LED',
    description: 'Clear — nothing detected.',
    icon: 'ellipse',
    tone: 'primary',
  },
  {
    key: 'led2',
    label: 'Yellow LED',
    description: 'Caution — approaching the detection threshold.',
    icon: 'ellipse',
    tone: 'warning',
  },
  {
    key: 'led3',
    label: 'Red LED',
    description: 'Alert — a detection is active.',
    icon: 'ellipse',
    tone: 'danger',
  },
];

export interface SensorMeta {
  key: SensorKey;
  label: string;
  unit: string;
  icon: string;
  /** Value at or below which the reading counts as a detection. */
  detectBelow?: number;
  detectAbove?: number;
  /** Expected range, used to scale gauges. */
  range: [number, number];
}

export const SENSORS: SensorMeta[] = [
  {
    key: 'distance',
    label: 'Distance',
    unit: 'cm',
    icon: 'resize',
    // An ultrasonic rangefinder detects by proximity: closer means something
    // is there. The threshold is a display default, not a device setting —
    // the ESP32 owns the real trigger logic.
    detectBelow: 30,
    range: [0, 200],
  },
  {
    key: 'sound',
    label: 'Sound level',
    unit: '',
    icon: 'mic',
    detectAbove: 500,
    range: [0, 4095],
  },
];

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

/** A device is considered offline if its heartbeat is older than this. */
export const OFFLINE_AFTER_MS = 30_000;

export type DeviceHealth = 'online' | 'stale' | 'offline' | 'unknown';

/**
 * Decide whether the device is alive from its heartbeat.
 *
 * Returns 'unknown' rather than 'offline' when `lastUpdate` is missing or zero
 * — which is the case in the live database right now. Reporting "offline" when
 * the truth is "this device never reports a heartbeat" would be a guess
 * presented as a fact, and would have the user hunting a hardware fault that
 * does not exist.
 */
export function deviceHealth(lastUpdate: number | undefined, now = Date.now()): DeviceHealth {
  if (!lastUpdate) return 'unknown';
  // Tolerate both epoch-milliseconds and epoch-seconds; sketches write either.
  const ms = lastUpdate < 1e11 ? lastUpdate * 1000 : lastUpdate;
  const age = now - ms;
  if (age < 0) return 'online'; // clock skew on the device
  if (age <= OFFLINE_AFTER_MS) return 'online';
  if (age <= OFFLINE_AFTER_MS * 4) return 'stale';
  return 'offline';
}

/** True when the device mirrors applied state, so confirmation is possible. */
export function supportsConfirmation(node: DeviceNode | null): boolean {
  return !!node?.state && typeof node.state === 'object';
}

/**
 * Whether a field exists in the database at all.
 *
 * Note what this does NOT tell you: the app writes several of these fields
 * itself, so their presence proves only that *something* wrote them — not that
 * the ESP32 reads them. Do not use this to claim a setting is live.
 */
export function fieldExists(node: DeviceNode | null, key: keyof DeviceNode): boolean {
  return !!node && node[key] !== undefined && node[key] !== null;
}

/**
 * Whether the device demonstrably acts on what the app writes.
 *
 * The only positive evidence available is the `state/` mirror: a node the ESP32
 * writes to report what it actually applied. Presence of a command field is not
 * evidence, because the app created it. Getting this wrong would put a
 * reassuring "Live" badge next to a slider that changes nothing — precisely the
 * false confirmation the rest of this design exists to avoid.
 */
export function deviceHonoursSettings(node: DeviceNode | null): boolean {
  return supportsConfirmation(node);
}

/** Fallbacks used only for the slider position before the device reports one. */
export const THRESHOLD_DEFAULTS = {
  distance: 30,
  sound: 500,
} as const;

export const THRESHOLD_RANGES = {
  distance: { min: 2, max: 200, step: 1, unit: 'cm' },
  sound: { min: 0, max: 4095, step: 25, unit: '' },
} as const;

// ---------------------------------------------------------------------------
// ESP32 additions
// ---------------------------------------------------------------------------

/**
 * The exact sketch additions that unlock heartbeat, confirmation and modes.
 *
 * Shown verbatim inside the app (Settings → Device sync) so the code and the
 * instructions cannot drift apart. All three are additive — existing reads and
 * writes keep working untouched.
 */
export const SUGGESTED_ESP32_ADDITIONS = `// --- 1. Heartbeat: lets the app tell online from offline -------------------
// Call once per loop, throttled to ~5 s. Uses NTP time if you have it,
// otherwise millis() still works — the app accepts either.
unsigned long lastBeat = 0;
if (millis() - lastBeat > 5000) {
  lastBeat = millis();
  Firebase.setInt(fbdo, "/pestDetector/device1/lastUpdate", time(nullptr));
}

// --- 2. Confirmation: report what you ACTUALLY applied ---------------------
// Call right after you drive each pin. The app compares this against what it
// asked for, and only then shows the control as confirmed.
digitalWrite(LED1_PIN, led1Cmd);
Firebase.setBool(fbdo, "/pestDetector/device1/state/led1", led1Cmd);

digitalWrite(BUZZER_PIN, alarmCmd);
Firebase.setBool(fbdo, "/pestDetector/device1/state/alarm", alarmCmd);

// --- 3. Mode: who is in charge --------------------------------------------
// Read this each loop. In "auto" run your own detection logic; in "manual"
// apply the values the app wrote to led1/led2/led3/alarm.
if (Firebase.getString(fbdo, "/pestDetector/device1/mode")) {
  String mode = fbdo.stringData();
  if (mode == "manual") { /* apply app values */ }
  else                  { /* run automatic pest-deterrent logic */ }
}`;
