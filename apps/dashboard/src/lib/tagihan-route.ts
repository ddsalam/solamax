import { addMonthsClamped, isValidIsoDate, monthInfo, monthStart } from "./periods";
import { formatWib } from "./piutang-route";
import { TAGIHAN_FILTERS, isTagihanFilter, type TagihanFilter } from "./tagihan-model";

/**
 * Masukan tampilan & pembuat tautan layar Tagihan pelanggan (rencana
 * 2026-11-13 U6; R8, R21). Murni — tanpa I/O — mengikuti `piutang-route.ts`:
 * halaman MENORMALKAN nilai tak dikenal ke bawaan, ekspor MENOLAKNYA.
 *
 * Parameter kueri: `filter`, `q`, `page`, `from`, `to`, `buka`.
 */

/** Saringan S1: lima saringan status model + kelompok "Belum ditagihkan" (S3). */
export const TAGIHAN_TAMPILAN = [...TAGIHAN_FILTERS, "belum_ditagihkan"] as const;
export type TagihanTampilan = (typeof TAGIHAN_TAMPILAN)[number];
export const TAGIHAN_TAMPILAN_DEFAULT: TagihanTampilan = "perlu_tindakan";

export function isTagihanTampilan(value: unknown): value is TagihanTampilan {
  return typeof value === "string" && TAGIHAN_TAMPILAN.some((candidate) => candidate === value);
}

/** `true` = tampilan ini dilayani saringan status model (`getTagihanDaftar`), bukan S3. */
export function isTampilanFaktur(tampilan: TagihanTampilan): tampilan is TagihanFilter {
  return isTagihanFilter(tampilan);
}

const TAMPILAN_LABEL: Record<TagihanTampilan, string> = {
  perlu_tindakan: "Perlu tindakan",
  lewat_jatuh_tempo: "Lewat jatuh tempo",
  sebagian: "Sebagian",
  lebih_bayar: "Lebih bayar",
  lunas: "Lunas",
  belum_ditagihkan: "Belum ditagihkan",
};

export function tagihanTampilanLabel(tampilan: TagihanTampilan): string {
  return TAMPILAN_LABEL[tampilan];
}

/** Rentang tanggal inklusif, "YYYY-MM-DD" — bentuk yang sama dengan `PeriodeTagihan`. */
export interface TagihanPeriode {
  from: string;
  to: string;
}

/**
 * Periode bawaan saringan Lunas: bulan kalender berjalan DAN bulan sebelumnya
 * (WIB) — tanggal 1 bulan lalu s.d. hari terakhir bulan ini.
 */
export function periodeLunasBawaan(hariIni: string): TagihanPeriode {
  const { daysInMonth } = monthInfo(hariIni);
  return {
    from: monthStart(addMonthsClamped(hariIni, -1)),
    to: `${hariIni.slice(0, 7)}-${String(daysInMonth).padStart(2, "0")}`,
  };
}

/** Masukan mentah dari URL; semuanya boleh absen. */
export interface TagihanViewInput {
  filter?: string | null;
  search?: string | null;
  page?: string | null;
  from?: string | null;
  to?: string | null;
  /** Kode pelanggan yang kelompoknya dibuka di S3. */
  buka?: string | null;
}

/** Tampilan yang sudah dinormalkan — inilah yang diserahkan ke kueri dan pembuat tautan. */
export interface TagihanView {
  tampilan: TagihanTampilan;
  /** Pencarian nama/kode pelanggan, sudah dipangkas; `""` = tanpa pencarian. */
  search: string;
  /** ≥ 1. Penjepitan ke halaman terakhir dilakukan `paginateTagihan`. */
  page: number;
  /** Periode pelunasan; hanya bermakna saat `tampilan === "lunas"`. */
  periode: TagihanPeriode;
  /** Periode itu adalah bawaan (tidak ditulis ke URL). */
  periodeBawaan: boolean;
  /** Kode pelanggan yang dibuka di S3; `null` = tak ada. */
  buka: string | null;
}

export function tagihanViewInput(params: Record<string, string | string[] | undefined>): TagihanViewInput {
  const one = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
  return {
    filter: one(params.filter), search: one(params.q), page: one(params.page),
    from: one(params.from), to: one(params.to), buka: one(params.buka),
  };
}

function parsePage(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return 1;
  if (!/^\d+$/.test(value.trim())) return null;
  const page = Number(value.trim());
  return Number.isSafeInteger(page) && page >= 1 ? page : null;
}

/** `null` = terisi tetapi tidak sah; `undefined` = keduanya absen (pakai bawaan). */
function parsePeriode(from: string | null | undefined, to: string | null | undefined): TagihanPeriode | null | undefined {
  const kosong = (v: string | null | undefined) => v === null || v === undefined || v === "";
  if (kosong(from) && kosong(to)) return undefined;
  if (!isValidIsoDate(from ?? undefined) || !isValidIsoDate(to ?? undefined)) return null;
  return from! <= to! ? { from: from!, to: to! } : null;
}

function susunView(
  tampilan: TagihanTampilan,
  input: TagihanViewInput,
  page: number,
  periode: TagihanPeriode | undefined,
  hariIni: string,
): TagihanView {
  const buka = input.buka?.trim() ?? "";
  return {
    tampilan,
    search: input.search?.trim() ?? "",
    page,
    periode: periode ?? periodeLunasBawaan(hariIni),
    periodeBawaan: periode === undefined,
    buka: buka === "" ? null : buka,
  };
}

/** Halaman: nilai tak dikenal jatuh ke bawaan, sama seperti layar saldo. */
export function normalizeTagihanView(input: TagihanViewInput, hariIni: string): TagihanView {
  return susunView(
    isTagihanTampilan(input.filter) ? input.filter : TAGIHAN_TAMPILAN_DEFAULT,
    input,
    parsePage(input.page) ?? 1,
    parsePeriode(input.from, input.to) ?? undefined,
    hariIni,
  );
}

/**
 * Ekspor: saringan tak dikenal, halaman atau periode yang terisi tetapi tidak
 * sah DITOLAK (`null`), tidak dinormalkan diam-diam. Absen tetap berarti bawaan.
 */
export function validTagihanExportInput(params: URLSearchParams, hariIni: string): TagihanView | null {
  const filter = params.get("filter");
  if (filter !== null && !isTagihanTampilan(filter)) return null;
  const page = parsePage(params.get("page"));
  if (page === null) return null;
  const periode = parsePeriode(params.get("from"), params.get("to"));
  if (periode === null) return null;
  return susunView(
    filter ?? TAGIHAN_TAMPILAN_DEFAULT,
    { search: params.get("q"), buka: params.get("buka") },
    page,
    periode,
    hariIni,
  );
}

type ViewTautan = Pick<TagihanView, "tampilan" | "search" | "periode" | "periodeBawaan">;

/** Parameter yang ikut ke setiap tautan daftar: saringan, pencarian, dan periode (hanya Lunas, hanya bila bukan bawaan). */
function viewParams(view: ViewTautan): URLSearchParams {
  const params = new URLSearchParams();
  params.set("filter", view.tampilan);
  if (view.search) params.set("q", view.search);
  if (view.tampilan === "lunas" && !view.periodeBawaan) {
    params.set("from", view.periode.from);
    params.set("to", view.periode.to);
  }
  return params;
}

const unitPath = (unitCode: string): string => `/keuangan/unit/${encodeURIComponent(unitCode)}/tagihan`;

/** S1 tanpa parameter — tampilan bawaan. */
export function tagihanListHref(unitCode: string): string {
  return unitPath(unitCode);
}

/** S1 dengan tampilan tertentu (untuk ubin S1 dan sel S5): tanpa pencarian, halaman 1. */
export function tagihanTampilanHref(unitCode: string, tampilan: TagihanTampilan): string {
  return `${unitPath(unitCode)}?filter=${tampilan}`;
}

/** Ganti saringan: pencarian dan periode dipertahankan, halaman & kelompok terbuka dilepas. */
export function tagihanFilterHref(unitCode: string, view: ViewTautan, tampilan: TagihanTampilan): string {
  return `${unitPath(unitCode)}?${viewParams({ ...view, tampilan })}`;
}

/** Pindah halaman dalam saringan yang sama. Halaman 1 tidak ditulis. */
export function tagihanPageHref(unitCode: string, view: ViewTautan, page: number): string {
  const params = viewParams(view);
  if (page > 1) params.set("page", String(page));
  return `${unitPath(unitCode)}?${params}`;
}

/** S3: buka (atau, dengan `null`, tutup) kelompok satu pelanggan. */
export function tagihanBukaHref(unitCode: string, view: ViewTautan, customerCode: string | null): string {
  const params = viewParams({ ...view, tampilan: "belum_ditagihkan" });
  const kode = customerCode?.trim() ?? "";
  if (kode !== "") params.set("buka", kode);
  return `${unitPath(unitCode)}?${params}`;
}

/** S2. Kode faktur satu segmen, di-encode (aman bila suatu unit memakai garis miring). */
export function tagihanFakturHref(unitCode: string, kodeFaktur: string): string {
  return `${unitPath(unitCode)}/faktur/${encodeURIComponent(kodeFaktur.trim())}`;
}

/**
 * Segmen `[kode]` → kode faktur. Menerima bentuk ter-encode maupun yang sudah
 * di-decode Next; `null` = kosong atau lebih panjang dari kolom cerminnya
 * (CHAR(15)) — pemanggil menjawab 404 tanpa menyentuh basis data.
 */
export function parseKodeFaktur(segment: string | string[]): string | null {
  const mentah = (Array.isArray(segment) ? segment.join("/") : segment).trim();
  let kode = mentah;
  try {
    kode = decodeURIComponent(mentah).trim();
  } catch {
    // Persen literal sah sesudah Next men-decode rute; bentuk mentah dipakai.
  }
  return kode === "" || kode.length > 15 ? null : kode;
}

/** S4. */
export function tagihanTerminHref(unitCode: string): string {
  return `${unitPath(unitCode)}/termin`;
}

/** S5. */
export function tagihanRingkasanHref(): string {
  return "/keuangan/tagihan";
}

/** Ekspor CSV saringan aktif — rute API, bukan di bawah `(app)/keuangan`. */
export function tagihanExportHref(unitCode: string, view: ViewTautan): string {
  return `/api/keuangan/unit/${encodeURIComponent(unitCode)}/tagihan/csv?${viewParams(view)}`;
}

/** Halaman pelanggan yang sudah ada (S6); `date` = tanggal Saldo pelanggan yang dibuka. */
export function tagihanPelangganHref(unitCode: string, date: string, customerCode: string): string {
  return `/keuangan/unit/${encodeURIComponent(unitCode)}/piutang/${date}/pelanggan/${encodeURIComponent(customerCode.trim())}`;
}

/** Baris kesegaran R22 dari `kesiapan.selesaiAt` (ISO UTC). */
export function tagihanKesegaranLabel(selesaiAt: string): string {
  return `Data EasyMax terakhir masuk ${formatWib(selesaiAt)}`;
}
