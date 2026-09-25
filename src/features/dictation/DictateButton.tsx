/**
 * The microphone button under a description, and what it shows while open.
 *
 * Speaking to a phone with no feedback feels like talking into a void — did it
 * hear me? — so the open microphone draws the voice: a rolling bar graph of the
 * last few seconds, the loudest moments lit as peaks, a ring on the stop button
 * that swells with the current level, and the time since it opened. Silence is
 * obvious too, which is how a contractor notices the mic is not picking them up.
 */

import { Pressable, StyleSheet, View } from 'react-native';

import { TypeText } from '../../components/ui';
import { MIN_TARGET, radius, space } from '../../theme/tokens';
import { useTheme } from '../../theme/use-theme';
import { formatElapsed, PEAK } from './merge';
import { METER_BARS, useDictation } from './useDictation';

const BAR_MAX = 36;
const BAR_MIN = 3;

export function DictateButton({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const dictation = useDictation(value, onChange);
  const c = useTheme();

  // Nothing to offer in Expo Go or a browser without a recogniser; the
  // keyboard's own microphone is still there.
  if (!dictation.available) return null;

  const open = dictation.phase !== 'idle';

  if (!open) {
    return (
      <View style={styles.idleWrap}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dictate the description"
          onPress={() => void dictation.start()}
          style={({ pressed }) => [
            styles.idle,
            { backgroundColor: c.surfaceAlt, borderColor: c.border, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <MicGlyph color={c.accent} />
          <TypeText role="bodyStrong">Dictate</TypeText>
        </Pressable>
        {dictation.problem ? (
          <TypeText role="caption" tone="danger">
            {dictation.problem}
          </TypeText>
        ) : null}
      </View>
    );
  }

  const latest = dictation.levels.at(-1) ?? 0;
  // Oldest on the left, so the voice scrolls in from the right.
  const bars = [
    ...Array.from({ length: METER_BARS - dictation.levels.length }, () => 0),
    ...dictation.levels,
  ];
  const listening = dictation.phase === 'listening';

  return (
    <View
      style={[styles.panel, { backgroundColor: c.surfaceAlt, borderColor: c.danger }]}
      accessibilityLiveRegion="polite"
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Stop dictating"
        onPress={dictation.stop}
        style={styles.stopHit}
      >
        {/* The ring breathes with the voice. */}
        <View
          style={[
            styles.ring,
            {
              borderColor: c.danger,
              opacity: 0.25 + latest * 0.6,
              transform: [{ scale: 1 + latest * 0.35 }],
            },
          ]}
        />
        <View style={[styles.stop, { backgroundColor: c.danger }]}>
          <View style={[styles.stopSquare, { backgroundColor: c.surface }]} />
        </View>
      </Pressable>

      <View style={styles.meterWrap}>
        <View style={styles.meter} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {bars.map((level, i) => (
            <View
              key={i}
              style={[
                styles.bar,
                {
                  height: BAR_MIN + level * (BAR_MAX - BAR_MIN),
                  backgroundColor: level >= PEAK ? c.danger : level > 0 ? c.accent : c.border,
                },
              ]}
            />
          ))}
        </View>
        <TypeText role="caption" tone="textMuted">
          {listening
            ? latest > 0.05
              ? 'Listening…'
              : 'Listening — speak when ready'
            : 'Opening the microphone…'}
        </TypeText>
      </View>

      <TypeText role="bodyStrong" tone="danger">
        {formatElapsed(dictation.elapsedMs)}
      </TypeText>
    </View>
  );
}

/** A microphone drawn from two shapes, so there is no icon font to load. */
function MicGlyph({ color }: { color: string }) {
  return (
    <View style={styles.glyph}>
      <View style={[styles.glyphHead, { backgroundColor: color }]} />
      <View style={[styles.glyphCup, { borderColor: color }]} />
      <View style={[styles.glyphStem, { backgroundColor: color }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  idleWrap: { gap: space.xs },
  idle: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: MIN_TARGET,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  panel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 2,
  },
  stopHit: { width: MIN_TARGET + 8, height: MIN_TARGET + 8, alignItems: 'center', justifyContent: 'center' },
  ring: {
    position: 'absolute',
    width: MIN_TARGET + 8,
    height: MIN_TARGET + 8,
    borderRadius: radius.pill,
    borderWidth: 3,
  },
  stop: {
    width: MIN_TARGET - 4,
    height: MIN_TARGET - 4,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopSquare: { width: 14, height: 14, borderRadius: 3 },
  meterWrap: { flex: 1, gap: space.xs },
  meter: { flexDirection: 'row', alignItems: 'center', height: BAR_MAX, gap: 2 },
  bar: { flex: 1, borderRadius: 2 },
  glyph: { width: 14, height: 20, alignItems: 'center' },
  glyphHead: { width: 8, height: 12, borderRadius: 4 },
  glyphCup: {
    position: 'absolute',
    top: 5,
    width: 14,
    height: 10,
    borderWidth: 2,
    borderTopWidth: 0,
    borderBottomLeftRadius: 7,
    borderBottomRightRadius: 7,
  },
  glyphStem: { width: 2, height: 5, marginTop: 1 },
});
