/**
 * The photos on a job, by room.
 *
 * Capture is built to never stop and look, so this is where a contractor
 * checks what they shot: the grid for a room, one tap for the full frame, and
 * the two edits that matter in the truck — which room it belongs to, and a
 * caption for the report.
 */

import { Image } from 'expo-image';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button, Card, Chip, Label, Screen, TextField, TypeText } from '@/components/ui';
import { openLocalDatabase } from '@/db/client';
import { labelPhoto, listPhotos, type PhotoRecord } from '@/db/photos';
import { listRooms, type RoomRecord } from '@/db/rooms';
import { isLabelled } from '@/features/photos/labels';
import { DescriptionField } from '@/features/dictation/DescriptionField';
import { usePhotoUri } from '@/features/photos/source';
import { goBack } from '@/lib/navigation';
import { radius, space } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';

export default function JobPhotosScreen() {
  const { id: jobId, roomId } = useLocalSearchParams<{ id: string; roomId?: string }>();
  const [photos, setPhotos] = useState<PhotoRecord[]>([]);
  const [rooms, setRooms] = useState<RoomRecord[]>([]);
  const [filter, setFilter] = useState<string | null>(roomId ?? null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [caption, setCaption] = useState('');
  const [roomDraft, setRoomDraft] = useState<string | null>(null);

  const load = useCallback(async () => {
    const db = await openLocalDatabase();
    const [loadedPhotos, loadedRooms] = await Promise.all([
      listPhotos(db, jobId),
      listRooms(db, jobId),
    ]);
    setPhotos(loadedPhotos);
    setRooms(loadedRooms);
  }, [jobId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const shown = useMemo(
    () => (filter === null ? photos : photos.filter((p) => p.roomId === filter)),
    [filter, photos],
  );
  const open = photos.find((p) => p.id === openId) ?? null;

  const openPhoto = (photo: PhotoRecord) => {
    setOpenId(photo.id);
    setTitle(photo.title ?? '');
    setCaption(photo.caption ?? '');
    setRoomDraft(photo.roomId);
  };

  const save = useCallback(async () => {
    if (!open) return;
    const db = await openLocalDatabase();
    await labelPhoto(db, open.id, {
      roomId: roomDraft,
      title: title.trim() || null,
      caption: caption.trim() || null,
    });
    await load();
  }, [caption, load, open, roomDraft, title]);

  // ---- One photo ------------------------------------------------------------

  if (open) {
    const changed =
      title.trim() !== (open.title ?? '') ||
      caption.trim() !== (open.caption ?? '') ||
      roomDraft !== open.roomId;
    return (
      <Screen
        footer={
          <>
            {changed ? <Button label="Save" onPress={() => void save()} /> : null}
            <Button label="Back to photos" variant="ghost" onPress={() => setOpenId(null)} />
          </>
        }
      >
        <FullPhoto photo={open} />
        <TypeText role="caption" tone="textFaint">
          {open.takenAt ? new Date(open.takenAt).toLocaleString() : ''}
          {open.gpsLat !== null && open.gpsLng !== null
            ? ` · ${open.gpsLat.toFixed(4)}, ${open.gpsLng.toFixed(4)}`
            : ''}
        </TypeText>

        <TextField label="Name" value={title} onChangeText={setTitle} placeholder="Kitchen - Water line" />
        <DescriptionField
          value={caption}
          onChangeText={setCaption}
          placeholder="What an adjuster should see in this photo"
        />

        {rooms.length > 0 ? (
          <View style={styles.section}>
            <Label>Room</Label>
            <View style={styles.chipRow}>
              <Chip label="No room" selected={roomDraft === null} onPress={() => setRoomDraft(null)} />
              {rooms.map((room) => (
                <Chip
                  key={room.id}
                  label={room.name}
                  selected={room.id === roomDraft}
                  onPress={() => setRoomDraft(room.id)}
                />
              ))}
            </View>
          </View>
        ) : null}
      </Screen>
    );
  }

  // ---- The grid -------------------------------------------------------------

  return (
    <Screen footer={<Button label="Done" variant="ghost" onPress={() => goBack()} />}>
      <View style={styles.header}>
        <TypeText role="title">Photos</TypeText>
        <TypeText role="caption" tone="textFaint">
          {shown.length} of {photos.length} on this job
        </TypeText>
      </View>

      <View style={styles.chipRow}>
        <Chip label="All" selected={filter === null} onPress={() => setFilter(null)} />
        {rooms.map((room) => (
          <Chip
            key={room.id}
            label={room.name}
            selected={filter === room.id}
            onPress={() => setFilter(room.id)}
          />
        ))}
      </View>

      {shown.length === 0 ? (
        <Card>
          <TypeText role="body" tone="textMuted">
            No photos here yet. Open the camera from the job and pick this room
            at the top before you shoot.
          </TypeText>
        </Card>
      ) : (
        <View style={styles.grid}>
          {shown.map((photo) => (
            <Pressable
              key={photo.id}
              accessibilityRole="button"
              accessibilityLabel={photo.caption ?? 'Photo'}
              onPress={() => openPhoto(photo)}
              style={({ pressed }) => [styles.cell, { opacity: pressed ? 0.8 : 1 }]}
            >
              <Thumb photo={photo} />
              <TypeText role="caption" tone={isLabelled(photo) ? 'textMuted' : 'warn'} numberOfLines={1}>
                {photo.title ?? 'No name'}
              </TypeText>
            </Pressable>
          ))}
        </View>
      )}
    </Screen>
  );
}

function Thumb({ photo }: { photo: PhotoRecord }) {
  const c = useTheme();
  const uri = usePhotoUri(photo, 'thumb');
  return (
    <Image
      source={uri ? { uri } : undefined}
      style={[styles.thumb, { backgroundColor: c.surfaceAlt, borderColor: c.border }]}
      contentFit="cover"
      transition={100}
    />
  );
}

function FullPhoto({ photo }: { photo: PhotoRecord }) {
  const c = useTheme();
  const uri = usePhotoUri(photo, 'original');
  return (
    <Image
      source={uri ? { uri } : undefined}
      style={[styles.full, { backgroundColor: c.surfaceAlt, borderColor: c.border }]}
      contentFit="contain"
      transition={100}
    />
  );
}

const styles = StyleSheet.create({
  header: { gap: space.xs },
  section: { gap: space.sm },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  cell: { width: '31.5%', gap: 2 },
  thumb: { width: '100%', aspectRatio: 1, borderRadius: radius.sm, borderWidth: 1 },
  full: { width: '100%', aspectRatio: 3 / 4, maxHeight: 460, borderRadius: radius.md, borderWidth: 1 },
});
