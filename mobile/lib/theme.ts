import { useColorScheme } from 'react-native';

export const palette = {
  light: {
    bg: '#ffffff',
    surface: '#f4f4f5',
    surfaceAlt: '#fafafa',
    border: '#e4e4e7',
    text: '#18181b',
    textSub: '#52525b',
    textMuted: '#a1a1aa',
    placeholder: '#a1a1aa',
    inputBg: '#ffffff',
    onlineBg: '#dcfce7',
    onlineText: '#166534',
    offlineBg: '#fee2e2',
    offlineText: '#991b1b',
  },
  dark: {
    bg: '#09090b',
    surface: '#18181b',
    surfaceAlt: '#1c1c1e',
    border: '#3f3f46',
    text: '#fafafa',
    textSub: '#a1a1aa',
    textMuted: '#71717a',
    placeholder: '#71717a',
    inputBg: '#18181b',
    onlineBg: '#14532d',
    onlineText: '#86efac',
    offlineBg: '#450a0a',
    offlineText: '#fca5a5',
  },
};

export type ThemeColors = typeof palette.light;

export function useTheme(): ThemeColors {
  const scheme = useColorScheme();
  return scheme === 'dark' ? palette.dark : palette.light;
}
