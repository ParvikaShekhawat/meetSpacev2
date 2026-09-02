import { Router, Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { authenticate, requireRole, AuthenticatedRequest } from "../middleware/auth.middleware";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { sendCandidateCredentials, sendVerificationEmail } from "../services/email.service";
import { generateVerificationToken, getVerificationTokenExpiry } from "../lib/utils";

const router = Router();

function generateTempPassword(): string {
  return crypto.randomBytes(9).toString("base64url"); // 12-char, URL-safe
}

router.use(authenticate);

router.get("/", requireRole("INTERVIEWER"), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const positionId = req.query.positionId as string | undefined;
    const where = positionId
      ? { positionId, position: { interviewerId: req.user!.id } }
      : { position: { interviewerId: req.user!.id } };

    const candidates = await prisma.candidate.findMany({
      where,
      include: { position: { select: { title: true } } },
      orderBy: { createdAt: "desc" },
    });
    return res.json(candidates);
  } catch (e) {
    console.error("Failed to fetch candidates:", e);
    return res.status(500).json({ error: "Failed to fetch candidates" });
  }
});

router.post("/", requireRole("INTERVIEWER"), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const name = (req.body.name as string | undefined)?.trim();
    const email = (req.body.email as string | undefined)?.trim().toLowerCase();
    const positionId = req.body.positionId as string | undefined;
    const resumeUrl = req.body.resumeUrl as string | undefined;

    if (!name || !email || !positionId) {
      return res.status(400).json({ error: "Name, email, and position are required" });
    }
    if (resumeUrl && !/^https?:\/\//i.test(resumeUrl)) {
      return res.status(400).json({ error: "Resume URL must start with http:// or https://" });
    }

    const position = await prisma.position.findFirst({
      where: { id: positionId, interviewerId: req.user!.id },
    });
    if (!position) {
      return res.status(404).json({ error: "Position not found" });
    }

    let tempPassword: string | null = null;
    let newlyCreatedUserId: string | null = null;
    let verificationToken: string | null = null;

    const candidate = await prisma.$transaction(async (tx) => {
      let userId: string | null = null;
      const existingUser = await tx.user.findUnique({ where: { email } });
      if (existingUser) {
        userId = existingUser.id;
      } else {
        tempPassword = generateTempPassword();
        const hashed = await bcrypt.hash(tempPassword, 10);
        const newUser = await tx.user.create({
          data: { email, password: hashed, name, role: "CANDIDATE", emailVerified: false },
        });
        userId = newUser.id;
        newlyCreatedUserId = newUser.id;

        verificationToken = generateVerificationToken();
        await tx.emailVerificationToken.create({
          data: { token: verificationToken, userId: newUser.id, expiresAt: getVerificationTokenExpiry() },
        });
      }
      return tx.candidate.create({
        data: { name, email, resumeUrl: resumeUrl ?? null, positionId, userId },
        include: { position: { select: { title: true } } },
      });
    });

    if (tempPassword) {
      sendCandidateCredentials({
        to: email,
        candidateName: name,
        email,
        temporaryPassword: tempPassword,
        positionTitle: candidate.position.title,
      }).catch((e) => console.error("Credentials email failed:", e));
    }

    if (newlyCreatedUserId && verificationToken) {
      sendVerificationEmail({
        to: email,
        candidateName: name,
        token: verificationToken,
      }).catch((e) => console.error("Verification email failed:", e));
    }

    return res.status(201).json(candidate);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return res.status(409).json({ error: "Candidate already exists for this position" });
    }
    console.error("Failed to create candidate:", e);
    return res.status(500).json({ error: "Failed to create candidate" });
  }
});

export default router;