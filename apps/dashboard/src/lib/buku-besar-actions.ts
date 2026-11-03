"use server";

import { pool } from "./db";
import { canTutupBulan } from "./keuangan-wewenang";
import { getDataScope } from "./scope";
import { bentukUlangRentang } from "./buku-besar-tulis";

/**
 * Server action "Bentuk ulang buku besar" (rencana 2026-11-02 K6 U8; R7,
 * KTD3) — backfill sejak 1 Okt 2026 dan pemulihan, untuk satu unit dan satu
 * rentang tanggal.
 *
 * ⛔ YANG MENGIKAT:
 *
 * 1. **Hanya Head of Finance + super admin** — predikat `canTutupBulan`, sebab
 *    backfill ke bulan yang ditutup K5 setara wewenang tutup bulan: keduanya
 *    menentukan isi bulan yang sudah final. Staf `keuangan` tidak.
 * 2. **Yang datang dari klien hanya unit dan rentang.** Jurnal diturunkan dari
 *    catatan sumber di server; tak ada angka dari klien.
 * 3. **Satu transaksi pendek per hari** (`bentukUlangRentang`): idempoten, bisa
 *    diulang dari hari yang gagal. Rentang yang memuat bulan yang sudah ditutup
 *    dengan buku besar ditolak seluruhnya sebelum hari pertama ditulis.
 */

export interface BentukUlangInput {
  code: string;
  /** `YYYY-MM-DD`. */
  dari: string;
  /** `YYYY-MM-DD`. */
  sampai: string;
}

export type BentukUlangResult =
  | { ok: true; hari: number; ditulis: number; dihapus: number; koreksi: number; temuan: number; pesan: string }
  | { ok: false; error: string; hariSelesai: number };

export async function bentukUlangBukuBesar(input: BentukUlangInput): Promise<BentukUlangResult> {
  const scope = await getDataScope();
  const unit = scope.requireUnit(input.code); // di luar scope → notFound()
  if (!canTutupBulan({ role: scope.role, email: scope.email })) {
    return { ok: false, error: "Hanya Head of Finance yang boleh membentuk ulang buku besar.", hariSelesai: 0 };
  }
  try {
    const r = await bentukUlangRentang(() => pool.connect(), unit.unit_id, input.dari, input.sampai, {
      aktor: { userId: scope.userId, email: scope.email },
    });
    if (!r.ok) return { ok: false, error: r.error, hariSelesai: r.hari.length };
    const jumlah = (f: (h: (typeof r.hari)[number]) => number) => r.hari.reduce((s, h) => s + f(h), 0);
    return {
      ok: true,
      hari: r.hari.length,
      ditulis: jumlah((h) => h.ditulis),
      dihapus: jumlah((h) => h.dihapus),
      koreksi: jumlah((h) => (h.koreksi ? 1 : 0)),
      temuan: jumlah((h) => h.temuan.length),
      pesan: `Buku besar ${unit.code} ${input.dari} s.d. ${input.sampai} dibentuk ulang (${r.hari.length} hari).`,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Gagal membentuk ulang buku besar.", hariSelesai: 0 };
  }
}
