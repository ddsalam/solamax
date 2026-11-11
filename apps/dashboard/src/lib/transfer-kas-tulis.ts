import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { senKeTeks } from "./antar-unit-model";
import { hariBukuTerkunci, kunciHariBersama } from "./hari-buku-queries";
import type { AkunKas } from "./keuangan-kas-model";
import { KODE_MAJU_TRANSFER } from "./keuangan-kode-maju";
import { auditKeuangan, type Aktor } from "./keuangan-tx";
import { KATEGORI_SETORAN } from "./cocok-bank-model";
import { teksKeSen } from "./pihak-lawan-model";
import type { ScopedUnitId } from "./scope";
import { bulanTertutupTerkunci } from "./tutup-bulan-queries";
import {
  KATEGORI_KAKI_BANK,
  KATEGORI_KELUAR_KAS_BESAR,
  PESAN_TANPA_KONFIRMASI,
  empatDigitRekening,
  kandidatJadikanTransfer,
  periksaRekeningTransfer,
  rencanaTransfer,
  ringkasKakiJadikan,
  vonisBatalTransfer,
  vonisJadikanTransfer,
  type BarisKasBesar,
  type KonfirmasiJadikan,
} from "./transfer-kas-model";

/**
 * Inti TULIS transfer Kas Besar → bank dua kaki (rencana 2026-11-11 U3/U6;
 * KTD3–KTD9) — dipanggil DI DALAM transaksi pemanggil, sesudah
 * `set_config('app.unit_ids', …, true)`. Tanpa gerbang wewenang: gerbangnya
 * milik `transfer-kas-actions.ts` dan dijalankan SEBELUM BEGIN.
 *
 * ⚠️ Sengaja BUKAN berkas "use server" (pola `antar-unit-tulis.ts` /
 * `cocok-bank-tulis.ts`): setiap ekspor berkas seperti itu menjadi endpoint
 * peramban — termasuk fungsi tanpa gerbang di bawah.
 *
 * ⛔ VOID, tak pernah DELETE dan tak pernah menyunting kategori (0029). Koreksi
 * baris lama = void + sisip baru; kaki Kas Besar hanya DITAUTKAN (`UPDATE
 * transfer_uuid` saja — kategori & nominalnya sudah benar).
 */

export type HasilCatat =
  | { ok: true; sudahAda: true }
  | { ok: true; sudahAda: false; hariBuku: string; maju: boolean; kasId: string; bankId: string; namaBank: string; sen: number }
  | { ok: false; error: string };

/** Nama indeks unik 0062 — pelanggarannya = kiriman ganda dengan kunci sama (KTD5). */
export const INDEKS_KUNCI_TRANSFER = "cash_ledger_transfer_akun_uq";

const INSERT_KAKI_TRANSFER = `INSERT INTO app.cash_ledger
         (unit_id, account_id, business_date, keterangan, jenis,
          category_side, category_label, amount, created_by_user_id,
          tanggal_asal, alasan_maju, alasan_maju_applies_to, transfer_uuid)
       VALUES ($1,$2::uuid,$3::date,$4,$5::app.cash_mutation_jenis,
               $6::app.cash_mutation_side,$7,$8::numeric,$9,
               $10::date,$11,$12,$13::uuid)
       RETURNING id::text AS id`;

/**
 * Bulan `tanggal` sudah ditutup? Lewat `bulanTertutupTerkunci` — kunci BERSAMA
 * bulan diambil dulu, jadi "Tutup bulan" yang berjalan menunggu tulisan ini.
 * Urutan kunci selalu bulan → hari (pola `batal-balik-tulis.ts`).
 */
async function bulanTertutup(c: PoolClient, unitId: ScopedUnitId, tanggal: string): Promise<boolean> {
  return (await bulanTertutupTerkunci(c, unitId, [tanggal.slice(0, 7)])).length > 0;
}

/**
 * Kaki keluar Kas Besar (kredit P6, non-void) pada satu hari buku — bahan
 * `kakiTransferTerlewat` (penjaga tab bank) dan pemeriksaan ulang calon
 * "Jadikan transfer". Satu kueri untuk keduanya.
 */
export async function bacaKasKeluarHari(c: PoolClient, unitId: ScopedUnitId, tanggal: string): Promise<BarisKasBesar[]> {
  const r = await c.query<{ id: string; tanggal: string; kategori: string | null; amount: string; transferUuid: string | null; void: boolean }>(
    `SELECT l.id::text AS id, to_char(l.business_date,'YYYY-MM-DD') AS tanggal, l.category_label AS kategori,
            l.amount::text AS amount, l.transfer_uuid::text AS "transferUuid", l.void
       FROM app.cash_ledger l
       JOIN app.cash_account a ON a.id = l.account_id AND a.unit_id = l.unit_id
      WHERE l.unit_id = $1 AND a.kind = 'kas' AND l.business_date = $2::date
        AND NOT l.void AND l.category_label = ANY($3::text[])`,
    [unitId, tanggal, KATEGORI_KELUAR_KAS_BESAR],
  );
  return r.rows.map((k) => ({ ...k, amountSen: teksKeSen(k.amount) }));
}

/**
 * Hari-hari ini ada yang `closed`? Kunci advisory BERSAMA per hari diambil dulu
 * (`kunciHariBersama`) supaya tutup hari yang sedang berjalan menunggu kita,
 * lalu status dibaca ulang (pola `hariBukuTerkunci`).
 */
async function adaHariTertutup(c: PoolClient, unitId: ScopedUnitId, hari: readonly string[]): Promise<boolean> {
  for (const h of [...new Set(hari)].sort()) await kunciHariBersama(c, unitId, h);
  const r = await c.query(
    `SELECT 1 AS ada FROM app.day_close
      WHERE unit_id = $1 AND business_date = ANY($2::date[]) AND status = 'closed'`,
    [unitId, [...new Set(hari)]],
  );
  return r.rows.length > 0;
}

/**
 * CATAT transfer: dua kaki, satu `transfer_uuid` (= kunci klien), satu hari
 * buku. Kunci yang sudah ada (void pun) ⇒ `sudahAda`, tanpa menulis (KTD5).
 */
export async function tulisTransferKeBank(
  c: PoolClient,
  m: {
    unitId: ScopedUnitId;
    unitCode: string;
    aktor: Aktor;
    tanggal: string;
    bankAccountId: string;
    amount: number;
    keterangan: string;
    kunci: string;
  },
): Promise<HasilCatat> {
  const ada = await c.query(`SELECT 1 AS ada FROM app.cash_ledger WHERE transfer_uuid = $1::uuid LIMIT 1`, [m.kunci]);
  if (ada.rows.length > 0) return { ok: true, sudahAda: true };

  // Rekening dikunci FOR SHARE: penonaktifan bersamaan menunggu sampai COMMIT.
  const akun = await c.query<AkunKas>(
    `SELECT id::text AS id, nama, kind::text AS kind, active
       FROM app.cash_account
      WHERE unit_id = $1 AND (kind = 'kas' OR id = $2::uuid)
      ORDER BY id
      FOR SHARE`,
    [m.unitId, m.bankAccountId],
  );
  const kas = akun.rows.filter((a) => a.kind === "kas");
  if (kas.length !== 1) {
    return { ok: false, error: `Unit ini punya ${kas.length} rekening Kas Besar — transfer tidak dicatat (seharusnya tepat satu).` };
  }
  const bank = akun.rows.find((a) => a.id === m.bankAccountId) ?? null;

  if (await bulanTertutup(c, m.unitId, m.tanggal)) {
    return { ok: false, error: "Bulan tanggal ini sudah ditutup — transfer tidak bisa dicatat di bulan tertutup." };
  }
  // Rekening yang salah jenis ditolak SEBELUM mengunci hari bukunya.
  const salahAkun = periksaRekeningTransfer(kas[0]!, bank);
  if (salahAkun !== null || bank === null) return { ok: false, error: salahAkun ?? "Rekening tujuan tak valid." };
  const hariKas = await hariBukuTerkunci(c, m.unitId, m.tanggal, { accountId: kas[0]!.id });
  const hariBank = await hariBukuTerkunci(c, m.unitId, m.tanggal, { accountId: bank.id });
  const r = rencanaTransfer({ ...m, akunKas: kas[0]!, akunBank: bank, hariKas, hariBank });
  if (!r.ok) return r;
  const { rencana } = r;

  const kaki = async (k: typeof rencana.kas): Promise<string> => {
    const ins = await c.query<{ id: string }>(INSERT_KAKI_TRANSFER, [
      m.unitId,
      k.accountId,
      rencana.hariBuku,
      r.keterangan,
      k.jenis,
      k.jenis,
      k.kategori,
      senKeTeks(k.amountSen),
      m.aktor.userId,
      rencana.maju ? m.tanggal : null,
      rencana.maju ? KODE_MAJU_TRANSFER : null,
      rencana.maju ? "adjustment" : null,
      m.kunci,
    ]);
    const id = ins.rows[0]?.id;
    if (!id) throw new Error("Kaki transfer tidak tersimpan.");
    return id;
  };
  const kasId = await kaki(rencana.kas);
  const bankId = await kaki(rencana.bank);

  await auditKeuangan(c, m.aktor, "kas.transfer.catat", `${m.unitCode}/${m.kunci}`, {
    transfer: m.kunci,
    kas: kasId,
    bank: bankId,
    rekening: bank.id,
    nominal: senKeTeks(rencana.bank.amountSen),
    tanggal: m.tanggal,
    hariBuku: rencana.hariBuku,
    maju: rencana.maju,
  });
  return { ok: true, sudahAda: false, hariBuku: rencana.hariBuku, maju: rencana.maju, kasId, bankId, namaBank: bank.nama, sen: rencana.bank.amountSen };
}

export type HasilBatal = { ok: true; kaki: string[]; hariBuku: string[] } | { ok: false; error: string };

/**
 * BATALKAN transfer: kedua kaki di-void bersama (KTD6). Kaki dikunci
 * `FOR UPDATE` berurut id; ditolak bila salah satu di kelompok cocok aktif,
 * hari bukunya tertutup, atau bulannya tertutup (§10.48 #4).
 */
export async function tulisBatalTransfer(
  c: PoolClient,
  m: { unitId: ScopedUnitId; unitCode: string; aktor: Aktor; transferUuid: string },
): Promise<HasilBatal> {
  const kaki = await c.query<{ id: string; hari: string; void: boolean; amount: string; dicocokkan: boolean }>(
    `SELECT l.id::text AS id, to_char(l.business_date,'YYYY-MM-DD') AS hari, l.void, l.amount::text AS amount,
            EXISTS (
              SELECT 1 FROM app.cocok_bank_baris b
               WHERE b.cash_ledger_id = l.id AND b.unit_id = l.unit_id AND b.aktif
            ) AS dicocokkan
       FROM app.cash_ledger l
      WHERE l.unit_id = $1 AND l.transfer_uuid = $2::uuid AND NOT l.void
      ORDER BY l.id
      FOR UPDATE OF l`,
    [m.unitId, m.transferUuid],
  );
  const legs = kaki.rows;
  const hari = legs.map((l) => l.hari);
  const bulanTutup = legs.length === 2 && (await bulanTertutup(c, m.unitId, hari[0]!));
  const tolak = vonisBatalTransfer({
    legs,
    dicocokkan: legs.some((l) => l.dicocokkan),
    hariTutup: legs.length === 2 && (await adaHariTertutup(c, m.unitId, hari)),
    bulanTutup,
  });
  if (tolak !== null) return { ok: false, error: tolak };

  const up = await c.query(
    `UPDATE app.cash_ledger
        SET void = true, voided_by_user_id = $1, voided_at = now()
      WHERE unit_id = $2 AND transfer_uuid = $3::uuid AND NOT void`,
    [m.aktor.userId, m.unitId, m.transferUuid],
  );
  if (up.rowCount !== 2) throw new Error(`Pembatalan transfer menyentuh ${up.rowCount} baris, bukan 2 — dibatalkan utuh.`);
  await auditKeuangan(c, m.aktor, "kas.transfer.batal", `${m.unitCode}/${m.transferUuid}`, {
    transfer: m.transferUuid,
    kaki: legs.map((l) => l.id),
    nominal: legs.map((l) => l.amount),
    hariBuku: [...new Set(hari)],
  });
  return { ok: true, kaki: legs.map((l) => l.id), hariBuku: [...new Set(hari)] };
}

export type HasilKoreksi =
  | { ok: true; baru: string; transferUuid: string; tanggal: string }
  | { ok: false; error: string };

interface BarisKoreksiDb {
  id: string;
  accountId: string;
  kind: string;
  tanggal: string;
  jenis: string;
  kategori: string | null;
  amount: string;
  void: boolean;
  transferUuid: string | null;
  pasanganUuid: string | null;
  saldoAwal: boolean;
  dariSetoranPengawas: boolean;
  keterangan: string;
  tanggalAsal: string | null;
  alasanMaju: string | null;
  alasanMajuAppliesTo: string | null;
  dibuat: string;
  namaAkun: string;
  nomorRekening: string | null;
  dicocokkan: boolean;
}

/**
 * JADIKAN TRANSFER (R16, KTD9): baris bank "Setoran Hasil Penjualan" lama +
 * kaki keluar Kas Besar-nya ⇒ baris bank lama di-VOID, baris bank baru "Pindah
 * Buku" (rekening, hari buku, `tanggal_asal`/alasan maju, keterangan, nominal
 * SAMA) disisipkan dengan `transfer_uuid` baru, dan kaki Kas Besar ditautkan ke
 * uuid yang sama. Tanpa pembukuan maju: koreksi ini netral kas dan menjaga
 * tanggal aslinya (§10.53 #2 — jurnal hari tertutup di bulan terbuka dibentuk
 * ulang). Kandidat diperiksa ULANG sesudah dikunci.
 */
export async function tulisJadikanTransfer(
  c: PoolClient,
  m: {
    unitId: ScopedUnitId;
    unitCode: string;
    aktor: Aktor;
    bankId: string;
    kasId: string;
    alasan: string;
    bolehHariTutup: boolean;
    /** Sudah diperiksa aksi (`periksaKonfirmasiJadikan`); dicocokkan ulang di sini. */
    konfirmasi: KonfirmasiJadikan;
  },
): Promise<HasilKoreksi> {
  if (m.konfirmasi?.yakin !== true) return { ok: false, error: PESAN_TANPA_KONFIRMASI };
  const baris = await c.query<BarisKoreksiDb>(
    `SELECT l.id::text AS id, l.account_id::text AS "accountId", a.kind::text AS kind,
            to_char(l.business_date,'YYYY-MM-DD') AS tanggal, l.jenis::text AS jenis,
            l.category_label AS kategori, l.amount::text AS amount, l.void,
            l.transfer_uuid::text AS "transferUuid", l.pasangan_uuid::text AS "pasanganUuid",
            l.saldo_awal AS "saldoAwal", (l.source_manual_entry_id IS NOT NULL) AS "dariSetoranPengawas",
            l.keterangan, to_char(l.tanggal_asal,'YYYY-MM-DD') AS "tanggalAsal",
            l.alasan_maju AS "alasanMaju", l.alasan_maju_applies_to AS "alasanMajuAppliesTo",
            l.created_at::text AS dibuat, a.nama AS "namaAkun", a.nomor_rekening AS "nomorRekening",
            EXISTS (
              SELECT 1 FROM app.cocok_bank_baris b
               WHERE b.cash_ledger_id = l.id AND b.unit_id = l.unit_id AND b.aktif
            ) AS dicocokkan
       FROM app.cash_ledger l
       JOIN app.cash_account a ON a.id = l.account_id AND a.unit_id = l.unit_id
      WHERE l.unit_id = $1 AND l.id = ANY($2::uuid[])
      ORDER BY l.id
      FOR UPDATE OF l`,
    [m.unitId, [m.bankId, m.kasId]],
  );
  const bank = baris.rows.find((b) => b.id === m.bankId);
  const kas = baris.rows.find((b) => b.id === m.kasId);
  const BERUBAH = "Baris ini sudah berubah (dibatalkan, ditautkan, atau dikoreksi) — muat ulang halaman.";
  if (!bank || !kas || bank.kind !== "bank" || kas.kind !== "kas" || bank.jenis !== "debet" || bank.saldoAwal || bank.pasanganUuid !== null) {
    return { ok: false, error: BERUBAH };
  }

  // Calon dibaca ulang terhadap SEMUA kaki keluar Kas Besar hari itu: satu
  // kaki Kas Besar kedua bernominal sama membuat pasangannya tak lagi tunggal.
  const kasRows = await bacaKasKeluarHari(c, m.unitId, bank.tanggal);
  // Baris bank SHP lain di hari yang sama ikut dinilai: satu kaki Kas Besar yang
  // diperebutkan dua baris bank harus "periksa manual" — sama dengan daftarnya.
  const bankLain = await c.query<{ id: string; accountId: string; amount: string; dibuat: string; dariSetoranPengawas: boolean }>(
    `SELECT l.id::text AS id, l.account_id::text AS "accountId", l.amount::text AS amount, l.created_at::text AS dibuat,
            (l.source_manual_entry_id IS NOT NULL) AS "dariSetoranPengawas"
       FROM app.cash_ledger l
       JOIN app.cash_account a ON a.id = l.account_id AND a.unit_id = l.unit_id
      WHERE l.unit_id = $1 AND a.kind = 'bank' AND l.jenis = 'debet' AND l.business_date = $2::date
        AND l.category_label = $3 AND NOT l.void AND l.transfer_uuid IS NULL AND l.id <> $4::uuid`,
    [m.unitId, bank.tanggal, KATEGORI_SETORAN, bank.id],
  );
  const calon = kandidatJadikanTransfer(
    [
      { id: bank.id, accountId: bank.accountId, tanggal: bank.tanggal, kategori: bank.kategori, amountSen: teksKeSen(bank.amount), transferUuid: bank.transferUuid, void: bank.void, dibuat: bank.dibuat, dariSetoranPengawas: bank.dariSetoranPengawas },
      ...bankLain.rows.map((b) => ({ ...b, tanggal: bank.tanggal, kategori: KATEGORI_SETORAN, amountSen: teksKeSen(b.amount), transferUuid: null, void: false })),
    ],
    kasRows,
  );
  const siap = calon.siap.find((x) => x.bank.id === bank.id);
  if (!siap || siap.kas.id !== kas.id) return { ok: false, error: BERUBAH };

  // Yang dikonfirmasi pengguna harus SAMA dengan baris yang kini dikunci.
  const nominalSen = teksKeSen(bank.amount);
  const rekening4 = empatDigitRekening({ nama: bank.namaAkun, nomorRekening: bank.nomorRekening });
  if (m.konfirmasi.tanggal !== bank.tanggal || m.konfirmasi.nominalSen !== nominalSen) {
    return { ok: false, error: "Yang dikonfirmasi tidak sama dengan baris saat ini (tanggal atau nominal) — muat ulang halaman." };
  }

  const bulanTutup = await bulanTertutup(c, m.unitId, bank.tanggal);
  const hariTutup = await adaHariTertutup(c, m.unitId, [bank.tanggal]);
  const tolak = vonisJadikanTransfer({
    bulanTutup,
    hariTutup,
    dicocokkan: bank.dicocokkan || kas.dicocokkan,
    bolehHariTutup: m.bolehHariTutup,
    alasan: m.alasan,
  });
  if (tolak !== null) return { ok: false, error: tolak };

  const v = await c.query(
    `UPDATE app.cash_ledger
        SET void = true, voided_by_user_id = $1, voided_at = now()
      WHERE id = $2::uuid AND unit_id = $3 AND NOT void AND transfer_uuid IS NULL`,
    [m.aktor.userId, bank.id, m.unitId],
  );
  if (v.rowCount !== 1) return { ok: false, error: BERUBAH };

  const transferUuid = randomUUID();
  const ins = await c.query<{ id: string }>(INSERT_KAKI_TRANSFER, [
    m.unitId,
    bank.accountId,
    bank.tanggal,
    bank.keterangan,
    "debet",
    "debet",
    KATEGORI_KAKI_BANK,
    bank.amount,
    m.aktor.userId,
    bank.tanggalAsal,
    bank.alasanMaju,
    bank.alasanMajuAppliesTo,
    transferUuid,
  ]);
  const baru = ins.rows[0]?.id;
  if (!baru) throw new Error("Baris bank baru tidak tersimpan.");

  const t = await c.query(
    `UPDATE app.cash_ledger
        SET transfer_uuid = $1::uuid
      WHERE id = $2::uuid AND unit_id = $3 AND NOT void AND transfer_uuid IS NULL`,
    [transferUuid, kas.id, m.unitId],
  );
  if (t.rowCount !== 1) throw new Error("Kaki Kas Besar gagal ditautkan — koreksi dibatalkan utuh.");

  await auditKeuangan(c, m.aktor, "kas.transfer.koreksi", `${m.unitCode}/${transferUuid}`, {
    lama: bank.id,
    baru,
    kas: kas.id,
    transfer: transferUuid,
    tanggal: bank.tanggal,
    nominal: bank.amount,
    kategoriLama: bank.kategori,
    hariTutup,
    alasan: m.alasan.trim() || null,
    // Kedua kaki menurut server + yang dikonfirmasi pengguna (tanggal, nominal, 4 digit rekening).
    kaki: ringkasKakiJadikan({
      unitCode: m.unitCode,
      tanggal: bank.tanggal,
      nominalSen,
      rekening4,
      kasKategori: kas.kategori ?? "",
      bankId: bank.id,
      kasId: kas.id,
    }),
    konfirmasi: { yakin: true, ditampilkan: { tanggal: m.konfirmasi.tanggal, nominalSen: m.konfirmasi.nominalSen, rekening4: m.konfirmasi.rekening4 } },
  });
  return { ok: true, baru, transferUuid, tanggal: bank.tanggal };
}

/** Pelanggaran indeks unik kunci transfer (kiriman ganda bersamaan, KTD5)? */
export function galatKunciGanda(e: unknown): boolean {
  const x = e as { code?: string; constraint?: string } | null;
  return x?.code === "23505" && x.constraint === INDEKS_KUNCI_TRANSFER;
}
