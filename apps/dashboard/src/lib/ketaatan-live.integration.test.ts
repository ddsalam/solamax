import { afterAll, describe, expect, it } from "vitest";
import { adminStatus, SETORAN_TOLERANSI_RP } from "./compliance";
import { uangTunai } from "./rekon";
import type { ScopedUnitId } from "./scope-rule";

/**
 * VERIFIKASI KETAATAN ADMINISTRASI DB-LIVE — FIXTURE-FREE & READ-ONLY.
 * Menjalankan QUERY PRODUKSI (`getAdminDays`, lewat qScoped/RLS) + ATURAN
 * PRODUKSI (`adminStatus`) terhadap unit-hari NYATA di DB pilot, dan menuntut
 * ketiga cabang keputusan Gate 1 benar-benar muncul pada data sungguhan —
 * bukan cuma pada fixture.
 *
 * Jalan hanya bila SCOPE_LIVE_DB=1 & DATABASE_URL di-set (CI default skip).
 */
const LIVE = process.env.SCOPE_LIVE_DB === "1" && !!process.env.DATABASE_URL;
const d = LIVE ? describe : describe.skip;

const U = (n: number) => n as unknown as ScopedUnitId;

/** Kasus NYATA, dikunci saat Fase 0 (snapshot 2026-08-07). */
const KASUS = {
  // IB — lengkap & selaras (H berpecahan, I bulat ribuan; selisih +747).
  selaras: { unit: 1, tanggal: "2026-07-24", kode: "selaras" },
  // 28 Oktober — kelebihan setor nyata +605.048 → KUNING (keputusan Gate 1 Q1;
  // aturan lama `I ≥ H` menghijaukan ini).
  lebih: { unit: 7, tanggal: "2026-08-04", kode: "lebih_setor" },
  // IB — kekurangan setor nyata −805.289,52 → MERAH.
  kurang: { unit: 1, tanggal: "2026-07-16", kode: "kurang_setor" },
} as const;

d("ketaatan administrasi live — cabang keputusan pada data pilot nyata", () => {
  afterAll(async () => {
    const { pool } = await import("./db");
    await pool.end();
  });

  const ambil = async (unit: number, tanggal: string) => {
    const { getAdminDays } = await import("./queries");
    const rows = await getAdminDays([U(unit)], tanggal, tanggal);
    const r = rows[0];
    if (!r) throw new Error(`tak ada baris untuk unit ${unit} ${tanggal}`);
    const h = uangTunai({ A: r.compA, B: r.compB, C: r.compC, D: r.compD, F: r.compF, G: r.compG });
    // "today" jauh di depan → semua tanggal uji sudah lewat jatuh tempo.
    const v = adminStatus(
      {
        nPendapatanLain: r.nPendapatanLain,
        nPengeluaran: r.nPengeluaran,
        nSetoran: r.nSetoran,
        h,
        i: r.setoran,
        shifts: r.shifts,
      },
      { businessDate: tanggal, today: "2026-08-07" },
    );
    return { r, h, v };
  };

  it("HIJAU: IB 2026-07-24 lengkap & selaras (pembulatan ribuan bukan pelanggaran)", async () => {
    const { h, v, r } = await ambil(KASUS.selaras.unit, KASUS.selaras.tanggal);
    expect(v.kode).toBe("selaras");
    expect(v.tone).toBe("green");
    expect(Math.abs((r.setoran ?? 0) - h)).toBeLessThanOrEqual(SETORAN_TOLERANSI_RP);
    expect(r.setoran! % 1000).toBe(0); // setoran SELALU kelipatan ribuan
  }, 30_000);

  it("KUNING: 28 Oktober 2026-08-04 kelebihan setor nyata (dulu hijau diam-diam)", async () => {
    const { h, v, r } = await ambil(KASUS.lebih.unit, KASUS.lebih.tanggal);
    expect(v.kode).toBe("lebih_setor");
    expect(v.tone).toBe("yellow");
    expect((r.setoran ?? 0) - h).toBeGreaterThan(SETORAN_TOLERANSI_RP);
    expect((r.setoran ?? 0) >= h).toBe(true); // KONTROL: aturan lama `I ≥ H` lolos
  }, 30_000);

  it("MERAH: IB 2026-07-16 kekurangan setor nyata", async () => {
    const { h, v, r } = await ambil(KASUS.kurang.unit, KASUS.kurang.tanggal);
    expect(v.kode).toBe("kurang_setor");
    expect(v.tone).toBe("red");
    expect(h - (r.setoran ?? 0)).toBeGreaterThan(SETORAN_TOLERANSI_RP);
  }, 30_000);

  it("MERAH: ada unit-hari lewat tempo yang benar-benar KOSONG (seksi tak diisi)", async () => {
    const { getAdminDays } = await import("./queries");
    const rows = await getAdminDays(
      [U(1), U(2), U(3), U(4), U(5), U(6), U(7)],
      "2026-07-01",
      "2026-08-05",
    );
    const merah = rows
      .map((r) => {
        const h = uangTunai({
          A: r.compA, B: r.compB, C: r.compC, D: r.compD, F: r.compF, G: r.compG,
        });
        return {
          r,
          v: adminStatus(
            {
              nPendapatanLain: r.nPendapatanLain,
              nPengeluaran: r.nPengeluaran,
              nSetoran: r.nSetoran,
              h,
              i: r.setoran,
              shifts: r.shifts,
            },
            { businessDate: r.d, today: "2026-08-07" },
          ),
        };
      })
      .filter((x) => x.v.kode === "belum_diisi");
    // KONTROL: array kosong tak boleh lolos sebagai "sukses" — .every() atas
    // himpunan kosong bernilai true dan akan MENYEMBUNYIKAN kegagalan.
    expect(merah.length).toBeGreaterThan(0);
    for (const m of merah) {
      expect(m.r.nPendapatanLain + m.r.nPengeluaran + m.r.nSetoran).toBe(0);
      expect(m.v.tone).toBe("red");
    }
  }, 60_000);
});
