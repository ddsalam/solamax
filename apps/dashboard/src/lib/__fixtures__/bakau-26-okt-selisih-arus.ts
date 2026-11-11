import type { HariPiutang } from "../selisih-arus-kas-model";

/**
 * Bakau (unit 2), 26/29/30 Okt 2026 — angka NYATA dari diagnosis read-only
 * 11 Nov 2026 (`docs/plans/2026-11-11-2210-…-plan.md`, Lampiran).
 *
 * Nominal, tanggal, pelanggan dan id8 bank adalah angka nyata. Yang
 * DISINTESIS: sisa uuid sesudah id8, kode `ckdbppiut`, dan dua baris 29 Okt
 * yang tak dirinci diagnosis — 17.859.212 (pembayaran EasyMax untuk bank
 * 30 Okt) dan 21.846.472 (sisa hasil pengurangan, pasangan bank 21.849.700).
 * Rekening hanya 4 digit terakhir.
 */

export const CEK_26_OKT = -123_196_354;
export const CEK_29_OKT = 151_261_816;
export const CEK_30_OKT = -17_864_266.5;

export const HARI_BAKAU_OKT: HariPiutang[] = [
  {
    tanggal: "2026-10-26",
    easymax: [],
    bank: [
      {
        id: "a8b2f689-0000-4000-8000-000000000026",
        rekening: "Bank BCA …6811",
        tanggalAsal: null,
        keterangan: "LLG-BPD KALBAR … SP2D",
        rp: 123_196_000,
      },
    ],
  },
  {
    tanggal: "2026-10-29",
    easymax: [
      { kode: "BT-SINTETIS-01", pelanggan: "PLG0607", ref: null, keterangan: null, rp: 86_136_000 },
      { kode: "BT-SINTETIS-02", pelanggan: "PLG0609", ref: null, keterangan: null, rp: 26_849_200 },
      { kode: "BT-SINTETIS-03", pelanggan: "PLG0607", ref: null, keterangan: "SP2D (baris 228)", rp: 10_210_800 },
      { kode: "BT-SINTETIS-04", pelanggan: "PLG0607", ref: null, keterangan: "SP2D (baris 229)", rp: 10_210_800 },
      { kode: "BT-SINTETIS-05", pelanggan: "PLG-SINTETIS-A", ref: null, keterangan: null, rp: 17_859_212 },
      { kode: "BT-SINTETIS-06", pelanggan: "PLG-SINTETIS-B", ref: null, keterangan: null, rp: 21_846_472 },
    ],
    bank: [
      {
        id: "00000000-0000-4000-8000-000000000029",
        rekening: "Bank BPD Kalbar",
        tanggalAsal: null,
        keterangan: "Transfer piutang 29 Okt (sintetis)",
        rp: 21_849_700,
      },
    ],
  },
  {
    tanggal: "2026-10-30",
    easymax: [],
    bank: [
      {
        id: "d8abe42b-0000-4000-8000-000000000030",
        rekening: "Bank BPD Kalbar",
        tanggalAsal: null,
        keterangan: "BPD Kalbar",
        rp: 17_864_200,
      },
    ],
  },
];
