'use client';

/**
 * Tabs — underline-style in-page tabs with an animated indicator and roving focus
 * (WAI-ARIA tabs pattern, automatic activation).
 *
 *   import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
 *
 *   <Tabs defaultValue="overview">            // or value={tab} onValueChange={setTab}
 *     <TabsList aria-label="Bucket sections">
 *       <TabsTrigger value="overview">Overview</TabsTrigger>
 *       <TabsTrigger value="files" count={42}>Files</TabsTrigger>
 *       <TabsTrigger value="settings" disabled>Settings</TabsTrigger>
 *     </TabsList>
 *     <TabsContent value="overview">…</TabsContent>
 *     <TabsContent value="files">…</TabsContent>
 *   </Tabs>
 *
 * Keyboard: ArrowLeft/ArrowRight move between tabs (wrapping), Home/End jump; only the
 * selected tab is in the tab order. Inactive panels are not rendered unless `forceMount`.
 */
import * as React from 'react';
import { cn } from '@/lib/utils';

interface TabsContextValue {
  value: string;
  setValue: (value: string) => void;
  baseId: string;
}

const TabsContext = React.createContext<TabsContextValue | null>(null);

function useTabs(): TabsContextValue {
  const ctx = React.useContext(TabsContext);
  if (!ctx) throw new Error('Tabs components must be used inside <Tabs>.');
  return ctx;
}

const slug = (v: string) => v.replace(/[^a-zA-Z0-9_-]/g, '_');

export interface TabsProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'defaultValue' | 'onChange'> {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
}

export function Tabs({ value: valueProp, defaultValue = '', onValueChange, className, ...props }: TabsProps) {
  const [inner, setInner] = React.useState(defaultValue);
  const value = valueProp ?? inner;
  const baseId = React.useId();
  const ctx = React.useMemo<TabsContextValue>(
    () => ({
      value,
      baseId,
      setValue: (next) => {
        if (valueProp === undefined) setInner(next);
        onValueChange?.(next);
      },
    }),
    [value, baseId, valueProp, onValueChange],
  );
  return (
    <TabsContext.Provider value={ctx}>
      <div className={cn('flex flex-col', className)} {...props} />
    </TabsContext.Provider>
  );
}

export function TabsList({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const { value } = useTabs();
  const listRef = React.useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = React.useState<{ left: number; width: number } | null>(null);

  // Track the selected tab's box so the underline can slide to it.
  React.useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const measure = () => {
      const active = list.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
      setIndicator(active ? { left: active.offsetLeft, width: active.offsetWidth } : null);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [value, children]);

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const tabs = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]:not([disabled])') ?? []);
    const index = tabs.findIndex((t) => t === document.activeElement);
    if (index === -1) return;
    let next = -1;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    if (next === -1) return;
    event.preventDefault();
    tabs[next].focus();
    tabs[next].click();
  }

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-orientation="horizontal"
      onKeyDown={onKeyDown}
      className={cn('relative flex items-center gap-1 overflow-x-auto border-b border-border [scrollbar-width:none]', className)}
      {...props}
    >
      {children}
      {indicator && (
        <span
          aria-hidden
          className="pointer-events-none absolute bottom-0 left-0 h-0.5 rounded-full bg-primary transition-[transform,width] duration-200 ease-out"
          style={{ width: indicator.width, transform: `translateX(${indicator.left}px)` }}
        />
      )}
    </div>
  );
}

export interface TabsTriggerProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'value'> {
  value: string;
  /** Optional count badge after the label. */
  count?: number;
}

export function TabsTrigger({ value, count, className, children, ...props }: TabsTriggerProps) {
  const ctx = useTabs();
  const selected = ctx.value === value;
  return (
    <button
      type="button"
      role="tab"
      id={`${ctx.baseId}-tab-${slug(value)}`}
      aria-selected={selected}
      aria-controls={`${ctx.baseId}-panel-${slug(value)}`}
      tabIndex={selected ? 0 : -1}
      data-state={selected ? 'active' : 'inactive'}
      onClick={() => ctx.setValue(value)}
      className={cn(
        'relative inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-t-md px-3 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-50 data-[state=active]:text-foreground focus-visible:outline-offset-[-2px]',
        className,
      )}
      {...props}
    >
      {children}
      {count !== undefined && (
        <span
          className={cn(
            'rounded-full px-1.5 text-[11px] font-semibold leading-[18px]',
            selected ? 'bg-primary-soft text-primary' : 'bg-muted text-muted-foreground',
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

export interface TabsContentProps extends React.HTMLAttributes<HTMLDivElement> {
  value: string;
  forceMount?: boolean;
}

export function TabsContent({ value, forceMount, className, ...props }: TabsContentProps) {
  const ctx = useTabs();
  const selected = ctx.value === value;
  if (!selected && !forceMount) return null;
  return (
    <div
      role="tabpanel"
      id={`${ctx.baseId}-panel-${slug(value)}`}
      aria-labelledby={`${ctx.baseId}-tab-${slug(value)}`}
      hidden={!selected}
      tabIndex={0}
      className={cn('pt-5 focus-visible:outline-offset-4', className)}
      {...props}
    />
  );
}
