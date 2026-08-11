import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { radius, spacing, useTheme } from '@/theme';
import { Button, InfoNote, Muted, Row, Txt } from '@/components/ui';
import { TextField } from '@/components/Field';
import { useStore } from '@/state/store';
import { ROLE_META } from '@/services/permissions';
import { UserRole } from '@/types';

const ROLES: UserRole[] = ['owner', 'technician', 'supervisor'];

export default function Register() {
  const { c } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { signIn } = useStore();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [farm, setFarm] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('owner');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = async () => {
    const e: Record<string, string> = {};
    if (name.trim().length < 2) e.name = 'Enter your full name';
    if (!email.includes('@')) e.email = 'Enter a valid email address';
    if (password.length < 8) e.password = 'Use at least 8 characters';
    if (role === 'owner' && farm.trim().length < 2) e.farm = 'Name the farm you manage';
    setErrors(e);
    if (Object.keys(e).length) return;

    setBusy(true);
    await new Promise((r) => setTimeout(r, 700));
    await signIn(email, role);
    setBusy(false);
    router.replace('/(auth)/onboarding');
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: c.bg }}
    >
      <ScrollView
        contentContainerStyle={{
          padding: spacing.xl,
          paddingTop: insets.top + spacing.lg,
          paddingBottom: insets.bottom + spacing.xl,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable onPress={() => router.back()} hitSlop={10} style={{ marginBottom: spacing.xl }}>
          <Ionicons name="arrow-back" size={22} color={c.text} />
        </Pressable>

        <Txt variant="h1">Create your account</Txt>
        <Muted style={{ marginTop: spacing.sm, lineHeight: 21 }}>
          One account covers every node on a farm. Invite the rest of your team afterwards from
          Settings.
        </Muted>

        <View style={{ gap: spacing.lg, marginTop: spacing.xl }}>
          <TextField
            label="Full name"
            value={name}
            onChangeText={setName}
            placeholder="Akosua Danso"
            autoCapitalize="words"
            icon="person"
            error={errors.name}
          />
          <TextField
            label="Email"
            value={email}
            onChangeText={setEmail}
            placeholder="you@farm.com"
            keyboardType="email-address"
            icon="mail"
            error={errors.email}
          />
          <TextField
            label="Password"
            value={password}
            onChangeText={setPassword}
            placeholder="At least 8 characters"
            secure
            icon="lock-closed"
            error={errors.password}
            hint="Used to sign in on any device. Node configuration changes are logged against it."
          />

          <View style={{ gap: spacing.sm }}>
            <Muted variant="caption">YOUR ROLE</Muted>
            {ROLES.map((r) => {
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
                  <View
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: radius.sm,
                      backgroundColor: meta.color + '1F',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Ionicons name={meta.icon as never} size={17} color={meta.color} />
                  </View>
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

          {role === 'owner' ? (
            <TextField
              label="Farm name"
              value={farm}
              onChangeText={setFarm}
              placeholder="Adaklu Ridge Farm"
              autoCapitalize="words"
              icon="leaf"
              error={errors.farm}
            />
          ) : (
            <InfoNote tone="info">
              Technicians and supervisors join an existing farm. Ask the owner to send you an
              invite from Settings → Team &amp; Roles once you have registered.
            </InfoNote>
          )}

          <Button label="Create account" onPress={submit} loading={busy} full />

          <Row justify="center" gap={5}>
            <Muted variant="small">Already registered?</Muted>
            <Pressable onPress={() => router.replace('/(auth)/login')} hitSlop={8}>
              <Txt variant="smallStrong" color={c.primary}>
                Sign in
              </Txt>
            </Pressable>
          </Row>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
