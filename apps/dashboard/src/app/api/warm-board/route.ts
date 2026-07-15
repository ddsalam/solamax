/**
 * POST /api/warm-board — pre-warm cache G/L board (Cloud Scheduler, harian pagi
 * WIB setelah jendela deep-rescan agent 02:00–05:00).
 *
 * KEAMANAN: hanya shared secret (header `x-warm-secret` == env WARM_BOARD_SECRET
 * dari Secret Manager, constant-time). Tanpa/salah kredensial → 401 kosong.
 * Respons sukses 204 TANPA DATA — route ini tidak pernah mengembalikan angka.
 *
 * Mengisi cache dengan memanggil getDailyGlWindow() langsung (key identik
 * dengan render halaman) untuk SEMUA unit aktif × jendela preset. Konteks
 * sistem tanpa user → daftar unit dari public.unit (tabel master, non-RLS,
 * pola getDataScope); cast ScopedUnitId sah di sini karena TIDAK ada data yang
 * keluar ke pemanggil (204) dan qScoped tetap men-set konteks RLS per unit.
 * Berjalan SEKUENSIAL per (unit × jendela) agar tak menjenuhkan pool (max 5).
 */
import { q } from "@/lib/db";
import { getDailyGlWindow } from "@/lib/gl-window";
import { boardWarmPlan, isWarmAuthorized } from "@/lib/board-warm";
import { todayWib } from "@/lib/periods";
import type { ScopedUnitId } from "@/lib/scope-rule";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  if (!isWarmAuthorized(req.headers.get("x-warm-secret"), process.env.WARM_BOARD_SECRET)) {
    return new Response(null, { status: 401 });
  }

  const t0 = Date.now();
  const today = todayWib();
  const units = await q<{ unit_id: number; code: string }>(
    `SELECT unit_id, code FROM public.unit WHERE active ORDER BY unit_id`,
  );
  const plan = boardWarmPlan(today);

  let calls = 0;
  for (const u of units) {
    for (const w of plan) {
      await getDailyGlWindow(u.unit_id as ScopedUnitId, w.from, w.to);
      calls += 1;
    }
  }

  console.log(
    JSON.stringify({
      msg: "warm-board selesai",
      today,
      units: units.length,
      windows: plan.length,
      calls,
      ms: Date.now() - t0,
    }),
  );
  return new Response(null, { status: 204 });
}
