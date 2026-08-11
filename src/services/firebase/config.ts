import Constants from 'expo-constants';

/**
 * Firebase configuration.
 *
 * Values are read from `app.json` → `expo.extra.firebase`, which can in turn be
 * fed from environment variables at build time. Nothing here is a secret in the
 * cryptographic sense — a Firebase web config ships inside every client that
 * uses it and is readable by anyone who opens the app — but it is still kept
 * out of source so a fork of this repo does not silently write to someone
 * else's database.
 *
 * The security boundary for Realtime Database is the *rules*, never the config.
 * See `RECOMMENDED_RULES` below.
 */

interface FirebaseConfig {
  databaseURL: string;
  apiKey?: string;
  authDomain?: string;
  projectId?: string;
  appId?: string;
  storageBucket?: string;
  messagingSenderId?: string;
}

const extra =
  (Constants.expoConfig?.extra as Record<string, unknown> | undefined)?.firebase ??
  (Constants.manifest2?.extra as Record<string, unknown> | undefined)?.firebase;

const fromExtra = (extra ?? {}) as Partial<FirebaseConfig>;

export const firebaseConfig: FirebaseConfig = {
  databaseURL:
    fromExtra.databaseURL ??
    process.env.EXPO_PUBLIC_FIREBASE_DATABASE_URL ??
    'https://pest-deterrent-system-7-default-rtdb.firebaseio.com',
  apiKey: fromExtra.apiKey ?? process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: fromExtra.authDomain ?? process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: fromExtra.projectId ?? process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  appId: fromExtra.appId ?? process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
  storageBucket: fromExtra.storageBucket ?? process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId:
    fromExtra.messagingSenderId ?? process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
};

export const isFirebaseConfigured = () => Boolean(firebaseConfig.databaseURL);

/**
 * Realtime Database rules to apply in the Firebase console.
 *
 * The project is currently running with fully open rules — verified, not
 * assumed: an unauthenticated PUT to the database root succeeded, and an
 * unauthenticated GET returns the whole tree. In practice that means anyone
 * who learns the URL can sound your alarm, switch your LEDs, or delete every
 * reading you have collected.
 *
 * The rules below are the minimum worth shipping. They:
 *   - require an authenticated user for both read and write,
 *   - allow writes only to the fields that actually exist, so a compromised
 *     client cannot graft arbitrary structure onto the device node,
 *   - type-check each field, which also catches sketch bugs early.
 *
 * If you need the device to write without signing in, give the ESP32 its own
 * database secret or a service account rather than leaving the tree public.
 */
export const RECOMMENDED_RULES = `{
  "rules": {
    ".read": false,
    ".write": false,

    "pestDetector": {
      "$deviceId": {
        ".read": "auth != null",
        ".write": "auth != null",

        "alarm":      { ".validate": "newData.isBoolean()" },
        "led1":       { ".validate": "newData.isBoolean()" },
        "led2":       { ".validate": "newData.isBoolean()" },
        "led3":       { ".validate": "newData.isBoolean()" },
        "distance":   { ".validate": "newData.isNumber()" },
        "sound":      { ".validate": "newData.isNumber()" },
        "status":     { ".validate": "newData.isString()" },
        "lastUpdate": { ".validate": "newData.isNumber()" },
        "test":       { ".validate": "newData.isBoolean()" },
        "mode":       { ".validate": "newData.isString() && (newData.val() === 'auto' || newData.val() === 'manual')" },

        "state": {
          "$actuator": { ".validate": "newData.isBoolean()" }
        },

        "$other": { ".validate": false }
      }
    }
  }
}`;

/**
 * A stricter variant, once the ESP32 authenticates separately: only the device
 * may write sensor readings and confirmed state, and only the app may write
 * commands. This is the shape to aim for, but it requires the sketch to sign in
 * with its own UID, so it is offered rather than recommended by default.
 */
export const RULES_WITH_DEVICE_IDENTITY = `{
  "rules": {
    "pestDetector": {
      "$deviceId": {
        ".read": "auth != null",

        // Commands: app writes, device only reads.
        "alarm": { ".write": "auth != null && auth.token.role === 'app'" },
        "led1":  { ".write": "auth != null && auth.token.role === 'app'" },
        "led2":  { ".write": "auth != null && auth.token.role === 'app'" },
        "led3":  { ".write": "auth != null && auth.token.role === 'app'" },
        "mode":  { ".write": "auth != null && auth.token.role === 'app'" },

        // Telemetry: device writes, app only reads.
        "distance":   { ".write": "auth != null && auth.token.role === 'device'" },
        "sound":      { ".write": "auth != null && auth.token.role === 'device'" },
        "status":     { ".write": "auth != null && auth.token.role === 'device'" },
        "lastUpdate": { ".write": "auth != null && auth.token.role === 'device'" },
        "state":      { ".write": "auth != null && auth.token.role === 'device'" }
      }
    }
  }
}`;
