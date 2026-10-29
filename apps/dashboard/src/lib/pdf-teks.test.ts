import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GalatPdfTeks, teksDariPdf } from "./pdf-teks";

// TMPDIR sendiri untuk berkas uji ini — `os.tmpdir()` membacanya tiap panggilan,
// jadi berkas sementara uji lain yang berjalan paralel tidak ikut terhitung.
let tmpUji = "";
const tmpAsal = process.env.TMPDIR;
beforeAll(() => {
  tmpUji = mkdtempSync(join(tmpdir(), "pdf-teks-uji-"));
  process.env.TMPDIR = tmpUji;
});
afterAll(() => {
  if (tmpAsal === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = tmpAsal;
  rmSync(tmpUji, { recursive: true, force: true });
});
const sisaBerkasSementara = () => readdirSync(tmpUji).filter((f) => f.startsWith("solamax-pdf-"));

describe("teksDariPdf", () => {
  it("menolak berkas yang kepalanya bukan %PDF tanpa menjalankan apa pun", async () => {
    await expect(teksDariPdf(Buffer.from("PK\u0003\u0004 bukan pdf"))).rejects.toMatchObject({
      kode: "bukan-pdf",
    });
    await expect(teksDariPdf(Buffer.alloc(0))).rejects.toBeInstanceOf(GalatPdfTeks);
    expect(sisaBerkasSementara()).toEqual([]);
  });

  it("PDF rusak ⇒ galat bertipe, berkas sementara terhapus", async () => {
    const g = await teksDariPdf(Buffer.from("%PDF-1.4\nrusak")).catch((e: unknown) => e);
    expect(g).toBeInstanceOf(GalatPdfTeks);
    // Tanpa poppler di mesin uji ⇒ "pdftotext-tidak-ada"; dengan poppler ⇒ "gagal".
    expect(["gagal", "pdftotext-tidak-ada"]).toContain((g as GalatPdfTeks).kode);
    expect(sisaBerkasSementara()).toEqual([]);
  });
});
