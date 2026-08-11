import React, { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { radius, spacing, useTheme } from '@/theme';
import { Button, InfoNote, Muted, Txt } from '@/components/ui';
import { TextField } from '@/components/Field';

export default function ForgotPassword() {
  const { c } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const submit = async () => {
    if (!email.includes('@')) {
      setError('Enter the email you registered with');
      return;
    }
    setError(undefined);
    setBusy(true);
    await new Promise((r) => setTimeout(r, 800));
    setBusy(false);
    setSent(true);
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.bg }}
      contentContainerStyle={{
        padding: spacing.xl,
        paddingTop: insets.top + spacing.lg,
      }}
      keyboardShouldPersistTaps="handled"
    >
      <Pressable onPress={() => router.back()} hitSlop={10} style={{ marginBottom: spacing.xl }}>
        <Ionicons name="arrow-back" size={22} color={c.text} />
      </Pressable>

      {sent ? (
        <View style={{ alignItems: 'center', paddingTop: spacing.xxl }}>
          <View
            style={{
              width: 62,
              height: 62,
              borderRadius: 31,
              backgroundColor: c.successDim,
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: spacing.xl,
            }}
          >
            <Ionicons name="mail-open" size={28} color={c.success} />
          </View>
          <Txt variant="h1" center>
            Check your inbox
          </Txt>
          <Muted style={{ marginTop: spacing.md, textAlign: 'center', lineHeight: 21 }}>
            If an account exists for {email}, a reset link is on its way. The link expires in 30
            minutes.
          </Muted>
          <View style={{ marginTop: spacing.xl, alignSelf: 'stretch', gap: spacing.md }}>
            <Button label="Back to sign in" onPress={() => router.replace('/(auth)/login')} full />
            <Button
              label="Send again"
              tone="ghost"
              onPress={() => setSent(false)}
              full
            />
          </View>
        </View>
      ) : (
        <>
          <View
            style={{
              width: 52,
              height: 52,
              borderRadius: radius.lg,
              backgroundColor: c.surfaceAlt,
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: spacing.lg,
            }}
          >
            <Ionicons name="key" size={24} color={c.textMuted} />
          </View>
          <Txt variant="h1">Reset your password</Txt>
          <Muted style={{ marginTop: spacing.sm, lineHeight: 21 }}>
            We will email you a link to set a new one. Your nodes keep running and deterring
            throughout — sign-in only gates the app, never the hardware.
          </Muted>

          <View style={{ gap: spacing.lg, marginTop: spacing.xl }}>
            <TextField
              label="Email"
              value={email}
              onChangeText={setEmail}
              placeholder="you@farm.com"
              keyboardType="email-address"
              icon="mail"
              error={error}
              returnKeyType="go"
              onSubmitEditing={submit}
            />
            <Button label="Send reset link" onPress={submit} loading={busy} full />
            <InfoNote tone="warning" title="Locked out with a node down?">
              Password recovery does not affect node operation, but it does block remote
              configuration. If a node needs disarming urgently, the physical reset button on the
              enclosure still works.
            </InfoNote>
          </View>
        </>
      )}
    </ScrollView>
  );
}
