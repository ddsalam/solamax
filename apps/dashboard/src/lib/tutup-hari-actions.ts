"use server";

import { revalidatePath } from "next/cache";
import { pool } from "./db";
import { periksaTutupHari, tierFor } from "./keuangan-tutup-hari";
import { getDataScope, type ScopedUnitId } from "./scope";

/**
 * Server action gerbang tutup hari (Layar 4).
 *
 * ⛔ EMPAT HAL YANG MENGIKAT:
 *
 * 1. **SELISIH DIBACA ULANG DI SERVER.** Yang datang dari client hanyalah
 *    kode alasan & tanggal target. Kalau selisihnya boleh dikirim browser,
 *    seluruh tangga §3.2 bisa dilewati dengan mengirim `0`.
 * 2. **Tier adalah FUNGSI dari selisih**, bukan pilihan — `tierFor()`, dan DB
 *    menegakkan ulang lewat CHECK `day_close_tier_matches_difference` (0026).
 * 3. **Aturan diputuskan SATU tempat**: `periksaTutupHari`. Berkas ini tidak
 *    menyalin satu pun ambang; menyalinnya berarti layar, aksi, dan laporan
 *    bisa menjawab berbeda untuk pertanyaan yang sama.
 * 4. **Selisih tidak pernah dinolkan atau dibulatkan** — ia disimpan apa
 *    adanya, termasuk yang di dalam toleransi.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type TutupResult =
  | { ok: true; tier: string }
  | { ok: false; error: string; kurang?: readonly string[] };

export interface TutupHariInput {
  code: string;
  date: string;
  reasonCode: string | null;
  targetDate: string | null;
  /** Persetujuan eksplisit untuk tier di luar toleransi. */
  setujui: boolean;
}

export async function tutupHari(input: TutupHariInput): Promise<TutupResult> {
  const scope = await getDataScope();
  const unit = scope.requireUnit(input.code); // di luar scope → notFound()
  if (!DATE_RE.test(input.date)) return { ok: false, error: "Tanggal tak valid." };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.unit_ids', $1, true)", [String(unit.unit_id)]);

    // Baris day_close disiapkan lebih dulu oleh perhitungan harian; kalau belum
    // ada, harinya belum bisa dinilai — dan menutup hari yang belum dinilai
    // adalah menutup mata, bukan menutup buku.
    const cur = await client.query<{ differenceRp: string; status: string }>(
      `SELECT difference_rp::text AS "differenceRp", status::text AS status
         FROM app.day_close
        WHERE unit_id = $1 AND business_date = $2::date
        FOR UPDATE`,
      [unit.unit_id, input.date],
    );
    const row = cur.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      return {
        ok: false,
        error:
          "Hari ini belum punya baris penilaian. Selisihnya harus dihitung lebih dulu " +
          "sebelum bisa ditutup.",
      };
    }
    if (row.status === "closed") {
      await client.query("ROLLBACK");
      return { ok: false, error: "Hari ini sudah ditutup." };
    }

    // Selisih dari DB, bukan dari payload (butir 1).
    const differenceRp = Number(row.differenceRp);

    // `requires_target_date` dibaca dari MASTER, bukan dari nama kodenya —
    // tak ada 'CLS-INVESTIGATING' yang di-hardcode di mana pun.
    let reasonRequiresTarget: boolean | null = null;
    if (input.reasonCode) {
      const rc = await client.query<{ requires: boolean }>(
        `SELECT requires_target_date AS requires FROM app.reason_code
          WHERE code = $1 AND applies_to = 'closing' AND active`,
        [input.reasonCode],
      );
      if (rc.rowCount === 0) {
        await client.query("ROLLBACK");
        return { ok: false, error: "Kode alasan tak dikenal untuk penutupan hari." };
      }
      reasonRequiresTarget = rc.rows[0]!.requires;
    }

    const hasil = periksaTutupHari(
      { differenceRp, reasonCode: input.reasonCode, reasonRequiresTarget, targetDate: input.targetDate },
      { role: scope.role, email: scope.email },
      { sudahDisetujui: input.setujui },
    );
    if (!hasil.boleh) {
      await client.query("ROLLBACK");
      return { ok: false, error: pesanKurang(hasil.kurang), kurang: hasil.kurang };
    }

    const tier = tierFor(differenceRp);
    const perluPersetujuan = tier !== "within_tolerance";
    await client.query(
      `UPDATE app.day_close
          SET status='closed', tier=$1::app.day_close_tier,
              reason_code=$2, reason_requires_target=$3, target_date=$4::date,
              closed_by_user_id=$5, closed_at=now(),
              approved_by_user_id=$6, approved_at=$7,
              updated_at=now()
        WHERE unit_id=$8 AND business_date=$9::date AND status='open'`,
      [
        tier,
        input.reasonCode,
        reasonRequiresTarget,
        input.targetDate,
        scope.userId,
        perluPersetujuan ? scope.userId : null,
        perluPersetujuan ? new Date() : null,
        unit.unit_id,
        input.date,
      ],
    );
    await client.query("COMMIT");
    revalidatePath(`/keuangan/unit/${unit.code}/tutup-hari/${input.date}`);
    return { ok: true, tier };
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* abaikan */
    }
    return { ok: false, error: e instanceof Error ? e.message : "Gagal menutup hari." };
  } finally {
    client.release();
  }
}

/** Pesan yang menyebut PERBAIKANNYA, bukan hanya penolakannya. */
function pesanKurang(kurang: readonly string[]): string {
  const p: string[] = [];
  if (kurang.includes("reason_code")) p.push("pilih kode alasan — selisih bukan nol wajib bersebab");
  if (kurang.includes("target_date")) p.push("isi tanggal target penyelesaiannya");
  if (kurang.includes("wewenang")) p.push("selisih sebesar ini di luar wewenang Anda");
  if (kurang.includes("persetujuan")) p.push("centang persetujuan eksplisitnya");
  return `Hari belum bisa ditutup: ${p.join(" · ")}.`;
}

/**
 * Pastikan baris `day_close` ADA dan nilainya segar — dipanggil saat Layar 4
 * dibuka (§10.15).
 *
 * ⛔ **BARIS TERTUTUP TIDAK PERNAH DISENTUH.** `WHERE status='open'` pada
 * UPDATE bukan optimasi; ia yang mencegah hitung ulang menulis ulang sejarah.
 * Selisih yang sudah disetujui seseorang tidak boleh berubah tanpa ia tahu —
 * persetujuannya akan menempel pada angka yang bukan yang ia setujui.
 *
 * ⚠️ Ini penulisan pada permintaan BACA, dan itu tak lazim — disebut apa adanya
 * di §10.15. Ditukar dengan hilangnya satu komponen (job harian) yang bisa mati
 * tanpa suara; repo ini punya sejarahnya.
 *
 * `langkahHarian === null` ⇒ **tidak menulis apa pun**. Hari yang belum bisa
 * dinilai tidak boleh mendapat baris bernilai nol — nol akan terbaca sebagai
 * "seimbang", padahal artinya "belum terhitung".
 */
export async function pastikanBarisDayClose(
  // ⛔ `ScopedUnitId`, bukan `number`. Tinjauan pra-promosi menemukan tanda-tipe
  // ini menerima angka mentah: pemanggil hari ini benar (`unit.unit_id` dari
  // `requireUnit`), tetapi pemanggil BERIKUTNYA tak akan dihalangi type-check —
  // dan seluruh lapis tipe repo ini berdiri di atas janji "lupa men-scope =
  // error type-check".
  unitId: ScopedUnitId,
  date: string,
  langkahHarian: number | null,
): Promise<void> {
  if (langkahHarian === null) return;
  const tier = tierFor(langkahHarian);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.unit_ids', $1, true)", [String(unitId)]);
    await client.query(
      `INSERT INTO app.day_close (unit_id, business_date, status, difference_rp, tier)
       VALUES ($1, $2::date, 'open', $3, $4::app.day_close_tier)
       ON CONFLICT (unit_id, business_date) DO UPDATE
          SET difference_rp = EXCLUDED.difference_rp,
              tier          = EXCLUDED.tier,
              updated_at    = now()
        WHERE app.day_close.status = 'open'`,
      [unitId, date, langkahHarian, tier],
    );
    await client.query("COMMIT");
  } catch {
    // Kegagalan di sini TIDAK boleh menjatuhkan halaman: gerbangnya masih bisa
    // dibaca, dan `tutupHari` menolak sendiri bila barisnya tak ada.
    try {
      await client.query("ROLLBACK");
    } catch {
      /* abaikan */
    }
  } finally {
    client.release();
  }
}
