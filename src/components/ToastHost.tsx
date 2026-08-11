import React, { useEffect, useRef } from 'react';
import { Animated, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { radius, spacing, useTheme } from '@/theme';
import { useStore } from '@/state/store';
import { Txt } from './ui';

/** Single global toast, anchored above the tab bar. */
export function ToastHost() {
  const { toast } = useStore();
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const y = useRef(new Animated.Value(80)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(y, {
        toValue: toast ? 0 : 80,
        useNativeDriver: true,
        damping: 18,
        stiffness: 180,
      }),
      Animated.timing(opacity, {
        toValue: toast ? 1 : 0,
        duration: 160,
        useNativeDriver: true,
      }),
    ]).start();
  }, [toast, y, opacity]);

  const tone = toast?.tone ?? 'ok';
  const map = {
    ok: { color: c.success, icon: 'checkmark-circle' as const },
    error: { color: c.danger, icon: 'alert-circle' as const },
    info: { color: c.info, icon: 'information-circle' as const },
  }[tone];

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: spacing.lg,
        right: spacing.lg,
        bottom: insets.bottom + 78,
        transform: [{ translateY: y }],
        opacity,
      }}
    >
      {toast ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.md,
            backgroundColor: c.surfaceRaised,
            borderRadius: radius.md,
            paddingVertical: spacing.md,
            paddingHorizontal: spacing.lg,
            borderLeftWidth: 3,
            borderLeftColor: map.color,
            shadowColor: c.shadow,
            shadowOpacity: 0.3,
            shadowRadius: 14,
            shadowOffset: { width: 0, height: 6 },
            elevation: 8,
          }}
        >
          <Ionicons name={map.icon} size={18} color={map.color} />
          <Txt variant="small" style={{ flex: 1, lineHeight: 19 }}>
            {toast.message}
          </Txt>
        </View>
      ) : null}
    </Animated.View>
  );
}
