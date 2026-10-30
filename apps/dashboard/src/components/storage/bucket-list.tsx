import Link from 'next/link';
import { Boxes } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { Bucket } from '@/lib/types';

export function BucketList({ buckets, action }: { buckets: Bucket[]; action?: React.ReactNode }) {
  if (buckets.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={Boxes}
          title="No buckets yet"
          description="Create a bucket to start uploading files and sharing them with signed links."
          action={action}
        />
      </Card>
    );
  }

  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Region</TableHead>
            <TableHead>Visibility</TableHead>
            <TableHead>Created</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {buckets.map((bucket) => (
            <TableRow key={bucket.id}>
              <TableCell>
                <Link href={`/storage/${bucket.id}`} className="font-medium text-primary hover:underline">
                  {bucket.name}
                </Link>
              </TableCell>
              <TableCell>{bucket.region}</TableCell>
              <TableCell>
                <Badge variant={bucket.public ? 'warning' : 'secondary'}>{bucket.public ? 'Public' : 'Private'}</Badge>
              </TableCell>
              <TableCell className="text-muted-foreground">{new Date(bucket.createdAt).toLocaleDateString()}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
