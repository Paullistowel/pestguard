import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Offline cache — the "Offline Mode" feature in §4.
 *
 * Everything the dashboard needs to render is mirrored to AsyncStorage on every
 * change, so a farmer walking out of Wi-Fi range still sees last-known status
 * and full history rather than a spinner. Writes the user makes while offline
 * go into an outbox and replay in order once the link returns — the same
 * store-and-forward pattern the ESP32 uses for events, applied to the app side.
 */

const PREFIX = '@pestguard/';

export const KEYS = {
  nodes: `${PREFIX}nodes`,
  events: `${PREFIX}events`,
  alerts: `${PREFIX}alerts`,
  session: `${PREFIX}session`,
  settings: `${PREFIX}settings`,
  outbox: `${PREFIX}outbox`,
  lastSync: `${PREFIX}last-sync`,
  onboarded: `${PREFIX}onboarded`,
} as const;

export async function save<T>(key: string, value: T): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    // A failed cache write must never break the UI — the in-memory store is
    // still authoritative for this session.
  }
}

export async function load<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export async function remove(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export async function clearAll(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    await AsyncStorage.multiRemove(keys.filter((k) => k.startsWith(PREFIX)));
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Outbox
// ---------------------------------------------------------------------------

export interface OutboxItem {
  id: string;
  kind: 'config' | 'arm' | 'disarm' | 'test' | 'label';
  nodeId: string;
  payload: Record<string, unknown>;
  queuedAt: number;
  attempts: number;
}

export async function enqueue(item: Omit<OutboxItem, 'id' | 'queuedAt' | 'attempts'>) {
  const box = await load<OutboxItem[]>(KEYS.outbox, []);
  box.push({
    ...item,
    id: `ob-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    queuedAt: Date.now(),
    attempts: 0,
  });
  await save(KEYS.outbox, box);
  return box.length;
}

export async function peekOutbox(): Promise<OutboxItem[]> {
  return load<OutboxItem[]>(KEYS.outbox, []);
}

export async function drainOutbox(): Promise<OutboxItem[]> {
  const box = await load<OutboxItem[]>(KEYS.outbox, []);
  await save(KEYS.outbox, []);
  return box;
}

export async function getStorageFootprint(): Promise<{ keys: number; bytes: number }> {
  try {
    const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(PREFIX));
    const pairs = await AsyncStorage.multiGet(keys);
    const bytes = pairs.reduce((sum, [k, v]) => sum + k.length + (v?.length ?? 0), 0);
    return { keys: keys.length, bytes };
  } catch {
    return { keys: 0, bytes: 0 };
  }
}
