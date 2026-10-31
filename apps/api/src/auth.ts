import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { getMigrations } from "better-auth/db/migration";
import { fromNodeHeaders } from "better-auth/node";
import { admin } from "better-auth/plugins";
import type { NextFunction, Request, Response } from "express";
import { secret } from "./aiconfig";
import { API_ORIGIN, DATA_DIR, PUBLIC_URL, WEB_ORIGIN } from "./config";
import { FACEBOOK_SCOPES, TIKTOK_API, TIKTOK_SCOPES, YOUTUBE_SCOPES } from "./publish/scopes";
import { isLoopback } from "./security";

/**
 * Better Auth lives under this path. OAuth redirect URIs for the publishing apps are
 * <public url>/api/identity/callback/<google|tiktok|facebook>.
 */
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

/** Only scheme://host[:port] of a URL; null when it does not parse. */
const originOf = (url: string): string | null => {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};

/** Configured origins, plus extra ones in TRUSTED_ORIGINS (comma separated). */
const configuredOrigins = [
  ...new Set(
    [API_ORIGIN, WEB_ORIGIN, PUBLIC_URL, ...(process.env.TRUSTED_ORIGINS ?? "").split(",")]
      .map((o) => (o ? originOf(o.trim()) : null))
      .filter((o): o is string => Boolean(o)),
  ),
];

/**
 * Origin the browser used to reach this server, from the reverse proxy headers (Coolify/Traefik
 * send X-Forwarded-Host/Proto) or Host. The web UI is served by this same server, so a request whose
 * Origin equals its own host is same-origin; a cross-site page still sends its own Origin and is rejected.
 */
export function requestOrigin(headers: Headers): string | null {
  const first = (name: string) => headers.get(name)?.split(",")[0]?.trim() || null;
  const host = first("x-forwarded-host") ?? first("host");
  if (!host) return null;
  const proto = first("x-forwarded-proto") ?? "http";
  return originOf(`${proto}://${host}`);
}

/** Better Auth rejects sign-in from any other origin with INVALID_ORIGIN. */
export function trustedOriginsFor(request?: globalThis.Request): string[] {
  const own = request ? requestOrigin(request.headers) : null;
  return own && !configuredOrigins.includes(own) ? [...configuredOrigins, own] : configuredOrigins;
}

/**
 * YouTube (Google), TikTok and Facebook are linked to the logged-in user to publish
 * with them, never used to sign in. Their app credentials are edited at runtime in
 * Ajustes → Cuentas, so they are read through getters on every request.
 */
const socialProviders = {
  google: {
    get clientId() {
      return secret("youtube_client_id");
    },
    get clientSecret() {
      return secret("youtube_client_secret");
    },
    scope: YOUTUBE_SCOPES,
    accessType: "offline",
    prompt: "consent",
    disableSignUp: true,
  },
  tiktok: {
    get clientKey() {
      return secret("tiktok_client_key");
    },
    get clientSecret() {
      return secret("tiktok_client_secret");
    },
    // Login Kit grants user.info.basic; the default user.info.profile needs extra approval.
    disableDefaultScope: true,
    scope: TIKTOK_SCOPES,
    disableSignUp: true,
    async getUserInfo(token) {
      const res = await fetch(`${TIKTOK_API}/user/info/?fields=open_id,display_name,avatar_url`, {
        headers: { Authorization: `Bearer ${token.accessToken}` },
      });
      const profile = (await res.json().catch(() => null)) as { data?: { user?: { open_id?: string; display_name?: string; avatar_url?: string } } } | null;
      const user = profile?.data?.user;
      if (!res.ok || !user?.open_id) return null;
      return {
        // The account id comes from data.data.user.open_id.
        user: { name: user.display_name ?? "", email: `${user.open_id}@tiktok.invalid`, image: user.avatar_url, emailVerified: false },
        data: profile as never,
      };
    },
  },
  facebook: {
    get clientId() {
      return secret("facebook_app_id");
    },
    get clientSecret() {
      return secret("facebook_app_secret");
    },
    scope: FACEBOOK_SCOPES,
    disableSignUp: true,
  },
} satisfies BetterAuthOptions["socialProviders"];

export type LinkedAccountEvent = { providerId: string; userId: string; accountId: string; userName: string | null };
const linkListeners = new Set<(event: LinkedAccountEvent) => Promise<void> | void>();
/** Called after a user connected (or reconnected) a social account. */
export const onAccountLinked = (fn: (event: LinkedAccountEvent) => Promise<void> | void) => void linkListeners.add(fn);

function accountLinked(account: { id: string; userId: string; providerId: string }, ctx: { path?: string } | null | undefined) {
  // Only real link callbacks: token refreshes also update the account row.
  if (account.providerId === "credential" || !ctx?.path?.startsWith("/callback/")) return;
  const user = db.prepare(`SELECT name FROM "user" WHERE id = ?`).get(account.userId) as { name: string } | undefined;
  const event = { providerId: account.providerId, userId: account.userId, accountId: account.id, userName: user?.name ?? null };
  // After the request: listeners call back into Better Auth for the (decrypted) token.
  setImmediate(() => {
    for (const fn of linkListeners) Promise.resolve(fn(event)).catch((e) => console.error("[auth] account link listener failed:", e));
  });
}

export const linkedAccountExists = (accountId: string): boolean => Boolean(db.prepare(`SELECT 1 FROM "account" WHERE id = ?`).get(accountId));
export const deleteAccountRow = (accountId: string): void => void db.prepare(`DELETE FROM "account" WHERE id = ?`).run(accountId);

const options = {
  appName: "TrueStoryMaker",
  baseURL: `${PUBLIC_URL ?? API_ORIGIN}${AUTH_BASE_PATH}`,
  basePath: AUTH_BASE_PATH,
  secret: authSecret(),
  database: db,
  trustedOrigins: trustedOriginsFor,
  // Accounts are created by admins in "Usuarios"; nobody can sign up on their own.
  emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 8 },
  session: { expiresIn: 60 * 60 * 24 * 14, updateAge: 60 * 60 * 24 },
  user: {
    additionalFields: {
      /** The setup user: deleted as soon as a real admin exists. */
      temporary: { type: "boolean", defaultValue: false, input: false },
    },
  },
  socialProviders,
  account: {
    // Tokens are stored encrypted with the auth secret.
    encryptOAuthTokens: true,
    // The channel/page account rarely shares the user's login email (TikTok gives none at all).
    accountLinking: { enabled: true, allowDifferentEmails: true, trustedProviders: ["google", "tiktok", "facebook"] },
  },
  plugins: [admin({ defaultRole: "user", adminRoles: ["admin"] })],
  hooks: {
    // Social accounts are only linked for publishing: signing in with them is not allowed.
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path === "/sign-in/social" || ctx.path === "/sign-in/oauth2") {
        throw new APIError("FORBIDDEN", { message: "Inicia sesión con tu correo y contraseña" });
      }
    }),
  },
  logger: {
    log(level, message, ...args) {
      // Expected until the platform credentials are filled in Ajustes.
      if (/missing clientId/.test(message)) return;
      console[level === "error" ? "error" : level === "warn" ? "warn" : "log"](`[auth] ${message}`, ...args);
    },
  },
  databaseHooks: {
    account: {
      create: { after: async (account, ctx) => accountLinked(account, ctx) },
      update: { after: async (account, ctx) => accountLinked(account, ctx) },
    },
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
  console.log(`[auth] trusted origins: ${configuredOrigins.join(", ")} (+ the domain each request arrives on)`);
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
