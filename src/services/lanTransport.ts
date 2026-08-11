import {
  BandEnergies,
  ConnectionState,
  DeterrentChannel,
  DeterrentNode,
  NodeConfig,
  PestClass,
  PestEvent,
} from '@/types';
import { Transport, TransportEvents } from './realtime';
import {
  baseUrl,
  ENDPOINTS,
  isWireEvent,
  isWireStatus,
  WireConfig,
  WireEvent,
  WireFrame,
  WireStatus,
  wsUrl,
} from './protocol';

/**
 * Real transport: talks directly to a PestGuard ESP32 node over the LAN.
 *
 * Two channels, deliberately:
 *   - a WebSocket for live push, so a detection reaches the phone in
 *     milliseconds rather than on a poll boundary, and
 *   - plain REST for everything that is a request/response — history backfill
 *     on connect, config writes, commands.
 *
 * If the WebSocket cannot be opened, or drops, the transport falls back to
 * polling REST and keeps working. A student's Wi-Fi will drop the socket
 * regularly, and an app that needs a manual reconnect after every hiccup is
 * useless in a field. Reconnection is automatic with backoff, and on every
 * successful reconnect the transport replays whatever the device buffered
 * while it was away — so no detections are lost to a dropout.
 */

const CONNECT_TIMEOUT_MS = 6000;
const POLL_INTERVAL_MS = 2000;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15000;

export interface LanTransportOptions {
  host: string;
  port?: number;
  /** Called whenever the device reports its identity, so the store can sync. */
  onStatus?: (status: WireStatus, node: DeterrentNode) => void;
}

export class LanTransport implements Transport {
  private handlers: TransportEvents | null = null;
  private socket: WebSocket | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private connected = false;
  private disposed = false;
  private attempts = 0;
  private pingId = 0;
  private pendingPings = new Map<number, number>();
  private latencyMs = 0;

  /** Highest device sequence id already delivered, for gap-free replay. */
  private lastSeq = 0;
  /**
   * Wall-clock anchor. The device may have no NTP, so it reports uptime and a
   * possibly-zero epoch. We record the phone's clock against the device's
   * uptime at connect and derive real timestamps from the delta — the phone
   * always knows what time it is, the ESP32 often does not.
   */
  private clockAnchor: { deviceUp: number; phoneMs: number } | null = null;

  private nodeId = '';

  constructor(private opts: LanTransportOptions) {}

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  connect(handlers: TransportEvents) {
    this.handlers = handlers;
    this.disposed = false;
    handlers.onState('connecting', 0);
    void this.bootstrap();
  }

  disconnect() {
    this.disposed = true;
    this.connected = false;
    this.teardownSocket();
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pollTimer = this.reconnectTimer = this.pingTimer = null;
    this.handlers?.onState('offline', 0);
  }

  isConnected() {
    return this.connected;
  }

  private get base() {
    return baseUrl(this.opts.host, this.opts.port);
  }

  /** Fetch with a hard timeout — a silent ESP32 must not hang the UI forever. */
  private async request(path: string, init?: RequestInit): Promise<Response> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), CONNECT_TIMEOUT_MS);
    try {
      return await fetch(`${this.base}${path}`, { ...init, signal: ctrl.signal });
    } finally {
      clearTimeout(t);
    }
  }

  /**
   * Establish state: read status, backfill the device's ring buffer, then open
   * the live socket. Ordering matters — backfilling before subscribing would
   * race and drop anything detected in between, so we record the sequence
   * number from the backfill and the socket only delivers past it.
   */
  private async bootstrap() {
    if (this.disposed) return;
    try {
      const status = await this.fetchStatus();
      this.nodeId = status.id;
      this.clockAnchor = { deviceUp: status.up, phoneMs: Date.now() };
      this.connected = true;
      this.attempts = 0;
      this.handlers?.onState('connected', this.latencyMs);
      this.opts.onStatus?.(status, statusToNode(status, this.clockAnchor));

      await this.backfill();
      this.openSocket();
      this.startPolling();
    } catch {
      this.connected = false;
      this.handlers?.onState('offline', 0);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.disposed || this.reconnectTimer) return;
    // Exponential backoff, capped. A node that is genuinely off should not be
    // hammered every second for the rest of the afternoon.
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** this.attempts);
    this.attempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.bootstrap();
    }, delay);
  }

  // -------------------------------------------------------------------------
  // REST
  // -------------------------------------------------------------------------

  async fetchStatus(): Promise<WireStatus> {
    const started = Date.now();
    const res = await this.request(ENDPOINTS.status);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const json: unknown = await res.json();
    this.latencyMs = Date.now() - started;
    if (!isWireStatus(json)) throw new Error('not a PestGuard device');
    return json;
  }

  /** Pull everything the device still holds that we have not seen. */
  private async backfill() {
    try {
      const res = await this.request(`${ENDPOINTS.events}?since=${this.lastSeq}&limit=200`);
      if (!res.ok) return;
      const json = (await res.json()) as { events?: unknown[] };
      for (const raw of json.events ?? []) {
        if (isWireEvent(raw)) this.deliver(raw);
      }
    } catch {
      // A failed backfill is not fatal — live events still flow, we simply
      // start the history from now.
    }
  }

  /**
   * REST polling. Always running, even with a healthy socket: it is how the
   * node's battery, RSSI and armed state stay fresh, and it silently covers
   * any event the socket missed because `since` guarantees no duplicates.
   */
  private startPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = setInterval(async () => {
      if (this.disposed) return;
      try {
        const status = await this.fetchStatus();
        if (!this.connected) {
          this.connected = true;
          this.attempts = 0;
        }
        this.handlers?.onState(
          this.socket?.readyState === 1 ? 'connected' : 'degraded',
          this.latencyMs,
        );
        if (this.clockAnchor) {
          this.opts.onStatus?.(status, statusToNode(status, this.clockAnchor));
        }
        if (this.socket?.readyState !== 1) await this.backfill();
      } catch {
        if (this.connected) {
          this.connected = false;
          this.handlers?.onState('offline', 0);
          this.scheduleReconnect();
        }
      }
    }, POLL_INTERVAL_MS);
  }

  // -------------------------------------------------------------------------
  // WebSocket
  // -------------------------------------------------------------------------

  private openSocket() {
    this.teardownSocket();
    try {
      const sock = new WebSocket(wsUrl(this.opts.host, this.opts.port));
      this.socket = sock;

      sock.onopen = () => {
        this.handlers?.onState('connected', this.latencyMs);
        // Round-trip ping gives a real latency figure rather than the HTTP
        // fetch time, which includes the device building its status JSON.
        this.pingTimer = setInterval(() => {
          if (sock.readyState !== 1) return;
          const id = ++this.pingId;
          this.pendingPings.set(id, Date.now());
          try {
            sock.send(JSON.stringify({ t: 'ping', id }));
          } catch {
            /* socket closing */
          }
        }, 10_000);
      };

      sock.onmessage = (msg) => {
        let frame: WireFrame;
        try {
          frame = JSON.parse(String(msg.data)) as WireFrame;
        } catch {
          return;
        }
        if (frame.t === 'event' && isWireEvent(frame.e)) {
          this.deliver(frame.e);
        } else if (frame.t === 'status' && isWireStatus(frame.s)) {
          if (!this.clockAnchor) {
            this.clockAnchor = { deviceUp: frame.s.up, phoneMs: Date.now() };
          }
          this.opts.onStatus?.(frame.s, statusToNode(frame.s, this.clockAnchor));
        } else if (frame.t === 'pong') {
          const sent = this.pendingPings.get(frame.id);
          if (sent) {
            this.latencyMs = Date.now() - sent;
            this.pendingPings.delete(frame.id);
            this.handlers?.onState('connected', this.latencyMs);
          }
        }
      };

      sock.onerror = () => {
        // Downgrade rather than disconnect — polling is still carrying data,
        // so the honest state is "degraded", not "offline".
        this.handlers?.onState(this.connected ? 'degraded' : 'offline', this.latencyMs);
      };

      sock.onclose = () => {
        if (this.pingTimer) clearInterval(this.pingTimer);
        this.pingTimer = null;
        if (this.disposed) return;
        this.handlers?.onState(this.connected ? 'degraded' : 'offline', this.latencyMs);
        // Retry the socket without tearing down polling.
        setTimeout(() => {
          if (!this.disposed && this.connected) this.openSocket();
        }, 3000);
      };
    } catch {
      // No WebSocket available at all — polling covers it.
      this.handlers?.onState('degraded', this.latencyMs);
    }
  }

  private teardownSocket() {
    if (!this.socket) return;
    const s = this.socket;
    this.socket = null;
    s.onopen = s.onmessage = s.onerror = s.onclose = null;
    try {
      s.close();
    } catch {
      /* already closed */
    }
  }

  // -------------------------------------------------------------------------
  // Delivery
  // -------------------------------------------------------------------------

  private deliver(wire: WireEvent) {
    // The device's sequence number is the deduplication key. Both the socket
    // and the poller can surface the same event; whichever arrives first wins
    // and the other is dropped.
    if (wire.id <= this.lastSeq) return;
    this.lastSeq = wire.id;
    this.handlers?.onEvent(wireToEvent(wire, this.nodeId, this.clockAnchor));
  }

  // -------------------------------------------------------------------------
  // Writes
  // -------------------------------------------------------------------------

  async publishConfig(_nodeId: string, config: unknown) {
    const body = JSON.stringify(toWireConfig(config as NodeConfig));
    const res = await this.request(ENDPOINTS.config, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (!res.ok) throw new Error(`config rejected: ${res.status}`);
  }

  async publishCommand(_nodeId: string, cmd: string) {
    const res = await this.request(ENDPOINTS.cmd, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmd }),
    });
    if (!res.ok) throw new Error(`command rejected: ${res.status}`);
  }
}

// ---------------------------------------------------------------------------
// Wire → app mapping
// ---------------------------------------------------------------------------

type ClockAnchor = { deviceUp: number; phoneMs: number } | null;

/**
 * Resolve a device timestamp to wall-clock.
 *
 * Prefer the device's own epoch when it has one. Otherwise reconstruct from
 * uptime against the anchor taken at connect. This is what keeps the history
 * chronologically sane on a node with no internet — without it every event
 * would land at 1970 and every chart would be empty.
 */
function resolveTs(wire: WireEvent, anchor: ClockAnchor): number {
  if (wire.ts > 1_600_000_000_000) return wire.ts;
  if (anchor) return anchor.phoneMs - (anchor.deviceUp - wire.up);
  return Date.now();
}

const CLASSES: PestClass[] = ['rodent', 'bird', 'insect', 'bat', 'unknown'];

function toPestClass(v: string): PestClass {
  return (CLASSES as string[]).includes(v) ? (v as PestClass) : 'unknown';
}

export function wireToEvent(
  wire: WireEvent,
  nodeId: string,
  anchor: ClockAnchor,
): PestEvent {
  const bands: BandEnergies = {
    b1: wire.b[0] ?? 0,
    b2: wire.b[1] ?? 0,
    b3: wire.b[2] ?? 0,
    b4: wire.b[3] ?? 0,
  };
  return {
    id: `${nodeId}-${wire.id}`,
    nodeId,
    type: wire.evt,
    ts: resolveTs(wire, anchor),
    rawClass: toPestClass(wire.cls),
    rawConfidence: wire.conf ?? 0,
    bands,
    dwellMs: wire.dwell ?? 0,
    batteryPct: wire.batt ?? 0,
    batteryVolts: wire.volts ?? 0,
    rssi: wire.rssi ?? -100,
    deterrentChannels: wire.ch as DeterrentChannel[] | undefined,
    deterrentDurationMs: wire.dur,
    note: wire.note,
  };
}

export function fromWireConfig(w: WireConfig): NodeConfig {
  return {
    sensitivity: w.sens,
    pattern: w.pattern,
    intensity: w.intensity,
    deterrentDurationSec: w.dur,
    cooldownSec: w.cooldown,
    channels: { ultrasonic: w.ultrasonic, strobe: w.strobe, buzzer: w.buzzer },
    quietHours: {
      enabled: w.quiet,
      startMin: w.quietStart,
      endMin: w.quietEnd,
      ultrasonicOnly: w.quietUltrasonic,
    },
    heartbeatSec: w.heartbeat,
    // Adaptive thresholding is an app-side suggestion; the device has no say.
    autoThreshold: true,
  };
}

export function toWireConfig(c: NodeConfig): WireConfig {
  return {
    sens: Math.round(c.sensitivity),
    pattern: c.pattern,
    intensity: Math.round(c.intensity),
    dur: Math.round(c.deterrentDurationSec),
    cooldown: Math.round(c.cooldownSec),
    ultrasonic: c.channels.ultrasonic,
    strobe: c.channels.strobe,
    buzzer: c.channels.buzzer,
    quiet: c.quietHours.enabled,
    quietStart: Math.round(c.quietHours.startMin),
    quietEnd: Math.round(c.quietHours.endMin),
    quietUltrasonic: c.quietHours.ultrasonicOnly,
    heartbeat: Math.round(c.heartbeatSec),
  };
}

/** Build the app's node record from a device status frame. */
export function statusToNode(s: WireStatus, anchor: ClockAnchor): DeterrentNode {
  const bootMs = anchor ? anchor.phoneMs - anchor.deviceUp : Date.now() - s.up;
  return {
    id: s.id,
    name: s.name || s.id,
    zone: s.zone || 'Unassigned',
    status: s.status,
    link: 'wifi',
    rssi: s.rssi,
    batteryPct: s.batt,
    batteryVolts: s.volts,
    batteryDaysRemaining: 0,
    solarAssisted: false,
    // A LAN node reports no GPS. Position is assigned by the user on the farm
    // map; until then it sits centre-field rather than at (0, 0) in the ocean.
    lat: 0,
    lon: 0,
    mapX: 0.5,
    mapY: 0.5,
    firmwareVersion: s.fw,
    gatewayFirmware: s.fw,
    uptimeSec: Math.round(s.up / 1000),
    lastSeen: Date.now(),
    lastDetection: null,
    queuedEvents: 0,
    config: fromWireConfig(s.config),
    installedAt: bootMs,
    hardware: {
      mcu: 'ESP32 (standalone)',
      gateway: `${s.ssid || 'Wi-Fi'} · ${s.ip}`,
      mic:
        s.sensor === 'envelope'
          ? `Sound sensor (envelope) → ADC1 @ ${(s.sampleRate / 1000).toFixed(1)} kHz`
          : `Analog mic → ADC1 @ ${(s.sampleRate / 1000).toFixed(0)} kHz`,
      cellCount: 1,
    },
  };
}

/**
 * One-shot probe used by the connection screen before anything is saved.
 * Returns the device's status or an explanation of what went wrong, phrased
 * for someone standing next to the board wondering why it will not appear.
 */
export async function probeDevice(
  host: string,
  port = 80,
): Promise<{ ok: true; status: WireStatus } | { ok: false; error: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CONNECT_TIMEOUT_MS);
  const started = Date.now();
  try {
    const res = await fetch(`${baseUrl(host, port)}${ENDPOINTS.status}`, {
      signal: ctrl.signal,
    });
    if (!res.ok) {
      return { ok: false, error: `The device answered with HTTP ${res.status}.` };
    }
    const json: unknown = await res.json();
    if (!isWireStatus(json)) {
      return {
        ok: false,
        error:
          'Something answered at that address, but it is not a PestGuard node. Check the IP printed on the ESP32 serial monitor.',
      };
    }
    return { ok: true, status: json };
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    const elapsed = Date.now() - started;

    /*
     * Distinguish "nothing there" from "there, but not listening".
     *
     * fetch collapses both into the same rejection, but the timing does not: a
     * host that is up and actively refuses the port fails almost immediately,
     * while an address with nothing at it hangs until the timeout. Getting this
     * right matters — telling someone to check their IP and their Wi-Fi when
     * both are already correct sends them hunting in the wrong place, and the
     * real cause is usually that the firmware simply is not running yet.
     */
    if (aborted) {
      return {
        ok: false,
        error:
          'No response within 6 seconds. Check the ESP32 is powered, its status LED is solid, and that this device is on the same Wi-Fi network.',
      };
    }
    if (elapsed < 2000) {
      return {
        ok: false,
        error:
          'That address is reachable, but nothing is listening on it. The board is on the network — it is almost certainly not running the PestGuard firmware yet. Flash firmware/pestguard_esp32 and watch the serial monitor for "Ready. Listening."',
      };
    }
    return {
      ok: false,
      error:
        'Could not reach that address. Confirm the IP from the ESP32 serial monitor and that both devices are on the same network.',
    };
  } finally {
    clearTimeout(timer);
  }
}
