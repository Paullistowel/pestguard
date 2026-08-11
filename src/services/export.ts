import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import { DeterrentNode, PestEvent } from '@/types';
import { fullTimestamp } from '@/utils/format';
import { effectiveClass, effectiveConfidence } from './ai/classifier';

/**
 * CSV export — the "export to CSV for reports" line in §4.
 *
 * The column set is chosen so the file drops straight into the field-test
 * report: raw vs AI label side by side (so classifier accuracy can be scored
 * by hand), the four band energies (so a disputed call can be re-derived), and
 * the ground-truth column a technician fills in.
 */

const COLUMNS = [
  'event_id',
  'node_id',
  'node_name',
  'zone',
  'timestamp_utc',
  'timestamp_local',
  'event_type',
  'raw_class',
  'raw_confidence',
  'ai_class',
  'ai_confidence',
  'ground_truth',
  'dwell_ms',
  'band1_2_6khz',
  'band2_6_12khz',
  'band3_12_20khz',
  'band4_20_40khz',
  'deterrent_channels',
  'deterrent_ms',
  'battery_pct',
  'battery_volts',
  'rssi_dbm',
] as const;

function escapeCell(v: unknown): string {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(events: PestEvent[], nodes: DeterrentNode[]): string {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const rows = events.map((e) => {
    const node = byId.get(e.nodeId);
    return [
      e.id,
      e.nodeId,
      node?.name ?? '',
      node?.zone ?? '',
      new Date(e.ts).toISOString(),
      fullTimestamp(e.ts),
      e.type,
      e.rawClass,
      e.rawConfidence.toFixed(4),
      e.aiClass ?? '',
      e.aiConfidence?.toFixed(4) ?? '',
      e.groundTruth ?? '',
      e.dwellMs,
      e.bands.b1.toFixed(4),
      e.bands.b2.toFixed(4),
      e.bands.b3.toFixed(4),
      e.bands.b4.toFixed(4),
      e.deterrentChannels?.join('|') ?? '',
      e.deterrentDurationMs ?? '',
      e.batteryPct,
      e.batteryVolts.toFixed(3),
      Math.round(e.rssi),
    ].map(escapeCell).join(',');
  });
  return [COLUMNS.join(','), ...rows].join('\n');
}

/** Summary sheet accompanying the raw export. */
export function toSummaryCsv(events: PestEvent[], nodes: DeterrentNode[]): string {
  const lines = ['metric,value'];
  const detections = events.filter((e) => e.type === 'detect' || e.type === 'deter');
  lines.push(`total_events,${events.length}`);
  lines.push(`total_detections,${detections.length}`);
  lines.push(`deterrents_fired,${events.filter((e) => e.type === 'deter').length}`);
  lines.push(`nodes,${nodes.length}`);
  lines.push(
    `mean_ai_confidence,${(
      detections.reduce((s, e) => s + effectiveConfidence(e), 0) / (detections.length || 1)
    ).toFixed(4)}`,
  );
  lines.push(`labelled_events,${events.filter((e) => e.groundTruth).length}`);
  lines.push(`false_alarms,${events.filter((e) => e.groundTruth === 'false_alarm').length}`);
  for (const cls of ['rodent', 'bird', 'insect', 'bat', 'unknown']) {
    lines.push(`class_${cls},${detections.filter((e) => effectiveClass(e) === cls).length}`);
  }
  for (const n of nodes) {
    lines.push(`node_${n.id}_detections,${detections.filter((e) => e.nodeId === n.id).length}`);
  }
  return lines.join('\n');
}

export interface ExportResult {
  ok: boolean;
  uri?: string;
  filename: string;
  bytes: number;
  message: string;
}

export async function exportCsv(
  events: PestEvent[],
  nodes: DeterrentNode[],
  label = 'detections',
): Promise<ExportResult> {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const filename = `pestguard-${label}-${stamp}.csv`;
  const csv = toCsv(events, nodes);
  const bytes = csv.length;

  // Web has no document directory — fall back to a Blob download.
  if (Platform.OS === 'web') {
    try {
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      return { ok: true, filename, bytes, message: `Downloaded ${filename}` };
    } catch (err) {
      return { ok: false, filename, bytes, message: `Download failed: ${String(err)}` };
    }
  }

  try {
    const file = new File(Paths.cache, filename);
    file.create({ overwrite: true });
    file.write(csv);
    const uri = file.uri;

    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, {
        mimeType: 'text/csv',
        dialogTitle: 'Export PestGuard detections',
        UTI: 'public.comma-separated-values-text',
      });
      return { ok: true, uri, filename, bytes, message: `Shared ${filename}` };
    }
    return {
      ok: true,
      uri,
      filename,
      bytes,
      message: `Saved to ${uri} — sharing is unavailable on this device.`,
    };
  } catch (err) {
    return { ok: false, filename, bytes, message: `Export failed: ${String(err)}` };
  }
}

/** JSON export for re-import into the training pipeline. */
export async function exportTrainingJson(events: PestEvent[]): Promise<ExportResult> {
  const labelled = events.filter((e) => e.groundTruth);
  const payload = {
    exportedAt: new Date().toISOString(),
    schema: 'pestguard-training-v1',
    count: labelled.length,
    samples: labelled.map((e) => ({
      features: [e.bands.b1, e.bands.b2, e.bands.b3, e.bands.b4, e.dwellMs, new Date(e.ts).getHours()],
      nodeId: e.nodeId,
      predicted: e.aiClass ?? e.rawClass,
      label: e.groundTruth,
    })),
  };
  const json = JSON.stringify(payload, null, 2);
  const filename = `pestguard-training-${new Date().toISOString().slice(0, 10)}.json`;

  if (Platform.OS === 'web') {
    try {
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      return { ok: true, filename, bytes: json.length, message: `Downloaded ${filename}` };
    } catch (err) {
      return { ok: false, filename, bytes: json.length, message: String(err) };
    }
  }

  try {
    const file = new File(Paths.cache, filename);
    file.create({ overwrite: true });
    file.write(json);
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(file.uri, { mimeType: 'application/json' });
    }
    return {
      ok: true,
      uri: file.uri,
      filename,
      bytes: json.length,
      message: `Exported ${labelled.length} labelled samples`,
    };
  } catch (err) {
    return { ok: false, filename, bytes: json.length, message: String(err) };
  }
}
