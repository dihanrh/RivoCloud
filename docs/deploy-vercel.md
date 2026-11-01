# Deploying the dashboard to Vercel (demo mode)

The dashboard (`apps/dashboard`, Next.js 15) can be deployed to Vercel by itself as a fully clickable demo
of the home page and the console. In demo mode it does not need the backend services (identity, cdn,
storage, analytics), Postgres, Redis, ClickHouse, NATS or MinIO: a built-in **mock backend** answers every
backend call from memory.

## 1. Import the project

1. In Vercel, choose **Add New → Project** and import this Git repository.
2. Set **Root Directory** to `apps/dashboard`. Leave **Include files outside the root directory** turned on
   (the default); the install needs the workspace files at the repo root.
3. **Framework Preset**: Next.js (detected automatically). No `vercel.json` is needed.

## 2. Build settings

| Setting | Value |
| --- | --- |
| Root Directory | `apps/dashboard` |
| Install Command | `pnpm install --frozen-lockfile --filter rivocloud --filter @rivocloud/dashboard` |
| Build Command | `pnpm build` (the default `next build` is fine too) |
| Output Directory | default (`.next`) |
| Node.js Version | 22.x (Settings → General). 20.x also works. |

Why the filtered install: the repository is a pnpm workspace. A plain `pnpm install` installs every
backend package too, and `packages/db` runs `prisma generate` in its `postinstall`. The dashboard doesn't
import any workspace package at runtime (only a unit test reads `packages/security`), so the install is
limited to the dashboard and the root workspace (which carries the shared ESLint config that `next build`
uses). pnpm 9 is picked up from `pnpm-lock.yaml` / the root `packageManager` field.

## 3. Environment variables

Add these in **Settings → Environment Variables** (Production and Preview):

| Variable | Value | Purpose |
| --- | --- | --- |
| `RIVO_DEMO_BACKEND` | `mock` | Server-side: answer every backend call from the in-memory demo backend. The four `*_SERVICE_URL` variables become optional. |
| `NEXT_PUBLIC_DEMO_MODE` | `true` | Shows the demo accounts panel on `/login` and the "Demo environment" notice in the console. Inlined at build time, so redeploy after changing it. |

Do not set `IDENTITY_SERVICE_URL`, `CDN_SERVICE_URL`, `STORAGE_SERVICE_URL` or `ANALYTICS_SERVICE_URL` for a
demo deployment.

## 4. Deploy

Click **Deploy**. When it finishes, open the deployment URL:

- `/` is the product home page.
- `/login` lists the demo accounts (password `DemoPass123!`):

  | Email | Role |
  | --- | --- |
  | `owner@demo.rivo` | Owner |
  | `admin@demo.rivo` | Admin |
  | `dev@demo.rivo` | Developer |
  | `viewer@demo.rivo` | Viewer (read-only) |

  New accounts can also be registered; they start without an organization and can create one.

You can check a build locally first, from `apps/dashboard`:

```bash
RIVO_DEMO_BACKEND=mock NEXT_PUBLIC_DEMO_MODE=true pnpm build
RIVO_DEMO_BACKEND=mock NEXT_PUBLIC_DEMO_MODE=true pnpm start -p 3020
```

## How the mock backend works

Every Next route handler under `src/app/api/**` calls the backend through one function,
`backendFetch()` in `src/lib/backend-fetch.ts`. When `RIVO_DEMO_BACKEND=mock`, that function hands the
call to `src/lib/demo-backend` instead of the network. The route handlers, the auth cookies and the
browser code all run unchanged.

- **Router** (`src/lib/demo-backend/router.ts`): a table of `(service, method, path pattern)` routes
  covering every endpoint the dashboard uses: auth (login, register, refresh, logout, select-org,
  forgot/reset password), `users/me`, organizations, members, audit log, API keys, websites (zones),
  cache rules (incl. reorder), custom domains (incl. verify), purges and invalidations, signing-secret
  rotation, buckets, objects (list, upload, sign, delete) and the eight analytics endpoints.
  Responses and errors have the same shape and status codes as the real services, e.g.
  `{ "statusCode": 403, "message": "Role \"viewer\" lacks the \"zone:write\" permission", "error": "Forbidden" }`.
- **Seed data** (`world.ts`): the same dataset as `scripts/seed-demo.mjs`: the "Acme Media"
  organization with the four users above; websites `acme-shop` (3 cache rules, custom domain
  `www.acme-shop.example` waiting for DNS), `acme-blog` (paused, with a past purge) and `media-assets`
  (signed URLs required); buckets `product-images` (public) and `invoices` (private) with a few files;
  an API key "CI deploy"; and an audit log entry for each of these.
- **Auth**: access tokens are JWT-shaped (`header.payload.signature`, payload `{ sub, org, role, exp, jti }`,
  15 minutes). The dashboard only decodes them. Refresh tokens are opaque.
- **Roles** are enforced like the real services: viewers can't change websites or storage, only the
  owner changes roles, admins invite or remove developers and viewers only, API key scopes are capped
  by role, and the audit log is for owners and admins. Every change is written to the audit log.
- **Analytics** (`analytics.ts`) is generated on the fly for any range, granularity and website:
  a daily traffic curve, about 94% cache hit ratio, status codes, p50/p95/p99 latency, countries and
  top paths. The numbers are deterministic, so charts are stable between requests.
- **Uploads**: the upload URL is same-origin (`/api/demo/upload/<ticket>`). That route accepts the
  browser's `PUT`, counts and discards the bytes, and marks the file ready.
- **Share links** point to `/api/demo/signed?...`, a plain-text page that explains the link (there is no
  edge network to serve the file).

## Limits

- **State is in memory.** Changes live in the memory of the serverless instance that handled them. They
  survive while the instance is warm and **reset on a cold start**, on a redeploy, or after two idle hours.
  Vercel may also send two requests to different instances, so a change can occasionally seem to
  disappear and come back. This is fine for a demo; it is not a database.
- **One sandbox per browser.** The first backend call sets an HTTP-only `rivo_demo_sid` cookie, and each
  cookie gets its own copy of the demo data, so concurrent visitors don't see each other's edits. Up to
  200 sandboxes are kept per instance (least recently used are dropped). Logging in as another demo user
  in the same browser shares the sandbox; a different browser (or cleared cookies) starts fresh.
- Registered accounts exist only in that sandbox and instance.
- Uploaded file contents are not stored, and share links don't serve files. Request bodies on Vercel
  functions are limited to about 4.5 MB, so larger demo uploads fail.
- Password reset emails are not sent, so reset links can't be completed. Custom domain verification
  always succeeds. Rate limits are not simulated.

## Pointing the dashboard at real services later

1. Deploy the backend services somewhere the dashboard can reach (see `docs/demo.md` and
   `infrastructure/`), and seed them if you want the demo data (`node scripts/seed-demo.mjs`).
2. In the Vercel project, **remove** `RIVO_DEMO_BACKEND`, and set:
   - `IDENTITY_SERVICE_URL`
   - `CDN_SERVICE_URL`
   - `STORAGE_SERVICE_URL`
   - `ANALYTICS_SERVICE_URL`

   Without `RIVO_DEMO_BACKEND=mock` all four are required and must be valid URLs; the dashboard fails
   fast with a clear error otherwise.
3. Set `NEXT_PUBLIC_DEMO_MODE` to `true` only if the backend has the demo accounts, then redeploy.

Note that the services trust `X-Forwarded-For` only from a proxy in front of them; read the comment in
`src/lib/forwarded-headers.ts` before exposing them to a public dashboard.
