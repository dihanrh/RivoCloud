import Link from 'next/link';
import { Badge, StatusDot } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { Zone } from '@/lib/types';
import { zoneHostname } from '@/lib/zone-hostname';
import { formatDate } from './format';

/** The websites table. Filtering and empty states are the caller's job. */
export function ZoneList({ zones }: { zones: Zone[] }) {
  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Website</TableHead>
            <TableHead>Origin</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Signed URLs</TableHead>
            <TableHead>Created</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {zones.map((zone) => (
            <TableRow key={zone.id}>
              <TableCell className="min-w-56">
                <Link href={`/zones/${zone.id}`} className="font-medium text-primary hover:underline">
                  {zone.name}
                </Link>
                <p className="mt-0.5 break-all font-mono text-xs text-muted-foreground">{zoneHostname(zone)}</p>
              </TableCell>
              <TableCell className="max-w-72 truncate" title={zone.originUrl}>
                {zone.originUrl}
              </TableCell>
              <TableCell>
                <StatusDot tone={zone.enabled ? 'success' : 'muted'}>{zone.enabled ? 'Active' : 'Paused'}</StatusDot>
              </TableCell>
              <TableCell>
                {zone.signedUrlsRequired ? (
                  <Badge variant="default">Required</Badge>
                ) : (
                  <span className="text-muted-foreground">Off</span>
                )}
              </TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(zone.createdAt)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
