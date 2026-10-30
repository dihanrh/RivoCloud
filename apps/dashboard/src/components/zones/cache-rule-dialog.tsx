'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ErrorBanner } from '@/components/ui/empty-state';
import { Input, Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCreateCacheRule, useUpdateCacheRule } from '@/hooks/use-cache-rules';
import { errorMessage } from '@/lib/http';
import type {
  CacheRule,
  CacheRuleAction,
  CacheRuleInput,
  CacheRulePatternType,
  CacheRuleQueryString,
} from '@/lib/types';

export const PATTERN_TYPE_LABEL: Record<CacheRulePatternType, string> = {
  glob: 'Wildcard',
  regex: 'Regular expression',
  exact: 'Exact path',
};

export const ACTION_LABEL: Record<CacheRuleAction, string> = {
  cache: 'Cache',
  bypass: 'Bypass cache',
  'no-store': 'Do not store',
};

export const QUERY_STRING_LABEL: Record<CacheRuleQueryString, string> = {
  strip_all: 'Ignore query string',
  whitelist: 'Include selected parameters',
  include_all: 'Include full query string',
};

interface FormState {
  pattern: string;
  patternType: CacheRulePatternType;
  action: CacheRuleAction;
  edgeTtl: string;
  browserTtl: string;
  queryString: CacheRuleQueryString;
  queryWhitelist: string;
}

function initialState(rule?: CacheRule): FormState {
  return {
    pattern: rule?.pattern ?? '',
    patternType: rule?.patternType ?? 'glob',
    action: rule?.action ?? 'cache',
    edgeTtl: rule?.edgeTtl != null ? String(rule.edgeTtl) : '',
    browserTtl: rule?.browserTtl != null ? String(rule.browserTtl) : '',
    queryString: rule?.queryString ?? 'strip_all',
    queryWhitelist: rule?.queryWhitelist.join(', ') ?? '',
  };
}

function parseTtl(value: string): number | null | 'invalid' {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (!/^\d+$/.test(trimmed)) return 'invalid';
  return Number(trimmed);
}

/**
 * Validates the form and builds the request body. On create, empty TTLs are
 * left out (use the website default); on edit they are sent as null to clear
 * an override.
 */
export function buildRuleInput(
  form: FormState,
  mode: 'create' | 'edit',
): { input: CacheRuleInput } | { error: string } {
  const pattern = form.pattern.trim();
  if (!pattern) return { error: 'Enter a URL pattern.' };
  if (pattern.length > 255) return { error: 'The URL pattern must be 255 characters or fewer.' };
  if (form.patternType === 'regex') {
    try {
      new RegExp(pattern);
    } catch {
      return { error: 'The regular expression is not valid.' };
    }
  }

  const edgeTtl = form.action === 'cache' ? parseTtl(form.edgeTtl) : null;
  const browserTtl = form.action === 'cache' ? parseTtl(form.browserTtl) : null;
  if (edgeTtl === 'invalid' || browserTtl === 'invalid') {
    return { error: 'TTLs must be whole numbers of seconds, 0 or more.' };
  }

  const whitelist = form.queryWhitelist
    .split(/[\s,]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (form.queryString === 'whitelist' && whitelist.length === 0) {
    return { error: 'List at least one query parameter to include in the cache key.' };
  }

  const input: CacheRuleInput = {
    pattern,
    patternType: form.patternType,
    action: form.action,
    queryString: form.queryString,
    queryWhitelist: form.queryString === 'whitelist' ? whitelist : [],
  };
  if (mode === 'edit') {
    input.edgeTtl = edgeTtl;
    input.browserTtl = browserTtl;
  } else {
    if (edgeTtl !== null) input.edgeTtl = edgeTtl;
    if (browserTtl !== null) input.browserTtl = browserTtl;
  }
  return { input };
}

/** Create a cache rule (no `rule`) or edit an existing one. */
export function CacheRuleDialog({
  zoneId,
  rule,
  open,
  onOpenChange,
  newPriority,
}: {
  zoneId: string;
  rule?: CacheRule;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Priority for a new rule; the caller places it last in the list. */
  newPriority?: number;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        {/* Remount the form for each open so it starts from the rule's current values. */}
        {open && <CacheRuleForm zoneId={zoneId} rule={rule} onDone={() => onOpenChange(false)} newPriority={newPriority} />}
      </DialogContent>
    </Dialog>
  );
}

function CacheRuleForm({
  zoneId,
  rule,
  onDone,
  newPriority,
}: {
  zoneId: string;
  rule?: CacheRule;
  onDone: () => void;
  newPriority?: number;
}) {
  const [form, setForm] = useState<FormState>(() => initialState(rule));
  const [error, setError] = useState<string | null>(null);
  const create = useCreateCacheRule(zoneId);
  const update = useUpdateCacheRule(zoneId);
  const pending = create.isPending || update.isPending;

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const built = buildRuleInput(form, rule ? 'edit' : 'create');
    if ('error' in built) {
      setError(built.error);
      return;
    }
    try {
      if (rule) {
        await update.mutateAsync({ ruleId: rule.id, input: built.input });
      } else {
        await create.mutateAsync({ ...built.input, ...(newPriority !== undefined && { priority: newPriority }) });
      }
      onDone();
    } catch (err) {
      setError(errorMessage(err, rule ? 'Could not save the cache rule.' : 'Could not create the cache rule.'));
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{rule ? 'Edit cache rule' : 'Create cache rule'}</DialogTitle>
        <DialogDescription>Rules apply to requests whose path matches the pattern. The first matching rule wins.</DialogDescription>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rule-pattern">URL pattern</Label>
            <Input
              id="rule-pattern"
              className="font-mono text-[13px]"
              placeholder="/images/*"
              value={form.pattern}
              onChange={(e) => set('pattern', e.target.value)}
              maxLength={255}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rule-pattern-type">Match type</Label>
            <Select
              id="rule-pattern-type"
              value={form.patternType}
              onChange={(e) => set('patternType', e.target.value as CacheRulePatternType)}
            >
              {Object.entries(PATTERN_TYPE_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rule-action">Action</Label>
          <Select id="rule-action" value={form.action} onChange={(e) => set('action', e.target.value as CacheRuleAction)}>
            {Object.entries(ACTION_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>

        {form.action === 'cache' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rule-edge-ttl">Edge TTL (seconds)</Label>
              <Input
                id="rule-edge-ttl"
                inputMode="numeric"
                placeholder="Website default"
                value={form.edgeTtl}
                onChange={(e) => set('edgeTtl', e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rule-browser-ttl">Browser TTL (seconds)</Label>
              <Input
                id="rule-browser-ttl"
                inputMode="numeric"
                placeholder="Website default"
                value={form.browserTtl}
                onChange={(e) => set('browserTtl', e.target.value)}
              />
            </div>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rule-query-string">Query string in cache key</Label>
          <Select
            id="rule-query-string"
            value={form.queryString}
            onChange={(e) => set('queryString', e.target.value as CacheRuleQueryString)}
          >
            {Object.entries(QUERY_STRING_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>

        {form.queryString === 'whitelist' && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rule-query-whitelist">Query parameters to include</Label>
            <Input
              id="rule-query-whitelist"
              className="font-mono text-[13px]"
              placeholder="page, lang"
              value={form.queryWhitelist}
              onChange={(e) => set('queryWhitelist', e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Separate names with commas. Other parameters are ignored.</p>
          </div>
        )}

        {error && <ErrorBanner>{error}</ErrorBanner>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving…' : rule ? 'Save rule' : 'Create rule'}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
