import { describe, expect, it } from "vitest";
import { TAGIHAN_FILTERS } from "./tagihan-model";
import {
  TAGIHAN_TAMPILAN,
  isTampilanFaktur,
  normalizeTagihanView,
  parseKodeFaktur,
  periodeLunasBawaan,
  tagihanBukaHref,
  tagihanExportHref,
  tagihanFakturHref,
  tagihanFilterHref,
  tagihanKesegaranLabel,
  tagihanListHref,
  tagihanPageHref,
  tagihanPelangganHref,
  tagihanRingkasanHref,
  tagihanTampilanHref,
  tagihanTampilanLabel,
  tagihanTerminHref,
  tagihanViewInput,
  validTagihanExportInput,
} from "./tagihan-route";

const HARI_INI = "2026-11-13";
const BAWAAN = { from: "2026-10-01", to: "2026-11-30" };

describe("tampilan & periode", () => {
  it("tampilan = lima saringan model + belum ditagihkan, masing-masing berlabel", () => {
    expect(TAGIHAN_TAMPILAN).toEqual([...TAGIHAN_FILTERS, "belum_ditagihkan"]);
    expect(TAGIHAN_TAMPILAN.map(tagihanTampilanLabel)).toEqual([
      "Perlu tindakan", "Lewat jatuh tempo", "Sebagian", "Lebih bayar", "Lunas", "Belum ditagihkan",
    ]);
    expect(TAGIHAN_TAMPILAN.filter(isTampilanFaktur)).toEqual([...TAGIHAN_FILTERS]);
  });

  it("periode lunas bawaan = bulan berjalan dan bulan sebelumnya (WIB)", () => {
    expect(periodeLunasBawaan(HARI_INI)).toEqual(BAWAAN);
    // Lintas tahun dan bulan pendek.
    expect(periodeLunasBawaan("2027-01-05")).toEqual({ from: "2026-12-01", to: "2027-01-31" });
    expect(periodeLunasBawaan("2028-03-31")).toEqual({ from: "2028-02-01", to: "2028-03-31" });
    expect(periodeLunasBawaan("2028-02-10")).toEqual({ from: "2028-01-01", to: "2028-02-29" });
  });
});

describe("normalizeTagihanView — halaman menormalkan ke bawaan", () => {
  it("tanpa parameter: perlu tindakan, halaman 1, periode bawaan", () => {
    expect(normalizeTagihanView(tagihanViewInput({}), HARI_INI)).toEqual({
      tampilan: "perlu_tindakan", search: "", page: 1, periode: BAWAAN, periodeBawaan: true, buka: null,
    });
  });

  it("parameter sah dipakai; larik mengambil nilai pertama; pencarian dipangkas", () => {
    const view = normalizeTagihanView(tagihanViewInput({
      filter: ["lunas", "sebagian"], q: "  PT Contoh ", page: "3", from: "2026-08-01", to: "2026-08-31", buka: " UJI/01 ",
    }), HARI_INI);
    expect(view).toEqual({
      tampilan: "lunas", search: "PT Contoh", page: 3,
      periode: { from: "2026-08-01", to: "2026-08-31" }, periodeBawaan: false, buka: "UJI/01",
    });
  });

  it("nilai tak dikenal jatuh ke bawaan: saringan, halaman, periode terbalik / tak nyata / separuh", () => {
    for (const params of [
      { filter: "semua", page: "0" },
      { filter: "", page: "-2" },
      { page: "dua", from: "2026-11-30", to: "2026-11-01" },
      { from: "2026-02-30", to: "2026-03-01" },
      { from: "2026-08-01" },
    ]) {
      expect(normalizeTagihanView(tagihanViewInput(params), HARI_INI)).toMatchObject({
        tampilan: "perlu_tindakan", page: 1, periode: BAWAAN, periodeBawaan: true,
      });
    }
  });
});

describe("validTagihanExportInput — ekspor MENOLAK, tidak menormalkan", () => {
  const sah = (qs: string) => validTagihanExportInput(new URLSearchParams(qs), HARI_INI);

  it("absen = bawaan; nilai sah diterima", () => {
    expect(sah("")).toEqual({
      tampilan: "perlu_tindakan", search: "", page: 1, periode: BAWAAN, periodeBawaan: true, buka: null,
    });
    expect(sah("filter=lunas&q=contoh&from=2026-08-01&to=2026-08-31")).toMatchObject({
      tampilan: "lunas", search: "contoh", periode: { from: "2026-08-01", to: "2026-08-31" }, periodeBawaan: false,
    });
    expect(sah("filter=belum_ditagihkan")).toMatchObject({ tampilan: "belum_ditagihkan" });
  });

  it("saringan tak dikenal, halaman tak sah, periode tak sah atau separuh = null", () => {
    for (const qs of [
      "filter=semua", "filter=", "page=0", "page=x",
      "from=2026-11-30&to=2026-11-01", "from=2026-02-30&to=2026-03-01", "from=2026-08-01", "to=2026-08-31",
    ]) {
      expect(sah(qs), qs).toBeNull();
    }
  });
});

describe("pembuat tautan", () => {
  const view = normalizeTagihanView({ filter: "lunas", search: "PT Contoh & Rekan", from: "2026-08-01", to: "2026-08-31" }, HARI_INI);
  const bawaan = normalizeTagihanView({ filter: "lewat_jatuh_tempo" }, HARI_INI);

  it("daftar, tampilan, termin, ringkasan — kode unit di-encode", () => {
    expect(tagihanListHref("64.781.11")).toBe("/keuangan/unit/64.781.11/tagihan");
    expect(tagihanListHref("UJI 01")).toBe("/keuangan/unit/UJI%2001/tagihan");
    expect(tagihanTampilanHref("6478111", "belum_ditagihkan")).toBe("/keuangan/unit/6478111/tagihan?filter=belum_ditagihkan");
    expect(tagihanTerminHref("6478111")).toBe("/keuangan/unit/6478111/tagihan/termin");
    expect(tagihanRingkasanHref()).toBe("/keuangan/tagihan");
  });

  it("ganti saringan: pencarian dipertahankan, halaman dilepas; periode hanya ikut ke Lunas dan hanya bila bukan bawaan", () => {
    expect(tagihanFilterHref("6478111", view, "sebagian"))
      .toBe("/keuangan/unit/6478111/tagihan?filter=sebagian&q=PT+Contoh+%26+Rekan");
    expect(tagihanFilterHref("6478111", view, "lunas"))
      .toBe("/keuangan/unit/6478111/tagihan?filter=lunas&q=PT+Contoh+%26+Rekan&from=2026-08-01&to=2026-08-31");
    expect(tagihanFilterHref("6478111", bawaan, "lunas")).toBe("/keuangan/unit/6478111/tagihan?filter=lunas");
  });

  it("halaman: halaman 1 tak ditulis", () => {
    expect(tagihanPageHref("6478111", bawaan, 1)).toBe("/keuangan/unit/6478111/tagihan?filter=lewat_jatuh_tempo");
    expect(tagihanPageHref("6478111", bawaan, 3)).toBe("/keuangan/unit/6478111/tagihan?filter=lewat_jatuh_tempo&page=3");
  });

  it("tautan yang dibuat terbaca kembali menjadi tampilan yang sama", () => {
    const href = tagihanPageHref("6478111", view, 2);
    const params = Object.fromEntries(new URL(href, "http://x").searchParams);
    expect(normalizeTagihanView(tagihanViewInput(params), HARI_INI)).toEqual({ ...view, page: 2 });
  });

  it("buka/tutup kelompok belum ditagihkan — kode bergaris miring & bertitik aman", () => {
    expect(tagihanBukaHref("6478111", bawaan, " NOL/02 "))
      .toBe("/keuangan/unit/6478111/tagihan?filter=belum_ditagihkan&buka=NOL%2F02");
    expect(tagihanBukaHref("6478111", bawaan, null)).toBe("/keuangan/unit/6478111/tagihan?filter=belum_ditagihkan");
    const params = Object.fromEntries(new URL(tagihanBukaHref("6478111", bawaan, "9.1.2"), "http://x").searchParams);
    expect(normalizeTagihanView(tagihanViewInput(params), HARI_INI)).toMatchObject({ tampilan: "belum_ditagihkan", buka: "9.1.2" });
  });

  it("rincian faktur & segmen kodenya", () => {
    expect(tagihanFakturHref("6478111", " TG-UJI/001 ")).toBe("/keuangan/unit/6478111/tagihan/faktur/TG-UJI%2F001");
    expect(parseKodeFaktur("TG-UJI%2F001")).toBe("TG-UJI/001");
    expect(parseKodeFaktur("TG-UJI/001")).toBe("TG-UJI/001");
    expect(parseKodeFaktur(["TG-UJI", "001"])).toBe("TG-UJI/001");
    expect(parseKodeFaktur(" TG001 ")).toBe("TG001");
    // Persen literal yang bukan escape sah: bentuk mentah dipakai.
    expect(parseKodeFaktur("TG%ZZ")).toBe("TG%ZZ");
    expect(parseKodeFaktur("   ")).toBeNull();
    expect(parseKodeFaktur("X".repeat(16))).toBeNull();
  });

  it("ekspor CSV ada di rute API dan membawa saringan aktif — lolos validasi ekspor", () => {
    const href = tagihanExportHref("6478111", view);
    expect(href).toBe("/api/keuangan/unit/6478111/tagihan/csv?filter=lunas&q=PT+Contoh+%26+Rekan&from=2026-08-01&to=2026-08-31");
    expect(validTagihanExportInput(new URL(href, "http://x").searchParams, HARI_INI)).toEqual(view);
  });

  it("halaman pelanggan yang sudah ada", () => {
    expect(tagihanPelangganHref("6478111", "2026-11-12", " NOL/02 "))
      .toBe("/keuangan/unit/6478111/piutang/2026-11-12/pelanggan/NOL%2F02");
  });

  it("baris kesegaran menyebut waktu WIB", () => {
    expect(tagihanKesegaranLabel("2026-11-13T02:00:00Z")).toMatch(/^Data EasyMax terakhir masuk 13 November 2026.*09[.:]00 WIB$/);
  });
});
