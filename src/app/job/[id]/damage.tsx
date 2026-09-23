/**
 * The damage sheet for one room.
 *
 * Shaped around how the walk actually goes: the water is one category and one
 * class for the whole room, then the contractor names what got wet and how far
 * up it went. Naming a material is one tap; the measurements are optional,
 * because a material that is obviously ruined does not need a meter reading to
 * belong in the scope.
 *
 * The payoff is at the bottom — the deepest reading on the sheet produces a
 * suggested flood cut height, one tap to apply to the room, which then flows
 * straight into the measurement engine and the estimate.
 */

import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  Button,
  Card,
  Chip,
  InlineField,
  Label,
  NotesField,
  Screen,
  TypeText,
} from '@/components/ui';
import { explainFloodCut } from '@/core/floodcut';
import { goBack } from '@/lib/navigation';
import { openLocalDatabase } from '@/db/client';
import {
  COMMON_MATERIALS,
  listDamages,
  saveDamage,
  softDeleteDamage,
  WATER_CATEGORY_LABELS,
  WATER_CLASS_LABELS,
  type WaterCategory,
  type WaterClass,
} from '@/db/damages';
import { getRoom, saveRoom, type RoomRecord } from '@/db/rooms';
import {
  deriveDamageSheet,
  emptyDamageSheet,
  newDraft,
  type DamageSheetValues,
} from '@/features/damage/damage-sheet';
import { currentCompanyId } from '@/features/jobs/useCompany';
import { formatFeetInches } from '@/features/rooms/dimension';
import { useSync } from '@/hooks/use-sync';
import { newId } from '@/lib/id';
import { space } from '@/theme/tokens';

export default function DamageSheetScreen() {
  const { roomId } = useLocalSearchParams<{ id: string; roomId: string }>();
  const [room, setRoom] = useState<RoomRecord | null>(null);
  const [values, setValues] = useState<DamageSheetValues>(emptyDamageSheet());
  const [loaded, setLoaded] = useState(false);
  const sync = useSync();

  useEffect(() => {
    void (async () => {
      const db = await openLocalDatabase();
      const [record, existing] = await Promise.all([getRoom(db, roomId), listDamages(db, roomId)]);
      setRoom(record);
      setValues({
        // Category and class describe the loss, so any existing record carries them.
        waterCategory: existing[0]?.waterCategory ?? null,
        waterClass: existing[0]?.waterClass ?? null,
        drafts: existing.map((damage) => ({
          id: damage.id,
          material: damage.material,
          affectedHeightText:
            damage.affectedHeightIn !== null ? formatFeetInches(damage.affectedHeightIn) : '',
          moistureText: damage.moisturePct !== null ? String(damage.moisturePct) : '',
          notes: damage.notes ?? '',
        })),
      });
      setLoaded(true);
    })();
  }, [roomId]);

  const wallHeightIn = room?.heightIn ?? 0;
  const state = useMemo(() => deriveDamageSheet(values, wallHeightIn), [values, wallHeightIn]);

  const addMaterial = (material: string) =>
    setValues((prev) => ({ ...prev, drafts: [...prev.drafts, newDraft(newId(), material)] }));

  const updateDraft = (id: string, patch: Partial<(typeof values.drafts)[number]>) =>
    setValues((prev) => ({
      ...prev,
      drafts: prev.drafts.map((d) => (d.id === id ? { ...d, ...patch } : d)),
    }));

  const removeDraft = (id: string) =>
    setValues((prev) => ({ ...prev, drafts: prev.drafts.filter((d) => d.id !== id) }));

  const applyFloodCut = useCallback(async () => {
    if (!room || state.suggestedFloodCutIn <= 0) return;
    const db = await openLocalDatabase();
    await saveRoom(db, {
      id: room.id,
      companyId: room.companyId,
      jobId: room.jobId,
      name: room.name,
      level: room.level,
      lengthIn: room.lengthIn,
      widthIn: room.widthIn,
      heightIn: room.heightIn,
      ceilingType: room.ceilingType,
      ceilingMultiplier: room.ceilingMultiplier,
      flooringType: room.flooringType,
      offsets: room.offsets,
      sortOrder: room.sortOrder,
      notes: room.notes,
      floodCutHeightIn: state.suggestedFloodCutIn,
    });
    setRoom({ ...room, floodCutHeightIn: state.suggestedFloodCutIn });
  }, [room, state.suggestedFloodCutIn]);

  const save = useCallback(async () => {
    if (!state.canSave || !room) return;
    const db = await openLocalDatabase();

    // Replaced wholesale rather than diffed: a room has a handful of materials
    // and every write is a local transaction.
    const previous = await listDamages(db, roomId);
    const keep = new Set(values.drafts.map((d) => d.id));
    for (const damage of previous) {
      if (!keep.has(damage.id)) await softDeleteDamage(db, damage.id);
    }

    for (const draft of values.drafts) {
      await saveDamage(db, {
        id: draft.id,
        companyId: currentCompanyId(),
        roomId,
        material: draft.material,
        waterCategory: values.waterCategory,
        waterClass: values.waterClass,
        affectedHeightIn: state.heights[draft.id],
        moisturePct: state.moisture[draft.id],
        notes: draft.notes.trim() || null,
      });
    }

    goBack();
    sync.syncNow();
  }, [room, roomId, state, sync, values]);

  if (!loaded) return null;

  const floodCutApplied = room?.floodCutHeightIn === state.suggestedFloodCutIn;

  return (
    <Screen
      footer={
        <>
          <Button
            testID="save-damage"
            label={state.canSave ? 'Save damage' : 'Add a material'}
            onPress={() => void save()}
            disabled={!state.canSave}
          />
          <Button label="Cancel" variant="ghost" onPress={() => goBack()} />
        </>
      }
    >
      <View style={styles.header}>
        <TypeText role="title">{room?.name ?? 'Room'}</TypeText>
        <TypeText role="caption" tone="textFaint">
          {room
            ? `${formatFeetInches(room.lengthIn)} × ${formatFeetInches(room.widthIn)} × ${formatFeetInches(room.heightIn)}`
            : ''}
        </TypeText>
      </View>

      {/* One category and one class for the room: they describe the water. */}
      <View style={styles.section}>
        <Label>Water category</Label>
        <View style={styles.chipRow}>
          {(Object.keys(WATER_CATEGORY_LABELS) as WaterCategory[]).map((category) => (
            <Chip
              key={category}
              label={WATER_CATEGORY_LABELS[category]}
              selected={values.waterCategory === category}
              onPress={() =>
                setValues((prev) => ({
                  ...prev,
                  waterCategory: prev.waterCategory === category ? null : category,
                }))
              }
            />
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <Label>Water class</Label>
        <View style={styles.chipRow}>
          {(Object.keys(WATER_CLASS_LABELS) as WaterClass[]).map((waterClass) => (
            <Chip
              key={waterClass}
              label={WATER_CLASS_LABELS[waterClass]}
              selected={values.waterClass === waterClass}
              onPress={() =>
                setValues((prev) => ({
                  ...prev,
                  waterClass: prev.waterClass === waterClass ? null : waterClass,
                }))
              }
            />
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <Label>What got wet</Label>
        <View style={styles.chipRow}>
          {COMMON_MATERIALS.map((material) => (
            <Chip key={material} label={material} onPress={() => addMaterial(material)} />
          ))}
        </View>
      </View>

      {values.drafts.length === 0 ? (
        <Card>
          <TypeText role="body" tone="textMuted">
            Tap a material above to add it. Measurements are optional — naming
            what got wet is what puts it in the scope.
          </TypeText>
        </Card>
      ) : (
        <View style={styles.list}>
          {values.drafts.map((draft) => (
            <Card key={draft.id}>
              <View style={styles.draftHeader}>
                <TypeText role="heading">{draft.material}</TypeText>
                <Button label="Remove" variant="ghost" onPress={() => removeDraft(draft.id)} />
              </View>

              <InlineField
                testID={`height-${draft.id}`}
                label="Water line"
                value={draft.affectedHeightText}
                onChangeText={(next) => updateDraft(draft.id, { affectedHeightText: next })}
                placeholder={'14"'}
                error={state.errors[draft.id]?.affectedHeight}
              />
              <InlineField
                testID={`moisture-${draft.id}`}
                label="Moisture"
                value={draft.moistureText}
                onChangeText={(next) => updateDraft(draft.id, { moistureText: next })}
                placeholder="31"
                suffix="%"
                error={state.errors[draft.id]?.moisture}
              />
              <NotesField
                value={draft.notes}
                onChangeText={(next) => updateDraft(draft.id, { notes: next })}
              />
            </Card>
          ))}
        </View>
      )}

      {/* The payoff: a measured water line becomes a flood cut height. */}
      {state.suggestedFloodCutIn > 0 ? (
        <Card>
          <Label>Suggested flood cut</Label>
          <TypeText role="title">{formatFeetInches(state.suggestedFloodCutIn)}</TypeText>
          <TypeText role="caption" tone="textMuted">
            {explainFloodCut(state.deepestWaterLineIn, state.suggestedFloodCutIn)}
          </TypeText>
          {floodCutApplied ? (
            <TypeText role="caption" tone="success">
              Applied to this room.
            </TypeText>
          ) : (
            <Button
              label="Apply to room"
              variant="secondary"
              onPress={() => void applyFloodCut()}
            />
          )}
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: space.xs },
  section: { gap: space.sm },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  list: { gap: space.md },
  draftHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
