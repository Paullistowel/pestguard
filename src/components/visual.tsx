import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';
import { radius, spacing, useTheme } from '@/theme';
import { Muted, Row, Txt } from './ui';

/**
 * Motion and colour pieces shared across screens.
 *
 * Two rules keep this from becoming decoration:
 *  - Animation only ever encodes state. A pulse means a node is firing right
 *    now; a press-scale confirms a tap landed. Nothing loops for its own sake,
 *    because a screen that is always moving trains you to ignore movement, and
 *    movement is how this app says "look here".
 *  - Gradients are tints of a token colour, never new hues. The chart palette
 *    stays the validated one; these are surfaces behind it.
 */

// ---------------------------------------------------------------------------
// Pressable card with tactile feedback
// ---------------------------------------------------------------------------

export function TouchCard({
  children,
  onPress,
  style,
  accent,
  disabled,
  haptic = true,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  accent?: string;
  disabled?: boolean;
  haptic?: boolean;
}) {
  const { c } = useTheme();
  const scale = useRef(new Animated.Value(1)).current;

  const to = (v: number) =>
    Animated.spring(scale, {
      toValue: v,
      useNativeDriver: true,
      speed: 40,
      bounciness: 0,
    }).start();

  const body = (
    <Animated.View
      style={[
        {
          backgroundColor: c.surface,
          borderRadius: radius.lg,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: c.border,
          overflow: 'hidden',
          transform: [{ scale }],
        },
        style,
      ]}
    >
      {accent ? (
        <LinearGradient
          colors={[accent + '26', accent + '00']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      {accent ? (
        <View
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: 3,
            backgroundColor: accent,
          }}
        />
      ) : null}
      {children}
    </Animated.View>
  );

  if (!onPress || disabled) return body;

  return (
    <Pressable
      onPressIn={() => to(0.975)}
      onPressOut={() => to(1)}
      onPress={() => {
        if (haptic && Platform.OS !== 'web') {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
        onPress();
      }}
    >
      {body}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Gradient hero
// ---------------------------------------------------------------------------

export function GradientHero({
  colors,
  children,
  style,
}: {
  colors: [string, string];
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <LinearGradient
      colors={colors}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[{ borderRadius: radius.xl, padding: spacing.xl, overflow: 'hidden' }, style]}
    >
      {children}
    </LinearGradient>
  );
}

// ---------------------------------------------------------------------------
// Icon chip
// ---------------------------------------------------------------------------

export function IconChip({
  icon,
  color,
  size = 38,
  filled,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  size?: number;
  filled?: boolean;
}) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.32,
        backgroundColor: filled ? color : color + '1F',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Ionicons name={icon} size={size * 0.46} color={filled ? '#FFFFFF' : color} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Live pulse — only rendered when something is genuinely happening
// ---------------------------------------------------------------------------

export function LivePulse({ color, size = 10 }: { color: string; size?: number }) {
  const ring = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(ring, {
        toValue: 1,
        duration: 1600,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [ring]);

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View
        style={{
          position: 'absolute',
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
          opacity: ring.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] }),
          transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [1, 2.8] }) }],
        }}
      />
      <View
        style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Count-up number — draws the eye to a figure that just changed
// ---------------------------------------------------------------------------

export function CountUp({
  value,
  variant = 'display',
  color,
  suffix,
}: {
  value: number;
  variant?: 'display' | 'metric' | 'h1';
  color?: string;
  suffix?: string;
}) {
  const anim = useRef(new Animated.Value(value)).current;
  const [shown, setShown] = React.useState(value);

  useEffect(() => {
    const id = anim.addListener(({ value: v }) => setShown(Math.round(v)));
    Animated.timing(anim, {
      toValue: value,
      duration: 700,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
    return () => anim.removeListener(id);
  }, [value, anim]);

  return (
    <Txt variant={variant} color={color}>
      {shown}
      {suffix ?? ''}
    </Txt>
  );
}

// ---------------------------------------------------------------------------
// Progress ring, drawn properly
// ---------------------------------------------------------------------------

export function Gauge({
  value,
  size = 90,
  stroke = 9,
  color,
  track,
  label,
  sublabel,
}: {
  value: number;
  size?: number;
  stroke?: number;
  color: string;
  track?: string;
  label?: string;
  sublabel?: string;
}) {
  const { c } = useTheme();
  const clamped = Math.max(0, Math.min(1, value));
  // Twelve segments around the ring: enough to read as continuous, cheap
  // enough to render in a list without an SVG per row.
  const SEGMENTS = 24;
  const lit = Math.round(clamped * SEGMENTS);

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {Array.from({ length: SEGMENTS }).map((_, i) => {
        const angle = (i / SEGMENTS) * 360 - 90;
        return (
          <View
            key={i}
            style={{
              position: 'absolute',
              width: size,
              height: size,
              alignItems: 'center',
              transform: [{ rotate: `${angle}deg` }],
            }}
          >
            <View
              style={{
                width: stroke * 0.6,
                height: stroke,
                borderRadius: stroke / 2,
                backgroundColor: i < lit ? color : track ?? c.surfaceAlt,
              }}
            />
          </View>
        );
      })}
      <View style={{ alignItems: 'center' }}>
        {label ? (
          <Txt variant="h2" color={color}>
            {label}
          </Txt>
        ) : null}
        {sublabel ? <Muted variant="caption">{sublabel}</Muted> : null}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Staggered entrance — content settles rather than snapping in
// ---------------------------------------------------------------------------

export function FadeIn({
  children,
  delay = 0,
  style,
}: {
  children: React.ReactNode;
  delay?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: 1,
      duration: 380,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [anim, delay]);

  return (
    <Animated.View
      style={[
        {
          opacity: anim,
          transform: [
            { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) },
          ],
        },
        style,
      ]}
    >
      {children}
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------
// Segmented meter — a compact multi-part bar used for band energies and splits
// ---------------------------------------------------------------------------

export function SplitBar({
  segments,
  height = 10,
}: {
  segments: { value: number; color: string }[];
  height?: number;
}) {
  const { c } = useTheme();
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  return (
    <View
      style={{
        flexDirection: 'row',
        height,
        borderRadius: height / 2,
        overflow: 'hidden',
        backgroundColor: c.surfaceAlt,
        gap: 2,
      }}
    >
      {segments
        .filter((s) => s.value > 0)
        .map((s, i) => (
          <View
            key={i}
            style={{
              flex: s.value / total,
              backgroundColor: s.color,
              borderRadius: height / 2,
            }}
          />
        ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Empty state, with a gradient plate so a blank screen still feels designed
// ---------------------------------------------------------------------------

export function RichEmpty({
  icon,
  title,
  body,
  color,
  action,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body?: string;
  color?: string;
  action?: React.ReactNode;
}) {
  const { c } = useTheme();
  const accent = color ?? c.primary;
  return (
    <View style={{ alignItems: 'center', paddingVertical: spacing.xxl, paddingHorizontal: spacing.lg }}>
      <LinearGradient
        colors={[accent + '2E', accent + '08']}
        style={{
          width: 78,
          height: 78,
          borderRadius: 26,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: spacing.lg,
        }}
      >
        <Ionicons name={icon} size={34} color={accent} />
      </LinearGradient>
      <Txt variant="h2" center>
        {title}
      </Txt>
      {body ? (
        <Muted variant="body" style={{ marginTop: spacing.sm, textAlign: 'center', lineHeight: 21 }}>
          {body}
        </Muted>
      ) : null}
      {action ? <View style={{ marginTop: spacing.xl }}>{action}</View> : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Metric tile
// ---------------------------------------------------------------------------

export function MetricTile({
  icon,
  label,
  value,
  unit,
  color,
  delta,
  onPress,
  hint,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string | number;
  unit?: string;
  color: string;
  delta?: number;
  onPress?: () => void;
  hint?: string;
}) {
  const { c } = useTheme();
  const up = (delta ?? 0) > 0;

  return (
    // flexBasis 0 rather than the default `auto`: with auto, a tile holding a
    // longer hint claims more width than its neighbour, and a row of metrics
    // that should read as a set comes out visibly lopsided.
    <TouchCard onPress={onPress} style={{ flex: 1, flexBasis: 0 }} accent={color}>
      <View style={{ padding: spacing.md, gap: spacing.sm }}>
        <Row justify="space-between">
          <IconChip icon={icon} color={color} size={30} />
          {delta !== undefined && Number.isFinite(delta) && delta !== 0 ? (
            <Row gap={2}>
              <Ionicons
                name={up ? 'arrow-up' : 'arrow-down'}
                size={11}
                color={up ? c.warning : c.success}
              />
              <Txt variant="caption" color={up ? c.warning : c.success}>
                {Math.abs(delta * 100).toFixed(0)}%
              </Txt>
            </Row>
          ) : null}
        </Row>
        <View>
          <Row gap={3} align="baseline">
            <Txt variant="metric">{value}</Txt>
            {unit ? <Muted variant="small">{unit}</Muted> : null}
          </Row>
          <Muted variant="caption" style={{ marginTop: 2 }}>
            {label.toUpperCase()}
          </Muted>
        </View>
        {hint ? (
          <Muted variant="small" numberOfLines={2} style={{ lineHeight: 16 }}>
            {hint}
          </Muted>
        ) : null}
      </View>
    </TouchCard>
  );
}
