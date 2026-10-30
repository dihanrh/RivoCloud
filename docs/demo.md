# RivoCloud demo

One command brings up the whole stack with a populated console, so you can open the dashboard and click through it.

```bash
bash scripts/demo.sh            # start everything, seed, print the URL
bash scripts/demo-stop.sh       # stop the apps this script started
bash scripts/demo-stop.sh --infra   # ...and also stop the Docker infra containers
```

Works from Git Bash on Windows and on Linux/macOS. Requirements: Docker running, Node 20+, pnpm, and `pnpm install` already done.

Then open **http://localhost:3000**.

## What the script does

1. Starts the Docker infra it needs (Redis, MinIO, ClickHouse, NATS; Postgres if nothing is on the database port) and waits for health.
2. Runs `pnpm --filter @rivocloud/db migrate:deploy`.
3. Starts identity (3001), cdn (3003), storage (3004), scheduler (3005), analytics (3006) and the dashboard (3000) in the background. Logs go to `.demo/logs/`, PIDs to `.demo/pids` (both gitignored).
4. Waits for every health check, then runs `scripts/seed-demo.mjs`.

It is idempotent: re-running skips anything that is already up and reuses (or skips) existing users, org, websites, buckets and traffic.

Settings come from the repo-root `.env`. Anything unset gets a dev default for this run only (`.env` is never edited): `ZONE_SECRET_ENCRYPTION_KEY`, `MINIO_ROOT_PASSWORD`, `MINIO_WEBHOOK_AUTH_TOKEN`, `INTERNAL_API_SECRET`, service URLs. `RATE_LIMIT_ENABLED=false` is forced for the demo run, because seeding logs in four users and would otherwise trip the 10/minute auth limit. Do not use this mode for anything but local demos.

If `DATABASE_URL` points at port 5433 (for a machine that already has a native Postgres on 5432) and nothing listens there, the script starts the container `rivocloud-test-postgres-5433` (creating it from `postgres:16-alpine` if missing).

## Demo accounts

All passwords: `DemoPass123!`. Organization: **Acme Media**.

The script exports `NEXT_PUBLIC_DEMO_MODE=true` for the dashboard, so the login page shows a "Demo accounts" panel under the form: click an account to fill in its email and password, then press Log in. Without that variable (any normal run) the panel is not rendered.

| Account | Role | What they see |
| --- | --- | --- |
| `owner@demo.rivo` (Demo Owner) | owner | Everything, including members, API keys, audit log, deleting resources |
| `admin@demo.rivo` (Demo Admin) | admin | Everything except owner-only actions (e.g. deleting the org) |
| `dev@demo.rivo` (Demo Developer) | developer | Websites, caching, storage, analytics; no member management |
| `viewer@demo.rivo` (Demo Viewer) | viewer | Read-only: can browse but write actions are rejected |

Seeded data: websites `acme-shop` (cache rules, a custom domain waiting for DNS), `acme-blog` (paused, with a purge-everything in its history) and `media-assets` (signed URLs required); buckets `product-images` (public) and `invoices` (private) with a few ready objects; an API key "CI deploy" (zone:read, cache:invalidate); and about 46,000 synthetic edge requests spread over the last 7 days (diurnal curve, cache HIT/MISS/BYPASS, seven countries, a few 304/404/5xx).

## Live click-through (about 5 minutes)

1. **Account home.** Log in as `owner@demo.rivo`. If the account belongs to several orgs, pick Acme Media. The home page shows the traffic and bandwidth summary across all websites.
2. **A website.** Open Websites, then `acme-shop`. Show the overview, the origin, and the domains tab (`www.acme-shop.example` sits in "Waiting for DNS", which is expected). Point out `acme-blog` is paused and `media-assets` requires signed URLs.
3. **Caching purge.** On `acme-shop`, open Caching: show the three rules (`/static/*` 1 day, `/api/*` bypass, `*.html` 5 minutes), then purge by path or purge everything and watch it appear in the purge history.
4. **Analytics.** Open the website's Analytics (or the account-level Analytics) and switch between 24 hours and 7 days: requests, bandwidth, hit ratio, top paths, countries, latency, status codes.
5. **Storage share link.** Open Storage, then `product-images`. Open an object and create a share link (signed URL); contrast with the private `invoices` bucket.
6. **Members, API keys, audit log.** Under Settings: Members (four roles), API keys ("CI deploy"; create one and note the secret is shown once), then the Audit log, which now lists the purge, share link and key creation you just did. Log in as `viewer@demo.rivo` in a private window to show the read-only experience.

## Troubleshooting

- **Docker is not running.** The script stops with a message. Start Docker Desktop, wait until `docker info` works, and re-run.
- **Port 5432 already in use (native Postgres).** The compose Postgres cannot bind. Set `DATABASE_URL` in `.env` to port 5433 (`postgresql://rivocloud:rivocloud_dev_password@localhost:5433/rivocloud`); the script then runs its own container on 5433. If 5432 already hosts a Postgres with the `rivocloud` role and database, leaving the default also works.
- **Port 3000 (or another app port) is taken.** The script refuses to start on a port owned by something else. Free the port, or run the dashboard elsewhere: `DASHBOARD_PORT=3010 bash scripts/demo.sh`.
- **A service did not become healthy.** Read `.demo/logs/<service>.log`.
- **Start clean.** `bash scripts/demo-stop.sh --infra`, then `docker compose -f infrastructure/compose/docker-compose.infra.yml down -v` to drop all data, and run the demo again.
- **Why vite-node and not `tsx`?** `pnpm dev` in each service runs through vite-node with an SWC config (`vite-node.config.ts`). The NestJS constructor injection needs decorator metadata, which `tsx`/esbuild does not emit.
