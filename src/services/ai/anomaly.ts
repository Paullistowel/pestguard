import { AnomalyResult, PestEvent } from '@/types';
import { clamp, linearRegression, mean, movingAverage, stdev } from '@/utils/math';
import { startOfDay } from '@/utils/format';

/**
 * Trend & anomaly detection — §5.3, feeding the Predictive Alerts screen.
 *
 * Approach: a light seasonal decomposition. Daily detection counts are split
 * into trend (centred moving average) and a day-of-week seasonal term; the
 * residual is standardised, and a persistent positive residual in the trailing
 * window is what we call an anomaly. A 7-day linear extrapolation of the trend
 * gives the projection shown on the alert.
 *
 * This is deliberately simple and inspectable rather than a black box. A farmer
 * being told "move your traps" deserves to see the arithmetic, and a simple
 * model degrades gracefully on the ~30 days of history a student deployment
 * will realistically have — an isolation forest needs far more.
 */

const DAY = 86_400_000;

/** Daily counts for a node over the trailing `days`, oldest first. */
export function dailyCounts(events: PestEvent[], nodeId: string | null, days = 30): number[] {
  const today = startOfDay(Date.now());
  const buckets = new Array(days).fill(0);
  for (const e of events) {
    if (e.type !== 'detect' && e.type !== 'deter') continue;
    if (nodeId && e.nodeId !== nodeId) continue;
    const idx = days - 1 - Math.floor((today - startOfDay(e.ts)) / DAY);
    if (idx >= 0 && idx < days) buckets[idx] += 1;
  }
  return buckets;
}

interface Decomposition {
  observed: number[];
  trend: number[];
  seasonal: number[];
  residual: number[];
  residualZ: number[];
}

export function decompose(series: number[], period = 7): Decomposition {
  const trend = movingAverage(series, period);
  const detrended = series.map((v, i) => v - trend[i]);

  // Average detrended value per position in the seasonal cycle, then centre it
  // so the seasonal term contributes nothing on average.
  const byPhase: number[][] = Array.from({ length: period }, () => []);
  detrended.forEach((v, i) => byPhase[i % period].push(v));
  const rawSeasonal = byPhase.map((xs) => (xs.length ? mean(xs) : 0));
  const seasonalMean = mean(rawSeasonal);
  const centred = rawSeasonal.map((v) => v - seasonalMean);
  const seasonal = series.map((_, i) => centred[i % period]);

  const residual = series.map((v, i) => v - trend[i] - seasonal[i]);
  const sd = stdev(residual) || 1;
  const residualZ = residual.map((r) => r / sd);

  return { observed: series, trend, seasonal, residual, residualZ };
}

export function detectAnomaly(
  events: PestEvent[],
  nodeId: string,
  opts: { days?: number; window?: number; horizonDays?: number } = {},
): AnomalyResult {
  const days = opts.days ?? 30;
  const window = opts.window ?? 5;
  const horizonDays = opts.horizonDays ?? 7;

  const series = dailyCounts(events, nodeId, days);
  const d = decompose(series);

  const tail = series.slice(-window);
  const observed = tail.reduce((a, b) => a + b, 0);

  // Expectation for the same window from the pre-window baseline, so a spike
  // inside the window cannot inflate its own baseline.
  const baseline = series.slice(0, Math.max(1, series.length - window));
  const expected = mean(baseline) * window;

  // Mean standardised residual across the window — averaging suppresses a
  // single loud day and rewards a sustained shift, which is the thing worth
  // alerting on.
  const z = mean(d.residualZ.slice(-window));

  // Trend slope over the trailing fortnight, extrapolated forward.
  const recentIdx = series.map((_, i) => i).slice(-14);
  const { slope, intercept } = linearRegression(
    recentIdx,
    recentIdx.map((i) => d.trend[i]),
  );
  const projected = Math.max(
    0,
    slope * (series.length - 1 + horizonDays) + intercept,
  ) * horizonDays;

  const direction: AnomalyResult['direction'] =
    slope > 0.12 ? 'rising' : slope < -0.12 ? 'falling' : 'stable';

  const isAnomaly = z >= 1.8 && direction === 'rising' && observed > expected;

  // Severity blends how unusual it is with how much it is still climbing.
  const severity = clamp(z / 4 + Math.max(0, slope) / 2, 0, 1);

  return {
    nodeId,
    observed,
    expected: Math.max(0, expected),
    z,
    isAnomaly,
    direction,
    severity,
    horizonDays,
    projected: Math.round(projected),
  };
}

export function detectAllAnomalies(events: PestEvent[], nodeIds: string[]): AnomalyResult[] {
  return nodeIds
    .map((id) => detectAnomaly(events, id))
    .sort((a, b) => b.severity - a.severity);
}

/** Hour-of-day histogram (0..23) — powers the "activity clock" chart. */
export function hourHistogram(events: PestEvent[], nodeId?: string | null): number[] {
  const out = new Array(24).fill(0);
  for (const e of events) {
    if (e.type !== 'detect' && e.type !== 'deter') continue;
    if (nodeId && e.nodeId !== nodeId) continue;
    out[new Date(e.ts).getHours()] += 1;
  }
  return out;
}

/** Day-of-week histogram, Monday-first, for the weekly-rhythm chart. */
export function weekdayHistogram(events: PestEvent[], nodeId?: string | null): number[] {
  const out = new Array(7).fill(0);
  for (const e of events) {
    if (e.type !== 'detect' && e.type !== 'deter') continue;
    if (nodeId && e.nodeId !== nodeId) continue;
    const js = new Date(e.ts).getDay(); // 0 = Sunday
    out[(js + 6) % 7] += 1;
  }
  return out;
}

/** Human-readable sentence for a Predictive Alert body. */
export function describeAnomaly(a: AnomalyResult, nodeName: string): string {
  if (!a.isAnomaly) {
    return `${nodeName} is tracking its normal baseline (${a.observed} detections vs ${Math.round(
      a.expected,
    )} expected over the last 5 days).`;
  }
  const ratio = a.expected > 0 ? a.observed / a.expected : Infinity;
  const times = Number.isFinite(ratio) ? `${ratio.toFixed(1)}×` : 'well above';
  return `${nodeName} logged ${a.observed} detections in the last 5 days — ${times} its seasonal baseline of ${Math.round(
    a.expected,
  )}. The trend is still climbing; at this rate expect roughly ${a.projected} detections over the next ${a.horizonDays} days. This pattern is consistent with an establishing colony rather than passing foragers.`;
}
