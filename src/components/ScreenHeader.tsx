import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { radius, spacing, useTheme } from '@/theme';
import { useStore } from '@/state/store';
import { relativeTime } from '@/utils/format';
import { Dot, IconButton, Muted, Row, Txt } from './ui';

/** App bar with the live link indicator and the alerts bell. */
export function ScreenHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { unreadAlerts } = useStore();

  return (
    <View
      style={{
        paddingTop: insets.top + spacing.sm,
        paddingHorizontal: spacing.lg,
        paddingBottom: spacing.md,
        backgroundColor: c.bg,
      }}
    >
      <Row justify="space-between" align="flex-start">
        <View style={{ flex: 1 }}>
          <Txt variant="h1" numberOfLines={1}>
            {title}
          </Txt>
          {subtitle ? (
            <Muted variant="small" style={{ marginTop: 2 }} numberOfLines={1}>
              {subtitle}
            </Muted>
          ) : null}
        </View>
        <Row gap={spacing.sm}>
          {right}
          <IconButton
            icon="notifications"
            badge={unreadAlerts}
            label="Alerts"
            onPress={() => router.push('/alerts')}
          />
        </Row>
      </Row>
    </View>
  );
}

/**
 * Connection banner.
 *
 * Deliberately always-visible rather than a transient toast: whether the app is
 * showing live data or a cached snapshot changes how much you should trust
 * everything below it, so it belongs on screen, not in a notification that has
 * already disappeared.
 */
export function ConnectionBanner() {
  const { c } = useTheme();
  const router = useRouter();
  const { link, offlineMode, lastSync, pendingWrites } = useStore();

  const map = {
    connected: { color: c.success, label: 'Live', icon: 'wifi' as const },
    connecting: { color: c.warning, label: 'Connecting…', icon: 'sync' as const },
    degraded: {
      color: c.warning,
      label: 'Polling — live socket down',
      icon: 'cellular' as const,
    },
    offline: { color: c.danger, label: 'Node unreachable', icon: 'cloud-offline' as const },
  };
  const s = map[link.state];
  const showDetail = link.state !== 'connected' || pendingWrites > 0;

  if (!showDetail) {
    return (
      <Row gap={6} style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.sm }}>
        <Dot color={s.color} size={6} pulse />
        <Muted variant="caption">
          {`LIVE · ${link.broker || 'LAN'} · ${link.latencyMs} MS · ${link.messagesIn} EVENTS`}
        </Muted>
      </Row>
    );
  }

  return (
    <Pressable
      onPress={() => router.push('/settings/connectivity')}
      style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.sm }}
    >
      <Row
        gap={spacing.sm}
        style={{
          backgroundColor: s.color + '18',
          borderRadius: radius.sm,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: s.color + '3A',
        }}
      >
        <Ionicons name={s.icon} size={14} color={s.color} />
        <Txt variant="small" color={s.color} style={{ flex: 1 }}>
          {offlineMode
            ? 'Working offline — showing cached data'
            : link.state === 'offline'
              ? `Cannot reach the node · last seen ${relativeTime(lastSync)}`
              : s.label}
          {pendingWrites > 0
            ? ` · ${pendingWrites} change${pendingWrites === 1 ? '' : 's'} queued`
            : ''}
        </Txt>
        <Ionicons name="chevron-forward" size={13} color={s.color} />
      </Row>
    </Pressable>
  );
}
