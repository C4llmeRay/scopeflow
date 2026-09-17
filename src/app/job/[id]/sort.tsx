/**
 * Sorting untagged photos into rooms.
 *
 * Capture mode is deliberately fast and deliberately lossy about rooms — a
 * contractor shoots fifteen frames without leaving the viewfinder, and the
 * room chip is whatever it happened to be. That trade is only honest if
 * tagging afterwards is quick, which is this screen.
 *
 * One photo at a time, big, with the rooms as thumb-sized targets underneath.
 * Tap a room and it assigns and advances in the same gesture. No grid, no
 * multi-select, no drag: this gets used in a truck with one hand, and every
 * extra decision per photo is multiplied by forty.
 */

import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Button, Card, Chip, Label, Screen, TypeText } from '@/components/ui';
import { openLocalDatabase } from '@/db/client';
import { assignPhotoToRoom, listPhotos, type PhotoRecord } from '@/db/photos';
import { listRooms, type RoomRecord } from '@/db/rooms';
import {
  indexAfterAssign,
  indexAfterSkip,
  sortProgress,
  sortQueue,
  suggestRoomId,
} from '@/features/photos/sort';
import { radius, space } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';

export default function SortPhotosScreen() {
  const { id: jobId } = useLocalSearchParams<{ id: string }>();
  const [queue, setQueue] = useState<PhotoRecord[]>([]);
  const [rooms, setRooms] = useState<RoomRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [index, setIndex] = useState(0);
  const [lastRoomId, setLastRoomId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const c = useTheme();

  const load = useCallback(async () => {
    const db = await openLocalDatabase();
    const [photos, loadedRooms] = await Promise.all([listPhotos(db, jobId), listRooms(db, jobId)]);
    setTotal(photos.length);
    setQueue(sortQueue(photos));
    setRooms(loadedRooms);
    setIndex(0);
    setLoaded(true);
  }, [jobId]);

  useEffect(() => {
    void load();
  }, [load]);

  const current = queue[index];

  const assign = useCallback(
    async (roomId: string) => {
      if (!current) return;

      const db = await openLocalDatabase();
      await assignPhotoToRoom(db, current.id, roomId);

      // The local list is updated rather than re-read. Re-reading would reset
      // the position and, on a job with two hundred photos, stutter on every
      // tap — the two things that would make this slower than doing it by hand.
      const remaining = queue.filter((photo) => photo.id !== current.id);
      setIndex(indexAfterAssign(index, queue.length));
      setQueue(remaining);
      setLastRoomId(roomId);
    },
    [current, index, queue],
  );

  const skip = useCallback(() => {
    setIndex(indexAfterSkip(index, queue.length));
  }, [index, queue.length]);

  const progress = sortProgress(total, queue.length);
  const suggested = suggestRoomId(lastRoomId, rooms.map((room) => room.id));

  if (!loaded) return null;

  // ---- Nothing to do ------------------------------------------------------

  if (rooms.length === 0) {
    return (
      <Screen
        footer={
          <>
            <Button
              label="Add a room"
              onPress={() => router.push(`/job/${jobId}/room-wizard`)}
            />
            <Button label="Back" variant="ghost" onPress={() => router.back()} />
          </>
        }
      >
        <TypeText role="title">Sort photos</TypeText>
        <Card>
          <TypeText role="body" tone="textMuted">
            There are no rooms on this job yet, so there is nowhere to file these
            photos. Measure a room first — the photos will still be here.
          </TypeText>
        </Card>
      </Screen>
    );
  }

  if (!current) {
    return (
      <Screen footer={<Button label="Done" onPress={() => router.back()} />}>
        <TypeText role="title">Sort photos</TypeText>
        <Card>
          <TypeText role="body" tone="success">
            {total === 0
              ? 'No photos on this job yet.'
              : `Every photo on this job is filed under a room. ${progress.label}.`}
          </TypeText>
        </Card>
      </Screen>
    );
  }

  // ---- The queue ----------------------------------------------------------

  return (
    <Screen
      footer={
        <>
          <Button label="Skip for now" variant="secondary" onPress={skip} />
          <Button label="Done" variant="ghost" onPress={() => router.back()} />
        </>
      }
    >
      <View style={styles.header}>
        <TypeText role="title">Sort photos</TypeText>
        <TypeText role="caption" tone="textFaint">
          {progress.label} · {queue.length} left
        </TypeText>
      </View>

      {/* The thumbnail, not the original: the original is a full-resolution
          JPEG and decoding one per tap would make this crawl. */}
      <Image
        source={{ uri: current.localThumbUri ?? current.localUri ?? undefined }}
        style={[styles.photo, { backgroundColor: c.surfaceAlt, borderColor: c.border }]}
        contentFit="contain"
        transition={100}
      />

      {current.caption ? (
        <TypeText role="caption" tone="textMuted">
          {current.caption}
        </TypeText>
      ) : null}

      <View style={styles.section}>
        <Label>Which room?</Label>
        <ScrollView
          horizontal={false}
          contentContainerStyle={styles.chipRow}
          showsVerticalScrollIndicator={false}
        >
          {rooms.map((room) => (
            <Chip
              key={room.id}
              label={room.name}
              // The previous room first, because consecutive photos are nearly
              // always the same room.
              selected={room.id === suggested}
              onPress={() => void assign(room.id)}
            />
          ))}
        </ScrollView>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: space.xs },
  section: { gap: space.sm },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  photo: {
    width: '100%',
    aspectRatio: 3 / 4,
    maxHeight: 420,
    borderRadius: radius.md,
    borderWidth: 1,
  },
});
