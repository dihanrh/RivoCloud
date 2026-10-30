'use client';

/**
 * Dev-only gallery of every console primitive, rendered at /ui-preview (404 in production).
 * Use it as the visual reference when migrating pages, and add new primitives here.
 */
import * as React from 'react';
import { Copy, Database, ExternalLink, Globe, Pencil, Plus, Search, Settings, Trash2, Upload } from 'lucide-react';
import { formatBytes, formatCompact, formatDuration, formatNumber, formatPercent } from '@/lib/format';
import { Badge, StatusDot } from './badge';
import { Button } from './button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, SettingRow } from './card';
import { Checkbox } from './checkbox';
import { ConfirmDialog } from './confirm-dialog';
import { CopyButton } from './copy-button';
import { DataTable, RowActionsMenu, TablePrimaryLink, TableToolbar, type DataTableColumn } from './data-table';
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogForm,
  DialogHeader,
  DialogTitle,
} from './dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, MenuItem, MenuLabel, MenuSeparator } from './dropdown-menu';
import { EmptyState, ErrorBanner } from './empty-state';
import { Field } from './field';
import { Input, Select, Textarea } from './input';
import { PageHeader, SectionTitle } from './page-header';
import { RelativeTime } from './relative-time';
import { Sheet, SheetBody, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from './sheet';
import { Skeleton, TableSkeleton } from './skeleton';
import { Switch } from './switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs';
import { useToast } from './toast';
import { Tooltip } from './tooltip';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Row {
  id: string;
  name: string;
  origin: string;
  status: 'active' | 'paused';
  requests: number;
  updatedAt: string;
}

const ROWS: Row[] = [
  { id: 'z1', name: 'acme.com', origin: 'https://origin.acme.com', status: 'active', requests: 1_284_000, updatedAt: new Date(Date.now() - 3 * 60_000).toISOString() },
  { id: 'z2', name: 'shop.acme.com', origin: 'https://shop-origin.acme.com', status: 'active', requests: 312_400, updatedAt: new Date(Date.now() - 5 * 3_600_000).toISOString() },
  { id: 'z3', name: 'static.acme.com', origin: 'https://static.acme.com', status: 'paused', requests: 0, updatedAt: new Date(Date.now() - 4 * 86_400_000).toISOString() },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10 first:mt-0">
      <SectionTitle>{title}</SectionTitle>
      <Card className="p-5">{children}</Card>
    </section>
  );
}

export function UiPreview() {
  const toast = useToast();
  const [search, setSearch] = React.useState('');
  const [tableState, setTableState] = React.useState<'data' | 'loading' | 'empty' | 'error'>('data');
  const [enabled, setEnabled] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [checked, setChecked] = React.useState(true);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [name, setName] = React.useState('');
  const [nameError, setNameError] = React.useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [failNext, setFailNext] = React.useState(true);
  const [loadingBtn, setLoadingBtn] = React.useState(false);

  const filtered = ROWS.filter((r) => r.name.includes(search.toLowerCase()));
  const columns: DataTableColumn<Row>[] = [
    { id: 'name', header: 'Website', cell: (r) => <TablePrimaryLink href={`/ui-preview#${r.id}`} sub={r.origin}>{r.name}</TablePrimaryLink> },
    {
      id: 'status',
      header: 'Status',
      cell: (r) => <StatusDot tone={r.status === 'active' ? 'success' : 'muted'}>{r.status === 'active' ? 'Active' : 'Paused'}</StatusDot>,
      hideBelow: 'sm',
    },
    { id: 'requests', header: 'Requests (24h)', cell: (r) => formatCompact(r.requests), align: 'right', hideBelow: 'md' },
    { id: 'updated', header: 'Updated', cell: (r) => <RelativeTime value={r.updatedAt} className="text-muted-foreground" />, align: 'right' },
  ];

  async function save(next: boolean) {
    setSaving(true);
    await sleep(900);
    setEnabled(next);
    setSaving(false);
    toast.success(next ? 'Website resumed' : 'Website paused');
  }

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setNameError('Enter a bucket name.');
      return;
    }
    setNameError(null);
    setCreating(true);
    await sleep(1200);
    setCreating(false);
    setDialogOpen(false);
    toast.success('Bucket created', `${name} is ready for uploads.`);
    setName('');
  }

  return (
    <div>
      <PageHeader
        title="UI preview"
        description="Every console primitive in one place. Development builds only."
        crumbs={[{ label: 'Account home', href: '/dashboard' }, { label: 'UI preview' }]}
        actions={
          <>
            <Button variant="secondary" leftIcon={<Upload />}>
              Import
            </Button>
            <Button leftIcon={<Plus />}>Add a website</Button>
          </>
        }
      />

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-2">
          <Button>Default</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
          <Button variant="destructive-outline">Destructive outline</Button>
          <Button variant="link">Link</Button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button size="sm">Small</Button>
          <Button>Default</Button>
          <Button size="lg">Large</Button>
          <Tooltip content="Edit">
            <Button size="icon" variant="secondary" aria-label="Edit">
              <Pencil />
            </Button>
          </Tooltip>
          <Tooltip content="Settings" shortcut="G S">
            <Button size="icon-sm" variant="ghost" aria-label="Settings">
              <Settings />
            </Button>
          </Tooltip>
          <Button leftIcon={<Plus />}>Left icon</Button>
          <Button variant="secondary" rightIcon={<ExternalLink />}>
            Right icon
          </Button>
          <Button
            loading={loadingBtn}
            onClick={async () => {
              setLoadingBtn(true);
              await sleep(1500);
              setLoadingBtn(false);
            }}
          >
            Click to load
          </Button>
          <Button variant="secondary" loading>
            Saving
          </Button>
          <Button disabled>Disabled</Button>
        </div>
      </Section>

      <Section title="Form controls">
        <div className="grid gap-5 md:grid-cols-2">
          <Field label="Website name" hint="The domain visitors use.">
            <Input placeholder="example.com" />
          </Field>
          <Field label="Origin" error="Enter a URL starting with https://">
            <Input defaultValue="origin.acme" />
          </Field>
          <Field label="Search">
            <Input leftIcon={<Search />} placeholder="Search websites" />
          </Field>
          <Field label="Subdomain" optional>
            <Input leftAddon="https://" rightAddon=".rivo.app" placeholder="assets" />
          </Field>
          <Field label="Region">
            <Select defaultValue="eu">
              <option value="eu">Europe (Frankfurt)</option>
              <option value="us">United States (Virginia)</option>
            </Select>
          </Field>
          <Field label="Rule (JSON)" hint="Monospace for config.">
            <Textarea defaultValue={'{ "ttl": 3600 }'} className="min-h-16" />
          </Field>
          <div className="flex flex-col gap-3">
            <Checkbox label="Public bucket" description="Anyone with a link can read files." checked={checked} onCheckedChange={setChecked} />
            <Checkbox label="Indeterminate" indeterminate onChange={() => {}} />
            <Checkbox label="Disabled" disabled />
          </div>
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <Switch checked={enabled} onCheckedChange={(v) => void save(v)} loading={saving} label="Serve traffic" />
              <span className="text-[13px]">Serve traffic (saves with a toast)</span>
            </div>
            <div className="flex items-center gap-3">
              <Switch size="sm" checked={false} label="Small" />
              <span className="text-[13px]">Small switch</span>
            </div>
            <div className="flex items-center gap-3">
              <Switch checked disabled label="Disabled" />
              <span className="text-[13px]">Disabled</span>
            </div>
          </div>
        </div>
      </Section>

      <Section title="Badges, copy, time, formatting">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>Default</Badge>
          <Badge variant="secondary">Secondary</Badge>
          <Badge variant="success">Active</Badge>
          <Badge variant="warning">Pending DNS</Badge>
          <Badge variant="destructive">Error</Badge>
          <Badge variant="outline">Outline</Badge>
          <StatusDot tone="success">Live</StatusDot>
          <StatusDot tone="muted">Paused</StatusDot>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-4 text-[13px]">
          <span className="flex items-center gap-1 font-mono">
            acme-1a2b3c4d.cdn.rivocloud.dev <CopyButton value="acme-1a2b3c4d.cdn.rivocloud.dev" label="Copy hostname" />
          </span>
          <CopyButton value="rk_live_123" label="Copy key" variant="secondary" showLabel />
          <span>
            Updated <RelativeTime value={ROWS[0].updatedAt} />
          </span>
          <span className="text-muted-foreground">
            {formatBytes(1_536_000)} · {formatNumber(1234567)} · {formatCompact(3_400_000)} · {formatPercent(0.873)} · {formatDuration(1500)}
          </span>
        </div>
      </Section>

      <Section title="Tabs">
        <Tabs defaultValue="overview">
          <TabsList aria-label="Bucket sections">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="files" count={42}>
              Files
            </TabsTrigger>
            <TabsTrigger value="access">Access</TabsTrigger>
            <TabsTrigger value="settings" disabled>
              Settings
            </TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="text-[13px] text-muted-foreground">
            Overview content. Use ← → to move between tabs.
          </TabsContent>
          <TabsContent value="files" className="text-[13px] text-muted-foreground">
            42 files.
          </TabsContent>
          <TabsContent value="access" className="text-[13px] text-muted-foreground">
            Access rules.
          </TabsContent>
        </Tabs>
      </Section>

      <Section title="Menus, dialogs, sheets, toasts">
        <div className="flex flex-wrap items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary">Open menu</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <MenuLabel>acme.com</MenuLabel>
              <MenuItem icon={<ExternalLink />}>Open</MenuItem>
              <MenuItem icon={<Copy />} shortcut="⌘C">
                Copy hostname
              </MenuItem>
              <MenuItem icon={<Pencil />} disabled>
                Rename
              </MenuItem>
              <MenuSeparator />
              <MenuItem icon={<Trash2 />} tone="destructive" onSelect={() => setConfirmOpen(true)}>
                Delete website…
              </MenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="secondary" onClick={() => setDialogOpen(true)}>
            Open dialog
          </Button>
          <Button variant="secondary" onClick={() => setSheetOpen(true)}>
            Open sheet
          </Button>
          <Button variant="destructive-outline" onClick={() => setConfirmOpen(true)}>
            Delete website
          </Button>
          <label className="ml-1 flex items-center gap-2 text-[13px] text-muted-foreground">
            <Checkbox checked={failNext} onCheckedChange={setFailNext} /> next delete fails
          </label>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button variant="ghost" onClick={() => toast.success('Bucket created', 'media-assets is ready for uploads.')}>
            Success toast
          </Button>
          <Button variant="ghost" onClick={() => toast.error('Could not purge cache', 'The origin did not respond.')}>
            Error toast
          </Button>
          <Button variant="ghost" onClick={() => toast.info('Purge queued', 'It can take up to a minute.')}>
            Info toast
          </Button>
        </div>
      </Section>

      <Section title="Data table">
        <div className="mb-3 flex flex-wrap gap-2">
          {(['data', 'loading', 'empty', 'error'] as const).map((s) => (
            <Button key={s} size="sm" variant={tableState === s ? 'default' : 'secondary'} onClick={() => setTableState(s)}>
              {s}
            </Button>
          ))}
        </div>
        <DataTable
          aria-label="Websites"
          columns={columns}
          rows={tableState === 'empty' ? [] : filtered}
          getRowKey={(r) => r.id}
          loading={tableState === 'loading'}
          error={tableState === 'error' ? 'Could not load websites.' : null}
          onRetry={() => setTableState('data')}
          empty={
            <EmptyState
              icon={Globe}
              title="No websites yet"
              description="Add a website to start caching and protecting it."
              action={<Button leftIcon={<Plus />}>Add a website</Button>}
            />
          }
          emptyFiltered={search ? <EmptyState title="No matching websites" description={`Nothing matches “${search}”.`} /> : undefined}
          rowActions={(r) => (
            <RowActionsMenu label={`Actions for ${r.name}`}>
              <MenuItem icon={<ExternalLink />}>Open</MenuItem>
              <MenuItem icon={<Copy />}>Copy hostname</MenuItem>
              <MenuSeparator />
              <MenuItem icon={<Trash2 />} tone="destructive" onSelect={() => setConfirmOpen(true)}>
                Delete…
              </MenuItem>
            </RowActionsMenu>
          )}
          toolbar={
            <TableToolbar
              search={search}
              onSearchChange={setSearch}
              searchPlaceholder="Search websites"
              count={filtered.length}
              noun="website"
              filters={
                <Select className="h-8 w-36" aria-label="Status" defaultValue="all">
                  <option value="all">All statuses</option>
                  <option value="active">Active</option>
                  <option value="paused">Paused</option>
                </Select>
              }
              actions={
                <Button size="sm" leftIcon={<Plus />}>
                  Add a website
                </Button>
              }
            />
          }
        />
      </Section>

      <Section title="Empty, error, setting rows, skeletons">
        <div className="flex flex-col gap-4">
          <ErrorBanner>Could not load members. Check your connection and try again.</ErrorBanner>
          <SettingRow title="Always use HTTPS" description="Redirect every HTTP request to HTTPS.">
            <div className="flex justify-end">
              <Switch checked label="Always use HTTPS" />
            </div>
          </SettingRow>
          <Card>
            <CardHeader>
              <CardTitle>Card title</CardTitle>
              <CardDescription>Card description.</CardDescription>
            </CardHeader>
            <CardContent>
              <EmptyState icon={Database} title="No buckets yet" description="Create a bucket to store files." action={<Button size="sm">Create bucket</Button>} />
            </CardContent>
          </Card>
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-4 w-72" />
          </div>
          <Card>
            <TableSkeleton rows={3} columns={4} />
          </Card>
        </div>
      </Section>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent preventClose={creating}>
          <DialogForm onSubmit={create} noValidate>
            <DialogHeader>
              <DialogTitle>Create bucket</DialogTitle>
              <DialogDescription>Buckets hold files you serve through the CDN.</DialogDescription>
            </DialogHeader>
            <DialogBody>
              <Field label="Bucket name" hint="Lowercase letters, numbers and dashes." error={nameError}>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="media-assets" autoFocus />
              </Field>
              <Field label="Region">
                <Select defaultValue="eu">
                  <option value="eu">Europe (Frankfurt)</option>
                  <option value="us">United States (Virginia)</option>
                </Select>
              </Field>
              <Checkbox label="Public bucket" description="Anyone with a link can read files." />
            </DialogBody>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="secondary" disabled={creating}>
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" loading={creating}>
                Create bucket
              </Button>
            </DialogFooter>
          </DialogForm>
        </DialogContent>
      </Dialog>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent>
          <form
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(e) => {
              e.preventDefault();
              setSheetOpen(false);
              toast.success('Cache rule saved');
            }}
          >
            <SheetHeader>
              <SheetTitle>Add cache rule</SheetTitle>
              <SheetDescription>Long forms use a sheet instead of a dialog.</SheetDescription>
            </SheetHeader>
            <SheetBody>
              {['Path pattern', 'Edge TTL', 'Browser TTL', 'Query string', 'Cookies', 'Headers', 'Bypass on'].map((label) => (
                <Field key={label} label={label}>
                  <Input />
                </Field>
              ))}
            </SheetBody>
            <SheetFooter>
              <SheetClose asChild>
                <Button type="button" variant="secondary">
                  Cancel
                </Button>
              </SheetClose>
              <Button type="submit">Save rule</Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        tone="destructive"
        title="Delete website"
        description={
          <>
            This permanently deletes <span className="font-semibold text-foreground">acme.com</span>, its cache rules and custom domains.
            Traffic to it stops immediately.
          </>
        }
        confirmLabel="Delete website"
        requireText="acme.com"
        successToast="Website deleted"
        onConfirm={async () => {
          await sleep(1000);
          if (failNext) {
            setFailNext(false);
            throw new Error('The website still has an active custom domain. Remove it first.');
          }
        }}
      />
    </div>
  );
}
