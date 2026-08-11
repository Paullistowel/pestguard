/** Small numeric helpers — kept dependency-free so they run on any RN target. */

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function mean(xs: number[]): number {
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function quantile(xs: number[], q: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const pos = clamp(q, 0, 1) * (s.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? s[lo] : lerp(s[lo], s[hi], pos - lo);
}

/** Ordinary least squares over (x, y) pairs. Returns slope/intercept/r². */
export function linearRegression(
  xs: number[],
  ys: number[],
): { slope: number; intercept: number; r2: number } {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return { slope: 0, intercept: ys[0] ?? 0, r2: 0 };
  const mx = mean(xs.slice(0, n));
  const my = mean(ys.slice(0, n));
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0) return { slope: 0, intercept: my, r2: 0 };
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const r2 = syy === 0 ? 1 : clamp((sxy * sxy) / (sxx * syy), 0, 1);
  return { slope, intercept, r2 };
}

/** Numerically stable softmax. */
export function softmax(logits: number[]): number[] {
  if (!logits.length) return [];
  const max = Math.max(...logits);
  const exps = logits.map((l) => Math.exp(l - max));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  return exps.map((e) => e / sum);
}

/** Centred moving average — the "trend" term of a seasonal decomposition. */
export function movingAverage(xs: number[], window: number): number[] {
  const half = Math.floor(window / 2);
  return xs.map((_, i) => {
    const lo = Math.max(0, i - half);
    const hi = Math.min(xs.length, i + half + 1);
    return mean(xs.slice(lo, hi));
  });
}

/** Exponentially weighted moving average, alpha in (0, 1]. */
export function ewma(xs: number[], alpha = 0.3): number[] {
  const out: number[] = [];
  let prev = xs[0] ?? 0;
  for (const x of xs) {
    prev = alpha * x + (1 - alpha) * prev;
    out.push(prev);
  }
  return out;
}

/** Deterministic PRNG (mulberry32) so demo data is stable across reloads. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller normal sample built on a uniform generator. */
export function gaussian(rng: () => number, mu = 0, sigma = 1): number {
  const u = Math.max(1e-9, rng());
  const v = rng();
  return mu + sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** "Nice" axis ceiling so bar charts don't end on 37. */
export function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  const norm = v / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * mag;
}
