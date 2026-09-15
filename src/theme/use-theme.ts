import { useColorScheme } from 'react-native';

import { colors, type ThemeColors } from './tokens';

/** The active palette. Follows the device, which follows the contractor. */
export function useTheme(): ThemeColors {
  return useColorScheme() === 'dark' ? colors.dark : colors.light;
}
