import { describe, expect, it } from "vitest";
import {
  periksaKelompokManual,
  usulkanCocok,
  usulkanSemua,
  type KasCocok,
  type KonteksCocok,
  type MutasiCocok,
} from "./cocok-bank-model";

/**
 * Mesin cocok MURNI (rencana 2026-10-29 U10; R19, R20, R29; AE4, AE10, AE11;
 * KTD6, KTD7). Data SINTETIS seluruhnya — nominal kasus rencana dipakai apa
 * adanya karena ia bagian dari kontraknya, nama & nomor karangan.
 */

const BCA = "aaaaaaaa-0000-4000-8000-000000000001"; // rekening BCA unit ini, …6811
const BCA2 = "aaaaaaaa-0000-4000-8000-000000000002"; // rekening BCA kedua unit ini, …4321
const rp = (r: number): number => Math.round(r * 100);

let n = 0;
const mutasi = (over: Partial<MutasiCocok> = {}): MutasiCocok => ({
  id: `m-${++n}`,
  accountId: BCA,
  tanggalBank: "2026-09-03",
  keterangan: "TRSF E-BANKING CR | CONTOH",
  amountSen: rp(1_000),
  so: null,
  dokRef: null,
  praCutover: false,
  rkStatus: "aktif",
  ...over,
});
const kas = (over: Partial<KasCocok> = {}): KasCocok => ({
  id: `k-${++n}`,
  accountId: BCA,
  businessDate: "2026-09-03",
  tanggalAsal: null,
  amountSen: rp(1_000),
  keterangan: "Ketikan",
  categoryLabel: "Lain-lain",
  void: false,
  saldoAwal: false,
  edcSettlementId: null,
  edcSettlementDate: null,
  pasanganUuid: null,
  lahirDariCocokId: null,
  ...over,
});
const ktx = (over: Partial<KonteksCocok> = {}): KonteksCocok => ({
  kas: [],
  penebusan: [],
  rekening: [
    { id: BCA, nomorRekening: "5125036811" },
    { id: BCA2, nomorRekening: "9876543210" },
  ],
  kasDicocokkan: new Set(),
  mutasiDicocokkan: new Set(),
  ...over,
});

// ---------------------------------------------------------------------------
// Debit B2B Pertamina — hanya lewat nomor SO (KTD7, R29)
// ---------------------------------------------------------------------------

describe("debit ber-SO — hanya penebusan dengan SO yang sama, tak pernah lewat nominal", () => {
  const SO_A = "6543210001";
  const SO_B = "6543210002";
  const nominal = -rp(180_000_000);

  it("Covers AE10: dua debit bernominal sama hari sama, SO berbeda ⇒ masing-masing ke penebusan SO-nya", () => {
    const kA = kas({ amountSen: nominal, categoryLabel: "Pembelian BBM", businessDate: "2026-09-02" });
    const kB = kas({ amountSen: nominal, categoryLabel: "Pembelian BBM", businessDate: "2026-09-02" });
    const c = ktx({
      kas: [kA, kB],
      penebusan: [
        { id: "p-A", noSo: SO_A, cashLedgerId: kA.id },
        { id: "p-B", noSo: SO_B, cashLedgerId: kB.id },
      ],
    });
    const mA = mutasi({ amountSen: nominal, so: SO_A });
    const mB = mutasi({ amountSen: nominal, so: SO_B });
    const [uA, uB] = usulkanSemua([mA, mB], c);
    expect(uA).toMatchObject({ jenis: "tunggal", kandidat: [{ cashLedgerId: kA.id, aturan: "penebusan-so" }] });
    expect(uB).toMatchObject({ jenis: "tunggal", kandidat: [{ cashLedgerId: kB.id, aturan: "penebusan-so" }] });
  });

  it("Covers AE10: SO di keterangan ditukar ⇒ tetap mengikuti SO, tak ada cocok silang lewat nominal", () => {
    const kA = kas({ amountSen: nominal, categoryLabel: "Pembelian BBM" });
    const c = ktx({ kas: [kA], penebusan: [{ id: "p-A", noSo: SO_A, cashLedgerId: kA.id }] });
    // Debit ber-SO B, bernominal & bertanggal persis sama dengan kas penebusan A.
    const u = usulkanCocok(mutasi({ amountSen: nominal, so: SO_B }), c);
    expect(u.jenis).toBe("tanpa");
    expect(u.kandidat).toEqual([]);
    expect(u.tanda).toBe("penebusan-belum-diketik");
  });

  it("SO ternormalisasi (lower/trim) seperti `penebusan.no_so`", () => {
    const k = kas({ amountSen: nominal });
    const c = ktx({ kas: [k], penebusan: [{ id: "p", noSo: "so-12a", cashLedgerId: k.id }] });
    expect(usulkanCocok(mutasi({ amountSen: nominal, so: "  SO-12A " }), c).jenis).toBe("tunggal");
  });

  it("penebusan belum diketik ⇒ tanpa kandidat, ditandai — padahal ada ketikan bernominal sama di tanggal sama", () => {
    const ketikan = kas({ amountSen: nominal });
    const u = usulkanCocok(mutasi({ amountSen: nominal, so: SO_A }), ktx({ kas: [ketikan] }));
    expect(u).toMatchObject({ jenis: "tanpa", kandidat: [], tanda: "penebusan-belum-diketik" });
  });

  it("kunci SO cocok tetapi nominal beda ⇒ CACAT ditandai, tidak dicocokkan", () => {
    const k = kas({ amountSen: nominal });
    const c = ktx({ kas: [k], penebusan: [{ id: "p", noSo: SO_A, cashLedgerId: k.id }] });
    const u = usulkanCocok(mutasi({ amountSen: nominal + 100, so: SO_A }), c);
    expect(u).toMatchObject({ jenis: "tanpa", kandidat: [], tanda: "penebusan-nominal-beda" });
    expect(u.rujukan).toEqual({ cashLedgerId: k.id, penebusanId: "p" });
  });

  it("kas penebusan di rekening lain ⇒ cacat rekening, tidak dicocokkan", () => {
    const k = kas({ amountSen: nominal, accountId: BCA2 });
    const c = ktx({ kas: [k], penebusan: [{ id: "p", noSo: SO_A, cashLedgerId: k.id }] });
    expect(usulkanCocok(mutasi({ amountSen: nominal, so: SO_A }), c).tanda).toBe("penebusan-rekening-beda");
  });

  it("kas penebusan sudah di kelompok aktif ⇒ tanpa, ditandai", () => {
    const k = kas({ amountSen: nominal });
    const c = ktx({ kas: [k], penebusan: [{ id: "p", noSo: SO_A, cashLedgerId: k.id }], kasDicocokkan: new Set([k.id]) });
    expect(usulkanCocok(mutasi({ amountSen: nominal, so: SO_A }), c)).toMatchObject({
      jenis: "tanpa",
      tanda: "penebusan-kas-sudah-dicocokkan",
    });
  });

  it("kas penebusan TIDAK pernah jadi kandidat ketikan bagi debit tanpa SO (kunci SO, bukan nominal)", () => {
    const k = kas({ amountSen: nominal, categoryLabel: "Pembelian BBM" });
    const c = ktx({ kas: [k], penebusan: [{ id: "p", noSo: SO_A, cashLedgerId: k.id }] });
    expect(usulkanCocok(mutasi({ amountSen: nominal }), c).jenis).toBe("tanpa");
  });

  it("satu SO, dua debit bernominal = Gross masing-masing ⇒ diperebutkan, tidak otomatis", () => {
    const k = kas({ amountSen: nominal });
    const c = ktx({ kas: [k], penebusan: [{ id: "p", noSo: SO_A, cashLedgerId: k.id }] });
    const u = usulkanSemua([mutasi({ amountSen: nominal, so: SO_A }), mutasi({ amountSen: nominal, so: SO_A })], c);
    expect(u.map((x) => x.jenis)).toEqual(["banyak", "banyak"]);
    expect(u.map((x) => x.tanda)).toEqual(["diperebutkan", "diperebutkan"]);
  });
});

// ---------------------------------------------------------------------------
// KURANG BAYAR — lewat nomor dokumen
// ---------------------------------------------------------------------------

describe("debit KURANG BAYAR — hanya baris kas yang keterangannya memuat nomor dokumen", () => {
  const nominal = -rp(2_345_678);

  it("satu baris kas memuat dok ⇒ tunggal; ketikan lain bernominal sama tanpa dok diabaikan", () => {
    const benar = kas({ amountSen: nominal, keterangan: "Kurang bayar DOK 8800123 Pertamina", businessDate: "2026-09-01" });
    const lain = kas({ amountSen: nominal });
    const u = usulkanCocok(mutasi({ amountSen: nominal, dokRef: "8800123" }), ktx({ kas: [benar, lain] }));
    expect(u).toMatchObject({ jenis: "tunggal", kandidat: [{ cashLedgerId: benar.id, aturan: "dok-ref" }] });
  });

  it("(dok, nominal) yang sama DUA kali ⇒ dua baris, tak pernah diciutkan jadi satu", () => {
    const k1 = kas({ amountSen: nominal, keterangan: "KURANG BAYAR 8800123 (1)" });
    const k2 = kas({ amountSen: nominal, keterangan: "KURANG BAYAR 8800123 (2)" });
    const m1 = mutasi({ amountSen: nominal, dokRef: "8800123" });
    const m2 = mutasi({ amountSen: nominal, dokRef: "8800123" });
    const u = usulkanSemua([m1, m2], ktx({ kas: [k1, k2] }));
    expect(u.map((x) => x.jenis)).toEqual(["banyak", "banyak"]);
    expect(u[0]!.kandidat.map((k) => k.cashLedgerId)).toEqual([k1.id, k2.id]);
  });

  it("dua baris bank, SATU baris kas ⇒ diperebutkan — baris kas tak dipakai dua kali", () => {
    const k1 = kas({ amountSen: nominal, keterangan: "KURANG BAYAR 8800123" });
    const u = usulkanSemua(
      [mutasi({ amountSen: nominal, dokRef: "8800123" }), mutasi({ amountSen: nominal, dokRef: "8800123" })],
      ktx({ kas: [k1] }),
    );
    expect(u.every((x) => x.jenis === "banyak" && x.tanda === "diperebutkan")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Setoran jemputan (AE11)
// ---------------------------------------------------------------------------

describe("kredit SETORAN JEMPUTAN ↔ setoran pengawas yang disetujui", () => {
  const nominal = rp(250_000_000);
  const jemputan = (over: Partial<MutasiCocok> = {}) =>
    mutasi({ keterangan: "KR OTOMATIS | SETORAN JEMPUTAN | 0981 / STR030327", amountSen: nominal, ...over });
  const setoran = (over: Partial<KasCocok> = {}) =>
    kas({ categoryLabel: "Setoran Hasil Penjualan", amountSen: nominal, businessDate: "2026-09-02", ...over });

  it("Covers AE11: setoran 2 Sep + jemputan bertanggal bank 3 Sep, satu kandidat ⇒ tunggal", () => {
    const s = setoran();
    const u = usulkanCocok(jemputan(), ktx({ kas: [s] }));
    expect(u).toMatchObject({ jenis: "tunggal", kandidat: [{ cashLedgerId: s.id, aturan: "setoran-jemputan" }] });
    // Murni: usulan hanya menunjuk — tanggal baris setoran tak disentuh.
    expect(s.businessDate).toBe("2026-09-02");
  });

  it("jendela [tanggal bank − 3, tanggal bank]: −3 masuk, −4 dan +1 tidak", () => {
    expect(usulkanCocok(jemputan(), ktx({ kas: [setoran({ businessDate: "2026-08-31" })] })).jenis).toBe("tunggal");
    expect(usulkanCocok(jemputan(), ktx({ kas: [setoran({ businessDate: "2026-08-30" })] })).jenis).toBe("tanpa");
    expect(usulkanCocok(jemputan(), ktx({ kas: [setoran({ businessDate: "2026-09-04" })] })).jenis).toBe("tanpa");
  });

  it("dua setoran bernominal sama dalam jendela ⇒ banyak, tidak otomatis", () => {
    const u = usulkanCocok(jemputan(), ktx({ kas: [setoran(), setoran({ businessDate: "2026-09-01" })] }));
    expect(u.jenis).toBe("banyak");
    expect(u.kandidat).toHaveLength(2);
  });

  it("rekening lain, nominal lain, kategori lain, void, saldo awal, atau sudah dicocokkan ⇒ bukan kandidat", () => {
    const sudah = setoran();
    const u = usulkanCocok(
      jemputan(),
      ktx({
        kas: [
          setoran({ accountId: BCA2 }),
          setoran({ amountSen: nominal + 1 }),
          setoran({ categoryLabel: "Lain-lain" }),
          setoran({ void: true }),
          setoran({ saldoAwal: true }),
          sudah,
        ],
        kasDicocokkan: new Set([sudah.id]),
      }),
    );
    expect(u.jenis).toBe("tanpa");
  });
});

// ---------------------------------------------------------------------------
// Ketikan manual & kaki antar unit (AE4)
// ---------------------------------------------------------------------------

describe("ketikan manual & kaki antar unit — rekening, tanda, nominal, tanggal asal sama", () => {
  const nominal = -rp(150_000_000);

  it("Covers AE4: ketikan manual 1 Sep + baris impor sama ⇒ tunggal (bank tak dikurangi dua kali)", () => {
    const k = kas({ amountSen: nominal, businessDate: "2026-09-01" });
    const u = usulkanCocok(mutasi({ amountSen: nominal, tanggalBank: "2026-09-01" }), ktx({ kas: [k] }));
    expect(u).toMatchObject({ jenis: "tunggal", kandidat: [{ cashLedgerId: k.id, aturan: "ketikan" }] });
  });

  it("tanggal ASAL yang dipakai, bukan hari buku (baris terdorong maju)", () => {
    const maju = kas({ amountSen: nominal, businessDate: "2026-09-04", tanggalAsal: "2026-09-01" });
    expect(usulkanCocok(mutasi({ amountSen: nominal, tanggalBank: "2026-09-01" }), ktx({ kas: [maju] })).jenis).toBe("tunggal");
    expect(usulkanCocok(mutasi({ amountSen: nominal, tanggalBank: "2026-09-04" }), ktx({ kas: [maju] })).jenis).toBe("tanpa");
  });

  it("tanda berlawanan atau tanggal beda ⇒ bukan kandidat", () => {
    const u = usulkanCocok(
      mutasi({ amountSen: nominal, tanggalBank: "2026-09-01" }),
      ktx({ kas: [kas({ amountSen: -nominal, businessDate: "2026-09-01" }), kas({ amountSen: nominal, businessDate: "2026-09-02" })] }),
    );
    expect(u.jenis).toBe("tanpa");
  });

  it("kaki antar unit yang sudah dicatat ⇒ cocok sebagai kaki antar unit", () => {
    const kaki = kas({ amountSen: -rp(50_000_000), categoryLabel: "Hutang Piutang", pasanganUuid: "pas-1" });
    const u = usulkanCocok(
      mutasi({ amountSen: -rp(50_000_000), keterangan: "TRSF E-BANKING DB | 0303/FTSCY/WS99999 | 1112223334 SOLA PETRA ABADI PT" }),
      ktx({ kas: [kaki] }),
    );
    expect(u).toMatchObject({ jenis: "tunggal", kandidat: [{ cashLedgerId: kaki.id, aturan: "antar-unit" }] });
  });

  it("baris kas yang lahir dari kelompok lain (sudah dibatalkan) tak pernah jadi kandidat", () => {
    const yatim = kas({ amountSen: nominal, businessDate: "2026-09-01", lahirDariCocokId: "g-lama" });
    expect(usulkanCocok(mutasi({ amountSen: nominal, tanggalBank: "2026-09-01" }), ktx({ kas: [yatim] })).jenis).toBe("tanpa");
  });
});

// ---------------------------------------------------------------------------
// EDC
// ---------------------------------------------------------------------------

describe("kredit EDC ↔ kaki bank pencairan EDC (net)", () => {
  const net = rp(12_345_600);
  const kredit = (over: Partial<MutasiCocok> = {}) =>
    mutasi({ keterangan: "KR OTOMATIS | MID : 000000000001 | 0998 / SPBU CONTOH", amountSen: net, ...over });
  const kaki = (over: Partial<KasCocok> = {}) =>
    kas({ amountSen: net, categoryLabel: "Pindah Buku", edcSettlementId: "s-1", edcSettlementDate: "2026-09-02", businessDate: "2026-09-02", ...over });

  it("net = kredit, settlement dalam [0, +3] ⇒ tunggal", () => {
    const k = kaki();
    expect(usulkanCocok(kredit(), ktx({ kas: [k] }))).toMatchObject({
      jenis: "tunggal",
      kandidat: [{ cashLedgerId: k.id, aturan: "edc" }],
    });
  });

  it("settlement di luar jendela ⇒ tanpa (tanggal settlement, bukan hari buku, yang dinilai)", () => {
    expect(usulkanCocok(kredit(), ktx({ kas: [kaki({ edcSettlementDate: "2026-08-30", businessDate: "2026-09-03" })] })).jenis).toBe("tanpa");
  });

  it("kaki EDC tak pernah jadi kandidat ketikan bagi kredit non-EDC bernominal & bertanggal sama", () => {
    expect(usulkanCocok(mutasi({ amountSen: net, tanggalBank: "2026-09-02" }), ktx({ kas: [kaki()] })).jenis).toBe("tanpa");
  });
});

// ---------------------------------------------------------------------------
// Pindah buku antar rekening SENDIRI
// ---------------------------------------------------------------------------

describe("pindah buku sendiri — nomor rekening terdaftar di unit yang sama, bukan nama pemegang", () => {
  const x = rp(25_000_000);

  it("debit ke rekening unit ini sendiri + kaki Pindah Buku tercatat di kedua rekening ⇒ tunggal sebagai pindah buku sendiri", () => {
    const kakiKeluar = kas({ amountSen: -x, categoryLabel: "Pindah Buku" });
    const kakiMasuk = kas({ amountSen: x, categoryLabel: "Pindah Buku", accountId: BCA2 });
    const u = usulkanCocok(
      mutasi({ amountSen: -x, keterangan: "TRSF E-BANKING DB | 0303/FTSCY/WS99999 | 9876543210 SOLA PETRA ABADI PT" }),
      ktx({ kas: [kakiKeluar, kakiMasuk] }),
    );
    expect(u).toMatchObject({ jenis: "tunggal", kandidat: [{ cashLedgerId: kakiKeluar.id, aturan: "pindah-buku-sendiri" }] });
  });

  it("nomor rekening berawalan nol tetap dikenali", () => {
    const kakiKeluar = kas({ amountSen: -x, categoryLabel: "Pindah Buku" });
    const kakiMasuk = kas({ amountSen: x, categoryLabel: "Pindah Buku", accountId: BCA2 });
    const u = usulkanCocok(
      mutasi({ amountSen: -x, keterangan: "TRSF E-BANKING DB | 09876543210 PT CONTOH" }),
      ktx({ kas: [kakiKeluar, kakiMasuk] }),
    );
    expect(u.kandidat[0]?.aturan).toBe("pindah-buku-sendiri");
  });

  it("debit BK → rekening unit LAIN atas nama 'SOLA PETRA ABADI PT' ⇒ BUKAN pindah buku sendiri", () => {
    // Pemegangnya sama, rekeningnya terdaftar di unit lain (tak ada di daftar unit ini).
    // Kaki Pindah Buku 'lawan' yang kebetulan ada di BCA2 tidak dipakai sebagai bukti.
    const kakiKeluar = kas({ amountSen: -x, categoryLabel: "Pindah Buku" });
    const kakiLain = kas({ amountSen: x, categoryLabel: "Pindah Buku", accountId: BCA2 });
    const u = usulkanCocok(
      mutasi({ amountSen: -x, keterangan: "TRSF E-BANKING DB | 0303/FTSCY/WS99999 | 1112223334 SOLA PETRA ABADI PT" }),
      ktx({ kas: [kakiKeluar, kakiLain] }),
    );
    expect(u.kandidat.map((k) => k.aturan)).not.toContain("pindah-buku-sendiri");
    expect(u.tanda).not.toBe("kaki-pasangan-belum-dicatat");
  });

  it("pindah buku sendiri tanpa kaki pasangan di rekening seberang ⇒ tanpa, ditandai", () => {
    const u = usulkanCocok(mutasi({ amountSen: -x, keterangan: "TRSF E-BANKING DB | 9876543210 PT CONTOH" }), ktx());
    expect(u).toMatchObject({ jenis: "tanpa", tanda: "kaki-pasangan-belum-dicatat" });
  });
});

// ---------------------------------------------------------------------------
// Baris yang tak pernah dicocokkan
// ---------------------------------------------------------------------------

describe("baris impor yang tak pernah dicocokkan", () => {
  it("pra-cut-over, rekening koran ditarik, atau sudah di kelompok aktif ⇒ tanpa, ditandai", () => {
    const k = kas();
    const c = ktx({ kas: [k] });
    expect(usulkanCocok(mutasi({ praCutover: true }), c)).toMatchObject({ jenis: "tanpa", tanda: "pra-cutover" });
    expect(usulkanCocok(mutasi({ rkStatus: "ditarik" }), c)).toMatchObject({ jenis: "tanpa", tanda: "ditarik" });
    const m = mutasi();
    expect(usulkanCocok(m, { ...c, mutasiDicocokkan: new Set([m.id]) })).toMatchObject({ jenis: "tanpa", tanda: "sudah-dicocokkan" });
  });
});

// ---------------------------------------------------------------------------
// Kelompok manual N:M (KTD6)
// ---------------------------------------------------------------------------

describe("periksaKelompokManual — Σ baris bank = Σ baris buku, tepat Rp 0", () => {
  const korcpu = () => mutasi({ amountSen: -rp(50_000), keterangan: "KORCPU" });
  const jemput = () => mutasi({ amountSen: rp(325_000_000), keterangan: "KR OTOMATIS | SETORAN JEMPUTAN" });
  const s1 = () => kas({ amountSen: rp(200_000_000), categoryLabel: "Setoran Hasil Penjualan" });

  it("KORCPU −50.000 + jemputan 325.000.000 ↔ dua setoran Σ 324.950.000 ⇒ diterima", () => {
    const r = periksaKelompokManual({ mutasi: [korcpu(), jemput()], kas: [s1(), kas({ amountSen: rp(124_950_000) })] }, ktx());
    expect(r).toEqual({ ok: true, totalSen: rp(324_950_000) });
  });

  it("Σ ≠ 0 (kurang satu sen) ⇒ ditolak dengan selisihnya", () => {
    const r = periksaKelompokManual({ mutasi: [korcpu(), jemput()], kas: [s1(), kas({ amountSen: rp(124_950_000) - 1 })] }, ktx());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Rp 0,01/);
  });

  it("Σ sama tetapi baris kas di rekening yang tak ada baris banknya ⇒ ditolak", () => {
    const r = periksaKelompokManual({ mutasi: [mutasi({ amountSen: rp(10) })], kas: [kas({ amountSen: rp(10), accountId: BCA2 })] }, ktx());
    expect(r.ok).toBe(false);
  });

  it("tanpa baris bank, baris ganda, anggota sudah di kelompok aktif, pra-cut-over, void ⇒ ditolak", () => {
    const m = mutasi({ amountSen: rp(10) });
    const k = kas({ amountSen: rp(10) });
    expect(periksaKelompokManual({ mutasi: [], kas: [k] }, ktx()).ok).toBe(false);
    expect(periksaKelompokManual({ mutasi: [m, m], kas: [k, k] }, ktx()).ok).toBe(false);
    expect(periksaKelompokManual({ mutasi: [m], kas: [k] }, ktx({ kasDicocokkan: new Set([k.id]) })).ok).toBe(false);
    expect(periksaKelompokManual({ mutasi: [m], kas: [k] }, ktx({ mutasiDicocokkan: new Set([m.id]) })).ok).toBe(false);
    expect(periksaKelompokManual({ mutasi: [{ ...m, praCutover: true }], kas: [k] }, ktx()).ok).toBe(false);
    expect(periksaKelompokManual({ mutasi: [m], kas: [{ ...k, void: true }] }, ktx()).ok).toBe(false);
    expect(periksaKelompokManual({ mutasi: [m], kas: [k] }, ktx()).ok).toBe(true);
  });

  it("satu SO dibayar dua debit ↔ satu baris kas Gross (2:1) ⇒ diterima; SO lain ⇒ ditolak (tak ada cocok silang)", () => {
    const k = kas({ amountSen: -rp(300) });
    const c = ktx({ penebusan: [{ id: "p", noSo: "so-1", cashLedgerId: k.id }] });
    const ok = periksaKelompokManual({ mutasi: [mutasi({ amountSen: -rp(100), so: "SO-1" }), mutasi({ amountSen: -rp(200), so: "so-1" })], kas: [k] }, c);
    expect(ok.ok).toBe(true);
    const silang = periksaKelompokManual({ mutasi: [mutasi({ amountSen: -rp(300), so: "so-2" })], kas: [k] }, c);
    expect(silang.ok).toBe(false);
  });
});
