import { Request, Response, NextFunction } from "express";
import { COOKIE_NAME, verifySession, type SessionUser } from "../lib/auth";
import type { UserRole } from "@prisma/client";

export interface AuthenticatedRequest extends Request {
  user?: SessionUser;
}

export async function authenticate(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const authHeader = req.headers.authorization;
    let token = req.cookies?.[COOKIE_NAME];

    if (!token && authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.substring(7);
    }

    if (!token) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const session = await verifySession(token);
    if (!session) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    req.user = session;
    next();
  } catch (error) {
    return res.status(401).json({ error: "Unauthorized" });
  }
}

export function requireRole(...roles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    next();
  };
}