import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatBytes } from '@/lib/format-bytes';
import type { StorageObject } from '@/lib/types';

const STATUS_VARIANT: Record<StorageObject['status'], 'default' | 'secondary' | 'destructive'> = {
  ready: 'default',
  pending: 'secondary',
  deleted: 'destructive',
};

export function ObjectBrowser({ objects, onDelete }: { objects: StorageObject[]; onDelete: (key: string) => void }) {
  if (objects.length === 0) {
    return <p className="text-muted-foreground">No files yet. Upload one to get started.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Key</TableHead>
          <TableHead>Size</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Status</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {objects.map((object) => (
          <TableRow key={object.id}>
            <TableCell className="font-medium">{object.key}</TableCell>
            <TableCell>{formatBytes(object.size)}</TableCell>
            <TableCell>{object.contentType}</TableCell>
            <TableCell>
              <Badge variant={STATUS_VARIANT[object.status]}>{object.status}</Badge>
            </TableCell>
            <TableCell>
              <Button variant="outline" size="sm" onClick={() => onDelete(object.key)}>
                Delete
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
