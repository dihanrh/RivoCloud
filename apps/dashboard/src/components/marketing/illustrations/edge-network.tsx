'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { useReducedMotion } from '../use-reduced-motion';
import { landRects, MAP_HEIGHT, MAP_WIDTH, project } from './world-map';

type Pop = { code: string; lon: number; lat: number; label?: 'above' | 'below' | 'left' | 'right' };

const POPS: Pop[] = [
  { code: 'SJC', lon: -122, lat: 37, label: 'left' },
  { code: 'DFW', lon: -97, lat: 32.8, label: 'below' },
  { code: 'GRU', lon: -46.6, lat: -23.5, label: 'right' },
  { code: 'MAD', lon: -3.7, lat: 40.4, label: 'below' },
  { code: 'FRA', lon: 8.7, lat: 50.1, label: 'above' },
  { code: 'ARN', lon: 18, lat: 59.3, label: 'right' },
  { code: 'LOS', lon: 3.4, lat: 6.5, label: 'below' },
  { code: 'JNB', lon: 28, lat: -26.2, label: 'right' },
  { code: 'DXB', lon: 55.3, lat: 25.2, label: 'below' },
  { code: 'BOM', lon: 72.9, lat: 19, label: 'below' },
  { code: 'DAC', lon: 90.4, lat: 23.8, label: 'above' },
  { code: 'SIN', lon: 103.8, lat: 1.3, label: 'below' },
  { code: 'HKG', lon: 114.2, lat: 22.3, label: 'right' },
  { code: 'NRT', lon: 140.4, lat: 35.8, label: 'right' },
  { code: 'SYD', lon: 151.2, lat: -33.9, label: 'right' },
];

const ORIGIN = project(-79, 39.5);

// Visitors and the edge each one is routed to (by index into POPS).
const VISITORS: Array<{ lon: number; lat: number; pop: number }> = [
  { lon: -118, lat: 46, pop: 0 },
  { lon: -110, lat: 28, pop: 1 },
  { lon: -58, lat: -33, pop: 2 },
  { lon: -40, lat: -8, pop: 2 },
  { lon: -8, lat: 53, pop: 4 },
  { lon: 22, lat: 46, pop: 4 },
  { lon: 30, lat: 64, pop: 5 },
  { lon: 14, lat: 12, pop: 6 },
  { lon: 36, lat: -14, pop: 7 },
  { lon: 46, lat: 33, pop: 8 },
  { lon: 78, lat: 10, pop: 9 },
  { lon: 84, lat: 34, pop: 10 },
  { lon: 110, lat: -6, pop: 11 },
  { lon: 122, lat: 32, pop: 12 },
  { lon: 128, lat: 44, pop: 13 },
  { lon: 140, lat: -24, pop: 14 },
];

// Edges that miss and fetch from the origin in the animation.
const MISSES = [2, 4, 11, 13];

type Point = { x: number; y: number };

function arc(a: Point, b: Point, lift: number) {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2 - lift;
  return `M${a.x.toFixed(1)} ${a.y.toFixed(1)} Q${mx.toFixed(1)} ${my.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
}

function labelOffset(side: Pop['label']) {
  switch (side) {
    case 'left':
      return { dx: -7, dy: 2.3, anchor: 'end' as const };
    case 'right':
      return { dx: 7, dy: 2.3, anchor: 'start' as const };
    case 'above':
      return { dx: 0, dy: -7, anchor: 'middle' as const };
    default:
      return { dx: 0, dy: 11, anchor: 'middle' as const };
  }
}

/** The hero image: a dotted world map with edge locations and live request flow. */
export function EdgeNetworkIllustration() {
  const reduced = useReducedMotion();
  const pops = POPS.map((pop) => ({ ...pop, ...project(pop.lon, pop.lat) }));
  const visitors = VISITORS.map((v) => ({ ...v, ...project(v.lon, v.lat) }));

  return (
    <svg
      viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
      className="block h-auto w-full"
      role="img"
      aria-labelledby="edge-map-title edge-map-desc"
    >
      <title id="edge-map-title">RivoCloud edge network</title>
      <desc id="edge-map-desc">
        A world map with fifteen edge locations. Visitors connect to their nearest edge, which answers from cache and only
        contacts the origin server on a cache miss.
      </desc>
      <defs>
        <pattern id="mk-dots" width="5" height="5" patternUnits="userSpaceOnUse">
          <circle cx="2.5" cy="2.5" r="1.05" fill="#1d2025" fillOpacity="0.22" />
        </pattern>
        <linearGradient id="mk-arc" x1="0" y1="0" x2={MAP_WIDTH} y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#f7931e" />
          <stop offset="0.55" stopColor="#e8336d" />
          <stop offset="1" stopColor="#5b2a8c" />
        </linearGradient>
        <radialGradient id="mk-pop-glow">
          <stop offset="0" stopColor="#e8336d" stopOpacity="0.35" />
          <stop offset="1" stopColor="#e8336d" stopOpacity="0" />
        </radialGradient>
      </defs>

      <g>
        {landRects().map((rect, i) => (
          <rect key={i} {...rect} fill="url(#mk-dots)" />
        ))}
      </g>

      {/* Edge-to-origin fetches on a cache miss. */}
      <g fill="none">
        {MISSES.map((popIndex) => {
          const pop = pops[popIndex];
          return (
            <path
              key={`miss-${pop.code}`}
              id={`mk-miss-${pop.code}`}
              d={arc(pop, ORIGIN, 46)}
              stroke="url(#mk-arc)"
              strokeOpacity="0.55"
              strokeWidth="0.9"
              strokeDasharray="3 3"
              className={reduced ? undefined : 'mk-dash'}
            />
          );
        })}
      </g>

      {/* Visitor-to-edge requests. */}
      <g fill="none">
        {visitors.map((v, i) => (
          <path
            key={`req-${i}`}
            id={`mk-req-${i}`}
            d={arc(v, pops[v.pop], 10)}
            stroke="#e8336d"
            strokeOpacity="0.4"
            strokeWidth="0.7"
          />
        ))}
      </g>

      {visitors.map((v, i) => (
        <circle key={`v-${i}`} cx={v.x} cy={v.y} r="1.6" fill="#5b2a8c" fillOpacity="0.6" />
      ))}

      {/* Moving request pulses. */}
      {!reduced && (
        <g>
          {visitors.map((_, i) => (
            <circle key={`p-${i}`} r="1.7" fill="#e8336d">
              <animateMotion dur={`${1.8 + (i % 4) * 0.35}s`} begin={`${((i * 0.37) % 2.2).toFixed(2)}s`} repeatCount="indefinite">
                <mpath href={`#mk-req-${i}`} />
              </animateMotion>
            </circle>
          ))}
          {MISSES.map((popIndex, i) => (
            <circle key={`m-${popIndex}`} r="2" fill="#f7931e">
              <animateMotion dur="3.6s" begin={`${i * 0.9}s`} repeatCount="indefinite">
                <mpath href={`#mk-miss-${pops[popIndex].code}`} />
              </animateMotion>
            </circle>
          ))}
        </g>
      )}

      {/* Edge locations. */}
      {pops.map((pop, i) => {
        const label = labelOffset(pop.label);
        const begin = `${((i * 0.41) % 2.8).toFixed(2)}s`;
        return (
          <g key={pop.code}>
            <circle cx={pop.x} cy={pop.y} r="9" fill="url(#mk-pop-glow)" />
            {!reduced && (
              <circle cx={pop.x} cy={pop.y} r="3" fill="none" stroke="#e8336d" strokeWidth="0.8">
                <animate attributeName="r" values="3;9" dur="2.8s" begin={begin} repeatCount="indefinite" />
                <animate attributeName="stroke-opacity" values="0.7;0" dur="2.8s" begin={begin} repeatCount="indefinite" />
              </circle>
            )}
            <circle cx={pop.x} cy={pop.y} r="3" fill="#ffffff" stroke="#d6246a" strokeWidth="1.4" />
            <text
              x={pop.x + label.dx}
              y={pop.y + label.dy}
              textAnchor={label.anchor}
              className="hidden fill-[#5e6670] font-mono sm:inline"
              fontSize="7.5"
              fontWeight="600"
            >
              {pop.code}
            </text>
          </g>
        );
      })}

      {/* Origin. */}
      <g>
        <rect x={ORIGIN.x - 7} y={ORIGIN.y - 7} width="14" height="14" rx="3.5" fill="#1d2025" />
        <rect x={ORIGIN.x - 3.6} y={ORIGIN.y - 3.6} width="7.2" height="2.2" rx="0.8" fill="#ffffff" fillOpacity="0.85" />
        <rect x={ORIGIN.x - 3.6} y={ORIGIN.y + 0.6} width="7.2" height="2.2" rx="0.8" fill="#ffffff" fillOpacity="0.55" />
        <text x={ORIGIN.x} y={ORIGIN.y + 17} textAnchor="middle" className="hidden fill-[#1d2025] sm:inline" fontSize="7" fontWeight="600">
          Your origin
        </text>
      </g>
    </svg>
  );
}

const SPARK = [42, 48, 45, 52, 58, 55, 61, 66, 63, 70, 74, 71, 78, 82, 79, 86];
const WOBBLE = [0, 3, -2, 5, 1, -3, 4, 2];

/** A small, live-looking console card that floats over the hero map. */
export function LiveStatsCard({ className = '' }: { className?: string }) {
  const reduced = useReducedMotion();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (reduced) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1600);
    return () => window.clearInterval(id);
  }, [reduced]);

  const wobble = WOBBLE[tick % WOBBLE.length];
  const rps = 12480 + wobble * 37;
  const hit = (96.4 + wobble * 0.05).toFixed(1);
  const p95 = 38 + (wobble % 3);

  return (
    <div className={`rounded-xl border border-border bg-white p-4 ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold text-foreground">shop.northwind.com</p>
          <p className="text-[12px] text-muted-foreground">All edges, last 60 seconds</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-medium text-success">
          <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />
          Live
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2">
        <div>
          <dt className="text-[11px] text-muted-foreground">Requests/s</dt>
          <dd className="font-mono text-[14px] font-semibold tabular-nums text-foreground">{rps.toLocaleString('en-US')}</dd>
        </div>
        <div>
          <dt className="text-[11px] text-muted-foreground">Cache hit</dt>
          <dd className="font-mono text-[14px] font-semibold tabular-nums text-foreground">{hit}%</dd>
        </div>
        <div>
          <dt className="text-[11px] text-muted-foreground">p95</dt>
          <dd className="font-mono text-[14px] font-semibold tabular-nums text-foreground">{p95} ms</dd>
        </div>
      </dl>
      <div className="mt-3 flex h-10 items-end gap-[3px]" aria-hidden>
        {SPARK.map((h, i) => {
          const value = Math.max(20, Math.min(100, h + (((i + tick) * 7) % 11) - 5));
          return (
            <span
              key={i}
              className="flex-1 rounded-[2px] transition-[height] duration-700"
              style={{
                height: `${value}%`,
                background: i === SPARK.length - 1 ? '#d6246a' : 'linear-gradient(to top, #f7931e66, #e8336daa)',
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

export function PurgeToast({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-start gap-2.5 rounded-xl border border-border bg-white/95 p-3.5 shadow-[0_18px_40px_-18px_rgba(29,32,37,0.35)] backdrop-blur ${className}`}>
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-foreground">Purge complete</p>
        <p className="text-[12px] leading-snug text-muted-foreground">
          <span className="font-mono text-foreground">/blog/*</span> cleared on all 15 edges in 1.4 s
        </p>
      </div>
    </div>
  );
}

const REGIONS = [
  { name: 'North America', edges: 2, ms: 14 },
  { name: 'Europe', edges: 3, ms: 11 },
  { name: 'Asia Pacific', edges: 6, ms: 19 },
  { name: 'South America', edges: 1, ms: 23 },
  { name: 'Middle East and Africa', edges: 3, ms: 26 },
];

/** Per-region edge health, shown beside the hero map. */
export function EdgeStatusList() {
  return (
    <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-semibold text-foreground">Edge locations</p>
        <p className="text-[12px] text-muted-foreground">Median TTFB</p>
      </div>
      <ul className="mt-2 divide-y divide-border">
        {REGIONS.map((region) => (
          <li key={region.name} className="flex items-center gap-2 py-2 text-[12px]">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-success" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-foreground">{region.name}</span>
            <span className="text-muted-foreground tabular-nums">{region.edges}</span>
            <span className="w-12 text-right font-mono text-foreground tabular-nums">{region.ms} ms</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
