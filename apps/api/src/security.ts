import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

/** Requests from inside the container: the Remotion renderer fetching media, Docker healthchecks. */
export function isLoopback(address: string | undefined): boolean {
  if (!address) return false;
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Parse "Basic base64(user:pass)". */
export function parseBasicAuth(header: string | undefined): { user: string; password: string } | null {
  const match = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(header ?? "");
  if (!match) return null;
  const decoded = Buffer.from(match[1], "base64").toString("utf8");
  const sep = decoded.indexOf(":");
  if (sep < 0) return null;
  return { user: decoded.slice(0, sep), password: decoded.slice(sep + 1) };
}

/**
 * HTTP Basic auth for the whole app (UI, API, media). Health checks and
 * loopback requests (the renderer inside the container) are exempt.
 */
export function basicAuth(user: string, password: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.path === "/api/health" || isLoopback(req.socket.remoteAddress)) return next();
    const creds = parseBasicAuth(req.headers.authorization);
    if (creds && safeEqual(creds.user, user) && safeEqual(creds.password, password)) return next();
    res.setHeader("WWW-Authenticate", 'Basic realm="TrueStoryMaker", charset="UTF-8"');
    res.status(401).send("Authentication required");
  };
}

/** Conservative security headers for the single-origin deployment. */
export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  next();
}
