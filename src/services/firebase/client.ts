import { FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import {
  Database,
  DataSnapshot,
  getDatabase,
  goOffline,
  goOnline,
  off,
  onValue,
  ref,
  serverTimestamp,
  set,
  update,
} from 'firebase/database';
import { firebaseConfig } from './config';
import { ActuatorKey, DeviceMode, DeviceNode, paths } from './schema';

/**
 * Realtime Database client.
 *
 * Uses the Firebase SDK's own listeners rather than polling: `onValue` holds a
 * socket open and pushes only what changed, which is both faster and far
 * cheaper than re-fetching the tree on a timer. It also gives `.info/connected`
 * for free, which is how the app distinguishes "Firebase is unreachable" from
 * "Firebase is fine but the ESP32 has stopped reporting" — two failures that
 * look identical from the data alone and need completely different fixes.
 */

let app: FirebaseApp | null = null;
let db: Database | null = null;

export function getDb(): Database {
  if (db) return db;
  app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  db = getDatabase(app, firebaseConfig.databaseURL);
  return db;
}

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

export type Unsubscribe = () => void;

/** Live subscription to one device node. */
export function subscribeDevice(
  deviceId: string,
  onData: (node: DeviceNode | null) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const r = ref(getDb(), paths.device(deviceId));
  const handler = (snap: DataSnapshot) => {
    const val = snap.val();
    onData(val && typeof val === 'object' ? (val as DeviceNode) : null);
  };
  onValue(r, handler, (err) => onError?.(err as Error));
  return () => off(r, 'value', handler);
}

/**
 * Live subscription to the SDK's own connection state.
 *
 * `.info/connected` is maintained by the client library, so it flips the moment
 * the socket drops — well before any read would time out.
 */
export function subscribeConnection(onChange: (connected: boolean) => void): Unsubscribe {
  const r = ref(getDb(), '.info/connected');
  const handler = (snap: DataSnapshot) => onChange(snap.val() === true);
  onValue(r, handler);
  return () => off(r, 'value', handler);
}

/** Enumerate the devices under the root, so the app never hard-codes one. */
export function subscribeDeviceList(
  onList: (ids: string[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const r = ref(getDb(), 'pestDetector');
  const handler = (snap: DataSnapshot) => {
    const val = snap.val();
    onList(val && typeof val === 'object' ? Object.keys(val) : []);
  };
  onValue(r, handler, (err) => onError?.(err as Error));
  return () => off(r, 'value', handler);
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export class FirebaseWriteError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'FirebaseWriteError';
  }
}

/**
 * Command an actuator.
 *
 * Writes only the single field, never the whole node — a full-object write
 * would clobber whatever the ESP32 had just reported into the same object, and
 * the two writers race constantly.
 */
export async function setActuator(
  deviceId: string,
  key: ActuatorKey,
  value: boolean,
): Promise<void> {
  try {
    await set(ref(getDb(), paths.field(deviceId, key)), value);
  } catch (err) {
    throw new FirebaseWriteError(
      `Could not write ${key}. ${describeWriteFailure(err)}`,
      err,
    );
  }
}

/** Master enable/disable for the whole deterrent system. */
export async function setEnabled(deviceId: string, enabled: boolean): Promise<void> {
  try {
    await set(ref(getDb(), paths.enabled(deviceId)), enabled);
  } catch (err) {
    throw new FirebaseWriteError(
      `Could not ${enabled ? 'enable' : 'disable'} the system. ${describeWriteFailure(err)}`,
      err,
    );
  }
}

/** Detection threshold. The ESP32 owns the comparison; this is just the value. */
export async function setThreshold(
  deviceId: string,
  which: 'distance' | 'sound',
  value: number,
): Promise<void> {
  const path =
    which === 'distance' ? paths.distanceThreshold(deviceId) : paths.soundThreshold(deviceId);
  try {
    await set(ref(getDb(), path), Math.round(value));
  } catch (err) {
    throw new FirebaseWriteError(
      `Could not save the ${which} threshold. ${describeWriteFailure(err)}`,
      err,
    );
  }
}

export async function setMode(deviceId: string, mode: DeviceMode): Promise<void> {
  try {
    await set(ref(getDb(), paths.mode(deviceId)), mode);
  } catch (err) {
    throw new FirebaseWriteError(`Could not switch mode. ${describeWriteFailure(err)}`, err);
  }
}

/** Set several actuators atomically — used by scene buttons like "all off". */
export async function setActuators(
  deviceId: string,
  values: Partial<Record<ActuatorKey, boolean>>,
): Promise<void> {
  try {
    await update(ref(getDb(), paths.device(deviceId)), values);
  } catch (err) {
    throw new FirebaseWriteError(`Could not apply changes. ${describeWriteFailure(err)}`, err);
  }
}

/**
 * Write the app's own heartbeat marker.
 *
 * Distinct from the device heartbeat: this records that a phone was here, which
 * is useful when diagnosing whether a command was ever actually sent.
 */
export async function touchAppSeen(deviceId: string): Promise<void> {
  try {
    await set(ref(getDb(), `${paths.device(deviceId)}/appLastSeen`), serverTimestamp());
  } catch {
    // Never surfaced — this is telemetry, not a user action.
  }
}

function describeWriteFailure(err: unknown): string {
  const code = (err as { code?: string })?.code ?? '';
  if (code.includes('permission-denied')) {
    return 'The database rejected it — check your Realtime Database rules allow this write.';
  }
  if (code.includes('unavailable') || code.includes('network')) {
    return 'Firebase is unreachable. Check your internet connection.';
  }
  return 'The write did not complete.';
}

// ---------------------------------------------------------------------------
// Connection control
// ---------------------------------------------------------------------------

export function pauseSync() {
  try {
    goOffline(getDb());
  } catch {
    /* not initialised yet */
  }
}

export function resumeSync() {
  try {
    goOnline(getDb());
  } catch {
    /* not initialised yet */
  }
}
