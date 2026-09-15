/**
 * Openings, added by tapping a preset.
 *
 * These change the numbers — a door removes wall area and breaks the baseboard
 * run, a window removes wall area but baseboard runs underneath it — so the
 * derived panel above updates the moment one is added. Standard sizes are one
 * tap because measuring a door frame is a waste of a contractor's time.
 */

import { StyleSheet, View } from 'react-native';

import { Button, Chip, Label, TypeText } from '../../components/ui';
import type { Opening } from '../../core/measure';
import { space } from '../../theme/tokens';
import { formatFeetInches } from './dimension';

interface Preset {
  label: string;
  opening: Opening;
}

const PRESETS: Preset[] = [
  { label: 'Interior door', opening: { kind: 'door', widthIn: 32, heightIn: 80 } },
  { label: 'Standard door', opening: { kind: 'door', widthIn: 36, heightIn: 80 } },
  { label: 'Double door', opening: { kind: 'door', widthIn: 72, heightIn: 80 } },
  { label: 'Window', opening: { kind: 'window', widthIn: 48, heightIn: 36 } },
  { label: 'Large window', opening: { kind: 'window', widthIn: 72, heightIn: 48 } },
  { label: 'Archway', opening: { kind: 'archway', widthIn: 48, heightIn: 84 } },
  { label: 'Missing wall', opening: { kind: 'missing_wall', widthIn: 60, heightIn: 96 } },
];

const KIND_LABELS: Record<Opening['kind'], string> = {
  door: 'Door',
  window: 'Window',
  archway: 'Archway',
  missing_wall: 'Missing wall',
};

export function OpeningsEditor({
  openings,
  onChange,
}: {
  openings: Opening[];
  onChange: (next: Opening[]) => void;
}) {
  const add = (opening: Opening) => onChange([...openings, { ...opening }]);
  const removeAt = (index: number) => onChange(openings.filter((_, i) => i !== index));

  return (
    <View style={styles.root}>
      <Label>Openings</Label>

      <View style={styles.presets}>
        {PRESETS.map((preset) => (
          <Chip key={preset.label} label={preset.label} onPress={() => add(preset.opening)} />
        ))}
      </View>

      {openings.length === 0 ? (
        <TypeText role="caption" tone="textFaint">
          Add doors and windows to deduct them from the wall area.
        </TypeText>
      ) : (
        <View style={styles.list}>
          {openings.map((opening, index) => (
            <View key={`${opening.kind}-${index}`} style={styles.row}>
              <View style={styles.rowMain}>
                <TypeText role="bodyStrong">{KIND_LABELS[opening.kind]}</TypeText>
                <TypeText role="caption" tone="textFaint">
                  {formatFeetInches(opening.widthIn)} &times; {formatFeetInches(opening.heightIn)}
                  {opening.count && opening.count > 1 ? ` · ${opening.count}×` : ''}
                </TypeText>
              </View>
              <Button label="Remove" variant="ghost" onPress={() => removeAt(index)} />
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.sm },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  list: { gap: space.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  rowMain: { flex: 1, gap: 2 },
});
