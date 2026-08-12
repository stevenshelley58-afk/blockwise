import type { Request, Response, NextFunction } from "express";
import { config } from "./config.js";

/**
 * Internal service auth middleware.
 * In dev mode, bypasses auth. In production, requires a Bearer token
 * matching FRANK_INTERNAL_AUTH_SECRET.
 */
export function internalAuth(req: Request, res: Response, next: NextFunction): void {
  if (config.isDev) return next();

  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const token = auth.slice(7);
  if (token !== config.internalAuthSecret) {
    res.status(403).json({ error: "forbidden" });
    return;
  }

  next();
}
