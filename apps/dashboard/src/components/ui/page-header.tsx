/**
 * PageHeader + SectionTitle — the top of every console page.
 *   import { PageHeader, SectionTitle, type Crumb } from '@/components/ui/page-header';
 *   <PageHeader title="Websites" description="…" crumbs={[{ label: 'Account home', href: '/dashboard' }, { label: 'Websites' }]}
 *               actions={<Button leftIcon={<Plus />}>Add a website</Button>} />
 *   <SectionTitle actions={…}>Cache rules</SectionTitle>
 */
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface Crumb {
  label: string;
  href?: string;
}

/** Breadcrumb trail + page title + optional description and primary actions. */
export function PageHeader({
  title,
  description,
  crumbs,
  actions,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  crumbs?: Crumb[];
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-6 flex flex-col gap-3', className)}>
      {crumbs && crumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-[13px] text-muted-foreground">
          {crumbs.map((crumb, i) => (
            <span key={`${crumb.label}-${i}`} className="inline-flex items-center gap-1">
              {i > 0 && <ChevronRight className="h-3.5 w-3.5" aria-hidden />}
              {crumb.href ? (
                <Link href={crumb.href} className="text-primary hover:underline">
                  {crumb.label}
                </Link>
              ) : (
                <span>{crumb.label}</span>
              )}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="mt-1 max-w-2xl text-[13px] text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

/** Section heading inside a page (between panels). */
export function SectionTitle({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-3 mt-8 flex items-center justify-between first:mt-0">
      <h2 className="text-base font-semibold">{children}</h2>
      {actions}
    </div>
  );
}
