/**
 * Speech to text for a single field.
 *
 * The recogniser is one per app, and its events go to every listener, so each
 * field that can dictate takes ownership while its microphone is open and
 * ignores events that are not its own. Starting a second field hands over
 * cleanly rather than writing one person's words into two boxes.
 *
 * Words land in the field as they are spoken, after whatever was already
 * there, so the contractor watches the description build and can stop the
 * moment it is right.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { speech, useSpeechEvent } from '../notes/speech';
import {
  applyResult,
  EMPTY_DICTATION,
  joinSpoken,
  levelFromVolume,
  pushLevel,
  spokenSoFar,
} from './merge';
import { needsOwnMeter, startMeter } from './meter';

/** How many bars the meter shows. */
export const METER_BARS = 32;

/** The field whose microphone is open, if any. */
let activeOwner: symbol | null = null;

/** Things a person hears about, as opposed to a pause or a cancelled start. */
const QUIET_ERRORS = new Set(['no-speech', 'aborted', 'speech-timeout']);

function describe(code: string, message: string): string {
  switch (code) {
    case 'not-allowed':
      return 'Microphone access is off. Allow it in the settings to dictate.';
    case 'network':
      return 'Dictation needs a connection on this device. Type it instead, or try again with signal.';
    case 'audio-capture':
      return 'No microphone was found.';
    case 'language-not-supported':
      return 'This device cannot recognise English speech.';
    default:
      return message || 'Dictation stopped.';
  }
}

function recogniserAvailable(): boolean {
  if (!speech) return false;
  try {
    return speech.isRecognitionAvailable();
  } catch {
    return false;
  }
}

export type DictationPhase = 'idle' | 'starting' | 'listening';

export interface Dictation {
  /** False in Expo Go, and in browsers without speech recognition. */
  available: boolean;
  phase: DictationPhase;
  /** The meter's recent levels, 0 to 1, newest last. */
  levels: number[];
  /** Milliseconds since the microphone opened. */
  elapsedMs: number;
  problem: string | null;
  start: () => Promise<void>;
  stop: () => void;
}

export function useDictation(value: string, onChange: (next: string) => void): Dictation {
  const owner = useRef(Symbol('dictation'));
  const [phase, setPhase] = useState<DictationPhase>('idle');
  const [levels, setLevels] = useState<number[]>([]);
  const [elapsedMs, setElapsedMs] = useState(0);
  const clock = useRef<ReturnType<typeof setInterval> | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  // What the field held when the microphone opened, and what has been said.
  const base = useRef('');
  const text = useRef(EMPTY_DICTATION);
  const stopOwnMeter = useRef<(() => void) | null>(null);

  // Events outlive renders; they must always write through the latest setter.
  const onChangeRef = useRef(onChange);
  const valueRef = useRef(value);
  useEffect(() => {
    onChangeRef.current = onChange;
    valueRef.current = value;
  });

  const mine = () => activeOwner === owner.current;

  const finish = useCallback(() => {
    if (activeOwner === owner.current) activeOwner = null;
    stopOwnMeter.current?.();
    stopOwnMeter.current = null;
    if (clock.current) clearInterval(clock.current);
    clock.current = null;
    setPhase('idle');
    setLevels([]);
    setElapsedMs(0);
  }, []);

  useSpeechEvent('start', () => {
    if (mine()) setPhase('listening');
  });

  useSpeechEvent('result', (event) => {
    if (!mine()) return;
    const transcript = event.results[0]?.transcript ?? '';
    text.current = applyResult(text.current, transcript, event.isFinal);
    onChangeRef.current(joinSpoken(base.current, spokenSoFar(text.current)));
  });

  useSpeechEvent('volumechange', (event) => {
    if (mine()) setLevels((history) => pushLevel(history, levelFromVolume(event.value), METER_BARS));
  });

  useSpeechEvent('error', (event) => {
    if (!mine()) return;
    if (!QUIET_ERRORS.has(event.error)) setProblem(describe(event.error, event.message));
    finish();
  });

  useSpeechEvent('end', () => {
    if (mine()) finish();
  });

  // Leaving the screen closes the microphone.
  useEffect(
    () => () => {
      if (activeOwner === owner.current) {
        speech?.abort();
        activeOwner = null;
      }
      stopOwnMeter.current?.();
      if (clock.current) clearInterval(clock.current);
    },
    [],
  );

  const start = useCallback(async () => {
    if (!speech) return;
    setProblem(null);

    // Another field was listening: close it before this one opens.
    if (activeOwner && activeOwner !== owner.current) speech.abort();
    activeOwner = owner.current;
    setPhase('starting');

    const permission = await speech.requestPermissionsAsync();
    if (!permission.granted) {
      setProblem(describe('not-allowed', ''));
      finish();
      return;
    }
    if (!mine()) return; // handed to another field while asking

    base.current = valueRef.current;
    text.current = EMPTY_DICTATION;
    setLevels([]);
    const openedAt = Date.now();
    setElapsedMs(0);
    if (clock.current) clearInterval(clock.current);
    clock.current = setInterval(() => setElapsedMs(Date.now() - openedAt), 250);

    speech.start({
      lang: 'en-US',
      interimResults: true,
      continuous: true,
      addsPunctuation: true,
      volumeChangeEventOptions: { enabled: true, intervalMillis: 80 },
    });

    if (needsOwnMeter) {
      try {
        stopOwnMeter.current = await startMeter((level) => {
          if (activeOwner === owner.current) {
            setLevels((history) => pushLevel(history, level, METER_BARS));
          }
        });
      } catch {
        // The words still come through; only the meter is missing.
      }
    }
  }, [finish]);

  const stop = useCallback(() => {
    if (mine()) speech?.stop();
  }, []);

  return {
    available: recogniserAvailable(),
    phase,
    levels,
    elapsedMs,
    problem,
    start,
    stop,
  };
}
