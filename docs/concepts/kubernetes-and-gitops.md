# Kubernetes & GitOps — Explained for Beginners

This document explains the concepts behind **Stage 13: Kubernetes Migration** — the Month 9 move from running RivoCloud on plain Docker Compose to running it on **k3s** (a lightweight Kubernetes) with **ArgoCD** managing deployments via **GitOps**. It assumes you've read [`docker-compose-and-infrastructure.md`](docker-compose-and-infrastructure.md), especially [Section 6, "How this will run on a real server"](docker-compose-and-infrastructure.md#6-how-this-will-run-on-a-real-server) — that section previewed this exact migration and gave a quick comparison table (Section 6.3). This document is the deep dive that preview promised.

**Important:** Stage 13 has **not been built yet**. Everything below describes the plan, grounded in [`superpowers/specs/2026-06-29-revocloud-phase1-cdn-edd.md`](../superpowers/specs/2026-06-29-revocloud-phase1-cdn-edd.md) (Sections 3.2, 9.4, 9.5, and 11) and [`superpowers/specs/2026-07-25-revocloud-phase1-prd.md`](../superpowers/specs/2026-07-25-revocloud-phase1-prd.md) (Section 7). Nothing in this document exists in the codebase today — it's a map of what Month 9 will build, so that when it's built, the concepts aren't new.

If you haven't read [`phase1-explained-for-beginners.md`](../phase1-explained-for-beginners.md) yet, start there — its glossary entries for ["Kubernetes (K8s) / k3s"](../phase1-explained-for-beginners.md#35-deployment--operations-concepts) and ["GitOps"](../phase1-explained-for-beginners.md#35-deployment--operations-concepts) are the one-paragraph version of everything below.

---

## 1. Quick recap: what Section 6.3 already told you

[`docker-compose-and-infrastructure.md` Section 6.3](docker-compose-and-infrastructure.md#63-what-stays-conceptually-the-same-either-way) gave this comparison table, mapping Docker Compose ideas onto their Kubernetes equivalents:

| Concept | Docker Compose (now) | Kubernetes (later) |
|---|---|---|
| "Which container image, which version" | `image:` field | A Pod's container spec |
| "How do containers find each other" | Compose's bridge network, by service name | Kubernetes DNS + Services |
| "Where does data survive a restart" | Named `volumes:` | PersistentVolumes |
| "Is this thing actually ready" | `healthcheck:` | Liveness/Readiness probes |
| "Which port is this reachable on" | `ports:` mapping to your laptop | Ingress / load balancer |

That table is correct but shallow on purpose — it exists to reassure you that nothing conceptually new is happening, just a change of vocabulary. This document goes underneath each of those rows: what a Pod actually *is*, why a Service is more than "DNS," how a PersistentVolume is provisioned rather than just declared, and — the part Section 6.3 didn't cover at all — how ArgoCD and GitOps change *who* is allowed to make production change happen.

---

## 2. k3s vs. full Kubernetes: why the lightweight version

"Kubernetes" (often shortened to **K8s** — "K, 8 letters, s") is a system for running many containers across multiple machines reliably: it restarts crashed containers, spreads load, and rolls out updates gradually. The original Kubernetes project ("upstream K8s") was built at Google for *enormous* scale — clusters with hundreds or thousands of machines, multiple redundant control planes, and every optional feature imaginable. Installing it typically means running several extra background components (etcd as a separate multi-node cluster, cloud-provider integrations, various controller processes) that only pay for themselves at that kind of scale.

**k3s** is a real, certified Kubernetes distribution (not a simulation or a subset with missing features) but repackaged by Rancher specifically for **small clusters and constrained hardware**: it ships as a single binary under 100MB, bundles its own lightweight datastore instead of requiring a separately-managed etcd cluster, drops legacy/alpha APIs and in-tree cloud-provider code most small deployments never touch, and uses `containerd` directly instead of a heavier container runtime stack.

Per the EDD (Section 3.2), RivoCloud's production Kubernetes cluster at this stage is:

```
2× Oracle Cloud A1.Flex instances (ARM, "Always Free" tier)
   4 cores / 24GB RAM each
   Node 1: k3s control-plane + worker
   Node 2: worker only
```

That's a **two-node cluster on free-tier hardware** — nowhere near the scale upstream Kubernetes assumes. Running full Kubernetes here would mean paying an operational tax (more moving parts to patch, monitor, and debug) for capabilities RivoCloud doesn't need yet: no multi-region control plane, no hundreds of nodes, no need for every cloud-provider plugin. k3s gives the same Pod/Deployment/Service/PersistentVolume model — everything below in this document applies identically — while fitting comfortably on two small VMs and being simple enough for a small team to actually operate. This is the same philosophy as choosing Docker Compose over Kubernetes back in Stage 1: pick the simplest tool that solves the actual problem at the actual scale, and upgrade only when the gap becomes real. k3s *is* that upgrade — a small step up in resilience, not a leap to Google-scale infrastructure the team doesn't need for a long time.

---

## 3. Pods, Deployments, and Services — in plain language

These three ideas are the daily vocabulary of Kubernetes, and they build directly on top of each other.

### 3.1 A Pod: "one or more containers running together"

A **Pod** is the smallest thing Kubernetes actually runs — it wraps one or more containers that always get scheduled onto the same machine, share a network address, and start/stop together. For most RivoCloud services, a Pod will contain exactly one container (e.g., "the CDN Service container"). This is the Kubernetes-native version of the row you already know from Section 6.3: "which container image, which version" — a Pod's spec says exactly which image (e.g., `ghcr.io/rivocloud/cdn-service:v1.2.3`), same idea as the `image:` field in `docker-compose.infra.yml`, just described in a different file format.

Pods are also **disposable by design** — the same way a Compose container is disposable and relies on a named `volume:` for anything that must survive. Kubernetes expects Pods to die and be replaced constantly (a crash, a machine reboot, a rolling update) and doesn't try to keep any specific Pod alive forever. That's precisely why Pods are never created directly in production — they're managed by something one level up:

### 3.2 A Deployment: "keep N copies of this Pod running"

A **Deployment** is an instruction, not a running thing itself: "I want 3 copies of the CDN Service Pod running, always. If one dies, start a replacement. If I give you a new image version, replace the old copies with new ones gradually." Kubernetes continuously compares what's actually running against what the Deployment asks for, and reconciles any difference — this loop never stops.

Concretely, from the EDD's planned cluster layout (Section 3.2), the `Rivocloud-control` namespace runs Deployments for `identity`, `cdn`, `storage`, `analytics`, `billing`, `notification`, and `dashboard`. Some of these also get an **HPA (Horizontal Pod Autoscaler)** — analytics scales between 1–5 replicas and storage between 1–3, based on load. This is a capability Docker Compose has no equivalent for at all: Compose can run a fixed number of containers, but nothing in Compose watches load and decides to spin up a fourth copy of a busy service automatically. This is the real payoff of "no automatic scaling" being listed as a gap in Section 6.1 of the Compose doc.

### 3.3 A Service: "a stable network name that routes to whichever Pods are healthy"

Pods come and go — a Deployment replacing a crashed Pod gives the replacement a *new* internal IP address. If other services had to track those IPs directly, everything would break every time a Pod restarted. A **Service** solves this by giving a *stable* name (e.g., `cdn-service`) that always routes traffic to whichever Pod copies are currently running and healthy, no matter how many times the underlying Pods have been replaced. This is the direct upgrade of the Compose row "how do containers find each other" — in Compose, a container is reachable by its fixed service name on the shared bridge network for as long as that one container is alive; in Kubernetes, a Service provides the same "reach it by name" convenience, but backed by a *set* of interchangeable, replaceable Pods rather than one fixed container.

### 3.4 Putting the three together

```
Deployment "cdn-service"  (says: keep 3 Pods running, image v1.2.3)
   │
   ├── Pod (cdn-service-a1b2c) ──┐
   ├── Pod (cdn-service-d3e4f) ──┼──▶  Service "cdn-service"  ──▶  stable name other
   └── Pod (cdn-service-g5h6i) ──┘      (cdn-service.rivocloud-      services call,
                                          control.svc.cluster.local)  e.g. from Dashboard
```

If the middle Pod (`cdn-service-d3e4f`) crashes, the Deployment notices the count dropped to 2, starts a replacement Pod (with a brand-new name/IP), and the Service updates automatically to include it — nothing calling `cdn-service` ever needs to know any of this happened.

---

## 4. PersistentVolumes: data that survives a restart, Kubernetes-style

Section 3 of the Compose doc explained why containers need **named volumes**: containers are disposable, but a database's actual data can't be. Kubernetes has the exact same requirement, solved with the same underlying idea, but with one added layer: because a Pod can be rescheduled onto a *different physical machine* than the one it was previously running on, "attach a folder on this machine's disk" isn't enough — the storage has to be something the cluster itself can find and reattach, wherever the Pod ends up.

- A **PersistentVolume (PV)** is a piece of storage the cluster knows about (a disk, a network volume, or in RivoCloud's case, storage carved out of the Oracle Cloud nodes) — conceptually the same thing a named `volume:` is in Compose, just registered with the cluster instead of with one machine's Docker daemon.
- A **PersistentVolumeClaim (PVC)** is how a Pod asks for one — "I need 20GB of storage that persists" — without needing to know exactly which physical disk it'll get. Kubernetes matches the claim to an available PersistentVolume (or provisions one on demand).
- A **StatefulSet** is the Deployment-equivalent used specifically for things that need stable identity and their own persistent storage per copy — databases, message queues — rather than interchangeable stateless replicas. Per the EDD's planned layout, the `rivocloud-infra` namespace runs StatefulSets for `postgres` (primary + one replica, via Patroni), `redis` (3-node Sentinel setup), `minio` (4 PersistentVolumeClaims using erasure coding), `clickhouse`, and `nats` (3-node JetStream cluster).

The practical difference from Compose: in `docker-compose.infra.yml` today, `postgres_data` is one named volume tied to one container on one machine — if that machine dies, the volume (and the data) is only as available as that one disk. In the Kubernetes plan, Postgres becomes a 2-node cluster with its own replication (Patroni), Redis becomes a 3-node Sentinel setup instead of one instance, and MinIO spreads its 4 volumes across nodes with erasure coding — so the *storage itself* stops being a single point of failure, not just the compute running on top of it. This is exactly the "production hardening" work the Month 9 roadmap calls out alongside the Kubernetes migration itself (see Section 8 below).

---

## 5. GitOps and ArgoCD: "the desired state lives in Git"

Everything in Sections 3–4 describes *what* Kubernetes can do. GitOps is about *how* those Deployments, Services, and PersistentVolumes actually get changed in production — and it's the part Section 6.3's table didn't cover at all, because it isn't really a "translate this Compose concept" idea. It's new.

### 5.1 The core idea

**GitOps** means: the complete, authoritative description of what should be running in production is a set of files checked into Git — not a person's memory of what commands they ran, not a runbook, not a server's actual current state. A tool (**ArgoCD**, in RivoCloud's plan) continuously watches those files and continuously compares them against what's *actually* running in the cluster. If they differ, ArgoCD changes the cluster to match the files — never the other way around.

Per the EDD (Section 3.2 and 9.4), the plan is:

```
Repository: github.com/rivocloud/infrastructure
  kubernetes/
    overlays/
      production/
        image-tags.yaml   ← updated by CI with new image SHAs
        values.yaml        ← production-specific config

ArgoCD Application:
  source: that repo, path: kubernetes/overlays/production
  destination: the k3s cluster
  syncPolicy: automated (prune: true, selfHeal: true)
```

`prune: true` means if a manifest is *removed* from Git, ArgoCD removes the matching resource from the cluster too — Git isn't just additive, it's the full source of truth. `selfHeal: true` means if someone manually changes something in the live cluster directly (bypassing Git — e.g., an emergency `kubectl edit`), ArgoCD will notice the drift and revert it back to match Git automatically. Combined, these two settings are what "the desired state lives in Git" really enforces in practice: the cluster is *not allowed* to disagree with Git for long, in either direction.

### 5.2 "Merge to main = deployed"

The actual production deploy process (EDD Section 9.4):

1. A release is tagged: `git tag v1.2.3 && git push --tags`.
2. CI builds Docker images tagged `:v1.2.3`.
3. CI updates `kubernetes/overlays/production/image-tags.yaml` with the new image SHAs, and that change is merged to `main`.
4. ArgoCD notices the Git state changed, computes the diff against the live cluster, and applies it — triggering a rolling update.

Compare this to the "manual updates" gap called out in Section 6.1 of the Compose doc: deploying today means someone logging into a server and re-running Compose commands by hand. That's fast to set up, but it means the *only* record of what's actually running in production is whatever that person typed, whenever they typed it — not reviewable, not reversible by anyone else, easy to get subtly wrong (typos, forgetting a step, running it against the wrong environment).

GitOps replaces that with something with real, structural safety properties:

- **Auditable** — every production change is a Git commit, with an author, a timestamp, and (via the normal PR process) a reviewer. "Who changed production, and when, and why" is a `git log`, not a guess.
- **Reversible** — rolling back means reverting the Git commit; ArgoCD sees the reverted state and undoes the change in the cluster the same way it applied it.
- **No drift** — because of `selfHeal`, the cluster can't quietly diverge from Git over months of small manual tweaks nobody remembers making — a common way production environments become fragile and undocumented.
- **No direct server access needed for routine deploys** — nobody needs SSH credentials to a production node just to ship a change; they need permission to merge to `main`, which is a much easier thing to control and log.

This is the real content behind the "GitOps" glossary entry in [`phase1-explained-for-beginners.md`](../phase1-explained-for-beginners.md#35-deployment--operations-concepts): "a tool automatically makes the real infrastructure match [Git]." ArgoCD is that tool, and Section 9.4 above is what "automatically" means in RivoCloud's specific case.

---

## 6. Blue/Green deployment: reverting a bad deploy instantly

A normal rolling update (Section 3.2 and 7 below) replaces old Pods with new ones gradually, in place. That's fine for routine changes, but for **high-risk changes** — a database migration, a breaking API change — RivoCloud's plan (EDD Section 9.5) uses a stricter pattern: **Blue/Green deployment**.

The idea: instead of replacing the running version in place, deploy the *new* version (Green) fully, side-by-side with the *currently live* version (Blue), without sending it any real traffic yet. Only once Green is confirmed healthy does traffic start moving to it — and if anything looks wrong at any point, traffic can be pointed straight back at Blue, which never stopped running.

```
Step 1 — Blue is live, 100% of traffic
             Blue (v1.2.2) ◀────────── 100% traffic

Step 2 — Deploy Green alongside Blue, no traffic yet
             Blue (v1.2.2) ◀────────── 100% traffic
             Green (v1.2.3) ◀───────── 0% traffic, smoke-tested internally

Step 3 — Shift traffic gradually (Traefik weighted routing), watching error rate
             Blue 90% / Green 10%  →  wait, watch
             Blue 50% / Green 50%  →  wait, watch
             Blue  0% / Green 100% →  Blue stays up as standby, not deleted

Step 4 — If anything looks wrong at any point: instant rollback
             kubectl apply -f traefik/routing-blue-100.yaml   ← back to 100% Blue immediately
```

The key property: because Blue never stopped running while Green was being validated, "rollback" isn't "redeploy the old version and wait for it to start up again" — it's "flip a routing rule," which takes effect immediately. Once there are real, paying customers (which is exactly what's approaching by the time Stage 16, Public Beta, arrives), the cost of a bad deploy staying live for even a few extra minutes — while someone reacts, diagnoses, and re-deploys the old version — is real: failed requests, corrupted data from a bad migration, or a broken API breaking customer integrations. Blue/Green trades a bit of extra infrastructure (running two versions briefly) for the ability to undo a mistake instantly, before it does much damage.

---

## 7. Why Month 9 — after everything else, before Public Beta

Stage 13 sits at a very deliberate point in the [16-stage build order](../phase1-explained-for-beginners.md#5-how-phase-1-is-built-the-16-stages):

- Per the PRD's roadmap table (Section 7), Stage 13 formally **depends on stages 4, 5, 6, 7, 8, 9, 10, 11, and 12** — that is, the CDN Service, Storage Service, Dashboard, cache invalidation, custom domains, Analytics, signed URLs, Security/RBAC, and Billing all need to already exist and work on Docker Compose *first*.
- It's scheduled **before Stage 14** (the first real Hetzner edge node) and **before Stage 16** (Public Beta) — both of which need the platform to already be resilient before they add real geographic distribution and real public users, respectively.

The reasoning, stated directly in the EDD's Development Order (Section 11) and echoed in the beginner glossary: this is a **purely operational upgrade**. It doesn't add a single new customer-facing feature — a zone, a bucket, an invoice all work identically whether the CDN Service is a Docker Compose container or a Kubernetes Pod. What it changes is *how reliably* an already-complete system keeps running, and *how safely* changes to it get deployed. Doing this work earlier — say, right after Stage 1 — would mean operating a full Kubernetes cluster for months before there's anything at stake, paying the operational complexity tax with none of the payoff yet. Doing it any later — after Stage 16, Public Beta — would mean the very first real, paying customers hit the platform while it's still running on a single Docker Compose box with no automatic failover, no gradual rollout, and no instant rollback. Month 9 is the last reasonable moment to harden the system before Month 10's public launch (Stage 16) and the second edge node (Stage 14) raise the stakes on both reliability and correct rollout — hence "after the system is functionally complete, but before it needs to survive contact with the real world."

---

## 8. What else ships alongside the migration

Kubernetes and ArgoCD are the headline of Month 9 ("Production Hardening" in the EDD's roadmap, Section 10), but the same month bundles several related reliability upgrades — worth knowing about even though they aren't the focus of this document:

- **PgBouncer** — a connection pooler placed in front of PostgreSQL, so many short-lived service connections share a smaller pool of real database connections instead of each service opening its own, which Postgres handles poorly at scale.
- **Redis Sentinel** — turns the single Redis instance from Compose into a 3-node cluster with automatic failover, so a crashed Redis node doesn't take the Edge Proxy's L2 cache down with it.
- **MinIO distributed mode** — spreads object storage across 4 PersistentVolumes with erasure coding (mentioned in Section 4 above), so storage survives losing a disk without losing data.
- **Alertmanager rules** — automated alerts for high error rate, high latency, low disk space, and TLS certificate expiry, built on top of the Prometheus/Grafana/Loki stack already running since Stage 1.

These all serve the same Month 9 theme as the Kubernetes migration itself: make an already-working system harder to knock over, without changing what it does.

---

## 9. A concrete walkthrough: merging a code change to production

Putting Sections 5–6 together, here's the full path a routine code change takes once Stage 13 is live:

1. A developer merges a pull request to `main` that changes the CDN Service's code.
2. CI builds a new Docker image (e.g., `ghcr.io/rivocloud/cdn-service:v1.4.0`) and updates `kubernetes/overlays/production/image-tags.yaml` in the infrastructure repo with the new image tag, then merges that change to `main` too.
3. **ArgoCD**, which continuously polls the Git repository, notices the Git state now differs from what's running in the cluster — the Deployment's desired image tag changed.
4. ArgoCD applies the updated manifest to the k3s cluster. The `cdn-service` **Deployment** now wants Pods running `v1.4.0` instead of `v1.3.9`.
5. Kubernetes rolls this out gradually: it starts one new `v1.4.0` Pod, waits for it to pass its readiness probe (the Kubernetes-native version of Compose's `healthcheck:`), then terminates one old `v1.3.9` Pod — repeating until every Pod is running the new version. The **Service** (`cdn-service`) keeps routing traffic to whichever Pods are currently healthy throughout, so there's no moment where the service is unreachable.
6. If one of the new Pods **crashes** at any point during or after rollout — a bug, an out-of-memory error — Kubernetes notices the Deployment's replica count has dropped below what was requested and starts a replacement Pod automatically, possibly scheduled onto the *other* physical node in the cluster if the first one is under load or unreachable. Nobody needs to be paged for this specific failure mode; it self-heals the same way `selfHeal: true` makes the cluster self-heal against configuration drift (Section 5.1).
7. For a high-risk change instead (a database migration) the same starting point (merge to `main`) instead triggers the Blue/Green flow from Section 6 — Green deployed and validated before traffic moves, with instant rollback available the whole time.

---

## 10. Why this depends on Docker Compose already working (Stages 4–12)

It's worth being explicit about why Stage 13 can't come earlier, beyond "the PRD table says so." Every one of the services being migrated — CDN Service, Storage Service, Dashboard, the NATS invalidation flow, custom domains, Analytics, signed URLs, RBAC, Billing — has to already be **correct** on Docker Compose before it's worth the effort of also making it **resilient** on Kubernetes. Migrating a service to Kubernetes changes *how it runs*, not *what it does* — there's no new business logic in a Deployment YAML file. If a service's actual behavior (its CDN Service logic, its billing logic) still had bugs or missing features, migrating it to Kubernetes wouldn't fix any of that — it would just mean debugging the same unfinished logic on a more complicated platform. Building resilience on top of a proven, working system (which is what Stages 4–12 deliver) is strictly cheaper than building it underneath a system still being figured out. This is the same "foundation → core mechanism → management layer → polish layer" pattern described in [`phase1-explained-for-beginners.md` Section 5](../phase1-explained-for-beginners.md#the-key-idea-behind-the-ordering) — Stage 13 is the platform-wide "polish layer" for reliability, and it only makes sense once everything it's hardening already exists.

---

## 11. One picture

```
docs/concepts/docker-compose-and-infrastructure.md         docs/concepts/kubernetes-and-gitops.md
   "how it runs on one machine, today"        ──migrates──▶   "how it runs on a cluster, Month 9"

  Compose container      ──becomes──▶  Pod (in a Deployment, N replicas, self-healing)
  Compose bridge network ──becomes──▶  Service (stable name, routes to healthy Pods)
  Named volume            ──becomes──▶  PersistentVolume (cluster-managed, survives Pod rescheduling)
  healthcheck:             ──becomes──▶  Liveness / Readiness probes
  Manual `docker compose up` on a server ──becomes──▶  ArgoCD watching Git, auto-syncing the cluster
  (no rollback plan)       ──becomes──▶  Blue/Green: instant rollback via routing change

  git merge to main
        │
        ▼
  CI builds image, updates kubernetes/overlays/production/image-tags.yaml
        │
        ▼
  ArgoCD detects Git ≠ cluster  ──▶  applies diff  ──▶  Kubernetes rolls out new Pods,
                                                          terminates old ones gradually
        │
        ▼
  If a Pod crashes anytime → Kubernetes restarts it, maybe on the other node
```

**The one-line summary:** k3s gives RivoCloud the same Pod/Deployment/Service/PersistentVolume model as full Kubernetes — self-healing, auto-scaling, resilient storage — but sized for a two-node free-tier cluster instead of Google-scale infrastructure; ArgoCD then makes Git, not a person's memory of commands, the one source of truth for what's running in production, so "merge to main" becomes the entire deploy process, with Blue/Green available as an extra safety net for the riskiest changes — all of it a reliability upgrade to a system that must already work correctly on Docker Compose first.
