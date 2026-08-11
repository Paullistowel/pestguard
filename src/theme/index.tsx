import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { darkPalette, lightPalette, Palette } from './colors';

export * from './colors';

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
  pill: 999,
} as const;

export const type = {
  display: { fontSize: 32, fontWeight: '700' as const, letterSpacing: -0.6 },
  h1: { fontSize: 24, fontWeight: '700' as const, letterSpacing: -0.4 },
  h2: { fontSize: 19, fontWeight: '700' as const, letterSpacing: -0.2 },
  h3: { fontSize: 16, fontWeight: '600' as const },
  body: { fontSize: 15, fontWeight: '400' as const },
  bodyStrong: { fontSize: 15, fontWeight: '600' as const },
  small: { fontSize: 13, fontWeight: '400' as const },
  smallStrong: { fontSize: 13, fontWeight: '600' as const },
  caption: { fontSize: 11, fontWeight: '600' as const, letterSpacing: 0.6 },
  mono: { fontSize: 12.5, fontFamily: 'Courier' as const },
  metric: { fontSize: 28, fontWeight: '700' as const, letterSpacing: -0.8 },
} as const;

export type ThemeMode = 'system' | 'dark' | 'light';

interface ThemeContextValue {
  c: Palette;
  mode: ThemeMode;
  setMode: (m: ThemeMode) => void;
  isDark: boolean;
}

const ThemeContext = createContext<ThemeContextValue>({
  c: darkPalette,
  mode: 'system',
  setMode: () => {},
  isDark: true,
});

const STORAGE_KEY = '@pestguard/theme-mode';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((v) => {
      if (v === 'dark' || v === 'light' || v === 'system') setModeState(v);
    });
  }, []);

  const setMode = (m: ThemeMode) => {
    setModeState(m);
    AsyncStorage.setItem(STORAGE_KEY, m).catch(() => {});
  };

  const isDark = mode === 'system' ? system !== 'light' : mode === 'dark';

  const value = useMemo<ThemeContextValue>(
    () => ({ c: isDark ? darkPalette : lightPalette, mode, setMode, isDark }),
    [isDark, mode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
