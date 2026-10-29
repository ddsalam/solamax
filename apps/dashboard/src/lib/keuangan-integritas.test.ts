import { describe, expect, it } from "vitest";
import {
  ANGGOTA_COCOK_AKTIF_SQL,
  periksaKelompokCocok,
  ringkasTemuanCocok,
  type AnggotaCocok,
  cariYatim,
  ringkasTemuan,
  SUMBER_ID_SQL,
  SUMBER_SAH,
  type TautSumber,
} from "./keuangan-integritas";

const taut = (over: Partial<TautSumber> = {}): TautSumber => ({
  tabel: "correction_entry",
  id: "c-1",
  sourceKind: "manual_entry",
  sourceTxnId: "m-1",
  ...over,
});

const ada = (...ids: string[]) => ({ manual_entry: new Set(ids) });

describe("cariYatim — taut yang menunjuk ke ketiadaan", () => {
  it("taut sah tidak dilaporkan", () => {
    expect(cariYatim([taut()], ada("m-1"))).toEqual([]);
  });

  it("id tidak ada di tabel tujuan ⇒ orphan", () => {
    const t = cariYatim([taut({ sourceTxnId: "m-hantu" })], ada("m-1"));
    expect(t).toHaveLength(1);
    expect(t[0]!.masalah).toBe("orphan");
    expect(t[0]!.sourceTxnId).toBe("m-hantu");
  });

  it("melaporkan tabel asalnya, bukan hanya id", () => {
    const t = cariYatim(
      [taut({ tabel: "reclassification", id: "r-9", sourceTxnId: "x" })],
      ada("m-1"),
    );
    expect(t[0]!.tabel).toBe("reclassification");
    expect(t[0]!.id).toBe("r-9");
  });

  it("source_kind di luar daftar tertutup ⇒ kind_unknown, BUKAN dilewati", () => {
    // Melewati yang tak dikenal = penjaga berhenti memeriksa persis pada baris
    // paling mencurigakan. Kalau baris ini pernah merah, penjaganya sudah buta.
    const t = cariYatim([taut({ sourceKind: "buku_kas_besar" })], ada("m-1"));
    expect(t).toHaveLength(1);
    expect(t[0]!.masalah).toBe("kind_unknown");
  });

  it("jenis tak dikenal dilaporkan meski id-nya kebetulan ada di ledger lain", () => {
    const t = cariYatim([taut({ sourceKind: "entah", sourceTxnId: "m-1" })], ada("m-1"));
    expect(t[0]!.masalah).toBe("kind_unknown");
  });

  it("himpunan id untuk jenis itu belum disediakan ⇒ orphan, bukan diam-diam lolos", () => {
    // Kejadian nyata yang diantisipasi: ledger kedua ditambahkan ke SUMBER_SAH
    // tetapi pengambilan id-nya lupa ditambah. Yang benar adalah BERISIK.
    const t = cariYatim([taut()], {});
    expect(t).toHaveLength(1);
    expect(t[0]!.masalah).toBe("orphan");
  });

  it("memeriksa SEMUA taut, bukan berhenti di temuan pertama", () => {
    const t = cariYatim(
      [
        taut({ id: "a", sourceTxnId: "hantu-1" }),
        taut({ id: "b", sourceTxnId: "m-1" }),
        taut({ id: "c", sourceKind: "aneh" }),
        taut({ id: "d", sourceTxnId: "hantu-2" }),
      ],
      ada("m-1"),
    );
    expect(t.map((x) => x.id)).toEqual(["a", "c", "d"]);
  });

  it("daftar kosong ⇒ bersih (dan ringkasannya menyebut begitu)", () => {
    expect(cariYatim([], ada())).toEqual([]);
    expect(ringkasTemuan([])).toBe("integritas taut: bersih");
  });

  it("ringkasan memisahkan yatim dari jenis tak dikenal", () => {
    const t = cariYatim(
      [taut({ id: "a", sourceTxnId: "hantu" }), taut({ id: "b", sourceKind: "aneh" })],
      ada("m-1"),
    );
    expect(ringkasTemuan(t)).toBe("integritas taut: 2 temuan (1 yatim, 1 jenis tak dikenal)");
  });
});

describe("daftar sumber tetap sinkron dengan pengambil id-nya", () => {
  it("hari ini tepat satu sumber sah", () => {
    // Bukan uji kosmetik: kalau seseorang menambah sumber di SUMBER_SAH, baris
    // ini merah dan memaksa ia memutuskan sadar — dan itu keputusan OWNER.
    expect([...SUMBER_SAH]).toEqual(["manual_entry"]);
  });

  it("setiap sumber sah punya SQL pengambil id-nya", () => {
    // Penjaga terhadap kelas kesalahan yang paling mungkin: daftar diperluas,
    // pengambil id-nya lupa — sehingga seluruh baris sumber baru jadi "orphan"
    // palsu, atau lebih buruk, tak diperiksa sama sekali.
    for (const s of SUMBER_SAH) {
      expect(SUMBER_ID_SQL[s], s).toBeTruthy();
      expect(SUMBER_ID_SQL[s]).toMatch(/SELECT id::text FROM app\./);
    }
    expect(Object.keys(SUMBER_ID_SQL).sort()).toEqual([...SUMBER_SAH].sort());
  });
});

// ---------------------------------------------------------------------------
// U10 — kelompok cocok (KTD6)
// ---------------------------------------------------------------------------

const ang = (over: Partial<AnggotaCocok>): AnggotaCocok => ({
  cocokId: "g1",
  unitId: 2,
  jenis: "kas",
  anggotaId: "k1",
  accountId: "bca",
  amountSen: 100,
  void: false,
  mutasiTakSah: false,
  ...over,
});

describe("periksaKelompokCocok — Σ kelompok = 0, keanggotaan tunggal", () => {
  const sah = [ang({ jenis: "mutasi", anggotaId: "m1" }), ang({ anggotaId: "k1" })];

  it("kelompok seimbang ⇒ bersih", () => {
    expect(periksaKelompokCocok(sah)).toEqual([]);
    expect(ringkasTemuanCocok([])).toBe("integritas kelompok cocok: bersih");
  });

  it("🔴 baris kas di DUA kelompok aktif ⇒ terdeteksi (dari kedua sisi)", () => {
    const t = periksaKelompokCocok([...sah, ang({ cocokId: "g2", jenis: "mutasi", anggotaId: "m2" }), ang({ cocokId: "g2", anggotaId: "k1" })]);
    const ganda = t.filter((x) => x.masalah === "keanggotaan-ganda");
    expect(ganda.map((x) => [x.cocokId, x.anggotaId, x.cocokLain])).toEqual([
      ["g1", "k1", ["g2"]],
      ["g2", "k1", ["g1"]],
    ]);
  });

  it("🔴 Σ ≠ 0 per rekening ⇒ terdeteksi dengan selisihnya; total sama tapi rekening tertukar tetap terdeteksi", () => {
    expect(periksaKelompokCocok([ang({ jenis: "mutasi", anggotaId: "m1", amountSen: 101 }), ang({})])).toEqual([
      { masalah: "sigma-tidak-nol", cocokId: "g1", unitId: 2, accountId: "bca", selisihSen: 1 },
    ]);
    const tertukar = periksaKelompokCocok([ang({ jenis: "mutasi", anggotaId: "m1" }), ang({ accountId: "bca2" })]);
    expect(tertukar.filter((x) => x.masalah === "sigma-tidak-nol")).toHaveLength(2);
  });

  it("anggota kas void, baris bank tak sah, kelompok tanpa baris bank ⇒ terdeteksi", () => {
    expect(periksaKelompokCocok([ang({ jenis: "mutasi", anggotaId: "m1" }), ang({ void: true })]).map((x) => x.masalah)).toEqual(["anggota-void"]);
    expect(periksaKelompokCocok([ang({ jenis: "mutasi", anggotaId: "m1", mutasiTakSah: true }), ang({})]).map((x) => x.masalah)).toEqual([
      "baris-bank-tak-sah",
    ]);
    expect(periksaKelompokCocok([ang({ amountSen: 0 })]).map((x) => x.masalah)).toEqual(["tanpa-baris-bank"]);
  });

  it("SQL membaca anggota AKTIF saja, dengan FK komposit unit di join", () => {
    const s = ANGGOTA_COCOK_AKTIF_SQL.replace(/\s+/g, " ");
    expect(s).toMatch(/WHERE b\.aktif/);
    expect(s).toMatch(/m\.id = b\.mutasi_bank_id AND m\.unit_id = b\.unit_id/);
    expect(s).toMatch(/l\.id = b\.cash_ledger_id AND l\.unit_id = b\.unit_id/);
  });
});
