import * as React from 'react';
import { cn } from '@/lib/utils';

// A console panel: white, hairline border, square-ish corners, no shadow.
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-[var(--radius)] border border-border bg-background', className)} {...props} />;
}
export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1 px-5 pt-5 pb-4', className)} {...props} />;
}
export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-base font-semibold leading-snug', className)} {...props} />;
}
export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-[13px] text-muted-foreground', className)} {...props} />;
}
export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 pb-5', className)} {...props} />;
}
export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex items-center gap-2 border-t border-border bg-muted px-5 py-3 rounded-b-[var(--radius)]', className)}
      {...props}
    />
  );
}

/**
 * A settings row: title + description on the left,
 * the control on the right, stacked on narrow screens.
 */
export function SettingRow({
  title,
  description,
  children,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn('flex flex-col gap-4 p-5 md:flex-row md:items-start md:justify-between', className)}>
      <div className="max-w-xl">
        <h3 className="text-base font-semibold">{title}</h3>
        {description && <p className="mt-1 text-[13px] text-muted-foreground">{description}</p>}
      </div>
      {children && <div className="shrink-0 md:min-w-64">{children}</div>}
    </Card>
  );
}
