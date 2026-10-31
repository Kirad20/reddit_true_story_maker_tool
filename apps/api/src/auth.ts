import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { fromNodeHeaders } from "better-auth/node";
import { admin } from "better-auth/plugins";
import type { NextFunction, Request, Response } from "express";
import { API_ORIGIN, DATA_DIR, PUBLIC_URL, WEB_ORIGIN } from "./config";
import { isLoopback } from "./security";

/** Better Auth lives under this path (the platform OAuth routes keep /api/auth/<platform>/...). */
export const AUTH_BASE_PATH = "/api/identity";

/** Login of the temporary setup user created when there are no users yet. */
export const SETUP_EMAIL = (process.env.SETUP_EMAIL || "setup@truestorymaker.local").toLowerCase();

/** Signing secret: BETTER_AUTH_SECRET, or one generated once and kept in the data folder. */
function authSecret(): string {
  if (process.env.BETTER_AUTH_SECRET) return process.env.BETTER_AUTH_SECRET;
  const file = path.join(DATA_DIR, "auth-secret");
  try {
    return fs.readFileSync(file, "utf8").trim();
  } catch {
    const value = randomBytes(32).toString("base64url");
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(file, value, { mode: 0o600 });
    return value;
  }
}

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, "auth.db"));
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");

const trustedOrigins = [...new Set([API_ORIGIN, WEB_ORIGIN, PUBLIC_URL].filter((o): o is string => Boolean(o)))];

const options = {
  appName: "TrueStoryMaker",
  baseURL: `${PUBLIC_URL ?? API_ORIGIN}${AUTH_BASE_PATH}`,
  basePath: AUTH_BASE_PATH,
  secret: authSecret(),
  database: db,
  trustedOrigins,
  // Accounts are created by admins in "Usuarios"; nobody can sign up on their own.
  emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 8 },
  session: { expiresIn: 60 * 60 * 24 * 14, updateAge: 60 * 60 * 24 },
  user: {
    additionalFields: {
      /** The setup user: deleted as soon as a real admin exists. */
      temporary: { type: "boolean", defaultValue: false, input: false },
    },
  },
  plugins: [admin({ defaultRole: "user", adminRoles: ["admin"] })],
  databaseHooks: {
    user: {
      create: { after: async (user) => void purgeTemporaryUsersIfReplaced(user) },
      update: { after: async (user) => void purgeTemporaryUsersIfReplaced(user) },
    },
  },
} satisfies BetterAuthOptions;

// Create/upgrade the tables before the instance starts: it checks the schema as soon as it is created.
await (await getMigrations(options)).runMigrations();

export const auth = betterAuth(options);

type AuthUser = { id: string; role?: string | null; temporary?: boolean | null };

const isAdmin = (role: string | null | undefined) => (role ?? "").split(",").includes("admin");

/** Number of admins that are not the temporary setup user. */
function realAdminCount(): number {
  const rows = db.prepare(`SELECT role FROM "user" WHERE COALESCE("temporary", 0) = 0`).all() as { role: string | null }[];
  return rows.filter((r) => isAdmin(r.role)).length;
}

/** Delete the temporary setup user (with its sessions and login) once a real admin exists. */
export function purgeTemporaryUsers(): number {
  if (realAdminCount() === 0) return 0;
  const temp = db.prepare(`SELECT id FROM "user" WHERE "temporary" = 1`).all() as { id: string }[];
  for (const { id } of temp) {
    db.prepare(`DELETE FROM "session" WHERE "userId" = ?`).run(id);
    db.prepare(`DELETE FROM "account" WHERE "userId" = ?`).run(id);
    db.prepare(`DELETE FROM "user" WHERE "id" = ?`).run(id);
  }
  if (temp.length) console.log("[auth] Temporary setup user deleted: a real admin account exists now.");
  return temp.length;
}

function purgeTemporaryUsersIfReplaced(user: AuthUser) {
  if (!user.temporary && isAdmin(user.role)) purgeTemporaryUsers();
}

/**
 * Make sure someone can log in: with no users at all a
 * temporary admin is created. Its password (SETUP_PASSWORD or a random one,
 * renewed on every start) is printed in the logs. Use it to create your own
 * admin in "Usuarios"; the temporary user is deleted right after.
 */
export async function initAuth(): Promise<void> {
  purgeTemporaryUsers();

  const { n } = db.prepare(`SELECT COUNT(*) AS n FROM "user"`).get() as { n: number };
  const temp = db.prepare(`SELECT id FROM "user" WHERE "temporary" = 1`).get() as { id: string } | undefined;
  if (n > 0 && !temp) return;

  const password = process.env.SETUP_PASSWORD || randomBytes(9).toString("base64url");
  const ctx = await auth.$context;
  if (temp) {
    await ctx.internalAdapter.updatePassword(temp.id, await ctx.password.hash(password));
  } else {
    await auth.api.createUser({
      body: { email: SETUP_EMAIL, password, name: "Usuario temporal", role: "admin", data: { temporary: true } },
    });
  }
  console.log(
    [
      "",
      "[auth] ================= TEMPORARY SETUP USER =================",
      `[auth]   email:    ${SETUP_EMAIL}`,
      `[auth]   password: ${process.env.SETUP_PASSWORD ? "(SETUP_PASSWORD)" : password}`,
      "[auth]   Log in, open Usuarios and create your own admin account.",
      "[auth]   This temporary user is deleted as soon as you do.",
      "[auth] ===========================================================",
      "",
    ].join("\n"),
  );
}

export type SessionUser = { id: string; email: string; name: string; role?: string | null; temporary?: boolean | null };

/**
 * Every /api and /media request needs a session, except health, the auth
 * endpoints themselves and the in-container renderer fetching media.
 */
export function requireSession() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const p = req.path;
    if (!p.startsWith("/api/") && !p.startsWith("/media/")) return next();
    if (p === "/api/health" || p.startsWith(`${AUTH_BASE_PATH}/`)) return next();
    if (p.startsWith("/media/") && isLoopback(req.socket.remoteAddress) && !req.headers["x-forwarded-for"]) return next();
    try {
      const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
      if (session && !(session.user as { banned?: boolean }).banned) {
        res.locals.user = session.user as SessionUser;
        return next();
      }
    } catch (error) {
      return next(error);
    }
    res.status(401).json({ error: "Inicia sesión para continuar" });
  };
}
