import React, { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { radius, spacing, type, useTheme } from '@/theme';
import { Muted, Row, Txt } from './ui';

export function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  secure,
  keyboardType,
  autoCapitalize = 'none',
  icon,
  error,
  hint,
  multiline,
  editable = true,
  onSubmitEditing,
  returnKeyType,
}: {
  label?: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  secure?: boolean;
  keyboardType?: 'default' | 'email-address' | 'numeric' | 'phone-pad';
  autoCapitalize?: 'none' | 'sentences' | 'words';
  icon?: keyof typeof Ionicons.glyphMap;
  error?: string;
  hint?: string;
  multiline?: boolean;
  editable?: boolean;
  onSubmitEditing?: () => void;
  returnKeyType?: 'done' | 'next' | 'go';
}) {
  const { c } = useTheme();
  const [focused, setFocused] = useState(false);
  const [reveal, setReveal] = useState(false);

  const borderColor = error ? c.danger : focused ? c.primary : c.border;

  return (
    <View style={{ gap: 6 }}>
      {label ? <Muted variant="caption">{label.toUpperCase()}</Muted> : null}
      <View
        style={{
          flexDirection: 'row',
          alignItems: multiline ? 'flex-start' : 'center',
          gap: spacing.sm,
          backgroundColor: c.surface,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor,
          paddingHorizontal: spacing.md,
          paddingVertical: multiline ? spacing.md : 0,
          opacity: editable ? 1 : 0.55,
        }}
      >
        {icon ? (
          <Ionicons name={icon} size={17} color={focused ? c.primary : c.textFaint} />
        ) : null}
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={c.textFaint}
          secureTextEntry={secure && !reveal}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          autoCorrect={false}
          multiline={multiline}
          editable={editable}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onSubmitEditing={onSubmitEditing}
          returnKeyType={returnKeyType}
          style={[
            type.body,
            {
              flex: 1,
              color: c.text,
              paddingVertical: multiline ? 0 : 14,
              minHeight: multiline ? 76 : undefined,
              textAlignVertical: multiline ? 'top' : 'center',
            },
          ]}
        />
        {secure ? (
          <Pressable onPress={() => setReveal((r) => !r)} hitSlop={8}>
            <Ionicons name={reveal ? 'eye-off' : 'eye'} size={17} color={c.textFaint} />
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <Row gap={4}>
          <Ionicons name="alert-circle" size={12} color={c.danger} />
          <Txt variant="small" color={c.danger}>
            {error}
          </Txt>
        </Row>
      ) : hint ? (
        <Muted variant="small">{hint}</Muted>
      ) : null}
    </View>
  );
}

/**
 * Slider without a native dependency on web: uses @react-native-community/slider
 * where available, and falls back to a tap-and-drag track elsewhere.
 */
export function SliderField({
  label,
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  unit,
  hint,
  color,
  disabled,
  marks,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  hint?: string;
  color?: string;
  disabled?: boolean;
  /** Optional reference marks, e.g. an AI-suggested value. */
  marks?: { value: number; label: string; color?: string }[];
}) {
  const { c } = useTheme();
  const [w, setW] = useState(0);
  const accent = color ?? c.primary;
  const frac = (value - min) / (max - min || 1);

  const pick = (x: number) => {
    if (disabled || !w) return;
    const t = Math.max(0, Math.min(1, x / w));
    const raw = min + t * (max - min);
    onChange(Math.round(raw / step) * step);
  };

  return (
    <View style={{ gap: spacing.sm, opacity: disabled ? 0.5 : 1 }}>
      <Row justify="space-between">
        <Txt variant="bodyStrong">{label}</Txt>
        <Txt variant="bodyStrong" color={accent}>
          {value}
          {unit ?? ''}
        </Txt>
      </Row>

      <View
        onLayout={(e) => setW(e.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => !disabled}
        onMoveShouldSetResponder={() => !disabled}
        onResponderGrant={(e) => pick(e.nativeEvent.locationX)}
        onResponderMove={(e) => pick(e.nativeEvent.locationX)}
        style={{ paddingVertical: 12 }}
      >
        <View style={{ height: 5, borderRadius: 3, backgroundColor: c.surfaceAlt }}>
          <View
            style={{
              width: `${Math.max(0, Math.min(100, frac * 100))}%`,
              height: '100%',
              borderRadius: 3,
              backgroundColor: accent,
            }}
          />
        </View>

        {marks?.map((m) => (
          <View
            key={m.label}
            style={{
              position: 'absolute',
              left: ((m.value - min) / (max - min || 1)) * w - 1,
              top: 6,
              alignItems: 'center',
            }}
          >
            <View
              style={{ width: 2, height: 17, borderRadius: 1, backgroundColor: m.color ?? c.warning }}
            />
          </View>
        ))}

        {/* 22px thumb keeps the touch target well above the 8px mark size. */}
        <View
          style={{
            position: 'absolute',
            left: Math.max(0, Math.min(w - 22, frac * w - 11)),
            top: 3.5,
            width: 22,
            height: 22,
            borderRadius: 11,
            backgroundColor: c.surfaceRaised,
            borderWidth: 2,
            borderColor: accent,
          }}
        />
      </View>

      {marks?.length ? (
        <Row gap={spacing.md} wrap>
          {marks.map((m) => (
            <Row key={m.label} gap={4}>
              <View
                style={{ width: 2, height: 10, backgroundColor: m.color ?? c.warning, borderRadius: 1 }}
              />
              <Muted variant="small">
                {m.label} ({m.value}
                {unit ?? ''})
              </Muted>
            </Row>
          ))}
        </Row>
      ) : null}

      {hint ? <Muted variant="small" style={{ lineHeight: 18 }}>{hint}</Muted> : null}
    </View>
  );
}

export function Toggle({
  value,
  onChange,
  disabled,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={() => !disabled && onChange(!value)}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      style={{
        width: 46,
        height: 27,
        borderRadius: 14,
        padding: 3,
        backgroundColor: value ? c.primary : c.surfaceAlt,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: value ? c.primary : c.border,
        opacity: disabled ? 0.4 : 1,
        justifyContent: 'center',
      }}
    >
      <View
        style={{
          width: 21,
          height: 21,
          borderRadius: 11,
          backgroundColor: value ? c.primaryText : c.textMuted,
          alignSelf: value ? 'flex-end' : 'flex-start',
        }}
      />
    </Pressable>
  );
}

/** Hour:minute picker built from two stepper columns — no native dependency. */
export function TimeField({
  label,
  minutes,
  onChange,
}: {
  label: string;
  minutes: number;
  onChange: (m: number) => void;
}) {
  const { c } = useTheme();
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;

  const bump = (deltaH: number, deltaM: number) => {
    const next = (((h + deltaH) * 60 + m + deltaM) % 1440 + 1440) % 1440;
    onChange(next);
  };

  const Stepper = ({
    value,
    onUp,
    onDown,
  }: {
    value: string;
    onUp: () => void;
    onDown: () => void;
  }) => (
    <View style={{ alignItems: 'center' }}>
      <Pressable onPress={onUp} hitSlop={6} style={{ padding: 3 }}>
        <Ionicons name="chevron-up" size={16} color={c.textMuted} />
      </Pressable>
      <Txt variant="h2" style={{ fontVariant: ['tabular-nums'] }}>
        {value}
      </Txt>
      <Pressable onPress={onDown} hitSlop={6} style={{ padding: 3 }}>
        <Ionicons name="chevron-down" size={16} color={c.textMuted} />
      </Pressable>
    </View>
  );

  return (
    <View style={{ gap: spacing.sm }}>
      <Muted variant="caption">{label.toUpperCase()}</Muted>
      <Row gap={spacing.sm} justify="center">
        <Stepper
          value={String(h).padStart(2, '0')}
          onUp={() => bump(1, 0)}
          onDown={() => bump(-1, 0)}
        />
        <Txt variant="h2" color={c.textFaint}>
          :
        </Txt>
        <Stepper
          value={String(m).padStart(2, '0')}
          onUp={() => bump(0, 15)}
          onDown={() => bump(0, -15)}
        />
      </Row>
    </View>
  );
}
