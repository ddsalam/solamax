import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BARIS_UKUR_RE,
  PENULIS,
  catatKueri,
  catatPernyataan,
  ukur,
} from "./ukur-kueri";

/**
 * ⛔ ALAT UKUR TUNDUK PADA ATURAN YANG SAMA: ujinya harus menguji KELAS CACAT
 * yang melahirkannya, bukan cuma bentuk keluarannya.
 *
 * Kelas cacat itu ada lima, dan tiap `it` di bawah menamai satu:
 *  A. angka yang DITAKSIR lalu dikutip di banyak tempat  → penghitung harus benar-benar menghitung
 *  B. kueri logis dicampur round-trip                    → dua penghitung, dan `qScoped` = 4 pernyataan
 *  C. alat ukur menjatuhkan yang diukur                  → penulis melempar, `ukur` tetap utuh
 *  D. data ikut keluar ke log                            → label himpunan tertutup + regex ketat
 *  E. ongkos render GAGAL tak terlihat                   → baris tetap ditulis saat `fn` melempar
 */

let baris: string[] = [];
const asli = PENULIS.tulis;

beforeEach(() => {
  baris = [];
  PENULIS.tulis = (b) => baris.push(b);
});
afterEach(() => {
  PENULIS.tulis = asli;
});

function ukuran(b: string): { kueri: number; pernyataan: number; ms: number } {
  const m = /kueri=(\d+) pernyataan=(\d+) ms=(\d+)/.exec(b);
  if (m === null) throw new Error(`baris tak terbaca: ${b}`);
  return { kueri: Number(m[1]), pernyataan: Number(m[2]), ms: Number(m[3]) };
}

describe("ukur-kueri — alat ukur ongkos", () => {
  it("A. menghitung yang SUNGGUH terjadi, dan DAYA-BEDANYA nyata (0 vs 3)", async () => {
    // Kasus kontrol: di LUAR skop, mencatat tak boleh menghasilkan apa pun.
    catatKueri();
    catatKueri();
    expect(baris).toEqual([]);

    await ukur("bahan-laporan", async () => {
      catatKueri();
      catatKueri();
      catatKueri();
    });
    expect(baris).toHaveLength(1);
    expect(ukuran(baris[0]!).kueri).toBe(3); // ← merah bila penghitungnya tetap/ditaksir
  });

  it("A′. hitungan mengikuti data: 7 panggilan → 7, bukan angka tetap", async () => {
    await ukur("bahan-laporan", async () => {
      for (let i = 0; i < 7; i++) catatKueri();
    });
    expect(ukuran(baris[0]!).kueri).toBe(7);
  });

  it("B. kueri LOGIS dan ROUND-TRIP dihitung terpisah", async () => {
    await ukur("bahan-laporan", async () => {
      catatKueri();
      catatPernyataan();
      catatPernyataan();
      catatPernyataan();
      catatPernyataan();
    });
    const u = ukuran(baris[0]!);
    expect(u.kueri).toBe(1);
    expect(u.pernyataan).toBe(4); // pola qScoped: BEGIN·set_config·kueri·COMMIT
    expect(u.kueri).not.toBe(u.pernyataan); // ← inilah pencampuran yang dilarang
  });

  it("B′. skop bersarang: induk menjumlahkan anaknya, anak tetap melaporkan dirinya", async () => {
    await ukur("papan", async () => {
      catatKueri(); // milik papan sendiri
      await ukur("bahan-laporan", async () => {
        catatKueri();
        catatKueri();
      });
      await ukur("bahan-laporan", async () => {
        catatKueri();
      });
    });
    expect(baris).toHaveLength(3);
    const anak = baris.filter((b) => b.includes("bahan-laporan")).map((b) => ukuran(b).kueri);
    expect(anak).toEqual([2, 1]);
    const papan = baris.find((b) => b.includes("] papan "))!;
    expect(ukuran(papan).kueri).toBe(4); // 1 + 2 + 1 — bukan 1
  });

  it("B″. skop paralel tak saling mencuri hitungan", async () => {
    await Promise.all([
      ukur("bahan-laporan", async () => {
        await new Promise((r) => setTimeout(r, 5));
        catatKueri();
      }),
      ukur("bahan-laporan", async () => {
        catatKueri();
        catatKueri();
        catatKueri();
      }),
    ]);
    expect(baris.map((b) => ukuran(b).kueri).sort()).toEqual([1, 3]);
  });

  it("C. penulis yang MELEMPAR tidak menjatuhkan yang diukur", async () => {
    PENULIS.tulis = () => {
      throw new Error("log rusak");
    };
    await expect(ukur("papan", async () => "hasil")).resolves.toBe("hasil");
  });

  it("C′. nilai & galat `fn` lewat apa adanya", async () => {
    await expect(ukur("papan", async () => 42)).resolves.toBe(42);
    await expect(ukur("papan", async () => Promise.reject(new Error("boom")))).rejects.toThrow(
      "boom",
    );
  });

  it("D. label di luar himpunan TIDAK lolos apa adanya — ia jadi 'lain'", async () => {
    // Pemanggil JS (tanpa type-check) menyelipkan nama unit + nominal.
    await ukur("Bakau 73.867.616" as never, async () => {});
    expect(baris[0]).not.toContain("Bakau");
    expect(baris[0]).not.toContain("73");
    expect(baris[0]).toContain("] lain ");
  });

  it("D′. bentuk baris ketat: hanya label, jumlah, dan durasi", async () => {
    await ukur("papan", async () => {
      catatKueri();
      catatPernyataan();
    });
    expect(baris[0]).toMatch(BARIS_UKUR_RE);
    // Regex-nya sendiri harus bisa MENOLAK — kalau tidak, ia bukan penjaga.
    expect("[ukur] papan kueri=1 pernyataan=1 ms=5 unit=Bakau").not.toMatch(BARIS_UKUR_RE);
    expect("[ukur] papan kueri=1 pernyataan=1 ms=5 total=73867616").not.toMatch(BARIS_UKUR_RE);
  });

  it("E. ongkos render GAGAL tetap tercatat", async () => {
    await expect(
      ukur("bahan-laporan", async () => {
        catatKueri();
        catatKueri();
        throw new Error("gagal render");
      }),
    ).rejects.toThrow("gagal render");
    expect(baris).toHaveLength(1);
    expect(ukuran(baris[0]!).kueri).toBe(2);
  });

  it("wall-clock benar-benar diukur, bukan nol tetap", async () => {
    await ukur("papan", async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(ukuran(baris[0]!).ms).toBeGreaterThanOrEqual(25);
    expect(ukuran(baris[0]!).ms).toBeLessThan(5_000);
  });
});

/**
 * PEMASANGANNYA di `db.ts` — bukan cuma alatnya. Penghitung yang benar tetapi
 * tak pernah dipanggil adalah persis "hijau tanpa subjek".
 */
describe("pemasangan di db.ts", () => {
  it("q() dan qScoped() benar-benar menaikkan penghitung (pg di-mock)", async () => {
    vi.resetModules();
    process.env.DATABASE_URL = "postgres://palsu@127.0.0.1:1/palsu";
    const dieksekusi: string[] = [];
    vi.doMock("pg", () => {
      class Pool {
        async query(text: string) {
          dieksekusi.push(text);
          return { rows: [] };
        }
        async connect() {
          return {
            query: async (text: string) => {
              dieksekusi.push(text);
              return { rows: [] };
            },
            release: () => {},
          };
        }
      }
      return { Pool };
    });
    const alat = await import("./ukur-kueri");
    const db = await import("./db");
    const tercatat: string[] = [];
    const simpan = alat.PENULIS.tulis;
    alat.PENULIS.tulis = (b) => tercatat.push(b);
    try {
      await alat.ukur("papan", async () => {
        await db.q("SELECT 1");
        await db.qScoped(1, "SELECT 2");
      });
    } finally {
      alat.PENULIS.tulis = simpan;
      vi.doUnmock("pg");
      vi.resetModules();
    }
    const m = /kueri=(\d+) pernyataan=(\d+)/.exec(tercatat[0]!)!;
    expect(Number(m[1])).toBe(2); // q + qScoped
    // 1 (q) + 4 (BEGIN·set_config·kueri·COMMIT) — cocok dengan yang SUNGGUH jalan
    expect(Number(m[2])).toBe(5);
    expect(dieksekusi).toHaveLength(5);
  });
});
