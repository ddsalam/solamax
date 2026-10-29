import type { PenebusanTampil } from "@/lib/penebusan-queries";
import { rekapPajak } from "@/lib/penebusan-model";
import { senKeTeks } from "@/lib/antar-unit-model";
import { susunCsv } from "./csv";
import { safeSpreadsheetText } from "./piutang";

/**
 * CSV rekap pajak penebusan per bulan (rencana 2026-10-29 U7; R13).
 *
 * ⛔ ISINYA SENGAJA SEMPIT: SO, tanggal bayar, unit, produk/volume EasyMax, dan
 * komponen. **Tanpa keterangan bank dan tanpa nama rekening** — berkas ini
 * dikirim ke konsultan pajak, bukan ke pemeriksa rekening koran.
 *
 * Angka ditulis sebagai teks numerik sen ("100000000.00"), tak pernah lewat
 * float; produk/volume yang belum tertaut ditulis "belum tertaut", bukan sel
 * kosong (sel kosong dibaca Excel sebagai nol — `csv.ts` aturan 1).
 */
export function penebusanCsv(input: {
  judulCakupan: string;
  ptLabel: string;
  bulan: string;
  rows: readonly PenebusanTampil[];
  generatedLabel: string;
  generatedBy: string;
}): string {
  const t = rekapPajak(input.rows.map((r) => ({ ...r })));
  const text = safeSpreadsheetText;
  const rows: string[][] = [
    ["Laporan", "Rekap Pajak Penebusan SO"],
    ["PT", text(input.ptLabel)],
    ["Cakupan", text(input.judulCakupan)],
    ["Bulan", input.bulan],
    ["Dibuat", text(input.generatedLabel)],
    ["Dicetak oleh", text(input.generatedBy)],
    [
      "Catatan",
      "Komponen pajak dicatat terpisah; HPP tetap Harga Gross ÷ liter. Perlakuan PPN masukan & PPh 22 " +
        "diputuskan konsultan pajak. Nota bertanda: debet +, kredit −.",
    ],
    [],
    ["Ringkasan", "Jumlah SO", "Harga Net", "PPN", "PPh", "PBBKB", "Nota Debet/Kredit", "Harga Gross"],
    [
      "Total",
      String(t.n),
      senKeTeks(t.netSen),
      senKeTeks(t.ppnSen),
      senKeTeks(t.pphSen),
      senKeTeks(t.pbbkbSen),
      senKeTeks(t.notaSen),
      senKeTeks(t.grossSen),
    ],
    [],
    [
      "Kode unit",
      "Nomor SO",
      "Tanggal bayar",
      "Produk (EasyMax)",
      "Volume (L)",
      "Harga Net",
      "PPN",
      "PPh",
      "PBBKB",
      "Nota Debet/Kredit",
      "Harga Gross",
    ],
    ...input.rows.map((r) => [
      text(r.unitCode),
      text(r.noSo),
      r.tanggalBayar,
      r.tertaut ? text(r.produk ?? "—") : "belum tertaut",
      r.tertaut && r.volume !== null ? String(r.volume) : "belum tertaut",
      senKeTeks(r.netSen),
      senKeTeks(r.ppnSen),
      senKeTeks(r.pphSen),
      senKeTeks(r.pbbkbSen),
      senKeTeks(r.notaSen),
      senKeTeks(r.grossSen),
    ]),
  ];
  return susunCsv(rows);
}
