# Custom Domains + TLS — Explained for Beginners

This document explains **Stage 8** of RivoCloud's Phase 1 build order: letting a customer use their own domain name (e.g. `cdn.their-company.com`) to reach RivoCloud's CDN, with an HTTPS certificate issued and renewed automatically. Everything below describes what was built, matching the design in [`2026-06-29-revocloud-phase1-cdn-edd.md`](../superpowers/specs/2026-06-29-revocloud-phase1-cdn-edd.md) (Section 5.8, Section 11 block 8) and the [PRD](../superpowers/specs/2026-07-25-revocloud-phase1-prd.md) (Section 5.3).

If you haven't read them yet:

- [`phase1-explained-for-beginners.md`](../phase1-explained-for-beginners.md) — the project-wide glossary; its **Custom Domain**, **TLS / SSL / HTTPS**, and **Traefik** entries are the quick version of everything below.
- [`docker-compose-and-infrastructure.md`](docker-compose-and-infrastructure.md) — the style template this document follows, whose Section 6.4 briefly mentions Traefik/TLS in the "running on a real server" context.

This document goes much deeper into *why* each of those pieces exists and how they fit together.

---

## 1. Why would a customer want their own domain at all?

Once a customer creates a CDN zone (Stage 4 — see [`cdn-zones-and-configuration.md`](cdn-zones-and-configuration.md) once it exists), RivoCloud automatically gives it a working URL for free: something like `my-zone.cdn.rivocloud.dev`. That URL works immediately — no setup, no waiting, no certificate to request, because it rides on a **wildcard certificate** (one certificate valid for `*.cdn.rivocloud.dev`, covering every zone at once — see Section 6).

So why isn't that enough? A few very ordinary reasons:

- **Branding.** A visitor loading images from `cdn.their-company.com` sees the company's own name in the URL bar. A visitor loading them from `random-slug-472.cdn.rivocloud.dev` sees RivoCloud's name instead, and it looks unprofessional or even suspicious (like a phishing link).
- **Portability.** If a customer ever wants to switch CDN providers, they can repoint `cdn.their-company.com` at a different provider without changing a single line of code in their app or website — every reference to "their CDN" in their own codebase already points at *their* domain, not RivoCloud's.
- **Cookie and same-origin rules.** Some browser security features (and some analytics/cookie setups) behave differently depending on whether an asset is served from the same registrable domain as the main site. Using `cdn.their-company.com` alongside `www.their-company.com` keeps everything under one umbrella domain.

This is exactly the same reason companies point `mail.company.com` at Google Workspace or `shop.company.com` at Shopify instead of using `company.gmail.com` or `random-id.myshopify.com` — the underlying infrastructure is someone else's, but the domain name is theirs.

**What has to happen for `cdn.their-company.com` to actually work as a RivoCloud-served CDN URL:**

1. The customer's own **DNS** (the system that maps domain names to server addresses — see Section 4) must be updated to point `cdn.their-company.com` at RivoCloud's infrastructure.
2. RivoCloud must be told about this domain and be watching for it — otherwise a request arriving with `Host: cdn.their-company.com` wouldn't match anything, and RivoCloud has no idea which zone's cache rules and origin to use.
3. RivoCloud must obtain and install a **TLS certificate** specifically valid for `cdn.their-company.com` — a certificate for `*.cdn.rivocloud.dev` does *not* cover a completely different domain name (see Section 3).

All three of these are what Stage 8 builds.

---

## 2. TLS / SSL / HTTPS — a quick refresher

The full glossary entry lives in [`phase1-explained-for-beginners.md`](../phase1-explained-for-beginners.md#31-cdn-concepts). The short version, restated here because everything else in this document builds on it:

- **HTTP** is the plain, unencrypted protocol browsers use to talk to web servers. Anyone on the network path (your Wi-Fi router, your ISP, a coffee-shop hotspot) can read — or *alter* — the data in transit.
- **HTTPS** is HTTP wrapped in an encryption layer, so the data in transit is unreadable to anyone except the browser and the server it's actually talking to. It also proves the server is *actually* who it claims to be (see Section 3), not an impostor.
- **TLS** (Transport Layer Security) is the current name for the encryption protocol that makes HTTPS work. **SSL** (Secure Sockets Layer) is the old name for TLS's predecessor — it's technically obsolete and shouldn't be used anymore, but the term stuck around in casual speech ("SSL certificate") even when people mean TLS.
- **Certificate** — the file a server presents to prove its identity and provide the cryptographic keys needed to set up an encrypted connection. This is the piece that has to be requested, issued, installed, and eventually renewed — and it's the crux of this entire document.

Almost every modern browser marks plain HTTP sites as "Not Secure" in the address bar, and RivoCloud's non-functional requirements (PRD Section 6) require "TLS enforced on all customer-facing domains" — so this isn't optional polish, it's a baseline requirement for the product to be usable at all.

---

## 3. Let's Encrypt: how a free, automatic certificate actually works

### 3.1 What a Certificate Authority is, and why it matters

A **Certificate Authority (CA)** is an organization that browsers and operating systems have agreed, in advance, to trust. When a CA issues a certificate for `cdn.their-company.com`, it's making a statement: *"I checked, and whoever requested this certificate really does control cdn.their-company.com."* Your browser trusts that statement because it already has a built-in list of CAs it considers reputable (baked into the OS or browser itself) — this is why a brand-new website can get a padlock icon on its very first day, without you personally having done anything to vouch for it.

If anyone could issue a certificate for any domain without proving control of it, the whole system would be useless — an attacker could get a certificate for `cdn.their-company.com` and impersonate it. So every CA is required to perform a **domain validation** check before issuing: prove, somehow, that the requester actually controls the domain in question.

### 3.2 Let's Encrypt specifically

Historically, getting a certificate meant: pay a CA (often $50–$500/year), submit a request, wait, manually download the issued certificate file, and manually install it on your server — then repeat the whole process every year before it expired (an expired certificate breaks HTTPS entirely, showing visitors a scary warning page).

**Let's Encrypt** is a CA, launched in 2015, that changed this by making certificates:

- **Free** — no cost to issue or renew, ever.
- **Automated** — issuance and renewal happen via an API (a protocol called **ACME** — Automatic Certificate Management Environment), not a human filling out a web form.
- **Short-lived** — certificates only last 90 days, which sounds worse but is actually the point: it *forces* automation (nobody could realistically re-issue every server's certificate by hand every 90 days), and it limits the damage if a certificate or its private key is ever compromised.

This is why "free automated certificates changed the industry": before Let's Encrypt, HTTPS was something you paid for and manually managed, so huge swaths of the web simply didn't bother — plain HTTP was the norm outside of banks and shops. After Let's Encrypt (and the tooling built around it, like Traefik — see Section 5), HTTPS-by-default became achievable for literally anyone running a server, including a project like RivoCloud automatically provisioning certificates for *its customers'* domains without ever involving a human.

### 3.3 How automatic renewal works, conceptually

Because Let's Encrypt certificates only last 90 days, whatever obtained the certificate has to keep re-obtaining it before it expires — forever, without anyone remembering to do it manually. Conceptually:

1. Something (in RivoCloud's case, **Traefik** — Section 5) keeps track of which certificates it's responsible for and when each one expires.
2. Some time before expiry (Traefik's default is to attempt renewal when a certificate has about a month of validity left), it repeats the same domain-validation-and-issuance process used the first time — proving control of the domain again, then requesting a fresh certificate.
3. The new certificate silently replaces the old one. If everything goes well, a visitor never notices anything happened — the padlock just keeps working.
4. If renewal somehow fails repeatedly (e.g. the domain's DNS changed and no longer points at RivoCloud), the certificate eventually expires and HTTPS breaks for that domain — which is why the PRD's roadmap also has the **Scheduler** perform "SSL certificate renewal checks" (mentioned in the EDD, Section 4) as a safety net that watches expiry dates independently of Traefik's own renewal logic.

The customer never has to click a "renew certificate" button, file a support ticket, or even know renewal happened — this entire lifecycle, from first issuance through every future renewal, runs unattended.

---

## 4. DNS: how a domain name points anywhere at all

**DNS (Domain Name System)** is the internet's phone book: it maps human-readable names (`cdn.their-company.com`) to the technical information a computer actually needs (typically, another domain name or an IP address to connect to). A domain's DNS records are controlled by whoever owns that domain, through their domain registrar or DNS host (e.g. GoDaddy, Cloudflare, Route 53) — RivoCloud has no ability to change a customer's DNS itself.

The specific kind of DNS record used here is a **CNAME record** ("Canonical Name") — it says "this name is really just an alias for that other name." The EDD's flow (Section 5.8) has RivoCloud tell the customer:

> Add CNAME record: `cdn.their-company.com` → `edge.rivocloud.dev`

Once the customer adds that record with their own DNS provider, any request for `cdn.their-company.com` gets redirected, at the DNS level, to `edge.rivocloud.dev` — which resolves to RivoCloud's own edge infrastructure. This is the mechanism by which "the customer's domain points at RivoCloud" actually happens: RivoCloud never touches the customer's DNS settings; it just tells the customer what record to add, and waits.

This step is entirely outside RivoCloud's control and can take anywhere from a few seconds to (rarely) many hours, because DNS changes propagate gradually across the internet's many caching layers — which is exactly why Stage 8 needs a *polling* mechanism rather than assuming the change is instant (see Section 6).

---

## 5. Traefik's role: a reverse proxy with dynamic, live-updating configuration

### 5.1 What a reverse proxy is

A **reverse proxy** sits in front of a set of backend servers and decides, for each incoming request, which backend should actually handle it — typically based on the hostname (`Host` header) or URL path of the request. Visitors only ever talk to the reverse proxy directly; it forwards ("proxies") the request to the right place behind the scenes.

### 5.2 Why RivoCloud specifically chose Traefik

The master architecture document ([`2026-06-29-revocloud-master-architecture.md`](../superpowers/specs/2026-06-29-revocloud-master-architecture.md), Section 5.6) compares three reverse proxy options for the control plane:

| | Nginx | Envoy | Traefik |
|---|---|---|---|
| Auto TLS (Let's Encrypt) | Manual (certbot) | Manual | **Automatic** |
| Docker/K8s service discovery | Manual config | xDS API (complex) | **Native, automatic** |
| Configuration | Static `nginx.conf` file | Complex YAML | YAML / Docker labels |
| Learning curve | Medium | High | **Low** |

The deciding factor is the combination of *automatic* Let's Encrypt integration and *automatic* discovery of backend services — Traefik does both natively, with no separate tool (like `certbot`) and no config file that a human has to remember to edit and redeploy. Nginx and Envoy are both excellent, battle-tested proxies, but they treat "get a certificate" and "notice a new backend" as manual steps by default; Traefik treats both as continuous, automatic processes. That's precisely the property Stage 8 depends on (see Section 5.3 below).

Note this decision is scoped to the **control plane** only. The master architecture is explicit that the **Edge Proxy** — RivoCloud's own Go program that actually serves cached CDN content to real visitors — is *not* Traefik or Nginx; it's custom-built, because cache-key construction, ETag handling, signed-URL verification, and range requests can't be implemented correctly inside an off-the-shelf reverse proxy's configuration language. Traefik's job is narrower: it's the front door for custom domains and for routing to the control-plane microservices, and it's what requests TLS certificates.

### 5.3 The Traefik Redis provider — why "dynamic config" matters here specifically

Ordinarily, Traefik (like Nginx) reads its routing rules from a static configuration file on disk. That's fine for infrastructure that changes rarely — e.g. "route requests for `api.rivocloud.dev` to the Identity Service" is a rule that gets set up once and barely ever changes.

Custom domains are the opposite kind of problem: **customers add and remove domains constantly, at runtime, with no RivoCloud engineer involved.** If Traefik's routing rules lived in a static file, adding one customer's domain would mean: edit the file, then restart or redeploy Traefik — for every single domain, added by every single customer, at any hour of the day. That doesn't scale, and it means a customer's "add domain" click in the dashboard couldn't actually take effect without an internal deployment happening in response — an unacceptable coupling between customer self-service and RivoCloud's own deploy pipeline.

Instead, the EDD's design (Section 5.8) has Traefik read its dynamic routing configuration from **Redis**, via a feature called the **Traefik Redis provider**. Concretely:

- The CDN Service writes a new domain's routing rule directly into Redis as a key like `traefik/http/routers/{domain}/rule` with a value like `` Host(`cdn.their-company.com`) ``.
- Traefik is continuously watching that Redis key space for changes (this is what "provider" means in Traefik's vocabulary — a *source* of configuration, as opposed to a one-time-loaded static file).
- The moment that key appears, Traefik picks it up **automatically** — no restart, no redeploy, no human involved — and starts routing matching requests, and separately kicks off the Let's Encrypt certificate request for that new hostname.

This mirrors a pattern already established elsewhere in RivoCloud: the CDN Service also publishes zone configuration to Redis so the Edge Proxy can pick up zone changes "without a restart" (PRD Section 5.2) — Stage 8 applies the exact same idea (config lives in fast, shared, watchable storage instead of a file) to Traefik's routing table instead of the Edge Proxy's zone cache.

---

## 6. DNS verification: why RivoCloud has to check before issuing a certificate

### 6.1 The problem this solves

Suppose RivoCloud simply trusted whatever domain a customer typed into the "add custom domain" form and immediately tried to get a Let's Encrypt certificate for it. Nothing would stop **Customer A** from typing in `cdn.customer-b.com` — a domain they don't actually own — and if Let's Encrypt's own domain-validation check somehow passed (it wouldn't, in practice, precisely because of checks like this), RivoCloud would have issued a certificate letting Customer A's zone impersonate Customer B's domain. Even short of that extreme, if RivoCloud started routing traffic for a domain before confirming the domain's owner actually intended to point it at RivoCloud, it could intercept traffic that was never meant to reach it.

So Stage 8 needs its own confirmation step, independent of whatever validation Let's Encrypt itself performs: **RivoCloud must observe that the customer's DNS genuinely resolves that domain to RivoCloud's infrastructure**, before treating the domain as legitimate and moving on to certificate issuance.

### 6.2 What "polling" means here

**Polling** means repeatedly checking something at a fixed interval, rather than being told the instant it changes. The EDD (Section 5.8, and Section 11 block 8.3) is explicit about this: after a customer is shown the CNAME record to add, the system doesn't just wait passively — the **Scheduler** service (the same microservice responsible for recurring background jobs elsewhere in RivoCloud, like rollups and cert-expiry checks) performs a DNS lookup for that domain **every 30 seconds**, checking whether it now resolves to RivoCloud's `edge.rivocloud.dev`.

Why polling, rather than some kind of instant push notification? Because DNS doesn't work that way — there's no mechanism for a customer's DNS provider to notify RivoCloud the moment a record is added. The only way to find out is to keep asking "does this resolve correctly yet?" — which is exactly what polling is for. (The EDD also allows a manual escape hatch: the customer can click "Verify" in the dashboard, hitting `POST /zones/:zoneId/domains/:d/verify`, to trigger an immediate check instead of waiting up to 30 seconds for the next scheduled poll.)

### 6.3 The status states a domain moves through

The `zone_domains` table (EDD Section 6) tracks this with an `ssl_status` column that moves through a small set of states:

| Status | Meaning |
|---|---|
| `pending_dns` | Domain added by the customer; RivoCloud is polling, waiting for their DNS to resolve to RivoCloud. |
| `pending_ssl` | DNS now resolves correctly; Traefik is in the process of requesting the Let's Encrypt certificate. |
| `active` | Certificate issued and installed; the domain is fully live and serving HTTPS traffic. |
| `error` | Something failed (DNS never resolved, or certificate issuance failed) — surfaced to the customer with a reason. |

The PRD (Section 5.3) requires this status to be "visible in the dashboard" at every stage — so a customer isn't left guessing whether their domain is working; they can see exactly which of these four states it's in.

---

## 7. A concrete walkthrough

Putting Sections 4–6 together, here's the full sequence the EDD describes for adding `cdn.their-company.com` to an existing zone:

1. **Customer adds the domain.** In the dashboard, the customer types `cdn.their-company.com` into an existing zone's settings and submits it. The dashboard calls `POST /api/v1/zones/:zoneId/domains` on the CDN Service.
2. **CDN Service records it and configures Traefik.** The CDN Service inserts a row into the `zone_domains` table in PostgreSQL with `ssl_status = 'pending_dns'`, and writes the routing rule into Redis's Traefik key space (`traefik/http/routers/{domain}/rule`) — this is the Traefik Redis provider write described in Section 5.3. Traefik notices the new key and is now *ready* to route this hostname, but nothing has changed for real visitors yet, because DNS doesn't point here yet.
3. **Dashboard tells the customer what to do.** The customer sees: "Add CNAME record: `cdn.their-company.com` → `edge.rivocloud.dev`."
4. **Customer updates their own DNS**, outside of RivoCloud entirely, at whatever registrar/DNS host they use.
5. **Scheduler polls.** Every 30 seconds, the Scheduler performs a DNS lookup for `cdn.their-company.com`. Once it observes the CNAME now resolving to RivoCloud's infrastructure, it flips the domain's status to `pending_ssl`.
6. **Traefik requests the Let's Encrypt certificate.** Now that DNS genuinely points at RivoCloud (satisfying both RivoCloud's own check and Let's Encrypt's own domain-validation requirement), Traefik performs the ACME issuance flow with Let's Encrypt for `cdn.their-company.com`, obtains the certificate, and installs it — no restart required (Section 5.3).
7. **Status flips to `active`.** The CDN Service learns issuance succeeded (via a webhook from Traefik, or by polling — the EDD notes both are options) and updates the domain's status to `active`.
8. **HTTPS now works.** A real visitor hitting `https://cdn.their-company.com/logo.png` is routed by Traefik's edge ingress to the correct backend for that hostname, over a properly encrypted, browser-trusted connection — indistinguishable, from the visitor's perspective, from any other HTTPS site.

```
Customer                CDN Service          Redis (Traefik      Scheduler         Traefik            Let's Encrypt
dashboard                                     provider keys)      (polls DNS)

  │  add domain               │                     │                 │                │                    │
  ├───────────────────────────▶                     │                 │                │                    │
  │                           │  write router rule   │                 │                │                    │
  │                           ├─────────────────────▶│                 │                │                    │
  │                           │  status: pending_dns  │                 │                │                    │
  │  "add this CNAME record"  │                     │                 │                │                    │
  ◀───────────────────────────┤                     │                 │                │                    │
  │                           │                     │                 │                │                    │
  │  (customer edits DNS at their own provider)      │                 │                │                    │
  │                           │                     │                 │  every 30s:     │                    │
  │                           │                     │                 │  does it resolve│                    │
  │                           │                     │                 │  to RivoCloud?  │                    │
  │                           │                     │                 │       │ yes     │                    │
  │                           │  status: pending_ssl │                 ◀───────┘         │                    │
  │                           ◀─────────────────────┼─────────────────┤                │                    │
  │                           │                     │  reads new host │                │                    │
  │                           │                     ├─────────────────┼───────────────▶│  request cert       │
  │                           │                     │                 │                ├───────────────────▶│
  │                           │                     │                 │                │  issued cert       │
  │                           │                     │                 │                ◀───────────────────┤
  │                           │  status: active      │                 │                │                    │
  │                           ◀─────────────────────┼─────────────────┼────────────────┤                    │
  │  "domain is live!"        │                     │                 │                │                    │
  ◀───────────────────────────┤                     │                 │                │                    │
  │                           │                     │                 │                │                    │
  │  HTTPS request to cdn.their-company.com ─────────────────────────────────────────────▶ routed correctly,
  │                                                                                         served over TLS
```

---

## 8. Why this depends on the CDN Service already existing

The roadmap table in the PRD (Section 7) lists Stage 8's dependency as **Stage 4 (CDN Service)** — not Stage 1, not Stage 3. This isn't arbitrary: a custom domain is meaningless on its own. Every domain in the `zone_domains` schema (Section 6) is a row referencing a `zone_id` — a domain is always *attached to* a zone; it doesn't exist independently. A domain's whole purpose is to give an *existing* zone (which already has an origin URL, cache rules, and a working default `{zone-slug}.cdn.rivocloud.dev` URL) an additional, customer-branded way to be reached.

Concretely, Stage 8 needs Stage 4's work already in place:

- The `pull_zones` table and the concept of "a zone" must already exist for a domain to attach to (`zone_domains.zone_id REFERENCES pull_zones(id)`).
- The CDN Service's existing API surface (`POST /zones`, etc.) is extended, not replaced — `POST /zones/:zoneId/domains` is a new endpoint added to the same service, in the same way it already publishes zone configuration to Redis for the Edge Proxy to read.
- The Edge Proxy (Stage 3) already needs to be resolving `Host` headers to zone configs for *default* subdomains before it's meaningful to add a second way (a custom domain) of reaching the same zone.

This is the same "foundation → core mechanism → management layer" sequencing principle that governs the whole 16-stage roadmap (see [`phase1-explained-for-beginners.md`](../phase1-explained-for-beginners.md#the-key-idea-behind-the-ordering)): custom domains are a *management layer* feature bolted onto a *core mechanism* (zones + the Edge Proxy) that has to exist first.

---

## 9. Wildcard subdomains: the thing that makes zones work on day one

One detail worth calling out explicitly, since it explains why custom domains can be a whole separate, later-arriving stage rather than something zones need from the very start: every zone gets a free default subdomain (`{zone-slug}.cdn.rivocloud.dev`) that works *immediately* upon zone creation, with no DNS setup and no certificate delay. This works because RivoCloud provisions a single **wildcard certificate** for `*.cdn.rivocloud.dev` once, up front — a wildcard certificate covers *any* subdomain of that pattern, so `zone-abc.cdn.rivocloud.dev` and `zone-xyz.cdn.rivocloud.dev` are both already covered without requesting a new certificate per zone.

A wildcard certificate cannot cover a completely different registrable domain like `their-company.com`, though — that's precisely why a *separate*, per-domain certificate request (via Traefik + Let's Encrypt, as described in Sections 5–7) is required the moment a customer wants their own domain instead of RivoCloud's. Stage 4 (CDN Service) only ever needed the one wildcard cert to make zones usable at all; Stage 8 is entirely about the *additional* work required for a customer's own domain name specifically.

---

## 10. Cross-references

- [`phase1-explained-for-beginners.md`](../phase1-explained-for-beginners.md) — see the **Custom Domain**, **TLS / SSL / HTTPS**, and **Traefik** glossary entries (Section 3.1/3.3) for the short version, and the [16-stage roadmap](../phase1-explained-for-beginners.md#5-how-phase-1-is-built-the-16-stages) for how Stage 8 fits alongside every other stage.
- [`docker-compose-and-infrastructure.md`](docker-compose-and-infrastructure.md) — Section 6.4 covers Traefik/TLS/DNS at the level of "what sits around the Docker Compose stack to make it reachable from the internet"; this document is the deep dive behind that summary.
- [`2026-06-29-revocloud-phase1-cdn-edd.md`](../superpowers/specs/2026-06-29-revocloud-phase1-cdn-edd.md) — Section 5.8 (HTTPS and Custom Domains), Section 6 (`zone_domains` schema), Section 10 (Month 3 tasks), Section 11 block 8 (Custom Domains + TLS dependency chain).
- [`2026-06-29-revocloud-master-architecture.md`](../superpowers/specs/2026-06-29-revocloud-master-architecture.md) — Section 5.6 (why Traefik was chosen over Nginx/Envoy).
- [`2026-07-25-revocloud-phase1-prd.md`](../superpowers/specs/2026-07-25-revocloud-phase1-prd.md) — Section 5.3 (Custom Domains + TLS functional requirements) and Section 7 (roadmap table, showing Stage 8's dependency on Stage 4).

---

**The one-line summary:** a custom domain only becomes a working, secure RivoCloud CDN endpoint once three independent things line up — the customer's own DNS pointing at RivoCloud, Traefik dynamically picking up the new hostname from Redis instead of a static config file, and a Scheduler-driven polling loop confirming DNS really resolved before Let's Encrypt is asked to prove it and issue a free, auto-renewing certificate — and none of it is meaningful until a zone (Stage 4) already exists for the domain to attach to.
