/**
 * ScopeFlow design tokens.
 *
 * Tuned for the conditions in the plan's mobile rules, not for a design gallery:
 * a phone held one-handed, sometimes with a glove on, in direct sunlight on a
 * driveway and in an unlit crawlspace twenty minutes later. That means heavy
 * weights, generous targets, and contrast well past the minimum.
 */

export interface ThemeColors {
  bg: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  borderStrong: string;
  text: string;
  textMuted: string;
  textFaint: string;
  accent: string;
  accentText: string;
  accentSoft: string;
  hivis: string;
  danger: string;
  dangerSoft: string;
  success: string;
  successSoft: string;
  warn: string;
  warnSoft: string;
}

const light: ThemeColors = {
  bg: '#EFF2F4',
  surface: '#FFFFFF',
  surfaceAlt: '#E4EAEE',
  border: '#C7D1D8',
  borderStrong: '#8C9BA5',
  text: '#0E1821',
  textMuted: '#42525C',
  textFaint: '#697A85',
  accent: '#0B5468',
  accentText: '#FFFFFF',
  accentSoft: '#D8EAF1',
  hivis: '#5F6E00',
  danger: '#992E14',
  dangerSoft: '#F9E3DC',
  success: '#185C3B',
  successSoft: '#DAEDE3',
  warn: '#7A5400',
  warnSoft: '#F7EDD4',
};

const dark: ThemeColors = {
  bg: '#0C1217',
  surface: '#161F26',
  surfaceAlt: '#1E2931',
  border: '#2B3740',
  borderStrong: '#4A5A65',
  text: '#E8EFF3',
  textMuted: '#A8B7C0',
  textFaint: '#7C8C96',
  accent: '#69BCD6',
  accentText: '#06121A',
  accentSoft: '#12303C',
  hivis: '#C2D400',
  danger: '#F09070',
  dangerSoft: '#3A2119',
  success: '#7BD0A4',
  successSoft: '#14301F',
  warn: '#E0B45A',
  warnSoft: '#332612',
};

export const colors = { light, dark } as const;
export type ColorSchemeName = keyof typeof colors;

/** 4pt grid. */
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 16,
  pill: 999,
} as const;

export const type = {
  display: { fontSize: 34, lineHeight: 38, fontWeight: '700' },
  title: { fontSize: 24, lineHeight: 29, fontWeight: '700' },
  heading: { fontSize: 18, lineHeight: 23, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 23, fontWeight: '400' },
  bodyStrong: { fontSize: 16, lineHeight: 23, fontWeight: '600' },
  label: { fontSize: 13, lineHeight: 17, fontWeight: '600', letterSpacing: 0.7 },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  /** Dimension entry. Big enough to read at arm's length in bad light. */
  numeric: { fontSize: 30, lineHeight: 36, fontWeight: '700' },
} as const;

/**
 * Minimum tap target. Not because a guideline says 44 — because a wet gloved
 * thumb has roughly half the precision of a bare one.
 */
export const MIN_TARGET = 48;

/** Primary actions sit here, inside comfortable thumb reach. */
export const THUMB_ZONE_PADDING = 16;
