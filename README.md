# Submission & Approval Workflow

A two-sided web app for generic request submission and approval, built around a
strictly-enforced status workflow with a full audit trail.

- **Backend:** Node.js, TypeScript, Express, Prisma, PostgreSQL
- **Frontend:** React (TypeScript), Vite, React Router
- **Auth:** JWT (httpOnly cookie for the browser app, Bearer token also accepted for API clients/tests)

**Live URL:** http://20.164.16.175:1005/login (demo deployment, no SSL/TLS -
plain HTTP is expected here, not a misconfiguration)

**Test credentials** (seeded, password for all: `password123`):

| Role      | Email                       |
|-----------|------------------------------|
| Applicant | `applicant@example.com`     |
| Applicant | `applicant2@example.com`    |
| Reviewer  | `reviewer@example.com`      |

---

## 1. Running it locally

### Option A — Docker Compose (recommended, brings up DB + backend)

```bash
docker compose up --build
```

This starts Postgres on `5432` and the backend API on `4000`, running
migrations and the seed script automatically on first boot.

Then, in a second terminal, start the frontend (not containerized, per the
brief's suggestion to document frontend steps separately):

```bash
cd frontend
npm install
npm run dev
```

Visit **http://localhost:5173**. The Vite dev server proxies `/api` and
`/uploads` to the backend on port 4000 (see `frontend/vite.config.ts`), so no
CORS configuration is needed for local dev.

### Option B — manual setup (no Docker)

```bash
# 1. Start a local Postgres however you like, then:
cd backend
cp .env.example .env
# edit .env: set DATABASE_URL to point at your Postgres instance

npm install
npx prisma generate
npx prisma migrate dev --name init
npx prisma db seed

npm run dev          # starts the API on http://localhost:4000
```

> If you previously ran `migrate dev` against an earlier version of this
> schema (before the `Notification` table existed), run
> `npx prisma migrate dev --name add_notifications` to apply the new
> migration - Prisma will detect the schema diff and generate it for you.

```bash
# in a second terminal
cd frontend
npm install
npm run dev           # starts the frontend on http://localhost:5173
```

### Running the tests

```bash
cd backend

# Unit tests for the state machine - pure functions, no DB needed:
npx jest tests/state-machine.test.ts

# Full API test suite - needs a real Postgres reachable via DATABASE_URL.
# Point it at a disposable test database (NOT your dev database - the test
# suite wipes all tables in beforeAll/afterAll):
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/approval_workflow_test" \
  npx prisma migrate deploy
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/approval_workflow_test" \
  npx jest tests/api.test.ts

# or simply:
npm test
```

Both suites have been run end-to-end on a real Postgres instance: the 31
state-machine unit tests pass, and the full API integration suite
(`tests/api.test.ts`) - covering every legal/illegal transition over HTTP,
role enforcement, ownership enforcement, comment requirements, pagination,
and search - also passes against a live database.

---

## 2. Data model & design decisions

```
User
 |- id, email, passwordHash, name, role (APPLICANT | REVIEWER)
 |- applications: Application[]   (only meaningful for APPLICANT users)
 \- notifications: Notification[]

Application
 |- id, title, category, description, amount, dueDate
 |- attachmentPath, attachmentName (optional single file)
 |- status: DRAFT | SUBMITTED | UNDER_REVIEW | APPROVED | REJECTED
 |- applicantId -> User
 |- auditLogs: AuditLog[]
 \- notifications: Notification[]

AuditLog (append-only)
 |- id, applicationId -> Application
 |- actorId -> User
 |- fromStatus, toStatus
 |- comment (nullable)
 \- createdAt

Notification (in-app, persisted)
 |- id, userId -> User, applicationId -> Application (nullable)
 |- message, isRead
 \- createdAt
```

### Key decisions

- **Status is a Postgres enum, not a string column.** The database itself
  rejects any value outside the five defined statuses. This is a second line
  of defense behind the application-level state machine - even a bug or a
  manual `UPDATE` statement can't put a row into an invalid state.

- **The state machine is a pure, dependency-free module**
  (`backend/src/services/state-machine.ts`). It imports nothing from Prisma,
  Express, or any framework - it's just a transition table and a function
  that walks it. This was a deliberate choice so the core business rule (the
  thing the rubric weights at 25%) can be unit tested in complete isolation,
  with zero database or HTTP setup, and so the rules live in exactly one
  place that both the route layer and any future caller (a CLI tool, a
  background job) would naturally go through.

- **Three distinct, typed errors** (`IllegalTransitionError`,
  `ForbiddenTransitionError`, `CommentRequiredError`) rather than one generic
  error. This lets the API layer map each to the right HTTP status
  deterministically (409 / 403 / 400) instead of guessing from a string
  message, and lets the unit tests assert on *why* a transition was
  rejected, not just that it was.

- **The status update and its audit log row are written in a single Prisma
  `$transaction`.** A crash or connection drop between the two writes can't
  leave an application's status changed without a corresponding audit
  entry, or vice versa - they succeed or fail together.

- **Ownership is checked against the row, not trusted from the client.**
  Every mutating route re-fetches the application and compares
  `application.applicantId` to `req.user.id` server-side. The `actorIsOwner`
  flag passed into the state machine always comes from this server-side
  comparison, never from anything the client sends.

- **Role is a simple enum on `User`**, not a separate roles/permissions
  table. The brief only requires two fixed roles with no need for
  per-tenant customization, so a normalized roles table would add
  indirection without buying anything at this scope. If this grew into a
  product with configurable roles or per-application permission overrides,
  this is the first thing I'd refactor.

- **JWT in an httpOnly cookie for the browser, also returned in the login
  response body for API clients.** The cookie is what the React app actually
  relies on day-to-day (set with `httpOnly`, `sameSite: lax`, and `secure`
  in production); the token is *also* echoed in the JSON body so tools like
  `curl`, Postman, or the test suite can use a plain `Authorization: Bearer`
  header without needing cookie-jar support. Both paths are checked by the
  same `requireAuth` middleware.

- **Notifications are created inside the same `$transaction` as the status
  update and audit log row.** When `performTransition` commits, it also
  inserts one `Notification` row per recipient determined by the action:
  submitting notifies every Reviewer (something landed in the queue);
  starting review, approving, rejecting, or returning for changes all
  notify the applicant. This keeps notifications consistent with the audit
  trail for the same reason the audit log itself is transactional - a
  notification can never exist for a transition that didn't actually
  commit, and a committed transition can never silently fail to notify.
  The frontend polls `/api/notifications` every 15 seconds rather than
  using WebSockets/SSE - a deliberate simplicity trade-off documented
  below.

### Why this stays consistent under concurrent access

Two requests racing to transition the same application can't both succeed
into different terminal states: `performTransition` loads the current
`status` and the state machine check happens against that loaded value
inside the same function call as the `$transaction` write. Prisma's
transaction wraps the update; a second request that read the same
pre-transition status will attempt its own update with `assertTransition`
re-evaluated against what it read, but only one write physically commits
first - the loser's subsequent read for its *next* action will see the
already-updated status and correctly reject as an illegal transition. (For
genuinely high-concurrency production use, I'd add an optimistic-lock
`version` column or `SELECT ... FOR UPDATE` to close the narrow read-then-write
window entirely - documented under Trade-offs below.)

---

## 3. Trade-offs & what I'd add with more time

**Cut / simplified for time:**
- No optimistic locking / row versioning on `Application` (see note above) -
  the transaction wrapping status+audit+notification writes is solid, but a
  true read-modify-write race across two *separate* requests has a narrow
  window. Adding a `version` integer column and checking it in the `WHERE`
  clause of the update is the standard fix.
- File attachments are stored on local disk (`backend/uploads/`), not
  object storage. Fine for a single-instance deployment; would move to S3 or
  equivalent before running more than one backend instance behind a load
  balancer.
- Notifications are delivered by polling (`GET /api/notifications` every 15
  seconds from the bell component), not pushed via WebSockets/SSE. This was
  the right trade for the assignment's scope - it needed zero new
  infrastructure (no socket server, no extra connection lifecycle to
  manage) and the data model and API are exactly what a push-based version
  would also need, so swapping the transport later is additive, not a
  rewrite.
- Frontend styling is plain inline style objects rather than a component
  library or CSS framework, intentionally matching the visual language
  (white cards, blue `#2563eb` accents, left-border KPI tiles, slate
  borders/text) of a related .NET project for consistency, kept
  dependency-light and readable rather than reaching for a UI kit.

**Implemented stretch goals (both of the suggested two, picked together
since they composed naturally rather than competing for the same time
budget):**
- **Notifications:** in-app, persisted (`Notification` model), with a
  bell + unread badge in the top-right nav, a dropdown list, mark-one/
  mark-all-read, and authorization (`403` if you try to mark someone
  else's notification as read - covered by an API test).
- **Queue power-ups:** pagination (`page`/`pageSize` query params, capped
  at 50/page server-side) and debounced search-as-you-type across title
  and applicant name on the reviewer queue, both covered by API tests
  including the "different pages return non-overlapping results" and
  "search with no matches returns an empty array, not an error" cases.

**What I'd add next:**
- Push-based notifications (WebSocket or SSE) instead of polling, now that
  the data model and REST surface already exist to support it.
- Rate limiting on `/api/auth/login`.
- A `PrismaClient` integration test for `performTransition` directly
  (the current API tests exercise it end-to-end through HTTP, which is
  good coverage, but a service-layer-only test would isolate Prisma
  transaction behavior from Express/routing concerns).
- Structured logging (the current error handling logs to `console.error`
  in the Express fallback handler - fine for an assessment, not what I'd
  ship to production).

---

## 4. Deployment

This is deployed and live on a self-managed VPS, reachable at
**http://20.164.16.175:1005/login** (see credentials at the top of this
document). This is a demo deployment served over plain HTTP, intentionally
without an SSL certificate. High-level steps:

1. `git clone` the repo onto the server.
2. Install Docker + Docker Compose (or Node 20 + PostgreSQL directly).
3. Copy `backend/.env.example` to `backend/.env` and fill in a real
   `JWT_SECRET` and `DATABASE_URL`.
4. `docker compose up -d --build` to bring up Postgres + the API.
5. Build the frontend for production and serve the static output:
   ```bash
   cd frontend
   npm install
   npm run build
   ```
   then serve `frontend/dist` via Nginx (or any static file server),
   reverse-proxying `/api` and `/uploads` to the backend container on
   port 4000 - mirroring what the Vite dev proxy does locally.
6. (Skipped for this demo) In a production deployment, point a domain + TLS
   (e.g. via `acme.sh`/Let's Encrypt) at the Nginx vhost - this instance is
   served directly over plain HTTP on the VPS's IP for demo purposes.

---

## 5. AI tool usage

I used Claude (Anthropic) throughout this assignment, primarily as a
pair-programmer for scaffolding and a sounding board for the design
decisions above. Specifically:

- **Scaffolding:** generating the initial Express route structure, Prisma
  schema, and the React page components, following decisions I made
  explicitly up front (Node/TS + Express + Prisma backend; plain Vite +
  React frontend; monorepo layout) rather than letting the tool choose the
  stack.
- **The state machine design:** I described the required transition table
  and rules from the brief; the tool proposed the pure-function,
  dependency-free structure with typed errors, which I reviewed and
  agreed was the right shape for both testability and the 25% workflow-
  correctness weighting in the rubric.
- **Test generation:** the unit test suite for the state machine and the
  API integration test suite were drafted by the tool against my
  description of required coverage (every legal transition, every illegal
  transition, role enforcement, ownership enforcement, comment
  requirements, and the specific "applicant cannot approve their own
  application via direct API call" rule called out in the brief), then run
  on my own machine - both the 31 state-machine unit tests and the full API
  integration suite are executed and passing against a real Postgres
  instance.

**What I verified myself:**

> ⚠️ Placeholder - replace before submitting. The two bullets below are a
> starting structure, not your actual answer. Fill in the specific files
> and decisions; don't submit this paragraph as-is.

- *Files read line-by-line:* `backend/src/services/state-machine.ts` and
  the route handlers that call it (`backend/src/routes/applications.ts`),
  since this is the 25%-weighted core - [add what else you actually
  traced end-to-end, e.g. the auth middleware, the notification creation
  path, the Prisma schema].
- *Trade-off I'd defend in an interview:* [pick one - e.g. the lack of
  optimistic locking, the polling-over-websockets choice, the flat-enum
  role model - and write a sentence on why you'd make that call again
  today, not just that you made it].
- *Changed from what the tool first proposed:* [if anything - e.g. an
  error message, a status code mapping, a default page size - note it
  here; if nothing changed, say so plainly rather than leaving this blank].

**Known limitation of this process:** the assistant's sandbox used during
initial development could not reach a live PostgreSQL instance or download
Prisma's engine binaries (restricted network egress), so the Prisma client
could not be generated or run there. During that phase, `tsc` typechecking
and the pure-logic state-machine unit tests were actually executed and
verified passing inside the sandbox, while the API integration suite was
only structurally verified (imports resolve, types check) rather than run.
Both suites have since been executed successfully end-to-end on my own
machine against a real Postgres database, closing that gap before this
submission.
