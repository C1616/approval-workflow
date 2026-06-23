import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { Role } from "@prisma/client";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signToken(user: AuthUser): string {
  return jwt.sign(user, JWT_SECRET, { expiresIn: "7d" });
}

/**
 * Reads the auth token from either the httpOnly cookie (used by the
 * browser frontend) or an Authorization: Bearer header (used by tests /
 * API clients), verifies it, and attaches the decoded user to req.user.
 * Responds 401 if missing or invalid - every route below this
 * middleware can assume req.user is populated.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const headerToken = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.slice(7)
    : undefined;
  const token = req.cookies?.token || headerToken;

  if (!token) {
    return res.status(401).json({ error: "Not authenticated." });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthUser;
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired session." });
  }
}

/**
 * Route guard factory: returns middleware that 403s unless req.user's
 * role is in the allowed set. Must run after requireAuth.
 */
export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: "Not authenticated." });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: `This action requires role: ${roles.join(" or ")}.`,
      });
    }
    next();
  };
}
