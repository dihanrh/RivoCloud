# Docker Compose & Infrastructure — Explained for Beginners

This document explains **how RivoCloud's local infrastructure works** — what Docker Compose is, what every term in [`infrastructure/compose/docker-compose.infra.yml`](../../infrastructure/compose/docker-compose.infra.yml) means, and how all these pieces will eventually run together on a real server. It assumes zero prior Docker knowledge.

If you haven't read it yet, [`phase1-explained-for-beginners.md`](../phase1-explained-for-beginners.md) explains *what* RivoCloud is and *why* it needs Postgres, Redis, MinIO, etc. This document focuses on *how* those tools are actually started, run, and connected on a machine.

---

## 1. The absolute basics: what is a container?

Before Docker Compose makes sense, you need one idea: the **container**.

Normally, if you want to run something like PostgreSQL on your laptop, you'd have to download an installer, run it, configure config files, make sure the right version is installed, hope it doesn't conflict with something else already using port 5432... it's a whole process, and it's different on Windows vs. Mac vs. Linux.

A **container** solves this by packaging up a piece of software *and everything it needs to run* (the exact OS files, libraries, default config) into one single, self-contained unit. Starting Postgres in a container is just: "run this exact, pre-built package." It behaves identically on every machine, because it's not using *your* machine's installed software at all — it brings its own.

**Image vs. Container** — these two words are often confused:

- An **image** is the packaged-up blueprint (e.g., "postgres:16-alpine" is a specific, versioned snapshot of Postgres 16, built on a minimal Linux distribution called Alpine).
- A **container** is a *running instance* of an image — the same way a running program ("process") is an instance of a file on disk. You can start and stop many containers from the same image.

**Docker** is the tool that downloads images and runs them as containers. `docker run postgres:16-alpine` would start one container running Postgres. That's the whole trick.

---

## 2. What problem does Docker Compose solve?

RivoCloud's local dev environment doesn't need *one* container — it needs **eight**, running at the same time, able to talk to each other: Postgres, Redis, MinIO, ClickHouse, NATS, Prometheus, Grafana, and Loki (see [Section 4](#4-the-rivocloud-stack-service-by-service) for what each one does).

Running eight separate `docker run ...` commands by hand every time, remembering all their settings, ports, and volume paths, would be tedious and error-prone.

**Docker Compose** solves this by letting you describe *all* of these containers — and how they relate to each other — in a single YAML file. Then one command, `docker compose up`, reads that file and starts (or updates) every container described in it, in the right way, every time, identically for every developer on the team.

That file, for RivoCloud, is [`infrastructure/compose/docker-compose.infra.yml`](../../infrastructure/compose/docker-compose.infra.yml). "Infra" because — true to the plan in [Stage 1](../superpowers/plans/2026-07-18-phase1-stage1-infrastructure-foundation.md) — it only contains supporting infrastructure (databases, message queues, monitoring tools), not RivoCloud's own application code. The application services (Identity Service, CDN Service, Edge Proxy, etc.) get their own containers in later stages; right now this file only sets up what those services will *depend on*.

---

## 3. Every term in the Compose file, explained

Open [`docker-compose.infra.yml`](../../infrastructure/compose/docker-compose.infra.yml) side-by-side with this section — each heading below is a keyword you'll see repeated throughout the file.

### `services:`

The top-level list of containers to run. Everything indented under `services:` (postgres, redis, minio, clickhouse, nats, prometheus, grafana, loki) is one container. The name you give each one (e.g., `postgres`) becomes its **hostname** — other containers on the same network can reach it just by using that name, like a nickname (see [Networks](#networks-and-networks-rivocloud) below).

### `image:`

Which pre-built blueprint to use, and which version. E.g., `postgres:16-alpine` means "Postgres, version 16, built on the lightweight Alpine Linux base." The part after the colon (`16-alpine`) is called a **tag** — it pins down an exact version, so everyone on the team runs the identical thing instead of "whatever the latest version happens to be today."

### `command:`

Overrides what the container runs when it starts, instead of the image's built-in default. E.g., for Redis:

```yaml
command: redis-server --maxmemory 512mb --maxmemory-policy allkeys-lru
```

This tells Redis to cap its memory use at 512MB, and when it's full, to evict the **L**east **R**ecently **U**sed item to make room (see the "LRU" glossary entry in [phase1-explained-for-beginners.md](../phase1-explained-for-beginners.md#33-core-infrastructure-pieces-the-ingredients)). Without a `command:` override, an image just runs its own default startup script.

### `environment:`

Environment variables passed *into* the container — the standard way to configure software without editing files. E.g.:

```yaml
environment:
  POSTGRES_DB: rivocloud
  POSTGRES_USER: rivocloud
  POSTGRES_PASSWORD: rivocloud_dev_password
```

The `postgres` image is *written* to look for these specific variable names on startup and use them to create the initial database, username, and password. Every image documents which environment variables it understands.

> **Note:** `rivocloud_dev_password` is a placeholder for **local development only** — it's fine to see it in this file because nobody's actual production data is ever exposed this way. Production secrets are never committed to git (see [Section 6](#6-how-this-will-run-on-a-real-server)).

### `ports:`

Exposes a container's internal network port to your actual machine ("the host"), so tools like `psql`, a browser, or another program running directly on your laptop can reach it. The format is always `"HOST_PORT:CONTAINER_PORT"`:

```yaml
ports:
  - "5432:5432"
```

This means "port 5432 *inside* the Postgres container is made reachable as port 5432 *on my machine*." The two numbers don't have to match — notice ClickHouse:

```yaml
ports:
  - "8123:8123"
  - "9009:9000"
```

Inside the container, ClickHouse's native protocol listens on port 9000 — but 9000 on the host machine is already taken by MinIO (see below), so it's remapped to 9009 on the host side only. Containers never actually see or care about this remapping; the renumbering only affects how *you*, on your machine, reach in.

### `volumes:`

Containers are meant to be disposable — you can delete and recreate one at any time, and by default *everything written inside it disappears* when it's removed. That's a problem for a database: you don't want to lose all your data every time you restart Postgres.

A **volume** is a piece of storage that lives *outside* the container, on your actual machine's disk, and gets attached ("mounted") into the container at a specific folder path. Even if the container is deleted and recreated, the volume — and the data in it — survives.

```yaml
volumes:
  - postgres_data:/var/lib/postgresql/data
```

This says: "take the volume named `postgres_data` and make it appear as the folder `/var/lib/postgresql/data` inside the container" (which is exactly where Postgres stores its data files). The named volumes (`postgres_data`, `redis_data`, `minio_data`, `clickhouse_data`) are declared once at the bottom of the file under a top-level `volumes:` block — Docker manages the actual files on disk for you; you never need to find them manually.

Not every service needs one — Prometheus, Grafana, Loki, and NATS here don't declare a volume, because for local development it's fine if their data (metrics history, dashboards) resets when the stack restarts. Only the things holding data you can't regenerate (the actual database, uploaded files) get a volume.

There's a second style of volume mount used for Prometheus:

```yaml
volumes:
  - ./prometheus.yml:/etc/prometheus/prometheus.yml
```

This isn't a named volume — it's a direct path (`./prometheus.yml`, a file sitting right next to the Compose file) mapped straight into the container. This is how you hand a container a config file that lives in your own repo, so editing `prometheus.yml` in your editor takes effect the next time the container starts, without rebuilding any image.

### `healthcheck:`

A way to tell Docker "don't just assume this container is working because it started — actually check." Postgres's healthcheck:

```yaml
healthcheck:
  test: ["CMD-SHELL", "pg_isready -U rivocloud"]
  interval: 5s
  timeout: 5s
  retries: 10
```

Every 5 seconds (`interval`), Docker runs the command `pg_isready -U rivocloud` *inside* the container. If it succeeds, the container is marked `healthy`. If it fails 10 times in a row (`retries`), each one allowed up to 5 seconds (`timeout`) to respond, it's marked `unhealthy`. This matters because a container can report "started" within a second, while the actual database software inside might take several more seconds to be ready to accept connections. Other tools (and later, other containers) can check this health status before trying to connect, instead of guessing and failing.

Not every service here has one — ClickHouse, NATS, Prometheus, Grafana, and Loki skip it, since nothing else in this particular stack needs to wait on them being fully ready before proceeding.

### `networks:` and `networks.rivocloud`

```yaml
networks: [rivocloud]
```

appears under every service, and at the bottom:

```yaml
networks:
  rivocloud:
    driver: bridge
```

This creates one private virtual network, named `rivocloud`, that all eight containers are attached to. Being on the same network means each container can reach every other one *by its service name* — e.g., a container running application code could connect to `postgres:5432` or `redis:6379` directly, without knowing any real IP address. (This is different from the `ports:` section — `ports:` is about reaching a container *from outside* Docker, i.e., from your own machine; `networks:` is about containers reaching *each other*.) A `bridge` network is Docker's standard, simplest kind of private network — sufficient for one machine running everything locally.

### The bottom-level `volumes:` and `networks:` blocks

These two blocks at the very end of the file are just the *declarations* — a one-time "here are the named volumes and networks this file uses" — that the `volumes:` and `networks:` lines *inside* each service refer back to. Nothing runs there directly; think of it as a table of contents.

---

## 4. The RivoCloud stack, service by service

Now that the *syntax* makes sense, here's *why* each of the eight services exists (cross-referencing the fuller explanations in [phase1-explained-for-beginners.md](../phase1-explained-for-beginners.md)):

| Service              | What it is                          | Why RivoCloud needs it                                                                                                                                                                                                                                                      |
| -------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **postgres**   | The main relational database        | The permanent "source of truth" for users, organizations, zones, buckets, billing — everything that must never be lost.                                                                                                                                                    |
| **redis**      | An in-memory (RAM-based) fast store | Caches zone configuration for the Edge Proxy, and later holds sessions/rate-limit counters. Capped at 512MB here so it can't accidentally eat all your RAM locally.                                                                                                         |
| **minio**      | S3-compatible object storage        | Where actual file bytes (uploads, "pushed" CDN content) live. Ports 9000 (API) and 9001 (web console) are both exposed so you can both connect programmatically and browse buckets in a browser.                                                                            |
| **clickhouse** | An analytics-optimized database     | Stores per-request traffic logs so the dashboard can show bandwidth/hit-rate charts without slowing down a regular database.                                                                                                                                                |
| **nats**       | A pub/sub messaging system          | Lets services broadcast events (like "this cache is now invalid") that other services — potentially many Edge Proxies — react to, without contacting each one directly.`-js` enables JetStream (durable message storage); `-m 8222` opens a monitoring HTTP endpoint. |
| **prometheus** | A metrics collector                 | Periodically "scrapes" (pulls) numeric metrics — like request counts or memory use — from services and stores them over time.                                                                                                                                             |
| **grafana**    | A dashboarding tool                 | Turns Prometheus's (and Loki's) raw stored metrics/logs into visual graphs and dashboards. Anonymous access is turned on here purely to skip a login step in local dev.                                                                                                     |
| **loki**       | A log aggregation system            | Like Prometheus, but for*logs* (text output) instead of numeric metrics — lets you search/filter logs from every service in one place instead of `docker logs`-ing each container individually.                                                                        |

None of these are RivoCloud's own code — they're all off-the-shelf open-source tools, each solving one well-known problem, wired together to give RivoCloud's *future* application code (Identity Service, CDN Service, Edge Proxy, etc. — see the [16-stage build order](../phase1-explained-for-beginners.md#5-how-phase-1-is-built-the-16-stages)) somewhere to store data, cache data, exchange messages, and be observed, from day one.

---

## 5. What actually happens when you run it

The plan's helper script, [`scripts/dev.sh`](../../scripts/dev.sh), boils down to one command:

```bash
docker compose -f infrastructure/compose/docker-compose.infra.yml up -d
```

Step by step:

1. Docker reads the YAML file and figures out the eight services it describes.
2. For any image not already downloaded (first run only), it pulls it from Docker Hub (the public registry of images).
3. It creates the `rivocloud` bridge network (if it doesn't already exist) and the four named volumes.
4. It starts all eight containers, attaching each to the `rivocloud` network and mounting its volumes.
5. `-d` means "detached" — run in the background and give you your terminal back immediately, instead of streaming logs and blocking until you hit Ctrl+C.
6. From that point on, `docker compose ... ps` shows you each container's status (including the `healthy`/`unhealthy` state from healthchecks), and `docker compose ... down` stops and removes all eight containers again (the *data* survives in the named volumes unless you also pass `-v` to delete those too).

Every developer on the team runs this exact same file, so "works on my machine" mostly stops being a problem for these supporting services — everyone gets the identical versions, ports, and configuration.

---

## 6. How this will run on a real server

Everything above describes **local development on one laptop**. Running in production, on a real server serving real traffic, is a related but different problem — worth being explicit about what changes and what doesn't.

### 6.1 Docker Compose *can* run a real server too — for a while

Nothing stops you from running this same `docker compose up` command on a single rented server (e.g., a Hetzner box, as RivoCloud's plan calls for) and pointing a domain name at it. That's a legitimate, simple way to run a real product early on, and it's exactly what Stage 1 sets up. The tradeoffs it accepts:

- **One machine, one point of failure.** If that server goes down, everything goes down. There's no automatic "restart this on a different machine."
- **No automatic scaling.** If traffic spikes, nothing spins up a second copy of a service to share the load — you'd have to do that by hand.
- **Manual updates.** Deploying a new version means logging into the server and re-running Compose commands yourself (or via a simple script), rather than an automated pipeline gradually rolling out the change.

This is a reasonable and common starting point — it's simpler to operate and debug than a full orchestration platform, and RivoCloud's own build plan deliberately starts here.

### 6.2 The planned upgrade path: Kubernetes (k3s)

RivoCloud's roadmap ([Stage 13](../phase1-explained-for-beginners.md#5-how-phase-1-is-built-the-16-stages), Month 9) migrates from Docker Compose to **k3s**, a lightweight version of **Kubernetes**. Kubernetes solves exactly the gaps above:

- If a container crashes or its host machine dies, Kubernetes automatically restarts it — possibly on a different machine entirely.
- It can run multiple copies of a busy service and spread traffic across them (this is what "scaling" means in practice).
- New versions can be rolled out gradually (a few containers at a time) and automatically rolled back if something looks wrong.

The reason this comes *late* in the plan (see the ordering discussion in [Section 5 of phase1-explained-for-beginners.md](../phase1-explained-for-beginners.md#the-key-idea-behind-the-ordering)) is that it's a purely *operational* upgrade — it makes an already-working system harder to knock over, but doesn't add any new customer-facing feature. There's no point taking on that operational complexity before the system it's protecting actually works end-to-end.

### 6.3 What stays conceptually the same either way

Whether it's plain Docker Compose on one box or full Kubernetes across many, the *ideas* in this document don't change — only who's responsible for them:

| Concept here                           | Docker Compose (now)                                                                 | Kubernetes (later)                                                                                                     |
| -------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| "Which container image, which version" | `image:` field                                                                     | Same idea, called a**Pod's** container spec                                                                      |
| "How do containers find each other"    | Compose's built-in`rivocloud` bridge network, containers reachable by service name | Kubernetes' own internal DNS +**Services** (a stable name/address that routes to whichever running copies exist) |
| "Where does data survive a restart"    | Named`volumes:`                                                                    | **PersistentVolumes**, same underlying idea, provisioned by the cluster                                          |
| "Is this thing actually ready"         | `healthcheck:`                                                                     | **Liveness/Readiness probes** — same purpose, Kubernetes-native syntax                                          |
| "Which port is this reachable on"      | `ports:` mapping to your laptop                                                    | An**Ingress** / load balancer routes a real public domain name to the right internal Service                     |

In other words: today's `docker-compose.infra.yml` isn't throwaway learning — it's the same mental model you'll reuse once the project moves to Kubernetes; only the exact YAML dialect changes.

### 6.4 The pieces that connect production to the internet

A few things sit *around* this Compose stack, whether on one server or a cluster, to make it reachable and secure from the public internet — mentioned in the [glossary](../phase1-explained-for-beginners.md#31-cdn-concepts) and worth restating here in the "running on a server" context:

- **Traefik** (a reverse proxy) sits in front of the control-plane services, routes each incoming request to the correct backend service by hostname/path, and automatically requests TLS certificates for custom domains.
- **TLS/SSL certificates** (via Let's Encrypt) are what let the padlock icon show up in a visitor's browser — issued automatically, not manually installed.
- **DNS** is what points a real domain name (e.g., `cdn.rivocloud.dev`) at the actual IP address of the server(s) running all of this.
- **Secrets** (database passwords, API keys) are never committed to git and never hardcoded the way `rivocloud_dev_password` appears in this *local-only* file — in production they're injected as environment variables from a secrets manager or CI/CD pipeline at deploy time.

---

## 7. Putting it all together — one picture

```
Your laptop (or a rented server)
│
│   docker compose -f infrastructure/compose/docker-compose.infra.yml up -d
│
├── Docker creates: the "rivocloud" private network + 4 named volumes
│
├── postgres      (network: rivocloud, port 5432→5432,  volume: postgres_data)
├── redis         (network: rivocloud, port 6379→6379,  volume: redis_data)
├── minio         (network: rivocloud, ports 9000/9001,  volume: minio_data)
├── clickhouse    (network: rivocloud, ports 8123/9009,  volume: clickhouse_data)
├── nats          (network: rivocloud, ports 4222/8222)
├── prometheus    (network: rivocloud, port 9090,        reads ./prometheus.yml)
├── grafana       (network: rivocloud, port 3002)
└── loki          (network: rivocloud, port 3100)

   All eight can reach each other by name (e.g. "postgres:5432")
   because they share the "rivocloud" network — that's how
   RivoCloud's later application code (once built) will connect
   to its database, cache, and message bus without hardcoding IPs.

   Later, in production: Traefik + DNS + TLS certs sit in front of
   whichever of these are internet-facing, and (eventually) k3s
   replaces "docker compose" as the thing that keeps it all running.
```

**The one-line summary:** Docker packages each tool identically for every machine; Docker Compose describes *all* of them and how they connect in one file so one command brings the whole stack up; and the exact same concepts — images, networking, persistent storage, health checks — carry forward unchanged when this graduates from one developer's laptop to a real server, and later to a full Kubernetes cluster.
