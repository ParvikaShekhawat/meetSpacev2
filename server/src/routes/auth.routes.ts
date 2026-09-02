import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma";
import { createSession, setSessionCookie, clearSessionCookie, COOKIE_NAME, verifySession } from "../lib/auth";
import { checkRateLimit, getClientIp } from "../lib/rate-limit";
import { config } from "../config/env";

const router = Router();

const MAX_PASSWORD_LENGTH = 128;
const MAX_NAME_LENGTH = 100;

const DUMMY_HASH = "$2a$10$CwTycUXWue0Thq9StjUM0uJ8aXfrsxmMDpKA6VjRvzZO2jY2vJm6a";

// Self-registration policy:
// - CANDIDATE: fully open, no gate (matches candidate.routes.ts auto-creation flow).
// - INTERVIEWER: requires a shared invite code (config.interviewerInviteCode) to
//   prevent anyone from self-granting interviewer privileges. If that code is
//   unset in production, interviewer self-signup is disabled entirely.
// Neither path verifies email ownership yet — see candidate email verification
// gap tracked separately.

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
      },
    });

    const token = await createSession({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    });

    setSessionCookie(res, token);
    return res.json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      token,
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
    });

    setSessionCookie(res, token);
    return res.json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      token,
    });
  } catch (error) {
    console.error("Login failed:", error);
    return res.status(500).json({ error: "Login failed" });
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