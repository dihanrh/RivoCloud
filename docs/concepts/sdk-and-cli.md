# SDK & CLI — Explained for Beginners

This document explains **everything you need to understand before Stage 15 (SDK + CLI) gets built** — what an SDK is, what a CLI is, why RivoCloud builds *two* different developer tools instead of one, why they're written in different programming languages, and — most importantly — why this stage sits dead last but one in the 16-stage build order instead of near the beginning.

**Nothing described here exists in code yet.** Per the [Phase 1 PRD](../superpowers/specs/2026-07-25-revocloud-phase1-prd.md) (Section 7, Implementation Roadmap), Stage 15 is targeted for Month 10 and is listed as "Not started," depending on Stages 4 (CDN Service), 5 (Storage Service), and 7 (NATS Invalidation) already being complete. If you haven't read [`../phase1-explained-for-beginners.md`](../phase1-explained-for-beginners.md) yet, read that first — its Section 3.4 glossary entry on **API Key** is required background, since every SDK/CLI call authenticates with one. This document goes deeper on the SDK/CLI terms specifically, the same way [`docker-compose-and-infrastructure.md`](docker-compose-and-infrastructure.md) went deeper on infrastructure for Stage 1.

The authoritative specs behind everything below are the [Phase 1 PRD](../superpowers/specs/2026-07-25-revocloud-phase1-prd.md) (Section 5.11, "SDK & CLI," and Section 7, Implementation Roadmap), the [Phase 1 EDD](../superpowers/specs/2026-06-29-revocloud-phase1-cdn-edd.md) (Section 7, REST API Design; Section 10, Month 10 tasks; Section 11, block "15. SDK + CLI"), and the [master architecture](../superpowers/specs/2026-06-29-revocloud-master-architecture.md) (Section 2, Product Strategy — Version 1.0).

---

## 1. What is an SDK, in plain language?

**SDK** stands for **Software Development Kit**. Despite the grand-sounding name, in RivoCloud's case it's a much simpler thing than it sounds: **a library — a package of pre-written code — that lets a developer call RivoCloud's features as ordinary function calls in their own programming language, instead of manually constructing raw HTTP requests.**

Concretely, without an SDK, a developer who wants to create a CDN zone has to do all of this themselves:

```
POST /api/v1/zones HTTP/1.1
Host: api.rivocloud.dev
Authorization: X-API-Key: rc_live_3qYJAKRpX8mF2nQ7vDsHbL9wEcT5iUg4
Content-Type: application/json

{
  "name": "my-app-cdn",
  "originUrl": "https://api.customer-backend.com",
  "defaultTtl": 3600
}
```

They'd need to know the exact URL path, the exact header name for the API key, the exact JSON field names, and how to parse the response — and they'd need to redo all of that (in whatever language they're using: Python, JavaScript, Go...) every time they wanted to call a different endpoint.

With the JavaScript/TypeScript SDK described in the EDD (Section 11, block 15.1), the same action becomes:

```javascript
import { RivoCloud } from "@rivocloud/sdk";

const client = new RivoCloud({ apiKey: "rc_live_3qYJAKRpX8mF2nQ7vDsHbL9wEcT5iUg4" });

const zone = await client.zones.create({
  name: "my-app-cdn",
  originUrl: "https://api.customer-backend.com",
  defaultTtl: 3600,
});
```

The SDK's `client.zones.create(...)` function, somewhere inside its own code, does *exactly* the raw HTTP request shown above — it just hides the HTTP details behind a friendly function name, and hands back a normal JavaScript object instead of raw JSON text to parse. This pattern — a library that wraps an API's raw request/response mechanics into idiomatic function calls in a specific language — is what "SDK" means in almost every context you'll encounter it (Stripe's SDK, AWS's SDK, Twilio's SDK — all follow this same shape).

---

## 2. The SDK adds convenience, not new capability

This is the single most important thing to understand about the SDK, and it's easy to miss because "SDK" sounds like a big, separate product: **the SDK cannot do anything that wasn't already possible by calling the REST API directly with a tool like `curl`.** It is a *wrapper*, not new functionality.

| Without the SDK (raw HTTP) | With the SDK |
|---|---|
| `curl -X POST https://api.rivocloud.dev/api/v1/zones -H "X-API-Key: ..." -H "Content-Type: application/json" -d '{"name":"my-app-cdn","originUrl":"..."}'` | `client.zones.create({ name: "my-app-cdn", originUrl: "..." })` |
| You must remember the exact path (`/api/v1/zones`), method (`POST`), header name, and JSON shape | The SDK's function signature and (in TypeScript) autocomplete/type-checking tell you what's needed |
| Errors come back as raw HTTP status codes + JSON bodies you must parse yourself | Errors are thrown as proper JavaScript exceptions with typed fields |
| Works from any language, any tool, including a terminal with no code at all | Only works from JavaScript/TypeScript projects that install the package |
| Nothing to install beyond `curl` itself | `npm install @rivocloud/sdk` |

Everything in the right-hand column is still, underneath, the exact same [REST API endpoints](../superpowers/specs/2026-06-29-revocloud-phase1-cdn-edd.md) documented in EDD Section 7 (e.g. `POST /api/v1/zones`, `POST /api/v1/buckets/:bucketId/objects/upload`, `POST /api/v1/zones/:zoneId/cache/invalidate`) that Stages 4, 5, and 7 already built. The SDK doesn't teach RivoCloud's servers to do anything new; it teaches *client code* a nicer way to ask for the same things. This is why the PRD (Section 5.11) and master architecture (Section 2, Version 1.0) both frame the SDK/CLI as a **DX (Developer Experience)** investment rather than a feature — the master architecture explicitly lists "DX / SDK" as a competitive differentiator ("First-class," vs. "Poor" for AWS CloudFront and "Mediocre" for Bunny.net), precisely *because* good DX doesn't require the underlying product to change at all — it just makes the existing product easier to use from code.

---

## 3. Why the SDK/CLI are built last, not early

It might seem natural to build the SDK early — wouldn't it make every other stage of development easier to have a nice client library from day one? In practice, the opposite is true, and the EDD's own dependency note explains why (Section 11, block 15, and the PRD's Section 7 roadmap table lists Stage 15's dependencies as Stages 4, 5, and 7):

**An SDK is a mirror of the REST API.** Every function in the SDK (`client.zones.create(...)`, `client.storage.upload(...)`, `client.cache.invalidate(...)`) exists only because a matching REST endpoint exists (`POST /api/v1/zones`, `POST /api/v1/buckets/:bucketId/objects/upload`, `POST /api/v1/zones/:zoneId/cache/invalidate`). If the SDK were built *before* those endpoints were finished and stable, every time the CDN Service (Stage 4), Storage Service (Stage 5), or invalidation endpoints (Stage 7) changed their URL shape, field names, or behavior during development, the SDK would have to be rewritten to match — and so would every example, every test, and every early adopter's code that used the old version.

Put simply: **building a wrapper around an API that's still changing means constantly rewriting the wrapper.** By deliberately sequencing SDK/CLI as Stage 15 — after zones (4), storage (5), and cache invalidation (7) are all done and their endpoints have stabilized — the SDK only has to be written *once*, against a REST API that isn't moving anymore. This is the same "foundation → core mechanism → management layer → polish layer" pattern used throughout the whole 16-stage plan (see [`phase1-explained-for-beginners.md`, Section 5](../phase1-explained-for-beginners.md#the-key-idea-behind-the-ordering)): the SDK is pure "polish layer" — it makes an *already-working* platform nicer to use, the same way Stage 13 (Kubernetes migration) made an already-working platform more resilient without adding new customer-facing behavior.

---

## 4. What is a CLI, and why build one in addition to an SDK?

**CLI** stands for **Command-Line Interface** — a program you run by typing commands into a terminal, rather than by writing code that imports a library. Per the EDD (Section 11, block 15.2) and Section 10's Month 10 task list, RivoCloud's planned CLI commands include things like:

```
rivocloud zones list
rivocloud cache invalidate /path
rivocloud upload ./dist ./my-bucket
```

It's reasonable to ask: if the SDK already wraps the REST API, why build a *second* wrapper? The answer is that the SDK and the CLI serve two different kinds of "caller":

| | JavaScript/TypeScript SDK | CLI |
|---|---|---|
| Who uses it | A developer writing *code* — inside their own application, a build script, or a serverless function | A human typing directly into a terminal, **or** a shell script / CI pipeline step |
| How it's invoked | `import` it into a `.js`/`.ts` file, then call functions | Type a command, or run it as one line in a CI YAML file |
| Example | `await client.zones.create({...})` inside an app's setup script | `rivocloud zones list` typed by a developer checking what zones exist |
| Typical moment of use | While building a feature that needs to *programmatically* manage RivoCloud resources as part of a larger application | A one-off administrative action, or an automated step in a deploy pipeline (e.g. "after every deploy, invalidate `/index.html`") |

Concretely: a developer building a SaaS product that automatically provisions a new CDN zone for every new customer signup needs the **SDK**, because that logic lives inside their own Node.js backend code. A DevOps engineer who just wants to purge a cache path after every production deploy, from a GitHub Actions workflow, needs the **CLI** — writing and maintaining a whole Node.js script just to make one HTTP call from a CI job is needless overhead when a single CLI command does the same thing in one line. Both tools call the exact same REST API underneath (see Section 2 above) — they just meet two different kinds of user where they already are.

---

## 5. Why is the CLI written in Go with "cobra," not TypeScript like the SDK?

The EDD (Section 11, block 15.2) specifies the CLI as **Go, using cobra** — a popular Go library for building command-line tools, providing subcommands (`zones`, `cache`, `upload`), flag parsing (`--ttl 3600`), and auto-generated `--help` text. This is a deliberate, different choice from the SDK's TypeScript, and it comes down to one practical property: **how the tool gets installed on someone else's machine.**

The JavaScript SDK is *meant* to be installed inside a Node.js project via `npm install @rivocloud/sdk` — anyone using it already has Node.js and a `package.json`, because that's the whole point of an SDK: it lives inside your application's existing code.

The CLI is different. It needs to run on:
- A developer's laptop, who may or may not have Node.js installed, and shouldn't need to install a whole JavaScript runtime just to purge a cache path.
- A CI runner (GitHub Actions, GitLab CI, etc.), where every extra `npm install` step adds seconds to every single pipeline run, forever.
- Any operating system (Linux CI containers, a Mac laptop, a Windows machine) without needing per-OS setup instructions.

**Go compiles to a single, standalone binary file** — one executable with no separate runtime needed (no Node.js, no Python interpreter, nothing to `npm install` first). Downloading `rivocloud` (a single file) and running it directly, on any of the platforms above, works immediately. This is the same reason the Edge Proxy (see [`edge-proxy-and-caching.md`](edge-proxy-and-caching.md)) is written in Go rather than Node.js/NestJS like the rest of the control plane, though for a different underlying reason there (raw request-handling speed, not distribution) — see the "Two Worlds" split in [`phase1-explained-for-beginners.md`, Section 2](../phase1-explained-for-beginners.md#2-the-big-picture-two-worlds). For the CLI, the deciding factor is purely: *what's the least friction way to get this exact tool running on any developer's machine or CI runner, today, with nothing pre-installed?* A compiled Go binary answers that better than a TypeScript package ever could.

The [master architecture](../superpowers/specs/2026-06-29-revocloud-master-architecture.md) (Section 6, Monorepo Structure) reflects this: the CLI lives in its own `sdks/cli/` directory with its own `go.mod`, built with the `cobra` library's standard `cmd/` folder layout, alongside (but separate from) the JavaScript SDK in `sdks/js/` — two different packages, two different languages, two different distribution stories, both wrapping the same underlying REST API.

---

## 6. A concrete walkthrough

### Walkthrough A: A developer uses the SDK inside their own app

1. A developer building a new SaaS product wants every new customer signup to automatically get their own CDN zone. They run `npm install @rivocloud/sdk` in their Node.js backend project.
2. They already have a RivoCloud **API key** (`rc_live_...`) — generated from the dashboard, exactly as described in the [Identity Service doc](identity-service-and-auth.md) and the API Key glossary entry in [`phase1-explained-for-beginners.md`](../phase1-explained-for-beginners.md#34-identity-security-and-access) — stored as an environment variable, never hardcoded.
3. In their signup handler, they write:
   ```javascript
   import { RivoCloud } from "@rivocloud/sdk";
   const client = new RivoCloud({ apiKey: process.env.RIVOCLOUD_API_KEY });

   const zone = await client.zones.create({
     name: `customer-${customerId}`,
     originUrl: customerOriginUrl,
     defaultTtl: 3600,
   });

   await client.storage.upload({
     bucket: "customer-assets",
     key: `${customerId}/logo.png`,
     file: logoFileBuffer,
   });
   ```
4. Under the hood, `client.zones.create(...)` sends `POST /api/v1/zones` with the API key in the `X-API-Key` header (per EDD Section 7.1's auth convention); `client.storage.upload(...)` calls the Storage Service's presigned-upload flow described in [`object-storage-and-uploads.md`](object-storage-and-uploads.md) — requesting a presigned URL, then uploading the file bytes directly to it.
5. The developer never wrote a single raw HTTP request, never manually built a JSON body, and never parsed a response by hand — but every action they triggered is identical to what Stages 4 and 5 already built and tested directly.

### Walkthrough B: A DevOps engineer uses the CLI in a CI pipeline

1. A DevOps engineer wants every production deploy to automatically invalidate the CDN cache for the app's entry point, so visitors don't see a stale `index.html` after a release.
2. They download the `rivocloud` CLI binary (a single file — no Node.js install step) onto the CI runner, or as a prebuilt step in a container image.
3. They add one line to their existing GitHub Actions deploy workflow:
   ```yaml
   - name: Invalidate CDN cache
     run: rivocloud cache invalidate /index.html --zone my-app-cdn
     env:
       RIVOCLOUD_API_KEY: ${{ secrets.RIVOCLOUD_API_KEY }}
   ```
4. Under the hood, this single command performs exactly the same `POST /api/v1/zones/:zoneId/cache/invalidate` request that the CDN Service exposed back in Stage 4 and that Stage 7's NATS invalidation machinery (see [`cache-invalidation-and-messaging.md`](cache-invalidation-and-messaging.md)) already knows how to propagate to every Edge Proxy.
5. No JavaScript, no `npm install`, no application code — just one command, in one line, in a pipeline that runs on every deploy.

Both walkthroughs end up hitting the exact same REST endpoints; they just arrive there through the tool that best fits how each person works.

---

## 7. Quick reference: what wraps what

```
                     ┌───────────────────────────────────────┐
                     │        RivoCloud REST API (v1)         │
                     │  POST /api/v1/zones                    │
                     │  POST /api/v1/buckets/:id/objects/upload│
                     │  POST /api/v1/zones/:id/cache/invalidate│
                     │  ... (built in Stages 4, 5, 7)          │
                     └───────────────┬─────────────────────────┘
                                     │
              ┌──────────────────────┼──────────────────────┐
              │                      │                      │
              ▼                      ▼                      ▼
   curl / raw HTTP        JS/TS SDK (npm install)     Go CLI (single binary)
   (works everywhere,     client.zones.create(...)    rivocloud zones list
    nothing to install,   client.storage.upload(...)  rivocloud cache invalidate
    most manual)          — for code inside apps      rivocloud upload
                                                        — for terminals & CI
```

**Where this fits in the 16-stage build order:** SDK + CLI is Stage 15 of 16, the second-to-last stage, depending on Stage 4 (CDN Service), Stage 5 (Storage Service), and Stage 7 (NATS Invalidation) — see the full table in the [Phase 1 PRD, Section 7](../superpowers/specs/2026-07-25-revocloud-phase1-prd.md#7-implementation-roadmap). It exists to support Stage 16, [Public Beta](public-beta-and-launch.md), whose documentation site and onboarding flow will showcase both tools to the first external users.

---

**The one-line summary:** an SDK and a CLI are both just convenient, language-appropriate front doors onto the same REST API that earlier stages already built — the SDK (JavaScript/TypeScript) is for calling RivoCloud from inside your own application code, the CLI (Go, via cobra) is a single, dependency-free binary for humans and CI pipelines typing commands directly — and both are deliberately built last, once the underlying zones/storage/invalidation endpoints have stopped changing, so the wrapper only has to be written once.
