"use server";

import { revalidatePath } from "next/cache";
import type { PoolClient } from "pg";
import { MULAI_BUKU_BESAR } from "./buku-besar-model";
import { bentukUlangHari } from "./buku-besar-tulis";
import { pool } from "./db";
import { kunciHariEksklusif } from "./hari-buku-queries";
import { hitungLangkahHarianRinci } from "./keuangan-laporan-queries";
import { periksaTutupHari, tierFor } from "./keuangan-tutup-hari";
import { auditKeuangan, type Aktor } from "./keuangan-tx";
import { getDataScope, type ScopedUnitId } from "./scope";

/**
 * Server action gerbang tutup hari (Layar 4).
 *
 * ⛔ EMPAT HAL YANG MENGIKAT:
 *
 * 1. **SELISIH DIHITUNG ULANG DI SERVER, DI BAWAH KUNCI.** Yang datang dari
 *    client hanyalah kode alasan & tanggal target. Kalau selisihnya boleh
 *    dikirim browser, seluruh tangga §3.2 bisa dilewati dengan mengirim `0`.
 *    Dan sejak rencana 2026-10-29 (U2/KTD5) ia juga TIDAK dibaca dari
 *    `difference_rp` tersimpan: angka itu dihitung saat layar dibuka, sedangkan
 *    jalur tulis R28 bisa membukukan baris ke hari ini sesudahnya.
 * 2. **Tier adalah FUNGSI dari selisih**, bukan pilihan — `tierFor()`, dan DB
 *    menegakkan ulang lewat CHECK `day_close_tier_matches_difference` (0026).
 * 3. **Aturan diputuskan SATU tempat**: `periksaTutupHari`. Berkas ini tidak
 *    menyalin satu pun ambang; menyalinnya berarti layar, aksi, dan laporan
 *    bisa menjawab berbeda untuk pertanyaan yang sama.
 * 4. **Selisih tidak pernah dinolkan atau dibulatkan** — ia disimpan apa
 *    adanya, termasuk yang di dalam toleransi.
 *
 * Sesudah `day_close` ditulis, jurnal buku besar hari itu dibentuk ulang di
 * transaksi yang sama (rencana 2026-11-02 K6 U8/U9; KTD3 pemicu 2) — lihat
 * {@link bentukBukuBesarHari}. Kegagalannya TIDAK menahan penutupan hari.
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

    // ⛔ Kunci EKSKLUSIF hari ini LEBIH DULU (U2/KTD5): menunggu jalur tulis
    //    R28 yang sedang memegang hari ini sampai COMMIT, dan menahan yang baru
    //    sampai penutupan ini selesai — mereka lalu melihat hari tertutup dan
    //    membukukan maju (`hariBukuTerkunci`). Urutannya sama dengan jalur tulis
    //    (advisory → baris), jadi tak ada siklus kunci.
    await kunciHariEksklusif(client, unit.unit_id, input.date);

    // Baris day_close disiapkan lebih dulu oleh perhitungan harian; kalau belum
    // ada, harinya belum bisa dinilai — dan menutup hari yang belum dinilai
    // adalah menutup mata, bukan menutup buku.
    const cur = await client.query<{ status: string }>(
      `SELECT status::text AS status
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
          "Hari ini belum punya baris penilaian. Baris itu dibuat saat layar ini dibuka — " +
          "muat ulang layar; bila ada pesan galat penyimpanan di atas, laporkan ke admin.",
      };
    }
    if (row.status === "closed") {
      await client.query("ROLLBACK");
      return { ok: false, error: "Hari ini sudah ditutup." };
    }

    // Selisih dari DATA TERKINI, bukan dari payload dan bukan dari angka yang
    // tersimpan saat layar dibuka (butir 1). Jalur hitungnya sama dengan
    // Layar 4 (`langkahHarianDari`). Kuerinya di koneksi lain — aman karena
    // kunci di atas sudah dipegang: semua penulis hari ini sudah COMMIT.
    // KTD15 (U12) — yang DINILAI tangga §3.2 adalah langkah TANPA baris susulan
    //    (`dinilai`); koreksi susulan disimpan DI SAMPINGNYA, tak ikut dinilai
    //    (R32). Satu panggilan, satu bahan: keduanya dari data yang sama.
    const rinci = await hitungLangkahHarianRinci(unit.unit_id, input.date);
    const differenceRp = rinci.dinilai;
    if (differenceRp === null) {
      // Tak terhitung ⇒ ditolak, TIDAK dinolkan (§10.15).
      await client.query("ROLLBACK");
      return {
        ok: false,
        error:
          "Selisih hari ini belum bisa dihitung dari data saat ini — lengkapi datanya " +
          "lalu buka ulang layar tutup hari.",
      };
    }

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
          SET status='closed', difference_rp=$10, koreksi_susulan_rp=$11, tier=$1::app.day_close_tier,
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
        differenceRp,
        rinci.koreksiSusulan,
      ],
    );
    // Buku besar SESUDAH day_close ditulis: P24 membaca persetujuan tier-nya.
    if (input.date >= MULAI_BUKU_BESAR) {
      await bentukBukuBesarHari(client, unit.unit_id, input.date, { userId: scope.userId, email: scope.email });
    }
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

/**
 * Bentuk ulang jurnal buku besar satu unit-hari di DALAM transaksi tutup hari
 * (rencana 2026-11-02 K6 U8/U9; KTD3 pemicu 2).
 *
 * ⛔ YANG MENGIKAT:
 *
 * 1. **Galat buku besar tidak menahan tutup hari.** Pekerjaannya di dalam
 *    SAVEPOINT; galat ⇒ digulung ke savepoint, dicatat di `audit_log`
 *    (`buku_besar.bentuk_ulang_gagal`), dan penutupan tetap COMMIT. Halaman
 *    Buku Besar menampilkan hari yang tertinggal; HoF memulihkannya lewat
 *    "Bentuk ulang bulan ini".
 * 2. **Seimbang diperiksa DI DALAM savepoint.** Trigger seimbang 0058 tertunda
 *    sampai COMMIT; tanpa `SET CONSTRAINTS … IMMEDIATE` jurnal tak seimbang
 *    baru meledak saat COMMIT dan menggagalkan seluruh tutup hari.
 * 3. **Kunci.** `bentukUlangHari` meminta kunci hari EKSKLUSIF yang sudah
 *    dipegang transaksi ini — kunci advisory re-entrant dalam satu sesi, jadi
 *    tidak menunggu dirinya sendiri — lalu kunci bulan BERSAMA. `tutupBulan`
 *    hanya memegang kunci bulan, tak pernah kunci hari: tak ada siklus.
 */
async function bentukBukuBesarHari(c: PoolClient, unit: ScopedUnitId, tanggal: string, aktor: Aktor): Promise<void> {
  await c.query("SAVEPOINT buku_besar_tutup_hari");
  try {
    await bentukUlangHari(c, unit, tanggal, { aktor });
    await c.query("SET CONSTRAINTS app.jurnal_seimbang, app.jurnal_baris_seimbang IMMEDIATE");
    await c.query("RELEASE SAVEPOINT buku_besar_tutup_hari");
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT buku_besar_tutup_hari");
    await auditKeuangan(c, aktor, "buku_besar.bentuk_ulang_gagal", `${unit}/${tanggal}`, {
      pemicu: "tutup_hari",
      galat: e instanceof Error ? e.message : String(e),
    });
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
 *
 * 🔴 **GALAT TIDAK DITELAN** (perbaikan 2026-11-11). Sampai 0061, setiap hari
 * berselisih bukan nol gagal di CHECK `day_close_reason_required` (23514), dan
 * `catch {}` di sini menelannya — halaman lalu berkata "belum punya baris
 * penilaian" tanpa sebab, dan `day_close` tetap 0 baris di ketujuh unit.
 * Sekarang galatnya DICATAT (unit, tanggal, kode) dan DIKEMBALIKAN ke halaman
 * untuk ditampilkan. Halaman tetap tidak jatuh — gerbangnya masih bisa dibaca.
 * Satu-satunya galat yang diabaikan dengan sengaja: 23505 (penyisipan bersamaan
 * dari tab lain menang lebih dulu — barisnya ADA, dan itu yang dibutuhkan).
 */
export type HasilBarisDayClose = { ok: true } | { ok: false; kode: string | null; pesan: string };

/** Kode SQLSTATE dari galat `pg`, bila ada. */
function kodeGalat(e: unknown): string | null {
  const k = (e as { code?: unknown } | null)?.code;
  return typeof k === "string" ? k : null;
}

export async function pastikanBarisDayClose(
  // ⛔ `ScopedUnitId`, bukan `number`. Tinjauan pra-promosi menemukan tanda-tipe
  // ini menerima angka mentah: pemanggil hari ini benar (`unit.unit_id` dari
  // `requireUnit`), tetapi pemanggil BERIKUTNYA tak akan dihalangi type-check —
  // dan seluruh lapis tipe repo ini berdiri di atas janji "lupa men-scope =
  // error type-check".
  unitId: ScopedUnitId,
  date: string,
  langkahHarian: number | null,
  /** KTD15 (U12) — disimpan di samping selisih; tak menentukan tier. */
  koreksiSusulan: number | null = null,
): Promise<HasilBarisDayClose> {
  if (langkahHarian === null) return { ok: true };
  const tier = tierFor(langkahHarian);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.unit_ids', $1, true)", [String(unitId)]);
    await client.query(
      `INSERT INTO app.day_close (unit_id, business_date, status, difference_rp, koreksi_susulan_rp, tier)
       VALUES ($1, $2::date, 'open', $3, $5, $4::app.day_close_tier)
       ON CONFLICT (unit_id, business_date) DO UPDATE
          SET difference_rp      = EXCLUDED.difference_rp,
              koreksi_susulan_rp = EXCLUDED.koreksi_susulan_rp,
              tier               = EXCLUDED.tier,
              updated_at         = now()
        WHERE app.day_close.status = 'open'`,
      [unitId, date, langkahHarian, tier, koreksiSusulan],
    );
    await client.query("COMMIT");
    return { ok: true };
  } catch (e) {
    // Kegagalan di sini TIDAK boleh menjatuhkan halaman: gerbangnya masih bisa
    // dibaca, dan `tutupHari` menolak sendiri bila barisnya tak ada. Tetapi
    // galatnya TIDAK ditelan — dicatat dan dikembalikan untuk ditampilkan.
    try {
      await client.query("ROLLBACK");
    } catch {
      /* abaikan */
    }
    const kode = kodeGalat(e);
    // 23505: penyisipan bersamaan menang lebih dulu — barisnya ada. Bukan galat.
    if (kode === "23505") return { ok: true };
    console.error("[pastikanBarisDayClose] gagal menyiapkan baris day_close", {
      unitId,
      date,
      kode,
      galat: e instanceof Error ? e.message : String(e),
    });
    return {
      ok: false,
      kode,
      pesan:
        `Baris penilaian hari ini gagal disimpan${kode ? ` (kode galat ${kode})` : ""}. ` +
        "Hari ini belum bisa ditutup sampai ini beres — muat ulang layar; bila pesan ini tetap muncul, " +
        "laporkan ke admin beserta unit, tanggal, dan kode galatnya.",
    };
  } finally {
    client.release();
  }
}
