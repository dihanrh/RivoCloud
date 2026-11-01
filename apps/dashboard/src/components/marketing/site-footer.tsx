import Link from 'next/link';
import Image from 'next/image';
import { Github, Linkedin, Twitter, Youtube } from 'lucide-react';
import { Container } from './section-heading';

const COLUMNS = [
  {
    title: 'Products',
    links: [
      ['Websites and CDN', '#products'],
      ['Object storage', '#products'],
      ['Signed URLs', '#products'],
      ['Analytics', '#products'],
    ],
  },
  {
    title: 'Developers',
    links: [
      ['API reference', '#developers'],
      ['JavaScript SDK', '#developers'],
      ['CLI', '#developers'],
      ['API keys', '#developers'],
      ['System status', '#'],
    ],
  },
  {
    title: 'Company',
    links: [
      ['About', '#'],
      ['Customers', '#use-cases'],
      ['Careers', '#'],
      ['Contact sales', '#contact'],
    ],
  },
  {
    title: 'Resources',
    links: [
      ['How it works', '#how-it-works'],
      ['Guides', '#'],
      ['Changelog', '#'],
      ['FAQ', '#faq'],
    ],
  },
  {
    title: 'Legal',
    links: [
      ['Privacy', '#'],
      ['Terms', '#'],
      ['Data processing', '#'],
      ['Security', '#'],
    ],
  },
];

const SOCIAL = [
  { label: 'RivoCloud on GitHub', icon: Github },
  { label: 'RivoCloud on X', icon: Twitter },
  { label: 'RivoCloud on LinkedIn', icon: Linkedin },
  { label: 'RivoCloud on YouTube', icon: Youtube },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-background">
      <Container className="py-14 sm:py-16">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]">
          <div>
            <Link href="/" aria-label="RivoCloud home" className="inline-block rounded-sm">
              <Image src="/brand/rivocloud-logo.png" alt="RivoCloud" width={156} height={104} />
            </Link>
            <p className="mt-4 max-w-xs text-[14px] leading-relaxed text-muted-foreground">
              CDN, object storage and analytics in one console, for teams that want fast sites without the plumbing.
            </p>
            <a
              href="#"
              className="mt-5 inline-flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-[13px] font-medium text-foreground hover:bg-muted"
            >
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full rounded-full bg-success opacity-40" aria-hidden />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-success" aria-hidden />
              </span>
              All systems operational
            </a>
          </div>
          <nav aria-label="Footer" className="grid grid-cols-2 gap-8 sm:grid-cols-3 lg:grid-cols-5">
            {COLUMNS.map((column) => (
              <div key={column.title}>
                <h2 className="text-[13px] font-semibold text-foreground">{column.title}</h2>
                <ul className="mt-4 space-y-3">
                  {column.links.map(([label, href]) => (
                    <li key={label}>
                      <a href={href} className="text-[14px] text-muted-foreground transition-colors hover:text-foreground">
                        {label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>
        <div className="mt-12 flex flex-col gap-4 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[13px] text-muted-foreground">© 2026 RivoCloud. All rights reserved.</p>
          <ul className="flex items-center gap-1">
            {SOCIAL.map(({ label, icon: Icon }) => (
              <li key={label}>
                <a
                  href="#"
                  aria-label={label}
                  className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <Icon className="h-[18px] w-[18px]" aria-hidden />
                </a>
              </li>
            ))}
          </ul>
        </div>
      </Container>
    </footer>
  );
}
