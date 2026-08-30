import { Router, Response } from "express";
import { prisma } from "../lib/prisma";
import { authenticate, requireRole, AuthenticatedRequest } from "../middleware/auth.middleware";

const router = Router();

const MIN_DURATION_MINS = 15;
const MAX_DURATION_MINS = 240;
const MAX_TITLE_LENGTH = 200;
const MAX_INTERVIEW_TYPE_LENGTH = 100;

router.use(authenticate);

router.get("/", requireRole("INTERVIEWER"), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const positions = await prisma.position.findMany({
      where: { interviewerId: req.user!.id },
      include: {
        _count: { select: { candidates: true, interviews: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return res.json(positions);
  } catch (e) {
    console.error("Failed to fetch positions:", e);
    return res.status(500).json({ error: "Failed to fetch positions" });
  }
});

router.post("/", requireRole("INTERVIEWER"), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const title = (req.body.title as string | undefined)?.trim();
    const interviewType = (req.body.interviewType as string | undefined)?.trim();
    const durationMinsRaw = req.body.durationMins;

    if (!title) {
      return res.status(400).json({ error: "Title is required" });
    }
    if (title.length > MAX_TITLE_LENGTH) {
      return res.status(400).json({ error: `Title must be ${MAX_TITLE_LENGTH} characters or fewer` });
    }
    if (interviewType && interviewType.length > MAX_INTERVIEW_TYPE_LENGTH) {
      return res.status(400).json({ error: `Interview type must be ${MAX_INTERVIEW_TYPE_LENGTH} characters or fewer` });
    }

    let durationMins = 60;
    if (durationMinsRaw !== undefined && durationMinsRaw !== null && durationMinsRaw !== "") {
      const parsed = parseInt(durationMinsRaw, 10);
      if (!Number.isFinite(parsed) || parsed < MIN_DURATION_MINS || parsed > MAX_DURATION_MINS) {
        return res.status(400).json({
          error: `Duration must be a number between ${MIN_DURATION_MINS} and ${MAX_DURATION_MINS} minutes`,
        });
      }
      durationMins = parsed;
    }

    const position = await prisma.position.create({
      data: {
        title,
        durationMins,
        interviewType: interviewType || "Technical Round",
        interviewerId: req.user!.id,
      },
    });

    return res.status(201).json(position);
  } catch (e) {
    console.error("Failed to create position:", e);
    return res.status(500).json({ error: "Failed to create position" });
  }
});

export default router;