import {
  assertTransition,
  canTransition,
  isEditable,
  IllegalTransitionError,
  ForbiddenTransitionError,
  CommentRequiredError,
  TransitionContext,
} from "../src/services/state-machine";

// Helper that builds a full TransitionContext from just the fields a
// given test cares about, defaulting everything else to a baseline
// "legal" scenario (an owning APPLICANT submitting their own DRAFT).
// This keeps every test below short - each one only specifies the
// handful of fields it's actually testing, via `overrides`.
function ctx(overrides: Partial<TransitionContext>): TransitionContext {
  return {
    currentStatus: "DRAFT",
    action: "SUBMIT",
    actorRole: "APPLICANT",
    actorIsOwner: true,
    comment: undefined,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Every transition the brief's state diagram actually allows. Each test
// here checks the "happy path": correct role, correct ownership (where
// required), correct comment (where required) -> the transition should
// succeed and return the expected next status.
// ─────────────────────────────────────────────────────────────────────────
describe("state machine — legal transitions", () => {
  // The very first step in the whole workflow: an applicant moves their
  // own draft into the review queue. This is the only transition where
  // ownership is checked (see "ownership enforcement" below) - every
  // other transition belongs to a reviewer, not the original owner.
  test("APPLICANT owner can SUBMIT a DRAFT -> SUBMITTED", () => {
    const result = assertTransition(
      ctx({ currentStatus: "DRAFT", action: "SUBMIT", actorRole: "APPLICANT", actorIsOwner: true })
    );
    expect(result).toBe("SUBMITTED");
  });

  // A reviewer picks up a submitted item and begins looking at it. Note
  // actorIsOwner is false here and throughout the rest of this describe
  // block - reviewer actions never require/check ownership, since a
  // reviewer reviewing their own submission isn't even a concept the
  // state machine allows (APPLICANT and REVIEWER are mutually exclusive
  // roles per user in this app).
  test("REVIEWER can START_REVIEW a SUBMITTED -> UNDER_REVIEW", () => {
    const result = assertTransition(
      ctx({ currentStatus: "SUBMITTED", action: "START_REVIEW", actorRole: "REVIEWER", actorIsOwner: false })
    );
    expect(result).toBe("UNDER_REVIEW");
  });

  // Approval is the only "positive" terminal transition, and critically
  // it does NOT require a comment (unlike reject/return below) - no
  // `comment` field is passed in ctx() here, relying on the default
  // `undefined` from the helper, and the transition still succeeds.
  test("REVIEWER can APPROVE an UNDER_REVIEW -> APPROVED, no comment needed", () => {
    const result = assertTransition(
      ctx({ currentStatus: "UNDER_REVIEW", action: "APPROVE", actorRole: "REVIEWER", actorIsOwner: false })
    );
    expect(result).toBe("APPROVED");
  });

  // Rejection IS one of the two transitions that require a non-empty
  // comment (see CommentRequiredError tests further down for the
  // negative case). This test supplies one, so it should succeed.
  test("REVIEWER can REJECT an UNDER_REVIEW -> REJECTED, with a comment", () => {
    const result = assertTransition(
      ctx({
        currentStatus: "UNDER_REVIEW",
        action: "REJECT",
        actorRole: "REVIEWER",
        actorIsOwner: false,
        comment: "Missing required documentation.",
      })
    );
    expect(result).toBe("REJECTED");
  });

  // The "send it back for revisions" path. Like REJECT, this requires a
  // comment - but unlike REJECT, the destination status is DRAFT, not a
  // terminal state, which is what lets the applicant edit and re-submit
  // (covered by the "Return for changes round-trip" describe block in
  // tests/api.test.ts).
  test("REVIEWER can RETURN_FOR_CHANGES an UNDER_REVIEW -> DRAFT, with a comment", () => {
    const result = assertTransition(
      ctx({
        currentStatus: "UNDER_REVIEW",
        action: "RETURN_FOR_CHANGES",
        actorRole: "REVIEWER",
        actorIsOwner: false,
        comment: "Please clarify the amount requested.",
      })
    );
    expect(result).toBe("DRAFT");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// "Illegal" here means: no rule in the TRANSITIONS table matches this
// (currentStatus, action) pair at all - it's not about who's asking, it's
// that the move itself doesn't exist in the state diagram. These should
// all throw IllegalTransitionError specifically (not ForbiddenTransitionError
// or anything else), which is what lets the API layer map this case to a
// 409 Conflict rather than 403 Forbidden - the distinction matters because
// a 409 says "this state doesn't support that action right now" while a
// 403 says "you personally aren't allowed to do that".
// ─────────────────────────────────────────────────────────────────────────
describe("state machine — illegal transitions (no matching rule)", () => {
  // You can't approve something that was never submitted for review -
  // there's no rule with from: "DRAFT", action: "APPROVE" at all.
  test("cannot APPROVE directly from DRAFT", () => {
    expect(() =>
      assertTransition(ctx({ currentStatus: "DRAFT", action: "APPROVE", actorRole: "REVIEWER", actorIsOwner: false }))
    ).toThrow(IllegalTransitionError);
  });

  // Submitting is a one-way door from DRAFT only - once it's already
  // SUBMITTED, trying to submit it again has no matching rule (the only
  // way back to DRAFT is via RETURN_FOR_CHANGES, a reviewer's action).
  test("cannot SUBMIT from SUBMITTED (already submitted)", () => {
    expect(() =>
      assertTransition(ctx({ currentStatus: "SUBMITTED", action: "SUBMIT", actorRole: "APPLICANT", actorIsOwner: true }))
    ).toThrow(IllegalTransitionError);
  });

  // Reviewing can only start once something has actually been submitted -
  // there's no rule for starting a review on a DRAFT that's still sitting
  // with its owner.
  test("cannot START_REVIEW from DRAFT", () => {
    expect(() =>
      assertTransition(ctx({ currentStatus: "DRAFT", action: "START_REVIEW", actorRole: "REVIEWER", actorIsOwner: false }))
    ).toThrow(IllegalTransitionError);
  });

  // APPROVED is a terminal state in this state machine - nothing can
  // move out of it, including rejecting it after the fact. This is the
  // unit-level counterpart of the API test
  // "cannot approve an already-approved application (illegal transition -> 409)".
  test("cannot REJECT an already-APPROVED application", () => {
    expect(() =>
      assertTransition(ctx({ currentStatus: "APPROVED", action: "REJECT", actorRole: "REVIEWER", actorIsOwner: false, comment: "x" }))
    ).toThrow(IllegalTransitionError);
  });

  // REJECTED is the other terminal state - once rejected, there is no
  // rule that lets it move anywhere else, including back to DRAFT via
  // re-submission. A rejected application is simply done.
  test("cannot transition out of a terminal REJECTED state", () => {
    expect(() =>
      assertTransition(ctx({ currentStatus: "REJECTED", action: "SUBMIT", actorRole: "APPLICANT", actorIsOwner: true }))
    ).toThrow(IllegalTransitionError);
  });

  // RETURN_FOR_CHANGES only has a rule starting from UNDER_REVIEW, not
  // from SUBMITTED - a reviewer has to formally start the review first
  // before they can send it back. This guards against skipping that step.
  test("cannot RETURN_FOR_CHANGES from SUBMITTED (must be UNDER_REVIEW first)", () => {
    expect(() =>
      assertTransition(
        ctx({ currentStatus: "SUBMITTED", action: "RETURN_FOR_CHANGES", actorRole: "REVIEWER", actorIsOwner: false, comment: "x" })
      )
    ).toThrow(IllegalTransitionError);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// "Forbidden" is different from "illegal" above: here, a rule DOES exist
// for the (currentStatus, action) pair - the move is structurally valid -
// but the actor's role doesn't match what that rule requires. These map
// to HTTP 403 at the API layer. This is the block that most directly
// proves the brief's core security requirement: "an applicant must not be
// able to approve their own application even by calling the API directly".
// ─────────────────────────────────────────────────────────────────────────
describe("state machine — role enforcement (403-mapped)", () => {
  // APPROVE from UNDER_REVIEW is a real, legal transition (see the legal
  // transitions block above) - just not for an APPLICANT. Only the role
  // check is wrong here, which is exactly what distinguishes this from
  // an IllegalTransitionError case.
  test("APPLICANT cannot APPROVE (even structurally valid status)", () => {
    expect(() =>
      assertTransition(ctx({ currentStatus: "UNDER_REVIEW", action: "APPROVE", actorRole: "APPLICANT", actorIsOwner: false }))
    ).toThrow(ForbiddenTransitionError);
  });

  // This is the single most important test in the whole suite, directly
  // lifted from the brief's explicit requirement. Note actorIsOwner is
  // set to true here deliberately - this proves that even being the
  // application's own owner does NOT grant permission to reject (or
  // approve) it. Role enforcement applies regardless of ownership.
  test("APPLICANT cannot REJECT their own application", () => {
    expect(() =>
      assertTransition(
        ctx({ currentStatus: "UNDER_REVIEW", action: "REJECT", actorRole: "APPLICANT", actorIsOwner: true, comment: "x" })
      )
    ).toThrow(ForbiddenTransitionError);
  });

  // SUBMIT from DRAFT is a legal transition - but only for the role the
  // rule names (APPLICANT). A reviewer has no business submitting
  // someone else's draft on their behalf.
  test("REVIEWER cannot SUBMIT a draft (not their action to perform)", () => {
    expect(() =>
      assertTransition(ctx({ currentStatus: "DRAFT", action: "SUBMIT", actorRole: "REVIEWER", actorIsOwner: false }))
    ).toThrow(ForbiddenTransitionError);
  });

  // Mirror image of the previous test: START_REVIEW from SUBMITTED is a
  // real rule, but it belongs to REVIEWER, not APPLICANT. Confirms the
  // role check is enforced symmetrically in both directions of the
  // workflow, not just on the "approve/reject" end.
  test("REVIEWER cannot START_REVIEW if somehow flagged as non-reviewer role string", () => {
    expect(() =>
      assertTransition(ctx({ currentStatus: "SUBMITTED", action: "START_REVIEW", actorRole: "APPLICANT", actorIsOwner: false }))
    ).toThrow(ForbiddenTransitionError);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// SUBMIT is the one transition in this app that also requires ownership,
// on top of the role check above. An APPLICANT role alone isn't enough -
// it has to be THIS applicant's own draft. This block isolates that
// specific extra check from the plain role check tested above.
// ─────────────────────────────────────────────────────────────────────────
describe("state machine — ownership enforcement", () => {
  // Role is correct (APPLICANT) and the transition itself is legal
  // (DRAFT -> SUBMITTED exists as a rule) - the only thing wrong is
  // actorIsOwner: false. This is what stops one applicant from
  // submitting a draft that belongs to a different applicant, which is
  // also covered end-to-end at the API layer in
  // "a DIFFERENT applicant cannot submit someone else's draft".
  test("an APPLICANT who is NOT the owner cannot SUBMIT another user's draft", () => {
    expect(() =>
      assertTransition(ctx({ currentStatus: "DRAFT", action: "SUBMIT", actorRole: "APPLICANT", actorIsOwner: false }))
    ).toThrow(ForbiddenTransitionError);
  });

  // The positive control for the test above: same role, same transition,
  // but actorIsOwner: true this time - it should succeed. Having both
  // the failing and succeeding case side by side proves the ownership
  // flag is the only thing that changed the outcome.
  test("the owning APPLICANT can SUBMIT their own draft", () => {
    expect(
      assertTransition(ctx({ currentStatus: "DRAFT", action: "SUBMIT", actorRole: "APPLICANT", actorIsOwner: true }))
    ).toBe("SUBMITTED");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// The brief explicitly states: "reject and return for changes require a
// comment". This block proves that rule is enforced precisely - not just
// "some" comment-requiring logic, but specifically REJECT and
// RETURN_FOR_CHANGES, and specifically that empty-string/whitespace-only
// comments don't count as having provided one.
// ─────────────────────────────────────────────────────────────────────────
describe("state machine — comment requirements", () => {
  // An empty string is technically a defined value, not undefined/null -
  // this confirms the check is "is there meaningful content here", not
  // just "was a comment field present at all".
  test("REJECT without a comment throws CommentRequiredError", () => {
    expect(() =>
      assertTransition(
        ctx({ currentStatus: "UNDER_REVIEW", action: "REJECT", actorRole: "REVIEWER", actorIsOwner: false, comment: "" })
      )
    ).toThrow(CommentRequiredError);
  });

  // A step further than the empty-string case above: a comment that's
  // present but entirely whitespace should be treated the same as no
  // comment at all (the state machine trims it internally before
  // checking). Guards against someone satisfying the API's "field is
  // present" check with a few spacebar presses.
  test("REJECT with only whitespace as a comment throws CommentRequiredError", () => {
    expect(() =>
      assertTransition(
        ctx({ currentStatus: "UNDER_REVIEW", action: "REJECT", actorRole: "REVIEWER", actorIsOwner: false, comment: "   " })
      )
    ).toThrow(CommentRequiredError);
  });

  // Confirms the comment requirement isn't unique to REJECT - the brief
  // names both REJECT and RETURN_FOR_CHANGES, and this is the second of
  // the two transitions getting the same scrutiny.
  test("RETURN_FOR_CHANGES without a comment throws CommentRequiredError", () => {
    expect(() =>
      assertTransition(
        ctx({ currentStatus: "UNDER_REVIEW", action: "RETURN_FOR_CHANGES", actorRole: "REVIEWER", actorIsOwner: false, comment: undefined })
      )
    ).toThrow(CommentRequiredError);
  });

  // The negative-space proof: APPROVE is NOT in the comment-required
  // list, so omitting a comment here should succeed rather than throw -
  // this is what stops a future bug where someone makes ALL transitions
  // require a comment by mistake.
  test("APPROVE does NOT require a comment", () => {
    expect(
      assertTransition(
        ctx({ currentStatus: "UNDER_REVIEW", action: "APPROVE", actorRole: "REVIEWER", actorIsOwner: false, comment: undefined })
      )
    ).toBe("APPROVED");
  });

  // Same idea as above but for SUBMIT - the brief never asks for a
  // comment when an applicant submits their own draft, so this confirms
  // that's still true and the rule table reflects it correctly.
  test("SUBMIT does NOT require a comment", () => {
    expect(
      assertTransition(ctx({ currentStatus: "DRAFT", action: "SUBMIT", actorRole: "APPLICANT", actorIsOwner: true, comment: undefined }))
    ).toBe("SUBMITTED");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// canTransition() is the non-throwing sibling of assertTransition() -
// same rules, but it swallows whichever error gets thrown and just
// returns true/false. It exists for callers (typically UI code) that
// want to ask "would this be allowed?" without needing to wrap a
// try/catch around every check - e.g. to decide whether to show or grey
// out a button. This block doesn't re-test every rule from scratch; it
// just spot-checks one example of each outcome category (legal,
// illegal, forbidden, missing comment) to confirm the wrapper correctly
// converts a throw into `false` and a success into `true` in each case.
// ─────────────────────────────────────────────────────────────────────────
describe("canTransition — non-throwing boolean wrapper", () => {
  test("returns true for a legal transition", () => {
    expect(canTransition(ctx({ currentStatus: "DRAFT", action: "SUBMIT", actorRole: "APPLICANT", actorIsOwner: true }))).toBe(true);
  });

  // Underlying cause would be an IllegalTransitionError if this called
  // assertTransition directly - canTransition just reports false instead.
  test("returns false for an illegal transition", () => {
    expect(canTransition(ctx({ currentStatus: "APPROVED", action: "SUBMIT", actorRole: "APPLICANT", actorIsOwner: true }))).toBe(false);
  });

  // Underlying cause would be a ForbiddenTransitionError (wrong role).
  test("returns false for a forbidden transition", () => {
    expect(canTransition(ctx({ currentStatus: "UNDER_REVIEW", action: "APPROVE", actorRole: "APPLICANT", actorIsOwner: false }))).toBe(
      false
    );
  });

  // Underlying cause would be a CommentRequiredError.
  test("returns false when a required comment is missing", () => {
    expect(
      canTransition(ctx({ currentStatus: "UNDER_REVIEW", action: "REJECT", actorRole: "REVIEWER", actorIsOwner: false, comment: "" }))
    ).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// isEditable() is a small, separate helper (not part of the transition
// table) used by the PATCH /applications/:id route to decide whether an
// application can still be modified. The rule is simple - only DRAFT is
// editable - but it's worth testing explicitly and exhaustively across
// every other status, since "can I edit this" is a distinct question
// from "can I transition this", and a bug here would let someone edit an
// application after it's already been submitted/decided.
// ─────────────────────────────────────────────────────────────────────────
describe("isEditable", () => {
  test("DRAFT is editable", () => {
    expect(isEditable("DRAFT")).toBe(true);
  });

  // test.each runs the same assertion once per entry in the array below,
  // generating four separate test results (one per status) rather than
  // one test that loops internally - so if, say, only APPROVED regresses,
  // the test output points at exactly that status rather than a single
  // generic failure covering all four.
  test.each<["SUBMITTED" | "UNDER_REVIEW" | "APPROVED" | "REJECTED"]>([
    ["SUBMITTED"],
    ["UNDER_REVIEW"],
    ["APPROVED"],
    ["REJECTED"],
  ])("%s is not editable", (status) => {
    expect(isEditable(status)).toBe(false);
  });
});
