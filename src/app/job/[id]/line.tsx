/**
 * Editing one line of the scope.
 *
 * Quantity first and focused, because that is what a contractor came here to
 * change: the template's number is a starting point and the real one comes off
 * a tape or a judgement call. The line total updates as they type, priced
 * through the same calculator as the estimate so the two can never disagree.
 */

import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Card, DimensionField, InlineField, Label, Screen, TypeText } from '@/components/ui';
import { computeRoom } from '@/core/measure';
import { formatUsd } from '@/core/units';
import { openLocalDatabase } from '@/db/client';
import {
  getLineItem,
  softDeleteLineItem,
  updateLineItemPricing,
  type LineItemRecord,
} from '@/db/line-items';
import { listOpenings, toCoreOpenings } from '@/db/openings';
import { getRoom } from '@/db/rooms';
import {
  deriveLineForm,
  describeLine,
  lineFormFrom,
  type LineFormValues,
} from '@/features/pricing/forms';
import { space } from '@/theme/tokens';

/** The derived quantities this line could plausibly be measured against. */
interface QuantityHint {
  label: string;
  value: number;
}

export default function LineEditorScreen() {
  const { lineId } = useLocalSearchParams<{ id: string; lineId: string }>();
  const [line, setLine] = useState<LineItemRecord | null>(null);
  const [values, setValues] = useState<LineFormValues | null>(null);
  const [hints, setHints] = useState<QuantityHint[]>([]);

  useEffect(() => {
    void (async () => {
      const db = await openLocalDatabase();
      const item = await getLineItem(db, lineId);
      if (!item) return;

      setLine(item);
      setValues(lineFormFrom(item));

      // Offer the room's own measurements, so putting a quantity back to what
      // the geometry says is one tap rather than a re-derivation by hand.
      if (item.roomId) {
        const room = await getRoom(db, item.roomId);
        if (room) {
          try {
            const q = computeRoom({
              lengthIn: room.lengthIn,
              widthIn: room.widthIn,
              heightIn: room.heightIn,
              offsets: room.offsets,
              openings: toCoreOpenings(await listOpenings(db, room.id)),
              floodCutHeightIn: room.floodCutHeightIn,
              ceilingMultiplier: room.ceilingMultiplier,
            });
            setHints(
              [
                { label: 'Floor', value: q.floorSf },
                { label: 'Ceiling', value: q.ceilingSf },
                { label: 'Walls, net', value: q.netWallSf },
                { label: 'Baseboard', value: q.baseboardLf },
                { label: 'Flood cut', value: q.floodCutSf },
              ].filter((hint) => hint.value > 0),
            );
          } catch {
            setHints([]);
          }
        }
      }
    })();
  }, [lineId]);

  const state = useMemo(
    () => (values ? deriveLineForm(values) : null),
    [values],
  );

  const set = <K extends keyof LineFormValues>(key: K, value: LineFormValues[K]) =>
    setValues((prev) => (prev ? { ...prev, [key]: value } : prev));

  const save = useCallback(async () => {
    if (!state?.canSave || !line) return;
    const db = await openLocalDatabase();
    await updateLineItemPricing(db, line.id, {
      qty: state.qty,
      wastePct: state.wastePct,
      materialUnitCents: state.materialUnitCents,
      laborUnitCents: state.laborUnitCents,
    });
    router.back();
  }, [line, state]);

  const remove = useCallback(async () => {
    if (!line) return;
    const db = await openLocalDatabase();
    await softDeleteLineItem(db, line.id);
    router.back();
  }, [line]);

  if (!line || !values || !state) return null;

  return (
    <Screen
      footer={
        <>
          <Button
            testID="save-line"
            label={state.canSave ? `Save — ${formatUsd(state.totalCents)}` : 'Check the quantity'}
            onPress={() => void save()}
            disabled={!state.canSave}
          />
          <Button label="Remove from scope" variant="danger" onPress={() => void remove()} />
          <Button label="Cancel" variant="ghost" onPress={() => router.back()} />
        </>
      }
    >
      <View style={styles.header}>
        <TypeText role="title">{line.code}</TypeText>
        <TypeText role="caption" tone="textMuted">
          {line.description}
        </TypeText>
        {line.note ? (
          <TypeText role="caption" tone="textFaint">
            {line.note}
          </TypeText>
        ) : null}
      </View>

      <DimensionField
        testID="qty"
        label={`Quantity (${line.unit})`}
        value={values.qtyText}
        onChangeText={(next) => set('qtyText', next)}
        error={state.errors.qty}
        placeholder="168"
        autoFocus
      />

      {hints.length > 0 ? (
        <View style={styles.section}>
          <Label>From the room</Label>
          <View style={styles.chipRow}>
            {hints.map((hint) => (
              <Button
                key={hint.label}
                label={`${hint.label} ${hint.value}`}
                variant="secondary"
                onPress={() => set('qtyText', String(hint.value))}
              />
            ))}
          </View>
        </View>
      ) : null}

      <Card>
        <Label>Price per {line.unit}</Label>
        <InlineField
          testID="line-material"
          label="Material"
          value={values.materialText}
          onChangeText={(next) => set('materialText', next)}
          error={state.errors.materialCost}
        />
        <InlineField
          testID="line-labor"
          label="Labor"
          value={values.laborText}
          onChangeText={(next) => set('laborText', next)}
          error={state.errors.laborCost}
        />
        <InlineField
          testID="line-waste"
          label="Waste"
          value={values.wastePctText}
          onChangeText={(next) => set('wastePctText', next)}
          suffix="%"
          error={state.errors.wastePct}
        />
      </Card>

      {/* The arithmetic, spelled out the way a contractor would check it. */}
      <Card>
        <Label>This line</Label>
        <TypeText role="title">{formatUsd(state.totalCents)}</TypeText>
        <TypeText role="caption" tone="textMuted">
          {describeLine(state, line.unit) || 'Enter a quantity to price this line.'}
        </TypeText>
        {line.origin === 'template' ? (
          <TypeText role="caption" tone="textFaint">
            Saving an edit here keeps this line when the room is re-scoped.
          </TypeText>
        ) : null}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: space.xs },
  section: { gap: space.sm },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
