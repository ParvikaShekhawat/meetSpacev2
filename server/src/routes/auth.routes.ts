import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma";
import { createSession, setSessionCookie, clearSessionCookie, COOKIE_NAME, verifySession } from "../lib/auth";
import { checkRateLimit, getClientIp } from "../lib/rate-limit";

const router = Router();

const MAX_PASSWORD_LENGTH = 128;
const MAX_NAME_LENGTH = 100;

// A precomputed bcrypt hash of a random, unused value — never matches any
// real password. Used to keep bcrypt.compare's timing constant whether or
// not the requested email exists, so login can't be used to enumerate
// registered emails by response time.
const DUMMY_HASH = "$2a$10$CwTycUXWue0Thq9StjUM0uJ8aXfrsxmMDpKA6VjRvzZO2jY2vJm6a";

// NOTE: public self-registration is enabled here by choice. This means
// anyone can create a CANDIDATE account with any email address, with no
// proof they own it. Combined with candidate.routes.ts (which attaches a
// new Candidate record to an existing User if one already exists for that
// email), someone could pre-register a victim's email and later gain
// access to an interview scheduled for that address by an interviewer.
// If that risk matters for your use case, the fix is email verification
// before an account is usable — flag it whenever you want to tackle it.

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
        role: "CANDIDATE",
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

    // Always run bcrypt.compare, even if no user was found, so a request
    // for a nonexistent email takes the same amount of time as one for a
    // real email with a wrong password.
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