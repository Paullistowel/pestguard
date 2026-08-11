import React, { useMemo, useRef, useState } from 'react';
import { LayoutChangeEvent, PanResponder, Pressable, StyleSheet, View } from 'react-native';
import Svg, {
  Circle,
  Defs,
  G,
  Line,
  LinearGradient,
  Path,
  Rect,
  Stop,
  Text as SvgText,
} from 'react-native-svg';
import { pestColors, radius, sequentialRamp, spacing, useTheme } from '@/theme';
import { PestClass } from '@/types';
import { PEST_PROFILES } from '@/data/pests';
import { clamp, niceCeil } from '@/utils/math';
import { Muted, Row, Txt } from '../ui';

/**
 * Chart primitives.
 *
 * Conventions applied throughout, so the whole app reads as one system:
 *  - Thin marks. 2px strokes, ≥8px touch targets, 4px rounded data-ends
 *    anchored to the baseline.
 *  - A 2px surface-coloured gap between adjacent fills, so stacked segments and
 *    neighbouring bars separate without an outline.
 *  - Recessive axes: hairline grid in the border token, labels in muted ink.
 *    Values and labels never wear the series colour — a coloured mark beside
 *    them carries identity instead.
 *  - Touch to inspect. On a phone there is no hover, so every chart that plots
 *    more than one value responds to press/drag with a crosshair and a readout.
 *  - One y-axis, always. Two measures of different scale get two charts.
 */

export function usePestColor() {
  const { isDark } = useTheme();
  return (cls: PestClass) => pestColors[isDark ? 'dark' : 'light'][cls];
}

// ---------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------

export function Legend({
  items,
  compact,
}: {
  items: { label: string; color: string; glyph?: string; value?: string }[];
  compact?: boolean;
}) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: compact ? spacing.md : spacing.lg }}>
      {items.map((it) => (
        <Row key={it.label} gap={6}>
          <View
            style={{ width: 9, height: 9, borderRadius: 2.5, backgroundColor: it.color }}
          />
          {/* The glyph is deliberate redundancy: identity must never rest on
              colour alone, and the worst CVD pair here sits in the floor band. */}
          {it.glyph ? <Txt variant="small">{it.glyph}</Txt> : null}
          <Txt variant="small" color={c.textMuted}>
            {it.label}
          </Txt>
          {it.value ? (
            <Txt variant="smallStrong" color={c.text}>
              {it.value}
            </Txt>
          ) : null}
        </Row>
      ))}
    </View>
  );
}

function useChartWidth() {
  const [w, setW] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width);
  return { width: w, onLayout };
}

// ---------------------------------------------------------------------------
// Sparkline
// ---------------------------------------------------------------------------

export function Sparkline({
  data,
  height = 34,
  color,
  fill = true,
}: {
  data: number[];
  height?: number;
  color?: string;
  fill?: boolean;
}) {
  const { c } = useTheme();
  const { width, onLayout } = useChartWidth();
  const stroke = color ?? c.seqHue;

  const path = useMemo(() => {
    if (!width || data.length < 2) return { line: '', area: '' };
    const max = Math.max(...data, 1);
    const min = Math.min(...data, 0);
    const span = max - min || 1;
    const pts = data.map((v, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((v - min) / span) * (height - 4) - 2;
      return [x, y] as const;
    });
    const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    const area = `${line} L${width},${height} L0,${height} Z`;
    return { line, area };
  }, [data, width, height]);

  return (
    <View onLayout={onLayout} style={{ height }}>
      {width > 0 && data.length > 1 ? (
        <Svg width={width} height={height}>
          {fill ? (
            <>
              <Defs>
                <LinearGradient id="spark" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor={stroke} stopOpacity="0.28" />
                  <Stop offset="1" stopColor={stroke} stopOpacity="0" />
                </LinearGradient>
              </Defs>
              <Path d={path.area} fill="url(#spark)" />
            </>
          ) : null}
          <Path d={path.line} stroke={stroke} strokeWidth={2} fill="none" strokeLinejoin="round" />
        </Svg>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Line chart with touch crosshair
// ---------------------------------------------------------------------------

export interface LinePoint {
  ts: number;
  value: number;
}

export function LineChart({
  data,
  height = 180,
  color,
  yLabel,
  formatX,
  formatY,
  showArea = true,
}: {
  data: LinePoint[];
  height?: number;
  color?: string;
  yLabel?: string;
  formatX?: (ts: number) => string;
  formatY?: (v: number) => string;
  showArea?: boolean;
}) {
  const { c } = useTheme();
  const { width, onLayout } = useChartWidth();
  const [active, setActive] = useState<number | null>(null);
  const stroke = color ?? c.seqHue;

  const PAD_L = 34;
  const PAD_B = 22;
  const PAD_T = 10;
  const plotW = Math.max(0, width - PAD_L - 8);
  const plotH = height - PAD_B - PAD_T;

  const max = niceCeil(Math.max(...data.map((d) => d.value), 1));
  const xAt = (i: number) => PAD_L + (data.length <= 1 ? plotW / 2 : (i / (data.length - 1)) * plotW);
  const yAt = (v: number) => PAD_T + plotH - (v / max) * plotH;

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => pick(e.nativeEvent.locationX),
      onPanResponderMove: (e) => pick(e.nativeEvent.locationX),
      onPanResponderRelease: () => setActive(null),
      onPanResponderTerminate: () => setActive(null),
    }),
  ).current;

  function pick(x: number) {
    if (!data.length || plotW <= 0) return;
    const t = clamp((x - PAD_L) / plotW, 0, 1);
    setActive(Math.round(t * (data.length - 1)));
  }

  const { line, area } = useMemo(() => {
    if (!width || !data.length) return { line: '', area: '' };
    const pts = data.map((d, i) => [xAt(i), yAt(d.value)] as const);
    const l = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    const a = `${l} L${xAt(data.length - 1)},${PAD_T + plotH} L${xAt(0)},${PAD_T + plotH} Z`;
    return { line: l, area: a };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, width, height, max]);

  const gridValues = [0, max / 2, max];
  const act = active != null ? data[active] : null;

  return (
    <View onLayout={onLayout}>
      {width > 0 && data.length > 0 ? (
        <View {...pan.panHandlers}>
          <Svg width={width} height={height}>
            <Defs>
              <LinearGradient id="lineArea" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={stroke} stopOpacity="0.24" />
                <Stop offset="1" stopColor={stroke} stopOpacity="0" />
              </LinearGradient>
            </Defs>

            {gridValues.map((v) => (
              <G key={v}>
                <Line
                  x1={PAD_L}
                  y1={yAt(v)}
                  x2={width - 8}
                  y2={yAt(v)}
                  stroke={c.border}
                  strokeWidth={StyleSheet.hairlineWidth}
                />
                <SvgText
                  x={PAD_L - 6}
                  y={yAt(v) + 3.5}
                  fill={c.textFaint}
                  fontSize={10}
                  textAnchor="end"
                >
                  {formatY ? formatY(v) : String(Math.round(v))}
                </SvgText>
              </G>
            ))}

            {showArea ? <Path d={area} fill="url(#lineArea)" /> : null}
            <Path
              d={line}
              stroke={stroke}
              strokeWidth={2}
              fill="none"
              strokeLinejoin="round"
              strokeLinecap="round"
            />

            {act && active != null ? (
              <G>
                <Line
                  x1={xAt(active)}
                  y1={PAD_T}
                  x2={xAt(active)}
                  y2={PAD_T + plotH}
                  stroke={c.textFaint}
                  strokeWidth={1}
                  strokeDasharray="3 3"
                />
                {/* 2px surface ring keeps the marker legible over the line. */}
                <Circle cx={xAt(active)} cy={yAt(act.value)} r={6} fill={c.surface} />
                <Circle cx={xAt(active)} cy={yAt(act.value)} r={4} fill={stroke} />
              </G>
            ) : null}

            {data.length > 1 ? (
              <>
                <SvgText x={PAD_L} y={height - 6} fill={c.textFaint} fontSize={10}>
                  {formatX ? formatX(data[0].ts) : ''}
                </SvgText>
                <SvgText
                  x={width - 8}
                  y={height - 6}
                  fill={c.textFaint}
                  fontSize={10}
                  textAnchor="end"
                >
                  {formatX ? formatX(data[data.length - 1].ts) : ''}
                </SvgText>
              </>
            ) : null}
          </Svg>
        </View>
      ) : (
        <View style={{ height }} />
      )}

      {act ? (
        <Row justify="space-between" style={{ marginTop: spacing.sm }}>
          <Muted variant="small">{formatX ? formatX(act.ts) : ''}</Muted>
          <Row gap={6}>
            <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: stroke }} />
            <Txt variant="smallStrong">
              {formatY ? formatY(act.value) : act.value} {yLabel ?? ''}
            </Txt>
          </Row>
        </Row>
      ) : (
        <Muted variant="small" style={{ marginTop: spacing.sm }}>
          Touch and drag the chart to inspect any day.
        </Muted>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Stacked bars by pest class
// ---------------------------------------------------------------------------

export function StackedClassBars({
  data,
  height = 170,
  formatX,
  classes,
}: {
  data: { ts: number; values: Record<PestClass, number> }[];
  height?: number;
  formatX?: (ts: number) => string;
  classes: PestClass[];
}) {
  const { c } = useTheme();
  const pestColor = usePestColor();
  const { width, onLayout } = useChartWidth();
  const [active, setActive] = useState<number | null>(null);

  const PAD_L = 30;
  const PAD_B = 20;
  // Headroom so the top gridline's label is not clipped by the card edge.
  const PAD_T = 8;
  const plotW = Math.max(0, width - PAD_L - 8);
  const plotH = height - PAD_B - PAD_T;

  const totals = data.map((d) => classes.reduce((s, k) => s + d.values[k], 0));
  const max = niceCeil(Math.max(...totals, 1));
  const slot = data.length ? plotW / data.length : 0;
  const barW = Math.max(3, slot - 4);

  const act = active != null ? data[active] : null;

  return (
    <View onLayout={onLayout}>
      {width > 0 && data.length ? (
        <Svg width={width} height={height}>
          {[0, max / 2, max].map((v) => (
            <G key={v}>
              <Line
                x1={PAD_L}
                y1={PAD_T + plotH - (v / max) * plotH}
                x2={width - 8}
                y2={PAD_T + plotH - (v / max) * plotH}
                stroke={c.border}
                strokeWidth={StyleSheet.hairlineWidth}
              />
              <SvgText
                x={PAD_L - 6}
                y={PAD_T + plotH - (v / max) * plotH + 3.5}
                fill={c.textFaint}
                fontSize={10}
                textAnchor="end"
              >
                {Math.round(v)}
              </SvgText>
            </G>
          ))}

          {data.map((d, i) => {
            let cursor = PAD_T + plotH;
            const x = PAD_L + i * slot + (slot - barW) / 2;
            return (
              <G key={d.ts}>
                {classes.map((cls) => {
                  const v = d.values[cls];
                  if (!v) return null;
                  const h = (v / max) * plotH;
                  // 2px gap between segments — separation without an outline.
                  const drawH = Math.max(1, h - 2);
                  cursor -= h;
                  return (
                    <Rect
                      key={cls}
                      x={x}
                      y={cursor}
                      width={barW}
                      height={drawH}
                      rx={2}
                      fill={pestColor(cls)}
                      opacity={active == null || active === i ? 1 : 0.35}
                    />
                  );
                })}

              </G>
            );
          })}

          <SvgText x={PAD_L} y={height - 5} fill={c.textFaint} fontSize={10}>
            {formatX ? formatX(data[0].ts) : ''}
          </SvgText>
          <SvgText x={width - 8} y={height - 5} fill={c.textFaint} fontSize={10} textAnchor="end">
            {formatX ? formatX(data[data.length - 1].ts) : ''}
          </SvgText>
        </Svg>
      ) : (
        <View style={{ height }} />
      )}

      {/*
        Hit targets are plain Pressables overlaid on the chart, not touch props
        on the SVG shapes. react-native-svg's web renderer does not implement
        React Native's touch props on shapes, so `onPressIn` on a <Rect> leaks
        through to the DOM and throws. Overlaying also gives a full-height
        target rather than one only as wide as a 3px bar.
      */}
      {width > 0 && data.length ? (
        <View
          style={{
            position: 'absolute',
            left: PAD_L,
            top: PAD_T,
            flexDirection: 'row',
            height: plotH,
          }}
        >
          {data.map((d, i) => (
            <Pressable
              key={d.ts}
              onPressIn={() => setActive(i)}
              onPressOut={() => setActive(null)}
              style={{ width: slot, height: plotH }}
            />
          ))}
        </View>
      ) : null}

      {act ? (
        <View
          style={{
            marginTop: spacing.sm,
            backgroundColor: c.surfaceAlt,
            borderRadius: radius.sm,
            padding: spacing.sm,
          }}
        >
          <Txt variant="smallStrong">{formatX ? formatX(act.ts) : ''}</Txt>
          <View style={{ marginTop: 5, gap: 3 }}>
            {classes
              .filter((cls) => act.values[cls] > 0)
              .map((cls) => (
                <Row key={cls} justify="space-between">
                  <Row gap={6}>
                    <View
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 2,
                        backgroundColor: pestColor(cls),
                      }}
                    />
                    <Txt variant="small">
                      {PEST_PROFILES[cls].emoji} {PEST_PROFILES[cls].label}
                    </Txt>
                  </Row>
                  <Txt variant="smallStrong">{act.values[cls]}</Txt>
                </Row>
              ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Donut
// ---------------------------------------------------------------------------

export function DonutChart({
  data,
  size = 150,
  thickness = 22,
  centerLabel,
  centerValue,
}: {
  data: { label: string; value: number; color: string; glyph?: string }[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerValue?: string;
}) {
  const { c } = useTheme();
  const total = data.reduce((s, d) => s + d.value, 0);
  const r = (size - thickness) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;

  let offset = 0;
  const arcs = data
    .filter((d) => d.value > 0)
    .map((d) => {
      const frac = total ? d.value / total : 0;
      // 2px surface gap between adjacent arcs.
      const len = Math.max(0, frac * circumference - 2);
      const arc = {
        ...d,
        dash: `${len} ${circumference - len}`,
        rotation: (offset / circumference) * 360 - 90,
      };
      offset += frac * circumference;
      return arc;
    });

  return (
    <View style={{ alignItems: 'center' }}>
      <View style={{ width: size, height: size }}>
        <Svg width={size} height={size}>
          <Circle cx={cx} cy={cy} r={r} stroke={c.surfaceAlt} strokeWidth={thickness} fill="none" />
          {arcs.map((a) => (
            <Circle
              key={a.label}
              cx={cx}
              cy={cy}
              r={r}
              stroke={a.color}
              strokeWidth={thickness}
              fill="none"
              strokeDasharray={a.dash}
              strokeLinecap="butt"
              transform={`rotate(${a.rotation} ${cx} ${cy})`}
            />
          ))}
        </Svg>
        <View
          style={{
            position: 'absolute',
            width: size,
            height: size,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {centerValue ? <Txt variant="h1">{centerValue}</Txt> : null}
          {centerLabel ? <Muted variant="caption">{centerLabel}</Muted> : null}
        </View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Ranked horizontal bars — magnitude, one hue
// ---------------------------------------------------------------------------

export function RankedBars({
  data,
  color,
  maxRows,
  formatValue,
  onPressRow,
}: {
  data: { label: string; value: number; sublabel?: string; color?: string; glyph?: string }[];
  color?: string;
  maxRows?: number;
  formatValue?: (v: number) => string;
  onPressRow?: (index: number) => void;
}) {
  const { c } = useTheme();
  const rows = maxRows ? data.slice(0, maxRows) : data;
  const max = Math.max(...rows.map((d) => d.value), 1);

  return (
    <View style={{ gap: spacing.md }}>
      {rows.map((d, i) => {
        const body = (
          <View key={d.label} style={{ gap: 5 }}>
            <Row justify="space-between">
              <Row gap={6} style={{ flex: 1 }}>
                {d.glyph ? <Txt variant="small">{d.glyph}</Txt> : null}
                <Txt variant="small" numberOfLines={1} style={{ flex: 1 }}>
                  {d.label}
                </Txt>
              </Row>
              <Row gap={spacing.sm}>
                {d.sublabel ? <Muted variant="small">{d.sublabel}</Muted> : null}
                {/* Direct label — no axis needed for a ranked list. */}
                <Txt variant="smallStrong">{formatValue ? formatValue(d.value) : d.value}</Txt>
              </Row>
            </Row>
            <View
              style={{
                height: 8,
                borderRadius: 4,
                backgroundColor: c.surfaceAlt,
                overflow: 'hidden',
              }}
            >
              <View
                style={{
                  width: `${Math.max(1.5, (d.value / max) * 100)}%`,
                  height: '100%',
                  borderRadius: 4,
                  backgroundColor: d.color ?? color ?? c.seqHue,
                }}
              />
            </View>
          </View>
        );
        return onPressRow ? (
          <Pressable
            key={d.label}
            onPress={() => onPressRow(i)}
            style={({ pressed }) => (pressed ? { opacity: 0.6 } : undefined)}
          >
            {body}
          </Pressable>
        ) : (
          body
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Hour-of-day bars
// ---------------------------------------------------------------------------

export function HourBars({
  data,
  height = 120,
  color,
  highlightHours,
}: {
  data: number[];
  height?: number;
  color?: string;
  /** Hours to mark as the species' known active window. */
  highlightHours?: number[];
}) {
  const { c } = useTheme();
  const { width, onLayout } = useChartWidth();
  const [active, setActive] = useState<number | null>(null);
  const hue = color ?? c.seqHue;

  const PAD_B = 18;
  const plotH = height - PAD_B;
  const max = Math.max(...data, 1);
  const slot = width ? width / 24 : 0;
  const barW = Math.max(3, slot - 3);

  return (
    <View onLayout={onLayout}>
      {width > 0 ? (
        <Svg width={width} height={height}>
          {data.map((v, h) => {
            const bh = Math.max(v > 0 ? 3 : 0, (v / max) * (plotH - 4));
            const isPeak = highlightHours?.includes(h);
            return (
              <G key={h}>
                {isPeak ? (
                  <Rect
                    x={h * slot}
                    y={0}
                    width={slot}
                    height={plotH}
                    fill={c.warning}
                    opacity={0.07}
                  />
                ) : null}
                <Rect
                  x={h * slot + (slot - barW) / 2}
                  y={plotH - bh}
                  width={barW}
                  height={bh}
                  rx={2}
                  fill={hue}
                  opacity={active == null || active === h ? 1 : 0.35}
                />
              </G>
            );
          })}
          <Line
            x1={0}
            y1={plotH}
            x2={width}
            y2={plotH}
            stroke={c.border}
            strokeWidth={StyleSheet.hairlineWidth}
          />
          {[0, 6, 12, 18].map((h) => (
            <SvgText key={h} x={h * slot + 2} y={height - 4} fill={c.textFaint} fontSize={9.5}>
              {String(h).padStart(2, '0')}:00
            </SvgText>
          ))}
        </Svg>
      ) : (
        <View style={{ height }} />
      )}

      {/*
        Hit targets are plain Pressables overlaid on the chart, not touch props
        on the SVG shapes. react-native-svg's web renderer does not implement
        React Native's touch props on shapes, so `onPressIn` on a <Rect> leaks
        through to the DOM and throws. Overlaying also gives a full-height
        target rather than one only as wide as a 3px bar.
      */}
      {width > 0 ? (
        <View
          style={{ position: 'absolute', left: 0, top: 0, flexDirection: 'row', height: plotH }}
        >
          {data.map((_, h) => (
            <Pressable
              key={h}
              onPressIn={() => setActive(h)}
              onPressOut={() => setActive(null)}
              style={{ width: slot, height: plotH }}
            />
          ))}
        </View>
      ) : null}
      <Muted variant="small" style={{ marginTop: spacing.sm }}>
        {active != null
          ? `${String(active).padStart(2, '0')}:00–${String((active + 1) % 24).padStart(
              2,
              '0',
            )}:00 · ${data[active]} detection${data[active] === 1 ? '' : 's'}`
          : 'Shaded columns mark the species’ known active window.'}
      </Muted>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Weekday × hour heatmap — sequential, one hue
// ---------------------------------------------------------------------------

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function WeekHeatmap({ matrix }: { matrix: number[][] }) {
  const { c, isDark } = useTheme();
  const { width, onLayout } = useChartWidth();
  const [sel, setSel] = useState<{ d: number; h: number } | null>(null);

  const ramp = sequentialRamp[isDark ? 'dark' : 'light'];
  const max = Math.max(...matrix.flat(), 1);

  const LABEL_W = 30;
  const cell = width ? (width - LABEL_W) / 24 : 0;
  const cellH = 16;
  const height = 7 * cellH + 18;

  const colorFor = (v: number) => {
    if (v === 0) return c.surfaceAlt;
    const idx = Math.min(ramp.length - 1, 1 + Math.floor((v / max) * (ramp.length - 1.001)));
    return ramp[idx];
  };

  return (
    <View onLayout={onLayout}>
      {width > 0 ? (
        <Svg width={width} height={height}>
          {matrix.map((row, d) =>
            row.map((v, h) => (
              <Rect
                key={`${d}-${h}`}
                x={LABEL_W + h * cell}
                y={d * cellH}
                // 2px gap so neighbouring cells stay distinct without borders.
                width={Math.max(1, cell - 2)}
                height={cellH - 2}
                rx={2}
                fill={colorFor(v)}
              />
            )),
          )}
          {DAYS.map((d, i) => (
            <SvgText key={d} x={0} y={i * cellH + 11} fill={c.textFaint} fontSize={9.5}>
              {d}
            </SvgText>
          ))}
          {[0, 6, 12, 18].map((h) => (
            <SvgText
              key={h}
              x={LABEL_W + h * cell}
              y={height - 4}
              fill={c.textFaint}
              fontSize={9.5}
            >
              {String(h).padStart(2, '0')}
            </SvgText>
          ))}
        </Svg>
      ) : (
        <View style={{ height }} />
      )}

      {/*
        Hit targets are plain Pressables overlaid on the chart, not touch props
        on the SVG shapes. react-native-svg's web renderer does not implement
        React Native's touch props on shapes, so `onPressIn` on a <Rect> leaks
        through to the DOM and throws. Overlaying also gives a full-height
        target rather than one only as wide as a 3px bar.
      */}
      {width > 0 ? (
        <View style={{ position: 'absolute', left: LABEL_W, top: 0 }}>
          {matrix.map((row, d) => (
            <View key={d} style={{ flexDirection: 'row', height: cellH }}>
              {row.map((_, h) => (
                <Pressable
                  key={h}
                  onPressIn={() => setSel({ d, h })}
                  onPressOut={() => setSel(null)}
                  style={{ width: cell, height: cellH }}
                />
              ))}
            </View>
          ))}
        </View>
      ) : null}

      <Row justify="space-between" style={{ marginTop: spacing.sm }}>
        <Muted variant="small">
          {sel
            ? `${DAYS[sel.d]} ${String(sel.h).padStart(2, '0')}:00 · ${matrix[sel.d][sel.h]}`
            : 'Press any cell for its count.'}
        </Muted>
        <Row gap={4}>
          <Muted variant="caption">0</Muted>
          {ramp.map((step) => (
            <View
              key={step}
              style={{ width: 12, height: 8, borderRadius: 2, backgroundColor: step }}
            />
          ))}
          <Muted variant="caption">{max}</Muted>
        </Row>
      </Row>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Band-energy bars — the Goertzel bins behind a single detection
// ---------------------------------------------------------------------------

export function BandEnergyBars({
  bands,
  height = 108,
}: {
  bands: { b1: number; b2: number; b3: number; b4: number };
  height?: number;
}) {
  const { c } = useTheme();
  const rows = [
    { key: 'b1', label: '2–6 kHz', value: bands.b1 },
    { key: 'b2', label: '6–12 kHz', value: bands.b2 },
    { key: 'b3', label: '12–20 kHz', value: bands.b3 },
    { key: 'b4', label: '20–40 kHz', value: bands.b4 },
  ];
  const peak = Math.max(...rows.map((r) => r.value));

  return (
    <View style={{ gap: spacing.sm, height }}>
      {rows.map((r) => (
        <Row key={r.key} gap={spacing.md}>
          <Muted variant="small" style={{ width: 62 }}>
            {r.label}
          </Muted>
          <View
            style={{
              flex: 1,
              height: 10,
              borderRadius: 5,
              backgroundColor: c.surfaceAlt,
              overflow: 'hidden',
            }}
          >
            <View
              style={{
                width: `${Math.max(2, r.value * 100)}%`,
                height: '100%',
                borderRadius: 5,
                // The dominant bin is what the detector locked onto — it earns
                // emphasis; the rest are context.
                backgroundColor: r.value === peak ? c.seqHue : c.textFaint,
              }}
            />
          </View>
          <Txt variant="small" style={{ width: 34, textAlign: 'right' }}>
            {r.value.toFixed(2)}
          </Txt>
        </Row>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Battery discharge with dashed projection
// ---------------------------------------------------------------------------

export function BatteryChart({
  measured,
  projected,
  cutoff,
  height = 170,
  formatX,
}: {
  measured: { ts: number; volts: number }[];
  projected: { ts: number; volts: number }[];
  cutoff: number;
  height?: number;
  formatX?: (ts: number) => string;
}) {
  const { c } = useTheme();
  const { width, onLayout } = useChartWidth();

  const all = [...measured, ...projected];
  if (!all.length) return <View style={{ height }} />;

  const PAD_L = 38;
  const PAD_B = 20;
  const PAD_T = 8;
  const plotW = Math.max(0, width - PAD_L - 8);
  const plotH = height - PAD_B - PAD_T;

  const minTs = all[0].ts;
  const maxTs = all[all.length - 1].ts;
  const spanTs = maxTs - minTs || 1;
  const vMin = Math.min(cutoff - 0.05, ...all.map((p) => p.volts));
  const vMax = Math.max(...all.map((p) => p.volts)) + 0.05;
  const vSpan = vMax - vMin || 1;

  const xAt = (ts: number) => PAD_L + ((ts - minTs) / spanTs) * plotW;
  const yAt = (v: number) => PAD_T + plotH - ((v - vMin) / vSpan) * plotH;

  const toPath = (pts: { ts: number; volts: number }[]) =>
    pts
      .map((p, i) => `${i ? 'L' : 'M'}${xAt(p.ts).toFixed(1)},${yAt(p.volts).toFixed(1)}`)
      .join(' ');

  return (
    <View onLayout={onLayout}>
      {width > 0 ? (
        <Svg width={width} height={height}>
          {[vMin, (vMin + vMax) / 2, vMax].map((v) => (
            <G key={v}>
              <Line
                x1={PAD_L}
                y1={yAt(v)}
                x2={width - 8}
                y2={yAt(v)}
                stroke={c.border}
                strokeWidth={StyleSheet.hairlineWidth}
              />
              <SvgText x={PAD_L - 6} y={yAt(v) + 3.5} fill={c.textFaint} fontSize={10} textAnchor="end">
                {v.toFixed(2)}
              </SvgText>
            </G>
          ))}

          {/* Cutoff line — the thing the projection is racing toward. */}
          <Line
            x1={PAD_L}
            y1={yAt(cutoff)}
            x2={width - 8}
            y2={yAt(cutoff)}
            stroke={c.danger}
            strokeWidth={1.5}
            strokeDasharray="5 4"
          />
          <SvgText x={width - 8} y={yAt(cutoff) - 5} fill={c.danger} fontSize={9.5} textAnchor="end">
            3.20 V cutoff
          </SvgText>

          <Path d={toPath(measured)} stroke={c.seqHue} strokeWidth={2} fill="none" />
          {projected.length ? (
            <Path
              d={toPath(projected)}
              stroke={c.warning}
              strokeWidth={2}
              strokeDasharray="4 4"
              fill="none"
            />
          ) : null}

          <SvgText x={PAD_L} y={height - 5} fill={c.textFaint} fontSize={10}>
            {formatX ? formatX(minTs) : ''}
          </SvgText>
          <SvgText x={width - 8} y={height - 5} fill={c.textFaint} fontSize={10} textAnchor="end">
            {formatX ? formatX(maxTs) : ''}
          </SvgText>
        </Svg>
      ) : (
        <View style={{ height }} />
      )}
      <Legend
        compact
        items={[
          { label: 'Measured', color: c.seqHue },
          { label: 'Projected', color: c.warning },
        ]}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Probability bars — the classifier's full output vector
// ---------------------------------------------------------------------------

export function ProbabilityBars({
  probabilities,
  order,
}: {
  probabilities: Record<PestClass, number>;
  order: PestClass[];
}) {
  const { c } = useTheme();
  const pestColor = usePestColor();
  const sorted = [...order].sort((a, b) => probabilities[b] - probabilities[a]);

  return (
    <View style={{ gap: spacing.md }}>
      {sorted.map((cls) => {
        const p = probabilities[cls] ?? 0;
        return (
          <View key={cls} style={{ gap: 5 }}>
            <Row justify="space-between">
              <Row gap={6}>
                <Txt variant="small">{PEST_PROFILES[cls].emoji}</Txt>
                <Txt variant="small">{PEST_PROFILES[cls].label}</Txt>
              </Row>
              <Txt variant="smallStrong" color={c.textMuted}>
                {(p * 100).toFixed(1)}%
              </Txt>
            </Row>
            <View
              style={{
                height: 7,
                borderRadius: 3.5,
                backgroundColor: c.surfaceAlt,
                overflow: 'hidden',
              }}
            >
              <View
                style={{
                  width: `${Math.max(1, p * 100)}%`,
                  height: '100%',
                  borderRadius: 3.5,
                  backgroundColor: pestColor(cls),
                }}
              />
            </View>
          </View>
        );
      })}
    </View>
  );
}
