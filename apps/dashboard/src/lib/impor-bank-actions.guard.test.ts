import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { urutan } from "./penjaga-urutan";

/**
 * Penjaga TEKS impor rekening koran (rencana 2026-10-29 U9; R17, R22, R31;
 * KTD6; Implementation Constraints "Unggah berkas dikeraskan") — bentuk
 * `penebusan-actions.guard.test.ts`: komentar JS & SQL dibuang, asersi urutan
 * lewat `urutan()` (yang menuntut KEDUA ujung ada).
 *
 * Yang dijaga:
 *   · gerbang (`requireUnit` + predikat) SEBELUM berkas disentuh, ukuran
 *     SEBELUM dibaca, pembaca U8 SEBELUM koneksi DB (AE3 tanpa jejak);
 *   · tak pernah menulis `cash_ledger` (KTD6), tanpa DELETE;
 *   · tarik: predikat HoF sebelum koneksi; kelompok cocok aktif (U10) & penanda
 *     U12 (bulan tertutup) SEBELUM UPDATE; cocok otomatis sesudah COMMIT unggah.
 *
 * ⚠️ Batas: membuktikan penjagaan ADA di kode. Perilakunya:
 * `impor-bank-actions.test.ts` (DB tiruan) dan uji DB-live ber-gerbang env.
 */
const tanpaKomentar = (src: string): string =>
  src
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"));
    })
    .join("\n")
    .replace(/--.*$/gm, "");

const MENTAH = readFileSync(resolve(__dirname, "impor-bank-actions.ts"), "utf8");
const KODE = tanpaKomentar(MENTAH);
/** Inti tulis impor (satu salinan SQL) — dipanggil langkah 4 unggahRekeningKoran. */
const KODE_TULIS = tanpaKomentar(readFileSync(resolve(__dirname, "impor-bank-tulis.ts"), "utf8"));

const badan = (kode: string, nama: string): string => {
  const i = kode.indexOf(`export async function ${nama}`);
  if (i < 0) return "";
  const j = kode.indexOf("\nexport ", i + 1);
  return kode.slice(i, j < 0 ? undefined : j);
};

/** Pelanggaran urutan unggah — [] = patuh. */
function pelanggaranUnggah(fn: string): string[] {
  const salah: string[] = [];
  for (const [a, b] of [
    ["scope.requireUnit(", 'form.get("berkas")'],
    ["canImporRekeningKoran(ctx)", 'form.get("berkas")'],
    ['form.get("berkas")', "periksaBerkas(berkas.size)"],
    ["periksaBerkas(berkas.size)", "berkas.arrayBuffer()"],
    ["berkas.arrayBuffer()", "teksDariPdf(isi)"],
    ["bacaRekeningKoranBca(", "pool.connect()"],
    ['client.query("BEGIN")', "set_config('app.unit_ids'"],
    ["nomorRekeningSama(", "simpanRekeningKoran(client"],
    ["simpanRekeningKoran(client", 'client.query("COMMIT")'],
  ] as const) {
    const u = urutan(fn, a, b);
    if (u !== "ok") salah.push(`${a} → ${b}: ${u}`);
  }
  return salah;
}

describe("unggahRekeningKoran — wewenang SEBELUM berkas, pembaca SEBELUM DB", () => {
  const fn = badan(KODE, "unggahRekeningKoran");

  it("punya subjek", () => {
    expect(fn).not.toBe("");
    expect(fn).toMatch(/simpanRekeningKoran\(client/);
    // Isi langkah 4 ada di impor-bank-tulis.ts: rekening koran SEBELUM barisnya.
    expect(urutan(KODE_TULIS, "INSERT INTO app.rekening_koran", "INSERT INTO app.mutasi_bank")).toBe("ok");
  });

  it("🔴 requireUnit → predikat → berkas → ukuran → baca → teks → parser → koneksi → BEGIN → … → COMMIT", () => {
    expect(pelanggaranUnggah(fn)).toEqual([]);
  });

  it("predikat DITOLAK (return), bukan sekadar dipanggil", () => {
    expect(fn).toMatch(/if \(!canImporRekeningKoran\(ctx\)\) \{\s*return tolak\("wewenang"/);
    expect(fn).toMatch(/if \(salahUkuran !== null\) return tolak\("berkas"/);
  });

  it("DAYA-BEDA: gerbang dipindah ke sesudah berkas dibaca ⇒ merah", () => {
    const gerbang = fn.slice(fn.indexOf("if (!canImporRekeningKoran(ctx))"), fn.indexOf("const accountId"));
    expect(gerbang).not.toBe("");
    const telat = fn.replace(gerbang, "").replace("let rk: RekeningKoran;", `${gerbang}\n  let rk: RekeningKoran;`);
    expect(telat).not.toBe(fn);
    expect(pelanggaranUnggah(telat).length).toBeGreaterThan(0);
  });

  it("R22: pra-cut-over memakai SATU aturan tanggal buku (tentukanHariBuku), hasilnya ditulis", () => {
    expect(fn).toMatch(/tentukanHariBuku\(\{ tanggal: r\.tanggal, cutOver, tertutup: \[\] \}\)\.status === "pra-cut-over"/);
    expect(fn).toMatch(/pra_cutover\)/);
  });
});

describe("tarikRekeningKoran — HoF, kelompok cocok & penanda U12 sebelum UPDATE", () => {
  const fn = badan(KODE, "tarikRekeningKoran");

  it("🔴 predikat HoF sebelum koneksi; FOR UPDATE sebelum UPDATE; audit sebelum COMMIT", () => {
    expect(fn).not.toBe("");
    expect(urutan(fn, "canTarikRekeningKoran(", "pool.connect()")).toBe("ok");
    expect(urutan(fn, "FOR UPDATE", "UPDATE app.rekening_koran")).toBe("ok");
    expect(urutan(fn, "UPDATE app.rekening_koran", "INSERT INTO app.audit_log")).toBe("ok");
    expect(urutan(fn, "INSERT INTO app.audit_log", 'client.query("COMMIT")')).toBe("ok");
  });

  it("🔴 U12: bulan tertutup diperiksa (kunci bersama → baca) SESUDAH kunci rekening koran & SEBELUM UPDATE, dan menolak", () => {
    expect(urutan(fn, "FOR UPDATE", "bulanTertutupTerkunci(client, unit.unit_id, [rk.periode])")).toBe("ok");
    expect(urutan(fn, "bulanTertutupTerkunci(", "UPDATE app.rekening_koran")).toBe("ok");
    expect(fn).toMatch(/if \(tertutup\.length > 0\) \{\s*await batal\(client\);\s*return \{\s*ok: false/);
  });

  it("🔴 U10: kelompok cocok AKTIF diperiksa SESUDAH kunci & SEBELUM UPDATE, dan menolak (return)", () => {
    expect(urutan(fn, "FOR UPDATE", "FROM app.cocok_bank_baris")).toBe("ok");
    expect(urutan(fn, "FROM app.cocok_bank_baris", "UPDATE app.rekening_koran")).toBe("ok");
    expect(fn).toMatch(/AND b\.aktif/);
    expect(fn).toMatch(/if \(nCocok > 0\) \{\s*await batal\(client\);\s*return \{\s*ok: false/);
  });
});

describe("unggahRekeningKoran — cocok otomatis SESUDAH impor COMMIT (U10)", () => {
  const fn = badan(KODE, "unggahRekeningKoran");
  it("🔴 dijalankan sesudah COMMIT impor, hasilnya ikut dilaporkan", () => {
    expect(urutan(fn, 'client.query("COMMIT")', "cocokSesudahUnggah(client")).toBe("ok");
    expect(fn).toMatch(/cocok,\s*\};/);
  });
  it("gagalnya tak membatalkan impor: dibungkus try/catch sendiri, transaksi sendiri", () => {
    const f = KODE.slice(KODE.indexOf("async function cocokSesudahUnggah"), KODE.indexOf("export async function unggahRekeningKoran"));
    expect(f).toMatch(/try \{\s*await client\.query\("BEGIN"\)/);
    expect(f).toMatch(/catch \(e\) \{\s*await batal\(client\);\s*return \{\s*status: "gagal"/);
  });
});

describe("berkas aksi", () => {
  it("🔴 KTD6: hanya rekening_koran, mutasi_bank, audit_log yang ditulis — TIDAK cash_ledger; tanpa DELETE", () => {
    expect(KODE).not.toMatch(/DELETE FROM/i);
    expect(KODE_TULIS).not.toMatch(/DELETE FROM|cash_ledger/i);
    const tulis = [...(KODE + KODE_TULIS).matchAll(/(INSERT INTO|UPDATE) (app\.\w+)/g)].map((m) => m[2]);
    expect(new Set(tulis)).toEqual(new Set(["app.rekening_koran", "app.mutasi_bank", "app.audit_log"]));
    expect(KODE).not.toMatch(/UPDATE app\.mutasi_bank/);
  });

  it("set_config transaction-local di kedua aksi + transaksi cocok sesudah unggah", () => {
    expect([...KODE.matchAll(/set_config\('app\.unit_ids', \$1, true\)/g)]).toHaveLength(3);
  });
});
