"use server";

import { revalidatePath } from "next/cache";
import { pool, qScoped } from "./db";
import { senKeTeks } from "./antar-unit-model";
import { periksaKelompokManual } from "./cocok-bank-model";
import { bacaKasId, bacaMutasiId, SQL_PENEBUSAN_COCOK } from "./cocok-bank-queries";
import { jalankanCocokOtomatis, tulisKelompok } from "./cocok-bank-tulis";
import { hariBukuTerkunci } from "./hari-buku-queries";
import { tulisBalikPasangan } from "./antar-unit-tulis";
import {
  pesanTakBolehInput,
  canBatalkanCocokBank,
  canCocokkanBank,
} from "./keuangan-wewenang";
import { normalisasiSo } from "./penebusan-model";
import { teksKeSen } from "./pihak-lawan-model";
import { getDataScope, type ScopedUnit } from "./scope";
import { bulanTertutupTerkunci } from "./tutup-bulan-queries";
import { auditKeuangan, batal, kodeAlasanKoreksiSah, PESAN_KODE_ALASAN_TAK_DIKENAL } from "./keuangan-tx";
import { KODE_MAJU_REVERSAL as KODE_PEMBALIK, PREFIKS_KODE_MAJU } from "./keuangan-kode-maju";
import { UUID_RE } from "./validasi";

/**
 * Server action kelompok cocok (rencana 2026-10-29 U10; R19, R20, R31; KTD6,
 * KTD7). Tindakan BERNAMA:
 *
 *   · cocokkan otomatis → Keuangan (`canCocokkanBank`) — juga dijalankan
 *     sendiri sesudah unggah rekening koran yang berhasil (`unggahRekeningKoran`)
 *   · cocokkan manual   → Keuangan (`canCocokkanBank`), kelompok N:M Σ = 0
 *   · batalkan cocok    → HoF (`canBatalkanCocokBank`, R31)
 *
 * Pola `tarikRekeningKoran` / `batalkanPenebusan`: gerbang (`requireUnit` +
 * predikat) & validasi masukan SEBELUM `pool.connect()`; satu transaksi;
 * `set_config` transaction-local; tanpa DELETE.
 *
 * ⛔ KTD6 — mencocokkan TIDAK menulis `cash_ledger`. Satu-satunya jalur di sini
 * yang menulis buku adalah PEMBATALAN atas kelompok yang MELAHIRKAN baris kas
 * (klasifikasi U11, `lahir_dari_cocok_id`): hari terbuka ⇒ void; hari tertutup
 * ⇒ pembalik maju (`ADJ-FWD-REVERSAL`, Key Decision "Koreksi dibukukan maju").
 */

const halaman = (code: string): string => `/keuangan/unit/${code}/impor-bank`;

/** Galat unik Postgres dari partial unique 0052 — anggota sudah di kelompok aktif lain. */
function tabrakanAnggota(e: unknown): boolean {
  const g = e as { code?: string; constraint?: string } | null;
  return g?.code === "23505" && (g.constraint === "cocok_bank_baris_mutasi_aktif_uq" || g.constraint === "cocok_bank_baris_kas_aktif_uq");
}

// ---------------------------------------------------------------------------
// Cocokkan otomatis (R20)
// ---------------------------------------------------------------------------

export type CocokOtomatisResult =
  | { ok: true; pesan: string; nOtomatis: number; nBanyak: number; nTanpa: number }
  | { ok: false; error: string };

export async function cocokkanOtomatis(input: { code: string; rekeningKoranId: string }): Promise<CocokOtomatisResult> {
  const scope = await getDataScope();
  const unit = scope.requireUnit(input.code);
  const ctx = { role: scope.role, email: scope.email };
  if (!canCocokkanBank(ctx)) return { ok: false, error: pesanTakBolehInput(ctx) };
  if (!UUID_RE.test(input.rekeningKoranId)) return { ok: false, error: "Rekening koran tak dikenali — muat ulang halaman." };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.unit_ids', $1, true)", [String(unit.unit_id)]);
    const h = await jalankanCocokOtomatis(client, {
      unitId: unit.unit_id,
      unitCode: unit.code,
      rekeningKoranId: input.rekeningKoranId,
      aktor: { userId: scope.userId, email: scope.email },
    });
    if (!h.ok) {
      await batal(client);
      return h;
    }
    await client.query("COMMIT");
    revalidatePath(halaman(unit.code));
    return {
      ok: true,
      nOtomatis: h.nOtomatis,
      nBanyak: h.nBanyak,
      nTanpa: h.nTanpa,
      pesan: `${h.nOtomatis} baris dicocokkan otomatis; ${h.nBanyak + h.nTanpa} baris menunggu dipilih atau diklasifikasi.`,
    };
  } catch (e) {
    await batal(client);
    if (tabrakanAnggota(e)) return { ok: false, error: "Ada baris yang baru saja dicocokkan bersamaan — jalankan ulang." };
    return { ok: false, error: e instanceof Error ? e.message : "Gagal mencocokkan otomatis." };
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Cocokkan manual — kelompok N:M pilihan Keuangan (KTD6)
// ---------------------------------------------------------------------------

export interface CocokManualInput {
  code: string;
  mutasiIds: string[];
  kasIds: string[];
}

export type CocokManualResult = { ok: true; pesan: string; cocokId: string } | { ok: false; error: string };

export async function cocokkanManual(input: CocokManualInput): Promise<CocokManualResult> {
  const scope = await getDataScope();
  const unit = scope.requireUnit(input.code);
  const ctx = { role: scope.role, email: scope.email };
  if (!canCocokkanBank(ctx)) return { ok: false, error: pesanTakBolehInput(ctx) };
  const mutasiIds = input.mutasiIds ?? [];
  const kasIds = input.kasIds ?? [];
  if (mutasiIds.length === 0) return { ok: false, error: "Pilih minimal satu baris rekening koran." };
  if (![...mutasiIds, ...kasIds].every((x) => UUID_RE.test(x))) return { ok: false, error: "Ada baris yang tak dikenali — muat ulang halaman." };
  if (new Set(mutasiIds).size !== mutasiIds.length || new Set(kasIds).size !== kasIds.length) {
    return { ok: false, error: "Ada baris yang dipilih dua kali — muat ulang halaman." };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.unit_ids', $1, true)", [String(unit.unit_id)]);

    // 1. Rekening koran induk dikunci (urut id) — tarik & pencocok lain menunggu.
    const awal = await bacaMutasiId(client, unit.unit_id, mutasiIds);
    if (awal.length !== mutasiIds.length) {
      await batal(client);
      return { ok: false, error: "Ada baris rekening koran yang tak ditemukan di unit ini — muat ulang halaman." };
    }
    const rkIds = [...new Set(awal.map((m) => m.rekeningKoranId))].sort();
    await client.query(
      `SELECT id FROM app.rekening_koran
        WHERE unit_id = $1 AND id = ANY($2::uuid[])
        ORDER BY id
        FOR NO KEY UPDATE`,
      [unit.unit_id, rkIds],
    );
    // 2. Dibaca ULANG sesudah kunci; baris kas dikunci FOR UPDATE.
    const mutasi = await bacaMutasiId(client, unit.unit_id, mutasiIds);
    const kas = kasIds.length === 0 ? [] : await bacaKasId(client, unit.unit_id, [...kasIds].sort(), true);
    if (kas.length !== kasIds.length) {
      await batal(client);
      return { ok: false, error: "Ada baris buku yang tak ditemukan di unit ini — muat ulang halaman." };
    }
    const sos = [...new Set(mutasi.flatMap((m) => (m.so === null ? [] : [normalisasiSo(m.so)])))];
    const penebusan = (
      await client.query<{ id: string; noSo: string; cashLedgerId: string }>(SQL_PENEBUSAN_COCOK, [unit.unit_id, sos, kasIds])
    ).rows;

    const v = periksaKelompokManual(
      { mutasi, kas },
      {
        penebusan,
        kasDicocokkan: new Set(kas.filter((k) => k.dicocokkan).map((k) => k.id)),
        mutasiDicocokkan: new Set(mutasi.filter((m) => m.dicocokkan).map((m) => m.id)),
      },
    );
    if (!v.ok) {
      await batal(client);
      return { ok: false, error: v.error };
    }

    const aktor = { userId: scope.userId, email: scope.email };
    const id = await tulisKelompok(client, { unitId: unit.unit_id, cara: "manual", aktor, mutasiIds, kasIds });
    await auditKeuangan(client, aktor, "cocok_bank.manual", `${unit.code}/${id}`, {
      mutasi: mutasiIds,
      kas: kasIds,
      total: senKeTeks(v.totalSen),
    });
    await client.query("COMMIT");
    revalidatePath(halaman(unit.code));
    return { ok: true, cocokId: id, pesan: `${mutasiIds.length} baris bank dicocokkan dengan ${kasIds.length} baris buku.` };
  } catch (e) {
    await batal(client);
    if (tabrakanAnggota(e)) return { ok: false, error: "Ada baris yang baru saja dicocokkan bersamaan — muat ulang halaman." };
    return { ok: false, error: e instanceof Error ? e.message : "Gagal mencocokkan." };
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Batalkan cocok (R31) — HoF
// ---------------------------------------------------------------------------

export interface BatalCocokInput {
  code: string;
  cocokId: string;
  reasonCode: string;
  catatan: string;
}

export type BatalCocokResult = { ok: true; pesan: string } | { ok: false; error: string };

type KasLahir = {
  id: string;
  accountId: string;
  businessDate: string;
  amount: string;
  keterangan: string;
  categorySide: "debet" | "kredit" | null;
  categoryLabel: string | null;
  pihakLawanId: string | null;
  pasanganUuid: string | null;
  sisiLawanAda: boolean;
  /** 0053 — beban pintu Finance AKTIF yang lahir bersama baris kas ini. */
  bebanId: string | null;
};

export async function batalkanCocok(input: BatalCocokInput): Promise<BatalCocokResult> {
  const scope = await getDataScope();
  const unit = scope.requireUnit(input.code);
  if (!canBatalkanCocokBank({ role: scope.role, email: scope.email })) {
    return { ok: false, error: "Hanya Head of Finance yang boleh membatalkan pencocokan rekening koran." };
  }
  if (!UUID_RE.test(input.cocokId)) return { ok: false, error: "Kelompok cocok tak dikenali — muat ulang halaman." };
  const catatan = input.catatan.trim();
  if (catatan === "") return { ok: false, error: "Catatan wajib diisi — tuliskan kenapa pencocokan ini dibatalkan." };
  const reasonCode = input.reasonCode.trim();
  if (reasonCode === "" || reasonCode.startsWith(PREFIKS_KODE_MAJU)) {
    return { ok: false, error: "Pilih kode alasan koreksi dari daftar (kode pembukuan maju diisi sistem)." };
  }

  // ⛔ Gerbang dua unit (Implementation Constraints): kelompok yang MELAHIRKAN
  //    kaki pasangan antar unit (klasifikasi U11) hanya dibatalkan lewat jalur
  //    balik pasangan — KEDUA kaki, kedua unit lolos `requireUnit` SEBELUM BEGIN.
  //    Unit lawan dibaca dulu dari kaki unit ini; dibaca ULANG & dikunci di dalam
  //    transaksi (`rencanaBalik` menuntut kedua kaki tepat di dua unit itu).
  const lawanRows = await qScoped<{ lawanUnitId: number | null }>(
    unit.unit_id,
    `SELECT DISTINCT p.lawan_unit_id AS "lawanUnitId"
       FROM app.cash_ledger l
       JOIN app.pihak_lawan p ON p.id = l.pihak_lawan_id AND p.unit_id = l.unit_id
      WHERE l.unit_id = $1 AND l.lahir_dari_cocok_id = $2::uuid AND NOT l.void AND l.pasangan_uuid IS NOT NULL`,
    [unit.unit_id, input.cocokId],
  );
  let lawan: ScopedUnit | null = null;
  if (lawanRows.length > 0) {
    const kode = lawanRows.length === 1 ? scope.units.find((x) => x.unit_id === lawanRows[0]!.lawanUnitId)?.code ?? null : null;
    if (kode === null) {
      return {
        ok: false,
        error:
          "Kelompok ini melahirkan kaki pinjaman antar unit, dan membatalkannya menulis buku KEDUA unit — akun ini " +
          "tidak memegang unit lawannya. Ditolak utuh, tak ada yang dibatalkan.",
      };
    }
    lawan = scope.requireUnit(kode);
  }
  const unitIds = lawan === null ? String(unit.unit_id) : `${unit.unit_id},${lawan.unit_id}`;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.unit_ids', $1, true)", [unitIds]);

    if (!(await kodeAlasanKoreksiSah(client, reasonCode))) {
      await batal(client);
      return { ok: false, error: PESAN_KODE_ALASAN_TAK_DIKENAL };
    }

    const g = await client.query<{ id: string; aktif: boolean; cara: string }>(
      `SELECT id::text AS id, aktif, cara FROM app.cocok_bank
        WHERE id = $1::uuid AND unit_id = $2
        FOR UPDATE`,
      [input.cocokId, unit.unit_id],
    );
    const grup = g.rows[0];
    if (!grup) {
      await batal(client);
      return { ok: false, error: "Kelompok cocok tak ditemukan di unit ini — muat ulang halaman." };
    }
    if (!grup.aktif) {
      await batal(client);
      return { ok: false, error: "Pencocokan ini sudah dibatalkan sebelumnya." };
    }

    const anggota = await client.query<{ mutasiId: string | null; kasId: string | null; tanggalBank: string | null }>(
      `SELECT b.mutasi_bank_id::text AS "mutasiId", b.cash_ledger_id::text AS "kasId",
              to_char(m.tanggal_bank, 'YYYY-MM-DD') AS "tanggalBank"
         FROM app.cocok_bank_baris b
         LEFT JOIN app.mutasi_bank m ON m.id = b.mutasi_bank_id AND m.unit_id = b.unit_id
        WHERE b.cocok_id = $1::uuid AND b.unit_id = $2`,
      [grup.id, unit.unit_id],
    );
    const bulanBank = [...new Set(anggota.rows.flatMap((a) => (a.tanggalBank ? [a.tanggalBank.slice(0, 7)] : [])))];

    // U12 (KTD14) — tolak bila salah satu `bulanBank` unit ini sudah ditutup:
    // "baris impor bertanggal bank di bulan yang sudah ditutup ⇒ ditolak".
    // Kunci BERSAMA tiap bulan DULU, baru `tutup_bulan` dibaca (lihat
    // `bulanTertutupTerkunci`): membatalkan cocok membuka kembali baris impor,
    // dan itu syarat yang sudah dinilai lolos oleh penutup bulan.
    const tertutup = await bulanTertutupTerkunci(client, unit.unit_id, bulanBank);
    if (tertutup.length > 0) {
      await batal(client);
      return {
        ok: false,
        error:
          `Bulan ${tertutup.join(", ")} sudah ditutup — pencocokan baris rekening koran bulan tertutup tidak bisa ` +
          "dibatalkan. Tak ada yang dibatalkan.",
      };
    }

    // Baris kas yang DILAHIRKAN kelompok ini (klasifikasi U11) — dikunci.
    const lahir = (
      await client.query<KasLahir>(
        `SELECT l.id::text AS id, l.account_id::text AS "accountId",
                to_char(l.business_date, 'YYYY-MM-DD') AS "businessDate", l.amount::text AS amount,
                l.keterangan, l.category_side::text AS "categorySide", l.category_label AS "categoryLabel",
                l.pihak_lawan_id::text AS "pihakLawanId", l.pasangan_uuid::text AS "pasanganUuid",
                (l.category_label IS NULL OR EXISTS (
                   SELECT 1 FROM app.cash_mutation_category k
                    WHERE k.label = l.category_label
                      AND k.side::text = CASE WHEN l.amount < 0 THEN 'debet' ELSE 'kredit' END
                )) AS "sisiLawanAda",
                (SELECT e.id::text FROM app.manual_entry e
                  WHERE e.cash_ledger_id = l.id AND e.unit_id = l.unit_id AND NOT e.void) AS "bebanId"
           FROM app.cash_ledger l
          WHERE l.unit_id = $1 AND l.lahir_dari_cocok_id = $2::uuid AND NOT l.void
          ORDER BY l.id
          FOR UPDATE OF l`,
        [unit.unit_id, grup.id],
      )
    ).rows;

    // ⛔ Kaki antar unit lahiran ⇒ jalur balik pasangan (KEDUA kaki), tak pernah
    //    void sepihak. Unit lawan sudah lolos gerbang sebelum BEGIN; yang tak
    //    cocok dengan pembacaan awal ditolak utuh.
    //    Kaki antar unit yang hanya DIcocokkan (tidak dilahirkan) boleh dibatalkan
    //    di sini: pembatalan itu hanya melepas tautan, tak menulis buku unit mana pun.
    const pasangan = [...new Set(lahir.flatMap((k) => (k.pasanganUuid === null ? [] : [k.pasanganUuid])))];
    if (pasangan.length > 0 && lawan === null) {
      await batal(client);
      return {
        ok: false,
        error: "Kelompok ini baru saja berubah (kaki antar unit) — muat ulang halaman. Tak ada yang dibatalkan.",
      };
    }

    // Rencana per baris lahiran (non-pasangan), SEBELUM apa pun ditulis: hari
    // buku terbuka ⇒ void (+ void beban tertautnya); tertutup ⇒ pembalik maju.
    // Dua bentuk yang TIDAK punya pembalik sah ditolak utuh:
    //   · kategori satu sisi (mis. "Transfer Pembayaran Piutang Pelanggan",
    //     "Biaya Operasional") — 0029 tak punya kategori sisi lawannya, dan
    //     pembalik tanpa kategori (jenis adjustment) tak berbaris arus kas (KTD12);
    //   · beban pintu Finance di hari tertutup — `manual_entry` hari tertutup
    //     immutable (0026) dan nominalnya wajib positif (0042): tak ada beban
    //     pembalik, jadi membalik kasnya saja akan memisahkan kas dari laba.
    const rencana: { k: KasLahir; hariBuku: string; buka: boolean }[] = [];
    for (const k of lahir) {
      if (k.pasanganUuid !== null) continue;
      const h = await hariBukuTerkunci(client, unit.unit_id, k.businessDate, { accountId: k.accountId });
      if (h.status === "pra-cut-over") {
        await batal(client);
        return { ok: false, error: `Baris buku ${k.businessDate} mendahului saldo pembuka (${h.cutOver}) — pembatalan ditolak utuh.` };
      }
      const buka = h.hariBuku === k.businessDate;
      if (!buka && !k.sisiLawanAda) {
        await batal(client);
        return {
          ok: false,
          error:
            `Hari buku ${k.businessDate} sudah ditutup dan kategori “${k.categoryLabel}” tak punya sisi lawan untuk baris ` +
            `pembalik — pencocokan ini tidak bisa dibatalkan. Koreksinya dicatat sebagai mutasi baru yang bertaut. Tak ada yang dibatalkan.`,
        };
      }
      if (!buka && k.bebanId !== null) {
        await batal(client);
        return {
          ok: false,
          error:
            `Hari buku ${k.businessDate} sudah ditutup dan bebannya sudah masuk laba hari itu — membalik kasnya saja akan ` +
            `memisahkan kas dari laba. Koreksinya lewat Adjust/Reverse (§2.3). Tak ada yang dibatalkan.`,
        };
      }
      rencana.push({ k, hariBuku: h.hariBuku, buka });
    }

    // Kelompok → nonaktif; anggota ikut lewat FK ON UPDATE CASCADE (0052).
    const u = await client.query(
      `UPDATE app.cocok_bank
          SET aktif = false, dibatalkan_at = now(), dibatalkan_by_user_id = $3,
              dibatalkan_alasan = $4, dibatalkan_alasan_applies_to = 'adjustment', dibatalkan_catatan = $5
        WHERE id = $1::uuid AND unit_id = $2 AND aktif`,
      [grup.id, unit.unit_id, scope.userId, reasonCode, catatan],
    );
    if (u.rowCount !== 1) {
      await batal(client);
      return { ok: false, error: "Kelompok cocok berubah bersamaan — muat ulang halaman." };
    }

    // Kaki antar unit lahiran: balik pasangan (kedua unit, void/pembalik per kaki).
    const kaki: { id: string; tindakan: "void" | "pembalik"; hariBuku: string; unit?: string }[] = [];
    for (const pu of pasangan) {
      const b = await tulisBalikPasangan(client, {
        unit: { unitId: unit.unit_id, code: unit.code, name: unit.name },
        lawan: { unitId: lawan!.unit_id, code: lawan!.code, name: lawan!.name },
        pasanganUuid: pu,
        reasonCode,
        catatan,
        aktor: { userId: scope.userId, email: scope.email },
      });
      if (!b.ok) {
        await batal(client);
        return { ok: false, error: b.error };
      }
      kaki.push(...b.kaki);
    }

    // Baris kas lahiran lain: hari buku terbuka ⇒ void (+ beban); tertutup ⇒ pembalik maju.
    const bebanDibatalkan: string[] = [];
    for (const { k, hariBuku, buka } of rencana) {
      if (buka) {
        await client.query(
          `UPDATE app.cash_ledger
              SET void = true, voided_by_user_id = $1, voided_at = now()
            WHERE id = $2::uuid AND unit_id = $3 AND NOT void`,
          [scope.userId, k.id, unit.unit_id],
        );
        if (k.bebanId !== null) {
          await client.query(
            `UPDATE app.manual_entry
                SET void = true, voided_by_user_id = $1, voided_at = now(), updated_at = now()
              WHERE id = $2::uuid AND unit_id = $3 AND NOT void`,
            [scope.userId, k.bebanId, unit.unit_id],
          );
          bebanDibatalkan.push(k.bebanId);
        }
        kaki.push({ id: k.id, tindakan: "void", hariBuku: k.businessDate });
        continue;
      }
      const sen = teksKeSen(k.amount);
      const jenis = sen < 0 ? "debet" : "kredit";
      const ins = await client.query<{ id: string }>(
        `INSERT INTO app.cash_ledger
           (unit_id, account_id, business_date, keterangan, jenis,
            category_side, category_label, amount, created_by_user_id, pihak_lawan_id,
            tanggal_asal, alasan_maju, alasan_maju_applies_to, lahir_dari_cocok_id)
         VALUES ($1,$2::uuid,$3::date,$4,$5::app.cash_mutation_jenis,
                 $6::app.cash_mutation_side,$7,$8::numeric,$9,$10::uuid,
                 $11::date,$12,'adjustment',$13::uuid)
         RETURNING id::text AS id`,
        [
          unit.unit_id,
          k.accountId,
          hariBuku,
          `Pembalik — ${k.keterangan}`,
          jenis,
          k.categoryLabel === null ? null : jenis,
          k.categoryLabel,
          senKeTeks(-sen),
          scope.userId,
          k.pihakLawanId,
          k.businessDate,
          KODE_PEMBALIK,
          // Pembalik ikut ditandai lahir dari kelompok (yang kini nonaktif):
          // pasangan asli+pembalik tak pernah lagi jadi kandidat cocok.
          grup.id,
        ],
      );
      kaki.push({ id: ins.rows[0]?.id ?? "?", tindakan: "pembalik", hariBuku });
    }

    await auditKeuangan(client, { userId: scope.userId, email: scope.email }, "cocok_bank.batal", `${unit.code}/${grup.id}`, {
      cara: grup.cara,
      reasonCode,
      catatan,
      mutasi: anggota.rows.flatMap((a) => (a.mutasiId ? [a.mutasiId] : [])),
      kas: anggota.rows.flatMap((a) => (a.kasId ? [a.kasId] : [])),
      kasLahir: kaki,
      pasangan,
      bebanDibatalkan,
    });
    await client.query("COMMIT");
    revalidatePath(halaman(unit.code));
    if (lawan !== null) revalidatePath(`/keuangan/unit/${lawan.code}/pihak-lawan`);
    const maju = kaki.filter((k) => k.tindakan === "pembalik").length;
    return {
      ok: true,
      pesan:
        `Pencocokan dibatalkan; baris rekening koran kembali terbuka.` +
        (kaki.length === 0 ? "" : ` ${kaki.length - maju} baris buku di-void, ${maju} dibalik maju ke hari terbuka.`),
    };
  } catch (e) {
    await batal(client);
    return { ok: false, error: e instanceof Error ? e.message : "Gagal membatalkan pencocokan." };
  } finally {
    client.release();
  }
}
