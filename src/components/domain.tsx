import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { radius, spacing, type, useTheme } from '@/theme';
import {
  Alert as AlertModel,
  DeterrentNode,
  NodeStatus,
  PestEvent,
  UserRole,
} from '@/types';
import { PEST_PROFILES } from '@/data/pests';
import { effectiveClass, effectiveConfidence } from '@/services/ai/classifier';
import { ROLE_META } from '@/services/permissions';
import {
  clockTime,
  compactNumber,
  relativeTime,
  signalBars,
  signalLabel,
  uptime,
} from '@/utils/format';
import { Badge, Card, Dot, Muted, Row, Txt } from './ui';
import { Sparkline, usePestColor } from './charts';

// ---------------------------------------------------------------------------
// Status primitives
// ---------------------------------------------------------------------------

export function useStatusColor() {
  const { c } = useTheme();
  return (s: NodeStatus) =>
    ({
      armed: c.statusArmed,
      deterring: c.statusDeterring,
      disarmed: c.statusDisarmed,
      offline: c.statusOffline,
      fault: c.statusFault,
    })[s];
}

export const STATUS_LABEL: Record<NodeStatus, string> = {
  armed: 'Armed',
  deterring: 'Deterring',
  disarmed: 'Disarmed',
  offline: 'Offline',
  fault: 'Fault',
};

export function StatusPill({ status, small }: { status: NodeStatus; small?: boolean }) {
  const color = useStatusColor()(status);
  return (
    <Badge
      label={STATUS_LABEL[status]}
      color={color}
      bg={color + '1F'}
      small={small}
      icon={
        status === 'armed'
          ? 'shield-checkmark'
          : status === 'deterring'
            ? 'radio'
            : status === 'offline'
              ? 'cloud-offline'
              : status === 'fault'
                ? 'alert-circle'
                : 'pause'
      }
    />
  );
}

export function SignalBars({ rssi, size = 14 }: { rssi: number; size?: number }) {
  const { c } = useTheme();
  const bars = signalBars(rssi);
  const color = bars >= 3 ? c.success : bars === 2 ? c.warning : c.danger;
  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 1.5, height: size }}
      accessibilityLabel={`Signal ${signalLabel(rssi)}`}
    >
      {[1, 2, 3, 4].map((i) => (
        <View
          key={i}
          style={{
            width: 2.5,
            height: (size / 4) * i,
            borderRadius: 1,
            backgroundColor: i <= bars ? color : c.surfaceAlt,
          }}
        />
      ))}
    </View>
  );
}

export function BatteryIcon({ pct, charging }: { pct: number; charging?: boolean }) {
  const { c } = useTheme();
  const color = pct <= 15 ? c.danger : pct <= 30 ? c.warning : c.success;
  return (
    <Row gap={5}>
      <View
        style={{
          width: 24,
          height: 12,
          borderRadius: 3,
          borderWidth: 1.2,
          borderColor: c.textFaint,
          padding: 1.5,
          justifyContent: 'center',
        }}
      >
        <View
          style={{
            width: `${Math.max(4, Math.min(100, pct))}%`,
            height: '100%',
            borderRadius: 1.5,
            backgroundColor: color,
          }}
        />
      </View>
      <Txt variant="smallStrong" color={color}>
        {Math.round(pct)}%
      </Txt>
      {charging ? <Ionicons name="sunny" size={12} color={c.warning} /> : null}
    </Row>
  );
}

// ---------------------------------------------------------------------------
// Stat tile
// ---------------------------------------------------------------------------

export function StatTile({
  label,
  value,
  unit,
  delta,
  icon,
  color,
  spark,
  onPress,
  hint,
}: {
  label: string;
  value: string | number;
  unit?: string;
  /** Signed ratio vs the previous window; rendered with an arrow + sign. */
  delta?: number;
  icon?: keyof typeof Ionicons.glyphMap;
  color?: string;
  spark?: number[];
  onPress?: () => void;
  hint?: string;
}) {
  const { c } = useTheme();
  const accent = color ?? c.text;
  const up = (delta ?? 0) > 0;

  return (
    <Card onPress={onPress} style={{ flex: 1 }} padded={false}>
      <View style={{ padding: spacing.md, gap: 6 }}>
        <Row justify="space-between">
          <Muted variant="caption">{label.toUpperCase()}</Muted>
          {icon ? <Ionicons name={icon} size={14} color={c.textFaint} /> : null}
        </Row>
        <Row gap={4} align="baseline">
          <Txt variant="metric" color={accent}>
            {value}
          </Txt>
          {unit ? <Muted variant="small">{unit}</Muted> : null}
        </Row>
        {delta !== undefined && Number.isFinite(delta) ? (
          <Row gap={3}>
            <Ionicons
              name={up ? 'trending-up' : delta === 0 ? 'remove' : 'trending-down'}
              size={12}
              color={delta === 0 ? c.textFaint : up ? c.warning : c.success}
            />
            <Muted variant="small">
              {delta === 0
                ? 'no change'
                : `${up ? '+' : ''}${(delta * 100).toFixed(0)}% vs previous`}
            </Muted>
          </Row>
        ) : hint ? (
          <Muted variant="small" numberOfLines={2}>
            {hint}
          </Muted>
        ) : null}
        {spark && spark.length > 1 ? (
          <View style={{ marginTop: 2 }}>
            <Sparkline data={spark} height={26} color={accent} />
          </View>
        ) : null}
      </View>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Node card
// ---------------------------------------------------------------------------

export function NodeCard({
  node,
  spark,
  onPress,
  compact,
}: {
  node: DeterrentNode;
  spark?: number[];
  onPress?: () => void;
  compact?: boolean;
}) {
  const { c } = useTheme();
  const statusColor = useStatusColor()(node.status);
  const router = useRouter();

  return (
    <Card
      accent={statusColor}
      onPress={onPress ?? (() => router.push(`/node/${node.id}`))}
      padded={false}
    >
      <View style={{ padding: spacing.lg, paddingLeft: spacing.lg + 3 }}>
        <Row justify="space-between" align="flex-start">
          <View style={{ flex: 1 }}>
            <Row gap={spacing.sm}>
              <Dot color={statusColor} pulse={node.status === 'deterring'} />
              <Txt variant="h3" numberOfLines={1}>
                {node.name}
              </Txt>
            </Row>
            <Muted variant="small" style={{ marginTop: 3 }}>
              {node.id} · {node.zone}
            </Muted>
          </View>
          <StatusPill status={node.status} small />
        </Row>

        {!compact ? (
          <>
            <Row justify="space-between" style={{ marginTop: spacing.lg }}>
              <BatteryIcon pct={node.batteryPct} charging={node.solarAssisted} />
              <Row gap={6}>
                <SignalBars rssi={node.rssi} />
                <Muted variant="small">
                  {node.link === 'gsm' ? 'GSM' : node.link === 'ble' ? 'BLE' : 'Wi-Fi'}
                </Muted>
              </Row>
              <Row gap={5}>
                <Ionicons name="pulse" size={13} color={c.textFaint} />
                <Muted variant="small">{relativeTime(node.lastDetection)}</Muted>
              </Row>
            </Row>

            {spark && spark.length > 1 ? (
              <View style={{ marginTop: spacing.md }}>
                <Sparkline data={spark} height={30} />
                <Muted variant="caption" style={{ marginTop: 4 }}>
                  DETECTIONS · LAST 14 DAYS
                </Muted>
              </View>
            ) : null}

            {node.queuedEvents > 0 ? (
              <View style={{ marginTop: spacing.md }}>
                <Badge
                  label={`${node.queuedEvents} events queued on gateway`}
                  icon="cloud-upload"
                  color={c.warning}
                  bg={c.warningDim}
                  small
                />
              </View>
            ) : null}
          </>
        ) : null}
      </View>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Event row
// ---------------------------------------------------------------------------

export function EventRow({
  event,
  nodeName,
  onPress,
  showNode = true,
}: {
  event: PestEvent;
  nodeName?: string;
  onPress?: () => void;
  showNode?: boolean;
}) {
  const { c } = useTheme();
  const pestColor = usePestColor();
  const router = useRouter();

  const isSystem = !['detect', 'deter'].includes(event.type);
  const cls = effectiveClass(event);
  const profile = PEST_PROFILES[cls];
  const conf = effectiveConfidence(event);

  const systemMeta: Record<string, { icon: keyof typeof Ionicons.glyphMap; label: string; color: string }> = {
    heartbeat: { icon: 'heart', label: 'Heartbeat', color: c.textFaint },
    offline: { icon: 'cloud-offline', label: 'Gateway offline', color: c.danger },
    online: { icon: 'cloud-done', label: 'Gateway online', color: c.success },
    config_ack: { icon: 'checkmark-done', label: 'Config applied', color: c.info },
    fault: { icon: 'alert-circle', label: 'Self-test fault', color: c.danger },
  };

  return (
    <Pressable
      onPress={onPress ?? (() => router.push(`/event/${event.id}`))}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        paddingVertical: spacing.md,
        paddingHorizontal: spacing.lg,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: radius.sm,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: isSystem ? c.surfaceAlt : pestColor(cls) + '24',
        }}
      >
        {isSystem ? (
          <Ionicons
            name={systemMeta[event.type]?.icon ?? 'ellipse'}
            size={16}
            color={systemMeta[event.type]?.color ?? c.textFaint}
          />
        ) : (
          <Txt variant="body">{profile.emoji}</Txt>
        )}
      </View>

      <View style={{ flex: 1 }}>
        <Row gap={spacing.sm}>
          <Txt variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
            {isSystem ? (systemMeta[event.type]?.label ?? event.type) : profile.label}
          </Txt>
          {event.type === 'deter' ? (
            <Ionicons name="radio" size={13} color={c.warning} />
          ) : null}
          {event.groundTruth === 'false_alarm' ? (
            <Badge label="False alarm" color={c.textFaint} small />
          ) : event.groundTruth ? (
            <Ionicons name="checkmark-circle" size={13} color={c.success} />
          ) : null}
        </Row>
        <Muted variant="small" style={{ marginTop: 2 }} numberOfLines={1}>
          {clockTime(event.ts)}
          {showNode && nodeName ? ` · ${nodeName}` : ''}
          {/* Just the number — the bar to the right of this row is the label,
              and spelling out "confidence" pushes the node name into an
              ellipsis on a narrow phone. */}
          {!isSystem ? ` · ${(conf * 100).toFixed(0)}%` : ''}
          {event.pendingSync ? ' · queued' : ''}
        </Muted>
      </View>

      {!isSystem ? (
        <View style={{ width: 44, alignItems: 'flex-end', gap: 4 }}>
          <View
            style={{
              width: 40,
              height: 4,
              borderRadius: 2,
              backgroundColor: c.surfaceAlt,
              overflow: 'hidden',
            }}
          >
            <View
              style={{
                width: `${Math.max(4, conf * 100)}%`,
                height: '100%',
                borderRadius: 2,
                backgroundColor: pestColor(cls),
              }}
            />
          </View>
        </View>
      ) : null}

      <Ionicons name="chevron-forward" size={16} color={c.textFaint} />
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Alert card
// ---------------------------------------------------------------------------

export function AlertCard({
  alert,
  nodeName,
  onPress,
  onDismiss,
}: {
  alert: AlertModel;
  nodeName?: string;
  onPress?: () => void;
  onDismiss?: () => void;
}) {
  const { c } = useTheme();

  const severityMap = {
    info: { color: c.info, bg: c.infoDim },
    warning: { color: c.warning, bg: c.warningDim },
    critical: { color: c.danger, bg: c.dangerDim },
  };
  const kindIcon: Record<AlertModel['kind'], keyof typeof Ionicons.glyphMap> = {
    detection: 'paw',
    predictive: 'trending-up',
    battery: 'battery-half',
    connectivity: 'cloud-offline',
    maintenance: 'construct',
    threshold: 'options',
  };
  const s = severityMap[alert.severity];

  return (
    <Card onPress={onPress} accent={alert.read ? undefined : s.color} padded={false}>
      <View style={{ padding: spacing.lg, paddingLeft: alert.read ? spacing.lg : spacing.lg + 3 }}>
        <Row align="flex-start" gap={spacing.md}>
          <View
            style={{
              width: 34,
              height: 34,
              borderRadius: radius.sm,
              backgroundColor: s.bg,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name={kindIcon[alert.kind]} size={17} color={s.color} />
          </View>

          <View style={{ flex: 1 }}>
            <Row justify="space-between" align="flex-start">
              <Txt variant="bodyStrong" style={{ flex: 1, paddingRight: spacing.sm }}>
                {alert.title}
              </Txt>
              {!alert.read ? <Dot color={s.color} size={7} /> : null}
            </Row>
            <Muted variant="small" style={{ marginTop: 4, lineHeight: 19 }}>
              {alert.body}
            </Muted>
            <Row justify="space-between" style={{ marginTop: spacing.sm }}>
              <Muted variant="caption">
                {relativeTime(alert.ts).toUpperCase()}
                {nodeName ? ` · ${nodeName.toUpperCase()}` : ''}
              </Muted>
              {onDismiss ? (
                <Pressable onPress={onDismiss} hitSlop={8}>
                  <Muted variant="caption">DISMISS</Muted>
                </Pressable>
              ) : null}
            </Row>
          </View>
        </Row>
      </View>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Schematic field map
// ---------------------------------------------------------------------------

/**
 * Farm map.
 *
 * Nodes are drawn on a normalised schematic rather than a tiled basemap: a
 * satellite tile of a maize field is visually noisy and tells a farmer nothing
 * they don't already know, whereas relative position plus status colour is the
 * whole question ("which corner is unprotected?"). It also keeps the app free
 * of a native map dependency and works offline, which a tile layer would not.
 * Real GPS coordinates are retained on every node and shown in the detail
 * sheet for anyone who needs to navigate to one.
 */
export function FieldMap({
  nodes,
  selectedId,
  onSelect,
  height = 300,
}: {
  nodes: DeterrentNode[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  height?: number;
}) {
  const { c } = useTheme();
  const statusColor = useStatusColor();
  const [w, setW] = React.useState(0);

  return (
    <View
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
      style={{
        height,
        borderRadius: radius.lg,
        backgroundColor: c.surfaceAlt,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: c.border,
        overflow: 'hidden',
      }}
    >
      {/* Field grid — a spatial reference, kept recessive. */}
      {Array.from({ length: 5 }).map((_, i) => (
        <View
          key={`h${i}`}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: (height / 5) * (i + 1),
            height: StyleSheet.hairlineWidth,
            backgroundColor: c.border,
          }}
        />
      ))}
      {Array.from({ length: 5 }).map((_, i) => (
        <View
          key={`v${i}`}
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: (w / 5) * (i + 1),
            width: StyleSheet.hairlineWidth,
            backgroundColor: c.border,
          }}
        />
      ))}

      {w > 0 &&
        nodes.map((n) => {
          const color = statusColor(n.status);
          const selected = selectedId === n.id;
          const x = n.mapX * (w - 56) + 12;
          const y = n.mapY * (height - 60) + 12;
          return (
            <Pressable
              key={n.id}
              onPress={() => onSelect?.(n.id)}
              style={{ position: 'absolute', left: x, top: y, alignItems: 'center' }}
            >
              {/* Coverage radius — roughly what one node's ultrasonic reaches. */}
              <View
                style={{
                  position: 'absolute',
                  width: 66,
                  height: 66,
                  borderRadius: 33,
                  backgroundColor: color + '14',
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: color + '3A',
                  left: -17,
                  top: -17,
                }}
              />
              <View
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  backgroundColor: c.surface,
                  borderWidth: selected ? 2.5 : 2,
                  borderColor: color,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons
                  name={
                    n.status === 'offline'
                      ? 'cloud-offline'
                      : n.status === 'deterring'
                        ? 'radio'
                        : n.status === 'disarmed'
                          ? 'pause'
                          : 'shield-checkmark'
                  }
                  size={14}
                  color={color}
                />
              </View>
              <View
                style={{
                  marginTop: 3,
                  paddingHorizontal: 5,
                  paddingVertical: 1.5,
                  borderRadius: radius.sm,
                  backgroundColor: c.surface + 'E6',
                }}
              >
                <Txt variant="caption" color={selected ? c.text : c.textMuted}>
                  {n.id.replace('PG-', '')}
                </Txt>
              </View>
            </Pressable>
          );
        })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

export function RoleBadge({ role }: { role: UserRole }) {
  const meta = ROLE_META[role];
  return (
    <Badge
      label={meta.label}
      color={meta.color}
      bg={meta.color + '1F'}
      icon={meta.icon as keyof typeof Ionicons.glyphMap}
      small
    />
  );
}

export function Avatar({
  name,
  color,
  size = 40,
}: {
  name: string;
  color: string;
  size?: number;
}) {
  const initials = name
    .split(' ')
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color + '2E',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Txt variant="bodyStrong" color={color} style={{ fontSize: size * 0.36 }}>
        {initials}
      </Txt>
    </View>
  );
}

export function NodeMetaStrip({ node }: { node: DeterrentNode }) {
  const { c } = useTheme();
  const items = [
    { icon: 'hardware-chip' as const, label: node.firmwareVersion },
    { icon: 'time' as const, label: uptime(node.uptimeSec) },
    { icon: 'wifi' as const, label: `${Math.round(node.rssi)} dBm` },
    { icon: 'flash' as const, label: `${node.batteryVolts.toFixed(2)} V` },
  ];
  return (
    <Row wrap gap={spacing.lg}>
      {items.map((it) => (
        <Row key={it.label} gap={5}>
          <Ionicons name={it.icon} size={12} color={c.textFaint} />
          <Muted variant="small">{it.label}</Muted>
        </Row>
      ))}
    </Row>
  );
}

export function CountPill({ count, label }: { count: number; label: string }) {
  const { c } = useTheme();
  return (
    <Row gap={5}>
      <Txt variant="bodyStrong">{compactNumber(count)}</Txt>
      <Muted variant="small">{label}</Muted>
    </Row>
  );
}
