import { describe, expect, it } from "vitest";
import {
  bolehMenerbitkanOverride,
  overrideMasihBerlaku,
  type PermintaanOverride,
} from "./keuangan-override";
import type { WewenangCtx } from "./keuangan-wewenang";

const HOF = ["ddsalam@solagroup.co"];
const hof: WewenangCtx = { role: "admin_perusahaan", email: "ddsalam@solagroup.co" };
const direksi: WewenangCtx = { role: "direksi", email: "dir@solagroup.co" };
const pengawas: WewenangCtx = { role: "pengawas", email: "peng@solagroup.co" };

const p = (o: Partial<PermintaanOverride> = {}): PermintaanOverride => ({
  requestedByUserId: 7,
  approvedByUserId: 15,
  reasonCode: "ADJ-MISSING",
  reasonAppliesTo: "adjustment",
  alasan: "nota supir tangki baru ditemukan setelah hari ditutup",
  ...o,
});

describe("bolehMenerbitkanOverride — lengkap & berwenang", () => {
  it("permintaan lengkap dengan approver HoF ⇒ boleh", () => {
    expect(bolehMenerbitkanOverride(p(), hof, HOF)).toEqual({ boleh: true });
  });

  it("Direksi juga boleh menyetujui", () => {
    expect(bolehMenerbitkanOverride(p(), direksi, HOF)).toEqual({ boleh: true });
  });

  it("🔴 approver TANPA canCloseException ⇒ ditolak", () => {
    // Mem-backdate ke hari tertutup MEMBUKA KEMBALI hari yang sudah disahkan;
    // wewenangnya disamakan dengan menutup di luar toleransi, bukan diturunkan.
    const r = bolehMenerbitkanOverride(p(), pengawas, HOF);
    expect(r.boleh).toBe(false);
    if (r.boleh) return;
    expect(r.kurang).toContain("wewenang_approver");
  });

  it("belum ada approver ⇒ ditolak, dan tidak menuduh soal wewenang", () => {
    const r = bolehMenerbitkanOverride(p({ approvedByUserId: null }), hof, HOF);
    expect(r.boleh).toBe(false);
    if (r.boleh) return;
    expect(r.kurang).toEqual(["approver"]);
  });

  it("🔴 pengaju menyetujui dirinya sendiri ⇒ ditolak", () => {
    const r = bolehMenerbitkanOverride(p({ requestedByUserId: 15, approvedByUserId: 15 }), hof, HOF);
    expect(r.boleh).toBe(false);
    if (r.boleh) return;
    expect(r.kurang).toContain("approver_sama_dengan_pengaju");
  });

  it("reason code kosong ⇒ ditolak", () => {
    const r = bolehMenerbitkanOverride(p({ reasonCode: null, reasonAppliesTo: null }), hof, HOF);
    expect(r.boleh).toBe(false);
    if (r.boleh) return;
    expect(r.kurang).toContain("reason_code");
  });

  it("🔴 reason code dari grup LAIN (closing) ⇒ ditolak", () => {
    // Tanpa ini, kode `closing` bisa dipinjam untuk membenarkan backdate —
    // dan laporan frekuensi per grup jadi bohong.
    const r = bolehMenerbitkanOverride(
      p({ reasonCode: "CLS-INVESTIGATING", reasonAppliesTo: "closing" }),
      hof,
      HOF,
    );
    expect(r.boleh).toBe(false);
    if (r.boleh) return;
    expect(r.kurang).toContain("reason_bukan_adjustment");
  });

  it("alasan kosong / spasi ⇒ ditolak", () => {
    for (const alasan of [null, "", "   "]) {
      const r = bolehMenerbitkanOverride(p({ alasan }), hof, HOF);
      expect(r.boleh, String(alasan)).toBe(false);
      if (r.boleh) continue;
      expect(r.kurang).toContain("alasan");
    }
  });

  it("melaporkan SEMUA kekurangan sekaligus", () => {
    const r = bolehMenerbitkanOverride(
      p({ reasonCode: null, reasonAppliesTo: null, alasan: "", approvedByUserId: 7 }),
      pengawas,
      HOF,
    );
    expect(r.boleh).toBe(false);
    if (r.boleh) return;
    expect([...r.kurang].sort()).toEqual([
      "alasan",
      "approver_sama_dengan_pengaju",
      "reason_code",
      "wewenang_approver",
    ]);
  });

  it("daftar HoF kosong ⇒ HoF kehilangan wewenangnya (fail-closed)", () => {
    const r = bolehMenerbitkanOverride(p(), hof, []);
    expect(r.boleh).toBe(false);
    if (r.boleh) return;
    expect(r.kurang).toContain("wewenang_approver");
  });
});

describe("overrideMasihBerlaku — SEKALI PAKAI", () => {
  const ov = (o: Partial<Parameters<typeof overrideMasihBerlaku>[0]> = {}) => ({
    approvedAt: "2026-08-13T02:00:00Z",
    consumedAt: null,
    void: false,
    ...o,
  });

  it("disetujui & belum terpakai ⇒ berlaku", () => {
    expect(overrideMasihBerlaku(ov())).toBe(true);
  });

  it("🔴 SUDAH TERPAKAI ⇒ TIDAK berlaku lagi — INSERT berikutnya ditolak", () => {
    // Syarat terpenting jalur tembus ini. Override yang menetap membuka hari itu
    // SELAMANYA dan tak seorang pun akan menyadarinya.
    expect(overrideMasihBerlaku(ov({ consumedAt: "2026-08-13T02:05:00Z" }))).toBe(false);
  });

  it("belum disetujui ⇒ tidak berlaku", () => {
    expect(overrideMasihBerlaku(ov({ approvedAt: null }))).toBe(false);
  });

  it("di-void ⇒ tidak berlaku meski sudah disetujui", () => {
    expect(overrideMasihBerlaku(ov({ void: true }))).toBe(false);
  });

  it("void menang atas persetujuan DAN atas belum-terpakai", () => {
    expect(overrideMasihBerlaku({ approvedAt: "x", consumedAt: null, void: true })).toBe(false);
  });
});
