import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./app.css", import.meta.url), "utf8");
const page = readFileSync(new URL("../app/(app)/unit/[code]/usulan/[date]/page.tsx", import.meta.url), "utf8");

function mediaBlocks(source: string, media: string): string[] {
  const blocks: string[] = [];
  let start = source.indexOf(media);
  while (start !== -1) {
    const open = source.indexOf("{", start);
    let depth = 1;
    let end = open + 1;
    for (; depth && end < source.length; end++) {
      if (source[end] === "{") depth++;
      if (source[end] === "}") depth--;
    }
    blocks.push(source.slice(open + 1, end - 1));
    start = source.indexOf(media, end);
  }
  return blocks;
}

const print = mediaBlocks(css, "@media print").join("\n");
function declarations(selector: string): string {
  const rule = [...print.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(
    (match) => match[1]!.replace(/\/\*[\s\S]*?\*\//g, "").trim() === selector,
  );
  expect(rule, `print rule ${selector}`).toBeDefined();
  return rule![2]!;
}

describe("cetak daftar SO · semua kolom muat tanpa skala/landscape wajib", () => {
  it("membebaskan track sidebar hanya saat mencetak daftar SO", () => {
    expect(page).toContain('className="lap-page usulan-list-page"');
    expect(declarations(".shell:has(.usulan-list-page)")).toMatch(/display:\s*block/);
    expect(declarations(".shell:has(.usulan-list-page)")).toMatch(/min-height:\s*0/);
    expect(declarations(".main:has(> .usulan-list-page)")).toMatch(/padding:\s*0/);
    // Marker/layout overrides stay inside print media, never changing screens.
    expect(css.split(".shell:has(.usulan-list-page)")).toHaveLength(2);
    expect(css).toContain(".shell.collapsed { grid-template-columns: 64px 1fr; }");
  });

  it("menghapus scroll/minimum layar yang memotong kolom kanan di kertas", () => {
    expect(declarations(".usulan-list-page .tbl-scroll")).toMatch(/overflow:\s*visible/);
    const row = declarations(".usulan-list-page .cols-usulan-list");
    expect(row).toMatch(/min-width:\s*0/);
    expect(row).toMatch(/width:\s*100%/);
    expect(row).toMatch(/break-inside:\s*avoid/);
    expect(row).toMatch(/font-size:\s*9pt/);
    expect(declarations(".usulan-list-page .cols-usulan-list > span")).toMatch(/overflow-wrap:\s*anywhere/);
    expect(css).toContain(".tbl-scroll .cols-usulan-list { min-width: 590px; }");
  });

  it("mempertahankan enam kolom, nilai nullable, dan waktu simpan", () => {
    for (const heading of ["Tanggal", "Total Penerimaan Hari (KL)", "Total Permintaan Besok (KL)", "Total Usulan Penebusan (KL)", "Status", "Terakhir disimpan"]) {
      expect(page).toContain(`>${heading}</span>`);
    }
    for (const field of ["totalPenerimaan", "totalPermintaan", "totalUsulan"]) {
      expect(page).toContain(`formatUsulanKl(u.${field})`);
    }
    expect(page).toContain("timeWib(u.lastSavedAt)");
    expect(print).not.toMatch(/cols-usulan-list[^{}]*\{[^{}]*(?:display:\s*none|overflow:\s*hidden)/);
  });

  it("parser media memisahkan aturan layar dan cetak", () => {
    expect(mediaBlocks("@media screen { .x { width: 10px; } } @media print { .x { width: 100%; } }", "@media print"))
      .toEqual([" .x { width: 100%; } "]);
  });
});
