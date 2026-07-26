/**
 * Hitung AKSES EFEKTIF setiap membership lewat LAPIS APLIKASI — bukan lewat SQL.
 *
 * Kenapa ada: post-condition migrasi 0019 sudah membandingkan aturan-lama vs
 * aturan-baru di lapis SQL saat migrate. Mengulang SQL yang sama di GATE 3 hanya
 * menjalankan jaring yang SAMA dua kali. Skrip ini memakai jalur produksi yang
 * sebenarnya — `ACTIVE_MEMBERSHIPS_SQL` → `toAssignments` → `resolveRole` →
 * `unitVisible` atas daftar unit yang sama dengan `getDataScope` (scope.ts) —
 * sehingga hasilnya jaring KEDUA yang independen dari post-condition.
 *
 * Satu-satunya bagian getAuthContext yang tidak dipakai adalah pencarian sesi
 * Auth.js (`auth()`), yang memang bukan bagian otorisasi.
 *
 * READ-ONLY. Tidak pernah menulis apa pun.
 *
 *   DATABASE_URL="postgresql://dashboard_app:…@127.0.0.1:PORT/solamax?options=-c%20search_path%3Dapp,public" \
 *     node --experimental-strip-types apps/dashboard/scripts/akses-efektif.mts
 */
import { Pool } from "pg";
import {
  ACTIVE_MEMBERSHIPS_SQL,
  toAssignments,
  type MembershipRow,
} from "../src/lib/membership-query.ts";
import { resolveRole, unitVisible } from "../src/lib/scope-rule.ts";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL belum di-set");

const pool = new Pool({ connectionString: url, max: 2 });

const sysid = (await pool.query("SELECT system_identifier::text AS s FROM pg_control_system()"))
  .rows[0].s as string;
const INSTANCE =
  sysid === "7650126488674766864"
    ? "LIVE solamax-pg"
    : sysid === "7659054651798528016"
      ? "TEST solamax-pg-rlsstg"
      : "TIDAK DIKENAL";
console.log(`# instance: ${INSTANCE} (system_identifier=${sysid})`);

// Query unit IDENTIK dengan getDataScope (scope.ts).
const units = (
  await pool.query(
    `SELECT unit_id, code, name, tenant_id FROM public.unit WHERE active ORDER BY unit_id`,
  )
).rows as { unit_id: number; code: string; tenant_id: string | null }[];

const users = (
  await pool.query(
    `SELECT DISTINCT u.id, u.email FROM app.users u
       JOIN app.membership m ON m.user_id = u.id ORDER BY u.email`,
  )
).rows as { id: number; email: string | null }[];

const baris: string[] = [];
for (const u of users) {
  const rows = (await pool.query(ACTIVE_MEMBERSHIPS_SQL, [u.id])).rows as MembershipRow[];
  if (rows.length === 0) {
    baris.push(`${u.email}\t(no-access)\t\t(KOSONG)`);
    continue;
  }
  const { role, conflict } = resolveRole(rows.map((r) => r.role));
  const assignments = toAssignments(rows);
  const terlihat = units
    .filter((x) => unitVisible({ role, assignments }, x))
    .map((x) => x.code);
  const tenant = [...new Set(rows.map((r) => r.tenant_id ?? "(global)"))].sort().join("+");
  baris.push(
    `${u.email}\t${role}${conflict ? " ⚠️KONFLIK" : ""}\t${tenant}\t${terlihat.join(",") || "(KOSONG)"}`,
  );
}
console.log("email\trole\ttenant\tunit_efektif");
for (const b of baris.sort()) console.log(b);
await pool.end();
