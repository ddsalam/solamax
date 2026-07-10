import * as ReactNS from "react";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// esbuild vitest mengompilasi TSX komponen dgn runtime JSX klasik
// (React.createElement sbg variabel bebas; tsconfig jsx=preserve) — sediakan
// global React agar modul .tsx bisa dirender tanpa mengubah vitest.config.
(globalThis as { React?: unknown }).React = ReactNS;

// Modul komponen meng-import server action → db.ts (pool butuh DATABASE_URL).
// View murni tak menyentuh action; mock modulnya agar import test tak butuh DB.
vi.mock("@/lib/manual-entry-actions", () => ({
  addManualEntry: vi.fn(),
  voidManualEntry: vi.fn(),
}));

import {
  AMOUNT_MAX,
  ManualPanel,
  ManualSectionView,
  type ManualSectionViewProps,
  ManualSourceBadge,
  parseAmount,
  sanitizeAmount,
  validateEntry,
} from "./ManualEntryForm";

/**
 * View manual-entry (murni & terkontrol) di-render statis — container stateful
 * (useOptimistic/useTransition) tak bisa jalan di React 18 vitest, maka logika
 * presentasi + validasi dipisah dan diuji di sini: struktur baris, format rp,
 * count+subtotal, empty state, form tambah (label/preview/error/pending),
 * konfirmasi void dua-langkah, indikator rekonsiliasi, dan no-print.
 */

const noop = (): void => {};

const baseProps = (over: Partial<ManualSectionViewProps> = {}): ManualSectionViewProps => ({
  title: "7 · Pengeluaran",
  idBase: "manual-pengeluaran",
  rows: [
    { id: "a", keterangan: "HENDRI/IBU RINA", amount: 50_000, urut: 0 },
    { id: "b", keterangan: "JUVEN/IBU RINA", amount: 30_137, urut: 1 },
  ],
  adding: false,
  ket: "",
  amount: "",
  pending: false,
  onAddToggle: noop,
  onCancelAdd: noop,
  onKetChange: noop,
  onAmountChange: noop,
  onSubmit: noop,
  onAskVoid: noop,
  onConfirmVoid: noop,
  onCancelVoid: noop,
  ...over,
});

const render = (over: Partial<ManualSectionViewProps> = {}): string =>
  renderToStaticMarkup(h(ManualSectionView, baseProps(over)));

describe("helper validasi/parse", () => {
  it("sanitizeAmount: digit saja, tanpa nol depan", () => {
    expect(sanitizeAmount("Rp 1.500a")).toBe("1500");
    expect(sanitizeAmount("007")).toBe("7");
    expect(sanitizeAmount("abc")).toBe("");
  });

  it("parseAmount: kosong → 0", () => {
    expect(parseAmount("")).toBe(0);
    expect(parseAmount("50000")).toBe(50_000);
  });

  it("validateEntry: keterangan wajib, jumlah > 0, batas atas", () => {
    expect(validateEntry("", "100")).toBe("Keterangan wajib diisi.");
    expect(validateEntry("  ", "100")).toBe("Keterangan wajib diisi.");
    expect(validateEntry("x", "")).toBe("Jumlah harus angka lebih dari 0.");
    expect(validateEntry("x", "0")).toBe("Jumlah harus angka lebih dari 0.");
    expect(validateEntry("x", String(AMOUNT_MAX + 1))).toBe("Jumlah terlalu besar.");
    expect(validateEntry("SETOR BANK", "50000")).toBeNull();
  });
});

describe("ManualSectionView — baris & header", () => {
  it("header: judul, badge Manual, jumlah entri, subtotal rp", () => {
    const html = render();
    expect(html).toContain("7 · Pengeluaran");
    expect(html).toContain("Manual");
    expect(html).toContain("2 entri");
    expect(html).toContain("Rp 80.137"); // subtotal 50.000 + 30.137
  });

  it("baris terstruktur: nomor urut, keterangan & jumlah rp rata kanan tabular", () => {
    const html = render();
    expect(html).toContain("HENDRI/IBU RINA");
    expect(html).toMatch(/right num nowrap manual-amt[^>]*>Rp 50\.000</);
    expect(html).toMatch(/right num nowrap manual-amt[^>]*>Rp 30\.137</);
  });

  it("empty state saat tanpa entri", () => {
    const html = render({ rows: [] });
    expect(html).toContain("Belum ada entri untuk tanggal ini.");
    expect(html).toContain("0 entri");
    expect(html).toContain("Rp 0");
  });

  it("baris optimistic pending: kelas pending + aria-busy", () => {
    const html = render({
      rows: [{ id: "opt-1", keterangan: "BARU", amount: 1000, urut: 9999, _pending: true }],
    });
    expect(html).toContain("manual-row pending");
    expect(html).toContain('aria-busy="true"');
  });
});

describe("ManualSectionView — form tambah entri", () => {
  it("tertutup: hanya tombol '+ Tambah entri' (tanpa input)", () => {
    const html = render();
    expect(html).toContain("+ Tambah entri");
    expect(html).not.toContain("<input");
  });

  it("terbuka: input berlabel + preview rp + Simpan/Batal", () => {
    const html = render({ adding: true, ket: "SETOR BANK", amount: "50000" });
    expect(html).toContain(">Keterangan</label>");
    expect(html).toContain(">Jumlah (Rp)</label>");
    expect(html).toContain('for="manual-pengeluaran-ket"');
    expect(html).toContain("Rp 50.000"); // live preview
    expect(html).toContain(">Simpan</span>");
    expect(html).toContain(">Batal</button>");
  });

  it("error validasi tampil sebagai role=alert; isian dipertahankan", () => {
    const html = render({ adding: true, ket: "", amount: "50000", err: "Keterangan wajib diisi." });
    expect(html).toMatch(/role="alert"[^>]*>Keterangan wajib diisi\./);
    expect(html).toContain('value="50000"');
  });

  it("pending: tombol Simpan disabled + label 'Menyimpan…' (anti double-submit)", () => {
    const html = render({ adding: true, ket: "X", amount: "1", pending: true });
    expect(html).toMatch(/disabled[^>]*>/);
    expect(html).toContain("Menyimpan…");
    expect(html).toContain('aria-busy="true"');
  });

  it("sukses tampil sebagai role=status", () => {
    const html = render({ success: "Entri ditambahkan." });
    expect(html).toMatch(/role="status"[^>]*>Entri ditambahkan\./);
  });
});

describe("ManualSectionView — konfirmasi void", () => {
  it("default: aksi 'Batalkan' tenang per baris, tanpa strip konfirmasi", () => {
    const html = render();
    expect(html).toContain('aria-label="Batalkan entri HENDRI/IBU RINA"');
    expect(html).not.toContain("Batalkan entri ini?");
  });

  it("confirming: baris ditandai + 'Ya, batalkan'/'Tidak', aksi baris lain tetap ada", () => {
    const html = render({ confirmId: "a" });
    expect(html).toContain("manual-row confirming");
    expect(html).toContain("Batalkan entri ini?");
    expect(html).toContain(">Ya, batalkan</button>");
    expect(html).toContain(">Tidak</button>");
    expect(html).toContain('aria-label="Konfirmasi pembatalan: HENDRI/IBU RINA"');
    // Baris "a" kehilangan tombol tenangnya; baris "b" tetap punya.
    expect(html).not.toContain('aria-label="Batalkan entri HENDRI/IBU RINA"');
    expect(html).toContain('aria-label="Batalkan entri JUVEN/IBU RINA"');
  });
});

describe("ManualSectionView — indikator rekonsiliasi I-vs-H", () => {
  it("warn (I < H): ikon ⚠ + teks + angka I & H (bukan warna saja)", () => {
    const html = render({
      recon: {
        tone: "warn",
        text: "Setoran kurang dari uang tunai (I < H, selisih Rp 4.809.563)",
        iVal: "Rp 20.000.000",
        hVal: "Rp 24.809.563",
      },
    });
    expect(html).toContain("manual-recon warn");
    expect(html).toContain("⚠");
    expect(html).toContain("selisih Rp 4.809.563");
    expect(html).toContain("I Rp 20.000.000 · H Rp 24.809.563");
  });

  it("ok (I ≥ H): ikon ✓ + teks", () => {
    const html = render({
      recon: { tone: "ok", text: "Setoran menutup uang tunai (I ≥ H)", iVal: "Rp 1", hVal: "Rp 1" },
    });
    expect(html).toContain("manual-recon ok");
    expect(html).toContain("✓");
  });

  it("tanpa recon (I null): indikator tak dirender", () => {
    expect(render()).not.toContain("manual-recon");
  });
});

describe("no-print — kontrol interaktif tak ikut cetak", () => {
  it("ManualPanel membungkus seluruh kontrol dalam .no-print", () => {
    const html = renderToStaticMarkup(
      h(ManualPanel, null, h(ManualSectionView, baseProps())),
    );
    expect(html).toMatch(/^<div class="no-print manual-panel mt12">/);
    expect(html).toContain("tidak ikut cetak");
    expect(html).toContain("<button"); // kontrol memang ada — di dalam wrapper no-print
  });

  it("badge 'Manual' di header sheet ber-kelas no-print (layar saja)", () => {
    const html = renderToStaticMarkup(h(ManualSourceBadge));
    expect(html).toContain("manual-badge");
    expect(html).toContain("no-print");
    expect(html).toContain("Manual");
  });
});
