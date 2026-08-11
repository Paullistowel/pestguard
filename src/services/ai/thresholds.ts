import { DeterrentNode, PestEvent, ThresholdSuggestion } from '@/types';
import { clamp } from '@/utils/math';
import { effectiveConfidence } from './classifier';

/**
 * Adaptive thresholds — §5.3.
 *
 * Each node accumulates its own false-alarm history from two sources: explicit
 * technician labels (`groundTruth === 'false_alarm'`) and events the classifier
 * could not name at all. A node sitting next to a diesel pump will collect far
 * more of these than one in a quiet orchard, which is exactly why the
 * suggestion is per-node rather than a global setting.
 *
 * The suggestion is *advisory unless* `config.autoThreshold` is on. Nothing
 * here ever writes to the node directly — the app pushes a config change
 * through the same cloud → ESP32 → Nano path a human edit would take (§6
 * step 5), so every threshold change is auditable.
 */

/** Minimum reviewed events before a suggestion is worth making. */
const MIN_SAMPLE = 20;

export function falseAlarmRate(events: PestEvent[], nodeId: string): number {
  const detections = events.filter(
    (e) => e.nodeId === nodeId && (e.type === 'detect' || e.type === 'deter'),
  );
  if (!detections.length) return 0;

  const bad = detections.filter(
    (e) =>
      e.groundTruth === 'false_alarm' ||
      // Unnamed, low-confidence energy is a nuisance trigger in all but name.
      ((e.aiClass ?? e.rawClass) === 'unknown' && effectiveConfidence(e) < 0.5),
  ).length;

  return bad / detections.length;
}

export function suggestThreshold(
  node: DeterrentNode,
  events: PestEvent[],
): ThresholdSuggestion {
  const nodeEvents = events.filter(
    (e) => e.nodeId === node.id && (e.type === 'detect' || e.type === 'deter'),
  );
  const rate = falseAlarmRate(events, node.id);
  const current = node.config.sensitivity;

  if (nodeEvents.length < MIN_SAMPLE) {
    return {
      nodeId: node.id,
      current,
      suggested: current,
      falseAlarmRate: rate,
      expectedFalseAlarmRate: rate,
      rationale: `Only ${nodeEvents.length} detections logged so far. The model holds off on threshold changes below ${MIN_SAMPLE} events — adjusting on thin data tends to swing sensitivity back and forth.`,
    };
  }

  // Target band: under 10% nuisance triggers, but not so tight that genuine
  // low-confidence detections get suppressed. Missing a rodent costs a farmer
  // far more than one spurious buzz, so the correction is asymmetric —
  // tightening is aggressive, loosening is cautious.
  const TARGET_HI = 0.1;
  const TARGET_LO = 0.02;

  let delta = 0;
  let rationale: string;

  if (rate > TARGET_HI) {
    delta = Math.round(clamp((rate - TARGET_HI) * 55, 2, 14));
    rationale = `${(rate * 100).toFixed(0)}% of this node's detections were nuisance triggers — well above the 10% target. Raising the Goertzel magnitude threshold by ${delta} points should filter the weakest of them while leaving confident detections untouched.`;
  } else if (rate < TARGET_LO) {
    delta = -Math.round(clamp((TARGET_LO - rate) * 90, 1, 5));
    rationale = `Nuisance triggers are down at ${(rate * 100).toFixed(
      1,
    )}%, below the ${(TARGET_LO * 100).toFixed(0)}% floor — the node may be running tighter than it needs to and missing quiet approaches. A small ${Math.abs(
      delta,
    )}-point drop would recover sensitivity with little added noise.`;
  } else {
    rationale = `Nuisance-trigger rate is ${(rate * 100).toFixed(
      0,
    )}%, inside the 2–10% target band. No change recommended.`;
  }

  const suggested = clamp(current + delta, 20, 95);

  // First-order effect estimate: nuisance triggers scale roughly with the
  // fraction of marginal events sitting just above the threshold.
  const expected =
    delta === 0 ? rate : clamp(rate * (1 - delta * 0.045), 0.005, 0.6);

  return {
    nodeId: node.id,
    current,
    suggested,
    falseAlarmRate: rate,
    expectedFalseAlarmRate: expected,
    rationale,
  };
}

export function suggestAll(
  nodes: DeterrentNode[],
  events: PestEvent[],
): ThresholdSuggestion[] {
  return nodes
    .map((n) => suggestThreshold(n, events))
    .filter((s) => s.suggested !== s.current)
    .sort((a, b) => b.falseAlarmRate - a.falseAlarmRate);
}

/** Plain-language reading of a sensitivity value, shown under the slider. */
export function describeSensitivity(v: number): { label: string; hint: string } {
  if (v < 35)
    return {
      label: 'Very sensitive',
      hint: 'Catches faint and distant signatures. Expect frequent nuisance triggers near machinery or in wind.',
    };
  if (v < 50)
    return {
      label: 'Sensitive',
      hint: 'Good for quiet indoor sites such as a grain store, where background noise is low and stakes are high.',
    };
  if (v < 70)
    return { label: 'Balanced', hint: 'The firmware default. Suits most open-field deployments.' };
  if (v < 85)
    return {
      label: 'Conservative',
      hint: 'Only strong, close signatures trigger. Fewer false alarms, but quiet approaches may be missed.',
    };
  return {
    label: 'Very conservative',
    hint: 'Near-field detections only. Use where a noisy neighbour — a pump or generator — dominates the microphone.',
  };
}
