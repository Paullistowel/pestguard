import {
  Alert,
  BandEnergies,
  DeterrentChannel,
  DeterrentNode,
  Farm,
  NodeConfig,
  PestClass,
  PestEvent,
  User,
} from '@/types';
import { clamp, gaussian, seededRandom } from '@/utils/math';
import { PEST_PROFILES } from './pests';

/**
 * Deterministic fixture generator.
 *
 * In production these records arrive from Firestore via the realtime listener
 * (§6 step 4). Here they are synthesised from a fixed seed so that charts,
 * anomaly scores and battery forecasts are reproducible between reloads and
 * between team members' devices — which matters when the same screenshots go
 * into the field-test report.
 */

const rng = seededRandom(43_2026);

export const FARM: Farm = {
  id: 'farm-01',
  name: 'Adaklu Ridge Farm',
  zones: ['North Field', 'East Orchard', 'Grain Store', 'South Paddock', 'Irrigation Line'],
  areaHectares: 42,
  crop: 'Maize & sorghum',
  timezone: 'Africa/Accra',
  centerLat: 6.4231,
  centerLon: 0.4712,
};

const defaultConfig = (over: Partial<NodeConfig> = {}): NodeConfig => ({
  sensitivity: 62,
  pattern: 'sweep',
  intensity: 78,
  deterrentDurationSec: 12,
  cooldownSec: 45,
  channels: { ultrasonic: true, strobe: true, buzzer: true },
  quietHours: { enabled: false, startMin: 22 * 60, endMin: 6 * 60, ultrasonicOnly: true },
  heartbeatSec: 300,
  autoThreshold: true,
  ...over,
});

const NOW = Date.now();
const DAY = 86_400_000;

interface NodeSpec {
  id: string;
  name: string;
  zone: string;
  link: DeterrentNode['link'];
  status: DeterrentNode['status'];
  battery: number;
  solar: boolean;
  mapX: number;
  mapY: number;
  /** Relative pest pressure — drives how many events this node generates. */
  pressure: number;
  bias: PestClass;
  config?: Partial<NodeConfig>;
}

const NODE_SPECS: NodeSpec[] = [
  {
    id: 'PG-N01',
    name: 'North Gate',
    zone: 'North Field',
    link: 'wifi',
    status: 'armed',
    battery: 82,
    solar: false,
    mapX: 0.22,
    mapY: 0.18,
    pressure: 1.0,
    bias: 'bird',
  },
  {
    id: 'PG-N02',
    name: 'Orchard Row 4',
    zone: 'East Orchard',
    link: 'wifi',
    status: 'armed',
    battery: 64,
    solar: true,
    mapX: 0.74,
    mapY: 0.3,
    pressure: 1.0,
    bias: 'bird',
    config: { pattern: 'burst', sensitivity: 58 },
  },
  {
    id: 'PG-N03',
    name: 'Grain Store Door',
    zone: 'Grain Store',
    link: 'wifi',
    status: 'deterring',
    battery: 91,
    solar: false,
    mapX: 0.48,
    mapY: 0.56,
    // Highest pressure — this node drives the predictive-alert demo.
    pressure: 1.5,
    bias: 'rodent',
    config: { sensitivity: 70, intensity: 92, cooldownSec: 30 },
  },
  {
    id: 'PG-N04',
    name: 'South Paddock',
    zone: 'South Paddock',
    link: 'gsm',
    status: 'armed',
    battery: 23,
    solar: false,
    mapX: 0.31,
    mapY: 0.82,
    pressure: 0.9,
    bias: 'insect',
    config: { pattern: 'pulse', heartbeatSec: 900 },
  },
  {
    id: 'PG-N05',
    name: 'Pump House',
    zone: 'Irrigation Line',
    link: 'wifi',
    status: 'offline',
    battery: 11,
    solar: false,
    mapX: 0.86,
    mapY: 0.71,
    pressure: 0.35,
    bias: 'rodent',
  },
  {
    id: 'PG-N06',
    name: 'West Hedgerow',
    zone: 'North Field',
    link: 'wifi',
    status: 'disarmed',
    battery: 77,
    solar: true,
    mapX: 0.11,
    mapY: 0.48,
    pressure: 0.9,
    bias: 'bat',
    config: { pattern: 'silent', quietHours: { enabled: true, startMin: 1200, endMin: 360, ultrasonicOnly: true } },
  },
];

function batteryVoltsFromPct(pct: number): number {
  // 18650 discharge curve, 4.15 V full -> 3.20 V protection cutoff, with 0%
  // sitting exactly at the cutoff. The near-linear exponent matters: a curve
  // that flattens hard at the top makes a linear extrapolation to the cutoff
  // meaningless, which is how you end up telling a farmer a 91% pack has a
  // year left.
  const t = clamp(pct / 100, 0, 1);
  return 3.2 + 0.95 * t ** 0.92;
}

/**
 * Percentage points lost per day. A continuously-listening Nano plus an ESP32
 * would flatten a single cell in days; these nodes duty-cycle the MCU and mic
 * between listening windows, which is what buys the ~6-week pack life the
 * figures below assume.
 */
const DRAIN_PCT_PER_DAY = { mains: 2.2, solar: 0.5 } as const;

/**
 * Battery level for a node `dayBack` days ago.
 *
 * Derived from when its pack was last swapped rather than by extrapolating
 * today's reading backwards and clamping at 100%. Clamping produced a series
 * that sat pinned at full for most of the window, which flattened the
 * regression and made the forecast meaningless. Running the cycle properly
 * yields the sawtooth a real deployment has — packs run down and get replaced —
 * and exercises the forecaster's swap detection.
 */
function batteryPctAt(spec: NodeSpec, dayBack: number, jitter = 0): number {
  const rate = spec.solar ? DRAIN_PCT_PER_DAY.solar : DRAIN_PCT_PER_DAY.mains;
  const packLifeDays = 100 / rate;
  const ageToday = (100 - spec.battery) / rate;
  const ageThen = (((ageToday - dayBack) % packLifeDays) + packLifeDays) % packLifeDays;
  return clamp(100 - ageThen * rate + jitter, 2, 100);
}

export const NODES: DeterrentNode[] = NODE_SPECS.map((s, i) => {
  const lastSeen = s.status === 'offline' ? NOW - 3.4 * 3600_000 : NOW - Math.floor(rng() * 180_000);
  return {
    id: s.id,
    name: s.name,
    zone: s.zone,
    status: s.status,
    link: s.link,
    rssi: s.status === 'offline' ? -110 : s.link === 'gsm' ? -89 - rng() * 8 : -48 - rng() * 32,
    batteryPct: s.battery,
    batteryVolts: batteryVoltsFromPct(s.battery),
    batteryDaysRemaining: 0, // filled by the forecast service at runtime
    solarAssisted: s.solar,
    lat: FARM.centerLat + (s.mapY - 0.5) * -0.018,
    lon: FARM.centerLon + (s.mapX - 0.5) * 0.024,
    mapX: s.mapX,
    mapY: s.mapY,
    firmwareVersion: '2.4.1',
    gatewayFirmware: s.link === 'gsm' ? 'pg-gw 1.3.0-gsm' : 'pg-gw 1.3.0',
    uptimeSec: Math.floor(180_000 + rng() * 1_400_000),
    lastSeen,
    lastDetection: null, // filled below once events exist
    queuedEvents: s.status === 'offline' ? 47 : 0,
    config: defaultConfig(s.config),
    installedAt: NOW - (60 + i * 6) * DAY,
    hardware: {
      mcu: 'ATmega328P @ 16 MHz (Arduino Nano)',
      gateway: s.link === 'gsm' ? 'ESP32-WROOM-32 + SIM800L' : 'ESP32-WROOM-32',
      mic: 'Electret + MAX9814 AGC → A0',
      cellCount: s.solar ? 2 : 1,
    },
  };
});

/**
 * Band energies consistent with a given class, so the on-device classifier in
 * `services/ai/classifier.ts` has genuinely separable features to work on.
 */
function bandsFor(cls: PestClass, r: () => number): BandEnergies {
  const n = (mu: number, sd: number) => clamp(gaussian(r, mu, sd), 0.02, 1);
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

/** Diurnal weighting: how likely `cls` is to fire at hour `h`. */
function hourWeight(cls: PestClass, h: number): number {
  const peaks = PEST_PROFILES[cls].peakHours;
  if (!peaks.length) return 0.4;
  // Off-peak is suppressed but not silenced — species genuinely do turn up
  // outside their usual window, and a distribution that never does makes the
  // hour-of-day charts look synthetic.
  return peaks.includes(h) ? 1 : 0.3;
}

function pickClass(bias: PestClass, r: () => number, hour: number): PestClass {
  const candidates: PestClass[] = ['rodent', 'bird', 'insect', 'bat', 'unknown'];
  const weights = candidates.map((c) => {
    // A node's dominant species leads without swamping the mix — otherwise
    // every chart in the app renders as one colour and the multi-species
    // analytics have nothing to show.
    const base = c === bias ? 2.0 : c === 'unknown' ? 0.3 : 1.15;
    return base * hourWeight(c, hour);
  });
  const total = weights.reduce((a, b) => a + b, 0);
  let x = r() * total;
  for (let i = 0; i < candidates.length; i++) {
    x -= weights[i];
    if (x <= 0) return candidates[i];
  }
  return 'unknown';
}

const HISTORY_DAYS = 30;

function buildEvents(): PestEvent[] {
  const out: PestEvent[] = [];
  let seq = 0;

  for (const spec of NODE_SPECS) {
    const node = NODES.find((n) => n.id === spec.id)!;

    for (let dayBack = HISTORY_DAYS - 1; dayBack >= 0; dayBack--) {
      // Grain Store ramps sharply over the final week — this is the rising
      // trend the anomaly detector is meant to surface as a Predictive Alert.
      const ramp =
        spec.id === 'PG-N03' && dayBack < 8 ? 1 + (8 - dayBack) * 0.3 : 1;
      // The Pump House went dark 3.4 h ago; nothing after that point.
      if (spec.id === 'PG-N05' && dayBack === 0) continue;

      const expected = spec.pressure * ramp * 5.5;
      const count = Math.max(0, Math.round(gaussian(rng, expected, expected * 0.35)));

      for (let k = 0; k < count; k++) {
        const hour = Math.floor(rng() * 24);
        const cls = pickClass(spec.bias, rng, hour);
        // Weight the hour draw toward the class's active window.
        const activeHours = PEST_PROFILES[cls].peakHours;
        const h = activeHours.length && rng() < 0.72
          ? activeHours[Math.floor(rng() * activeHours.length)]
          : hour;

        const ts =
          NOW - dayBack * DAY - (23 - h) * 3600_000 - Math.floor(rng() * 3600_000);
        if (ts > NOW) continue;

        const bands = bandsFor(cls, rng);
        const conf = clamp(gaussian(rng, cls === 'unknown' ? 0.44 : 0.79, 0.11), 0.3, 0.99);
        const batteryPct = batteryPctAt(spec, dayBack, gaussian(rng, 0, 0.35));

        // A silent-pattern node logs but never fires; quiet hours suppress the
        // audible channels — both mirror the firmware's own decision table.
        const cfg = node.config;
        const inQuiet =
          cfg.quietHours.enabled &&
          isWithinQuiet(h * 60, cfg.quietHours.startMin, cfg.quietHours.endMin);
        const fires =
          cfg.pattern !== 'silent' && cls !== 'bat' && cls !== 'unknown' && conf > 0.55;

        const channels: DeterrentChannel[] = fires
          ? (Object.keys(cfg.channels) as DeterrentChannel[]).filter(
              (ch) =>
                cfg.channels[ch] &&
                !(inQuiet && cfg.quietHours.ultrasonicOnly && ch !== 'ultrasonic'),
            )
          : [];

        out.push({
          id: `evt-${String(++seq).padStart(5, '0')}`,
          nodeId: spec.id,
          type: fires && channels.length ? 'deter' : 'detect',
          ts,
          rawClass: cls,
          rawConfidence: conf,
          bands,
          dwellMs: Math.round(clamp(gaussian(rng, cls === 'bat' ? 320 : 1400, 600), 90, 6000)),
          batteryPct: Math.round(batteryPct),
          batteryVolts: batteryVoltsFromPct(batteryPct),
          rssi: node.rssi + gaussian(rng, 0, 4),
          deterrentChannels: channels.length ? channels : undefined,
          deterrentDurationMs: channels.length ? cfg.deterrentDurationSec * 1000 : undefined,
          // ~1 in 9 events has been reviewed by a technician in the field.
          groundTruth:
            rng() < 0.11
              ? rng() < 0.24
                ? 'false_alarm'
                : cls
              : undefined,
        });
      }

      // One heartbeat per day per node keeps the battery regression honest
      // without flooding the history list.
      const hbTs = NOW - dayBack * DAY;
      if (hbTs <= NOW && !(spec.id === 'PG-N05' && dayBack === 0)) {
        const batteryPct = batteryPctAt(spec, dayBack, gaussian(rng, 0, 0.25));
        out.push({
          id: `evt-${String(++seq).padStart(5, '0')}`,
          nodeId: spec.id,
          type: 'heartbeat',
          ts: hbTs,
          rawClass: 'unknown',
          rawConfidence: 0,
          bands: { b1: 0, b2: 0, b3: 0, b4: 0 },
          dwellMs: 0,
          batteryPct: Math.round(batteryPct),
          batteryVolts: batteryVoltsFromPct(batteryPct),
          rssi: node.rssi + gaussian(rng, 0, 3),
        });
      }
    }
  }

  // The Pump House dropping off the broker — MQTT last-will (§6).
  out.push({
    id: 'evt-offline-05',
    nodeId: 'PG-N05',
    type: 'offline',
    ts: NOW - 3.4 * 3600_000,
    rawClass: 'unknown',
    rawConfidence: 0,
    bands: { b1: 0, b2: 0, b3: 0, b4: 0 },
    dwellMs: 0,
    batteryPct: 11,
    batteryVolts: batteryVoltsFromPct(11),
    rssi: -110,
    note: 'MQTT last-will received — broker lost the gateway keepalive.',
  });

  return out.sort((a, b) => b.ts - a.ts);
}

export const EVENTS: PestEvent[] = buildEvents();

function isWithinQuiet(minuteOfDay: number, start: number, end: number): boolean {
  return start <= end
    ? minuteOfDay >= start && minuteOfDay < end
    : minuteOfDay >= start || minuteOfDay < end;
}

// Backfill each node's last detection from the generated history.
for (const node of NODES) {
  const last = EVENTS.find(
    (e) => e.nodeId === node.id && (e.type === 'detect' || e.type === 'deter'),
  );
  node.lastDetection = last?.ts ?? null;
}

export const USERS: User[] = [
  {
    id: 'u-1',
    name: 'Sylvester Mensah',
    email: 'sylvester@viewengine.ai',
    role: 'owner',
    farmId: FARM.id,
    avatarColor: '#35C77E',
    lastActive: NOW - 60_000,
  },
  {
    id: 'u-2',
    name: 'Akosua Danso',
    email: 'akosua.danso@example.com',
    role: 'technician',
    farmId: FARM.id,
    avatarColor: '#4EA8FF',
    lastActive: NOW - 5 * 3600_000,
  },
  {
    id: 'u-3',
    name: 'Dr. K. Owusu',
    email: 'k.owusu@example.edu',
    role: 'supervisor',
    farmId: FARM.id,
    avatarColor: '#A66BFF',
    lastActive: NOW - 2 * DAY,
  },
  {
    id: 'u-4',
    name: 'Yaw Boateng',
    email: 'yaw.boateng@example.com',
    role: 'technician',
    farmId: FARM.id,
    avatarColor: '#FFB020',
    lastActive: NOW - 26 * 3600_000,
  },
];

export const SEED_ALERTS: Alert[] = [
  {
    id: 'al-1',
    kind: 'connectivity',
    severity: 'critical',
    title: 'Pump House is offline',
    body: 'PG-N05 stopped reporting 3h ago. Its last-will message fired on the broker. 47 events are queued on the gateway and will replay on reconnect.',
    nodeId: 'PG-N05',
    ts: NOW - 3.4 * 3600_000,
    read: false,
  },
  {
    id: 'al-2',
    kind: 'battery',
    severity: 'critical',
    title: 'Pump House battery critical — 11%',
    body: 'The pack is close to the 3.20 V protection cutoff. Swap it on the next field walk — below the cutoff the node stops deterring entirely.',
    nodeId: 'PG-N05',
    ts: NOW - 9 * 3600_000,
    read: false,
    aiRationale:
      'Least-squares fit over 30 heartbeat readings: −0.021 V/day, r² = 0.94. Projection crosses cutoff on the stated date.',
  },
  {
    id: 'al-3',
    kind: 'battery',
    severity: 'warning',
    title: 'South Paddock battery low — 23%',
    body: 'Limited headroom left. This node is on GSM, which draws hardest during TX bursts.',
    nodeId: 'PG-N04',
    ts: NOW - 20 * 3600_000,
    read: true,
  },
  {
    id: 'al-4',
    kind: 'maintenance',
    severity: 'info',
    title: 'Gateway firmware 1.3.1 available',
    body: 'Fixes a UART framing edge case at 38400 baud when the Nano prints a heartbeat mid-detection. Rollout is staged per node.',
    ts: NOW - 2 * DAY,
    read: true,
  },
];
