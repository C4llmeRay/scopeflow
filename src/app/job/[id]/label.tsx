/**
 * Naming and describing photos, one at a time.
 *
 * This screen is what replaces an evening of typing into Xactimate. Each photo
 * arrives already named from the camera's chips; what is left is the
 * description, and for that the keyboard's own microphone is the fastest input
 * there is. Starters for the kind of photo turn most descriptions into a tap
 * and a number.
 *
 * Photos come in the order they will have in Xactimate, so labelling and the
 * export agree about which one is "photo 12".
 */

import { Image } from 'expo-image';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Button, Card, Chip, Label, Screen, TextField, TypeText } from '@/components/ui';
import { openLocalDatabase } from '@/db/client';
import { labelPhoto, listPhotos, type PhotoLabel, type PhotoRecord } from '@/db/photos';
import { listRooms, type RoomRecord } from '@/db/rooms';
import {
  appendStarter,
  buildExportManifest,
  composeTitle,
  isLabelled,
  PHOTO_SUBJECTS,
} from '@/features/photos/labels';
import { DescriptionField } from '@/features/dictation/DescriptionField';
import { usePhotoUri } from '@/features/photos/source';
import { goBack } from '@/lib/navigation';
import { radius, space } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';

/** Recovers which quick-pick a title was built from, so changing the room keeps it. */
function subjectOf(title: string | null, roomName: string | null): string | null {
  if (!title) return null;
  const rest = roomName && title.startsWith(`${roomName} - `) ? title.slice(roomName.length + 3) : title;
  return PHOTO_SUBJECTS.some((s) => s.label === rest) ? rest : null;
}

export default function LabelPhotosScreen() {
  const { id: jobId, all } = useLocalSearchParams<{ id: string; all?: string }>();
  const [rooms, setRooms] = useState<RoomRecord[]>([]);
  const [queue, setQueue] = useState<PhotoRecord[]>([]);
  const [index, setIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [everything, setEverything] = useState(all === '1');

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void (async () => {
        const db = await openLocalDatabase();
        const [photos, loadedRooms] = await Promise.all([listPhotos(db, jobId), listRooms(db, jobId)]);
        const order = buildExportManifest(
          loadedRooms.map((r) => ({ id: r.id, name: r.name, sortOrder: r.sortOrder })),
          photos,
        ).map((e) => e.photoId);
        const byId = new Map(photos.map((p) => [p.id, p]));
        const ordered = order.map((id) => byId.get(id)!).filter(Boolean);
        if (!active) return;
        setRooms(loadedRooms);
        setQueue(everything ? ordered : ordered.filter((p) => !isLabelled(p)));
        setIndex(0);
        setLoaded(true);
      })();
      return () => {
        active = false;
      };
    }, [everything, jobId]),
  );

  const current = queue[index] ?? null;

  const advance = useCallback(() => setIndex((i) => Math.min(i + 1, queue.length)), [queue.length]);

  const save = useCallback(
    async (photo: PhotoRecord, label: PhotoLabel) => {
      const db = await openLocalDatabase();
      await labelPhoto(db, photo.id, label);
      // Updated in place rather than re-read, so the position holds.
      setQueue((q) => q.map((p) => (p.id === photo.id ? { ...p, ...label } : p)));
      advance();
    },
    [advance],
  );

  if (!loaded) return null;

  if (!current) {
    const labelledNow = queue.filter(isLabelled).length;
    return (
      <Screen
        footer={
          <>
            <Button label="Export for Xactimate" onPress={() => router.replace(`/job/${jobId}/export`)} />
            <Button label="Back to the job" variant="ghost" onPress={() => goBack(`/job/${jobId}`)} />
          </>
        }
      >
        <TypeText role="title">Label photos</TypeText>
        <Card>
          <TypeText role="body" tone="success">
            {queue.length === 0
              ? 'Every photo on this job already has a name and a description.'
              : `Done — ${labelledNow} of ${queue.length} photos now have a name and a description.`}
          </TypeText>
          <Button label="Review all photos" variant="secondary" onPress={() => setEverything(true)} />
        </Card>
      </Screen>
    );
  }

  return (
    <LabelForm
      // A fresh draft for every photo, straight from its saved values.
      key={current.id}
      photo={current}
      rooms={rooms}
      position={`Photo ${index + 1} of ${queue.length}${everything ? '' : ' still to label'}`}
      isLast={index + 1 >= queue.length}
      onSave={(label) => save(current, label)}
      onSkip={advance}
      onDone={() => goBack(`/job/${jobId}`)}
    />
  );
}

function LabelForm({
  photo,
  rooms,
  position,
  isLast,
  onSave,
  onSkip,
  onDone,
}: {
  photo: PhotoRecord;
  rooms: RoomRecord[];
  position: string;
  isLast: boolean;
  onSave: (label: PhotoLabel) => Promise<void>;
  onSkip: () => void;
  onDone: () => void;
}) {
  const roomName = useCallback((id: string | null) => rooms.find((r) => r.id === id)?.name ?? null, [rooms]);

  const [roomId, setRoomId] = useState<string | null>(photo.roomId);
  const [title, setTitle] = useState(photo.title ?? composeTitle(roomName(photo.roomId), null) ?? '');
  const [description, setDescription] = useState(photo.caption ?? '');
  const [saving, setSaving] = useState(false);

  const subject = useMemo(() => subjectOf(title, roomName(roomId)), [roomId, roomName, title]);
  const starters =
    PHOTO_SUBJECTS.find((s) => s.label === subject)?.starters ??
    PHOTO_SUBJECTS.find((s) => s.label === 'Overview')!.starters;

  const chooseRoom = (next: string | null) => {
    // Keep what the photo shows; only the room half of the name changes.
    const keep = subjectOf(title, roomName(roomId));
    setRoomId(next);
    if (keep || !title.trim() || title === roomName(roomId)) {
      setTitle(composeTitle(roomName(next), keep) ?? '');
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      await onSave({ roomId, title: title.trim() || null, caption: description.trim() || null });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen
      footer={
        <>
          <Button
            label={saving ? 'Saving…' : isLast ? 'Save' : 'Save and next'}
            onPress={() => void save()}
            disabled={saving}
          />
          <View style={styles.row}>
            <View style={styles.flex}>
              <Button label="Skip" variant="ghost" onPress={onSkip} />
            </View>
            <View style={styles.flex}>
              <Button label="Done" variant="ghost" onPress={onDone} />
            </View>
          </View>
        </>
      }
    >
      <TypeText role="caption" tone="textFaint">
        {position}
      </TypeText>

      <Photo photo={photo} />

      <View style={styles.section}>
        <Label>Room</Label>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          <Chip label="No room" selected={roomId === null} onPress={() => chooseRoom(null)} />
          {rooms.map((room) => (
            <Chip key={room.id} label={room.name} selected={room.id === roomId} onPress={() => chooseRoom(room.id)} />
          ))}
        </ScrollView>
      </View>

      <View style={styles.section}>
        <Label>Shows</Label>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {PHOTO_SUBJECTS.map(({ label }) => (
            <Chip
              key={label}
              label={label}
              selected={subject === label}
              onPress={() => setTitle(composeTitle(roomName(roomId), label) ?? label)}
            />
          ))}
        </ScrollView>
      </View>

      <TextField label="Name" value={title} onChangeText={setTitle} placeholder="Kitchen - Water line" />

      <DescriptionField
        value={description}
        onChangeText={setDescription}
        placeholder="What an adjuster should see in this photo"
      />
      <View style={styles.chips}>
        {starters.map((starter) => (
          <Chip key={starter} label={starter} onPress={() => setDescription((d) => appendStarter(d, starter))} />
        ))}
      </View>
    </Screen>
  );
}

function Photo({ photo }: { photo: PhotoRecord }) {
  const c = useTheme();
  const uri = usePhotoUri(photo, 'thumb');
  return (
    <Image
      source={uri ? { uri } : undefined}
      style={[styles.photo, { backgroundColor: c.surfaceAlt, borderColor: c.border }]}
      contentFit="contain"
      transition={100}
    />
  );
}

const styles = StyleSheet.create({
  section: { gap: space.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chipRow: { flexDirection: 'row', gap: space.sm, paddingRight: space.lg },
  row: { flexDirection: 'row', gap: space.sm },
  flex: { flex: 1 },
  photo: { width: '100%', aspectRatio: 4 / 3, maxHeight: 320, borderRadius: radius.md, borderWidth: 1 },
});
