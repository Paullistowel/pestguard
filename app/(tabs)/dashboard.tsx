import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { radius, spacing, useTheme } from '@/theme';
import { tint } from '@/theme/tokens';
import { ScreenHeader } from '@/components/ScreenHeader';
import {
  Badge,
  Button,
  Card,
  Divider,
  InfoNote,
  Muted,
  Row,
  ScrollScreen,
  Section,
  Txt,
} from '@/components/ui';
import { Toggle } from '@/components/Field';
import { FadeIn, Gauge, IconChip, LivePulse } from '@/components/visual';
import { ErrorState, SkeletonCard, SkeletonTile } from '@/components/feedback';
import { CommandState } from '@/state/useDevice';
import { useDeviceState } from '@/state/DeviceProvider';
import {
  ACTUATORS,
  SENSORS,
  SensorMeta,
  THRESHOLD_DEFAULTS,
  deviceHonoursSettings,
} from '@/services/firebase/schema';
import { relativeTime } from '@/utils/format';

/**
 * Dashboard — the whole system on one screen.
 *
 * Ordered by the questions a user actually opens the app to answer: is it
 * running, what is it seeing, what is switched on, and can I intervene. Nothing
 * here is derived, predicted or averaged — every value is a field the ESP32
 * writes, or a control that writes one back.
 */
export default function Dashboard() {
  const { c, isDark } = useTheme();
  const router = useRouter();
  const d = useDeviceState();

  const tone: Record<string, string> = {
    danger: c.danger,
    warning: c.warning,
    info: c.info,
    primary: c.primary,
  };

  const health = {
    online: { color: c.success, label: 'Online', icon: 'checkmark-circle' as const },
    stale: { color: c.warning, label: 'Stale', icon: 'time' as const },
    offline: { color: c.danger, label: 'Offline', icon: 'cloud-offline' as const },
    unknown: { color: c.textFaint, label: 'No heartbeat', icon: 'help-circle' as const },
  }[d.health];

  // The device only reports `enabled` once the sketch reads it. Until then the
  // switch is still useful — it writes the value — but it cannot claim the
  // system is actually disabled.
  const hasEnabled = deviceHonoursSettings(d.node);
  const enabled = d.node?.enabled !== false;

  const distanceThreshold = d.node?.distanceThreshold ?? THRESHOLD_DEFAULTS.distance;
  const soundThreshold = d.node?.soundThreshold ?? THRESHOLD_DEFAULTS.sound;

  const distance = d.node?.distance;
  const sound = d.node?.sound;

  const activeOutputs = ACTUATORS.filter((a) => d.actuatorValue(a.key));
  const controlsDisabled = !d.firebaseConnected || d.health === 'offline';

  /*
   * DETECTION IS DECIDED FROM THE THRESHOLDS
   *
   * The headline state is computed here, from the live readings against the
   * thresholds you set — not from the device's `status` field or its outputs.
   * That is a deliberate choice for this deployment: the sketch does not
   * update `status` as conditions change, so trusting it would leave the
   * dashboard reading "Armed" while a sensor sat well past its trigger point.
   *
   * The device still owns what the *hardware* does. This governs what the
   * dashboard reports, and the two can disagree — which is surfaced below
   * rather than hidden, because that disagreement is usually the sign that the
   * sketch is still using its own compiled-in thresholds.
   */
  // Distance triggers when the reading is ABOVE the threshold.
  const nearThreshold = typeof distance === 'number' && distance > distanceThreshold;
  const loudThreshold = typeof sound === 'number' && sound > soundThreshold;
  const anyDetection = nearThreshold || loudThreshold;

  // What the device itself reports, kept only so a mismatch can be surfaced.
  const deviceStatus = (d.node?.status ?? '').toLowerCase();
  const deviceSaysDetecting =
    deviceStatus.includes('detect') ||
    deviceStatus.includes('alert') ||
    deviceStatus.includes('deter') ||
    activeOutputs.length > 0;
  const appDisagrees = anyDetection !== deviceSaysDetecting;

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <ScreenHeader
        title="Pest Deterrent"
        subtitle={d.deviceId}
        right={
          <Ionicons
            name="settings-outline"
            size={20}
            color={c.text}
            onPress={() => router.push('/(tabs)/settings')}
          />
        }
      />

      <ScrollScreen>
        {/* ================= System status ================= */}
        <FadeIn>
          <LinearGradient
            colors={
              anyDetection
                ? (isDark ? [c.danger + '2E', c.surface] : [c.danger + '1F', c.surface])
                : (isDark ? [health.color + '26', c.surface] : [health.color + '1A', c.surface])
            }
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{
              borderRadius: radius.xl,
              padding: spacing.lg,
              borderWidth: 1,
              borderColor: c.border,
            }}
          >
            <Row justify="space-between" align="flex-start">
              <View style={{ flex: 1 }}>
                <Row gap={spacing.sm}>
                  <Muted variant="caption">SYSTEM</Muted>
                  {d.health === 'online' ? <LivePulse color={c.success} size={7} /> : null}
                </Row>
                <Txt
                  variant="display"
                  color={anyDetection ? c.danger : enabled ? c.success : c.textMuted}
                  style={{ marginTop: spacing.sm }}
                >
                  {anyDetection ? 'Detection' : enabled ? 'Armed' : 'Disabled'}
                </Txt>
                <Row gap={spacing.sm} wrap style={{ marginTop: spacing.sm }}>
                  <Badge
                    label={health.label}
                    icon={health.icon}
                    color={health.color}
                    bg={health.color + '1F'}
                    small
                  />
                  <Badge
                    label={d.firebaseConnected ? 'Firebase live' : 'Firebase offline'}
                    icon={d.firebaseConnected ? 'cloud-done' : 'cloud-offline'}
                    color={d.firebaseConnected ? c.success : c.danger}
                    bg={c.surfaceAlt}
                    small
                  />
                  {d.node?.status ? <Badge label={d.node.status} small /> : null}
                </Row>
              </View>
              <IconChip
                icon={anyDetection ? 'warning' : 'shield-checkmark'}
                color={anyDetection ? c.danger : health.color}
                size={48}
              />
            </Row>

            <Divider />

            <Row justify="space-between" align="flex-start">
              <View style={{ flexShrink: 0, paddingRight: spacing.md }}>
                <Muted variant="caption">LAST UPDATE</Muted>
                <Txt variant="smallStrong" style={{ marginTop: 3 }}>
                  {d.node?.lastUpdate
                    ? relativeTime(
                        d.node.lastUpdate < 1e11 ? d.node.lastUpdate * 1000 : d.node.lastUpdate,
                      )
                    : 'never'}
                </Txt>
              </View>
              {/* Flexes and truncates: four output names easily exceed the card. */}
              <View style={{ flex: 1, minWidth: 0, alignItems: 'flex-end' }}>
                <Muted variant="caption">ACTIVE OUTPUTS</Muted>
                <Txt
                  variant="smallStrong"
                  numberOfLines={2}
                  style={{ marginTop: 3, textAlign: 'right' }}
                >
                  {activeOutputs.length
                    ? activeOutputs.length === ACTUATORS.length
                      ? 'All outputs'
                      : activeOutputs.map((a) => a.label).join(', ')
                    : 'none'}
                </Txt>
              </View>
            </Row>
          </LinearGradient>
        </FadeIn>

        {/* ================= Errors / connectivity ================= */}
        {d.error ? (
          <View style={{ marginTop: spacing.lg }}>
            <Card>
              <ErrorState
                title="Cannot reach the database"
                detail={d.error}
                onRetry={() => d.selectDevice(d.deviceId)}
              />
            </Card>
          </View>
        ) : null}

        {!d.firebaseConnected && !d.error && !d.loading ? (
          <View style={{ marginTop: spacing.lg }}>
            <InfoNote tone="danger" title="No connection to Firebase">
              Readings below are the last values received. Controls are disabled until the
              connection returns — a switch that looks like it worked and silently did nothing is
              worse than one that refuses.
            </InfoNote>
          </View>
        ) : null}

        {d.health === 'unknown' && !d.loading && d.node ? (
          <View style={{ marginTop: spacing.lg }}>
            <InfoNote tone="warning" title="No sign of life from the device">
              `lastUpdate` is 0 and none of the sensor readings have changed since the app
              opened, so the ESP32 is probably not running. The values below are whatever was
              last written — they could be minutes or days old.
            </InfoNote>
          </View>
        ) : null}

        {d.health !== 'unknown' && !d.hasHeartbeat && !d.loading && d.node ? (
          <View style={{ marginTop: spacing.lg }}>
            <InfoNote tone="info" title="Liveness inferred from changing readings">
              The device does not write a heartbeat, so “online” here means its sensor values
              have changed recently rather than the device saying so. A still room can look like
              a stopped device. The heartbeat line in the sketch removes the guesswork.
            </InfoNote>
          </View>
        ) : null}

        {/* ================= Loading ================= */}
        {d.loading ? (
          <View style={{ marginTop: spacing.lg, gap: spacing.md }}>
            <Row gap={spacing.md}>
              <SkeletonTile />
              <SkeletonTile />
            </Row>
            <SkeletonCard lines={3} />
          </View>
        ) : null}

        {/* ================= Sensor readings ================= */}
        {!d.loading && d.node ? (
          <Section
            title="Sensor readings"
            subtitle="Values from the ESP32, compared against your thresholds"
          >
            <Row gap={spacing.md}>
              <SensorCard
                meta={SENSORS[0]}
                value={distance}
                threshold={distanceThreshold}
                triggered={nearThreshold}
                caption={nearThreshold ? 'Above trigger' : 'Below trigger'}
              />
              <SensorCard
                meta={SENSORS[1]}
                value={sound}
                threshold={soundThreshold}
                triggered={loudThreshold}
                caption={loudThreshold ? 'Above trigger' : 'Below trigger'}
              />
            </Row>

            {appDisagrees ? (
              <View style={{ marginTop: spacing.md }}>
                <InfoNote tone="info" title="App and device disagree">
                  The state above is computed from your thresholds. The ESP32 reports
                  “{d.node?.status ?? 'unknown'}” and has {activeOutputs.length} output
                  {activeOutputs.length === 1 ? '' : 's'} active. They differ because the sketch
                  still uses its own compiled-in thresholds — it will agree once it reads
                  `distanceThreshold` and `soundThreshold` from Firebase.
                </InfoNote>
              </View>
            ) : null}
          </Section>
        ) : null}

        {/* ================= Deterrent outputs ================= */}
        {!d.loading && d.node ? (
          <Section
            title="Deterrent outputs"
            subtitle={
              d.canConfirm
                ? 'State reported by the device'
                : 'Commands stored in Firebase — this sketch does not report what it applied'
            }
          >
            <View style={{ gap: spacing.md }}>
              {ACTUATORS.map((a, i) => (
                <FadeIn key={a.key} delay={i * 50}>
                  <OutputRow
                    icon={a.icon as never}
                    label={a.label}
                    description={a.description}
                    color={tone[a.tone]}
                    value={d.actuatorValue(a.key)}
                    command={d.commands[a.key]}
                    canConfirm={d.canConfirm}
                    disabled={controlsDisabled}
                    onChange={(v) => d.setActuator(a.key, v)}
                  />
                </FadeIn>
              ))}
            </View>
          </Section>
        ) : null}

        {/* ================= Quick controls ================= */}
        {!d.loading && d.node ? (
          <Section title="Quick controls">
            <Card>
              <Row justify="space-between" align="center">
                <View style={{ flex: 1, paddingRight: spacing.md }}>
                  <Txt variant="h3">System enabled</Txt>
                  <Muted variant="small" style={{ marginTop: 3, lineHeight: 18 }}>
                    {hasEnabled
                      ? 'The ESP32 reads this and suppresses all output when off.'
                      : 'Written to Firebase, but this device does not read it yet.'}
                  </Muted>
                </View>
                <Toggle
                  value={enabled}
                  disabled={controlsDisabled}
                  onChange={(v) => d.setEnabled(v)}
                />
              </Row>

              <Divider />

              <Row gap={spacing.md}>
                <Button
                  label="All outputs off"
                  icon="power"
                  tone="neutral"
                  disabled={controlsDisabled}
                  onPress={() => ACTUATORS.forEach((a) => d.setActuator(a.key, false))}
                  style={{ flex: 1 }}
                />
                <Button
                  label="Test outputs"
                  icon="flash"
                  tone="ghost"
                  disabled={controlsDisabled}
                  onPress={() => ACTUATORS.forEach((a) => d.setActuator(a.key, true))}
                  style={{ flex: 1 }}
                />
              </Row>

              <Button
                label="Thresholds & settings"
                icon="options"
                tone="ghost"
                full
                style={{ marginTop: spacing.md }}
                onPress={() => router.push('/(tabs)/settings')}
              />
            </Card>
          </Section>
        ) : null}

        {/* ================= Nothing there ================= */}
        {!d.loading && !d.node && !d.error ? (
          <Card style={{ marginTop: spacing.lg }}>
            <ErrorState
              icon="server-outline"
              title="No device data"
              detail={`Nothing exists at pestDetector/${d.deviceId}. Check the ESP32 has written to Firebase at least once.`}
            />
          </Card>
        ) : null}
      </ScrollScreen>
    </View>
  );
}

// ---------------------------------------------------------------------------

function SensorCard({
  meta,
  value,
  threshold,
  triggered,
  caption,
}: {
  meta: SensorMeta;
  value: number | undefined;
  threshold: number;
  triggered: boolean;
  caption: string;
}) {
  const { c } = useTheme();
  const has = typeof value === 'number' && Number.isFinite(value);
  const [lo, hi] = meta.range;
  const frac = has ? Math.max(0, Math.min(1, (value - lo) / (hi - lo || 1))) : 0;
  const color = triggered ? c.danger : c.info;

  return (
    <Card style={{ flex: 1, flexBasis: 0 }} padded={false}>
      <View style={{ padding: spacing.md, alignItems: 'center', gap: 6 }}>
        <Gauge
          value={frac}
          color={color}
          size={86}
          label={has ? String(Math.round(value)) : '—'}
          sublabel={meta.unit.toUpperCase() || undefined}
        />
        <Txt variant="smallStrong">{meta.label}</Txt>
        {triggered ? (
          <Badge label={caption} color={c.danger} bg={c.dangerDim} small />
        ) : (
          <Muted variant="caption">{has ? caption.toUpperCase() : 'NO DATA'}</Muted>
        )}
        <Muted variant="caption">
          {`TRIGGER > ${threshold}`}
        </Muted>
      </View>
    </Card>
  );
}

function OutputRow({
  icon,
  label,
  description,
  color,
  value,
  command,
  canConfirm,
  disabled,
  onChange,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  description: string;
  color: string;
  value: boolean;
  command?: CommandState;
  canConfirm: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  const { c } = useTheme();

  const status = (() => {
    switch (command?.status) {
      case 'sending':
        return { text: 'Sending…', color: c.textMuted, busy: true };
      case 'pending':
        return { text: 'Waiting for device…', color: c.warning, busy: true };
      case 'confirmed':
        return {
          text: command.desired ? 'ON · confirmed' : 'OFF · confirmed',
          color: c.success,
          busy: false,
        };
      case 'unconfirmed':
        // Saved is a fact — Firebase acknowledged the write. Whether the pin
        // moved is genuinely unknown, and saying so is the whole point.
        return {
          text: command.desired
            ? 'ON saved · device does not report outputs'
            : 'OFF saved · device does not report outputs',
          color: c.warning,
          busy: false,
        };
      case 'failed':
        return { text: command.error ?? 'Failed', color: c.danger, busy: false };
      case 'timeout':
        return { text: 'No response from device', color: c.danger, busy: false };
      default:
        if (canConfirm) {
          return {
            text: value ? 'ON · reported' : 'OFF · reported',
            color: value ? c.success : c.textMuted,
            busy: false,
          };
        }
        return {
          text: value ? 'ON (database)' : 'OFF (database)',
          color: value ? c.text : c.textMuted,
          busy: false,
        };
    }
  })();

  return (
    <View
      style={{
        borderRadius: radius.lg,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: value ? color + '55' : c.border,
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <LinearGradient
        colors={value ? tint(color, 'medium') : [c.surface, c.surface]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ padding: spacing.lg }}
      >
        <Row gap={spacing.md} align="flex-start">
          <IconChip icon={icon} color={color} filled={value} />
          <View style={{ flex: 1 }}>
            <Txt variant="h3">{label}</Txt>
            <Muted variant="small" style={{ marginTop: 3, lineHeight: 18 }}>
              {description}
            </Muted>
            <Row gap={6} style={{ marginTop: spacing.sm }}>
              {status.busy ? <ActivityIndicator size="small" color={status.color} /> : null}
              <Txt variant="smallStrong" color={status.color}>
                {status.text}
              </Txt>
            </Row>
          </View>
          <Toggle value={value} disabled={disabled} onChange={onChange} />
        </Row>
      </LinearGradient>
    </View>
  );
}
