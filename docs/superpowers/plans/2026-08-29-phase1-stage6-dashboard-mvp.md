# Phase 1 — Stage 6: Dashboard MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `apps/dashboard` (Next.js 15) covering exactly EDD §11 steps 6.1–6.3 — login/register, zone management (create/list/detail), and storage management (bucket list/object browser/upload) — so a logged-in user can create an organization, spin up a CDN zone, and upload a file to a bucket, entirely through the browser, calling Identity/CDN/Storage Service through same-origin Next.js Route Handlers.

**Architecture:** A new Control Plane app, `apps/dashboard`, owns zero data of its own. Every page is a Next.js App Router route; the browser never calls Identity/CDN/Storage Service directly (none of them send CORS headers — confirmed by reading each service's `main.ts`). Instead, Client Components call same-origin Route Handlers under `src/app/api/**`, which read the caller's session from httpOnly cookies, forward the request to the right backend with `Authorization: Bearer <jwt>`, and return the JSON response — the exact "browser → Next.js server → backend microservice" hop the EDD (§2.9) and the dashboard concept doc (§3) describe. Backend tokens come back as JSON (not cookies — confirmed no cookie code exists in `identity-service`), so the dashboard's own Route Handlers are what turn them into httpOnly cookies.

**Tech Stack:** Next.js 15 (App Router), React 19, Tailwind CSS 4 + hand-written shadcn/ui-style primitives (Button, Input, Label, Card, Badge, Table, Dialog, Skeleton), TanStack Query v5, Zod, Vitest + Testing Library (jsdom) for tests. No `@rivocloud/config`/`@rivocloud/db` dependency (see Design Decision 2).

**Spec:**
- [`docs/superpowers/specs/2026-07-25-revocloud-phase1-prd.md`](../specs/2026-07-25-revocloud-phase1-prd.md) — Section 5.10 (Functional Requirements), Section 7 (Roadmap, Stage 6)
- [`docs/superpowers/specs/2026-06-29-revocloud-phase1-cdn-edd.md`](../specs/2026-06-29-revocloud-phase1-cdn-edd.md) — Section 2.9 (Dashboard design), Section 7 (REST API), Section 11.6 (6.1/6.2/6.3 development order)
- [`docs/concepts/dashboard-and-frontend.md`](../../concepts/dashboard-and-frontend.md) — the beginner walkthrough this plan implements end-to-end

## Global Constraints

- API routes on every backend service are versioned `/api/v1/...` (PRD Non-Functional Requirements) — the dashboard's Route Handlers must call `${SERVICE_URL}/api/v1/...`, never a bare path.
- Every zone/bucket/object request requires the caller's JWT to carry a non-null `org` claim (confirmed in `cdn-service`/`storage-service` auth guards via `requireOrgId`) — no zone/storage page may render until an org is selected.
- None of Identity/CDN/Storage Service send CORS headers — the browser must never call them directly; every backend call goes through a same-origin Route Handler.
- Object `size` comes back from Storage Service as a **stringified BigInt** (`string | null`), never a JSON number — never `Number()`/arithmetic on it without an explicit parse.
- Zone endpoints respond `{ zones: ZoneResponse[], total: number }`; bucket/object endpoints respond `{ buckets: ...[], total }` / `{ objects: ...[], total }` — these field names (`zones`/`buckets`/`objects`/`total`), not `data`/`items`/`page`, are exact and must be used verbatim in types.
- Out of scope for this stage (deferred to later stages per EDD §11): cache rules, custom domains, invalidation, analytics charts, billing, settings/API-key/member management UI, multipart upload, signed URLs, object versioning UI. `/zones/[zoneId]` shows only the zone's own fields (name, origin, TTLs, enabled) — no cache-rules/domains/analytics panels.

## Design Decisions (read before starting)

1. **Object keys stay flat (single path segment) for this stage.** Storage Service's `DELETE .../objects/:key` route is a plain Express `:key` param with no wildcard/slash-decoding configured, and its own integration tests never exercise a key containing `/` (confirmed by reading `objects.controller.ts` and its tests) — an untested, unconfirmed-working path. The upload flow always generates a flat key (`${8-char-random}-${sanitized-filename}`, no `/`), and the object browser is a flat table, not a folder tree. Nested "folder" browsing is deferred past this stage.
2. **No dependency on `@rivocloud/config` or `@rivocloud/db`.** `baseEnvSchema` in `@rivocloud/config` hard-requires `DATABASE_URL`/`REDIS_URL`/`NATS_URL` to parse as URLs — vestigial requirements for a service that touches none of those. The dashboard defines its own three-variable Zod env schema (`IDENTITY_SERVICE_URL`, `CDN_SERVICE_URL`, `STORAGE_SERVICE_URL`).
3. **`tsconfig.json` does not extend the root `tsconfig.base.json`.** The base config pins `module`/`moduleResolution: "NodeNext"`, which conflicts with the `moduleResolution: "bundler"` Next.js 15 requires for its own type-checking during `next build`. The dashboard's `tsconfig.json` is self-contained, matching the standard Next.js 15 App Router template.
4. **Route Handlers run in the default Node.js runtime; `middleware.ts` does coarse-grained cookie-presence checks only, never JWT decoding.** Edge Runtime (the default for `middleware.ts`) does not reliably expose `Buffer`; decoding a JWT's payload (needed to read `exp`/`org`) only happens in Route Handlers, which run in Node.js by default. Middleware redirects to `/login` purely on whether the access-token cookie is present — expiry/refresh is handled per-request by `resolveSession()` inside Route Handlers.
5. **No shadcn/ui CLI run.** The CLI's `init`/`add` commands are interactive and can't run unattended in this plan. Instead, Task 2 hand-writes the same small set of primitives the CLI would generate (Button, Input, Label, Card, Badge, Table, Dialog, Skeleton) using the standard shadcn "new-york" source shape (Radix primitives + `class-variance-authority` + `cn()`), so later tasks import from `@/components/ui/*` exactly as they would with the CLI.
6. **Lint gets a Next/React-aware block added to the existing root `eslint.config.js`, not a new per-app config file.** ESLint's flat config resolves upward from the linted file's directory to the nearest `eslint.config.js`, so `apps/dashboard`'s `eslint .` (run by Turbo, exactly like every sibling service) already finds the root file. `eslint-config-next` ships primarily as a legacy (`.eslintrc`-style) config and is awkward to bridge into flat config; this plan instead adds `eslint-plugin-react-hooks`'s recommended rules scoped to `apps/dashboard/**/*.{ts,tsx}`, which catches the correctness bugs that matter (rules-of-hooks, exhaustive-deps) without a compatibility shim.
7. **Auth proxy logic centralizes in one `proxyToBackend()` helper (`src/lib/proxy.ts`), not per-route.** Every protected Route Handler needs identical behavior: resolve session → require org (unless opted out) → forward to backend → surface backend errors → persist any refreshed tokens. Testing that logic once in `proxy.test.ts` covers every route that uses it; the routes themselves become 3–6 line wrappers not worth separate unit tests (mirrors how `zone-scope.guard.ts` in `cdn-service` centralizes RBAC once rather than per-controller).
8. **Register does not auto-receive tokens (confirmed: `POST /auth/register` returns only `{id,email,name}`), so the register page logs the user in immediately after a successful register**, reusing the same login Route Handler and the same post-login org-routing logic as Design Decision 9.
9. **Org routing after login is centralized in the login Route Handler's response, not scattered across pages.** `POST /api/auth/login` decodes the fresh access token's `org` claim; if it's already set, it returns `{ org }` and the client goes straight to `/dashboard`. If `org` is null, the handler (now authenticated) also calls `GET /api/v1/orgs` and returns `{ org: null, orgs }` so the client can route to `/orgs/new` (zero orgs), auto-select-and-continue (exactly one org), or `/orgs` (an org switcher, more than one) — without a second round trip for the common cases.
10. **No Dockerfile, no docker-compose entry, no per-app README.** None of `identity-service`/`cdn-service`/`storage-service` have any of these today (confirmed: no `Dockerfile` anywhere in the repo, no app-level `docker-compose.yml`, no per-app `README.md`) — Stage 6 doesn't invent a new packaging convention the other three services don't follow. Docker packaging is Stage 13's job (Kubernetes Migration).

## File Structure

```
apps/dashboard/
  package.json, tsconfig.json, next.config.ts, postcss.config.mjs
  vitest.config.ts, vitest.setup.ts
  .env.example
  next-env.d.ts (generated by `next dev`/`next build`, gitignored)
  src/
    middleware.ts
    app/
      layout.tsx
      globals.css
      page.tsx                          # "/" landing page
      login/page.tsx
      register/page.tsx
      orgs/page.tsx                     # org switcher (>1 org)
      orgs/new/page.tsx                 # create-org onboarding (0 orgs)
      (app)/layout.tsx                  # authenticated shell: nav + logout
      (app)/dashboard/page.tsx
      (app)/zones/page.tsx
      (app)/zones/[zoneId]/page.tsx
      (app)/storage/page.tsx
      (app)/storage/[bucketId]/page.tsx
      api/auth/register/route.ts
      api/auth/login/route.ts
      api/auth/logout/route.ts
      api/me/route.ts
      api/orgs/route.ts
      api/orgs/select/route.ts
      api/zones/route.ts
      api/zones/[zoneId]/route.ts
      api/buckets/route.ts
      api/buckets/[bucketId]/route.ts
      api/buckets/[bucketId]/objects/route.ts
      api/buckets/[bucketId]/objects/upload/route.ts
      api/buckets/[bucketId]/objects/[key]/route.ts
    components/
      ui/button.tsx, ui/input.tsx, ui/label.tsx, ui/card.tsx, ui/badge.tsx,
         ui/table.tsx, ui/dialog.tsx, ui/skeleton.tsx
      providers/query-provider.tsx
      layout/app-shell.tsx
      auth/login-form.tsx, auth/register-form.tsx
      orgs/create-org-form.tsx, orgs/org-switcher.tsx
      zones/zone-list.tsx, zones/create-zone-dialog.tsx, zones/zone-detail.tsx
      storage/bucket-list.tsx, storage/create-bucket-dialog.tsx,
        storage/object-browser.tsx, storage/upload-button.tsx
    lib/
      env.ts, env.test.ts
      jwt.ts, jwt.test.ts
      cookies.ts
      backend-fetch.ts, backend-fetch.test.ts
      auth-session.ts, auth-session.test.ts
      proxy.ts, proxy.test.ts
      http.ts
      types.ts
      validation.ts, validation.test.ts
      utils.ts
    hooks/
      use-me.ts, use-orgs.ts, use-create-org.ts, use-select-org.ts
      use-zones.ts, use-zone.ts, use-create-zone.ts, use-update-zone.ts, use-delete-zone.ts
      use-buckets.ts, use-bucket.ts, use-create-bucket.ts
      use-objects.ts, use-initiate-upload.ts, use-delete-object.ts
```

---

### Task 1: Scaffold `apps/dashboard` — Next.js app boots, lints, typechecks

**Files:**
- Modify: `.gitignore` (add `.next/`)
- Modify: `eslint.config.js` (add the `apps/dashboard` React-hooks block from Design Decision 6)
- Create: `apps/dashboard/package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`
- Create: `apps/dashboard/vitest.config.ts`, `vitest.setup.ts`
- Create: `apps/dashboard/.env.example`
- Create: `apps/dashboard/src/app/globals.css`, `layout.tsx`, `page.tsx`
- Create: `apps/dashboard/src/lib/utils.ts`, `utils.test.ts`

**Interfaces:**
- Produces: `cn(...inputs: ClassValue[]): string` from `src/lib/utils.ts`, imported by every component task below.

- [ ] **Step 1: Add `.next/` to root `.gitignore`**

Append to `.gitignore`:
```
.next/
```

- [ ] **Step 2: Add the dashboard's lint block to root `eslint.config.js`**

Add a new `devDependencies` entry is not needed here (that's Step 4's `package.json`); just add this block as the last argument to `tseslint.config(...)` in `eslint.config.js`:
```js
  {
    files: ['apps/dashboard/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
```
And add the import at the top of the file:
```js
import reactHooks from 'eslint-plugin-react-hooks';
```

- [ ] **Step 3: Create `apps/dashboard/package.json`**

```json
{
  "name": "@rivocloud/dashboard",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test:unit": "vitest run"
  },
  "dependencies": {
    "@radix-ui/react-dialog": "^1.1.2",
    "@radix-ui/react-label": "^2.1.0",
    "@radix-ui/react-slot": "^1.1.0",
    "@tanstack/react-query": "^5.59.0",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.1.1",
    "lucide-react": "^0.451.0",
    "next": "^15.0.3",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "sonner": "^1.5.0",
    "tailwind-merge": "^2.5.4",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4.0.0",
    "@testing-library/jest-dom": "^6.6.2",
    "@testing-library/react": "^16.0.1",
    "@testing-library/user-event": "^14.5.2",
    "@types/node": "^20.16.11",
    "@types/react": "^19.0.1",
    "@types/react-dom": "^19.0.2",
    "@vitejs/plugin-react": "^4.3.3",
    "eslint-plugin-react-hooks": "^5.0.0",
    "jsdom": "^25.0.1",
    "postcss": "^8.4.47",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.6.2",
    "vitest": "^2.1.1"
  }
}
```

- [ ] **Step 4: Create `apps/dashboard/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "ES2022"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 5: Create `apps/dashboard/next.config.ts`**

```ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {};

export default nextConfig;
```

- [ ] **Step 6: Create `apps/dashboard/postcss.config.mjs`**

```js
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};
```

- [ ] **Step 7: Create `apps/dashboard/.env.example`**

```
IDENTITY_SERVICE_URL=http://localhost:3001
CDN_SERVICE_URL=http://localhost:3003
STORAGE_SERVICE_URL=http://localhost:3004
PORT=3000
```

- [ ] **Step 8: Create `apps/dashboard/vitest.config.ts` and `vitest.setup.ts`**

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
```

`vitest.setup.ts`:
```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 9: Write the failing test for `cn()`**

Create `apps/dashboard/src/lib/utils.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { cn } from './utils';

describe('cn', () => {
  it('merges class names and drops falsy values', () => {
    expect(cn('a', false, undefined, 'b')).toBe('a b');
  });

  it('lets a later Tailwind class win over a conflicting earlier one', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4');
  });
});
```

- [ ] **Step 10: Run the test to verify it fails**

Run (from `apps/dashboard`): `pnpm test:unit`
Expected: FAIL — `./utils` has no exported member `cn` (module doesn't exist yet).

- [ ] **Step 11: Create `apps/dashboard/src/lib/utils.ts`**

```ts
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 12: Run the test to verify it passes**

Run: `pnpm test:unit`
Expected: PASS (2 tests)

- [ ] **Step 13: Create `apps/dashboard/src/app/globals.css`**

```css
@import "tailwindcss";

@theme {
  --color-background: oklch(1 0 0);
  --color-foreground: oklch(0.145 0 0);
  --color-primary: oklch(0.205 0 0);
  --color-primary-foreground: oklch(0.985 0 0);
  --color-muted: oklch(0.97 0 0);
  --color-muted-foreground: oklch(0.556 0 0);
  --color-border: oklch(0.922 0 0);
  --color-destructive: oklch(0.577 0.245 27.325);
  --color-destructive-foreground: oklch(0.985 0 0);
  --radius: 0.5rem;
}

body {
  background: var(--color-background);
  color: var(--color-foreground);
}
```

- [ ] **Step 14: Create `apps/dashboard/src/app/layout.tsx`**

```tsx
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'RivoCloud',
  description: 'CDN, storage, and analytics — one dashboard.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 15: Create `apps/dashboard/src/app/page.tsx`**

```tsx
import Link from 'next/link';

export default function LandingPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-6 px-4 text-center">
      <h1 className="text-4xl font-bold tracking-tight">RivoCloud</h1>
      <p className="text-muted-foreground max-w-xl">
        One CDN, one object store, one dashboard — no juggling separate vendors for your edge caching and file storage.
      </p>
      <div className="flex gap-4">
        <Link href="/register" className="rounded-md bg-primary px-4 py-2 text-primary-foreground">
          Get started
        </Link>
        <Link href="/login" className="rounded-md border border-border px-4 py-2">
          Log in
        </Link>
      </div>
    </main>
  );
}
```

- [ ] **Step 16: Verify the app builds and lints**

Run (from `apps/dashboard`): `pnpm install` (from repo root, once, to link the new workspace package), then `pnpm --filter @rivocloud/dashboard build`
Expected: build succeeds, producing `.next/`.

Run: `pnpm turbo lint typecheck` (from repo root)
Expected: passes for `@rivocloud/dashboard` along with every existing app.

- [ ] **Step 17: Commit**

```bash
git add .gitignore eslint.config.js apps/dashboard
git commit -m "feat: scaffold apps/dashboard (Stage 6.0)"
```

---

### Task 2: shadcn/ui-style primitives

**Files:**
- Create: `apps/dashboard/src/components/ui/button.tsx`, `input.tsx`, `label.tsx`, `card.tsx`, `badge.tsx`, `table.tsx`, `dialog.tsx`, `skeleton.tsx`
- Test: `apps/dashboard/src/components/ui/button.test.tsx`

**Interfaces:**
- Consumes: `cn()` from `@/lib/utils` (Task 1).
- Produces: `Button`, `buttonVariants`, `Input`, `Label`, `Card`/`CardHeader`/`CardTitle`/`CardDescription`/`CardContent`/`CardFooter`, `Badge`, `Table`/`TableHeader`/`TableBody`/`TableRow`/`TableHead`/`TableCell`, `Dialog`/`DialogTrigger`/`DialogContent`/`DialogHeader`/`DialogTitle`/`DialogDescription`/`DialogFooter`, `Skeleton` — imported by every page/component task below.

- [ ] **Step 1: Write the failing test for `Button`**

Create `apps/dashboard/src/components/ui/button.test.tsx`:
```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from './button';

describe('Button', () => {
  it('renders its children and responds to clicks', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('is disabled when the disabled prop is set', () => {
    render(<Button disabled>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:unit`
Expected: FAIL — `./button` module not found.

- [ ] **Step 3: Create `apps/dashboard/src/components/ui/button.tsx`**

```tsx
import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:opacity-90',
        outline: 'border border-border bg-transparent hover:bg-muted',
        destructive: 'bg-destructive text-destructive-foreground hover:opacity-90',
        ghost: 'hover:bg-muted',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 px-3',
        lg: 'h-10 px-6',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return <Comp className={cn(buttonVariants({ variant, size }), className)} ref={ref} {...props} />;
  },
);
Button.displayName = 'Button';

export { buttonVariants };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test:unit`
Expected: PASS

- [ ] **Step 5: Create the remaining primitives**

`apps/dashboard/src/components/ui/input.tsx`:
```tsx
import * as React from 'react';
import { cn } from '@/lib/utils';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      className={cn(
        'flex h-9 w-full rounded-md border border-border bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
);
Input.displayName = 'Input';
```

`apps/dashboard/src/components/ui/label.tsx`:
```tsx
'use client';

import * as React from 'react';
import * as LabelPrimitive from '@radix-ui/react-label';
import { cn } from '@/lib/utils';

export const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn('text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70', className)}
    {...props}
  />
));
Label.displayName = LabelPrimitive.Root.displayName;
```

`apps/dashboard/src/components/ui/card.tsx`:
```tsx
import * as React from 'react';
import { cn } from '@/lib/utils';

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-lg border border-border shadow-sm', className)} {...props} />;
}
export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1.5 p-6', className)} {...props} />;
}
export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-lg font-semibold leading-none', className)} {...props} />;
}
export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-sm text-muted-foreground', className)} {...props} />;
}
export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-6 pt-0', className)} {...props} />;
}
export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex items-center p-6 pt-0', className)} {...props} />;
}
```

`apps/dashboard/src/components/ui/badge.tsx`:
```tsx
import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva('inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium', {
  variants: {
    variant: {
      default: 'border-transparent bg-primary text-primary-foreground',
      secondary: 'border-transparent bg-muted text-muted-foreground',
      destructive: 'border-transparent bg-destructive text-destructive-foreground',
      outline: 'border-border text-foreground',
    },
  },
  defaultVariants: { variant: 'default' },
});

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
```

`apps/dashboard/src/components/ui/table.tsx`:
```tsx
import * as React from 'react';
import { cn } from '@/lib/utils';

export function Table({ className, ...props }: React.HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-auto">
      <table className={cn('w-full caption-bottom text-sm', className)} {...props} />
    </div>
  );
}
export function TableHeader({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn('[&_tr]:border-b', className)} {...props} />;
}
export function TableBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn('[&_tr:last-child]:border-0', className)} {...props} />;
}
export function TableRow({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn('border-b border-border transition-colors hover:bg-muted', className)} {...props} />;
}
export function TableHead({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={cn('h-10 px-2 text-left align-middle font-medium text-muted-foreground', className)} {...props} />;
}
export function TableCell({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('p-2 align-middle', className)} {...props} />;
}
```

`apps/dashboard/src/components/ui/dialog.tsx`:
```tsx
'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;

export function DialogContent({ className, children, ...props }: DialogPrimitive.DialogContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
      <DialogPrimitive.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-background p-6 shadow-lg',
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 hover:opacity-100">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mb-4 flex flex-col gap-1.5', className)} {...props} />;
}
export function DialogTitle({ className, ...props }: DialogPrimitive.DialogTitleProps) {
  return <DialogPrimitive.Title className={cn('text-lg font-semibold', className)} {...props} />;
}
export function DialogDescription({ className, ...props }: DialogPrimitive.DialogDescriptionProps) {
  return <DialogPrimitive.Description className={cn('text-sm text-muted-foreground', className)} {...props} />;
}
export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mt-6 flex justify-end gap-2', className)} {...props} />;
}
```

`apps/dashboard/src/components/ui/skeleton.tsx`:
```tsx
import { cn } from '@/lib/utils';

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} {...props} />;
}
```

- [ ] **Step 6: Run the full unit test suite and lint/typecheck**

Run: `pnpm test:unit && pnpm typecheck && pnpm lint` (from `apps/dashboard`)
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard/src/components/ui
git commit -m "feat: add shadcn/ui-style primitives (Stage 6.0)"
```

---

### Task 3: Env schema, JWT decoding, cookies, backend fetch

**Files:**
- Create: `apps/dashboard/src/lib/env.ts`, `env.test.ts`
- Create: `apps/dashboard/src/lib/jwt.ts`, `jwt.test.ts`
- Create: `apps/dashboard/src/lib/cookies.ts`
- Create: `apps/dashboard/src/lib/backend-fetch.ts`, `backend-fetch.test.ts`

**Interfaces:**
- Produces: `getEnv(): Env`; `decodeAccessToken(token: string): DecodedAccessToken | null`, `isExpired(exp: number, skewSeconds?: number): boolean`; `ACCESS_COOKIE`, `REFRESH_COOKIE`, `cookieOptions(maxAgeSeconds: number)`; `backendFetch(baseUrl: string, path: string, init?: RequestInit & { accessToken?: string }): Promise<unknown>`, `class BackendError extends Error { status: number; body: unknown }` — consumed by Task 4's `auth-session.ts`/`proxy.ts` and every Route Handler task after it.

- [ ] **Step 1: Write the failing test for `getEnv`**

Create `apps/dashboard/src/lib/env.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getEnv } from './env';

const REQUIRED = {
  IDENTITY_SERVICE_URL: 'http://localhost:3001',
  CDN_SERVICE_URL: 'http://localhost:3003',
  STORAGE_SERVICE_URL: 'http://localhost:3004',
};

describe('getEnv', () => {
  const original = { ...process.env };

  beforeEach(() => {
    process.env = { ...original, ...REQUIRED };
  });

  afterEach(() => {
    process.env = original;
  });

  it('parses valid service URLs', () => {
    expect(getEnv()).toMatchObject(REQUIRED);
  });

  it('throws with a readable message when a URL is missing', () => {
    delete process.env.CDN_SERVICE_URL;
    expect(() => getEnv()).toThrow(/CDN_SERVICE_URL/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:unit`
Expected: FAIL — `./env` module not found.

- [ ] **Step 3: Create `apps/dashboard/src/lib/env.ts`**

```ts
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  IDENTITY_SERVICE_URL: z.string().url(),
  CDN_SERVICE_URL: z.string().url(),
  STORAGE_SERVICE_URL: z.string().url(),
});

export type Env = z.infer<typeof envSchema>;

export function getEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`).join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  return result.data;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test:unit`
Expected: PASS

- [ ] **Step 5: Write the failing test for JWT decoding**

Create `apps/dashboard/src/lib/jwt.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { decodeAccessToken, isExpired } from './jwt';

function fakeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.fake-signature`;
}

describe('decodeAccessToken', () => {
  it('reads sub/org/role/exp without verifying the signature', () => {
    const token = fakeJwt({ sub: 'user-1', org: 'org-1', role: 'owner', exp: 1234567890, jti: 'abc' });
    expect(decodeAccessToken(token)).toEqual({ sub: 'user-1', org: 'org-1', role: 'owner', exp: 1234567890 });
  });

  it('defaults org/role to null when absent', () => {
    const token = fakeJwt({ sub: 'user-1', exp: 1234567890 });
    expect(decodeAccessToken(token)).toEqual({ sub: 'user-1', org: null, role: null, exp: 1234567890 });
  });

  it('returns null for a malformed token', () => {
    expect(decodeAccessToken('not-a-jwt')).toBeNull();
  });
});

describe('isExpired', () => {
  it('is true once past exp minus the skew window', () => {
    const nowSeconds = Date.now() / 1000;
    expect(isExpired(nowSeconds + 5, 10)).toBe(true);
    expect(isExpired(nowSeconds + 1000, 10)).toBe(false);
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `pnpm test:unit`
Expected: FAIL — `./jwt` module not found.

- [ ] **Step 7: Create `apps/dashboard/src/lib/jwt.ts`**

```ts
export interface DecodedAccessToken {
  sub: string;
  org: string | null;
  role: string | null;
  exp: number;
}

export function decodeAccessToken(token: string): DecodedAccessToken | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (typeof payload.sub !== 'string' || typeof payload.exp !== 'number') return null;
    return {
      sub: payload.sub,
      org: typeof payload.org === 'string' ? payload.org : null,
      role: typeof payload.role === 'string' ? payload.role : null,
      exp: payload.exp,
    };
  } catch {
    return null;
  }
}

export function isExpired(exp: number, skewSeconds = 10): boolean {
  return Date.now() / 1000 >= exp - skewSeconds;
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm test:unit`
Expected: PASS

- [ ] **Step 9: Create `apps/dashboard/src/lib/cookies.ts`** (no test — trivial constants/config, exercised indirectly by Task 4's `auth-session.test.ts`)

```ts
export const ACCESS_COOKIE = 'rc_access_token';
export const REFRESH_COOKIE = 'rc_refresh_token';

export function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: maxAgeSeconds,
  };
}

export const ACCESS_TOKEN_MAX_AGE_SECONDS = 60 * 15;
export const REFRESH_TOKEN_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
```

- [ ] **Step 10: Write the failing test for `backendFetch`**

Create `apps/dashboard/src/lib/backend-fetch.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { backendFetch, BackendError } from './backend-fetch';

describe('backendFetch', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends a bearer token and returns the parsed JSON body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await backendFetch('http://svc', '/api/v1/thing', { accessToken: 'jwt-123' });

    expect(result).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://svc/api/v1/thing');
    expect(init.headers.Authorization).toBe('Bearer jwt-123');
  });

  it('throws BackendError with the status and parsed body on a non-2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'nope' }), { status: 403 })),
    );

    await expect(backendFetch('http://svc', '/api/v1/thing')).rejects.toMatchObject({
      status: 403,
      body: { message: 'nope' },
    });
  });

  it('returns null for an empty response body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 204 })));
    expect(await backendFetch('http://svc', '/api/v1/thing')).toBeNull();
  });
});
```

- [ ] **Step 11: Run the test to verify it fails**

Run: `pnpm test:unit`
Expected: FAIL — `./backend-fetch` module not found.

- [ ] **Step 12: Create `apps/dashboard/src/lib/backend-fetch.ts`**

```ts
export class BackendError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`Backend request failed with status ${status}`);
    this.name = 'BackendError';
  }
}

export async function backendFetch(
  baseUrl: string,
  path: string,
  init: RequestInit & { accessToken?: string } = {},
): Promise<unknown> {
  const { accessToken, headers, ...rest } = init;
  const response = await fetch(`${baseUrl}${path}`, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...headers,
    },
  });

  const text = await response.text();
  const body: unknown = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new BackendError(response.status, body);
  }
  return body;
}
```

- [ ] **Step 13: Run the test to verify it passes**

Run: `pnpm test:unit`
Expected: PASS

- [ ] **Step 14: Commit**

```bash
git add apps/dashboard/src/lib/env.ts apps/dashboard/src/lib/env.test.ts \
        apps/dashboard/src/lib/jwt.ts apps/dashboard/src/lib/jwt.test.ts \
        apps/dashboard/src/lib/cookies.ts \
        apps/dashboard/src/lib/backend-fetch.ts apps/dashboard/src/lib/backend-fetch.test.ts
git commit -m "feat: add dashboard env schema, JWT decoding, and backend-fetch helper (Stage 6.1)"
```

---

### Task 4: Session resolution + backend proxy helper

**Files:**
- Create: `apps/dashboard/src/lib/auth-session.ts`, `auth-session.test.ts`
- Create: `apps/dashboard/src/lib/proxy.ts`, `proxy.test.ts`
- Create: `apps/dashboard/src/lib/types.ts`

**Interfaces:**
- Consumes: `decodeAccessToken`, `isExpired` (Task 3 `jwt.ts`); `backendFetch`, `BackendError` (Task 3 `backend-fetch.ts`); `ACCESS_COOKIE`, `REFRESH_COOKIE`, `cookieOptions`, `ACCESS_TOKEN_MAX_AGE_SECONDS`, `REFRESH_TOKEN_MAX_AGE_SECONDS` (Task 3 `cookies.ts`); `getEnv` (Task 3 `env.ts`).
- Produces: `interface AuthTokens { accessToken: string; refreshToken: string }`; `interface SessionResult { accessToken: string; org: string | null; newTokens: AuthTokens | null }`; `resolveSession(): Promise<SessionResult | null>`; `applySessionCookies(response: NextResponse, tokens: AuthTokens): void`; `clearSessionCookies(response: NextResponse): void`; `proxyToBackend(baseUrl: string, path: string, init?: RequestInit, opts?: { requireOrg?: boolean }): Promise<NextResponse>` — consumed by every Route Handler task (5, 7, 8, 9, 11).

- [ ] **Step 1: Create `apps/dashboard/src/lib/types.ts`**

```ts
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  emailVerified: boolean;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
}

export interface Zone {
  id: string;
  orgId: string;
  projectId: string | null;
  name: string;
  slug: string;
  originUrl: string;
  originProtocol: string;
  cacheTtl: number;
  browserTtl: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Bucket {
  id: string;
  orgId: string;
  projectId: string | null;
  name: string;
  region: string;
  versioningEnabled: boolean;
  public: boolean;
  lifecycleRules: unknown;
  createdAt: string;
}

export interface StorageObject {
  id: string;
  bucketId: string;
  key: string;
  versionId: string;
  isLatest: boolean;
  size: string | null;
  contentType: string;
  etag: string | null;
  storagePath: string;
  metadata: unknown;
  status: 'pending' | 'ready' | 'deleted';
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 2: Write the failing test for `resolveSession`**

Create `apps/dashboard/src/lib/auth-session.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from 'vitest';

const cookieStore = new Map<string, { value: string }>();

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => cookieStore.get(name),
  }),
}));

vi.mock('./env', () => ({
  getEnv: () => ({ IDENTITY_SERVICE_URL: 'http://identity', CDN_SERVICE_URL: 'http://cdn', STORAGE_SERVICE_URL: 'http://storage' }),
}));

import { resolveSession } from './auth-session';
import { ACCESS_COOKIE, REFRESH_COOKIE } from './cookies';

function fakeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.sig`;
}

describe('resolveSession', () => {
  afterEach(() => {
    cookieStore.clear();
    vi.unstubAllGlobals();
  });

  it('returns the session unchanged when the access token is still valid', async () => {
    const token = fakeJwt({ sub: 'u1', org: 'org-1', exp: Date.now() / 1000 + 900 });
    cookieStore.set(ACCESS_COOKIE, { value: token });

    const session = await resolveSession();

    expect(session).toEqual({ accessToken: token, org: 'org-1', newTokens: null });
  });

  it('returns null when there is no access token and no refresh token', async () => {
    expect(await resolveSession()).toBeNull();
  });

  it('refreshes when the access token is expired and a refresh token exists', async () => {
    const expired = fakeJwt({ sub: 'u1', org: 'org-1', exp: Date.now() / 1000 - 100 });
    const freshAccess = fakeJwt({ sub: 'u1', org: 'org-1', exp: Date.now() / 1000 + 900 });
    cookieStore.set(ACCESS_COOKIE, { value: expired });
    cookieStore.set(REFRESH_COOKIE, { value: 'refresh-abc' });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ accessToken: freshAccess, refreshToken: 'refresh-xyz' }), { status: 200 }),
      ),
    );

    const session = await resolveSession();

    expect(session).toEqual({
      accessToken: freshAccess,
      org: 'org-1',
      newTokens: { accessToken: freshAccess, refreshToken: 'refresh-xyz' },
    });
  });

  it('returns null when the refresh call fails', async () => {
    const expired = fakeJwt({ sub: 'u1', org: 'org-1', exp: Date.now() / 1000 - 100 });
    cookieStore.set(ACCESS_COOKIE, { value: expired });
    cookieStore.set(REFRESH_COOKIE, { value: 'refresh-abc' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));

    expect(await resolveSession()).toBeNull();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm test:unit`
Expected: FAIL — `./auth-session` module not found.

- [ ] **Step 4: Create `apps/dashboard/src/lib/auth-session.ts`**

```ts
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { decodeAccessToken, isExpired } from './jwt';
import { backendFetch } from './backend-fetch';
import { getEnv } from './env';
import {
  ACCESS_COOKIE,
  ACCESS_TOKEN_MAX_AGE_SECONDS,
  cookieOptions,
  REFRESH_COOKIE,
  REFRESH_TOKEN_MAX_AGE_SECONDS,
} from './cookies';
import type { AuthTokens } from './types';

export interface SessionResult {
  accessToken: string;
  org: string | null;
  newTokens: AuthTokens | null;
}

export async function resolveSession(): Promise<SessionResult | null> {
  const store = await cookies();
  const access = store.get(ACCESS_COOKIE)?.value;
  const refresh = store.get(REFRESH_COOKIE)?.value;
  const decoded = access ? decodeAccessToken(access) : null;

  if (access && decoded && !isExpired(decoded.exp)) {
    return { accessToken: access, org: decoded.org, newTokens: null };
  }

  if (!refresh) return null;

  try {
    const tokens = (await backendFetch(getEnv().IDENTITY_SERVICE_URL, '/api/v1/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: refresh }),
    })) as AuthTokens;
    const newDecoded = decodeAccessToken(tokens.accessToken);
    return { accessToken: tokens.accessToken, org: newDecoded?.org ?? null, newTokens: tokens };
  } catch {
    return null;
  }
}

export function applySessionCookies(response: NextResponse, tokens: AuthTokens): void {
  response.cookies.set(ACCESS_COOKIE, tokens.accessToken, cookieOptions(ACCESS_TOKEN_MAX_AGE_SECONDS));
  response.cookies.set(REFRESH_COOKIE, tokens.refreshToken, cookieOptions(REFRESH_TOKEN_MAX_AGE_SECONDS));
}

export function clearSessionCookies(response: NextResponse): void {
  response.cookies.delete(ACCESS_COOKIE);
  response.cookies.delete(REFRESH_COOKIE);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test:unit`
Expected: PASS

- [ ] **Step 6: Write the failing test for `proxyToBackend`**

Create `apps/dashboard/src/lib/proxy.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from 'vitest';

const resolveSessionMock = vi.fn();
vi.mock('./auth-session', () => ({
  resolveSession: () => resolveSessionMock(),
  applySessionCookies: vi.fn(),
}));

import { proxyToBackend } from './proxy';
import { BackendError, backendFetch } from './backend-fetch';

vi.mock('./backend-fetch', async () => {
  const actual = await vi.importActual<typeof import('./backend-fetch')>('./backend-fetch');
  return { ...actual, backendFetch: vi.fn() };
});

describe('proxyToBackend', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when there is no session', async () => {
    resolveSessionMock.mockResolvedValue(null);
    const response = await proxyToBackend('http://svc', '/api/v1/zones');
    expect(response.status).toBe(401);
  });

  it('returns 409 when the session has no org and requireOrg is not disabled', async () => {
    resolveSessionMock.mockResolvedValue({ accessToken: 'jwt', org: null, newTokens: null });
    const response = await proxyToBackend('http://svc', '/api/v1/zones');
    expect(response.status).toBe(409);
  });

  it('skips the org check when requireOrg is false', async () => {
    resolveSessionMock.mockResolvedValue({ accessToken: 'jwt', org: null, newTokens: null });
    vi.mocked(backendFetch).mockResolvedValue({ orgs: [] });

    const response = await proxyToBackend('http://svc', '/api/v1/orgs', {}, { requireOrg: false });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ orgs: [] });
  });

  it('forwards a successful backend response as JSON', async () => {
    resolveSessionMock.mockResolvedValue({ accessToken: 'jwt', org: 'org-1', newTokens: null });
    vi.mocked(backendFetch).mockResolvedValue({ zones: [], total: 0 });

    const response = await proxyToBackend('http://svc', '/api/v1/zones');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ zones: [], total: 0 });
  });

  it('surfaces a BackendError as a JSON response with the same status', async () => {
    resolveSessionMock.mockResolvedValue({ accessToken: 'jwt', org: 'org-1', newTokens: null });
    vi.mocked(backendFetch).mockRejectedValue(new BackendError(404, { message: 'not found' }));

    const response = await proxyToBackend('http://svc', '/api/v1/zones/missing');

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ message: 'not found' });
  });
});
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `pnpm test:unit`
Expected: FAIL — `./proxy` module not found.

- [ ] **Step 8: Create `apps/dashboard/src/lib/proxy.ts`**

```ts
import { NextResponse } from 'next/server';
import { applySessionCookies, resolveSession } from './auth-session';
import { backendFetch, BackendError } from './backend-fetch';

export async function proxyToBackend(
  baseUrl: string,
  path: string,
  init: RequestInit = {},
  opts: { requireOrg?: boolean } = {},
): Promise<NextResponse> {
  const session = await resolveSession();
  if (!session) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }
  if (opts.requireOrg !== false && !session.org) {
    return NextResponse.json({ message: 'Select an organization first' }, { status: 409 });
  }

  try {
    const data = await backendFetch(baseUrl, path, { ...init, accessToken: session.accessToken });
    const response = NextResponse.json(data ?? {});
    if (session.newTokens) applySessionCookies(response, session.newTokens);
    return response;
  } catch (err) {
    if (err instanceof BackendError) {
      const response = NextResponse.json(err.body ?? { message: 'Backend error' }, { status: err.status });
      if (session.newTokens) applySessionCookies(response, session.newTokens);
      return response;
    }
    throw err;
  }
}
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `pnpm test:unit`
Expected: PASS (all 5 cases)

- [ ] **Step 10: Commit**

```bash
git add apps/dashboard/src/lib/types.ts apps/dashboard/src/lib/auth-session.ts \
        apps/dashboard/src/lib/auth-session.test.ts apps/dashboard/src/lib/proxy.ts \
        apps/dashboard/src/lib/proxy.test.ts
git commit -m "feat: add session resolution and backend proxy helper (Stage 6.1)"
```

---

### Task 5: Auth Route Handlers (register, login, logout, me)

**Files:**
- Create: `apps/dashboard/src/app/api/auth/register/route.ts`
- Create: `apps/dashboard/src/app/api/auth/login/route.ts`
- Create: `apps/dashboard/src/app/api/auth/logout/route.ts`
- Create: `apps/dashboard/src/app/api/me/route.ts`

**Interfaces:**
- Consumes: `getEnv` (Task 3), `backendFetch`/`BackendError` (Task 3), `decodeAccessToken` (Task 3), `applySessionCookies`/`clearSessionCookies`/`resolveSession` (Task 4), `ACCESS_COOKIE`/`REFRESH_COOKIE` (Task 3), `AuthTokens`/`Organization` (Task 4).
- Produces: `POST /api/auth/register` (body `{email,name,password}` → `{id,email,name}`); `POST /api/auth/login` (body `{email,password}` → `{ org: string|null, orgs?: Organization[] }`, sets cookies); `POST /api/auth/logout` (clears cookies, best-effort backend logout, → `{success:true}`); `GET /api/me` (→ `{ ...UserProfile, orgId: string|null }`) — consumed by Task 6's auth forms and Task 7's org routing.

No dedicated tests for these four files per Design Decision 7 — their only logic beyond `proxyToBackend`'s already-tested behavior is cookie issuance and the login org-lookup branch, both plain, easily-reviewed sequential code with no branching worth mocking four more times. Verify them with the manual curl checks in Step 5 and the end-to-end browser walkthrough in Task 15.

- [ ] **Step 1: Create `apps/dashboard/src/app/api/auth/register/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getEnv } from '@/lib/env';
import { backendFetch, BackendError } from '@/lib/backend-fetch';

export async function POST(request: NextRequest) {
  const body = await request.text();
  try {
    const user = await backendFetch(getEnv().IDENTITY_SERVICE_URL, '/api/v1/auth/register', {
      method: 'POST',
      body,
    });
    return NextResponse.json(user, { status: 201 });
  } catch (err) {
    if (err instanceof BackendError) {
      return NextResponse.json(err.body ?? { message: 'Registration failed' }, { status: err.status });
    }
    throw err;
  }
}
```

- [ ] **Step 2: Create `apps/dashboard/src/app/api/auth/login/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getEnv } from '@/lib/env';
import { backendFetch, BackendError } from '@/lib/backend-fetch';
import { applySessionCookies } from '@/lib/auth-session';
import { decodeAccessToken } from '@/lib/jwt';
import type { AuthTokens, Organization } from '@/lib/types';

export async function POST(request: NextRequest) {
  const body = await request.text();

  try {
    const tokens = (await backendFetch(getEnv().IDENTITY_SERVICE_URL, '/api/v1/auth/login', {
      method: 'POST',
      body,
    })) as AuthTokens;

    const decoded = decodeAccessToken(tokens.accessToken);
    const org = decoded?.org ?? null;

    let orgs: Organization[] | undefined;
    if (!org) {
      orgs = (await backendFetch(getEnv().IDENTITY_SERVICE_URL, '/api/v1/orgs', {
        accessToken: tokens.accessToken,
      })) as Organization[];
    }

    const response = NextResponse.json({ org, orgs });
    applySessionCookies(response, tokens);
    return response;
  } catch (err) {
    if (err instanceof BackendError) {
      return NextResponse.json(err.body ?? { message: 'Login failed' }, { status: err.status });
    }
    throw err;
  }
}
```

- [ ] **Step 3: Create `apps/dashboard/src/app/api/auth/logout/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getEnv } from '@/lib/env';
import { backendFetch } from '@/lib/backend-fetch';
import { clearSessionCookies } from '@/lib/auth-session';
import { REFRESH_COOKIE } from '@/lib/cookies';

export async function POST() {
  const store = await cookies();
  const refreshToken = store.get(REFRESH_COOKIE)?.value;

  if (refreshToken) {
    try {
      await backendFetch(getEnv().IDENTITY_SERVICE_URL, '/api/v1/auth/logout', {
        method: 'POST',
        body: JSON.stringify({ refreshToken }),
      });
    } catch {
      // best-effort: the cookies are cleared regardless of whether the backend call succeeds
    }
  }

  const response = NextResponse.json({ success: true });
  clearSessionCookies(response);
  return response;
}
```

- [ ] **Step 4: Create `apps/dashboard/src/app/api/me/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { getEnv } from '@/lib/env';
import { resolveSession } from '@/lib/auth-session';
import { backendFetch, BackendError } from '@/lib/backend-fetch';

export async function GET() {
  const session = await resolveSession();
  if (!session) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });

  try {
    const profile = await backendFetch(getEnv().IDENTITY_SERVICE_URL, '/api/v1/users/me', {
      accessToken: session.accessToken,
    });
    return NextResponse.json({ ...(profile as object), orgId: session.org });
  } catch (err) {
    if (err instanceof BackendError) {
      return NextResponse.json(err.body ?? { message: 'Failed to load profile' }, { status: err.status });
    }
    throw err;
  }
}
```

*(`GET /api/me` doesn't go through `proxyToBackend` because its response needs the extra `orgId` field merged in.)*

- [ ] **Step 5: Manually verify against a running identity-service**

With `identity-service` running locally on port 3001 and the dashboard's `.env.local` pointing `IDENTITY_SERVICE_URL=http://localhost:3001`, run `pnpm dev` in `apps/dashboard` and:
```bash
curl -i -X POST http://localhost:3000/api/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"dash-test@example.com","password":"password123","name":"Dash Test"}'
curl -i -X POST http://localhost:3000/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"dash-test@example.com","password":"password123"}' -c cookies.txt
curl -i http://localhost:3000/api/me -b cookies.txt
```
Expected: register returns 201; login returns `{"org":null,"orgs":[]}` and sets `rc_access_token`/`rc_refresh_token` cookies; `/api/me` returns the profile with `"orgId":null`.

- [ ] **Step 6: Run lint/typecheck**

Run: `pnpm lint && pnpm typecheck` (from `apps/dashboard`)
Expected: passes.

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard/src/app/api/auth apps/dashboard/src/app/api/me
git commit -m "feat: add auth Route Handlers — register, login, logout, me (Stage 6.1)"
```

---

### Task 6: Login/register pages, TanStack Query provider, auth session hook

**Files:**
- Create: `apps/dashboard/src/lib/validation.ts`, `validation.test.ts`
- Create: `apps/dashboard/src/lib/http.ts`
- Create: `apps/dashboard/src/components/providers/query-provider.tsx`
- Create: `apps/dashboard/src/hooks/use-me.ts`
- Create: `apps/dashboard/src/components/auth/login-form.tsx`, `register-form.tsx`
- Create: `apps/dashboard/src/app/login/page.tsx`, `apps/dashboard/src/app/register/page.tsx`
- Modify: `apps/dashboard/src/app/layout.tsx` (wrap children in `QueryProvider`)
- Test: `apps/dashboard/src/components/auth/login-form.test.tsx`

**Interfaces:**
- Consumes: `Button`/`Input`/`Label`/`Card*` (Task 2); `POST /api/auth/login`, `POST /api/auth/register` (Task 5); `UserProfile` (Task 4 `types.ts`).
- Produces: `loginSchema`, `registerSchema` (Zod); `apiFetch<T>(path: string, init?: RequestInit): Promise<T>` and `class ApiError extends Error { status: number; body: unknown }` from `lib/http.ts`; `QueryProvider`; `useMe()` — consumed by Task 7 onward for every authenticated page/hook.

- [ ] **Step 1: Write the failing test for the login/register Zod schemas**

Create `apps/dashboard/src/lib/validation.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { loginSchema, registerSchema } from './validation';

describe('loginSchema', () => {
  it('accepts a valid email/password pair', () => {
    expect(loginSchema.safeParse({ email: 'a@b.com', password: 'password123' }).success).toBe(true);
  });

  it('rejects an invalid email', () => {
    expect(loginSchema.safeParse({ email: 'not-an-email', password: 'password123' }).success).toBe(false);
  });
});

describe('registerSchema', () => {
  it('accepts a valid registration payload', () => {
    expect(
      registerSchema.safeParse({ name: 'Ada', email: 'ada@example.com', password: 'password123' }).success,
    ).toBe(true);
  });

  it('rejects a password shorter than 8 characters', () => {
    expect(
      registerSchema.safeParse({ name: 'Ada', email: 'ada@example.com', password: 'short' }).success,
    ).toBe(false);
  });

  it('rejects an empty name', () => {
    expect(
      registerSchema.safeParse({ name: '', email: 'ada@example.com', password: 'password123' }).success,
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:unit`
Expected: FAIL — `./validation` module not found.

- [ ] **Step 3: Create `apps/dashboard/src/lib/validation.ts`**

```ts
import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, 'Password is required'),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const registerSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const createOrgSchema = z.object({
  name: z.string().min(1, 'Organization name is required'),
});
export type CreateOrgInput = z.infer<typeof createOrgSchema>;

export const createZoneSchema = z.object({
  name: z.string().min(1).max(54),
  originUrl: z.string().url({ message: 'Enter a valid http(s) URL' }),
  cacheTtl: z.coerce.number().int().min(0).optional(),
  browserTtl: z.coerce.number().int().min(0).optional(),
});
export type CreateZoneInput = z.infer<typeof createZoneSchema>;

export const updateZoneSchema = createZoneSchema.partial().extend({
  enabled: z.boolean().optional(),
});
export type UpdateZoneInput = z.infer<typeof updateZoneSchema>;

export const createBucketSchema = z.object({
  name: z.string().min(1).max(63),
  public: z.boolean().optional(),
});
export type CreateBucketInput = z.infer<typeof createBucketSchema>;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test:unit`
Expected: PASS

- [ ] **Step 5: Create `apps/dashboard/src/lib/http.ts`**

```ts
export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`Request failed with status ${status}`);
    this.name = 'ApiError';
  }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new ApiError(response.status, body);
  }
  return body as T;
}
```

- [ ] **Step 6: Create `apps/dashboard/src/components/providers/query-provider.tsx`**

```tsx
'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1 } } }));
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
```

- [ ] **Step 7: Modify `apps/dashboard/src/app/layout.tsx` to wrap children in `QueryProvider`**

```tsx
import type { Metadata } from 'next';
import { QueryProvider } from '@/components/providers/query-provider';
import './globals.css';

export const metadata: Metadata = {
  title: 'RivoCloud',
  description: 'CDN, storage, and analytics — one dashboard.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 8: Create `apps/dashboard/src/hooks/use-me.ts`**

```ts
'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/http';
import type { UserProfile } from '@/lib/types';

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => apiFetch<UserProfile & { orgId: string | null }>('/api/me'),
  });
}
```

- [ ] **Step 9: Write the failing test for `LoginForm`**

Create `apps/dashboard/src/components/auth/login-form.test.tsx`:
```tsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginForm } from './login-form';

describe('LoginForm', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('shows a validation error and never calls fetch for an invalid email', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<LoginForm onSuccess={vi.fn()} />);

    await userEvent.type(screen.getByLabelText(/email/i), 'not-an-email');
    await userEvent.type(screen.getByLabelText(/password/i), 'password123');
    await userEvent.click(screen.getByRole('button', { name: /log in/i }));

    expect(await screen.findByText(/valid email/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('submits valid credentials and calls onSuccess with the login response', async () => {
    const onSuccess = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ org: null, orgs: [] }), { status: 200 })),
    );
    render(<LoginForm onSuccess={onSuccess} />);

    await userEvent.type(screen.getByLabelText(/email/i), 'ada@example.com');
    await userEvent.type(screen.getByLabelText(/password/i), 'password123');
    await userEvent.click(screen.getByRole('button', { name: /log in/i }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith({ org: null, orgs: [] }));
  });
});
```

- [ ] **Step 10: Run the test to verify it fails**

Run: `pnpm test:unit`
Expected: FAIL — `./login-form` module not found.

- [ ] **Step 11: Create `apps/dashboard/src/components/auth/login-form.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiFetch, ApiError } from '@/lib/http';
import { loginSchema } from '@/lib/validation';
import type { Organization } from '@/lib/types';

export interface LoginResult {
  org: string | null;
  orgs?: Organization[];
}

export function LoginForm({ onSuccess }: { onSuccess: (result: LoginResult) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Enter a valid email and password');
      return;
    }

    setSubmitting(true);
    try {
      const result = await apiFetch<LoginResult>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify(parsed.data),
      });
      onSuccess(result);
    } catch (err) {
      const message = err instanceof ApiError ? ((err.body as { message?: string })?.message ?? 'Login failed') : 'Login failed';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">Password</Label>
        <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={submitting}>
        {submitting ? 'Logging in…' : 'Log in'}
      </Button>
    </form>
  );
}
```

- [ ] **Step 12: Run the test to verify it passes**

Run: `pnpm test:unit`
Expected: PASS

- [ ] **Step 13: Create `apps/dashboard/src/components/auth/register-form.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiFetch, ApiError } from '@/lib/http';
import { registerSchema } from '@/lib/validation';
import type { LoginResult } from './login-form';

export function RegisterForm({ onSuccess }: { onSuccess: (result: LoginResult) => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const parsed = registerSchema.safeParse({ name, email, password });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the form for errors');
      return;
    }

    setSubmitting(true);
    try {
      await apiFetch('/api/auth/register', { method: 'POST', body: JSON.stringify(parsed.data) });
      const loginResult = await apiFetch<LoginResult>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: parsed.data.email, password: parsed.data.password }),
      });
      onSuccess(loginResult);
    } catch (err) {
      const message = err instanceof ApiError ? ((err.body as { message?: string })?.message ?? 'Registration failed') : 'Registration failed';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">Name</Label>
        <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">Password</Label>
        <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={submitting}>
        {submitting ? 'Creating account…' : 'Create account'}
      </Button>
    </form>
  );
}
```

- [ ] **Step 14: Create the login and register pages**

`apps/dashboard/src/app/login/page.tsx`:
```tsx
'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LoginForm, type LoginResult } from '@/components/auth/login-form';
import { routeAfterLogin } from '@/lib/route-after-login';

export default function LoginPage() {
  const router = useRouter();

  function handleSuccess(result: LoginResult) {
    void routeAfterLogin(result, router);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <Card>
        <CardHeader>
          <CardTitle>Log in to RivoCloud</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <LoginForm onSuccess={handleSuccess} />
          <p className="text-sm text-muted-foreground">
            No account? <Link href="/register" className="underline">Register</Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
```

`apps/dashboard/src/app/register/page.tsx`:
```tsx
'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RegisterForm } from '@/components/auth/register-form';
import type { LoginResult } from '@/components/auth/login-form';
import { routeAfterLogin } from '@/lib/route-after-login';

export default function RegisterPage() {
  const router = useRouter();

  function handleSuccess(result: LoginResult) {
    void routeAfterLogin(result, router);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <Card>
        <CardHeader>
          <CardTitle>Create your RivoCloud account</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <RegisterForm onSuccess={handleSuccess} />
          <p className="text-sm text-muted-foreground">
            Already have an account? <Link href="/login" className="underline">Log in</Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
```

*(`routeAfterLogin` is created in Task 7, which owns org routing — both pages import it now so Task 7 only has to add the one file.)*

- [ ] **Step 15: Run lint/typecheck and the full unit suite**

Run: `pnpm test:unit && pnpm typecheck && pnpm lint` (from `apps/dashboard`)
Expected: fails only on the missing `@/lib/route-after-login` import — expected until Task 7. Confirm the *only* error is that missing module before moving on.

- [ ] **Step 16: Commit**

```bash
git add apps/dashboard/src/lib/validation.ts apps/dashboard/src/lib/validation.test.ts \
        apps/dashboard/src/lib/http.ts apps/dashboard/src/components/providers \
        apps/dashboard/src/hooks/use-me.ts apps/dashboard/src/components/auth \
        apps/dashboard/src/app/login apps/dashboard/src/app/register apps/dashboard/src/app/layout.tsx
git commit -m "feat: add login/register pages and TanStack Query provider (Stage 6.1)"
```

---

### Task 7: Org routing, org switcher, create-org onboarding

**Files:**
- Create: `apps/dashboard/src/lib/route-after-login.ts`, `route-after-login.test.ts`
- Create: `apps/dashboard/src/app/api/orgs/route.ts`
- Create: `apps/dashboard/src/app/api/orgs/select/route.ts`
- Create: `apps/dashboard/src/hooks/use-orgs.ts`, `use-create-org.ts`, `use-select-org.ts`
- Create: `apps/dashboard/src/components/orgs/create-org-form.tsx`, `org-switcher.tsx`
- Create: `apps/dashboard/src/app/orgs/new/page.tsx`, `apps/dashboard/src/app/orgs/page.tsx`

**Interfaces:**
- Consumes: `proxyToBackend` (Task 4), `getEnv` (Task 3), `apiFetch`/`ApiError` (Task 6), `createOrgSchema` (Task 6), `Organization` (Task 4 `types.ts`), `LoginResult` (Task 6 `login-form.tsx`).
- Produces: `routeAfterLogin(result: LoginResult, router: AppRouterInstance): Promise<void>`; `GET/POST /api/orgs`; `POST /api/orgs/select` (body `{orgId}` → `{org: string}`, sets cookies); `useOrgs()`, `useCreateOrg()`, `useSelectOrg()` — consumed by Task 9's zone pages and Task 12's storage pages (which all assume an org is already selected once they render).

- [ ] **Step 1: Write the failing test for `routeAfterLogin`**

Create `apps/dashboard/src/lib/route-after-login.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { routeAfterLogin } from './route-after-login';

vi.mock('./http', () => ({
  apiFetch: vi.fn(),
}));

import { apiFetch } from './http';

describe('routeAfterLogin', () => {
  it('goes straight to /dashboard when an org is already selected', async () => {
    const router = { push: vi.fn() };
    await routeAfterLogin({ org: 'org-1' }, router as never);
    expect(router.push).toHaveBeenCalledWith('/dashboard');
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('goes to /orgs/new when the user has zero organizations', async () => {
    const router = { push: vi.fn() };
    await routeAfterLogin({ org: null, orgs: [] }, router as never);
    expect(router.push).toHaveBeenCalledWith('/orgs/new');
  });

  it('auto-selects and continues to /dashboard when there is exactly one organization', async () => {
    const router = { push: vi.fn() };
    vi.mocked(apiFetch).mockResolvedValue({ org: 'org-1' });

    await routeAfterLogin({ org: null, orgs: [{ id: 'org-1', name: 'Acme', slug: 'acme', createdAt: '', updatedAt: '' }] }, router as never);

    expect(apiFetch).toHaveBeenCalledWith('/api/orgs/select', { method: 'POST', body: JSON.stringify({ orgId: 'org-1' }) });
    expect(router.push).toHaveBeenCalledWith('/dashboard');
  });

  it('goes to the /orgs switcher when there is more than one organization', async () => {
    const router = { push: vi.fn() };
    const orgs = [
      { id: 'org-1', name: 'Acme', slug: 'acme', createdAt: '', updatedAt: '' },
      { id: 'org-2', name: 'Globex', slug: 'globex', createdAt: '', updatedAt: '' },
    ];
    await routeAfterLogin({ org: null, orgs }, router as never);
    expect(router.push).toHaveBeenCalledWith('/orgs');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:unit`
Expected: FAIL — `./route-after-login` module not found.

- [ ] **Step 3: Create `apps/dashboard/src/lib/route-after-login.ts`**

```ts
import type { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { apiFetch } from './http';
import type { LoginResult } from '@/components/auth/login-form';

export async function routeAfterLogin(result: LoginResult, router: AppRouterInstance): Promise<void> {
  if (result.org) {
    router.push('/dashboard');
    return;
  }

  const orgs = result.orgs ?? [];
  if (orgs.length === 0) {
    router.push('/orgs/new');
    return;
  }
  if (orgs.length === 1) {
    await apiFetch('/api/orgs/select', { method: 'POST', body: JSON.stringify({ orgId: orgs[0].id }) });
    router.push('/dashboard');
    return;
  }
  router.push('/orgs');
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test:unit`
Expected: PASS

- [ ] **Step 5: Create the orgs Route Handlers**

`apps/dashboard/src/app/api/orgs/route.ts`:
```ts
import { NextRequest } from 'next/server';
import { getEnv } from '@/lib/env';
import { proxyToBackend } from '@/lib/proxy';

export async function GET() {
  return proxyToBackend(getEnv().IDENTITY_SERVICE_URL, '/api/v1/orgs', {}, { requireOrg: false });
}

export async function POST(request: NextRequest) {
  const body = await request.text();
  return proxyToBackend(getEnv().IDENTITY_SERVICE_URL, '/api/v1/orgs', { method: 'POST', body }, { requireOrg: false });
}
```

`apps/dashboard/src/app/api/orgs/select/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server';
import { getEnv } from '@/lib/env';
import { backendFetch, BackendError } from '@/lib/backend-fetch';
import { applySessionCookies, resolveSession } from '@/lib/auth-session';
import type { AuthTokens } from '@/lib/types';

export async function POST(request: NextRequest) {
  const session = await resolveSession();
  if (!session) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });

  const { orgId } = (await request.json()) as { orgId: string };

  try {
    const tokens = (await backendFetch(getEnv().IDENTITY_SERVICE_URL, '/api/v1/auth/select-org', {
      method: 'POST',
      body: JSON.stringify({ orgId }),
      accessToken: session.accessToken,
    })) as AuthTokens;

    const response = NextResponse.json({ org: orgId });
    applySessionCookies(response, tokens);
    return response;
  } catch (err) {
    if (err instanceof BackendError) {
      return NextResponse.json(err.body ?? { message: 'Failed to select organization' }, { status: err.status });
    }
    throw err;
  }
}
```

- [ ] **Step 6: Create the org hooks**

`apps/dashboard/src/hooks/use-orgs.ts`:
```ts
'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/http';
import type { Organization } from '@/lib/types';

export function useOrgs() {
  return useQuery({
    queryKey: ['orgs'],
    queryFn: () => apiFetch<Organization[]>('/api/orgs'),
  });
}
```

`apps/dashboard/src/hooks/use-create-org.ts`:
```ts
'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/http';
import type { CreateOrgInput } from '@/lib/validation';
import type { Organization } from '@/lib/types';

export function useCreateOrg() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateOrgInput) =>
      apiFetch<{ organization: Organization }>('/api/orgs', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['orgs'] });
    },
  });
}
```

`apps/dashboard/src/hooks/use-select-org.ts`:
```ts
'use client';

import { useMutation } from '@tanstack/react-query';
import { apiFetch } from '@/lib/http';

export function useSelectOrg() {
  return useMutation({
    mutationFn: (orgId: string) => apiFetch<{ org: string }>('/api/orgs/select', { method: 'POST', body: JSON.stringify({ orgId }) }),
  });
}
```

- [ ] **Step 7: Create `apps/dashboard/src/components/orgs/create-org-form.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createOrgSchema } from '@/lib/validation';
import { useCreateOrg } from '@/hooks/use-create-org';
import { useSelectOrg } from '@/hooks/use-select-org';
import { ApiError } from '@/lib/http';

export function CreateOrgForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const createOrg = useCreateOrg();
  const selectOrg = useSelectOrg();

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const parsed = createOrgSchema.safeParse({ name });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Enter an organization name');
      return;
    }

    try {
      const { organization } = await createOrg.mutateAsync(parsed.data);
      await selectOrg.mutateAsync(organization.id);
      router.push('/dashboard');
    } catch (err) {
      const message = err instanceof ApiError ? ((err.body as { message?: string })?.message ?? 'Could not create organization') : 'Could not create organization';
      setError(message);
    }
  }

  const submitting = createOrg.isPending || selectOrg.isPending;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="org-name">Organization name</Label>
        <Input id="org-name" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={submitting}>
        {submitting ? 'Creating…' : 'Create organization'}
      </Button>
    </form>
  );
}
```

- [ ] **Step 8: Create `apps/dashboard/src/components/orgs/org-switcher.tsx`**

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useOrgs } from '@/hooks/use-orgs';
import { useSelectOrg } from '@/hooks/use-select-org';

export function OrgSwitcher() {
  const router = useRouter();
  const { data: orgs, isLoading } = useOrgs();
  const selectOrg = useSelectOrg();

  async function pick(orgId: string) {
    await selectOrg.mutateAsync(orgId);
    router.push('/dashboard');
  }

  if (isLoading) return <p className="text-muted-foreground">Loading organizations…</p>;

  return (
    <div className="flex flex-col gap-3">
      {orgs?.map((org) => (
        <Card key={org.id}>
          <CardContent className="flex items-center justify-between p-4">
            <span className="font-medium">{org.name}</span>
            <Button size="sm" onClick={() => pick(org.id)} disabled={selectOrg.isPending}>
              Select
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
```

- [ ] **Step 9: Create the org pages**

`apps/dashboard/src/app/orgs/new/page.tsx`:
```tsx
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { CreateOrgForm } from '@/components/orgs/create-org-form';

export default function NewOrgPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <Card>
        <CardHeader>
          <CardTitle>Create your organization</CardTitle>
          <CardDescription>Every zone and bucket belongs to an organization.</CardDescription>
        </CardHeader>
        <CardContent>
          <CreateOrgForm />
        </CardContent>
      </Card>
    </main>
  );
}
```

`apps/dashboard/src/app/orgs/page.tsx`:
```tsx
import { OrgSwitcher } from '@/components/orgs/org-switcher';

export default function OrgsPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-4">
      <h1 className="text-xl font-semibold">Choose an organization</h1>
      <OrgSwitcher />
    </main>
  );
}
```

- [ ] **Step 10: Run the full unit suite, lint, and typecheck**

Run: `pnpm test:unit && pnpm typecheck && pnpm lint` (from `apps/dashboard`)
Expected: all pass — this also resolves the pending `@/lib/route-after-login` import from Task 6.

- [ ] **Step 11: Commit**

```bash
git add apps/dashboard/src/lib/route-after-login.ts apps/dashboard/src/lib/route-after-login.test.ts \
        apps/dashboard/src/app/api/orgs apps/dashboard/src/hooks/use-orgs.ts \
        apps/dashboard/src/hooks/use-create-org.ts apps/dashboard/src/hooks/use-select-org.ts \
        apps/dashboard/src/components/orgs apps/dashboard/src/app/orgs
git commit -m "feat: add org routing, switcher, and create-org onboarding (Stage 6.1)"
```

---

### Task 8: Authenticated shell — middleware, nav, dashboard overview

**Files:**
- Create: `apps/dashboard/src/middleware.ts`
- Create: `apps/dashboard/src/components/layout/app-shell.tsx`
- Create: `apps/dashboard/src/app/(app)/layout.tsx`
- Create: `apps/dashboard/src/app/(app)/dashboard/page.tsx`

**Interfaces:**
- Consumes: `useMe` (Task 6), `useOrgs` (Task 7), `ACCESS_COOKIE` (Task 3), `Button` (Task 2).
- Produces: an authenticated `(app)` route group every subsequent page (zones, storage) renders inside; unauthenticated requests to any `(app)` route redirect to `/login`.

- [ ] **Step 1: Create `apps/dashboard/src/middleware.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '@/lib/cookies';

const PROTECTED_PREFIXES = ['/dashboard', '/zones', '/storage', '/orgs'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  if (!isProtected) return NextResponse.next();

  const hasSession = Boolean(request.cookies.get(ACCESS_COOKIE) ?? request.cookies.get(REFRESH_COOKIE));
  if (hasSession) return NextResponse.next();

  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('next', pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/dashboard/:path*', '/zones/:path*', '/storage/:path*', '/orgs/:path*'],
};
```

*(`/orgs` and `/orgs/new` are intentionally included — they still require a logged-in user, just not yet an org.)*

- [ ] **Step 2: Create `apps/dashboard/src/components/layout/app-shell.tsx`**

```tsx
'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { useMe } from '@/hooks/use-me';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Overview' },
  { href: '/zones', label: 'Zones' },
  { href: '/storage', label: 'Storage' },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: me } = useMe();

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  }

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b border-border px-6 py-3">
        <div className="flex items-center gap-6">
          <span className="font-semibold">RivoCloud</span>
          <nav className="flex gap-4">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'text-sm text-muted-foreground hover:text-foreground',
                  pathname?.startsWith(item.href) && 'font-medium text-foreground',
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          {me && <span className="text-sm text-muted-foreground">{me.email}</span>}
          <Button variant="outline" size="sm" onClick={handleLogout}>
            Log out
          </Button>
        </div>
      </header>
      <main className="px-6 py-8">{children}</main>
    </div>
  );
}
```

- [ ] **Step 3: Create `apps/dashboard/src/app/(app)/layout.tsx`**

```tsx
import { AppShell } from '@/components/layout/app-shell';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
```

- [ ] **Step 4: Create `apps/dashboard/src/app/(app)/dashboard/page.tsx`**

Per the dashboard concept doc §4: "in Stage 6's own scope, this is a simpler authenticated landing page" — no analytics summary (that needs the Analytics Service, Stage 9).

```tsx
'use client';

import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useZones } from '@/hooks/use-zones';
import { useBuckets } from '@/hooks/use-buckets';

export default function DashboardOverviewPage() {
  const { data: zonesData } = useZones();
  const { data: bucketsData } = useBuckets();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Overview</h1>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Link href="/zones">
          <Card>
            <CardHeader>
              <CardTitle>Zones</CardTitle>
            </CardHeader>
            <CardContent className="text-3xl font-bold">{zonesData?.total ?? '—'}</CardContent>
          </Card>
        </Link>
        <Link href="/storage">
          <Card>
            <CardHeader>
              <CardTitle>Buckets</CardTitle>
            </CardHeader>
            <CardContent className="text-3xl font-bold">{bucketsData?.total ?? '—'}</CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
```

*(`useZones`/`useBuckets` are created in Tasks 9 and 12; this page is wired now and will typecheck once those land. Add it to Task 9/12's verification, not this task's.)*

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/middleware.ts apps/dashboard/src/components/layout apps/dashboard/src/app/\(app\)
git commit -m "feat: add authenticated shell — middleware, nav, dashboard overview (Stage 6.2 prep)"
```

Note: `pnpm typecheck` will fail after this commit until Task 9 adds `use-zones.ts` and Task 12 adds `use-buckets.ts` — this is expected and resolved by the very next task; do not attempt to fix it here.

---

### Task 9: Zone Route Handlers + zone list/create UI

**Files:**
- Create: `apps/dashboard/src/app/api/zones/route.ts`
- Create: `apps/dashboard/src/app/api/zones/[zoneId]/route.ts`
- Create: `apps/dashboard/src/hooks/use-zones.ts`, `use-create-zone.ts`
- Create: `apps/dashboard/src/components/zones/zone-list.tsx`, `create-zone-dialog.tsx`
- Create: `apps/dashboard/src/app/(app)/zones/page.tsx`
- Test: `apps/dashboard/src/components/zones/zone-list.test.tsx`

**Interfaces:**
- Consumes: `proxyToBackend`/`getEnv` (Tasks 3–4), `Zone` (Task 4 `types.ts`), `createZoneSchema` (Task 6), `Table*`/`Dialog*`/`Badge`/`Button` (Task 2), `apiFetch` (Task 6).
- Produces: `GET/POST /api/zones`, `GET/PATCH/DELETE /api/zones/[zoneId]`; `useZones()`, `useCreateZone()` — consumed by Task 8's dashboard overview and Task 10's zone detail page.

- [ ] **Step 1: Create the zones Route Handlers**

`apps/dashboard/src/app/api/zones/route.ts`:
```ts
import { NextRequest } from 'next/server';
import { getEnv } from '@/lib/env';
import { proxyToBackend } from '@/lib/proxy';

export async function GET(request: NextRequest) {
  return proxyToBackend(getEnv().CDN_SERVICE_URL, `/api/v1/zones${request.nextUrl.search}`);
}

export async function POST(request: NextRequest) {
  const body = await request.text();
  return proxyToBackend(getEnv().CDN_SERVICE_URL, '/api/v1/zones', { method: 'POST', body });
}
```

`apps/dashboard/src/app/api/zones/[zoneId]/route.ts`:
```ts
import { NextRequest } from 'next/server';
import { getEnv } from '@/lib/env';
import { proxyToBackend } from '@/lib/proxy';

interface RouteParams {
  params: Promise<{ zoneId: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { zoneId } = await params;
  return proxyToBackend(getEnv().CDN_SERVICE_URL, `/api/v1/zones/${zoneId}`);
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { zoneId } = await params;
  const body = await request.text();
  return proxyToBackend(getEnv().CDN_SERVICE_URL, `/api/v1/zones/${zoneId}`, { method: 'PATCH', body });
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const { zoneId } = await params;
  return proxyToBackend(getEnv().CDN_SERVICE_URL, `/api/v1/zones/${zoneId}`, { method: 'DELETE' });
}
```

- [ ] **Step 2: Create the zone hooks**

`apps/dashboard/src/hooks/use-zones.ts`:
```ts
'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/http';
import type { Zone } from '@/lib/types';

export function useZones() {
  return useQuery({
    queryKey: ['zones'],
    queryFn: () => apiFetch<{ zones: Zone[]; total: number }>('/api/zones'),
  });
}
```

`apps/dashboard/src/hooks/use-create-zone.ts`:
```ts
'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/http';
import type { CreateZoneInput } from '@/lib/validation';
import type { Zone } from '@/lib/types';

export function useCreateZone() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateZoneInput) => apiFetch<Zone>('/api/zones', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['zones'] });
    },
  });
}
```

- [ ] **Step 3: Write the failing test for `ZoneList`**

Create `apps/dashboard/src/components/zones/zone-list.test.tsx`:
```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ZoneList } from './zone-list';
import type { Zone } from '@/lib/types';

function makeZone(overrides: Partial<Zone> = {}): Zone {
  return {
    id: 'zone-1',
    orgId: 'org-1',
    projectId: null,
    name: 'my-zone',
    slug: 'my-zone',
    originUrl: 'https://origin.example.com',
    originProtocol: 'https',
    cacheTtl: 3600,
    browserTtl: 3600,
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('ZoneList', () => {
  it('renders an empty state when there are no zones', () => {
    render(<ZoneList zones={[]} />);
    expect(screen.getByText(/no zones yet/i)).toBeInTheDocument();
  });

  it('renders one row per zone with its name, origin, and status', () => {
    render(<ZoneList zones={[makeZone({ name: 'blog' }), makeZone({ id: 'zone-2', name: 'assets', enabled: false })]} />);

    expect(screen.getByText('blog')).toBeInTheDocument();
    expect(screen.getByText('assets')).toBeInTheDocument();
    expect(screen.getAllByText('https://origin.example.com')).toHaveLength(2);
    expect(screen.getByText('Enabled')).toBeInTheDocument();
    expect(screen.getByText('Disabled')).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm test:unit`
Expected: FAIL — `./zone-list` module not found.

- [ ] **Step 5: Create `apps/dashboard/src/components/zones/zone-list.tsx`**

```tsx
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
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm test:unit`
Expected: PASS

- [ ] **Step 7: Create `apps/dashboard/src/components/zones/create-zone-dialog.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { createZoneSchema } from '@/lib/validation';
import { useCreateZone } from '@/hooks/use-create-zone';
import { ApiError } from '@/lib/http';

export function CreateZoneDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [originUrl, setOriginUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const createZone = useCreateZone();

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const parsed = createZoneSchema.safeParse({ name, originUrl });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the form for errors');
      return;
    }

    try {
      await createZone.mutateAsync(parsed.data);
      setOpen(false);
      setName('');
      setOriginUrl('');
    } catch (err) {
      const message = err instanceof ApiError ? ((err.body as { message?: string })?.message ?? 'Could not create zone') : 'Could not create zone';
      setError(message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Create zone</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a pull zone</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="zone-name">Name</Label>
            <Input id="zone-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="zone-origin">Origin URL</Label>
            <Input
              id="zone-origin"
              placeholder="https://origin.example.com"
              value={originUrl}
              onChange={(e) => setOriginUrl(e.target.value)}
              required
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={createZone.isPending}>
              {createZone.isPending ? 'Creating…' : 'Create zone'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 8: Create `apps/dashboard/src/app/(app)/zones/page.tsx`**

```tsx
'use client';

import { Skeleton } from '@/components/ui/skeleton';
import { ZoneList } from '@/components/zones/zone-list';
import { CreateZoneDialog } from '@/components/zones/create-zone-dialog';
import { useZones } from '@/hooks/use-zones';

export default function ZonesPage() {
  const { data, isLoading, error } = useZones();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Zones</h1>
        <CreateZoneDialog />
      </div>
      {isLoading && <Skeleton className="h-40 w-full" />}
      {error && <p className="text-destructive">Failed to load zones.</p>}
      {data && <ZoneList zones={data.zones} />}
    </div>
  );
}
```

- [ ] **Step 9: Run the full unit suite, lint, and typecheck**

Run: `pnpm test:unit && pnpm typecheck && pnpm lint` (from `apps/dashboard`)
Expected: all pass, including Task 8's previously-failing `use-zones` import in the dashboard overview page.

- [ ] **Step 10: Commit**

```bash
git add apps/dashboard/src/app/api/zones apps/dashboard/src/hooks/use-zones.ts \
        apps/dashboard/src/hooks/use-create-zone.ts apps/dashboard/src/components/zones \
        apps/dashboard/src/app/\(app\)/zones
git commit -m "feat: add zone Route Handlers and zone list/create UI (Stage 6.2)"
```

---

### Task 10: Zone detail — view, edit, delete

**Files:**
- Create: `apps/dashboard/src/hooks/use-zone.ts`, `use-update-zone.ts`, `use-delete-zone.ts`
- Create: `apps/dashboard/src/components/zones/zone-detail.tsx`
- Create: `apps/dashboard/src/app/(app)/zones/[zoneId]/page.tsx`
- Test: `apps/dashboard/src/components/zones/zone-detail.test.tsx`

**Interfaces:**
- Consumes: `Zone` (Task 4), `updateZoneSchema` (Task 6), `Card*`/`Button`/`Input`/`Label`/`Dialog*` (Task 2), `GET/PATCH/DELETE /api/zones/[zoneId]` (Task 9).
- Produces: `useZone(zoneId)`, `useUpdateZone(zoneId)`, `useDeleteZone(zoneId)`; the `/zones/:id` page — the last Stage 6.2 deliverable ("non-technical user can set up a CDN zone in 2 minutes", EDD §11.6.2).

- [ ] **Step 1: Create the remaining zone hooks**

`apps/dashboard/src/hooks/use-zone.ts`:
```ts
'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/http';
import type { Zone } from '@/lib/types';

export function useZone(zoneId: string) {
  return useQuery({
    queryKey: ['zones', zoneId],
    queryFn: () => apiFetch<Zone>(`/api/zones/${zoneId}`),
  });
}
```

`apps/dashboard/src/hooks/use-update-zone.ts`:
```ts
'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/http';
import type { UpdateZoneInput } from '@/lib/validation';
import type { Zone } from '@/lib/types';

export function useUpdateZone(zoneId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateZoneInput) =>
      apiFetch<Zone>(`/api/zones/${zoneId}`, { method: 'PATCH', body: JSON.stringify(input) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['zones', zoneId] });
      void queryClient.invalidateQueries({ queryKey: ['zones'] });
    },
  });
}
```

`apps/dashboard/src/hooks/use-delete-zone.ts`:
```ts
'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/http';

export function useDeleteZone(zoneId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ success: true }>(`/api/zones/${zoneId}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['zones'] });
    },
  });
}
```

- [ ] **Step 2: Write the failing test for `ZoneDetail`**

Create `apps/dashboard/src/components/zones/zone-detail.test.tsx`:
```tsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ZoneDetail } from './zone-detail';
import type { Zone } from '@/lib/types';

const zone: Zone = {
  id: 'zone-1',
  orgId: 'org-1',
  projectId: null,
  name: 'my-zone',
  slug: 'my-zone',
  originUrl: 'https://origin.example.com',
  originProtocol: 'https',
  cacheTtl: 3600,
  browserTtl: 3600,
  enabled: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('ZoneDetail', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the zone name and origin URL', () => {
    render(<ZoneDetail zone={zone} />);
    expect(screen.getByDisplayValue('my-zone')).toBeInTheDocument();
    expect(screen.getByDisplayValue('https://origin.example.com')).toBeInTheDocument();
  });

  it('calls the PATCH endpoint with edited fields on save', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...zone, name: 'renamed' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    render(<ZoneDetail zone={zone} />);
    const nameInput = screen.getByDisplayValue('my-zone');
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'renamed');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/zones/zone-1',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ name: 'renamed', originUrl: 'https://origin.example.com' }) }),
    );
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm test:unit`
Expected: FAIL — `./zone-detail` module not found.

- [ ] **Step 4: Create `apps/dashboard/src/components/zones/zone-detail.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { updateZoneSchema } from '@/lib/validation';
import { useUpdateZone } from '@/hooks/use-update-zone';
import { useDeleteZone } from '@/hooks/use-delete-zone';
import { ApiError } from '@/lib/http';
import type { Zone } from '@/lib/types';

export function ZoneDetail({ zone }: { zone: Zone }) {
  const router = useRouter();
  const [name, setName] = useState(zone.name);
  const [originUrl, setOriginUrl] = useState(zone.originUrl);
  const [error, setError] = useState<string | null>(null);
  const updateZone = useUpdateZone(zone.id);
  const deleteZone = useDeleteZone(zone.id);

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const parsed = updateZoneSchema.safeParse({ name, originUrl });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the form for errors');
      return;
    }

    try {
      await updateZone.mutateAsync(parsed.data);
    } catch (err) {
      const message = err instanceof ApiError ? ((err.body as { message?: string })?.message ?? 'Could not save zone') : 'Could not save zone';
      setError(message);
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Delete zone "${zone.name}"? This cannot be undone.`)) return;
    await deleteZone.mutateAsync();
    router.push('/zones');
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{zone.name}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSave} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="zone-name">Name</Label>
            <Input id="zone-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="zone-origin">Origin URL</Label>
            <Input id="zone-origin" value={originUrl} onChange={(e) => setOriginUrl(e.target.value)} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={updateZone.isPending}>
            {updateZone.isPending ? 'Saving…' : 'Save'}
          </Button>
        </form>
      </CardContent>
      <CardFooter>
        <Button variant="destructive" onClick={handleDelete} disabled={deleteZone.isPending}>
          Delete zone
        </Button>
      </CardFooter>
    </Card>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test:unit`
Expected: PASS

- [ ] **Step 6: Create `apps/dashboard/src/app/(app)/zones/[zoneId]/page.tsx`**

```tsx
'use client';

import { use } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { ZoneDetail } from '@/components/zones/zone-detail';
import { useZone } from '@/hooks/use-zone';

export default function ZoneDetailPage({ params }: { params: Promise<{ zoneId: string }> }) {
  const { zoneId } = use(params);
  const { data: zone, isLoading, error } = useZone(zoneId);

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (error || !zone) return <p className="text-destructive">Zone not found.</p>;

  return <ZoneDetail zone={zone} />;
}
```

- [ ] **Step 7: Run the full unit suite, lint, and typecheck**

Run: `pnpm test:unit && pnpm typecheck && pnpm lint` (from `apps/dashboard`)
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add apps/dashboard/src/hooks/use-zone.ts apps/dashboard/src/hooks/use-update-zone.ts \
        apps/dashboard/src/hooks/use-delete-zone.ts apps/dashboard/src/components/zones/zone-detail.tsx \
        apps/dashboard/src/components/zones/zone-detail.test.tsx apps/dashboard/src/app/\(app\)/zones/\[zoneId\]
git commit -m "feat: add zone detail view/edit/delete (Stage 6.2)"
```

---

### Task 11: Bucket Route Handlers + object Route Handlers

**Files:**
- Create: `apps/dashboard/src/app/api/buckets/route.ts`
- Create: `apps/dashboard/src/app/api/buckets/[bucketId]/route.ts`
- Create: `apps/dashboard/src/app/api/buckets/[bucketId]/objects/route.ts`
- Create: `apps/dashboard/src/app/api/buckets/[bucketId]/objects/upload/route.ts`
- Create: `apps/dashboard/src/app/api/buckets/[bucketId]/objects/[key]/route.ts`

**Interfaces:**
- Consumes: `proxyToBackend`/`getEnv` (Tasks 3–4).
- Produces: `GET/POST /api/buckets`, `GET /api/buckets/[bucketId]`, `GET /api/buckets/[bucketId]/objects`, `POST /api/buckets/[bucketId]/objects/upload`, `DELETE /api/buckets/[bucketId]/objects/[key]` — consumed by Tasks 12–13's storage hooks.

- [ ] **Step 1: Create `apps/dashboard/src/app/api/buckets/route.ts`**

```ts
import { NextRequest } from 'next/server';
import { getEnv } from '@/lib/env';
import { proxyToBackend } from '@/lib/proxy';

export async function GET(request: NextRequest) {
  return proxyToBackend(getEnv().STORAGE_SERVICE_URL, `/api/v1/buckets${request.nextUrl.search}`);
}

export async function POST(request: NextRequest) {
  const body = await request.text();
  return proxyToBackend(getEnv().STORAGE_SERVICE_URL, '/api/v1/buckets', { method: 'POST', body });
}
```

- [ ] **Step 2: Create `apps/dashboard/src/app/api/buckets/[bucketId]/route.ts`**

```ts
import { NextRequest } from 'next/server';
import { getEnv } from '@/lib/env';
import { proxyToBackend } from '@/lib/proxy';

interface RouteParams {
  params: Promise<{ bucketId: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { bucketId } = await params;
  return proxyToBackend(getEnv().STORAGE_SERVICE_URL, `/api/v1/buckets/${bucketId}`);
}
```

- [ ] **Step 3: Create `apps/dashboard/src/app/api/buckets/[bucketId]/objects/route.ts`**

```ts
import { NextRequest } from 'next/server';
import { getEnv } from '@/lib/env';
import { proxyToBackend } from '@/lib/proxy';

interface RouteParams {
  params: Promise<{ bucketId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { bucketId } = await params;
  return proxyToBackend(getEnv().STORAGE_SERVICE_URL, `/api/v1/buckets/${bucketId}/objects${request.nextUrl.search}`);
}
```

- [ ] **Step 4: Create `apps/dashboard/src/app/api/buckets/[bucketId]/objects/upload/route.ts`**

```ts
import { NextRequest } from 'next/server';
import { getEnv } from '@/lib/env';
import { proxyToBackend } from '@/lib/proxy';

interface RouteParams {
  params: Promise<{ bucketId: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { bucketId } = await params;
  const body = await request.text();
  return proxyToBackend(getEnv().STORAGE_SERVICE_URL, `/api/v1/buckets/${bucketId}/objects/upload`, {
    method: 'POST',
    body,
  });
}
```

- [ ] **Step 5: Create `apps/dashboard/src/app/api/buckets/[bucketId]/objects/[key]/route.ts`**

```ts
import { NextRequest } from 'next/server';
import { getEnv } from '@/lib/env';
import { proxyToBackend } from '@/lib/proxy';

interface RouteParams {
  params: Promise<{ bucketId: string; key: string }>;
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const { bucketId, key } = await params;
  return proxyToBackend(getEnv().STORAGE_SERVICE_URL, `/api/v1/buckets/${bucketId}/objects/${encodeURIComponent(key)}`, {
    method: 'DELETE',
  });
}
```

- [ ] **Step 6: Run lint and typecheck**

Run: `pnpm lint && pnpm typecheck` (from `apps/dashboard`)
Expected: passes (no dedicated tests here — Design Decision 7 applies identically to these five thin wrappers).

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard/src/app/api/buckets
git commit -m "feat: add bucket and object Route Handlers (Stage 6.3)"
```

---

### Task 12: Bucket list + create UI

**Files:**
- Create: `apps/dashboard/src/hooks/use-buckets.ts`, `use-create-bucket.ts`
- Create: `apps/dashboard/src/components/storage/bucket-list.tsx`, `create-bucket-dialog.tsx`
- Create: `apps/dashboard/src/app/(app)/storage/page.tsx`
- Test: `apps/dashboard/src/components/storage/bucket-list.test.tsx`

**Interfaces:**
- Consumes: `Bucket` (Task 4), `createBucketSchema` (Task 6), `Table*`/`Badge`/`Dialog*` (Task 2), `GET/POST /api/buckets` (Task 11).
- Produces: `useBuckets()`, `useCreateBucket()`; the `/storage` page — consumed by Task 8's dashboard overview and Task 13's object browser page.

- [ ] **Step 1: Create the bucket hooks**

`apps/dashboard/src/hooks/use-buckets.ts`:
```ts
'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/http';
import type { Bucket } from '@/lib/types';

export function useBuckets() {
  return useQuery({
    queryKey: ['buckets'],
    queryFn: () => apiFetch<{ buckets: Bucket[]; total: number }>('/api/buckets'),
  });
}
```

`apps/dashboard/src/hooks/use-create-bucket.ts`:
```ts
'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/http';
import type { CreateBucketInput } from '@/lib/validation';
import type { Bucket } from '@/lib/types';

export function useCreateBucket() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateBucketInput) => apiFetch<Bucket>('/api/buckets', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['buckets'] });
    },
  });
}
```

- [ ] **Step 2: Write the failing test for `BucketList`**

Create `apps/dashboard/src/components/storage/bucket-list.test.tsx`:
```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BucketList } from './bucket-list';
import type { Bucket } from '@/lib/types';

function makeBucket(overrides: Partial<Bucket> = {}): Bucket {
  return {
    id: 'bucket-1',
    orgId: 'org-1',
    projectId: null,
    name: 'photos',
    region: 'us-east-1',
    versioningEnabled: false,
    public: false,
    lifecycleRules: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('BucketList', () => {
  it('renders an empty state when there are no buckets', () => {
    render(<BucketList buckets={[]} />);
    expect(screen.getByText(/no buckets yet/i)).toBeInTheDocument();
  });

  it('renders one row per bucket with its name and visibility', () => {
    render(<BucketList buckets={[makeBucket({ name: 'photos' }), makeBucket({ id: 'bucket-2', name: 'backups', public: true })]} />);

    expect(screen.getByText('photos')).toBeInTheDocument();
    expect(screen.getByText('backups')).toBeInTheDocument();
    expect(screen.getByText('Private')).toBeInTheDocument();
    expect(screen.getByText('Public')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm test:unit`
Expected: FAIL — `./bucket-list` module not found.

- [ ] **Step 4: Create `apps/dashboard/src/components/storage/bucket-list.tsx`**

```tsx
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
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test:unit`
Expected: PASS

- [ ] **Step 6: Create `apps/dashboard/src/components/storage/create-bucket-dialog.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { createBucketSchema } from '@/lib/validation';
import { useCreateBucket } from '@/hooks/use-create-bucket';
import { ApiError } from '@/lib/http';

export function CreateBucketDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const createBucket = useCreateBucket();

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const parsed = createBucketSchema.safeParse({ name });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Enter a valid bucket name');
      return;
    }

    try {
      await createBucket.mutateAsync(parsed.data);
      setOpen(false);
      setName('');
    } catch (err) {
      const message = err instanceof ApiError ? ((err.body as { message?: string })?.message ?? 'Could not create bucket') : 'Could not create bucket';
      setError(message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Create bucket</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a bucket</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bucket-name">Name</Label>
            <Input id="bucket-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={createBucket.isPending}>
              {createBucket.isPending ? 'Creating…' : 'Create bucket'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 7: Create `apps/dashboard/src/app/(app)/storage/page.tsx`**

```tsx
'use client';

import { Skeleton } from '@/components/ui/skeleton';
import { BucketList } from '@/components/storage/bucket-list';
import { CreateBucketDialog } from '@/components/storage/create-bucket-dialog';
import { useBuckets } from '@/hooks/use-buckets';

export default function StoragePage() {
  const { data, isLoading, error } = useBuckets();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Storage</h1>
        <CreateBucketDialog />
      </div>
      {isLoading && <Skeleton className="h-40 w-full" />}
      {error && <p className="text-destructive">Failed to load buckets.</p>}
      {data && <BucketList buckets={data.buckets} />}
    </div>
  );
}
```

- [ ] **Step 8: Run the full unit suite, lint, and typecheck**

Run: `pnpm test:unit && pnpm typecheck && pnpm lint` (from `apps/dashboard`)
Expected: all pass, including Task 8's previously-failing `use-buckets` import.

- [ ] **Step 9: Commit**

```bash
git add apps/dashboard/src/hooks/use-buckets.ts apps/dashboard/src/hooks/use-create-bucket.ts \
        apps/dashboard/src/components/storage/bucket-list.tsx apps/dashboard/src/components/storage/bucket-list.test.tsx \
        apps/dashboard/src/components/storage/create-bucket-dialog.tsx apps/dashboard/src/app/\(app\)/storage/page.tsx
git commit -m "feat: add bucket list/create UI (Stage 6.3)"
```

---

### Task 13: Object browser + upload

**Files:**
- Create: `apps/dashboard/src/lib/format-bytes.ts`, `format-bytes.test.ts`
- Create: `apps/dashboard/src/hooks/use-objects.ts`, `use-initiate-upload.ts`, `use-delete-object.ts`
- Create: `apps/dashboard/src/components/storage/object-browser.tsx`, `upload-button.tsx`
- Create: `apps/dashboard/src/app/(app)/storage/[bucketId]/page.tsx`
- Test: `apps/dashboard/src/components/storage/object-browser.test.tsx`

**Interfaces:**
- Consumes: `StorageObject` (Task 4), `Table*`/`Badge`/`Button` (Task 2), `GET .../objects`, `POST .../objects/upload`, `DELETE .../objects/[key]` (Task 11).
- Produces: `formatBytes(size: string | null): string`; `useObjects(bucketId)`, `useInitiateUpload(bucketId)`, `useDeleteObject(bucketId)`; the `/storage/:bucketId` page — the final Stage 6.3 deliverable ("user can upload a file via dashboard", EDD §11.6.3).

- [ ] **Step 1: Write the failing test for `formatBytes`**

Create `apps/dashboard/src/lib/format-bytes.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { formatBytes } from './format-bytes';

describe('formatBytes', () => {
  it('returns a placeholder for null (object still pending)', () => {
    expect(formatBytes(null)).toBe('—');
  });

  it('formats small byte counts as-is', () => {
    expect(formatBytes('512')).toBe('512 B');
  });

  it('formats kilobytes, megabytes, and gigabytes with one decimal', () => {
    expect(formatBytes('2048')).toBe('2.0 KB');
    expect(formatBytes('5242880')).toBe('5.0 MB');
    expect(formatBytes('3221225472')).toBe('3.0 GB');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:unit`
Expected: FAIL — `./format-bytes` module not found.

- [ ] **Step 3: Create `apps/dashboard/src/lib/format-bytes.ts`**

```ts
const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

export function formatBytes(size: string | null): string {
  if (size === null) return '—';

  let value = BigInt(size);
  let unitIndex = 0;
  let display = Number(value);

  while (value >= 1024n && unitIndex < UNITS.length - 1) {
    value /= 1024n;
    display /= 1024;
    unitIndex += 1;
  }

  return unitIndex === 0 ? `${display} ${UNITS[unitIndex]}` : `${display.toFixed(1)} ${UNITS[unitIndex]}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test:unit`
Expected: PASS

- [ ] **Step 5: Create the object hooks**

`apps/dashboard/src/hooks/use-objects.ts`:
```ts
'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/http';
import type { StorageObject } from '@/lib/types';

export function useObjects(bucketId: string) {
  return useQuery({
    queryKey: ['buckets', bucketId, 'objects'],
    queryFn: () => apiFetch<{ objects: StorageObject[]; total: number }>(`/api/buckets/${bucketId}/objects`),
    refetchInterval: (query) => {
      const hasPending = query.state.data?.objects.some((object) => object.status === 'pending');
      return hasPending ? 2000 : false;
    },
  });
}
```

`apps/dashboard/src/hooks/use-initiate-upload.ts`:
```ts
'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/http';

interface InitiateUploadResponse {
  objectId: string;
  uploadUrl: string;
}

export function useInitiateUpload(bucketId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const key = `${crypto.randomUUID().slice(0, 8)}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const { uploadUrl } = await apiFetch<InitiateUploadResponse>(`/api/buckets/${bucketId}/objects/upload`, {
        method: 'POST',
        body: JSON.stringify({ key, contentType: file.type || 'application/octet-stream', size: file.size }),
      });

      const putResponse = await fetch(uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
      });
      if (!putResponse.ok) {
        throw new Error(`Upload to storage failed with status ${putResponse.status}`);
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['buckets', bucketId, 'objects'] });
    },
  });
}
```

`apps/dashboard/src/hooks/use-delete-object.ts`:
```ts
'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/http';

export function useDeleteObject(bucketId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (key: string) => apiFetch<{ success: true }>(`/api/buckets/${bucketId}/objects/${encodeURIComponent(key)}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['buckets', bucketId, 'objects'] });
    },
  });
}
```

- [ ] **Step 6: Write the failing test for `ObjectBrowser`**

Create `apps/dashboard/src/components/storage/object-browser.test.tsx`:
```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ObjectBrowser } from './object-browser';
import type { StorageObject } from '@/lib/types';

function makeObject(overrides: Partial<StorageObject> = {}): StorageObject {
  return {
    id: 'obj-1',
    bucketId: 'bucket-1',
    key: 'photo.png',
    versionId: 'v1',
    isLatest: true,
    size: '2048',
    contentType: 'image/png',
    etag: 'abc',
    storagePath: 'rc-bucket-1/photo.png/v1',
    metadata: null,
    status: 'ready',
    expiresAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('ObjectBrowser', () => {
  it('renders an empty state when there are no objects', () => {
    render(<ObjectBrowser objects={[]} onDelete={vi.fn()} />);
    expect(screen.getByText(/no files yet/i)).toBeInTheDocument();
  });

  it('renders each object with its formatted size and status', () => {
    render(
      <ObjectBrowser
        objects={[makeObject({ key: 'photo.png', size: '2048' }), makeObject({ id: 'obj-2', key: 'draft.txt', status: 'pending', size: null })]}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByText('photo.png')).toBeInTheDocument();
    expect(screen.getByText('2.0 KB')).toBeInTheDocument();
    expect(screen.getByText('draft.txt')).toBeInTheDocument();
    expect(screen.getByText('pending')).toBeInTheDocument();
  });
});
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `pnpm test:unit`
Expected: FAIL — `./object-browser` module not found.

- [ ] **Step 8: Create `apps/dashboard/src/components/storage/object-browser.tsx`**

```tsx
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
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `pnpm test:unit`
Expected: PASS

- [ ] **Step 10: Create `apps/dashboard/src/components/storage/upload-button.tsx`**

```tsx
'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useInitiateUpload } from '@/hooks/use-initiate-upload';

export function UploadButton({ bucketId }: { bucketId: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const initiateUpload = useInitiateUpload(bucketId);

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setError(null);
    try {
      await initiateUpload.mutateAsync(file);
    } catch {
      setError('Upload failed. Please try again.');
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <input ref={inputRef} type="file" className="hidden" onChange={handleFileChange} />
      <Button onClick={() => inputRef.current?.click()} disabled={initiateUpload.isPending}>
        {initiateUpload.isPending ? 'Uploading…' : 'Upload file'}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 11: Create `apps/dashboard/src/app/(app)/storage/[bucketId]/page.tsx`**

```tsx
'use client';

import { use } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { ObjectBrowser } from '@/components/storage/object-browser';
import { UploadButton } from '@/components/storage/upload-button';
import { useBucket } from '@/hooks/use-bucket';
import { useObjects } from '@/hooks/use-objects';
import { useDeleteObject } from '@/hooks/use-delete-object';

export default function BucketDetailPage({ params }: { params: Promise<{ bucketId: string }> }) {
  const { bucketId } = use(params);
  const { data: bucket } = useBucket(bucketId);
  const { data, isLoading, error } = useObjects(bucketId);
  const deleteObject = useDeleteObject(bucketId);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{bucket?.name ?? 'Bucket'}</h1>
        <UploadButton bucketId={bucketId} />
      </div>
      {isLoading && <Skeleton className="h-40 w-full" />}
      {error && <p className="text-destructive">Failed to load objects.</p>}
      {data && <ObjectBrowser objects={data.objects} onDelete={(key) => deleteObject.mutate(key)} />}
    </div>
  );
}
```

This page imports `useBucket`, which doesn't exist yet — add it now as part of this task (it's a one-file, one-query addition, small enough not to warrant its own task):

`apps/dashboard/src/hooks/use-bucket.ts`:
```ts
'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/http';
import type { Bucket } from '@/lib/types';

export function useBucket(bucketId: string) {
  return useQuery({
    queryKey: ['buckets', bucketId],
    queryFn: () => apiFetch<Bucket>(`/api/buckets/${bucketId}`),
  });
}
```

- [ ] **Step 12: Run the full unit suite, lint, and typecheck**

Run: `pnpm test:unit && pnpm typecheck && pnpm lint` (from `apps/dashboard`)
Expected: all pass.

- [ ] **Step 13: Commit**

```bash
git add apps/dashboard/src/lib/format-bytes.ts apps/dashboard/src/lib/format-bytes.test.ts \
        apps/dashboard/src/hooks/use-objects.ts apps/dashboard/src/hooks/use-initiate-upload.ts \
        apps/dashboard/src/hooks/use-delete-object.ts apps/dashboard/src/hooks/use-bucket.ts \
        apps/dashboard/src/components/storage/object-browser.tsx apps/dashboard/src/components/storage/object-browser.test.tsx \
        apps/dashboard/src/components/storage/upload-button.tsx apps/dashboard/src/app/\(app\)/storage/\[bucketId\]
git commit -m "feat: add object browser and upload (Stage 6.3)"
```

---

### Task 14: Repo-wide wiring — root `.env.example`, whole-monorepo verification

**Files:**
- Modify: `.env.example` (root — add the three dashboard service URLs)

**Interfaces:** none — this task only touches shared config and runs verification; no new exports.

- [ ] **Step 1: Add dashboard env vars to the root `.env.example`**

Append a new section at the end of `.env.example`:
```

# Dashboard
IDENTITY_SERVICE_URL=http://localhost:3001
CDN_SERVICE_URL=http://localhost:3003
STORAGE_SERVICE_URL=http://localhost:3004
```

- [ ] **Step 2: Run the full repo-wide checks**

Run (from repo root):
```bash
pnpm install
pnpm turbo lint typecheck
pnpm turbo test:unit
pnpm --filter @rivocloud/dashboard build
```
Expected: every task passes for every workspace, including `@rivocloud/dashboard`, and the production build succeeds.

- [ ] **Step 3: End-to-end manual walkthrough**

With `identity-service`, `cdn-service`, and `storage-service` running locally (their required infra — Postgres, Redis, NATS, MinIO — up via `docker compose -f infrastructure/compose/docker-compose.infra.yml up -d`) and `apps/dashboard` running via `pnpm dev`:

1. Visit `http://localhost:3000`, click "Get started", register a new account — expect a redirect to `/orgs/new` (a fresh user has zero orgs).
2. Create an organization — expect a redirect to `/dashboard` showing "0" zones and "0" buckets.
3. Go to `/zones`, click "Create zone", fill in a name and an origin URL (e.g. `https://example.com`) — expect the new zone to appear in the list.
4. Click into the zone, rename it, save — expect the new name to persist on reload.
5. Go to `/storage`, click "Create bucket", name it — expect it to appear in the list.
6. Click into the bucket, click "Upload file", pick any small file — expect it to appear with status `pending`, then flip to `ready` within a couple seconds (MinIO's webhook completing the upload lifecycle from Stage 5).
7. Delete the uploaded object and the zone — expect both to disappear from their lists.
8. Log out, then try visiting `/dashboard` directly — expect a redirect to `/login`.

Record the outcome of this walkthrough in the final PR description; do not mark the stage done without having actually run it.

- [ ] **Step 4: Commit**

```bash
git add .env.example
git commit -m "docs: wire dashboard service URLs into the root .env.example (Stage 6)"
```

---

### Task 15: Mark Stage 6 (6.1–6.3) done in the PRD

**Files:**
- Modify: `docs/superpowers/specs/2026-07-25-revocloud-phase1-prd.md`

- [ ] **Step 1: Update the roadmap table**

In the Section 7 table, change the Stage 6 row's Status cell from `Not started` to:
```
✅ Done (6.1–6.3: auth, zone UI, storage UI)
```

- [ ] **Step 2: Update the Status line at the top of the document**

Change:
```
**Status:** Draft — Stages 1-5 (Infrastructure Foundation, Identity Service, Go Edge Proxy, CDN Service, Storage Service) complete, Stages 6–16 not started.
```
to:
```
**Status:** Draft — Stages 1-6 (Infrastructure Foundation, Identity Service, Go Edge Proxy, CDN Service, Storage Service, Dashboard MVP: auth/zone/storage UI) complete, Stages 7–16 not started.
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-07-25-revocloud-phase1-prd.md
git commit -m "docs: mark Stage 6 (Dashboard MVP: auth/zone/storage UI) done in the PRD"
```
