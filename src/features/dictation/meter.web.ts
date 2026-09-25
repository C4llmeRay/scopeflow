/**
 * The browser's speech recogniser says nothing about volume, so the meter
 * listens for itself: a second, silent tap on the microphone through the Web
 * Audio API, measured as RMS amplitude every animation-ish tick.
 */

import { levelFromRms } from './merge';

export const needsOwnMeter = true;

const TICK_MS = 70;

export async function startMeter(onLevel: (level: number) => void): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const context = new AudioContext();
  // Browsers create audio suspended until the page has been interacted with;
  // the tap on Dictate counts, but only if the context is asked to run.
  if (context.state === 'suspended') await context.resume().catch(() => undefined);
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);

  const samples = new Float32Array(analyser.fftSize);
  const timer = setInterval(() => {
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (const s of samples) sum += s * s;
    onLevel(levelFromRms(Math.sqrt(sum / samples.length)));
  }, TICK_MS);

  return () => {
    clearInterval(timer);
    source.disconnect();
    for (const track of stream.getTracks()) track.stop();
    void context.close();
  };
}
