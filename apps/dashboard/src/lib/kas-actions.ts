"use server";

import { barisSistemDari, PENJELASAN_BARIS_SISTEM } from "./keuangan-kas-model";
import { revalidatePath } from "next/cache";
import { pool } from "./db";
import { kategoriCocok, tandaCocok, type JenisMutasi, type SisiKategori } from "./keuangan-kas";
import { PESAN_TAK_BOLEH_INPUT, alasanTakBolehInput, canNonaktifkanAkunKas } from "./keuangan-wewenang";
import { getDataScope, type DataScope, type ScopedUnit } from "./scope";
import { hariBukuTerkunci } from "./hari-buku-queries";
import { kategoriPihakLawan, periksaPecahan, periksaPihakLawanMutasi, rupiahKeSen } from "./pihak-lawan-model";
import { bacaPihakLawanTerkunci } from "./pihak-lawan-tulis";
import { KATEGORI_OPERASIONAL, sectionBeban } from "./klasifikasi-model";
import { tulisBebanFinance } from "./klasifikasi-tulis";

/**
 * Server action buku kas & buku bank (Layar 3 blok 2).
 *
 * Pola SAMA dengan `harga-beli-actions.ts` — `requireUnit` → `canInputKeuangan`
 * → `set_config` transaction-local → DML. Tak ada pola baru.
 *
 * ⛔ EMPAT HAL YANG MENGIKAT:
 *
 * 1. **SALDO TIDAK PERNAH DITULIS.** Tak ada kolom saldo di `app.cash_ledger`
 *    (0029) dan tak ada satu pun `INSERT` di sini yang menyebutnya. Saldo
 *    dihitung dari mutasi setiap kali dibaca.
 * 2. **Nominal BERTANDA** — debet > 0, kredit < 0 — sehingga saldo = `Σ amount`.
 *    Diperiksa di sini DAN oleh CHECK `cash_ledger_tanda` di DB.
 * 3. **Setoran pengawas DITAWARKAN, bukan diposting** (§1.4). Barisnya baru
 *    lahir saat ada yang MENYETUJUI, dan `created_by_user_id` pada baris itu
 *    adalah jejak persetujuannya.
 * 4. **Nominal tawaran tidak diterima dari client.** Ia dibaca ulang di server
 *    dari `app.manual_entry`. Kalau angkanya datang dari browser, "disetujui"
 *    berhenti berarti apa pun — yang menyetujui bisa menyetujui angka lain.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type KasResult = { ok: true; n?: number } | { ok: false; error: string };

/**
 * Gerbang bersama ketiga aksi: unit ter-scope + wewenang tulis. Mengembalikan
 * ALASAN penolakan, bukan sekadar `null` — pesan "Anda tidak berwenang" yang
 * tidak menyebut sebabnya membuat HoF mengira sistemnya rusak.
 */
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

export interface MutasiInput {
  code: string;
  date: string;
  accountId: string;
  keterangan: string;
  jenis: JenisMutasi;
  categorySide: SisiKategori | null;
  categoryLabel: string | null;
  /** BERTANDA: debet > 0, kredit < 0. */
  amount: number;
  /**
   * Wajib untuk kategori pihak lawan ("Hutang Piutang", "Penyerahan titipan"),
   * dilarang untuk kategori lain (rencana 2026-10-29 U3, R2, KTD3). Dibaca
   * ulang di server: harus milik unit ini, aktif, dan sejenis dengan kategorinya.
   */
  pihakLawanId?: string | null;
}

export async function simpanMutasiKas(input: MutasiInput): Promise<KasResult> {
  const ctx = await buka(input.code);
  if (!ctx.boleh) return { ok: false, error: ctx.error };
  const { scope, unit } = ctx;

  if (!DATE_RE.test(input.date)) return { ok: false, error: "Tanggal tak valid." };
  if (input.keterangan.trim() === "") return { ok: false, error: "Keterangan wajib diisi." };
  if (!Number.isFinite(input.amount)) return { ok: false, error: "Nominal tak valid." };
  if (!tandaCocok(input.jenis, input.amount)) {
    return {
      ok: false,
      error: "Tanda nominal harus mengikuti jenis: debet positif, kredit negatif, dan bukan nol.",
    };
  }
  if (!kategoriCocok(input.jenis, input.categorySide)) {
    return { ok: false, error: "Kategori harus sesisi dengan jenis mutasinya." };
  }
  // Pihak lawan: ada-tidaknya diputus SEBELUM koneksi (CHECK 0049 menolak
  // juga, tetapi dengan galat DB yang tak menyebut perbaikannya).
  const pihakLawanId = input.pihakLawanId ?? null;
  if (pihakLawanId === null || !kategoriPihakLawan(input.categoryLabel)) {
    const salah = periksaPihakLawanMutasi({ categoryLabel: input.categoryLabel, pihakLawanId, pihak: null });
    if (salah !== null) return { ok: false, error: salah };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.unit_ids', $1, true)", [String(unit.unit_id)]);

    if (pihakLawanId !== null) {
      // Dibaca ulang & dikunci DI DALAM transaksi: unit sama, aktif, sejenis.
      const pihak = await bacaPihakLawanTerkunci(client, unit.unit_id, pihakLawanId);
      const salah = periksaPihakLawanMutasi({ categoryLabel: input.categoryLabel, pihakLawanId, pihak });
      if (salah !== null) {
        await client.query("ROLLBACK");
        return { ok: false, error: salah };
      }
    }

    // ⛔ §10.24 butir 2 — MUSTAHIL KE DEPAN. Mutasi baru tak boleh mendahului
    //    titik awal rekeningnya: saldo pembuka berarti "saldo pada AWAL hari
    //    cut-over", jadi baris yang lebih tua akan dihitung ganda. Diperiksa DI
    //    DALAM transaksi yang sama supaya tak ada celah antara memeriksa dan
    //    menulis.
    const cut = await client.query<{ businessDate: string }>(
      `SELECT to_char(business_date,'YYYY-MM-DD') AS "businessDate"
         FROM app.cash_ledger
        WHERE unit_id = $1 AND account_id = $2::uuid AND saldo_awal AND NOT void`,
      [unit.unit_id, input.accountId],
    );
    const cutOver = cut.rows[0]?.businessDate ?? null;
    if (cutOver !== null && input.date < cutOver) {
      await client.query("ROLLBACK");
      return {
        ok: false,
        error:
          `Tanggal mutasi mendahului saldo pembuka rekening ini (${cutOver}). ` +
          `Saldo pembuka adalah titik awal; mutasi sebelum titik itu akan dihitung dua kali.`,
      };
    }

    await client.query(
      `INSERT INTO app.cash_ledger
         (unit_id, account_id, business_date, keterangan, jenis,
          category_side, category_label, amount, created_by_user_id, pihak_lawan_id)
       VALUES ($1,$2::uuid,$3::date,$4,$5::app.cash_mutation_jenis,
               $6::app.cash_mutation_side,$7,$8,$9,$10::uuid)`,
      [
        unit.unit_id,
        input.accountId,
        input.date,
        input.keterangan.trim(),
        input.jenis,
        input.categorySide,
        input.categoryLabel,
        input.amount,
        scope.userId,
        pihakLawanId,
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

/**
 * Setujui tawaran setoran — INILAH yang mengubah "ditawarkan" jadi "dibukukan".
 *
 * Nominal & keterangan diambil dari `app.manual_entry` DI SERVER (butir 4 di
 * kepala berkas). Yang datang dari client hanyalah daftar **id** setoran mana
 * yang disetujui.
 *
 * Kategori dikunci `Setoran Hasil Penjualan` (sisi debet) — bukan pilihan
 * pengguna: baris ini lahir dari setoran hasil penjualan, dan membiarkan
 * kategorinya bebas membuat asal-usulnya bisa dikaburkan pada saat persetujuan.
 */
export async function setujuiSetoran(input: {
  code: string;
  date: string;
  accountId: string;
  manualEntryIds: string[];
}): Promise<KasResult> {
  const ctx = await buka(input.code);
  if (!ctx.boleh) return { ok: false, error: ctx.error };
  const { scope, unit } = ctx;

  if (!DATE_RE.test(input.date)) return { ok: false, error: "Tanggal tak valid." };
  if (input.manualEntryIds.length === 0) {
    return { ok: false, error: "Tak ada setoran yang dipilih." };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.unit_ids', $1, true)", [String(unit.unit_id)]);

    // Baca ulang di server: nominal & keterangan TIDAK diterima dari client.
    // RLS + unit_id di WHERE memastikan setoran unit lain tak pernah terjaring.
    const src = await client.query<{ id: string; keterangan: string; amount: string }>(
      `SELECT id::text AS id, keterangan, amount::text AS amount
         FROM app.manual_entry
        WHERE unit_id = $1 AND business_date = $2::date
          AND section = 'setoran_tunai'::app.manual_entry_section
          AND NOT void AND id = ANY($3::uuid[])`,
      [unit.unit_id, input.date, input.manualEntryIds],
    );
    if (src.rowCount !== input.manualEntryIds.length) {
      await client.query("ROLLBACK");
      return {
        ok: false,
        error: "Sebagian setoran tak ditemukan lagi — muat ulang halaman sebelum menyetujui.",
      };
    }

    for (const r of src.rows) {
      // ON CONFLICT pada indeks unik parsial 0033: menyetujui dua kali tidak
      // melahirkan baris kedua. Diam-diam mengabaikan lebih baik daripada gagal
      // total — dua penyetuju yang menekan bersamaan adalah kejadian biasa.
      await client.query(
        `INSERT INTO app.cash_ledger
           (unit_id, account_id, business_date, keterangan, jenis,
            category_side, category_label, amount, created_by_user_id,
            source_manual_entry_id)
         VALUES ($1,$2::uuid,$3::date,$4,'debet','debet','Setoran Hasil Penjualan',$5,$6,$7::uuid)
         ON CONFLICT ("source_manual_entry_id") WHERE "source_manual_entry_id" IS NOT NULL AND NOT "void"
         DO NOTHING`,
        [
          unit.unit_id,
          input.accountId,
          input.date,
          r.keterangan,
          r.amount,
          scope.userId,
          r.id,
        ],
      );
    }
    await client.query("COMMIT");
    revalidatePath(`/keuangan/unit/${unit.code}/${input.date}/input`);
    return { ok: true, n: src.rowCount ?? 0 };
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* abaikan */
    }
    return { ok: false, error: e instanceof Error ? e.message : "Gagal menyetujui." };
  } finally {
    client.release();
  }
}

/**
 * Batalkan satu baris buku. VOID, tak pernah DELETE — dan `voided_by_user_id`
 * membuat "siapa membatalkan" punya jawaban. CHECK `cash_ledger_void_audit`
 * (0029) menolak pembatalan tanpa jejak.
 */
export async function voidMutasiKas(input: {
  code: string;
  date: string;
  id: string;
}): Promise<KasResult> {
  const ctx = await buka(input.code);
  if (!ctx.boleh) return { ok: false, error: ctx.error };
  const { scope, unit } = ctx;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.unit_ids', $1, true)", [String(unit.unit_id)]);
    // ⛔ Baris SISTEM tidak dibatalkan dari buku — dijaga DI SERVER, bukan hanya
    // dengan menyembunyikan tombolnya. Dulu tombol "Batalkan" bisa (a) mencabut
    // saldo pembuka milik Head of Finance tanpa jejak audit_log, dan (b) memutus
    // satu dari tiga kaki jurnal pencairan EDC sehingga buku tak seimbang dan
    // batch-nya tak bisa disetujui ulang. `FOR UPDATE` mengunci barisnya sampai
    // UPDATE di bawah, supaya vonis dan tulisan membaca keadaan yang sama.
    // U7 (0050): baris kas milik penebusan AKTIF juga baris sistem — void-nya
    // lewat `batalkanPenebusan`, yang menjaga hari buku & tautan penebusannya.
    // `FOR UPDATE` di sini bertabrakan dengan `FOR UPDATE OF l` milik
    // `simpanPenebusan`, jadi pengikatan yang bersamaan terbaca.
    const cek = await client.query<{ saldo_awal: boolean; dari_edc: boolean; dari_penebusan: boolean; dicocokkan: boolean }>(
      `SELECT l.saldo_awal, (l.edc_settlement_id IS NOT NULL) AS dari_edc,
              EXISTS (
                SELECT 1 FROM app.penebusan p
                 WHERE p.cash_ledger_id = l.id AND p.unit_id = l.unit_id AND NOT p.void
              ) AS dari_penebusan,
              EXISTS (
                SELECT 1 FROM app.cocok_bank_baris b
                 WHERE b.cash_ledger_id = l.id AND b.unit_id = l.unit_id AND b.aktif
              ) AS dicocokkan
         FROM app.cash_ledger l
        WHERE l.id=$1::uuid AND l.unit_id=$2 AND NOT l.void
        FOR UPDATE OF l`,
      [input.id, unit.unit_id],
    );
    const sistem = cek.rows[0]
      ? barisSistemDari({
          saldoAwal: cek.rows[0].saldo_awal,
          dariPencairanEdc: cek.rows[0].dari_edc,
          dariPenebusan: cek.rows[0].dari_penebusan,
        })
      : null;
    if (sistem !== null) {
      await client.query("ROLLBACK");
      return { ok: false, error: `Baris ini tidak bisa dibatalkan dari buku. ${PENJELASAN_BARIS_SISTEM[sistem]}` };
    }
    // U11 — baris di kelompok cocok AKTIF (dicocokkan ATAU dilahirkan
    // klasifikasi) tak di-void dari buku: Σ kelompoknya akan berhenti Rp 0
    // sementara baris rekening korannya tetap tampak selesai. Jalannya
    // "Batalkan cocok" (HoF, R31), yang juga membatalkan beban tertautnya.
    if (cek.rows[0]?.dicocokkan) {
      await client.query("ROLLBACK");
      return {
        ok: false,
        error:
          "Baris ini sudah dicocokkan dengan rekening koran — minta Head of Finance membatalkan cocoknya dulu " +
          "(Impor rekening koran), baru baris bisa dibatalkan.",
      };
    }
    const res = await client.query(
      `UPDATE app.cash_ledger
          SET void=true, voided_by_user_id=$1, voided_at=now()
        WHERE id=$2::uuid AND unit_id=$3 AND NOT void
          AND NOT saldo_awal AND edc_settlement_id IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM app.penebusan p
             WHERE p.cash_ledger_id = app.cash_ledger.id AND p.unit_id = app.cash_ledger.unit_id AND NOT p.void
          )`,
      [scope.userId, input.id, unit.unit_id],
    );
    // 0053 — beban pintu Finance yang lahir BERSAMA baris kas ini (pecahan /
    // klasifikasi) ikut dibatalkan: kas dan laba tak boleh berpisah. Hari
    // tertutup ⇒ trigger 0026 menolak UPDATE ini dan seluruh pembatalan batal.
    if (res.rowCount === 1) {
      await client.query(
        `UPDATE app.manual_entry
            SET void=true, voided_by_user_id=$1, voided_at=now(), updated_at=now()
          WHERE cash_ledger_id=$2::uuid AND unit_id=$3 AND NOT void`,
        [scope.userId, input.id, unit.unit_id],
      );
    }
    await client.query("COMMIT");
    revalidatePath(`/keuangan/unit/${unit.code}/${input.date}/input`);
    if (res.rowCount === 0) return { ok: false, error: "Baris sudah dibatalkan atau tak ditemukan." };
    return { ok: true };
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* abaikan */
    }
    return { ok: false, error: e instanceof Error ? e.message : "Gagal membatalkan." };
  } finally {
    client.release();
  }
}

/**
 * TETAPKAN / GANTI saldo pembuka sebuah rekening — §10.24.
 *
 * ⛔ WEWENANG: Head of Finance (atau super admin), **bukan** peran `keuangan`.
 * Menetapkan titik awal sebuah rekening lebih dekat ke *menyetujui* daripada ke
 * *mengetik* (§10.18), dan ia tak bisa dikoreksi diam-diam sesudah mutasi
 * menumpuk di atasnya.
 *
 * ⛔ MENGGANTI, BUKAN MENYUNTING (butir 3). Anchor lama di-VOID, anchor baru
 * disisipkan, dan `audit_log` mencatat keduanya berikut alasannya. Melarang
 * perubahan tidak membuat kekeliruan hilang — ia mendorong orang mengimbanginya
 * dengan mutasi palsu, yang jauh lebih buruk sebab tak terlihat sebagai koreksi.
 *
 * ⚠️ Alasannya hidup di `audit_log`, bukan di baris ledgernya: `cash_ledger` tak
 * punya kolom `void_reason`. Disebut apa adanya, bukan ditutupi.
 */
export interface SaldoAwalInput {
  code: string;
  accountId: string;
  /** Tanggal cut-over — saldo berlaku pada AWAL hari ini. */
  date: string;
  /** Bebas tanda (rekening bisa negatif). Nol HANYA bila `sementara` (§10.26). */
  amount: number;
  /**
   * §10.26 — angka rekening koran belum di tangan; titik awal ini akan diganti.
   * Satu-satunya jalan saldo pembuka Rp 0 sah, dan penandanya terlihat di layar.
   */
  sementara?: boolean;
  /** Wajib: kenapa angka ini, dan dari mana. */
  alasan: string;
}

export async function tetapkanSaldoAwal(input: SaldoAwalInput): Promise<KasResult> {
  const scope = await getDataScope();
  const unit = scope.requireUnit(input.code);
  if (!canNonaktifkanAkunKas({ role: scope.role, email: scope.email })) {
    return { ok: false, error: "Hanya Head of Finance yang boleh menetapkan saldo pembuka." };
  }
  if (!DATE_RE.test(input.date)) return { ok: false, error: "Tanggal tak valid." };
  const sementara = input.sementara === true;
  if (!Number.isFinite(input.amount)) return { ok: false, error: "Nominal tak valid." };
  if (input.amount === 0 && !sementara) {
    return {
      ok: false,
      error:
        "Saldo pembuka Rp 0 hanya boleh bila ditandai SEMENTARA (angka rekening koran menyusul) — " +
        "supaya nol tidak terbaca sebagai saldo sungguhan.",
    };
  }
  if (input.alasan.trim() === "") {
    return { ok: false, error: "Alasan wajib diisi: dari mana angka ini berasal." };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.unit_ids', $1, true)", [String(unit.unit_id)]);

    const lama = await client.query<{ id: string; amount: string; businessDate: string }>(
      `SELECT id::text AS id, amount::text AS amount,
              to_char(business_date,'YYYY-MM-DD') AS "businessDate"
         FROM app.cash_ledger
        WHERE unit_id = $1 AND account_id = $2::uuid AND saldo_awal AND NOT void
        FOR UPDATE`,
      [unit.unit_id, input.accountId],
    );
    const sebelumnya = lama.rows[0] ?? null;
    if (sebelumnya !== null) {
      await client.query(
        `UPDATE app.cash_ledger
            SET void = true, voided_by_user_id = $2, voided_at = now()
          WHERE id = $1::uuid AND unit_id = $3`,
        [sebelumnya.id, scope.userId, unit.unit_id],
      );
    }

    await client.query(
      `INSERT INTO app.cash_ledger
         (unit_id, account_id, business_date, keterangan, jenis, amount,
          saldo_awal, saldo_awal_sementara, created_by_user_id)
       VALUES ($1,$2::uuid,$3::date,$4,'adjustment',$5,true,$6,$7)`,
      [
        unit.unit_id,
        input.accountId,
        input.date,
        sementara ? "Saldo pembuka (sementara)" : "Saldo pembuka",
        input.amount,
        sementara,
        scope.userId,
      ],
    );

    await client.query(
      `INSERT INTO app.audit_log (actor_user_id, action, target, detail)
       VALUES ($1, $2, $3, $4)`,
      [
        scope.userId,
        sebelumnya === null ? "saldo_awal.tetapkan" : "saldo_awal.ganti",
        `${unit.code}/${input.accountId}`,
        JSON.stringify({
          tanggal: input.date,
          nominal: input.amount,
          sementara,
          alasan: input.alasan.trim(),
          sebelumnya:
            sebelumnya === null
              ? null
              : { tanggal: sebelumnya.businessDate, nominal: sebelumnya.amount },
        }),
      ],
    );

    await client.query("COMMIT");
    revalidatePath(`/keuangan/unit/${unit.code}/akun-kas`);
    return { ok: true };
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* abaikan */
    }
    return { ok: false, error: e instanceof Error ? e.message : "Gagal menetapkan saldo pembuka." };
  } finally {
    client.release();
  }
}

/**
 * PECAH satu mutasi bank menjadi N baris klasifikasi (rencana 2026-10-29 U3;
 * R9, R27, AE6) — mis. angsuran BPR = pokok ke pihak lawan kreditur + bunga ke
 * beban. SATU tindakan, SATU transaksi: semua baris tertulis atau tak satu pun.
 *
 * ⛔ TIGA HAL YANG MENGIKAT:
 *
 * 1. **Σ baris = nominal mutasi, tepat Rp 0, dalam SEN BULAT** (`periksaPecahan`),
 *    diperiksa di server sebelum koneksi. Selisih Rp 1 ditolak dengan angkanya.
 * 2. **Jalur tulis BARU ⇒ penjaga hari tertutup (U2, KTD5).** Hari buku dipilih
 *    `hariBukuTerkunci` DI DALAM transaksi, sebelum INSERT, untuk SEMUA baris
 *    sekaligus (satu tanggal bersama). Hari tertutup ⇒ dibukukan maju dengan
 *    `tanggal_asal` + kode alasan; pra-cut-over ⇒ tidak dibukukan (R22).
 *    (`simpanMutasiKas` sengaja TIDAK diubah ke penjaga ini — celah lama, PR
 *    terpisah menurut rencana.)
 * 3. **Pihak lawan per baris** mengikuti aturan yang sama dengan
 *    `simpanMutasiKas` — dibaca ulang & dikunci di dalam transaksi.
 *
 * Kode alasan maju: `ADJ-FWD-IMPORT` — mutasi yang dipecah adalah mutasi
 * rekening koran yang dicatat susulan; 0049 tak punya kode khusus pecahan.
 *
 * 4. **Baris BEBAN = baris kas + `manual_entry` pintu Finance** (U11, 0053).
 *    Baris kas "Biaya Operasional"/"Management Fee"/"Pendapatan Lain-Lain"
 *    hanya realisasi tunai — laba membaca `manual_entry`. Tanpa beban
 *    pendampingnya, bunga angsuran BPR (AE6) mengurangi kas tanpa mengurangi
 *    laba: langkah neraca melompat sebesar bunganya. Beban ditulis di hari buku
 *    yang sama, bertaut `cash_ledger_id`; kategori operasionalnya wajib dipilih.
 */
export interface PecahanInput {
  code: string;
  /** Tanggal transaksi (tanggal bank). Hari bukunya ditentukan penjaga U2. */
  date: string;
  accountId: string;
  keterangan: string;
  jenis: "debet" | "kredit";
  /** Nominal mutasi sumber, BERTANDA. */
  total: number;
  baris: {
    amount: number;
    categorySide: SisiKategori | null;
    categoryLabel: string | null;
    pihakLawanId?: string | null;
    /** Kosong ⇒ memakai keterangan mutasi. */
    keterangan?: string;
    /** Wajib untuk baris beban/pendapatan lain-lain (`sectionBeban`), dilarang selainnya. */
    operationalCategory?: string | null;
  }[];
}

const KODE_MAJU_PECAHAN = "ADJ-FWD-IMPORT";

export async function pecahMutasi(input: PecahanInput): Promise<KasResult> {
  const ctx = await buka(input.code);
  if (!ctx.boleh) return { ok: false, error: ctx.error };
  const { scope, unit } = ctx;

  if (!DATE_RE.test(input.date)) return { ok: false, error: "Tanggal tak valid." };
  if (input.keterangan.trim() === "") return { ok: false, error: "Keterangan wajib diisi." };
  const salahPecahan = periksaPecahan({ jenis: input.jenis, total: input.total, baris: input.baris });
  if (salahPecahan !== null) return { ok: false, error: salahPecahan };
  for (const [i, b] of input.baris.entries()) {
    const id = b.pihakLawanId ?? null;
    if (id === null || !kategoriPihakLawan(b.categoryLabel)) {
      const salah = periksaPihakLawanMutasi({ categoryLabel: b.categoryLabel, pihakLawanId: id, pihak: null });
      if (salah !== null) return { ok: false, error: `Baris ${i + 1}: ${salah}` };
    }
    const seksi = sectionBeban(b.categoryLabel);
    const op = b.operationalCategory ?? null;
    if (seksi === null && op !== null) {
      return { ok: false, error: `Baris ${i + 1}: kategori operasional hanya untuk beban atau pendapatan lain-lain — kosongkan pilihannya.` };
    }
    if (seksi !== null && (op === null || !(KATEGORI_OPERASIONAL as readonly string[]).includes(op))) {
      return {
        ok: false,
        error: `Baris ${i + 1}: “${b.categoryLabel}” adalah ${seksi === "pengeluaran" ? "beban" : "pendapatan lain-lain"} — pilih kategori operasionalnya supaya laba ikut tercatat.`,
      };
    }
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.unit_ids', $1, true)", [String(unit.unit_id)]);

    const hari = await hariBukuTerkunci(client, unit.unit_id, input.date, { accountId: input.accountId });
    if (hari.status === "pra-cut-over") {
      await client.query("ROLLBACK");
      return {
        ok: false,
        error:
          `Tanggal mutasi mendahului saldo pembuka (${hari.cutOver}) — sudah termuat di saldo pembuka, ` +
          `jadi tidak dibukukan. Mencatatnya akan menghitungnya dua kali.`,
      };
    }
    const maju = hari.perluKodeAlasan;

    for (const [i, b] of input.baris.entries()) {
      const id = b.pihakLawanId ?? null;
      if (id === null) continue;
      const pihak = await bacaPihakLawanTerkunci(client, unit.unit_id, id);
      const salah = periksaPihakLawanMutasi({ categoryLabel: b.categoryLabel, pihakLawanId: id, pihak });
      if (salah !== null) {
        await client.query("ROLLBACK");
        return { ok: false, error: `Baris ${i + 1}: ${salah}` };
      }
    }

    const ids: string[] = [];
    const bebanIds: string[] = [];
    for (const b of input.baris) {
      const r = await client.query<{ id: string }>(
        `INSERT INTO app.cash_ledger
         (unit_id, account_id, business_date, keterangan, jenis,
          category_side, category_label, amount, created_by_user_id, pihak_lawan_id,
          tanggal_asal, alasan_maju, alasan_maju_applies_to)
       VALUES ($1,$2::uuid,$3::date,$4,$5::app.cash_mutation_jenis,
               $6::app.cash_mutation_side,$7,$8,$9,$10::uuid,
               $11::date,$12,$13)
       RETURNING id::text AS id`,
        [
          unit.unit_id,
          input.accountId,
          hari.hariBuku,
          b.keterangan?.trim() || input.keterangan.trim(),
          input.jenis,
          b.categorySide,
          b.categoryLabel,
          b.amount,
          scope.userId,
          b.pihakLawanId ?? null,
          maju ? input.date : null,
          maju ? KODE_MAJU_PECAHAN : null,
          maju ? "adjustment" : null,
        ],
      );
      const id = r.rows[0]?.id ?? "?";
      ids.push(id);
      const seksi = sectionBeban(b.categoryLabel);
      if (seksi !== null) {
        const be = await tulisBebanFinance(client, {
          unitId: unit.unit_id,
          businessDate: hari.hariBuku,
          section: seksi,
          keterangan: b.keterangan?.trim() || input.keterangan.trim(),
          amountSen: rupiahKeSen(b.amount) ?? 0,
          operationalCategory: b.operationalCategory!,
          cashLedgerId: id,
          aktorId: scope.userId,
        });
        if (!be.ok) {
          await client.query("ROLLBACK");
          return { ok: false, error: be.error };
        }
        bebanIds.push(be.id);
      }
    }

    await client.query(
      `INSERT INTO app.audit_log (actor_user_id, actor_email, action, target, detail)
       VALUES ($1,$2,$3,$4,$5::jsonb)`,
      [
        scope.userId,
        scope.email,
        "kas.pecah",
        `${unit.code}/${input.accountId}`,
        JSON.stringify({
          tanggal: input.date,
          hariBuku: hari.hariBuku,
          nominal: input.total,
          keterangan: input.keterangan.trim(),
          baris: input.baris.map((b, i) => ({
            id: ids[i],
            nominal: b.amount,
            kategori: b.categoryLabel,
            pihakLawanId: b.pihakLawanId ?? null,
            kategoriOperasional: b.operationalCategory ?? null,
          })),
          beban: bebanIds,
        }),
      ],
    );
    await client.query("COMMIT");
    revalidatePath(`/keuangan/unit/${unit.code}/${hari.hariBuku}/input`);
    if (hari.hariBuku !== input.date) revalidatePath(`/keuangan/unit/${unit.code}/${input.date}/input`);
    return { ok: true, n: ids.length };
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* abaikan */
    }
    return { ok: false, error: e instanceof Error ? e.message : "Gagal menyimpan pecahan." };
  } finally {
    client.release();
  }
}
