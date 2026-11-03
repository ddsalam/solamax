import type { PoolClient } from "pg";
import { auditKeuangan, type Aktor } from "./keuangan-tx";
/** Nama lama, dipakai `scripts/uji-ulang-rekening-koran.ts`. */
export { auditKeuangan as audit, type Aktor } from "./keuangan-tx";
import { senKeTeks } from "./antar-unit-model";
import {
  KATEGORI_PINDAH_BUKU,
  KATEGORI_SETORAN,
  KATEGORI_SETORAN_KE_BANK,
  usulkanSemua,
  type KandidatSetoran,
  type MutasiCocok,
  type UsulanCocok,
} from "./cocok-bank-model";
import { bacaKasId, bacaKonteksCocok, bacaMutasiRekeningKoran } from "./cocok-bank-queries";
import { hariBukuTerkunci } from "./hari-buku-queries";
import { KODE_MAJU_IMPOR } from "./keuangan-kode-maju";
import type { ScopedUnitId } from "./scope";

/**
 * Inti TULIS kelompok cocok (rencana 2026-10-29 U10; KTD6, KTD7) — dipanggil
 * DI DALAM transaksi pemanggil, sesudah `set_config('app.unit_ids', …, true)`.
 * Tanpa gerbang wewenang: gerbangnya milik `cocok-bank-actions.ts` /
 * `impor-bank-actions.ts` dan dijalankan SEBELUM BEGIN.
 *
 * ⚠️ Sengaja BUKAN berkas "use server" (pola `antar-unit-tulis.ts`): setiap
 * ekspor berkas seperti itu menjadi endpoint peramban — termasuk fungsi tanpa
 * gerbang di bawah.
 *
 * ⛔ KTD6: mencocokkan tak menulis `cash_ledger` — hanya `cocok_bank`,
 * `cocok_bank_baris`, dan `audit_log`. SATU pengecualian bernama:
 * {@link tulisPasanganJemputan} (K6 U7, R31, KTD8) melahirkan pasangan
 * Setoran ke Bank untuk jemputan yang setorannya ada di Kas Besar, dengan
 * `lahir_dari_cocok_id` — pembatalan kelompok (HoF) me-void/membalik keduanya.
 */

/**
 * Kepala kelompok saja — dipakai klasifikasi (U11), yang harus punya id
 * kelompok SEBELUM menulis baris kas lahirannya (`lahir_dari_cocok_id` FK ke
 * kelompok, 0052), lalu menambahkan anggotanya lewat {@link tambahAnggota}.
 */
export async function buatKelompok(
  c: PoolClient,
  m: { unitId: ScopedUnitId; cara: "otomatis" | "manual"; aktor: Aktor },
): Promise<string> {
  const g = await c.query<{ id: string }>(
    `INSERT INTO app.cocok_bank (unit_id, cara, dibuat_by_user_id)
     VALUES ($1, $2, $3)
     RETURNING id::text AS id`,
    [m.unitId, m.cara, m.aktor.userId],
  );
  const id = g.rows[0]?.id;
  if (!id) throw new Error("Kelompok cocok tidak tersimpan.");
  return id;
}

/**
 * Anggota ke kelompok AKTIF (FK cermin 0052 menolak kelompok yang sudah
 * dibatalkan; partial unique menolak anggota yang sudah di kelompok aktif lain).
 */
export async function tambahAnggota(
  c: PoolClient,
  m: { unitId: ScopedUnitId; cocokId: string; mutasiIds: readonly string[]; kasIds: readonly string[] },
): Promise<void> {
  if (m.mutasiIds.length + m.kasIds.length === 0) return;
  await c.query(
    `INSERT INTO app.cocok_bank_baris (unit_id, cocok_id, mutasi_bank_id, cash_ledger_id)
     SELECT $1, $2::uuid, t.mutasi, t.kas
       FROM unnest($3::uuid[], $4::uuid[]) AS t(mutasi, kas)`,
    [
      m.unitId,
      m.cocokId,
      [...m.mutasiIds, ...m.kasIds.map(() => null)],
      [...m.mutasiIds.map(() => null), ...m.kasIds],
    ],
  );
}

/** Satu kelompok + anggotanya. Partial unique 0052 menolak anggota yang sudah di kelompok aktif. */
export async function tulisKelompok(
  c: PoolClient,
  m: { unitId: ScopedUnitId; cara: "otomatis" | "manual"; aktor: Aktor; mutasiIds: readonly string[]; kasIds: readonly string[] },
): Promise<string> {
  const id = await buatKelompok(c, m);
  await tambahAnggota(c, { unitId: m.unitId, cocokId: id, mutasiIds: m.mutasiIds, kasIds: m.kasIds });
  return id;
}

// ---------------------------------------------------------------------------
// K6 U7 — pasangan Setoran ke Bank dari jemputan (R31, AE1, KTD8)
// ---------------------------------------------------------------------------

const INSERT_KAKI_SETORAN = `INSERT INTO app.cash_ledger
         (unit_id, account_id, business_date, keterangan, jenis,
          category_side, category_label, amount, created_by_user_id,
          tanggal_asal, alasan_maju, alasan_maju_applies_to, lahir_dari_cocok_id)
       VALUES ($1,$2::uuid,$3::date,$4,$5::app.cash_mutation_jenis,
               $6::app.cash_mutation_side,$7,$8::numeric,$9,
               $10::date,$11,$12,$13::uuid)
       RETURNING id::text AS id`;

export type HasilPasangan = { ok: true; cocokId: string } | { ok: false; error: string };

/**
 * Setorkan satu kandidat (satu setoran / setoran satu tanggal) dari Kas Besar
 * ke rekening jemputan — satu transaksi milik pemanggil:
 *
 *   1. Setoran dikunci `FOR UPDATE` lalu diperiksa ULANG: masih aktif, belum
 *      disetor (tak di kelompok aktif), bukan lahiran, di Kas Besar, Σ = kredit.
 *      Yang berubah ⇒ ditolak, tak ada yang ditulis.
 *   2. Hari buku dari TANGGAL BANK lewat `hariBukuTerkunci` untuk KEDUA akun;
 *      hari tertutup ⇒ maju dengan `tanggal_asal` + `ADJ-FWD-IMPORT` (R28).
 *      Kedua kaki di hari buku yang sama ⇒ tak ada dana dalam perjalanan.
 *   3. Kepala kelompok, lalu dua kaki lahiran (`lahir_dari_cocok_id`): bank
 *      "Pindah Buku" +nominal (pola kaki pencairan EDC), Kas Besar "Setoran ke
 *      Bank" −nominal.
 *   4. Anggota: baris bank + kaki bank (rekening bank Σ 0) + kaki Kas Besar +
 *      setoran yang disetor (Kas Besar Σ 0). Keanggotaan setoran itulah tanda
 *      "sudah disetor": kandidat berikutnya melewatinya, dan
 *      `batalkanKasSetoran` (K6 U5) menolak membatalkannya selama kelompok aktif.
 */
export async function tulisPasanganJemputan(
  c: PoolClient,
  m: {
    unitId: ScopedUnitId;
    unitCode: string;
    cara: "otomatis" | "manual";
    aktor: Aktor;
    mutasi: Pick<MutasiCocok, "id" | "accountId" | "tanggalBank" | "amountSen">;
    akunKasBesar: string;
    kandidat: KandidatSetoran;
  },
): Promise<HasilPasangan> {
  const ids = [...m.kandidat.kasIds].sort();
  const setoran = ids.length === 0 ? [] : await bacaKasId(c, m.unitId, ids, true);
  const utuh =
    setoran.length === ids.length &&
    setoran.every(
      (k) =>
        !k.void &&
        !k.saldoAwal &&
        !k.dicocokkan &&
        k.lahirDariCocokId === null &&
        k.accountId === m.akunKasBesar &&
        k.categoryLabel === KATEGORI_SETORAN,
    ) &&
    setoran.reduce((t, k) => t + k.amountSen, 0) === m.mutasi.amountSen;
  if (!utuh) return { ok: false, error: "Setoran yang diusulkan sudah berubah (disetor, dibatalkan, atau nominalnya lain) — muat ulang halaman." };

  const hariBank = await hariBukuTerkunci(c, m.unitId, m.mutasi.tanggalBank, { accountId: m.mutasi.accountId });
  const hariKas = await hariBukuTerkunci(c, m.unitId, m.mutasi.tanggalBank, { accountId: m.akunKasBesar });
  if (hariBank.status === "pra-cut-over" || hariKas.status === "pra-cut-over") {
    return { ok: false, error: `Tanggal bank ${m.mutasi.tanggalBank} mendahului saldo pembuka — tidak dibukukan (R22).` };
  }
  if (hariBank.hariBuku !== hariKas.hariBuku) {
    return { ok: false, error: "Hari buku rekening bank dan Kas Besar berbeda — cocokkan manual." };
  }
  const maju = hariBank.perluKodeAlasan;

  const cocokId = await buatKelompok(c, { unitId: m.unitId, cara: m.cara, aktor: m.aktor });
  const kaki = async (akun: string, sisi: "debet" | "kredit", kategori: string, sen: number, ket: string): Promise<string> => {
    const r = await c.query<{ id: string }>(INSERT_KAKI_SETORAN, [
      m.unitId,
      akun,
      hariBank.hariBuku,
      ket,
      sisi,
      sisi,
      kategori,
      senKeTeks(sen),
      m.aktor.userId,
      maju ? m.mutasi.tanggalBank : null,
      maju ? KODE_MAJU_IMPOR : null,
      maju ? "adjustment" : null,
      cocokId,
    ]);
    const id = r.rows[0]?.id;
    if (!id) throw new Error("Kaki Setoran ke Bank tidak tersimpan.");
    return id;
  };
  const kakiBank = await kaki(
    m.mutasi.accountId,
    "debet",
    KATEGORI_PINDAH_BUKU,
    m.mutasi.amountSen,
    `Setoran jemputan dari Kas Besar (setoran ${m.kandidat.tanggal})`,
  );
  const kakiKas = await kaki(
    m.akunKasBesar,
    "kredit",
    KATEGORI_SETORAN_KE_BANK,
    -m.mutasi.amountSen,
    `Setoran ke Bank — jemputan ${m.mutasi.tanggalBank}`,
  );
  await tambahAnggota(c, { unitId: m.unitId, cocokId, mutasiIds: [m.mutasi.id], kasIds: [kakiBank, kakiKas, ...ids] });
  await auditKeuangan(c, m.aktor, m.cara === "otomatis" ? "cocok_bank.otomatis" : "cocok_bank.manual", `${m.unitCode}/${cocokId}`, {
    mutasi: [m.mutasi.id],
    kas: [kakiBank, kakiKas, ...ids],
    aturan: "setoran-jemputan-pasangan",
    setoran: ids,
    kasLahir: [kakiBank, kakiKas],
    maju,
  });
  return { ok: true, cocokId };
}

export type HasilOtomatis =
  | {
      ok: true;
      /** Kelompok yang ditulis (cocok tunggal). */
      nOtomatis: number;
      /** Baris yang menunggu pilihan manusia (banyak kandidat / tanpa kandidat / cacat). */
      nBanyak: number;
      nTanpa: number;
      usulan: UsulanCocok[];
    }
  | { ok: false; error: string };

/**
 * "Cocokkan otomatis" satu rekening koran: usulan dihitung atas potret buku
 * SESUDAH rekening koran dikunci, lalu hanya cocok TUNGGAL yang ditulis
 * (KTD7) — ditambah pasangan Setoran ke Bank untuk jemputan berkandidat setoran
 * tunggal (K6 U7, {@link tulisPasanganJemputan}). Rekening koran dikunci `FOR NO KEY UPDATE` — dua pencocok pada
 * rekening koran yang sama berurutan, dan `tarikRekeningKoran` (FOR UPDATE)
 * menunggu. Baris kas yang akan ditautkan dikunci `FOR UPDATE` lalu diperiksa
 * ULANG (non-void, belum di kelompok aktif): yang berubah sejak dibaca
 * dilewati, bukan ditebak.
 *
 * ⚠️ `mutasi_bank` tak bisa dikunci baris: `dashboard_app` sengaja tanpa UPDATE
 * di sana (0051), dan `FOR UPDATE/SHARE` menuntut hak itu. Penguncinya adalah
 * rekening koran induknya + partial unique 0052.
 */
export async function jalankanCocokOtomatis(
  c: PoolClient,
  m: { unitId: ScopedUnitId; unitCode: string; rekeningKoranId: string; aktor: Aktor },
): Promise<HasilOtomatis> {
  const rk = await c.query<{ status: string }>(
    `SELECT status FROM app.rekening_koran
      WHERE id = $1::uuid AND unit_id = $2
      FOR NO KEY UPDATE`,
    [m.rekeningKoranId, m.unitId],
  );
  const st = rk.rows[0]?.status;
  if (st === undefined) return { ok: false, error: "Rekening koran tak ditemukan di unit ini — muat ulang halaman." };
  if (st !== "aktif") return { ok: false, error: "Rekening koran ini sudah ditarik — tak ada yang dicocokkan." };

  const mutasi = await bacaMutasiRekeningKoran(c, m.unitId, m.rekeningKoranId);
  const ktx = await bacaKonteksCocok(c, m.unitId, mutasi);
  const usulan = usulkanSemua(mutasi, ktx);
  const tunggal = usulan.filter((u) => u.jenis === "tunggal");

  // Kunci & periksa ulang baris kas yang akan ditautkan.
  const kasIds = [...new Set(tunggal.map((u) => u.kandidat[0]!.cashLedgerId))].sort();
  const terkunci = kasIds.length === 0 ? [] : await bacaKasId(c, m.unitId, kasIds, true);
  const masihBebas = new Set(terkunci.filter((k) => !k.void && !k.dicocokkan && k.lahirDariCocokId === null).map((k) => k.id));

  let nOtomatis = 0;
  for (const u of tunggal) {
    const kas = u.kandidat[0]!;
    if (!masihBebas.has(kas.cashLedgerId)) continue;
    const id = await tulisKelompok(c, { unitId: m.unitId, cara: "otomatis", aktor: m.aktor, mutasiIds: [u.mutasiId], kasIds: [kas.cashLedgerId] });
    await auditKeuangan(c, m.aktor, "cocok_bank.otomatis", `${m.unitCode}/${id}`, {
      rekeningKoran: m.rekeningKoranId,
      mutasi: [u.mutasiId],
      kas: [kas.cashLedgerId],
      aturan: kas.aturan,
    });
    nOtomatis += 1;
  }

  // K6 U7 — jemputan tanpa kaki bank, tepat satu kandidat setoran Kas Besar,
  // baris parser BCA ⇒ pasangan Setoran ke Bank + kelompok. Yang berubah sejak
  // dibaca dilewati (tetap terbuka), bukan ditebak.
  const disetor = new Set<string>();
  for (const u of usulan) {
    if (!u.setoran?.otomatis || !ktx.akunKasBesar) continue;
    const mu = mutasi.find((x) => x.id === u.mutasiId);
    if (!mu) continue;
    const p = await tulisPasanganJemputan(c, {
      unitId: m.unitId,
      unitCode: m.unitCode,
      cara: "otomatis",
      aktor: m.aktor,
      mutasi: mu,
      akunKasBesar: ktx.akunKasBesar,
      kandidat: u.setoran.kandidat[0]!,
    });
    if (!p.ok) continue;
    disetor.add(u.mutasiId);
    nOtomatis += 1;
  }

  const terbuka = usulan.filter(
    (u) => u.tanda !== "pra-cutover" && u.tanda !== "sudah-dicocokkan" && u.tanda !== "ditarik" && !disetor.has(u.mutasiId),
  );
  return {
    ok: true,
    nOtomatis,
    nBanyak: terbuka.filter((u) => u.jenis === "banyak").length,
    nTanpa: terbuka.filter((u) => u.jenis === "tanpa").length,
    usulan,
  };
}
