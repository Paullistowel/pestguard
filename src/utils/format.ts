/** Formatting helpers shared across every screen. */

export function relativeTime(ts: number | null | undefined, now = Date.now()): string {
  if (ts == null) return 'never';
  const d = Math.max(0, now - ts);
  const s = Math.floor(d / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  const w = Math.floor(days / 7);
  if (w < 5) return `${w}w ago`;
  return new Date(ts).toLocaleDateString();
}

export function clockTime(ts: number): string {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fullTimestamp(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function dayLabel(ts: number, now = Date.now()): string {
  const a = startOfDay(ts);
  const b = startOfDay(now);
  const diff = Math.round((b - a) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return new Date(ts).toLocaleDateString(undefined, { weekday: 'long' });
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function startOfHour(ts: number): number {
  const d = new Date(ts);
  d.setMinutes(0, 0, 0);
  return d.getTime();
}

export function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

/** Minutes-from-midnight -> "22:30". */
export function minutesToClock(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

export function uptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function pct(v: number, digits = 0): string {
  return `${(v * 100).toFixed(digits)}%`;
}

export function volts(v: number): string {
  return `${v.toFixed(2)} V`;
}

export function dbm(v: number): string {
  return `${Math.round(v)} dBm`;
}

/** Wi-Fi/GSM RSSI -> 0..4 bar count. */
export function signalBars(rssi: number): number {
  if (rssi >= -55) return 4;
  if (rssi >= -67) return 3;
  if (rssi >= -78) return 2;
  if (rssi >= -88) return 1;
  return 0;
}

export function signalLabel(rssi: number): string {
  return ['No signal', 'Poor', 'Fair', 'Good', 'Excellent'][signalBars(rssi)];
}

export function hzLabel([lo, hi]: [number, number]): string {
  const f = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)} kHz` : `${n} Hz`);
  return `${f(lo)} – ${f(hi)}`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function compactNumber(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function durationMs(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.round(ms / 60_000)} min`;
}
