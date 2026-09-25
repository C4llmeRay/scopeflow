/**
 * On a phone the recogniser reports its own volume (the `volumechange` event),
 * so there is no separate meter to run. See meter.web.ts for the browser.
 */
export const needsOwnMeter = false;

export async function startMeter(_onLevel: (level: number) => void): Promise<() => void> {
  return () => {};
}
