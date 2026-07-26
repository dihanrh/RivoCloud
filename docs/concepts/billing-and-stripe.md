# Billing & Stripe — Explained for Beginners

This document explains **Stage 12 (Billing, Month 7)** of RivoCloud's Phase 1 build — the part of the system that lets an organization actually *pay* for the CDN and storage it's using. **Nothing in this document has been built yet.** It's written the same way as [`docker-compose-and-infrastructure.md`](docker-compose-and-infrastructure.md) — as a "read this before the stage exists" concept primer, grounded entirely in what the specs say Stage 12 *will* build:

- [`phase1-explained-for-beginners.md`](../phase1-explained-for-beginners.md) — the overall glossary and 16-stage build order (Billing is stage 12, and its one-paragraph summary lives in [Section 5](../phase1-explained-for-beginners.md#5-how-phase-1-is-built-the-16-stages))
- [`superpowers/specs/2026-07-25-revocloud-phase1-prd.md`](../superpowers/specs/2026-07-25-revocloud-phase1-prd.md) — Section 5.9 (functional requirement) and Section 7 (roadmap table, row 12)
- [`superpowers/specs/2026-06-29-revocloud-phase1-cdn-edd.md`](../superpowers/specs/2026-06-29-revocloud-phase1-cdn-edd.md) — Section 2.6 (Billing Service design), Section 6.4 (database tables), Section 7.8 (API endpoints), Section 10 (Month 7 tasks), and Section 11's "12. BILLING" build steps

If you haven't read [`phase1-explained-for-beginners.md`](../phase1-explained-for-beginners.md) yet, do that first — it explains what an Organization, the CDN Service, Redis, and NATS are, all of which this document assumes you already know.

---

## 1. Why doesn't RivoCloud just build its own payment processing?

It would seem simpler, on the surface, to add a `credit_card_number` column to the database and a form on the dashboard that collects it. RivoCloud doesn't do this, and won't, for one overriding reason: **handling raw credit card numbers yourself is a massive legal and security burden**, and there is no good reason to take it on.

**PCI compliance**, in plain language, is a set of strict rules ("PCI DSS" — Payment Card Industry Data Security Standard) that any company handling real credit card numbers must follow: how the numbers may be stored, encrypted, transmitted, and audited. Getting certified is expensive, ongoing, and unforgiving — a single mistake (a card number logged in plaintext by accident, a database backup that isn't encrypted correctly) can mean fines, loss of the ability to process payments at all, and a breach of customer trust that's very hard to earn back.

**Stripe** is a payment processor that has already done all of this. When RivoCloud uses Stripe:

- RivoCloud's own servers **never see or store a raw card number** — Stripe's hosted forms collect it directly, and Stripe's systems are the ones that are PCI-certified, not RivoCloud's.
- Stripe already has working, battle-tested infrastructure for subscriptions (recurring monthly charges), invoices (itemized bills, receipts, tax handling), retries on failed payments, and fraud detection.
- Customers already trust Stripe's checkout pages — they're a known, recognizable experience, which lowers the "is this site safe to give my card to?" hesitation a homemade form would create.

So the Billing Service (per EDD Section 2.6) isn't a payment processor — it's a thin layer that talks to Stripe's API and keeps RivoCloud's own database in sync with what Stripe reports. This is the same pattern as the rest of the platform: don't rebuild infrastructure someone else has already solved well (compare to using MinIO instead of writing an object-storage engine, or NATS instead of writing a message queue).

---

## 2. Stripe Checkout Session: a payment form RivoCloud never has to build

A **Stripe Checkout Session** is a hosted payment page — a URL, on Stripe's own domain, that Stripe generates on request and that already knows what plan the customer is buying and how much it costs. Instead of RivoCloud building and maintaining its own "enter your card details" form (and instantly becoming subject to the PCI rules described above), the Billing Service asks Stripe's API to create a Checkout Session, gets back a URL, and redirects the customer's browser to it.

Per EDD Section 7.8, this is a single endpoint:

```
POST /api/v1/billing/checkout    Create Stripe Checkout session for plan upgrade
```

The customer fills out their card details **on Stripe's page**, not RivoCloud's. Stripe handles validating the card, showing errors, retry attempts, and then redirects the customer back to RivoCloud's dashboard once payment succeeds (or is cancelled). RivoCloud only ever has to ask "please create a checkout page for this org, for this plan" and later find out "did it work?" — which is the webhook problem covered next.

---

## 3. Why Stripe webhooks, not just trusting the redirect

After a customer pays on Stripe's Checkout page, Stripe redirects their browser back to a URL on RivoCloud's dashboard (something like `/billing/success`). It would seem tempting to just say: "if the browser lands on the success page, mark the org's plan as paid." **This is not safe, and Stage 12 does not do it this way.**

The problem: that redirect happens entirely in the customer's own browser, which RivoCloud does not control.

- The browser could be closed before the redirect finishes.
- The customer's internet connection could drop at exactly the wrong moment.
- A malicious user could, in principle, craft a fake request straight to `/billing/success` without ever actually paying anything, if that page were the only thing deciding "did they pay?"

**The browser could lie, or the connection could simply drop — but a webhook is Stripe's own server, directly telling RivoCloud's own server what actually happened.** That's a much stronger source of truth than "the customer's browser eventually showed up somewhere."

A **webhook** is the reverse of a normal API call: instead of RivoCloud asking Stripe "did anything happen?", Stripe proactively sends an HTTP request *to* RivoCloud whenever something relevant occurs — payment succeeded, payment failed, a subscription was cancelled, and so on. EDD Section 2.6 lists this as one of the Billing Service's core responsibilities: *"Handle Stripe webhooks (payment success, failure, subscription cancellation)."* The endpoint for this, per Section 7.8, is:

```
POST /api/v1/billing/webhook    Stripe webhook receiver (internal, not for customers)
```

This endpoint is marked "internal" because it's never called by a person clicking around the dashboard — only by Stripe's own servers, and it's protected by a cryptographic signature Stripe attaches to every webhook request, so RivoCloud can verify a given webhook request genuinely came from Stripe and wasn't forged.

One extra wrinkle worth understanding: **Stripe retries webhook deliveries** if RivoCloud's server doesn't acknowledge them quickly (e.g., if the Billing Service was briefly down or slow). That means the same "payment succeeded" event might arrive at RivoCloud's webhook endpoint more than once. Per EDD Section 2.6's scaling notes: *"Stripe webhook endpoint must be idempotent (Stripe retries on failure)."* **Idempotent** means "processing the same event twice has the same effect as processing it once" — e.g., "set this org's plan to `pro`" is idempotent (doing it twice is harmless), whereas "add one more paid month to this org's subscription" would not be, if applied twice by accident. The webhook handler is built to be safe against duplicate deliveries.

---

## 4. Usage metering: how billing knows how much an org actually used

Charging for a subscription is one thing — but RivoCloud's plans are also usage-based (e.g., a free tier has a bandwidth cap). To enforce that, the Billing Service needs to know, per organization, how much bandwidth and how many requests were actually served.

That usage data already exists — it's collected by the **Analytics Service** (Stage 9, see [`analytics-and-clickhouse.md`](analytics-and-clickhouse.md)), which stores every Edge Proxy request as a row in ClickHouse and pre-computes hourly/daily rollup tables like `bandwidth_hourly` so nobody has to re-scan millions of raw request rows just to answer "how much bandwidth did this org use this month?" Billing reuses that same pre-computed data rather than re-deriving it from scratch — per EDD Section 10's Month 7 tasks: *"Usage metering: read from ClickHouse daily rollup."*

Per EDD Section 2.6, the actual flow is:

1. The **Analytics Service** publishes daily usage rollups to **NATS**.
2. The **Billing Service** subscribes to those NATS events and updates its own `usage_records` table in Postgres (one row per org, per billing period — see Section 6 below) with the latest bandwidth/request/storage totals.

This is the same "don't call synchronously on a hot or expensive path" pattern used throughout RivoCloud: rather than the Billing Service querying ClickHouse directly every time it needs to check a limit, Analytics pushes the numbers over once a day, and Billing just keeps its own lightweight running total in Postgres.

---

## 5. Plan limit enforcement: what happens when an org goes over its limit

Knowing usage numbers is only useful if something actually happens when an org exceeds its plan — e.g., a free-tier org that blows past its bandwidth cap. EDD Section 2.6 describes this precisely, and it deliberately avoids putting Billing anywhere near the Edge Proxy's hot path:

1. Once the Billing Service determines (from the usage records above) that an org has exceeded its plan's limit, it doesn't call the CDN Service or Edge Proxy directly and it doesn't block traffic itself.
2. Instead, it writes `billing_suspended: true` into that org's zone configuration **in Redis** — the exact same `zone_config:{zone_id}` JSON blob the CDN Service already publishes for every zone (see [`cdn-zones-and-configuration.md`](cdn-zones-and-configuration.md) Section 4 for how that mechanism works day-to-day).
3. A NATS event triggers the already-running Edge Proxies to refresh that zone's config sooner than their normal refresh cycle — the same `config.zones.updated` notification path used for ordinary zone edits.
4. The **Edge Proxy** checks the `billing_suspended` flag from its own local (in-process, then Redis) zone config on the next request — never a live, synchronous call to the Billing Service. If the flag is `true`, the zone stops serving traffic until the flag clears (e.g., at the start of the next billing period, or once the org upgrades).

Why this design, instead of the CDN Service or Edge Proxy asking Billing directly, in real time, "is this org allowed to serve this request?" The EDD is explicit about the tradeoff: *"the window where an over-limit org could serve traffic is bounded by the 60-second in-process TTL. This is acceptable — blocking all traffic immediately on a Redis miss would cause outages during Redis restarts."* In other words, RivoCloud accepts that an over-limit org might serve traffic for up to about a minute longer than strictly necessary, in exchange for the Edge Proxy never having a hard dependency on the Billing Service being up and fast. This is the same Control-Plane/Data-Plane split from [`phase1-explained-for-beginners.md` Section 2](../phase1-explained-for-beginners.md#2-the-big-picture-two-worlds): the data plane (Edge Proxy) must never be one slow or down control-plane service away from breaking for every visitor.

The **CDN Service** also checks billing status before certain control-plane operations (per EDD Section 10's Month 7 tasks: *"Plan limit enforcement in CDN Service (check billing status before zone operations)"*) — e.g., refusing to let a suspended org create a brand-new zone, even though existing zones are disabled via the Redis flag above rather than a live call on every request.

---

## 6. The Stripe Customer Portal: self-serve plan management, without building a UI for it

Beyond the initial upgrade, customers need to be able to change plans, update their card, view past invoices, or cancel — all of which would normally mean building an entire billing-settings UI. The **Stripe Customer Portal** is another hosted page Stripe provides (like Checkout, but for ongoing account management instead of a one-time purchase) that already implements all of this: change plan, update payment method, view/download invoices, cancel subscription.

Per EDD Section 7.8:

```
POST   /api/v1/billing/portal    Create Stripe Customer Portal session
```

The Billing Service's job here is again just to ask Stripe for a portal session URL for the right Stripe Customer, and redirect the user there — RivoCloud doesn't build a card-update form, an invoice list UI, or a "are you sure you want to cancel?" flow itself; Stripe already has one, and it's the one customers may already recognize from other products.

---

## 7. The database tables Stage 12 introduces

Per EDD Section 6.4, three new Postgres tables hold Billing's permanent state:

| Table | What it stores | Key columns |
|---|---|---|
| `billing_accounts` | One row per organization — the org's current plan and Stripe identifiers | `org_id` (unique, one per org), `stripe_customer_id`, `stripe_sub_id`, `plan` (e.g. `free`, `pro`), `status` (`active`, `past_due`, `cancelled`, `suspended`) |
| `usage_records` | Monthly usage snapshots per org, kept in sync from Analytics' NATS rollup events | `org_id`, `period_start`/`period_end`, `bandwidth_bytes`, `requests`, `storage_bytes` — unique per `(org_id, period_start)` |
| `invoices` | A local copy of what Stripe has already billed, for the dashboard's invoice list | `org_id`, `stripe_invoice_id`, `amount_cents`, `currency`, `status` (`draft`, `open`, `paid`, `void`, `uncollectable`), `period_start`/`period_end`, `paid_at` |

Notice what's *not* in this schema: no card numbers, no raw payment details anywhere. Every column here is either a reference to something Stripe holds on RivoCloud's behalf (`stripe_customer_id`, `stripe_sub_id`, `stripe_invoice_id`) or a summarized number RivoCloud computed itself (usage totals). That absence is the PCI-compliance argument from Section 1, made concrete in the schema.

The full set of customer-facing endpoints, per EDD Section 7.8:

```
GET    /api/v1/billing/account            Get billing account, current plan
POST   /api/v1/billing/checkout           Create Stripe Checkout session for plan upgrade
POST   /api/v1/billing/portal             Create Stripe Customer Portal session
GET    /api/v1/billing/usage              Current period usage (bandwidth, requests, storage)
GET    /api/v1/billing/invoices           List invoices
GET    /api/v1/billing/invoices/:id       Get invoice + PDF URL
POST   /api/v1/billing/webhook            Stripe webhook receiver (internal, not for customers)
```

---

## 8. A concrete walkthrough: upgrading a plan end to end

Putting Sections 2, 3, 4, and 5 together into one realistic sequence, matching the EDD's Section 11 build steps (12.1 → 12.2 → 12.3):

1. An org's Owner is on the free plan and clicks **"Upgrade"** in the Dashboard's billing page.
2. The Dashboard calls `POST /api/v1/billing/checkout`. The Billing Service looks up (or creates, on first use) a Stripe Customer for this org, then asks Stripe's API to create a Checkout Session for the chosen paid plan, and returns Stripe's hosted checkout URL.
3. The browser is redirected to that URL. The customer enters their card details **on Stripe's page** — RivoCloud's servers never see the raw number (Section 1).
4. Stripe processes the payment and, on success, redirects the customer's browser back to the dashboard *and* separately fires a webhook to `POST /api/v1/billing/webhook` telling RivoCloud's backend, server-to-server, that the checkout completed and a subscription now exists (Section 3 — this is the step that's actually trusted, not the browser redirect).
5. The Billing Service's webhook handler verifies the event came from Stripe, then updates `billing_accounts` for this org: `plan: 'pro'`, `status: 'active'`, storing the new `stripe_sub_id`.
6. From then on, every month, the **Analytics Service** publishes usage rollups over NATS; the **Billing Service** keeps `usage_records` current (Section 4) and compares it against the new, higher plan's limits — no `billing_suspended` flag gets set as long as usage stays under the new (larger) cap.
7. If this org had previously been over the free tier's limit and had `billing_suspended: true` sitting in its zone config in Redis (Section 5), the Billing Service clears that flag once the higher-tier plan is active, and a NATS `config.zones.updated` event tells the Edge Proxy to pick up the change — the org's zones start serving traffic again, now allowed the higher tier's usage, without anyone restarting anything.
8. Later, the Owner wants to update their card or downgrade. They click **"Manage Billing"**, which calls `POST /api/v1/billing/portal` and redirects them to the Stripe Customer Portal (Section 6) — no dashboard UI was built for any of this.

---

## 9. Why Billing is Stage 12 — after Organizations and after Analytics

Per the [PRD's roadmap table](../superpowers/specs/2026-07-25-revocloud-phase1-prd.md#7-implementation-roadmap), Stage 12 (Billing) depends on stages 2 and 9. Both dependencies are load-bearing, not incidental:

- **Stage 2 (Identity Service — Organizations).** Every billing record in Section 7 is keyed by `org_id` — `billing_accounts.org_id` is even declared `UNIQUE`, meaning billing is fundamentally a *per-organization* concept, not per-user. Without Organizations already existing as a real, populated table, there would be nothing for a `billing_accounts` row to reference. See [`identity-service-and-auth.md`](identity-service-and-auth.md) Section 5 for how Organizations were introduced back in Stage 2.
- **Stage 9 (Analytics).** Plan limit enforcement (Section 5 above) is meaningless without real bandwidth/request numbers to compare against a plan's cap — and those numbers only exist because the Analytics Service (Stage 9) has already been collecting them in ClickHouse and rolling them up. Building Billing before Analytics existed would mean having nothing to meter usage *from*.

This is the same "foundation → core mechanism → management layer" pattern described in [phase1-explained-for-beginners.md's ordering discussion](../phase1-explained-for-beginners.md#the-key-idea-behind-the-ordering): Billing is deliberately one of the *last* functional stages (Month 7 of 10), because it's a management/monetization layer sitting on top of things that must already work — an organization to bill, and usage data to bill it against.

---

## 10. Summary table: the pieces this stage introduces

| Concept | What it is | Where it lives / how it's checked |
|---|---|---|
| PCI compliance | Rules for safely handling raw credit card data | Never RivoCloud's problem — Stripe is the PCI-certified party |
| Stripe Checkout Session | A hosted Stripe payment page for a one-time plan purchase | Created via `POST /api/v1/billing/checkout`; redirect only |
| Stripe webhook | Stripe's server telling RivoCloud's server what really happened | `POST /api/v1/billing/webhook`; signature-verified, idempotent |
| Stripe Customer Portal | A hosted Stripe page for self-serve plan/card/invoice management | Created via `POST /api/v1/billing/portal`; redirect only |
| `billing_accounts` | One row per org: plan, status, Stripe identifiers | Postgres; `org_id` unique |
| `usage_records` | Monthly usage snapshot per org | Postgres; updated from NATS rollup events, not queried live from ClickHouse |
| `invoices` | Local copy of Stripe-issued invoices | Postgres; mirrors Stripe, not the source of truth for payment itself |
| `billing_suspended` flag | "This org is over its limit" | Embedded in the same Redis `zone_config:{zone_id}` JSON the CDN Service already publishes |
| Usage metering | Reading rollup numbers to know if a plan limit is breached | Analytics Service (ClickHouse) → NATS → Billing Service (`usage_records`) |
| Plan limit enforcement | Disabling a zone's traffic once a cap is breached | Edge Proxy reads `billing_suspended` from its local zone config — never a live call to Billing |

---

## 11. Putting it all together

```
Dashboard "Upgrade" click
      │
      ▼
Billing Service ──creates──▶ Stripe Checkout Session ──redirect──▶ Stripe's hosted payment page
      │                                                                    │
      │                                                          customer enters card
      │                                                                    │
      │                                                                    ▼
      │                                                         Stripe processes payment
      │                                                                    │
      │◀────────────────── webhook: checkout.session.completed ───────────┘
      │        (POST /api/v1/billing/webhook — signature-verified, idempotent)
      ▼
billing_accounts.plan = 'pro', status = 'active'   (Postgres)


Analytics Service ──daily usage rollup──▶ NATS ──▶ Billing Service ──▶ usage_records (Postgres)
                                                          │
                                          compares usage vs. plan limit
                                                          │
                                     over limit? ─────────┴───────── under limit?
                                          │                                │
                             writes billing_suspended:true         nothing changes
                             into zone_config:{zone_id} (Redis)
                                          │
                             NATS config.zones.updated
                                          │
                                          ▼
                             Edge Proxy refreshes zone config,
                             stops serving that zone's traffic
                             until the flag clears


Later: Dashboard "Manage Billing" click
      │
      ▼
Billing Service ──creates──▶ Stripe Customer Portal session ──redirect──▶ Stripe's hosted account page
                                                                          (upgrade / downgrade / cancel / invoices)
```

**The one-line summary:** RivoCloud never touches a raw credit card number or builds its own payment UI — Stripe's Checkout Session and Customer Portal are hosted pages that handle that entirely, Stripe's webhooks (not the browser redirect) are the trusted signal that something actually happened, and plan-limit enforcement works by writing a `billing_suspended` flag into the same Redis zone-config mechanism the CDN Service already uses, so the Edge Proxy can check it locally without ever making a live call to the Billing Service.
