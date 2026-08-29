import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { Bucket } from '@/lib/types';

export function BucketList({ buckets }: { buckets: Bucket[] }) {
  if (buckets.length === 0) {
    return <p className="text-muted-foreground">No buckets yet. Create one to start uploading files.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Region</TableHead>
          <TableHead>Visibility</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {buckets.map((bucket) => (
          <TableRow key={bucket.id}>
            <TableCell>
              <Link href={`/storage/${bucket.id}`} className="font-medium underline-offset-2 hover:underline">
                {bucket.name}
              </Link>
            </TableCell>
            <TableCell>{bucket.region}</TableCell>
            <TableCell>
              <Badge variant={bucket.public ? 'default' : 'secondary'}>{bucket.public ? 'Public' : 'Private'}</Badge>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
