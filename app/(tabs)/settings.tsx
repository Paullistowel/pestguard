import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { radius, spacing, ThemeMode, useTheme } from '@/theme';
import { ScreenHeader } from '@/components/ScreenHeader';
import {
  Badge,
  Button,
  Card,
  Divider,
  InfoNote,
  KeyValue,
  ListGroup,
  Muted,
  Row,
  ScrollScreen,
  Section,
  SettingRow,
  Txt,
} from '@/components/ui';
import { SliderField, Toggle } from '@/components/Field';
import { IconChip } from '@/components/visual';
import { useStore } from '@/state/store';
import { useDevice } from '@/state/useDevice';
import {
  DB_ROOT,
  SUGGESTED_ESP32_ADDITIONS,
  THRESHOLD_DEFAULTS,
  THRESHOLD_RANGES,
  fieldExists,
  deviceHonoursSettings,
} from '@/services/firebase/schema';
import { RECOMMENDED_RULES, firebaseConfig } from '@/services/firebase/config';
import { osNotificationsAvailable } from '@/services/notifications';

const MODES: { key: ThemeMode; label: string }[] = [
  { key: 'system', label: 'System' },
  { key: 'dark', label: 'Dark' },
  { key: 'light', label: 'Light' },
];

/**
 * Settings — thresholds, system enable, and the truth about what the firmware
 * currently honours.
 *
 * Thresholds are written to Firebase but compared on the ESP32. The app never
 * decides whether something is a detection; it only stores the number the
 * device compares against, and shows the same number back so the two cannot
 * silently disagree.
 */
export default function Settings() {
  const { c, mode, setMode } = useTheme();
  const router = useRouter();
  const store = useStore();
  const d = useDevice();

  // Local slider state so dragging is smooth; the write happens on release.
  const [distance, setDistance] = useState<number | null>(null);
  const [sound, setSound] = useState<number | null>(null);
  const [showRules, setShowRules] = useState(false);
  const [showSketch, setShowSketch] = useState(false);

  // Adopt the device's values whenever it reports new ones, unless the user is
  // mid-drag — otherwise a slider would jump under the finger.
  useEffect(() => {
    if (distance === null && typeof d.node?.distanceThreshold === 'number') {
      setDistance(d.node.distanceThreshold);
    }
    if (sound === null && typeof d.node?.soundThreshold === 'number') {
      setSound(d.node.soundThreshold);
    }
  }, [d.node?.distanceThreshold, d.node?.soundThreshold, distance, sound]);

  const distanceValue = distance ?? d.node?.distanceThreshold ?? THRESHOLD_DEFAULTS.distance;
  const soundValue = sound ?? d.node?.soundThreshold ?? THRESHOLD_DEFAULTS.sound;

  const hasDistanceThreshold = fieldExists(d.node, 'distanceThreshold');
  const hasSoundThreshold = fieldExists(d.node, 'soundThreshold');
  const hasEnabled = fieldExists(d.node, 'enabled');
  const enabled = d.node?.enabled !== false;

  const writable = d.firebaseConnected;

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <ScreenHeader title="Settings" subtitle={d.deviceId} />

      <ScrollScreen>
        {/* ================= System ================= */}
        <Section title="System" style={{ marginTop: 0 }}>
          <Card>
            <Row justify="space-between" align="center">
              <View style={{ flex: 1, paddingRight: spacing.md }}>
                <Txt variant="h3">Deterrent enabled</Txt>
                <Muted variant="small" style={{ marginTop: 3, lineHeight: 18 }}>
                  {hasEnabled
                    ? 'The ESP32 reads this and suppresses all output when off.'
                    : 'Saved to Firebase, but this sketch does not read it yet — the hardware will keep running regardless.'}
                </Muted>
              </View>
              <Toggle value={enabled} disabled={!writable} onChange={(v) => d.setEnabled(v)} />
            </Row>

            {!hasEnabled ? (
              <View style={{ marginTop: spacing.lg }}>
                <Badge label="Not read by device" color={c.warning} bg={c.warningDim} small />
              </View>
            ) : null}
          </Card>
        </Section>

        {/* ================= Thresholds ================= */}
        <Section
          title="Detection thresholds"
          subtitle="Stored in Firebase; compared on the ESP32"
        >
          <Card>
            <SliderField
              label="Distance threshold"
              value={Math.round(distanceValue)}
              onChange={setDistance}
              min={THRESHOLD_RANGES.distance.min}
              max={THRESHOLD_RANGES.distance.max}
              step={THRESHOLD_RANGES.distance.step}
              unit=" cm"
              disabled={!writable}
              hint="An object closer than this counts as a detection. The ultrasonic sensor currently reads about
                    the value shown on the dashboard, so set this below your normal background distance."
            />
            <Row gap={spacing.md}>
              <Button
                label="Save distance"
                icon="save"
                small
                disabled={!writable || distance === null}
                onPress={() => d.setThreshold('distance', distanceValue)}
              />
              {!hasDistanceThreshold ? (
                <Badge label="Saved · device not confirming" color={c.warning} bg={c.warningDim} small />
              ) : (
                <Badge label="Confirmed by device" color={c.success} bg={c.successDim} small />
              )}
            </Row>

            <Divider />

            <SliderField
              label="Sound threshold"
              value={Math.round(soundValue)}
              onChange={setSound}
              min={THRESHOLD_RANGES.sound.min}
              max={THRESHOLD_RANGES.sound.max}
              step={THRESHOLD_RANGES.sound.step}
              disabled={!writable}
              hint="A reading above this counts as a detection. This is a raw sensor value, not decibels — set it
                    by watching the dashboard while making a representative noise."
            />
            <Row gap={spacing.md}>
              <Button
                label="Save sound"
                icon="save"
                small
                disabled={!writable || sound === null}
                onPress={() => d.setThreshold('sound', soundValue)}
              />
              {!hasSoundThreshold ? (
                <Badge label="Saved · device not confirming" color={c.warning} bg={c.warningDim} small />
              ) : (
                <Badge label="Confirmed by device" color={c.success} bg={c.successDim} small />
              )}
            </Row>

            {!hasDistanceThreshold || !hasSoundThreshold ? (
              <View style={{ marginTop: spacing.lg }}>
                <InfoNote tone="warning" title="These values are stored but not yet used">
                  Your sketch has its thresholds compiled in. Saving here writes the number to
                  Firebase, which is harmless, but the hardware will not change behaviour until it
                  reads the value back. The sketch addition below makes it live.
                </InfoNote>
              </View>
            ) : null}
          </Card>
        </Section>

        {/* ================= Firmware ================= */}
        <Section title="Firmware integration">
          <Card>
            <Row gap={spacing.md} align="flex-start">
              <IconChip icon="code-slash" color={c.info} />
              <View style={{ flex: 1 }}>
                <Txt variant="bodyStrong">Make the app fully two-way</Txt>
                <Muted variant="small" style={{ marginTop: 4, lineHeight: 19 }}>
                  Three additions unlock the rest: a heartbeat so online/offline is real, a
                  confirmed-state mirror so controls stop saying “unconfirmed”, and reading the
                  threshold values so these sliders take effect.
                </Muted>
              </View>
            </Row>

            <Button
              label={showSketch ? 'Hide code' : 'Show sketch additions'}
              icon="terminal"
              tone="neutral"
              full
              style={{ marginTop: spacing.lg }}
              onPress={() => setShowSketch((v) => !v)}
            />

            {showSketch ? (
              <>
                <View
                  style={{
                    marginTop: spacing.md,
                    backgroundColor: c.surfaceAlt,
                    borderRadius: radius.sm,
                    padding: spacing.md,
                  }}
                >
                  <Txt variant="mono" color={c.textMuted}>
                    {SUGGESTED_ESP32_ADDITIONS}
                  </Txt>
                </View>
                <Button
                  label="Copy"
                  icon="copy"
                  tone="ghost"
                  full
                  style={{ marginTop: spacing.md }}
                  onPress={async () => {
                    await Clipboard.setStringAsync(SUGGESTED_ESP32_ADDITIONS);
                    store.showToast('Sketch additions copied');
                  }}
                />
              </>
            ) : null}
          </Card>
        </Section>

        {/* ================= Connection ================= */}
        <Section title="Connection">
          <Card>
            <KeyValue
              columns={1}
              items={[
                { label: 'Database', value: firebaseConfig.databaseURL, mono: true },
                { label: 'Path', value: `${DB_ROOT}/${d.deviceId}`, mono: true },
                {
                  label: 'Firebase',
                  value: d.firebaseConnected ? 'Connected' : 'Offline',
                },
                { label: 'Device heartbeat', value: d.health },
              ]}
            />
          </Card>
        </Section>

        {/* ================= Security ================= */}
        <Section title="Security">
          <Card accent={c.danger}>
            <Row gap={spacing.md} align="flex-start">
              <IconChip icon="warning" color={c.danger} />
              <View style={{ flex: 1 }}>
                <Txt variant="h3">Database is publicly writable</Txt>
                <Muted variant="small" style={{ marginTop: 5, lineHeight: 19 }}>
                  Anyone who knows the URL can read your readings and switch your outputs. This is
                  the default for a new Realtime Database and is meant to be temporary.
                </Muted>
              </View>
            </Row>

            <Button
              label={showRules ? 'Hide rules' : 'Show rules to paste'}
              icon="shield-checkmark"
              tone="neutral"
              full
              style={{ marginTop: spacing.lg }}
              onPress={() => setShowRules((v) => !v)}
            />

            {showRules ? (
              <>
                <View
                  style={{
                    marginTop: spacing.md,
                    backgroundColor: c.surfaceAlt,
                    borderRadius: radius.sm,
                    padding: spacing.md,
                  }}
                >
                  <Txt variant="mono" color={c.textMuted}>
                    {RECOMMENDED_RULES}
                  </Txt>
                </View>
                <Button
                  label="Copy rules"
                  icon="copy"
                  tone="ghost"
                  full
                  style={{ marginTop: spacing.md }}
                  onPress={async () => {
                    await Clipboard.setStringAsync(RECOMMENDED_RULES);
                    store.showToast('Rules copied');
                  }}
                />
                <InfoNote tone="warning" title="Give the ESP32 credentials first">
                  These rules require an authenticated user. Your sketch writes anonymously, so it
                  will stop working the moment you apply them unless you give it a database secret
                  first.
                </InfoNote>
              </>
            ) : null}
          </Card>
        </Section>

        {/* ================= App ================= */}
        <Section title="App">
          <ListGroup>
            {MODES.map((m) => (
              <SettingRow
                key={m.key}
                icon={m.key === 'dark' ? 'moon' : m.key === 'light' ? 'sunny' : 'phone-portrait'}
                iconColor={mode === m.key ? c.primary : c.textMuted}
                title={m.label}
                onPress={() => setMode(m.key)}
                right={
                  <Badge
                    label={mode === m.key ? 'On' : ''}
                    color={mode === m.key ? c.primary : 'transparent'}
                    bg={mode === m.key ? c.primary + '1F' : 'transparent'}
                    small
                  />
                }
              />
            ))}
          </ListGroup>

          {!osNotificationsAvailable ? (
            <View style={{ marginTop: spacing.md }}>
              <InfoNote tone="info" title="Notification banners need a development build">
                Expo removed notification delivery from Expo Go in SDK 53. Everything in the app
                still works; you just will not get OS pop-ups on this build.
              </InfoNote>
            </View>
          ) : null}
        </Section>

        <Button
          label="Sign out"
          tone="ghost"
          icon="log-out"
          full
          style={{ marginTop: spacing.xl }}
          onPress={() => {
            store.signOut();
            router.replace('/(auth)/login');
          }}
        />

        <Muted variant="small" style={{ marginTop: spacing.lg, textAlign: 'center' }}>
          Pest Deterrent System · {d.deviceId}
        </Muted>
      </ScrollScreen>
    </View>
  );
}
