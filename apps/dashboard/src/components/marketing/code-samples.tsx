'use client';

import { useId, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTourCommand } from './tour/tour-bus';

type Lang = 'curl' | 'js' | 'cli';
type Task = 'create' | 'purge' | 'upload';

export const LANGS: Array<{ id: Lang; label: string; preview?: boolean }> = [
  { id: 'curl', label: 'cURL' },
  { id: 'js', label: 'JavaScript', preview: true },
  { id: 'cli', label: 'CLI', preview: true },
];

export const TASKS: Array<{ id: Task; label: string }> = [
  { id: 'create', label: 'Create a website' },
  { id: 'purge', label: 'Purge the cache' },
  { id: 'upload', label: 'Upload a file' },
];

export const SNIPPETS: Record<Lang, Record<Task, string>> = {
  curl: {
    create: `curl https://api.rivocloud.dev/api/v1/zones \\
  -H "X-API-Key: $RIVO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "northwind-shop",
    "originUrl": "https://origin.northwind.com",
    "cacheTtl": 3600
  }'`,
    purge: `# Needs a key with the cache:invalidate scope
curl https://api.rivocloud.dev/api/v1/zones/$ZONE_ID/cache/invalidate \\
  -H "X-API-Key: $RIVO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "patterns": ["/products/*"], "tags": ["summer-sale"] }'

# 202 Accepted: every edge drops the matches within seconds`,
    upload: `# 1. Ask for a presigned upload URL
curl https://api.rivocloud.dev/api/v1/buckets/$BUCKET_ID/objects/upload \\
  -H "X-API-Key: $RIVO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "key": "uploads/report.pdf", "contentType": "application/pdf" }'

# 2. Send the bytes straight to storage
curl -X PUT "$UPLOAD_URL" \\
  -H "Content-Type: application/pdf" \\
  --data-binary @report.pdf`,
  },
  js: {
    create: `import { RivoCloud } from '@rivocloud/sdk';

const rivo = new RivoCloud({ apiKey: process.env.RIVO_API_KEY });

const zone = await rivo.zones.create({
  name: 'northwind-shop',
  originUrl: 'https://origin.northwind.com',
  cacheTtl: 3600,
});

console.log(zone.id);`,
    purge: `// Needs a key with the cache:invalidate scope
const job = await rivo.cache.invalidate(zoneId, {
  patterns: ['/products/*'],
  tags: ['summer-sale'],
});

console.log(job.status); // "pending", then "completed"`,
    upload: `const { uploadUrl } = await rivo.objects.createUpload(bucketId, {
  key: 'uploads/report.pdf',
  contentType: 'application/pdf',
});

// The file goes straight to storage, never through the API
await fetch(uploadUrl, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/pdf' },
  body: file,
});`,
  },
  cli: {
    create: `rivo login --api-key $RIVO_API_KEY

rivo zones create northwind-shop \\
  --origin https://origin.northwind.com \\
  --cache-ttl 1h`,
    purge: `# Purge paths and tags after a deploy
rivo cache purge northwind-shop \\
  --path "/products/*" \\
  --tag summer-sale`,
    upload: `# Uploads use a presigned URL under the hood
rivo storage cp ./report.pdf media-assets/uploads/report.pdf

rivo storage share media-assets/uploads/report.pdf --expires 15m`,
  },
};

const TOKEN = /(^\s*#.*$|^\s*\/\/.*$|\s\/\/ .*$|'[^']*'|"[^"]*"|`[^`]*`|\$[A-Z_]+|\s--?[a-z][a-z-]*)/g;

function highlight(line: string) {
  const parts = line.split(TOKEN);
  return parts.map((part, i) => {
    if (!part) return null;
    let cls = '';
    if (/^\s*(#|\/\/)/.test(part)) cls = 'text-[#8b919c] italic';
    else if (/^['"`]/.test(part)) cls = 'text-[#ffb36b]';
    else if (part.startsWith('$')) cls = 'text-[#8fc7ff]';
    else if (/^\s--?[a-z]/.test(part)) cls = 'text-[#ff8fb5]';
    return cls ? (
      <span key={i} className={cls}>
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    );
  });
}

export function CodeSamples() {
  const [lang, setLang] = useState<Lang>('curl');
  const [task, setTask] = useState<Task>('create');
  const [copied, setCopied] = useState(false);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const baseId = useId();
  const code = SNIPPETS[lang][task];

  useTourCommand('code', (next) => setLang(next));

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const onTabKey = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = -1;
    if (event.key === 'ArrowRight') next = (index + 1) % LANGS.length;
    if (event.key === 'ArrowLeft') next = (index - 1 + LANGS.length) % LANGS.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = LANGS.length - 1;
    if (next < 0) return;
    event.preventDefault();
    setLang(LANGS[next].id);
    tabRefs.current[next]?.focus();
  };

  return (
    <div data-tour="code-samples" className="overflow-hidden rounded-2xl border border-white/10 bg-[#14161b] shadow-[0_40px_80px_-40px_rgba(0,0,0,0.8)]">
      <div className="flex items-center gap-2 border-b border-white/10 px-3 sm:px-4">
        <div role="tablist" aria-label="Language" className="flex min-w-0 gap-1 overflow-x-auto">
          {LANGS.map((item, index) => {
            const selected = item.id === lang;
            return (
              <button
                key={item.id}
                ref={(node) => {
                  tabRefs.current[index] = node;
                }}
                id={`${baseId}-tab-${item.id}`}
                role="tab"
                type="button"
                aria-selected={selected}
                aria-controls={`${baseId}-panel`}
                tabIndex={selected ? 0 : -1}
                onClick={() => setLang(item.id)}
                onKeyDown={(event) => onTabKey(event, index)}
                className={cn(
                  'relative inline-flex shrink-0 items-center gap-1.5 px-2.5 py-3 sm:px-3 text-[13px] font-medium transition-colors focus-visible:outline-offset-[-2px]',
                  selected ? 'text-white' : 'text-[#9aa1ad] hover:text-white',
                )}
              >
                {item.label}
                {item.preview && (
                  <span className="hidden rounded bg-white/10 px-1.5 py-px text-[10px] font-semibold text-[#c9ced6] sm:inline">Preview</span>
                )}
                {selected && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-[#ff5c93]" aria-hidden />}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={copy}
          className="ml-auto inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-white/15 px-2.5 text-[12px] font-medium text-[#d7dbe2] transition-colors hover:bg-white/10"
          aria-label={copied ? 'Copied to clipboard' : 'Copy code'}
        >
          {copied ? <Check className="h-3.5 w-3.5 text-[#7ad09a]" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
          <span className="hidden sm:inline">{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-white/10 px-3 py-2.5 sm:px-4" role="group" aria-label="Example">
        {TASKS.map((item) => {
          const selected = item.id === task;
          return (
            <button
              key={item.id}
              type="button"
              aria-pressed={selected}
              onClick={() => setTask(item.id)}
              className={cn(
                'rounded-full px-3 py-1 text-[12px] font-medium transition-colors',
                selected ? 'bg-white text-[#14161b]' : 'text-[#b7bcc6] hover:bg-white/10 hover:text-white',
              )}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      <div id={`${baseId}-panel`} role="tabpanel" aria-labelledby={`${baseId}-tab-${lang}`} tabIndex={0} className="focus-visible:outline-offset-[-2px]">
        <pre className="min-h-[300px] overflow-x-auto p-4 font-mono text-[12.5px] leading-[1.75] text-[#e6e8ec] sm:p-5 sm:text-[13px]" data-testid="code-sample">
          <code>
            {code.split('\n').map((line, i) => (
              <span key={i} className="block">
                <span className="mr-4 inline-block w-5 text-right text-[#5b616c] select-none" aria-hidden>
                  {i + 1}
                </span>
                {highlight(line)}
                {line === '' ? '​' : null}
              </span>
            ))}
          </code>
        </pre>
      </div>
      <p className="sr-only" aria-live="polite">
        {copied ? 'Code copied to clipboard' : ''}
      </p>
    </div>
  );
}
