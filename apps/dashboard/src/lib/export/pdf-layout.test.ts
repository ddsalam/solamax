/**
 * Judul seksi yatim + kontras header tabel PDF. Lapis (1) murni. Lapis (2)
 * menata letak PDF SUNGGUHAN lewat pdfmake dan membaca halaman akhirnya (pola
 * harian-doc.test): bukti bahwa pdfmake benar-benar memindahkan judul, plus
 * kontrak pdfmake yang diandalkan penjaganya (bila versi pdfmake berubah dan
 * kontraknya patah, test di sini yang merah lebih dulu).
 */
import type { Content, ContentTable, TDocumentDefinitions } from "pdfmake/interfaces";
import pdfMakeImport from "pdfmake/build/pdfmake";
import vfsImport from "pdfmake/build/vfs_fonts";
import { describe, expect, it } from "vitest";
import { keepHeadingsWithTable, orphanHeadingBreak } from "./pdf-layout";
import { PDF } from "./pdf-tokens";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pdfMake: any = (pdfMakeImport as any).default ?? pdfMakeImport;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const vfsAny: any = (vfsImport as any).default ?? vfsImport;
pdfMake.vfs = vfsAny.pdfMake?.vfs ?? vfsAny.vfs ?? vfsAny;

/** WCAG 2.x contrast ratio between two #RRGGBB colours. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

type Node = Record<string, unknown>;
const heading = (text: string): Content => ({ text, headlineLevel: 1 });
const tableOf = (rows: string[], headerRows = 1): Content => ({
  table: { headerRows, keepWithHeaderRows: 1, dontBreakRows: true, body: [["KEPALA"], ...rows.map((r) => [r])] },
});
const bodyOf = (n: unknown) => (n as ContentTable).table.body;

describe("header tabel navy", () => {
  it("teks putih di atas navy lolos WCAG AA; teks default (hitam) tidak terbaca", () => {
    expect(contrast(PDF.onNavy, PDF.navy)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(PDF.textPrimary, PDF.navy)).toBeLessThan(2);
  });
});

describe("keepHeadingsWithTable — pemasangan", () => {
  it("memasangkan judul dengan tabel pertama sesudahnya, melewati hint, tanpa melewati judul berikut", () => {
    const input: Content[] = [
      { text: "pembuka" },
      heading("A"), { text: "hint A" }, tableOf(["a1"]),
      heading("B"), { text: "catatan tanpa tabel" },
      heading("C"), tableOf(["c1"]),
    ];
    const out = keepHeadingsWithTable(input).content as unknown as Node[];
    expect(out.map((n) => n.id)).toEqual([undefined, "keep-1", undefined, "keep-1-body",
      undefined, undefined, "keep-6", "keep-6-body"]);
    // Penanda di sel pertama baris BADAN pertama (sesudah headerRows), bukan di header.
    expect(bodyOf(out[3])[0]).toEqual(["KEPALA"]);
    expect(bodyOf(out[3])[1]).toEqual([{ text: "a1", id: "keep-1-row" }]);
    // Input tidak dimutasi (builder lain bisa memakai ulang simpulnya).
    expect((input[1] as unknown as Node).id).toBeUndefined();
    expect(bodyOf(input[3])[1]).toEqual(["a1"]);
  });

  it("penanda melewati sel kosong; sel objek mempertahankan gayanya", () => {
    const t: Content = { table: { headerRows: 2, body: [["H1", "H1b"], ["H2", "H2b"],
      ["", { text: "isi", bold: true, color: "#123456" }], ["x", "y"]] } };
    const out = keepHeadingsWithTable([heading("J"), t]).content as unknown as Node[];
    expect(bodyOf(out[1])[2]).toEqual(["", { text: "isi", bold: true, color: "#123456", id: "keep-0-row" }]);
    const stacked = keepHeadingsWithTable([heading("S"), { table: { headerRows: 1, body: [["H", "H2"],
      [{ stack: [{ text: "judul" }, { text: "rinci" }] }, "u"]] } }]).content as unknown as Node[];
    // Penanda di simpul TEKS dalam stack (halaman kontainer stack bisa tentatif).
    expect(bodyOf(stacked[1])[1]![0]).toEqual({ stack: [{ text: "judul", id: "keep-0-row" }, { text: "rinci" }] });
  });

  it("tabel kosong / tanpa sel berteks: judul tidak dipasangkan (tak pernah dipindah); tabel header-saja menandai headernya", () => {
    const empty = keepHeadingsWithTable([heading("E"), { table: { body: [] } }]).content as unknown as Node[];
    expect(empty.map((n) => n.id)).toEqual([undefined, undefined]);
    const blank = keepHeadingsWithTable([heading("K"), { table: { headerRows: 1, body: [["H"], ["", { text: " " }]] } }])
      .content as unknown as Node[];
    expect(blank.map((n) => n.id)).toEqual([undefined, undefined]);
    const headerOnly = keepHeadingsWithTable([heading("H"), { table: { headerRows: 1, body: [["KEPALA"]] } }])
      .content as unknown as Node[];
    expect(bodyOf(headerOnly[1])[0]).toEqual([{ text: "KEPALA", id: "keep-0-row" }]);
  });

  it("setiap judul (berpasangan atau tidak) atomik; isi lain & tabel tetap boleh pecah; input tak dimutasi", () => {
    const status: Content = { columns: [{ text: "Arus" }, { text: "belum final" }], headlineLevel: 1 };
    const input: Content[] = [status, { text: "catatan" }, tableOf(["r1", "r2"]), heading("Tanpa tabel")];
    const out = keepHeadingsWithTable(input).content as unknown as Node[];
    expect(out.map((n) => n.unbreakable)).toEqual([true, undefined, undefined, true]);
    expect((input[0] as unknown as Node).unbreakable).toBeUndefined();
  });

  it("judul `columns` berpasangan: teks pertamanya ditandai keep-i-head; judul teks tidak; input tak dimutasi", () => {
    const status: Content = { columns: [{ text: "" }, { text: "Arus", bold: true }, { text: "belum final" }], headlineLevel: 1 };
    const input: Content[] = [status, tableOf(["r1"]), heading("Teks"), tableOf(["t1"])];
    const out = keepHeadingsWithTable(input).content as unknown as Node[];
    expect(out[0]).toMatchObject({ id: "keep-0", unbreakable: true, headlineLevel: 1,
      columns: [{ text: "" }, { text: "Arus", bold: true, id: "keep-0-head" }, { text: "belum final" }] });
    expect(out[2]).toEqual({ text: "Teks", headlineLevel: 1, unbreakable: true, id: "keep-2" });
    expect((status as unknown as { columns: Node[] }).columns[1]!.id).toBeUndefined();
  });
});

describe("orphanHeadingBreak — predikat", () => {
  const h = { id: "keep-3", startPosition: { pageNumber: 2, top: 700 } };
  const row = (pageNumber: number) => ({ id: "keep-3-row", startPosition: { pageNumber, top: 730 } });
  const above = { id: "x", startPosition: { pageNumber: 2, top: 400 } };

  it("tetap di tempat bila baris badan pertama mulai di halaman judul", () => {
    expect(orphanHeadingBreak(h, [{ id: "x" }, row(2)], [], [above])).toBe(false);
  });
  it("pindah bila penanda berhalaman lain — walau pdfmake memasukkannya ke daftar 'following'", () => {
    expect(orphanHeadingBreak(h, [row(3)], [], [above])).toBe(true);
    expect(orphanHeadingBreak(h, [], [row(3)], [above])).toBe(true);
    expect(orphanHeadingBreak(h, [], [], [above])).toBe(true);
    expect(orphanHeadingBreak(h, [{ ...row(2), id: "keep-30-row" }], [], [above])).toBe(true);
  });
  it("judul di puncak halaman tak dipindah (hanya akan menambah halaman kosong)", () => {
    expect(orphanHeadingBreak(h, [row(3)], [], [])).toBe(false);
    expect(orphanHeadingBreak(h, [row(3)], [], [{ id: "root", startPosition: { pageNumber: 2, top: 700 } }])).toBe(false);
    expect(orphanHeadingBreak(h, [row(3)], [], [{ id: "prev", startPosition: { pageNumber: 1, top: 100 } }])).toBe(false);
  });
  it("halaman judul dibaca dari penanda teksnya (kontainer `columns` bisa melapor halaman lama)", () => {
    const stale = { id: "keep-3", startPosition: { pageNumber: 2, top: 787 } };
    const head = (pageNumber: number) => ({ id: "keep-3-head", startPosition: { pageNumber, top: 787 } });
    // Didorong utuh ke halaman 3 bersama barisnya: tetap.
    expect(orphanHeadingBreak(stale, [], [head(3), row(3)], [above])).toBe(false);
    // Kontrol: tanpa penanda, halaman lama kontainer → dipindah tanpa perlu.
    expect(orphanHeadingBreak(stale, [], [row(3)], [above])).toBe(true);
    // Penanda sehalaman dengan kontainer, baris di halaman berikut: yatim → pindah.
    expect(orphanHeadingBreak(stale, [head(2)], [row(3)], [above])).toBe(true);
    // Sudah di puncak halaman 3 (tak ada isi lain di halaman itu), baris di halaman 4: tetap.
    expect(orphanHeadingBreak(stale, [], [head(3)], [above])).toBe(false);
  });
  it("arity 4: pdfmake hanya mengisi daftar next/previous bila pageBreakBefore.length > 2", () => {
    expect(orphanHeadingBreak.length).toBe(4);
    expect(keepHeadingsWithTable([]).pageBreakBefore.length).toBe(4);
  });
  it("simpul lain (tanpa id pasangan, atau id milik pemakai lain) tak pernah dipindah", () => {
    expect(orphanHeadingBreak({}, [])).toBe(false);
    expect(orphanHeadingBreak({ id: "toc-1", startPosition: { pageNumber: 1, top: 9 } }, [], [], [above])).toBe(false);
    expect(orphanHeadingBreak({ id: "keep-3-body", startPosition: { pageNumber: 2, top: 9 } }, [], [], [above])).toBe(false);
  });
});

// ── pdfmake sungguhan ──

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pagesOf = (doc: TDocumentDefinitions): Promise<any[]> => new Promise((r) => pdfMake.createPdf(doc)._getPages({}, r));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const linesOf = (pages: any[]) => pages.flatMap((p, page) => p.items
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  .filter((x: any) => x.type === "line")
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  .map((x: any) => ({ page, y: x.item.y as number, text: x.item.inlines.map((i: any) => i.text).join("") as string })));
const pageOfText = (lines: { page: number; text: string }[], s: string) => lines.find((l) => l.text.includes(s))?.page ?? -1;
const BASE: Omit<TDocumentDefinitions, "content"> = { pageSize: "A4", pageMargins: [40, 40, 40, 44], defaultStyle: { font: "Roboto", fontSize: 10 } };
const filler = (n: number): Content[] => Array.from({ length: n }, (_, i) => ({ text: `isi ${i}` }));
/** Judul berstatus seperti laporan (sectionHeading): `columns` [judul 14 pt | status], marginTop 12. */
const colHeading = (text: string): Content =>
  ({ columns: [{ text, fontSize: 14 }, { text: "status", width: "auto" }], marginTop: 12, headlineLevel: 1 });
const lineOf = (lines: { page: number; y: number; text: string }[], s: string) => lines.find((l) => l.text === s);
/** Hasil keepHeadingsWithTable TANPA penanda teks judul (kontrol: perilaku sebelum keep-i-head). */
const unmarked = (content: Content[]): Content[] => (content as unknown as Node[]).map((n) => Array.isArray(n.columns)
  ? { ...n, columns: (n.columns as Node[]).map((c) => Object.fromEntries(Object.entries(c).filter(([key]) => key !== "id"))) } : n) as unknown as Content[];

describe("kontrak pdfmake yang diandalkan penjaga", () => {
  it("nomor halaman sel penanda baris pertama final; posisi tabel & top penanda tentatif", async () => {
    // Bukti dari probe fase 8: blok header+keepWithHeaderRows yang tak muat dipindah
    // SESUDAH tabel mencatat posisinya. Cari rentang isi tempat itu terjadi.
    let seen = 0;
    for (let lines = 55; lines <= 64; lines++) {
      const kept = keepHeadingsWithTable([...filler(lines), heading("JUDUL"), tableOf(["BARISSATU", "baris dua"])]);
      const log: Record<string, { pageNumber: number; top: number }> = {};
      const doc: TDocumentDefinitions = { ...BASE, content: kept.content,
        pageBreakBefore: (n) => {
          const id = (n as { id?: string }).id;
          if (id === "keep-" + lines || id === `keep-${lines}-body` || id === `keep-${lines}-row`) log[id] = n.startPosition as never;
          return false;
        } };
      const lns = linesOf(await pagesOf(doc));
      const rowPage = pageOfText(lns, "BARISSATU");
      expect(log[`keep-${lines}-row`]!.pageNumber - 1).toBe(rowPage);
      if (log[`keep-${lines}-body`]!.pageNumber - 1 !== rowPage) {
        seen++;
        // Tabel melapor halaman lama; top penanda = top tabel (bukan posisi barisnya).
        expect(log[`keep-${lines}-row`]!.top).toBe(log[`keep-${lines}-body`]!.top);
      }
    }
    expect(seen).toBeGreaterThan(0);
  }, 60_000);

  it("judul atomik `columns` yang didorong utuh: halaman kontainer tanpa penanda lama, halaman penanda teksnya final", async () => {
    let seen = 0;
    for (let lines = 55; lines <= 66; lines++) {
      const log = async (mark: boolean) => {
        const kept = keepHeadingsWithTable([...filler(lines), colHeading("JUDULKOLOM"), tableOf(["BARISSATU"])]);
        const pages: Record<string, number> = {};
        const doc: TDocumentDefinitions = { ...BASE, content: mark ? kept.content : unmarked(kept.content),
          pageBreakBefore: (n) => {
            const id = (n as { id?: string }).id;
            if (id === `keep-${lines}` || id === `keep-${lines}-head`) pages[id] = n.startPosition.pageNumber - 1;
            return false;
          } };
        return { pages, final: pageOfText(linesOf(await pagesOf(doc)), "JUDULKOLOM") };
      };
      const [marked, bare] = [await log(true), await log(false)];
      expect(marked.pages[`keep-${lines}-head`]).toBe(marked.final);
      expect(bare.final).toBe(marked.final);
      if (bare.pages[`keep-${lines}`] !== bare.final) seen++;
    }
    expect(seen).toBeGreaterThan(0);
  }, 60_000);

  it("titik polyline digeser DI TEMPAT oleh satu kali tata letak (sebab penjaga memulihkannya)", async () => {
    const pts = [{ x: 0, y: 30 }, { x: 50, y: 2 }];
    await pagesOf({ ...BASE, content: [...filler(5), { canvas: [{ type: "polyline", lineWidth: 1, points: pts }] }] });
    expect(pts[0]!.y).toBeGreaterThan(30);
  });
});

describe("PDF sungguhan (tata letak pdfmake)", () => {
  it("judul tak pernah tertinggal sendirian di dasar halaman; tanpa penjaga ia yatim", async () => {
    const orphans = { guarded: 0, unguarded: 0 };
    // Isi pengisi (±62 baris/halaman) mendorong judul melintasi dasar halaman pertama.
    for (let lines = 50; lines <= 66; lines++) {
      for (const guarded of [true, false]) {
        // Fresh nodes per render: pdfmake mutates the docDefinition it lays out.
        const content: Content[] = [...filler(lines), heading("JUDULSEKSI"), { text: "hint seksi" }, tableOf(["BARISSATU", "baris dua"])];
        const doc: TDocumentDefinitions = { ...BASE, ...(guarded ? keepHeadingsWithTable(content) : { content }) };
        const lns = linesOf(await pagesOf(doc));
        const [title, firstRow] = [pageOfText(lns, "JUDULSEKSI"), pageOfText(lns, "BARISSATU")];
        expect(title).toBeGreaterThanOrEqual(0);
        // Ruang lapang: penjaga tidak memindahkan judul tanpa perlu.
        if (lines <= 54) expect(title).toBe(0);
        if (title !== firstRow) orphans[guarded ? "guarded" : "unguarded"]++;
      }
    }
    expect(orphans.guarded).toBe(0);
    // Kontrol: rentang di atas memang memuat kasus yatim tanpa penjaga.
    expect(orphans.unguarded).toBeGreaterThan(0);
  }, 60_000);

  it("relayout tak merusak grafik polyline sebelum judul yang dipindah (kontrol tanpa pemulihan: rusak)", async () => {
    const build = (mode: "guarded" | "unguarded" | "noRestore", lines: number) => {
      const content: Content[] = [
        { text: "GRAFIKJUDUL" },
        { canvas: [{ type: "polyline", lineWidth: 1, points: [{ x: 0, y: 30 }, { x: 200, y: 2 }] }] },
        ...filler(lines), heading("JUDULSEKSI"), tableOf(["BARISSATU", "baris dua"]),
      ];
      const kept = keepHeadingsWithTable(content);
      return { ...BASE, ...(mode === "guarded" ? kept : mode === "noRestore"
        ? { content: kept.content, pageBreakBefore: orphanHeadingBreak } : { content }) } as TDocumentDefinitions;
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chart = (pages: any[]) => {
      const lns = linesOf(pages);
      const title = lns.find((l) => l.text === "GRAFIKJUDUL")!;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const poly = pages.flatMap((p, page) => p.items.filter((x: any) => x.item.type === "polyline").map((x: any) => ({ page, ys: x.item.points.map((q: any) => q.y) })))[0]!;
      return { page: poly.page - title.page, dy: Math.min(...poly.ys) - title.y };
    };
    let moved = 0;
    let corruptedWithoutRestore = 0;
    for (let lines = 50; lines <= 64; lines++) {
      const unguarded = await pagesOf(build("unguarded", lines));
      const guardedPages = await pagesOf(build("guarded", lines));
      const g = linesOf(guardedPages);
      expect(pageOfText(g, "JUDULSEKSI")).toBe(pageOfText(g, "BARISSATU"));
      // Judul dipindah ⇒ pdfmake menata letak ulang; grafiknya tetap persis di bawah judulnya.
      if (pageOfText(g, "JUDULSEKSI") > pageOfText(linesOf(unguarded), "JUDULSEKSI")) moved++;
      expect(chart(guardedPages)).toEqual(chart(unguarded));
      if (JSON.stringify(chart(await pagesOf(build("noRestore", lines)))) !== JSON.stringify(chart(unguarded))) corruptedWithoutRestore++;
    }
    expect(moved).toBeGreaterThan(0);
    expect(corruptedWithoutRestore).toBeGreaterThan(0);
  }, 60_000);

  it("judul `columns` yang sudah didorong utuh ke halaman barisnya tak dipindah lagi (kontrol tanpa penanda teks: dipindah)", async () => {
    let pushed = 0;
    let spurious = 0;
    for (let lines = 55; lines <= 66; lines++) {
      const content = (): Content[] => [...filler(lines), colHeading("JUDULKOLOM"), tableOf(["BARISSATU", "baris dua"])];
      const u = linesOf(await pagesOf({ ...BASE, content: content() }));
      const g = linesOf(await pagesOf({ ...BASE, ...keepHeadingsWithTable(content()) }));
      const k = keepHeadingsWithTable(content());
      const s = linesOf(await pagesOf({ ...BASE, content: unmarked(k.content), pageBreakBefore: k.pageBreakBefore }));
      expect(pageOfText(g, "JUDULKOLOM")).toBe(pageOfText(g, "BARISSATU"));
      if (pageOfText(u, "JUDULKOLOM") !== pageOfText(u, "BARISSATU")) continue;
      // Tanpa penjaga judul sudah sehalaman dengan barisnya: penjaga tak mengubah posisinya sama sekali.
      expect(lineOf(g, "JUDULKOLOM")).toEqual(lineOf(u, "JUDULKOLOM"));
      if (lineOf(u, `isi ${lines - 1}`)!.page < lineOf(u, "JUDULKOLOM")!.page) pushed++;
      if (JSON.stringify(lineOf(s, "JUDULKOLOM")) !== JSON.stringify(lineOf(u, "JUDULKOLOM"))) spurious++;
    }
    expect(pushed).toBeGreaterThan(0);
    expect(spurious).toBeGreaterThan(0);
  }, 60_000);

  it("baris pertama raksasa di puncak halaman: penjaga tak menambah halaman kosong", async () => {
    const giant = Array.from({ length: 90 }, (_, i) => `baris-${i}`).join("\n");
    const build = (guarded: boolean) => {
      const content: Content[] = [{ text: "awal", pageBreak: "after" }, heading("JUDULRAKSASA"), tableOf([giant, "berikut"])];
      return { ...BASE, ...(guarded ? keepHeadingsWithTable(content) : { content }) } as TDocumentDefinitions;
    };
    const [g, u] = [await pagesOf(build(true)), await pagesOf(build(false))];
    expect(g.length).toBe(u.length);
    expect(pageOfText(linesOf(g), "JUDULRAKSASA")).toBe(1);
  }, 60_000);
});
