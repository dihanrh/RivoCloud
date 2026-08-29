import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { Zone } from '@/lib/types';

export function ZoneList({ zones }: { zones: Zone[] }) {
  if (zones.length === 0) {
    return <p className="text-muted-foreground">No zones yet. Create one to start caching an origin.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Origin</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {zones.map((zone) => (
          <TableRow key={zone.id}>
            <TableCell>
              <Link href={`/zones/${zone.id}`} className="font-medium underline-offset-2 hover:underline">
                {zone.name}
              </Link>
            </TableCell>
            <TableCell>{zone.originUrl}</TableCell>
            <TableCell>
              <Badge variant={zone.enabled ? 'default' : 'secondary'}>{zone.enabled ? 'Enabled' : 'Disabled'}</Badge>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
