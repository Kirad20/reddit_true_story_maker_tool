import { adminClient, inferAdditionalFields } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/** Better Auth client; the API mounts it at /api/identity (same origin, proxied by Vite in dev). */
export const authClient = createAuthClient({
  baseURL: `${window.location.origin}/api/identity`,
  plugins: [adminClient(), inferAdditionalFields({ user: { temporary: { type: "boolean", required: false, input: false } } })],
});

export type AppUser = {
  id: string;
  name: string;
  email: string;
  role?: string | null;
  banned?: boolean | null;
  temporary?: boolean | null;
  createdAt: Date | string;
};

export const isAdmin = (user: { role?: string | null } | null | undefined) => (user?.role ?? "").split(",").includes("admin");

/** Fired by the API helpers when the server answers 401 (session expired or revoked). */
export const UNAUTHORIZED_EVENT = "tsm:unauthorized";
