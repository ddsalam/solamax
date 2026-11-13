import { describe, expect, it } from "vitest";
import { compareTagihanRows, matchesTagihanFilter, TAGIHAN_FILTERS } from "@/lib/tagihan-model";
import type { BelumDitagihkanDokumen } from "@/lib/tagihan-queries";
import { CONTOH, CONTOH_HARI_INI, CONTOH_UNIT, contohBaris } from "@/components/keuangan/TagihanContoh";
import {
  TAGIHAN_CSV_KOLOM_DOKUMEN,
  TAGIHAN_CSV_KOLOM_FAKTUR,
  barisDokumenCsv,
  barisFakturCsv,
  belumDitagihkanCsv,
  tagihanCsv,
  type TagihanCsvKepala,
} from "./tagihan";

/** Semua nilai ilustratif. */
const kepala = (o: Partial<TagihanCsvKepala> = {}): TagihanCsvKepala => ({
  unit: CONTOH_UNIT,
  ptLabel: "PT Contoh",
  tampilanLabel: "Perlu tindakan",
  cari: "",
  hariIni: CONTOH_HARI_INI,
  kesegaranLabel: "Data EasyMax terakhir masuk 13 November 2026 pukul 09.00 WIB",
  generatedLabel: "13 November 2026 pukul 10.00 WIB",
  generatedBy: "keuangan@example.com",
  terpotong: false,
  ...o,
});

const semua = [
  CONTOH.lewat(), CONTOH.sebagianLewat(), CONTOH.belumJatuhTempo(), CONTOH.terminBelumDiatur(),
  CONTOH.lunas(), CONTOH.lebihBayar(), CONTOH.bedaEasymax(), CONTOH.jtTakWajar(),
];

/** Pengurai CSV kecil (RFC 4180) — cukup untuk membaca balik keluaran `susunCsv`. */
function urai(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let sel = "";
  let kutip = false;
  const isi = csv.replace(/^﻿/, "");
  for (let i = 0; i < isi.length; i++) {
    const c = isi[i]!;
    if (kutip) {
      if (c === '"' && isi[i + 1] === '"') { sel += '"'; i++; }
      else if (c === '"') kutip = false;
      else sel += c;
    } else if (c === '"') kutip = true;
    else if (c === ",") { row.push(sel); sel = ""; }
    else if (c === "\r" && isi[i + 1] === "\n") { row.push(sel); rows.push(row); row = []; sel = ""; i++; }
    else sel += c;
  }
  return rows;
}

/** Baris data = segala sesuatu sesudah baris judul kolom. */
function dataSesudah(csv: string, kolom: readonly string[]): string[][] {
  const rows = urai(csv);
  const i = rows.findIndex((r) => r.join("|") === kolom.join("|"));
  expect(i, "baris judul kolom tidak ditemukan").toBeGreaterThan(-1);
  return rows.slice(i + 1);
}

describe("tagihanCsv — saringan faktur", () => {
  it.each(TAGIHAN_FILTERS)("🔴 %s: baris CSV = baris saringan itu, urutan sama", (filter) => {
    const baris = semua.filter((b) => matchesTagihanFilter(b.status, filter)).sort(compareTagihanRows);
    const data = dataSesudah(
      tagihanCsv({ ...kepala(), periodeLunas: null, baris }),
      TAGIHAN_CSV_KOLOM_FAKTUR,
    );
    expect(data.map((r) => r[4])).toEqual(baris.map((b) => b.faktur.kode));
    expect(data).toEqual(baris.map((b) => barisFakturCsv(CONTOH_UNIT, b)));
    for (const r of data) expect(r).toHaveLength(TAGIHAN_CSV_KOLOM_FAKTUR.length);
  });

  it("saringan yang berbeda menghasilkan himpunan baris yang berbeda (daya-beda)", () => {
    const kode = (filter: (typeof TAGIHAN_FILTERS)[number]) => dataSesudah(
      tagihanCsv({ ...kepala(), periodeLunas: null, baris: semua.filter((b) => matchesTagihanFilter(b.status, filter)) }),
      TAGIHAN_CSV_KOLOM_FAKTUR,
    ).map((r) => r[4]);
    expect(kode("lunas")).toEqual(["TG-0005"]);
    expect(kode("lebih_bayar")).toEqual(["TG-0006"]);
    expect(kode("perlu_tindakan")).not.toContain("TG-0005");
    expect(kode("perlu_tindakan")).toHaveLength(7);
  });

  it("isi satu baris: angka tanpa pemisah ribuan, status dari model, penanda ya/tidak", () => {
    const r = barisFakturCsv(CONTOH_UNIT, CONTOH.sebagianLewat());
    const sel = Object.fromEntries(TAGIHAN_CSV_KOLOM_FAKTUR.map((k, i) => [k, r[i]]));
    expect(sel).toMatchObject({
      "Kode unit": "6400001",
      "Kode pelanggan": "P-002",
      "Nama pelanggan": "CV Mitra Contoh",
      "No. faktur": "TG-0002",
      "Tanggal faktur": "2026-10-29",
      "Jatuh tempo": "2026-11-12",
      "Sumber jatuh tempo": "dari EasyMax",
      "Nilai": "10000000",
      "Dibayar": "4000000",
      "Sisa": "6000000",
      "Status bayar": "Sebagian",
      "Status jatuh tempo": "Lewat 1 hari",
      "Hari lewat": "1",
      "Beda status dengan EasyMax": "tidak",
      "Beda sisa dengan EasyMax": "tidak",
      "Jatuh tempo EasyMax tak wajar": "tidak",
    });
  });

  it("penanda dan lebih bayar terbawa: beda EasyMax = ya, sisa negatif, termin belum diatur disebut", () => {
    const beda = barisFakturCsv(CONTOH_UNIT, CONTOH.bedaEasymax());
    expect(beda[15]).toBe("ya");
    expect(beda[16]).toBe("ya");
    expect(barisFakturCsv(CONTOH_UNIT, CONTOH.jtTakWajar())[17]).toBe("ya");
    expect(barisFakturCsv(CONTOH_UNIT, CONTOH.lebihBayar())[10]).toBe("-50000");
    const tanpaTermin = barisFakturCsv(CONTOH_UNIT, CONTOH.terminBelumDiatur());
    expect(tanpaTermin[6]).toBe("belum diatur");
    expect(tanpaTermin[12]).toBe("Termin belum diatur");
  });

  it("🔴 nilai faktur kosong: penandanya di sel Nilai, sisa bukan angka nol, dan tak menambah total sisa", () => {
    const r = barisFakturCsv(CONTOH_UNIT, CONTOH.nilaiKosong());
    const sel = Object.fromEntries(TAGIHAN_CSV_KOLOM_FAKTUR.map((k, i) => [k, r[i]]));
    expect(sel).toMatchObject({ "No. faktur": "TG-0009", "Nilai": "nilai faktur kosong", "Sisa": "—", "Status bayar": "Belum dibayar" });
    expect(r.every((isi) => isi !== "")).toBe(true);
    const kepalaCsv = (baris: Parameters<typeof tagihanCsv>[0]["baris"]) =>
      Object.fromEntries(urai(tagihanCsv({ ...kepala(), periodeLunas: null, baris })).slice(0, 14).map((b) => [b[0], b[1]]));
    const tanpa = kepalaCsv([CONTOH.lewat()]);
    const dengan = kepalaCsv([CONTOH.lewat(), CONTOH.nilaiKosong()]);
    expect([tanpa["Jumlah faktur"], dengan["Jumlah faktur"]]).toEqual(["1", "2"]);
    expect(dengan["Total sisa"]).toBe(tanpa["Total sisa"]);
  });

  it("🔴 tak ada sel kosong di baris data (Excel membaca sel kosong sebagai nol)", () => {
    const csv = tagihanCsv({
      ...kepala(), periodeLunas: null,
      baris: [...semua, contohBaris({ kode: "TG-0099", nama: null, sisaEasymax: null, statusEasymax: null })],
    });
    for (const r of dataSesudah(csv, TAGIHAN_CSV_KOLOM_FAKTUR)) {
      for (const sel of r) expect(sel.trim()).not.toBe("");
    }
  });

  it("teks dari EasyMax yang berbentuk rumus dinetralkan", () => {
    const r = barisFakturCsv(CONTOH_UNIT, contohBaris({ kode: "TG-0100", nama: '=HYPERLINK("x")', keterangan: "+62 kontak" }));
    expect(r[3]).toBe(`'=HYPERLINK("x")`);
    expect(r[20]).toBe("'+62 kontak");
  });

  it("kepala: saringan, pencarian, periode pelunasan, kesegaran, dan jumlah/total barisnya", () => {
    const baris = [CONTOH.lewat(), CONTOH.sebagianLewat()];
    const rows = urai(tagihanCsv({
      ...kepala({ tampilanLabel: "Lunas", cari: "mitra" }),
      periodeLunas: { from: "2026-10-01", to: "2026-11-30" },
      baris,
    }));
    const meta = new Map(rows.filter((r) => r.length === 2).map((r) => [r[0], r[1]]));
    expect(meta.get("Laporan")).toBe("Tagihan pelanggan");
    expect(meta.get("Saringan")).toBe("Lunas");
    expect(meta.get("Pencarian pelanggan")).toBe("mitra");
    expect(meta.get("Periode pelunasan")).toBe("2026-10-01 s.d. 2026-11-30");
    expect(meta.get("Status dihitung per")).toBe(CONTOH_HARI_INI);
    expect(meta.get("Kesegaran data")).toContain("Data EasyMax terakhir masuk");
    expect(meta.get("Jumlah faktur")).toBe("2");
    expect(meta.get("Total sisa")).toBe("16000000");
    expect(meta.get("Kelengkapan")).toBe("lengkap");
    // Bukan saringan Lunas: baris periode tidak ada.
    const tanpa = urai(tagihanCsv({ ...kepala(), periodeLunas: null, baris }));
    expect(tanpa.some((r) => r[0] === "Periode pelunasan")).toBe(false);
    expect(new Map(tanpa.filter((r) => r.length === 2).map((r) => [r[0], r[1]])).get("Pencarian pelanggan"))
      .toBe("tanpa pencarian");
  });

  it("🔴 terpotong ditulis di berkas, bukan disembunyikan", () => {
    const rows = urai(tagihanCsv({ ...kepala({ terpotong: true }), periodeLunas: null, baris: [] }));
    expect(rows.find((r) => r[0] === "Kelengkapan")?.[1]).toMatch(/^TERPOTONG/);
  });

  it("BOM UTF-8 dan CRLF, seperti ekspor CSV lain", () => {
    const csv = tagihanCsv({ ...kepala(), periodeLunas: null, baris: [CONTOH.lewat()] });
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv.endsWith("\r\n")).toBe(true);
  });
});

describe("belumDitagihkanCsv — daftar dokumen", () => {
  const dokumen: BelumDitagihkanDokumen[] = [
    { customerCode: "P-001", namaPelanggan: "PT Pelanggan Contoh", kodeDokumen: "JP-000101", tanggal: "2026-11-03", jumlah: 750_000.4, keterangan: "Penjualan, kredit" },
    { customerCode: "21.7", namaPelanggan: null, kodeDokumen: "UV-000007", tanggal: "2026-11-08", jumlah: 500_000, keterangan: null },
  ];

  it("🔴 satu baris per dokumen, urutan sama, koma di keterangan tidak memecah kolom", () => {
    const data = dataSesudah(
      belumDitagihkanCsv({ ...kepala({ tampilanLabel: "Belum ditagihkan" }), dokumen }),
      TAGIHAN_CSV_KOLOM_DOKUMEN,
    );
    expect(data).toEqual(dokumen.map((d) => barisDokumenCsv(CONTOH_UNIT, d)));
    expect(data).toEqual([
      ["6400001", "SPBU Contoh", "P-001", "PT Pelanggan Contoh", "JP-000101", "2026-11-03", "750000", "Penjualan, kredit"],
      ["6400001", "SPBU Contoh", "21.7", "Nama belum tersedia", "UV-000007", "2026-11-08", "500000", "—"],
    ]);
  });

  it("kepala menyebut jumlah dokumen dan totalnya", () => {
    const rows = urai(belumDitagihkanCsv({ ...kepala({ tampilanLabel: "Belum ditagihkan" }), dokumen }));
    const meta = new Map(rows.filter((r) => r.length === 2).map((r) => [r[0], r[1]]));
    expect(meta.get("Saringan")).toBe("Belum ditagihkan");
    expect(meta.get("Jumlah dokumen")).toBe("2");
    expect(meta.get("Total")).toBe("1250000");
  });
});
