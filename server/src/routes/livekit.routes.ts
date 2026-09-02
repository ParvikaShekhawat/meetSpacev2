import { Router, Response } from "express";
import { prisma } from "../lib/prisma";
import { authenticate, AuthenticatedRequest } from "../middleware/auth.middleware";
import { createLiveKitToken, getLiveKitUrl, isLiveKitConfigured } from "../services/livekit.service";

const router = Router();

router.use(authenticate);

router.get("/:interviewId/token", async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!isLiveKitConfigured()) {
      return res.status(503).json({ error: "Video service is not configured" });
    }

    const interviewId = req.params.interviewId as string;

    const interview = await prisma.interview.findUnique({
      where: { id: interviewId },
      include: {
        candidate: { select: { userId: true } },
        position: { select: { interviewerId: true } },
      },
    });

    if (!interview) {
      return res.status(404).json({ error: "Interview not found" });
    }

    const userId = req.user!.id;
    const isInterviewer = interview.position.interviewerId === userId;
    const isCandidate = interview.candidate.userId === userId;

    if (!isInterviewer && !isCandidate) {
      return res.status(403).json({ error: "Not authorized for this interview" });
    }

    if (isCandidate && !req.user!.emailVerified) {
      return res.status(403).json({ error: "Please verify your email before joining an interview" });
    }

    if (interview.status !== "IN_PROGRESS" && interview.status !== "SCHEDULED") {
      return res.status(400).json({ error: `Cannot join an interview with status ${interview.status}` });
    }

    const roomName = `interview-${interview.id}`;
    const participantName = req.user!.name ?? req.user!.email ?? userId;

    const token = await createLiveKitToken(roomName, participantName, userId);

    return res.json({ token, url: getLiveKitUrl(), roomName });
  } catch (e) {
    console.error("Failed to issue LiveKit token:", e);
    return res.status(500).json({ error: "Failed to issue video token" });
  }
});

export default router;