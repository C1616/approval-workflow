import { Prisma, ApplicationStatus as PrismaStatus } from "@prisma/client";
import { prisma } from "../prisma";
import {
  assertTransition,
  TransitionAction,
  Role as SmRole,
  ApplicationStatus as SmStatus,
} from "./state-machine";
import { AuthUser } from "../middleware/auth";

export class NotFoundError extends Error {
  constructor(message = "Not found.") {
    super(message);
    this.name = "NotFoundError";
  }
}

/**
 * Builds the notification(s) to create for a given transition. Returns a
 * list of { userId, message } pairs - empty if no one should be notified
 * for this particular action (there currently isn't such a case, but the
 * shape allows for it).
 *
 * Recipients:
 *   SUBMIT              -> every REVIEWER (a new item landed in the queue)
 *   START_REVIEW        -> the applicant (their item is now being looked at)
 *   APPROVE/REJECT       -> the applicant (a decision was made)
 *   RETURN_FOR_CHANGES   -> the applicant (action needed from them)
 */
async function buildNotifications(params: {
  action: TransitionAction;
  applicationTitle: string;
  applicantId: string;
  actorName: string;
}): Promise<{ userId: string; message: string }[]> {
  const { action, applicationTitle, applicantId, actorName } = params;

  if (action === "SUBMIT") {
    const reviewers = await prisma.user.findMany({
      where: { role: "REVIEWER" },
      select: { id: true },
    });
    return reviewers.map((r: { id: string }) => ({
      userId: r.id,
      message: `New application submitted: "${applicationTitle}" by ${actorName}.`,
    }));
  }

  const messageByAction: Record<string, string> = {
    START_REVIEW: `Your application "${applicationTitle}" is now under review.`,
    APPROVE: `Your application "${applicationTitle}" was approved.`,
    REJECT: `Your application "${applicationTitle}" was rejected.`,
    RETURN_FOR_CHANGES: `Your application "${applicationTitle}" was returned for changes.`,
  };
  const message = messageByAction[action];
  if (!message) return [];

  return [{ userId: applicantId, message }];
}

/**
 * Performs a single workflow transition for an application:
 *   1. Loads the application (404 if missing).
 *   2. Runs it through the pure state machine (assertTransition), which
 *      throws IllegalTransitionError / ForbiddenTransitionError /
 *      CommentRequiredError as appropriate - the route layer maps these
 *      to 409 / 403 / 400.
 *   3. If legal, updates the application's status, inserts the AuditLog
 *      row, AND creates any resulting Notification rows, all inside a
 *      single Prisma transaction - so the status change, its audit trail
 *      entry, and any notifications can never get out of sync with each
 *      other (a crash between writes can't leave one without the others).
 */
export async function performTransition(params: {
  applicationId: string;
  action: TransitionAction;
  actor: AuthUser;
  comment?: string | null;
}) {
  const { applicationId, action, actor, comment } = params;

  const application = await prisma.application.findUnique({
    where: { id: applicationId },
  });
  if (!application) {
    throw new NotFoundError("Application not found.");
  }

  const nextStatus = assertTransition({
    currentStatus: application.status as SmStatus,
    action,
    actorRole: actor.role as SmRole,
    actorIsOwner: application.applicantId === actor.id,
    comment,
  });

  const notifications = await buildNotifications({
    action,
    applicationTitle: application.title,
    applicantId: application.applicantId,
    actorName: actor.name,
  });

  const [updated] = await prisma.$transaction([
    prisma.application.update({
      where: { id: applicationId },
      data: { status: nextStatus as PrismaStatus },
    }),
    prisma.auditLog.create({
      data: {
        applicationId,
        actorId: actor.id,
        fromStatus: application.status,
        toStatus: nextStatus as PrismaStatus,
        comment: comment?.trim() || null,
      },
    }),
    ...notifications.map((n) =>
      prisma.notification.create({
        data: {
          userId: n.userId,
          applicationId,
          message: n.message,
        },
      })
    ),
  ]);

  return updated;
}

/** Maps domain errors thrown by the state machine / service layer to HTTP status codes. */
export function httpStatusForError(err: unknown): number {
  const name = (err as Error)?.name;
  switch (name) {
    case "NotFoundError":
      return 404;
    case "ForbiddenTransitionError":
      return 403;
    case "IllegalTransitionError":
      return 409;
    case "CommentRequiredError":
      return 400;
    default:
      return 500;
  }
}
