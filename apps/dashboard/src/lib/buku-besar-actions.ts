"use server";

import { revalidatePath } from "next/cache";
import type { PoolClient } from "pg";
import { bacaRupiah } from "./angka-input";
import { POS, type BarisJurnal } from "./buku-besar-model";
import { SALDO_NOL_DIPERTAHANKAN, barisPembalikan, periksaMemorial, periksaPersetujuan, periksaSaldoAwal } from "./buku-besar-memorial-model";
import { KUNCI_SALDO_AWAL_POS_SQL } from "./tutup-bulan-queries";
import { kasPerPos, keKasPembuka, SQL_KAS_PEMBUKA, SQL_SALDO_AWAL_POS, type BarisKasPembuka } from "./buku-besar-queries";
import { bentukUlangRentang, koreksiMajuBulan, KUNCI_BULAN_BUKU_BESAR_SQL } from "./buku-besar-tulis";
import { pool } from "./db";
import { auditKeuangan, batal } from "./keuangan-tx";
import {
  canIsiSaldoAwalPos,
  canSetujuiMemorial,
  canTutupBulan,
  canUsulkanMemorial,
  PESAN_TAK_BOLEH_MEMORIAL,
  PESAN_TAK_BOLEH_SALDO_AWAL_POS,
  PESAN_TAK_BOLEH_SETUJUI_MEMORIAL,
} from "./keuangan-wewenang";
import type { Pos } from "./pos-model";
import { barisKePos, SQL_DAFTAR_POS } from "./pos-queries";
import { getDataScope } from "./scope";
import { UUID_RE } from "./validasi";

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
  } finally {
    // Hari yang sudah COMMIT tetap, juga saat rentang berhenti di tengah.
    revalidatePath(`/keuangan/unit/${unit.code}/buku-besar`, "layout");
  }
}


export type KoreksiMajuResult =
  | { ok: true; hari: number; koreksi: number; pesan: string }
  | { ok: false; error: string; hariSelesai: number };

/**
 * "Periksa ulang bulan tertutup" (KTD3, R13) — bulan yang ditutup dengan buku
 * besar dibentuk ulang per hari dalam mode koreksi maju. Wewenang sama dengan
 * bentuk ulang (HoF + super admin): yang diubah adalah isi bulan berjalan
 * berikutnya. Yang datang dari klien hanya unit dan bulan.
 */
export async function koreksiMajuBukuBesar(input: { code: string; bulan: string }): Promise<KoreksiMajuResult> {
  const scope = await getDataScope();
  const unit = scope.requireUnit(input.code); // di luar scope → notFound()
  if (!canTutupBulan({ role: scope.role, email: scope.email })) {
    return { ok: false, error: "Hanya Head of Finance yang boleh memeriksa ulang bulan tertutup.", hariSelesai: 0 };
  }
  try {
    const r = await koreksiMajuBulan(() => pool.connect(), unit.unit_id, input.bulan, {
      aktor: { userId: scope.userId, email: scope.email },
    });
    if (!r.ok) return { ok: false, error: r.error, hariSelesai: r.hari.length };
    const kor = r.hari.filter((h) => h.koreksi !== null);
    return {
      ok: true,
      hari: r.hari.length,
      koreksi: kor.length,
      pesan:
        kor.length === 0
          ? `Bulan ${input.bulan} diperiksa ulang (${r.hari.length} hari): tidak ada sumber yang berubah, tidak ada koreksi.`
          : `Bulan ${input.bulan} diperiksa ulang: ${kor.length} hari berubah, koreksi maju diposting ke ${[...new Set(kor.map((h) => h.koreksi!.tanggalBuku))].join(", ")}.`,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Gagal memeriksa ulang bulan tertutup.", hariSelesai: 0 };
  } finally {
    revalidatePath(`/keuangan/unit/${unit.code}/buku-besar`, "layout");
  }
}

// ===========================================================================
// Saldo awal pos & jurnal memorial (rencana 2026-11-02 K6 U9; R8, R9, KD13)
// ===========================================================================
//
// Kerangka setiap aksi: getDataScope → requireUnit → can* → validasi bentuk →
// BEGIN → set_config → baca ulang di transaksi → validasi murni
// (`buku-besar-memorial-model.ts`) → DML → auditKeuangan → COMMIT →
// revalidatePath. Yang datang dari klien hanya isian HoF; kas/bank, status
// persetujuan, dan pengusul ditentukan server.

export type BukuBesarResult = { ok: true; pesan: string } | { ok: false; error: string; bedaSen?: number };

const halamanBukuBesar = (code: string): void => revalidatePath(`/keuangan/unit/${code}/buku-besar`, "layout");

/** Pos yang dibaca `SQL_SALDO_SEBELUM` (U8) — mengubahnya menuntut bentuk ulang. */
const POS_DIBACA_PEMBENTUKAN: readonly string[] = [POS.PERSEDIAAN_TANGKI, POS.SO_DIBAYAR, POS.BELUM_DISETOR];
const SARAN_BENTUK_ULANG = " Pos persediaan/SO/1103 berubah — jalankan \"Bentuk ulang bulan ini\" supaya jurnal harian ikut.";

function pesanGalat(e: unknown, cadangan: string): string {
  // check_violation dari trigger 0058 (bulan beku, pos tak sah, empat mata) membawa kalimat yang terbaca.
  return e instanceof Error ? e.message : cadangan;
}

async function daftarPosDiTransaksi(c: PoolClient, unitId: number): Promise<Pos[]> {
  const r = await c.query(SQL_DAFTAR_POS, [unitId]);
  return (r.rows as Parameters<typeof barisKePos>[0][]).map(barisKePos);
}

/**
 * Rupiah bulat yang diketik → sen (`bacaRupiah`: titik = ribuan; yang ambigu
 * ditolak, tidak ditebak). Kosong = 0. Galat membawa contoh cara mengetik.
 */
function senDariIsian(v: string, bolehNegatif: boolean): { sen: number } | { error: string } {
  const h = bacaRupiah(v, { bolehNegatif });
  if (h.keadaan === "kosong") return { sen: 0 };
  if (h.keadaan === "tolak") return { error: h.pesan };
  return { sen: h.nilai * 100 };
}

async function bulanBeku(c: PoolClient, unitId: number, tanggal: string): Promise<boolean> {
  const r = await c.query<{ ada: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM app.tutup_bulan
                     WHERE unit_id = $1 AND buku_besar AND bulan = date_trunc('month', $2::date)::date) AS ada`,
    [unitId, tanggal],
  );
  return r.rows[0]?.ada === true;
}

// ---------------------------------------------------------------------------
// Saldo awal pos (R9, AE10)
// ---------------------------------------------------------------------------

export interface SimpanSaldoAwalInput {
  code: string;
  /** Isian HoF di sisi normal pos (rupiah). Kas & bank tidak dikirim — dibaca dari rekening. */
  nilai: { posKode: string; rupiah: string }[];
  alasan: string;
}

/**
 * Simpan saldo awal pos 30 Sep 2026 SELURUHNYA (R9): set lama di-void, set
 * baru disisipkan — VOID-only (0058 keputusan 8). Kas/bank disalin dari saldo
 * pembuka rekening (`sumber = 'akun_kas'`). Tidak seimbang ⇒ ditolak dengan
 * bedanya (AE10), tanpa angka penyeimbang.
 *
 * ⛔ Sesudah bulan pertama ditutup dengan buku besar, saldo awal tidak bisa
 * diganti lagi — koreksinya jurnal memorial ke 3200 di bulan terbuka
 * (spec-flow I9). Bulan beku tak boleh berubah diam-diam lewat saldo awal.
 */
export async function simpanSaldoAwalPos(input: SimpanSaldoAwalInput): Promise<BukuBesarResult> {
  const scope = await getDataScope();
  const unit = scope.requireUnit(input.code); // di luar scope → notFound()
  if (!canIsiSaldoAwalPos({ role: scope.role, email: scope.email })) return { ok: false, error: PESAN_TAK_BOLEH_SALDO_AWAL_POS };
  if (input.alasan.trim() === "") return { ok: false, error: "Alasan wajib diisi: dari mana angka ini berasal." };
  const ketik: { posKode: string; nilaiSen: number }[] = [];
  for (const n of input.nilai) {
    const h = senDariIsian(n.rupiah, true);
    if ("error" in h) return { ok: false, error: `Pos ${n.posKode}: ${h.error}` };
    // Nol yang DIISI untuk 1131/1132 = saldo awal yang diketahui; isian kosong = belum diisi.
    const nolBermakna = SALDO_NOL_DIPERTAHANKAN.has(n.posKode) && n.rupiah.trim() !== "";
    if (h.sen !== 0 || nolBermakna) ketik.push({ posKode: n.posKode, nilaiSen: h.sen });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.unit_ids', $1, true)", [String(unit.unit_id)]);
    // Dua HoF menyimpan bersamaan ⇒ berurutan, set yang terakhir menang utuh.
    // Kunci yang SAMA diambil tutupBulan (bersama) — saldo awal tak bisa berganti
    // di tengah tutup bulan pertama yang memakai buku besar (tinjauan PR #448).
    await client.query(`SELECT pg_advisory_xact_lock(${KUNCI_SALDO_AWAL_POS_SQL})`, [unit.unit_id]);
    const beku = await client.query<{ ada: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM app.tutup_bulan WHERE unit_id = $1 AND buku_besar) AS ada`,
      [unit.unit_id],
    );
    if (beku.rows[0]?.ada) {
      await batal(client);
      return {
        ok: false,
        error: "Sudah ada bulan yang ditutup dengan buku besar — saldo awal tidak bisa diganti. Koreksi dengan jurnal memorial ke 3200 Laba Ditahan di bulan terbuka.",
      };
    }
    const daftar = await daftarPosDiTransaksi(client, unit.unit_id);
    const kas = kasPerPos((await client.query<BarisKasPembuka>(SQL_KAS_PEMBUKA, [unit.unit_id])).rows.map(keKasPembuka));
    const hasil = periksaSaldoAwal({ ketik, kas, daftar });
    if (!hasil.ok) {
      await batal(client);
      return { ok: false, error: hasil.error, bedaSen: hasil.bedaSen };
    }
    const lama = (await client.query<{ posKode: string; saldoSen: string; sumber: string }>(SQL_SALDO_AWAL_POS, [unit.unit_id])).rows;
    await client.query(
      `UPDATE app.saldo_awal_pos SET void = true, voided_by_user_id = $2, voided_at = now()
        WHERE unit_id = $1 AND NOT void`,
      [unit.unit_id, scope.userId],
    );
    await client.query(
      `INSERT INTO app.saldo_awal_pos (unit_id, pos_kode, saldo_sen, sumber, entered_by_user_id)
       SELECT $1, x.pos, x.saldo, x.sumber, $5
         FROM unnest($2::text[], $3::bigint[], $4::text[]) AS x(pos, saldo, sumber)`,
      [unit.unit_id, hasil.baris.map((b) => b.posKode), hasil.baris.map((b) => b.saldoSen), hasil.baris.map((b) => b.sumber), scope.userId],
    );
    await auditKeuangan(client, scope, lama.length ? "buku_besar.saldo_awal_ganti" : "buku_besar.saldo_awal_tetapkan", `${unit.code}`, {
      alasan: input.alasan.trim(),
      baris: hasil.baris,
      sebelumnya: lama.map((l) => ({ posKode: l.posKode, saldoSen: Number(l.saldoSen), sumber: l.sumber })),
    });
    await client.query("COMMIT");
    halamanBukuBesar(unit.code);
    const ubah = (k: string) =>
      (lama.find((l) => l.posKode === k)?.saldoSen ?? "0") !== String(hasil.baris.find((b) => b.posKode === k)?.saldoSen ?? 0);
    return {
      ok: true,
      pesan: `Saldo awal ${unit.code} per 30 Sep 2026 disimpan (${hasil.baris.length} pos, seimbang).${lama.length && POS_DIBACA_PEMBENTUKAN.some(ubah) ? SARAN_BENTUK_ULANG : ""}`,
    };
  } catch (e) {
    await batal(client);
    return { ok: false, error: pesanGalat(e, "Gagal menyimpan saldo awal.") };
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Jurnal memorial (R8, KD13, KTD11)
// ---------------------------------------------------------------------------

export interface UsulkanMemorialInput {
  code: string;
  /** `YYYY-MM-DD` — hari mana pun di bulan yang belum ditutup dengan buku besar (R13). */
  tanggal: string;
  alasan: string;
  bukti: string;
  baris: { posKode: string; debet: string; kredit: string }[];
}

const SQL_SISIP_MEMORIAL = `
  INSERT INTO app.jurnal
    (unit_id, tanggal_buku, tanggal_efektif, jenis, aturan, sumber_tabel, sumber_id, keterangan, status,
     diusulkan_oleh_user_id, created_by_user_id)
  VALUES ($1, $2::date, $2::date, 'memorial', 'P21', $3, $4, $5, $6, $7, $7)
  RETURNING id::text AS id`;

const SQL_SISIP_BARIS = `
  INSERT INTO app.jurnal_baris (jurnal_id, unit_id, pos_kode, debet_sen, kredit_sen)
  SELECT $1::uuid, $2, x.pos, x.d, x.k FROM unnest($3::text[], $4::bigint[], $5::bigint[]) AS x(pos, d, k)`;

/** Sisipkan memorial yang SUDAH lolos `periksaMemorial`, di bawah kunci bulan BERSAMA. */
async function sisipMemorial(
  c: PoolClient,
  unitId: number,
  m: { tanggal: string; keterangan: string; status: "aktif" | "menunggu"; baris: readonly BarisJurnal[]; pengusul: number; sumber?: { tabel: string; id: string } },
): Promise<string> {
  // Kunci bulan BERSAMA — sama dengan pembentukan ulang; `tutupBulan` memegang
  // yang eksklusif, jadi memorial tidak menyelinap ke bulan yang sedang ditutup.
  await c.query(`SELECT pg_advisory_xact_lock_shared(${KUNCI_BULAN_BUKU_BESAR_SQL})`, [unitId, m.tanggal.slice(0, 7)]);
  const id = (
    await c.query<{ id: string }>(SQL_SISIP_MEMORIAL, [
      unitId,
      m.tanggal,
      m.sumber?.tabel ?? null,
      m.sumber?.id ?? null,
      m.keterangan,
      m.status,
      m.pengusul,
    ])
  ).rows[0]!.id;
  await c.query(SQL_SISIP_BARIS, [id, unitId, m.baris.map((b) => b.posKode), m.baris.map((b) => b.debetSen), m.baris.map((b) => b.kreditSen)]);
  return id;
}

const keteranganMemorial = (alasan: string, bukti: string) => `${alasan.trim()} · bukti: ${bukti.trim()}`;

/**
 * HoF mengetik jurnal memorial (R8). Status DIPUTUSKAN server: > Rp 100.000
 * atau menyentuh 1103/1190/1198/1199/5130 ⇒ `menunggu` (tidak masuk laporan
 * sampai Direksi menyetujui); selainnya `aktif` langsung. KTD11 (pelanggan
 * membayar ke rekening unit lain) memakai jalur ini juga, satu memorial di tiap unit.
 */
export async function usulkanMemorial(input: UsulkanMemorialInput): Promise<BukuBesarResult> {
  const scope = await getDataScope();
  const unit = scope.requireUnit(input.code); // di luar scope → notFound()
  if (!canUsulkanMemorial({ role: scope.role, email: scope.email })) return { ok: false, error: PESAN_TAK_BOLEH_MEMORIAL };
  const baris: BarisJurnal[] = [];
  for (const b of input.baris) {
    const d = senDariIsian(b.debet, false);
    const k = senDariIsian(b.kredit, false);
    if ("error" in d) return { ok: false, error: `Debet pos ${b.posKode}: ${d.error}` };
    if ("error" in k) return { ok: false, error: `Kredit pos ${b.posKode}: ${k.error}` };
    if (b.posKode.trim() === "" && d.sen === 0 && k.sen === 0) continue; // baris kosong formulir
    baris.push({ posKode: b.posKode.trim(), debetSen: d.sen, kreditSen: k.sen });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.unit_ids', $1, true)", [String(unit.unit_id)]);
    const hasil = periksaMemorial({ tanggal: input.tanggal, alasan: input.alasan, bukti: input.bukti, baris }, await daftarPosDiTransaksi(client, unit.unit_id));
    if (!hasil.ok) {
      await batal(client);
      return { ok: false, error: hasil.error };
    }
    if (await bulanBeku(client, unit.unit_id, input.tanggal)) {
      await batal(client);
      return { ok: false, error: `Bulan ${input.tanggal.slice(0, 7)} sudah ditutup dengan buku besar — memorial koreksinya bertanggal di bulan terbuka.` };
    }
    const id = await sisipMemorial(client, unit.unit_id, {
      tanggal: input.tanggal,
      keterangan: keteranganMemorial(input.alasan, input.bukti),
      status: hasil.status,
      baris: hasil.baris,
      pengusul: scope.userId,
    });
    await auditKeuangan(client, scope, "buku_besar.memorial_usul", `${unit.code}/${id}`, {
      tanggal: input.tanggal,
      alasan: input.alasan.trim(),
      bukti: input.bukti.trim(),
      baris: hasil.baris,
      totalSen: hasil.totalSen,
      status: hasil.status,
      sebabMenunggu: hasil.sebabMenunggu,
    });
    await client.query("COMMIT");
    halamanBukuBesar(unit.code);
    const saran = hasil.status === "aktif" && hasil.baris.some((b) => POS_DIBACA_PEMBENTUKAN.includes(b.posKode)) ? SARAN_BENTUK_ULANG : "";
    return {
      ok: true,
      pesan:
        hasil.status === "menunggu"
          ? `Memorial tersimpan dan menunggu persetujuan Direksi (${hasil.sebabMenunggu}). Belum masuk laporan.`
          : `Memorial terposting.${saran}`,
    };
  } catch (e) {
    await batal(client);
    return { ok: false, error: pesanGalat(e, "Gagal menyimpan memorial.") };
  } finally {
    client.release();
  }
}

interface MemorialTerkunci {
  status: string;
  diusulkanOleh: number | null;
  tanggal: string;
  sumberTabel: string | null;
  keterangan: string;
  baris: BarisJurnal[];
}

async function kunciMemorial(c: PoolClient, unitId: number, id: string): Promise<MemorialTerkunci | null> {
  const r = await c.query<{ status: string; diusulkanOleh: number | null; tanggal: string; sumberTabel: string | null; keterangan: string }>(
    `SELECT status, diusulkan_oleh_user_id AS "diusulkanOleh", to_char(tanggal_buku, 'YYYY-MM-DD') AS tanggal,
            sumber_tabel AS "sumberTabel", keterangan
       FROM app.jurnal WHERE id = $1::uuid AND unit_id = $2 AND jenis = 'memorial' FOR UPDATE`,
    [id, unitId],
  );
  const j = r.rows[0];
  if (!j) return null;
  const b = await c.query<{ posKode: string; debetSen: string; kreditSen: string }>(
    `SELECT pos_kode AS "posKode", debet_sen::text AS "debetSen", kredit_sen::text AS "kreditSen"
       FROM app.jurnal_baris WHERE jurnal_id = $1::uuid AND unit_id = $2 ORDER BY kredit_sen, pos_kode`,
    [id, unitId],
  );
  return { ...j, baris: b.rows.map((x) => ({ posKode: x.posKode, debetSen: Number(x.debetSen), kreditSen: Number(x.kreditSen) })) };
}

/** Direksi/super admin menyetujui memorial yang menunggu — bukan pengusulnya (R8, KD13). */
export async function setujuiMemorial(input: { code: string; id: string }): Promise<BukuBesarResult> {
  const scope = await getDataScope();
  const unit = scope.requireUnit(input.code); // di luar scope → notFound()
  const bolehSetujui = canSetujuiMemorial({ role: scope.role, email: scope.email });
  if (!bolehSetujui) return { ok: false, error: PESAN_TAK_BOLEH_SETUJUI_MEMORIAL };
  if (!UUID_RE.test(input.id)) return { ok: false, error: "Jurnal tak dikenali — muat ulang halaman." };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.unit_ids', $1, true)", [String(unit.unit_id)]);
    const j = await kunciMemorial(client, unit.unit_id, input.id);
    if (!j) {
      await batal(client);
      return { ok: false, error: "Jurnal memorial tidak ditemukan." };
    }
    const salah = periksaPersetujuan(j, { userId: scope.userId, bolehSetujui });
    if (salah !== null) {
      await batal(client);
      return { ok: false, error: salah };
    }
    await client.query(`SELECT pg_advisory_xact_lock_shared(${KUNCI_BULAN_BUKU_BESAR_SQL})`, [unit.unit_id, j.tanggal.slice(0, 7)]);
    // CHECK `jurnal_empat_mata` menegakkan ulang pengusul ≠ penyetuju; trigger beku menolak bulan tertutup.
    await client.query(
      `UPDATE app.jurnal SET status = 'aktif', disetujui_oleh_user_id = $3, disetujui_at = now(), updated_at = now()
        WHERE id = $1::uuid AND unit_id = $2 AND status = 'menunggu'`,
      [input.id, unit.unit_id, scope.userId],
    );
    await auditKeuangan(client, scope, "buku_besar.memorial_setujui", `${unit.code}/${input.id}`, {
      tanggal: j.tanggal,
      pengusul: j.diusulkanOleh,
      baris: j.baris,
    });
    await client.query("COMMIT");
    halamanBukuBesar(unit.code);
    const saran = j.baris.some((b) => POS_DIBACA_PEMBENTUKAN.includes(b.posKode)) ? SARAN_BENTUK_ULANG : "";
    return { ok: true, pesan: `Memorial disetujui dan terposting.${saran}` };
  } catch (e) {
    await batal(client);
    return { ok: false, error: pesanGalat(e, "Gagal menyetujui memorial.") };
  } finally {
    client.release();
  }
}

/**
 * Tolak memorial yang menunggu (Direksi/super admin), atau tarik usulan
 * sendiri (pengusul). Statusnya `batal`; barisnya tetap untuk jejak.
 */
export async function tolakMemorial(input: { code: string; id: string; alasan: string }): Promise<BukuBesarResult> {
  const scope = await getDataScope();
  const unit = scope.requireUnit(input.code); // di luar scope → notFound()
  const bolehSetujui = canSetujuiMemorial({ role: scope.role, email: scope.email });
  const bolehUsul = canUsulkanMemorial({ role: scope.role, email: scope.email });
  if (!bolehSetujui && !bolehUsul) return { ok: false, error: PESAN_TAK_BOLEH_SETUJUI_MEMORIAL };
  if (!UUID_RE.test(input.id)) return { ok: false, error: "Jurnal tak dikenali — muat ulang halaman." };
  if (input.alasan.trim() === "") return { ok: false, error: "Alasan penolakan wajib diisi." };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.unit_ids', $1, true)", [String(unit.unit_id)]);
    const j = await kunciMemorial(client, unit.unit_id, input.id);
    if (!j || j.status !== "menunggu") {
      await batal(client);
      return { ok: false, error: "Memorial ini tidak menunggu persetujuan — muat ulang halaman." };
    }
    const pengusulSendiri = j.diusulkanOleh === scope.userId;
    if (!bolehSetujui && !pengusulSendiri) {
      await batal(client);
      return { ok: false, error: "Hanya Direksi, atau pengusulnya sendiri, yang boleh menolak memorial ini." };
    }
    await client.query(
      `UPDATE app.jurnal SET status = 'batal', updated_at = now() WHERE id = $1::uuid AND unit_id = $2 AND status = 'menunggu'`,
      [input.id, unit.unit_id],
    );
    await auditKeuangan(client, scope, pengusulSendiri ? "buku_besar.memorial_tarik" : "buku_besar.memorial_tolak", `${unit.code}/${input.id}`, {
      alasan: input.alasan.trim(),
      tanggal: j.tanggal,
      baris: j.baris,
    });
    await client.query("COMMIT");
    halamanBukuBesar(unit.code);
    return { ok: true, pesan: pengusulSendiri ? "Usulan memorial ditarik." : "Memorial ditolak." };
  } catch (e) {
    await batal(client);
    return { ok: false, error: pesanGalat(e, "Gagal menolak memorial.") };
  } finally {
    client.release();
  }
}

/**
 * Batalkan memorial yang sudah terposting = PEMBALIKAN (R8): memorial baru
 * dengan sisi tertukar, bertaut ke aslinya (`sumber_tabel = 'jurnal'`). Aturan
 * persetujuannya sama dengan memorial biasa — membalik memorial besar atau
 * yang menyentuh pos kliring juga menunggu Direksi. Jurnal asli tidak diubah.
 */
export async function balikMemorial(input: { code: string; id: string; tanggal: string; alasan: string }): Promise<BukuBesarResult> {
  const scope = await getDataScope();
  const unit = scope.requireUnit(input.code); // di luar scope → notFound()
  if (!canUsulkanMemorial({ role: scope.role, email: scope.email })) return { ok: false, error: PESAN_TAK_BOLEH_MEMORIAL };
  if (!UUID_RE.test(input.id)) return { ok: false, error: "Jurnal tak dikenali — muat ulang halaman." };
  if (input.alasan.trim() === "") return { ok: false, error: "Alasan pembalikan wajib diisi." };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.unit_ids', $1, true)", [String(unit.unit_id)]);
    const j = await kunciMemorial(client, unit.unit_id, input.id);
    if (!j || j.status !== "aktif") {
      await batal(client);
      return { ok: false, error: "Hanya memorial yang sudah terposting yang dibalik — yang menunggu cukup ditolak/ditarik." };
    }
    if (j.sumberTabel === "jurnal") {
      await batal(client);
      return { ok: false, error: "Ini sudah jurnal pembalik — ketik memorial baru bila perlu." };
    }
    const sudah = await client.query<{ ada: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM app.jurnal WHERE unit_id = $1 AND jenis = 'memorial'
                       AND sumber_tabel = 'jurnal' AND sumber_id = $2 AND status <> 'batal') AS ada`,
      [unit.unit_id, input.id],
    );
    if (sudah.rows[0]?.ada) {
      await batal(client);
      return { ok: false, error: "Memorial ini sudah dibalik (atau pembaliknya menunggu persetujuan)." };
    }
    const hasil = periksaMemorial(
      { tanggal: input.tanggal, alasan: `Pembalikan: ${input.alasan}`, bukti: j.keterangan, baris: barisPembalikan(j.baris) },
      await daftarPosDiTransaksi(client, unit.unit_id),
    );
    if (!hasil.ok) {
      await batal(client);
      return { ok: false, error: hasil.error };
    }
    if (await bulanBeku(client, unit.unit_id, input.tanggal)) {
      await batal(client);
      return { ok: false, error: `Bulan ${input.tanggal.slice(0, 7)} sudah ditutup dengan buku besar — pilih tanggal di bulan terbuka.` };
    }
    const baru = await sisipMemorial(client, unit.unit_id, {
      tanggal: input.tanggal,
      keterangan: `Pembalikan memorial ${j.tanggal}: ${input.alasan.trim()}`,
      status: hasil.status,
      baris: hasil.baris,
      pengusul: scope.userId,
      sumber: { tabel: "jurnal", id: input.id },
    });
    await auditKeuangan(client, scope, "buku_besar.memorial_balik", `${unit.code}/${input.id}`, {
      pembalik: baru,
      tanggal: input.tanggal,
      alasan: input.alasan.trim(),
      status: hasil.status,
      baris: hasil.baris,
    });
    await client.query("COMMIT");
    halamanBukuBesar(unit.code);
    return {
      ok: true,
      pesan: hasil.status === "menunggu" ? `Pembalikan menunggu persetujuan Direksi (${hasil.sebabMenunggu}).` : "Memorial dibalik.",
    };
  } catch (e) {
    await batal(client);
    return { ok: false, error: pesanGalat(e, "Gagal membalik memorial.") };
  } finally {
    client.release();
  }
}
