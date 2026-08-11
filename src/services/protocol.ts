/**
 * PestGuard device protocol — the contract between the ESP32 firmware and this
 * app. Both sides implement exactly this; nothing else talks to the hardware.
 *
 * Transport is direct over the LAN:
 *   REST      http://<device>/api/...   status, history backfill, config, commands
 *   WebSocket ws://<device>/ws          live push of events and status
 *
 * The app prefers the WebSocket and falls back to REST polling if it cannot
 * open or loses it, so a device that only implements the REST half still works
 * — just with polling latency instead of instant push.
 *
 * Wire fields are abbreviated because they cross a constrained link and the
 * ESP32 builds them by hand without a JSON library. The mapping into the app's
 * own richer `PestEvent` happens in `lanTransport.ts` and nowhere else.
 */

export const PROTOCOL_VERSION = 1;
export const DEFAULT_PORT = 80;

// ---------------------------------------------------------------------------
// Device → app
// ---------------------------------------------------------------------------

/** One detection, deterrent firing, or heartbeat as the device reports it. */
export interface WireEvent {
  /** Monotonic sequence number from the device's ring buffer. */
  id: number;
  /**
   * Epoch milliseconds if the device got NTP, else 0. When 0 the app derives a
   * wall-clock time from `up` — an ESP32 with no internet has no real clock,
   * and inventing one on the device would produce timestamps that silently
   * disagree with the phone's.
   */
  ts: number;
  /** Milliseconds since device boot. Always present, always trustworthy. */
  up: number;
  evt: 'detect' | 'deter' | 'heartbeat' | 'online' | 'offline' | 'fault' | 'config_ack';
  /** Class asserted on-device by the Goertzel detector. */
  cls: 'rodent' | 'bird' | 'insect' | 'bat' | 'unknown';
  /** On-device confidence, 0..1. */
  conf: number;
  /** Four normalised band energies, in the firmware's band order. */
  b: [number, number, number, number];
  /** Milliseconds the signature stayed above threshold. */
  dwell: number;
  /** Battery percentage, 0..100. */
  batt: number;
  /** Battery volts at the divider. */
  volts: number;
  /** Wi-Fi RSSI in dBm. */
  rssi: number;
  /** Deterrent channels that actually fired. */
  ch?: ('ultrasonic' | 'strobe' | 'buzzer')[];
  /** Deterrent duration in milliseconds. */
  dur?: number;
  /** Free-text note, used for faults. */
  note?: string;
}

/** Device identity and live state, from `GET /api/status`. */
export interface WireStatus {
  proto: number;
  /** Stable device id, derived from the MAC. */
  id: string;
  name: string;
  zone: string;
  fw: string;
  /** Milliseconds since boot. */
  up: number;
  /** Device epoch ms, or 0 if it never reached an NTP server. */
  time: number;
  status: 'armed' | 'disarmed' | 'deterring' | 'fault';
  rssi: number;
  ssid: string;
  ip: string;
  batt: number;
  volts: number;
  /** Total events the device has produced since boot. */
  events: number;
  /** How many it still holds in its ring buffer. */
  buffered: number;
  /** Sample rate and band edges, so the app can label charts honestly. */
  sampleRate: number;
  bands: [number, number][];
  /**
   * What the four numbers in `WireEvent.b` actually are.
   *
   * 'waveform' — a real audio preamp, so they are Goertzel band energies and
   *   spectral species classification is meaningful.
   * 'envelope' — a sound-sensor module whose analog pin is a rectified
   *   amplitude envelope. There is no spectrum to measure, so they are
   *   loudness / attack / rhythm / sustain instead.
   *
   * The app reads this rather than assuming, so a chart never labels an axis
   * in kilohertz when the hardware never measured frequency.
   */
  sensor?: 'waveform' | 'envelope';
  /** Display names for the four features when `sensor` is 'envelope'. */
  featureLabels?: string[];
  config: WireConfig;
}

/** Frames pushed over the WebSocket. */
export type WireFrame =
  | { t: 'event'; e: WireEvent }
  | { t: 'status'; s: WireStatus }
  | { t: 'pong'; id: number }
  | { t: 'ack'; cmd: string; ok: boolean; msg?: string };

// ---------------------------------------------------------------------------
// App → device
// ---------------------------------------------------------------------------

/**
 * The subset of the app's `NodeConfig` the device actually acts on. Kept flat
 * and primitive so the firmware can parse it without a JSON library.
 */
export interface WireConfig {
  /** Detection threshold above the tracked noise floor, 0..100. */
  sens: number;
  pattern: 'sweep' | 'pulse' | 'burst' | 'random' | 'silent';
  /** Ultrasonic PWM duty, 0..100. */
  intensity: number;
  /** Deterrent burst length, seconds. */
  dur: number;
  /** Enforced silence after a burst, seconds. */
  cooldown: number;
  ultrasonic: boolean;
  strobe: boolean;
  buzzer: boolean;
  quiet: boolean;
  /** Quiet-hours window, minutes from midnight. */
  quietStart: number;
  quietEnd: number;
  /** Keep the ultrasonic channel alive during quiet hours. */
  quietUltrasonic: boolean;
  /** Heartbeat interval, seconds. */
  heartbeat: number;
}

export type WireCommand = 'arm' | 'disarm' | 'test-deterrent' | 'reboot' | 'identify';

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

export function baseUrl(host: string, port = DEFAULT_PORT): string {
  const h = host.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  return port === 80 ? `http://${h}` : `http://${h}:${port}`;
}

/**
 * The device serves REST on port 80 and the WebSocket on its own port 81.
 * They are separate servers in the firmware — arduinoWebSockets binds its own
 * listener rather than upgrading a connection on the HTTP server — so the port
 * is derived, not the same one.
 */
export const WS_PORT_OFFSET = 1;

export function wsUrl(host: string, port = DEFAULT_PORT): string {
  const h = host.trim().replace(/^wss?:\/\//, '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
  return `ws://${h}:${port + WS_PORT_OFFSET}/`;
}

export const ENDPOINTS = {
  status: '/api/status',
  events: '/api/events',
  config: '/api/config',
  cmd: '/api/cmd',
} as const;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Structural check on anything claiming to be a device status.
 *
 * This runs on every payload from the network. A device on a student's bench
 * gets reflashed, half-flashed, and pointed at the wrong IP; a malformed
 * response should surface as "that isn't a PestGuard device" rather than as
 * `undefined` propagating into a chart three screens later.
 */
export function isWireStatus(v: unknown): v is WireStatus {
  if (!v || typeof v !== 'object') return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s.id === 'string' &&
    typeof s.fw === 'string' &&
    typeof s.up === 'number' &&
    typeof s.status === 'string' &&
    typeof s.config === 'object' &&
    s.config !== null
  );
}

export function isWireEvent(v: unknown): v is WireEvent {
  if (!v || typeof v !== 'object') return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.id === 'number' &&
    typeof e.up === 'number' &&
    typeof e.evt === 'string' &&
    Array.isArray(e.b) &&
    (e.b as unknown[]).length === 4
  );
}
