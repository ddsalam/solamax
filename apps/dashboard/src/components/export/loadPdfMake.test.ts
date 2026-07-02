import type { TDocumentDefinitions } from "pdfmake/interfaces";
import { describe, expect, it } from "vitest";
import { applyPdfDefaults } from "./loadPdfMake";

describe("applyPdfDefaults (shared ligature fix)", () => {
  it("menonaktifkan ligatur via defaultStyle.fontFeatures {liga:false,dlig:false}", () => {
    const out = applyPdfDefaults({ content: "x", defaultStyle: { font: "Roboto", fontSize: 9 } });
    const ff = (out.defaultStyle as Record<string, unknown>).fontFeatures as Record<string, boolean>;
    expect(ff).toEqual({ liga: false, dlig: false });
    // default lain dipertahankan
    expect((out.defaultStyle as Record<string, unknown>).font).toBe("Roboto");
  });

  it("mengisi defaultStyle bila belum ada", () => {
    const out = applyPdfDefaults({ content: "x" } as TDocumentDefinitions);
    expect((out.defaultStyle as Record<string, unknown>).fontFeatures).toBeDefined();
  });

  it("tidak menimpa fontFeatures yang sudah diset laporan", () => {
    const custom = ["liga"] as never;
    const out = applyPdfDefaults({ content: "x", defaultStyle: { fontFeatures: custom } });
    expect((out.defaultStyle as Record<string, unknown>).fontFeatures).toBe(custom);
  });
});
