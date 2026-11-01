/** Small, on-brand illustrations for the use-case cards. Decorative only. */

const frame = { fill: '#ffffff', stroke: '#d9dce1' };

export function StoreArt() {
  return (
    <svg viewBox="0 0 320 168" className="h-auto w-full" aria-hidden>
      <rect x="24" y="18" width="272" height="136" rx="12" {...frame} />
      <rect x="24" y="18" width="272" height="26" rx="12" fill="#f6f7f9" />
      <rect x="24" y="36" width="272" height="8" fill="#f6f7f9" />
      <rect x="40" y="27" width="64" height="8" rx="4" fill="#d9dce1" />
      <rect x="250" y="25" width="32" height="12" rx="6" fill="#d6246a" />
      {[0, 1, 2].map((i) => {
        const x = 40 + i * 84;
        return (
          <g key={i}>
            <rect x={x} y="56" width="72" height="54" rx="8" fill={['#fff1e3', '#fde8f0', '#efe8f7'][i]} />
            <circle cx={x + 36} cy="80" r="13" fill={['#f7931e', '#e8336d', '#5b2a8c'][i]} fillOpacity="0.8" />
            <rect x={x} y="118" width="50" height="7" rx="3.5" fill="#d9dce1" />
            <rect x={x} y="131" width="28" height="9" rx="4.5" fill="#1d2025" />
          </g>
        );
      })}
      <g transform="translate(244 98)">
        <rect width="62" height="26" rx="13" fill="#1d2025" />
        <path d="M17 6 11 14h5l-2 7 7-9h-5l2-6z" fill="#ffb36b" />
        <text x="27" y="17" fontSize="10" fontWeight="600" fill="#fff">HIT</text>
      </g>
    </svg>
  );
}

export function MediaArt() {
  return (
    <svg viewBox="0 0 320 168" className="h-auto w-full" aria-hidden>
      <rect x="24" y="18" width="272" height="136" rx="12" {...frame} />
      <rect x="40" y="32" width="150" height="88" rx="8" fill="#1d2025" />
      <defs>
        <linearGradient id="mk-media-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f7931e" />
          <stop offset="0.55" stopColor="#e8336d" />
          <stop offset="1" stopColor="#5b2a8c" />
        </linearGradient>
      </defs>
      <rect x="40" y="32" width="150" height="88" rx="8" fill="url(#mk-media-grad)" fillOpacity="0.85" />
      <circle cx="115" cy="76" r="16" fill="#ffffff" fillOpacity="0.92" />
      <path d="M110 68v16l13-8z" fill="#d6246a" />
      <rect x="40" y="128" width="150" height="4" rx="2" fill="#e2e4e8" />
      <rect x="40" y="128" width="92" height="4" rx="2" fill="#d6246a" />
      <rect x="204" y="34" width="76" height="8" rx="4" fill="#1d2025" />
      <rect x="204" y="50" width="70" height="6" rx="3" fill="#d9dce1" />
      <rect x="204" y="62" width="62" height="6" rx="3" fill="#d9dce1" />
      <rect x="204" y="80" width="76" height="40" rx="6" fill="#fff1e3" />
      <rect x="204" y="128" width="54" height="6" rx="3" fill="#d9dce1" />
      <g transform="translate(206 90)">
        <rect width="72" height="20" rx="10" fill="#ffffff" stroke="#f7931e" />
        <text x="36" y="13.5" textAnchor="middle" fontSize="9" fontWeight="600" fill="#9a5b00">tag: article-42</text>
      </g>
    </svg>
  );
}

export function SaasArt() {
  return (
    <svg viewBox="0 0 320 168" className="h-auto w-full" aria-hidden>
      <rect x="24" y="18" width="272" height="136" rx="12" {...frame} />
      <rect x="24" y="18" width="62" height="136" rx="12" fill="#f6f7f9" />
      <rect x="74" y="18" width="12" height="136" fill="#f6f7f9" />
      {[38, 56, 74, 92].map((y, i) => (
        <rect key={y} x="36" y={y} width={i === 0 ? 38 : 30} height="7" rx="3.5" fill={i === 0 ? '#d6246a' : '#d9dce1'} />
      ))}
      <circle cx="122" cy="52" r="18" fill="#efe8f7" />
      <circle cx="122" cy="47" r="7" fill="#5b2a8c" fillOpacity="0.7" />
      <path d="M109 64a13 11 0 0 1 26 0z" fill="#5b2a8c" fillOpacity="0.7" />
      <rect x="150" y="40" width="90" height="8" rx="4" fill="#1d2025" />
      <rect x="150" y="54" width="120" height="6" rx="3" fill="#d9dce1" />
      <rect x="104" y="84" width="176" height="56" rx="8" fill="#f6f7f9" stroke="#e2e4e8" />
      <rect x="116" y="96" width="20" height="24" rx="3" fill="#ffffff" stroke="#b9bec6" />
      <rect x="146" y="98" width="86" height="6" rx="3" fill="#1d2025" />
      <rect x="146" y="110" width="60" height="5" rx="2.5" fill="#b9bec6" />
      <g transform="translate(146 122)">
        <rect width="118" height="12" rx="6" fill="#fde8f0" />
        <text x="8" y="9" fontSize="7.5" fontWeight="600" fill="#b51b58">Signed link · expires 15 min</text>
      </g>
    </svg>
  );
}

export function DeveloperArt() {
  return (
    <svg viewBox="0 0 320 168" className="h-auto w-full" aria-hidden>
      <rect x="24" y="18" width="272" height="136" rx="12" fill="#14161b" />
      <circle cx="42" cy="34" r="4" fill="#3a3f48" />
      <circle cx="56" cy="34" r="4" fill="#3a3f48" />
      <circle cx="70" cy="34" r="4" fill="#3a3f48" />
      <g fontFamily="ui-monospace, Menlo, Consolas, monospace" fontSize="10">
        <text x="40" y="62" fill="#8b919c">$</text>
        <text x="52" y="62" fill="#ffffff">curl -X POST</text>
        <text x="130" y="62" fill="#ff8fb5">…/cache/invalidate</text>
        <text x="52" y="78" fill="#ffb36b">-H "X-API-Key: rc_live_…"</text>
        <text x="52" y="94" fill="#d7dbe2">-d {'\'{"patterns":["/docs/*"]}\''}</text>
        <text x="40" y="118" fill="#7ad09a">202 Accepted</text>
        <text x="40" y="134" fill="#8b919c">{'{ "status": "pending", "edges": 15 }'}</text>
      </g>
    </svg>
  );
}
