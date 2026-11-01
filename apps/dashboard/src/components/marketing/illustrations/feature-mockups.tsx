'use client';

import { useEffect, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Copy,
  File,
  FileImage,
  FileVideo,
  Folder,
  KeyRound,
  Loader2,
  Lock,
  Minus,
  ShieldCheck,
  Upload,
  XCircle,
} from 'lucide-react';
import { useReducedMotion } from '../use-reduced-motion';
import { MockWindow, Pill } from './mock-window';

/* ------------------------------------------------------------------ */
/* Websites and caching                                                */
/* ------------------------------------------------------------------ */

const RULES = [
  { path: '/static/*', action: 'Cache', tone: 'success' as const, edge: '30 days', browser: '7 days', qs: 'Ignore' },
  { path: '/products/*', action: 'Cache', tone: 'success' as const, edge: '10 min', browser: '1 min', qs: 'Include' },
  { path: '/api/*', action: 'Bypass', tone: 'warning' as const, edge: '-', browser: '-', qs: 'Include' },
  { path: '/account/*', action: 'No store', tone: 'danger' as const, edge: '-', browser: '-', qs: '-' },
];

export function CacheRulesMockup() {
  return (
    <MockWindow title="shop.northwind.com · Cache rules" meta="4 rules">
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-[12px]">
          <thead className="bg-muted text-left text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Path</th>
              <th scope="col" className="px-3 py-2 font-medium">Action</th>
              <th scope="col" className="px-3 py-2 font-medium">Edge TTL</th>
              <th scope="col" className="hidden px-3 py-2 font-medium sm:table-cell">Browser TTL</th>
              <th scope="col" className="hidden px-3 py-2 font-medium md:table-cell">Query string</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {RULES.map((rule) => (
              <tr key={rule.path}>
                <td className="px-3 py-2.5 font-mono text-foreground">{rule.path}</td>
                <td className="px-3 py-2.5">
                  <Pill tone={rule.tone}>{rule.action}</Pill>
                </td>
                <td className="px-3 py-2.5 text-foreground tabular-nums">{rule.edge}</td>
                <td className="hidden px-3 py-2.5 text-foreground tabular-nums sm:table-cell">{rule.browser}</td>
                <td className="hidden px-3 py-2.5 text-muted-foreground md:table-cell">{rule.qs}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between text-[12px]">
          <span className="font-medium text-foreground">Where requests were answered</span>
          <span className="text-muted-foreground">last 24 hours</span>
        </div>
        <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden>
          <span className="h-full bg-brand-pink" style={{ width: '71%' }} />
          <span className="h-full bg-brand-orange" style={{ width: '23%' }} />
          <span className="h-full bg-brand-purple" style={{ width: '6%' }} />
        </div>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <li className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-brand-pink" aria-hidden />Edge memory 71%</li>
          <li className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-brand-orange" aria-hidden />Regional Redis 23%</li>
          <li className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-brand-purple" aria-hidden />Origin 6%</li>
        </ul>
      </div>

      <div className="mt-4 rounded-lg border border-border bg-muted/60 p-3">
        <div className="flex gap-2">
          <div className="flex h-8 min-w-0 flex-1 items-center rounded-md border border-border-strong bg-background px-2.5 font-mono text-[12px] text-foreground">
            <span className="truncate">/products/summer-*</span>
          </div>
          <span className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground">
            Purge
          </span>
        </div>
        <p className="mk-fade-up mt-2.5 flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden />
          Purged on all 15 edges in 1.4 s · 2,318 objects
        </p>
      </div>
    </MockWindow>
  );
}

/* ------------------------------------------------------------------ */
/* Object storage                                                      */
/* ------------------------------------------------------------------ */

const OBJECTS = [
  { icon: Folder, name: 'products/', size: '-', when: '-' },
  { icon: FileImage, name: 'banner-autumn.webp', size: '284 KB', when: '2 min ago' },
  { icon: FileImage, name: 'logo@2x.png', size: '41 KB', when: 'Yesterday' },
  { icon: File, name: 'catalogue-2026.pdf', size: '12.4 MB', when: 'Oct 28' },
];

export function StorageMockup() {
  return (
    <MockWindow
      title="media-assets"
      meta={
        <span className="inline-flex items-center gap-1">
          <Lock className="h-3 w-3" aria-hidden /> Private
        </span>
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-[12px] text-muted-foreground">
          media-assets <span className="text-border-strong">/</span> <span className="text-foreground">uploads</span>
        </p>
        <span className="inline-flex h-7 items-center gap-1.5 rounded-md bg-primary px-2.5 text-[12px] font-medium text-primary-foreground">
          <Upload className="h-3.5 w-3.5" aria-hidden /> Upload
        </span>
      </div>
      <ul className="mt-3 divide-y divide-border overflow-hidden rounded-lg border border-border text-[12px]">
        <li className="bg-primary-soft/50 px-3 py-2.5">
          <div className="flex items-center gap-2.5">
            <FileVideo className="h-4 w-4 shrink-0 text-primary" aria-hidden />
            <span className="min-w-0 flex-1 truncate font-medium text-foreground">launch-film-4k.mp4</span>
            <span className="text-muted-foreground tabular-nums">1.8 GB</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white">
            <div className="mk-progress h-full w-[68%] rounded-full" style={{ background: 'var(--brand-gradient)' }} />
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">Uploading straight to storage with a presigned URL</p>
        </li>
        {OBJECTS.map(({ icon: Icon, name, size, when }) => (
          <li key={name} className="flex items-center gap-2.5 px-3 py-2.5">
            <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-foreground">{name}</span>
            <span className="hidden w-16 text-right text-muted-foreground tabular-nums sm:inline">{size}</span>
            <span className="w-20 text-right text-muted-foreground">{when}</span>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
        <Pill tone="info">S3-compatible endpoint</Pill>
        <Pill tone="neutral">Served through shop.northwind.com</Pill>
      </div>
    </MockWindow>
  );
}

/* ------------------------------------------------------------------ */
/* Signed URLs                                                         */
/* ------------------------------------------------------------------ */

function formatClock(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function SignedUrlMockup() {
  const reduced = useReducedMotion();
  const [remaining, setRemaining] = useState(59 * 60 + 42);

  useEffect(() => {
    if (reduced) return;
    const id = window.setInterval(() => setRemaining((s) => (s <= 1 ? 3600 : s - 1)), 1000);
    return () => window.clearInterval(id);
  }, [reduced]);

  return (
    <MockWindow title="Acme Media · Signed URL" meta="HMAC-SHA256">
      <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
        <div>
          <p className="text-[11px] font-medium text-muted-foreground">Path</p>
          <div className="mt-1 flex h-8 items-center rounded-md border border-border-strong px-2.5 font-mono text-[12px] text-foreground">
            /reports/q3-earnings.pdf
          </div>
        </div>
        <div>
          <p className="text-[11px] font-medium text-muted-foreground">Expires after</p>
          <div className="mt-1 flex h-8 items-center justify-between rounded-md border border-border-strong px-2.5 text-[12px] text-foreground">
            1 hour <span className="text-muted-foreground" aria-hidden>▾</span>
          </div>
        </div>
      </div>
      <div className="mt-4 rounded-lg border border-border bg-[#14161b] p-3">
        <div className="flex items-start gap-2">
          <p className="min-w-0 flex-1 font-mono text-[11.5px] leading-relaxed break-all text-[#d7dbe2]">
            https://media.acme.com/reports/q3-earnings.pdf
            <span className="text-[#ffb36b]">?expires=</span>
            <span className="text-white">1793487600</span>
            <span className="text-[#ffb36b]">&amp;sig=</span>
            <span className="text-[#ff8fb5]">9f2c41d07a6be3e1</span>
          </p>
          <Copy className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#8b919c]" aria-hidden />
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between rounded-lg bg-primary-soft px-3 py-2 text-[12px]">
        <span className="font-medium text-primary">Link expires in</span>
        <span className="font-mono font-semibold text-primary tabular-nums" aria-live="off">
          {formatClock(remaining)}
        </span>
      </div>
      <ul className="mt-3 space-y-1.5 text-[12px]">
        <li className="flex items-center gap-2 text-foreground">
          <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden /> Valid signature
          <span className="ml-auto font-mono text-success">200 OK</span>
        </li>
        <li className="flex items-center gap-2 text-foreground">
          <XCircle className="h-3.5 w-3.5 text-destructive" aria-hidden /> Path or expiry changed
          <span className="ml-auto font-mono text-destructive">403</span>
        </li>
        <li className="flex items-center gap-2 text-foreground">
          <XCircle className="h-3.5 w-3.5 text-destructive" aria-hidden /> Link has expired
          <span className="ml-auto font-mono text-destructive">403</span>
        </li>
      </ul>
    </MockWindow>
  );
}

/* ------------------------------------------------------------------ */
/* Analytics                                                           */
/* ------------------------------------------------------------------ */

const SERIES = [32, 30, 28, 27, 29, 35, 46, 58, 66, 70, 72, 74, 71, 69, 72, 78, 84, 88, 80, 68, 56, 47, 40, 35];

function areaPath(values: number[], width: number, height: number) {
  const max = 100;
  const step = width / (values.length - 1);
  const pts = values.map((v, i) => [i * step, height - (v / max) * height] as const);
  const line = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  return { line, area: `${line} L${width} ${height} L0 ${height} Z` };
}

export function AnalyticsMockup() {
  const { line, area } = areaPath(SERIES, 320, 96);
  return (
    <MockWindow title="Analytics · All websites" meta="Last 24 hours">
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ['Requests', '18.2M', '+12%'],
          ['Bandwidth', '3.4 TB', '+8%'],
          ['Cache hit', '95.1%', '+1.3 pt'],
          ['p95 latency', '41 ms', '-6 ms'],
        ].map(([label, value, delta]) => (
          <div key={label} className="rounded-lg border border-border px-3 py-2">
            <dt className="text-[11px] text-muted-foreground">{label}</dt>
            <dd className="text-[16px] font-semibold text-foreground tabular-nums">{value}</dd>
            <dd className="text-[11px] font-medium text-success">{delta}</dd>
          </div>
        ))}
      </dl>
      <svg viewBox="0 0 320 110" className="mt-4 h-auto w-full" aria-hidden>
        <defs>
          <linearGradient id="mk-analytics-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#e8336d" stopOpacity="0.28" />
            <stop offset="1" stopColor="#e8336d" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 24, 48, 72, 96].map((y) => (
          <line key={y} x1="0" x2="320" y1={y} y2={y} stroke="#d9dce1" strokeDasharray="2 3" strokeWidth="0.6" />
        ))}
        <path d={area} fill="url(#mk-analytics-fill)" />
        <path d={line} fill="none" stroke="#d6246a" strokeWidth="1.8" strokeLinejoin="round" />
        <circle cx={(17 / 23) * 320} cy={96 - 0.88 * 96} r="3.5" fill="#fff" stroke="#d6246a" strokeWidth="1.8" />
        {['00:00', '06:00', '12:00', '18:00', '24:00'].map((t, i) => (
          <text key={t} x={i * 80} y="108" fontSize="7" fill="#5e6670" textAnchor={i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}>
            {t}
          </text>
        ))}
      </svg>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-[12px] font-medium text-foreground">Status codes</p>
          <div className="mt-2 flex h-2 overflow-hidden rounded-full" aria-hidden>
            <span className="bg-success" style={{ width: '97%' }} />
            <span className="bg-[#7aa7e8]" style={{ width: '1.6%' }} />
            <span className="bg-warning" style={{ width: '1.2%' }} />
            <span className="bg-destructive" style={{ width: '0.2%' }} />
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">2xx 97.0% · 3xx 1.6% · 4xx 1.2% · 5xx 0.2%</p>
        </div>
        <div>
          <p className="text-[12px] font-medium text-foreground">Top countries</p>
          <ul className="mt-1.5 space-y-1 text-[11px]">
            {[
              ['United States', 38],
              ['Germany', 17],
              ['Bangladesh', 11],
            ].map(([name, pct]) => (
              <li key={name} className="flex items-center gap-2">
                <span className="w-24 truncate text-foreground">{name}</span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <span className="block h-full rounded-full bg-brand-purple/70" style={{ width: `${(Number(pct) / 38) * 100}%` }} />
                </span>
                <span className="w-8 text-right text-muted-foreground tabular-nums">{pct}%</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </MockWindow>
  );
}

/* ------------------------------------------------------------------ */
/* Custom domains and TLS                                              */
/* ------------------------------------------------------------------ */

export function DomainsMockup() {
  const reduced = useReducedMotion();
  return (
    <MockWindow title="media.acme.com · Domains" meta="3 domains">
      <ul className="space-y-3 text-[12px]">
        <li className="rounded-lg border border-border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono font-medium text-foreground">media.acme.com</span>
            <Pill tone="success" className="ml-auto">
              <ShieldCheck className="h-3 w-3" aria-hidden /> Active
            </Pill>
          </div>
          <p className="mt-1.5 text-muted-foreground">TLS certificate issued by Let&apos;s Encrypt · renews automatically in 61 days</p>
        </li>
        <li className="rounded-lg border border-border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono font-medium text-foreground">static.acme.com</span>
            <Pill tone="info" className="ml-auto">
              <Loader2 className={`h-3 w-3 ${reduced ? '' : 'mk-spin'}`} aria-hidden /> Issuing certificate
            </Pill>
          </div>
          <p className="mt-1.5 text-muted-foreground">DNS verified · requesting a certificate, usually under a minute</p>
        </li>
        <li className="rounded-lg border border-dashed border-border-strong p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono font-medium text-foreground">video.acme.com</span>
            <Pill tone="warning" className="ml-auto">Waiting for DNS</Pill>
          </div>
          <p className="mt-1.5 text-muted-foreground">Add this record at your DNS provider:</p>
          <div className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md bg-muted p-2.5 font-mono text-[11.5px]">
            <span className="text-muted-foreground">Type</span>
            <span className="text-foreground">CNAME</span>
            <span className="text-muted-foreground">Name</span>
            <span className="text-foreground">video</span>
            <span className="text-muted-foreground">Target</span>
            <span className="break-all text-foreground">acme-media.cdn.rivocloud.dev</span>
          </div>
          <div className="mt-2.5 flex justify-end">
            <span className="inline-flex h-7 items-center rounded-md border border-border-strong bg-background px-2.5 text-[12px] font-medium text-foreground">
              Check again
            </span>
          </div>
        </li>
      </ul>
    </MockWindow>
  );
}

/* ------------------------------------------------------------------ */
/* Teams and security                                                  */
/* ------------------------------------------------------------------ */

const ROLES = ['Owner', 'Admin', 'Developer', 'Viewer'];
const PERMISSIONS: Array<[string, boolean[]]> = [
  ['View websites, files and analytics', [true, true, true, true]],
  ['Edit websites and cache rules', [true, true, true, false]],
  ['Purge cache', [true, true, true, false]],
  ['Upload and delete files', [true, true, true, false]],
  ['Invite members, view billing', [true, true, false, false]],
];

export function TeamsMockup() {
  return (
    <MockWindow title="Acme Media · Members and roles" meta="12 members">
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-[12px]">
          <thead className="bg-muted text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-medium">Permission</th>
              {ROLES.map((role) => (
                <th key={role} scope="col" className="px-1.5 py-2 text-center font-medium">
                  <span className="hidden sm:inline">{role}</span>
                  <span className="sm:hidden" aria-hidden>{role.slice(0, 3)}</span>
                  <span className="sr-only sm:hidden">{role}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {PERMISSIONS.map(([label, grants]) => (
              <tr key={label}>
                <th scope="row" className="px-3 py-2 text-left font-normal text-foreground">{label}</th>
                {grants.map((granted, i) => (
                  <td key={ROLES[i]} className="px-1.5 py-2 text-center">
                    {granted ? (
                      <Check className="mx-auto h-3.5 w-3.5 text-success" aria-label="Allowed" />
                    ) : (
                      <Minus className="mx-auto h-3.5 w-3.5 text-border-strong" aria-label="Not allowed" />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-border p-3">
          <p className="flex items-center gap-1.5 text-[12px] font-medium text-foreground">
            <KeyRound className="h-3.5 w-3.5 text-primary" aria-hidden /> Deploy pipeline
          </p>
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">rc_live_7Hq2····</p>
          <div className="mt-2 flex flex-wrap gap-1">
            <Pill tone="brand" className="font-mono">zone:read</Pill>
            <Pill tone="brand" className="font-mono">cache:invalidate</Pill>
          </div>
        </div>
        <div className="rounded-lg border border-border p-3">
          <p className="text-[12px] font-medium text-foreground">Audit log</p>
          <ul className="mt-1.5 space-y-1 text-[11px] text-muted-foreground">
            <li><span className="text-foreground">Jane D.</span> purged /blog/* · 2m</li>
            <li><span className="text-foreground">CI key</span> updated a cache rule · 1h</li>
            <li><span className="text-foreground">Tom B.</span> invited a viewer · 3h</li>
          </ul>
        </div>
      </div>
    </MockWindow>
  );
}
