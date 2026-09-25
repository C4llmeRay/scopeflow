/**
 * A job, as the photo workflow sees it.
 *
 * The job exists to produce one thing: a set of named, described photos ready
 * for Xactimate. So the screen leads with how far along that is, then the
 * rooms and what has been shot in each, and keeps the camera in the thumb zone.
 */

import { Image } from 'expo-image';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button, Card, Screen, SyncChip, TypeText } from '../../components/ui';
import { openLocalDatabase } from '../../db/client';
import { getJob, jobSubtitle, jobTitle, type JobRecord } from '../../db/jobs';
import { listPhotos, type PhotoRecord } from '../../db/photos';
import { listRooms, type RoomRecord } from '../../db/rooms';
import { useSync } from '../../hooks/use-sync';
import { radius, space } from '../../theme/tokens';
import { useTheme } from '../../theme/use-theme';
import { isLabelled, labelProgress } from '../photos/labels';
import { usePhotoUri } from '../photos/source';

const STRIP = 4;

interface Group {
  key: string;
  room: RoomRecord | null;
  photos: PhotoRecord[];
}

export function PhotoJobScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [job, setJob] = useState<JobRecord | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [all, setAll] = useState<PhotoRecord[]>([]);
  const sync = useSync();
  const c = useTheme();

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void (async () => {
        const db = await openLocalDatabase();
        const [record, rooms, photos] = await Promise.all([
          getJob(db, id),
          listRooms(db, id),
          listPhotos(db, id),
        ]);
        if (!active) return;
        const general = photos.filter((p) => p.roomId === null || !rooms.some((r) => r.id === p.roomId));
        setJob(record);
        setAll(photos);
        setGroups([
          ...(general.length > 0 ? [{ key: 'general', room: null, photos: general }] : []),
          ...rooms.map((room) => ({
            key: room.id,
            room,
            photos: photos.filter((p) => p.roomId === room.id),
          })),
        ]);
      })();
      return () => {
        active = false;
      };
    }, [id]),
  );

  const progress = labelProgress(all);

  return (
    <Screen
      footer={
        <>
          <View style={styles.row}>
            <View style={styles.flex}>
              <Button label="Rooms" variant="secondary" onPress={() => router.push(`/job/${id}/rooms`)} />
            </View>
            <View style={styles.flex}>
              <Button
                label={progress.remaining > 0 ? `Label (${progress.remaining})` : 'Label'}
                variant="secondary"
                onPress={() => router.push(`/job/${id}/label`)}
                disabled={progress.total === 0}
              />
            </View>
            <View style={styles.flex}>
              <Button
                label="Export"
                variant="secondary"
                onPress={() => router.push(`/job/${id}/export`)}
                disabled={progress.total === 0}
              />
            </View>
          </View>
          <Button label="Camera" onPress={() => router.push(`/job/${id}/capture`)} />
        </>
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
        <TypeText role="title">{job ? jobTitle(job) : 'Job'}</TypeText>
        <TypeText role="caption" tone="textFaint">
          {job ? [jobSubtitle(job), job.claimNo ? `Claim ${job.claimNo}` : null].filter(Boolean).join(' · ') : ''}
        </TypeText>
        <View style={styles.edit}>
          <Button label="Edit details" variant="ghost" onPress={() => router.push(`/job/${id}/details`)} />
        </View>
      </View>

      {progress.total > 0 ? (
        <Card>
          <TypeText role="heading">
            {progress.remaining === 0
              ? `All ${progress.total} photos are ready for Xactimate`
              : `${progress.labelled} of ${progress.total} photos named and described`}
          </TypeText>
          <TypeText role="caption" tone="textMuted">
            {progress.remaining === 0
              ? 'Export them on your computer, or share them from here.'
              : 'Each photo needs a name and a description before it goes into Xactimate.'}
          </TypeText>
          {progress.remaining > 0 ? (
            <Button
              label={`Label ${progress.remaining} ${progress.remaining === 1 ? 'photo' : 'photos'}`}
              onPress={() => router.push(`/job/${id}/label`)}
            />
          ) : null}
        </Card>
      ) : null}

      {groups.length === 0 ? (
        <Card>
          <TypeText role="heading">Add the rooms, then shoot</TypeText>
          <TypeText role="body" tone="textMuted">
            Tap the rooms you will photograph — each photo is named after the
            room it is taken in. Photos of the outside or the source of loss can
            go under no room at all.
          </TypeText>
          <Button label="Add rooms" variant="secondary" onPress={() => router.push(`/job/${id}/rooms`)} />
        </Card>
      ) : (
        <View style={styles.list}>
          {groups.map(({ key, room, photos }) => {
            const remaining = photos.filter((p) => !isLabelled(p)).length;
            return (
              <Pressable
                key={key}
                accessibilityRole="button"
                onPress={() =>
                  router.push(room ? `/job/${id}/photos?roomId=${room.id}` : `/job/${id}/photos`)
                }
                style={({ pressed }) => [
                  styles.card,
                  { backgroundColor: c.surface, borderColor: c.border, opacity: pressed ? 0.9 : 1 },
                ]}
              >
                <View style={styles.cardHead}>
                  <TypeText role="heading">{room ? room.name : 'No room'}</TypeText>
                  <TypeText role="caption" tone={remaining > 0 ? 'warn' : 'textFaint'}>
                    {photos.length === 0
                      ? 'No photos yet'
                      : `${photos.length} ${photos.length === 1 ? 'photo' : 'photos'}${
                          remaining > 0 ? ` · ${remaining} to label` : ' · all labelled'
                        }`}
                  </TypeText>
                </View>
                {photos.length > 0 ? (
                  <View style={styles.strip}>
                    {photos.slice(0, STRIP).map((photo) => (
                      <Thumb key={photo.id} photo={photo} />
                    ))}
                    {photos.length > STRIP ? (
                      <View style={[styles.more, { backgroundColor: c.surfaceAlt, borderColor: c.border }]}>
                        <TypeText role="bodyStrong">+{photos.length - STRIP}</TypeText>
                      </View>
                    ) : null}
                  </View>
                ) : null}
              </Pressable>
            );
          })}
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
    />
  );
}

const styles = StyleSheet.create({
  header: { gap: space.xs },
  edit: { alignSelf: 'flex-start' },
  row: { flexDirection: 'row', gap: space.sm },
  flex: { flex: 1 },
  list: { gap: space.md },
  card: { borderWidth: 1, borderRadius: radius.md, padding: space.lg, gap: space.sm },
  cardHead: { gap: 2 },
  strip: { flexDirection: 'row', gap: space.xs },
  thumb: { width: 56, height: 56, borderRadius: radius.sm, borderWidth: 1 },
  more: {
    width: 56,
    height: 56,
    borderRadius: radius.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
