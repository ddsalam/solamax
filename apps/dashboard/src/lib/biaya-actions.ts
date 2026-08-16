"use server";

import { revalidatePath } from "next/cache";
import { pool } from "./db";
import { alasanTakBolehInput, PESAN_TAK_BOLEH_INPUT } from "./keuangan-wewenang";
import { getDataScope, type DataScope, type ScopedUnit } from "./scope";

/**
 * Server action biaya operasional & pendapatan lain-lain (Layar 3 blok 4) —
 * **pintu Finance saja**.
 *
 * ⛔ TIGA HAL YANG MENGIKAT:
 *
 * 1. **TIDAK ADA `editBiaya`, dan tak akan pernah ada** (§2.3). Berkas ini
 *    hanya bisa MENAMBAH baris lewat pintu Finance. Baris milik pengawas tidak
 *    bisa disentuh dari sini sama sekali — bukan "tidak ditampilkan tombolnya",
 *    melainkan tidak ada jalannya.
 * 2. **`source_door='finance'` ditulis eksplisit** (0034). Asal-usul adalah
 *    fakta saat penulisan; menurunkannya belakangan dari peran pembuatnya akan
 *    menulis ulang sejarah setiap kali orang berganti peran.
 * 3. **`accounting_account` TIDAK diketik** — ia dipetakan dari kategori lewat
 *    `app.category_account_map` (§4.3), di dalam transaksi yang sama. Kalau
 *    CoA boleh diketik bebas, peta itu berhenti berarti apa pun dan dua baris
 *    berkategori sama bisa mendarat di akun berbeda.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SECTION = new Set(["pengeluaran", "pendapatan_lain"]);

export type BiayaResult = { ok: true } | { ok: false; error: string };

type Buka =
  | { boleh: false; error: string }
  | { boleh: true; scope: DataScope; unit: ScopedUnit };

async function buka(code: string): Promise<Buka> {
  const scope = await getDataScope();
  const unit = scope.requireUnit(code); // di luar scope → notFound(), tak menulis
  const alasan = alasanTakBolehInput({ role: scope.role, email: scope.email });
  if (alasan !== null) return { boleh: false, error: PESAN_TAK_BOLEH_INPUT[alasan] };
  return { boleh: true, scope, unit };
}

export interface BiayaFinanceInput {
  code: string;
  date: string;
  section: "pengeluaran" | "pendapatan_lain";
  keterangan: string;
  /** Rupiah POSITIF. Tandanya ditentukan section, bukan diketik. */
  amountRp: number;
  /** Salah satu dari 14 kategori (§2.4). */
  operationalCategory: string;
}

export async function tambahBiayaFinance(input: BiayaFinanceInput): Promise<BiayaResult> {
  const ctx = await buka(input.code);
  if (!ctx.boleh) return { ok: false, error: ctx.error };
  const { scope, unit } = ctx;

  if (!DATE_RE.test(input.date)) return { ok: false, error: "Tanggal tak valid." };
  if (!SECTION.has(input.section)) return { ok: false, error: "Seksi tak dikenal." };
  if (input.keterangan.trim() === "") return { ok: false, error: "Keterangan wajib diisi." };
  if (!(input.amountRp > 0)) return { ok: false, error: "Nominal harus lebih besar dari nol." };
  if (input.operationalCategory.trim() === "") {
    return { ok: false, error: "Kategori wajib dipilih." };
  }
  // Tanda ditentukan SEKSI: pengeluaran negatif, pendapatan positif. Minus yang
  // terlupa adalah cara termudah membuat biaya menaikkan laba.
  const amount = input.section === "pengeluaran" ? -input.amountRp : input.amountRp;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.unit_ids', $1, true)", [String(unit.unit_id)]);

    // CoA dipetakan, tidak diketik (§4.3). Override per-unit menang atas
    // default; di antara beberapa effective_from, yang terbaru menang.
    const peta = await client.query<{ account: string }>(
      `SELECT accounting_account AS account
         FROM app.category_account_map
        WHERE (unit_id = $1 OR unit_id IS NULL)
          AND operational_category = $2
          AND effective_from <= $3::date
        ORDER BY (unit_id IS NULL), effective_from DESC
        LIMIT 1`,
      [unit.unit_id, input.operationalCategory.trim(), input.date],
    );
    const akun = peta.rows[0]?.account ?? null;
    if (akun === null) {
      await client.query("ROLLBACK");
      return {
        ok: false,
        error: `Kategori "${input.operationalCategory}" belum punya pemetaan akun akuntansi.`,
      };
    }

    // `urut` menyusul baris terakhir hari itu — pengawas dan Finance berbagi
    // satu urutan, sebab mereka berbagi satu daftar (§2.4).
    await client.query(
      `INSERT INTO app.manual_entry
         (unit_id, business_date, section, urut, keterangan, amount,
          operational_category, accounting_account, status, source_door,
          created_by_user_id, submitted_at)
       SELECT $1, $2::date, $3::app.manual_entry_section,
              COALESCE(max(urut), 0) + 1, $4, $5, $6, $7, 'submitted', 'finance', $8, now()
         FROM app.manual_entry
        WHERE unit_id = $1 AND business_date = $2::date`,
      [
        unit.unit_id,
        input.date,
        input.section,
        input.keterangan.trim(),
        amount,
        input.operationalCategory.trim(),
        akun,
        scope.userId,
      ],
    );
    await client.query("COMMIT");
    revalidatePath(`/keuangan/unit/${unit.code}/${input.date}/input`);
    return { ok: true };
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* abaikan */
    }
    return { ok: false, error: e instanceof Error ? e.message : "Gagal menyimpan." };
  } finally {
    client.release();
  }
}
