import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma";
import { createSession, setSessionCookie, clearSessionCookie, COOKIE_NAME, verifySession } from "../lib/auth";
import { checkRateLimit, getClientIp } from "../lib/rate-limit";
import { config } from "../config/env";
import { generateVerificationToken, getVerificationTokenExpiry } from "../lib/utils";
import { sendVerificationEmail } from "../services/email.service";

const router = Router();

const MAX_PASSWORD_LENGTH = 128;
const MAX_NAME_LENGTH = 100;

const DUMMY_HASH = "$2a$10$CwTycUXWue0Thq9StjUM0uJ8aXfrsxmMDpKA6VjRvzZO2jY2vJm6a";

// Self-registration policy:
// - CANDIDATE: open signup, but the account starts unverified (emailVerified: false).
//   A verification email is sent; unverified candidates can log in and browse but
//   are blocked from joining an interview or running code until verified (see
//   livekit.routes.ts / code.routes.ts).
// - INTERVIEWER: requires a shared invite code (config.interviewerInviteCode).
//   Interviewer accounts are NOT subject to email verification — the invite code
//   is the gate for that role.

router.post("/register", async (req: Request, res: Response) => {
  try {
    const ip = getClientIp(req);
    const limit = checkRateLimit(`register:${ip}`, 10, 60 * 60 * 1000);
    if (!limit.allowed) {
      return res.status(429).json({
        error: "Too many registration attempts. Please try again later.",
      });
    }

    const email = (req.body.email as string | undefined)?.trim().toLowerCase();
    const password = req.body.password as string | undefined;
    const name = (req.body.name as string | undefined)?.trim();
    const roleInput = (req.body.role as string | undefined)?.trim().toUpperCase();
    const inviteCode = req.body.inviteCode as string | undefined;

    if (!email || !password || !name) {
      return res.status(400).json({ error: "Name, email, and password are required" });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }
    if (password.length > MAX_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `Password must be ${MAX_PASSWORD_LENGTH} characters or fewer` });
    }
    if (name.length > MAX_NAME_LENGTH) {
      return res.status(400).json({ error: `Name must be ${MAX_NAME_LENGTH} characters or fewer` });
    }

    let role: "CANDIDATE" | "INTERVIEWER" = "CANDIDATE";

    if (roleInput === "INTERVIEWER") {
      if (!config.interviewerInviteCode) {
        return res.status(403).json({ error: "Interviewer signup is currently disabled" });
      }
      if (inviteCode !== config.interviewerInviteCode) {
        return res.status(403).json({ error: "Invalid invite code" });
      }
      role = "INTERVIEWER";
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: "Email already registered" });
    }

    const hashed = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        email,
        password: hashed,
        name,
        role,
        emailVerified: role === "INTERVIEWER", // interviewers skip email verification
      },
    });

    if (role === "CANDIDATE") {
      const token = generateVerificationToken();
      await prisma.emailVerificationToken.create({
        data: { token, userId: user.id, expiresAt: getVerificationTokenExpiry() },
      });
      sendVerificationEmail({ to: user.email, candidateName: user.name, token }).catch((e) =>
        console.error("Failed to send verification email:", e)
      );
    }

    const sessionToken = await createSession({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      emailVerified: user.emailVerified,
    });

    setSessionCookie(res, sessionToken);
    return res.json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role, emailVerified: user.emailVerified },
      token: sessionToken,
    });
  } catch (error) {
    console.error("Registration failed:", error);
    return res.status(500).json({ error: "Registration failed" });
  }
});

router.post("/login", async (req: Request, res: Response) => {
  try {
    const ip = getClientIp(req);
    const limit = checkRateLimit(`login:${ip}`, 20, 15 * 60 * 1000);
    if (!limit.allowed) {
      return res.status(429).json({
        error: "Too many login attempts. Please try again later.",
      });
    }

    const email = (req.body.email as string | undefined)?.trim().toLowerCase();
    const password = req.body.password as string | undefined;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }
    if (password.length > MAX_PASSWORD_LENGTH) {
      return res.status(400).json({ error: "Invalid credentials" });
    }

    const user = await prisma.user.findUnique({ where: { email } });

    const passwordMatches = await bcrypt.compare(password, user?.password ?? DUMMY_HASH);

    if (!user || !passwordMatches) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = await createSession({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      emailVerified: user.emailVerified,
    });

    setSessionCookie(res, token);
    return res.json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role, emailVerified: user.emailVerified },
      token,
    });
  } catch (error) {
    console.error("Login failed:", error);
    return res.status(500).json({ error: "Login failed" });
  }
});

router.post("/verify-email", async (req: Request, res: Response) => {
  try {
    const token = req.body.token as string | undefined;
    if (!token) {
      return res.status(400).json({ error: "Token is required" });
    }

    const record = await prisma.emailVerificationToken.findUnique({ where: { token } });
    if (!record) {
      return res.status(400).json({ error: "Invalid or expired verification link" });
    }
    if (record.expiresAt < new Date()) {
      await prisma.emailVerificationToken.delete({ where: { token } });
      return res.status(400).json({ error: "Verification link has expired" });
    }

    await prisma.$transaction([
      prisma.user.update({ where: { id: record.userId }, data: { emailVerified: true } }),
      prisma.emailVerificationToken.deleteMany({ where: { userId: record.userId } }),
    ]);

    return res.json({ success: true });
  } catch (error) {
    console.error("Email verification failed:", error);
    return res.status(500).json({ error: "Verification failed" });
  }
});

router.get("/me", async (req: Request, res: Response) => {
  try {
    let token = req.cookies?.[COOKIE_NAME];
    const authHeader = req.headers.authorization;
    if (!token && authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.substring(7);
    }

    if (!token) {
      return res.json({ user: null });
    }

    const session = await verifySession(token);
    return res.json({ user: session });
  } catch (error) {
    console.error("Failed to verify session:", error);
    return res.json({ user: null });
  }
});

router.post("/logout", (_req: Request, res: Response) => {
  clearSessionCookie(res);
  return res.json({ success: true });
});

export default router;