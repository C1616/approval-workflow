import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/prisma";
import bcrypt from "bcryptjs";

// These tests run against a real (test) Postgres database via Prisma -
// unlike state-machine.test.ts, this file exercises the full stack: real
// Express routes, real auth middleware, real Prisma queries, real
// transactions. Point DATABASE_URL at a disposable test database before
// running, e.g.:
//   DATABASE_URL="postgresql://postgres:postgres@localhost:5432/approval_workflow_test"
// then: npx prisma migrate deploy && npx jest tests/api.test.ts
//
// Each test file run starts from a clean slate (see beforeAll/afterAll
// below, which wipe every table) so tests can run in any order without
// interfering with each other, and so re-running this file twice in a
// row doesn't fail on "email already exists" type errors.

const app = createApp();

// Shared across every test below - populated once in the top-level
// beforeAll so individual tests don't each need to log in from scratch.
let applicantToken: string;
let applicant2Token: string;
let reviewerToken: string;

beforeAll(async () => {
  // Wipe tables in FK-safe order (children before parents: AuditLog and
  // Application both reference User, so they have to go first or the
  // delete would fail on a foreign-key constraint).
  await prisma.auditLog.deleteMany();
  await prisma.application.deleteMany();
  await prisma.user.deleteMany();

  const passwordHash = await bcrypt.hash("password123", 10);

  // Three seed users for this test run: two separate applicants (needed
  // specifically for the "different applicant can't touch my stuff"
  // tests later on) and one reviewer.
  const applicant = await prisma.user.create({
    data: { email: "test-applicant@example.com", name: "Test Applicant", role: "APPLICANT", passwordHash },
  });
  const applicant2 = await prisma.user.create({
    data: { email: "test-applicant2@example.com", name: "Test Applicant Two", role: "APPLICANT", passwordHash },
  });
  const reviewer = await prisma.user.create({
    data: { email: "test-reviewer@example.com", name: "Test Reviewer", role: "REVIEWER", passwordHash },
  });

  // Logs in as each seed user via the real HTTP login endpoint (not a
  // shortcut/mock) and grabs the JWT from the response body, so every
  // test below is authenticating exactly the way a real client would.
  const loginAs = async (email: string) => {
    const res = await request(app).post("/api/auth/login").send({ email, password: "password123" });
    return res.body.token as string;
  };

  applicantToken = await loginAs(applicant.email);
  applicant2Token = await loginAs(applicant2.email);
  reviewerToken = await loginAs(reviewer.email);
});

afterAll(async () => {
  // Clean up after the whole suite finishes, so the test database is
  // left empty rather than accumulating leftover rows from this run.
  await prisma.auditLog.deleteMany();
  await prisma.application.deleteMany();
  await prisma.user.deleteMany();
  await prisma.$disconnect();
});

// Small helper so every request below can just do .set(auth(token))
// instead of repeating the header object literal everywhere.
function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

// ─────────────────────────────────────────────────────────────────────────
// Basic login/session checks - these don't test the workflow itself, just
// that the auth plumbing (password checking, token issuing, the /me
// endpoint) behaves correctly before anything else is tested on top of it.
// ─────────────────────────────────────────────────────────────────────────
describe("Auth", () => {
  // Confirms a wrong password is rejected rather than, say, silently
  // logging in or throwing a 500.
  test("login with wrong password returns 401", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "test-applicant@example.com", password: "wrong" });
    expect(res.status).toBe(401);
  });

  // The positive case: correct credentials return both a token (used by
  // every other test in this file via the auth() helper) and the user's
  // role, which the frontend needs to decide which UI to show.
  test("login with valid credentials returns a token and user", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "test-applicant@example.com", password: "password123" });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.role).toBe("APPLICANT");
  });

  // No Authorization header at all should be rejected by the requireAuth
  // middleware before it even reaches the route handler.
  test("/api/auth/me without a token returns 401", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
  });

  // A valid token should let the caller fetch their own identity back -
  // this is what the frontend's AuthContext uses on page load to check
  // "is this saved token still good?".
  test("/api/auth/me with a valid token returns the user", async () => {
    const res = await request(app).get("/api/auth/me").set(auth(applicantToken));
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe("test-applicant@example.com");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// POST /api/applications - creating a new draft. These tests check both
// the Zod input validation (missing/invalid fields -> 400) and the role
// gate (only APPLICANT can create applications at all).
// ─────────────────────────────────────────────────────────────────────────
describe("Application creation & validation", () => {
  // The basic happy path: a well-formed request from an APPLICANT
  // creates a new application, and it starts life as DRAFT (never
  // anything else - there's no way to create an application directly
  // into SUBMITTED or any other status).
  test("APPLICANT can create a draft application", async () => {
    const res = await request(app)
      .post("/api/applications")
      .set(auth(applicantToken))
      .send({ title: "Test expense", category: "EXPENSE", description: "Lunch with client", amount: 45.5 });
    expect(res.status).toBe(201);
    expect(res.body.application.status).toBe("DRAFT");
  });

  // title is a required field per the Zod schema - omitting it should
  // be caught before anything touches the database.
  test("creating an application with a missing title returns 400", async () => {
    const res = await request(app)
      .post("/api/applications")
      .set(auth(applicantToken))
      .send({ category: "EXPENSE" });
    expect(res.status).toBe(400);
  });

  // category must be one of the fixed enum values - this confirms the
  // server rejects a category that isn't in that list, rather than
  // silently accepting arbitrary strings (which would also break the
  // Postgres enum constraint, but we want the friendlier 400 first).
  test("creating an application with an invalid category returns 400", async () => {
    const res = await request(app)
      .post("/api/applications")
      .set(auth(applicantToken))
      .send({ title: "Bad category test", category: "NOT_A_REAL_CATEGORY" });
    expect(res.status).toBe(400);
  });

  // Only APPLICANT-role users can create applications at all - a
  // REVIEWER sending an otherwise-perfectly-valid payload should still
  // be blocked by the role check (requireRole("APPLICANT") on the route),
  // independently of whether the body itself was valid.
  test("REVIEWER cannot create an application (role-gated)", async () => {
    const res = await request(app)
      .post("/api/applications")
      .set(auth(reviewerToken))
      .send({ title: "Should fail", category: "OTHER" });
    expect(res.status).toBe(403);
  });

  // No Authorization header at all - should be stopped by requireAuth
  // before it even reaches the role check or validation.
  test("creating without auth returns 401", async () => {
    const res = await request(app).post("/api/applications").send({ title: "x", category: "OTHER" });
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// The full lifecycle of a single application, end to end, through every
// status in order: DRAFT -> SUBMITTED -> UNDER_REVIEW -> APPROVED. Tests
// within this describe block share `appId` and run in sequence (Jest runs
// tests within a describe block in file order by default), so each test
// builds on the state left behind by the previous one - this is
// intentional here, mirroring how a real application actually moves
// through the workflow over time rather than testing each transition in
// total isolation.
// ─────────────────────────────────────────────────────────────────────────
describe("Full workflow happy path", () => {
  let appId: string;

  // Step 1: create the draft and capture its id for every subsequent
  // test in this block to reuse.
  test("applicant creates a draft", async () => {
    const res = await request(app)
      .post("/api/applications")
      .set(auth(applicantToken))
      .send({ title: "Workflow happy path", category: "EQUIPMENT", amount: 200 });
    expect(res.status).toBe(201);
    appId = res.body.application.id;
  });

  // Step 2: confirm a DRAFT can still be edited by its owner - this is
  // the editable window the brief describes ("Only the owner can
  // edit/submit a DRAFT").
  test("applicant can edit their own draft", async () => {
    const res = await request(app)
      .patch(`/api/applications/${appId}`)
      .set(auth(applicantToken))
      .send({ title: "Workflow happy path (edited)" });
    expect(res.status).toBe(200);
    expect(res.body.application.title).toBe("Workflow happy path (edited)");
  });

  // Step 3: the applicant submits - status should move from DRAFT to
  // SUBMITTED, and a corresponding audit log row should exist (checked
  // later in this block once there are enough transitions to inspect).
  test("applicant submits the draft -> SUBMITTED", async () => {
    const res = await request(app).post(`/api/applications/${appId}/submit`).set(auth(applicantToken));
    expect(res.status).toBe(200);
    expect(res.body.application.status).toBe("SUBMITTED");
  });

  // Step 4: now that it's left DRAFT, the brief's rule "an applicant
  // cannot edit an application once it has left DRAFT" should kick in -
  // the same PATCH that worked in step 2 should now be rejected with a
  // 409 (illegal because of current status, not because of role/ownership).
  test("applicant can no longer edit once submitted", async () => {
    const res = await request(app)
      .patch(`/api/applications/${appId}`)
      .set(auth(applicantToken))
      .send({ title: "Should not work" });
    expect(res.status).toBe(409);
  });

  // Step 5: a reviewer picks it up - SUBMITTED -> UNDER_REVIEW.
  test("reviewer starts review -> UNDER_REVIEW", async () => {
    const res = await request(app).post(`/api/applications/${appId}/start-review`).set(auth(reviewerToken));
    expect(res.status).toBe(200);
    expect(res.body.application.status).toBe("UNDER_REVIEW");
  });

  // Step 6: the reviewer approves it - UNDER_REVIEW -> APPROVED, the
  // final state for this particular application's journey through the
  // happy path.
  test("reviewer approves -> APPROVED", async () => {
    const res = await request(app).post(`/api/applications/${appId}/approve`).set(auth(reviewerToken));
    expect(res.status).toBe(200);
    expect(res.body.application.status).toBe("APPROVED");
  });

  // Now that three real transitions have happened (submit, start-review,
  // approve), fetch the application's detail view and confirm the audit
  // trail recorded all three, in order, with the correct from/to statuses,
  // and that every single entry has both an actor and a timestamp
  // attached (the brief's audit log requirement: "who, old -> new
  // status, comment, timestamp").
  test("audit log records every transition with actor and timestamps", async () => {
    const res = await request(app).get(`/api/applications/${appId}`).set(auth(reviewerToken));
    expect(res.status).toBe(200);
    const logs = res.body.application.auditLogs;
    expect(logs.length).toBe(3); // submit, start-review, approve
    expect(logs[0].fromStatus).toBe("DRAFT");
    expect(logs[0].toStatus).toBe("SUBMITTED");
    expect(logs[2].toStatus).toBe("APPROVED");
    expect(logs.every((l: any) => l.actor && l.createdAt)).toBe(true);
  });

  // Final check for this block: APPROVED is terminal, so trying to
  // approve it again should fail - this is the API-level (not just
  // unit-level) proof that illegal transitions return 409, exercised
  // against a real application that's actually sitting in that state in
  // the database, not just a hand-built context object like in
  // state-machine.test.ts.
  test("cannot approve an already-approved application (illegal transition -> 409)", async () => {
    const res = await request(app).post(`/api/applications/${appId}/approve`).set(auth(reviewerToken));
    expect(res.status).toBe(409);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// The brief's explicit rule: "reject and return for changes require a
// comment". This block (and the next one) each set up their own fresh
// application via a local beforeAll, already fast-forwarded to
// UNDER_REVIEW, so the actual tests only need to exercise the one
// transition they care about.
// ─────────────────────────────────────────────────────────────────────────
describe("Reject / return-for-changes require a comment", () => {
  let appId: string;

  // Fast-forward a fresh application to UNDER_REVIEW before any test in
  // this block runs, so each test below starts from the same known state
  // rather than repeating this setup three times.
  beforeAll(async () => {
    const create = await request(app)
      .post("/api/applications")
      .set(auth(applicantToken))
      .send({ title: "To be rejected", category: "OTHER" });
    appId = create.body.application.id;
    await request(app).post(`/api/applications/${appId}/submit`).set(auth(applicantToken));
    await request(app).post(`/api/applications/${appId}/start-review`).set(auth(reviewerToken));
  });

  // Sending an empty body (no comment field at all) to /reject should be
  // rejected with 400 - this is the API-level version of the unit test
  // "REJECT without a comment throws CommentRequiredError".
  test("reject without a comment returns 400", async () => {
    const res = await request(app).post(`/api/applications/${appId}/reject`).set(auth(reviewerToken)).send({});
    expect(res.status).toBe(400);
  });

  // Supplying a real comment should let the rejection go through and
  // land the application in the REJECTED terminal state.
  test("reject with a comment succeeds -> REJECTED", async () => {
    const res = await request(app)
      .post(`/api/applications/${appId}/reject`)
      .set(auth(reviewerToken))
      .send({ comment: "Insufficient justification provided." });
    expect(res.status).toBe(200);
    expect(res.body.application.status).toBe("REJECTED");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// This block covers the "revision round-trip" stretch goal mentioned in
// the brief: send something back to DRAFT, let the applicant fix it, and
// re-submit. Each test depends on the previous one's outcome, same as
// the "Full workflow happy path" block above.
// ─────────────────────────────────────────────────────────────────────────
describe("Return for changes round-trip", () => {
  let appId: string;

  beforeAll(async () => {
    const create = await request(app)
      .post("/api/applications")
      .set(auth(applicantToken))
      .send({ title: "Needs revision", category: "TRAVEL" });
    appId = create.body.application.id;
    await request(app).post(`/api/applications/${appId}/submit`).set(auth(applicantToken));
    await request(app).post(`/api/applications/${appId}/start-review`).set(auth(reviewerToken));
  });

  // Same comment-requirement check as the REJECT case above, but for the
  // RETURN_FOR_CHANGES action specifically - confirms the requirement
  // isn't accidentally only wired up for reject.
  test("return for changes without a comment returns 400", async () => {
    const res = await request(app).post(`/api/applications/${appId}/return`).set(auth(reviewerToken)).send({});
    expect(res.status).toBe(400);
  });

  // With a comment supplied, the application should move back to DRAFT
  // rather than to a terminal state - this is what makes it "returned
  // for changes" rather than "rejected".
  test("return for changes with a comment sends it back to DRAFT", async () => {
    const res = await request(app)
      .post(`/api/applications/${appId}/return`)
      .set(auth(reviewerToken))
      .send({ comment: "Please attach a receipt." });
    expect(res.status).toBe(200);
    expect(res.body.application.status).toBe("DRAFT");
  });

  // Now that it's back in DRAFT, the applicant should be able to edit it
  // again - proving the "no longer editable" rule from the happy-path
  // block is specifically tied to status, and reverses itself once the
  // status reverses.
  test("applicant can edit again after it's back in DRAFT", async () => {
    const res = await request(app)
      .patch(`/api/applications/${appId}`)
      .set(auth(applicantToken))
      .send({ description: "Receipt attached as requested." });
    expect(res.status).toBe(200);
  });

  // Finally, after revising, the applicant should be able to re-submit
  // it - completing the full round-trip back through SUBMITTED, proving
  // the cycle can repeat rather than being a one-shot path.
  test("applicant can re-submit after revising", async () => {
    const res = await request(app).post(`/api/applications/${appId}/submit`).set(auth(applicantToken));
    expect(res.status).toBe(200);
    expect(res.body.application.status).toBe("SUBMITTED");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// This is the API-level (full HTTP stack, real database) proof of the
// brief's single most emphasized security requirement: "an applicant
// must not be able to approve their own application even by calling the
// API directly". Everything in state-machine.test.ts proves the pure
// logic rejects this; this block proves the same thing is actually true
// when a real HTTP request hits a real route on a real application row.
// ─────────────────────────────────────────────────────────────────────────
describe("Authorization: the critical 'cannot approve your own application' rule", () => {
  let appId: string;

  beforeAll(async () => {
    const create = await request(app)
      .post("/api/applications")
      .set(auth(applicantToken))
      .send({ title: "Self-approval attempt", category: "EXPENSE" });
    appId = create.body.application.id;
    await request(app).post(`/api/applications/${appId}/submit`).set(auth(applicantToken));
    await request(app).post(`/api/applications/${appId}/start-review`).set(auth(reviewerToken));
  });

  // The headline test: the same applicantToken that created and
  // submitted this application is used to try approving it directly via
  // the API (not through any UI button that might have hidden the
  // option) - this must come back 403, proving the server enforces this
  // independently of whatever the frontend chooses to show or hide.
  test("the owning APPLICANT cannot approve their own application via the API, even directly", async () => {
    const res = await request(app).post(`/api/applications/${appId}/approve`).set(auth(applicantToken));
    expect(res.status).toBe(403);
  });

  // Same idea, but for reject - confirms the block applies to every
  // reviewer-only action, not just approve.
  test("the owning APPLICANT cannot reject their own application via the API", async () => {
    const res = await request(app)
      .post(`/api/applications/${appId}/reject`)
      .set(auth(applicantToken))
      .send({ comment: "trying to self-reject" });
    expect(res.status).toBe(403);
  });

  // A related but distinct authorization rule: applicant2 (a completely
  // different APPLICANT account) tries to submit a draft that belongs to
  // applicant (the first one). Same role, wrong owner - should be 403.
  // This is the API-level version of the unit test "an APPLICANT who is
  // NOT the owner cannot SUBMIT another user's draft".
  test("a DIFFERENT applicant cannot submit someone else's draft", async () => {
    const create = await request(app)
      .post("/api/applications")
      .set(auth(applicantToken))
      .send({ title: "Owned by applicant 1", category: "OTHER" });
    const otherAppId = create.body.application.id;

    const res = await request(app).post(`/api/applications/${otherAppId}/submit`).set(auth(applicant2Token));
    expect(res.status).toBe(403);
  });

  // Same cross-ownership idea, but against the PATCH (edit) route rather
  // than a state transition - confirms ownership is checked on edits
  // too, not just on submit/approve/reject.
  test("a DIFFERENT applicant cannot edit someone else's draft", async () => {
    const create = await request(app)
      .post("/api/applications")
      .set(auth(applicantToken))
      .send({ title: "Owned by applicant 1 again", category: "OTHER" });
    const otherAppId = create.body.application.id;

    const res = await request(app)
      .patch(`/api/applications/${otherAppId}`)
      .set(auth(applicant2Token))
      .send({ title: "hijacked" });
    expect(res.status).toBe(403);
  });

  // Confirms the role gate also applies to read endpoints, not just
  // mutations - an APPLICANT has no legitimate reason to see the
  // reviewer's queue, so this should 403 rather than e.g. silently
  // returning an empty list (which could leak the existence of the
  // endpoint without leaking data, but 403 is the clearer signal).
  test("APPLICANT cannot access the reviewer queue endpoint", async () => {
    const res = await request(app).get("/api/applications/queue").set(auth(applicantToken));
    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Confirms the API returns a proper 404 (not a 500, not a 200 with null
// data, not a 403) when asked about an application id that simply
// doesn't exist - covers both a plain read and an attempted transition.
// ─────────────────────────────────────────────────────────────────────────
describe("Not-found handling", () => {
  // A GET for a random, never-created UUID should 404 cleanly.
  test("getting a non-existent application returns 404", async () => {
    const res = await request(app)
      .get("/api/applications/00000000-0000-0000-0000-000000000000")
      .set(auth(reviewerToken));
    expect(res.status).toBe(404);
  });

  // Same idea, but for a transition endpoint - performTransition's first
  // step is to load the application, and this confirms that lookup
  // failure is surfaced as 404 rather than, say, a confusing 409 about
  // an "illegal transition" on something that was never there to begin
  // with.
  test("transitioning a non-existent application returns 404", async () => {
    const res = await request(app)
      .post("/api/applications/00000000-0000-0000-0000-000000000000/approve")
      .set(auth(reviewerToken));
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// GET /api/applications/queue - the reviewer's main worklist. Covers the
// default status filter, explicit status filtering, and (added when the
// "queue power-up" stretch goal was implemented) pagination and search.
// ─────────────────────────────────────────────────────────────────────────
describe("Reviewer queue", () => {
  // With no ?status= param at all, the queue should default to showing
  // only SUBMITTED and UNDER_REVIEW items - the things actually awaiting
  // reviewer attention - rather than everything ever created.
  test("queue defaults to SUBMITTED + UNDER_REVIEW applications", async () => {
    const res = await request(app).get("/api/applications/queue").set(auth(reviewerToken));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.applications)).toBe(true);
    for (const a of res.body.applications) {
      expect(["SUBMITTED", "UNDER_REVIEW"]).toContain(a.status);
    }
  });

  // Explicitly asking for ?status=SUBMITTED should narrow the results to
  // only that one status, not the default pair.
  test("queue can be filtered by an explicit status", async () => {
    const res = await request(app).get("/api/applications/queue?status=SUBMITTED").set(auth(reviewerToken));
    expect(res.status).toBe(200);
    for (const a of res.body.applications) {
      expect(a.status).toBe("SUBMITTED");
    }
  });

  // Confirms the response shape includes everything the frontend's
  // pagination controls need: the array itself capped at pageSize, plus
  // total/page/pageSize as separate fields (total is the full count
  // across all pages, not just this page's array length).
  test("queue response includes total/page/pageSize for pagination", async () => {
    const res = await request(app).get("/api/applications/queue?page=1&pageSize=2").set(auth(reviewerToken));
    expect(res.status).toBe(200);
    expect(res.body.applications.length).toBeLessThanOrEqual(2);
    expect(typeof res.body.total).toBe("number");
    expect(res.body.page).toBe(1);
    expect(res.body.pageSize).toBe(2);
  });

  // The real correctness check for pagination: fetching page 1 and page
  // 2 (each capped at 2 items) should return completely disjoint sets of
  // application ids. If this failed, it would mean the skip/take offset
  // math in the queue route is wrong and pages are overlapping or
  // repeating items.
  test("queue pagination returns different items on page 2 than page 1", async () => {
    const page1 = await request(app).get("/api/applications/queue?page=1&pageSize=2").set(auth(reviewerToken));
    const page2 = await request(app).get("/api/applications/queue?page=2&pageSize=2").set(auth(reviewerToken));
    const ids1 = page1.body.applications.map((a: any) => a.id);
    const ids2 = page2.body.applications.map((a: any) => a.id);
    const overlap = ids1.filter((id: string) => ids2.includes(id));
    expect(overlap.length).toBe(0);
  });

  // Creates an application with a deliberately distinctive title, submits
  // it so it actually lands in the queue, then searches for a fragment of
  // that title in a different case ("searchable unique" vs "Searchable
  // Unique") to confirm the search is both functional and
  // case-insensitive, matching what a reviewer would expect when typing
  // a quick lowercase guess at a title.
  test("queue search filters by title (case-insensitive)", async () => {
    await request(app)
      .post("/api/applications")
      .set(auth(applicantToken))
      .send({ title: "Searchable Unique Title XYZ", category: "OTHER" })
      .then((create) => request(app).post(`/api/applications/${create.body.application.id}/submit`).set(auth(applicantToken)));

    const res = await request(app).get("/api/applications/queue?search=searchable unique").set(auth(reviewerToken));
    expect(res.status).toBe(200);
    expect(res.body.applications.length).toBeGreaterThan(0);
    expect(res.body.applications.every((a: any) => a.title.toLowerCase().includes("searchable"))).toBe(true);
  });

  // A search term that can't possibly match anything real (a long,
  // deliberately nonsensical string) should come back as a normal 200
  // with an empty array - not a 404, not a 500. This matters because a
  // naive implementation might treat "no results" as an error case by
  // mistake.
  test("queue search with no matches returns an empty list, not an error", async () => {
    const res = await request(app)
      .get("/api/applications/queue?search=zzz_no_such_application_zzz")
      .set(auth(reviewerToken));
    expect(res.status).toBe(200);
    expect(res.body.applications).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// The in-app notification system: created server-side inside the same
// transaction as each status transition (see application-service.ts),
// never created directly by a client request. This block proves both
// the "who gets notified for which action" rules and the
// read/mark-as-read authorization around them.
// ─────────────────────────────────────────────────────────────────────────
describe("Notifications", () => {
  let appId: string;

  // Submitting an application should notify every REVIEWER (there's
  // exactly one in this test's seed data, reviewerToken's user) - this
  // checks the unread count goes up by exactly one and that the newest
  // notification's message text mentions "submitted", confirming both
  // the recipient and the message content are correct for this action.
  test("submitting an application notifies every reviewer", async () => {
    const create = await request(app)
      .post("/api/applications")
      .set(auth(applicantToken))
      .send({ title: "Notification test - submit", category: "OTHER" });
    appId = create.body.application.id;

    const beforeRes = await request(app).get("/api/notifications").set(auth(reviewerToken));
    const beforeCount = beforeRes.body.unreadCount;

    await request(app).post(`/api/applications/${appId}/submit`).set(auth(applicantToken));

    const afterRes = await request(app).get("/api/notifications").set(auth(reviewerToken));
    expect(afterRes.body.unreadCount).toBe(beforeCount + 1);
    expect(afterRes.body.notifications[0].message).toMatch(/submitted/i);
  });

  // The mirror case: when the reviewer approves, it's the ORIGINAL
  // APPLICANT (not the reviewer) who should get notified - this confirms
  // notifications flow in both directions depending on the action,
  // rather than always notifying the same party.
  test("approving an application notifies the applicant", async () => {
    await request(app).post(`/api/applications/${appId}/start-review`).set(auth(reviewerToken));

    const beforeRes = await request(app).get("/api/notifications").set(auth(applicantToken));
    const beforeCount = beforeRes.body.unreadCount;

    await request(app).post(`/api/applications/${appId}/approve`).set(auth(reviewerToken));

    const afterRes = await request(app).get("/api/notifications").set(auth(applicantToken));
    expect(afterRes.body.unreadCount).toBe(beforeCount + 1);
    expect(afterRes.body.notifications[0].message).toMatch(/approved/i);
  });

  // Authorization check on the notifications themselves: the reviewer
  // grabs the applicant's own notification id (by listing as the
  // applicant first) and then tries to mark THAT notification as read
  // while authenticated as the reviewer - this must be blocked with 403,
  // since notifications are private to whoever they were created for.
  test("a user cannot mark another user's notification as read", async () => {
    const list = await request(app).get("/api/notifications").set(auth(applicantToken));
    const notificationId = list.body.notifications[0].id;

    const res = await request(app).post(`/api/notifications/${notificationId}/read`).set(auth(reviewerToken));
    expect(res.status).toBe(403);
  });

  // The positive case for the same endpoint: the actual owner of that
  // notification marking it as read should succeed, and the returned
  // notification object should reflect isRead: true.
  test("marking a notification as read works for its owner", async () => {
    const list = await request(app).get("/api/notifications").set(auth(applicantToken));
    const notificationId = list.body.notifications[0].id;

    const res = await request(app).post(`/api/notifications/${notificationId}/read`).set(auth(applicantToken));
    expect(res.status).toBe(200);
    expect(res.body.notification.isRead).toBe(true);
  });

  // The "mark all as read" bulk action should zero out the unread count
  // entirely for that user, confirmed by a follow-up call to the
  // dedicated unread-count endpoint.
  test("mark-all-read zeroes out the unread count", async () => {
    await request(app).post("/api/notifications/read-all").set(auth(applicantToken));
    const res = await request(app).get("/api/notifications/unread-count").set(auth(applicantToken));
    expect(res.status).toBe(200);
    expect(res.body.unreadCount).toBe(0);
  });

  // Baseline auth check: like every other route in this app, the
  // notifications endpoints should refuse an unauthenticated request
  // with 401 rather than, say, returning an empty list as if there were
  // simply no notifications.
  test("notifications endpoints require authentication", async () => {
    const res = await request(app).get("/api/notifications");
    expect(res.status).toBe(401);
  });
});
