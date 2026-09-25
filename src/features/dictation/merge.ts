/**
 * Turning speech into description text.
 *
 * Pure, so the rules that decide what lands in the field are pinned by tests
 * rather than by trying it on three platforms. Speech arrives as segments: the
 * one being spoken changes word by word, and a finished one is committed. The
 * browser and Android finish a segment at every pause; iOS keeps one growing
 * segment for the whole session. Treating each event as "the current segment"
 * handles both.
 */

/** What was in the field when dictation started, plus what has been said. */
export function joinSpoken(base: string, spoken: string): string {
  const words = spoken.trim().replace(/\s+/g, ' ');
  if (!words) return base;

  const head = base.replace(/\s+$/, '');
  // A new sentence starts with a capital, whatever the recogniser sent.
  const startsSentence = head === '' || /[.!?]$/.test(head);
  const text = startsSentence ? words[0].toUpperCase() + words.slice(1) : words;

  return head === '' ? text : `${head} ${text}`;
}

export interface DictationText {
  /** Segments already finished. */
  committed: string;
  /** The segment being spoken, still changing. */
  current: string;
}

export const EMPTY_DICTATION: DictationText = { committed: '', current: '' };

/** Applies one recognition result. */
export function applyResult(state: DictationText, transcript: string, isFinal: boolean): DictationText {
  if (!isFinal) return { ...state, current: transcript };
  const committed = [state.committed, transcript.trim()].filter(Boolean).join(' ');
  return { committed, current: '' };
}

/** Everything said so far, finished or not. */
export const spokenSoFar = (state: DictationText): string =>
  [state.committed, state.current.trim()].filter(Boolean).join(' ');

/* -------------------------------------------------------------------------- */
/* The meter                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The native recogniser reports volume from -2 to 10, anything under 0 being
 * silence. Speech sits around 2 to 8, so that range fills the meter.
 */
export function levelFromVolume(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(1, value / 8);
}

/**
 * The browser meter measures RMS amplitude, 0 to 1. Speech into a laptop mic
 * is roughly 0.02 to 0.3, so it is scaled on a curve that lifts quiet speech
 * and still leaves room at the top for a peak.
 */
export function levelFromRms(rms: number): number {
  if (!Number.isFinite(rms) || rms <= 0.005) return 0;
  return Math.min(1, Math.sqrt(rms / 0.3));
}

/** A level at or above this is drawn as a peak. */
export const PEAK = 0.8;

/** The rolling history the meter draws, newest last. */
export function pushLevel(history: readonly number[], level: number, size: number): number[] {
  const next = [...history, Math.max(0, Math.min(1, level))];
  return next.length > size ? next.slice(next.length - size) : next;
}

/** "0:07" — how long the microphone has been open. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
