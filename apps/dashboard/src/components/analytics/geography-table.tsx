'use client';

import { useAnalyticsGeography } from '@/hooks/use-analytics';
import type { AnalyticsQueryParams } from '@/lib/types';
import { ShareTable } from './share-table';

let regionNames: Intl.DisplayNames | null | undefined;
function countryName(code: string): string | null {
  if (regionNames === undefined) {
    try {
      regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
    } catch {
      regionNames = null;
    }
  }
  if (!regionNames || !/^[A-Z]{2}$/.test(code)) return null;
  try {
    const name = regionNames.of(code);
    return name && name !== code ? name : null;
  } catch {
    return null;
  }
}

export function GeographyTable({ params, limit = 10 }: { params: AnalyticsQueryParams; limit?: number }) {
  const { data, isLoading, error } = useAnalyticsGeography(params);
  const countries = [...(data?.countries ?? [])].sort((a, b) => b.requests - a.requests).slice(0, limit);

  return (
    <ShareTable
      labelHeader="Country"
      loading={isLoading}
      error={!!error}
      rows={countries.map((row) => {
        const name = countryName(row.country);
        return {
          key: row.country,
          requests: row.requests,
          bytesSent: row.bytesSent,
          label: (
            <span className="flex items-center gap-2">
              <span className="w-7 shrink-0 rounded bg-muted px-1 py-0.5 text-center font-mono text-[11px] font-semibold">{row.country}</span>
              {name && <span className="min-w-0 truncate">{name}</span>}
            </span>
          ),
        };
      })}
    />
  );
}
