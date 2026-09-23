/**
 * Capture mode.
 *
 * Per the plan: the camera is a MODE, not a screen. It stays open, a room chip
 * is pinned at the top showing where photos are landing, and a contractor can
 * shoot fifteen frames without ever leaving the viewfinder. Tagging and
 * captioning happen later, in the truck.
 *
 * Nothing here awaits the network. Each shutter press writes the original to
 * device storage, generates a compressed derivative, records the row, and
 * queues both binaries — then returns, so the next frame is immediate.
 */

import { CameraView, useCameraPermissions } from 'expo-camera';
import { Image } from 'expo-image';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Location from 'expo-location';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Button, Chip, Screen, TypeText } from '@/components/ui';
import { goBack } from '@/lib/navigation';
import { openLocalDatabase } from '@/db/client';
import { capturePhoto, listPhotos } from '@/db/photos';
import { listRooms, type RoomRecord } from '@/db/rooms';
import { currentCompanyId } from '@/features/jobs/useCompany';
import { persistPhoto } from '@/features/photos/storage';
import { newId } from '@/lib/id';
import { MIN_TARGET, radius, space } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';

/** Wide enough to read on screen, small enough to upload on one bar. */
const THUMB_WIDTH = 1280;
const THUMB_QUALITY = 0.6;

export default function CaptureScreen() {
  const { id: jobId } = useLocalSearchParams<{ id: string }>();
  const [permission, requestPermission] = useCameraPermissions();
  const [rooms, setRooms] = useState<RoomRecord[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [shotCount, setShotCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [lastShot, setLastShot] = useState<string | null>(null);
  const cameraRef = useRef<CameraView>(null);
  const coords = useRef<{ lat: number; lng: number } | null>(null);
  const c = useTheme();

  useEffect(() => {
    void (async () => {
      const db = await openLocalDatabase();
      const [loaded, existing] = await Promise.all([
        listRooms(db, jobId),
        listPhotos(db, jobId),
      ]);
      setRooms(loaded);
      setShotCount(existing.length);
      setActiveRoomId((current) => current ?? loaded[0]?.id ?? null);
    })();
  }, [jobId]);

  // One location read for the whole session. A photo is evidence, and where it
  // was taken is part of that, but a GPS fix per frame would drain the battery
  // and stall the shutter.
  useEffect(() => {
    void (async () => {
      const granted = await Location.requestForegroundPermissionsAsync();
      if (!granted.granted) return;
      const position = await Location.getLastKnownPositionAsync();
      if (position) {
        coords.current = { lat: position.coords.latitude, lng: position.coords.longitude };
      }
    })();
  }, []);

  const shoot = useCallback(async () => {
    if (!cameraRef.current || busy) return;
    setBusy(true);
    try {
      // The original is never re-encoded: EXIF, GPS and the capture timestamp
      // stay on it, because that metadata is the contractor's defence in a
      // disputed claim eighteen months from now.
      const original = await cameraRef.current.takePictureAsync({ exif: true, quality: 1 });
      if (!original) return;

      const derivative = await ImageManipulator.manipulateAsync(
        original.uri,
        [{ resize: { width: THUMB_WIDTH } }],
        { compress: THUMB_QUALITY, format: ImageManipulator.SaveFormat.JPEG },
      );

      const id = newId();
      const stored = await persistPhoto(jobId, id, original.uri, derivative.uri);

      const db = await openLocalDatabase();
      await capturePhoto(db, {
        id,
        companyId: currentCompanyId(),
        jobId,
        roomId: activeRoomId,
        localUri: stored.originalUri,
        localThumbUri: stored.thumbUri,
        gpsLat: coords.current?.lat ?? null,
        gpsLng: coords.current?.lng ?? null,
      });

      setShotCount((n) => n + 1);
      setLastShot(stored.thumbUri);
    } finally {
      setBusy(false);
    }
  }, [activeRoomId, busy, jobId]);

  if (!permission) return null;

  if (!permission.granted) {
    return (
      <Screen footer={<Button label="Allow camera" onPress={() => void requestPermission()} />}>
        <TypeText role="title">Camera access</TypeText>
        <TypeText role="body" tone="textMuted">
          ScopeFlow needs the camera to document damage. Photos stay on this
          phone until there is signal.
        </TypeText>
        {Platform.OS === 'web' ? (
          <TypeText role="caption" tone="textFaint">
            If this browser or page does not offer the camera, nothing is wrong
            with the job — photos are taken in the phone app.
          </TypeText>
        ) : null}
        <Button label="Back to the job" variant="ghost" onPress={() => goBack()} />
      </Screen>
    );
  }

  const activeRoom = rooms.find((r) => r.id === activeRoomId);

  return (
    <View style={[styles.root, { backgroundColor: c.bg }]}>
      <CameraView ref={cameraRef} style={styles.camera} facing="back" />

      {/* Pinned room chip: where the next frame lands, switchable without
          leaving the viewfinder. */}
      <View style={styles.topBar}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          <Chip
            label="Untagged"
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

      <View style={[styles.bottomBar, { backgroundColor: c.surface, borderTopColor: c.border }]}>
        {lastShot ? (
          <Image
            source={{ uri: lastShot }}
            style={[styles.lastShot, { borderColor: c.border }]}
            contentFit="cover"
            accessibilityLabel="Last photo taken"
          />
        ) : null}
        <View style={styles.bottomInfo}>
          <TypeText role="bodyStrong">{activeRoom ? activeRoom.name : 'Untagged'}</TypeText>
          <TypeText role="caption" tone="textFaint">
            {shotCount} {shotCount === 1 ? 'photo' : 'photos'} on this job
          </TypeText>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Take photo"
          onPress={() => void shoot()}
          disabled={busy}
          style={({ pressed }) => [
            styles.shutter,
            { borderColor: c.accent, opacity: busy ? 0.5 : pressed ? 0.7 : 1 },
          ]}
        >
          <View style={[styles.shutterInner, { backgroundColor: c.accent }]} />
        </Pressable>

        <View style={styles.bottomInfo}>
          <Button label="Done" variant="ghost" onPress={() => goBack()} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  camera: { flex: 1 },
  topBar: { position: 'absolute', top: space.lg, left: 0, right: 0 },
  chipRow: { flexDirection: 'row', gap: space.sm, paddingHorizontal: space.lg },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.xl,
    borderTopWidth: 1,
  },
  bottomInfo: { flex: 1, gap: 2 },
  lastShot: { width: 48, height: 48, borderRadius: radius.sm, borderWidth: 1 },
  shutter: {
    width: MIN_TARGET + 28,
    height: MIN_TARGET + 28,
    borderRadius: radius.pill,
    borderWidth: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: { width: MIN_TARGET + 6, height: MIN_TARGET + 6, borderRadius: radius.pill },
});
