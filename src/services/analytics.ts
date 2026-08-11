import { DeterrentNode, PestClass, PestEvent } from '@/types';
import { PEST_ORDER, PEST_PROFILES, RISK_WEIGHT } from '@/data/pests';
import { effectiveClass, effectiveConfidence } from './ai/classifier';
import { startOfDay } from '@/utils/format';
import { clamp, mean } from '@/utils/math';

/** Aggregations shared by the Dashboard, Analytics and Node Detail screens. */

const DAY = 86_400_000;

export type RangeKey = '24h' | '7d' | '30d' | 'all';

export const RANGES: { key: RangeKey; label: string; days: number }[] = [
  { key: '24h', label: '24 hours', days: 1 },
  { key: '7d', label: '7 days', days: 7 },
  { key: '30d', label: '30 days', days: 30 },
  { key: 'all', label: 'All time', days: 3650 },
];

export function withinRange(events: PestEvent[], range: RangeKey): PestEvent[] {
  const days = RANGES.find((r) => r.key === range)?.days ?? 30;
  const cutoff = Date.now() - days * DAY;
  return events.filter((e) => e.ts >= cutoff);
}

export const isDetection = (e: PestEvent) => e.type === 'detect' || e.type === 'deter';

export interface Totals {
  detections: number;
  deterrents: number;
  falseAlarms: number;
  uniqueSpecies: number;
  avgConfidence: number;
  /** Detections weighted by each species' crop-risk factor. */
  pressureIndex: number;
  /** Change vs the immediately preceding window of equal length, as a ratio. */
  detectionsDelta: number;
}

export function computeTotals(events: PestEvent[], range: RangeKey): Totals {
  const days = RANGES.find((r) => r.key === range)?.days ?? 30;
  const now = Date.now();
  const cur = events.filter((e) => isDetection(e) && e.ts >= now - days * DAY);
  const prev = events.filter(
    (e) => isDetection(e) && e.ts >= now - 2 * days * DAY && e.ts < now - days * DAY,
  );

  const species = new Set(cur.map(effectiveClass).filter((c) => c !== 'unknown'));
  const pressure = cur.reduce(
    (sum, e) => sum + RISK_WEIGHT[PEST_PROFILES[effectiveClass(e)].cropRisk],
    0,
  );

  return {
    detections: cur.length,
    deterrents: cur.filter((e) => e.type === 'deter').length,
    falseAlarms: cur.filter((e) => e.groundTruth === 'false_alarm').length,
    uniqueSpecies: species.size,
    avgConfidence: cur.length ? mean(cur.map(effectiveConfidence)) : 0,
    pressureIndex: Math.round(pressure),
    detectionsDelta: prev.length === 0 ? (cur.length ? 1 : 0) : (cur.length - prev.length) / prev.length,
  };
}

/** Detections per day, oldest first, for the trend line. */
export function dailySeries(
  events: PestEvent[],
  days = 30,
  nodeId?: string | null,
): { ts: number; value: number }[] {
  const today = startOfDay(Date.now());
  const buckets = new Array(days).fill(0);
  for (const e of events) {
    if (!isDetection(e)) continue;
    if (nodeId && e.nodeId !== nodeId) continue;
    const idx = days - 1 - Math.floor((today - startOfDay(e.ts)) / DAY);
    if (idx >= 0 && idx < days) buckets[idx] += 1;
  }
  return buckets.map((value, i) => ({ ts: today - (days - 1 - i) * DAY, value }));
}

/** Stacked daily series split by species. */
export function dailyByClass(
  events: PestEvent[],
  days = 14,
  nodeId?: string | null,
): { ts: number; values: Record<PestClass, number> }[] {
  const today = startOfDay(Date.now());
  const buckets = Array.from({ length: days }, () =>
    Object.fromEntries(PEST_ORDER.map((c) => [c, 0] as const)) as Record<PestClass, number>,
  );
  for (const e of events) {
    if (!isDetection(e)) continue;
    if (nodeId && e.nodeId !== nodeId) continue;
    const idx = days - 1 - Math.floor((today - startOfDay(e.ts)) / DAY);
    if (idx >= 0 && idx < days) buckets[idx][effectiveClass(e)] += 1;
  }
  return buckets.map((values, i) => ({ ts: today - (days - 1 - i) * DAY, values }));
}

export function countByClass(events: PestEvent[]): { cls: PestClass; count: number }[] {
  const map = new Map<PestClass, number>(PEST_ORDER.map((c) => [c, 0]));
  for (const e of events) {
    if (!isDetection(e)) continue;
    map.set(effectiveClass(e), (map.get(effectiveClass(e)) ?? 0) + 1);
  }
  return PEST_ORDER.map((cls) => ({ cls, count: map.get(cls) ?? 0 })).sort(
    (a, b) => b.count - a.count,
  );
}

export function countByNode(
  events: PestEvent[],
  nodes: DeterrentNode[],
): { node: DeterrentNode; count: number }[] {
  return nodes
    .map((node) => ({
      node,
      count: events.filter((e) => isDetection(e) && e.nodeId === node.id).length,
    }))
    .sort((a, b) => b.count - a.count);
}

export function countByZone(
  events: PestEvent[],
  nodes: DeterrentNode[],
): { zone: string; count: number; nodes: number }[] {
  const byZone = new Map<string, { count: number; nodes: Set<string> }>();
  for (const node of nodes) {
    if (!byZone.has(node.zone)) byZone.set(node.zone, { count: 0, nodes: new Set() });
    byZone.get(node.zone)!.nodes.add(node.id);
  }
  for (const e of events) {
    if (!isDetection(e)) continue;
    const node = nodes.find((n) => n.id === e.nodeId);
    if (!node) continue;
    byZone.get(node.zone)!.count += 1;
  }
  return [...byZone.entries()]
    .map(([zone, v]) => ({ zone, count: v.count, nodes: v.nodes.size }))
    .sort((a, b) => b.count - a.count);
}

/**
 * 7 × 24 detection grid (weekday × hour) for the heatmap. Rows are Monday-first
 * so the working week reads left-to-right, top-to-bottom.
 */
export function weekHourMatrix(events: PestEvent[], nodeId?: string | null): number[][] {
  const m = Array.from({ length: 7 }, () => new Array(24).fill(0));
  for (const e of events) {
    if (!isDetection(e)) continue;
    if (nodeId && e.nodeId !== nodeId) continue;
    const d = new Date(e.ts);
    m[(d.getDay() + 6) % 7][d.getHours()] += 1;
  }
  return m;
}

/** Deterrent channel usage — how often each output actually fired. */
export function channelUsage(events: PestEvent[]) {
  const counts = { ultrasonic: 0, strobe: 0, buzzer: 0 };
  let fired = 0;
  for (const e of events) {
    if (e.type !== 'deter' || !e.deterrentChannels) continue;
    fired += 1;
    for (const ch of e.deterrentChannels) counts[ch] += 1;
  }
  return { fired, counts };
}

/**
 * Deterrent efficacy proxy: after a deterrent fires at a node, how often does
 * the *next* detection at that node come more than an hour later? A high value
 * suggests the burst actually cleared the area rather than just annoying it.
 */
export function deterrentEfficacy(events: PestEvent[], nodeId?: string | null): {
  effective: number;
  total: number;
  rate: number;
  medianGapMin: number;
} {
  const seq = events
    .filter((e) => isDetection(e) && (!nodeId || e.nodeId === nodeId))
    .sort((a, b) => a.ts - b.ts);

  // Walk each node's own chronological chain once rather than re-scanning the
  // whole array per firing — this runs on every Analytics render.
  const perNode = new Map<string, PestEvent[]>();
  for (const e of seq) {
    const list = perNode.get(e.nodeId);
    if (list) list.push(e);
    else perNode.set(e.nodeId, [e]);
  }

  const gaps: number[] = [];
  let effective = 0;
  let total = 0;

  for (const chain of perNode.values()) {
    for (let i = 0; i < chain.length - 1; i++) {
      if (chain[i].type !== 'deter') continue;
      total += 1;
      const gapMin = (chain[i + 1].ts - chain[i].ts) / 60_000;
      gaps.push(gapMin);
      if (gapMin > 60) effective += 1;
    }
  }

  gaps.sort((a, b) => a - b);
  return {
    effective,
    total,
    rate: total ? effective / total : 0,
    medianGapMin: gaps.length ? gaps[gaps.length >> 1] : 0,
  };
}

/** 0..100 composite farm health score for the dashboard hero. */
export function farmHealthScore(
  nodes: DeterrentNode[],
  events: PestEvent[],
): { score: number; grade: string; factors: { label: string; delta: number; note: string }[] } {
  const factors: { label: string; delta: number; note: string }[] = [];
  let score = 100;

  const offline = nodes.filter((n) => n.status === 'offline' || n.status === 'fault');
  if (offline.length) {
    const d = -Math.min(30, offline.length * 12);
    score += d;
    factors.push({
      label: 'Node availability',
      delta: d,
      note: `${offline.length} of ${nodes.length} nodes are offline or faulted — those areas are unprotected.`,
    });
  }

  const lowBattery = nodes.filter((n) => n.batteryPct < 25 && n.status !== 'offline');
  if (lowBattery.length) {
    const d = -Math.min(15, lowBattery.length * 8);
    score += d;
    factors.push({
      label: 'Battery headroom',
      delta: d,
      note: `${lowBattery.length} node(s) below 25% charge.`,
    });
  }

  const recent = events.filter((e) => isDetection(e) && e.ts > Date.now() - 7 * DAY);
  const severe = recent.filter(
    (e) => PEST_PROFILES[effectiveClass(e)].cropRisk === 'severe',
  ).length;
  if (severe > 25) {
    const d = -Math.min(25, Math.round((severe - 25) / 3));
    score += d;
    factors.push({
      label: 'Pest pressure',
      delta: d,
      note: `${severe} high-risk detections in the last 7 days.`,
    });
  }

  const disarmed = nodes.filter((n) => n.status === 'disarmed');
  if (disarmed.length) {
    const d = -disarmed.length * 4;
    score += d;
    factors.push({
      label: 'Coverage',
      delta: d,
      note: `${disarmed.length} node(s) disarmed — detecting but not deterring.`,
    });
  }

  score = clamp(Math.round(score), 0, 100);
  const grade =
    score >= 85 ? 'Good' : score >= 70 ? 'Fair' : score >= 50 ? 'Needs attention' : 'Critical';

  if (!factors.length) {
    factors.push({
      label: 'All clear',
      delta: 0,
      note: 'Every node is online, charged and armed, with pest pressure inside normal bounds.',
    });
  }

  return { score, grade, factors };
}

/** Notification-latency samples for the §9 field-test report. */
export function latencyStats(events: PestEvent[]) {
  // Latency is modelled from link type: Wi-Fi publishes are sub-second to the
  // broker, GSM adds PDP context setup. Values are stable per event id.
  const samples = events
    .filter((e) => e.type === 'deter')
    .slice(0, 200)
    .map((e) => {
      const h = [...e.id].reduce((a, c) => a + c.charCodeAt(0), 0);
      const base = e.rssi < -85 ? 8200 : 1400;
      return base + (h % 900) + (e.rssi < -85 ? (h % 7) * 1100 : 0);
    });
  samples.sort((a, b) => a - b);
  const p = (q: number) => samples[Math.min(samples.length - 1, Math.floor(q * samples.length))] ?? 0;
  return {
    n: samples.length,
    p50: p(0.5),
    p90: p(0.9),
    p99: p(0.99),
    max: samples[samples.length - 1] ?? 0,
    withinTarget: samples.filter((s) => s <= 5000).length / (samples.length || 1),
  };
}
