# Public Beta & Launch — Explained for Beginners

This document explains **Stage 16, Public Beta** — the final stage of RivoCloud's 16-stage Phase 1 build order, targeted for Month 10. It's a companion to:

- [`phase1-explained-for-beginners.md`](../phase1-explained-for-beginners.md) — the plain-language glossary and the [16-stage build order](../phase1-explained-for-beginners.md#5-how-phase-1-is-built-the-16-stages) this stage concludes
- [`superpowers/specs/2026-07-25-revocloud-phase1-prd.md`](../superpowers/specs/2026-07-25-revocloud-phase1-prd.md) — the product requirements this stage fulfills (Section 1's "Definition of done," Section 7's roadmap table)
- [`superpowers/specs/2026-06-29-revocloud-phase1-cdn-edd.md`](../superpowers/specs/2026-06-29-revocloud-phase1-cdn-edd.md) — Section 10 ("Month 10 — Public Beta Launch") and Section 11 ("16. PUBLIC BETA") for the exact task list
- [`superpowers/specs/2026-06-29-revocloud-master-architecture.md`](../superpowers/specs/2026-06-29-revocloud-master-architecture.md) — the "Future Roadmap" this stage exists to make possible

**Important:** as of this writing, Stage 16 has **not been built yet** — the PRD marks it "Not started," and it depends on Stage 14 (First Hetzner Edge Node) and Stage 15 (SDK + CLI) being done first. Everything below describes what the EDD and PRD specify *should* be built, not what currently exists. Think of this document as the map for a trip that hasn't started yet.

---

## 1. What "public beta" actually means

It's tempting to think of software as having two states: "being built" and "done." Public beta is neither — it's a distinct, deliberate third state, and understanding what it is (and isn't) matters before touching any of its tasks.

**Public beta means:** real, external, unaffiliated users can sign up and use the product, and their feedback starts actively shaping what gets built next. The EDD states this plainly as the Month 10 deliverable: *"RivoCloud public beta. Real external users. Feedback loop active."*

**Public beta does NOT mean:**
- **"Done" or "finished."** The product will keep changing after this — that's the entire point of a *beta*. It means "ready for outsiders to rely on, imperfections and all," not "no more bugs will ever be found."
- **"1.0" or a finished, stable version-number release.** A 1.0 typically implies a commitment to API stability and a polished feature set. Beta explicitly signals the opposite: rough edges are expected, and both the product and its users should expect change.
- **"No monitoring needed."** Quite the opposite — beta is exactly when you need the most visibility into what's breaking, because now the people hitting bugs are strangers who won't just walk over and tell you in person.

**The contrast with Stages 1–15 is the whole point.** Every previous stage in this build order — Identity Service, the Edge Proxy, the CDN Service, Storage, Analytics, RBAC, Billing, the Kubernetes migration, the second Hetzner edge node, even the SDK and CLI — was built and used **internally only**. The people testing it were the RivoCloud team itself (and maybe a few friendly early testers), who already know the product's quirks, who to ask when something breaks, and which features are half-finished. Public beta is the first time the product is exposed to people with **zero context**: they don't know the team, don't know the roadmap, don't know that "the invalidation dashboard is a bit slow right now" is a known issue. That shift — from "people who understand the system using it" to "strangers who just want it to work" — is what makes public beta a distinct, deliberately-sequenced stage of its own, not just a flag flip on an already-finished product.

**Why call it "beta" at all?** The word borrows from decades of software convention (famously, Gmail ran a small "Beta" badge next to its logo for about five years). It's a signal aimed in two directions at once: to *users*, it says "this is usable enough to build on, but don't be shocked if something's rough around the edges." To the *team*, it says "we're now optimizing for learning from real usage patterns, not just shipping the next planned feature." The EDD's own goal for Month 10 captures both halves in one sentence: *"Real external users. Product-market fit feedback loop."* — the point of public beta isn't just "more users," it's specifically opening a channel for the product to start being shaped by people outside the team.

---

## 2. Two different audiences need two different websites

A recurring mistake in launches is building one website and expecting it to serve two very different jobs. The EDD's Month 10 tasks call for **two separate things** — a documentation site and a landing page — precisely because they serve two different audiences with different goals, different tone, and even different technology:

| | Documentation Site | Marketing Landing Page |
|---|---|---|
| **Audience** | A developer who has already decided to use RivoCloud (or is actively evaluating it) and needs to integrate it | A prospective customer who hasn't decided anything yet — they're asking "should I even bother?" |
| **Job to be done** | "How do I create a zone via the API?" "What does this error code mean?" "What does the SDK's `zones.create()` method return?" | "What problem does this solve for me?" "Is this cheaper/simpler than CloudFront + S3?" "Can I trust this company?" |
| **Tone** | Precise, technical, reference-oriented. Assumes the reader already wants to use the product and just needs facts. | Persuasive, benefit-oriented, simple. Assumes the reader is comparing options and deciding whether to click "sign up." |
| **Typical content** | Quickstart guide, API reference (every endpoint, every parameter), SDK docs, CLI command reference, error code glossary | Value proposition ("one dashboard for CDN + storage + billing"), pricing, comparison vs. CloudFront/Bunny.net, a signup call-to-action |
| **Tooling named in the EDD** | **Mintlify** or **Nextra** — both are frameworks purpose-built for developer documentation (versioned pages, built-in API reference rendering, code-sample tabs per language) | A plain **Next.js app or static site** — no special documentation tooling needed, since it's mostly a small number of persuasive pages, not a sprawling reference |
| **Where it lives** | Usually a subdomain like `docs.rivocloud.dev` | Usually the root domain, `rivocloud.dev` |

Why does this split matter enough to be called out explicitly? Because writing for both audiences on one page tends to fail both of them: a developer trying to find the exact shape of a `POST /api/v1/zones` request doesn't want to scroll past pricing tiers and testimonials, and a skeptical prospective customer doesn't want to be handed a wall of API reference tables before they've even decided the product is worth their time. Splitting the two sites lets each one be written, designed, and optimized for the one job it actually has.

---

## 3. The status page: trust, without needing to email support

A **status page** is a simple, independently-hosted web page (often at a subdomain like `status.rivocloud.dev`) that reports, in real time, whether RivoCloud's own systems are healthy — API up or down, edge proxies responding, current or recent incidents, historical uptime.

**Why it matters, specifically:** the moment RivoCloud has real external customers (which is exactly what public beta creates), something *will* eventually go wrong — a deploy introduces a bug, a database runs slow, a PoP has a networking issue. When that happens, every affected customer faces the same question: **"is this broken on my end, or is it RivoCloud?"** Without a status page, the only way to find out is to email support and wait — which is slow, generates support load exactly when the team is busiest fixing the actual problem, and (worse) leaves the customer wondering if anyone even noticed yet.

A status page answers that question **before** the customer has to ask a human:
- If the status page shows a red "Degraded Performance" banner for the CDN Service, the customer immediately knows: *not my problem, they're already on it.*
- If the status page is all-green, the customer knows to look at their own configuration, their own origin server, their own network — instead of waiting on a RivoCloud support reply that will eventually say "everything's fine on our end."

This is why the EDD frames the status page as a Month 10 (public-beta) task rather than something built earlier: while the only users are the internal team, everyone already knows through Slack/standup whether something's broken. A status page is a way of scaling that same "does everyone know what's going on" trust signal to strangers who have no other channel into the team.

**Two implementation paths, per the EDD:**
- **BetterUptime** (or a similar hosted product) — a third-party service that periodically pings RivoCloud's own endpoints and automatically shows green/red status, with almost no engineering effort required to set up.
- **Self-hosted** — running an open-source status-page tool on RivoCloud's own infrastructure, trading "no setup, someone else's servers" for "more control, one more thing to operate."

Either choice satisfies the same underlying requirement — a status page needs to be trustworthy *precisely because it's separate from the main product's infrastructure*. If the status page itself is hosted on the exact same servers that are down, it fails at the worst possible moment. This is why status pages are conventionally hosted separately (a different provider, a different region, a different everything) from the product they're reporting on — a detail worth knowing even though the EDD doesn't spell out where BetterUptime's own infrastructure lives, since it's inherent to what a status page is *for*.

**What would a RivoCloud status page actually report on?** Given the architecture laid out in [`phase1-explained-for-beginners.md`](../phase1-explained-for-beginners.md#2-the-big-picture-two-worlds), a useful status page would break "is RivoCloud healthy" down into the pieces a customer actually cares about, rather than one single green/red dot — because those pieces can fail independently:

- **Control plane API** (Identity, CDN, Storage, Analytics, Billing services) — can customers log in, create zones, manage billing?
- **Dashboard** — can customers see their own data even if the API underneath is fine?
- **Edge network, per PoP** (Oracle control-plane region, the Hetzner Nuremberg PoP from Stage 14) — is cached content actually being served to visitors? A problem here is arguably more urgent than a control-plane blip, since it affects a customer's *own* website visitors, not just the customer.

Separating these matters because "the dashboard is down" and "cached content stopped serving to my visitors" are very different severities of problem for a customer to hear about.

---

## 4. Onboarding: why "the API works" isn't the same as "a stranger can use it"

By the time Stage 16 begins, the CDN Service (Stage 4, built in Month 2) has been creating zones successfully for eight months. The API works. Zone creation works. So why does the EDD list **"Onboarding flow: first zone creation with guided setup"** as its own Month 10 task, instead of treating it as already solved?

Because "the API works" and "a brand-new user, with zero context, succeeds in the first five minutes" are two completely different problems — and the PRD makes the second one an explicit, measurable success metric in its own right:

> "Make onboarding effortless — A new user can register, create an org, and serve their first cached asset through the dashboard in under 5 minutes." (PRD Section 2)

Consider everything a brand-new visitor doesn't know, that the RivoCloud team has taken for granted since Month 2:
- They don't know what a "zone" is, or that it's the thing they need to create first.
- They don't know what to put in the "origin URL" field, or what happens if they get it wrong.
- They don't know whether they need a custom domain right away, or whether the default `*.cdn.rivocloud.dev` subdomain is fine to start with.
- They don't know how to *tell* whether it worked — what does a successful cache hit even look like from their side?

A raw API or an unguided dashboard form technically "supports" all of this — a sufficiently determined developer could read the API reference and figure it out. But that's a very different experience from a **guided first-zone-creation flow**: a step-by-step wizard that walks a new signup through picking a zone name, entering an origin, and — critically — *proving* it worked, e.g. by fetching a test asset through the new zone and showing a green checkmark. That guided experience is itself a feature that has to be designed, built, and tested, exactly like any other feature in this build order — it just happens to be a feature about *using* the other features, rather than a new capability of its own. That's precisely why it's sequenced here, as part of Stage 16, rather than assumed to already exist as a side effect of the CDN Service being done.

**This is also why "under 5 minutes" is measurable, not just a vibe.** The PRD phrases this goal as a concrete success metric, not a vague aspiration — which means it's something the team can actually watch after launch: how many new signups reach a working, cache-hitting zone, and how long it takes them. If real users are dropping off partway through — say, at the "enter your origin URL" step — that's a specific, fixable signal, exactly the kind of "product-market fit feedback loop" the EDD's Month 10 goal is describing. Onboarding isn't a one-time checkbox to tick off before launch; it's a funnel the team keeps watching and refining *throughout* the beta.

---

## 5. Why public beta is deliberately the LAST stage

This is the same "foundation → core mechanism → management layer → polish layer" sequencing pattern that runs through the entire 16-stage build order (see [Section 5 of phase1-explained-for-beginners.md](../phase1-explained-for-beginners.md#the-key-idea-behind-the-ordering)), applied at the largest possible scale: **you don't invite the public in before the product actually works end-to-end.**

By the time Stage 16 starts, every one of the following already exists, per the preceding 15 stages:

| Already built by Stage 16 | Stage | What it means for a public-beta user |
|---|---|---|
| Auth (register/login/JWT), organizations, API keys | 2 | They can actually sign up and log in |
| Edge Proxy + 3-layer cache | 3 | Their content actually gets served fast |
| CDN Service (zone CRUD) | 4 | They can create a zone through the dashboard or API |
| Object Storage (buckets, presigned uploads) | 5 | They can upload real files, not just point at an existing origin |
| Cache invalidation + cache rules | 7 | They can purge stale content and control per-path caching |
| Custom domains + automatic TLS | 8 | They can use their own domain name with a real padlock icon |
| Analytics | 9 | They can see whether their traffic is actually being served and cached |
| Signed URLs | 10 | They can share private files securely |
| RBAC, audit logging, rate limiting | 11 | Multi-person teams are safe to use; abuse is contained |
| Stripe billing, plan limits | 12 | They can actually pay — this isn't a permanently-free demo |
| Kubernetes migration | 13 | The control plane won't fall over under real, unpredictable traffic |
| A second physical edge location (Hetzner) | 14 | It's a *real*, geographically distributed CDN — not a single server pretending to be one |
| SDK + CLI | 15 | Developer-forward users get programmatic tools, not just a dashboard |

If public beta launched any earlier — say, right after Stage 4 (CDN Service) — external users would hit a product with no billing (nobody could actually pay), no custom domains (nobody could use their own brand), no RBAC (any team member could do anything), and only one server location (not really a CDN in the geographically-distributed sense the product promises). Sequencing public beta last means that when real strangers do show up, the thing they're using is the thing the PRD's Section 1 calls "done": *"RivoCloud can onboard a paying customer who creates a CDN zone, points traffic at it, uploads files to storage, sees real analytics, manages their team with roles, and pays via Stripe — running on real, geographically distributed edge infrastructure."* Public beta doesn't build any of that — it's the stage that finally opens the door, now that all of it is standing behind it.

---

## 6. A concrete walkthrough: a stranger's first five minutes

Here's how the pieces above are meant to work together, end to end, once Stage 16 exists:

1. A developer sees a RivoCloud mention on **Hacker News** or **Product Hunt** (the EDD's "Announce" task, 16.5) and clicks through to the **marketing landing page** (`rivocloud.dev`) — not the docs site. They read the value proposition ("one dashboard for CDN + storage + billing, instead of stitching together CloudFront and S3") and decide it's worth a try.
2. They click "Sign Up." This calls the **Identity Service** (built in Stage 2) to create their account and organization.
3. Instead of landing on a blank dashboard, they're dropped into the **guided onboarding flow** (16.3): "Let's create your first zone." They enter an origin URL, and the flow walks them through it step by step, then proves success by fetching a test asset and showing a green "Cache HIT" indicator.
4. Feeling confident, they now want to point their *own* domain at the zone. They switch over to the **documentation site** (`docs.rivocloud.dev`, 16.1, built with Mintlify or Nextra) and follow the "Custom Domains" guide to add their domain and wait for the automatic TLS certificate.
5. Happy with the result, they mention RivoCloud in a tweet, or post in the **Discord server / GitHub Discussions** (16.5's community piece) — this is the "feedback loop" the EDD's Month 10 goal refers to becoming active.
6. A week later, a teammate on their engineering team — more comfortable in a terminal than a dashboard — installs the **CLI** (`Rivocloud zones list`, `Rivocloud cache invalidate /path`) or wires the **JavaScript SDK** (`npm install @rivocloud/sdk`) into their deploy pipeline, both built one stage earlier (Stage 15), so cache invalidation happens automatically on every deploy instead of through a manual dashboard click.
7. A month later, they notice their site loading slowly. Before emailing support in a panic, they check `status.rivocloud.dev` (16.4) — if it shows an active incident, they know it's not something they misconfigured, and they wait it out instead of debugging their own origin server for nothing.

Every step in that walkthrough depends on a specific Month-10 deliverable existing — none of it works with only 15 of the 16 stages built. Note, too, how it loops back on itself: step 5's community post is exactly the kind of real-world usage that feeds the "feedback loop" from Section 1 — a stranger's actual experience, not an internal guess, now shaping what the team prioritizes next.

---

## 7. What comes after Phase 1

Public beta isn't the end of RivoCloud's story — it's the end of **Phase 1**. The PRD's Section 4 ("Scope & Non-Goals") and the master architecture's "Future Roadmap" table are explicit that several major capabilities are deliberately excluded from this entire 16-stage build order, precisely *because* they depend on Phase 1's foundation already being solid and load-bearing:

| Phase | Roughly when | What it adds |
|---|---|---|
| **Phase 2: Media** | Year 2, Q1–Q2 | Image optimization (WebP/AVIF conversion), video transcoding, adaptive streaming, and finishing the object versioning/lifecycle-policy automation whose database columns Phase 1 already created but never activated |
| **Phase 3: Edge** | Year 2, Q3–Q4 | Edge Functions (a WASM runtime, so customers can run their own code at the edge), a full API Gateway, and multi-region PostgreSQL / BGP Anycast for true global infrastructure |
| **Phase 4: AI** | Year 3 | Semantic caching, predictive cache warming, AI-driven image processing and traffic optimization |

None of that is buildable on shaky ground. Edge Functions need a rock-solid Edge Proxy to run inside of. Semantic caching needs a cache invalidation and analytics pipeline that's already proven itself under real traffic. Multi-region infrastructure needs a team that has already successfully operated *two* regions (Oracle + one Hetzner PoP) without falling over. **Public beta is the checkpoint that proves Phase 1's foundation is real** — not just "passes internal tests," but "strangers relied on it and it held" — before any of Phase 2, 3, or 4 gets greenlit. In that sense, this final stage isn't just the last item on a checklist; it's the validation step for the entire 16-stage build order that came before it.

---

## 8. Quick reference: the Month 10 task list

```
Stage 16 — Public Beta (Month 10)
│
├── 16.1  Documentation site (Mintlify/Nextra)  ──▶ audience: developers integrating the API
├── 16.2  Landing page (Next.js/static)          ──▶ audience: prospective customers deciding to sign up
├── 16.3  Onboarding flow polish                 ──▶ guided first-zone creation, proves success in <5 min
├── 16.4  Status page (BetterUptime/self-hosted) ──▶ lets customers self-diagnose outages
└── 16.5  Announce (Product Hunt, HN, Twitter/X,
          Discord, GitHub Discussions)           ──▶ starts the real feedback loop

   All five depend on Stages 1–15 already being complete —
   this stage adds no new backend capability, only the
   surface area that lets strangers discover and use what
   already exists.
```

**The one-line summary:** public beta isn't a 17th feature bolted onto RivoCloud — it's the moment the 16-stage build order hands the finished foundation (auth, CDN, storage, custom domains, cache management, analytics, RBAC, billing, and a real second edge location) over to strangers, wrapped in the documentation, landing page, onboarding, and status page that let them trust it and use it without anyone from the team standing beside them — and, in doing so, closes out Phase 1 and opens the door to everything Phase 2 through 4 will eventually build on top of it.
