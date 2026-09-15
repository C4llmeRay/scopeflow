/**
 * Clock formatting for voice notes.
 *
 * Minutes and seconds, never hours: a field note that runs past an hour is a
 * recording somebody forgot to stop, and showing 1:02:33 would hide that more
 * than 62:33 does.
 */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return '0:00';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** "2:14 PM" — when the note was taken, which is how a contractor finds it again. */
export function formatClockTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}
