import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { spacing, radius, useTheme } from '@/theme';
import { Button, Divider, InfoNote, Muted, Row, Txt } from '@/components/ui';
import { TextField } from '@/components/Field';
import { useStore } from '@/state/store';
import { RoleBadge } from '@/components/domain';
import { ROLE_META } from '@/services/permissions';
import { UserRole } from '@/types';

export default function Login() {
  const { c } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { signIn } = useStore();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('owner');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const submit = async (as?: string) => {
    const target = as ?? email;
    if (!target.includes('@')) {
      setError('Enter a valid email address');
      return;
    }
    setError(undefined);
    setBusy(true);
    await new Promise((r) => setTimeout(r, 350));
    await signIn(target, role);
    setBusy(false);
    router.replace('/(tabs)/dashboard');
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: c.bg }}
    >
      <ScrollView
        contentContainerStyle={{
          padding: spacing.xl,
          paddingTop: insets.top + spacing.xxl,
          paddingBottom: insets.bottom + spacing.xl,
        }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Brand */}
        <View
          style={{
            width: 58,
            height: 58,
            borderRadius: radius.lg,
            backgroundColor: c.primary,
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: spacing.xl,
          }}
        >
          <Ionicons name="pulse" size={30} color={c.primaryText} />
        </View>

        <Txt variant="display">PestGuard</Txt>
        <Muted variant="body" style={{ marginTop: spacing.sm, lineHeight: 22 }}>
          Remote monitoring and AI analytics for your Acoustic Pest &amp; Rodent Deterrent nodes.
        </Muted>

        <View style={{ gap: spacing.lg, marginTop: spacing.xxl }}>
          <TextField
            label="Email"
            value={email}
            onChangeText={setEmail}
            placeholder="you@farm.com"
            keyboardType="email-address"
            icon="mail"
            error={error}
          />
          <TextField
            label="Password"
            value={password}
            onChangeText={setPassword}
            placeholder="Your password"
            secure
            icon="lock-closed"
            returnKeyType="go"
            onSubmitEditing={() => submit()}
          />

          <Row justify="flex-end">
            <Pressable onPress={() => router.push('/(auth)/forgot-password')} hitSlop={8}>
              <Txt variant="smallStrong" color={c.primary}>
                Forgot password?
              </Txt>
            </Pressable>
          </Row>

          <Button label="Sign in" onPress={() => submit()} loading={busy} full />

          <Row gap={spacing.md}>
            <View style={{ flex: 1 }}>
              <Divider style={{ marginVertical: 0 }} />
            </View>
            <Muted variant="caption">YOUR ROLE</Muted>
            <View style={{ flex: 1 }}>
              <Divider style={{ marginVertical: 0 }} />
            </View>
          </Row>

          {/*
            The account is local to this phone — there is no auth server,
            because the hardware is reached directly over the LAN. The role
            still matters: it decides who can arm a node or push a config
            change, and it labels who made each change.
          */}
          <View style={{ gap: spacing.sm }}>
            {(['owner', 'technician', 'supervisor'] as UserRole[]).map((r) => {
              const meta = ROLE_META[r];
              const active = role === r;
              return (
                <Pressable
                  key={r}
                  onPress={() => setRole(r)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: spacing.md,
                    padding: spacing.md,
                    borderRadius: radius.md,
                    backgroundColor: active ? meta.color + '14' : c.surface,
                    borderWidth: 1,
                    borderColor: active ? meta.color : c.border,
                  }}
                >
                  <Ionicons name={meta.icon as never} size={18} color={meta.color} />
                  <View style={{ flex: 1 }}>
                    <Txt variant="bodyStrong">{meta.label}</Txt>
                    <Muted variant="small" style={{ marginTop: 2, lineHeight: 17 }}>
                      {meta.blurb}
                    </Muted>
                  </View>
                  <Ionicons
                    name={active ? 'radio-button-on' : 'radio-button-off'}
                    size={19}
                    color={active ? meta.color : c.textFaint}
                  />
                </Pressable>
              );
            })}
          </View>

          <InfoNote tone="info" title="Everything here is your own data">
            There is no cloud account and no demo data. After signing in, pair your ESP32 and the
            app shows only what that board actually reports.
          </InfoNote>

          <Row justify="center" gap={5} style={{ marginTop: spacing.md }}>
            <Muted variant="small">New to PestGuard?</Muted>
            <Pressable onPress={() => router.push('/(auth)/register')} hitSlop={8}>
              <Txt variant="smallStrong" color={c.primary}>
                Create an account
              </Txt>
            </Pressable>
          </Row>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
