'use client';

import { Select } from '@/components/ui/input';
import { useZones } from '@/hooks/use-zones';
import type { AnalyticsQueryParams } from '@/lib/types';

const RANGE_PRESETS: Record<string, { label: string; ms: number }> = {
  '24h': { label: 'Last 24 hours', ms: 24 * 60 * 60 * 1000 },
  '7d': { label: 'Last 7 days', ms: 7 * 24 * 60 * 60 * 1000 },
  '30d': { label: 'Last 30 days', ms: 30 * 24 * 60 * 60 * 1000 },
};

export type AnalyticsFilterState = AnalyticsQueryParams & { rangeKey: string };

export function AnalyticsFilters({
  params,
  onChange,
  showZone = true,
}: {
  params: AnalyticsFilterState;
  onChange: (next: AnalyticsFilterState) => void;
  /** Hide the website selector when the page is already scoped to one website. */
  showZone?: boolean;
}) {
  const { data } = useZones();

  function setRange(rangeKey: string) {
    const to = new Date();
    const from = new Date(to.getTime() - RANGE_PRESETS[rangeKey]!.ms);
    onChange({ ...params, rangeKey, from: from.toISOString(), to: to.toISOString() });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {showZone && (
        <Select
          aria-label="Website"
          className="w-auto min-w-44"
          value={params.zoneId ?? ''}
          onChange={(e) => onChange({ ...params, zoneId: e.target.value || undefined })}
        >
          <option value="">All websites</option>
          {(data?.zones ?? []).map((zone) => (
            <option key={zone.id} value={zone.id}>
              {zone.name}
            </option>
          ))}
        </Select>
      )}
      <Select aria-label="Range" className="w-auto" value={params.rangeKey} onChange={(e) => setRange(e.target.value)}>
        {Object.entries(RANGE_PRESETS).map(([key, preset]) => (
          <option key={key} value={key}>
            {preset.label}
          </option>
        ))}
      </Select>
    </div>
  );
}
