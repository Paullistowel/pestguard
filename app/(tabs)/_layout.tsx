import React from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet } from 'react-native';
import { useTheme } from '@/theme';

/**
 * Two tabs, deliberately.
 *
 * This is a monitoring and control panel for one device, not a management
 * platform. Everything the user opens the app to do lives on the Dashboard;
 * Settings holds the handful of values that change rarely. Extra tabs would be
 * navigation for its own sake.
 */
export default function TabsLayout() {
  const { c } = useTheme();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.primary,
        tabBarInactiveTintColor: c.textFaint,
        tabBarStyle: {
          backgroundColor: c.surface,
          borderTopColor: c.border,
          borderTopWidth: StyleSheet.hairlineWidth,
          height: 62,
          paddingTop: 6,
          paddingBottom: 8,
        },
        tabBarLabelStyle: { fontSize: 11.5, fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="dashboard"
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="speedometer" size={size - 2} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="options" size={size - 2} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
