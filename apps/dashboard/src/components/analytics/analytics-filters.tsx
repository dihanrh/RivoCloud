'use client';

import { useZones } from '@/hooks/use-zones';
import type { AnalyticsQueryParams } from '@/lib/types';

const RANGE_PRESETS: Record<string, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

export type AnalyticsFilterState = AnalyticsQueryParams & { rangeKey: string };

export function AnalyticsFilters({
  params,
  onChange,
}: {
  params: AnalyticsFilterState;
  onChange: (next: AnalyticsFilterState) => void;
}) {
  const { data } = useZones();

  function setRange(rangeKey: string) {
    const to = new Date();
    const from = new Date(to.getTime() - RANGE_PRESETS[rangeKey]);
    onChange({ ...params, rangeKey, from: from.toISOString(), to: to.toISOString() });
  }

  return (
    <div className="flex items-center gap-3">
      <select
        aria-label="Zone"
        className="rounded border border-border bg-background px-2 py-1 text-sm"
        value={params.zoneId ?? ''}
        onChange={(e) => onChange({ ...params, zoneId: e.target.value || undefined })}
      >
        <option value="">All zones</option>
        {(data?.zones ?? []).map((zone) => (
          <option key={zone.id} value={zone.id}>
            {zone.name}
          </option>
        ))}
      </select>
      <select
        aria-label="Range"
        className="rounded border border-border bg-background px-2 py-1 text-sm"
        value={params.rangeKey}
        onChange={(e) => setRange(e.target.value)}
      >
        {Object.keys(RANGE_PRESETS).map((key) => (
          <option key={key} value={key}>
            {key}
          </option>
        ))}
      </select>
    </div>
  );
}
