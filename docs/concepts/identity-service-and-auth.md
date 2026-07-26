# Identity Service & Auth — Explained for Beginners

This document explains **everything you need to understand before Stage 2 (Identity Service) gets built** — what authentication and authorization actually mean, how JWTs and API keys work, why passwords are never stored as plain text, and how organizations/roles make RivoCloud "multi-tenant" from day one.

**Nothing described here exists in code yet.** Stage 1 (Infrastructure) is done — the databases and tools are running. Stage 2 is the *next* thing to build, and this doc is the "read this before you start" companion, the same way [`docker-compose-and-infrastructure.md`](docker-compose-and-infrastructure.md) was for Stage 1. If you haven't read [`../phase1-explained-for-beginners.md`](../phase1-explained-for-beginners.md) yet, read that first — it defines JWT, API Key, RBAC, and Organization briefly in its glossary (Section 3.4). This document goes much deeper on those same terms, specifically as they apply to Identity Service.

The authoritative specs behind everything below are the [Phase 1 PRD](../superpowers/specs/2026-07-25-revocloud-phase1-prd.md) (Section 5.1, functional requirements) and the [Phase 1 EDD](../superpowers/specs/2026-06-29-revocloud-phase1-cdn-edd.md) (Section 2.2 service design, Section 6.1 database tables, Section 7.1–7.4 API endpoints, Section 8.1–8.2 security architecture, Section 11 build order).

---

## 1. Why does an "Identity Service" need to exist at all?

Every product that has user accounts needs to answer two questions, over and over, for every single request:

1. **Who is this?** ("this request says it's from user `alice@example.com`... is that actually true?")
2. **Are they allowed to do this?** ("okay, it really is Alice — but is she allowed to delete *this specific* CDN zone?")

Question 1 is **authentication**. Question 2 is **authorization**. They sound similar and get confused constantly, so here's a plain-language way to keep them straight:

> **Authentication is showing your ID at the door. Authorization is the bouncer deciding which rooms you're allowed into once you're inside.**

A concrete everyday analogy: at a hotel, checking in at the front desk and getting a keycard is *authentication* — the hotel confirms you're really the person who booked the room. But that keycard only opens *your* room, the gym, and the lobby — it won't open the manager's office or another guest's room. That restriction is *authorization*. You can be authenticated (a real, checked-in guest) and still be unauthorized to do something (enter a room that isn't yours).

In RivoCloud terms:
- **Authentication** = logging in with an email/password (or presenting a valid JWT / API key on a later request) and having the system confirm "yes, this really is that user."
- **Authorization** = once we know who you are, checking your **role** (Owner/Admin/Developer/Viewer — see Section 6) or your **API key's permissions** before letting an action through, e.g. "Developers can create zones, but only Owners can touch billing."

The **Identity Service** is the one microservice responsible for both of these, for the entire platform. Every other service — CDN, Storage, Analytics, Billing — will ask Identity's logic (via a shared piece of code called the **Auth Guard**, Section 7) "who is this, and are they allowed to do this?" instead of each reinventing login and permission-checking themselves.

---

## 2. Why passwords are never stored as typed

Imagine RivoCloud stored passwords exactly as users typed them — `password_column = "hunter2"`. Anyone with database access (an attacker who breaks in, a careless employee, a leaked backup file) instantly has every user's real password. Since people reuse passwords across sites, one leaked RivoCloud database could hand out logins to unrelated services too.

The fix is **hashing**. A hash function takes any input (a password) and produces a fixed-length scrambled output (a "digest") that:
- Always produces the *same* output for the *same* input (so you can check a password by hashing the login attempt and comparing digests).
- Cannot practically be reversed — you can't take the digest and compute the original password back out.

So instead of storing the password, the database stores only the *hash* of it. The `users` table's `password_hash` column (see Section 6.1 of the EDD) holds this hash — never the real password. When someone logs in, the server hashes what they typed and compares it to the stored hash; if they match, the password was correct, and the server never needed to "remember" the real password at all.

Plain generic hash functions (like the ones used to verify a downloaded file wasn't corrupted) are actually *too fast* for passwords — a modern computer can try billions of guesses per second against a stolen hash. Password hashing specifically uses **slow, intentionally expensive** algorithms designed for this purpose — the two well-known families are **bcrypt** and **argon2**. The EDD names bcrypt specifically for hashing API keys before storage (Section 2.2, Section 8.1); it doesn't pin an exact algorithm for user login passwords, so treat "some deliberately slow password-hashing algorithm, most likely bcrypt for consistency with the rest of the service" as the plan rather than a hard commitment — the actual choice gets made when Stage 2 is implemented.

The same idea — never store the sensitive secret itself, only a hash of it — is reused for **API keys** (Section 5) and for **email verification / password reset tokens** (the `email_verification_tokens` table stores a `token_hash`, not the raw token that gets emailed to the user).

---

## 3. JWT: proving who you are without a database lookup every time

### The problem JWT solves

Say a logged-in user clicks around the dashboard, firing off dozens of API requests per minute. One approach: every request, the server looks up a "session ID" in a database to confirm the user is still logged in. That works, but it means *every single request* costs a database round-trip just to answer "who is this?" — before the request has even started doing its actual job.

A **JWT (JSON Web Token)** solves this by making the token *self-describing and tamper-proof*. Instead of a random session ID that means nothing on its own, a JWT is a small chunk of signed data that directly says who the user is. The server can verify a JWT's signature using pure math (a few microseconds), with **no database lookup needed**, because the proof travels inside the token itself.

Concretely, per the EDD (Section 8.1), a RivoCloud JWT's payload looks like this:

```json
{
  "sub": "user_uuid",
  "org": "org_uuid",
  "role": "developer",
  "iat": 1719648000,
  "exp": 1719648900,
  "jti": "unique_token_id"
}
```

- `sub` ("subject") — which user this is.
- `org` — which organization they're currently acting within (remember, everything is org-scoped — see Section 5).
- `role` — their role in that org, so authorization checks don't need a separate database lookup either.
- `iat` / `exp` — issued-at and expiry timestamps.
- `jti` — a unique ID for *this specific token*, used for revocation (see below).

This whole payload is cryptographically **signed** by the server (using `RS256`, an algorithm involving a private/public key pair) before being handed to the client. Anyone can *read* a JWT's contents (it's not encrypted, just encoded) — that's fine, since it contains no secrets — but nobody except the server holding the private key can *forge* a valid signature. If someone edits even one character of the payload (e.g., changing `"role": "developer"` to `"role": "owner"`), the signature no longer matches, and the server rejects it instantly.

### Access token vs. refresh token — and why the split exists

If a JWT is this convenient, why not just make one that lasts forever? Because a JWT can't easily be "un-issued" once handed out — unlike a database session row, you can't just delete it, since the server never looks it up. If a long-lived JWT leaks (e.g., stolen from a compromised browser), the attacker can use it until it expires, no matter what the real user does afterward.

RivoCloud's answer is the same one most modern systems use: **two tokens with very different lifetimes**, working together:

| | Access Token | Refresh Token |
|---|---|---|
| **Lifetime** | 15 minutes | 30 days |
| **Purpose** | Sent with every API request, to prove identity cheaply (no DB lookup) | Used *only* to get a new access token when the old one expires |
| **Where it's stored/checked** | Not stored anywhere server-side — verified by signature alone | Stored as a hash in Redis, so it *can* be looked up, checked, and invalidated |
| **What happens if it leaks** | Damage is capped at 15 minutes — then it stops working on its own | More dangerous if leaked (30-day window), which is exactly why it's tracked server-side and can be revoked |

This is the resolution to a real tension: **short-lived tokens are safer (less time for a stolen token to do damage) but annoying (users would have to log in again every 15 minutes without something else in place)**. The refresh token is that "something else" — it lets the client silently request a new 15-minute access token every time the old one is close to expiring, without asking the user to type their password again, while still keeping the *dangerous, long-lived* credential (the refresh token) revocable, because it lives in Redis where the server can check and delete it. Per the EDD, refresh tokens are also **single-use and rotated** — each time one is used to get a new access token, it's replaced with a brand new refresh token, so a stolen-but-unused refresh token becomes worthless the next time the real user refreshes normally.

### Revoking a JWT before it naturally expires

Since access tokens aren't looked up anywhere, how does the system handle "log this user out right now" or "this token was stolen, kill it immediately"? The EDD's answer is a **blacklist**: when a token needs to be revoked early, its `jti` (unique ID) gets written to a Redis key like `jwt:blacklist:{jti}`, with an expiry set to match however much time was left on that token anyway (no point remembering a blacklisted token past the moment it would have expired naturally). Every request additionally checks "is this token's `jti` on the blacklist?" — one fast Redis lookup, not a full database query, so the speed benefit of JWTs is mostly preserved even with revocation support.

---

## 4. API Keys: a different mechanism for a different kind of "user"

JWTs are built around a human logging into a browser session that lasts a while and then ends. But plenty of RivoCloud usage isn't a human at all — it's a script, a CI/CD pipeline, or another company's backend server calling RivoCloud's REST API directly, with no browser and no concept of "logging in" every 15 minutes.

That's what **API Keys** are for — programmatic, machine-to-machine access. Per the EDD (Section 8.1), a RivoCloud API key looks like:

```
rc_live_3qYJAKRpX8mF2nQ7vDsHbL9wEcT5iUg4
```

Key differences from a JWT:

| | JWT (access token) | API Key |
|---|---|---|
| Who/what uses it | A human, via the dashboard, for a limited session | A script/integration, indefinitely |
| Lifetime | 15 minutes, then refreshed automatically | No expiry by default (`expires_at` can optionally be set); stays valid until explicitly revoked |
| How it's verified | Signature check only (no DB lookup) | Looked up in the `api_keys` table by its `key_prefix`, then its hash is compared (`bcrypt.Compare`) — this *is* a DB lookup, which is acceptable because API calls are far less frequent than a browser's constant JWT-carrying requests |
| What it can do | Whatever the logged-in user's role allows | A specific, chosen subset of permissions (see Section 6) — can be narrower than the creating user's full role, but never broader |
| Shown to the user | N/A (browser holds it, user never sees the raw string) | Shown in full **exactly once**, at creation time — after that, only the `key_prefix` (first 12 characters) is ever displayed again, so a leaked dashboard screenshot can't leak the whole key |

Storage mirrors the password lesson from Section 2: the full key is never stored — only its bcrypt hash (`key_hash`), plus the `key_prefix` for fast lookup and display. This is why, per the EDD's API design, losing your API key means generating a new one — RivoCloud itself can't show it to you again, because it never kept a copy of the real thing either.

---

## 5. Organizations & Members: multi-tenancy from day one

RivoCloud isn't built for one company's private use — it's a platform many different, unrelated customers will use simultaneously, each with their own zones, buckets, billing, and team members, all stored in the *same* database and served by the *same* running services. This is called **multi-tenancy**: many "tenants" (customers) sharing one system, kept strictly separate from each other's data.

The unit of a "tenant" in RivoCloud is the **Organization**. Nearly every table in the schema — zones, buckets, API keys, billing — has an `org_id` column pointing back to an organization. This is what "**org-scoped**" means throughout the specs: every resource belongs to exactly one organization, and every request must be checked against *that* organization's boundary — Alice at Company A should never be able to see, list, or modify Company B's zones, even by guessing an ID.

Why build this in from the very first stage, rather than adding it later once there are "actually multiple customers"? Retrofitting multi-tenancy onto a system that was built assuming a single owner is a notoriously error-prone, expensive rework (every table needs an `org_id` added, every query needs an org filter bolted on, and it's easy to miss one and create a data leak between customers). Building it from Stage 2 onward means every table and every endpoint is org-scoped *by construction*, before a single feature exists to accidentally get it wrong on.

A user isn't tied to one organization forever — the `organization_members` table (Section 6.1 of the EDD) is a many-to-many link: one user can belong to multiple organizations (e.g., a contractor working for two different clients), and one organization has multiple members. Each row in that table also carries the member's **role** within that specific organization — which is the subject of the next section.

---

## 6. RBAC: what each role can and can't do

**RBAC (Role-Based Access Control)** means permissions are attached to a small set of named *roles*, and each user is simply assigned one role per organization, rather than the system tracking a giant custom list of individual permissions per person. It's much easier to reason about "Alice is a Developer" than to track fifteen individual yes/no permission flags for her.

Per the EDD (Section 8.2), RivoCloud's four organization roles and what they can touch:

| Role | Zone | Storage | Analytics | Billing | Members | Settings |
|---|---|---|---|---|---|---|
| **Owner** | Full | Full | Full | Full | Full | Full |
| **Admin** | Full | Full | Full | Read | Invite/Remove | Full |
| **Developer** | Full | Full | Full | None | None | Read |
| **Viewer** | Read | Read | Full | None | None | None |

Reading this in plain language:
- **Owner** — the organization's creator/super-admin. Can do absolutely everything, including irreversible things like deleting the organization or changing billing.
- **Admin** — trusted operational staff. Can manage zones, storage, and team membership day-to-day, but can only *view* (not change) billing.
- **Developer** — a working engineer. Can create/edit/delete zones and storage (the actual technical work), can see settings, but has no visibility or control over members or billing at all — a compromised developer account can't be used to add new members or see the credit card on file.
- **Viewer** — read-only access. Useful for stakeholders (a manager, a client) who need to see what's happening — zone configs, analytics — without being able to change anything.

Every column here maps to real API endpoints in Section 7.5–7.8 of the EDD (zone CRUD, storage CRUD, billing endpoints, member management) — the Auth Guard (Section 7 below) is what actually enforces "does this caller's role allow this specific action?" before the request is allowed to reach that endpoint's logic.

**API keys get their own, finer-grained permission system**, separate from the four broad roles, because a script often needs *narrower* access than a full human role would grant (e.g., a CI pipeline that only needs to trigger cache invalidation shouldn't also be able to delete storage buckets). Per Section 8.2, permissions are individual strings like `zone:read`, `zone:write`, `zone:delete`, `cache:invalidate`, `storage:read`, `storage:write`, `storage:delete`, `analytics:read`, `billing:read` — and an API key can be issued with any subset of these. Critically, **a user can never grant an API key more permission than their own role already has** — a Developer (who has no billing access at all) cannot create an API key with `billing:read`, even though that scope exists in the system, because they don't hold that permission themselves to hand out.

---

## 7. The Auth Guard: one gatekeeper, reused everywhere

Every one of RivoCloud's microservices (CDN Service, Storage Service, Analytics Service, Billing Service, and so on) needs to answer "who is this, and are they allowed to do this?" before doing anything else. Writing that logic separately, service by service, would mean six or seven slightly-different, independently-bug-prone implementations of the exact same problem.

Instead, per the EDD's Development Order (Section 11, step 2.4), Identity Service produces a shared **Auth Guard** — in NestJS (the web framework these services are built with), a "Guard" is a small piece of code that runs *before* a request reaches its actual handler and decides whether to let it through. Every other service imports and reuses this exact same guard rather than writing its own.

The EDD sketches its logic (Section 8.2) roughly like this:

```typescript
@Injectable()
export class AuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = extractToken(request);

    if (token.startsWith('rc_')) {
      // API key auth
      const key = await this.apiKeyService.verify(token);
      request.auth = { type: 'api_key', key, org: key.org, permissions: key.permissions };
    } else {
      // JWT auth
      const payload = this.jwtService.verify(token);
      request.auth = { type: 'jwt', userId: payload.sub, orgId: payload.org, role: payload.role };
    }
    return true;
  }
}
```

Notice it handles *both* mechanisms from Sections 3 and 4 in one place: if the credential starts with `rc_` it's an API key (look it up and check its stored permissions); otherwise it's treated as a JWT (verify the signature, trust the embedded `role`). Either way, it attaches a normalized `request.auth` object that the rest of the request-handling code — in *any* service — can check without caring which of the two mechanisms was actually used.

Two more pieces from Section 2.2 of the EDD make this reusable across services running as separate processes, rather than sharing memory:

- `POST /internal/verify-token` — given a JWT, returns the user + org context.
- `POST /internal/verify-api-key` — given an API key, returns its permissions.

These are **internal APIs** — not exposed to customers, only callable by Traefik (the reverse proxy sitting in front of every control-plane service, introduced in [`docker-compose-and-infrastructure.md`](docker-compose-and-infrastructure.md)) or by other services directly. This is what lets, say, the CDN Service — a completely separate running program from Identity Service — still ask "is this JWT valid, and who does it belong to?" without duplicating Identity Service's verification logic itself.

---

## 8. A concrete walkthrough: register → log in → create an org → generate an API key

Here's how the concepts above combine into one realistic sequence, referencing the actual planned endpoints from Section 7.1–7.4 of the EDD.

1. **Register.** A new user submits an email, password, and name to `POST /api/v1/auth/register`. The Identity Service hashes the password (Section 2), creates a row in `users` with `email_verified: false`, and (per Section 2.2 of the EDD) publishes a `user.registered` event to NATS so the Notification Service can send a verification email — Identity Service doesn't send email itself.
2. **Verify email.** The user clicks the link in that email, hitting `POST /api/v1/auth/verify-email` with the token from the link. The server hashes the incoming token and compares it to the stored `token_hash` in `email_verification_tokens` (same never-store-the-raw-secret pattern as passwords and API keys) — matching it flips `email_verified` to `true`.
3. **Log in.** The user submits their email/password to `POST /api/v1/auth/login`. The server re-hashes the submitted password and compares it to the stored `password_hash`. On success, it issues an **access token** (15-minute JWT) and a **refresh token** (30-day, stored hashed in Redis) — see Section 3.
4. **The dashboard uses the access token.** Every subsequent request from the browser carries `Authorization: Bearer <access token>` in its headers. The Auth Guard (Section 7) verifies the signature — no database hit needed — and reads the embedded `sub`/`org`/`role` claims.
5. **Silent refresh.** Fifteen minutes later, the access token expires. Before that happens, the dashboard calls `POST /api/v1/auth/refresh` with the refresh token. Identity Service checks the token's hash against what's stored in Redis, issues a brand-new access token *and* a new refresh token (rotating the old one out, Section 3), and the user never notices — no re-typing a password.
6. **Create an organization.** The user calls `POST /api/v1/orgs` with a name (e.g., "Acme Corp"). Identity Service creates a row in `organizations` with this user as `owner_id`, and a matching row in `organization_members` linking this user to this new org with `role: 'owner'` (Section 5 and 6). From now on, the user's JWTs are minted with `"org": "<acme-org-uuid>"` and `"role": "owner"` when acting on behalf of this org.
7. **Invite a teammate.** The Owner calls `POST /api/v1/orgs/:orgId/members` with a teammate's email and a chosen role (say, `developer`). This sends an invitation email (via the Notification Service, again via NATS) and creates an `organization_members` row for them once accepted.
8. **Generate an API key.** The team wants their CI pipeline to trigger cache invalidations automatically, without a human logging in. They call `POST /api/v1/api-keys` with a name and a requested scope of just `["cache:invalidate"]`. Identity Service generates a random `rc_live_...` string, shows it **once** in the response, and stores only its bcrypt hash plus its 12-character prefix (Section 4).
9. **The CI pipeline uses the API key.** Every automated request now sends `X-API-Key: rc_live_...` instead of a JWT. The Auth Guard (Section 7) recognizes the `rc_` prefix, looks the key up by its prefix, verifies the bcrypt hash matches, and attaches `request.auth = { type: 'api_key', permissions: ['cache:invalidate'] }` — meaning this credential can invalidate caches and nothing else, even though it belongs to an org whose Owner can do everything.
10. **Someone leaves the company.** The Owner calls `DELETE /api/v1/api-keys/:keyId` to revoke that key (setting its revoked timestamp so future lookups reject it), or removes a departing teammate via `DELETE /api/v1/orgs/:orgId/members/:uid`. Either way, the Auth Guard's checks (steps 4 and 9) immediately start rejecting that credential on the very next request — no special-casing needed elsewhere, because every other service already goes through the same shared guard.

---

## 9. Why this is Stage 2 — right after infrastructure, before everything else

Looking back at the [16-stage build order](../phase1-explained-for-beginners.md#5-how-phase-1-is-built-the-16-stages) and the [PRD's roadmap table](../superpowers/specs/2026-07-25-revocloud-phase1-prd.md), Identity Service is stage 2, depending only on stage 1 (Infrastructure Foundation). Every stage after it — the Edge Proxy, CDN Service, Storage Service, Analytics, Billing — either directly imports the Auth Guard built here (Section 7) or depends on Organizations existing as a concept (Section 5) so its own tables can be org-scoped from the start.

Put another way: without Stage 2, there is no answer to "who made this request, and are they allowed to?" — and *every single other feature* in the platform needs that answer before it can safely do anything. Building zone management (Stage 4) before auth exists would mean anyone could create, edit, or delete anyone else's CDN configuration; building storage (Stage 5) first would mean anyone could upload to or delete from anyone else's buckets. Building Identity once, early, and having every later service reuse its Auth Guard instead of reinventing login and permission-checking is exactly the "foundation → core mechanism" pattern described in the phase-wide walkthrough's [key ordering idea](../phase1-explained-for-beginners.md#the-key-idea-behind-the-ordering).

This is also why the EDD's own internal build order for this stage (Section 11) is sequenced the way it is: Auth (2.1) before Organizations (2.2), because a member row needs a real user to reference; Organizations before API Keys (2.3), because an API key belongs to an org; and the shared Auth Guard (2.4) comes *last* within this stage, because it needs all three of the previous pieces (login, orgs, keys) working before it can meaningfully verify either kind of credential.

---

## 10. Summary table: the pieces this stage introduces

| Concept | What it is | Where it lives / how it's checked |
|---|---|---|
| Password hash | A one-way scrambled version of a user's password | `users.password_hash` column; never the real password |
| Access token (JWT) | Short-lived (15 min), signed proof of identity | Verified by signature only, no DB lookup; carries `sub`/`org`/`role` |
| Refresh token | Long-lived (30 days), single-use, rotated on each refresh | Stored as a hash in Redis; used only to mint new access tokens |
| JWT blacklist | A way to revoke an access token before it naturally expires | Redis key `jwt:blacklist:{jti}`, checked on every request |
| API key | Long-lived credential for scripts/integrations, not humans | `api_keys` table; stored as a bcrypt hash + prefix, shown in full only once |
| Organization | A tenant/team account; the unit every resource belongs to | `organizations` table; every other resource carries an `org_id` |
| Organization member | A user's role within one specific organization | `organization_members` table; many-to-many between users and orgs |
| Role (Owner/Admin/Developer/Viewer) | A named bundle of permissions checked per-org | Embedded in JWTs; enforced by the Auth Guard on every mutating call |
| API key permission scope | Fine-grained action grants (`zone:read`, `storage:write`, etc.) | `api_keys.permissions` JSON column; never broader than the creator's own role |
| Auth Guard | Shared NestJS middleware every other service reuses | Reads either a JWT or an `rc_`-prefixed API key, attaches `request.auth` |

---

## 11. Putting it all together

```
Browser (Dashboard)                          Script / CI pipeline
      │                                              │
      │ email + password                            │ X-API-Key: rc_live_...
      ▼                                              ▼
POST /auth/register ──▶ users table (password_hash)  │
POST /auth/verify-email ──▶ email_verification_tokens │
POST /auth/login ──▶ checks password_hash             │
      │                                              │
      ├──▶ Access Token (JWT, 15 min)                 │
      └──▶ Refresh Token (hash in Redis, 30 days) ─┐   │
                                                    │   │
      every request ──▶  ┌─────────────────────────▼───▼─────────────┐
                          │              Auth Guard                   │
                          │  starts with "rc_"? → verify API key hash │
                          │  else               → verify JWT sig      │
                          │  → request.auth = { userId/org/role  OR   │
                          │                      apiKey/permissions } │
                          └─────────────────┬───────────────────────┬─┘
                                            │                       │
                          checked against:  │                       │
                     RBAC role table ◀──────┘        API key scopes ┘
                     (Owner/Admin/Developer/Viewer)   (zone:read, storage:write, ...)
                                            │
                                            ▼
              CDN Service · Storage Service · Analytics Service · Billing Service
              (every one of these imports the SAME Auth Guard — built once, here)

POST /orgs ──▶ organizations + organization_members (role: owner)
POST /orgs/:orgId/members ──▶ invite teammate (role: developer/admin/viewer)
POST /api-keys ──▶ api_keys table (key_hash, key_prefix, permissions[])
```

**The one-line summary:** Identity Service exists so that every later microservice can ask one shared Auth Guard "who is this, and what are they allowed to do?" instead of each reinventing password hashing, JWTs, API keys, organizations, and roles on its own — which is exactly why it's built second, immediately after the infrastructure that stores its data, and before anything that will need to trust its answer.
