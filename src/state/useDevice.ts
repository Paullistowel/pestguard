import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FirebaseWriteError,
  setActuator as writeActuator,
  setEnabled as writeEnabled,
  setMode as writeMode,
  setThreshold as writeThreshold,
  subscribeConnection,
  subscribeDevice,
  subscribeDeviceList,
} from '@/services/firebase/client';
import {
  ActuatorKey,
  DEFAULT_DEVICE_ID,
  DeviceHealth,
  DeviceMode,
  DeviceNode,
  deviceHealth,
  supportsConfirmation,
} from '@/services/firebase/schema';

/**
 * Live device state, plus the command lifecycle.
 *
 * The lifecycle exists because "the app wrote to Firebase" and "the hardware
 * did the thing" are different events, and conflating them is how an IoT app
 * ends up lying to its user. Each command moves through explicit states and the
 * UI renders whichever one is true right now:
 *
 *   sending      the write to Firebase is in flight
 *   pending      Firebase accepted it; waiting for the ESP32 to report back
 *   confirmed    the device reported the state we asked for
 *   unconfirmed  Firebase accepted, but this device cannot report back, so we
 *                genuinely do not know whether the hardware changed
 *   failed       the write itself was rejected
 *   timeout      the device never acknowledged within the window
 *
 * `unconfirmed` is the important one. With the schema as it stands today there
 * is one field per actuator, so reading `led1: true` back only proves Firebase
 * stored our own write. Claiming success from that would be a guess. Once the
 * sketch mirrors applied state under `state/`, this hook detects it and starts
 * producing real `confirmed` transitions automatically — no app change needed.
 */

export type CommandStatus =
  | 'idle'
  | 'sending'
  | 'pending'
  | 'confirmed'
  | 'unconfirmed'
  | 'failed'
  | 'timeout';

export interface CommandState {
  status: CommandStatus;
  /** What we asked for. */
  desired?: boolean;
  error?: string;
  at: number;
}

/** How long to wait for the ESP32 to acknowledge before giving up. */
const CONFIRM_TIMEOUT_MS = 8000;

export interface UseDeviceResult {
  deviceId: string;
  devices: string[];
  node: DeviceNode | null;
  /** Firebase socket state — not the ESP32's. */
  firebaseConnected: boolean;
  /** ESP32 liveness, derived from its heartbeat. */
  health: DeviceHealth;
  /** True once the sketch mirrors applied state, enabling real confirmation. */
  canConfirm: boolean;
  /** True when the device writes a real heartbeat, rather than us inferring it. */
  hasHeartbeat: boolean;
  /** When device-written telemetry last changed, 0 if never observed. */
  telemetryAt: number;
  loading: boolean;
  error: string | null;
  commands: Partial<Record<ActuatorKey, CommandState>>;
  mode: DeviceMode | undefined;
  /** Effective value to render for an actuator: confirmed state if available. */
  actuatorValue: (key: ActuatorKey) => boolean;
  setActuator: (key: ActuatorKey, value: boolean) => Promise<void>;
  setMode: (mode: DeviceMode) => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<void>;
  setThreshold: (which: 'distance' | 'sound', value: number) => Promise<void>;
  selectDevice: (id: string) => void;
  clearCommand: (key: ActuatorKey) => void;
}

export function useDevice(initialId = DEFAULT_DEVICE_ID): UseDeviceResult {
  const [deviceId, setDeviceId] = useState(initialId);
  const [devices, setDevices] = useState<string[]>([]);
  const [node, setNode] = useState<DeviceNode | null>(null);
  const [firebaseConnected, setFirebaseConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [commands, setCommands] = useState<Partial<Record<ActuatorKey, CommandState>>>({});
  // Re-render on a timer so the heartbeat-derived health goes stale on its own
  // rather than sitting on "online" until the next database change arrives.
  const [tickValue, setTick] = useState(0);

  const timers = useRef<Partial<Record<ActuatorKey, ReturnType<typeof setTimeout>>>>({});
  const nodeRef = useRef<DeviceNode | null>(null);
  nodeRef.current = node;

  /*
   * Fallback liveness signal.
   *
   * `lastUpdate` is the proper heartbeat, but plenty of sketches never write
   * it. A device that is genuinely running still betrays itself: its sensor
   * readings move. So we watch the fields only the ESP32 writes and record
   * when they last changed. That is weaker evidence than a heartbeat — a
   * perfectly still room produces a constant distance — so it is reported as
   * its own state rather than being passed off as one.
   */
  const telemetryRef = useRef<{ sig: string; at: number }>({ sig: '', at: 0 });
  const [telemetryAt, setTelemetryAt] = useState(0);

  // --- subscriptions -------------------------------------------------------

  useEffect(() => subscribeConnection(setFirebaseConnected), []);

  useEffect(
    () =>
      subscribeDeviceList(setDevices, (e) =>
        setError(`Could not list devices: ${e.message}`),
      ),
    [],
  );

  useEffect(() => {
    setLoading(true);
    setError(null);
    const unsub = subscribeDevice(
      deviceId,
      (n) => {
        // Only device-written fields count. Including the command fields would
        // make the app's own writes look like the device reporting in.
        const sig = n ? `${n.distance ?? ''}|${n.sound ?? ''}|${n.status ?? ''}|${n.lastUpdate ?? ''}` : '';
        if (sig && sig !== telemetryRef.current.sig) {
          telemetryRef.current = { sig, at: Date.now() };
          setTelemetryAt(Date.now());
        }
        setNode(n);
        setLoading(false);
      },
      (e) => {
        setError(
          e.message.includes('permission')
            ? 'Firebase denied access to this device. Check your Realtime Database rules.'
            : `Could not read the device: ${e.message}`,
        );
        setLoading(false);
      },
    );
    return unsub;
  }, [deviceId]);

  useEffect(() => {
    const i = setInterval(() => setTick((t) => t + 1), 5000);
    return () => clearInterval(i);
  }, []);

  useEffect(() => {
    const t = timers.current;
    return () => Object.values(t).forEach((x) => x && clearTimeout(x));
  }, []);

  const canConfirm = supportsConfirmation(node);

  // --- resolve pending commands against reported state ---------------------

  useEffect(() => {
    if (!node) return;
    setCommands((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [k, cmd] of Object.entries(prev) as [ActuatorKey, CommandState][]) {
        if (cmd.status !== 'pending' || cmd.desired === undefined) continue;
        const reported = node.state?.[k];
        if (reported === cmd.desired) {
          next[k] = { ...cmd, status: 'confirmed', at: Date.now() };
          const t = timers.current[k];
          if (t) clearTimeout(t);
          delete timers.current[k];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [node]);

  // --- actions -------------------------------------------------------------

  const mark = useCallback((key: ActuatorKey, state: CommandState) => {
    setCommands((prev) => ({ ...prev, [key]: state }));
  }, []);

  const setActuator = useCallback(
    async (key: ActuatorKey, value: boolean) => {
      const existing = timers.current[key];
      if (existing) clearTimeout(existing);

      mark(key, { status: 'sending', desired: value, at: Date.now() });

      try {
        await writeActuator(deviceId, key, value);
      } catch (err) {
        mark(key, {
          status: 'failed',
          desired: value,
          error: err instanceof FirebaseWriteError ? err.message : 'The write failed.',
          at: Date.now(),
        });
        return;
      }

      // The write landed. Whether the hardware followed is a separate question,
      // and only answerable if the device reports applied state.
      if (!supportsConfirmation(nodeRef.current)) {
        mark(key, { status: 'unconfirmed', desired: value, at: Date.now() });
        return;
      }

      mark(key, { status: 'pending', desired: value, at: Date.now() });
      timers.current[key] = setTimeout(() => {
        setCommands((prev) => {
          const cur = prev[key];
          if (!cur || cur.status !== 'pending') return prev;
          return {
            ...prev,
            [key]: {
              ...cur,
              status: 'timeout',
              error: 'The device did not acknowledge. It may be offline or busy.',
              at: Date.now(),
            },
          };
        });
      }, CONFIRM_TIMEOUT_MS);
    },
    [deviceId, mark],
  );

  const setMode = useCallback(
    async (m: DeviceMode) => {
      try {
        await writeMode(deviceId, m);
      } catch (err) {
        setError(err instanceof FirebaseWriteError ? err.message : 'Could not switch mode.');
      }
    },
    [deviceId],
  );

  /**
   * What to render for an actuator.
   *
   * Prefers the device's reported state when it publishes one, because that is
   * the hardware talking. Falls back to the command field otherwise — which is
   * the app's own request, and is labelled as unconfirmed in the UI so the
   * distinction is never hidden.
   */
  const actuatorValue = useCallback(
    (key: ActuatorKey) => {
      if (node?.state && key in node.state) return node.state[key] === true;
      return node?.[key] === true;
    },
    [node],
  );

  const setEnabled = useCallback(
    async (enabled: boolean) => {
      try {
        await writeEnabled(deviceId, enabled);
      } catch (err) {
        setError(
          err instanceof FirebaseWriteError ? err.message : 'Could not change system state.',
        );
      }
    },
    [deviceId],
  );

  const setThreshold = useCallback(
    async (which: 'distance' | 'sound', value: number) => {
      try {
        await writeThreshold(deviceId, which, value);
      } catch (err) {
        setError(
          err instanceof FirebaseWriteError ? err.message : 'Could not save the threshold.',
        );
      }
    },
    [deviceId],
  );

  /*
   * Health, best evidence first.
   *
   * A real heartbeat wins. Failing that, telemetry that changed recently means
   * the device is alive even though it never says so. Failing both, we say we
   * do not know — which is the truth, and is different from claiming offline.
   */
  const health = useMemo<DeviceHealth>(() => {
    const fromBeat = deviceHealth(node?.lastUpdate);
    if (fromBeat !== 'unknown') return fromBeat;
    if (!telemetryAt) return 'unknown';
    const age = Date.now() - telemetryAt;
    if (age < 30_000) return 'online';
    if (age < 120_000) return 'stale';
    return 'unknown';
  }, [node?.lastUpdate, telemetryAt, tickValue]);

  return {
    deviceId,
    devices,
    node,
    firebaseConnected,
    health,
    canConfirm,
    hasHeartbeat: !!node?.lastUpdate,
    telemetryAt,
    loading,
    error,
    commands,
    mode: node?.mode,
    actuatorValue,
    setActuator,
    setMode,
    setEnabled,
    setThreshold,
    selectDevice: setDeviceId,
    clearCommand: (key) => setCommands((prev) => ({ ...prev, [key]: undefined })),
  };
}
