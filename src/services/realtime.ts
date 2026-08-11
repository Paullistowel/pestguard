import { BandEnergies, ConnectionState, DeterrentNode, PestClass, PestEvent } from '@/types';
import { clamp, gaussian, seededRandom } from '@/utils/math';
import { PEST_PROFILES } from '@/data/pests';

/**
 * Realtime transport.
 *
 * In production this module wraps two things:
 *   1. an MQTT subscription to `pestguard/v1/<farm>/<node>/events` — the topic
 *      the ESP32 gateway publishes to (§6 step 2), and
 *   2. a Firestore/RTDB listener that delivers events already enriched by the
 *      classifier Cloud Function (§6 step 4).
 *
 * MQTT is used rather than plain HTTP for the reasons given in §6: lower
 * per-message battery cost on the gateway, and a retained last-will that lets
 * the app mark a node offline the moment its keepalive lapses, instead of
 * waiting for a missed heartbeat to time out.
 *
 * For development and for the demo build, `SimulatedTransport` below produces
 * the same event stream locally. The `Transport` interface is what the rest of
 * the app codes against, so switching to a real broker is a one-line change in
 * `createTransport()` — no screen or store touches MQTT directly.
 */

export interface TransportEvents {
  onEvent: (event: PestEvent) => void;
  onState: (state: ConnectionState, latencyMs: number) => void;
  onNodePatch: (nodeId: string, patch: Partial<DeterrentNode>) => void;
}

export interface Transport {
  connect(handlers: TransportEvents): void;
  disconnect(): void;
  /** Publish a retained config document to `.../<node>/config`. */
  publishConfig(nodeId: string, config: unknown): Promise<void>;
  /** Fire a one-off deterrent test — `.../<node>/cmd`, QoS 1. */
  publishCommand(nodeId: string, cmd: string, args?: unknown): Promise<void>;
  isConnected(): boolean;
}

// ---------------------------------------------------------------------------
// Simulated transport
// ---------------------------------------------------------------------------

const rng = seededRandom(9_43_2026);

function bandsFor(cls: PestClass): BandEnergies {
  const n = (mu: number, sd: number) => clamp(gaussian(rng, mu, sd), 0.02, 1);
  switch (cls) {
    case 'rodent':
      return { b1: n(0.55, 0.13), b2: n(0.62, 0.12), b3: n(0.3, 0.12), b4: n(0.81, 0.1) };
    case 'bird':
      return { b1: n(0.78, 0.11), b2: n(0.52, 0.13), b3: n(0.22, 0.1), b4: n(0.11, 0.07) };
    case 'insect':
      return { b1: n(0.35, 0.12), b2: n(0.7, 0.11), b3: n(0.76, 0.11), b4: n(0.2, 0.09) };
    case 'bat':
      return { b1: n(0.14, 0.08), b2: n(0.28, 0.11), b3: n(0.44, 0.13), b4: n(0.88, 0.08) };
    default:
      return { b1: n(0.4, 0.22), b2: n(0.4, 0.22), b3: n(0.4, 0.22), b4: n(0.4, 0.22) };
  }
}

export class SimulatedTransport implements Transport {
  private timer: ReturnType<typeof setInterval> | null = null;
  private stateTimer: ReturnType<typeof setInterval> | null = null;
  private handlers: TransportEvents | null = null;
  private connected = false;
  private seq = 0;

  constructor(private getNodes: () => DeterrentNode[]) {}

  connect(handlers: TransportEvents) {
    this.handlers = handlers;
    handlers.onState('connecting', 0);

    // Broker handshake, then subscribe.
    setTimeout(() => {
      this.connected = true;
      handlers.onState('connected', 90 + Math.round(rng() * 120));
    }, 900);

    // Live detections. ~1 every 12–20 s so the dashboard visibly moves during
    // a demo without becoming noise.
    this.timer = setInterval(() => {
      if (!this.connected) return;
      if (rng() > 0.55) return;
      const event = this.synthesise();
      if (event) handlers.onEvent(event);
    }, 6000);

    // Heartbeats + link quality drift.
    this.stateTimer = setInterval(() => {
      if (!this.connected) return;
      const nodes = this.getNodes().filter((n) => n.status !== 'offline');
      for (const node of nodes) {
        handlers.onNodePatch(node.id, {
          rssi: clamp(node.rssi + gaussian(rng, 0, 1.6), -105, -35),
          uptimeSec: node.uptimeSec + 15,
          lastSeen: Date.now(),
        });
      }
      handlers.onState('connected', 80 + Math.round(rng() * 160));
    }, 15_000);
  }

  private synthesise(): PestEvent | null {
    const candidates = this.getNodes().filter(
      (n) => n.status === 'armed' || n.status === 'deterring',
    );
    if (!candidates.length) return null;

    const node = candidates[Math.floor(rng() * candidates.length)];
    const hour = new Date().getHours();

    // Weight the class by which species is actually active at this hour.
    const classes: PestClass[] = ['rodent', 'bird', 'insect', 'bat', 'unknown'];
    const weights = classes.map((c) =>
      c === 'unknown' ? 0.5 : PEST_PROFILES[c].peakHours.includes(hour) ? 2.4 : 0.35,
    );
    const total = weights.reduce((a, b) => a + b, 0);
    let x = rng() * total;
    let cls: PestClass = 'unknown';
    for (let i = 0; i < classes.length; i++) {
      x -= weights[i];
      if (x <= 0) {
        cls = classes[i];
        break;
      }
    }

    const cfg = node.config;
    const conf = clamp(gaussian(rng, cls === 'unknown' ? 0.45 : 0.8, 0.1), 0.3, 0.99);
    const fires =
      cfg.pattern !== 'silent' && cls !== 'bat' && cls !== 'unknown' && conf > 0.55;
    const channels = fires
      ? (Object.keys(cfg.channels) as (keyof typeof cfg.channels)[]).filter(
          (ch) => cfg.channels[ch],
        )
      : [];

    return {
      id: `live-${Date.now().toString(36)}-${++this.seq}`,
      nodeId: node.id,
      type: channels.length ? 'deter' : 'detect',
      ts: Date.now(),
      rawClass: cls,
      rawConfidence: conf,
      bands: bandsFor(cls),
      dwellMs: Math.round(clamp(gaussian(rng, 1200, 550), 90, 6000)),
      batteryPct: node.batteryPct,
      batteryVolts: node.batteryVolts,
      rssi: node.rssi,
      deterrentChannels: channels.length ? channels : undefined,
      deterrentDurationMs: channels.length ? cfg.deterrentDurationSec * 1000 : undefined,
    };
  }

  disconnect() {
    this.connected = false;
    if (this.timer) clearInterval(this.timer);
    if (this.stateTimer) clearInterval(this.stateTimer);
    this.timer = null;
    this.stateTimer = null;
    this.handlers?.onState('offline', 0);
  }

  async publishConfig(nodeId: string, _config: unknown) {
    // Round-trip: app → cloud → ESP32 → Nano → config_ack (§6 step 5).
    await new Promise((r) => setTimeout(r, 700 + rng() * 900));
    if (!this.connected) throw new Error('offline');
    this.handlers?.onNodePatch(nodeId, { lastSeen: Date.now() });
  }

  async publishCommand(nodeId: string, cmd: string) {
    await new Promise((r) => setTimeout(r, 400 + rng() * 600));
    if (!this.connected) throw new Error('offline');
    if (cmd === 'test-deterrent') {
      this.handlers?.onNodePatch(nodeId, { status: 'deterring' });
      setTimeout(() => this.handlers?.onNodePatch(nodeId, { status: 'armed' }), 4000);
    }
  }

  isConnected() {
    return this.connected;
  }
}

/**
 * Swap this for `new MqttTransport(brokerUrl, credentials)` once the broker is
 * provisioned; nothing else in the app needs to change.
 */
export function createTransport(getNodes: () => DeterrentNode[]): Transport {
  return new SimulatedTransport(getNodes);
}

export const TOPIC_ROOT = 'pestguard/v1';

export function topicFor(nodeId: string, leaf: 'events' | 'config' | 'cmd' | 'status') {
  return `${TOPIC_ROOT}/farm-01/${nodeId}/${leaf}`;
}
