'use client';

import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { useTourCommand } from './tour/tour-bus';

type Metric = 'requests' | 'bandwidth' | 'hit';
type Range = '24h' | '7d' | '30d';

export const METRICS: Array<{ id: Metric; label: string }> = [
  { id: 'requests', label: 'Requests' },
  { id: 'bandwidth', label: 'Bandwidth' },
  { id: 'hit', label: 'Cache hit ratio' },
];

const RANGES: Array<{ id: Range; label: string; points: number; stepHours: number }> = [
  { id: '24h', label: '24 hours', points: 24, stepHours: 1 },
  { id: '7d', label: '7 days', points: 42, stepHours: 4 },
  { id: '30d', label: '30 days', points: 30, stepHours: 24 },
];

// Small deterministic pseudo-random generator so server and client agree.
function rand(seed: number) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function series(metric: Metric, range: Range) {
  const cfg = RANGES.find((r) => r.id === range)!;
  return Array.from({ length: cfg.points }, (_, i) => {
    const hour = (i * cfg.stepHours) % 24;
    const day = Math.floor((i * cfg.stepHours) / 24);
    const diurnal = cfg.stepHours >= 24 ? 1 : 0.62 + 0.38 * Math.sin(((hour - 8) / 24) * Math.PI * 2);
    const weekly = 1 + (day % 7 >= 5 ? -0.12 : 0.04);
    const trend = 1 + i / cfg.points / 6;
    const noise = 0.92 + rand(i + cfg.points * 7) * 0.16;
    const reqPerHour = 760_000 * diurnal * weekly * trend * noise * (cfg.stepHours >= 24 ? 24 : cfg.stepHours);
    if (metric === 'requests') return reqPerHour;
    if (metric === 'bandwidth') return reqPerHour * 182_000; // bytes, ~182 KB average response
    return 93.2 + diurnal * 2.4 + rand(i * 3 + 1) * 1.1; // percent
  });
}

function formatValue(metric: Metric, value: number, compact = false) {
  if (metric === 'hit') return `${value.toFixed(compact ? 0 : 1)}%`;
  if (value === 0) return '0';
  if (metric === 'bandwidth') {
    const tb = value / 1e12;
    if (tb >= 1) return `${tb.toFixed(compact ? 1 : 2)} TB`;
    return `${(value / 1e9).toFixed(compact ? 0 : 1)} GB`;
  }
  if (value >= 1e9) return `${(value / 1e9).toFixed(compact ? 1 : 2)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(compact ? 1 : 2)}M`;
  return `${Math.round(value / 1e3)}K`;
}

function labelFor(range: Range, index: number) {
  const cfg = RANGES.find((r) => r.id === range)!;
  if (range === '24h') return `${String(index).padStart(2, '0')}:00`;
  if (range === '7d') {
    const day = Math.floor((index * cfg.stepHours) / 24);
    return `Day ${day + 1}, ${String((index * cfg.stepHours) % 24).padStart(2, '0')}:00`;
  }
  return `Day ${index + 1}`;
}

function niceStep(raw: number) {
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const nice = [1, 2, 2.5, 5, 10].find((n) => n * magnitude >= raw) ?? 10;
  return nice * magnitude;
}

const W = 720;
const H = 340;
const PAD = { left: 52, right: 12, top: 16, bottom: 28 };

export function PerformanceChart() {
  const [metric, setMetric] = useState<Metric>('requests');
  const [range, setRange] = useState<Range>('24h');
  const [hover, setHover] = useState<number | null>(null);

  useTourCommand('metric', (next) => {
    setMetric(next);
    setHover(null);
  });

  const data = useMemo(() => series(metric, range), [metric, range]);
  const isHit = metric === 'hit';
  const step = isHit ? 3 : niceStep((Math.max(...data) * 1.05) / 4);
  const min = isHit ? 88 : 0;
  const max = isHit ? 100 : step * 4;
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (i / (data.length - 1)) * innerW;
  const y = (v: number) => PAD.top + innerH - ((v - min) / (max - min)) * innerH;

  const line = data.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L${x(data.length - 1).toFixed(1)} ${PAD.top + innerH} L${PAD.left} ${PAD.top + innerH} Z`;
  const ticks = Array.from({ length: 5 }, (_, i) => min + ((max - min) * i) / 4);

  const total = data.reduce((a, b) => a + b, 0);
  const summary = isHit
    ? [
        ['Average', formatValue(metric, total / data.length)],
        ['Lowest', formatValue(metric, Math.min(...data))],
        ['Highest', formatValue(metric, Math.max(...data))],
      ]
    : [
        ['Total', formatValue(metric, total)],
        ['Peak per point', formatValue(metric, Math.max(...data))],
        ['Average per point', formatValue(metric, total / data.length)],
      ];

  const active = hover ?? data.length - 1;
  const metricLabel = METRICS.find((m) => m.id === metric)!.label;
  const rangeLabel = RANGES.find((r) => r.id === range)!.label;

  const onMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((px - PAD.left) / innerW) * (data.length - 1));
    setHover(Math.max(0, Math.min(data.length - 1, i)));
  };

  const onKey = (event: React.KeyboardEvent<SVGSVGElement>) => {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      setHover(Math.min(data.length - 1, active + 1));
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setHover(Math.max(0, active - 1));
    }
  };

  const tipX = x(active);
  const tipLeft = tipX > W * 0.7;

  return (
    <div data-tour="performance" className="rounded-3xl border border-border bg-background p-4 shadow-[0_24px_60px_-36px_rgba(29,32,37,0.35)] sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div role="radiogroup" aria-label="Metric" className="inline-flex w-full rounded-lg bg-muted p-1 sm:w-auto">
          {METRICS.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={metric === m.id}
              onClick={() => {
                setMetric(m.id);
                setHover(null);
              }}
              className={cn(
                'flex-1 rounded-md px-3 py-1.5 text-[13px] font-medium whitespace-nowrap transition-colors sm:flex-none',
                metric === m.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div role="radiogroup" aria-label="Time range" className="flex gap-1.5">
          {RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              role="radio"
              aria-checked={range === r.id}
              onClick={() => {
                setRange(r.id);
                setHover(null);
              }}
              className={cn(
                'rounded-full border px-3 py-1 text-[12px] font-medium transition-colors',
                range === r.id
                  ? 'border-primary bg-primary-soft text-primary'
                  : 'border-border text-muted-foreground hover:border-border-strong hover:text-foreground',
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <dl className="mt-5 grid grid-cols-3 gap-3">
        {summary.map(([label, value]) => (
          <div key={label}>
            <dt className="text-[12px] text-muted-foreground">{label}</dt>
            <dd className="text-[18px] font-semibold tracking-tight text-foreground tabular-nums sm:text-[22px]">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="relative mt-4">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="block h-auto w-full touch-pan-y"
          role="img"
          aria-label={`${metricLabel} over the last ${rangeLabel}. Selected point ${labelFor(range, active)}: ${formatValue(metric, data[active])}. Use the left and right arrow keys to move between points.`}
          tabIndex={0}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
          onKeyDown={onKey}
          onBlur={() => setHover(null)}
        >
          <defs>
            <linearGradient id="mk-perf-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#e8336d" stopOpacity="0.25" />
              <stop offset="1" stopColor="#e8336d" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="mk-perf-line" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#f7931e" />
              <stop offset="0.5" stopColor="#d6246a" />
              <stop offset="1" stopColor="#5b2a8c" />
            </linearGradient>
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="#e4e6ea" strokeWidth="1" />
              <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" fontSize="11" className="text-[22px] sm:text-[14px] lg:text-[11px]" fill="#5e6670">
                {formatValue(metric, t, true)}
              </text>
            </g>
          ))}
          {[0, Math.floor((data.length - 1) / 2), data.length - 1].map((i) => (
            <text
              key={i}
              x={x(i)}
              y={H - 8}
              textAnchor={i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'}
              fontSize="11" className="text-[22px] sm:text-[14px] lg:text-[11px]"
              fill="#5e6670"
            >
              {labelFor(range, i)}
            </text>
          ))}
          <path d={area} fill="url(#mk-perf-fill)" />
          <path d={line} fill="none" stroke="url(#mk-perf-line)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
          <line x1={tipX} x2={tipX} y1={PAD.top} y2={PAD.top + innerH} stroke="#1d2025" strokeOpacity="0.25" strokeDasharray="3 3" />
          <circle cx={tipX} cy={y(data[active])} r="5" fill="#ffffff" stroke="#d6246a" strokeWidth="2.5" />
        </svg>
        <div
          className="pointer-events-none absolute top-2 rounded-lg border border-border bg-background/95 px-3 py-2 shadow-md"
          style={tipLeft ? { right: `${((W - tipX) / W) * 100 + 2}%` } : { left: `${(tipX / W) * 100 + 2}%` }}
          aria-hidden
        >
          <p className="text-[11px] text-muted-foreground">{labelFor(range, active)}</p>
          <p className="text-[14px] font-semibold text-foreground tabular-nums">{formatValue(metric, data[active])}</p>
        </div>
      </div>
    </div>
  );
}
