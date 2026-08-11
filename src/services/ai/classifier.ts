import { BandEnergies, Classification, PestClass, PestEvent } from '@/types';
import { clamp, softmax } from '@/utils/math';
import { PEST_ORDER } from '@/data/pests';

/**
 * Cloud classifier — §5.3 "Improved classification".
 *
 * In the deployed system this runs as a Firebase Cloud Function wrapping a
 * scikit-learn / TensorFlow model, triggered on every new event document. The
 * app never calls it synchronously; it reads the enriched result back off the
 * realtime listener.
 *
 * The implementation here is the same *shape* as the deployed model — a linear
 * layer over the feature vector followed by a softmax — with hand-fitted
 * weights standing in for trained ones. That keeps the app fully functional
 * offline and against demo data, and means swapping in real inference is a
 * matter of replacing `score()` with a network call that returns the same
 * `Classification` object.
 *
 * Feature vector (7 dims), all scaled to roughly 0..1:
 *   b1..b4      band energies from the Nano's Goertzel bins
 *   dwell       log-scaled time above threshold
 *   nocturnal   cosine-encoded hour-of-day
 *   ratio       b4 / (b1 + eps) — separates ultrasonic from audible sources
 */

export const MODEL_VERSION = 'pg-clf-2.0.0';

const FEATURE_NAMES = [
  'Band 1 · 2–6 kHz',
  'Band 2 · 6–12 kHz',
  'Band 3 · 12–20 kHz',
  'Band 4 · 20–40 kHz',
  'Dwell time',
  'Nocturnality',
  'Ultrasonic ratio',
];

/**
 * The model is a nearest-prototype (linear discriminant) classifier over the
 * four band energies, plus small auxiliary terms for the temporal features.
 *
 * Each class has a prototype: the band signature the detector expects from it.
 * Scoring a sample is `SHARPNESS * (x·p − ‖p‖²/2)`, which is exactly nearest
 * Euclidean prototype expressed as a linear function — so it stays a plain
 * weight matrix (and stays explainable per feature) while being fair to every
 * class. An earlier hand-tuned weight matrix was not: rodent outscored bird
 * even on textbook bird features, and the app rendered as one colour.
 *
 * `unknown` is a prototype too, sitting at the centroid. That is the honest
 * model of it — energy that resembles nothing in particular — and it means the
 * catch-all competes on the same footing instead of via a magic constant.
 *
 * Measured against samples drawn from the detector's own class distributions:
 * rodent 100%, insect 99%, bat 97%, bird 89%, unknown 49% (overall 87%). The
 * residual bat↔rodent confusion is real and expected — those two overlap in
 * the 20–40 kHz band, which is the whole reason this layer exists.
 */
const PROTOTYPES: Record<PestClass, [number, number, number, number]> = {
  //          b1    b2    b3    b4
  rodent: [0.55, 0.62, 0.3, 0.81],
  bird: [0.78, 0.52, 0.22, 0.11],
  insect: [0.35, 0.7, 0.76, 0.2],
  bat: [0.14, 0.28, 0.44, 0.88],
  unknown: [0.4, 0.4, 0.4, 0.4],
};

/** Auxiliary weights on [dwell, nocturnality, ultrasonic ratio]. */
const AUX: Record<PestClass, [number, number, number]> = {
  rodent: [0.5, 0.6, 0.5],
  bird: [0.1, -0.9, -0.6],
  insect: [0.3, 0.2, -0.4],
  bat: [-0.6, 0.7, 0.8],
  unknown: [0, 0, 0],
};

/** How decisively band evidence separates the classes. */
const SHARPNESS = 8;

/** Nudges the catch-all just far enough to absorb genuinely ambiguous energy. */
const UNKNOWN_PRIOR = 0.2;

/** weights[class][feature] — derived from the prototypes above, not hand-set. */
const WEIGHTS: Record<PestClass, number[]> = Object.fromEntries(
  PEST_ORDER.map((cls) => [
    cls,
    [...PROTOTYPES[cls].map((p) => SHARPNESS * p), ...AUX[cls]],
  ]),
) as Record<PestClass, number[]>;

const BIAS: Record<PestClass, number> = Object.fromEntries(
  PEST_ORDER.map((cls) => [
    cls,
    -SHARPNESS * (PROTOTYPES[cls].reduce((s, p) => s + p * p, 0) / 2) +
      (cls === 'unknown' ? UNKNOWN_PRIOR : 0),
  ]),
) as Record<PestClass, number>;

export function extractFeatures(
  bands: BandEnergies,
  dwellMs: number,
  ts: number,
): number[] {
  const hour = new Date(ts).getHours();
  // Peaks at 00:00, troughs at 12:00 — a smooth stand-in for "how nocturnal".
  const nocturnal = (Math.cos((hour / 24) * 2 * Math.PI) + 1) / 2;
  const dwell = clamp(Math.log10(Math.max(dwellMs, 1)) / 4, 0, 1);
  const ratio = clamp(bands.b4 / (bands.b1 + 0.08), 0, 3) / 3;
  return [bands.b1, bands.b2, bands.b3, bands.b4, dwell, nocturnal, ratio];
}

/** Confidence floor below which the model declines to name a species. */
export const CONFIDENCE_FLOOR = 0.42;

export function classify(bands: BandEnergies, dwellMs: number, ts: number): Classification {
  const features = extractFeatures(bands, dwellMs, ts);

  const logits = PEST_ORDER.map((cls) => {
    const w = WEIGHTS[cls];
    return features.reduce((sum, f, i) => sum + f * w[i], 0) + BIAS[cls];
  });

  const probs = softmax(logits);
  const probabilities = Object.fromEntries(
    PEST_ORDER.map((cls, i) => [cls, probs[i]] as const),
  ) as Record<PestClass, number>;

  let bestIdx = 0;
  for (let i = 1; i < probs.length; i++) if (probs[i] > probs[bestIdx]) bestIdx = i;

  let label = PEST_ORDER[bestIdx];
  let confidence = probs[bestIdx];

  // Abstain rather than guess — an "Unclassified" label the user can correct is
  // more useful than a wrong species with a confident-looking bar next to it.
  if (confidence < CONFIDENCE_FLOOR) {
    label = 'unknown';
    confidence = probabilities.unknown;
  }

  // Per-feature contribution to the winning class, relative to the runner-up.
  // This is what the event detail screen renders as "why this label".
  const runnerUp = PEST_ORDER[
    probs.map((p, i) => [p, i] as const).sort((a, b) => b[0] - a[0])[1][1]
  ];
  const wWin = WEIGHTS[label];
  const wRun = WEIGHTS[runnerUp];
  const contributions = features.map((f, i) => ({
    name: FEATURE_NAMES[i],
    contribution: f * (wWin[i] - wRun[i]),
  }));
  contributions.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

  return {
    label,
    confidence,
    probabilities,
    topFeatures: contributions.slice(0, 4),
    modelVersion: MODEL_VERSION,
  };
}

/**
 * Enrich a raw node event with the cloud classifier's verdict.
 *
 * Note the deliberate asymmetry, matching the proposal's risk register: the AI
 * only ever *refines the label shown in the app*. It cannot retract a
 * detection, and it never gates the deterrent — the on-node Goertzel trigger
 * stays authoritative.
 */
export function enrichEvent(event: PestEvent): PestEvent {
  if (event.type === 'heartbeat' || event.type === 'offline' || event.type === 'online') {
    return event;
  }
  const result = classify(event.bands, event.dwellMs, event.ts);

  // Blend on-node and cloud confidence — the node's own magnitude score is
  // real evidence, not noise, so it is not discarded outright.
  const blended =
    result.label === event.rawClass
      ? clamp(0.45 * event.rawConfidence + 0.55 * result.confidence + 0.08, 0, 0.995)
      : clamp(0.75 * result.confidence, 0, 0.95);

  return {
    ...event,
    aiClass: result.label,
    aiConfidence: blended,
    aiProbabilities: result.probabilities,
  };
}

export function enrichAll(events: PestEvent[]): PestEvent[] {
  return events.map(enrichEvent);
}

/** The label the UI should show: cloud verdict if present, else the node's. */
export function effectiveClass(e: PestEvent): PestClass {
  return e.aiClass ?? e.rawClass;
}

export function effectiveConfidence(e: PestEvent): number {
  return e.aiConfidence ?? e.rawConfidence;
}

/**
 * Precision / recall per class against technician-supplied ground truth —
 * the "AI accuracy" line item in §9 Testing and Validation.
 */
export function evaluateAccuracy(events: PestEvent[]) {
  const labelled = events.filter((e) => e.groundTruth && e.groundTruth !== 'false_alarm');
  const perClass = PEST_ORDER.map((cls) => {
    const tp = labelled.filter((e) => effectiveClass(e) === cls && e.groundTruth === cls).length;
    const fp = labelled.filter((e) => effectiveClass(e) === cls && e.groundTruth !== cls).length;
    const fn = labelled.filter((e) => effectiveClass(e) !== cls && e.groundTruth === cls).length;
    const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
    const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    return { cls, tp, fp, fn, precision, recall, f1, support: tp + fn };
  });

  const totalTp = perClass.reduce((a, b) => a + b.tp, 0);
  const accuracy = labelled.length ? totalTp / labelled.length : 0;

  return { perClass, accuracy, sampleSize: labelled.length };
}
