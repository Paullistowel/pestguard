import React, { useEffect, useRef } from 'react';
import {
  AccessibilityRole,
  Animated,
  Easing,
  Platform,
  Pressable,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { radius, spacing, useTheme } from '@/theme';
import { elevation, glass, motion, tint } from '@/theme/tokens';
import { Muted, Row, Txt } from './ui';

/**
 * Loading, empty, error and success states.
 *
 * These four are the states an app spends most of its life in and the ones
 * usually left as a spinner or a blank screen. Treating them as first-class
 * screens is most of what separates something that feels finished from
 * something that feels like a prototype.
 */

// ---------------------------------------------------------------------------
// Skeletons
// ---------------------------------------------------------------------------

/**
 * Shimmering placeholder.
 *
 * Shaped like the content it replaces, so the layout does not jump when data
 * arrives — a spinner tells you to wait, a skeleton tells you what is coming.
 */
export function Skeleton({
  width,
  height = 14,
  rounded = 6,
  style,
}: {
  width?: number | `${number}%`;
  height?: number;
  rounded?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { c } = useTheme();
  const shimmer = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(shimmer, {
          toValue: 0,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [shimmer]);

  return (
    <Animated.View
      accessibilityRole="progressbar"
      accessibilityLabel="Loading"
      style={[
        {
          width: width ?? '100%',
          height,
          borderRadius: rounded,
          backgroundColor: c.surfaceAlt,
          opacity: shimmer.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0.9] }),
        },
        style,
      ]}
    />
  );
}

/** Skeleton shaped like a metric tile, for the dashboard's first paint. */
export function SkeletonTile() {
  const { c } = useTheme();
  return (
    <View
      style={{
        flex: 1,
        flexBasis: 0,
        padding: spacing.md,
        gap: spacing.sm,
        borderRadius: radius.lg,
        backgroundColor: c.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: c.border,
      }}
    >
      <Skeleton width={30} height={30} rounded={10} />
      <Skeleton width="60%" height={26} />
      <Skeleton width="40%" height={10} />
    </View>
  );
}

/** Skeleton shaped like a list row. */
export function SkeletonRow() {
  return (
    <Row gap={spacing.md} style={{ paddingVertical: spacing.md, paddingHorizontal: spacing.lg }}>
      <Skeleton width={36} height={36} rounded={10} />
      <View style={{ flex: 1, gap: 7 }}>
        <Skeleton width="55%" height={13} />
        <Skeleton width="35%" height={10} />
      </View>
    </Row>
  );
}

export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  const { c } = useTheme();
  return (
    <View
      style={{
        padding: spacing.lg,
        gap: spacing.md,
        borderRadius: radius.lg,
        backgroundColor: c.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: c.border,
      }}
    >
      <Skeleton width="45%" height={16} />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} width={i === lines - 1 ? '70%' : '100%'} height={11} />
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Success
// ---------------------------------------------------------------------------

/** Check mark that draws itself in. Used after a config push or a pairing. */
export function SuccessCheck({
  size = 72,
  color,
  onDone,
}: {
  size?: number;
  color?: string;
  onDone?: () => void;
}) {
  const { c } = useTheme();
  const accent = color ?? c.success;
  const scale = useRef(new Animated.Value(0)).current;
  const ring = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (Platform.OS !== 'web') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
    Animated.sequence([
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, damping: 12, stiffness: 190 }),
      Animated.timing(ring, {
        toValue: 1,
        duration: 520,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start(() => onDone?.());
  }, [scale, ring, onDone]);

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View
        style={{
          position: 'absolute',
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 2,
          borderColor: accent,
          opacity: ring.interpolate({ inputRange: [0, 1], outputRange: [0.7, 0] }),
          transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [1, 1.6] }) }],
        }}
      />
      <Animated.View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: accent + '24',
          alignItems: 'center',
          justifyContent: 'center',
          transform: [{ scale }],
        }}
      >
        <Ionicons name="checkmark" size={size * 0.46} color={accent} />
      </Animated.View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

/**
 * Error state.
 *
 * Always names what failed and offers the next action. "Something went wrong"
 * with no retry is the single most common failure of an error screen — it
 * tells the user nothing and leaves them nowhere to go.
 */
export function ErrorState({
  title,
  detail,
  onRetry,
  retryLabel = 'Try again',
  icon = 'alert-circle',
}: {
  title: string;
  detail?: string;
  onRetry?: () => void;
  retryLabel?: string;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  const { c } = useTheme();
  return (
    <View style={{ alignItems: 'center', paddingVertical: spacing.xxl, paddingHorizontal: spacing.lg }}>
      <LinearGradient
        colors={tint(c.danger, 'medium')}
        style={{
          width: 74,
          height: 74,
          borderRadius: 26,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: spacing.lg,
        }}
      >
        <Ionicons name={icon} size={32} color={c.danger} />
      </LinearGradient>
      <Txt variant="h2" center>
        {title}
      </Txt>
      {detail ? (
        <Muted variant="body" style={{ marginTop: spacing.sm, textAlign: 'center', lineHeight: 21 }}>
          {detail}
        </Muted>
      ) : null}
      {onRetry ? (
        <View style={{ marginTop: spacing.xl }}>
          <PressableScale onPress={onRetry}>
            <Row
              gap={spacing.sm}
              style={{
                backgroundColor: c.surfaceAlt,
                paddingHorizontal: spacing.xl,
                paddingVertical: spacing.md,
                borderRadius: radius.pill,
              }}
            >
              <Ionicons name="refresh" size={16} color={c.text} />
              <Txt variant="bodyStrong">{retryLabel}</Txt>
            </Row>
          </PressableScale>
        </View>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Pressable with scale feedback
// ---------------------------------------------------------------------------

/**
 * Wraps anything in a press-scale + haptic. The scale is deliberately small —
 * 2.5% reads as responsive; more reads as a toy.
 */
export function PressableScale({
  children,
  onPress,
  onLongPress,
  disabled,
  style,
  haptic = 'light',
  accessibilityLabel,
  accessibilityRole = 'button',
}: {
  children: React.ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  haptic?: 'light' | 'medium' | 'none';
  accessibilityLabel?: string;
  accessibilityRole?: AccessibilityRole;
}) {
  const scale = useRef(new Animated.Value(1)).current;

  const to = (v: number) =>
    Animated.spring(scale, { toValue: v, useNativeDriver: true, ...motion.press }).start();

  return (
    <Pressable
      disabled={disabled}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      onPressIn={() => to(0.975)}
      onPressOut={() => to(1)}
      onLongPress={onLongPress}
      onPress={() => {
        if (haptic !== 'none' && Platform.OS !== 'web') {
          Haptics.impactAsync(
            haptic === 'medium'
              ? Haptics.ImpactFeedbackStyle.Medium
              : Haptics.ImpactFeedbackStyle.Light,
          ).catch(() => {});
        }
        onPress?.();
      }}
    >
      <Animated.View style={[{ transform: [{ scale }] }, style]}>{children}</Animated.View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Glass surface
// ---------------------------------------------------------------------------

export function GlassPanel({
  children,
  style,
  intensity = 'light',
  level = 2,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  intensity?: 'light' | 'heavy';
  level?: 0 | 1 | 2 | 3;
}) {
  const { c } = useTheme();
  return (
    <View
      style={[
        { borderRadius: radius.lg, overflow: 'hidden' },
        glass(c, intensity),
        elevation(level, c),
        style,
      ]}
    >
      {children}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Floating action button
// ---------------------------------------------------------------------------

export function Fab({
  icon,
  label,
  onPress,
  color,
  extended,
  style,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label?: string;
  onPress: () => void;
  color?: string;
  extended?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { c } = useTheme();
  const accent = color ?? c.primary;

  return (
    <PressableScale
      onPress={onPress}
      haptic="medium"
      accessibilityLabel={label ?? 'Action'}
      style={[
        {
          position: 'absolute',
          right: spacing.lg,
          bottom: spacing.xl,
          borderRadius: radius.pill,
          overflow: 'hidden',
        },
        elevation(3, c),
        style,
      ]}
    >
      <LinearGradient
        colors={[accent, accent + 'DD']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          height: 54,
          minWidth: 54,
          paddingHorizontal: extended && label ? spacing.lg : 0,
          justifyContent: 'center',
        }}
      >
        <Ionicons name={icon} size={24} color={c.primaryText} />
        {extended && label ? (
          <Txt variant="bodyStrong" color={c.primaryText}>
            {label}
          </Txt>
        ) : null}
      </LinearGradient>
    </PressableScale>
  );
}

// ---------------------------------------------------------------------------
// Sticky section header with a glass backdrop
// ---------------------------------------------------------------------------

export function StickyBar({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const { c } = useTheme();
  return (
    <View
      style={[
        {
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.md,
        },
        glass(c, 'heavy'),
        { borderWidth: 0, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
        style,
      ]}
    >
      {children}
    </View>
  );
}
