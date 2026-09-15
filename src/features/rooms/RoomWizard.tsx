/**
 * The room wizard — the most-used screen in the app.
 *
 * The target from the plan is under fifteen seconds per room: tap a name, type
 * three numbers, save. Everything else about a room is optional and collapsed.
 * The derived quantities update as the contractor types, because seeing 168 SF
 * appear is what makes the tool feel like it is doing the work.
 */

import { useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';

import {
  Button,
  Card,
  Chip,
  DimensionField,
  Label,
  QuantityRow,
  Screen,
  SyncChip,
  TypeText,
} from '../../components/ui';
import { space, type } from '../../theme/tokens';
import { useTheme } from '../../theme/use-theme';
import { formatFeetInches } from './dimension';
import { OpeningsEditor } from './OpeningsEditor';
import {
  COMMON_ROOM_NAMES,
  deriveRoomForm,
  emptyRoomForm,
  type RoomFormValues,
} from './wizard';

export interface RoomWizardProps {
  initialValues?: RoomFormValues;
  onSave: (values: RoomFormValues) => void;
  onCancel?: () => void;
  sync?: {
    pending: number;
    uploading?: number;
    thinking?: number;
    failed: number;
    online: boolean;
  };
}

export function RoomWizard({ initialValues, onSave, onCancel, sync }: RoomWizardProps) {
  const c = useTheme();
  const [values, setValues] = useState<RoomFormValues>(initialValues ?? emptyRoomForm());
  const [showMore, setShowMore] = useState(false);

  const widthRef = useRef<TextInput>(null);
  const heightRef = useRef<TextInput>(null);

  const state = useMemo(() => deriveRoomForm(values), [values]);

  const set = <K extends keyof RoomFormValues>(key: K, value: RoomFormValues[K]) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  const echo = (inches: number | null) => (inches === null ? null : formatFeetInches(inches));

  return (
    <Screen
      footer={
        <>
          <Button
            testID="save-room"
            label={state.canSave ? 'Save room' : 'Enter the measurements'}
            onPress={() => onSave(values)}
            disabled={!state.canSave}
          />
          {onCancel ? <Button label="Cancel" variant="ghost" onPress={onCancel} /> : null}
        </>
      }
    >
      {sync ? <SyncChip {...sync} /> : null}

      <View style={styles.header}>
        <TypeText role="title">{values.name.trim() || 'New room'}</TypeText>
        <TypeText role="caption" tone="textFaint">
          Three numbers. Everything else is optional.
        </TypeText>
      </View>

      {/* Naming is a tap, not typing — these are the rooms a house has. */}
      <View style={styles.section}>
        <Label>Room</Label>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.chipRow}
        >
          {COMMON_ROOM_NAMES.map((name) => (
            <Chip
              key={name}
              label={name}
              selected={values.name === name}
              onPress={() => set('name', name)}
            />
          ))}
        </ScrollView>
        <TextInput
          value={values.name}
          onChangeText={(next) => set('name', next)}
          placeholder="Or type a name"
          placeholderTextColor={c.textFaint}
          style={[
            type.body as never,
            styles.nameInput,
            { backgroundColor: c.surface, borderColor: c.border, color: c.text },
          ]}
        />
      </View>

      <View style={styles.dimensions}>
        <DimensionField
          testID="length"
          label="Length"
          value={values.lengthText}
          onChangeText={(next) => set('lengthText', next)}
          onSubmitEditing={() => widthRef.current?.focus()}
          hint={echo(state.lengthIn)}
          error={state.errors.length}
          autoFocus
        />
        <DimensionField
          testID="width"
          label="Width"
          value={values.widthText}
          onChangeText={(next) => set('widthText', next)}
          onSubmitEditing={() => heightRef.current?.focus()}
          hint={echo(state.widthIn)}
          error={state.errors.width}
          placeholder="14"
        />
        <DimensionField
          testID="height"
          label="Ceiling height"
          value={values.heightText}
          onChangeText={(next) => set('heightText', next)}
          hint={echo(state.heightIn)}
          error={state.errors.height}
          placeholder="8"
        />
      </View>

      <TypeText role="caption" tone="textFaint">
        A bare number means feet. 12&apos;6&quot;, 12 6 and 12.5 all work.
      </TypeText>

      {/* The payoff: quantities appear as the numbers land. */}
      <Card>
        <Label>Derived</Label>
        {state.quantities ? (
          <>
            <QuantityRow label="Floor" value={String(state.quantities.floorSf)} unit="SF" emphasis />
            <QuantityRow label="Ceiling" value={String(state.quantities.ceilingSf)} unit="SF" />
            <QuantityRow label="Perimeter" value={String(state.quantities.perimeterLf)} unit="LF" />
            <QuantityRow label="Walls, gross" value={String(state.quantities.grossWallSf)} unit="SF" />
            <QuantityRow label="Walls, net" value={String(state.quantities.netWallSf)} unit="SF" emphasis />
            <QuantityRow label="Baseboard" value={String(state.quantities.baseboardLf)} unit="LF" />
            {state.quantities.floodCutSf > 0 ? (
              <QuantityRow label="Flood cut" value={String(state.quantities.floodCutSf)} unit="SF" emphasis />
            ) : null}
            <QuantityRow label="Volume" value={String(state.quantities.volumeCf)} unit="CF" />
          </>
        ) : (
          <TypeText role="body" tone="textFaint">
            Quantities appear here as you measure.
          </TypeText>
        )}
      </Card>

      <OpeningsEditor
        openings={values.openings ?? []}
        onChange={(next) => set('openings', next)}
      />

      <Button
        label={showMore ? 'Fewer details' : 'Flood cut and level'}
        variant="ghost"
        onPress={() => setShowMore((s) => !s)}
      />

      {showMore ? (
        <View style={styles.section}>
          <DimensionField
            testID="flood-cut"
            label="Flood cut height"
            value={values.floodCutText}
            onChangeText={(next) => set('floodCutText', next)}
            hint={values.floodCutText ? echo(state.floodCutHeightIn) : 'Leave empty for none'}
            error={state.errors.floodCut}
            placeholder="2"
          />
          <View style={styles.section}>
            <Label>Level</Label>
            <View style={styles.chipRow}>
              {['Basement', 'First floor', 'Second floor', 'Attic'].map((level) => (
                <Chip
                  key={level}
                  label={level}
                  selected={values.level === level}
                  onPress={() => set('level', values.level === level ? undefined : level)}
                />
              ))}
            </View>
          </View>
        </View>
      ) : null}

      {state.errors.name ? (
        <TypeText role="caption" tone="danger">
          {state.errors.name}
        </TypeText>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: space.xs },
  section: { gap: space.sm },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingRight: space.lg },
  nameInput: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: space.lg,
  },
  dimensions: { gap: space.lg },
});
