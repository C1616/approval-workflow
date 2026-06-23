import { Router } from "express";
import { prisma } from "../prisma";
import { requireAuth } from "../middleware/auth";

const router = Router();
router.use(requireAuth);

// Lightweight list, newest first, capped at 30 by default - this is a
// notification dropdown, not a paginated archive. unreadCount is also
// returned so the bell badge and the dropdown's "mark all read" state
// stay in sync from a single call.
router.get("/", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 50);

  const [notifications, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { application: { select: { id: true, title: true } } },
    }),
    prisma.notification.count({ where: { userId: req.user!.id, isRead: false } }),
  ]);

  res.json({ notifications, unreadCount });
});

router.get("/unread-count", async (req, res) => {
  const unreadCount = await prisma.notification.count({
    where: { userId: req.user!.id, isRead: false },
  });
  res.json({ unreadCount });
});

router.post("/:id/read", async (req, res) => {
  const notification = await prisma.notification.findUnique({ where: { id: req.params.id } });
  if (!notification) return res.status(404).json({ error: "Notification not found." });
  if (notification.userId !== req.user!.id) {
    return res.status(403).json({ error: "You do not have access to this notification." });
  }
  const updated = await prisma.notification.update({
    where: { id: req.params.id },
    data: { isRead: true },
  });
  res.json({ notification: updated });
});

router.post("/read-all", async (req, res) => {
  await prisma.notification.updateMany({
    where: { userId: req.user!.id, isRead: false },
    data: { isRead: true },
  });
  res.json({ ok: true });
});

export default router;
