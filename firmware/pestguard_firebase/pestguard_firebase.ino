/*
 * Pest Deterrent System — ESP32 ↔ Firebase Realtime Database
 *
 * A complete, working reference for the database you already have. It reads and
 * writes exactly the paths under pestDetector/device1 that the mobile app uses,
 * and nothing else.
 *
 * ---------------------------------------------------------------------------
 * WHY YOU ARE READING THIS
 * ---------------------------------------------------------------------------
 * The app says "ON requested · unconfirmed" on every control. That is not a bug
 * — it is the app declining to claim something it cannot observe.
 *
 * Your database has one field per output. When the app writes led1 = true and
 * reads led1 = true back, it is reading its own write echoed by Firebase. The
 * ESP32 might be unplugged. Reporting "ON · confirmed" from that would be a
 * guess dressed as a measurement.
 *
 * The fix is one extra write per output. After the sketch drives a pin, it
 * reports what it actually applied to:
 *
 *     pestDetector/device1/state/led1
 *
 * The app watches that node. The moment it appears, every control upgrades
 * itself from "unconfirmed" to a real
 * sending → waiting for device → confirmed cycle. No app change is needed.
 *
 * ---------------------------------------------------------------------------
 * HOW TO USE THIS FILE
 * ---------------------------------------------------------------------------
 * You already have a working sketch. Do not throw it away. Copy across the
 * three marked sections:
 *
 *   [1] HEARTBEAT   — so the app can tell running from switched-off
 *   [2] STATE       — so controls become genuinely confirmed
 *   [3] SETTINGS    — so the app's thresholds and enable switch take effect
 *
 * Everything else here is scaffolding to show them in context.
 *
 * ---------------------------------------------------------------------------
 * LIBRARY
 * ---------------------------------------------------------------------------
 * "Firebase Arduino Client Library for ESP8266 and ESP32" by Mobizt.
 * Library Manager → search "Firebase ESP Client".
 *
 * If your existing sketch uses a different Firebase library, keep it — only the
 * function names change. The paths and the logic are what matter.
 */

#include <WiFi.h>
#include <Firebase_ESP_Client.h>
#include <addons/TokenHelper.h>
#include <time.h>

// ===========================================================================
// EDIT THESE
// ===========================================================================
#define WIFI_SSID       "YOUR_WIFI_NAME"
#define WIFI_PASSWORD   "YOUR_WIFI_PASSWORD"

#define DATABASE_URL    "https://pest-deterrent-system-7-default-rtdb.firebaseio.com"
// Realtime Database → the long "Database secret", or an API key + auth if you
// have moved to authenticated rules. With the rules currently wide open this
// can stay empty, but that is exactly the state you should not ship in.
#define DATABASE_SECRET ""

#define DEVICE_ID       "device1"

// ===========================================================================
// PINS — change to match your wiring
// ===========================================================================
#define PIN_TRIG        5     // HC-SR04 trigger
#define PIN_ECHO        18    // HC-SR04 echo
#define PIN_SOUND       34    // sound sensor analog out (ADC1, input-only)
#define PIN_BUZZER      27
#define PIN_LED_GREEN   25    // led1
#define PIN_LED_YELLOW  26    // led2
#define PIN_LED_RED     33    // led3

// ===========================================================================
// State
// ===========================================================================
FirebaseData   fbdo;       // for reads/writes
FirebaseData   stream;     // dedicated object for the command stream
FirebaseAuth   auth;
FirebaseConfig config;

String basePath = String("/pestDetector/") + DEVICE_ID;

// Commanded values, updated by the Firebase stream.
bool cmdAlarm = false, cmdLed1 = false, cmdLed2 = false, cmdLed3 = false;

// [3] Settings the app owns. Defaults apply until Firebase supplies a value.
bool  sysEnabled        = true;
float distanceThreshold = 30.0;   // cm — closer than this is a detection
int   soundThreshold    = 500;    // raw ADC — louder than this is a detection
String deviceMode       = "auto"; // "auto" = this sketch decides; "manual" = app does

unsigned long lastBeat      = 0;
unsigned long lastTelemetry = 0;

// ===========================================================================
// Sensors
// ===========================================================================
float readDistanceCm() {
  digitalWrite(PIN_TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(PIN_TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(PIN_TRIG, LOW);

  // 30 ms ceiling ≈ 5 m. Without a timeout a missing echo blocks for a second.
  unsigned long us = pulseIn(PIN_ECHO, HIGH, 30000UL);
  if (us == 0) return -1;            // no echo
  return us * 0.0343f / 2.0f;
}

int readSoundLevel() {
  // Peak over a short window: a sound sensor's output is spiky, and a single
  // analogRead lands wherever the waveform happens to be.
  int peak = 0;
  for (int i = 0; i < 32; i++) {
    int v = analogRead(PIN_SOUND);
    if (v > peak) peak = v;
    delayMicroseconds(200);
  }
  return peak;
}

// ===========================================================================
// [2] STATE — report what was ACTUALLY applied
// ===========================================================================
/*
 * Call this immediately after driving the pins, never before. The whole point
 * is that it reports reality, so writing it optimistically would recreate the
 * exact problem it exists to solve.
 *
 * Only writes when something changed — Firebase bills by operation and a
 * ten-times-a-second rewrite of an unchanged boolean is pure waste.
 */
void reportState(bool alarm, bool l1, bool l2, bool l3) {
  static bool init = false;
  static bool pAlarm, pL1, pL2, pL3;

  if (init && alarm == pAlarm && l1 == pL1 && l2 == pL2 && l3 == pL3) return;

  FirebaseJson json;
  json.set("alarm", alarm);
  json.set("led1",  l1);
  json.set("led2",  l2);
  json.set("led3",  l3);

  if (Firebase.RTDB.updateNode(&fbdo, basePath + "/state", &json)) {
    pAlarm = alarm; pL1 = l1; pL2 = l2; pL3 = l3;
    init = true;
  } else {
    Serial.print("state write failed: ");
    Serial.println(fbdo.errorReason());
  }
}

/** Drive the hardware, then report it. Single place, so the two cannot drift. */
void applyOutputs(bool alarm, bool l1, bool l2, bool l3) {
  digitalWrite(PIN_BUZZER,     alarm ? HIGH : LOW);
  digitalWrite(PIN_LED_GREEN,  l1    ? HIGH : LOW);
  digitalWrite(PIN_LED_YELLOW, l2    ? HIGH : LOW);
  digitalWrite(PIN_LED_RED,    l3    ? HIGH : LOW);

  reportState(alarm, l1, l2, l3);
}

// ===========================================================================
// Command stream — app → ESP32
// ===========================================================================
/*
 * A stream, not a poll. Firebase pushes the change the instant it lands, so a
 * button press reaches the hardware in well under a second. Polling the same
 * node every few seconds would be slower and cost far more reads.
 */
void streamCallback(FirebaseStream data) {
  String path = data.dataPath();          // e.g. "/led1"
  String key  = path.substring(1);

  if (data.dataType() == "boolean") {
    bool v = data.boolData();
    if      (key == "alarm")   cmdAlarm = v;
    else if (key == "led1")    cmdLed1  = v;
    else if (key == "led2")    cmdLed2  = v;
    else if (key == "led3")    cmdLed3  = v;
    else if (key == "enabled") sysEnabled = v;         // [3]
  } else if (data.dataType() == "int" || data.dataType() == "double") {
    float v = data.floatData();
    if      (key == "distanceThreshold") distanceThreshold = v;   // [3]
    else if (key == "soundThreshold")    soundThreshold    = (int)v;
  } else if (data.dataType() == "string") {
    if (key == "mode") deviceMode = data.stringData();
  } else if (path == "/") {
    // Whole-node update: re-read everything at once.
    FirebaseJson *json = data.to<FirebaseJson *>();
    FirebaseJsonData r;
    if (json->get(r, "alarm"))             cmdAlarm = r.boolValue;
    if (json->get(r, "led1"))              cmdLed1  = r.boolValue;
    if (json->get(r, "led2"))              cmdLed2  = r.boolValue;
    if (json->get(r, "led3"))              cmdLed3  = r.boolValue;
    if (json->get(r, "enabled"))           sysEnabled = r.boolValue;
    if (json->get(r, "distanceThreshold")) distanceThreshold = r.doubleValue;
    if (json->get(r, "soundThreshold"))    soundThreshold = r.intValue;
    if (json->get(r, "mode"))              deviceMode = r.stringValue;
  }

  Serial.printf("cmd %s  enabled=%d  distTh=%.0f  soundTh=%d  mode=%s\n",
                key.c_str(), sysEnabled, distanceThreshold, soundThreshold,
                deviceMode.c_str());
}

void streamTimeoutCallback(bool timeout) {
  if (timeout) Serial.println("stream timed out, resuming");
  if (!stream.httpConnected()) {
    Serial.printf("stream error: %s\n", stream.errorReason().c_str());
  }
}

// ===========================================================================
// Setup
// ===========================================================================
void setup() {
  Serial.begin(115200);
  delay(300);

  pinMode(PIN_TRIG, OUTPUT);
  pinMode(PIN_ECHO, INPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_LED_GREEN, OUTPUT);
  pinMode(PIN_LED_YELLOW, OUTPUT);
  pinMode(PIN_LED_RED, OUTPUT);
  applyOutputs(false, false, false, false);

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Wi-Fi");
  while (WiFi.status() != WL_CONNECTED) { delay(400); Serial.print("."); }
  Serial.printf("\nconnected: %s\n", WiFi.localIP().toString().c_str());

  // NTP so lastUpdate is a real wall-clock time. The app copes without it —
  // it falls back to uptime — but a real timestamp is far easier to debug.
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");

  config.database_url = DATABASE_URL;
  config.signer.tokens.legacy_token = DATABASE_SECRET;
  Firebase.reconnectWiFi(true);
  Firebase.begin(&config, &auth);

  // Subscribe to the device node: every command and setting arrives here.
  if (!Firebase.RTDB.beginStream(&stream, basePath)) {
    Serial.printf("stream begin failed: %s\n", stream.errorReason().c_str());
  }
  Firebase.RTDB.setStreamCallback(&stream, streamCallback, streamTimeoutCallback);

  Serial.println("Ready.");
}

// ===========================================================================
// Loop
// ===========================================================================
void loop() {
  if (!Firebase.ready()) return;

  unsigned long now = millis();

  // ---- Sensors + decision -------------------------------------------------
  float dist  = readDistanceCm();
  int   sound = readSoundLevel();

  bool objectNear   = dist > 0 && dist < distanceThreshold;   // [3] app-tunable
  bool soundLoud    = sound > soundThreshold;                  // [3] app-tunable
  bool detection    = objectNear || soundLoud;

  bool alarm = cmdAlarm, l1 = cmdLed1, l2 = cmdLed2, l3 = cmdLed3;

  if (deviceMode == "manual") {
    // App drives the outputs directly; use the commanded values as-is.
  } else {
    // Auto: this sketch decides. Green = clear, yellow = close, red = detection.
    l3    = detection;
    l2    = !detection && dist > 0 && dist < distanceThreshold * 2;
    l1    = !detection && !l2;
    alarm = detection;
  }

  // [3] Master enable wins over everything.
  if (!sysEnabled) { alarm = false; l1 = false; l2 = false; l3 = false; }

  applyOutputs(alarm, l1, l2, l3);   // [2] drives pins AND reports real state

  // ---- Telemetry ----------------------------------------------------------
  // Every 2 s, and only when the reading actually moved — a rangefinder jitters
  // by a millimetre constantly, and writing that to Firebase forever is a good
  // way to exhaust a free tier for no information gain.
  static float lastDist = -999;
  static int   lastSound = -999;
  if (now - lastTelemetry > 2000) {
    lastTelemetry = now;
    if (fabs(dist - lastDist) > 1.0 || abs(sound - lastSound) > 20) {
      FirebaseJson t;
      t.set("distance", dist > 0 ? dist : 0);
      t.set("sound", sound);
      t.set("status", detection ? "detecting" : (sysEnabled ? "idle" : "disabled"));
      Firebase.RTDB.updateNode(&fbdo, basePath, &t);
      lastDist = dist;
      lastSound = sound;
    }
  }

  // ---- [1] HEARTBEAT ------------------------------------------------------
  // The single most valuable line in this file. Without it the app cannot tell
  // a running ESP32 from an unplugged one, and every reading it shows might be
  // days stale with no way to know.
  if (now - lastBeat > 5000) {
    lastBeat = now;
    time_t t = time(nullptr);
    // Epoch seconds if NTP landed, otherwise uptime — the app accepts either.
    Firebase.RTDB.setInt(&fbdo, basePath + "/lastUpdate",
                         t > 1600000000 ? (int)t : (int)(now / 1000));
  }

  delay(50);
}
