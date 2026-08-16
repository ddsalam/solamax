import { describe, expect, it } from "vitest";
import {
  BATAS_HOF_RP,
  bolehMenutup,
  periksaTutupHari,
  tierFor,
  TOLERANSI_RP,
  type SyaratTutup,
} from "./keuangan-tutup-hari";
import type { WewenangCtx } from "./keuangan-wewenang";

const HOF = ["ddsalam@solagroup.co"];
const hof: WewenangCtx = { role: "admin_perusahaan", email: "ddsalam@solagroup.co" };
const direksi: WewenangCtx = { role: "direksi", email: "dir@solagroup.co" };
const superadmin: WewenangCtx = { role: "super_admin", email: "sa@solagroup.co" };
const pengawas: WewenangCtx = { role: "pengawas", email: "peng@solagroup.co" };

describe("tierFor — ambang pada NILAI MUTLAK", () => {
  it("nol dan di dalam toleransi", () => {
    expect(tierFor(0)).toBe("within_tolerance");
    expect(tierFor(9_999)).toBe("within_tolerance");
  });

  it("tepat di Rp 10.000 masih di dalam toleransi (batas INKLUSIF)", () => {
    expect(tierFor(TOLERANSI_RP)).toBe("within_tolerance");
  });

  it("Rp 10.000,01 sudah exception_hof", () => {
    expect(tierFor(10_000.01)).toBe("exception_hof");
  });

  it("tepat di Rp 100.000 masih exception_hof", () => {
    expect(tierFor(BATAS_HOF_RP)).toBe("exception_hof");
  });

  it("Rp 100.000,01 sudah override_direksi", () => {
    expect(tierFor(100_000.01)).toBe("override_direksi");
  });

  it("arah tidak mengubah tier — kurang setor sama seriusnya dgn lebih setor", () => {
    for (const n of [10_001, 50_000, 100_001, 5_000_000]) {
      expect(tierFor(-n), String(-n)).toBe(tierFor(n));
    }
  });
});

describe("bolehMenutup — dua predikat, dan bedanya HANYA satu suku", () => {
  it("dalam toleransi: siapa pun yang berhak menutup", () => {
    expect(bolehMenutup("within_tolerance", pengawas, HOF)).toBe(true);
  });

  it("exception_hof: HoF boleh", () => {
    expect(bolehMenutup("exception_hof", hof, HOF)).toBe(true);
  });

  it("🔴 override_direksi: HoF TIDAK boleh — inilah yang membuat tangga berarti", () => {
    // Kalau baris ini pernah hijau, kedua predikat telah disatukan dan tingkat
    // ketiga diam-diam turun jadi tingkat kedua.
    expect(bolehMenutup("override_direksi", hof, HOF)).toBe(false);
  });

  it("override_direksi: direksi & super_admin boleh", () => {
    expect(bolehMenutup("override_direksi", direksi, HOF)).toBe(true);
    expect(bolehMenutup("override_direksi", superadmin, HOF)).toBe(true);
  });

  it("pengawas tidak boleh di kedua tier di luar toleransi", () => {
    expect(bolehMenutup("exception_hof", pengawas, HOF)).toBe(false);
    expect(bolehMenutup("override_direksi", pengawas, HOF)).toBe(false);
  });

  it("HoF berwenang PERSIS pada satu tier, tidak lebih", () => {
    // Pernyataan positif + negatif berdampingan: kalau wewenang HoF melebar,
    // salah satu dari keduanya merah.
    expect(bolehMenutup("exception_hof", hof, HOF)).toBe(true);
    expect(bolehMenutup("override_direksi", hof, HOF)).toBe(false);
  });
});

describe("periksaTutupHari — satu tempat yang memutuskan", () => {
  const syarat = (o: Partial<SyaratTutup> = {}): SyaratTutup => ({
    differenceRp: 0,
    reasonCode: null,
    reasonRequiresTarget: null,
    targetDate: null,
    ...o,
  });

  it("selisih nol tanpa alasan: boleh ditutup", () => {
    const r = periksaTutupHari(syarat(), pengawas, { sudahDisetujui: false, daftarHof: HOF });
    expect(r).toEqual({ boleh: true, tier: "within_tolerance" });
  });

  it("selisih kecil TANPA reason_code ⇒ ditolak (yang kecil pun wajib bersebab)", () => {
    const r = periksaTutupHari(syarat({ differenceRp: 500 }), pengawas, {
      sudahDisetujui: false,
      daftarHof: HOF,
    });
    expect(r.boleh).toBe(false);
    if (r.boleh) return;
    expect(r.kurang).toEqual(["reason_code"]);
  });

  it("selisih kecil DENGAN reason_code ⇒ boleh, dan selisihnya tetap tersimpan", () => {
    const r = periksaTutupHari(
      syarat({ differenceRp: 500, reasonCode: "CLS-ROUND", reasonRequiresTarget: false }),
      pengawas,
      { sudahDisetujui: false, daftarHof: HOF },
    );
    expect(r).toEqual({ boleh: true, tier: "within_tolerance" });
  });

  it("kode ber-requires_target TANPA tanggal target ⇒ ditolak", () => {
    // Dibaca dari DATA, bukan dari nama kode: tes ini tidak menyebut
    // CLS-INVESTIGATING sebagai syarat, hanya sebagai contoh nilai.
    const r = periksaTutupHari(
      syarat({
        differenceRp: 50_000,
        reasonCode: "CLS-INVESTIGATING",
        reasonRequiresTarget: true,
      }),
      hof,
      { sudahDisetujui: true, daftarHof: HOF },
    );
    expect(r.boleh).toBe(false);
    if (r.boleh) return;
    expect(r.kurang).toEqual(["target_date"]);
  });

  it("kode LAIN yang menuntut target juga tertahan — aturannya bukan nama kode", () => {
    const r = periksaTutupHari(
      syarat({ differenceRp: 0, reasonCode: "KODE-BARU-X", reasonRequiresTarget: true }),
      direksi,
      { sudahDisetujui: true, daftarHof: HOF },
    );
    expect(r.boleh).toBe(false);
    if (r.boleh) return;
    expect(r.kurang).toContain("target_date");
  });

  it("🔴 HoF pada selisih > Rp 100.000 ⇒ kurang WEWENANG", () => {
    const r = periksaTutupHari(
      syarat({ differenceRp: 250_000, reasonCode: "CLS-CASH", reasonRequiresTarget: false }),
      hof,
      { sudahDisetujui: true, daftarHof: HOF },
    );
    expect(r.boleh).toBe(false);
    if (r.boleh) return;
    expect(r.tier).toBe("override_direksi");
    expect(r.kurang).toContain("wewenang");
  });

  it("Direksi pada selisih > Rp 100.000 dengan persetujuan ⇒ boleh", () => {
    const r = periksaTutupHari(
      syarat({ differenceRp: 250_000, reasonCode: "CLS-CASH", reasonRequiresTarget: false }),
      direksi,
      { sudahDisetujui: true, daftarHof: HOF },
    );
    expect(r).toEqual({ boleh: true, tier: "override_direksi" });
  });

  it("berwenang TAPI belum menyetujui ⇒ tetap ditahan", () => {
    // Wewenang ≠ persetujuan. Menyatukannya membuat tier di luar toleransi
    // tertutup begitu orang yang tepat membuka layarnya.
    const r = periksaTutupHari(
      syarat({ differenceRp: 250_000, reasonCode: "CLS-CASH", reasonRequiresTarget: false }),
      direksi,
      { sudahDisetujui: false, daftarHof: HOF },
    );
    expect(r.boleh).toBe(false);
    if (r.boleh) return;
    expect(r.kurang).toEqual(["persetujuan"]);
  });

  it("dalam toleransi TIDAK menuntut persetujuan", () => {
    const r = periksaTutupHari(
      syarat({ differenceRp: 1_000, reasonCode: "CLS-ROUND", reasonRequiresTarget: false }),
      pengawas,
      { sudahDisetujui: false, daftarHof: HOF },
    );
    expect(r.boleh).toBe(true);
  });

  it("melaporkan SEMUA yang kurang sekaligus, bukan satu per satu", () => {
    const r = periksaTutupHari(syarat({ differenceRp: 500_000 }), pengawas, {
      sudahDisetujui: false,
      daftarHof: HOF,
    });
    expect(r.boleh).toBe(false);
    if (r.boleh) return;
    expect([...r.kurang].sort()).toEqual(["persetujuan", "reason_code", "wewenang"]);
  });

  it("selisih negatif besar diperlakukan sama dengan positif besar", () => {
    const a = periksaTutupHari(
      syarat({ differenceRp: -250_000, reasonCode: "CLS-CASH", reasonRequiresTarget: false }),
      hof,
      { sudahDisetujui: true, daftarHof: HOF },
    );
    expect(a.boleh).toBe(false);
    if (a.boleh) return;
    expect(a.tier).toBe("override_direksi");
  });
});
