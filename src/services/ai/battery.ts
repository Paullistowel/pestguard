import { BatteryForecast, DeterrentNode, PestEvent } from '@/types';
import { clamp, linearRegression } from '@/utils/math';

/**
 * Battery-life estimation — §5.3, surfaced on the Battery & Health screen.
 *
 * Least-squares fit of pack voltage against time over the heartbeat history,
 * extrapolated to the 3.20 V protection cutoff of the 18650 pack used in the
 * base project. r² is reported alongside the estimate and drives the confidence
 * band, because a flat or noisy discharge curve produces a slope that is not
 * worth acting on — and telling a farmer "3 days" from a bad fit is worse than
 * telling them the estimate is unreliable.
 */

export const CUTOFF_VOLTS = 3.2;
const DAY = 86_400_000;

export function forecastBattery(node: DeterrentNode, events: PestEvent[]): BatteryForecast {
  const all = events
    .filter((e) => e.nodeId === node.id && e.batteryVolts > 0)
    .sort((a, b) => a.ts - b.ts);

  // Fit only the readings since the last pack change. A swap shows up as a
  // sharp rise in pack voltage, and regressing across one averages a fresh
  // cell together with a spent one — which produces a slope that describes
  // neither. This is the single biggest source of nonsense in voltage-based
  // fuel gauging, and it is cheap to exclude.
  const SWAP_RISE_V = 0.15;
  let start = 0;
  for (let i = 1; i < all.length; i++) {
    if (all[i].batteryVolts - all[i - 1].batteryVolts > SWAP_RISE_V) start = i;
  }
  const readings = all.slice(start);

  if (readings.length < 4) {
    return {
      nodeId: node.id,
      slopeVoltsPerDay: 0,
      interceptVolts: node.batteryVolts,
      r2: 0,
      daysRemaining: Number.POSITIVE_INFINITY,
      depletionTs: Number.POSITIVE_INFINITY,
      confidence: 'low',
      recommendation: 'Not enough heartbeat history yet — check back after a few days of logging.',
    };
  }

  const t0 = readings[0].ts;
  const xs = readings.map((r) => (r.ts - t0) / DAY);
  const ys = readings.map((r) => r.batteryVolts);
  const { slope, intercept, r2 } = linearRegression(xs, ys);

  const nowDays = (Date.now() - t0) / DAY;
  const vNow = slope * nowDays + intercept;

  let daysRemaining: number;
  if (slope >= -1e-4) {
    // Flat or rising — solar top-up is keeping pace with the radio draw.
    daysRemaining = Number.POSITIVE_INFINITY;
  } else {
    daysRemaining = clamp((vNow - CUTOFF_VOLTS) / -slope, 0, 3650);
  }

  const confidence: BatteryForecast['confidence'] =
    r2 >= 0.8 && readings.length >= 14 ? 'high' : r2 >= 0.5 ? 'medium' : 'low';

  return {
    nodeId: node.id,
    slopeVoltsPerDay: slope,
    interceptVolts: intercept,
    r2,
    daysRemaining,
    depletionTs: Number.isFinite(daysRemaining) ? Date.now() + daysRemaining * DAY : Infinity,
    confidence,
    recommendation: recommend(node, daysRemaining, slope, confidence),
  };
}

function recommend(
  node: DeterrentNode,
  days: number,
  slope: number,
  confidence: BatteryForecast['confidence'],
): string {
  if (!Number.isFinite(days)) {
    return node.solarAssisted
      ? 'Voltage is holding flat — the solar panel is covering the ESP32 radio draw. No action needed.'
      : 'Voltage is not trending down measurably yet. Keep logging heartbeats to refine the estimate.';
  }
  if (days < 2) {
    return 'Swap the pack now. Below the cutoff the node stops deterring entirely and the gateway loses its buffered events after roughly 12 hours.';
  }
  if (days < 7) {
    return `Schedule a pack swap within the week. ${
      node.link === 'gsm'
        ? 'This node runs GSM, whose TX bursts pull hardest — batching transmissions would buy a few extra days.'
        : 'Raising the heartbeat interval would extend this modestly.'
    }`;
  }
  if (days < 21) {
    return 'Comfortable for now. Add it to the next scheduled maintenance walk rather than making a special trip.';
  }
  const conf = confidence === 'low' ? ' Treat this as indicative — the discharge fit is still noisy.' : '';
  return `Healthy. At ${Math.abs(slope * 1000).toFixed(1)} mV/day the pack has weeks of headroom.${conf}`;
}

export function forecastAll(nodes: DeterrentNode[], events: PestEvent[]): BatteryForecast[] {
  return nodes.map((n) => forecastBattery(n, events));
}

/** Voltage series for the battery sparkline / detail chart. */
export function voltageSeries(
  nodeId: string,
  events: PestEvent[],
  days = 30,
): { ts: number; volts: number }[] {
  const cutoff = Date.now() - days * DAY;
  return events
    .filter((e) => e.nodeId === nodeId && e.type === 'heartbeat' && e.ts >= cutoff)
    .sort((a, b) => a.ts - b.ts)
    .map((e) => ({ ts: e.ts, volts: e.batteryVolts }));
}

/**
 * Projected voltage points from now to the cutoff, for the dashed
 * extrapolation drawn past the end of the measured series.
 */
export function projectionSeries(
  forecast: BatteryForecast,
  fromTs: number,
  fromVolts: number,
  steps = 12,
): { ts: number; volts: number }[] {
  if (!Number.isFinite(forecast.daysRemaining) || forecast.daysRemaining <= 0) return [];
  const span = Math.min(forecast.daysRemaining, 45);
  return Array.from({ length: steps + 1 }, (_, i) => {
    const d = (span * i) / steps;
    return {
      ts: fromTs + d * DAY,
      volts: Math.max(CUTOFF_VOLTS, fromVolts + forecast.slopeVoltsPerDay * d),
    };
  });
}

/**
 * Energy accounting for the "why is my battery draining" explainer.
 *
 * These are duty-cycled averages, not peak draw. A Nano sampling continuously
 * with the mic preamp and LCD backlight live pulls tens of milliamps and would
 * flatten a single 18650 inside a week; the firmware instead wakes for short
 * listening windows and leaves the display dark unless the enclosure button is
 * pressed. That is the design decision that turns days of endurance into weeks,
 * and it is why the radio — the thing people assume is the problem — is not the
 * largest line here.
 */
export function drawBreakdown(node: DeterrentNode) {
  const heartbeatsPerDay = 86400 / node.config.heartbeatSec;
  // GSM registration bursts cost far more per message than a Wi-Fi publish.
  const radioMah = heartbeatsPerDay * (node.link === 'gsm' ? 0.055 : 0.012);
  const idleMah = node.link === 'gsm' ? 8.5 : 6.0;
  const deterMah = node.status === 'disarmed' ? 0 : 4.5;
  const baseMah = 26; // Nano + mic preamp across its listening windows
  const total = radioMah + idleMah + deterMah + baseMah;
  return {
    total,
    items: [
      { label: 'Nano + mic (duty-cycled)', mah: baseMah },
      { label: 'Gateway idle', mah: idleMah },
      { label: 'Radio TX bursts', mah: radioMah },
      { label: 'Deterrent firing', mah: deterMah },
    ].map((i) => ({ ...i, share: i.mah / total })),
  };
}
