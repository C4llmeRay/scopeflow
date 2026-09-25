/**
 * A description a contractor can speak. Every photo description uses this, so
 * dictation is never more than one tap away from a text box that wants words.
 */

import { View } from 'react-native';

import { TextField } from '../../components/ui';
import { space } from '../../theme/tokens';
import { DictateButton } from './DictateButton';
import { speech } from '../notes/speech';

export function DescriptionField({
  label = 'Description',
  value,
  onChangeText,
  placeholder,
}: {
  label?: string;
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
}) {
  return (
    <View style={{ gap: space.sm }}>
      <TextField
        label={label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        hint={
          speech
            ? 'Tap Dictate and describe it out loud, or type.'
            : 'Tip: tap the microphone on your keyboard to dictate.'
        }
        multiline
      />
      <DictateButton value={value} onChange={onChangeText} />
    </View>
  );
}
