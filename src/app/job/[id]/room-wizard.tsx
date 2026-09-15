import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';

import { openLocalDatabase } from '@/db/client';
import { listOpenings, saveOpening, softDeleteOpening } from '@/db/openings';
import { getRoom, listRooms, saveRoom } from '@/db/rooms';
import { currentCompanyId } from '@/features/jobs/useCompany';
import { formatFeetInches } from '@/features/rooms/dimension';
import { RoomWizard } from '@/features/rooms/RoomWizard';
import {
  deriveRoomForm,
  emptyRoomForm,
  type RoomFormValues,
} from '@/features/rooms/wizard';
import { useSync } from '@/hooks/use-sync';
import { newId } from '@/lib/id';

export default function RoomWizardRoute() {
  const { id: jobId, roomId } = useLocalSearchParams<{ id: string; roomId?: string }>();
  const [initial, setInitial] = useState<RoomFormValues | null>(roomId ? null : emptyRoomForm());
  const sync = useSync();

  // Editing an existing room: load it back into the form, openings included.
  useEffect(() => {
    if (!roomId) return;
    void (async () => {
      const db = await openLocalDatabase();
      const [room, openings] = await Promise.all([getRoom(db, roomId), listOpenings(db, roomId)]);
      if (!room) {
        setInitial(emptyRoomForm());
        return;
      }
      setInitial({
        name: room.name,
        lengthText: formatFeetInches(room.lengthIn),
        widthText: formatFeetInches(room.widthIn),
        heightText: formatFeetInches(room.heightIn),
        floodCutText: room.floodCutHeightIn ? formatFeetInches(room.floodCutHeightIn) : '',
        level: room.level ?? undefined,
        offsets: room.offsets,
        ceilingMultiplier: room.ceilingMultiplier,
        openings: openings.map((o) => ({
          kind: o.kind,
          widthIn: o.widthIn,
          heightIn: o.heightIn,
          count: o.count,
          ...(o.deductsWall !== null ? { deductsWall: o.deductsWall } : {}),
          ...(o.deductsBase !== null ? { deductsBase: o.deductsBase } : {}),
        })),
      });
    })();
  }, [roomId]);

  const handleSave = useCallback(
    async (values: RoomFormValues) => {
      const state = deriveRoomForm(values);
      if (
        !state.canSave ||
        state.lengthIn === null ||
        state.widthIn === null ||
        state.heightIn === null
      ) {
        return;
      }

      const db = await openLocalDatabase();
      const id = roomId ?? newId();
      const existing = await listRooms(db, jobId);

      // Writes to SQLite and the outbox in one transaction, then returns. No
      // network call happens here, so this works the same in a crawlspace.
      await saveRoom(db, {
        id,
        companyId: currentCompanyId(),
        jobId,
        name: values.name.trim(),
        level: values.level ?? null,
        lengthIn: state.lengthIn,
        widthIn: state.widthIn,
        heightIn: state.heightIn,
        floodCutHeightIn: state.floodCutHeightIn,
        offsets: values.offsets,
        ceilingMultiplier: values.ceilingMultiplier,
        sortOrder: roomId
          ? (existing.find((r) => r.id === roomId)?.sortOrder ?? existing.length + 1)
          : existing.length + 1,
      });

      // Openings are replaced wholesale rather than diffed: there are rarely
      // more than a handful, and every write is a local transaction.
      const previous = await listOpenings(db, id);
      for (const opening of previous) {
        await softDeleteOpening(db, opening.id);
      }
      for (const opening of values.openings ?? []) {
        await saveOpening(db, {
          id: newId(),
          companyId: currentCompanyId(),
          roomId: id,
          kind: opening.kind,
          widthIn: opening.widthIn,
          heightIn: opening.heightIn,
          count: opening.count ?? 1,
          deductsWall: opening.deductsWall ?? null,
          deductsBase: opening.deductsBase ?? null,
        });
      }

      router.back();
      // Opportunistic: if there is signal it goes now, otherwise it waits.
      sync.syncNow();
    },
    [jobId, roomId, sync],
  );

  if (!initial) return null;

  return (
    <RoomWizard
      initialValues={initial}
      onSave={(values) => void handleSave(values)}
      onCancel={() => router.back()}
      sync={{
        pending: sync.pending,
        uploading: sync.uploading,
        thinking: sync.thinking,
        failed: sync.failed,
        online: sync.online,
      }}
    />
  );
}
