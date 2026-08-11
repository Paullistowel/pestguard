import { PestClass, PestProfile } from '@/types';

/**
 * Reference catalogue for the five classes the Project 43 detector separates.
 *
 * `bandHz` mirrors the Goertzel target bins configured in the Nano firmware —
 * the app shows these on the event detail screen so a user can sanity-check
 * why a given signature matched.
 */
export const PEST_PROFILES: Record<PestClass, PestProfile> = {
  rodent: {
    id: 'rodent',
    label: 'Rodent',
    latin: 'Rattus spp. / Mus musculus',
    emoji: '🐀',
    bandHz: [20_000, 40_000],
    description:
      'Ultrasonic vocalisations (20–40 kHz) plus low-band gnawing transients. The most damaging class for stored grain and irrigation lines — a single colony can spoil far more than it eats through contamination.',
    cropRisk: 'severe',
    recommendedPattern: 'sweep',
    peakHours: [20, 21, 22, 23, 0, 1, 2, 3, 4],
  },
  bird: {
    id: 'bird',
    label: 'Bird',
    latin: 'Quelea quelea / Passer spp.',
    emoji: '🐦',
    bandHz: [2_000, 8_000],
    description:
      'Flock chatter and alarm calls in the 2–8 kHz band. Damage is concentrated in the milk-to-dough grain stage, and flocks return to the same field daily unless deterred early.',
    cropRisk: 'high',
    recommendedPattern: 'burst',
    peakHours: [6, 7, 8, 9, 16, 17, 18],
  },
  insect: {
    id: 'insect',
    label: 'Insect',
    latin: 'Gryllidae / Locusta migratoria',
    emoji: '🦗',
    bandHz: [3_000, 15_000],
    description:
      'Stridulation with strong harmonic structure across 3–15 kHz. Useful as an early-warning proxy: a rising cricket chorus often precedes a wider infestation by several days.',
    cropRisk: 'moderate',
    recommendedPattern: 'pulse',
    peakHours: [18, 19, 20, 21, 22],
  },
  bat: {
    id: 'bat',
    label: 'Bat',
    latin: 'Chiroptera',
    emoji: '🦇',
    bandHz: [25_000, 45_000],
    description:
      'Echolocation sweeps that overlap the rodent ultrasonic band — the single largest source of false rodent alarms. Bats are beneficial insect predators, so the deterrent is suppressed by default for this class.',
    cropRisk: 'low',
    recommendedPattern: 'silent',
    peakHours: [19, 20, 21, 22, 23],
  },
  unknown: {
    id: 'unknown',
    label: 'Unclassified',
    latin: '—',
    emoji: '❓',
    bandHz: [0, 40_000],
    description:
      'Energy crossed the detection threshold but no class reached the confidence floor. Usually wind, rain on the enclosure, or machinery. These events are the primary training signal for adaptive thresholding.',
    cropRisk: 'low',
    recommendedPattern: 'silent',
    peakHours: [],
  },
};

export const PEST_ORDER: PestClass[] = ['rodent', 'bird', 'insect', 'bat', 'unknown'];

export const RISK_WEIGHT: Record<PestProfile['cropRisk'], number> = {
  low: 0.2,
  moderate: 0.5,
  high: 0.8,
  severe: 1,
};

export const DETERRENT_PATTERNS = [
  {
    id: 'sweep' as const,
    label: 'Frequency Sweep',
    description:
      'Continuously sweeps the ultrasonic carrier across 18–45 kHz so pests cannot habituate to a fixed tone. Highest efficacy against rodents; highest current draw.',
    dutyHint: 'High power',
  },
  {
    id: 'pulse' as const,
    label: 'Pulsed Tone',
    description:
      '200 ms on / 300 ms off at a fixed carrier. Good balance of efficacy and battery life for insect and general-purpose deployments.',
    dutyHint: 'Medium power',
  },
  {
    id: 'burst' as const,
    label: 'Startle Burst',
    description:
      'Short, loud composite burst — buzzer and strobe together with a brief ultrasonic tail. Best for flocking birds, which respond to sudden onset rather than sustained sound.',
    dutyHint: 'High peak, low average',
  },
  {
    id: 'random' as const,
    label: 'Randomised',
    description:
      'Randomises carrier, duty and interval on every trigger. Slowest habituation over long deployments; slightly less immediate efficacy per event.',
    dutyHint: 'Variable',
  },
  {
    id: 'silent' as const,
    label: 'Log Only',
    description:
      'Detects and logs but fires no deterrent. Used for beneficial species, for baseline data collection, and inside quiet hours.',
    dutyHint: 'No draw',
  },
];
