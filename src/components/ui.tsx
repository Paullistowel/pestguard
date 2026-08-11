import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControlProps,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';
import { radius, spacing, type, useTheme } from '@/theme';

/** Core presentational primitives. Everything else is composed from these. */

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

type TypeKey = keyof typeof type;

export function Txt({
  children,
  variant = 'body',
  color,
  style,
  numberOfLines,
  center,
}: {
  children: React.ReactNode;
  variant?: TypeKey;
  color?: string;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  center?: boolean;
}) {
  const { c } = useTheme();
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[
        type[variant] as TextStyle,
        { color: color ?? c.text },
        center && { textAlign: 'center' },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

export function Muted({
  children,
  variant = 'small',
  style,
  numberOfLines,
}: {
  children: React.ReactNode;
  variant?: TypeKey;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}) {
  const { c } = useTheme();
  return (
    <Txt variant={variant} color={c.textMuted} style={style} numberOfLines={numberOfLines}>
      {children}
    </Txt>
  );
}

/** All-caps section eyebrow. */
export function Eyebrow({ children, color }: { children: React.ReactNode; color?: string }) {
  const { c } = useTheme();
  return (
    <Text
      style={[
        type.caption,
        { color: color ?? c.textFaint, textTransform: 'uppercase', marginBottom: spacing.sm },
      ]}
    >
      {children}
    </Text>
  );
}

// ---------------------------------------------------------------------------
// Containers
// ---------------------------------------------------------------------------

export function Card({
  children,
  style,
  padded = true,
  onPress,
  accent,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
  onPress?: () => void;
  /** Left edge accent bar — used to colour-code by status or severity. */
  accent?: string;
}) {
  const { c } = useTheme();
  const body = (
    <View
      style={[
        {
          backgroundColor: c.surface,
          borderRadius: radius.lg,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: c.border,
          overflow: 'hidden',
        },
        style,
      ]}
    >
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
      <View style={padded ? { padding: spacing.lg } : undefined}>{children}</View>
    </View>
  );

  if (!onPress) return body;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => (pressed ? { opacity: 0.7 } : undefined)}>
      {body}
    </Pressable>
  );
}

export function Section({
  title,
  subtitle,
  action,
  children,
  style,
}: {
  title?: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[{ marginTop: spacing.xl }, style]}>
      {(title || action) && (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            marginBottom: spacing.md,
          }}
        >
          <View style={{ flex: 1, paddingRight: spacing.md }}>
            {title ? <Txt variant="h2">{title}</Txt> : null}
            {subtitle ? <Muted style={{ marginTop: 2 }}>{subtitle}</Muted> : null}
          </View>
          {action}
        </View>
      )}
      {children}
    </View>
  );
}

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  return (
    <View
      style={[{ height: StyleSheet.hairlineWidth, backgroundColor: c.border, marginVertical: spacing.md }, style]}
    />
  );
}

export function Row({
  children,
  style,
  gap = spacing.md,
  align = 'center',
  justify,
  wrap,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  gap?: number;
  align?: ViewStyle['alignItems'];
  justify?: ViewStyle['justifyContent'];
  wrap?: boolean;
}) {
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: align,
          justifyContent: justify,
          gap,
          flexWrap: wrap ? 'wrap' : 'nowrap',
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

export type ButtonTone = 'primary' | 'neutral' | 'danger' | 'ghost' | 'warning';

export function Button({
  label,
  onPress,
  tone = 'primary',
  icon,
  disabled,
  loading,
  small,
  full,
  style,
}: {
  label: string;
  onPress?: () => void;
  tone?: ButtonTone;
  icon?: keyof typeof Ionicons.glyphMap;
  disabled?: boolean;
  loading?: boolean;
  small?: boolean;
  full?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { c } = useTheme();

  const tones: Record<ButtonTone, { bg: string; fg: string; border?: string }> = {
    primary: { bg: c.primary, fg: c.primaryText },
    neutral: { bg: c.surfaceAlt, fg: c.text, border: c.border },
    danger: { bg: c.danger, fg: '#FFFFFF' },
    warning: { bg: c.warning, fg: c.scheme === 'dark' ? '#1A1200' : '#FFFFFF' },
    ghost: { bg: 'transparent', fg: c.text, border: c.border },
  };
  const t = tones[tone];
  const isOff = disabled || loading;

  return (
    <Pressable
      onPress={() => {
        if (isOff) return;
        if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress?.();
      }}
      disabled={isOff}
      style={({ pressed }) => [
        {
          backgroundColor: t.bg,
          borderRadius: radius.md,
          paddingVertical: small ? 9 : 14,
          paddingHorizontal: small ? spacing.md : spacing.lg,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: spacing.sm,
          borderWidth: t.border ? StyleSheet.hairlineWidth : 0,
          borderColor: t.border,
          opacity: isOff ? 0.45 : pressed ? 0.8 : 1,
          alignSelf: full ? 'stretch' : 'flex-start',
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={t.fg} />
      ) : icon ? (
        <Ionicons name={icon} size={small ? 15 : 17} color={t.fg} />
      ) : null}
      <Text style={[small ? type.smallStrong : type.bodyStrong, { color: t.fg }]}>{label}</Text>
    </Pressable>
  );
}

export function IconButton({
  icon,
  onPress,
  color,
  size = 20,
  badge,
  label,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
  color?: string;
  size?: number;
  badge?: number;
  label?: string;
}) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={label}
      accessibilityRole="button"
      hitSlop={8}
      style={({ pressed }) => ({
        width: size + 18,
        height: size + 18,
        borderRadius: radius.pill,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: c.surfaceAlt,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Ionicons name={icon} size={size} color={color ?? c.text} />
      {badge && badge > 0 ? (
        <View
          style={{
            position: 'absolute',
            top: -2,
            right: -2,
            minWidth: 17,
            height: 17,
            paddingHorizontal: 4,
            borderRadius: radius.pill,
            backgroundColor: c.danger,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 2,
            borderColor: c.bg,
          }}
        >
          <Text style={{ color: '#FFF', fontSize: 9, fontWeight: '700' }}>
            {badge > 99 ? '99+' : badge}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Badges & indicators
// ---------------------------------------------------------------------------

export function Badge({
  label,
  color,
  bg,
  icon,
  small,
}: {
  label: string;
  color?: string;
  bg?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  small?: boolean;
}) {
  const { c } = useTheme();
  const fg = color ?? c.textMuted;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: small ? 7 : 9,
        paddingVertical: small ? 2 : 4,
        borderRadius: radius.pill,
        backgroundColor: bg ?? c.surfaceAlt,
        alignSelf: 'flex-start',
      }}
    >
      {icon ? <Ionicons name={icon} size={small ? 10 : 12} color={fg} /> : null}
      <Text style={{ color: fg, fontSize: small ? 10 : 11.5, fontWeight: '700' }}>{label}</Text>
    </View>
  );
}

export function Dot({ color, size = 8, pulse }: { color: string; size?: number; pulse?: boolean }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        ...(pulse
          ? {
              shadowColor: color,
              shadowOpacity: 0.9,
              shadowRadius: 5,
              shadowOffset: { width: 0, height: 0 },
              elevation: 4,
            }
          : {}),
      }}
    />
  );
}

/** Horizontal confidence meter with a labelled value. */
export function ConfidenceBar({
  value,
  color,
  height = 6,
  showLabel = true,
  label,
}: {
  value: number;
  color?: string;
  height?: number;
  showLabel?: boolean;
  label?: string;
}) {
  const { c } = useTheme();
  const fill = color ?? (value >= 0.75 ? c.success : value >= 0.5 ? c.warning : c.danger);
  return (
    <View style={{ gap: 5 }}>
      {showLabel ? (
        <Row justify="space-between">
          <Muted variant="caption">{label ?? 'CONFIDENCE'}</Muted>
          <Txt variant="smallStrong" color={fill}>
            {(value * 100).toFixed(0)}%
          </Txt>
        </Row>
      ) : null}
      <View
        style={{
          height,
          borderRadius: height / 2,
          backgroundColor: c.surfaceAlt,
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            width: `${Math.max(2, Math.min(100, value * 100))}%`,
            height: '100%',
            backgroundColor: fill,
            borderRadius: height / 2,
          }}
        />
      </View>
    </View>
  );
}

export function ProgressRing({
  value,
  size = 64,
  stroke = 6,
  color,
  children,
}: {
  value: number;
  size?: number;
  stroke?: number;
  color?: string;
  children?: React.ReactNode;
}) {
  const { c } = useTheme();
  // Rendered with nested views rather than SVG so it stays cheap in long lists.
  const clamped = Math.max(0, Math.min(1, value));
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          position: 'absolute',
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: stroke,
          borderColor: c.surfaceAlt,
        }}
      />
      <View
        style={{
          position: 'absolute',
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: stroke,
          borderColor: 'transparent',
          borderTopColor: color ?? c.primary,
          borderRightColor: clamped > 0.25 ? color ?? c.primary : 'transparent',
          borderBottomColor: clamped > 0.5 ? color ?? c.primary : 'transparent',
          borderLeftColor: clamped > 0.75 ? color ?? c.primary : 'transparent',
          transform: [{ rotate: `${-90 + clamped * 360 * 0.02}deg` }],
        }}
      />
      {children}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  small,
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  small?: boolean;
}) {
  const { c } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: c.surfaceAlt,
        borderRadius: radius.md,
        padding: 3,
        gap: 3,
      }}
    >
      {options.map((o) => {
        const active = o.key === value;
        return (
          <Pressable
            key={o.key}
            onPress={() => onChange(o.key)}
            style={{
              flex: 1,
              paddingVertical: small ? 6 : 9,
              borderRadius: radius.sm,
              backgroundColor: active ? c.surfaceRaised : 'transparent',
              alignItems: 'center',
              ...(active
                ? { borderWidth: StyleSheet.hairlineWidth, borderColor: c.border }
                : {}),
            }}
          >
            <Text
              style={{
                fontSize: small ? 12 : 13,
                fontWeight: active ? '700' : '500',
                color: active ? c.text : c.textMuted,
              }}
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Chip({
  label,
  active,
  onPress,
  color,
  icon,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
  color?: string;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  const { c } = useTheme();
  const accent = color ?? c.primary;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        paddingHorizontal: spacing.md,
        paddingVertical: 7,
        borderRadius: radius.pill,
        backgroundColor: active ? accent + '26' : c.surfaceAlt,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: active ? accent : c.border,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      {icon ? <Ionicons name={icon} size={13} color={active ? accent : c.textMuted} /> : null}
      <Text
        style={{
          fontSize: 13,
          fontWeight: active ? '700' : '500',
          color: active ? accent : c.textMuted,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** Labelled settings row with an arbitrary right-hand control. */
export function SettingRow({
  icon,
  iconColor,
  title,
  subtitle,
  right,
  onPress,
  disabled,
  destructive,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  const { c } = useTheme();
  const fg = destructive ? c.danger : c.text;
  const content = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        paddingVertical: spacing.md,
        paddingHorizontal: spacing.lg,
        opacity: disabled ? 0.45 : 1,
      }}
    >
      {icon ? (
        <View
          style={{
            width: 32,
            height: 32,
            borderRadius: radius.sm,
            backgroundColor: (iconColor ?? c.textMuted) + '1F',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name={icon} size={17} color={iconColor ?? (destructive ? c.danger : c.textMuted)} />
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        <Text style={[type.body, { color: fg }]}>{title}</Text>
        {subtitle ? (
          <Text style={[type.small, { color: c.textMuted, marginTop: 2 }]}>{subtitle}</Text>
        ) : null}
      </View>
      {right ?? (onPress ? <Ionicons name="chevron-forward" size={17} color={c.textFaint} /> : null)}
    </View>
  );

  if (!onPress || disabled) return content;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => (pressed ? { opacity: 0.6 } : undefined)}>
      {content}
    </Pressable>
  );
}

export function ListGroup({ children }: { children: React.ReactNode }) {
  const { c } = useTheme();
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <View
      style={{
        backgroundColor: c.surface,
        borderRadius: radius.lg,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: c.border,
        overflow: 'hidden',
      }}
    >
      {items.map((child, i) => (
        <View key={i}>
          {i > 0 ? (
            <View
              style={{
                height: StyleSheet.hairlineWidth,
                backgroundColor: c.border,
                marginLeft: spacing.lg,
              }}
            />
          ) : null}
          {child}
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------

export function EmptyState({
  icon = 'file-tray-outline',
  title,
  body,
  action,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  body?: string;
  action?: React.ReactNode;
}) {
  const { c } = useTheme();
  return (
    <View style={{ alignItems: 'center', paddingVertical: spacing.xxl, paddingHorizontal: spacing.xl }}>
      <View
        style={{
          width: 56,
          height: 56,
          borderRadius: 28,
          backgroundColor: c.surfaceAlt,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: spacing.lg,
        }}
      >
        <Ionicons name={icon} size={26} color={c.textFaint} />
      </View>
      <Txt variant="h3" center>
        {title}
      </Txt>
      {body ? (
        <Muted style={{ marginTop: spacing.sm, textAlign: 'center', lineHeight: 20 }}>{body}</Muted>
      ) : null}
      {action ? <View style={{ marginTop: spacing.lg }}>{action}</View> : null}
    </View>
  );
}

export function InfoNote({
  children,
  tone = 'info',
  icon,
  title,
}: {
  children: React.ReactNode;
  tone?: 'info' | 'warning' | 'danger' | 'success';
  icon?: keyof typeof Ionicons.glyphMap;
  title?: string;
}) {
  const { c } = useTheme();
  const map = {
    info: { fg: c.info, bg: c.infoDim, icon: 'information-circle' as const },
    warning: { fg: c.warning, bg: c.warningDim, icon: 'warning' as const },
    danger: { fg: c.danger, bg: c.dangerDim, icon: 'alert-circle' as const },
    success: { fg: c.success, bg: c.successDim, icon: 'checkmark-circle' as const },
  };
  const t = map[tone];
  return (
    <View
      style={{
        flexDirection: 'row',
        gap: spacing.md,
        backgroundColor: t.bg,
        borderRadius: radius.md,
        padding: spacing.md,
      }}
    >
      <Ionicons name={icon ?? t.icon} size={17} color={t.fg} style={{ marginTop: 1 }} />
      <View style={{ flex: 1 }}>
        {title ? (
          <Text style={[type.smallStrong, { color: t.fg, marginBottom: 3 }]}>{title}</Text>
        ) : null}
        <Text style={[type.small, { color: c.text, lineHeight: 19, opacity: 0.92 }]}>
          {children}
        </Text>
      </View>
    </View>
  );
}

export function KeyValue({
  items,
  columns = 2,
}: {
  items: { label: string; value: React.ReactNode; mono?: boolean }[];
  columns?: number;
}) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
      {items.map((it, i) => (
        <View key={i} style={{ width: `${100 / columns}%`, paddingVertical: spacing.sm, paddingRight: spacing.md }}>
          <Text style={[type.caption, { color: c.textFaint, textTransform: 'uppercase' }]}>
            {it.label}
          </Text>
          {typeof it.value === 'string' || typeof it.value === 'number' ? (
            <Text
              style={[
                it.mono ? type.mono : type.bodyStrong,
                { color: c.text, marginTop: 3 },
              ]}
            >
              {it.value}
            </Text>
          ) : (
            <View style={{ marginTop: 3 }}>{it.value}</View>
          )}
        </View>
      ))}
    </View>
  );
}

export function ScrollScreen({
  children,
  contentStyle,
  refreshControl,
}: {
  children: React.ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
  // React 19 defaults ReactElement's props to `unknown`, so ScrollView's
  // refreshControl slot needs the element's prop type spelled out.
  refreshControl?: React.ReactElement<RefreshControlProps>;
}) {
  const { c } = useTheme();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.bg }}
      contentContainerStyle={[
        { padding: spacing.lg, paddingBottom: spacing.xxxl * 2 },
        contentStyle,
      ]}
      showsVerticalScrollIndicator={false}
      refreshControl={refreshControl}
    >
      {children}
    </ScrollView>
  );
}
