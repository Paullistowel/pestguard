# PestGuard Companion

A React Native mobile app and AI layer for the **Acoustic Pest & Rodent Deterrent System (Project 43)**.

Built with React Native 0.86 / React 19 on Expo SDK 57, in TypeScript, with Expo Router for
file-based navigation. Runs on Android, iOS and the web from one codebase.

The base project is an Arduino Nano node that listens on a microphone, runs a Goertzel band-energy
detector, and fires an ultrasonic / strobe / buzzer deterrent, reporting locally on a 16×2 LCD. This
app adds everything above that line: remote visibility, push notifications, a searchable history,
trend analytics, remote configuration, and a cloud AI layer that refines species labels, adapts
per-node thresholds, forecasts battery life and predicts infestations.

**The core principle, enforced throughout:** the node's detect-decide-deter loop is untouched and
authoritative. Nothing in this app sits between a detection and the deterrent firing. If the
network, the cloud, and the AI all disappeared, every node would keep protecting the farm exactly as
it does today — you would simply stop being told about it.

---

## Running it

```bash
npm install
npm start          # then press i / a, or scan the QR code with Expo Go
npm run web        # runs in a browser too
npm run typecheck  # tsc --noEmit
```

The build ships with a **simulated transport and a local copy of the cloud classifier**, so every
screen is fully populated without a gateway, a broker, or a Firebase project. Sign in with any of
the three demo accounts on the login screen to see how the role permissions actually differ.

---

## Going live

Three files, in order of how much work each is:

| To connect | Edit | What to do |
|---|---|---|
| A real MQTT broker | `src/services/realtime.ts` | Implement `Transport` against your MQTT client and return it from `createTransport()`. Nothing else in the app touches MQTT. |
| Firebase | `src/state/store.tsx` | Replace the seed hydration with a Firestore listener. The reducer already treats events as an append-only stream. |
| A trained classifier | `src/services/ai/classifier.ts` | Replace `score()`/`classify()` with a call to your Cloud Function. Keep the `Classification` return shape and every screen keeps working. |

The `Transport` interface is the whole integration surface:

```ts
interface Transport {
  connect(handlers: TransportEvents): void;
  disconnect(): void;
  publishConfig(nodeId: string, config: unknown): Promise<void>;
  publishCommand(nodeId: string, cmd: string, args?: unknown): Promise<void>;
  isConnected(): boolean;
}
```

### Topic structure

```
pestguard/v1/{farm}/{node}/events    ← gateway publishes detections + heartbeats
pestguard/v1/{farm}/{node}/status    ← retained last will, marks a node offline in seconds
pestguard/v1/{farm}/{node}/config    → retained config document, pulled on boot
pestguard/v1/{farm}/{node}/cmd       → arm / disarm / test-deterrent, QoS 1
```

### The firmware change

The entire change required on the Nano is printing one line per event to the previously unused
hardware UART:

```c
{"evt":"detect","class":"rodent","conf":0.87,"batt":78}
```

No changes to the Goertzel detection, PWM deterrent or LCD code paths. **Level-shift D1 → ESP32 RX**
— the Nano idles at 5 V and the ESP32 is not 5 V tolerant.

---

## Structure

```
app/                          expo-router file-based routes
  (auth)/                     login, register, password reset, onboarding
  (tabs)/                     dashboard, nodes, history, analytics, more
  node/[id]                   node detail — overview / activity / power / hardware
  node/config                 remote configuration, full round trip
  node/diagnostics            10-point self-test suite
  event/[id]                  detection detail + AI explainability
  species/[id]                per-species acoustic profile
  settings/                   notifications, team, connectivity, ai, data, appearance, about
  alerts, map, provision

src/
  components/                 ui primitives, domain components, charts
  services/
    ai/classifier.ts          softmax classifier + accuracy scoring
    ai/anomaly.ts             seasonal decomposition → predictive alerts
    ai/battery.ts             least-squares discharge fit → days remaining
    ai/thresholds.ts          per-node adaptive sensitivity
    realtime.ts               transport interface + simulator
    analytics.ts              every aggregation the charts need
    notifications.ts          push delivery, cooldowns, batching, quiet hours
    export.ts                 CSV + training-set export
    storage.ts                offline cache + outbox
    permissions.ts            three-role matrix
  state/store.tsx             single store: transport, AI sweeps, cache, auth
  theme/                      validated palettes, spacing, type scale
  data/                       pest catalogue + deterministic 30-day fixture
```

---

## Feature map against the proposal

Every feature in §4 of the technical proposal, and where it lives:

| Proposal feature | Screen |
|---|---|
| Live Dashboard | `(tabs)/dashboard` — farm score, per-node status, live event stream |
| Push Notifications | `services/notifications.ts`, tuned in `settings/notifications` |
| Detection History & Log | `(tabs)/history` — search, 6 filter dimensions, CSV export |
| Trend Analytics | `(tabs)/analytics` — 4 tabs, 9 chart types |
| Multi-Node Map View | `map`, plus the inline map on `(tabs)/nodes` |
| Remote Configuration | `node/config` — sensitivity, pattern, channels, timing, quiet hours |
| Species Identification | `event/[id]` — probabilities, feature attribution, node-vs-cloud |
| Predictive Alerts | `analytics` → Nodes tab, and `node/[id]` |
| Battery & Health | `node/[id]` → Power tab — regression, projection, draw breakdown |
| Offline Mode | `services/storage.ts` — cache + replay outbox; toggle in `more` |
| User Accounts & Roles | `settings/team` — full permission matrix |

Plus, beyond the proposal: node provisioning over BLE, a hardware self-test suite, per-species
reference pages, AI explainability on every detection, and a live notification-volume preview.

---

## Design decisions worth knowing

**Charts use one categorical scale.** Pest class is the only genuinely categorical dimension, so it
gets the four validated hues (plus neutral grey for unclassified). Everything else — by node, by
zone, by hour — is magnitude, and uses a single hue. Six simultaneous hues failed all-pairs
colour-blindness separation, so that option was cut rather than shipped.

Both the light and dark palettes were validated for lightness band, chroma floor, contrast against
their own chart surface, and CVD separation across *every* pair. The worst protanopic pair sits in
the 6–8 ΔE floor band, which is only legal alongside secondary encoding — so every chart carries a
legend, a species glyph and direct labels. Identity never rests on colour alone.

**Touch to inspect, not hover.** There is no hover on a phone. Line charts take a drag gesture with
a crosshair; bars and heatmap cells respond to press. Hit targets are always larger than the marks.

**The map is a schematic, not a basemap.** A satellite tile of a maize field tells a farmer nothing
they don't know. Relative position plus status colour answers the actual question — which corner is
unprotected. It also works offline and needs no native map dependency. Real GPS coordinates are kept
on every node and shown in the detail view.

**Notifications default to restraint.** A node in a bad week fires dozens of times an hour. A farmer
who gets buzzed for each one turns notifications off, and then the system is worse than useless. So:
a confidence floor, a per-node cooldown, batching, a risk threshold, and quiet hours — with a live
preview on the settings screen that runs your real last-24-hours events through the exact same
predicate the delivery path uses, so you can see what each slider actually costs you.

**Supervisors are read-only by design.** A project supervisor reviewing field data has every reason
to look at a node and none to change one. Making that a hard boundary means an accidental tap during
a demo cannot disarm a deterrent mid-trial and quietly invalidate the data being collected.

**The AI abstains.** Below 42% confidence the classifier returns "Unclassified" rather than naming a
species. A wrong label with a confident-looking bar is worse than an honest shrug you can correct —
and those corrections are what drive both retraining and the per-node threshold suggestions.

---

## Testing against §9 of the proposal

The app surfaces each validation line item directly:

- **Connectivity reliability** — `settings/connectivity`: queued events per gateway, app outbox, replay behaviour
- **Latency** — `analytics` → Trends: p50 / p90 / worst, and share within the 5 s Wi-Fi target
- **Non-interference** — `node/diagnostics`: UART framing check
- **Battery impact** — `node/[id]` → Power: measured discharge, fit quality, draw breakdown
- **AI accuracy** — `analytics` → AI: precision, recall and F1 per class against ground truth
- **App usability** — the whole thing; role switching on the login screen makes multi-user testing a single tap

---

Embedded Systems Project · Mobile App & AI Companion Extension · Project 43
