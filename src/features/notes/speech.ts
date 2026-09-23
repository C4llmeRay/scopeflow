/**
 * On-device speech recognition, when this build has it.
 *
 * expo-speech-recognition is a native module that is not part of Expo Go, and
 * it throws the moment it is imported where its native half is missing. Because
 * expo-router loads every route up front, an unguarded import on the notes
 * screen takes the whole app down in Expo Go — not just voice notes. Guarding
 * it here means the rest of ScopeFlow runs anywhere, and the notes screen can
 * fall back to typing.
 */

import type * as SpeechRecognition from 'expo-speech-recognition';

type Module = typeof SpeechRecognition;

let loaded: Module | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  loaded = require('expo-speech-recognition') as Module;
} catch {
  loaded = null;
}

/** Null in Expo Go, or anywhere else the native module is missing. */
export const speech: Module['ExpoSpeechRecognitionModule'] | null =
  loaded?.ExpoSpeechRecognitionModule ?? null;

/**
 * The event hook, or a no-op when there is no recogniser. Availability is fixed
 * for the life of the process, so the hook order never changes between renders.
 */
export const useSpeechEvent: Module['useSpeechRecognitionEvent'] =
  loaded?.useSpeechRecognitionEvent ?? (() => {});
