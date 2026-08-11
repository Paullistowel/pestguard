/**
 * PestGuard palette.
 *
 * Dark-first, because the app is used at dusk and at night when rodent and bat
 * activity peaks — that is also when a farmer is most likely to be reading a
 * push notification outdoors. The light scheme is a full peer, not an
 * afterthought: every token below exists in both.
 */

export interface Palette {
  scheme: 'dark' | 'light';

  // Surfaces, back to front.
  bg: string;
  surface: string;
  surfaceAlt: string;
  surfaceRaised: string;
  border: string;
  borderStrong: string;

  // Type.
  text: string;
  textMuted: string;
  textFaint: string;
  textInverse: string;

  // Brand + semantics.
  primary: string;
  primaryDim: string;
  primaryText: string;
  danger: string;
  dangerDim: string;
  warning: string;
  warningDim: string;
  info: string;
  infoDim: string;
  success: string;
  successDim: string;

  /**
   * The one categorical scale in the app: pest class, in fixed order
   * rodent → bird → insect → bat → unclassified. Hues are assigned to the
   * entity and never cycled or re-ranked, so a filter that removes a species
   * never repaints the survivors.
   *
   * Validated all-pairs (not just adjacent) against this scheme's chart
   * surface: lightness band, chroma floor, CVD separation, normal-vision
   * floor and contrast all pass. The worst protanopic pair sits in the 6–8
   * floor band, which is legal only alongside secondary encoding — so every
   * chart that uses these also carries a legend, a per-species glyph, and
   * direct labels.
   */
  series: string[];
  /** Single hue for magnitude charts (by node, by zone, by hour). */
  seqHue: string;

  // Status colours for node cards / map pins.
  statusArmed: string;
  statusDeterring: string;
  statusDisarmed: string;
  statusOffline: string;
  statusFault: string;

  overlay: string;
  shadow: string;
}

export const darkPalette: Palette = {
  scheme: 'dark',

  bg: '#0A0E13',
  surface: '#131A22',
  surfaceAlt: '#1A222C',
  surfaceRaised: '#212B37',
  border: '#26313E',
  borderStrong: '#374556',

  text: '#E9EFF6',
  textMuted: '#93A4B8',
  textFaint: '#63758A',
  textInverse: '#0A0E13',

  primary: '#35C77E',
  primaryDim: '#173D2C',
  primaryText: '#05150D',
  danger: '#FF6B6B',
  dangerDim: '#42201F',
  warning: '#FFB020',
  warningDim: '#40300E',
  info: '#4EA8FF',
  infoDim: '#152B44',
  success: '#35C77E',
  successDim: '#173D2C',

  series: ['#E5675F', '#4187F0', '#8E8000', '#C45BC0', '#7E8FA3'],
  seqHue: '#4187F0',

  statusArmed: '#35C77E',
  statusDeterring: '#FFB020',
  statusDisarmed: '#93A4B8',
  statusOffline: '#63758A',
  statusFault: '#FF6B6B',

  overlay: 'rgba(4, 8, 12, 0.72)',
  shadow: '#000000',
};

export const lightPalette: Palette = {
  scheme: 'light',

  bg: '#F4F7FA',
  surface: '#FFFFFF',
  surfaceAlt: '#EDF2F7',
  surfaceRaised: '#FFFFFF',
  border: '#DCE4ED',
  borderStrong: '#C3CFDC',

  text: '#0F1A26',
  textMuted: '#516275',
  textFaint: '#7E8FA3',
  textInverse: '#FFFFFF',

  primary: '#0E9F5E',
  primaryDim: '#DCF3E7',
  primaryText: '#FFFFFF',
  danger: '#D63A3A',
  dangerDim: '#FCE4E4',
  warning: '#B87500',
  warningDim: '#FDF0D8',
  info: '#1C6FD0',
  infoDim: '#DEEBFB',
  success: '#0E9F5E',
  successDim: '#DCF3E7',

  series: ['#B83A34', '#1C6FD0', '#A89400', '#A93FB5', '#6B7A8C'],
  seqHue: '#1C6FD0',

  statusArmed: '#0E9F5E',
  statusDeterring: '#B87500',
  statusDisarmed: '#516275',
  statusOffline: '#7E8FA3',
  statusFault: '#D63A3A',

  overlay: 'rgba(15, 26, 38, 0.45)',
  shadow: '#8B9AAB',
};

/**
 * Pest-class hue lookup, per scheme. These are the same values as
 * `Palette.series` — exposed by name so a chart can ask for "the rodent
 * colour" rather than an index, which is what keeps colour bound to the
 * entity when series are filtered in or out.
 */
export const pestColors: Record<'dark' | 'light', Record<string, string>> = {
  dark: {
    rodent: '#E5675F',
    bird: '#4187F0',
    insect: '#8E8000',
    bat: '#C45BC0',
    unknown: '#7E8FA3',
  },
  light: {
    rodent: '#B83A34',
    bird: '#1C6FD0',
    insect: '#A89400',
    bat: '#A93FB5',
    unknown: '#6B7A8C',
  },
};

/** Sequential ramp for magnitude (heatmap cells), light → dark, one hue. */
export const sequentialRamp: Record<'dark' | 'light', string[]> = {
  // On a dark surface the ramp runs dim → bright: more ink = more magnitude.
  dark: ['#1A222C', '#1E3A52', '#22527A', '#276BA4', '#3B87C9', '#63A8E4'],
  light: ['#EDF3FA', '#CFE0F2', '#A8C7E8', '#7BA9DA', '#4B87C8', '#1C6FD0'],
};
