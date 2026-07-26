# Edge Nodes & GeoDNS — Explained for Beginners

This document explains the concepts behind **Stage 14: First Hetzner Edge Node** — the fourteenth stage of Phase 1's [16-stage build order](../phase1-explained-for-beginners.md#5-how-phase-1-is-built-the-16-stages). **Nothing in this document has been built yet.** Its job is to make sure every concept needed to understand "adding a second physical server location" is clear *before* a single Ansible playbook is written.

If you haven't read them yet, start with:
- [`phase1-explained-for-beginners.md`](../phase1-explained-for-beginners.md) — especially the [PoP (Point of Presence) glossary entry](../phase1-explained-for-beginners.md#33-core-infrastructure-pieces-the-ingredients) and [Section 2's control-plane/data-plane split](../phase1-explained-for-beginners.md#2-the-big-picture-two-worlds). This document goes *much deeper* on that one glossary entry — it doesn't repeat it, it explains the "why" and "how" underneath it.
- [`edge-proxy-and-caching.md`](edge-proxy-and-caching.md) — explains the Edge Proxy itself and the 3-layer cache. This document assumes that mechanism already works correctly in one place, and explains what changes when it has to run correctly in *two* places at once.
- [`docker-compose-and-infrastructure.md`](docker-compose-and-infrastructure.md) — explains Docker Compose itself. This document reuses that same mental model for a second, much smaller Compose file that runs on the edge node.

The engineering source of truth for everything here is [`2026-06-29-revocloud-phase1-cdn-edd.md`](../superpowers/specs/2026-06-29-revocloud-phase1-cdn-edd.md) (Section 3.3 "Edge Node — Hetzner (Per PoP)", Section 9.6 "Edge Node Deployment", and Section 11 "14. FIRST HETZNER EDGE NODE"), plus the [master architecture's Scaling Strategy (Section 4)](../superpowers/specs/2026-06-29-revocloud-master-architecture.md#4-scaling-strategy) for why a second physical location fits into the bigger picture. The product-facing requirement and roadmap entry are [PRD Section 5.12 "Distributed Edge"](../superpowers/specs/2026-07-25-revocloud-phase1-prd.md#512-distributed-edge-p1-month-8) and [Section 7's Implementation Roadmap, row 14](../superpowers/specs/2026-07-25-revocloud-phase1-prd.md#7-implementation-roadmap).

---

## 1. Wait — hasn't RivoCloud already been "a CDN" since Stage 3?

This is the single most important thing to understand before anything else in this document makes sense, and it's easy to miss because every earlier stage *behaves* like a real CDN: zones exist, caching works, invalidation works, analytics work. Functionally, nothing is missing. **Physically, something crucial is.**

Look back at the [master architecture's Scaling Strategy](../superpowers/specs/2026-06-29-revocloud-master-architecture.md#4-scaling-strategy). From Stage 1 (local Docker Compose) through Stage 2 (the single Oracle Cloud VPS that Phase 1 runs on for its first several months), **every single container — Dashboard, Identity Service, CDN Service, Postgres, Redis, NATS, and the Edge Proxy itself — runs on the same one machine, in the same one data center.** The Edge Proxy has a real 3-layer cache, real cache rules, real invalidation... but there is only ever one physical copy of it, sitting right next to the control plane that manages it.

That matters because the entire *point* of a CDN — the thing that makes "Content Delivery Network" a meaningful name instead of just "a caching proxy" — is **physical proximity to visitors**. A cache hit is fast no matter where the server is. But if a visitor in Tokyo has to cross the ocean to reach the *one* Edge Proxy in a European data center, the cache hit might shave a few milliseconds off *processing* the request, while the *network trip itself* — tens or hundreds of milliseconds each way — dominates the total time. For that visitor, hitting RivoCloud's single Edge Proxy isn't meaningfully faster than the customer's origin server just answering them directly, if the origin also happens to be reasonably close. The "CDN" so far is really "one well-built caching reverse proxy in one location" — genuinely useful, but not yet *distributed*, which is the word doing all the work in "Content Delivery **Network**."

Stage 14 is the first stage where that changes. It doesn't add a new feature to the Edge Proxy's code at all — the Go binary built in Stage 3 and hardened through Stages 7–11 is the *exact same program*. What Stage 14 adds is a **second physical location** for that same program to run, chosen specifically because it's far from the first one — and everything needed to make that second copy behave as one coherent system with the first, instead of two disconnected islands.

| | Before Stage 14 | After Stage 14 |
|---|---|---|
| Number of physical Edge Proxy locations | 1 (Oracle Cloud, co-located with the control plane) | 2 (Oracle Cloud + Hetzner, Nuremberg) |
| Latency benefit for a visitor near Oracle's region | Real | Same |
| Latency benefit for a visitor in the EU, far from Oracle's region | Little to none — same as hitting origin directly | Real — routed to the nearby Nuremberg node instead |
| Is a cache invalidation reliably seen everywhere? | Trivially yes (only one place to update) | Only if the messaging system itself spans both locations (see [Section 4](#4-why-does-nats-need-to-become-a-cluster-that-spans-two-locations)) |
| Is this "a CDN" in the full sense of the word? | Functionally yes, physically no | Yes — the first genuinely distributed proof point |

---

## 2. Ansible, in plain language

Before Stage 14, every server RivoCloud runs (the local dev machine, the one Oracle VPS) has been set up either by a developer's own laptop tooling or by hand: SSH in, install Docker, copy a Compose file, run it. That's manageable for *one* server. Stage 14 introduces a *second* server that needs the same careful setup — and the master architecture's later scaling stages (Stage 4: three edge PoPs; Stage 6: "15+ PoP locations across all continents") make clear this number is only going to grow. Doing "SSH in and type commands by hand" for the *fifteenth* server is not just tedious, it's a reliability risk: it's very easy for the tenth server to end up subtly different from the first one, just because a human typed one command slightly differently, or forgot a step, or did it in a different order.

**Ansible** is a tool for solving exactly this problem: it lets you write down, once, in a file called a **playbook**, the *exact* sequence of setup steps a server needs — "install Docker," "create this config file," "start this service" — and then run that playbook against any server (or any number of servers) to bring it into that exact state, automatically and identically every time.

A few ideas worth being explicit about:

- **A playbook is a description of "what should be true," not a list of commands to type.** Instead of writing "run `apt install docker`," a playbook typically says something closer to "Docker should be installed" — and Ansible figures out whether it already is, and only takes action if it isn't. Running the same playbook twice in a row does nothing the second time, because everything it describes is already true. This property is called **idempotency**, and it's what makes playbooks safe to re-run without worrying about double-installing things or restarting services that don't need restarting.
- **Ansible needs no special software installed on the target server ahead of time.** It works over plain SSH (which any Linux server already has), which is exactly why it's a reasonable tool for a brand-new, freshly-rented VPS that has nothing on it yet.
- **The same playbook scales to any number of servers.** Whether you point Ansible at 1 server or 15, the playbook file itself doesn't change — only the list of target servers ("the inventory") does. This is precisely why it's introduced *now*: Stage 14 is deliberately the first time this pattern gets used for real, on a genuinely new physical location, so that the *next* edge node (Stage 4 of the master architecture's scaling path: Helsinki, Ashburn, and beyond) is "run the same playbook against a new IP address" instead of "repeat a multi-step manual process from memory and hope nothing is forgotten."

Per [EDD Section 3.3](../superpowers/specs/2026-06-29-revocloud-phase1-cdn-edd.md#33-edge-node--hetzner-per-pop), the Stage 14 playbook's job is specifically: provision the Hetzner VPS, install Docker and Docker Compose, and deploy `docker-compose.edge.yml` (see [Section 3](#3-a-smaller-second-compose-file-just-for-the-edge) below). Nothing about *what* gets deployed is new or mysterious — it's the same Docker Compose concepts explained in [`docker-compose-and-infrastructure.md`](docker-compose-and-infrastructure.md). Ansible's entire job is making sure the steps *leading up to* `docker compose up` happen correctly and repeatably, without a human doing them by hand.

---

## 3. A smaller, second Compose file — just for the edge

[`docker-compose-and-infrastructure.md`](docker-compose-and-infrastructure.md) explained `docker-compose.infra.yml` — the file that starts all eight supporting tools (Postgres, Redis, MinIO, ClickHouse, NATS, Prometheus, Grafana, Loki) for **local development**. The Hetzner edge node does *not* run that file, and it doesn't need most of what's in it — an edge node has no reason to run its own Postgres or ClickHouse; those stay on the control plane. Per the EDD, the edge node runs a much smaller, purpose-built file, `docker-compose.edge.yml`:

```
Hetzner CX21
├── Docker (no Kubernetes — edge simplicity)
├── docker-compose.edge.yml:
│   ├── edge-proxy (Go) — 2 replicas
│   ├── redis-edge — local cache (2GB max memory)
│   └── node-exporter — metrics for Prometheus
├── nginx (optional) — load balance between edge-proxy replicas
└── fail2ban — basic DDoS mitigation
```

A **CX21** is simply Hetzner's name for a specific size of rented virtual server: 2 CPU cores, 4GB RAM, for about €5.29/month. It's a deliberately modest, cheap machine — the point of Stage 14 is to *prove the distributed-edge mechanism works*, not to provision a data-center-grade server on day one. Every other line maps onto concepts already introduced elsewhere: `edge-proxy` is the same Go binary from [`edge-proxy-and-caching.md`](edge-proxy-and-caching.md); `redis-edge` is the same L2 cache concept from the [3-layer cache](edge-proxy-and-caching.md#3-the-3-layer-cache-in-depth), just running on this new physical machine instead of the Oracle one; `node-exporter` is a small helper program that exposes this machine's own CPU/memory/disk metrics so the control plane's existing Prometheus can scrape them remotely, extending the observability RivoCloud already has to this new location. `fail2ban` is a basic security tool that watches for IPs making abusively many requests and temporarily blocks them — worth having on any server directly exposed to public internet traffic. Notice also: **no Kubernetes here.** The EDD is explicit that the edge node stays on plain Docker Compose even after [Stage 13](../superpowers/specs/2026-07-25-revocloud-phase1-prd.md#7-implementation-roadmap) migrates the *control plane* to k3s — an edge node's job is narrow and stable enough (run edge-proxy, run redis-edge) that the operational overhead of a full orchestrator isn't worth it there.

---

## 4. Why does NATS need to become a cluster that spans two locations?

[`phase1-explained-for-beginners.md`'s glossary entry for NATS](../phase1-explained-for-beginners.md#33-core-infrastructure-pieces-the-ingredients) and [Walkthrough B](../phase1-explained-for-beginners.md#4-a-concrete-walkthrough-what-actually-happens) already establish the mechanism: when a customer invalidates a cache, the CDN Service publishes a `cache.invalidate` event to NATS, and "every Edge Proxy, everywhere, is subscribed to that NATS topic" and purges its own cache in response. Up through Stage 13, "every Edge Proxy, everywhere" has only ever meant "the one Edge Proxy, on the one Oracle machine, sitting right next to the NATS server that published the event." Publisher and subscriber were always on the same local network — arguably the *easiest possible case* for a messaging system to handle correctly.

Stage 14 is the first time this assumption gets tested for real. The Nuremberg Edge Proxy is a completely different physical machine, in a different data center, in a different country, reached over the public internet rather than a local network. If NATS only ever runs as a single server on Oracle, the Nuremberg Edge Proxy has no way to hear about invalidation events at all — it would keep serving stale, purged-everywhere-else content indefinitely, silently, for however long its TTL happens to allow. That's the exact failure mode a distributed CDN cannot tolerate: a customer purges their homepage, and it's genuinely fixed for visitors near Oracle but still broken for EU visitors landing on Nuremberg.

This is why Stage 14's task list (EDD Section 11, item 14.3) is specifically **"NATS cluster: Hetzner ↔ Oracle"**, with the stated output **"cache invalidation events reach Hetzner edge."** A NATS **cluster** means multiple NATS server processes (rather than just one) that talk to each other and keep each other in sync, so a message published to *any* member of the cluster reliably reaches every subscriber connected to *any other* member. Practically, for Stage 14, that means: a NATS server process runs on the Hetzner box alongside `edge-proxy` and `redis-edge`, it connects across the internet back to the NATS server(s) already running on the Oracle control plane, and the two together behave as one logical messaging system rather than two separate ones. The Nuremberg edge-proxy then subscribes to the same `cache.invalidate.*` and `config.zones.*` topics ([EDD Section 3.3](../superpowers/specs/2026-06-29-revocloud-phase1-cdn-edd.md#33-edge-node--hetzner-per-pop)'s bootstrap sequence, step 6) it would subscribe to if it were still running on Oracle — from the Edge Proxy code's point of view, *nothing changes*; it just publishes and subscribes to NATS as always. What changes is that NATS itself now has to correctly carry those messages across a real network boundary between two physical sites, which is precisely why this is called out as its own explicit sub-task rather than assumed to "just work."

This same pattern — a NATS cluster where the control plane and every edge PoP all subscribe together — is exactly what the master architecture's [later scaling stages](../superpowers/specs/2026-06-29-revocloud-master-architecture.md#4-scaling-strategy) describe as the long-term shape of the system: "NATS: 3-node JetStream cluster, control plane + edge subscribe" (Stage 5), scaling eventually to 15+ PoPs (Stage 6). Stage 14 is the *first, smallest possible version* of that same idea — two locations instead of one — proven before trusting it at any larger scale.

---

## 5. GeoDNS: how does a visitor even end up talking to Nuremberg?

Getting invalidation events to Nuremberg solves only half the problem. The other half is: **how does a visitor's request actually arrive at the Nuremberg Edge Proxy in the first place**, instead of the one on Oracle?

Ordinary DNS (Domain Name System — the system that turns a hostname like `cdn.rivocloud.dev` into an IP address a computer can actually connect to) is deliberately simple: you ask "what's the IP address for this hostname?" and you get back the *same* answer no matter who's asking or where they're asking from. That's fine for most things, but it's exactly wrong for a CDN with two physical locations — you don't want a visitor in Germany and a visitor in Australia both being told to connect to the same one IP address, because whichever location that IP points to, it's far away for one of them.

**GeoDNS** solves this by making the DNS answer depend on *where the question is coming from*. A GeoDNS-aware DNS server looks at the requester's approximate location (typically inferred from the IP address of the DNS resolver making the lookup on the visitor's behalf) and returns a *different* IP address depending on that location — the IP of whichever edge location is closest. Per [EDD Section 11's task 14.4](../superpowers/specs/2026-06-29-revocloud-phase1-cdn-edd.md#11-development-order), Stage 14's job here is: "add the Hetzner node IP to `edge.rivocloud.dev`'s GeoDNS record, so EU traffic routes to Nuremberg" — everyone else continues to resolve to whatever the DNS record pointed to before (the Oracle location).

The crucial property, and the reason GeoDNS is the *right* tool for this rather than something built into the CDN's own application logic, is that it requires **zero special logic in the visitor's browser or app.** A browser making a request to `edge.rivocloud.dev` has no idea GeoDNS exists — it just does what browsers always do: ask DNS for an IP address, then connect to whatever IP comes back. All of the "which physical location is closer" decision-making happens invisibly, one layer below, before the browser ever opens a connection. This is exactly the same shape of idea as a [Custom Domain](../phase1-explained-for-beginners.md#31-cdn-concepts) or [TLS certificate](../phase1-explained-for-beginners.md#31-cdn-concepts) — infrastructure-level plumbing that makes the visitor's experience better (or, here, faster) without asking the visitor's software to know or do anything differently.

| Regular DNS | GeoDNS |
|---|---|
| One hostname → one IP address, always | One hostname → different IP addresses, depending on requester location |
| A visitor in Tokyo and a visitor in Berlin get the identical answer | A visitor in Berlin might get the Nuremberg IP; a visitor in Tokyo gets whatever the "everyone else" default is (still Oracle, until further PoPs exist) |
| Visitor's browser: no special behavior needed | Visitor's browser: still no special behavior needed — the routing decision is invisible to it |
| Good enough when there's only one server anywhere | Only useful once there's more than one physical location to route between — which is exactly why it doesn't matter until Stage 14 |

Notice the dependency direction here: GeoDNS on its own is useless without a second physical location to route *to* (Stage 14's Ansible-provisioned Nuremberg box), and a second physical location is useless without GeoDNS (or something like it) to actually direct the right visitors *toward* it. The two pieces only produce a real latency benefit together — which is why Stage 14 bundles "provision the server" and "route traffic to it" as sub-tasks of the same stage rather than two separate stages.

---

## 6. Why a Hetzner CX21 in Nuremberg, specifically — and why Month 8?

**Why Nuremberg:** the master architecture's [Scaling Strategy](../superpowers/specs/2026-06-29-revocloud-master-architecture.md#4-scaling-strategy) already plans Hetzner as RivoCloud's edge-hosting provider going forward — Stage 4 of that scaling path adds Helsinki and Ashburn alongside Nuremberg, and Stage 5 adds Warsaw, Singapore, and Tokyo, all still on Hetzner. Nuremberg, Germany specifically matters for *this first* node because the Oracle control plane already serves the EU/nearby region reasonably well from wherever its own data center sits — the actual latency *problem* worth fixing first is proving out the mechanism somewhere genuinely useful, and EU traffic is the traffic RivoCloud can most easily reach and measure early on. A CX21 (2 cores, 4GB RAM, ~€5.29/month) is intentionally small: cheap enough to be a low-risk experiment, but large enough to run `edge-proxy` (2 replicas) and `redis-edge` comfortably, per the resource sketch in [EDD Section 3.3](../superpowers/specs/2026-06-29-revocloud-phase1-cdn-edd.md#33-edge-node--hetzner-per-pop).

**Why Month 8, this late in the build order:** [Section 7 of the PRD's Implementation Roadmap](../superpowers/specs/2026-07-25-revocloud-phase1-prd.md#7-implementation-roadmap) lists Stage 14 as depending on Stage 13 (the Kubernetes migration of the control plane). Combined with the master architecture's own scaling stages — where "Basic Kubernetes: k3s on Oracle" and "+ First Hetzner edge node" are described together as one stage (Months 7–9) — the reasoning is two-layered:

1. **The mechanism itself has to already be trustworthy.** Everything Stage 14 depends on functionally — the Edge Proxy's 3-layer cache (Stage 3), the CDN Service publishing zone config (Stage 4), and NATS-based cache invalidation (Stage 7) — has been running, exercised by real Dashboard usage and real cache traffic, for months by the time Stage 14 begins. Splitting a system across two physical locations multiplies the number of things that can go subtly wrong (network partitions, clock drift, "did that invalidation actually arrive everywhere") — exactly the kind of complexity you do *not* want to be debugging at the same time you're *also* still shaking out basic bugs in caching or invalidation themselves. [`phase1-explained-for-beginners.md`'s own stage-14 rationale](../phase1-explained-for-beginners.md#5-how-phase-1-is-built-the-16-stages) puts it directly: this stage depends on "everything about the Edge Proxy and NATS already working reliably in one place, before trusting it to run in two places at once."
2. **The control plane itself needs to be on more resilient footing first.** Once a second physical Edge Proxy location exists, the control plane it depends on (for zone config, for NATS invalidation) becomes a shared dependency for *two* real, physically separate serving locations rather than one co-located pair. Doing the Kubernetes migration (Stage 13) immediately beforehand means the control plane the Nuremberg node relies on is already the more resilient, self-healing version by the time it needs to be depended on from far away — rather than adding physical distribution on top of the more fragile single-Docker-Compose-process control plane.

Put simply: Stage 14 is deliberately one of the *last* things built in Phase 1, not because it's unimportant, but because it's the stage with the least tolerance for an unproven foundation underneath it.

---

## 7. A concrete walkthrough: an EU visitor, after Stage 14

Putting Sections 2–5 together, here's what happens end-to-end once Stage 14 is fully built — contrast this with [Walkthrough A in `phase1-explained-for-beginners.md`](../phase1-explained-for-beginners.md#4-a-concrete-walkthrough-what-actually-happens), which describes the *same* zone-serving flow back when there was only ever one Edge Proxy location to route to.

1. A visitor in, say, Munich requests `https://{zone}.cdn.rivocloud.dev/logo.png`.
2. Their device asks DNS to resolve the hostname. Because this record is GeoDNS-managed, and the request is coming from an EU-region resolver, DNS returns the **Nuremberg Hetzner node's IP address** — not the Oracle control plane's IP. The visitor's browser has no idea this decision was even made; it just connects to whatever IP it was given, exactly as it always does.
3. The visitor's HTTP request lands directly on the **Nuremberg Edge Proxy** — a physically nearby server rather than one on the other side of the continent (or further).
4. Suppose the customer who owns this zone had just changed a cache rule, or purged `/logo.png`, moments earlier via the Dashboard. That action reached the CDN Service on the Oracle control plane, which published a `cache.invalidate` (or `config.zones.*`) event to NATS — the same as always.
5. Because the Nuremberg node's local NATS server is part of the same NATS **cluster** as Oracle's (Section 4), and the Nuremberg edge-proxy is subscribed to the same topics it always was, **it already knows** about that change — it doesn't need to ask the control plane directly, and it doesn't matter that the change originated on a machine hundreds of kilometers away.
6. The Nuremberg Edge Proxy runs its ordinary 3-layer cache logic (L1 → L2/`redis-edge` → origin/MinIO, exactly as described in [`edge-proxy-and-caching.md`](edge-proxy-and-caching.md)) — except any stale entry has already been purged, so this is correctly treated as a fresh cache miss rather than incorrectly serving old content.
7. The response goes back to the Munich visitor over a short, fast, physically local network path — instead of round-tripping to wherever the Oracle control plane's data center happens to be.

The EDD's own stated goal for this stage captures the measurable outcome directly: **"EU users get 20–50ms CDN response vs 100ms+"** (EDD Section 11, task 14.4) — the same caching mechanism, just finally reachable from nearby instead of far away.

---

## 8. Quick reference: how the pieces connect

```
                     edge.rivocloud.dev  (GeoDNS record)
                              │
             ┌────────────────┴────────────────┐
             │  "where is this request from?"  │
             └────────────────┬────────────────┘
                 EU visitor            everyone else (for now)
                     │                          │
                     ▼                          ▼
        ┌─────────────────────────┐  ┌─────────────────────────┐
        │  Hetzner CX21            │  │  Oracle Cloud            │
        │  Nuremberg, Germany      │  │  (control plane + the    │
        │                          │  │   original Edge Proxy)   │
        │  edge-proxy × 2          │  │  edge-proxy               │
        │  redis-edge (L2, 2GB)    │  │  Redis (L2)                │
        │  node-exporter           │  │  Identity/CDN/Storage/...  │
        │  fail2ban                │  │  Postgres, ClickHouse       │
        └───────────┬──────────────┘  └────────────┬────────────┘
                    │                              │
                    └───────── NATS cluster ────────┘
              (cache.invalidate.*, config.zones.* —
               published once, delivered to every
               subscribed edge-proxy, regardless
               of which physical site it runs on)

  Provisioned by: an Ansible playbook (installs Docker, deploys
  docker-compose.edge.yml) — repeatable for this node and every
  future one (Helsinki, Ashburn, ... per the master architecture's
  later scaling stages).
```

**The one-line summary:** up through Stage 13, RivoCloud's "CDN" was a fully-working caching mechanism running in exactly one physical place, which meant no real latency win for anyone far from it; Stage 14 changes that by using Ansible to repeatably provision a second, physically distant server (a Hetzner CX21 in Nuremberg), extending the NATS cluster so cache invalidations reach that new location as reliably as the original one, and using GeoDNS to invisibly route nearby visitors to it — turning "a caching proxy in one data center" into the first real, physically distributed step of a genuine Content Delivery *Network*.
