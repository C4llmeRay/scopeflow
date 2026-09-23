/**
 * Voice notes.
 *
 * Talking is several times faster than typing with gloves on, and it is how the
 * trade already communicates — so this screen is one big button.
 *
 * Transcription happens ON THE DEVICE, as the contractor speaks. That was a
 * deliberate choice over sending the audio somewhere to be transcribed: the
 * words appear immediately with no signal, cost nothing per minute, and — most
 * importantly — the contractor can read and fix them before they become damage
 * records. A misheard "four feet" that becomes a flood cut height is a wrong
 * estimate, and the cheapest place to catch it is on the screen it was spoken
 * into.
 *
 * The audio is kept alongside the transcript. A recording is evidence; a
 * transcript is a convenience.
 */

import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Button, Card, Chip, Label, Screen, SyncChip, TypeText } from '@/components/ui';
import { openLocalDatabase } from '@/db/client';
import { listRooms, type RoomRecord } from '@/db/rooms';
import {
  listVoiceNotes,
  saveVoiceNote,
  setTranscript,
  softDeleteVoiceNote,
  type VoiceNoteRecord,
} from '@/db/voice-notes';
import { queueVoiceExtraction } from '@/features/ai/queue';
import { currentCompanyId } from '@/features/jobs/useCompany';
import { formatClockTime, formatDuration } from '@/features/notes/duration';
import { speech, useSpeechEvent } from '@/features/notes/speech';
import { useSync } from '@/hooks/use-sync';
import { newId } from '@/lib/id';
import { MIN_TARGET, radius, space, type } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';

export default function VoiceNotesScreen() {
  const { id: jobId } = useLocalSearchParams<{ id: string }>();
  const [notes, setNotes] = useState<VoiceNoteRecord[]>([]);
  const [rooms, setRooms] = useState<RoomRecord[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [permission, setPermission] = useState<boolean | null>(null);
  const [recording, setRecording] = useState(false);
  const [live, setLive] = useState('');
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  // Captured from the recogniser's own events, so the saved note carries what
  // was actually heard rather than what the UI happened to be showing.
  const finalText = useRef('');
  const audioUri = useRef<string | null>(null);
  const startedAt = useRef(0);

  const sync = useSync();
  const c = useTheme();

  const refresh = useCallback(async () => {
    const db = await openLocalDatabase();
    const [loadedNotes, loadedRooms] = await Promise.all([
      listVoiceNotes(db, jobId),
      listRooms(db, jobId),
    ]);
    setNotes(loadedNotes);
    setRooms(loadedRooms);
  }, [jobId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!speech) return;
    void (async () => {
      const granted = await speech.requestPermissionsAsync();
      setPermission(granted.granted);
    })();
  }, []);

  useSpeechEvent('result', (event) => {
    const text = event.results[0]?.transcript ?? '';
    setLive(text);
    // Only a final result is worth keeping; interim ones churn word by word.
    if (event.isFinal && text.trim()) finalText.current = text;
  });

  useSpeechEvent('audioend', (event) => {
    audioUri.current = event.uri ?? null;
  });

  useSpeechEvent('error', (event) => {
    setRecording(false);
    // "no-speech" is somebody tapping the button and thinking better of it.
    if (event.error !== 'no-speech' && event.error !== 'aborted') {
      setProblem(`The recogniser stopped: ${event.error}`);
    }
  });

  const save = useCallback(async () => {
    const transcript = (finalText.current || live).trim();
    const uri = audioUri.current;
    if (!transcript && !uri) return;

    const db = await openLocalDatabase();
    const id = newId();

    await saveVoiceNote(db, {
      id,
      companyId: currentCompanyId(),
      jobId,
      roomId: activeRoomId,
      // The recogniser persists the audio; without it there is nothing to keep.
      localUri: uri ?? '',
      durationMs: Date.now() - startedAt.current,
    });

    if (transcript) {
      await setTranscript(db, id, transcript);
      // Queued, not awaited. Extraction runs after the rows have synced.
      if (db.ai) await queueVoiceExtraction(db.ai, { voiceNoteId: id, jobId });
    }

    finalText.current = '';
    audioUri.current = null;
    setLive('');
    await refresh();
    sync.syncNow();
  }, [activeRoomId, jobId, live, refresh, sync]);

  useSpeechEvent('end', () => {
    setRecording(false);
    void save();
  });

  const start = useCallback(() => {
    setProblem(null);
    finalText.current = '';
    audioUri.current = null;
    startedAt.current = Date.now();
    setLive('');
    setRecording(true);

    speech?.start({
      lang: 'en-US',
      // Partial results are what make the words appear as they are spoken.
      interimResults: true,
      continuous: true,
      // Keep the audio: a recording is evidence, a transcript is a convenience.
      recordingOptions: { persist: true },
    });
  }, []);

  const stop = useCallback(() => {
    speech?.stop();
  }, []);

  const saveEdit = useCallback(async () => {
    if (!editing) return;
    const db = await openLocalDatabase();
    await setTranscript(db, editing.id, editing.text.trim());
    // A corrected transcript is worth re-reading: the first pass may have acted
    // on a misheard word.
    if (db.ai && editing.text.trim()) {
      await queueVoiceExtraction(db.ai, { voiceNoteId: editing.id, jobId });
    }
    setEditing(null);
    await refresh();
    sync.syncNow();
  }, [editing, jobId, refresh, sync]);

  /** Without a recogniser, a note is typed rather than spoken. */
  const typeNote = useCallback(async () => {
    const db = await openLocalDatabase();
    const id = newId();
    await saveVoiceNote(db, {
      id,
      companyId: currentCompanyId(),
      jobId,
      roomId: activeRoomId,
      localUri: '',
      durationMs: null,
    });
    await refresh();
    setEditing({ id, text: '' });
  }, [activeRoomId, jobId, refresh]);

  const remove = useCallback(
    async (id: string) => {
      const db = await openLocalDatabase();
      await softDeleteVoiceNote(db, id);
      await refresh();
    },
    [refresh],
  );

  if (permission === false) {
    return (
      <Screen
        footer={
          <Button
            label="Allow microphone"
            onPress={() =>
              void speech?.requestPermissionsAsync().then((r) => setPermission(r.granted))
            }
          />
        }
      >
        <TypeText role="title">Microphone access</TypeText>
        <TypeText role="body" tone="textMuted">
          ScopeFlow listens while you describe damage, so you do not have to type
          it later. The words are worked out on this phone — nothing is sent
          anywhere to be transcribed.
        </TypeText>
      </Screen>
    );
  }

  return (
    <Screen
      footer={
        !speech ? (
          <Button label="Type a note" onPress={() => void typeNote()} />
        ) : (
        <View style={styles.recordRow}>
          <View style={styles.recordInfo}>
            <TypeText role="bodyStrong">
              {recording ? 'Listening' : 'Describe what you see'}
            </TypeText>
            <TypeText role="caption" tone="textFaint">
              {recording
                ? 'Tap to stop'
                : activeRoomId
                  ? (rooms.find((r) => r.id === activeRoomId)?.name ?? 'Whole job')
                  : 'Whole job'}
            </TypeText>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={recording ? 'Stop recording' : 'Start recording'}
            onPress={() => (recording ? stop() : start())}
            disabled={permission === null}
            style={({ pressed }) => [
              styles.recordButton,
              { borderColor: recording ? c.danger : c.accent, opacity: pressed ? 0.8 : 1 },
            ]}
          >
            <View
              style={[
                recording ? styles.recordInnerStop : styles.recordInner,
                { backgroundColor: recording ? c.danger : c.accent },
              ]}
            />
          </Pressable>
        </View>
        )
      }
    >
      <SyncChip
        pending={sync.pending}
        uploading={sync.uploading}
        thinking={sync.thinking}
        failed={sync.failed}
        online={sync.online}
      />

      <View style={styles.header}>
        <TypeText role="title">Voice notes</TypeText>
        <TypeText role="caption" tone="textFaint">
          {notes.length} on this job
        </TypeText>
      </View>

      {!speech ? (
        <Card>
          <TypeText role="caption" tone="textMuted">
            Speaking a note needs the ScopeFlow app build — this one (Expo Go, or
            a browser) has no on-device recogniser. Typed notes work the same way.
          </TypeText>
        </Card>
      ) : null}

      {problem ? (
        <Card>
          <TypeText role="caption" tone="danger">
            {problem}
          </TypeText>
        </Card>
      ) : null}

      {/* The words as they are spoken, so a mishearing is obvious immediately. */}
      {recording ? (
        <Card>
          <Label>Hearing</Label>
          <TypeText role="body">{live || '…'}</TypeText>
        </Card>
      ) : null}

      {rooms.length > 0 ? (
        <View style={styles.section}>
          <Label>Tag to</Label>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
          >
            <Chip
              label="Whole job"
              selected={activeRoomId === null}
              onPress={() => setActiveRoomId(null)}
            />
            {rooms.map((room) => (
              <Chip
                key={room.id}
                label={room.name}
                selected={room.id === activeRoomId}
                onPress={() => setActiveRoomId(room.id)}
              />
            ))}
          </ScrollView>
        </View>
      ) : null}

      {notes.length === 0 ? (
        <Card>
          <TypeText role="body" tone="textMuted">
            Nothing recorded yet. Describe the damage out loud as you walk — the
            words appear as you say them, and what you name gets turned into
            damage records for you to check.
          </TypeText>
        </Card>
      ) : (
        <View style={styles.list}>
          {notes.map((note) => {
            const room = rooms.find((r) => r.id === note.roomId);
            const isEditing = editing?.id === note.id;

            return (
              <Card key={note.id}>
                <View style={styles.noteHeader}>
                  <View style={styles.noteMeta}>
                    <TypeText role="bodyStrong">{formatDuration(note.durationMs)}</TypeText>
                    <TypeText role="caption" tone="textFaint">
                      {formatClockTime(note.createdAt)} &middot; {room?.name ?? 'Whole job'}
                    </TypeText>
                  </View>
                  {!isEditing ? (
                    <Button label="Delete" variant="ghost" onPress={() => void remove(note.id)} />
                  ) : null}
                </View>

                {isEditing ? (
                  <>
                    <TextInput
                      value={editing.text}
                      onChangeText={(text) => setEditing({ id: note.id, text })}
                      multiline
                      textAlignVertical="top"
                      autoFocus
                      style={[
                        type.body as never,
                        styles.editor,
                        { backgroundColor: c.surfaceAlt, borderColor: c.border, color: c.text },
                      ]}
                    />
                    <Button label="Save and re-read" onPress={() => void saveEdit()} />
                    <Button label="Cancel" variant="ghost" onPress={() => setEditing(null)} />
                  </>
                ) : note.transcript ? (
                  <>
                    <TypeText role="body">{note.transcript}</TypeText>
                    <Button
                      label="Fix the wording"
                      variant="ghost"
                      onPress={() => setEditing({ id: note.id, text: note.transcript ?? '' })}
                    />
                  </>
                ) : (
                  <TypeText role="caption" tone="textFaint">
                    Nothing was heard on this one. The audio is still saved.
                  </TypeText>
                )}
              </Card>
            );
          })}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: space.xs },
  section: { gap: space.sm },
  chipRow: { flexDirection: 'row', gap: space.sm, paddingRight: space.lg },
  list: { gap: space.md },
  noteHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  noteMeta: { gap: 2 },
  editor: {
    minHeight: 110,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: space.md,
  },
  recordRow: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  recordInfo: { flex: 1, gap: 2 },
  recordButton: {
    width: MIN_TARGET + 28,
    height: MIN_TARGET + 28,
    borderRadius: radius.pill,
    borderWidth: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordInner: { width: MIN_TARGET + 6, height: MIN_TARGET + 6, borderRadius: radius.pill },
  recordInnerStop: { width: 28, height: 28, borderRadius: radius.sm },
});
