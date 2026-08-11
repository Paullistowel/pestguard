import React, { createContext, useContext } from 'react';
import { UseDeviceResult, useDevice } from './useDevice';

/**
 * One device subscription for the whole app.
 *
 * Each `useDevice()` call opens its own Firebase listener, its own connection
 * watcher and its own command-timeout timers. Calling it from two screens meant
 * two live sockets on the same node, doubled read cost, and — worse — two
 * independent copies of the state that could briefly disagree: the Dashboard
 * showing a threshold the Settings screen had not received yet.
 *
 * Hoisting it here gives every screen the same instance, so what the user sees
 * on one tab is by construction what they see on the other.
 */

const DeviceContext = createContext<UseDeviceResult | null>(null);

export function DeviceProvider({ children }: { children: React.ReactNode }) {
  const device = useDevice();
  return <DeviceContext.Provider value={device}>{children}</DeviceContext.Provider>;
}

export function useDeviceState(): UseDeviceResult {
  const ctx = useContext(DeviceContext);
  if (!ctx) {
    throw new Error('useDeviceState must be used inside <DeviceProvider>');
  }
  return ctx;
}
