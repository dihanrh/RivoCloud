'use client';

import { useReducedMotion } from '../use-reduced-motion';

export type ArchNode = 'visitors' | 'dns' | 'console' | 'edge' | 'l1' | 'l2' | 'origin' | 'bus' | 'edges' | 'analytics';
export type ArchLink =
  | 'visitor-edge'
  | 'visitor-dns'
  | 'dns-edge'
  | 'edge-origin'
  | 'console-edge'
  | 'console-bus'
  | 'bus-edge'
  | 'bus-edges'
  | 'edge-analytics';

const LINKS: Record<ArchLink, string> = {
  'visitor-edge': 'M120 214 C150 214 160 170 186 170',
  'visitor-dns': 'M68 160 C68 90 100 49 150 49',
  'dns-edge': 'M235 78 L235 144',
  'edge-origin': 'M408 204 L470 204',
  'console-edge': 'M480 78 C480 110 400 104 380 144',
  'console-bus': 'M448 78 L448 330 Q448 340 438 340 L408 340',
  'bus-edge': 'M290 326 L290 294',
  'bus-edges': 'M408 356 L470 356',
  'edge-analytics': 'M172 262 C110 262 80 280 80 316',
};

function Box({
  x,
  y,
  w,
  h,
  active,
  dimmed,
  title,
  sub,
  radius = 10,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  active: boolean;
  dimmed: boolean;
  title: string;
  sub?: string;
  radius?: number;
}) {
  return (
    <g style={{ opacity: dimmed ? 0.45 : 1, transition: 'opacity 250ms ease' }}>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={radius}
        fill={active ? '#fde8f0' : '#ffffff'}
        stroke={active ? '#d6246a' : '#d9dce1'}
        strokeWidth={active ? 1.6 : 1}
        style={{ transition: 'fill 250ms ease, stroke 250ms ease' }}
      />
      <text x={x + w / 2} y={sub ? y + h / 2 - 3 : y + h / 2 + 4} textAnchor="middle" fontSize="12" fontWeight="600" fill="#1d2025">
        {title}
      </text>
      {sub && (
        <text x={x + w / 2} y={y + h / 2 + 13} textAnchor="middle" fontSize="10.5" fill="#5e6670" fontFamily="ui-monospace, Menlo, Consolas, monospace">
          {sub}
        </text>
      )}
    </g>
  );
}

/**
 * Architecture of a request: visitor, DNS, edge (L1 memory and L2 Redis),
 * origin, the message bus that fans purges out to every edge, and the
 * analytics store. Pass the nodes and links to highlight.
 */
export function ArchitectureDiagram({
  activeNodes,
  activeLinks,
  label,
}: {
  activeNodes: ArchNode[];
  activeLinks: ArchLink[];
  label: string;
}) {
  const reduced = useReducedMotion();
  const on = (node: ArchNode) => activeNodes.includes(node);
  const dim = (node: ArchNode) => activeNodes.length > 0 && !on(node);

  return (
    <svg viewBox="0 0 640 392" className="block h-auto w-full" role="img" aria-label={label}>
      <defs>
        <marker id="mk-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0 0 10 5 0 10z" fill="#d6246a" />
        </marker>
        <marker id="mk-arrow-muted" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0 0 10 5 0 10z" fill="#b9bec6" />
        </marker>
        <linearGradient id="mk-edge-fill" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff7ef" />
          <stop offset="1" stopColor="#f6eefb" />
        </linearGradient>
      </defs>

      {/* Links, drawn under the boxes. */}
      {(Object.keys(LINKS) as ArchLink[]).map((key) => {
        const active = activeLinks.includes(key);
        return (
          <path
            key={key}
            d={LINKS[key]}
            fill="none"
            stroke={active ? '#d6246a' : '#c9cdd4'}
            strokeWidth={active ? 2 : 1.2}
            strokeDasharray={active ? '6 6' : '3 4'}
            markerEnd={`url(#${active ? 'mk-arrow' : 'mk-arrow-muted'})`}
            className={active && !reduced ? 'mk-dash' : undefined}
            style={{ transition: 'stroke 250ms ease' }}
          />
        );
      })}

      {/* Visitors */}
      <g style={{ opacity: dim('visitors') ? 0.45 : 1, transition: 'opacity 250ms ease' }}>
        <rect x="16" y="160" width="104" height="84" rx="12" fill={on('visitors') ? '#fde8f0' : '#fff'} stroke={on('visitors') ? '#d6246a' : '#d9dce1'} strokeWidth={on('visitors') ? 1.6 : 1} />
        {[38, 62, 86].map((cx) => (
          <g key={cx} fill={on('visitors') ? '#d6246a' : '#5e6670'}>
            <circle cx={cx} cy="190" r="6" />
            <path d={`M${cx - 10} 212 a10 10 0 0 1 20 0z`} />
          </g>
        ))}
        <text x="68" y="232" textAnchor="middle" fontSize="12" fontWeight="600" fill="#1d2025">Visitors</text>
      </g>

      <Box x={150} y={20} w={170} h={58} title="DNS" sub="CNAME to rivocloud.dev" active={on('dns')} dimmed={dim('dns')} />
      <Box x={440} y={20} w={184} h={58} title="Console and API" sub="/api/v1/zones" active={on('console')} dimmed={dim('console')} />

      {/* Edge location container */}
      <g style={{ opacity: dim('edge') && dim('l1') && dim('l2') ? 0.45 : 1, transition: 'opacity 250ms ease' }}>
        <rect x="172" y="118" width="236" height="176" rx="14" fill="url(#mk-edge-fill)" stroke={on('edge') ? '#d6246a' : '#d9dce1'} strokeWidth={on('edge') ? 1.6 : 1} />
        <text x="186" y="138" fontSize="11" fontWeight="600" fill="#5e6670">Edge location, nearest to the visitor</text>
      </g>
      <Box x={188} y={146} w={204} h={42} radius={8} title="Edge proxy" sub="TLS, signed URLs, rate limits" active={on('edge')} dimmed={dim('edge')} />
      <Box x={188} y={198} w={98} h={50} radius={8} title="L1 memory" sub="~1 ms" active={on('l1')} dimmed={dim('l1')} />
      <Box x={294} y={198} w={98} h={50} radius={8} title="L2 Redis" sub="~3 ms" active={on('l2')} dimmed={dim('l2')} />
      <text x="290" y="276" textAnchor="middle" fontSize="10" fill="#5e6670">Memory first, then Redis, then origin</text>

      <Box x={470} y={168} w={154} h={72} title="Your origin" sub="origin.example.com" active={on('origin')} dimmed={dim('origin')} />
      <Box x={172} y={326} w={236} h={44} title="Message bus" sub="config and purges, NATS" active={on('bus')} dimmed={dim('bus')} />

      {/* Other edges */}
      <g style={{ opacity: dim('edges') ? 0.45 : 1, transition: 'opacity 250ms ease' }}>
        <rect x="470" y="316" width="154" height="64" rx="12" fill={on('edges') ? '#fde8f0' : '#fff'} stroke={on('edges') ? '#d6246a' : '#d9dce1'} strokeWidth={on('edges') ? 1.6 : 1} />
        {[492, 522, 552].map((x) => (
          <rect key={x} x={x} y="328" width="22" height="16" rx="4" fill={on('edges') ? '#d6246a' : '#b9bec6'} />
        ))}
        <text x="582" y="341" fontSize="11" fill="#5e6670">+12</text>
        <text x="547" y="368" textAnchor="middle" fontSize="12" fontWeight="600" fill="#1d2025">Every other edge</text>
      </g>

      <Box x={16} y={316} w={128} h={64} title="Analytics" sub="ClickHouse" active={on('analytics')} dimmed={dim('analytics')} />
    </svg>
  );
}
