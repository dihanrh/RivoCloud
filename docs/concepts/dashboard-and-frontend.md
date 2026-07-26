# Dashboard & Frontend Concepts — Explained for Beginners

This document explains **everything you need to understand before Stage 6 (Dashboard MVP) gets built** — what Next.js is, why the dashboard counts as its own separate "service" even though it has no customers of its own data, why it gets built in pieces alongside each backend service instead of all at once, and what a "component library" like shadcn/ui buys you. It assumes **zero prior frontend framework knowledge** — if you've never touched React, Next.js, or a UI component library, start here.

**Nothing described here exists in code yet.** By the time Stage 6 starts, Stages 1–5 (Infrastructure, Identity Service, Edge Proxy, CDN Service, Storage Service) are either done or in progress — this doc is the "read this before you start" companion, the same way [`docker-compose-and-infrastructure.md`](docker-compose-and-infrastructure.md) was for Stage 1 and [`identity-service-and-auth.md`](identity-service-and-auth.md) was for Stage 2. If you haven't read [`../phase1-explained-for-beginners.md`](../phase1-explained-for-beginners.md) yet, read that first — it introduces the Dashboard in its microservices table (Section 3.6) and in the 16-stage build order (Section 5, stage 6), and this document goes much deeper on that same stage.

The authoritative specs behind everything below are the [Phase 1 PRD](../superpowers/specs/2026-07-25-revocloud-phase1-prd.md) (Section 5.10, functional requirement; Section 7, implementation roadmap) and the [Phase 1 EDD](../superpowers/specs/2026-06-29-revocloud-phase1-cdn-edd.md) (Section 2.9, Dashboard service design; Section 10, Month 1–3 tasks; Section 11, step 6, Development Order), plus the [master architecture doc](../superpowers/specs/2026-06-29-revocloud-master-architecture.md) (Section 6, Monorepo Structure) for where the dashboard's code will live.

---

## 1. What is Next.js, in plain language?

Before Next.js makes sense, you need one idea underneath it: **React**.

A website used to mean: the server builds an entire HTML page and sends it down, and every click that needs new data reloads the whole page from scratch. **React** is a JavaScript library that instead lets you build a page out of small, reusable pieces called **components** — a button, a login form, a table row — each responsible for its own little bit of the screen. When data changes (a user logs in, a new zone appears in a list), React updates only the parts of the page that actually changed, instead of reloading everything. This is what people mean by a "frontend framework" — a set of tools for building the parts of an application that run in the user's browser.

**Next.js** is a framework *built on top of* React that adds the pieces a real production application needs beyond "components that update themselves":

- **Routing** — mapping URLs like `/zones/42` to the right component, without hand-writing that logic yourself.
- **Server-side rendering (SSR)** — for the *first* load of a page, Next.js can run your React components on the server and send back fully-formed HTML, so the page appears instantly and search engines/screen readers can read it — instead of sending a blank page and a pile of JavaScript that the browser has to run before anything shows up. After that first load, the page behaves like a normal React app in the browser.
- **API routes** — small server-side endpoints that live inside the same Next.js project, useful as a thin proxy layer in front of RivoCloud's real backend services (see Section 2 below).

So, in one sentence: **Next.js is a React framework for building web applications that can render pages on the server (fast first load, good for search engines) and then take over in the browser (fast, app-like interactions afterward), with routing and lightweight server endpoints built in.** Per the EDD (Section 2.9), RivoCloud's dashboard uses **Next.js 15** with the **App Router** (Next.js's current, folder-based way of defining routes — a file at `app/zones/page.tsx` automatically becomes the `/zones` page, no separate routing configuration file needed).

### "Client" and "server" pages, in the same app

One more beginner-trips-here idea worth naming: in the App Router, every component is, by default, a **Server Component** — its code runs on the dashboard's own server, never gets sent to the browser as JavaScript, and is what produces that fast first-load HTML mentioned above. A component only becomes a **Client Component** (code that ships to and runs *in* the visitor's browser) when it's explicitly marked as one — because it needs to do something a server can't, like respond to a button click or remember what a user just typed into a form. A realistic RivoCloud page mixes both: the outer `/zones` page can be a Server Component that fetches the initial zone list before the page even renders, while the "Create Zone" button and its form inside that page are a Client Component, because clicking a button and typing into inputs only make sense running live in the browser. Neither kind talks to a database directly — both eventually go through the same API-route proxy described in Section 3.

---

## 2. Where the dashboard sits in the Control Plane / Data Plane split

[`phase1-explained-for-beginners.md`](../phase1-explained-for-beginners.md#2-the-big-picture-two-worlds) splits everything in RivoCloud into two worlds: the **Control Plane** ("the office" — configuration and management, touched only by RivoCloud customers) and the **Data Plane** ("the front counter" — the Edge Proxy, touched by every website visitor, all day, every day). The dashboard is squarely a **Control Plane** citizen, alongside Identity Service, CDN Service, Storage Service, Analytics Service, and Billing Service.

This matters because it sets expectations for how the dashboard is allowed to behave. Nobody's website visitors ever load the dashboard — only the RivoCloud *customer* managing their own account does, the same way only restaurant staff go into the back office, not the diners at the tables. That means the dashboard can afford things the Edge Proxy never could: a database round-trip here and there, a slightly slower page load while data is fetched, a full page re-render on navigation. None of that would be acceptable in the Data Plane, where every millisecond is multiplied by thousands of requests per second — but it's perfectly fine for a human clicking around a settings page a few times a minute. The dashboard is built in TypeScript (Next.js/React), the same broad technology family as the rest of the Control Plane's NestJS services, rather than the Go used for the performance-critical Edge Proxy — see the Control Plane vs. Data Plane comparison table in Section 2 of that document for the fuller reasoning behind that split.

---

## 3. Why the dashboard is its own "service," not just part of a backend

Looking at the microservices table in [`phase1-explained-for-beginners.md`](../phase1-explained-for-beginners.md#36-the-microservices-themselves), the Dashboard sits in the same list as Identity Service, CDN Service, Storage Service, and the rest — it is its own deployable program, with its own `Dockerfile` and its own place in the monorepo (`apps/dashboard/`, per the master architecture doc's [monorepo structure](../superpowers/specs/2026-06-29-revocloud-master-architecture.md), sitting alongside `apps/identity-service/`, `apps/cdn-service/`, `apps/storage-service/`, and so on).

This might seem surprising — doesn't the dashboard just *display* what the backend services already know? Yes, and that's exactly why it's separate: the dashboard owns **presentation** (pages, forms, charts, buttons), while every backend microservice owns **one narrow slice of data and logic** (Identity Service owns users/orgs, CDN Service owns zones, Storage Service owns buckets/objects). Mixing "serve HTML pages to browsers" into the same process as "manage zone configuration for the entire platform" would tie two very different jobs, with very different scaling and reliability needs, into one program.

**Crucially, the dashboard has no special, private access to any backend service's data.** It talks to Identity Service, CDN Service, and Storage Service using the exact same REST APIs documented in the EDD (Section 7) that any other API client — a script, the future CLI, a customer's own integration — would use: `POST /api/v1/auth/login`, `POST /api/v1/zones`, `POST /api/v1/buckets/:bucketId/objects/upload`, and so on. From the backend's point of view, the dashboard is just another caller carrying a JWT, indistinguishable from a request made with `curl`. This matters because it means the backend services never need dashboard-specific code paths — whatever the API can do, the dashboard can do, and nothing more.

Per the EDD (Section 2.9), the dashboard doesn't call these backend APIs directly from the browser, though — it proxies them through Next.js's own **API routes** (see Section 1 above) running on the dashboard's own server. Two reasons given: it avoids **CORS** issues (a browser security restriction that blocks a page loaded from one domain from freely calling an API on a different domain unless that API explicitly allows it), and it lets sensitive things like the refresh token be handled server-side rather than sitting exposed in browser JavaScript. So the real request path is: **browser → Next.js server (same origin) → the actual backend microservice (Identity/CDN/Storage/Analytics/Billing)** — one small extra hop, in exchange for a simpler and more secure browser-side story.

---

## 4. Why the dashboard is built incrementally, not all at once

Look again at stage 6 in the [16-stage build order](../phase1-explained-for-beginners.md#5-how-phase-1-is-built-the-16-stages):

> **Dashboard MVP (Months 1–3, ongoing)** — The actual web UI, built incrementally alongside each backend service (login pages once Identity exists, zone UI once CDN Service exists, storage UI once Storage Service exists). *Why it spans multiple months:* there's no point building UI for a feature that doesn't have a backend yet.

This is the single most important idea in this document. A login page is useless without an Identity Service to call `POST /api/v1/auth/login` against — it would just be a form that goes nowhere. A "Create Zone" button is useless without a CDN Service to call `POST /api/v1/zones` against. So instead of designing and building the *entire* dashboard up front and hoping the backend catches up, RivoCloud builds dashboard pages **in lockstep** with whichever backend service just became real:

| Backend service ships (Stage) | Dashboard piece that becomes buildable | EDD reference |
|---|---|---|
| Stage 2 — Identity Service | Login page, register page, dashboard layout skeleton | Section 11, step 6.1 |
| Stage 4 — CDN Service | Zone creation form, zone list, zone detail page | Section 11, step 6.2 |
| Stage 5 — Storage Service | Storage tab: bucket list, object browser, upload button | Section 11, step 6.3 |
| *(later stages, beyond Stage 6's own scope)* | Cache rules UI, analytics charts, billing page, settings — added in later stages (7, 9, 12, 11) as those backends ship | Section 11, steps 7–12 |

Per the EDD's Section 11 dependency notes: step 6.1 (auth pages) depends only on step 2.1 (Identity's login/register endpoints); step 6.2 (zone UI) depends on both 6.1 (needs a logged-in user) *and* 4.1 (the CDN Service's zone endpoints); step 6.3 (storage UI) depends on 6.1 *and* 5.1–5.3 (the Storage Service's bucket/upload/object endpoints). Each dashboard piece is gated on the backend it displays — never the other way around.

This also explains why Stage 6 doesn't have one single month or one single "depends on" like most other stages. Every other stage in the build order (see the [phase1-development-flow.md](../phase1-development-flow.md) diagram) is a single chunk of work with a clear starting dependency. The Dashboard instead **spans Months 1 through 3** in the [Development Roadmap](../superpowers/specs/2026-06-29-revocloud-phase1-cdn-edd.md#10-development-roadmap) (and keeps growing well past Month 3, as later stages add their own dashboard pages), because it isn't one feature — it's a *thin visual layer* that grows a little bit every time a backend feature becomes real. Concretely, per Section 10 of the EDD:

- **Month 1:** "Dashboard skeleton: login page, register page, dashboard layout (shadcn/ui)."
- **Month 2:** "Dashboard: Zone creation form, zone list, zone detail (basic)."
- **Month 3:** "Dashboard: Storage tab (bucket list, object browser), domain management UI."

---

## 5. shadcn/ui: what a "component library" is and why it's worth using

Section 1 introduced React **components** — small, reusable pieces of a page. But even once you know how to build a component, you still have to answer dozens of small design questions for every single one: how big should a button's padding be, what shade of gray is a disabled input, how does a dropdown menu animate open, what does an error state look like on a text field? Answering these consistently, for every component, across an entire application, by hand, is slow and easy to get subtly wrong (one page's buttons look slightly different from another page's).

A **component library** is a pre-built set of these common UI pieces — buttons, forms, dialogs, dropdowns, tables, tabs — already designed to look good and work correctly together, that you install and reuse instead of building from scratch. Per the EDD (Section 2.9), RivoCloud's dashboard uses **shadcn/ui**, built on **Tailwind CSS** (a utility-based styling system). shadcn/ui has one distinguishing trait worth knowing: instead of installing it as an opaque package you can't see inside, it copies the actual component source code into your own project — so it's a starting point you can freely customize, not a black box you're stuck with.

Using a component library like this means:

- **Consistency for free** — every button, form field, and dialog across every page (login, zones, storage, and everything added in later stages) looks and behaves the same way, because they're all built from the same underlying pieces.
- **Speed** — building "a form with a text input, a submit button, and validation error messages" from absolute scratch (styling, accessibility, keyboard navigation, focus states) takes real time; assembling one from ready-made pieces takes minutes.
- **Fewer bugs** — accessibility and edge-case behavior (e.g., "can you operate this dropdown with only a keyboard?") are handled once, by the library, instead of re-solved imperfectly on every new page.

This is why the Month 1 task list explicitly calls out "Dashboard skeleton: login page, register page, dashboard layout (shadcn/ui)" — the very first dashboard work isn't just "build a login form," it's "install the component library the *entire rest of the dashboard* will be built out of."

---

## 6. The dashboard's technology stack, at a glance

Per the EDD (Section 2.9), beyond Next.js and shadcn/ui:

| Piece | What it's for |
|---|---|
| **Next.js 15 (App Router)** | The framework itself — routing, server-side rendering, API routes (Section 1). |
| **shadcn/ui + Tailwind CSS** | The component library and styling system (Section 5). |
| **Recharts** | A charting library, used from Month 5 onward for the Analytics page (bandwidth graphs, cache-hit-ratio gauges) — not needed for Stage 6's own scope, but part of the same dashboard codebase. |
| **TanStack Query** | A library for fetching data from APIs and automatically handling loading states, caching responses, and re-fetching when data goes stale — e.g., keeping the zone list up to date without writing that bookkeeping by hand. |
| **Zod** | A schema-validation library, used to validate form input on the client (e.g., "is this a well-formed origin URL?") before ever sending it to a backend service. |

**Deployment:** the EDD notes the dashboard can run as a Docker container on the same infrastructure as the control plane, or on Vercel (a hosting platform built specifically for Next.js) for simplicity — either way, it's still just another container/process making REST calls to the backend services, the same as described in Section 3.

### Where this lives in the monorepo

Per the master architecture doc's [monorepo structure](../superpowers/specs/2026-06-29-revocloud-master-architecture.md#6-monorepo-structure), the dashboard is one `apps/` entry among the other deployable programs, following the same shape every app in the monorepo does — its own `Dockerfile` and `package.json`, plus a `src/` split into the pieces described in this document:

```
apps/
├── identity-service/     # NestJS — Stage 2
├── cdn-service/          # NestJS — Stage 4
├── storage-service/      # NestJS — Stage 5
├── ...
└── dashboard/            # Next.js — Stage 6 (this document)
    ├── src/
    │   ├── app/          # App Router pages: /login, /zones, /storage, ...
    │   ├── components/   # shadcn/ui-based components, reused across pages
    │   └── lib/          # API-client helpers, TanStack Query hooks, Zod schemas
    ├── Dockerfile
    └── package.json
```

Being just another `apps/` entry — not something bolted on separately, or living in a different repository — is itself a small illustration of the point in Section 3: the dashboard is an ordinary service in this monorepo, built and versioned the same way as every backend it calls.

---

## 7. A concrete walkthrough: logging in, creating a zone, and later using storage

Here's how the pieces above combine into one realistic sequence — note how each dashboard capability only appears in the walkthrough *after* its corresponding backend stage has shipped, mirroring Section 4 above.

1. **A user visits the dashboard.** Their browser loads `/login` (per the EDD's key pages, Section 2.9) — a page built with shadcn/ui form components, rendered by Next.js.
2. **They log in.** The login form submits to a Next.js API route, which forwards the request to Identity Service's `POST /api/v1/auth/login` (see [`identity-service-and-auth.md`](identity-service-and-auth.md) for exactly what happens there). Identity Service returns an access token and refresh token; the dashboard stores them and redirects the user to `/dashboard`.
3. **They land on the dashboard overview**, which — once the Analytics Service exists in a later stage — shows a bandwidth and cache-hit-ratio summary; in Stage 6's own scope, this is a simpler authenticated landing page.
4. **They see a "Create Zone" button.** This only exists in the UI because the CDN Service (Stage 4) has already shipped `POST /api/v1/zones`. Clicking it opens a shadcn/ui form (built with the same components as the login form) asking for an origin URL and default TTL. Submitting it calls the CDN Service, which creates a row in the `pull_zones` table and returns the new zone; the dashboard's zone list (kept fresh via TanStack Query) updates to show it.
5. **Later, they see a "Storage" tab.** This only exists because the Storage Service (Stage 5) has shipped its bucket/object endpoints. Clicking into it calls `GET /api/v1/buckets`, showing a bucket list; clicking a bucket calls `GET /api/v1/buckets/:bucketId/objects` to show an object browser; an "Upload" button calls `POST /api/v1/buckets/:bucketId/objects/upload` to get a presigned URL, and the browser then uploads the file bytes directly to MinIO — the dashboard's own server never touches the actual file content, exactly as described for any other client in [`phase1-explained-for-beginners.md`](../phase1-explained-for-beginners.md#32-storage-concepts).

At every step, the dashboard is doing nothing a script with `curl` couldn't also do — it's just presenting the same REST API through forms, lists, and buttons instead of a command line.

---

## 8. Putting it all together — one picture

```
Browser
  │
  │  visits /login, /zones, /storage, ...
  ▼
Next.js Dashboard (its own service, apps/dashboard/)
  │  built from: React components + shadcn/ui + Tailwind CSS
  │  server-rendered first load, then behaves like an app in-browser
  │
  ├── API route ──▶ Identity Service   (POST /auth/login, /users/me, /orgs, /api-keys)
  ├── API route ──▶ CDN Service        (POST /zones, GET /zones, /zones/:id/domains, /rules)
  ├── API route ──▶ Storage Service    (POST /buckets, /objects/upload, GET /objects)
  │
  │   (Analytics Service / Billing Service calls added in later stages,
  │    once THOSE backends exist — same pattern, not part of Stage 6)
  ▼
Same REST APIs any other client (script, future CLI, customer integration) would call
```

**Stage 6 has no single "Month X" or single dependency** the way Stages 2, 4, 5, 7, etc. do, precisely because it isn't one backend capability — it's a thin, ever-growing presentation layer that gains a page every time a backend stage finishes: Month 1 (auth pages, after Identity Service), Month 2 (zone UI, after CDN Service), Month 3 (storage UI, after Storage Service), and further pages in later months as Analytics, Cache Rules, RBAC, and Billing each ship their own backend. See the [PRD's Implementation Roadmap](../superpowers/specs/2026-07-25-revocloud-phase1-prd.md#7-implementation-roadmap) and the EDD's [Development Roadmap](../superpowers/specs/2026-06-29-revocloud-phase1-cdn-edd.md#10-development-roadmap) for the month-by-month breakdown this document draws from.

**The one-line summary:** the dashboard is a Next.js web application — its own separate service in the monorepo, built from reusable React components styled with shadcn/ui — that talks to every backend microservice through the exact same REST APIs any other client would use, and it grows one page at a time, in step with whichever backend service has just been built, rather than being designed and built as one finished product up front.
