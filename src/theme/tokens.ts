import { Platform, ViewStyle } from 'react-native';
import { Palette } from './colors';

/**
 * Design tokens layered on top of the colour palette.
 *
 * The palette answers "which colour"; this answers "how does a surface sit in
 * space, and how fast does it move". Keeping them separate means the validated
 * chart colours stay untouched while the surface language evolves.
 */

// ---------------------------------------------------------------------------
// Elevation
// ---------------------------------------------------------------------------

/**
 * Four elevation steps. On a dark surface a drop shadow is nearly invisible,
 * so dark mode leans on a lifted background and a hairline border instead —
 * the same visual job done with the tools that actually work there.
 */
export type Elevation = 0 | 1 | 2 | 3;

export function elevation(level: Elevation, c: Palette): ViewStyle {
  if (level === 0) return {};

  const specs = {
    1: { radius: 8, opacity: 0.10, y: 2, android: 2 },
    2: { radius: 18, opacity: 0.14, y: 6, android: 5 },
    3: { radius: 32, opacity: 0.20, y: 12, android: 10 },
  } as const;

  const s = specs[level];

  if (c.scheme === 'dark') {
    // Shadows barely read on dark; separation comes from the surface itself.
    return {
      backgroundColor: c.surfaceRaised,
      ...Platform.select({
        ios: {
          shadowColor: '#000000',
          shadowOpacity: s.opacity * 1.6,
          shadowRadius: s.radius,
          shadowOffset: { width: 0, height: s.y },
        },
        android: { elevation: s.android },
        default: {},
      }),
    };
  }

  return Platform.select({
    ios: {
      shadowColor: c.shadow,
      shadowOpacity: s.opacity,
      shadowRadius: s.radius,
      shadowOffset: { width: 0, height: s.y },
    },
    android: { elevation: s.android },
    default: {
      boxShadow: `0 ${s.y}px ${s.radius}px rgba(15,23,42,${s.opacity})`,
    } as ViewStyle,
  })!;
}

// ---------------------------------------------------------------------------
// Motion
// ---------------------------------------------------------------------------

/**
 * Durations, in milliseconds.
 *
 * Anything a finger is waiting on stays under 200 ms, because past roughly
 * that a transition stops feeling like a response and starts feeling like a
 * delay. Only decorative entrances are allowed to be slower.
 */
export const motion = {
  instant: 90,
  fast: 150,
  base: 220,
  slow: 320,
  entrance: 420,
  /** Spring config used for anything a press drives. */
  press: { speed: 40, bounciness: 0 },
  /** Softer spring for panels and sheets. */
  panel: { damping: 18, stiffness: 180 },
} as const;

// ---------------------------------------------------------------------------
// Glass
// ---------------------------------------------------------------------------

/**
 * Translucent surface.
 *
 * Used sparingly and only where something sits *over* content — a sticky
 * header, a floating bar. Glass over a flat background is just a lighter grey
 * with extra cost, so it earns its place only when there is something behind
 * it worth hinting at.
 */
export function glass(c: Palette, intensity: 'light' | 'heavy' = 'light'): ViewStyle {
  const alpha = intensity === 'heavy' ? 'F2' : 'D9';
  return {
    backgroundColor: c.surface + alpha,
    borderWidth: 1,
    borderColor: c.scheme === 'dark' ? '#FFFFFF14' : '#0F172A0F',
  };
}

// ---------------------------------------------------------------------------
// Gradients
// ---------------------------------------------------------------------------

/** Two-stop tint of a single token colour — never a new hue. */
export function tint(color: string, strength: 'soft' | 'medium' = 'soft'): [string, string] {
  return strength === 'soft' ? [color + '1F', color + '05'] : [color + '38', color + '0A'];
}

/** Surface gradient for hero panels, derived from the scheme. */
export function surfaceGradient(c: Palette): [string, string] {
  return c.scheme === 'dark' ? ['#18222E', '#111820'] : ['#FFFFFF', '#F4F7FA'];
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export const layout = {
  /** Max content width so the app stays readable on a tablet or the web. */
  maxContentWidth: 640,
  screenPadding: 16,
  cardPadding: 16,
  /** Minimum touch target. Anything interactive must reach this. */
  minTouch: 44,
} as const;

/**
 * Type scale ratios for the accessibility "large text" setting. Multiplying at
 * the component level rather than swapping a whole second scale keeps every
 * size relationship intact as it grows.
 */
export const textScale = {
  normal: 1,
  large: 1.15,
  larger: 1.3,
} as const;

export type TextScaleKey = keyof typeof textScale;
