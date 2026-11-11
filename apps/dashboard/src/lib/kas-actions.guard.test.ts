import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { urutan } from "./penjaga-urutan";

/**
 * Penjaga TEKS atas `kas-actions.ts` (Layar 3 blok 2).
 *
 * 📌 Bentuk tetap dari kelas kesalahan kelima & keenam diterapkan SEJAK AWAL di
 * sini, bukan setelah mutasi menemukannya:
 *   · komentar JS **dan** komentar SQL dibuang — di mana pun letaknya, termasuk
 *     tepat sesudah backtick pembuka template literal;
 *   · asersi menuntut **pernyataan utuh**, bukan fragmen yang tersebar.
 *
 * ⚠️ Batasnya tetap sama: ini membuktikan penjagaan ADA di kode, bukan bahwa ia
 * bekerja terhadap DB. Yang membuktikan perilakunya adalah CD.
 */
const SRC = readFileSync(resolve(__dirname, "kas-actions.ts"), "utf8");
const KODE = SRC.split("\n")
  .filter((l) => {
    const t = l.trim();
    return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"));
  })
  .join("\n")
  .replace(/--.*$/gm, "");

/**
 * Badan SATU fungsi `export async function <nama>` — sampai sebelum `export`
 * berikutnya. Tanpa ini, asersi "nominal tidak dari client" akan salah: di
 * `simpanMutasiKas` nominal MEMANG datang dari pengguna (itu mutasi yang
 * diketik), dan larangannya hanya berlaku pada `setujuiSetoran`. Penjaga yang
 * memeriksa seluruh berkas untuk aturan yang cakupannya satu fungsi akan
 * memaksa penulisnya melonggarkan asersi sampai tak menjaga apa-apa.
 */
const badanFungsi = (nama: string): string => {
  const i = KODE.indexOf(`export async function ${nama}`);
  if (i < 0) return "";
  const j = KODE.indexOf("\nexport ", i + 1);
  return KODE.slice(i, j < 0 ? undefined : j);
};

/** Satu pernyataan SQL utuh yang dimulai dengan `prefix`, sampai backtick penutup. */
const pernyataan = (prefix: string): string => {
  const i = KODE.indexOf(prefix);
  if (i < 0) return "";
  const j = KODE.indexOf("`", i);
  return KODE.slice(i, j < 0 ? undefined : j);
};

describe("kas-actions — penjagaan yang tak boleh hilang", () => {
  it("penjaga ini punya SUBJEK", () => {
    for (const f of ["simpanMutasiKas", "setujuiSetoran", "voidMutasiKas", "pecahMutasi", "simpanMutasiBeban", "lengkapiBebanMutasi"]) {
      expect(KODE).toMatch(new RegExp(`export async function ${f}`));
    }
  });

  it("🔴 SALDO tidak pernah ditulis — tak ada kolom saldo di INSERT mana pun", () => {
    // Kalau kelak ada yang menambahkan kolom saldo "biar cepat", yang ia bangun
    // adalah angka yang bisa berselisih dengan mutasinya sendiri.
    //
    // 🔴 DIPERSEMPIT 24 Agu 2026 (§10.24). Bentuk lama melarang KATA "saldo",
    //    dan `saldo_awal` — sebuah PENANDA boolean, bukan angka — memerahkannya.
    //    Itu positif-palsu, dan positif-palsu mengajari orang mengabaikan
    //    penjaganya. Yang dilarang keputusan 0029 butir 2 adalah **kolom yang
    //    MENYIMPAN saldo**, bukan kata.
    //    Dan ia memeriksa SQL-nya, bukan berkasnya: kata "saldo" hidup wajar di
    //    prosa dan pesan galat ("Saldo pembuka adalah titik awal…"). Penjaga
    //    yang memindai prosa akan menuduh kalimat.
    const sqlSaja = (teks: string): string =>
      (teks.match(/`[^`]*`/g) ?? [])
        .filter((l) => /\b(SELECT|INSERT|UPDATE|DELETE)\b/i.test(l))
        .map((l) => l.replace(/--.*$/gm, ""))
        .join("\n");

    const TERLARANG = [/\bsaldo\b(?!_awal)/i, /saldo_akhir/i, /running_balance/i, /\bbalance\b/i];
    const sql = sqlSaja(KODE);
    expect(sql.length, "tak ada SQL yang diperiksa — penjaga tanpa subjek").toBeGreaterThan(200);
    for (const t of TERLARANG) expect(sql, `pola terlarang: ${t}`).not.toMatch(t);

    // 🔴 DAYA-BEDA di kedua arah, lewat PEMERIKSA YANG SAMA.
    const palsu = "const q = `INSERT INTO app.cash_ledger (saldo_akhir) VALUES ($1)`";
    expect(TERLARANG.some((t) => t.test(sqlSaja(palsu)))).toBe(true);
    const sah = "const q = `INSERT INTO app.cash_ledger (saldo_awal) VALUES (true)`";
    expect(TERLARANG.some((t) => t.test(sqlSaja(sah)))).toBe(false);
    // Prosa yang menyebut "saldo" TIDAK dituduh.
    expect(sqlSaja('const pesan = "Saldo pembuka adalah titik awal";')).toBe("");
  });

  it("gerbang §2.6 dipanggil, dan MENDAHULUI koneksi", () => {
    // `alasanTakBolehInput` MEMBUNGKUS `canInputKeuangan` + menutup irisan
    // HoF × keuangan (§10.12), dan membawa alasan penolakannya. Penjaga ini
    // menuntut gerbangnya lewat SATU pintu itu — bukan dua pemeriksaan yang
    // bisa berselisih.
    expect(KODE).toMatch(/alasanTakBolehInput\(/);
    expect(KODE).toMatch(/PESAN_TAK_BOLEH_INPUT\[alasan\]/);
    // `buka()` = requireUnit + gerbang; ia dipanggil di awal SETIAP aksi,
    // sebelum satu pun `pool.connect()`.
    expect(urutan(KODE, "alasanTakBolehInput(", "pool.connect()")).toBe("ok");
    // 🔴 Bukan hanya "gerbangnya dipanggil" — PENOLAKANNYA harus terjadi.
    // Uji mutasi: menghapus baris `return` ini meninggalkan `const alasan = …`
    // yang tetap cocok dengan asersi lama, jadi penjaga tetap hijau sementara
    // siapa pun boleh menulis. Memanggil pemeriksa tanpa memakai hasilnya
    // adalah bentuk lain dari "hijau tanpa subjek".
    expect(KODE).toMatch(
      /if \(alasan !== null\) return \{ (ok: false, error|boleh: false, error): PESAN_TAK_BOLEH_INPUT\[alasan\] \}/,
    );

    expect(KODE).toMatch(/scope\.requireUnit\(code\)/);
    // 3 → 4 (rencana 2026-10-29 U3): `pecahMutasi` lewat gerbang yang SAMA.
    // 4 → 6 (K6 U3): `simpanMutasiBeban`, `lengkapiBebanMutasi`.
    expect([...KODE.matchAll(/const ctx = await buka\(/g)]).toHaveLength(6);
    expect([...KODE.matchAll(/if \(!ctx\.boleh\) return/g)]).toHaveLength(6);
  });

  it("🔴 nominal tawaran dibaca DI SERVER, tidak diterima dari client", () => {
    // Kalau angkanya datang dari browser, "disetujui" berhenti berarti apa pun.
    const baca = pernyataan("SELECT id::text AS id, keterangan, amount::text");
    expect(baca).toMatch(/FROM app\.manual_entry/);
    expect(baca).toMatch(/section = 'setoran_tunai'/);
    const fn = badanFungsi("setujuiSetoran");
    expect(fn, "fungsi setujuiSetoran tidak ditemukan").not.toBe("");
    // Di fungsi INI nominal tak boleh datang dari payload…
    expect(fn).not.toMatch(/input\.amount/);
    // …dan yang di-INSERT adalah nominal hasil baca server (`r.amount`).
    expect(fn).toMatch(/r\.amount/);
    // Yang datang dari client hanyalah daftar ID.
    expect(KODE).toMatch(/manualEntryIds: string\[\]/);
    // Kontrol POSITIF: di mutasi yang memang diketik, nominal dari payload SAH.
    expect(badanFungsi("simpanMutasiKas")).toMatch(/input\.amount/);
  });

  it("INSERT setoran adalah SATU pernyataan utuh dan mengunci kategorinya", () => {
    const ins = pernyataan("INSERT INTO app.cash_ledger\n           (unit_id, account_id");
    expect(ins, "INSERT tawaran setoran tidak ditemukan utuh").not.toBe("");
    expect(ins).toMatch(/source_manual_entry_id/);
    expect(ins).toMatch(/'Setoran Hasil Penjualan'/);
    // Idempoten terhadap indeks unik parsial 0033.
    expect(ins).toMatch(/ON CONFLICT[\s\S]*DO NOTHING/);
  });

  it("RLS 0016: set_config transaction-local mendahului setiap DML", () => {
    // Empat sejak §10.24 menambah `tetapkanSaldoAwal`. Angkanya SENGAJA dipatok:
    // jalur tulis baru yang lupa men-set konteks akan menaikkannya tanpa
    // menaikkan angka di sini, dan penjaga ini memerah.
    // 4 → 5 (rencana 2026-10-29 U3): `pecahMutasi`. 5 → 7 (K6 U3).
    expect([...KODE.matchAll(/set_config\('app\.unit_ids', \$1, true\)/g)]).toHaveLength(7);
    expect(urutan(KODE, "set_config('app.unit_ids'", "INSERT INTO app.cash_ledger")).toBe("ok");
  });

  it("VOID-only: tak ada DELETE, dan pembatalan meninggalkan jejak", () => {
    expect(KODE).not.toMatch(/DELETE FROM/i);
    const upd = pernyataan("UPDATE app.cash_ledger");
    expect(upd).toMatch(/SET void=true, voided_by_user_id=\$1, voided_at=now\(\)/);
    expect(upd).toMatch(/AND NOT void/);
  });

  it("tanda & kategori diperiksa lewat aturan bersama, bukan disalin ulang", () => {
    // `tandaCocok`/`kategoriCocok` juga ditegakkan CHECK di 0029. Aturan yang
    // disalin ulang di sini akan berselisih dengan DB tanpa ada yang tahu.
    expect(KODE).toMatch(/tandaCocok\(input\.jenis, input\.amount\)/);
    expect(KODE).toMatch(/kategoriCocok\(input\.jenis, input\.categorySide\)/);
  });
});

describe("§10.24 · saldo pembuka — gerbang dan bentuknya", () => {
  const SRC = readFileSync(resolve(__dirname, "kas-actions.ts"), "utf8");
  const fn = SRC.slice(SRC.indexOf("export async function tetapkanSaldoAwal"));

  it("🔴 WEWENANG Head of Finance — bukan peran `keuangan`", () => {
    expect(fn).toMatch(/if \(!canNonaktifkanAkunKas\(\{[^}]*\}\)\) \{/);
    // Dan hasilnya DIPAKAI: memanggil tanpa menolak adalah kelas yang sudah
    // menggigit repo ini empat kali.
    expect(fn).toMatch(/return \{ ok: false, error: "Hanya Head of Finance/);
  });

  it("🔴 MENGGANTI, bukan menyunting: anchor lama di-VOID, bukan di-UPDATE nilainya", () => {
    expect(fn).toMatch(/SET void = true, voided_by_user_id/);
    // sisip baru — sejak §10.26 membawa penanda sementara di antara keduanya.
    expect(fn).toMatch(/saldo_awal, saldo_awal_sementara, created_by_user_id/);
    // Tak boleh ada UPDATE yang mengubah amount/business_date anchor.
    expect(fn).not.toMatch(/SET amount/);
    expect(fn).not.toMatch(/SET business_date/);
  });

  it("alasan WAJIB — syaratnya ADA, bukan hanya kalimatnya", () => {
    // 🔴 Bentuk pertama hanya mencocokkan teks "Alasan wajib diisi", sehingga
    //    melumpuhkan SYARATNYA tetap hijau (mutasi AA7). Kelas yang sudah
    //    menggigit repo ini berkali-kali: memanggil pemeriksa tanpa memakai
    //    hasilnya — di sini, menyimpan pesannya tanpa syaratnya.
    expect(fn).toMatch(/if \(input\.alasan\.trim\(\) === ""\) \{/);
    expect(fn).toMatch(/Alasan wajib diisi/);
    expect(fn).toMatch(/INSERT INTO app\.audit_log/);
    expect(fn).toMatch(/saldo_awal\.tetapkan|saldo_awal\.ganti/);
  });

  it("RLS di-set sebelum DML, di dalam transaksi yang sama", () => {
    expect(fn).toMatch(/BEGIN[\s\S]*set_config\('app\.unit_ids'[\s\S]*INSERT INTO app\.cash_ledger/);
  });

  it("🔴 penolakan mutasi pra-cut-over ADA, dan di DALAM transaksi", () => {
    const simpan = SRC.slice(
      SRC.indexOf("export async function simpanMutasiKas"),
      SRC.indexOf("export async function tetapkanSaldoAwal"),
    );
    // Diperiksa sesudah BEGIN — celah antara memeriksa dan menulis adalah cara
    // dua permintaan bersamaan menyelipkan baris pra-cut-over.
    expect(simpan).toMatch(/BEGIN[\s\S]*saldo_awal AND NOT void[\s\S]*INSERT INTO app\.cash_ledger/);
    expect(simpan).toMatch(/input\.date < cutOver/);
    expect(simpan).toMatch(/mendahului saldo pembuka/);
  });
});

describe("§10.26 — Rp 0 hanya sah sebagai saldo pembuka SEMENTARA", () => {
  const src = readFileSync(resolve(__dirname, "kas-actions.ts"), "utf8");
  const fn = src.slice(src.indexOf("export async function tetapkanSaldoAwal"));
  it("server menolak Rp 0 tanpa penanda, sebelum menyentuh DB", () => {
    expect(fn).toMatch(/input\.amount === 0 && !sementara/);
    expect(fn.indexOf("input.amount === 0 && !sementara")).toBeLessThan(fn.indexOf("pool.connect()"));
  });
  it("penanda ikut tersimpan di baris DAN di audit_log", () => {
    expect(fn).toMatch(/saldo_awal_sementara/);
    expect(fn).toMatch(/nominal: input\.amount,\s*\n\s*sementara,/);
  });
  it("DB: nol hanya lewat jalan saldo pembuka sementara (0044)", () => {
    const m = readFileSync(
      resolve(__dirname, "../../../backend/prisma/migrations/0044_saldo_pembuka_sementara/migration.sql"),
      "utf8",
    );
    expect(m).toMatch(/"jenis" = 'adjustment' AND "saldo_awal" AND "saldo_awal_sementara" AND "amount" = 0/);
    expect(m).toMatch(/NOT "saldo_awal_sementara" OR "saldo_awal"/);
  });
});

// ---------------------------------------------------------------------------
// K6 U4 (R19–R21) — "Pembelian BBM" di rekening BANK tak lewat jalur mutasi
// biasa; ia lewat field penebusan (`simpanPenebusan` dariBukuBank). DB TIRUAN
// (pola `kas-actions.pihak-lawan.test.ts`): "ditolak" = tak ada INSERT.
// ---------------------------------------------------------------------------

type KasT = { id: string; account_id: string; business_date: string; category_label: string | null; amount: number; void: boolean; tanggal_asal: string | null; alasan_maju: string | null; saldo_awal: boolean; transfer?: boolean };
/** Kaki keluar Kas Besar yang dibaca penjaga tab bank (rencana 2026-11-11 U5). */
type KasBesarT = { id: string; tanggal: string; kategori: string | null; amount: string; transferUuid: string | null; void: boolean };
type BebanT = { id: string; business_date: string; section: string; amount: number; operational_category: string; accounting_account: string; source_door: string; cash_ledger_id: string | null; void: boolean };

const t = vi.hoisted(() => {
  process.env.HEAD_OF_FINANCE_EMAILS = "hof@solagroup.co";
  const log: { sql: string; params: unknown[] }[] = [];
  const state = {
    kind: "bank",
    kas: [] as KasT[],
    beban: [] as BebanT[],
    audit: [] as { action: string; detail: unknown }[],
    // Peta 0056 (potongan): kategori → pos. "Management Fee" sengaja TAK ada.
    peta: { "Sarana & Prasarana (Listrik, Air, Lampu, Tlpn, Genset, Jalan)": "5300", "Lain-Lain": "5700" } as Record<string, string>,
    kategori: ["kredit|Biaya Operasional", "kredit|Management Fee", "debet|Pendapatan Lain-Lain", "kredit|Pembelian BBM", "kredit|Biaya Bank"],
    tutupBulan: false,
    kasBesar: [] as KasBesarT[],
    hari: (tgl: string): unknown => ({ status: "dibukukan", hariBuku: tgl, terdorongMaju: false, perluKodeAlasan: false }),
  };
  let staged: { kas: KasT[]; beban: BebanT[] } | null = null;
  let seq = 0;
  const kasNow = () => (staged ?? state).kas;
  const bebanNow = () => (staged ?? state).beban;
  const ok = (rows: unknown[] = [], rowCount?: number) => ({ rows, rowCount: rowCount ?? rows.length });
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      log.push({ sql, params });
      const p = params;
      if (sql === "BEGIN") {
        staged = { kas: state.kas.map((k) => ({ ...k })), beban: state.beban.map((b) => ({ ...b })) };
        return ok();
      }
      if (sql === "COMMIT") {
        if (staged) Object.assign(state, staged);
        staged = null;
        return ok();
      }
      if (sql === "ROLLBACK") {
        staged = null;
        return ok();
      }
      if (sql.includes("set_config")) return ok();
      if (sql.includes("a.kind = 'kas'")) return ok(state.kasBesar.filter((k) => k.tanggal === p[1]));
      if (sql.includes("FROM app.cash_account")) return ok([{ kind: state.kind }]);
      if (sql.includes("FROM app.cash_mutation_category")) return ok(state.kategori.includes(`${p[0]}|${p[1]}`) ? [{ ada: true }] : []);
      if (sql.includes("FROM app.category_account_map")) {
        const a = state.peta[p[1] as string];
        return ok(a ? [{ account: a }] : []);
      }
      if (sql.includes("FROM app.tutup_bulan")) return ok(state.tutupBulan ? [{ ada: 1 }] : []);
      if (sql.includes("INSERT INTO app.audit_log")) {
        state.audit.push({ action: p[2] as string, detail: JSON.parse(String(p[4])) });
        return ok();
      }
      if (sql.includes("INSERT INTO app.cash_ledger")) {
        const id = `kas-${++seq}`;
        const klas = sql.includes("tanggal_asal");
        kasNow().push({
          id,
          account_id: p[1] as string,
          business_date: p[2] as string,
          category_label: (klas ? p[6] : p[6]) as string | null,
          amount: Number(p[7]),
          void: false,
          tanggal_asal: klas ? ((p[10] as string | null) ?? null) : null,
          alasan_maju: klas ? ((p[11] as string | null) ?? null) : null,
          saldo_awal: false,
        });
        return ok([{ id }]);
      }
      if (sql.includes("INSERT INTO app.manual_entry")) {
        const [, date, section, , amount, op, akun, , cl] = p as [number, string, string, string, string, string, string, number, string];
        if (bebanNow().some((b) => b.cash_ledger_id === cl && !b.void)) throw new Error('duplicate key value violates unique constraint "manual_entry_cash_ledger_aktif_uq"');
        const id = `beban-${++seq}`;
        bebanNow().push({ id, business_date: date, section, amount: Number(amount), operational_category: op, accounting_account: akun, source_door: "finance", cash_ledger_id: cl, void: false });
        return ok([{ id }]);
      }
      if (sql.includes("FROM app.cash_ledger l") && sql.includes("FOR UPDATE OF l")) {
        const k = kasNow().find((x) => x.id === p[0] && !x.void);
        if (!k) return ok([]);
        return ok([
          {
            saldo_awal: k.saldo_awal,
            dari_edc: false,
            dari_penebusan: false,
            antar_unit: false,
            transfer: k.transfer ?? false,
            dicocokkan: false,
            accountId: k.account_id,
            businessDate: k.business_date,
            categoryLabel: k.category_label,
            keterangan: "mutasi",
            amount: String(k.amount),
            bebanAktif: bebanNow().some((b) => b.cash_ledger_id === k.id && !b.void),
          },
        ]);
      }
      if (sql.includes("UPDATE app.cash_ledger")) {
        const k = kasNow().find((x) => x.id === p[1] && !x.void);
        if (k) k.void = true;
        return ok([], k ? 1 : 0);
      }
      if (sql.includes("UPDATE app.manual_entry")) {
        let n = 0;
        for (const b of bebanNow()) if (b.cash_ledger_id === p[1] && !b.void) { b.void = true; n++; }
        return ok([], n);
      }
      return ok();
    },
    release: () => {},
  };
  const connect = vi.fn(async () => client);
  return { log, state, connect };
});

vi.mock("./hari-buku-queries", () => ({
  hariBukuTerkunci: vi.fn(async (_c: unknown, _u: number, tgl: string) => t.state.hari(tgl)),
}));
vi.mock("./db", () => ({ pool: { connect: t.connect }, qScoped: vi.fn(), q: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("./scope", () => ({
  getDataScope: vi.fn(async () => ({
    userId: 7,
    role: "keuangan",
    email: "staf@solagroup.co",
    requireUnit(code: string) {
      if (code !== "6300001") throw new Error("NEXT_NOT_FOUND");
      return { unit_id: 2, code, name: "Contoh" };
    },
  })),
}));

const { simpanMutasiKas, simpanMutasiBeban, lengkapiBebanMutasi, voidMutasiKas } = await import("./kas-actions");

describe("simpanMutasiKas — Pembelian BBM di rekening bank ditolak (K6 U4)", () => {
  const BBM = {
    code: "6300001",
    date: "2026-11-03",
    accountId: "44444444-4444-4444-8444-444444444444",
    keterangan: "Bayar SO",
    jenis: "kredit" as const,
    categorySide: "kredit" as const,
    categoryLabel: "Pembelian BBM",
    amount: -110_000_000,
  };
  const insertKas = () => t.log.filter((l) => l.sql.includes("INSERT INTO app.cash_ledger"));

  beforeEach(() => {
    t.log.length = 0;
    t.state.kind = "bank";
    t.state.kas = [];
    t.state.beban = [];
  });

  it("🔴 rekening bank + Pembelian BBM ⇒ ditolak, menunjuk field penebusan; tak ada INSERT", async () => {
    const r = await simpanMutasiKas(BBM);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/field penebusan/);
    expect(insertKas()).toHaveLength(0);
    expect(t.log.map((l) => l.sql)).toContain("ROLLBACK");
  });

  it("Kas Besar + Pembelian BBM ⇒ tetap tersimpan lewat jalur biasa", async () => {
    t.state.kind = "kas";
    const r = await simpanMutasiKas(BBM);
    expect(r).toEqual({ ok: true });
    expect(insertKas()).toHaveLength(1);
  });

  it("kategori lain di rekening bank ⇒ jalur biasa tak berubah", async () => {
    const r = await simpanMutasiKas({ ...BBM, categoryLabel: "Biaya Bank" });
    expect(r).toEqual({ ok: true });
    expect(insertKas()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// K6 U3 (R23, R24, AE6, KTD6) — Tambah mutasi berkategori biaya / pendapatan
// lain-lain: SATU simpan menulis mutasi DAN baris Biaya bertaut. Diuji dari
// BARIS TERSIMPAN di DB tiruan (COMMIT/ROLLBACK disimulasikan).
// ---------------------------------------------------------------------------

describe("simpanMutasiBeban — mutasi + baris Biaya dalam satu transaksi (K6 U3)", () => {
  const SARANA = "Sarana & Prasarana (Listrik, Air, Lampu, Tlpn, Genset, Jalan)";
  const KAS_BESAR = "11111111-1111-4111-8111-111111111111";
  const dasar = {
    code: "6300001",
    date: "2026-11-03",
    accountId: KAS_BESAR,
    keterangan: "Bayar listrik",
    jenis: "kredit" as const,
    categoryLabel: "Biaya Operasional",
    amount: -1_500_000,
    operationalCategory: SARANA,
  };
  beforeEach(() => {
    t.log.length = 0;
    t.state.kind = "kas";
    t.state.kas = [];
    t.state.beban = [];
    t.state.audit = [];
    t.state.tutupBulan = false;
    t.state.hari = (tgl: string) => ({ status: "dibukukan", hariBuku: tgl, terdorongMaju: false, perluKodeAlasan: false });
  });

  it("Covers AE6. Kredit Kas Besar Rp 1.500.000 Biaya Operasional + Sarana & Prasarana ⇒ satu mutasi + satu Biaya pos 5300", async () => {
    const r = await simpanMutasiBeban(dasar);
    expect(r.ok).toBe(true);
    expect(t.state.kas).toHaveLength(1);
    expect(t.state.kas[0]).toMatchObject({ amount: -1_500_000, business_date: "2026-11-03", category_label: "Biaya Operasional" });
    expect(t.state.beban).toHaveLength(1);
    expect(t.state.beban[0]).toMatchObject({
      section: "pengeluaran",
      amount: 1_500_000,
      accounting_account: "5300",
      operational_category: SARANA,
      source_door: "finance",
      cash_ledger_id: t.state.kas[0]!.id,
      business_date: "2026-11-03",
    });
    expect(t.state.audit.map((a) => a.action)).toContain("kas.beban");
  });

  it("Biaya Operasional TANPA jenis biaya ⇒ ditolak server, tak ada yang tersimpan", async () => {
    const r = await simpanMutasiBeban({ ...dasar, operationalCategory: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/jenis biaya/);
    expect(t.state.kas).toHaveLength(0);
    expect(t.state.beban).toHaveLength(0);
  });

  it("Debet bank Pendapatan Lain-Lain tanpa field kedua ⇒ baris pendapatan_lain pos 4200", async () => {
    t.state.kind = "bank";
    const r = await simpanMutasiBeban({
      ...dasar,
      jenis: "debet",
      categoryLabel: "Pendapatan Lain-Lain",
      amount: 750_000,
      operationalCategory: null,
    });
    expect(r.ok).toBe(true);
    expect(t.state.beban).toHaveLength(1);
    expect(t.state.beban[0]).toMatchObject({ section: "pendapatan_lain", amount: 750_000, accounting_account: "4200" });
    expect(t.state.beban[0]!.cash_ledger_id).toBe(t.state.kas[0]!.id);
  });

  it("Management Fee tanpa field kedua ⇒ pengeluaran di pos P20 (awal 5700, peta 'Management Fee' belum ada)", async () => {
    const r = await simpanMutasiBeban({ ...dasar, categoryLabel: "Management Fee", amount: -2_000_000, operationalCategory: null });
    expect(r.ok).toBe(true);
    expect(t.state.beban[0]).toMatchObject({ section: "pengeluaran", amount: 2_000_000, accounting_account: "5700" });
    // Bila HoF memberi peta sendiri, pos itu yang dipakai.
    t.state.peta["Management Fee"] = "5710";
    t.state.kas = [];
    t.state.beban = [];
    await simpanMutasiBeban({ ...dasar, categoryLabel: "Management Fee", amount: -2_000_000, operationalCategory: null });
    expect(t.state.beban[0]).toMatchObject({ accounting_account: "5710", operational_category: "Management Fee" });
    delete t.state.peta["Management Fee"];
  });

  it("hari tertutup ⇒ mutasi DAN Biaya terdorong maju bersama (satu business_date)", async () => {
    t.state.hari = () => ({ status: "dibukukan", hariBuku: "2026-11-05", terdorongMaju: true, perluKodeAlasan: true });
    const r = await simpanMutasiBeban(dasar);
    expect(r.ok).toBe(true);
    expect(t.state.kas[0]).toMatchObject({ business_date: "2026-11-05", tanggal_asal: "2026-11-03" });
    expect(t.state.kas[0]!.alasan_maju).toMatch(/^ADJ-FWD-/);
    expect(t.state.beban[0]!.business_date).toBe("2026-11-05");
  });

  it("pra-cut-over ⇒ ditolak, tak ada yang tersimpan", async () => {
    t.state.hari = () => ({ status: "pra-cut-over", cutOver: "2026-10-01" });
    const r = await simpanMutasiBeban(dasar);
    expect(r.ok).toBe(false);
    expect(t.state.kas).toHaveLength(0);
    expect(t.state.beban).toHaveLength(0);
  });

  it("🔴 penjaga: nominal Biaya SELALU dari nominal mutasi — isian kedua dari klien diabaikan", async () => {
    const curang = { ...dasar, amountBeban: 1, amountRp: 1 } as typeof dasar;
    const r = await simpanMutasiBeban(curang);
    expect(r.ok).toBe(true);
    expect(t.state.beban[0]!.amount).toBe(1_500_000);
    expect(Math.abs(t.state.kas[0]!.amount)).toBe(t.state.beban[0]!.amount);
  });

  it("kategori di sisi yang salah ⇒ ditolak (dibaca dari master kategori)", async () => {
    const r = await simpanMutasiBeban({ ...dasar, jenis: "debet", amount: 1_500_000 });
    expect(r.ok).toBe(false);
    expect(t.state.kas).toHaveLength(0);
  });

  it("R24: membatalkan mutasi ikut membatalkan baris Biaya bertaut", async () => {
    await simpanMutasiBeban(dasar);
    const id = t.state.kas[0]!.id;
    const r = await voidMutasiKas({ code: "6300001", date: "2026-11-03", id });
    expect(r).toEqual({ ok: true });
    expect(t.state.kas[0]!.void).toBe(true);
    expect(t.state.beban[0]!.void).toBe(true);
  });

  it("simpanMutasiKas menolak kategori biaya — tak ada mutasi biaya tanpa barisnya", async () => {
    const r = await simpanMutasiKas({ ...dasar, categorySide: "kredit" });
    expect(r.ok).toBe(false);
    expect(t.state.kas).toHaveLength(0);
  });
});

describe("lengkapiBebanMutasi — R27 (a): mutasi biaya tanpa baris Biaya", () => {
  const SARANA = "Sarana & Prasarana (Listrik, Air, Lampu, Tlpn, Genset, Jalan)";
  beforeEach(() => {
    t.state.kas = [
      { id: "kas-lama", account_id: "A", business_date: "2026-10-20", category_label: "Biaya Operasional", amount: -400_000, void: false, tanggal_asal: null, alasan_maju: null, saldo_awal: false },
    ];
    t.state.beban = [];
    t.state.audit = [];
    t.state.tutupBulan = false;
    t.state.hari = (tgl: string) => ({ status: "dibukukan", hariBuku: tgl, terdorongMaju: false, perluKodeAlasan: false });
  });

  it("menulis Biaya bertaut dengan nominal dari baris kas tersimpan", async () => {
    const r = await lengkapiBebanMutasi({ code: "6300001", cashLedgerId: "kas-lama", operationalCategory: SARANA });
    expect(r.ok).toBe(true);
    expect(t.state.beban).toEqual([
      expect.objectContaining({ cash_ledger_id: "kas-lama", amount: 400_000, accounting_account: "5300", business_date: "2026-10-20" }),
    ]);
  });

  it("kedua kali ⇒ ditolak: satu mutasi satu Biaya aktif", async () => {
    await lengkapiBebanMutasi({ code: "6300001", cashLedgerId: "kas-lama", operationalCategory: SARANA });
    const r = await lengkapiBebanMutasi({ code: "6300001", cashLedgerId: "kas-lama", operationalCategory: SARANA });
    expect(r.ok).toBe(false);
    expect(t.state.beban).toHaveLength(1);
  });

  it("bulan sudah ditutup ⇒ ditolak", async () => {
    t.state.tutupBulan = true;
    const r = await lengkapiBebanMutasi({ code: "6300001", cashLedgerId: "kas-lama", operationalCategory: SARANA });
    expect(r.ok).toBe(false);
    expect(t.state.beban).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Rencana 2026-11-11 U5 (R13, R14, KTD8) — penjaga tab bank: debet "Setoran
// Hasil Penjualan" yang menyamai kaki keluar Kas Besar hari itu ditolak tanpa
// konfirmasi "setoran langsung"; konfirmasi diaudit. U3 (KTD6): void satu
// kaki transfer ditolak — jalannya "Batalkan transfer".
// ---------------------------------------------------------------------------

describe("simpanMutasiKas — penjaga kaki bank transfer (rencana 2026-11-11 U5)", () => {
  const BCA = "44444444-4444-4444-8444-444444444444";
  const SHP = {
    code: "6300001",
    date: "2026-11-03",
    accountId: BCA,
    keterangan: "setoran penjualan dari kas besar",
    jenis: "debet" as const,
    categorySide: "debet" as const,
    categoryLabel: "Setoran Hasil Penjualan",
    amount: 399_979_000,
  };
  const kakiKas = (o: Partial<KasBesarT> = {}): KasBesarT => ({
    id: "kas-sk",
    tanggal: "2026-11-03",
    kategori: "Setoran ke Bank",
    amount: "-399979000.00",
    transferUuid: null,
    void: false,
    ...o,
  });
  const insertKas = () => t.log.filter((l) => l.sql.includes("INSERT INTO app.cash_ledger"));
  const bacaKasBesar = () => t.log.filter((l) => l.sql.includes("a.kind = 'kas'"));

  beforeEach(() => {
    t.log.length = 0;
    t.state.kind = "bank";
    t.state.kas = [];
    t.state.audit = [];
    t.state.kasBesar = [kakiKas()];
  });

  it("🔴 Covers AE5. Tab bank, nominal & tanggal sama dengan 'Setoran ke Bank' Kas Besar ⇒ ditolak tanpa centang; tak ada INSERT", async () => {
    const r = await simpanMutasiKas(SHP);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/kategorinya 'Pindah Buku'/);
      expect(r.error).toMatch(/Rp 399\.979\.000/);
      expect(r.error).toMatch(/centang 'setoran langsung'/);
    }
    expect(insertKas()).toHaveLength(0);
  });

  it("dengan centang 'setoran langsung' ⇒ tersimpan, dan konfirmasinya diaudit", async () => {
    const r = await simpanMutasiKas({ ...SHP, bukanTransfer: true });
    expect(r).toEqual({ ok: true });
    expect(t.state.kas).toHaveLength(1);
    const a = t.state.audit.find((x) => x.action === "kas.setoran_bank_bukan_transfer");
    expect(a?.detail).toMatchObject({ kas: t.state.kas[0]!.id, tanggal: "2026-11-03", nominal: 399_979_000 });
  });

  it("nominal berbeda ⇒ tersimpan tanpa peringatan dan tanpa audit konfirmasi", async () => {
    const r = await simpanMutasiKas({ ...SHP, amount: 399_978_999 });
    expect(r).toEqual({ ok: true });
    expect(t.state.audit.map((x) => x.action)).not.toContain("kas.setoran_bank_bukan_transfer");
  });

  it("kaki Kas Besar sudah bertaut transfer ⇒ tak dianggap terlewat", async () => {
    t.state.kasBesar = [kakiKas({ transferUuid: "6f1c0b8e-2a4d-4c3b-9e1f-0a2b3c4d5e6f" })];
    expect(await simpanMutasiKas(SHP)).toEqual({ ok: true });
  });

  it("R14: tab Kas Besar 'Setoran Hasil Penjualan' tak pernah diperiksa", async () => {
    t.state.kind = "kas";
    expect(await simpanMutasiKas(SHP)).toEqual({ ok: true });
    expect(bacaKasBesar()).toHaveLength(0);
  });

  it("setujuiSetoran tak berubah — tak membaca kaki Kas Besar (D7 ditunda)", () => {
    expect(badanFungsi("setujuiSetoran")).not.toMatch(/kakiTransferTerlewat|bukanTransfer/);
  });
});

describe("voidMutasiKas — kaki transfer ditolak satu per satu (rencana 2026-11-11 KTD6)", () => {
  beforeEach(() => {
    t.log.length = 0;
    t.state.kas = [
      { id: "kaki-tf", account_id: "A", business_date: "2026-11-03", category_label: "Pindah Buku", amount: 100, void: false, tanggal_asal: null, alasan_maju: null, saldo_awal: false, transfer: true },
      { id: "biasa", account_id: "A", business_date: "2026-11-03", category_label: "Biaya Bank", amount: -5, void: false, tanggal_asal: null, alasan_maju: null, saldo_awal: false },
    ];
    t.state.beban = [];
  });

  it("🔴 kaki transfer ⇒ ditolak, menunjuk 'Batalkan transfer'; tak ada UPDATE", async () => {
    const r = await voidMutasiKas({ code: "6300001", date: "2026-11-03", id: "kaki-tf" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Batalkan transfer/);
    expect(t.log.some((l) => l.sql.includes("UPDATE app.cash_ledger"))).toBe(false);
    expect(t.state.kas[0]!.void).toBe(false);
  });

  it("baris biasa tetap bisa dibatalkan (regresi)", async () => {
    expect(await voidMutasiKas({ code: "6300001", date: "2026-11-03", id: "biasa" })).toEqual({ ok: true });
    expect(t.state.kas[1]!.void).toBe(true);
  });

  it("UPDATE void ikut menuntut transfer_uuid IS NULL (sabuk kedua)", () => {
    const upd = badanFungsi("voidMutasiKas");
    expect(upd).toMatch(/AND pasangan_uuid IS NULL\s+AND transfer_uuid IS NULL/);
  });
});
