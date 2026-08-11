import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';
import { Alert, AlertSeverity, DeterrentNode, PestEvent } from '@/types';
import { PEST_PROFILES } from '@/data/pests';
import { effectiveClass, effectiveConfidence } from './ai/classifier';

/**
 * Notifications — OS-level where available, in-app always.
 *
 * The interesting part is not delivery, it is *restraint*. A node in a bad week
 * can fire dozens of times an hour; a farmer who gets buzzed for every one of
 * them turns notifications off, and then the system is worse than useless. So
 * this module implements the mitigations named in the risk register: a
 * per-node cooldown, batching within a window, quiet-hours suppression, and a
 * confidence floor below which detections are logged but never pushed.
 *
 * ---------------------------------------------------------------------------
 * WHY expo-notifications IS LOADED LAZILY
 * ---------------------------------------------------------------------------
 * Expo removed remote-push support from Expo Go in SDK 53, and the module now
 * throws the moment it is imported there — which took down the whole app at
 * startup, because this file is pulled in by the store, which is pulled in by
 * the first screen. A feature that is merely unavailable must not be able to
 * crash the app that depends on it.
 *
 * So the import happens on demand, behind an Expo Go check, and every entry
 * point below degrades to a no-op instead of throwing. In Expo Go you lose the
 * OS banner; the alerts list, badge counts, throttling logic and the settings
 * screen all keep working, because none of them need the native module. A
 * development build restores the banners with no code change.
 */

/** Expo Go reports `storeClient`; a dev build or standalone reports otherwise. */
export const isExpoGo =
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

/** True once we know OS notifications are usable on this build. */
export const osNotificationsAvailable = !isExpoGo;

type NotificationsModule = typeof import('expo-notifications');

let cached: NotificationsModule | null = null;
let handlerInstalled = false;

/**
 * Resolve the native module, or null where it cannot be used.
 *
 * `require` rather than a static import so the module is never even evaluated
 * in Expo Go, and wrapped so a future platform quirk degrades instead of
 * crashing.
 */
function getNotifications(): NotificationsModule | null {
  if (isExpoGo) return null;
  if (cached) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require('expo-notifications') as NotificationsModule;
  } catch {
    return null;
  }

  if (!handlerInstalled && cached) {
    try {
      cached.setNotificationHandler({
        handleNotification: async () => ({
          // `shouldShowAlert` is deprecated in favour of the banner/list split.
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: true,
          shouldSetBadge: true,
        }),
      });
      handlerInstalled = true;
    } catch {
      /* handler is optional; delivery still works without it */
    }
  }
  return cached;
}

export interface NotificationPrefs {
  enabled: boolean;
  detections: boolean;
  predictive: boolean;
  battery: boolean;
  connectivity: boolean;
  maintenance: boolean;
  /** Suppress pushes below this classifier confidence. */
  minConfidence: number;
  /** Minimum seconds between pushes for the same node. */
  cooldownSec: number;
  /** Collapse everything inside this window into one summary push. */
  batchWindowSec: number;
  /** Phone-side quiet hours, independent of the node's own. */
  quietHours: { enabled: boolean; startMin: number; endMin: number };
  /** Only push for species at or above this risk level. */
  minRisk: 'low' | 'moderate' | 'high' | 'severe';
  sound: boolean;
  vibrate: boolean;
}

export const DEFAULT_PREFS: NotificationPrefs = {
  enabled: true,
  detections: true,
  predictive: true,
  battery: true,
  connectivity: true,
  maintenance: false,
  minConfidence: 0.6,
  cooldownSec: 180,
  batchWindowSec: 60,
  quietHours: { enabled: false, startMin: 22 * 60, endMin: 6 * 60 },
  minRisk: 'moderate',
  sound: true,
  vibrate: true,
};

const RISK_ORDER = ['low', 'moderate', 'high', 'severe'] as const;

const lastPushPerNode = new Map<string, number>();
let batch: PestEvent[] = [];
let batchTimer: ReturnType<typeof setTimeout> | null = null;

export async function requestPermissions(): Promise<boolean> {
  const N = getNotifications();
  if (!N) return false;
  try {
    const existing = await N.getPermissionsAsync();
    let status = existing.status;
    if (status !== 'granted') {
      status = (await N.requestPermissionsAsync()).status;
    }
    if (Platform.OS === 'android' && status === 'granted') {
      await N.setNotificationChannelAsync('detections', {
        name: 'Pest detections',
        importance: N.AndroidImportance.HIGH,
        vibrationPattern: [0, 200, 100, 200],
        lightColor: '#35C77E',
      });
      await N.setNotificationChannelAsync('system', {
        name: 'Node health & connectivity',
        importance: N.AndroidImportance.DEFAULT,
        lightColor: '#FFB020',
      });
    }
    return status === 'granted';
  } catch {
    return false;
  }
}

function inQuietHours(prefs: NotificationPrefs, now = new Date()): boolean {
  if (!prefs.quietHours.enabled) return false;
  const m = now.getHours() * 60 + now.getMinutes();
  const { startMin: s, endMin: e } = prefs.quietHours;
  return s <= e ? m >= s && m < e : m >= s || m < e;
}

/** Decide whether an event earns a push. Returns the reason if it does not. */
export function shouldNotify(
  event: PestEvent,
  prefs: NotificationPrefs,
): { ok: true } | { ok: false; reason: string } {
  if (!prefs.enabled) return { ok: false, reason: 'Notifications are switched off' };
  if (!prefs.detections) return { ok: false, reason: 'Detection alerts are switched off' };
  if (event.type !== 'deter' && event.type !== 'detect')
    return { ok: false, reason: 'Not a detection event' };
  if (inQuietHours(prefs)) return { ok: false, reason: 'Inside your quiet hours' };

  const conf = effectiveConfidence(event);
  if (conf < prefs.minConfidence)
    return { ok: false, reason: `Confidence ${(conf * 100).toFixed(0)}% below your floor` };

  const risk = PEST_PROFILES[effectiveClass(event)].cropRisk;
  if (RISK_ORDER.indexOf(risk) < RISK_ORDER.indexOf(prefs.minRisk))
    return { ok: false, reason: `${risk} risk is below your threshold` };

  const last = lastPushPerNode.get(event.nodeId) ?? 0;
  if (Date.now() - last < prefs.cooldownSec * 1000)
    return { ok: false, reason: 'Node is inside its notification cooldown' };

  return { ok: true };
}

/**
 * Queue an event for push. Events arriving inside the batch window are
 * collapsed into a single summary rather than sent one by one.
 */
export function queueDetection(
  event: PestEvent,
  node: DeterrentNode | undefined,
  prefs: NotificationPrefs,
) {
  const verdict = shouldNotify(event, prefs);
  if (!verdict.ok) return;

  batch.push(event);
  lastPushPerNode.set(event.nodeId, Date.now());

  if (batchTimer) return;
  batchTimer = setTimeout(() => {
    const pending = batch;
    batch = [];
    batchTimer = null;
    flush(pending, node, prefs);
  }, Math.max(1, prefs.batchWindowSec) * 1000);
}

async function flush(events: PestEvent[], node: DeterrentNode | undefined, prefs: NotificationPrefs) {
  if (!events.length) return;

  if (events.length === 1) {
    const e = events[0];
    const profile = PEST_PROFILES[effectiveClass(e)];
    await present(
      `${profile.emoji} ${profile.label} detected`,
      `${node?.name ?? e.nodeId} · ${(effectiveConfidence(e) * 100).toFixed(0)}% confidence${
        e.type === 'deter' ? ' · deterrent fired' : ''
      }`,
      prefs,
      { eventId: e.id, nodeId: e.nodeId },
    );
    return;
  }

  const nodeIds = new Set(events.map((e) => e.nodeId));
  const top = PEST_PROFILES[effectiveClass(events[0])];
  await present(
    `${events.length} detections`,
    `${top.label} and others across ${nodeIds.size} node${nodeIds.size === 1 ? '' : 's'} in the last minute.`,
    prefs,
    { nodeId: events[0].nodeId },
  );
}

export async function presentAlert(alert: Alert, prefs: NotificationPrefs) {
  const gate: Record<string, boolean> = {
    predictive: prefs.predictive,
    battery: prefs.battery,
    connectivity: prefs.connectivity,
    maintenance: prefs.maintenance,
    threshold: prefs.maintenance,
    detection: prefs.detections,
  };
  if (!prefs.enabled || !gate[alert.kind]) return;
  // Critical alerts pierce quiet hours — a dead node is worth waking up for.
  if (inQuietHours(prefs) && alert.severity !== 'critical') return;

  await present(alert.title, alert.body, prefs, { alertId: alert.id, nodeId: alert.nodeId });
}

async function present(
  title: string,
  body: string,
  prefs: NotificationPrefs,
  data: Record<string, unknown>,
) {
  const N = getNotifications();
  if (!N) return; // Expo Go, or the module is unavailable — in-app alerts only.
  try {
    await N.scheduleNotificationAsync({
      content: {
        title,
        body,
        data,
        sound: prefs.sound,
        vibrate: prefs.vibrate ? [0, 200, 100, 200] : undefined,
      },
      trigger: null,
    });
  } catch {
    // Simulators and web builds have no notification service — the in-app
    // alerts list still records everything, so nothing is lost.
  }
}

export function severityFor(kind: Alert['kind'], value: number): AlertSeverity {
  if (kind === 'battery') return value < 15 ? 'critical' : value < 30 ? 'warning' : 'info';
  if (kind === 'connectivity') return 'critical';
  if (kind === 'predictive') return value > 0.6 ? 'warning' : 'info';
  return 'info';
}

export function resetThrottles() {
  lastPushPerNode.clear();
  batch = [];
  if (batchTimer) clearTimeout(batchTimer);
  batchTimer = null;
}
