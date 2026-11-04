"use server";

import { bentukJurnalSesudahTulis } from "./buku-besar-tulis";
import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import type { PoolClient } from "pg";
import { jalankanCocokOtomatis } from "./cocok-bank-tulis";
import { pool } from "./db";
import { tentukanHariBuku } from "./hari-buku";
import {
  BATAS_BACA_AI_PER_BULAN,
  bandingkanSaldoAwal,
  bulanSebelum,
  nomorRekeningSama,
  parseRupiahKetik,
  periksaAngkaKontrol,
  periksaBacaan,
  periksaBerkas,
  periksaJangkar,
  pesanPelanggaran,
  periodeAwal,
  type AngkaKontrol,
  type HasilBacaRekeningKoran,
  type HasilCocokSesudahUnggah,
  type HasilUnggah,
  type Jangkar,
  type SebabTolak,
  type SebabTolakAi,
} from "./impor-bank-model";
import { bacaRekeningKoranBca, GalatRekeningKoran, type RekeningKoran } from "./impor-bank-parser";
import { simpanRekeningKoran } from "./impor-bank-tulis";
import { bacaRekeningKoranAi, buatKlien, kenaliMedia } from "./rekening-koran-ai";
import { bulanSah } from "./bulan";
import { teksKeSen } from "./pihak-lawan-model";
import { keSaldoBukuAwal, POLA_NAMA_BCA, SQL_CUT_OVER, SQL_SALDO_BUKU_AWAL, type BarisSaldoBuku } from "./impor-bank-queries";
import {
  pesanTakBolehInput,
  canImporRekeningKoran,
  canTarikRekeningKoran,
} from "./keuangan-wewenang";
import { GalatPdfTeks, teksDariPdf } from "./pdf-teks";
import { getDataScope } from "./scope";
import { bulanTertutupTerkunci } from "./tutup-bulan-queries";
import { auditKeuangan, batal, kodeAlasanKoreksiSah, PESAN_KODE_ALASAN_TAK_DIKENAL } from "./keuangan-tx";
import { PREFIKS_KODE_MAJU } from "./keuangan-kode-maju";
import { UUID_RE } from "./validasi";

/**
 * Server action impor rekening koran (rencana 2026-10-29 U9; R17–R19, R22,
 * R31; KTD6, KTD10, KTD13). Tindakan BERNAMA:
 *
 *   · unggah rekening koran → Keuangan (`canImporRekeningKoran`)
 *   · tarik rekening koran  → HoF (`canTarikRekeningKoran`)
 *
 * ⛔ UNGGAH DIKERASKAN (Implementation Constraints): `requireUnit` + predikat
 * wewenang SEBELUM berkas disentuh; ukuran diperiksa sebelum dibaca; kepala
 * `%PDF`, `execFile` tanpa shell, batas waktu & halaman di `teksDariPdf`;
 * pembaca U8 menolak UTUH bila kaki tak cocok (AE3) — sebelum koneksi DB apa
 * pun dibuka, jadi berkas yang ditolak tak meninggalkan jejak di DB.
 *
 * ⛔ TIDAK PERNAH menulis `cash_ledger` (KTD6). Baris impor disimpan apa
 * adanya; pencocokan (U10) adalah tautan. Baris bertanggal sebelum cut-over
 * rekening disimpan `pra_cutover = true` (R22, AE8) menurut aturan KTD5
 * (`tentukanHariBuku`) — tak pernah dicocokkan, tak pernah dibukukan.
 *
 * ⛔ Idempoten (R19): berkas identik (sha256) untuk (rekening, bulan) yang
 * aktif = no-op "sudah ada"; berkas BERBEDA ditolak sampai HoF menarik yang
 * lama. Partial unique 0051 menjamin yang sama bila dua unggahan berbalapan.
 */

const halaman = (code: string): string => `/keuangan/unit/${code}/impor-bank`;

const tolak = (sebab: SebabTolak, pesan: string): HasilUnggah => ({ status: "ditolak", sebab, pesan });

const PESAN_PERIODE_AKTIF = (periode: string): string =>
  `Rekening koran ${periode} untuk rekening ini sudah diimpor dari berkas yang BERBEDA. ` +
  "Tarik impor lama dulu: bila berkas lama keliru, minta Head of Finance menariknya, lalu unggah ulang berkas ini.";

/** Galat unik Postgres dari partial unique 0051 — dua unggahan berbalapan. */
function tabrakanAktif(e: unknown): boolean {
  const g = e as { code?: string; constraint?: string } | null;
  return g?.code === "23505" && (g.constraint === "rekening_koran_aktif_uq" || g.constraint === "mutasi_bank_aktif_uq");
}

async function cocokSesudahUnggah(
  client: PoolClient,
  m: Parameters<typeof jalankanCocokOtomatis>[1],
): Promise<HasilCocokSesudahUnggah> {
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.unit_ids', $1, true)", [String(m.unitId)]);
    const h = await jalankanCocokOtomatis(client, m);
    if (!h.ok) {
      await batal(client);
      return { status: "gagal", pesan: `Impor tersimpan, tetapi cocok otomatis tidak berjalan: ${h.error}` };
    }
    await bentukJurnalSesudahTulis(client, m.unitId, m.aktor);
    await client.query("COMMIT");
    return { status: "selesai", nOtomatis: h.nOtomatis, nBanyak: h.nBanyak, nTanpa: h.nTanpa };
  } catch (e) {
    await batal(client);
    return {
      status: "gagal",
      pesan:
        "Impor tersimpan, tetapi cocok otomatis gagal — jalankan ulang “Cocokkan otomatis”. " +
        (e instanceof Error ? e.message : ""),
    };
  }
}

// ---------------------------------------------------------------------------
// Unggah (R17, R18, R19, R22)
// ---------------------------------------------------------------------------

export async function unggahRekeningKoran(form: FormData): Promise<HasilUnggah> {
  const scope = await getDataScope();
  const unit = scope.requireUnit(String(form.get("code") ?? "")); // di luar scope → notFound()
  const ctx = { role: scope.role, email: scope.email };
  if (!canImporRekeningKoran(ctx)) {
    return tolak("wewenang", pesanTakBolehInput(ctx));
  }
  const accountId = String(form.get("accountId") ?? "");
  if (!UUID_RE.test(accountId)) return tolak("rekening-salah", "Rekening tak dikenali — muat ulang halaman.");

  // ── Berkas baru disentuh SESUDAH gerbang di atas ──────────────────────────
  const berkas = form.get("berkas");
  if (!(berkas instanceof Blob)) return tolak("berkas", "Pilih berkas e-statement PDF dari BCA.");
  const salahUkuran = periksaBerkas(berkas.size);
  if (salahUkuran !== null) return tolak("berkas", salahUkuran);
  const isi = Buffer.from(await berkas.arrayBuffer());

  let rk: RekeningKoran;
  try {
    rk = bacaRekeningKoranBca(await teksDariPdf(isi));
  } catch (e) {
    if (e instanceof GalatPdfTeks) return tolak("berkas", e.message);
    if (e instanceof GalatRekeningKoran) {
      return e.kode === "kaki-tidak-cocok"
        ? { status: "ditolak-kaki", pesan: e.message, ketidakcocokan: e.ketidakcocokan }
        : tolak("format", e.message);
    }
    throw e;
  }
  const sha256 = createHash("sha256").update(isi).digest("hex");
  const hariPertama = periodeAwal(rk.periode);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.unit_ids', $1, true)", [String(unit.unit_id)]);

    // 1. Rekening: milik unit ini, BANK BCA aktif bernomor, nomornya = kepala (R18).
    const akun = await client.query<{
      id: string;
      nama: string;
      kind: string;
      active: boolean;
      nomorRekening: string | null;
      bca: boolean;
    }>(
      `SELECT id::text AS id, nama, kind::text AS kind, active, nomor_rekening AS "nomorRekening",
              (nama ~* $3) AS bca
         FROM app.cash_account
        WHERE id = $1::uuid AND unit_id = $2
        FOR SHARE`,
      [accountId, unit.unit_id, POLA_NAMA_BCA],
    );
    const a = akun.rows[0];
    const salahRekening =
      !a
        ? "Rekening tak ditemukan di unit ini — pilih rekening BCA milik unit ini."
        : a.kind !== "bank" || !a.bca
          ? `“${a.nama}” bukan rekening BCA — impor tahap ini hanya e-statement BCA; rekening bank lain tetap diketik manual.`
          : !a.active
            ? `Rekening “${a.nama}” sudah ditutup — impor hanya untuk rekening aktif.`
            : a.nomorRekening === null
              ? `Rekening “${a.nama}” belum punya nomor rekening — isi dulu di Kelola akun kas.`
              : !nomorRekeningSama(rk.nomorRekening, a.nomorRekening)
                ? `Rekening salah: berkas ini milik rekening ${rk.nomorRekening}, sedangkan rekening yang dipilih ` +
                  `“${a.nama}” bernomor ${a.nomorRekening}. Pilih baris rekening yang benar, atau periksa berkasnya.`
                : null;
    if (salahRekening !== null) {
      await batal(client);
      return tolak("rekening-salah", salahRekening);
    }

    // 2. Rekening koran AKTIF untuk (rekening, bulan) ini — identik = no-op.
    const ada = await client.query<{ id: string; fileSha256: string; nBaris: number; nPraCutover: number }>(
      `SELECT r.id::text AS id, r.file_sha256 AS "fileSha256",
              (SELECT count(*)::int FROM app.mutasi_bank m
                WHERE m.rekening_koran_id = r.id AND m.unit_id = r.unit_id) AS "nBaris",
              (SELECT count(*)::int FROM app.mutasi_bank m
                WHERE m.rekening_koran_id = r.id AND m.unit_id = r.unit_id AND m.pra_cutover) AS "nPraCutover"
         FROM app.rekening_koran r
        WHERE r.unit_id = $1 AND r.account_id = $2::uuid AND r.periode = $3::date AND r.status = 'aktif'`,
      [unit.unit_id, accountId, hariPertama],
    );
    const lama = ada.rows[0];
    if (lama) {
      await batal(client);
      if (lama.fileSha256 === sha256) {
        return { status: "sudah-ada", rekeningKoranId: lama.id, periode: rk.periode, nBaris: lama.nBaris, nPraCutover: lama.nPraCutover };
      }
      return tolak("periode-aktif", PESAN_PERIODE_AKTIF(rk.periode));
    }

    // 2b. Bulan tertutup ⇒ tolak (keputusan Dion 30 Okt 2026, §10.43). Sama
    // dengan tarik: kunci BERSAMA bulan dulu, baru `tutup_bulan` dibaca, jadi
    // penutup yang berjalan ditunggu dan penutup sesudahnya melihat impor ini.
    // Sesudah cek identik di atas: unggah ulang berkas yang sama tetap no-op.
    if ((await bulanTertutupTerkunci(client, unit.unit_id, [rk.periode])).length > 0) {
      await batal(client);
      return tolak(
        "bulan-tertutup",
        `Bulan ${rk.periode} sudah ditutup — rekening koran bulan tertutup tidak bisa diunggah. ` +
          "Bulan tertutup tidak dibuka kembali; hubungi Head of Finance.",
      );
    }

    // 3. Cut-over rekening (⇒ unit) — satu aturan tanggal buku (KTD5, R22).
    const cut = await client.query<{ unit: string | null; akun: string | null }>(SQL_CUT_OVER, [unit.unit_id, accountId]);
    const cutOver = cut.rows[0]?.akun ?? cut.rows[0]?.unit ?? null;
    const pra = rk.rows.map((r) => tentukanHariBuku({ tanggal: r.tanggal, cutOver, tertutup: [] }).status === "pra-cut-over");

    // 4. Rekening koran + barisnya, satu transaksi (satu salinan SQL: impor-bank-tulis.ts).
    const rekeningKoranId = await simpanRekeningKoran(client, {
      unitId: unit.unit_id,
      accountId,
      hariPertama,
      rk,
      sha256,
      pra,
      userId: scope.userId,
    });

    // 5. R18 — saldo awal vs saldo buku hari sebelum periode (menurut tanggal asal).
    const sb = await client.query<BarisSaldoBuku>(SQL_SALDO_BUKU_AWAL, [unit.unit_id, accountId, hariPertama]);
    const saldoAwal = bandingkanSaldoAwal({
      periode: rk.periode,
      saldoAwalSen: rk.saldoAwalSen,
      buku: keSaldoBukuAwal(sb.rows[0]),
      cutOverUnit: cut.rows[0]?.unit ?? null,
    });
    const nPraCutover = pra.filter(Boolean).length;

    await auditKeuangan(client, scope, "rekening_koran.unggah", `${unit.code}/${rekeningKoranId}`, {
      rekening: accountId,
      nomorRekening: rk.nomorRekening,
      periode: rk.periode,
      sha256,
      nBaris: rk.rows.length,
      nPraCutover,
      cutOver,
      saldoAwal,
    });
    await bentukJurnalSesudahTulis(client, unit.unit_id, { userId: scope.userId, email: scope.email });
    await client.query("COMMIT");
    revalidatePath(halaman(unit.code));
    // U10 — cocok otomatis SESUDAH impor COMMIT, transaksi sendiri: gagalnya
    // dilaporkan, tak membatalkan impor (baris tetap tersimpan & terbuka; aksi
    // `cocokkanOtomatis` bisa dijalankan ulang). Pengunggah sudah lolos
    // `canImporRekeningKoran` = semantik `canCocokkanBank` (Keuangan).
    const cocok = await cocokSesudahUnggah(client, {
      unitId: unit.unit_id,
      unitCode: unit.code,
      rekeningKoranId,
      aktor: { userId: scope.userId, email: scope.email },
    });
    return {
      status: "diterima",
      rekeningKoranId,
      periode: rk.periode,
      nBaris: rk.rows.length,
      nPraCutover,
      nCr: rk.footer.nCr,
      nDb: rk.footer.nDb,
      saldoAwal,
      cocok,
    };
  } catch (e) {
    await batal(client);
    if (tabrakanAktif(e)) return tolak("periode-aktif", PESAN_PERIODE_AKTIF(rk.periode));
    return tolak("galat", `Rekening koran tidak tersimpan — tak ada yang diimpor. ${e instanceof Error ? e.message : ""}`.trim());
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Tarik (R31)
// ---------------------------------------------------------------------------

export interface TarikInput {
  code: string;
  rekeningKoranId: string;
  reasonCode: string;
  catatan: string;
}

/** `nCocok` — hanya pada penolakan "batalkan cocok dulu": jumlah baris yang masih dicocokkan. */
export type TarikResult = { ok: true; pesan: string } | { ok: false; error: string; nCocok?: number };

export async function tarikRekeningKoran(input: TarikInput): Promise<TarikResult> {
  const scope = await getDataScope();
  const unit = scope.requireUnit(input.code);
  if (!canTarikRekeningKoran({ role: scope.role, email: scope.email })) {
    return { ok: false, error: "Hanya Head of Finance yang boleh menarik rekening koran yang sudah diimpor." };
  }
  if (!UUID_RE.test(input.rekeningKoranId)) return { ok: false, error: "Rekening koran tak dikenali — muat ulang halaman." };
  const catatan = input.catatan.trim();
  if (catatan === "") return { ok: false, error: "Catatan wajib diisi — tuliskan kenapa impor ini ditarik." };
  const reasonCode = input.reasonCode.trim();
  if (reasonCode === "" || reasonCode.startsWith(PREFIKS_KODE_MAJU)) {
    return { ok: false, error: "Pilih kode alasan koreksi dari daftar (kode pembukuan maju diisi sistem)." };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.unit_ids', $1, true)", [String(unit.unit_id)]);

    if (!(await kodeAlasanKoreksiSah(client, reasonCode))) {
      await batal(client);
      return { ok: false, error: PESAN_KODE_ALASAN_TAK_DIKENAL };
    }

    const r = await client.query<{ id: string; status: string; periode: string; accountId: string }>(
      `SELECT id::text AS id, status, to_char(periode, 'YYYY-MM') AS periode, account_id::text AS "accountId"
         FROM app.rekening_koran
        WHERE id = $1::uuid AND unit_id = $2
        FOR UPDATE`,
      [input.rekeningKoranId, unit.unit_id],
    );
    const rk = r.rows[0];
    if (!rk) {
      await batal(client);
      return { ok: false, error: "Rekening koran tak ditemukan di unit ini — muat ulang halaman." };
    }
    if (rk.status !== "aktif" && rk.status !== "menunggu") {
      await batal(client);
      return { ok: false, error: `Rekening koran ${rk.periode} sudah ditarik sebelumnya.` };
    }
    // U10 — bacaan bank lain yang MENUNGGU konfirmasi: "Tolak" HoF = tarik
    // dengan kode alasan + catatan yang sama (jejak R31 tidak bercabang).
    const statusLama = rk.status === "menunggu" ? "menunggu" : "aktif";

    // U12 (KTD14) — tolak bila bulan `rk.periode` unit ini sudah ditutup.
    // Kunci BERSAMA bulan itu diambil DULU, baru `tutup_bulan` dibaca: penutup
    // yang sedang berjalan ditunggu sampai COMMIT, dan penutup yang datang
    // sesudahnya menunggu tarikan ini lalu melihat rekening korannya hilang.
    const tertutup = await bulanTertutupTerkunci(client, unit.unit_id, [rk.periode]);
    if (tertutup.length > 0) {
      await batal(client);
      return {
        ok: false,
        error:
          `Bulan ${rk.periode} sudah ditutup — rekening koran bulan tertutup tidak bisa ditarik. ` +
          "Koreksinya dibukukan maju ke bulan terbuka.",
      };
    }
    // U10 — tolak bila ada baris rekening koran ini di kelompok cocok AKTIF:
    // "batalkan cocok dulu" (KTD6, R31). Rekening koran sudah dikunci FOR
    // UPDATE di atas, dan setiap pencocok mengunci induknya FOR NO KEY UPDATE —
    // tak ada kelompok baru yang bisa lahir di antara periksa ini dan UPDATE.
    const cocok = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n
         FROM app.cocok_bank_baris b
         JOIN app.mutasi_bank m ON m.id = b.mutasi_bank_id AND m.unit_id = b.unit_id
        WHERE m.rekening_koran_id = $1::uuid AND m.unit_id = $2 AND b.aktif`,
      [rk.id, unit.unit_id],
    );
    const nCocok = cocok.rows[0]?.n ?? 0;
    if (nCocok > 0) {
      await batal(client);
      return {
        ok: false,
        nCocok,
        error:
          `${nCocok} baris rekening koran ${rk.periode} sudah dicocokkan — batalkan cocok dulu ` +
          "(tindakan Head of Finance), baru tarik impornya.",
      };
    }

    // Status → 'ditarik'; `mutasi_bank.rk_status` ikut lewat FK ON UPDATE
    // CASCADE (0051) — baris bank tak pernah disunting aplikasi.
    const u = await client.query(
      `UPDATE app.rekening_koran
          SET status = 'ditarik', ditarik_at = now(), ditarik_by_user_id = $3,
              ditarik_alasan = $4, ditarik_alasan_applies_to = 'adjustment', ditarik_catatan = $5
        WHERE id = $1::uuid AND unit_id = $2 AND status = '${statusLama}'`,
      [rk.id, unit.unit_id, scope.userId, reasonCode, catatan],
    );
    if (u.rowCount !== 1) {
      await batal(client);
      return { ok: false, error: "Rekening koran berubah bersamaan — muat ulang halaman." };
    }

    await auditKeuangan(client, scope, "rekening_koran.tarik", `${unit.code}/${rk.id}`, {
      rekening: rk.accountId,
      periode: rk.periode,
      reasonCode,
      catatan,
      ...(statusLama === "menunggu" ? { menunggu: true } : {}),
    });
    await bentukJurnalSesudahTulis(client, unit.unit_id, { userId: scope.userId, email: scope.email });
    await client.query("COMMIT");
    revalidatePath(halaman(unit.code));
    return {
      ok: true,
      pesan:
        statusLama === "menunggu"
          ? `Bacaan rekening koran ${rk.periode} ditolak. Staf Keuangan boleh membaca ulang atau mengetik barisnya manual.`
          : `Rekening koran ${rk.periode} ditarik. Berkas pengganti kini boleh diunggah.`,
    };
  } catch (e) {
    await batal(client);
    return { ok: false, error: e instanceof Error ? e.message : "Gagal menarik rekening koran." };
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Rekening koran bank lain — pembaca AI & input manual (rencana 2026-11-02
// U10; R29, R30, AE8, KTD9)
// ---------------------------------------------------------------------------
//
// ⛔ AI hanya membaca. Bacaan (atau baris ketikan manual) lewat gerbang PASTI
// `periksaBacaan`: empat angka kontrol ketikan staf, saldo berjalan per baris,
// urutan tanggal, saldo awal = saldo akhir rekening koran terkonfirmasi bulan
// lalu (atau saldo buku bank untuk jangkar pertama). Satu pelanggaran =
// ROLLBACK, tidak ada baris tersimpan (AE8). Yang lolos disimpan berstatus
// `menunggu` — tak ikut pencocokan (`rkStatus !== 'aktif'`) sampai HoF
// mengonfirmasi (`canTarikRekeningKoran`). Rekening BCA TIDAK lewat jalur ini.
//
// ⛔ Batas 10 bacaan AI per rekening per bulan kalender WIB, yang ditolak ikut
// dihitung: percobaan dicatat di `audit_log` ("rekening_koran.baca_ai") dan
// di-COMMIT SEBELUM API dipanggil, di bawah kunci advisory per rekening.

const AKSI_BACA_AI = "rekening_koran.baca_ai";

const tolakAi = (sebab: SebabTolakAi, pesan: string, sisaPercobaan: number | null = null): HasilBacaRekeningKoran => ({
  status: "ditolak",
  sebab,
  pesan,
  // Input manual ditawarkan bila bacaannya yang gagal, bukan bila pengguna/rekening yang salah.
  inputManual: !["wewenang", "rekening-salah", "periode-aktif", "bulan-tertutup"].includes(sebab),
  sisaPercobaan,
});

type AkunBankLain = { id: string; nama: string; kind: string; active: boolean; nomorRekening: string | null; bca: boolean };

/** Rekening milik unit, BANK aktif, BUKAN BCA (BCA tetap parser e-statement, R29). `null` = sah. */
async function periksaRekeningBankLain(
  client: PoolClient,
  unitId: number,
  accountId: string,
): Promise<{ salah: string; akun?: undefined } | { salah: null; akun: AkunBankLain }> {
  const r = await client.query<AkunBankLain>(
    `SELECT id::text AS id, nama, kind::text AS kind, active, nomor_rekening AS "nomorRekening",
            (nama ~* $3) AS bca
       FROM app.cash_account
      WHERE id = $1::uuid AND unit_id = $2
      FOR SHARE`,
    [accountId, unitId, POLA_NAMA_BCA],
  );
  const a = r.rows[0];
  if (!a) return { salah: "Rekening tak ditemukan di unit ini — pilih rekening bank milik unit ini." };
  if (a.kind !== "bank") return { salah: `“${a.nama}” bukan rekening bank.` };
  if (a.bca) return { salah: `“${a.nama}” rekening BCA — unggah e-statement PDF-nya di matriks BCA, bukan lewat pembaca AI.` };
  if (!a.active) return { salah: `Rekening “${a.nama}” sudah ditutup — rekening koran hanya untuk rekening aktif.` };
  return { salah: null, akun: a };
}

const PESAN_SUDAH_ADA = (periode: string): string =>
  `Rekening koran ${periode} untuk rekening ini sudah tersimpan (terkonfirmasi atau menunggu konfirmasi HoF). ` +
  "Bila keliru, minta Head of Finance menolak/menariknya dulu.";

/** Rekening koran AKTIF atau MENUNGGU untuk (rekening, bulan) — paling banyak satu (0051/0057). */
async function adaRekeningKoran(client: PoolClient, unitId: number, accountId: string, hariPertama: string): Promise<boolean> {
  const r = await client.query<{ id: string }>(
    `SELECT id::text AS id FROM app.rekening_koran
      WHERE unit_id = $1 AND account_id = $2::uuid AND periode = $3::date AND status IN ('aktif', 'menunggu')`,
    [unitId, accountId, hariPertama],
  );
  return r.rows.length > 0;
}

/** Jangkar saldo awal (R30) untuk `saldoAwalSen` — dibaca di dalam transaksi pemanggil. */
async function bacaJangkar(client: PoolClient, unitId: number, accountId: string, periode: string, saldoAwalSen: number): Promise<Jangkar> {
  const hariPertama = periodeAwal(periode);
  const lalu = await client.query<{ periode: string; saldoAkhir: string }>(
    `SELECT to_char(periode, 'YYYY-MM') AS periode, saldo_akhir::text AS "saldoAkhir"
       FROM app.rekening_koran
      WHERE unit_id = $1 AND account_id = $2::uuid AND status = 'aktif' AND periode < $3::date
      ORDER BY periode DESC
      LIMIT 1`,
    [unitId, accountId, hariPertama],
  );
  const r = lalu.rows[0];
  const bulanLalu = bulanSebelum(periode);
  if (r) {
    return r.periode === bulanLalu
      ? { jenis: "rekening-koran-lalu", periode: r.periode, saldoAkhirSen: teksKeSen(r.saldoAkhir) }
      : { jenis: "bulan-lalu-belum", periodeLalu: bulanLalu };
  }
  // Jangkar pertama: saldo buku bank pada awal periode (R18, sama dengan BCA).
  const cut = await client.query<{ unit: string | null; akun: string | null }>(SQL_CUT_OVER, [unitId, accountId]);
  const sb = await client.query<BarisSaldoBuku>(SQL_SALDO_BUKU_AWAL, [unitId, accountId, hariPertama]);
  return {
    jenis: "buku-bank",
    perbandingan: bandingkanSaldoAwal({ periode, saldoAwalSen, buku: keSaldoBukuAwal(sb.rows[0]), cutOverUnit: cut.rows[0]?.unit ?? null }),
  };
}

/** Empat angka kontrol dari teks ketikan; `string` = pesan penolakan. */
function uraiKontrol(t: { saldoAwal: string; totalDebet: string; totalKredit: string; saldoAkhir: string }): AngkaKontrol | string {
  const saldoAwalSen = parseRupiahKetik(t.saldoAwal);
  const totalDebetSen = parseRupiahKetik(t.totalDebet);
  const totalKreditSen = parseRupiahKetik(t.totalKredit);
  const saldoAkhirSen = parseRupiahKetik(t.saldoAkhir);
  if (saldoAwalSen === null || totalDebetSen === null || totalKreditSen === null || saldoAkhirSen === null) {
    return "Isi keempat angka kontrol dari cetakan rekening koran (contoh: 12.500.000,00).";
  }
  const k = { saldoAwalSen, totalDebetSen, totalKreditSen, saldoAkhirSen };
  return periksaAngkaKontrol(k) ?? k;
}

/**
 * Simpan bacaan yang LOLOS gerbang, berstatus `menunggu`. Gerbang dijalankan
 * DI DALAM transaksi (jangkar dibaca bersama kunci bulan), dan pelanggaran =
 * ROLLBACK sebelum INSERT apa pun.
 */
async function simpanBacaan(m: {
  scope: Awaited<ReturnType<typeof getDataScope>>;
  unit: { unit_id: Parameters<typeof simpanRekeningKoran>[1]["unitId"]; code: string };
  accountId: string;
  periode: string;
  rk: RekeningKoran;
  kontrol: AngkaKontrol;
  sumber: "ai" | "manual";
  sha256: string;
  sisaPercobaan: number | null;
  /** Nomor rekening yang dibaca dari kepala (AI), bila ada. */
  nomorTerbaca?: string | null;
}): Promise<HasilBacaRekeningKoran> {
  const { scope, unit } = m;
  const hariPertama = periodeAwal(m.periode);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.unit_ids', $1, true)", [String(unit.unit_id)]);

    const rek = await periksaRekeningBankLain(client, unit.unit_id, m.accountId);
    if (rek.salah !== null) {
      await batal(client);
      return tolakAi("rekening-salah", rek.salah, m.sisaPercobaan);
    }
    // R18 untuk bank lain: nomor di kepala (bila terbaca DAN rekening bernomor) harus sama.
    if (m.nomorTerbaca && rek.akun.nomorRekening !== null && !nomorRekeningSama(m.nomorTerbaca, rek.akun.nomorRekening)) {
      await batal(client);
      return tolakAi(
        "rekening-salah",
        `Rekening salah: rekening koran ini milik rekening ${m.nomorTerbaca}, sedangkan “${rek.akun.nama}” bernomor ` +
          `${rek.akun.nomorRekening}. Tidak ada yang disimpan.`,
        m.sisaPercobaan,
      );
    }
    if (await adaRekeningKoran(client, unit.unit_id, m.accountId, hariPertama)) {
      await batal(client);
      return tolakAi("periode-aktif", PESAN_SUDAH_ADA(m.periode), m.sisaPercobaan);
    }
    if ((await bulanTertutupTerkunci(client, unit.unit_id, [m.periode])).length > 0) {
      await batal(client);
      return tolakAi("bulan-tertutup", `Bulan ${m.periode} sudah ditutup — rekening koran bulan tertutup tidak bisa disimpan.`, m.sisaPercobaan);
    }

    // R30 — gerbang pasti. Pelanggaran ⇒ ROLLBACK, tak ada INSERT (AE8).
    const jangkar = await bacaJangkar(client, unit.unit_id, m.accountId, m.periode, m.rk.saldoAwalSen);
    const g = periksaBacaan({ rk: m.rk, kontrol: m.kontrol, periode: m.periode, jangkar });
    if (!g.ok) {
      await batal(client);
      return { status: "ditolak-gerbang", pesan: g.pesan, pelanggaran: g.pelanggaran, sisaPercobaan: m.sisaPercobaan };
    }

    const cut = await client.query<{ unit: string | null; akun: string | null }>(SQL_CUT_OVER, [unit.unit_id, m.accountId]);
    const cutOver = cut.rows[0]?.akun ?? cut.rows[0]?.unit ?? null;
    const pra = g.rk.rows.map((r) => tentukanHariBuku({ tanggal: r.tanggal, cutOver, tertutup: [] }).status === "pra-cut-over");
    const rekeningKoranId = await simpanRekeningKoran(client, {
      unitId: unit.unit_id,
      accountId: m.accountId,
      hariPertama,
      rk: g.rk,
      sha256: m.sha256,
      pra,
      userId: scope.userId,
      asal: { sumber: m.sumber, status: "menunggu" },
    });
    // Audit TANPA isi baris (KTD9): hitungan, total, sha256 saja.
    await auditKeuangan(client, scope, m.sumber === "ai" ? "rekening_koran.unggah_ai" : "rekening_koran.input_manual", `${unit.code}/${rekeningKoranId}`, {
      rekening: m.accountId,
      periode: m.periode,
      sha256: m.sha256,
      nBaris: g.rk.rows.length,
      nCr: g.rk.footer.nCr,
      nDb: g.rk.footer.nDb,
      jangkar: jangkar.jenis,
    });
    await client.query("COMMIT");
    revalidatePath(halaman(unit.code));
    return { status: "menunggu-konfirmasi", rekeningKoranId, periode: m.periode, nBaris: g.rk.rows.length, sisaPercobaan: m.sisaPercobaan };
  } catch (e) {
    await batal(client);
    if (tabrakanAktif(e)) return tolakAi("periode-aktif", PESAN_SUDAH_ADA(m.periode), m.sisaPercobaan);
    return tolakAi("galat", `Rekening koran tidak tersimpan — tak ada yang disimpan. ${e instanceof Error ? e.message : ""}`.trim(), m.sisaPercobaan);
  } finally {
    client.release();
  }
}

/**
 * Baca rekening koran bank lain (PDF atau foto JPEG/PNG) dengan pembaca AI.
 * Form: `code`, `accountId`, `periode` (YYYY-MM), `saldoAwal`, `totalDebet`,
 * `totalKredit`, `saldoAkhir` (ketikan), `berkas`.
 */
export async function bacaRekeningKoranAiAksi(form: FormData): Promise<HasilBacaRekeningKoran> {
  const scope = await getDataScope();
  const unit = scope.requireUnit(String(form.get("code") ?? ""));
  const ctx = { role: scope.role, email: scope.email };
  if (!canImporRekeningKoran(ctx)) return tolakAi("wewenang", pesanTakBolehInput(ctx));
  const accountId = String(form.get("accountId") ?? "");
  if (!UUID_RE.test(accountId)) return tolakAi("rekening-salah", "Rekening tak dikenali — muat ulang halaman.");
  const periode = String(form.get("periode") ?? "");
  if (!bulanSah(periode)) return tolakAi("kontrol", "Pilih bulan rekening koran.");
  const kontrol = uraiKontrol({
    saldoAwal: String(form.get("saldoAwal") ?? ""),
    totalDebet: String(form.get("totalDebet") ?? ""),
    totalKredit: String(form.get("totalKredit") ?? ""),
    saldoAkhir: String(form.get("saldoAkhir") ?? ""),
  });
  if (typeof kontrol === "string") return tolakAi("kontrol", kontrol);

  // KTD9 — tanpa kunci: menolak SEBELUM berkas dibaca & percobaan dihitung.
  const klien = buatKlien();
  if (klien === null) {
    return tolakAi("tanpa-kunci", "Pembaca AI belum aktif di lingkungan ini (kunci layanan belum dipasang). Ketik baris rekening koran secara manual.");
  }

  // ── Berkas baru disentuh SESUDAH gerbang di atas ──────────────────────────
  const berkas = form.get("berkas");
  if (!(berkas instanceof Blob)) return tolakAi("berkas", "Pilih PDF atau foto rekening koran.");
  const salahUkuran = periksaBerkas(berkas.size, "ai");
  if (salahUkuran !== null) return tolakAi("berkas", salahUkuran);
  const isi = Buffer.from(await berkas.arrayBuffer());
  const media = kenaliMedia(isi);
  if (media === null) return tolakAi("berkas", "Berkas harus PDF, JPEG, atau PNG.");
  const sha256 = createHash("sha256").update(isi).digest("hex");

  // 1. Percobaan: periksa & catat di transaksi sendiri, COMMIT sebelum API dipanggil.
  let sisaPercobaan: number;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.unit_ids', $1, true)", [String(unit.unit_id)]);
    const rek = await periksaRekeningBankLain(client, unit.unit_id, accountId);
    if (rek.salah !== null) {
      await batal(client);
      return tolakAi("rekening-salah", rek.salah);
    }
    if (await adaRekeningKoran(client, unit.unit_id, accountId, periodeAwal(periode))) {
      await batal(client);
      return tolakAi("periode-aktif", PESAN_SUDAH_ADA(periode));
    }
    // Dua bacaan bersamaan untuk rekening yang sama berurutan di sini.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`${AKSI_BACA_AI}:${accountId}`]);
    const n = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n
         FROM app.audit_log
        WHERE action = $1 AND target = $2
          AND created_at >= (date_trunc('month', now() AT TIME ZONE 'Asia/Jakarta') AT TIME ZONE 'Asia/Jakarta')`,
      [AKSI_BACA_AI, `${unit.code}/${accountId}`],
    );
    const sudah = n.rows[0]?.n ?? 0;
    if (sudah >= BATAS_BACA_AI_PER_BULAN) {
      await batal(client);
      return tolakAi(
        "batas-percobaan",
        `Batas ${BATAS_BACA_AI_PER_BULAN} kali baca AI per rekening per bulan sudah tercapai untuk rekening ini. Ketik baris rekening koran secara manual.`,
        0,
      );
    }
    await auditKeuangan(client, scope, AKSI_BACA_AI, `${unit.code}/${accountId}`, { periode, sha256, media, ke: sudah + 1 });
    await client.query("COMMIT");
    sisaPercobaan = BATAS_BACA_AI_PER_BULAN - sudah - 1;
  } catch (e) {
    await batal(client);
    return tolakAi("galat", `Percobaan baca tidak tercatat — tak ada yang dibaca. ${e instanceof Error ? e.message : ""}`.trim());
  } finally {
    client.release();
  }

  // 2. Baca — tanpa koneksi DB terbuka selama menunggu layanan AI.
  const baca = await bacaRekeningKoranAi(klien, { isi, media, periode });
  if (!baca.ok) return tolakAi(baca.sebab, baca.pesan, sisaPercobaan);

  return simpanBacaan({
    scope,
    unit,
    accountId,
    periode,
    kontrol,
    sha256,
    sisaPercobaan,
    rk: baca.rk,
    nomorTerbaca: baca.nomorRekening,
    sumber: "ai",
  });
}

export interface BarisManualInput {
  /** `YYYY-MM-DD`. */
  tanggal: string;
  keterangan: string;
  arah: "debet" | "kredit";
  /** Ketikan, mis. "1.250.000,00". */
  nominal: string;
  /** Saldo berjalan tercetak (ketikan) — kosong bila tidak dicetak. */
  saldo: string;
}

export interface InputManual {
  code: string;
  accountId: string;
  periode: string;
  kontrol: { saldoAwal: string; totalDebet: string; totalKredit: string; saldoAkhir: string };
  baris: BarisManualInput[];
}

const MAKS_BARIS_MANUAL = 2_000;

/**
 * Input manual baris rekening koran bank lain (R30) — jalur bila pembaca AI
 * menolak, tak terbaca, atau tak tersedia. Pemeriksaan yang SAMA
 * (`periksaBacaan`), status yang sama (`menunggu` konfirmasi HoF). Saldo awal
 * bacaan = saldo awal angka kontrol (diketik sekali); jangkar tetap diperiksa.
 */
export async function simpanMutasiManual(input: InputManual): Promise<HasilBacaRekeningKoran> {
  const scope = await getDataScope();
  const unit = scope.requireUnit(input.code);
  const ctx = { role: scope.role, email: scope.email };
  if (!canImporRekeningKoran(ctx)) return tolakAi("wewenang", pesanTakBolehInput(ctx));
  if (!UUID_RE.test(input.accountId)) return tolakAi("rekening-salah", "Rekening tak dikenali — muat ulang halaman.");
  if (!bulanSah(input.periode)) return tolakAi("kontrol", "Pilih bulan rekening koran.");
  const kontrol = uraiKontrol(input.kontrol);
  if (typeof kontrol === "string") return tolakAi("kontrol", kontrol);
  if (!Array.isArray(input.baris) || input.baris.length > MAKS_BARIS_MANUAL) {
    return tolakAi("kontrol", `Baris rekening koran harus berupa daftar, paling banyak ${MAKS_BARIS_MANUAL} baris.`);
  }

  const perTanggal = new Map<string, number>();
  const rows: RekeningKoran["rows"] = [];
  for (const [i, b] of input.baris.entries()) {
    const nominal = parseRupiahKetik(String(b?.nominal ?? ""));
    const saldoTeks = String(b?.saldo ?? "").trim();
    const saldo = saldoTeks === "" ? null : parseRupiahKetik(saldoTeks);
    const tanggal = String(b?.tanggal ?? "");
    const keterangan = String(b?.keterangan ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal) || nominal === null || nominal <= 0 || (saldoTeks !== "" && saldo === null)) {
      return tolakAi("kontrol", `Baris ${i + 1}: isi tanggal, nominal positif, dan saldo (boleh kosong) dengan benar.`);
    }
    if (b.arah !== "debet" && b.arah !== "kredit") return tolakAi("kontrol", `Baris ${i + 1}: pilih debet atau kredit.`);
    if (keterangan === "") return tolakAi("kontrol", `Baris ${i + 1}: keterangan wajib diisi seperti tercetak.`);
    const urutan = (perTanggal.get(tanggal) ?? 0) + 1;
    perTanggal.set(tanggal, urutan);
    rows.push({ tanggal, urutan, keterangan, amountSen: b.arah === "debet" ? -nominal : nominal, saldoSen: saldo, so: null, dokRef: null });
  }
  const rk: RekeningKoran = {
    nomorRekening: "",
    periode: input.periode,
    saldoAwalSen: kontrol.saldoAwalSen,
    rows,
    // Diganti angka kontrol oleh gerbang.
    footer: { mutasiCrSen: 0, nCr: 0, mutasiDbSen: 0, nDb: 0, saldoAkhirSen: 0 },
  };
  // Tak ada berkas: sha256 atas isi kanonik (kolom file_sha256 wajib, 0051).
  const sha256 = createHash("sha256")
    .update(JSON.stringify({ akun: input.accountId, periode: input.periode, kontrol, rows }))
    .digest("hex");
  return simpanBacaan({ scope, unit, accountId: input.accountId, periode: input.periode, rk, kontrol, sumber: "manual", sha256, sisaPercobaan: null });
}

export type KonfirmasiResult = { ok: true; pesan: string; cocok: HasilCocokSesudahUnggah } | { ok: false; error: string };

/**
 * Konfirmasi HoF atas bacaan yang menunggu (R30) → status `aktif`; baris ikut
 * lewat FK ON UPDATE CASCADE (0051), lalu ikut pencocokan: cocok otomatis
 * dijalankan SESUDAH COMMIT, transaksi sendiri (pola unggah BCA). Jangkar saldo
 * awal diperiksa ULANG — rekening koran bulan lalu bisa ditarik/diganti sejak
 * bacaan ini disimpan.
 */
export async function konfirmasiRekeningKoran(input: { code: string; rekeningKoranId: string }): Promise<KonfirmasiResult> {
  const scope = await getDataScope();
  const unit = scope.requireUnit(input.code);
  if (!canTarikRekeningKoran({ role: scope.role, email: scope.email })) {
    return { ok: false, error: "Hanya Head of Finance yang boleh mengonfirmasi bacaan rekening koran." };
  }
  if (!UUID_RE.test(input.rekeningKoranId)) return { ok: false, error: "Rekening koran tak dikenali — muat ulang halaman." };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.unit_ids', $1, true)", [String(unit.unit_id)]);
    const r = await client.query<{ id: string; status: string; periode: string; accountId: string; saldoAwal: string }>(
      `SELECT id::text AS id, status, to_char(periode, 'YYYY-MM') AS periode, account_id::text AS "accountId",
              saldo_awal::text AS "saldoAwal"
         FROM app.rekening_koran
        WHERE id = $1::uuid AND unit_id = $2
        FOR UPDATE`,
      [input.rekeningKoranId, unit.unit_id],
    );
    const rk = r.rows[0];
    if (!rk) {
      await batal(client);
      return { ok: false, error: "Rekening koran tak ditemukan di unit ini — muat ulang halaman." };
    }
    if (rk.status !== "menunggu") {
      await batal(client);
      return { ok: false, error: `Rekening koran ${rk.periode} tidak sedang menunggu konfirmasi.` };
    }
    if ((await bulanTertutupTerkunci(client, unit.unit_id, [rk.periode])).length > 0) {
      await batal(client);
      return { ok: false, error: `Bulan ${rk.periode} sudah ditutup — bacaan ini tidak bisa dikonfirmasi lagi.` };
    }
    const saldoAwalSen = teksKeSen(rk.saldoAwal);
    const jangkar = await bacaJangkar(client, unit.unit_id, rk.accountId, rk.periode, saldoAwalSen);
    const putus = periksaJangkar(saldoAwalSen, jangkar);
    if (putus !== null) {
      await batal(client);
      return { ok: false, error: `${pesanPelanggaran([putus]).replace("Bacaan ditolak — tidak ada baris yang disimpan. ", "")} Tolak bacaan ini.` };
    }
    const u = await client.query(
      `UPDATE app.rekening_koran
          SET status = 'aktif', dikonfirmasi_at = now(), dikonfirmasi_by_user_id = $3
        WHERE id = $1::uuid AND unit_id = $2 AND status = 'menunggu'`,
      [rk.id, unit.unit_id, scope.userId],
    );
    if (u.rowCount !== 1) {
      await batal(client);
      return { ok: false, error: "Rekening koran berubah bersamaan — muat ulang halaman." };
    }
    await auditKeuangan(client, scope, "rekening_koran.konfirmasi", `${unit.code}/${rk.id}`, {
      rekening: rk.accountId,
      periode: rk.periode,
      jangkar: jangkar.jenis,
    });
    await client.query("COMMIT");
    revalidatePath(halaman(unit.code));
    // HoF boleh memicu cocok otomatis di sini: ini kelanjutan impor, bukan
    // pencocokan pilihan sendiri — sama dengan cocok sesudah unggah BCA.
    const cocok = await cocokSesudahUnggah(client, {
      unitId: unit.unit_id,
      unitCode: unit.code,
      rekeningKoranId: rk.id,
      aktor: { userId: scope.userId, email: scope.email },
    });
    return { ok: true, pesan: `Rekening koran ${rk.periode} dikonfirmasi — barisnya kini ikut pencocokan.`, cocok };
  } catch (e) {
    await batal(client);
    if (tabrakanAktif(e)) return { ok: false, error: "Rekening koran aktif lain untuk bulan ini sudah ada — muat ulang halaman." };
    return { ok: false, error: e instanceof Error ? e.message : "Gagal mengonfirmasi rekening koran." };
  } finally {
    client.release();
  }
}
