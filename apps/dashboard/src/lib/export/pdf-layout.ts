/**
 * Primitif tabel pdfmake bersama untuk SEMUA laporan (hindari duplikasi):
 * layout ledger (header navy + zebra aman-grayscale), layout header-saja, helper
 * sel header, dan lebar konten A4 potret/lanskap.
 */
import type { Content, ContentTable, CustomTableLayout, TableCell, TDocumentDefinitions } from "pdfmake/interfaces";
import { PDF } from "./pdf-tokens";

/** Lebar konten (pt): A4 595.28/841.89 − margin kiri+kanan 40+40. */
export const CONTENT_WIDTH_PORTRAIT = 515;
export const CONTENT_WIDTH_LANDSCAPE = 762;

/** Header navy, zebra abu-abu muda pada baris genap, garis tipis. */
export const ledgerLayout: CustomTableLayout = {
  fillColor: (rowIndex) => {
    if (rowIndex === 0) return PDF.navy; // header
    return rowIndex % 2 === 0 ? PDF.zebra : null; // zebra aman-grayscale
  },
  hLineWidth: () => 0.5,
  vLineWidth: () => 0,
  hLineColor: () => PDF.border,
  paddingTop: () => 3,
  paddingBottom: () => 3,
  paddingLeft: () => 5,
  paddingRight: () => 5,
};

/** Hanya header yang di-fill navy; baris lain tanpa zebra (untuk tabel ringkas). */
export const headerOnlyLayout: CustomTableLayout = {
  fillColor: (rowIndex) => (rowIndex === 0 ? PDF.navy : null),
  hLineWidth: () => 0.5,
  vLineWidth: () => 0,
  hLineColor: () => PDF.border,
  paddingTop: () => 3,
  paddingBottom: () => 3,
  paddingLeft: () => 5,
  paddingRight: () => 5,
};

/** Sel header tabel (teks putih tebal di atas fill navy). Dokumen WAJIB
 *  mendefinisikan gaya `th` — tanpanya teks jatuh ke warna default (hitam). */
export function th(text: string, alignment?: "right" | "center"): TableCell {
  return { text, style: "th", alignment };
}

const KEEP_ID = /^keep-\d+$/;

/** Salinan sel dengan id di simpul TEKS pertamanya (menembus stack/columns), atau
 *  null bila tak ada teks. Halaman simpul teks itu final; halaman kontainer
 *  (tabel, stack) bisa tentatif — terbukti di pdf-layout.reports.test (anomali). */
function markText(cell: unknown, id: string): TableCell | null {
  if (typeof cell === "string" || typeof cell === "number") return String(cell).trim() === "" ? null : { text: String(cell), id };
  if (typeof cell !== "object" || cell === null) return null;
  const o = cell as Record<string, unknown>;
  if ("text" in o) return String(o.text).trim() === "" ? null : ({ ...o, id } as TableCell);
  for (const key of ["stack", "columns"] as const) {
    const items = o[key];
    if (!Array.isArray(items)) continue;
    for (let k = 0; k < items.length; k++) {
      const marked = markText(items[k], id);
      if (marked) return { ...o, [key]: items.map((x, i) => (i === k ? marked : x)) } as TableCell;
    }
  }
  return null;
}

/** BARIS BADAN pertama dengan teks pertamanya ditandai id; null bila tabel tak
 *  punya baris/teks yang bisa ditandai (judulnya lalu tak dipasangkan — sel
 *  kosong/placeholder colSpan tak tercatat posisinya). */
function markFirstRow(body: TableCell[][], headerRows: number, id: string): TableCell[][] | null {
  if (body.length === 0) return null;
  const r = Math.min(headerRows, body.length - 1); // tabel header-saja: tandai baris terakhirnya
  const row = body[r] ?? [];
  for (let c = 0; c < row.length; c++) {
    const marked = markText(row[c], id);
    if (marked) return body.map((x, i) => (i === r ? x.map((y, k) => (k === c ? marked : y)) : x));
  }
  return null;
}

interface PageNode {
  id?: string;
  startPosition?: { pageNumber: number; top: number };
}

/**
 * Predikat `pageBreakBefore`: pindahkan judul `keep-i` bila baris badan pertama
 * tabelnya (`keep-i-row`) TIDAK mulai di halaman judul. Posisi `top` sel di blok
 * header+`keepWithHeaderRows` maupun simpul tabelnya TENTATIF (dicatat sebelum
 * blok dipindah), dan daftar "following/next" pdfmake masih memuat halaman
 * tentatif itu; yang final hanyalah `startPosition.pageNumber` sel penanda —
 * jadi itulah yang dibandingkan, tanpa ambang ruang (terbukti di
 * pdf-layout.test & pdf-layout.reports.test). Judul yang sudah di puncak halaman
 * tak dipindah (baris raksasa tak muat di mana pun; memindah hanya menambah
 * halaman kosong). Simpul tanpa id pasangan tak pernah dipindah.
 *
 * Arity WAJIB 4 (tanpa nilai default): pdfmake hanya mengisi `nodesOnNextPage` &
 * `previousNodesOnPage` bila `pageBreakBefore.length > 2`.
 */
export function orphanHeadingBreak(
  node: PageNode,
  followingNodesOnPage: PageNode[],
  nodesOnNextPage?: PageNode[],
  previousNodesOnPage?: PageNode[],
): boolean {
  if (typeof node.id !== "string" || !KEEP_ID.test(node.id) || !node.startPosition) return false;
  const { pageNumber, top } = node.startPosition;
  const row = [...followingNodesOnPage, ...(nodesOnNextPage ?? [])].find((n) => n.id === `${node.id}-row`);
  if (row?.startPosition?.pageNumber === pageNumber) return false;
  return (previousNodesOnPage ?? []).some((n) => n.startPosition?.pageNumber === pageNumber && n.startPosition.top < top);
}

type Point = { x: number; y: number };

/**
 * pdfmake menggeser titik `polyline` canvas DI TEMPAT saat tata letak (titik
 * sparkline board berpindah ke koordinat halaman). Setiap `pageBreakBefore` yang
 * mengembalikan true memicu tata letak ULANG atas docDefinition yang sama, yang
 * lalu mengukur titik yang sudah tergeser → grafik membengkak & melompat halaman
 * (akar judul "Evaluasi" yatim di board). Simpan titik asli; kembalikan sebelum
 * tata letak ulang.
 */
function polylineRestorer(content: Content[]): () => void {
  const saved: Array<[{ points: Point[] }, Point[]]> = [];
  const seen = new WeakSet<object>();
  const walk = (n: unknown): void => {
    if (typeof n !== "object" || n === null || seen.has(n)) return;
    seen.add(n);
    const o = n as Record<string, unknown>;
    if (o.type === "polyline" && Array.isArray(o.points)) {
      saved.push([o as { points: Point[] }, (o.points as Point[]).map((p) => ({ ...p }))]);
    }
    for (const v of Object.values(o)) walk(v);
  };
  walk(content);
  return () => {
    for (const [vector, points] of saved) vector.points = points.map((p) => ({ ...p }));
  };
}

/**
 * Judul seksi tak boleh yatim di dasar halaman (judul di satu halaman, tabelnya
 * di halaman berikut). Judul ditandai `headlineLevel: 1`; judul top-level
 * dipasangkan dengan TABEL top-level pertama sesudahnya (sebelum judul
 * berikutnya) lewat id `keep-i` / `keep-i-body` / `keep-i-row` (sel baris badan
 * pertama). Blok di antaranya (hint/catatan) ikut pindah. Hanya judul yang
 * dipindah: tabel tetap boleh terpecah antarhalaman dengan header berulang.
 * Hasilnya disebar ke docDefinition: `{ ...keepHeadingsWithTable(content), … }`.
 * Input tidak dimutasi.
 */
export function keepHeadingsWithTable(content: Content[]): {
  content: Content[];
  pageBreakBefore: NonNullable<TDocumentDefinitions["pageBreakBefore"]>;
} {
  const out = [...content];
  const isHeading = (n: Content) => typeof n === "object" && !Array.isArray(n) && "headlineLevel" in n && n.headlineLevel === 1;
  for (let i = 0; i < out.length; i++) {
    if (!isHeading(out[i]!)) continue;
    for (let j = i + 1; j < out.length && !isHeading(out[j]!); j++) {
      const node = out[j]!;
      if (typeof node === "object" && !Array.isArray(node) && "table" in node && node.table) {
        const t = (node as ContentTable).table;
        const body = markFirstRow(t.body, t.headerRows ?? 0, `keep-${i}-row`);
        if (body === null) break; // tabel kosong: tak ada baris untuk dijaga
        out[i] = { ...(out[i] as object), id: `keep-${i}` } as Content;
        out[j] = { ...(node as ContentTable), id: `keep-${i}-body`, table: { ...t, body } } as unknown as Content;
        break;
      }
    }
  }
  const restore = polylineRestorer(out);
  return {
    content: out,
    pageBreakBefore: (node, following, next, previous) => {
      const move = orphanHeadingBreak(node as PageNode, following as PageNode[], next as PageNode[], previous as PageNode[]);
      if (move) restore();
      return move;
    },
  };
}
