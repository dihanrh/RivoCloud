'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ErrorBanner } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import {
  Sheet,
  SheetBody,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useToast } from '@/components/ui/toast';
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

const ACTION_HINT: Record<CacheRuleAction, string> = {
  cache: 'Store matching responses at the edge for the TTLs below.',
  bypass: 'Always fetch matching requests from your origin.',
  'no-store': 'Serve from your origin and tell browsers not to store the response.',
};

export interface RuleFormState {
  pattern: string;
  patternType: CacheRulePatternType;
  action: CacheRuleAction;
  edgeTtl: string;
  browserTtl: string;
  queryString: CacheRuleQueryString;
  queryWhitelist: string;
}

type RuleField = 'pattern' | 'edgeTtl' | 'browserTtl' | 'queryWhitelist';

function initialState(rule?: CacheRule): RuleFormState {
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

const TTL_ERROR = 'Enter a whole number of seconds, 0 or more.';

/**
 * Validates the form and builds the request body. On create, empty TTLs are
 * left out (use the website default); on edit they are sent as null to clear
 * an override. Errors are keyed by field.
 */
export function buildRuleInput(
  form: RuleFormState,
  mode: 'create' | 'edit',
): { input: CacheRuleInput } | { errors: Partial<Record<RuleField, string>> } {
  const errors: Partial<Record<RuleField, string>> = {};
  const pattern = form.pattern.trim();
  if (!pattern) errors.pattern = 'Enter a URL pattern.';
  else if (pattern.length > 255) errors.pattern = 'The URL pattern must be 255 characters or fewer.';
  else if (form.patternType === 'regex') {
    try {
      new RegExp(pattern);
    } catch {
      errors.pattern = 'The regular expression is not valid.';
    }
  }

  const edgeTtl = form.action === 'cache' ? parseTtl(form.edgeTtl) : null;
  const browserTtl = form.action === 'cache' ? parseTtl(form.browserTtl) : null;
  if (edgeTtl === 'invalid') errors.edgeTtl = TTL_ERROR;
  if (browserTtl === 'invalid') errors.browserTtl = TTL_ERROR;

  const whitelist = form.queryWhitelist
    .split(/[\s,]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (form.queryString === 'whitelist' && whitelist.length === 0) {
    errors.queryWhitelist = 'List at least one query parameter to include in the cache key.';
  }

  if (Object.keys(errors).length > 0 || edgeTtl === 'invalid' || browserTtl === 'invalid') return { errors };

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

/** Create a cache rule (no `rule`) or edit an existing one, in a side sheet. */
export function CacheRuleSheet({
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
  const create = useCreateCacheRule(zoneId);
  const update = useUpdateCacheRule(zoneId);
  const pending = create.isPending || update.isPending;

  return (
    <Sheet open={open} onOpenChange={(next) => (pending && !next ? undefined : onOpenChange(next))}>
      <SheetContent size="md" preventClose={pending}>
        {/* Remount the form for each open so it starts from the rule's current values. */}
        {open && (
          <CacheRuleForm
            rule={rule}
            create={create}
            update={update}
            pending={pending}
            onDone={() => onOpenChange(false)}
            newPriority={newPriority}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function CacheRuleForm({
  rule,
  create,
  update,
  pending,
  onDone,
  newPriority,
}: {
  rule?: CacheRule;
  create: ReturnType<typeof useCreateCacheRule>;
  update: ReturnType<typeof useUpdateCacheRule>;
  pending: boolean;
  onDone: () => void;
  newPriority?: number;
}) {
  const toast = useToast();
  const [form, setForm] = useState<RuleFormState>(() => initialState(rule));
  const [errors, setErrors] = useState<Partial<Record<RuleField, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);

  function set<K extends keyof RuleFormState>(key: K, value: RuleFormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    if (key in errors) setErrors((e) => ({ ...e, [key]: undefined }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    const built = buildRuleInput(form, rule ? 'edit' : 'create');
    if ('errors' in built) {
      setErrors(built.errors);
      return;
    }
    setErrors({});
    try {
      if (rule) {
        await update.mutateAsync({ ruleId: rule.id, input: built.input });
        toast.success('Cache rule saved', built.input.pattern);
      } else {
        await create.mutateAsync({ ...built.input, ...(newPriority !== undefined && { priority: newPriority }) });
        toast.success('Cache rule created', built.input.pattern);
      }
      onDone();
    } catch (err) {
      setFormError(errorMessage(err, rule ? 'Could not save the cache rule.' : 'Could not create the cache rule.'));
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col" noValidate>
      <SheetHeader>
        <SheetTitle>{rule ? 'Edit cache rule' : 'Create cache rule'}</SheetTitle>
        <SheetDescription>Rules apply to requests whose path matches the pattern. The first matching rule wins.</SheetDescription>
      </SheetHeader>
      <SheetBody>
        <Field label="URL pattern" error={errors.pattern} hint="For example /images/* or /api/v1/products.">
          <Input
            className="font-mono text-[13px]"
            placeholder="/images/*"
            value={form.pattern}
            onChange={(e) => set('pattern', e.target.value)}
            maxLength={255}
            autoFocus
            disabled={pending}
          />
        </Field>
        <Field label="Match type">
          <Select
            value={form.patternType}
            onChange={(e) => set('patternType', e.target.value as CacheRulePatternType)}
            disabled={pending}
          >
            {Object.entries(PATTERN_TYPE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Action" hint={ACTION_HINT[form.action]}>
          <Select value={form.action} onChange={(e) => set('action', e.target.value as CacheRuleAction)} disabled={pending}>
            {Object.entries(ACTION_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>

        {form.action === 'cache' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Edge TTL (seconds)" error={errors.edgeTtl} hint="Empty uses the website default.">
              <Input
                inputMode="numeric"
                placeholder="Website default"
                value={form.edgeTtl}
                onChange={(e) => set('edgeTtl', e.target.value)}
                disabled={pending}
              />
            </Field>
            <Field label="Browser TTL (seconds)" error={errors.browserTtl} hint="Empty uses the website default.">
              <Input
                inputMode="numeric"
                placeholder="Website default"
                value={form.browserTtl}
                onChange={(e) => set('browserTtl', e.target.value)}
                disabled={pending}
              />
            </Field>
          </div>
        )}

        <Field label="Query string in cache key">
          <Select
            value={form.queryString}
            onChange={(e) => set('queryString', e.target.value as CacheRuleQueryString)}
            disabled={pending}
          >
            {Object.entries(QUERY_STRING_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>

        {form.queryString === 'whitelist' && (
          <Field
            label="Query parameters to include"
            hint="Separate names with commas. Other parameters are ignored."
            error={errors.queryWhitelist}
          >
            <Input
              className="font-mono text-[13px]"
              placeholder="page, lang"
              value={form.queryWhitelist}
              onChange={(e) => set('queryWhitelist', e.target.value)}
              disabled={pending}
            />
          </Field>
        )}

        {formError && <ErrorBanner>{formError}</ErrorBanner>}
      </SheetBody>
      <SheetFooter>
        <SheetClose asChild>
          <Button type="button" variant="secondary" disabled={pending}>
            Cancel
          </Button>
        </SheetClose>
        <Button type="submit" loading={pending}>
          {rule ? 'Save rule' : 'Create rule'}
        </Button>
      </SheetFooter>
    </form>
  );
}
