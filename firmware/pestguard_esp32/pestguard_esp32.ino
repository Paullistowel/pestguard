/*
 * PestGuard — Acoustic Pest & Rodent Deterrent Node
 * ESP32 standalone firmware (Project 43)
 *
 * One board does everything: samples a microphone, runs a Goertzel band-energy
 * detector, decides whether a pest is present, drives the ultrasonic / strobe /
 * buzzer deterrent, and serves its state to the PestGuard mobile app over Wi-Fi.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS CAN AND CANNOT HEAR — read this before wiring
 * ---------------------------------------------------------------------------
 * The ESP32's ADC, driven as fast as `adc1_get_raw()` reliably allows, samples
 * at SAMPLE_RATE_HZ (40 kHz by default). Nyquist puts a hard ceiling at half of
 * that: 20 kHz. Anything above 20 kHz is invisible to this code no matter what
 * microphone you attach.
 *
 * That means:
 *   YES — bird calls, insect stridulation, rodent gnawing and audible squeaks,
 *         machinery, wind. All of it sits under 20 kHz.
 *   NO  — true rodent ultrasonic vocalisation (20–40 kHz) and bat echolocation.
 *
 * The original proposal lists a 20–40 kHz band. It is not reachable on this
 * hardware path, and a standard electret capsule rolls off around 16–20 kHz
 * anyway, so it would read as noise even if the sample rate allowed it. Rather
 * than ship a band that is silently always empty, the four bands below span the
 * range this hardware genuinely covers. The app labels its charts from the
 * `bands` array this firmware reports, so they stay honest automatically.
 *
 * To reach true ultrasound you need both an ultrasonic transducer (e.g. a
 * 40 kHz receiver or a MEMS mic specified past 40 kHz) AND a faster acquisition
 * path — I2S with an external ADC at >=96 kHz. That is a hardware change, not a
 * firmware setting.
 *
 * ---------------------------------------------------------------------------
 * WIRING (change the pin defines below to match your board)
 * ---------------------------------------------------------------------------
 *   Microphone (MAX9814 / MAX4466 analog out) ... GPIO36  (ADC1_CH0, input only)
 *   Battery sense, via 100k/100k divider ........ GPIO35  (ADC1_CH7, input only)
 *   Ultrasonic transducer (through driver) ...... GPIO25
 *   Strobe LED array (through MOSFET gate) ...... GPIO26
 *   Piezo buzzer ................................ GPIO27
 *   Status LED .................................. GPIO2   (onboard on most devkits)
 *
 * GPIO36 and GPIO35 are input-only pins — correct for ADC, and they cannot be
 * driven by mistake. Do not move the mic to an ADC2 pin (GPIO0/2/4/12-15/25-27):
 * ADC2 is unavailable whenever Wi-Fi is active, which is always, here.
 *
 * Never drive the ultrasonic transducer or the LED array straight off a GPIO.
 * The ESP32 sources 40 mA absolute maximum per pin; use a MOSFET or a driver.
 *
 * ---------------------------------------------------------------------------
 * LIBRARIES
 * ---------------------------------------------------------------------------
 * One external library, via Arduino IDE → Tools → Manage Libraries:
 *   "WebSockets" by Markus Sattler   (arduinoWebSockets)
 * Everything else ships with the ESP32 board package.
 *
 * Board: "ESP32 Dev Module". Tested against ESP32 Arduino core 2.x and 3.x.
 */

#include <WiFi.h>
#include <WebServer.h>
#include <WebSocketsServer.h>
#include <Preferences.h>
#include <ESPmDNS.h>
#include <time.h>
#include <math.h>
#include "driver/adc.h"

// ===========================================================================
// USER SETTINGS — edit these two lines, flash, done.
// ===========================================================================
const char* WIFI_SSID     = "YOUR_WIFI_NAME";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// Shown in the app. Change per node if you build more than one.
const char* NODE_NAME = "North Gate";
const char* NODE_ZONE = "North Field";

// ===========================================================================
// Pins
// ===========================================================================
#define PIN_MIC          36
#define PIN_BATTERY      35
#define PIN_ULTRASONIC   25
#define PIN_STROBE       26
#define PIN_BUZZER       27
#define PIN_STATUS_LED    2

// ===========================================================================
// Signal processing
// ===========================================================================
/*
 * SENSOR TYPE — this is the most important setting in the file.
 *
 *   SENSOR_ENVELOPE (1): a sound-sensor module (KY-038, KY-037, LM393-based).
 *     Its analog pin outputs a rectified, smoothed *amplitude envelope*, not a
 *     waveform. There is no spectrum to extract — running a Goertzel over it
 *     produces numbers, but they mean nothing. In this mode the node measures
 *     what the hardware can actually report: loudness, attack sharpness, event
 *     duration and burst rhythm. Gnawing, chirping and steady ambient noise
 *     separate well on those.
 *
 *   SENSOR_WAVEFORM (0): an electret module with a real preamp (MAX9814,
 *     MAX4466). This outputs an audio waveform, so the four Goertzel bands
 *     below become meaningful and species classification by spectrum works.
 *
 * Set this to match what is physically on the ADC pin. The app reads the mode
 * from the status endpoint and labels its charts accordingly, so it never
 * claims a measurement the sensor cannot make.
 */
#define SENSOR_ENVELOPE  1

#if SENSOR_ENVELOPE
  // An LM393 envelope follower has no useful content above a few hundred Hz.
  // Sampling faster buys nothing but heat.
  #define SAMPLE_RATE_HZ   2000
  #define WINDOW_SAMPLES    256     // 128 ms of envelope per window
#else
  #define SAMPLE_RATE_HZ  40000
  #define WINDOW_SAMPLES    512     // 12.8 ms at 40 kHz
#endif

#define NUM_BANDS           4
#define PROBES_PER_BAND     3

// Band edges in Hz. Must stay below SAMPLE_RATE_HZ / 2.
const float BAND_EDGES[NUM_BANDS][2] = {
  { 1500.0f,  5000.0f },   // b1 — bird calls, rodent gnawing transients
  { 5000.0f,  9000.0f },   // b2 — rodent squeaks, upper bird harmonics
  { 9000.0f, 14000.0f },   // b3 — insect stridulation
  {14000.0f, 19000.0f },   // b4 — high insect harmonics, sibilant noise
};

// Battery: 100k/100k divider, so the pin sees half the pack voltage.
#define BATTERY_DIVIDER   2.0f
#define BATTERY_FULL_V    4.15f
#define BATTERY_EMPTY_V   3.20f
// Trim this if your multimeter disagrees with the reported voltage.
#define ADC_REF_V         3.30f

#define EVENT_BUFFER_SIZE  200
#define WS_PORT           81

// ===========================================================================
// State
// ===========================================================================
WebServer       http(80);
WebSocketsServer ws(WS_PORT);
Preferences     prefs;

struct Config {
  uint8_t  sens;             // 0..100, detection threshold above noise floor
  char     pattern[8];       // sweep | pulse | burst | random | silent
  uint8_t  intensity;        // 0..100 ultrasonic duty
  uint8_t  dur;              // deterrent burst length, seconds
  uint16_t cooldown;         // seconds
  bool     ultrasonic;
  bool     strobe;
  bool     buzzer;
  bool     quiet;
  uint16_t quietStart;       // minutes from midnight
  uint16_t quietEnd;
  bool     quietUltrasonic;
  uint16_t heartbeat;        // seconds
} cfg;

struct Event {
  uint32_t id;
  uint64_t ts;               // epoch ms, 0 if no NTP
  uint32_t up;               // millis at capture
  char     evt[10];
  char     cls[8];
  float    conf;
  float    b[NUM_BANDS];
  uint16_t dwell;
  uint8_t  batt;
  float    volts;
  int16_t  rssi;
  bool     chUltrasonic, chStrobe, chBuzzer;
  uint16_t durMs;
};

Event    ring[EVENT_BUFFER_SIZE];
uint16_t ringHead = 0;
uint16_t ringCount = 0;
uint32_t eventSeq = 0;

bool     armed = true;
bool     faulted = false;
char     faultMsg[64] = "";

// Detector state
float    noiseFloor[NUM_BANDS] = {0};
bool     noiseFloorReady = false;
uint32_t detectStartMs = 0;
bool     inDetection = false;
float    peakBands[NUM_BANDS] = {0};
float    peakConf = 0;
char     peakCls[8] = "unknown";

// Deterrent state machine
bool     deterring = false;
uint32_t deterStartMs = 0;
uint32_t deterEndMs = 0;
uint32_t cooldownUntilMs = 0;
bool     activeUltrasonic = false, activeStrobe = false, activeBuzzer = false;

uint32_t lastHeartbeatMs = 0;
uint32_t bootMs = 0;

int16_t  samples[WINDOW_SAMPLES];

// LEDC channels
#define LEDC_ULTRASONIC 0
#define LEDC_BUZZER     1

// ---------------------------------------------------------------------------
// LEDC compatibility
// ---------------------------------------------------------------------------
/*
 * ESP32 Arduino core 3.x reworked the LEDC API: ledcWrite() and
 * ledcChangeFrequency() now take the GPIO, where 2.x took the channel number.
 * Calling the wrong one compiles on some cores and silently drives nothing on
 * others, which is a miserable thing to debug with a transducer in your hand.
 * These two helpers take both and route to whichever the installed core wants,
 * so the sketch builds and behaves identically on either.
 */
static inline void pwmWrite(uint8_t pin, uint8_t ch, uint32_t duty) {
#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
  (void)ch; ledcWrite(pin, duty);
#else
  (void)pin; ledcWrite(ch, duty);
#endif
}

static inline void pwmFreq(uint8_t pin, uint8_t ch, uint32_t freq) {
#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
  (void)ch; ledcChangeFrequency(pin, freq, 8);
#else
  (void)pin; ledcChangeFrequency(ch, freq, 8);
#endif
}

// ---------------------------------------------------------------------------
// Forward declarations
// ---------------------------------------------------------------------------
// The Arduino IDE normally generates these itself, but it gets it wrong for
// functions taking a struct reference or a default argument — both of which
// appear below. Declaring them explicitly removes that failure mode.
String eventJson(const Event& e, const char* note = nullptr);
String statusJson();
String configJson();
void   pushEvent(const char* evt, const char* cls, float conf, const float* bands,
                 uint16_t dwell, bool cu, bool cs, bool cb, uint16_t durMs,
                 const char* note);
void   startDeterrent(uint16_t durationMs);
void   stopDeterrent();
bool   jsonInt(const String& body, const char* key, long& out);

// ===========================================================================
// Config persistence
// ===========================================================================
void loadConfig() {
  prefs.begin("pestguard", true);
  cfg.sens            = prefs.getUChar("sens", 62);
  String pat          = prefs.getString("pattern", "sweep");
  strncpy(cfg.pattern, pat.c_str(), sizeof(cfg.pattern) - 1);
  cfg.pattern[sizeof(cfg.pattern) - 1] = 0;
  cfg.intensity       = prefs.getUChar("intensity", 78);
  cfg.dur             = prefs.getUChar("dur", 12);
  cfg.cooldown        = prefs.getUShort("cooldown", 45);
  cfg.ultrasonic      = prefs.getBool("ultrasonic", true);
  cfg.strobe          = prefs.getBool("strobe", true);
  cfg.buzzer          = prefs.getBool("buzzer", true);
  cfg.quiet           = prefs.getBool("quiet", false);
  cfg.quietStart      = prefs.getUShort("quietStart", 22 * 60);
  cfg.quietEnd        = prefs.getUShort("quietEnd", 6 * 60);
  cfg.quietUltrasonic = prefs.getBool("quietUS", true);
  cfg.heartbeat       = prefs.getUShort("heartbeat", 300);
  armed               = prefs.getBool("armed", true);
  prefs.end();
}

void saveConfig() {
  prefs.begin("pestguard", false);
  prefs.putUChar("sens", cfg.sens);
  prefs.putString("pattern", cfg.pattern);
  prefs.putUChar("intensity", cfg.intensity);
  prefs.putUChar("dur", cfg.dur);
  prefs.putUShort("cooldown", cfg.cooldown);
  prefs.putBool("ultrasonic", cfg.ultrasonic);
  prefs.putBool("strobe", cfg.strobe);
  prefs.putBool("buzzer", cfg.buzzer);
  prefs.putBool("quiet", cfg.quiet);
  prefs.putUShort("quietStart", cfg.quietStart);
  prefs.putUShort("quietEnd", cfg.quietEnd);
  prefs.putBool("quietUS", cfg.quietUltrasonic);
  prefs.putUShort("heartbeat", cfg.heartbeat);
  prefs.putBool("armed", armed);
  prefs.end();
}

// ===========================================================================
// Device identity
// ===========================================================================
String deviceId() {
  uint64_t mac = ESP.getEfuseMac();
  char buf[24];
  snprintf(buf, sizeof(buf), "PG-%02X%02X%02X",
           (uint8_t)(mac >> 24), (uint8_t)(mac >> 16), (uint8_t)(mac >> 8));
  return String(buf);
}

// ===========================================================================
// Battery
// ===========================================================================
float readBatteryVolts() {
  // Average a few reads — the ESP32 ADC is noisy enough that a single sample
  // makes the app's discharge regression fit garbage.
  uint32_t acc = 0;
  for (int i = 0; i < 16; i++) acc += analogRead(PIN_BATTERY);
  float raw = acc / 16.0f;
  return (raw / 4095.0f) * ADC_REF_V * BATTERY_DIVIDER;
}

uint8_t batteryPercent(float v) {
  float pct = (v - BATTERY_EMPTY_V) / (BATTERY_FULL_V - BATTERY_EMPTY_V) * 100.0f;
  if (pct < 0) pct = 0;
  if (pct > 100) pct = 100;
  return (uint8_t)(pct + 0.5f);
}

// ===========================================================================
// Sampling + Goertzel
// ===========================================================================

/** Fill `samples` at approximately SAMPLE_RATE_HZ using busy-wait timing. */
void captureWindow() {
  const uint32_t periodUs = 1000000UL / SAMPLE_RATE_HZ;
  uint32_t next = micros();
  for (int i = 0; i < WINDOW_SAMPLES; i++) {
    while ((int32_t)(micros() - next) < 0) { /* spin */ }
    next += periodUs;
    samples[i] = (int16_t)adc1_get_raw(ADC1_CHANNEL_0) - 2048;  // centre on 0
  }
}

/**
 * Goertzel magnitude for one target frequency over the captured window.
 * Cheaper than an FFT when you only care about a handful of bins, which is
 * exactly the case here — twelve probes instead of a 512-point transform.
 */
float goertzel(float freqHz) {
  float k = 0.5f + ((WINDOW_SAMPLES * freqHz) / SAMPLE_RATE_HZ);
  float omega = (2.0f * PI * (int)k) / WINDOW_SAMPLES;
  float coeff = 2.0f * cosf(omega);
  float s0 = 0, s1 = 0, s2 = 0;
  for (int i = 0; i < WINDOW_SAMPLES; i++) {
    s0 = samples[i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  float mag = sqrtf(s1 * s1 + s2 * s2 - coeff * s1 * s2);
  return mag / (WINDOW_SAMPLES / 2.0f);
}

/*
 * Envelope features — the SENSOR_ENVELOPE path.
 *
 * Four numbers, in the same slots the spectral mode uses so the wire format
 * and every downstream chart stay identical:
 *   f0 loudness   peak level above the tracked noise floor
 *   f1 attack     how abruptly it started; a gnaw is sharp, wind is gradual
 *   f2 rhythm     zero-crossing rate of the envelope about its own mean,
 *                 which is what separates repetitive gnawing from a steady tone
 *   f3 sustain    fraction of the window spent above the floor
 */
void computeEnvelopeFeatures(float* out) {
  int32_t sum = 0;
  int16_t peak = 0;
  for (int i = 0; i < WINDOW_SAMPLES; i++) {
    int16_t v = samples[i] < 0 ? -samples[i] : samples[i];
    sum += v;
    if (v > peak) peak = v;
  }
  float mean = (float)sum / WINDOW_SAMPLES;

  // Crossings of the window mean: a proxy for how rhythmic the envelope is.
  uint16_t crossings = 0;
  uint16_t above = 0;
  bool prevAbove = false;
  for (int i = 0; i < WINDOW_SAMPLES; i++) {
    int16_t v = samples[i] < 0 ? -samples[i] : samples[i];
    bool isAbove = v > mean;
    if (i && isAbove != prevAbove) crossings++;
    if (isAbove) above++;
    prevAbove = isAbove;
  }

  // Attack: how much steeper the fastest rise is than the average level.
  int16_t maxRise = 0;
  for (int i = 1; i < WINDOW_SAMPLES; i++) {
    int16_t d = samples[i] - samples[i - 1];
    if (d > maxRise) maxRise = d;
  }

  const float FULL = 2048.0f;
  out[0] = constrain(peak / FULL, 0.0f, 1.0f);
  out[1] = constrain(maxRise / (FULL * 0.35f), 0.0f, 1.0f);
  out[2] = constrain(crossings / (float)(WINDOW_SAMPLES * 0.35f), 0.0f, 1.0f);
  out[3] = constrain(above / (float)WINDOW_SAMPLES, 0.0f, 1.0f);
}

/** Band energies: sum of PROBES_PER_BAND Goertzel probes spread across each band. */
void computeBands(float* out) {
  for (int b = 0; b < NUM_BANDS; b++) {
    float lo = BAND_EDGES[b][0], hi = BAND_EDGES[b][1];
    float sum = 0;
    for (int p = 0; p < PROBES_PER_BAND; p++) {
      float f = lo + (hi - lo) * (p + 0.5f) / PROBES_PER_BAND;
      sum += goertzel(f);
    }
    out[b] = sum / PROBES_PER_BAND;
  }
}

// ===========================================================================
// On-device classification
// ===========================================================================
/*
 * Deliberately simple and inspectable: ratios between bands, not a model. The
 * app runs a proper classifier over the same four numbers and shows a refined
 * label — but this one has to run in a few microseconds, needs no training
 * data, and is what actually gates the deterrent. Keeping it readable means a
 * wrong call can be diagnosed on a bench with a scope rather than debugged
 * through a black box.
 */
void classify(const float* norm, char* clsOut, float* confOut) {
#if SENSOR_ENVELOPE
  /*
   * Envelope classification.
   *
   * With no spectrum available these are behavioural categories, not species
   * identifications, and the confidence ceiling is deliberately lower than the
   * spectral path's. Calling a sharp rhythmic burst "rodent" on envelope data
   * alone would be a guess dressed up as a measurement — the app shows these
   * with the sensor mode attached so the distinction stays visible.
   */
  float loud = norm[0], attack = norm[1], rhythm = norm[2], sustain = norm[3];

  // Gnawing / scratching: sharp onset, strongly rhythmic, not sustained.
  float gnaw    = attack * 1.5f + rhythm * 1.4f - sustain * 0.8f;
  // Chirping: loud, sharp, short bursts with moderate rhythm.
  float chirp   = loud * 1.3f + attack * 0.9f - rhythm * 0.5f - sustain * 0.6f;
  // Steady stridulation or machinery: sustained and smooth.
  float steady  = sustain * 1.7f - attack * 0.9f;

  const char* cls = "unknown";
  float best = 0.0f;
  if (gnaw   > best) { best = gnaw;   cls = "rodent"; }
  if (chirp  > best) { best = chirp;  cls = "bird"; }
  if (steady > best) { best = steady; cls = "insect"; }

  // Cap at 0.8: envelope evidence never justifies more than that.
  float conf = constrain(best * 0.55f, 0.0f, 0.80f);
  if (conf < 0.35f) { cls = "unknown"; conf = 0.30f + conf * 0.2f; }

  strncpy(clsOut, cls, 7);
  clsOut[7] = 0;
  *confOut = conf;
  return;
#else
  float b1 = norm[0], b2 = norm[1], b3 = norm[2], b4 = norm[3];
  float best = 0;
  const char* cls = "unknown";

  // Bird: energy concentrated low, little above 9 kHz.
  float bird = b1 * 1.6f - b3 * 0.8f - b4 * 0.8f;
  // Insect: strong mid/high harmonic structure.
  float insect = (b3 + b4) * 1.3f - b1 * 0.6f;
  // Rodent: broad, with a distinct b2 emphasis from squeaks over gnawing.
  float rodent = b2 * 1.7f + b1 * 0.5f - b4 * 0.5f;

  if (bird > best)   { best = bird;   cls = "bird"; }
  if (insect > best) { best = insect; cls = "insect"; }
  if (rodent > best) { best = rodent; cls = "rodent"; }

  // Map the winning score into a confidence, floored so a marginal win never
  // reports as certainty.
  float conf = best;
  if (conf < 0) conf = 0;
  if (conf > 1) conf = 1;

  if (conf < 0.35f) { cls = "unknown"; conf = 0.30f + conf * 0.3f; }

  strncpy(clsOut, cls, 7);
  clsOut[7] = 0;
  *confOut = conf;
#endif
}

// ===========================================================================
// Event emission
// ===========================================================================
uint64_t epochMs() {
  time_t now = time(nullptr);
  if (now < 1600000000) return 0;          // NTP never landed
  return (uint64_t)now * 1000ULL;
}

void pushEvent(const char* evt, const char* cls, float conf, const float* bands,
               uint16_t dwell, bool cu, bool cs, bool cb, uint16_t durMs,
               const char* note) {
  Event& e = ring[ringHead];
  e.id = ++eventSeq;
  e.ts = epochMs();
  e.up = millis();
  strncpy(e.evt, evt, sizeof(e.evt) - 1); e.evt[sizeof(e.evt) - 1] = 0;
  strncpy(e.cls, cls, sizeof(e.cls) - 1); e.cls[sizeof(e.cls) - 1] = 0;
  e.conf = conf;
  for (int i = 0; i < NUM_BANDS; i++) e.b[i] = bands ? bands[i] : 0;
  e.dwell = dwell;
  float v = readBatteryVolts();
  e.volts = v;
  e.batt = batteryPercent(v);
  e.rssi = WiFi.RSSI();
  e.chUltrasonic = cu; e.chStrobe = cs; e.chBuzzer = cb;
  e.durMs = durMs;

  ringHead = (ringHead + 1) % EVENT_BUFFER_SIZE;
  if (ringCount < EVENT_BUFFER_SIZE) ringCount++;

  String json = "{\"t\":\"event\",\"e\":" + eventJson(e, note) + "}";
  ws.broadcastTXT(json);
}

String eventJson(const Event& e, const char* note) {
  String s = "{";
  s += "\"id\":" + String(e.id);
  s += ",\"ts\":" + String((unsigned long)(e.ts / 1000ULL)) + "000";
  s += ",\"up\":" + String(e.up);
  s += ",\"evt\":\"" + String(e.evt) + "\"";
  s += ",\"cls\":\"" + String(e.cls) + "\"";
  s += ",\"conf\":" + String(e.conf, 3);
  s += ",\"b\":[";
  for (int i = 0; i < NUM_BANDS; i++) {
    if (i) s += ",";
    s += String(e.b[i], 3);
  }
  s += "]";
  s += ",\"dwell\":" + String(e.dwell);
  s += ",\"batt\":" + String(e.batt);
  s += ",\"volts\":" + String(e.volts, 3);
  s += ",\"rssi\":" + String(e.rssi);
  if (e.chUltrasonic || e.chStrobe || e.chBuzzer) {
    s += ",\"ch\":[";
    bool first = true;
    if (e.chUltrasonic) { s += "\"ultrasonic\""; first = false; }
    if (e.chStrobe)     { if (!first) s += ","; s += "\"strobe\""; first = false; }
    if (e.chBuzzer)     { if (!first) s += ","; s += "\"buzzer\""; }
    s += "]";
    s += ",\"dur\":" + String(e.durMs);
  }
  if (note && note[0]) s += ",\"note\":\"" + String(note) + "\"";
  s += "}";
  return s;
}

// ===========================================================================
// Deterrent
// ===========================================================================
bool inQuietHours() {
  if (!cfg.quiet) return false;
  time_t now = time(nullptr);
  if (now < 1600000000) return false;      // no clock, cannot honour a schedule
  struct tm t;
  localtime_r(&now, &t);
  uint16_t m = t.tm_hour * 60 + t.tm_min;
  return cfg.quietStart <= cfg.quietEnd
       ? (m >= cfg.quietStart && m < cfg.quietEnd)
       : (m >= cfg.quietStart || m < cfg.quietEnd);
}

void startDeterrent(uint16_t durationMs) {
  bool quiet = inQuietHours();
  activeUltrasonic = cfg.ultrasonic;
  activeStrobe     = cfg.strobe && !(quiet && cfg.quietUltrasonic);
  activeBuzzer     = cfg.buzzer && !(quiet && cfg.quietUltrasonic);

  if (activeUltrasonic) {
    pwmWrite(PIN_ULTRASONIC, LEDC_ULTRASONIC, map(cfg.intensity, 0, 100, 0, 255));
  }
  if (activeStrobe) digitalWrite(PIN_STROBE, HIGH);
  if (activeBuzzer) pwmWrite(PIN_BUZZER, LEDC_BUZZER, 128);

  deterring    = true;
  deterStartMs = millis();
  deterEndMs   = deterStartMs + durationMs;
}

void stopDeterrent() {
  pwmWrite(PIN_ULTRASONIC, LEDC_ULTRASONIC, 0);
  pwmWrite(PIN_BUZZER, LEDC_BUZZER, 0);
  digitalWrite(PIN_STROBE, LOW);
  deterring = false;
  activeUltrasonic = activeStrobe = activeBuzzer = false;
  cooldownUntilMs = millis() + (uint32_t)cfg.cooldown * 1000UL;
}

/** Pattern shaping, applied while a burst is running. */
void serviceDeterrent() {
  if (!deterring) return;
  uint32_t now = millis();
  if (now >= deterEndMs) { stopDeterrent(); return; }

  uint32_t elapsed = now - deterStartMs;

  if (strcmp(cfg.pattern, "sweep") == 0 && activeUltrasonic) {
    // Sweep the carrier 18–40 kHz over 2 s so pests cannot habituate.
    uint32_t freq = 18000 + (elapsed % 2000) * 11;
    pwmFreq(PIN_ULTRASONIC, LEDC_ULTRASONIC, freq);
  } else if (strcmp(cfg.pattern, "pulse") == 0) {
    bool on = (elapsed % 500) < 200;
    if (activeUltrasonic) pwmWrite(PIN_ULTRASONIC, LEDC_ULTRASONIC, on ? map(cfg.intensity, 0, 100, 0, 255) : 0);
    if (activeStrobe) digitalWrite(PIN_STROBE, on ? HIGH : LOW);
  } else if (strcmp(cfg.pattern, "burst") == 0) {
    bool on = elapsed < 800 || (elapsed % 1500) < 300;
    if (activeStrobe) digitalWrite(PIN_STROBE, on ? HIGH : LOW);
    if (activeBuzzer) pwmWrite(PIN_BUZZER, LEDC_BUZZER, on ? 200 : 0);
  } else if (strcmp(cfg.pattern, "random") == 0 && activeUltrasonic) {
    if (elapsed % 400 < 20) {
      pwmFreq(PIN_ULTRASONIC, LEDC_ULTRASONIC, 18000 + random(22000));
      pwmWrite(PIN_ULTRASONIC, LEDC_ULTRASONIC, map(random(50, cfg.intensity + 1), 0, 100, 0, 255));
    }
  }
}

// ===========================================================================
// Detection loop
// ===========================================================================
void runDetector() {
  captureWindow();

  float raw[NUM_BANDS];
#if SENSOR_ENVELOPE
  computeEnvelopeFeatures(raw);
#else
  computeBands(raw);
#endif

  // Track the noise floor while nothing is happening. Slow EWMA — the floor
  // should follow the wind and the generator, not the pest.
  if (!noiseFloorReady) {
    static uint16_t warmup = 0;
    for (int i = 0; i < NUM_BANDS; i++) noiseFloor[i] += raw[i];
    if (++warmup >= 60) {
      for (int i = 0; i < NUM_BANDS; i++) noiseFloor[i] /= warmup;
      noiseFloorReady = true;
    }
    return;
  }

  float total = 0, floorTotal = 0;
  for (int i = 0; i < NUM_BANDS; i++) { total += raw[i]; floorTotal += noiseFloor[i]; }
  if (floorTotal < 1e-6f) floorTotal = 1e-6f;

  // Sensitivity 0..100 maps to a multiple of the noise floor. Higher setting
  // means a louder signature is required, matching the app's slider labels.
  float trigger = 1.5f + (cfg.sens / 100.0f) * 6.0f;
  bool over = (total / floorTotal) > trigger;

  if (over) {
    // Normalise the bands for classification and for the app's charts.
    float norm[NUM_BANDS];
    float peak = 0;
    for (int i = 0; i < NUM_BANDS; i++) if (raw[i] > peak) peak = raw[i];
    if (peak < 1e-6f) peak = 1e-6f;
    for (int i = 0; i < NUM_BANDS; i++) norm[i] = raw[i] / peak;

    char cls[8]; float conf;
    classify(norm, cls, &conf);

    if (!inDetection) {
      inDetection = true;
      detectStartMs = millis();
      peakConf = 0;
    }
    if (conf >= peakConf) {
      peakConf = conf;
      strncpy(peakCls, cls, sizeof(peakCls) - 1);
      for (int i = 0; i < NUM_BANDS; i++) peakBands[i] = norm[i];
    }
  } else {
    // Only adapt the floor when quiet, so a sustained pest cannot train the
    // detector into ignoring it.
    for (int i = 0; i < NUM_BANDS; i++) noiseFloor[i] = noiseFloor[i] * 0.995f + raw[i] * 0.005f;

    if (inDetection) {
      inDetection = false;
      uint32_t dwellMs32 = millis() - detectStartMs;
      uint16_t dwell = dwellMs32 > 65535 ? 65535 : (uint16_t)dwellMs32;
      if (dwell < 40) return;              // too brief to be anything real

      bool fire = armed
                && strcmp(cfg.pattern, "silent") != 0
                && strcmp(peakCls, "unknown") != 0
                && peakConf > 0.45f
                && millis() > cooldownUntilMs;

      if (fire) {
        startDeterrent((uint16_t)cfg.dur * 1000);
        pushEvent("deter", peakCls, peakConf, peakBands, dwell,
                  activeUltrasonic, activeStrobe, activeBuzzer,
                  (uint16_t)cfg.dur * 1000, nullptr);
      } else {
        pushEvent("detect", peakCls, peakConf, peakBands, dwell,
                  false, false, false, 0, nullptr);
      }
    }
  }
}

// ===========================================================================
// JSON output
// ===========================================================================
String configJson() {
  String s = "{";
  s += "\"sens\":" + String(cfg.sens);
  s += ",\"pattern\":\"" + String(cfg.pattern) + "\"";
  s += ",\"intensity\":" + String(cfg.intensity);
  s += ",\"dur\":" + String(cfg.dur);
  s += ",\"cooldown\":" + String(cfg.cooldown);
  s += ",\"ultrasonic\":" + String(cfg.ultrasonic ? "true" : "false");
  s += ",\"strobe\":" + String(cfg.strobe ? "true" : "false");
  s += ",\"buzzer\":" + String(cfg.buzzer ? "true" : "false");
  s += ",\"quiet\":" + String(cfg.quiet ? "true" : "false");
  s += ",\"quietStart\":" + String(cfg.quietStart);
  s += ",\"quietEnd\":" + String(cfg.quietEnd);
  s += ",\"quietUltrasonic\":" + String(cfg.quietUltrasonic ? "true" : "false");
  s += ",\"heartbeat\":" + String(cfg.heartbeat);
  s += "}";
  return s;
}

String statusJson() {
  float v = readBatteryVolts();
  String s = "{";
  s += "\"proto\":1";
  s += ",\"id\":\"" + deviceId() + "\"";
  s += ",\"name\":\"" + String(NODE_NAME) + "\"";
  s += ",\"zone\":\"" + String(NODE_ZONE) + "\"";
  s += ",\"fw\":\"pestguard-esp32 1.0.0\"";
  s += ",\"up\":" + String(millis());
  s += ",\"time\":" + String((unsigned long)(epochMs() / 1000ULL)) + "000";
  s += ",\"status\":\"";
  s += faulted ? "fault" : (deterring ? "deterring" : (armed ? "armed" : "disarmed"));
  s += "\"";
  s += ",\"rssi\":" + String(WiFi.RSSI());
  s += ",\"ssid\":\"" + WiFi.SSID() + "\"";
  s += ",\"ip\":\"" + WiFi.localIP().toString() + "\"";
  s += ",\"batt\":" + String(batteryPercent(v));
  s += ",\"volts\":" + String(v, 3);
  s += ",\"events\":" + String(eventSeq);
  s += ",\"buffered\":" + String(ringCount);
  s += ",\"sampleRate\":" + String(SAMPLE_RATE_HZ);
#if SENSOR_ENVELOPE
  // Tell the app what the four numbers actually are, so it never labels an
  // envelope feature as a frequency band it did not measure.
  s += ",\"sensor\":\"envelope\"";
  s += ",\"featureLabels\":[\"Loudness\",\"Attack\",\"Rhythm\",\"Sustain\"]";
  s += ",\"bands\":[]";
#else
  s += ",\"sensor\":\"waveform\"";
  s += ",\"featureLabels\":[]";
  s += ",\"bands\":[";
  for (int i = 0; i < NUM_BANDS; i++) {
    if (i) s += ",";
    s += "[" + String((int)BAND_EDGES[i][0]) + "," + String((int)BAND_EDGES[i][1]) + "]";
  }
  s += "]";
#endif
  s += ",\"config\":" + configJson();
  s += "}";
  return s;
}

// ===========================================================================
// Minimal JSON field extraction
// ===========================================================================
/*
 * The config body is a flat object of numbers, booleans and one short string,
 * so a full JSON parser would be 20 KB of flash to read thirteen fields. These
 * two helpers do it directly. They are not a general parser and are not used on
 * anything but our own config payload.
 */
bool jsonInt(const String& body, const char* key, long& out) {
  String needle = "\"" + String(key) + "\":";
  int i = body.indexOf(needle);
  if (i < 0) return false;
  i += needle.length();
  while (i < (int)body.length() && (body[i] == ' ')) i++;
  int start = i;
  if (i < (int)body.length() && (body[i] == '-' || body[i] == '+')) i++;
  while (i < (int)body.length() && isDigit(body[i])) i++;
  if (i == start) return false;
  out = body.substring(start, i).toInt();
  return true;
}

bool jsonBool(const String& body, const char* key, bool& out) {
  String needle = "\"" + String(key) + "\":";
  int i = body.indexOf(needle);
  if (i < 0) return false;
  i += needle.length();
  while (i < (int)body.length() && body[i] == ' ') i++;
  if (body.startsWith("true", i))  { out = true;  return true; }
  if (body.startsWith("false", i)) { out = false; return true; }
  return false;
}

bool jsonStr(const String& body, const char* key, char* out, size_t cap) {
  String needle = "\"" + String(key) + "\":\"";
  int i = body.indexOf(needle);
  if (i < 0) return false;
  i += needle.length();
  int end = body.indexOf('"', i);
  if (end < 0) return false;
  String v = body.substring(i, end);
  strncpy(out, v.c_str(), cap - 1);
  out[cap - 1] = 0;
  return true;
}

// ===========================================================================
// HTTP handlers
// ===========================================================================
void sendJson(int code, const String& body) {
  http.sendHeader("Access-Control-Allow-Origin", "*");
  http.sendHeader("Access-Control-Allow-Headers", "Content-Type");
  http.sendHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  http.send(code, "application/json", body);
}

void handleStatus() { sendJson(200, statusJson()); }

void handleEvents() {
  // Replay the ring buffer, oldest first, optionally only past a sequence id.
  uint32_t since = http.hasArg("since") ? (uint32_t)http.arg("since").toInt() : 0;
  int limit = http.hasArg("limit") ? http.arg("limit").toInt() : EVENT_BUFFER_SIZE;
  if (limit <= 0 || limit > EVENT_BUFFER_SIZE) limit = EVENT_BUFFER_SIZE;

  String s = "{\"events\":[";
  int emitted = 0;
  for (uint16_t n = 0; n < ringCount; n++) {
    uint16_t idx = (ringHead + EVENT_BUFFER_SIZE - ringCount + n) % EVENT_BUFFER_SIZE;
    if (ring[idx].id <= since) continue;
    if (emitted >= limit) break;
    if (emitted) s += ",";
    s += eventJson(ring[idx]);
    emitted++;
  }
  s += "],\"count\":" + String(emitted) + ",\"seq\":" + String(eventSeq) + "}";
  sendJson(200, s);
}

void handleGetConfig() { sendJson(200, configJson()); }

void handlePostConfig() {
  String body = http.arg("plain");
  long v; bool b; char str[8];

  if (jsonInt(body, "sens", v))       cfg.sens = constrain(v, 0, 100);
  if (jsonInt(body, "intensity", v))  cfg.intensity = constrain(v, 0, 100);
  if (jsonInt(body, "dur", v))        cfg.dur = constrain(v, 1, 120);
  if (jsonInt(body, "cooldown", v))   cfg.cooldown = constrain(v, 0, 3600);
  if (jsonInt(body, "quietStart", v)) cfg.quietStart = constrain(v, 0, 1439);
  if (jsonInt(body, "quietEnd", v))   cfg.quietEnd = constrain(v, 0, 1439);
  if (jsonInt(body, "heartbeat", v))  cfg.heartbeat = constrain(v, 10, 3600);
  if (jsonBool(body, "ultrasonic", b)) cfg.ultrasonic = b;
  if (jsonBool(body, "strobe", b))     cfg.strobe = b;
  if (jsonBool(body, "buzzer", b))     cfg.buzzer = b;
  if (jsonBool(body, "quiet", b))      cfg.quiet = b;
  if (jsonBool(body, "quietUltrasonic", b)) cfg.quietUltrasonic = b;
  if (jsonStr(body, "pattern", str, sizeof(str))) {
    strncpy(cfg.pattern, str, sizeof(cfg.pattern) - 1);
    cfg.pattern[sizeof(cfg.pattern) - 1] = 0;
  }

  saveConfig();
  pushEvent("config_ack", "unknown", 0, nullptr, 0, false, false, false, 0, nullptr);
  sendJson(200, "{\"ok\":true,\"config\":" + configJson() + "}");
}

void handleCmd() {
  String body = http.arg("plain");
  char cmd[24] = "";
  jsonStr(body, "cmd", cmd, sizeof(cmd));

  if (strcmp(cmd, "arm") == 0) {
    armed = true; saveConfig();
  } else if (strcmp(cmd, "disarm") == 0) {
    armed = false;
    if (deterring) stopDeterrent();
    saveConfig();
  } else if (strcmp(cmd, "test-deterrent") == 0) {
    startDeterrent(4000);
    pushEvent("deter", "unknown", 1.0f, nullptr, 0,
              activeUltrasonic, activeStrobe, activeBuzzer, 4000, "Manual test burst");
  } else if (strcmp(cmd, "identify") == 0) {
    for (int i = 0; i < 6; i++) {
      digitalWrite(PIN_STATUS_LED, HIGH); delay(80);
      digitalWrite(PIN_STATUS_LED, LOW);  delay(80);
    }
  } else if (strcmp(cmd, "reboot") == 0) {
    sendJson(200, "{\"ok\":true}");
    delay(200);
    ESP.restart();
    return;
  } else {
    sendJson(400, "{\"ok\":false,\"msg\":\"unknown command\"}");
    return;
  }

  ws.broadcastTXT("{\"t\":\"status\",\"s\":" + statusJson() + "}");
  sendJson(200, "{\"ok\":true,\"cmd\":\"" + String(cmd) + "\"}");
}

void handleRoot() {
  // A human landing on the device in a browser should get something useful,
  // not a 404 that reads like the board is broken.
  String s = "<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'>";
  s += "<style>body{font:15px system-ui;margin:2rem;max-width:34rem;color:#111}";
  s += "code{background:#f1f3f5;padding:.15rem .35rem;border-radius:4px}</style>";
  s += "<h2>PestGuard node " + deviceId() + "</h2>";
  s += "<p>Status: <b>" + String(armed ? "armed" : "disarmed") + "</b>";
  s += " &middot; battery " + String(batteryPercent(readBatteryVolts())) + "%";
  s += " &middot; " + String(eventSeq) + " events since boot</p>";
  s += "<p>This is the device API, not the app. Open the PestGuard app and add ";
  s += "this address: <code>" + WiFi.localIP().toString() + "</code></p>";
  s += "<p>Endpoints: <code>/api/status</code> <code>/api/events</code> ";
  s += "<code>/api/config</code> <code>/api/cmd</code> &middot; WebSocket on port ";
  s += String(WS_PORT) + "</p>";
  http.send(200, "text/html", s);
}

void onWsEvent(uint8_t num, WStype_t type, uint8_t* payload, size_t len) {
  if (type == WStype_CONNECTED) {
    ws.sendTXT(num, "{\"t\":\"status\",\"s\":" + statusJson() + "}");
  } else if (type == WStype_TEXT) {
    String msg = String((char*)payload).substring(0, len);
    long id;
    if (msg.indexOf("\"ping\"") >= 0) {
      if (!jsonInt(msg, "id", id)) id = 0;
      ws.sendTXT(num, "{\"t\":\"pong\",\"id\":" + String(id) + "}");
    }
  }
}

// ===========================================================================
// Setup / loop
// ===========================================================================
void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\nPestGuard ESP32 node starting");

  pinMode(PIN_STROBE, OUTPUT);      digitalWrite(PIN_STROBE, LOW);
  pinMode(PIN_STATUS_LED, OUTPUT);  digitalWrite(PIN_STATUS_LED, LOW);

  // ESP32 core 3.x changed the LEDC API. Both spellings are kept so this
  // sketch compiles on 2.x and 3.x without the user having to care.
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcAttachChannel(PIN_ULTRASONIC, 25000, 8, LEDC_ULTRASONIC);
  ledcAttachChannel(PIN_BUZZER,      2800, 8, LEDC_BUZZER);
#else
  ledcSetup(LEDC_ULTRASONIC, 25000, 8);
  ledcAttachPin(PIN_ULTRASONIC, LEDC_ULTRASONIC);
  ledcSetup(LEDC_BUZZER, 2800, 8);
  ledcAttachPin(PIN_BUZZER, LEDC_BUZZER);
#endif
  pwmWrite(PIN_ULTRASONIC, LEDC_ULTRASONIC, 0);
  pwmWrite(PIN_BUZZER, LEDC_BUZZER, 0);

  analogSetPinAttenuation(PIN_BATTERY, ADC_11db);
  adc1_config_width(ADC_WIDTH_BIT_12);
  adc1_config_channel_atten(ADC1_CHANNEL_0, ADC_ATTEN_DB_11);

  loadConfig();

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to Wi-Fi");
  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 30000) {
    delay(400);
    Serial.print(".");
    digitalWrite(PIN_STATUS_LED, !digitalRead(PIN_STATUS_LED));
  }

  if (WiFi.status() == WL_CONNECTED) {
    digitalWrite(PIN_STATUS_LED, HIGH);
    Serial.println();
    Serial.print("Connected. Add this address in the PestGuard app: ");
    Serial.println(WiFi.localIP());
    if (MDNS.begin("pestguard")) {
      MDNS.addService("http", "tcp", 80);
      Serial.println("Also reachable at http://pestguard.local");
    }
    // Best effort only — the node runs fine without a clock, it just reports
    // ts=0 and lets the app derive wall-clock time from uptime.
    configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  } else {
    Serial.println("\nWi-Fi failed. Detection still runs; the app cannot reach it.");
    faulted = true;
    strncpy(faultMsg, "Wi-Fi connection failed", sizeof(faultMsg) - 1);
  }

  http.on("/", handleRoot);
  http.on("/api/status", HTTP_GET, handleStatus);
  http.on("/api/events", HTTP_GET, handleEvents);
  http.on("/api/config", HTTP_GET, handleGetConfig);
  http.on("/api/config", HTTP_POST, handlePostConfig);
  http.on("/api/cmd",    HTTP_POST, handleCmd);
  http.onNotFound([]() {
    if (http.method() == HTTP_OPTIONS) { sendJson(204, ""); return; }
    sendJson(404, "{\"ok\":false,\"msg\":\"no such endpoint\"}");
  });
  http.begin();

  ws.begin();
  ws.onEvent(onWsEvent);

  bootMs = millis();
  lastHeartbeatMs = millis();
  pushEvent("online", "unknown", 0, nullptr, 0, false, false, false, 0, "Node booted");
  Serial.println("Ready. Listening.");
}

void loop() {
  http.handleClient();
  ws.loop();
  serviceDeterrent();

  // Detection is the priority; networking is serviced between windows. Each
  // window is ~13 ms, so the HTTP server still feels instant.
  if (!deterring || strcmp(cfg.pattern, "silent") == 0) {
    runDetector();
  }

  uint32_t now = millis();
  if (now - lastHeartbeatMs >= (uint32_t)cfg.heartbeat * 1000UL) {
    lastHeartbeatMs = now;
    pushEvent("heartbeat", "unknown", 0, nullptr, 0, false, false, false, 0, nullptr);
    ws.broadcastTXT("{\"t\":\"status\",\"s\":" + statusJson() + "}");
  }

  // Reconnect if the AP drops. Detection keeps running throughout — losing
  // Wi-Fi must never stop the node protecting the field.
  static uint32_t lastWifiCheck = 0;
  if (now - lastWifiCheck > 10000) {
    lastWifiCheck = now;
    if (WiFi.status() != WL_CONNECTED) {
      digitalWrite(PIN_STATUS_LED, LOW);
      WiFi.disconnect();
      WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    } else {
      digitalWrite(PIN_STATUS_LED, HIGH);
    }
  }
}
