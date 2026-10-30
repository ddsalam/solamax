import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

/**
 * UJI ULANG — FASE TUNTAS (rencana 2026-10-29 U13; Success Criteria butir 1:
 * "setiap mutasi berakhir tercocokkan, terklasifikasi, atau diparkir").
 *
 * Lanjutan `uji-ulang-rekening-koran.ts`: sesudah 18 e-statement diunggah ke
 * unit fiktif 8810, setiap baris impor yang masih terbuka diselesaikan lewat
 * SERVER ACTION ASLI — bukan SQL tiruan — dengan sesi Keuangan tiruan:
 *
 *   · debit B2B Pertamina ber-SO yang buktinya ada ⇒ `simpanPenebusan`
 *     (`mutasiBankId`; Net/PPN/PPh/PBBKB/Nota dibaca dari bukti BCA asli);
 *   · pola kode transaksi BCA yang tak butuh pertimbangan (EDC, kartu kredit,
 *     setoran jemputan, bunga, pajak bunga, biaya admin) ⇒ `klasifikasiKategori`;
 *   · sisanya (transfer, BI-FAST, koreksi, SO tanpa bukti) ⇒ `klasifikasiParkir`
 *     — keputusan manusia, ditunggu di penampung.
 *
 * Lalu dibuktikan dari DB: nol baris terbuka, Σ kas lahiran = Σ baris impor.
 *
 * ⛔ Hanya HITUNGAN yang dicetak. Gated & tier testing saja:
 *
 *   cd apps/dashboard
 *   UJI_ULANG_TUNTASKAN=1 DATABASE_URL="postgresql://dashboard_app:…@127.0.0.1:PORT/solamax?options=…" \
 *   UJI_ULANG_BUKTI_DIR="/path/lokal/Arsip Bukti Penebusan/2026" \
 *     npx vitest run scripts/uji-ulang-tuntaskan.live.test.ts
 *
 * Pembersihan sesudahnya: `uji-ulang-rekening-koran.ts --bersihkan`.
 */
const LIVE = process.env.UJI_ULANG_TUNTASKAN === "1" && !!process.env.DATABASE_URL;
const d = LIVE ? describe : describe.skip;

const UNIT = { unit_id: 8810, code: "UJI-8810", name: "Uji ulang" };
const SYSID_TEST = "7659054651798528016";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../src/lib/scope", () => ({
  getDataScope: vi.fn(async () => ({
    userId: 0,
    role: "keuangan",
    email: "uji-ulang-rekening-koran@sintetis.invalid",
    units: [UNIT],
    requireUnit(code: string) {
      if (code !== UNIT.code) throw new Error("NEXT_NOT_FOUND");
      return UNIT;
    },
  })),
}));

/** Komponen bukti "B2B Pertamina – Otorisasi Transaksi" BCA, rupiah. */
interface Bukti {
  net: number;
  ppn: number;
  pph: number;
  pbbkb: number;
  nota: number;
  gross: number;
}

const angka = (t: string, label: string): number | null => {
  const m = t.match(new RegExp(`${label}\\s*:\\s*(-?[\\d,]+\\.\\d\\d)`));
  return m ? Number(m[1]!.replace(/,/g, "")) : null;
};

export function bacaBukti(t: string): { so: string; bukti: Bukti } | null {
  const so = t.match(/No\.\s*SO\s*:\s*(\d+)/)?.[1];
  const v = {
    net: angka(t, "Harga Net"),
    ppn: angka(t, "PPN"),
    pph: angka(t, "PPh"),
    pbbkb: angka(t, "PBBKB"),
    nota: angka(t, "Nilai Nota Debet/Kredit"),
    gross: angka(t, "Total Pembayaran"),
  };
  if (!so || Object.values(v).some((x) => x === null)) return null;
  return { so: so.replace(/^0+/, ""), bukti: v as Bukti };
}

type Aturan = { kategori: string; operasional: string | null };

/** Kode transaksi BCA generik ⇒ kategori. `null` = butuh pertimbangan manusia (parkir). */
function aturan(keterangan: string, kredit: boolean): Aturan | null {
  const k = keterangan.replace(/\s+/g, " ").trim().toUpperCase();
  if (kredit) {
    if (/^KR OTOMATIS .*SETORAN JEMPUTAN/.test(k)) return { kategori: "Setoran Hasil Penjualan", operasional: null };
    if (/^KR OTOMATIS .*MID/.test(k) || /^KARTU KREDIT/.test(k)) return { kategori: "Penjualan EDC", operasional: null };
    if (/^BUNGA\b/.test(k) || /^CR KOREKSI BUNGA/.test(k)) return { kategori: "Pendapatan Lain-Lain", operasional: "Lain-Lain" };
    return null;
  }
  if (/^PAJAK BUNGA/.test(k) || /^BIAYA ADM/.test(k) || /^BA JASA/.test(k) || /BIAYA SURAT REF/.test(k)) {
    return { kategori: "Biaya Operasional", operasional: "Biaya Admin" };
  }
  return null;
}

const tanpaAngka = (s: string): string => s.replace(/\d/g, "9").replace(/Rp\s?[\d.,]+/g, "Rp…").slice(0, 90);

d("U13 — setiap baris impor unit fiktif tuntas lewat server action asli", () => {
  it("nol baris terbuka; Σ kas lahiran = Σ baris impor", { timeout: 1_800_000 }, async () => {
    const { pool } = await import("../src/lib/db");
    const sysid = (await pool.query<{ s: string }>("SELECT system_identifier::text AS s FROM pg_control_system()")).rows[0]?.s;
    expect(sysid, "hanya tier testing solamax-pg-rlsstg").toBe(SYSID_TEST);

    const { simpanPenebusan } = await import("../src/lib/penebusan-actions");
    const { klasifikasiKategori, klasifikasiParkir } = await import("../src/lib/klasifikasi-actions");
    const { teksDariPdf } = await import("../src/lib/pdf-teks");

    // Bukti penebusan asli (di luar repo) ⇒ SO → komponen.
    const bukti = new Map<string, Bukti>();
    const dir = process.env.UJI_ULANG_BUKTI_DIR;
    let buktiTakTerbaca = 0;
    if (dir) {
      for (const f of readdirSync(dir).filter((x) => x.toLowerCase().endsWith(".pdf"))) {
        const b = bacaBukti(await teksDariPdf(readFileSync(join(dir, f))).catch(() => ""));
        if (b) bukti.set(b.so, b.bukti);
        else buktiTakTerbaca += 1;
      }
    }

    const baca = async <T extends object>(sql: string, p: unknown[] = []): Promise<T[]> => {
      const c = await pool.connect();
      try {
        await c.query("BEGIN READ ONLY");
        await c.query("SELECT set_config('app.unit_ids', $1, true)", [String(UNIT.unit_id)]);
        return (await c.query<T>(sql, p)).rows;
      } finally {
        await c.query("ROLLBACK").catch(() => {});
        c.release();
      }
    };

    const terbuka = await baca<{ id: string; account_id: string; tanggal: string; keterangan: string; amount: string; so: string | null }>(
      `SELECT m.id::text, m.account_id::text, to_char(m.tanggal_bank,'YYYY-MM-DD') AS tanggal, m.keterangan, m.amount::text, m.so
         FROM app.mutasi_bank m
        WHERE m.unit_id = $1 AND m.rk_status = 'aktif' AND NOT m.pra_cutover
          AND NOT EXISTS (SELECT 1 FROM app.cocok_bank_baris b WHERE b.mutasi_bank_id = m.id AND b.unit_id = m.unit_id AND b.aktif)
        ORDER BY m.tanggal_bank, m.urutan`,
      [UNIT.unit_id],
    );

    const hitung = new Map<string, number>();
    const tambah = (k: string) => hitung.set(k, (hitung.get(k) ?? 0) + 1);
    const galat = new Map<string, number>();

    for (const m of terbuka) {
      const sen = Math.round(Number(m.amount) * 100);
      const b = m.so && sen < 0 ? bukti.get(m.so.replace(/^0+/, "")) : undefined;
      let r: { ok: true } | { ok: false; error: string };
      let jalur: string;
      if (b) {
        jalur = "penebusan (bukti asli)";
        r = await simpanPenebusan({
          code: UNIT.code,
          mutasiBankId: m.id,
          noSo: m.so!,
          tanggalBayar: m.tanggal,
          accountId: m.account_id,
          ...b,
        });
      } else {
        const a = aturan(m.keterangan, sen > 0);
        if (a) {
          jalur = `kategori: ${a.kategori}`;
          r = await klasifikasiKategori({ code: UNIT.code, mutasiId: m.id, categoryLabel: a.kategori, operationalCategory: a.operasional });
        } else {
          jalur = m.so ? "parkir: SO tanpa bukti di arsip" : "parkir: butuh pertimbangan";
          r = await klasifikasiParkir({ code: UNIT.code, mutasiId: m.id, catatan: m.so ? "bukti penebusan belum ada di arsip" : null });
        }
      }
      if (r.ok) tambah(jalur);
      else {
        const k = `${jalur} ⇒ ${tanpaAngka(r.error)}`;
        galat.set(k, (galat.get(k) ?? 0) + 1);
      }
    }

    // Potret akhir dari DB.
    const [akhir] = await baca<{ n: number; terbuka: number; diparkir: number; selisih: string; penebusan: number; tebusTakSama: number }>(
      `WITH g AS (
         SELECT b.mutasi_bank_id AS mid, b.cocok_id AS gid
           FROM app.cocok_bank_baris b WHERE b.unit_id = $1 AND b.aktif AND b.mutasi_bank_id IS NOT NULL),
       kas AS (
         SELECT b.cocok_id AS gid, sum(l.amount) AS kas,
                sum(l.amount) FILTER (WHERE l.category_label = 'Mutasi Belum Teridentifikasi') AS penampung
           FROM app.cocok_bank_baris b JOIN app.cash_ledger l ON l.id = b.cash_ledger_id AND l.unit_id = b.unit_id
          WHERE b.unit_id = $1 AND b.aktif AND NOT l.void GROUP BY 1)
       SELECT count(*)::int AS n,
              count(*) FILTER (WHERE g.gid IS NULL)::int AS terbuka,
              count(*) FILTER (WHERE COALESCE(k.penampung,0) <> 0)::int AS diparkir,
              (sum(m.amount) - sum(COALESCE(k.kas,0)))::text AS selisih,
              (SELECT count(*)::int FROM app.penebusan p WHERE p.unit_id = $1 AND NOT p.void) AS penebusan,
              (SELECT count(*)::int FROM app.penebusan p WHERE p.unit_id = $1 AND NOT p.void
                  AND p.net + p.ppn + p.pph + p.pbbkb + p.nota <> p.gross) AS "tebusTakSama"
         FROM app.mutasi_bank m LEFT JOIN g ON g.mid = m.id LEFT JOIN kas k ON k.gid = g.gid
        WHERE m.unit_id = $1 AND m.rk_status = 'aktif' AND NOT m.pra_cutover`,
      [UNIT.unit_id],
    );

    console.log(`\n# Uji ulang — fase tuntas (unit fiktif ${UNIT.unit_id})`);
    console.log(`Bukti penebusan terbaca: ${bukti.size} (tak terbaca ${buktiTakTerbaca})`);
    console.log(`Baris terbuka sebelum: ${terbuka.length}`);
    for (const [k, v] of [...hitung.entries()].sort()) console.log(`  ✅ ${k.padEnd(44)} ${v}`);
    for (const [k, v] of [...galat.entries()].sort()) console.log(`  ❌ ${k}  ×${v}`);
    console.log(`Sesudah: ${akhir!.n} baris · terbuka ${akhir!.terbuka} · diparkir ${akhir!.diparkir} · tercocokkan ${akhir!.n - akhir!.terbuka - akhir!.diparkir}`);
    console.log(`Σ baris impor − Σ kas lahiran: ${akhir!.selisih} · penebusan ${akhir!.penebusan} (Σ komponen ≠ Gross: ${akhir!.tebusTakSama})`);

    expect(galat.size, "setiap server action menerima barisnya").toBe(0);
    expect(akhir!.terbuka).toBe(0);
    expect(Number(akhir!.selisih)).toBe(0);
    expect(akhir!.tebusTakSama).toBe(0);
    await pool.end();
  });
});
