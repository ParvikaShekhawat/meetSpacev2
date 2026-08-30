import { Router, Response } from "express";
import { prisma } from "../lib/prisma";
import { generateInterviewCode } from "../lib/interview-code";
import { authenticate, requireRole, AuthenticatedRequest } from "../middleware/auth.middleware";

const router = Router();

const MIN_DURATION_MINS = 15;
const MAX_DURATION_MINS = 240;

router.use(authenticate);

router.get("/", requireRole("INTERVIEWER"), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const status = req.query.status as string | undefined;
    const where: any = { position: { interviewerId: req.user!.id } };
    if (status) where.status = status;

    const interviews = await prisma.interview.findMany({
      where,
      include: {
        candidate: { select: { name: true, email: true } },
        position: { select: { title: true } },
        questions: { include: { question: { select: { title: true, type: true } } } },
      },
      orderBy: { scheduledAt: "desc" },
    });
    return res.json(interviews);
  } catch (e) {
    console.error("Failed to fetch interviews:", e);
    return res.status(500).json({ error: "Failed to fetch interviews" });
  }
});

router.post("/", requireRole("INTERVIEWER"), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const candidateId = req.body.candidateId as string | undefined;
    const scheduledAtRaw = req.body.scheduledAt as string | undefined;
    const durationMinsRaw = req.body.durationMins;
    const questionIds = req.body.questionIds as string[] | undefined;

    if (!candidateId || !scheduledAtRaw) {
      return res.status(400).json({ error: "candidateId and scheduledAt are required" });
    }
    if (!Array.isArray(questionIds) || questionIds.length === 0) {
      return res.status(400).json({ error: "At least one questionId is required" });
    }

    const scheduledAt = new Date(scheduledAtRaw);
    if (isNaN(scheduledAt.getTime())) {
      return res.status(400).json({ error: "scheduledAt must be a valid date" });
    }
    if (scheduledAt.getTime() < Date.now()) {
      return res.status(400).json({ error: "scheduledAt must be in the future" });
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

    const candidate = await prisma.candidate.findFirst({
      where: { id: candidateId, position: { interviewerId: req.user!.id } },
    });
    if (!candidate) {
      return res.status(404).json({ error: "Candidate not found" });
    }

    const questions = await prisma.question.findMany({
      where: { id: { in: questionIds }, interviewerId: req.user!.id },
    });
    if (questions.length !== questionIds.length) {
      return res.status(400).json({ error: "One or more questions not found or not owned by you" });
    }

    const code = await generateInterviewCode();

    const interview = await prisma.interview.create({
      data: {
        code,
        candidateId,
        positionId: candidate.positionId,
        scheduledAt,
        durationMins,
        questions: {
          create: questionIds.map((questionId, index) => ({ questionId, order: index })),
        },
      },
      include: {
        candidate: { select: { name: true, email: true } },
        position: { select: { title: true } },
        questions: { include: { question: { select: { title: true, type: true } } } },
      },
    });

    return res.status(201).json(interview);
  } catch (e) {
    console.error("Failed to create interview:", e);
    return res.status(500).json({ error: "Failed to create interview" });
  }
});

export default router;