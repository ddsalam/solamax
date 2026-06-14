import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import PostgresAdapter from "@auth/pg-adapter";
import { pool } from "@/lib/db";

/**
 * Auth.js v5 — Google OAuth, sesi DATABASE (revocation seketika), adapter
 * @auth/pg-adapter di atas pool `dashboard_app`. Tabel auth di schema `app`
 * (resolve via search_path=app,public di DATABASE_URL). Otorisasi (tenant/role)
 * TIDAK di sini — lihat lib/auth-context.ts (getAuthContext). "Gmail bebas"
 * tapi invite-gated: login sukses tanpa membership → /no-access (nol data).
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PostgresAdapter(pool),
  session: { strategy: "database" },
  providers: [Google], // AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET dari env (GERBANG 2)
  pages: { signIn: "/login" },
  trustHost: true,
});
