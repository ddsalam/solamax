/**
 * Penjaga BUDGET KONEKSI Cloud SQL.
 *
 * Sejarahnya: `max: 5` dan `connectionTimeoutMillis: 10_000` dipasang saat
 * insiden saturasi koneksi 30 Juni 2026, ketika instance masih **db-f1-micro**
 * (max_connections 25 → 22 terpakai). Instance kemudian di-bump ke db-g1-small
 * (50 → 47 terpakai) dan **pool tidak pernah ikut ditinjau** — komentarnya masih
 * menyebut f1-micro sampai 2026-08-05. Perbaikan insiden yang membeku jadi
 * konfigurasi permanen, dengan premis yang sudah gugur dan tak ada yang berbunyi.
 *
 * Test ini yang berbunyi. Ia MEMBACA `max:` dari `db.ts` (readFileSync, bukan
 * grep — `apps/agent/src/domains.ts` membuktikan grep bisa melewatkan berkas
 * tanpa pesan) lalu menghitung ulang budget menyeluruh. Menaikkan pool melewati
 * kapasitas instance = MERAH, bukan insiden.
 *
 * Angka non-kode di bawah adalah konfigurasi DEPLOY, jadi tak bisa di-import.
 * Semuanya diukur langsung di pilot 2026-08-05 — bila salah satunya berubah,
 * perbarui di sini bersamaan dengan perubahannya.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** `max_connections` Cloud SQL solamax-pg (db-g1-small). */
const MAX_CONNECTIONS = 50;
/** `superuser_reserved_connections` — tak tersedia untuk aplikasi. */
const SUPERUSER_RESERVED = 3;
/** Cloud Run dashboard pilot: autoscaling.knative.dev/maxScale. */
const DASHBOARD_MAX_SCALE = 2;
/** Cloud Run backend ingest pilot: maxScale × Prisma connection_limit. */
const INGEST_MAX_SCALE = 2;
const INGEST_CONNECTION_LIMIT = 3;
/** Koneksi cloudsqladmin/cloudsqlagent yang terukur hidup di instance. */
const CLOUD_SQL_INTERNAL = 4;

export const USABLE = MAX_CONNECTIONS - SUPERUSER_RESERVED;

/** Total koneksi terburuk yang bisa dipegang seluruh sistem. */
export function connectionBudget(dashboardPoolMax: number): number {
  return (
    DASHBOARD_MAX_SCALE * dashboardPoolMax +
    INGEST_MAX_SCALE * INGEST_CONNECTION_LIMIT +
    CLOUD_SQL_INTERNAL
  );
}

/** `max: N` dari sumber db.ts — nilai yang BENAR-BENAR dipakai runtime. */
export function readPoolMax(src: string): number | null {
  const m = src.match(/^\s*max:\s*(\d+)\s*,/m);
  return m?.[1] ? Number(m[1]) : null;
}

describe("budget koneksi Cloud SQL", () => {
  const src = readFileSync(join(__dirname, "db.ts"), "utf8");

  it("pool dashboard terbaca dari db.ts (anti-vakum)", () => {
    // Tanpa ini, `max:` yang berpindah/berganti nama membuat test di bawah
    // memeriksa `null` dan hijau selamanya.
    expect(src.length).toBeGreaterThan(500);
    expect(src).toContain("connectionTimeoutMillis");
    expect(readPoolMax(src)).toBeTypeOf("number");
  });

  it("budget muat di kapasitas instance", () => {
    const poolMax = readPoolMax(src)!;
    const total = connectionBudget(poolMax);
    expect(
      total,
      `Budget koneksi ${total} > ${USABLE} terpakai (max_connections ` +
        `${MAX_CONNECTIONS} − ${SUPERUSER_RESERVED} superuser_reserved). ` +
        `Dashboard ${DASHBOARD_MAX_SCALE}×${poolMax} + ingest ` +
        `${INGEST_MAX_SCALE}×${INGEST_CONNECTION_LIMIT} + internal ` +
        `${CLOUD_SQL_INTERNAL}. Naikkan tier atau turunkan pool/maxScale — ` +
        `JANGAN biarkan lewat: inilah insiden 30 Juni 2026 terulang.`,
    ).toBeLessThanOrEqual(USABLE);
  });

  it("pool cukup besar untuk fan-out halaman Laporan", () => {
    // Sisi satunya: pool yang terlalu KECIL juga cacat. Render Laporan menembak
    // 17 query paralel; dengan 5 slot ia mati di connectionTimeoutMillis.
    expect(readPoolMax(src)!).toBeGreaterThanOrEqual(10);
  });

  it("hitungannya sendiri bisa MERAH (kontrol non-vakum)", () => {
    expect(readPoolMax("  max: 10,\n")).toBe(10);
    expect(readPoolMax("tidak ada konfigurasi pool di sini")).toBeNull();
    expect(connectionBudget(10)).toBe(30); // 20 + 6 + 4
    expect(connectionBudget(10)).toBeLessThanOrEqual(USABLE);
    expect(connectionBudget(19)).toBeGreaterThan(USABLE); // 38 + 6 + 4 = 48 > 47
  });
});
