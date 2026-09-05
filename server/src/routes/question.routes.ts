import { Router, Response } from "express";
import { prisma } from "../lib/prisma";
import { authenticate, requireRole, AuthenticatedRequest } from "../middleware/auth.middleware";

const router = Router();

const VALID_QUESTION_TYPES = ["CODING", "SYSTEM_DESIGN", "SQL", "OOP", "DEBUGGING", "BEHAVIORAL"];
const VALID_DIFFICULTIES = ["Easy", "Medium", "Hard"];
const MAX_TITLE_LENGTH = 200;
const MAX_STATEMENT_LENGTH = 10000;
const MAX_CONSTRAINTS_LENGTH = 5000;
const MAX_HINTS_LENGTH = 5000;
const MAX_EXPECTED_FIELD_LENGTH = 2000;

router.use(authenticate);

router.get("/", requireRole("INTERVIEWER"), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const questions = await prisma.question.findMany({
      where: { interviewerId: req.user!.id },
      orderBy: { createdAt: "desc" },
    });
    return res.json(questions);
  } catch (e) {
    console.error("Failed to load questions:", e);
    return res.status(500).json({ error: "Failed to load questions" });
  }
});

router.post("/", requireRole("INTERVIEWER"), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const title = (req.body.title as string | undefined)?.trim();
    const statement = (req.body.statement as string | undefined)?.trim();
    const typeRaw = (req.body.type as string | undefined)?.trim();
    const difficultyRaw = (req.body.difficulty as string | undefined)?.trim();
    const constraints = (req.body.constraints as string | undefined)?.trim();
    const hints = (req.body.hints as string | undefined)?.trim();
    const expectedApproach = (req.body.expectedApproach as string | undefined)?.trim();
    const expectedTimeComplexity = (req.body.expectedTimeComplexity as string | undefined)?.trim();
    const expectedSpaceComplexity = (req.body.expectedSpaceComplexity as string | undefined)?.trim();

    if (!title || !typeRaw || !statement) {
      return res.status(400).json({ error: "Title, type, and statement are required" });
    }
    if (title.length > MAX_TITLE_LENGTH) {
      return res.status(400).json({ error: `Title must be ${MAX_TITLE_LENGTH} characters or fewer` });
    }
    if (statement.length > MAX_STATEMENT_LENGTH) {
      return res.status(400).json({ error: `Statement must be ${MAX_STATEMENT_LENGTH} characters or fewer` });
    }
    if (constraints && constraints.length > MAX_CONSTRAINTS_LENGTH) {
      return res.status(400).json({ error: `Constraints must be ${MAX_CONSTRAINTS_LENGTH} characters or fewer` });
    }
    if (hints && hints.length > MAX_HINTS_LENGTH) {
      return res.status(400).json({ error: `Hints must be ${MAX_HINTS_LENGTH} characters or fewer` });
    }

    if (expectedApproach && expectedApproach.length > MAX_EXPECTED_FIELD_LENGTH) {
      return res.status(400).json({ error: `Expected approach must be ${MAX_EXPECTED_FIELD_LENGTH} characters or fewer` });
    }
    if (expectedTimeComplexity && expectedTimeComplexity.length > MAX_EXPECTED_FIELD_LENGTH) {
      return res.status(400).json({ error: `Expected time complexity must be ${MAX_EXPECTED_FIELD_LENGTH} characters or fewer` });
    }
    if (expectedSpaceComplexity && expectedSpaceComplexity.length > MAX_EXPECTED_FIELD_LENGTH) {
      return res.status(400).json({ error: `Expected space complexity must be ${MAX_EXPECTED_FIELD_LENGTH} characters or fewer` });
    }

    const type = typeRaw.toUpperCase();
    if (!VALID_QUESTION_TYPES.includes(type)) {
      return res.status(400).json({ error: `Invalid question type. Must be one of: ${VALID_QUESTION_TYPES.join(", ")}` });
    }

    const difficulty = difficultyRaw || "Medium";
    if (!VALID_DIFFICULTIES.includes(difficulty)) {
      return res.status(400).json({ error: `Invalid difficulty. Must be one of: ${VALID_DIFFICULTIES.join(", ")}` });
    }

        const newQuestion = await prisma.question.create({
      data: {
        title,
        type: type as any,
        difficulty,
        statement,
        constraints: constraints || null,
        hints: hints || null,
        expectedApproach: expectedApproach || null,
        expectedTimeComplexity: expectedTimeComplexity || null,
        expectedSpaceComplexity: expectedSpaceComplexity || null,
        interviewerId: req.user!.id,
      },
    });

    return res.status(201).json(newQuestion);
  } catch (e) {
    console.error("Failed to create question:", e);
    return res.status(500).json({ error: "Failed to create question" });
  }
});

router.patch("/:id", requireRole("INTERVIEWER"), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const existing = await prisma.question.findFirst({ where: { id, interviewerId: req.user!.id } });
    if (!existing) {
      return res.status(404).json({ error: "Question not found" });
    }

    const data: Record<string, unknown> = {};

    if (req.body.title !== undefined) {
      const title = (req.body.title as string).trim();
      if (!title) return res.status(400).json({ error: "Title cannot be empty" });
      if (title.length > MAX_TITLE_LENGTH) {
        return res.status(400).json({ error: `Title must be ${MAX_TITLE_LENGTH} characters or fewer` });
      }
      data.title = title;
    }

    if (req.body.statement !== undefined) {
      const statement = (req.body.statement as string).trim();
      if (!statement) return res.status(400).json({ error: "Statement cannot be empty" });
      if (statement.length > MAX_STATEMENT_LENGTH) {
        return res.status(400).json({ error: `Statement must be ${MAX_STATEMENT_LENGTH} characters or fewer` });
      }
      data.statement = statement;
    }

    if (req.body.type !== undefined) {
      const type = (req.body.type as string).trim().toUpperCase();
      if (!VALID_QUESTION_TYPES.includes(type)) {
        return res.status(400).json({ error: `Invalid question type. Must be one of: ${VALID_QUESTION_TYPES.join(", ")}` });
      }
      data.type = type;
    }

    if (req.body.difficulty !== undefined) {
      const difficulty = (req.body.difficulty as string).trim();
      if (!VALID_DIFFICULTIES.includes(difficulty)) {
        return res.status(400).json({ error: `Invalid difficulty. Must be one of: ${VALID_DIFFICULTIES.join(", ")}` });
      }
      data.difficulty = difficulty;
    }

    if (req.body.constraints !== undefined) {
      const constraints = (req.body.constraints as string)?.trim() || null;
      if (constraints && constraints.length > MAX_CONSTRAINTS_LENGTH) {
        return res.status(400).json({ error: `Constraints must be ${MAX_CONSTRAINTS_LENGTH} characters or fewer` });
      }
      data.constraints = constraints;
    }

    if (req.body.hints !== undefined) {
      const hints = (req.body.hints as string)?.trim() || null;
      if (hints && hints.length > MAX_HINTS_LENGTH) {
        return res.status(400).json({ error: `Hints must be ${MAX_HINTS_LENGTH} characters or fewer` });
      }
      data.hints = hints;
    }

    if (req.body.expectedApproach !== undefined) {
      const val = (req.body.expectedApproach as string)?.trim() || null;
      if (val && val.length > MAX_EXPECTED_FIELD_LENGTH) {
        return res.status(400).json({ error: `Expected approach must be ${MAX_EXPECTED_FIELD_LENGTH} characters or fewer` });
      }
      data.expectedApproach = val;
    }

    if (req.body.expectedTimeComplexity !== undefined) {
      const val = (req.body.expectedTimeComplexity as string)?.trim() || null;
      if (val && val.length > MAX_EXPECTED_FIELD_LENGTH) {
        return res.status(400).json({ error: `Expected time complexity must be ${MAX_EXPECTED_FIELD_LENGTH} characters or fewer` });
      }
      data.expectedTimeComplexity = val;
    }

    if (req.body.expectedSpaceComplexity !== undefined) {
      const val = (req.body.expectedSpaceComplexity as string)?.trim() || null;
      if (val && val.length > MAX_EXPECTED_FIELD_LENGTH) {
        return res.status(400).json({ error: `Expected space complexity must be ${MAX_EXPECTED_FIELD_LENGTH} characters or fewer` });
      }
      data.expectedSpaceComplexity = val;
    }

    const updated = await prisma.question.update({ where: { id }, data });
    return res.json(updated);
  } catch (e) {
    console.error("Failed to update question:", e);
    return res.status(500).json({ error: "Failed to update question" });
  }
});

router.delete("/:id", requireRole("INTERVIEWER"), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const question = await prisma.question.findFirst({ where: { id, interviewerId: req.user!.id } });
    if (!question) {
      return res.status(404).json({ error: "Question not found" });
    }
    const usageCount = await prisma.interviewQuestion.count({ where: { questionId: id } });
    if (usageCount > 0) {
      return res.status(409).json({ error: `This question is used in ${usageCount} interview(s) and can't be deleted.` });
    }
    await prisma.question.delete({ where: { id } });
    return res.json({ success: true });
  } catch (e) {
    console.error("Failed to delete question:", e);
    return res.status(500).json({ error: "Failed to delete question" });
  }
});

export default router;