import { FileText } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatBytes } from '@/lib/format-bytes';
import type { StorageObject } from '@/lib/types';

// A pending object has been issued an upload URL but storage hasn't confirmed the file landed yet.
const STATUS_BADGE: Record<StorageObject['status'], { label: string; variant: 'success' | 'warning' | 'destructive' }> = {
  ready: { label: 'Ready', variant: 'success' },
  pending: { label: 'Uploading', variant: 'warning' },
  deleted: { label: 'Deleted', variant: 'destructive' },
};

export function ObjectBrowser({
  objects,
  onDelete,
  onShare,
  emptyAction,
}: {
  objects: StorageObject[];
  onDelete: (key: string) => void;
  onShare?: (key: string) => void;
  emptyAction?: React.ReactNode;
}) {
  if (objects.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={FileText}
          title="No files yet"
          description="Upload a file to store it in this bucket."
          action={emptyAction}
        />
      </Card>
    );
  }

  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Key</TableHead>
            <TableHead>Size</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Uploaded</TableHead>
            <TableHead>
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {objects.map((object) => (
            <TableRow key={object.id}>
              <TableCell className="break-all font-medium">{object.key}</TableCell>
              <TableCell className="whitespace-nowrap tabular-nums">{formatBytes(object.size)}</TableCell>
              <TableCell className="text-muted-foreground">{object.contentType}</TableCell>
              <TableCell>
                <Badge variant={STATUS_BADGE[object.status].variant}>{STATUS_BADGE[object.status].label}</Badge>
              </TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">
                {new Date(object.createdAt).toLocaleDateString()}
              </TableCell>
              <TableCell>
                <div className="flex justify-end gap-2">
                  {onShare && object.status === 'ready' && (
                    <Button variant="outline" size="sm" onClick={() => onShare(object.key)}>
                      Share link
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={() => onDelete(object.key)}>
                    Delete
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
