import React, { useEffect, useRef } from 'react';
import { Animated, Easing, View } from 'react-native';
import Svg, { Circle, Defs, G, Line, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { useTheme } from '@/theme';

/**
 * Illustrations, drawn as animated SVG rather than imported artwork.
 *
 * Three reasons this beats shipping PNGs or Lottie files here:
 *  - They take their colours from the live theme, so dark and light mode are
 *    both correct by construction instead of needing two sets of assets.
 *  - They are vector at any size and cost a few kilobytes, not a few hundred.
 *  - The motion encodes something real — the sonar rings expand at the node's
 *    actual deterrent cadence, the waveform reacts to live sound level — which
 *    a canned animation cannot do.
 */

/*
 * react-native-svg shapes take their geometry as props, not style, so these
 * animate `opacity`, `height` and `y` directly. Wrapping in an Animated.View
 * is not an option inside an <Svg> tree, and `style` on an animated <G> is not
 * part of its prop type.
 */
const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedRect = Animated.createAnimatedComponent(Rect);
const AnimatedPath = Animated.createAnimatedComponent(Path);

/** Loops a value 0→1 forever. Shared by every scene below. */
function useLoop(duration: number, delay = 0) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(v, {
          toValue: 1,
          duration,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [v, duration, delay]);
  return v;
}

// ---------------------------------------------------------------------------
// Sonar — the deterrent radiating outward
// ---------------------------------------------------------------------------

export function SonarScene({ size = 200, color }: { size?: number; color?: string }) {
  const { c } = useTheme();
  const accent = color ?? c.primary;
  const r1 = useLoop(2600, 0);
  const r2 = useLoop(2600, 870);
  const r3 = useLoop(2600, 1740);

  const ring = (v: Animated.Value) => ({
    r: v.interpolate({ inputRange: [0, 1], outputRange: [14, size * 0.46] }),
    opacity: v.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.55, 0] }),
  });

  const a = ring(r1);
  const b = ring(r2);
  const d = ring(r3);
  const cx = size / 2;

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id="sonarCore" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={accent} stopOpacity="0.9" />
            <Stop offset="1" stopColor={accent} stopOpacity="0.25" />
          </RadialGradient>
        </Defs>

        {[a, b, d].map((x, i) => (
          <AnimatedCircle
            key={i}
            cx={cx}
            cy={cx}
            r={x.r as unknown as number}
            stroke={accent}
            strokeWidth={2}
            fill="none"
            opacity={x.opacity as unknown as number}
          />
        ))}

        <Circle cx={cx} cy={cx} r={22} fill="url(#sonarCore)" />
        <Circle cx={cx} cy={cx} r={9} fill={accent} />
      </Svg>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Waveform — a live sound envelope
// ---------------------------------------------------------------------------

/**
 * Bars driven by a real level value (0..1). Passing the node's current sound
 * level makes this a genuine readout rather than decoration; with no value it
 * idles low so an inactive node looks inactive.
 */
export function WaveformScene({
  size = 200,
  level = 0,
  color,
  bars = 13,
}: {
  size?: number;
  level?: number;
  color?: string;
  bars?: number;
}) {
  const { c } = useTheme();
  const accent = color ?? c.info;
  const pulse = useLoop(1400);

  const w = size;
  const h = size * 0.5;
  const gap = 4;
  const barW = (w - gap * (bars - 1)) / bars;

  return (
    <View style={{ width: w, height: h }}>
      <Svg width={w} height={h}>
        {Array.from({ length: bars }).map((_, i) => {
          // A fixed envelope shape keeps the centre tallest; `level` scales it.
          const centre = 1 - Math.abs(i - (bars - 1) / 2) / ((bars - 1) / 2);
          const base = 0.18 + centre * 0.55;
          const amp = base * (0.35 + level * 0.65);
          const barH = Math.max(4, amp * h);
          // Each bar breathes on its own phase so the row reads as a live
          // signal rather than a single block scaling up and down.
          const shrink = 1 - (i % 3) * 0.12 - 0.08;
          const animH = pulse.interpolate({
            inputRange: [0, 0.5, 1],
            outputRange: [barH, Math.max(4, barH * shrink), barH],
          });
          const animY = pulse.interpolate({
            inputRange: [0, 0.5, 1],
            outputRange: [
              (h - barH) / 2,
              (h - Math.max(4, barH * shrink)) / 2,
              (h - barH) / 2,
            ],
          });
          return (
            <AnimatedRect
              key={i}
              x={i * (barW + gap)}
              y={animY}
              width={barW}
              height={animH}
              rx={barW / 2}
              fill={accent}
              opacity={0.35 + centre * 0.65}
            />
          );
        })}
      </Svg>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Shield — protection active
// ---------------------------------------------------------------------------

export function ShieldScene({ size = 180, color }: { size?: number; color?: string }) {
  const { c } = useTheme();
  const accent = color ?? c.success;
  const glow = useLoop(3000);

  const s = size;
  const path = `M${s / 2} ${s * 0.08}
    L${s * 0.84} ${s * 0.24}
    L${s * 0.84} ${s * 0.52}
    Q${s * 0.84} ${s * 0.8} ${s / 2} ${s * 0.94}
    Q${s * 0.16} ${s * 0.8} ${s * 0.16} ${s * 0.52}
    L${s * 0.16} ${s * 0.24} Z`;

  return (
    <View style={{ width: s, height: s }}>
      <Svg width={s} height={s}>
        <Defs>
          <RadialGradient id="shieldFill" cx="50%" cy="35%" r="70%">
            <Stop offset="0" stopColor={accent} stopOpacity="0.30" />
            <Stop offset="1" stopColor={accent} stopOpacity="0.06" />
          </RadialGradient>
        </Defs>
        <AnimatedCircle
          cx={s / 2}
          cy={s / 2}
          r={s * 0.42}
          fill={accent}
          opacity={
            glow.interpolate({
              inputRange: [0, 0.5, 1],
              outputRange: [0.04, 0.12, 0.04],
            }) as unknown as number
          }
        />
        <Path d={path} fill="url(#shieldFill)" stroke={accent} strokeWidth={2.5} />
        <Path
          d={`M${s * 0.36} ${s * 0.5} L${s * 0.46} ${s * 0.61} L${s * 0.65} ${s * 0.39}`}
          stroke={accent}
          strokeWidth={4}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </Svg>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Node — the ESP32 board with a live link
// ---------------------------------------------------------------------------

export function NodeScene({
  size = 200,
  connected = true,
  color,
}: {
  size?: number;
  connected?: boolean;
  color?: string;
}) {
  const { c } = useTheme();
  const accent = color ?? (connected ? c.primary : c.textFaint);
  const pulse = useLoop(2000);
  const s = size;
  const bw = s * 0.42;
  const bh = s * 0.32;
  const bx = (s - bw) / 2;
  const by = s * 0.42;

  return (
    <View style={{ width: s, height: s }}>
      <Svg width={s} height={s}>
        {/* Signal arcs rising from the board */}
        {connected
          ? [0, 1, 2].map((i) => {
              const r = s * (0.16 + i * 0.1);
              return (
                <AnimatedPath
                  key={i}
                  d={`M${s / 2 - r * 0.72} ${by - r * 0.34} A${r} ${r} 0 0 1 ${
                    s / 2 + r * 0.72
                  } ${by - r * 0.34}`}
                  stroke={accent}
                  strokeWidth={2.4}
                  strokeLinecap="round"
                  fill="none"
                  opacity={pulse.interpolate({
                    inputRange: [0, 0.4 + i * 0.15, 0.8 + i * 0.06, 1],
                    outputRange: [0.15, 0.85, 0.15, 0.15],
                  })}
                />
              );
            })
          : null}

        {/* Board */}
        <Rect x={bx} y={by} width={bw} height={bh} rx={7} fill={accent} opacity={0.16} />
        <Rect
          x={bx}
          y={by}
          width={bw}
          height={bh}
          rx={7}
          stroke={accent}
          strokeWidth={2}
          fill="none"
        />

        {/* Pin headers down both sides */}
        {Array.from({ length: 6 }).map((_, i) => {
          const y = by + 8 + i * ((bh - 16) / 5);
          return (
            <G key={i}>
              <Line x1={bx - 7} y1={y} x2={bx} y2={y} stroke={accent} strokeWidth={2} opacity={0.7} />
              <Line
                x1={bx + bw}
                y1={y}
                x2={bx + bw + 7}
                y2={y}
                stroke={accent}
                strokeWidth={2}
                opacity={0.7}
              />
            </G>
          );
        })}

        {/* Die */}
        <Rect
          x={bx + bw * 0.28}
          y={by + bh * 0.28}
          width={bw * 0.44}
          height={bh * 0.44}
          rx={3}
          fill={accent}
          opacity={0.55}
        />

        {/* Status LED */}
        <Circle cx={bx + bw - 11} cy={by + bh - 10} r={3.5} fill={connected ? c.success : c.danger} />
      </Svg>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Pest — a simple rodent silhouette, used in empty states
// ---------------------------------------------------------------------------

export function PestScene({ size = 160, color }: { size?: number; color?: string }) {
  const { c } = useTheme();
  const accent = color ?? c.textFaint;
  const s = size;

  return (
    <View style={{ width: s, height: s * 0.7 }}>
      <Svg width={s} height={s * 0.7}>
        {/* Body */}
        <Path
          d={`M${s * 0.2} ${s * 0.46}
              Q${s * 0.24} ${s * 0.26} ${s * 0.46} ${s * 0.26}
              Q${s * 0.66} ${s * 0.26} ${s * 0.7} ${s * 0.42}
              Q${s * 0.72} ${s * 0.52} ${s * 0.6} ${s * 0.54}
              L${s * 0.26} ${s * 0.54}
              Q${s * 0.19} ${s * 0.53} ${s * 0.2} ${s * 0.46} Z`}
          fill={accent}
          opacity={0.5}
        />
        {/* Head */}
        <Circle cx={s * 0.74} cy={s * 0.42} r={s * 0.1} fill={accent} opacity={0.6} />
        {/* Ear */}
        <Circle cx={s * 0.72} cy={s * 0.31} r={s * 0.055} fill={accent} opacity={0.42} />
        {/* Eye */}
        <Circle cx={s * 0.79} cy={s * 0.4} r={s * 0.014} fill={c.bg} />
        {/* Tail */}
        <Path
          d={`M${s * 0.2} ${s * 0.5} Q${s * 0.06} ${s * 0.5} ${s * 0.1} ${s * 0.32}`}
          stroke={accent}
          strokeWidth={2.5}
          strokeLinecap="round"
          fill="none"
          opacity={0.5}
        />
      </Svg>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Connection lost
// ---------------------------------------------------------------------------

export function DisconnectedScene({ size = 170, color }: { size?: number; color?: string }) {
  const { c } = useTheme();
  const accent = color ?? c.danger;
  const s = size;

  return (
    <View style={{ width: s, height: s * 0.72 }}>
      <Svg width={s} height={s * 0.72}>
        {[0, 1, 2].map((i) => {
          const r = s * (0.14 + i * 0.11);
          return (
            <Path
              key={i}
              d={`M${s / 2 - r * 0.75} ${s * 0.52 - r * 0.36} A${r} ${r} 0 0 1 ${
                s / 2 + r * 0.75
              } ${s * 0.52 - r * 0.36}`}
              stroke={accent}
              strokeWidth={2.6}
              strokeLinecap="round"
              fill="none"
              opacity={0.22 + i * 0.06}
            />
          );
        })}
        <Circle cx={s / 2} cy={s * 0.54} r={5} fill={accent} opacity={0.5} />
        {/* The slash: unmistakably "no link" */}
        <Line
          x1={s * 0.26}
          y1={s * 0.18}
          x2={s * 0.74}
          y2={s * 0.64}
          stroke={accent}
          strokeWidth={4}
          strokeLinecap="round"
        />
      </Svg>
    </View>
  );
}
