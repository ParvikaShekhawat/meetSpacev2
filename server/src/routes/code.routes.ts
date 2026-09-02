// src/routes/code.routes.ts
import { Router, Response } from "express";
import { prisma } from "../lib/prisma";
import { authenticate, AuthenticatedRequest } from "../middleware/auth.middleware";
import { executeViaPiston, SUPPORTED_LANGUAGES, LanguageId } from "../services/piston.service";
import { runMultiLanguageTests, QuestionTestConfig } from "../services/piston-test-runner.service";

const router = Router();

const SUPPORTED_LANGUAGE_IDS = SUPPORTED_LANGUAGES.map((l) => l.id);
const MAX_STDIN_LENGTH = 10_000;

router.use(authenticate);

async function checkInterviewAccess(interviewId: string, userId: string) {
  const interview = await prisma.interview.findUnique({
    where: { id: interviewId },
    include: {
      candidate: { select: { userId: true } },
      position: { select: { interviewerId: true } },
    },
  });

  if (!interview) return { interview: null, authorized: false };

  const isInterviewer = interview.position.interviewerId === userId;
  const isCandidate = interview.candidate.userId === userId;

  return { interview, authorized: isInterviewer || isCandidate };
}

function isValidLanguage(language: unknown): language is LanguageId {
  return typeof language === "string" && (SUPPORTED_LANGUAGE_IDS as string[]).includes(language);
}

// Run code freely against optional stdin — no test cases, just raw stdout/stderr.
router.post("/run", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { interviewId, code, language, stdin } = req.body as {
      interviewId?: string;
      code?: string;
      language?: string;
      stdin?: string;
    };

    if (!interviewId || typeof code !== "string" || !isValidLanguage(language)) {
      return res.status(400).json({ error: "interviewId, code, and a supported language are required" });
    }
    if (stdin !== undefined && (typeof stdin !== "string" || stdin.length > MAX_STDIN_LENGTH)) {
      return res.status(400).json({ error: `stdin must be a string under ${MAX_STDIN_LENGTH} characters` });
    }

    const { interview, authorized } = await checkInterviewAccess(interviewId, req.user!.id);
    if (!interview) {
      return res.status(404).json({ error: "Interview not found" });
    }
    if (!authorized) {
      return res.status(403).json({ error: "Not authorized for this interview" });
    }
    if (interview.status !== "IN_PROGRESS") {
      return res.status(400).json({ error: `Cannot run code for an interview with status ${interview.status}` });
    }

    const result = await executeViaPiston(code, language, stdin);
    return res.json(result);
  } catch (e) {
    console.error("Failed to run code:", e);
    return res.status(500).json({ error: "Failed to run code" });
  }
});

// Run code against a question's configured test cases.
router.post("/test", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { interviewId, questionId, code, language } = req.body as {
      interviewId?: string;
      questionId?: string;
      code?: string;
      language?: string;
    };

    if (!interviewId || !questionId || typeof code !== "string" || !isValidLanguage(language)) {
      return res.status(400).json({
        error: "interviewId, questionId, code, and a supported language are required",
      });
    }

    const { interview, authorized } = await checkInterviewAccess(interviewId, req.user!.id);
    if (!interview) {
      return res.status(404).json({ error: "Interview not found" });
    }
    if (!authorized) {
      return res.status(403).json({ error: "Not authorized for this interview" });
    }
    if (interview.status !== "IN_PROGRESS") {
      return res.status(400).json({ error: `Cannot run tests for an interview with status ${interview.status}` });
    }

    // Confirm the question actually belongs to this interview.
    const link = await prisma.interviewQuestion.findFirst({
      where: { interviewId, questionId },
    });
    if (!link) {
      return res.status(404).json({ error: "Question not found on this interview" });
    }

    const question = await prisma.question.findUnique({
      where: { id: questionId },
      select: { metadata: true },
    });
    if (!question) {
      return res.status(404).json({ error: "Question not found" });
    }

    const testConfig = (question.metadata as unknown as QuestionTestConfig | null) ?? null;

    const result = await runMultiLanguageTests(code, language, testConfig);
    return res.json(result);
  } catch (e) {
    console.error("Failed to run tests:", e);
    return res.status(500).json({ error: "Failed to run tests" });
  }
});

export default router;