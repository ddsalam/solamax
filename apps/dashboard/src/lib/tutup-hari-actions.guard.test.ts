import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { urutan } from "./penjaga-urutan";

/**
 * Penjaga TEKS atas `tutup-hari-actions.ts` (Layar 4) — permukaan tulis yang
 * paling mahal kalau salah: penutupan MENGUNCI `manual_entry` terhadap void.
 */
const baca = (f: string): string =>
  readFileSync(resolve(__dirname, f), "utf8")
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"));
    })
    .join("\n")
    .replace(/--.*$/gm, "");

const KODE = baca("tutup-hari-actions.ts");
const PANEL = baca("../components/keuangan/TutupHariPanel.tsx");
const HAL = baca("../app/(app)/keuangan/unit/[code]/tutup-hari/[date]/page.tsx");

describe("tutup-hari-actions — penjagaan yang tak boleh hilang", () => {
  it("penjaga ini punya SUBJEK", () => {
    expect(KODE).toMatch(/export async function tutupHari/);
  });

  it("🔴 SELISIH dibaca ulang di server — tidak pernah dari client", () => {
    // Kalau selisih boleh dikirim browser, SELURUH tangga §3.2 bisa dilewati
    // dengan mengirim 0.
    const masukan = KODE.slice(
      KODE.indexOf("export interface TutupHariInput"),
      KODE.indexOf("}", KODE.indexOf("export interface TutupHariInput")) + 1,
    );
    expect(masukan).toMatch(/reasonCode/);
    expect(masukan).not.toMatch(/difference|selisih/i);
    expect(KODE).toMatch(/const differenceRp = Number\(row\.differenceRp\)/);
  });

  it("🔴 AMBANG tidak disalin — satu tempat yang memutuskan", () => {
    // Menyalin ambang berarti layar, aksi, dan laporan bisa menjawab berbeda
    // untuk pertanyaan yang sama.
    expect(KODE).toMatch(/periksaTutupHari\(/);
    // 🔴 Bukan hanya DIPANGGIL — hasilnya harus MENOLAK. Uji mutasi: menghapus
    // blok `if (!hasil.boleh)` meninggalkan `const hasil = …` yang tetap cocok
    // dengan asersi di atas, jadi penjaga hijau sementara tangga §3.2 mati
    // total. Kelas yang sama sudah muncul di keempat aksi Layar 3.
    expect(KODE).toMatch(/if \(!hasil\.boleh\) \{/);
    expect(KODE).toMatch(/return \{ ok: false, error: pesanKurang\(hasil\.kurang\)/);
    expect(KODE).toMatch(/tierFor\(differenceRp\)/);
    for (const src of [KODE, PANEL]) {
      expect(src).not.toMatch(/10_?000\b|100_?000\b/);
    }
    // Panel memakai konstanta bersama, bukan angka.
    expect(PANEL).toMatch(/TOLERANSI_RP/);
    expect(PANEL).toMatch(/BATAS_HOF_RP/);
  });

  it("🔴 requires_target_date dibaca dari MASTER, bukan dari nama kodenya", () => {
    expect(KODE).toMatch(/FROM app\.reason_code/);
    expect(KODE).not.toMatch(/CLS-INVESTIGATING/);
    expect(PANEL).not.toMatch(/CLS-INVESTIGATING/);
  });

  it("FOR UPDATE + status='open' — dua penutup tak menutup dua kali", () => {
    expect(KODE).toMatch(/FOR UPDATE/);
    expect(KODE).toMatch(/AND status='open'/);
  });

  it("hari tanpa baris penilaian TIDAK bisa ditutup", () => {
    // Menutup hari yang belum dinilai adalah menutup mata, bukan menutup buku.
    expect(KODE).toMatch(/belum punya baris penilaian/);
  });

  it("RLS di-set sebelum DML, dan tak ada DELETE", () => {
    expect(urutan(KODE, "set_config('app.unit_ids'", "UPDATE app.day_close")).toBe("ok");
    expect(KODE).not.toMatch(/DELETE FROM/i);
  });

  it("🔴 wewenang dihitung DI SERVER, layar hanya menerima hasilnya", () => {
    // Kesimpulan klien bisa dibuat benar dengan mengubah state di peramban.
    expect(HAL).toMatch(/bolehMenutup\(tierFor\(/);
    expect(PANEL).toMatch(/bolehMenutupTier: boolean/);
    // Panel TIDAK memanggil predikat wewenang sendiri.
    expect(PANEL).not.toMatch(/canCloseException|canOverrideAboveMax|bolehMenutup\(/);
  });

  it("gerbang BACA §10.13 dipakai dan penolakannya terjadi", () => {
    expect(HAL).toMatch(/if \(!canViewLaporanKeuangan\([^)]*\)\) notFound\(\)/);
  });

  it("kumulatif yang belum tersedia DISEBUT, bukan disembunyikan", () => {
    expect(PANEL).toMatch(/LANGKAH HARIAN/);
    expect(PANEL).toMatch(/kumulatif belum tersedia|kumulatif/);
  });
});

describe("§10.15 — baris day_close lahir saat halaman dibuka", () => {
  it("penjaga ini punya SUBJEK", () => {
    expect(KODE).toMatch(/export async function pastikanBarisDayClose/);
    expect(HAL).toMatch(/await pastikanBarisDayClose\(/);
  });

  it("🔴 BARIS TERTUTUP TIDAK PERNAH DISENTUH", () => {
    // `WHERE app.day_close.status = 'open'` pada ON CONFLICT bukan optimasi;
    // ia yang mencegah hitung ulang menulis ulang sejarah. Selisih yang sudah
    // disetujui seseorang tak boleh berubah tanpa ia tahu.
    const ins = KODE.slice(KODE.indexOf("INSERT INTO app.day_close"));
    expect(ins).toMatch(/ON CONFLICT \(unit_id, business_date\) DO UPDATE/);
    expect(ins).toMatch(/WHERE app\.day_close\.status = 'open'/);
  });

  it("🔴 langkah null ⇒ TIDAK menulis apa pun — nol bukan 'belum terhitung'", () => {
    const fn = KODE.slice(
      KODE.indexOf("export async function pastikanBarisDayClose"),
      KODE.indexOf("const client = await pool.connect()", KODE.indexOf("pastikanBarisDayClose")),
    );
    expect(fn).toMatch(/if \(langkahHarian === null\) return;/);
  });

  it("🔴 unitId ber-BRAND ScopedUnitId, bukan number mentah", () => {
    // Melonggarkan tanda-tipe SELALU lolos type-check — tak ada pemanggil yang
    // pecah, jadi tak ada tes perilaku yang bisa menangkapnya. Yang menjaganya
    // hanya asersi ini, dan seluruh lapis tipe repo ini berdiri di atas janji
    // "lupa men-scope = error type-check".
    expect(KODE).toMatch(/unitId: ScopedUnitId,/);
    expect(KODE).not.toMatch(/unitId: number,/);
  });

  it("tier ditulis dari tierFor, bukan dari nilai bebas", () => {
    expect(KODE).toMatch(/const tier = tierFor\(langkahHarian\)/);
  });

  it("kegagalan pembuatan baris TIDAK menjatuhkan halaman", () => {
    // Gerbangnya masih bisa dibaca, dan `tutupHari` menolak sendiri bila
    // barisnya tak ada — jadi gagal di sini tak boleh jadi layar error.
    const fn = KODE.slice(KODE.indexOf("export async function pastikanBarisDayClose"));
    expect(fn).toMatch(/catch \{/);
    expect(fn).not.toMatch(/throw /);
  });
});

describe("§10.16 — Cash Flow Check TIDAK memblokir penutupan", () => {
  it("🔴 aturan penutupan tidak menyebut cash flow sama sekali", async () => {
    // Diuji pada ATURANNYA, bukan pada layarnya: kalau kelak ia disambungkan
    // diam-diam, baris ini merah sebelum ada yang melihat layarnya.
    const aturan = readFileSync(resolve(__dirname, "keuangan-tutup-hari.ts"), "utf8");
    const kode = aturan
      .split("\n")
      .filter((l) => {
        const t = l.trim();
        return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"));
      })
      .join("\n");
    expect(kode).not.toMatch(/cashFlow|CashFlow|arus/i);
  });

  it("🔴 PERILAKU: cash flow check bukan-nol tidak menghalangi penutupan", async () => {
    // Uji perilaku, bukan teks — tiga putaran terakhir menunjukkan penjaga teks
    // kalah oleh sintaks alternatif.
    const { periksaTutupHari } = await import("./keuangan-tutup-hari");
    const hasil = periksaTutupHari(
      { differenceRp: 0, reasonCode: null, reasonRequiresTarget: null, targetDate: null },
      { role: "keuangan", email: null },
      { sudahDisetujui: false },
    );
    // Tak ada parameter cash flow sama sekali di kontraknya — dan hasilnya
    // BOLEH meski arusnya (di layar) sedang tidak nol.
    expect(hasil.boleh).toBe(true);
  });

  it("aksi tutup hari tidak membaca cash flow", () => {
    expect(KODE).not.toMatch(/cashFlow/i);
  });

  it("syarat yang MEMBANGUNKANNYA tertulis — 'nanti' punya bentuk", () => {
    // Spasi diratakan lebih dulu: kalimat dokumen dibungkus baris, dan asersi
    // yang tak meratakannya akan merah karena PEMBUNGKUSAN, bukan karena isinya
    // hilang — penjaga yang merah karena sebab yang salah sama tak bergunanya
    // dengan penjaga yang hijau karena sebab yang salah.
    const doc = readFileSync(resolve(__dirname, "../../KEUANGAN-HARIAN.md"), "utf8").replace(/\s+/g, " ");
    expect(doc).toMatch(/SYARAT YANG MEMBANGUNKANNYA/);
    expect(doc).toMatch(/konsisten nol selama sekian minggu berjalan/);
  });
});
