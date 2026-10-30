'use client';

import { useId, useState } from 'react';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

export const FAQS = [
  {
    q: 'What is a pull zone?',
    a: 'A pull zone is how RivoCloud represents one of your websites. You give it your origin URL, and our edges fetch ("pull") content from that origin the first time it is requested, then serve it from cache until it expires or you purge it. In the console we simply call it a website.',
  },
  {
    q: 'How fast is a purge?',
    a: 'Usually a second or two. When you purge a path pattern or a cache tag, the request goes onto a message bus that every edge listens to, and each edge drops the matching objects from memory and from Redis straight away. You can watch the status of each purge in the console or through the API.',
  },
  {
    q: 'How do signed URLs work?',
    a: 'Turn on signed URLs for a website and each link must carry an expiry time and an HMAC-SHA256 signature made with that website’s secret. The edge recomputes the signature before serving anything. If the path or expiry has been changed, or the time has passed, the request is refused. You can rotate the secret at any time.',
  },
  {
    q: 'Where are my files stored?',
    a: 'In S3-compatible object storage, in buckets that belong to your organization. Uploads go straight from the browser or your server to storage using short-lived presigned URLs, so file contents never pass through our API. Buckets can be public or private, and can be served through any of your websites.',
  },
  {
    q: 'Can I use my own domain, and is HTTPS included?',
    a: 'Yes. Add the domain to a website, create the CNAME record we show you, and we verify it and issue a Let’s Encrypt certificate automatically. Certificates renew on their own, so there is nothing to remember.',
  },
  {
    q: 'How do roles and API keys work?',
    a: 'Every organization has four roles: Owner, Admin, Developer and Viewer. API keys are created by a member and limited to scopes such as zone:read, cache:invalidate or storage:write, and can never do more than the person who created them. Every change, from the console or the API, is written to the audit log.',
  },
  {
    q: 'How long do you keep analytics?',
    a: 'Request-level analytics are kept for 90 days, and hourly and daily summaries for 13 months. Analytics are aggregated from every request, not sampled.',
  },
];

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  const baseId = useId();

  return (
    <ul className="divide-y divide-border border-y border-border">
      {FAQS.map((item, index) => {
        const expanded = open === index;
        const buttonId = `${baseId}-q-${index}`;
        const panelId = `${baseId}-a-${index}`;
        return (
          <li key={item.q}>
            <h3>
              <button
                id={buttonId}
                type="button"
                aria-expanded={expanded}
                aria-controls={panelId}
                onClick={() => setOpen(expanded ? null : index)}
                className="flex w-full items-center justify-between gap-6 py-5 text-left text-[17px] font-medium text-foreground transition-colors hover:text-primary"
              >
                {item.q}
                <span
                  className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border transition-transform duration-200',
                    expanded && 'rotate-45 border-primary bg-primary-soft text-primary',
                  )}
                  aria-hidden
                >
                  <Plus className="h-4 w-4" />
                </span>
              </button>
            </h3>
            <div id={panelId} role="region" aria-labelledby={buttonId} hidden={!expanded}>
              <p className="max-w-3xl pr-12 pb-6 text-[15px] leading-relaxed text-muted-foreground">{item.a}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
