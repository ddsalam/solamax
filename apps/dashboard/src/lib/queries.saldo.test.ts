import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScopedUnitId } from "./scope-rule";

/**
 * KUNCI SEMANTIK Saldo Piutang/Hutang (blok RECAP Laporan Operasional).
 *
 * Ketiga aturan di bawah TERBUKTI vs oracle EasyMax "DAFTAR SALDO HUTANG PIUTANG"
 * unit 28 Oktober (63781002), 2–4 Agustus 2026, 9/9 sel eksak — lihat
 * session-notes/2026-08-05-saldo-hutang-piutang-28oktober.md.
 *
 * Test ini ada karena TIGA regresi spesifik pernah/hampir terjadi:
 *   1. batas `<=` ditukar jadi `<`   → seluruh baris bergeser satu hari;
 *   2. Online difilter `sjenis = 3`  → pelanggan bertitik ber-SJENIS lain hilang
 *      (HERWIN 21.999.0014, SJENIS 4 — bug produksi nyata, kurang Rp36.084/hari);
 *   3. Lokal lupa mengecualikan kode bertitik → pelanggan Online ikut terhitung
 *      dua kali (di 28 Oktober kebetulan nol, di unit lain belum tentu).
 *
 * Diskriminator Lokal/Online adalah FORMAT KODE (ada/tidaknya titik), BUKAN
 * SJENIS — dua sumbu terpisah. Itu sebabnya aturan satu-sumbu tak pernah benar.
 */
const { q, qScoped } = vi.hoisted(() => {
  const q = vi.fn((_text: string, _params?: unknown[]) => Promise.resolve([] as unknown[]));
  const qScoped = vi.fn((_unit: unknown, text: string, params?: unknown[]) => q(text, params));
  return { q, qScoped };
});
vi.mock("./db", () => ({ q, qScoped, pool: {} }));

const { getSaldoPelanggan } = await import("./queries");

const U = 7 as unknown as ScopedUnitId;
const DATE = "2026-08-04";

/** SQL yang benar-benar dikirim, dengan spasi dinormalkan agar assertion stabil. */
async function saldoSql(): Promise<string> {
  await getSaldoPelanggan(U, DATE);
  const [sql] = q.mock.calls[0]!;
  return sql.replace(/\s+/g, " ");
}

describe("getSaldoPelanggan — batas tanggal", () => {
  beforeEach(() => q.mockClear());

  // CATATAN: assertion di bawah sengaja PER-TABEL dan ber-hitungan. Versi
  // pertama test ini hanya `toContain("dtgl <= $2::date")` — dan LOLOS ketika
  // batas di CTE `piut` ditukar jadi `<`, karena CTE `hut` masih memuat pola
  // yang sama. Satu baris diedit, test tetap hijau. Itu bukan pagar.
  it("batas CTE = akhir hari (<=) di KEDUA tabel, bukan salah satu", async () => {
    const sql = await saldoSql();
    expect(sql).toContain("b.dtgl <= $2::date");
    expect(sql).toContain("h.dtgl <= $2::date");
    // `<` hanya boleh muncul di subselect "awal" (tanpa prefiks tabel).
    expect(sql).not.toMatch(/b\.dtgl <(?!=)/);
    expect(sql).not.toMatch(/h\.dtgl <(?!=)/);
  });

  it("tepat TIGA subselect 'awal' berpredikat `dtgl < $2` — satu per baris saldo", async () => {
    const sql = await saldoSql();
    expect(sql.match(/(?<!\.)dtgl < \$2::date/g)).toHaveLength(3);
  });

  it("mengembalikan enam angka: tiga baris × dua batas", async () => {
    const sql = await saldoSql();
    for (const alias of [
      "awalPiutangLokal",
      "akhirPiutangLokal",
      "awalPiutangOnline",
      "akhirPiutangOnline",
      "awalHutangLokal",
      "akhirHutangLokal",
    ]) {
      expect(sql).toContain(`"${alias}"`);
    }
  });

  it("saldo AKHIR tidak boleh berpredikat tanggal di dalam agregatnya", async () => {
    // Batas akhir hari sudah dijamin oleh CTE (`dtgl <= $2`); menambahkan predikat
    // lagi di subselect "akhir" adalah cara paling mudah menyelundupkan `<`.
    const sql = await saldoSql();
    expect(sql).toContain("SELECT sum(v) FROM piut WHERE lokal AND NOT dotted)");
    expect(sql).toContain("SELECT sum(v) FROM piut WHERE dotted)");
    expect(sql).toContain("SELECT sum(v) FROM hut)");
  });
});

describe("getSaldoPelanggan — bucket Lokal vs Online", () => {
  beforeEach(() => q.mockClear());

  // Ber-hitungan, bukan sekadar "ada". Versi pertama test ini LOLOS ketika
  // `NOT dotted` dihapus dari subselect "awal", sebab subselect "akhir" masih
  // memuat polanya. Kedua batas wajib dijaga terpisah.
  it("Lokal = SJENIS {1,5} DAN kode TANPA titik — di KEDUA batas", async () => {
    const sql = await saldoSql();
    // `lokal` = baris yang cocok ke master ber-SJENIS {1,5} (prafilter di join).
    expect(sql.match(/WHERE lokal AND NOT dotted/g)).toHaveLength(2);
    // SJENIS hanya boleh muncul SEKALI, yaitu sbg prafilter sisi master.
    expect(sql.match(/sjenis IN \(1,5\)/g)).toHaveLength(1);
    expect(sql).toMatch(
      /FROM public\.pelanggan_master\s+WHERE unit_id = \$1 AND sjenis IN \(1,5\)/,
    );
    // `lokal` HARUS berasal dari kecocokan master, bukan konstanta.
    expect(sql).toContain("(m.ckdplg IS NOT NULL) AS lokal");
  });

  it("Online = kode BERTITIK, TANPA filter SJENIS — di KEDUA batas", async () => {
    const sql = await saldoSql();
    expect(sql.match(/WHERE dotted(?! AND sjenis)/g)).toHaveLength(2);
    // Regresi #2: `sjenis = 3` tak boleh muncul di mana pun lagi.
    expect(sql).not.toMatch(/sjenis\s*=\s*3/);
  });

  it("'bertitik' dideteksi dari kode ter-trim, bukan dari SJENIS atau prefiks PLG", async () => {
    const sql = await saldoSql();
    expect(sql).toContain("position('.' in trim(b.ckdplg)) > 0");
    // char(12) dipadding spasi → tanpa trim, deteksi & join sama-sama meleset.
    expect(sql).not.toContain("LIKE 'PLG");
  });

  it("Hutang = SELURUH bphut, tanpa filter SJENIS maupun format kode", async () => {
    const sql = await saldoSql();
    // HANYA badan CTE `hut` — dari "hut AS (" sampai ") SELECT" penutupnya.
    const from = sql.indexOf("hut AS (");
    const hut = sql.slice(from, sql.indexOf(") SELECT", from));
    expect(hut).toContain("public.bphut");
    expect(hut).toContain("h.sjnsbp"); // kontrol: potongannya memang berisi badan CTE
    expect(hut).not.toContain("sjenis IN");
    expect(hut).not.toContain("dotted");
  });
});

describe("getSaldoPelanggan — pagar struktural", () => {
  beforeEach(() => q.mockClear());

  it("LEFT JOIN ke master: baris Online tak boleh bergantung pada master", async () => {
    // INNER JOIN akan membuang pelanggan bertitik yang belum ada di master —
    // hilang senyap dari Online, tanpa jejak apa pun.
    const sql = await saldoSql();
    expect(sql).toMatch(/LEFT JOIN \(SELECT unit_id, ckdplg FROM public\.pelanggan_master/);
    expect(sql).not.toMatch(/(?<!LEFT )JOIN \(?SELECT unit_id, ckdplg FROM public\.pelanggan_master/);
    expect(sql).not.toContain("INNER JOIN");
  });

  it("non-batal + ter-scope unit di kedua tabel", async () => {
    await getSaldoPelanggan(U, DATE);
    const [sql, params] = q.mock.calls[0]!;
    expect(sql).toMatch(/COALESCE\(b\.sbatal,0\) = 0/);
    expect(sql).toMatch(/COALESCE\(h\.sbatal,0\) = 0/);
    expect(sql).toContain("b.unit_id = $1");
    expect(sql).toContain("h.unit_id = $1");
    expect(params).toEqual([U, DATE]);
  });

  it("memindai tiap tabel SEKALI (CTE), bukan sekali per baris saldo", async () => {
    // Bentuk lama memindai bppiut dua kali (Lokal + Online terpisah). Kembali ke
    // sana = regresi biaya yang tak terlihat di angka mana pun.
    const sql = await saldoSql();
    expect(sql.match(/FROM public\.bppiut/g)).toHaveLength(1);
    expect(sql.match(/FROM public\.bphut/g)).toHaveLength(1);
  });

  it("bentuk kembalian: dua trio berlabel awal/akhir", async () => {
    q.mockResolvedValueOnce([
      {
        awalPiutangLokal: 12_033_038_039,
        akhirPiutangLokal: 12_117_420_938,
        awalPiutangOnline: 10_796_518,
        akhirPiutangOnline: 10_796_518,
        awalHutangLokal: 149_332_330,
        akhirHutangLokal: 140_919_652,
      },
    ]);
    await expect(getSaldoPelanggan(U, "2026-08-03")).resolves.toEqual({
      awal: {
        piutangLokal: 12_033_038_039,
        piutangOnline: 10_796_518,
        hutangLokal: 149_332_330,
      },
      akhir: {
        piutangLokal: 12_117_420_938,
        piutangOnline: 10_796_518,
        hutangLokal: 140_919_652,
      },
    });
  });

  it("baris kosong → nol-semua di kedua batas (bukan undefined)", async () => {
    q.mockResolvedValueOnce([]);
    const out = await getSaldoPelanggan(U, DATE);
    expect(out.awal).toEqual({ piutangLokal: 0, piutangOnline: 0, hutangLokal: 0 });
    expect(out.akhir).toEqual({ piutangLokal: 0, piutangOnline: 0, hutangLokal: 0 });
  });
});
