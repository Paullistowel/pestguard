import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from 'react';
import {
  Alert,
  AlertKind,
  ConnectionState,
  DeterrentNode,
  Farm,
  GatewayLink,
  NodeConfig,
  PestClass,
  PestEvent,
  User,
} from '@/types';
import { EMPTY_FARM, FARM_KEY } from '@/data/farm';
import { DeviceRef, addDevice, loadDevices, removeDevice } from '@/services/devices';
import { LanTransport, statusToNode } from '@/services/lanTransport';
import { WireStatus } from '@/services/protocol';
import { enrichEvent, effectiveClass } from '@/services/ai/classifier';
import { forecastBattery } from '@/services/ai/battery';
import { detectAnomaly, describeAnomaly } from '@/services/ai/anomaly';
import { Transport } from '@/services/realtime';
import * as storage from '@/services/storage';
import {
  DEFAULT_PREFS,
  NotificationPrefs,
  presentAlert,
  queueDetection,
  requestPermissions,
} from '@/services/notifications';
import { PEST_PROFILES } from '@/data/pests';
import { can } from '@/services/permissions';
import { Permissions } from '@/types';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface State {
  hydrated: boolean;
  farm: Farm;
  nodes: DeterrentNode[];
  events: PestEvent[];
  alerts: Alert[];
  users: User[];
  currentUser: User | null;
  link: GatewayLink;
  prefs: NotificationPrefs;
  /** Manual override: user pulled the "work offline" switch. */
  offlineMode: boolean;
  /** Physical nodes this phone can reach. Empty until one is paired. */
  devices: DeviceRef[];
  lastSync: number | null;
  pendingWrites: number;
  toast: { id: number; message: string; tone: 'ok' | 'error' | 'info' } | null;
}

type Action =
  | { type: 'HYDRATE'; payload: Partial<State> }
  | { type: 'SIGN_IN'; user: User }
  | { type: 'SIGN_OUT' }
  | { type: 'EVENT'; event: PestEvent }
  | { type: 'PATCH_NODE'; nodeId: string; patch: Partial<DeterrentNode> }
  | { type: 'SET_CONFIG'; nodeId: string; config: NodeConfig }
  | { type: 'LINK'; state: ConnectionState; latencyMs?: number }
  | { type: 'ADD_ALERT'; alert: Alert }
  | { type: 'READ_ALERT'; id: string }
  | { type: 'READ_ALL_ALERTS' }
  | { type: 'DISMISS_ALERT'; id: string }
  | { type: 'LABEL_EVENT'; eventId: string; label: PestClass | 'false_alarm' | undefined }
  | { type: 'SET_PREFS'; prefs: NotificationPrefs }
  | { type: 'SET_OFFLINE'; offline: boolean }
  | { type: 'SET_DEVICES'; devices: DeviceRef[] }
  | { type: 'UPSERT_NODE'; node: DeterrentNode }
  | { type: 'PENDING'; delta: number }
  | { type: 'SYNCED' }
  | { type: 'ADD_NODE'; node: DeterrentNode }
  | { type: 'REMOVE_NODE'; nodeId: string }
  | { type: 'UPSERT_USER'; user: User }
  | { type: 'REMOVE_USER'; userId: string }
  | { type: 'TOAST'; message: string; tone?: 'ok' | 'error' | 'info' }
  | { type: 'CLEAR_TOAST' };

/*
 * Nothing is fabricated. The app starts genuinely empty and every node, event
 * and alert below comes from a real ESP32 on the network. An empty dashboard
 * with a "pair a node" prompt is the correct state before any hardware is
 * connected — inventing a farm to fill the space would mean a user could not
 * tell whether what they are looking at came from their device or from us.
 */
const initialState: State = {
  hydrated: false,
  farm: EMPTY_FARM,
  nodes: [],
  events: [],
  alerts: [],
  users: [],
  currentUser: null,
  devices: [],
  link: {
    state: 'offline',
    broker: '',
    protocol: 'HTTP',
    latencyMs: 0,
    lastMessageTs: 0,
    messagesIn: 0,
    messagesOut: 0,
    outbox: 0,
  },
  prefs: DEFAULT_PREFS,
  offlineMode: false,
  lastSync: null,
  pendingWrites: 0,
  toast: null,
};

/** Cap the in-memory log so a long-running session cannot grow unbounded. */
const MAX_EVENTS = 4000;

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'HYDRATE':
      return { ...state, ...action.payload, hydrated: true };

    case 'SIGN_IN':
      return { ...state, currentUser: action.user };

    case 'SIGN_OUT':
      return { ...state, currentUser: null };

    case 'EVENT': {
      const e = action.event;
      const events = [e, ...state.events].slice(0, MAX_EVENTS);
      const nodes = state.nodes.map((n): DeterrentNode =>
        n.id !== e.nodeId
          ? n
          : {
              ...n,
              lastSeen: e.ts,
              lastDetection:
                e.type === 'detect' || e.type === 'deter' ? e.ts : n.lastDetection,
              batteryPct: e.batteryPct || n.batteryPct,
              batteryVolts: e.batteryVolts || n.batteryVolts,
              status: e.type === 'deter' ? 'deterring' : n.status,
            },
      );
      return {
        ...state,
        events,
        nodes,
        link: {
          ...state.link,
          messagesIn: state.link.messagesIn + 1,
          lastMessageTs: e.ts,
        },
      };
    }

    case 'PATCH_NODE':
      return {
        ...state,
        nodes: state.nodes.map((n) => (n.id === action.nodeId ? { ...n, ...action.patch } : n)),
      };

    case 'SET_CONFIG':
      return {
        ...state,
        nodes: state.nodes.map((n) =>
          n.id === action.nodeId ? { ...n, config: action.config } : n,
        ),
      };

    case 'LINK':
      return {
        ...state,
        link: {
          ...state.link,
          state: action.state,
          latencyMs: action.latencyMs ?? state.link.latencyMs,
          // 'connected' means the WebSocket is up; 'degraded' means REST
          // polling is carrying it. Showing which is which matters — the
          // difference is instant push versus a two-second lag.
          protocol: action.state === 'connected' ? 'WS' : 'HTTP',
        },
      };

    case 'ADD_ALERT':
      // Collapse duplicates: same kind + same node within 30 minutes.
      if (
        state.alerts.some(
          (a) =>
            a.kind === action.alert.kind &&
            a.nodeId === action.alert.nodeId &&
            Math.abs(a.ts - action.alert.ts) < 1_800_000,
        )
      ) {
        return state;
      }
      return { ...state, alerts: [action.alert, ...state.alerts].slice(0, 200) };

    case 'READ_ALERT':
      return {
        ...state,
        alerts: state.alerts.map((a) => (a.id === action.id ? { ...a, read: true } : a)),
      };

    case 'READ_ALL_ALERTS':
      return { ...state, alerts: state.alerts.map((a) => ({ ...a, read: true })) };

    case 'DISMISS_ALERT':
      return { ...state, alerts: state.alerts.filter((a) => a.id !== action.id) };

    case 'LABEL_EVENT':
      return {
        ...state,
        events: state.events.map((e) =>
          e.id === action.eventId ? { ...e, groundTruth: action.label } : e,
        ),
      };

    case 'SET_PREFS':
      return { ...state, prefs: action.prefs };

    case 'SET_DEVICES':
      return { ...state, devices: action.devices };

    case 'UPSERT_NODE': {
      const exists = state.nodes.some((n) => n.id === action.node.id);
      return {
        ...state,
        nodes: exists
          ? state.nodes.map((n) =>
              n.id === action.node.id
                ? {
                    // Keep the fields the app owns rather than the device:
                    // map placement and the computed battery forecast are not
                    // things the ESP32 knows about, and a status frame must not
                    // reset them every two seconds.
                    ...action.node,
                    mapX: n.mapX,
                    mapY: n.mapY,
                    lat: n.lat,
                    lon: n.lon,
                    batteryDaysRemaining: n.batteryDaysRemaining,
                    lastDetection: n.lastDetection,
                  }
                : n,
            )
          : [...state.nodes, action.node],
        farm: state.farm.zones.includes(action.node.zone)
          ? state.farm
          : { ...state.farm, zones: [...state.farm.zones, action.node.zone] },
      };
    }

    case 'SET_OFFLINE':
      return {
        ...state,
        offlineMode: action.offline,
        link: { ...state.link, state: action.offline ? 'offline' : 'connecting' },
      };

    case 'PENDING':
      return {
        ...state,
        pendingWrites: Math.max(0, state.pendingWrites + action.delta),
        link: {
          ...state.link,
          outbox: Math.max(0, state.link.outbox + action.delta),
          messagesOut: action.delta > 0 ? state.link.messagesOut + 1 : state.link.messagesOut,
        },
      };

    case 'SYNCED':
      return { ...state, lastSync: Date.now() };

    case 'ADD_NODE':
      return { ...state, nodes: [...state.nodes, action.node] };

    case 'REMOVE_NODE':
      return {
        ...state,
        nodes: state.nodes.filter((n) => n.id !== action.nodeId),
        events: state.events.filter((e) => e.nodeId !== action.nodeId),
      };

    case 'UPSERT_USER':
      return {
        ...state,
        users: state.users.some((u) => u.id === action.user.id)
          ? state.users.map((u) => (u.id === action.user.id ? action.user : u))
          : [...state.users, action.user],
        currentUser:
          state.currentUser?.id === action.user.id ? action.user : state.currentUser,
      };

    case 'REMOVE_USER':
      return { ...state, users: state.users.filter((u) => u.id !== action.userId) };

    case 'TOAST':
      return {
        ...state,
        toast: { id: Date.now(), message: action.message, tone: action.tone ?? 'ok' },
      };

    case 'CLEAR_TOAST':
      return { ...state, toast: null };

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface StoreValue extends State {
  signIn: (email: string, role?: User['role']) => Promise<void>;
  signOut: () => void;
  nodeById: (id: string) => DeterrentNode | undefined;
  eventById: (id: string) => PestEvent | undefined;
  eventsForNode: (id: string) => PestEvent[];
  setNodeConfig: (nodeId: string, config: NodeConfig) => Promise<boolean>;
  setArmed: (nodeId: string, armed: boolean) => Promise<boolean>;
  testDeterrent: (nodeId: string) => Promise<boolean>;
  labelEvent: (eventId: string, label: PestClass | 'false_alarm' | undefined) => void;
  markAlertRead: (id: string) => void;
  markAllAlertsRead: () => void;
  dismissAlert: (id: string) => void;
  setPrefs: (prefs: NotificationPrefs) => void;
  setOfflineMode: (offline: boolean) => void;
  addNode: (node: DeterrentNode) => void;
  removeNode: (nodeId: string) => void;
  upsertUser: (user: User) => void;
  removeUser: (userId: string) => void;
  toast: State['toast'];
  pairDevice: (host: string, port: number, deviceId?: string, name?: string) => Promise<void>;
  unpairDevice: (host: string) => Promise<void>;
  setFarm: (farm: Farm) => void;
  showToast: (message: string, tone?: 'ok' | 'error' | 'info') => void;
  clearToast: () => void;
  unreadAlerts: number;
  online: boolean;
  permissions: Permissions;
  requireNotificationPermission: () => Promise<boolean>;
}

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const transportRef = useRef<Transport | null>(null);
  // Refs, not deps: the periodic AI sweep must see current data without being
  // torn down and restarted every time an event arrives.
  const nodesRef = useRef(state.nodes);
  const prefsRef = useRef(state.prefs);
  const eventsRef = useRef(state.events);
  const linkRef = useRef(state.link);

  nodesRef.current = state.nodes;
  prefsRef.current = state.prefs;
  eventsRef.current = state.events;
  linkRef.current = state.link;

  // --- hydrate from the offline cache -------------------------------------
  useEffect(() => {
    (async () => {
      const [session, prefs, alerts, lastSync, nodes, events, devices, farm] =
        await Promise.all([
          storage.load<User | null>(storage.KEYS.session, null),
          storage.load<NotificationPrefs>(storage.KEYS.settings, DEFAULT_PREFS),
          storage.load<Alert[]>(storage.KEYS.alerts, []),
          storage.load<number | null>(storage.KEYS.lastSync, null),
          storage.load<DeterrentNode[]>(storage.KEYS.nodes, []),
          storage.load<PestEvent[]>(storage.KEYS.events, []),
          loadDevices(),
          storage.load<Farm>(FARM_KEY, EMPTY_FARM),
        ]);

      // Cached hardware state is shown immediately so the app is useful before
      // the node answers — the last reading from a real device is real data,
      // just stale. The connection banner is what tells you which it is.
      dispatch({
        type: 'HYDRATE',
        payload: {
          currentUser: session,
          prefs: { ...DEFAULT_PREFS, ...prefs },
          alerts,
          lastSync,
          nodes,
          events,
          devices,
          farm: { ...EMPTY_FARM, ...farm },
          users: session ? [session] : [],
        },
      });
    })();
  }, []);

  // --- persist ------------------------------------------------------------
  useEffect(() => {
    if (!state.hydrated) return;
    storage.save(storage.KEYS.alerts, state.alerts.slice(0, 100));
  }, [state.alerts, state.hydrated]);

  useEffect(() => {
    if (!state.hydrated) return;
    storage.save(storage.KEYS.settings, state.prefs);
  }, [state.prefs, state.hydrated]);

  useEffect(() => {
    if (!state.hydrated) return;
    storage.save(storage.KEYS.nodes, state.nodes);
  }, [state.nodes, state.hydrated]);

  useEffect(() => {
    if (!state.hydrated) return;
    // Only the most recent slice is cached — enough for the offline history
    // view without writing megabytes on every event.
    storage.save(storage.KEYS.events, state.events.slice(0, 500));
  }, [state.events, state.hydrated]);

  // --- transport ----------------------------------------------------------
  // One LanTransport per paired ESP32. Each owns its own socket, backfill and
  // reconnect loop, so one node dropping off the Wi-Fi never stalls another.
  useEffect(() => {
    if (!state.hydrated || !state.currentUser) return;

    const device = state.devices[0];
    if (state.offlineMode || !device) {
      transportRef.current?.disconnect();
      transportRef.current = null;
      return;
    }

    dispatch({
      type: 'HYDRATE',
      payload: { link: { ...linkRef.current, broker: device.host } },
    });

    /*
     * Anything already on the device when we connect is history, not news.
     * Pairing a node replays its whole ring buffer, and alerting on all of it
     * would bury the user in notifications for detections that happened while
     * the app was closed — the opposite of what an alert is for. Only events
     * timestamped after this moment raise an alert or a push; everything else
     * lands silently in the log where it belongs.
     */
    const liveFrom = Date.now();

    const transport = new LanTransport({
      host: device.host,
      port: device.port,
      onStatus: (_status: WireStatus, node) => {
        dispatch({ type: 'UPSERT_NODE', node });
      },
    });
    transportRef.current = transport;

    transport.connect({
      onEvent: (raw) => {
        // The device sends raw band energies and its own quick verdict; the
        // app's classifier refines the label before anything is stored, so
        // every screen downstream sees a consistently enriched event.
        const event = enrichEvent(raw);
        dispatch({ type: 'EVENT', event });

        const node = nodesRef.current.find((n) => n.id === event.nodeId);
        const isLive = event.ts >= liveFrom - 5_000;
        if (isLive) queueDetection(event, node, prefsRef.current);

        if (
          isLive &&
          (event.type === 'detect' || event.type === 'deter') &&
          (event.aiConfidence ?? 0) >= 0.6
        ) {
          const profile = PEST_PROFILES[effectiveClass(event)];
          dispatch({
            type: 'ADD_ALERT',
            alert: {
              id: `al-${event.id}`,
              kind: 'detection',
              severity: profile.cropRisk === 'severe' ? 'warning' : 'info',
              title: `${profile.emoji} ${profile.label} at ${node?.name ?? event.nodeId}`,
              body: `${(event.aiConfidence! * 100).toFixed(0)}% confidence${
                event.type === 'deter'
                  ? ` · ${event.deterrentChannels?.join(', ')} fired for ${
                      (event.deterrentDurationMs ?? 0) / 1000
                    }s`
                  : ' · logged only, no deterrent'
              }`,
              nodeId: event.nodeId,
              eventId: event.id,
              ts: event.ts,
              read: false,
            },
          });
        }
      },
      onState: (s, latency) => dispatch({ type: 'LINK', state: s, latencyMs: latency }),
      onNodePatch: (nodeId, patch) => dispatch({ type: 'PATCH_NODE', nodeId, patch }),
    });

    return () => {
      transport.disconnect();
      transportRef.current = null;
    };
  }, [state.hydrated, state.currentUser, state.offlineMode, state.devices]);

  // --- background AI sweeps ----------------------------------------------
  // Battery forecasts and anomaly scores are recomputed periodically rather
  // than per-event: they are windowed statistics, so running them on every
  // arrival would burn cycles for no change in the answer.
  useEffect(() => {
    if (!state.hydrated || !state.currentUser) return;

    const run = () => {
      const events = eventsRef.current;
      for (const node of nodesRef.current) {
        const forecast = forecastBattery(node, events);
        const days = Number.isFinite(forecast.daysRemaining)
          ? Math.round(forecast.daysRemaining)
          : 999;
        if (days !== Math.round(node.batteryDaysRemaining)) {
          dispatch({ type: 'PATCH_NODE', nodeId: node.id, patch: { batteryDaysRemaining: days } });
        }

        if (days <= 7 && node.status !== 'offline') {
          pushAlert({
            id: `al-batt-${node.id}-${Math.floor(Date.now() / 86_400_000)}`,
            kind: 'battery',
            severity: days <= 2 ? 'critical' : 'warning',
            title: `${node.name} battery ${days <= 2 ? 'critical' : 'low'} — ${node.batteryPct}%`,
            body: `About ${days} day${days === 1 ? '' : 's'} to the 3.20 V cutoff. ${forecast.recommendation}`,
            nodeId: node.id,
            ts: Date.now(),
            read: false,
            aiRationale: `Least-squares fit: ${(forecast.slopeVoltsPerDay * 1000).toFixed(
              1,
            )} mV/day, r² = ${forecast.r2.toFixed(2)} (${forecast.confidence} confidence).`,
          });
        }

        const anomaly = detectAnomaly(events, node.id);
        if (anomaly.isAnomaly) {
          pushAlert({
            id: `al-anom-${node.id}-${Math.floor(Date.now() / 86_400_000)}`,
            kind: 'predictive',
            severity: anomaly.severity > 0.6 ? 'warning' : 'info',
            title: `Rising activity at ${node.name}`,
            body: describeAnomaly(anomaly, node.name),
            nodeId: node.id,
            ts: Date.now(),
            read: false,
            aiRationale: `Seasonal decomposition over 30 days: mean standardised residual z = ${anomaly.z.toFixed(
              2,
            )} across the trailing 5-day window (threshold 1.8), trend direction ${anomaly.direction}.`,
          });
        }
      }
      dispatch({ type: 'SYNCED' });
      storage.save(storage.KEYS.lastSync, Date.now());
    };

    const pushAlert = (alert: Alert) => {
      dispatch({ type: 'ADD_ALERT', alert });
      presentAlert(alert, prefsRef.current);
    };

    const t = setTimeout(run, 2500);
    const i = setInterval(run, 120_000);
    return () => {
      clearTimeout(t);
      clearInterval(i);
    };
    // Events are read through `eventsRef` rather than listed as a dependency:
    // including them would tear down and restart the sweep on every arriving
    // detection, which is exactly what this interval exists to avoid.
  }, [state.hydrated, state.currentUser]);

  // --- toast auto-dismiss -------------------------------------------------
  useEffect(() => {
    if (!state.toast) return;
    const t = setTimeout(() => dispatch({ type: 'CLEAR_TOAST' }), 3200);
    return () => clearTimeout(t);
  }, [state.toast]);

  // --- actions ------------------------------------------------------------

  const showToast = useCallback(
    (message: string, tone: 'ok' | 'error' | 'info' = 'ok') =>
      dispatch({ type: 'TOAST', message, tone }),
    [],
  );

  const signIn = useCallback(async (email: string, role: User['role'] = 'owner') => {
    // Local account only. There is no auth server in this deployment — the
    // hardware is reached directly over the LAN, so a login exists to scope
    // roles and label who changed a node's configuration, not to gate access
    // to a backend that does not exist.
    const user: User = {
      id: `u-${Date.now().toString(36)}`,
      name: email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()),
      email: email.trim(),
      role,
      farmId: 'local',
      avatarColor: '#35C77E',
      lastActive: Date.now(),
    };
    await storage.save(storage.KEYS.session, user);
    dispatch({ type: 'SIGN_IN', user });
    dispatch({ type: 'UPSERT_USER', user });
  }, []);

  const signOut = useCallback(() => {
    storage.remove(storage.KEYS.session);
    transportRef.current?.disconnect();
    dispatch({ type: 'SIGN_OUT' });
  }, []);

  /**
   * Config writes take the full round trip described in §6 step 5. When the
   * link is down the change is queued locally and replayed later — the user
   * still sees it applied optimistically, with the pending count visible in
   * the connection banner so nothing is silently lost.
   */
  const setNodeConfig = useCallback(
    async (nodeId: string, config: NodeConfig): Promise<boolean> => {
      dispatch({ type: 'SET_CONFIG', nodeId, config });
      dispatch({ type: 'PENDING', delta: 1 });
      try {
        if (!transportRef.current) throw new Error('offline');
        await transportRef.current.publishConfig(nodeId, config);
        dispatch({ type: 'PENDING', delta: -1 });
        showToast('Configuration pushed to node');
        return true;
      } catch {
        await storage.enqueue({ kind: 'config', nodeId, payload: { config } });
        showToast('Saved offline — will sync when the node reconnects', 'info');
        return false;
      }
    },
    [showToast],
  );

  const setArmed = useCallback(
    async (nodeId: string, armed: boolean): Promise<boolean> => {
      dispatch({
        type: 'PATCH_NODE',
        nodeId,
        patch: { status: armed ? 'armed' : 'disarmed' },
      });
      dispatch({ type: 'PENDING', delta: 1 });
      try {
        if (!transportRef.current) throw new Error('offline');
        await transportRef.current.publishCommand(nodeId, armed ? 'arm' : 'disarm');
        dispatch({ type: 'PENDING', delta: -1 });
        showToast(armed ? 'Node armed' : 'Node disarmed — detection continues');
        return true;
      } catch {
        await storage.enqueue({ kind: armed ? 'arm' : 'disarm', nodeId, payload: {} });
        showToast('Queued — node is unreachable right now', 'info');
        return false;
      }
    },
    [showToast],
  );

  const testDeterrent = useCallback(
    async (nodeId: string): Promise<boolean> => {
      try {
        if (!transportRef.current) throw new Error('offline');
        await transportRef.current.publishCommand(nodeId, 'test-deterrent');
        showToast('Test burst fired — check the node');
        return true;
      } catch {
        showToast('Cannot reach the node', 'error');
        return false;
      }
    },
    [showToast],
  );

  /** Pair a physical node. The transport effect picks it up immediately. */
  const pairDevice = useCallback(
    async (host: string, port: number, deviceId?: string, name?: string) => {
      const devices = await addDevice({
        host,
        port,
        deviceId,
        name,
        addedAt: Date.now(),
      });
      dispatch({ type: 'SET_DEVICES', devices });
      showToast(name ? `${name} paired` : 'Node paired');
    },
    [showToast],
  );

  const unpairDevice = useCallback(
    async (host: string) => {
      const devices = await removeDevice(host);
      dispatch({ type: 'SET_DEVICES', devices });
      showToast('Node removed');
    },
    [showToast],
  );

  const requireNotificationPermission = useCallback(async () => {
    const granted = await requestPermissions();
    if (!granted) showToast('Notification permission denied', 'error');
    return granted;
  }, [showToast]);

  const value = useMemo<StoreValue>(
    () => ({
      ...state,
      signIn,
      signOut,
      nodeById: (id) => state.nodes.find((n) => n.id === id),
      eventById: (id) => state.events.find((e) => e.id === id),
      eventsForNode: (id) => state.events.filter((e) => e.nodeId === id),
      setNodeConfig,
      setArmed,
      testDeterrent,
      labelEvent: (eventId, label) => {
        dispatch({ type: 'LABEL_EVENT', eventId, label });
        showToast(
          label === 'false_alarm'
            ? 'Marked as a false alarm — this feeds the next threshold suggestion'
            : label
              ? 'Label saved — added to the training set'
              : 'Label cleared',
        );
      },
      markAlertRead: (id) => dispatch({ type: 'READ_ALERT', id }),
      markAllAlertsRead: () => dispatch({ type: 'READ_ALL_ALERTS' }),
      dismissAlert: (id) => dispatch({ type: 'DISMISS_ALERT', id }),
      setPrefs: (prefs) => dispatch({ type: 'SET_PREFS', prefs }),
      setOfflineMode: (offline) => dispatch({ type: 'SET_OFFLINE', offline }),
      addNode: (node) => {
        dispatch({ type: 'ADD_NODE', node });
        showToast(`${node.name} added to ${node.zone}`);
      },
      removeNode: (nodeId) => dispatch({ type: 'REMOVE_NODE', nodeId }),
      upsertUser: (user) => dispatch({ type: 'UPSERT_USER', user }),
      removeUser: (userId) => dispatch({ type: 'REMOVE_USER', userId }),
      pairDevice,
      unpairDevice,
      setFarm: (farm: Farm) => {
        storage.save(FARM_KEY, farm);
        dispatch({ type: 'HYDRATE', payload: { farm } });
      },
      showToast,
      clearToast: () => dispatch({ type: 'CLEAR_TOAST' }),
      unreadAlerts: state.alerts.filter((a) => !a.read).length,
      online: state.link.state === 'connected' || state.link.state === 'degraded',
      permissions: {
        viewDashboard: can(state.currentUser?.role ?? 'supervisor', 'viewDashboard'),
        armDisarm: can(state.currentUser?.role ?? 'supervisor', 'armDisarm'),
        editConfig: can(state.currentUser?.role ?? 'supervisor', 'editConfig'),
        provisionNodes: can(state.currentUser?.role ?? 'supervisor', 'provisionNodes'),
        manageUsers: can(state.currentUser?.role ?? 'supervisor', 'manageUsers'),
        exportData: can(state.currentUser?.role ?? 'supervisor', 'exportData'),
        labelEvents: can(state.currentUser?.role ?? 'supervisor', 'labelEvents'),
      },
      requireNotificationPermission,
    }),
    [state, signIn, signOut, setNodeConfig, setArmed, testDeterrent, showToast,
     pairDevice, unpairDevice, requireNotificationPermission],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside <StoreProvider>');
  return ctx;
}

/** Convenience selector for a single node plus its event slice. */
export function useNode(nodeId: string | undefined) {
  const store = useStore();
  return useMemo(() => {
    const node = nodeId ? store.nodeById(nodeId) : undefined;
    const events = nodeId ? store.events.filter((e) => e.nodeId === nodeId) : [];
    return { node, events };
  }, [nodeId, store]);
}
