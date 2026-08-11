import React, { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ActivityIndicator, View } from 'react-native';
import { ThemeProvider, useTheme } from '@/theme';
import { StoreProvider, useStore } from '@/state/store';
import { ToastHost } from '@/components/ToastHost';

/**
 * Route gate.
 *
 * Auth state lives in the store and is hydrated from AsyncStorage, so on a cold
 * start we hold on a spinner until hydration resolves rather than flashing the
 * login screen at a user who is already signed in.
 */
function Gate({ children }: { children: React.ReactNode }) {
  const { hydrated, currentUser } = useStore();
  const segments = useSegments();
  const router = useRouter();
  const { c } = useTheme();

  useEffect(() => {
    if (!hydrated) return;
    const inAuth = segments[0] === '(auth)';
    if (!currentUser && !inAuth) router.replace('/(auth)/login');
    else if (currentUser && inAuth) router.replace('/(tabs)/dashboard');
  }, [hydrated, currentUser, segments, router]);

  if (!hydrated) {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={c.primary} />
      </View>
    );
  }
  return <>{children}</>;
}

function RootNavigator() {
  const { c, isDark } = useTheme();

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Gate>
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: c.bg },
            headerTintColor: c.text,
            headerTitleStyle: { fontSize: 17, fontWeight: '700' },
            headerShadowVisible: false,
            contentStyle: { backgroundColor: c.bg },
            animation: 'slide_from_right',
          }}
        >
          <Stack.Screen name="(auth)" options={{ headerShown: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        </Stack>
        <ToastHost />
      </Gate>
    </>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <StoreProvider>
            <RootNavigator />
          </StoreProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
