import type { PoolClient } from "pg";
import { senKeTeks } from "./antar-unit-model";
import { jenisDariSen, sectionBeban, type BarisKlasifikasi } from "./klasifikasi-model";
import { periksaPihakLawanMutasi } from "./pihak-lawan-model";
import { bacaPihakLawanTerkunci } from "./pihak-lawan-tulis";
import type { ScopedUnitId } from "./scope";

/**
 * Inti TULIS klasifikasi mutasi bank (rencana 2026-10-29 U11; R9, R21, R27,
 * R28; KTD5, KTD6, KTD8) — dipanggil DI DALAM transaksi pemanggil, sesudah
 * `set_config('app.unit_ids', …, true)` dan SESUDAH `hariBukuTerkunci`. Tanpa
 * gerbang wewenang: gerbangnya milik server action (`klasifikasi-actions.ts`,
 * `kas-actions.ts`) dan dijalankan SEBELUM BEGIN.
 *
 * ⚠️ Sengaja BUKAN berkas "use server" (pola `antar-unit-tulis.ts`): setiap
 * ekspor berkas seperti itu menjadi endpoint peramban — termasuk fungsi tanpa
 * gerbang di bawah.
 *
 * ⛔ BEBAN = DUA BARIS. Baris kas berkategori beban/pendapatan lain-lain tak
 * menggeser laba (laba hanya membaca `manual_entry`/`noncash_expense`), jadi
 * setiap baris seperti itu DIIRINGI `manual_entry` pintu Finance di hari buku
 * yang SAMA (§2.4 — `tambahBiayaFinance`: nominal positif, CoA dipetakan lewat
 * `category_account_map`, `source_door = 'finance'`), bertaut lewat
 * `cash_ledger_id` (0053) sehingga pembatalan baris kas ikut membatalkannya.
 */

export const INSERT_KAS_KLASIFIKASI = `INSERT INTO app.cash_ledger
         (unit_id, account_id, business_date, keterangan, jenis,
          category_side, category_label, amount, created_by_user_id, pihak_lawan_id,
          tanggal_asal, alasan_maju, alasan_maju_applies_to, lahir_dari_cocok_id, parkir_sumber_id)
       VALUES ($1,$2::uuid,$3::date,$4,$5::app.cash_mutation_jenis,
               $6::app.cash_mutation_side,$7,$8::numeric,$9,$10::uuid,
               $11::date,$12,$13,$14::uuid,$15::uuid)
       RETURNING id::text AS id`;

/**
 * `manual_entry` pintu Finance untuk satu baris kas beban/pendapatan. CoA
 * DIPETAKAN, tidak diketik (§4.3) — override per unit menang, lalu
 * `effective_from` terbaru. `urut` menyusul baris terakhir hari itu (pengawas &
 * Finance berbagi satu urutan, §2.4).
 */
export async function tulisBebanFinance(
  c: PoolClient,
  m: {
    unitId: ScopedUnitId;
    businessDate: string;
    section: "pengeluaran" | "pendapatan_lain";
    keterangan: string;
    /** Sen bulat POSITIF — arah ditentukan seksi (0042). */
    amountSen: number;
    operationalCategory: string;
    cashLedgerId: string;
    aktorId: number;
  },
): Promise<{ ok: true; id: string; akun: string } | { ok: false; error: string }> {
  const peta = await c.query<{ account: string }>(
    `SELECT accounting_account AS account
       FROM app.category_account_map
      WHERE (unit_id = $1 OR unit_id IS NULL)
        AND operational_category = $2
        AND effective_from <= $3::date
      ORDER BY (unit_id IS NULL), effective_from DESC
      LIMIT 1`,
    [m.unitId, m.operationalCategory, m.businessDate],
  );
  const akun = peta.rows[0]?.account ?? null;
  if (akun === null) return { ok: false, error: `Kategori operasional “${m.operationalCategory}” belum punya pemetaan akun akuntansi.` };
  const r = await c.query<{ id: string }>(
    `INSERT INTO app.manual_entry
       (unit_id, business_date, section, urut, keterangan, amount,
        operational_category, accounting_account, status, source_door,
        created_by_user_id, submitted_at, cash_ledger_id)
     SELECT $1, $2::date, $3::app.manual_entry_section,
            COALESCE(max(urut), 0) + 1, $4, $5::numeric, $6, $7, 'submitted', 'finance', $8, now(), $9::uuid
       FROM app.manual_entry
      WHERE unit_id = $1 AND business_date = $2::date
     RETURNING id::text AS id`,
    [m.unitId, m.businessDate, m.section, m.keterangan, senKeTeks(Math.abs(m.amountSen)), m.operationalCategory, akun, m.aktorId, m.cashLedgerId],
  );
  return { ok: true, id: r.rows[0]?.id ?? "?", akun };
}

export interface KasLahiran {
  id: string;
  amountSen: number;
  categoryLabel: string;
  bebanId: string | null;
}

/**
 * Baris kas klasifikasi (+ beban pintu Finance bila kategorinya beban), satu
 * rekening, satu hari buku. Pihak lawan & kategori dibaca ulang di transaksi.
 * `maju` ⇒ `tanggal_asal` + `kodeMaju` (R28); `lahirDariCocokId` menandai
 * baris yang dilahirkan kelompok cocok (pembatalannya me-void/membalik baris
 * ini dan bebannya).
 */
export async function tulisBarisKlasifikasi(
  c: PoolClient,
  m: {
    unitId: ScopedUnitId;
    accountId: string;
    hariBuku: string;
    /** Tanggal transaksi (tanggal bank). */
    tanggal: string;
    maju: boolean;
    kodeMaju: string;
    aktorId: number;
    lahirDariCocokId: string | null;
    parkirSumberId?: string | null;
    baris: readonly BarisKlasifikasi[];
  },
): Promise<{ ok: true; kas: KasLahiran[] } | { ok: false; error: string }> {
  const n = (i: number) => (m.baris.length > 1 ? `Baris ${i + 1}: ` : "");
  for (const [i, b] of m.baris.entries()) {
    const sisi = jenisDariSen(b.amountSen);
    const k = await c.query<{ ada: boolean }>(
      `SELECT true AS ada FROM app.cash_mutation_category
        WHERE side = $1::app.cash_mutation_side AND label = $2 AND active`,
      [sisi, b.categoryLabel],
    );
    if (k.rows.length === 0) {
      return { ok: false, error: `${n(i)}kategori “${b.categoryLabel}” tidak ada di sisi ${sisi} — pilih kategori yang sesisi dengan mutasinya.` };
    }
    if (b.pihakLawanId !== null) {
      const pihak = await bacaPihakLawanTerkunci(c, m.unitId, b.pihakLawanId);
      const salah = periksaPihakLawanMutasi({ categoryLabel: b.categoryLabel, pihakLawanId: b.pihakLawanId, pihak });
      if (salah !== null) return { ok: false, error: `${n(i)}${salah}` };
    }
  }

  const kas: KasLahiran[] = [];
  for (const [i, b] of m.baris.entries()) {
    const jenis = jenisDariSen(b.amountSen);
    const r = await c.query<{ id: string }>(INSERT_KAS_KLASIFIKASI, [
      m.unitId,
      m.accountId,
      m.hariBuku,
      b.keterangan.trim(),
      jenis,
      jenis,
      b.categoryLabel,
      senKeTeks(b.amountSen),
      m.aktorId,
      b.pihakLawanId,
      m.maju ? m.tanggal : null,
      m.maju ? m.kodeMaju : null,
      m.maju ? "adjustment" : null,
      m.lahirDariCocokId,
      m.parkirSumberId ?? null,
    ]);
    const id = r.rows[0]?.id ?? "?";
    let bebanId: string | null = null;
    const seksi = sectionBeban(b.categoryLabel);
    if (seksi !== null) {
      const be = await tulisBebanFinance(c, {
        unitId: m.unitId,
        businessDate: m.hariBuku,
        section: seksi,
        keterangan: b.keterangan.trim(),
        amountSen: b.amountSen,
        operationalCategory: b.operationalCategory!,
        cashLedgerId: id,
        aktorId: m.aktorId,
      });
      if (!be.ok) return { ok: false, error: `${n(i)}${be.error}` };
      bebanId = be.id;
    }
    kas.push({ id, amountSen: b.amountSen, categoryLabel: b.categoryLabel, bebanId });
  }
  return { ok: true, kas };
}
