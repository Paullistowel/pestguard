import { load, save } from './storage';

/**
 * The set of physical nodes this phone knows how to reach.
 *
 * A device is identified by its address on the network, which is the one thing
 * that can change without the hardware changing — DHCP hands an ESP32 a new IP
 * after a router reboot. So the record keeps both: the address to dial, and the
 * device id last seen there, which lets the app notice when an address now
 * points at a different board.
 */

export interface DeviceRef {
  /** Hostname or IP, e.g. `192.168.1.42` or `pestguard.local`. */
  host: string;
  port: number;
  /** Device id reported by the node the last time we reached it. */
  deviceId?: string;
  /** Cached name so the UI has something to show before the first response. */
  name?: string;
  addedAt: number;
  lastSeen?: number;
}

const KEY = '@pestguard/devices';

export async function loadDevices(): Promise<DeviceRef[]> {
  const list = await load<DeviceRef[]>(KEY, []);
  return Array.isArray(list) ? list : [];
}

export async function saveDevices(devices: DeviceRef[]): Promise<void> {
  await save(KEY, devices);
}

export async function addDevice(device: DeviceRef): Promise<DeviceRef[]> {
  const list = await loadDevices();
  const norm = normaliseHost(device.host);
  // Re-adding the same address updates it rather than creating a duplicate —
  // people re-run the setup flow when something looks wrong, and ending up
  // with the same node listed three times is its own confusing problem.
  const next = [
    ...list.filter((d) => normaliseHost(d.host) !== norm),
    { ...device, host: norm },
  ];
  await saveDevices(next);
  return next;
}

export async function removeDevice(host: string): Promise<DeviceRef[]> {
  const list = await loadDevices();
  const next = list.filter((d) => normaliseHost(d.host) !== normaliseHost(host));
  await saveDevices(next);
  return next;
}

export function normaliseHost(host: string): string {
  return host
    .trim()
    .toLowerCase()
    .replace(/^wss?:\/\//, '')
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');
}

/**
 * Split an entered address into host and port.
 *
 * People paste `192.168.1.42:80` as readily as `192.168.1.42`, and a
 * non-default port is genuinely needed when the board sits behind a port
 * forward. Accepting both costs one regex and removes a class of "it says
 * invalid but it looks right" support questions.
 */
export function parseAddress(input: string, fallbackPort = 80): { host: string; port: number } {
  const h = normaliseHost(input);
  const m = h.match(/^(.*?):(\d{1,5})$/);
  if (m) {
    const port = Number(m[2]);
    if (port > 0 && port <= 65535) return { host: m[1], port };
  }
  return { host: h, port: fallbackPort };
}

/** Loose sanity check so the setup screen can reject obvious typos early. */
export function isPlausibleHost(host: string): boolean {
  const { host: h } = parseAddress(host);
  if (!h) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) {
    return h.split('.').every((p) => Number(p) <= 255);
  }
  // Hostnames such as `pestguard.local`, or a bare name on some networks.
  return /^[a-z0-9][a-z0-9.-]*$/.test(h);
}

/**
 * Candidate addresses to try when the user has not entered one.
 *
 * mDNS is what the firmware advertises, so it is first and usually works on
 * iOS. Android's support for `.local` is patchy, which is why the setup screen
 * still asks for an IP rather than relying on discovery alone.
 */
export const DISCOVERY_CANDIDATES = ['pestguard.local', 'pestguard-1.local'];
