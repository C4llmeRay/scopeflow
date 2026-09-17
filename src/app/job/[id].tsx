/**
 * Job detail — the room list for one property.
 *
 * This is the screen a contractor lives on during an inspection, so the two
 * things they do most are the two buttons in the thumb zone: add a room, and
 * open the camera. Everything else is a tap away from here.
 */

import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Card, Label, QuantityRow, Screen, SyncChip, TypeText } from '@/components/ui';
import { computeRoom, type RoomQuantities } from '@/core/measure';
import { openLocalDatabase } from '@/db/client';
import { listDamages } from '@/db/damages';
import { latestSentEstimate, recordEstimateOutcome } from '@/db/estimates';
import {
  getJob,
  JOB_STATUS_LABELS,
  jobSubtitle,
  jobTitle,
  setJobStatus,
  type JobRecord,
  type JobStatus,
} from '@/db/jobs';
import { CloseJobPrompt, JobStatusBar } from '@/features/jobs/JobStatusBar';
import { listOpenings, toCoreOpenings } from '@/db/openings';
import { listPhotos } from '@/db/photos';
import { listRooms, type RoomRecord } from '@/db/rooms';
import { formatFeetInches } from '@/features/rooms/dimension';
import { useSync } from '@/hooks/use-sync';
import { radius, space } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';

interface RoomView {
  room: RoomRecord;
  quantities: RoomQuantities | null;
  openings: number;
  photos: number;
  damages: number;
}

export default function JobDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [job, setJob] = useState<JobRecord | null>(null);
  const [views, setViews] = useState<RoomView[]>([]);
  const [untagged, setUntagged] = useState(0);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const sync = useSync();
  const c = useTheme();

  const load = useCallback(
    async (active: () => boolean) => {
      {
        const db = await openLocalDatabase();
        const [record, rooms, photos] = await Promise.all([
          getJob(db, id),
          listRooms(db, id),
          listPhotos(db, id),
        ]);

        const next: RoomView[] = [];
        for (const room of rooms) {
          const [openings, damages] = await Promise.all([
            listOpenings(db, room.id),
            listDamages(db, room.id),
          ]);
          next.push({
            room,
            openings: openings.length,
            damages: damages.length,
            photos: photos.filter((p) => p.roomId === room.id).length,
            quantities: safeQuantities(room, openings),
          });
        }

        if (active()) {
          setJob(record);
          setViews(next);
          setUntagged(photos.filter((p) => p.roomId === null).length);
        }
      }
    },
    [id],
  );

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void load(() => active);
      return () => {
        active = false;
      };
    }, [load]),
  );

  /**
   * Moving the job also moves the estimate the carrier is answering, so the two
   * never disagree about whether a claim was approved.
   */
  const changeStatus = useCallback(
    async (next: JobStatus) => {
      if (!job) return;
      setBusy(true);
      setProblem(null);
      try {
        const db = await openLocalDatabase();
        await setJobStatus(db, job.id, next);

        if (next === 'approved' || next === 'lost') {
          const sent = await latestSentEstimate(db, job.id);
          if (sent && sent.status === 'sent') {
            await recordEstimateOutcome(db, sent.id, next === 'approved' ? 'approved' : 'rejected');
          }
        }

        await load(() => true);
      } catch (error) {
        setProblem((error as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [job, load],
  );

  return (
    <Screen
      footer={
        <>
          <View style={styles.footerRow}>
            <View style={styles.footerItem}>
              <Button
                label="Add room"
                variant="secondary"
                onPress={() => router.push(`/job/${id}/room-wizard`)}
              />
            </View>
            <View style={styles.footerItem}>
              <Button
                label="Camera"
                variant="secondary"
                onPress={() => router.push(`/job/${id}/capture`)}
              />
            </View>
            <View style={styles.footerItem}>
              <Button
                label="Notes"
                variant="secondary"
                onPress={() => router.push(`/job/${id}/notes`)}
              />
            </View>
          </View>
          <Button label="Estimate" onPress={() => router.push(`/job/${id}/estimate`)} />
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
          {job ? [jobSubtitle(job), JOB_STATUS_LABELS[job.status]].filter(Boolean).join(' · ') : ''}
        </TypeText>
      </View>

      <Card>
        <JobStatusBar
          status={job?.status ?? 'inspecting'}
          onChange={(next) => void changeStatus(next)}
          busy={busy}
        />
        {job?.status === 'approved' ? (
          <CloseJobPrompt onClose={() => void changeStatus('closed')} busy={busy} />
        ) : null}
        {problem ? (
          <TypeText role="caption" tone="danger">
            {problem}
          </TypeText>
        ) : null}
      </Card>

      {views.length === 0 ? (
        <Card>
          <TypeText role="heading">No rooms measured</TypeText>
          <TypeText role="body" tone="textMuted">
            Add the first room — three numbers and you are done. Quantities are
            derived as you type.
          </TypeText>
        </Card>
      ) : (
        <View style={styles.list}>
          {views.map(({ room, quantities, openings, photos, damages }) => (
            <View
              key={room.id}
              style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}
            >
              <View style={styles.cardHeader}>
                <TypeText role="heading">{room.name}</TypeText>
                <TypeText role="caption" tone="textFaint">
                  {formatFeetInches(room.lengthIn)} &times; {formatFeetInches(room.widthIn)} &times;{' '}
                  {formatFeetInches(room.heightIn)}
                  {openings > 0 ? ` · ${openings} opening${openings === 1 ? '' : 's'}` : ''}
                  {photos > 0 ? ` · ${photos} photo${photos === 1 ? '' : 's'}` : ''}
                </TypeText>
              </View>

              {quantities ? (
                <>
                  <Label>Derived</Label>
                  <QuantityRow label="Floor" value={String(quantities.floorSf)} unit="SF" emphasis />
                  <QuantityRow label="Walls, net" value={String(quantities.netWallSf)} unit="SF" />
                  <QuantityRow label="Baseboard" value={String(quantities.baseboardLf)} unit="LF" />
                  {quantities.floodCutSf > 0 ? (
                    <QuantityRow
                      label="Flood cut"
                      value={String(quantities.floodCutSf)}
                      unit="SF"
                      emphasis
                    />
                  ) : null}
                </>
              ) : (
                <TypeText role="caption" tone="danger">
                  Check this room&apos;s measurements.
                </TypeText>
              )}

              <View style={styles.cardActions}>
                <View style={styles.footerItem}>
                  <Button
                    label="Measurements"
                    variant="secondary"
                    onPress={() => router.push(`/job/${id}/room-wizard?roomId=${room.id}`)}
                  />
                </View>
                <View style={styles.footerItem}>
                  <Button
                    label={damages > 0 ? `Damage (${damages})` : 'Damage'}
                    variant="secondary"
                    onPress={() => router.push(`/job/${id}/damage?roomId=${room.id}`)}
                  />
                </View>
              </View>
            </View>
          ))}
        </View>
      )}

      {untagged > 0 ? (
        <Card>
          <TypeText role="body" tone="warn">
            {untagged} {untagged === 1 ? 'photo is' : 'photos are'} not tagged to a
            room yet. An untagged photo is missing from the photo report and from
            anything the AI reasons about for that room.
          </TypeText>
          <Button
            label={`Sort ${untagged} ${untagged === 1 ? 'photo' : 'photos'}`}
            variant="secondary"
            onPress={() => router.push(`/job/${id}/sort`)}
          />
        </Card>
      ) : null}
    </Screen>
  );
}

function safeQuantities(
  room: RoomRecord,
  openings: Awaited<ReturnType<typeof listOpenings>>,
): RoomQuantities | null {
  try {
    return computeRoom({
      lengthIn: room.lengthIn,
      widthIn: room.widthIn,
      heightIn: room.heightIn,
      offsets: room.offsets,
      openings: toCoreOpenings(openings),
      floodCutHeightIn: room.floodCutHeightIn,
      ceilingMultiplier: room.ceilingMultiplier,
    });
  } catch {
    return null;
  }
}

const styles = StyleSheet.create({
  header: { gap: space.xs },
  list: { gap: space.md },
  card: { borderWidth: 1, borderRadius: radius.md, padding: space.lg, gap: space.sm },
  cardHeader: { gap: 2 },
  cardActions: { flexDirection: 'row', gap: space.sm, marginTop: space.xs },
  footerRow: { flexDirection: 'row', gap: space.md },
  footerItem: { flex: 1 },
});
