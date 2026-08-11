import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { radius, spacing, useTheme } from '@/theme';
import { Button, Muted, Row, Txt } from '@/components/ui';
import { useStore } from '@/state/store';
import * as storage from '@/services/storage';

const SLIDES = [
  {
    icon: 'radio' as const,
    title: 'Your nodes, from anywhere',
    body: 'Every deterrent node reports detections, deterrent activity and battery health to your phone. No more walking the field to read a 16×2 LCD.',
    accentKey: 'primary' as const,
  },
  {
    icon: 'sparkles' as const,
    title: 'AI that earns its keep',
    body: 'A cloud classifier refines each detection into a species label with a confidence score, learns your nodes’ false-alarm patterns, and warns you about a rising infestation before it is visible.',
    accentKey: 'info' as const,
  },
  {
    icon: 'shield-checkmark' as const,
    title: 'The hardware stays in charge',
    body: 'The Nano’s own detector still fires the deterrent — instantly, offline, every time. The AI only refines what you see in the app. If the network drops, nothing stops working.',
    accentKey: 'warning' as const,
  },
  {
    icon: 'notifications' as const,
    title: 'Alerts worth reading',
    body: 'Cooldowns, batching and quiet hours mean you get told about the things that matter, not every cricket. Tune all of it in Settings.',
    accentKey: 'primary' as const,
  },
];

export default function Onboarding() {
  const { c } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { requireNotificationPermission } = useStore();
  const [index, setIndex] = useState(0);

  const finish = async () => {
    await storage.save(storage.KEYS.onboarded, true);
    await requireNotificationPermission();
    router.replace('/(tabs)/dashboard');
  };

  const slide = SLIDES[index];
  const accent = c[slide.accentKey];

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: c.bg,
        paddingTop: insets.top + spacing.xl,
        paddingBottom: insets.bottom + spacing.xl,
      }}
    >
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: spacing.xl }}
      >
        <View
          style={{
            width: 76,
            height: 76,
            borderRadius: radius.xl,
            backgroundColor: accent + '1F',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: spacing.xl,
          }}
        >
          <Ionicons name={slide.icon} size={36} color={accent} />
        </View>

        <Txt variant="display" style={{ lineHeight: 38 }}>
          {slide.title}
        </Txt>
        <Muted variant="body" style={{ marginTop: spacing.lg, lineHeight: 24 }}>
          {slide.body}
        </Muted>
      </ScrollView>

      <View style={{ paddingHorizontal: spacing.xl, gap: spacing.lg }}>
        <Row gap={6} justify="center">
          {SLIDES.map((_, i) => (
            <View
              key={i}
              style={{
                width: i === index ? 20 : 6,
                height: 6,
                borderRadius: 3,
                backgroundColor: i === index ? accent : c.surfaceAlt,
              }}
            />
          ))}
        </Row>

        <Row gap={spacing.md}>
          {index < SLIDES.length - 1 ? (
            <>
              <Button label="Skip" tone="ghost" onPress={finish} style={{ flex: 1 }} />
              <Button
                label="Next"
                icon="arrow-forward"
                onPress={() => setIndex((i) => i + 1)}
                style={{ flex: 2 }}
              />
            </>
          ) : (
            <Button
              label="Enable alerts & continue"
              icon="notifications"
              onPress={finish}
              full
              style={{ flex: 1 }}
            />
          )}
        </Row>
      </View>
    </View>
  );
}
