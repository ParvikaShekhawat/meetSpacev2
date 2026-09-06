import { Router, Response } from "express";
import { prisma } from "../lib/prisma";
import { generateInterviewCode } from "../lib/interview-code";
import { authenticate, requireRole, AuthenticatedRequest } from "../middleware/auth.middleware";
import { generateReportWithAI } from "../services/openai.service";
import { startRoomRecording, stopRoomRecording, isLiveKitConfigured } from "../services/livekit.service";
import { processInterviewTranscript } from "../services/transcription.service";

const router = Router();

const MIN_DURATION_MINS = 15;
const MAX_DURATION_MINS = 240;

router.use(authenticate);

async function getInterviewAccess(interviewId: string, userId: string) {
  const interview = await prisma.interview.findUnique({
    where: { id: interviewId },
    include: { position: true, candidate: true },
  });

  if (!interview) {
    return { interview: null, isInterviewer: false, isCandidate: false, hasAccess: false };
  }

  const isInterviewer = interview.position.interviewerId === userId;
  const isCandidate = interview.candidate.userId === userId;

  return { interview, isInterviewer, isCandidate, hasAccess: isInterviewer || isCandidate };
}

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

router.get("/:id", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const user = req.user!;

    const interview = await prisma.interview.findUnique({
      where: { id },
      include: {
        candidate: true,
        position: true,
        questions: {
          include: { question: true },
          orderBy: { order: "asc" },
        },
        events: { orderBy: { timestampMs: "asc" } },
        report: true,
      },
    });

    if (!interview) {
      return res.status(404).json({ error: "Interview not found" });
    }

    const isInterviewer = interview.position.interviewerId === user.id;
    const isCandidate = interview.candidate.userId === user.id;

    if (!isInterviewer && !isCandidate) {
      return res.status(403).json({ error: "Forbidden" });
    }

    if (isInterviewer) {
      return res.json(interview);
    }

    // Candidates never see interviewer-private notes/decisions.
    const iv = interview as any;
    return res.json({
      ...iv,
      questions: iv.questions.map((iq: any) => ({ ...iq, notes: null })),
      report: iv.report
        ? { ...iv.report, interviewerNotes: null, interviewerDecision: null, finalComments: null }
        : null,
    });
  } catch (e) {
    console.error("Failed to fetch interview:", e);
    return res.status(500).json({ error: "Failed to fetch interview" });
  }
});

router.get("/:id/events", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const { hasAccess } = await getInterviewAccess(id, req.user!.id);
    if (!hasAccess) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const events = await prisma.interviewEvent.findMany({
      where: { interviewId: id },
      orderBy: { timestampMs: "asc" },
    });
    return res.json(events);
  } catch (e) {
    console.error("Failed to fetch events:", e);
    return res.status(500).json({ error: "Failed to fetch events" });
  }
});

router.get("/:id/report", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const user = req.user!;

    const interview = await prisma.interview.findUnique({
      where: { id },
      include: {
        candidate: true,
        position: true,
        questions: { include: { question: true }, orderBy: { order: "asc" } },
        events: { orderBy: { timestampMs: "asc" } },
        report: true,
      },
    });

    if (!interview || !interview.report) {
      return res.status(404).json({ error: "Report not found" });
    }

    const isInterviewer = interview.position.interviewerId === user.id;
    const isCandidate = interview.candidate.userId === user.id;
    if (!isInterviewer && !isCandidate) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const iv = interview as any;
    const report = {
      id: iv.id,
      code: iv.code,
      candidateName: iv.candidate.name,
      positionTitle: iv.position.title,
      scheduledAt: iv.scheduledAt.toISOString(),
      durationMins: iv.durationMins,
      overallScore: iv.report.overallScore,
      aiSummary: iv.report.aiSummary,
      strengths: iv.report.strengths,
      weaknesses: iv.report.weaknesses,
      recommendation: iv.report.aiRecommendation,
      interviewerNotes: isInterviewer ? iv.report.interviewerNotes : null,
      interviewerDecision: isInterviewer ? iv.report.interviewerDecision : null,
      finalComments: isInterviewer ? iv.report.finalComments : null,
      questionsSolved: iv.report.questionsSolved,
      hintsUsed: iv.report.hintsUsed,
      questionsAsked: iv.questions.length,
      competencyScores: iv.report.competencyScores ?? [],
      learningPlan: iv.report.learningPlanData ?? [],
      candidateBetterApproach: isCandidate ? iv.report.candidateBetterApproach : null,
      aiGenerated: iv.report.aiGenerated,
      questions: iv.questions.map((iq: any) => ({
        id: iq.id,
        questionRefId: iq.questionId,
        title: iq.question.title,
        type: iq.question.type,
        difficulty: iq.question.difficulty,
        statement: iq.question.statement,
        finalCode: iq.finalCode,
        notes: isInterviewer ? iq.notes : null,
      })),
      events: iv.events.map((e: any) => ({
        id: e.id,
        timestampMs: e.timestampMs,
        type: e.type,
        payload: e.payload || {},
      })),
      role: user.role,
    };

    return res.json(report);
  } catch (e) {
    console.error("Failed to fetch report:", e);
    return res.status(500).json({ error: "Failed to fetch report" });
  }
});

router.patch("/:id/report", requireRole("INTERVIEWER"), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const user = req.user!;

    const interview = await prisma.interview.findUnique({
      where: { id },
      include: { position: true },
    });

    if (!interview || interview.position.interviewerId !== user.id) {
      return res.status(404).json({ error: "Not found or forbidden" });
    }

    const { interviewerDecision, finalComments, interviewerNotes } = req.body;
    const report = await prisma.interviewReport.update({
      where: { interviewId: id },
      data: { interviewerDecision, finalComments, interviewerNotes },
    });

    return res.json(report);
  } catch (e) {
    console.error("Failed to update report:", e);
    return res.status(500).json({ error: "Failed to update report" });
  }
});

router.post("/:id/start", requireRole("INTERVIEWER"), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = req.params.id as string;

    const interview = await prisma.interview.findFirst({
      where: { id, position: { interviewerId: req.user!.id } },
    });
    if (!interview) {
      return res.status(404).json({ error: "Interview not found" });
    }
    if (interview.status !== "SCHEDULED") {
      return res.status(400).json({ error: `Cannot start an interview with status ${interview.status}` });
    }

    const startedAt = new Date();

    // Best-effort: if LiveKit/recording isn't configured or Egress fails to start,
    // the interview should still proceed — recording is an enhancement, not a blocker.
    let egressId: string | null = null;
    if (isLiveKitConfigured()) {
      try {
        const roomName = `interview-${id}`;
        egressId = await startRoomRecording(roomName);
      } catch (egressError) {
        console.error("Failed to start recording, continuing without it:", egressError);
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      const updatedInterview = await tx.interview.update({
        where: { id },
        data: { status: "IN_PROGRESS", startedAt, currentEgressId: egressId },
      });

      await tx.interviewEvent.create({
        data: {
          interviewId: id,
          timestampMs: 0,
          type: "INTERVIEW_STARTED",
          payload: { startedAt: startedAt.toISOString() },
        },
      });

      return updatedInterview;
    });

    return res.json(updated);
  } catch (e) {
    console.error("Failed to start interview:", e);
    return res.status(500).json({ error: "Failed to start interview" });
  }
});

router.post("/:id/end", requireRole("INTERVIEWER"), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = req.params.id as string;

    const interview = await prisma.interview.findFirst({
      where: { id, position: { interviewerId: req.user!.id } },
      include: { candidate: true, position: true },
    });
    if (!interview) {
      return res.status(404).json({ error: "Interview not found" });
    }
    if (interview.status !== "IN_PROGRESS") {
      return res.status(400).json({ error: `Cannot end an interview with status ${interview.status}` });
    }

    
    if (interview.currentEgressId) {
      try {
        await stopRoomRecording(interview.currentEgressId);
        // Fire-and-forget: transcription takes several minutes (waiting for upload +
        // AssemblyAI processing), so it must not block this request/response.
        // Errors inside are already logged internally by processInterviewTranscript.
        processInterviewTranscript(id).catch((err) =>
          console.error(`Background transcription failed for interview ${id}:`, err)
        );
      } catch (egressError) {
        console.error("Failed to stop recording:", egressError);
      }
    }

    const endedAt = new Date();
        if (interview.currentQuestionId && interview.currentQuestionStartedAt) {
      const secsSpent = Math.round(
        (endedAt.getTime() - interview.currentQuestionStartedAt.getTime()) / 1000
      );
      if (secsSpent > 0) {
        await prisma.interviewQuestion.updateMany({
          where: { interviewId: id, questionId: interview.currentQuestionId },
          data: { timeSpentSecs: { increment: secsSpent } },
        });
      }
    }
    const timestampMs = interview.startedAt
      ? endedAt.getTime() - interview.startedAt.getTime()
      : 0;

    // Snapshot final code from RoomState into InterviewQuestion before generating the report,
    // so the report reflects what was actually on screen when the interview ended.
    const roomStates = await prisma.roomState.findMany({ where: { interviewId: id } });
    for (const state of roomStates) {
      await prisma.interviewQuestion.updateMany({
        where: { interviewId: id, questionId: state.questionId },
        data: {
          finalCode: state.code ?? undefined,
          workspaceData: state.workspaceData ?? undefined,
        },
      });
    }

    const refreshedQuestions = await prisma.interviewQuestion.findMany({
      where: { interviewId: id },
      include: { question: true },
    });
    const events = await prisma.interviewEvent.findMany({ where: { interviewId: id } });

    let analysis: Awaited<ReturnType<typeof generateReportWithAI>> | null = null;
    try {
      analysis = await generateReportWithAI({
        candidateName: interview.candidate.name,
        positionTitle: interview.position.title,
        durationMins: interview.durationMins,
        events: events.map((e) => ({
          type: e.type,
          timestampMs: e.timestampMs,
          payload: (e.payload as Record<string, string>) ?? {},
        })),
        questions: refreshedQuestions.map((q) => ({
          title: q.question.title,
          type: q.question.type,
          finalCode: q.finalCode,
        })),
      });
    } catch (aiError) {
      console.error("AI report generation failed, ending interview without report:", aiError);
    }

    const updated = await prisma.$transaction(async (tx) => {
      const updatedInterview = await tx.interview.update({
        where: { id },
        data: { status: "COMPLETED", endedAt },
      });

      await tx.interviewEvent.create({
        data: {
          interviewId: id,
          timestampMs,
          type: "INTERVIEW_ENDED",
          payload: { endedAt: endedAt.toISOString() },
        },
      });

      if (analysis) {
        await tx.interviewReport.upsert({
          where: { interviewId: id },
          create: {
            interviewId: id,
            questionsAsked: refreshedQuestions.length,
            overallScore: analysis.overallScore,
            questionsSolved: analysis.questionsSolved,
            hintsUsed: analysis.hintsUsed,
            aiSummary: analysis.aiSummary,
            strengths: analysis.strengths,
            weaknesses: analysis.weaknesses,
            aiRecommendation: analysis.recommendation,
            competencyScores: analysis.competencyScores,
            learningPlanData: analysis.learningPlan,
            candidateBetterApproach: analysis.candidateBetterApproach,
            aiGenerated: analysis.aiGenerated,
            interviewerNotes: "",
          },
          update: {
            questionsAsked: refreshedQuestions.length,
            overallScore: analysis.overallScore,
            questionsSolved: analysis.questionsSolved,
            hintsUsed: analysis.hintsUsed,
            aiSummary: analysis.aiSummary,
            strengths: analysis.strengths,
            weaknesses: analysis.weaknesses,
            aiRecommendation: analysis.recommendation,
            competencyScores: analysis.competencyScores,
            learningPlanData: analysis.learningPlan,
            candidateBetterApproach: analysis.candidateBetterApproach,
            aiGenerated: analysis.aiGenerated,
          },
        });
      }

      return updatedInterview;
    });

    return res.json(updated);
  } catch (e) {
    console.error("Failed to end interview:", e);
    return res.status(500).json({ error: "Failed to end interview" });
  }
});

export default router;