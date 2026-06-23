import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { requireAuth, requireRole } from "../middleware/auth";
import { isEditable } from "../services/state-machine";
import { performTransition, httpStatusForError, NotFoundError } from "../services/application-service";
import multer from "multer";
import path from "path";
import fs from "fs";

const router = Router();
router.use(requireAuth);

const uploadDir = path.join(__dirname, "..", "..", "uploads");
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
      const safeExt = path.extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, "");
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${safeExt}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
});

const applicationInputSchema = z.object({
  title: z.string().min(1, "Title is required."),
  category: z.enum(["EXPENSE", "LEAVE", "EQUIPMENT", "TRAVEL", "OTHER"]),
  description: z.string().optional().nullable(),
  amount: z.union([z.number(), z.string()]).optional().nullable(),
  dueDate: z.string().optional().nullable(),
});

// ── Applicant: list own applications ─────────────────────────────────────
router.get("/mine", async (req, res) => {
  const apps = await prisma.application.findMany({
    where: { applicantId: req.user!.id },
    orderBy: { updatedAt: "desc" },
  });
  res.json({ applications: apps });
});

// ── Reviewer: queue of submitted/under-review applications ──────────────
// Supports:
//   ?status=SUBMITTED|UNDER_REVIEW|APPROVED|REJECTED|ALL  (default: SUBMITTED+UNDER_REVIEW)
//   ?search=text       matches against title or applicant name (case-insensitive)
//   ?page=1            1-indexed
//   ?pageSize=10        capped at 50
router.get("/queue", requireRole("REVIEWER"), async (req, res) => {
  const statusFilter = typeof req.query.status === "string" ? req.query.status : undefined;
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(Math.max(1, Number(req.query.pageSize) || 10), 50);

  const statusWhere =
    statusFilter && statusFilter !== "ALL"
      ? { status: statusFilter as any }
      : { status: { in: ["SUBMITTED", "UNDER_REVIEW"] as any } };

  const where = search
    ? {
        ...statusWhere,
        OR: [
          { title: { contains: search, mode: "insensitive" as const } },
          { applicant: { name: { contains: search, mode: "insensitive" as const } } },
        ],
      }
    : statusWhere;

  const [apps, total] = await Promise.all([
    prisma.application.findMany({
      where,
      include: { applicant: { select: { name: true, email: true } } },
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.application.count({ where }),
  ]);

  res.json({ applications: apps, total, page, pageSize });
});

// ── Get a single application (owner or any reviewer) ────────────────────
router.get("/:id", async (req, res) => {
  const app = await prisma.application.findUnique({
    where: { id: req.params.id },
    include: {
      applicant: { select: { id: true, name: true, email: true } },
      auditLogs: {
        include: { actor: { select: { name: true, role: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!app) return res.status(404).json({ error: "Application not found." });

  const isOwner = app.applicantId === req.user!.id;
  const isReviewer = req.user!.role === "REVIEWER";
  if (!isOwner && !isReviewer) {
    return res.status(403).json({ error: "You do not have access to this application." });
  }

  res.json({ application: app });
});

// ── Applicant: create a new DRAFT application ────────────────────────────
router.post("/", requireRole("APPLICANT"), async (req, res) => {
  const parsed = applicationInputSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid application data.", details: parsed.error.flatten() });
  }
  const { title, category, description, amount, dueDate } = parsed.data;

  const app = await prisma.application.create({
    data: {
      title,
      category,
      description: description || null,
      amount: amount !== undefined && amount !== null && amount !== "" ? Number(amount) : null,
      dueDate: dueDate ? new Date(dueDate) : null,
      applicantId: req.user!.id,
      status: "DRAFT",
    },
  });
  res.status(201).json({ application: app });
});

// ── Applicant: edit a DRAFT they own ─────────────────────────────────────
router.patch("/:id", requireRole("APPLICANT"), async (req, res) => {
  const existing = await prisma.application.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Application not found." });

  if (existing.applicantId !== req.user!.id) {
    return res.status(403).json({ error: "You can only edit your own applications." });
  }
  if (!isEditable(existing.status as any)) {
    return res.status(409).json({ error: `Cannot edit an application in status '${existing.status}'.` });
  }

  const parsed = applicationInputSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid application data.", details: parsed.error.flatten() });
  }
  const { title, category, description, amount, dueDate } = parsed.data;

  const updated = await prisma.application.update({
    where: { id: req.params.id },
    data: {
      ...(title !== undefined && { title }),
      ...(category !== undefined && { category }),
      ...(description !== undefined && { description }),
      ...(amount !== undefined && { amount: amount === null || amount === "" ? null : Number(amount) }),
      ...(dueDate !== undefined && { dueDate: dueDate ? new Date(dueDate) : null }),
    },
  });
  res.json({ application: updated });
});

// ── Applicant: attach a file to a DRAFT they own ─────────────────────────
router.post("/:id/attachment", requireRole("APPLICANT"), upload.single("file"), async (req, res) => {
  const existing = await prisma.application.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Application not found." });
  if (existing.applicantId !== req.user!.id) {
    return res.status(403).json({ error: "You can only edit your own applications." });
  }
  if (!isEditable(existing.status as any)) {
    return res.status(409).json({ error: `Cannot edit an application in status '${existing.status}'.` });
  }
  if (!req.file) return res.status(400).json({ error: "No file uploaded." });

  const updated = await prisma.application.update({
    where: { id: req.params.id },
    data: { attachmentPath: req.file.filename, attachmentName: req.file.originalname },
  });
  res.json({ application: updated });
});

// ── Shared transition handler ─────────────────────────────────────────────
const transitionCommentSchema = z.object({ comment: z.string().optional() });

function makeTransitionRoute(action: "SUBMIT" | "START_REVIEW" | "APPROVE" | "REJECT" | "RETURN_FOR_CHANGES") {
  return async (req: any, res: any) => {
    const parsed = transitionCommentSchema.safeParse(req.body ?? {});
    const comment = parsed.success ? parsed.data.comment : undefined;

    try {
      const updated = await performTransition({
        applicationId: req.params.id,
        action,
        actor: req.user!,
        comment,
      });
      res.json({ application: updated });
    } catch (err) {
      const status = httpStatusForError(err);
      res.status(status).json({ error: (err as Error).message });
    }
  };
}

router.post("/:id/submit", makeTransitionRoute("SUBMIT"));
router.post("/:id/start-review", makeTransitionRoute("START_REVIEW"));
router.post("/:id/approve", makeTransitionRoute("APPROVE"));
router.post("/:id/reject", makeTransitionRoute("REJECT"));
router.post("/:id/return", makeTransitionRoute("RETURN_FOR_CHANGES"));

export default router;
