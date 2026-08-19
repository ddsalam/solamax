import { describe, expect, it } from "vitest";
import {
  DATE_COOKIE,
  deriveTopbarSelection,
  selectionCookieWrites,
  UNIT_COOKIE,
} from "./selection-keys";

/**
 * Mengunci sinkronisasi picker ↔ URL — URL KANONIK. Di SEMUA rute ber-unit-di-
 * URL (laporan/rincian/usulan + denah) picker cermin URL (cegah desync saat
 * layout grup tak re-render & cookie basi — bug denah 2026-07-09). Di rute
 * tanpa unit di URL → seed cookie. Plus aturan write-through cookie.
 */
const SEED_UNIT = "6478111";
const SEED_DATE = "2026-06-18"; // cookie basi
const TODAY = "2026-07-09";
const UNITS = ["6478111", "6378301"]; // IB + Bakau

const derive = (path: string) => deriveTopbarSelection(path, SEED_UNIT, SEED_DATE, TODAY);

describe("deriveTopbarSelection — picker cermin URL di rute ber-unit", () => {
  it("rincian: unit+tanggal dari URL menang atas seed cookie", () => {
    expect(derive("/unit/6478111/rincian/2026-06-14")).toEqual({
      unit: "6478111",
      date: "2026-06-14",
      navDate: "2026-06-14",
      unitFromUrl: true,
      dateFromUrl: true,
    });
  });

  it("laporan: tanggal dari URL menang (?view diabaikan oleh path)", () => {
    const r = derive("/unit/6478111/laporan/2026-06-15");
    expect(r.date).toBe("2026-06-15");
    expect(r.dateFromUrl).toBe(true);
  });

  it("usulan (termasuk /edit): unit+tanggal dari URL", () => {
    const r = derive("/unit/6378301/usulan/2026-06-20/edit");
    expect(r).toMatchObject({ unit: "6378301", date: "2026-06-20", unitFromUrl: true });
  });

  it("UNIT desync: code dari URL menang atas seed unit", () => {
    const r = derive("/unit/6478333/rincian/2026-06-14");
    expect(r.unit).toBe("6478333");
    expect(r.date).toBe("2026-06-14");
  });

  it("DENAH (bug 2026-07-09): unit dari URL menang atas seed — bukan grup-wide", () => {
    const r = derive("/monitoring/denah/6478111");
    expect(r.unit).toBe("6478111");
    expect(r.unitFromUrl).toBe(true);
  });

  it("DENAH realtime: tanggal tampil = hari ini, TANPA write-through tanggal", () => {
    const r = derive("/monitoring/denah/6378301");
    expect(r.date).toBe(TODAY);
    expect(r.dateFromUrl).toBe(false);
  });

  it("DENAH detour (B4, walk 2026-07-10): navDate = tanggal terbawa, BUKAN hari ini — link sidebar dari denah mempertahankan tanggal laporan", () => {
    // laporan 2026-07-05 → denah → sidebar balik ke laporan harus 2026-07-05.
    const laporan = deriveTopbarSelection("/unit/6478111/laporan/2026-07-05", SEED_UNIT, SEED_DATE, TODAY);
    expect(laporan.navDate).toBe("2026-07-05");
    const denah = deriveTopbarSelection("/monitoring/denah/6478111", SEED_UNIT, "2026-07-05", TODAY);
    expect(denah.date).toBe(TODAY); // tampilan tetap hari ini (realtime)
    expect(denah.navDate).toBe("2026-07-05"); // navigasi membawa tanggal terbawa
  });

  it("grup-wide (board/ketaatan/beranda/admin): pakai seed cookie", () => {
    for (const p of ["/board", "/monitoring/ketaatan", "/", "/admin", "/monitoring"]) {
      expect(derive(p)).toEqual({
        unit: SEED_UNIT,
        date: SEED_DATE,
        navDate: SEED_DATE,
        unitFromUrl: false,
        dateFromUrl: false,
      });
    }
  });
});

describe("selectionCookieWrites — write-through mengikuti navigasi", () => {
  it("drill-in denah: tulis unit URL (≠ cookie), tanggal TIDAK ditulis", () => {
    const sel = derive("/monitoring/denah/6378301");
    expect(selectionCookieWrites(sel, UNITS, { unit: "6478111", date: SEED_DATE })).toEqual([
      { key: UNIT_COOKIE, value: "6378301" },
    ]);
  });

  it("rute laporan: tulis unit + tanggal saat keduanya berbeda", () => {
    const sel = derive("/unit/6378301/laporan/2026-07-01");
    expect(selectionCookieWrites(sel, UNITS, { unit: "6478111", date: SEED_DATE })).toEqual([
      { key: UNIT_COOKIE, value: "6378301" },
      { key: DATE_COOKIE, value: "2026-07-01" },
    ]);
  });

  it("nilai sama = tanpa tulisan (hindari loop efek)", () => {
    const sel = derive("/unit/6478111/laporan/2026-06-15");
    expect(selectionCookieWrites(sel, UNITS, { unit: "6478111", date: "2026-06-15" })).toEqual([]);
  });

  it("unit di luar scope caller TIDAK pernah ditulis ke cookie", () => {
    const sel = derive("/monitoring/denah/9999999");
    expect(selectionCookieWrites(sel, UNITS, { unit: "6478111", date: SEED_DATE })).toEqual([]);
  });

  it("URL 404 di luar scope: TANPA tulisan APA PUN — tanggal pun tidak (temuan walk 2026-07-10)", () => {
    // Pengawas Bakau membuka /unit/<IB>/laporan/<tgl> → 404; tanggal URL tak
    // boleh menggeser tanggal terbawa.
    const sel = derive("/unit/6478111/laporan/2026-07-01");
    expect(selectionCookieWrites(sel, ["6378301"], { unit: "6378301", date: SEED_DATE })).toEqual(
      [],
    );
  });

  it("rute tanpa unit di URL: tanpa tulisan apa pun", () => {
    const sel = derive("/board");
    expect(selectionCookieWrites(sel, UNITS, { unit: "6378301", date: SEED_DATE })).toEqual([]);
  });
});

describe("rute Keuangan — /keuangan/unit/{code}/{date}/… (K2, layar 3)", () => {
  it("URL otoritatif: unit & tanggal diambil dari path, bukan cookie", () => {
    // Bentuk rute ini BEDA dari rute laporan (unit setelah /keuangan, bukan di
    // akar). Rute ber-unit yang tak terdaftar di sini bukan gagal terang — ia
    // diam-diam memakai cookie, dan tautan sidebar menunjuk SPBU yang salah.
    const s = derive("/keuangan/unit/6378301/2026-01-15/input");
    expect(s.unit).toBe("6378301");
    expect(s.date).toBe("2026-01-15");
    expect(s.navDate).toBe("2026-01-15");
    expect(s.unitFromUrl).toBe(true);
    expect(s.dateFromUrl).toBe(true);
  });

  it("berbeda dari seed — jangan hijau karena kebetulan sama dengan cookie", () => {
    // Daya-beda: kalau regexnya TIDAK cocok, hasilnya jatuh ke SEED. Uji ini
    // memakai unit & tanggal yang berbeda dari seed supaya kegagalan itu
    // terlihat, bukan tersamar.
    const s = derive("/keuangan/unit/6478201/2026-03-09/input");
    expect(s.unit).not.toBe(SEED_UNIT);
    expect(s.date).not.toBe(SEED_DATE);
  });

  it("write-through cookie jalan untuk rute ini", () => {
    const s = derive("/keuangan/unit/6378301/2026-01-15/input");
    const w = selectionCookieWrites(s, ["6378301"], {});
    expect(w.map((x) => x.value).sort()).toEqual(["2026-01-15", "6378301"]);
  });

  it("tanggal tak valid di path → tidak dianggap rute ber-unit", () => {
    const s = derive("/keuangan/unit/6378301/kemarin/input");
    expect(s.unitFromUrl).toBe(false);
    expect(s.unit).toBe(SEED_UNIT);
  });
});

describe("rute Laporan Keuangan — /keuangan/unit/{code}/{date} (K2, layar 2)", () => {
  it("tercakup regex yang sama dengan Layar 3 — tanpa akhiran /input", () => {
    // Dibuktikan, bukan diasumsikan: regexnya tak menuntut akhiran, jadi rute
    // laporan ikut tercakup. Kalau kelak ia dipersempit dengan `$`, baris ini
    // merah — dan gejalanya di lapangan adalah tautan sidebar menunjuk SPBU lain.
    const s = derive("/keuangan/unit/6378301/2026-01-15");
    expect(s.unit).toBe("6378301");
    expect(s.date).toBe("2026-01-15");
    expect(s.unitFromUrl).toBe(true);
    expect(s.dateFromUrl).toBe(true);
  });

  it("beda dari seed — daya-beda ada", () => {
    const s = derive("/keuangan/unit/6478201/2026-03-09");
    expect(s.unit).not.toBe(SEED_UNIT);
    expect(s.date).not.toBe(SEED_DATE);
  });
});

describe("rute Tutup Hari — /keuangan/unit/{code}/tutup-hari/{date} (K2, layar 4)", () => {
  it("🔴 tanggal ada di segmen KETIGA — URL tetap otoritatif", () => {
    // Jebakan yang didokumentasikan sendiri lalu nyaris terinjak: pola Layar
    // 2/3 menaruh tanggal di segmen kedua. Kalau regexnya tak menampung bentuk
    // ini, `unitFromUrl` jadi false, nilai jatuh ke cookie, dan tautan sidebar
    // menunjuk SPBU LAIN — gejala yang jauh dari sebabnya.
    const s = derive("/keuangan/unit/6378301/tutup-hari/2026-01-29");
    expect(s.unit).toBe("6378301");
    expect(s.date).toBe("2026-01-29");
    expect(s.unitFromUrl).toBe(true);
    expect(s.dateFromUrl).toBe(true);
  });

  it("beda dari seed — daya-beda ada", () => {
    const s = derive("/keuangan/unit/6478201/2026-03-09");
    expect(s.unit).not.toBe(SEED_UNIT);
  });
});
