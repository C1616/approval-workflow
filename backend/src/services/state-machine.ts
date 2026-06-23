// state-machine.ts
//
// Pure, framework-free implementation of the application workflow.
// Deliberately has zero dependencies on Prisma, Express, or anything
// else - it's just data in, data out - so it can be unit tested in
// complete isolation from the database (see tests/state-machine.test.ts).
//
// The transition table below is the single source of truth for which
// moves are legal. Everything else (the API layer, the service layer)
// must go through `canTransition` / `assertTransition` rather than
// re-implementing the rules - that's what guarantees illegal
// transitions are rejected consistently everywhere.

export type ApplicationStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "UNDER_REVIEW"
  | "APPROVED"
  | "REJECTED";

export type Role = "APPLICANT" | "REVIEWER";

export type TransitionAction =
  | "SUBMIT"
  | "START_REVIEW"
  | "APPROVE"
  | "REJECT"
  | "RETURN_FOR_CHANGES";

export interface TransitionRule {
  from: ApplicationStatus;
  to: ApplicationStatus;
  action: TransitionAction;
  /** Which role is allowed to perform this transition. */
  allowedRole: Role;
  /** Whether the actor must also be the application's owner (applicant). */
  requiresOwnership: boolean;
  /** Whether a non-empty comment is mandatory for this transition. */
  requiresComment: boolean;
}

// The complete, exhaustive set of legal transitions. Any (status, action)
// pair not listed here is illegal by definition.
export const TRANSITIONS: TransitionRule[] = [
  {
    from: "DRAFT",
    to: "SUBMITTED",
    action: "SUBMIT",
    allowedRole: "APPLICANT",
    requiresOwnership: true,
    requiresComment: false,
  },
  {
    from: "SUBMITTED",
    to: "UNDER_REVIEW",
    action: "START_REVIEW",
    allowedRole: "REVIEWER",
    requiresOwnership: false,
    requiresComment: false,
  },
  {
    from: "UNDER_REVIEW",
    to: "APPROVED",
    action: "APPROVE",
    allowedRole: "REVIEWER",
    requiresOwnership: false,
    requiresComment: false,
  },
  {
    from: "UNDER_REVIEW",
    to: "REJECTED",
    action: "REJECT",
    allowedRole: "REVIEWER",
    requiresOwnership: false,
    requiresComment: true,
  },
  {
    from: "UNDER_REVIEW",
    to: "DRAFT",
    action: "RETURN_FOR_CHANGES",
    allowedRole: "REVIEWER",
    requiresOwnership: false,
    requiresComment: true,
  },
];

export class IllegalTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IllegalTransitionError";
  }
}

export class ForbiddenTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForbiddenTransitionError";
  }
}

export class CommentRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommentRequiredError";
  }
}

export interface TransitionContext {
  currentStatus: ApplicationStatus;
  action: TransitionAction;
  actorRole: Role;
  actorIsOwner: boolean;
  comment?: string | null;
}

/** Looks up the rule for a given (currentStatus, action) pair, if any. */
export function findRule(
  currentStatus: ApplicationStatus,
  action: TransitionAction
): TransitionRule | undefined {
  return TRANSITIONS.find((r) => r.from === currentStatus && r.action === action);
}

/**
 * Validates a proposed transition against the rule table and returns the
 * resulting status if legal. Throws a specific, typed error describing
 * exactly why the transition was rejected:
 *
 * - IllegalTransitionError: no rule exists for (currentStatus, action) -
 *   e.g. trying to APPROVE a DRAFT. Maps to HTTP 409 (Conflict) at the API layer.
 * - ForbiddenTransitionError: a rule exists but the actor's role (or
 *   ownership) doesn't satisfy it - e.g. an Applicant calling APPROVE, or
 *   a different Applicant trying to SUBMIT someone else's draft. Maps to
 *   HTTP 403 (Forbidden).
 * - CommentRequiredError: the rule requires a comment and none/blank was
 *   given. Maps to HTTP 400 (Bad Request).
 */
export function assertTransition(ctx: TransitionContext): ApplicationStatus {
  const rule = findRule(ctx.currentStatus, ctx.action);

  if (!rule) {
    throw new IllegalTransitionError(
      `Cannot perform '${ctx.action}' from status '${ctx.currentStatus}'.`
    );
  }

  if (rule.allowedRole !== ctx.actorRole) {
    throw new ForbiddenTransitionError(
      `Action '${ctx.action}' requires role '${rule.allowedRole}', but actor has role '${ctx.actorRole}'.`
    );
  }

  if (rule.requiresOwnership && !ctx.actorIsOwner) {
    throw new ForbiddenTransitionError(
      `Action '${ctx.action}' can only be performed by the application's owner.`
    );
  }

  if (rule.requiresComment && !ctx.comment?.trim()) {
    throw new CommentRequiredError(
      `Action '${ctx.action}' requires a non-empty comment.`
    );
  }

  return rule.to;
}

/** Non-throwing convenience wrapper around assertTransition, for UI-side checks. */
export function canTransition(ctx: TransitionContext): boolean {
  try {
    assertTransition(ctx);
    return true;
  } catch {
    return false;
  }
}

/** Whether an application in this status can still be edited by its owner. */
export function isEditable(status: ApplicationStatus): boolean {
  return status === "DRAFT";
}
