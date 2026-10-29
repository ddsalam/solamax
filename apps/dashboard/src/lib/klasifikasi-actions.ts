"use server";

import type { PoolClient } from "pg";
import { revalidatePath } from "next/cache";
import { pool } from "./db";
import { JENIS_ANTAR_UNIT, senKeTeks, type JenisAntarUnit } from "./antar-unit-model";
import { tulisPasanganAntarUnit } from "./antar-unit-tulis";
import { bacaMutasiId, type MutasiTerbaca } from "./cocok-bank-queries";
import { buatKelompok, tambahAnggota } from "./cocok-bank-tulis";
import { hariBukuTerkunci } from "./hari-buku-queries";
import { KATEGORI_PENAMPUNG } from "./keuangan-sisi-kas";
import { pesanTakBolehInput, canCatatAntarUnit, canCocokkanBank } from "./keuangan-wewenang";
import {
  keteranganDariBank,
  periksaBarisKlasifikasi,
  periksaJumlah,
  type BarisKlasifikasi,
} from "./klasifikasi-model";
import { tulisBarisKlasifikasi } from "./klasifikasi-tulis";
import { rupiahKeSen, teksKeSen } from "./pihak-lawan-model";
import { todayWib } from "./periods";
import { getDataScope, type DataScope, type ScopedUnit } from "./scope";
import { auditKeuangan, batal } from "./keuangan-tx";
import { KODE_MAJU_IMPOR, KODE_MAJU_SUSPENSE as KODE_MAJU_PENAMPUNG } from "./keuangan-kode-maju";
import { UUID_RE } from "./validasi";
import { DATE_RE } from "./selection-keys";

/**
 * Server action KLASIFIKASI baris rekening koran (rencana 2026-10-29 U11; R9,
 * R21, R23, R27, R28, R30; KTD5, KTD6, KTD8). Tindakan BERNAMA — Keuangan
 * (`canCocokkanBank`):
 *
 *   · klasifikasi kategori (+ pihak lawan; + beban pintu Finance bila beban)
 *   · parkir di penampung "Mutasi Belum Teridentifikasi"
 *   · pecah (N baris, Σ = nominal mutasi)
 *   · pasangan antar unit (gerbang DUA unit, R30)
 *   · pindahkan dari penampung
 *   · (penebusan: `simpanPenebusan` dengan `mutasiBankId`, penebusan-actions.ts)
 *
 * ⛔ POLA SETIAP JALUR (KTD5, KTD6): gerbang (`requireUnit` + predikat) &
 * validasi SEBELUM `pool.connect()`; satu transaksi; `set_config`
 * transaction-local; rekening koran induk dikunci lalu baris impor dibaca ULANG
 * (sudah diselesaikan / ditarik / pra-cut-over ⇒ ditolak); `hariBukuTerkunci`
 * dengan tanggal = TANGGAL BANK sebelum INSERT apa pun (hari tertutup ⇒ maju
 * dengan `tanggal_asal` + `ADJ-FWD-IMPORT`); kepala kelompok cocok; baris kas
 * lahiran (`lahir_dari_cocok_id`); anggota; `audit_log` (R27). Tanpa DELETE.
 *
 * Nominal TIDAK diterima dari peramban kecuali pembagian pecahan — nominal
 * baris impor dibaca ulang di server, dan Σ diperiksa dalam sen bulat.
 */

export type KlasifikasiResult = { ok: true; pesan: string; cocokId: string } | { ok: false; error: string };

const halaman = (code: string, tanggal?: string): string[] => [
  `/keuangan/unit/${code}/impor-bank`,
  ...(tanggal ? [`/keuangan/unit/${code}/impor-bank/${tanggal.slice(0, 7)}`] : []),
];

function tabrakan(e: unknown): boolean {
  const g = e as { code?: string; constraint?: string } | null;
  return g?.code === "23505" && (g.constraint === "cocok_bank_baris_mutasi_aktif_uq" || g.constraint === "cocok_bank_baris_kas_aktif_uq");
}

type Gerbang = { boleh: false; error: string } | { boleh: true; scope: DataScope; unit: ScopedUnit };

async function gerbang(code: string): Promise<Gerbang> {
  const scope = await getDataScope();
  const unit = scope.requireUnit(code); // di luar scope → notFound(), tak menulis
  const ctx = { role: scope.role, email: scope.email };
  if (!canCocokkanBank(ctx)) return { boleh: false, error: pesanTakBolehInput(ctx) };
  return { boleh: true, scope, unit };
}

/**
 * Baris impor dibaca ULANG sesudah rekening koran induknya dikunci
 * `FOR NO KEY UPDATE` (pola `cocokkanManual`; `mutasi_bank` sendiri tak bisa
 * dikunci baris — 0051). Pencocok & penarik lain menunggu.
 */
async function bacaBarisTerbuka(
  client: PoolClient,
  unitId: ScopedUnit["unit_id"],
  mutasiId: string,
): Promise<{ ok: true; m: MutasiTerbaca } | { ok: false; error: string }> {
  const awal = await bacaMutasiId(client, unitId, [mutasiId]);
  if (awal.length !== 1) return { ok: false, error: "Baris rekening koran tak ditemukan di unit ini — muat ulang halaman." };
  await client.query(
    `SELECT id FROM app.rekening_koran
      WHERE unit_id = $1 AND id = $2::uuid
      FOR NO KEY UPDATE`,
    [unitId, awal[0]!.rekeningKoranId],
  );
  const [m] = await bacaMutasiId(client, unitId, [mutasiId]);
  if (!m) return { ok: false, error: "Baris rekening koran tak ditemukan di unit ini — muat ulang halaman." };
  if (m.rkStatus !== "aktif") return { ok: false, error: "Rekening koran baris ini sudah ditarik — tak ada yang diklasifikasi." };
  if (m.praCutover) {
    return { ok: false, error: "Baris ini bertanggal sebelum saldo pembuka — sudah termuat di saldo pembuka, jadi tidak dibukukan (R22)." };
  }
  if (m.dicocokkan) return { ok: false, error: "Baris rekening koran ini sudah diselesaikan — muat ulang halaman." };
  return { ok: true, m };
}

/**
 * Jalur satu unit: kategori, parkir, pecah. `susun` membentuk baris kas dari
 * baris impor yang SUDAH dibaca ulang (nominalnya milik server).
 */
async function klasifikasiSatuUnit(
  code: string,
  mutasiId: string,
  jenis: "kategori" | "parkir" | "pecah",
  susun: (m: MutasiTerbaca) => BarisKlasifikasi[] | string,
  rincian: Record<string, unknown>,
): Promise<KlasifikasiResult> {
  const g = await gerbang(code);
  if (!g.boleh) return { ok: false, error: g.error };
  const { scope, unit } = g;
  if (!UUID_RE.test(mutasiId)) return { ok: false, error: "Baris rekening koran tak dikenali — muat ulang halaman." };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.unit_ids', $1, true)", [String(unit.unit_id)]);

    const b = await bacaBarisTerbuka(client, unit.unit_id, mutasiId);
    if (!b.ok) {
      await batal(client);
      return { ok: false, error: b.error };
    }
    const m = b.m;
    const baris = susun(m);
    const salah =
      typeof baris === "string"
        ? baris
        : (periksaBarisKlasifikasi(baris, { bolehPenampung: jenis === "parkir" }) ?? periksaJumlah(baris, m.amountSen));
    if (salah !== null) {
      await batal(client);
      return { ok: false, error: salah };
    }
    const daftar = baris as BarisKlasifikasi[];

    // KTD5/R28 — hari buku dari TANGGAL BANK, dikunci sampai COMMIT.
    const hari = await hariBukuTerkunci(client, unit.unit_id, m.tanggalBank, { accountId: m.accountId });
    if (hari.status === "pra-cut-over") {
      await batal(client);
      return {
        ok: false,
        error: `Tanggal bank ${m.tanggalBank} mendahului saldo pembuka (${hari.cutOver}) — tidak dibukukan (R22).`,
      };
    }

    const aktor = { userId: scope.userId, email: scope.email };
    const cocokId = await buatKelompok(client, { unitId: unit.unit_id, cara: "manual", aktor });
    const t = await tulisBarisKlasifikasi(client, {
      unitId: unit.unit_id,
      accountId: m.accountId,
      hariBuku: hari.hariBuku,
      tanggal: m.tanggalBank,
      maju: hari.perluKodeAlasan,
      kodeMaju: KODE_MAJU_IMPOR,
      aktorId: scope.userId,
      lahirDariCocokId: cocokId,
      baris: daftar,
    });
    if (!t.ok) {
      await batal(client);
      return { ok: false, error: t.error };
    }
    await tambahAnggota(client, { unitId: unit.unit_id, cocokId, mutasiIds: [m.id], kasIds: t.kas.map((k) => k.id) });
    await auditKeuangan(client, aktor, `klasifikasi.${jenis}`, `${unit.code}/${cocokId}`, {
      mutasi: [m.id],
      tanggalBank: m.tanggalBank,
      hariBuku: hari.hariBuku,
      maju: hari.perluKodeAlasan,
      nominal: senKeTeks(m.amountSen),
      kas: t.kas.map((k) => ({ id: k.id, nominal: senKeTeks(k.amountSen), kategori: k.categoryLabel, beban: k.bebanId })),
      ...rincian,
    });
    await client.query("COMMIT");
    for (const p of halaman(unit.code, m.tanggalBank)) revalidatePath(p);
    const maju = hari.perluKodeAlasan ? ` Hari ${m.tanggalBank} sudah ditutup — dibukukan ${hari.hariBuku} (tanggal asal ${m.tanggalBank}).` : "";
    return {
      ok: true,
      cocokId,
      pesan: `${jenis === "parkir" ? "Diparkir di penampung" : `${t.kas.length} baris buku dicatat & dicocokkan`}.${maju}`,
    };
  } catch (e) {
    await batal(client);
    if (tabrakan(e)) return { ok: false, error: "Baris ini baru saja diselesaikan bersamaan — muat ulang halaman." };
    return { ok: false, error: e instanceof Error ? e.message : "Gagal menyimpan klasifikasi." };
  } finally {
    client.release();
  }
}

const atauNull = (s: string | null | undefined): string | null => (s == null || s.trim() === "" ? null : s.trim());

// ---------------------------------------------------------------------------
// Kategori (+ pihak lawan; + beban pintu Finance)
// ---------------------------------------------------------------------------

export interface KlasifikasiKategoriInput {
  code: string;
  mutasiId: string;
  categoryLabel: string;
  pihakLawanId?: string | null;
  /** Wajib untuk beban / pendapatan lain-lain (laba ikut tercatat). */
  operationalCategory?: string | null;
  /** Kosong ⇒ keterangan bank. */
  keterangan?: string | null;
}

export async function klasifikasiKategori(input: KlasifikasiKategoriInput): Promise<KlasifikasiResult> {
  // Vonis bentuk SEBELUM koneksi (nominal & sisinya diperiksa sesudah baris dibaca ulang).
  const pra = periksaBarisKlasifikasi([
    {
      amountSen: 1,
      categoryLabel: input.categoryLabel,
      pihakLawanId: atauNull(input.pihakLawanId),
      operationalCategory: atauNull(input.operationalCategory),
      keterangan: "x",
    },
  ]);
  if (pra !== null) return { ok: false, error: pra };
  return klasifikasiSatuUnit(
    input.code,
    input.mutasiId,
    "kategori",
    (m) => [
      {
        amountSen: m.amountSen,
        categoryLabel: input.categoryLabel,
        pihakLawanId: atauNull(input.pihakLawanId),
        operationalCategory: atauNull(input.operationalCategory),
        keterangan: keteranganDariBank(m.keterangan, input.keterangan),
      },
    ],
    { kategori: input.categoryLabel },
  );
}

// ---------------------------------------------------------------------------
// Parkir (R23, KTD8)
// ---------------------------------------------------------------------------

export async function klasifikasiParkir(input: { code: string; mutasiId: string; catatan?: string | null }): Promise<KlasifikasiResult> {
  return klasifikasiSatuUnit(
    input.code,
    input.mutasiId,
    "parkir",
    (m) => [
      {
        amountSen: m.amountSen,
        categoryLabel: KATEGORI_PENAMPUNG,
        pihakLawanId: null,
        operationalCategory: null,
        keterangan: `Diparkir — ${keteranganDariBank(m.keterangan, input.catatan)}`.slice(0, 220),
      },
    ],
    { catatan: atauNull(input.catatan) },
  );
}

// ---------------------------------------------------------------------------
// Pecah (R9)
// ---------------------------------------------------------------------------

export interface KlasifikasiPecahInput {
  code: string;
  mutasiId: string;
  /** Nominal rupiah TANPA tanda per baris — tandanya mengikuti baris impor. */
  baris: {
    amount: number;
    categoryLabel: string;
    pihakLawanId?: string | null;
    operationalCategory?: string | null;
    keterangan?: string | null;
  }[];
}

export async function klasifikasiPecah(input: KlasifikasiPecahInput): Promise<KlasifikasiResult> {
  const baris = input.baris ?? [];
  if (baris.length < 2) return { ok: false, error: "Pecahan butuh minimal dua baris — satu baris cukup lewat Kategori." };
  const sen = baris.map((b) => rupiahKeSen(Math.abs(b.amount)));
  if (sen.some((s) => s === null || s === 0)) {
    return { ok: false, error: "Setiap baris pecahan wajib bernominal, bukan nol, paling banyak dua desimal." };
  }
  const pra = periksaBarisKlasifikasi(
    baris.map((b, i) => ({
      amountSen: sen[i]!,
      categoryLabel: b.categoryLabel,
      pihakLawanId: atauNull(b.pihakLawanId),
      operationalCategory: atauNull(b.operationalCategory),
      keterangan: "x",
    })),
  );
  if (pra !== null) return { ok: false, error: pra };
  return klasifikasiSatuUnit(
    input.code,
    input.mutasiId,
    "pecah",
    (m) => {
      const tanda = m.amountSen < 0 ? -1 : 1;
      return baris.map((b, i) => ({
        amountSen: tanda * sen[i]!,
        categoryLabel: b.categoryLabel,
        pihakLawanId: atauNull(b.pihakLawanId),
        operationalCategory: atauNull(b.operationalCategory),
        keterangan: keteranganDariBank(m.keterangan, b.keterangan),
      }));
    },
    {},
  );
}

// ---------------------------------------------------------------------------
// Antar unit (R3, R30) — gerbang DUA unit sebelum BEGIN
// ---------------------------------------------------------------------------

export interface KlasifikasiAntarUnitInput {
  code: string;
  mutasiId: string;
  /** Unit di seberang pasangan. */
  lawanCode: string;
  /** Rekening kaki unit lawan. */
  lawanAccountId: string;
  jenis: string;
  catatan?: string | null;
}

const PESAN_DUA_UNIT =
  "Pasangan antar unit menulis buku KEDUA unit, dan akun ini tidak berperan Keuangan di kedua unit — " +
  "ditolak utuh, tak ada sisi yang tertulis. Minta pengguna yang memegang kedua unit (atau super admin).";

export async function klasifikasiAntarUnit(input: KlasifikasiAntarUnitInput): Promise<KlasifikasiResult> {
  const scope = await getDataScope();
  const unit = scope.requireUnit(input.code);
  const ctx = { role: scope.role, email: scope.email };
  if (!canCocokkanBank(ctx) || !canCatatAntarUnit(ctx)) {
    return { ok: false, error: pesanTakBolehInput(ctx) };
  }
  // ⛔ R30 — unit lawan harus dalam jangkauan, ditanya dulu supaya penolakannya
  //    berpesan (bukan 404), lalu `requireUnit` — keduanya SEBELUM koneksi.
  if (!scope.units.some((u) => u.code === input.lawanCode)) return { ok: false, error: PESAN_DUA_UNIT };
  const lawan = scope.requireUnit(input.lawanCode);
  if (lawan.unit_id === unit.unit_id) return { ok: false, error: "Unit lawan harus unit lain." };
  if (!UUID_RE.test(input.mutasiId)) return { ok: false, error: "Baris rekening koran tak dikenali — muat ulang halaman." };
  if (!UUID_RE.test(input.lawanAccountId)) return { ok: false, error: `Pilih rekening ${lawan.name}.` };
  if (!(JENIS_ANTAR_UNIT as readonly string[]).includes(input.jenis)) return { ok: false, error: "Pilih jenis: pinjaman, pengembalian, atau titipan." };
  const jenis = input.jenis as JenisAntarUnit;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.unit_ids', $1, true)", [`${unit.unit_id},${lawan.unit_id}`]);

    const b = await bacaBarisTerbuka(client, unit.unit_id, input.mutasiId);
    if (!b.ok) {
      await batal(client);
      return { ok: false, error: b.error };
    }
    const m = b.m;
    // Kredit ke rekening unit ini ⇒ unit ini PENERIMA (mis. transfer pelanggan
    // unit lawan yang mendarat di sini: unit ini berhutang ke lawan); debit ⇒
    // unit ini PEMBERI. Kaki unit ini = rekening baris impor, nominal = |mutasi|.
    const masuk = m.amountSen > 0;
    const sisiIni = { unitId: unit.unit_id, code: unit.code, name: unit.name };
    const sisiLawan = { unitId: lawan.unit_id, code: lawan.code, name: lawan.name };

    const aktor = { userId: scope.userId, email: scope.email };
    const cocokId = await buatKelompok(client, { unitId: unit.unit_id, cara: "manual", aktor });
    const h = await tulisPasanganAntarUnit(client, {
      pemberi: masuk ? sisiLawan : sisiIni,
      penerima: masuk ? sisiIni : sisiLawan,
      pemberiAccountId: masuk ? input.lawanAccountId : m.accountId,
      penerimaAccountId: masuk ? m.accountId : input.lawanAccountId,
      nominalSen: Math.abs(m.amountSen),
      tanggal: m.tanggalBank,
      jenis,
      catatan: (input.catatan ?? "").trim() || keteranganDariBank(m.keterangan),
      aktor,
      lahirDariCocok: { unitId: unit.unit_id, cocokId },
    });
    if (!h.ok) {
      await batal(client);
      return { ok: false, error: h.error };
    }
    const kaki = h.kaki.find((k) => k.unit === unit.code);
    if (!kaki) {
      await batal(client);
      return { ok: false, error: "Kaki unit ini tidak tertulis — tak ada yang disimpan." };
    }
    await tambahAnggota(client, { unitId: unit.unit_id, cocokId, mutasiIds: [m.id], kasIds: [kaki.id] });
    await auditKeuangan(client, aktor, "klasifikasi.antar_unit", `${unit.code}/${cocokId}`, {
      mutasi: [m.id],
      tanggalBank: m.tanggalBank,
      nominal: senKeTeks(m.amountSen),
      lawan: lawan.code,
      pasanganUuid: h.pasanganUuid,
      kaki: h.kaki,
    });
    await client.query("COMMIT");
    for (const p of halaman(unit.code, m.tanggalBank)) revalidatePath(p);
    for (const u of [unit, lawan]) revalidatePath(`/keuangan/unit/${u.code}/pihak-lawan`);
    return {
      ok: true,
      cocokId,
      pesan: `Pasangan antar unit dicatat di kedua buku (${unit.name} ↔ ${lawan.name}); kaki ${lawan.name} menunggu rekening korannya sendiri.`,
    };
  } catch (e) {
    await batal(client);
    if (tabrakan(e)) return { ok: false, error: "Baris ini baru saja diselesaikan bersamaan — muat ulang halaman." };
    return { ok: false, error: e instanceof Error ? e.message : "Gagal mencatat pasangan antar unit." };
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Pindahkan dari penampung (R23, KTD8)
// ---------------------------------------------------------------------------

export interface PindahPenampungInput {
  code: string;
  /** Baris kas parkir (kategori penampung, lahir dari kelompok cocok aktif). */
  parkirId: string;
  /** Tanggal pemindahan; kosong ⇒ hari ini (WIB). Hari tertutup ⇒ maju. */
  tanggal?: string | null;
  categoryLabel: string;
  pihakLawanId?: string | null;
  operationalCategory?: string | null;
  keterangan?: string | null;
}

export async function pindahkanDariPenampung(input: PindahPenampungInput): Promise<KlasifikasiResult> {
  const g = await gerbang(input.code);
  if (!g.boleh) return { ok: false, error: g.error };
  const { scope, unit } = g;
  if (!UUID_RE.test(input.parkirId)) return { ok: false, error: "Baris parkir tak dikenali — muat ulang halaman." };
  const tanggal = atauNull(input.tanggal) ?? todayWib();
  if (!DATE_RE.test(tanggal)) return { ok: false, error: "Tanggal pemindahan tak valid." };
  const pra = periksaBarisKlasifikasi([
    {
      amountSen: 1,
      categoryLabel: input.categoryLabel,
      pihakLawanId: atauNull(input.pihakLawanId),
      operationalCategory: atauNull(input.operationalCategory),
      keterangan: "x",
    },
  ]);
  if (pra !== null) return { ok: false, error: pra };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.unit_ids', $1, true)", [String(unit.unit_id)]);

    // Baris parkir dikunci; baris parkir TAK PERNAH disunting (KTD8).
    const r = await client.query<{
      id: string;
      accountId: string;
      businessDate: string;
      amount: string;
      keterangan: string;
      categoryLabel: string | null;
      cocokId: string | null;
      sudahDipindah: boolean;
    }>(
      `SELECT l.id::text AS id, l.account_id::text AS "accountId",
              to_char(l.business_date, 'YYYY-MM-DD') AS "businessDate", l.amount::text AS amount,
              l.keterangan, l.category_label AS "categoryLabel",
              (SELECT b.cocok_id::text FROM app.cocok_bank_baris b
                WHERE b.cash_ledger_id = l.id AND b.unit_id = l.unit_id AND b.aktif) AS "cocokId",
              EXISTS (SELECT 1 FROM app.cash_ledger x
                       WHERE x.unit_id = l.unit_id AND x.parkir_sumber_id = l.id AND NOT x.void) AS "sudahDipindah"
         FROM app.cash_ledger l
        WHERE l.id = $1::uuid AND l.unit_id = $2 AND NOT l.void
        FOR UPDATE OF l`,
      [input.parkirId, unit.unit_id],
    );
    const p = r.rows[0];
    const tolak =
      !p ? "Baris parkir tak ditemukan di unit ini (atau sudah dibatalkan) — muat ulang halaman."
      : p.categoryLabel !== KATEGORI_PENAMPUNG ? "Baris ini bukan baris penampung."
      : p.cocokId === null ? "Baris penampung ini tidak di kelompok cocok aktif — muat ulang halaman."
      : p.sudahDipindah ? "Baris parkir ini sudah dipindahkan."
      : tanggal < p.businessDate ? `Tanggal pemindahan tak boleh sebelum hari buku baris parkirnya (${p.businessDate}).`
      : null;
    if (tolak !== null) {
      await batal(client);
      return { ok: false, error: tolak };
    }
    // Kelompoknya dikunci bersama — pembatalan (FOR UPDATE) menunggu.
    const gk = await client.query<{ aktif: boolean }>(
      `SELECT aktif FROM app.cocok_bank WHERE id = $1::uuid AND unit_id = $2 FOR SHARE`,
      [p!.cocokId, unit.unit_id],
    );
    if (gk.rows[0]?.aktif !== true) {
      await batal(client);
      return { ok: false, error: "Kelompok cocok baris parkir ini baru saja dibatalkan — muat ulang halaman." };
    }

    const parkirSen = teksKeSen(p!.amount);
    const target: BarisKlasifikasi = {
      amountSen: parkirSen,
      categoryLabel: input.categoryLabel,
      pihakLawanId: atauNull(input.pihakLawanId),
      operationalCategory: atauNull(input.operationalCategory),
      keterangan: (atauNull(input.keterangan) ?? p!.keterangan.replace(/^Diparkir — /, "")).slice(0, 220),
    };
    const pembalik: BarisKlasifikasi = {
      amountSen: -parkirSen,
      categoryLabel: KATEGORI_PENAMPUNG,
      pihakLawanId: null,
      operationalCategory: null,
      keterangan: `Pindah dari penampung — ${p!.keterangan}`.slice(0, 220),
    };
    const salah = periksaBarisKlasifikasi([target]);
    if (salah !== null) {
      await batal(client);
      return { ok: false, error: salah };
    }

    const hari = await hariBukuTerkunci(client, unit.unit_id, tanggal, { accountId: p!.accountId });
    if (hari.status === "pra-cut-over") {
      await batal(client);
      return { ok: false, error: `Tanggal ${tanggal} mendahului saldo pembuka (${hari.cutOver}).` };
    }
    const t = await tulisBarisKlasifikasi(client, {
      unitId: unit.unit_id,
      accountId: p!.accountId,
      hariBuku: hari.hariBuku,
      tanggal,
      maju: hari.perluKodeAlasan,
      kodeMaju: KODE_MAJU_PENAMPUNG,
      aktorId: scope.userId,
      lahirDariCocokId: p!.cocokId,
      parkirSumberId: p!.id,
      baris: [pembalik, target],
    });
    if (!t.ok) {
      await batal(client);
      return { ok: false, error: t.error };
    }
    // Keduanya masuk kelompok AKTIF baris parkir: Σ kelompok tak berubah
    // (parkir + pembalik = 0, sisa = baris tujuan = nominal bank).
    await tambahAnggota(client, { unitId: unit.unit_id, cocokId: p!.cocokId!, mutasiIds: [], kasIds: t.kas.map((k) => k.id) });
    const aktor = { userId: scope.userId, email: scope.email };
    await auditKeuangan(client, aktor, "penampung.pindah", `${unit.code}/${p!.cocokId}`, {
      parkir: p!.id,
      tanggal,
      hariBuku: hari.hariBuku,
      maju: hari.perluKodeAlasan,
      nominal: senKeTeks(parkirSen),
      kas: t.kas.map((k) => ({ id: k.id, nominal: senKeTeks(k.amountSen), kategori: k.categoryLabel, beban: k.bebanId })),
    });
    await client.query("COMMIT");
    for (const x of halaman(unit.code, p!.businessDate)) revalidatePath(x);
    return {
      ok: true,
      cocokId: p!.cocokId!,
      pesan:
        `Dipindahkan dari penampung ke “${input.categoryLabel}”.` +
        (hari.perluKodeAlasan ? ` Hari ${tanggal} sudah ditutup — dibukukan ${hari.hariBuku}.` : ""),
    };
  } catch (e) {
    await batal(client);
    if (tabrakan(e)) return { ok: false, error: "Baris ini baru saja berubah bersamaan — muat ulang halaman." };
    return { ok: false, error: e instanceof Error ? e.message : "Gagal memindahkan dari penampung." };
  } finally {
    client.release();
  }
}
