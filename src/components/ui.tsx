/**
 * The component set the whole app is built from.
 *
 * Small on purpose. Building the room wizard against these first is what forces
 * them to be right, because it is the screen a contractor touches most.
 */

import type { ReactNode } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { MIN_TARGET, radius, space, type, type ThemeColors } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';

/* -------------------------------------------------------------------------- */
/* Text                                                                        */
/* -------------------------------------------------------------------------- */

type TypeRole = keyof typeof type;

export function TypeText({
  role = 'body',
  tone = 'text',
  style,
  numberOfLines,
  children,
}: {
  role?: TypeRole;
  tone?: keyof Pick<
    ThemeColors,
    'text' | 'textMuted' | 'textFaint' | 'accent' | 'danger' | 'success' | 'warn' | 'hivis'
  >;
  style?: StyleProp<TextStyle>;
  /** Truncates with an ellipsis rather than wrapping. */
  numberOfLines?: number;
  children: ReactNode;
}) {
  const c = useTheme();
  return (
    <Text numberOfLines={numberOfLines} style={[type[role] as TextStyle, { color: c[tone] }, style]}>
      {children}
    </Text>
  );
}

export function Label({ children }: { children: ReactNode }) {
  const c = useTheme();
  return (
    <Text style={[type.label as TextStyle, { color: c.textFaint, textTransform: 'uppercase' }]}>
      {children}
    </Text>
  );
}

/* -------------------------------------------------------------------------- */
/* Screen                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A screen with its primary action pinned to the bottom, in the thumb zone.
 * Nothing that must be tapped ever lives in the top quarter of the display.
 */
export function Screen({
  children,
  footer,
}: {
  children: ReactNode;
  footer?: ReactNode;
}) {
  const c = useTheme();
  return (
    <View style={[styles.screen, { backgroundColor: c.bg }]}>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.screenContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="none"
      >
        {children}
      </ScrollView>
      {footer ? (
        <View style={[styles.footer, { backgroundColor: c.surface, borderTopColor: c.border }]}>
          {footer}
        </View>
      ) : null}
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const c = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }, style]}>
      {children}
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Button                                                                      */
/* -------------------------------------------------------------------------- */

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  testID,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  disabled?: boolean;
  testID?: string;
}) {
  const c = useTheme();

  const background =
    variant === 'primary' ? c.accent : variant === 'secondary' ? c.surfaceAlt : 'transparent';
  const foreground =
    variant === 'primary' ? c.accentText : variant === 'danger' ? c.danger : c.text;

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: background,
          borderColor: variant === 'secondary' ? c.border : 'transparent',
          borderWidth: variant === 'secondary' ? 1 : 0,
          opacity: disabled ? 0.4 : pressed ? 0.85 : 1,
        },
      ]}
    >
      <Text style={[type.bodyStrong as TextStyle, { color: foreground }]}>{label}</Text>
    </Pressable>
  );
}

/* -------------------------------------------------------------------------- */
/* Chip                                                                        */
/* -------------------------------------------------------------------------- */

export function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
}) {
  const c = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected ? c.accent : c.surface,
          borderColor: selected ? c.accent : c.border,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <Text
        style={[
          type.body as TextStyle,
          { color: selected ? c.accentText : c.text, fontWeight: selected ? '600' : '400' },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/* -------------------------------------------------------------------------- */
/* Dimension field                                                             */
/* -------------------------------------------------------------------------- */

/**
 * One of the three fields that matter. Large target, numeric keyboard that does
 * not dismiss between fields, and the parsed value echoed underneath so a
 * contractor can see that 12'6" was understood as twelve foot six.
 */
export function DimensionField({
  label,
  value,
  onChangeText,
  onSubmitEditing,
  hint,
  error,
  placeholder = '12',
  autoFocus,
  testID,
}: {
  label: string;
  value: string;
  onChangeText: (next: string) => void;
  onSubmitEditing?: () => void;
  hint?: string | null;
  error?: string | null;
  placeholder?: string;
  autoFocus?: boolean;
  testID?: string;
}) {
  const c = useTheme();
  return (
    <View style={styles.field}>
      <Label>{label}</Label>
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmitEditing}
        placeholder={placeholder}
        placeholderTextColor={c.textFaint}
        // decimal-pad rather than numeric: contractors type 12.5 constantly,
        // and the feet-and-inches shapes are handled by the parser.
        keyboardType="decimal-pad"
        inputMode="decimal"
        returnKeyType="next"
        blurOnSubmit={false}
        autoFocus={autoFocus}
        selectTextOnFocus
        style={[
          type.numeric as TextStyle,
          styles.input,
          {
            backgroundColor: c.surface,
            borderColor: error ? c.danger : c.border,
            color: c.text,
          },
        ]}
      />
      {error ? (
        <TypeText role="caption" tone="danger">
          {error}
        </TypeText>
      ) : hint ? (
        <TypeText role="caption" tone="textFaint">
          {hint}
        </TypeText>
      ) : null}
    </View>
  );
}

/**
 * A compact labelled input for lists, where a full-size DimensionField would
 * make a five-material room scroll for a page and a half.
 */
export function InlineField({
  label,
  value,
  onChangeText,
  placeholder,
  error,
  suffix,
  keyboardType = 'decimal-pad',
  testID,
}: {
  label: string;
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
  error?: string | null;
  suffix?: string;
  keyboardType?: 'decimal-pad' | 'default';
  testID?: string;
}) {
  const c = useTheme();
  return (
    <View style={styles.inlineField}>
      <View style={styles.inlineRow}>
        <Text style={[type.body as TextStyle, { color: c.textMuted, flex: 1 }]}>{label}</Text>
        <TextInput
          testID={testID}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={c.textFaint}
          keyboardType={keyboardType}
          inputMode={keyboardType === 'decimal-pad' ? 'decimal' : 'text'}
          selectTextOnFocus
          style={[
            type.bodyStrong as TextStyle,
            styles.inlineInput,
            {
              backgroundColor: c.surfaceAlt,
              borderColor: error ? c.danger : c.border,
              color: c.text,
            },
          ]}
        />
        {suffix ? (
          <Text style={[type.caption as TextStyle, { color: c.textFaint, width: 28 }]}>
            {suffix}
          </Text>
        ) : null}
      </View>
      {error ? (
        <TypeText role="caption" tone="danger">
          {error}
        </TypeText>
      ) : null}
    </View>
  );
}

/**
 * A labelled text field at full width — a photo's name, a job's address. The
 * multiline form grows to fit a dictated description.
 */
export function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  hint,
  multiline,
  autoCapitalize = 'sentences',
  keyboardType = 'default',
  testID,
}: {
  label: string;
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
  hint?: string;
  multiline?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words';
  keyboardType?: 'default' | 'email-address' | 'phone-pad';
  testID?: string;
}) {
  const c = useTheme();
  return (
    <View style={styles.textField}>
      <Label>{label}</Label>
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={c.textFaint}
        multiline={multiline}
        textAlignVertical={multiline ? 'top' : 'center'}
        autoCapitalize={autoCapitalize}
        keyboardType={keyboardType}
        style={[
          type.body as TextStyle,
          multiline ? styles.notes : styles.textInput,
          { backgroundColor: c.surfaceAlt, borderColor: c.border, color: c.text },
        ]}
      />
      {hint ? (
        <TypeText role="caption" tone="textFaint">
          {hint}
        </TypeText>
      ) : null}
    </View>
  );
}

export function NotesField({
  value,
  onChangeText,
  placeholder = 'Anything worth remembering',
}: {
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
}) {
  const c = useTheme();
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={c.textFaint}
      multiline
      textAlignVertical="top"
      style={[
        type.body as TextStyle,
        styles.notes,
        { backgroundColor: c.surfaceAlt, borderColor: c.border, color: c.text },
      ]}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Derived quantities                                                          */
/* -------------------------------------------------------------------------- */

export function QuantityRow({
  label,
  value,
  unit,
  emphasis,
}: {
  label: string;
  value: string;
  unit: string;
  emphasis?: boolean;
}) {
  const c = useTheme();
  return (
    <View style={[styles.quantityRow, { borderBottomColor: c.border }]}>
      <Text style={[type.body as TextStyle, { color: c.textMuted }]}>{label}</Text>
      <View style={styles.quantityValue}>
        <Text
          style={[
            (emphasis ? type.bodyStrong : type.body) as TextStyle,
            { color: emphasis ? c.text : c.textMuted, fontVariant: ['tabular-nums'] },
          ]}
        >
          {value}
        </Text>
        <Text style={[type.caption as TextStyle, { color: c.textFaint, width: 26, textAlign: 'right' }]}>
          {unit}
        </Text>
      </View>
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Sync status                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Never says "no connection" as a failure. Offline is the default state of this
 * app, not an error, so the chip reports what is queued and gets on with it.
 */
export function SyncChip({
  pending,
  uploading = 0,
  thinking = 0,
  failed,
  online,
}: {
  pending: number;
  /** Photo and audio binaries still queued. */
  uploading?: number;
  /** Photos queued for the model to look at. */
  thinking?: number;
  failed: number;
  online: boolean;
}) {
  const c = useTheme();
  const queued = pending + uploading;

  const { text, fg, bg } = failed
    ? { text: `${failed} need attention`, fg: c.danger, bg: c.dangerSoft }
    : !online
      ? {
          text: queued ? `${queued} saved on phone` : 'Saved on phone',
          fg: c.warn,
          bg: c.warnSoft,
        }
      : pending
        ? { text: `Syncing ${pending}`, fg: c.accent, bg: c.accentSoft }
        : uploading
          ? {
              text: `${uploading} ${uploading === 1 ? 'photo' : 'photos'} uploading`,
              fg: c.accent,
              bg: c.accentSoft,
            }
          : thinking
            ? {
                text: `Reading ${thinking} ${thinking === 1 ? 'photo' : 'photos'}`,
                fg: c.accent,
                bg: c.accentSoft,
              }
            : { text: 'All synced', fg: c.success, bg: c.successSoft };

  return (
    <View style={[styles.syncChip, { backgroundColor: bg }]}>
      <View style={[styles.syncDot, { backgroundColor: fg }]} />
      <Text style={[type.caption as TextStyle, { color: fg, fontWeight: '600' }]}>{text}</Text>
    </View>
  );
}

/* -------------------------------------------------------------------------- */

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1 },
  screenContent: { padding: space.lg, paddingBottom: space.xxl, gap: space.lg },
  footer: {
    padding: space.lg,
    paddingBottom: space.xl,
    borderTopWidth: 1,
    gap: space.sm,
  },
  card: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.lg,
    gap: space.sm,
  },
  button: {
    minHeight: MIN_TARGET,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chip: {
    minHeight: MIN_TARGET,
    paddingHorizontal: space.lg,
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: radius.pill,
  },
  field: { gap: space.xs },
  input: {
    minHeight: 64,
    borderWidth: 2,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  inlineField: { gap: space.xs },
  inlineRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  inlineInput: {
    minHeight: MIN_TARGET,
    width: 116,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
    textAlign: 'right',
  },
  textField: { gap: space.xs },
  textInput: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
  },
  notes: {
    minHeight: 88,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: space.md,
  },
  quantityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: space.md,
  },
  quantityValue: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  syncChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  syncDot: { width: 8, height: 8, borderRadius: 4 },
});
