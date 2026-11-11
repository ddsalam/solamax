import { describe, expect, it } from "vitest";
import { jurnalKas, type BarisJurnal, type BarisKas } from "./buku-besar-model";
import { barisBuku, barisSistemDari, PENJELASAN_BARIS_SISTEM, type AkunKas } from "./keuangan-kas-model";
import {
  CATATAN_KAKI_PINDAH_BUKU,
  kakiTransferTerlewat,
  kandidatJadikanTransfer,
  rencanaTransfer,
  vonisBatalTransfer,
  vonisJadikanTransfer,
  type BarisBankKoreksi,
  type BarisKasBesar,
  type HariKaki,
} from "./transfer-kas-model";

const KAS: AkunKas = { id: "akun-kas", nama: "Kas Besar", kind: "kas", active: true };
const BCA: AkunKas = { id: "akun-bca", nama: "BCA …6811", kind: "bank", active: true };
const EDC: AkunKas = { id: "akun-edc", nama: "EDC Penampungan", kind: "edc_penampungan", active: true };
const KUNCI = "6f1c0b8e-2a4d-4c3b-9e1f-0a2b3c4d5e6f";
const T = "2026-10-22";
const buka = (d = T): HariKaki => ({ status: "dibukukan", hariBuku: d, perluKodeAlasan: false });
const maju = (d: string): HariKaki => ({ status: "dibukukan", hariBuku: d, perluKodeAlasan: true });

const dasar = {
  amount: 399_979_000,
  keterangan: "Setoran ke Bank 2026-10-22",
  tanggal: T,
  kunci: KUNCI,
  akunKas: KAS,
  akunBank: BCA,
  hariKas: buka(),
  hariBank: buka(),
};

describe("rencanaTransfer — dua kaki, kategori ditetapkan server (R3, R4, KTD2)", () => {
  it("jalur bahagia: Kas Besar −X 'Setoran ke Bank' (kredit), bank +X 'Pindah Buku' (debet), satu hari buku", () => {
    const r = rencanaTransfer(dasar);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rencana).toEqual({
      hariBuku: T,
      maju: false,
      kas: { accountId: "akun-kas", jenis: "kredit", kategori: "Setoran ke Bank", amountSen: -39_997_900_000 },
      bank: { accountId: "akun-bca", jenis: "debet", kategori: "Pindah Buku", amountSen: 39_997_900_000 },
    });
  });

  it.each([
    ["nol", 0],
    ["negatif", -5_000],
    ["tiga desimal", 10.001],
  ])("nominal %s ditolak", (_n, amount) => {
    const r = rencanaTransfer({ ...dasar, amount });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Nominal transfer harus angka rupiah positif/);
  });

  it("keterangan kosong ditolak", () => {
    const r = rencanaTransfer({ ...dasar, keterangan: "   " });
    expect(r).toEqual({ ok: false, error: "Keterangan wajib diisi." });
  });

  it("kunci idempotensi bukan UUID ditolak", () => {
    expect(rencanaTransfer({ ...dasar, kunci: "abc" }).ok).toBe(false);
  });

  it.each([
    ["Kas Besar sendiri", KAS],
    ["EDC Penampungan", EDC],
  ])("tujuan %s ditolak — hanya rekening bank", (_n, akunBank) => {
    const r = rencanaTransfer({ ...dasar, akunBank });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/harus rekening bank/);
  });

  it("rekening bank nonaktif ditolak", () => {
    expect(rencanaTransfer({ ...dasar, akunBank: { ...BCA, active: false } }).ok).toBe(false);
  });

  it("sumber bukan Kas Besar ditolak", () => {
    expect(rencanaTransfer({ ...dasar, akunKas: BCA }).ok).toBe(false);
    expect(rencanaTransfer({ ...dasar, akunKas: null }).ok).toBe(false);
  });

  it("pra-cut-over salah satu kaki ditolak", () => {
    const r = rencanaTransfer({ ...dasar, hariBank: { status: "pra-cut-over", cutOver: "2026-10-01" } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/mendahului saldo pembuka \(2026-10-01\)/);
  });

  it("🔴 hari buku kedua kaki berbeda ⇒ ditolak (1190 tak boleh tertinggal)", () => {
    const r = rencanaTransfer({ ...dasar, hariKas: maju("2026-10-23"), hariBank: buka() });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/berbeda/);
  });

  it("hari tertutup ⇒ kedua kaki maju bersama, ditandai maju (ADJ-FWD-TRANSFER di inti tulis)", () => {
    const r = rencanaTransfer({ ...dasar, hariKas: maju("2026-10-23"), hariBank: maju("2026-10-23") });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.rencana.hariBuku).toBe("2026-10-23");
      expect(r.rencana.maju).toBe(true);
    }
  });
});

describe("hasil jurnal — P6 lewat 1190, TANPA 1103 (R5)", () => {
  const baris = (o: Partial<BarisKas> & Pick<BarisKas, "id" | "accountId" | "amountSen" | "kategori">): BarisKas => ({
    keterangan: "Setoran ke Bank",
    tanggalAsal: null,
    edcSettlementId: null,
    pasanganUuid: null,
    pihakLawanJenis: null,
    tertaut: [],
    penebusan: null,
    ...o,
  });
  const saldo = (b: readonly BarisJurnal[]): Record<string, number> => {
    const s: Record<string, number> = {};
    for (const x of b) s[x.posKode] = (s[x.posKode] ?? 0) + x.debetSen - x.kreditSen;
    for (const k of Object.keys(s)) if (s[k] === 0) delete s[k];
    return s;
  };

  it("kedua kaki rencana: 1101 Cr X, 1111 Dr X, 1190 net 0, tak ada baris 1103", () => {
    const r = rencanaTransfer(dasar);
    if (!r.ok) throw new Error(r.error);
    const kas = jurnalKas(T, baris({ id: "k", accountId: "akun-kas", amountSen: r.rencana.kas.amountSen, kategori: r.rencana.kas.kategori }), "1101");
    const bank = jurnalKas(T, baris({ id: "b", accountId: "akun-bca", amountSen: r.rencana.bank.amountSen, kategori: r.rencana.bank.kategori }), "1111");
    const semua = [...kas.jurnal!.baris, ...bank.jurnal!.baris];
    expect(saldo(semua)).toEqual({ "1101": -39_997_900_000, "1111": 39_997_900_000 });
    expect(semua.some((x) => x.posKode === "1103")).toBe(false);
    expect(semua.filter((x) => x.posKode === "1190")).toHaveLength(2);
  });

  it("pembanding: kaki bank berlabel 'Setoran Hasil Penjualan' mengkredit 1103 (akar kesalahan)", () => {
    const bank = jurnalKas(T, baris({ id: "b", accountId: "akun-bca", amountSen: 39_997_900_000, kategori: "Setoran Hasil Penjualan" }), "1111");
    expect(saldo(bank.jurnal!.baris)["1103"]).toBe(-39_997_900_000);
  });
});

const kasRow = (o: Partial<BarisKasBesar> & Pick<BarisKasBesar, "id" | "amountSen">): BarisKasBesar => ({
  tanggal: T,
  kategori: "Setoran ke Bank",
  transferUuid: null,
  void: false,
  ...o,
});

describe("kakiTransferTerlewat — penjaga tab bank (R13, KTD8)", () => {
  const baru = { accountKind: "bank", jenis: "debet", kategori: "Setoran Hasil Penjualan", amountSen: 50_000_00, tanggal: T };

  it("kena: tanggal & nominal sama dengan kaki keluar Kas Besar bebas", () => {
    expect(kakiTransferTerlewat(baru, [kasRow({ id: "k1", amountSen: -50_000_00 })])).toBe(true);
  });
  it("kaki Kas Besar 'Pindah Buku' lama juga dihitung", () => {
    expect(kakiTransferTerlewat(baru, [kasRow({ id: "k1", amountSen: -50_000_00, kategori: "Pindah Buku" })])).toBe(true);
  });
  it("meleset: beda 1 sen", () => {
    expect(kakiTransferTerlewat(baru, [kasRow({ id: "k1", amountSen: -50_000_01 })])).toBe(false);
  });
  it("meleset: kaki Kas Besar sudah bertaut transfer", () => {
    expect(kakiTransferTerlewat(baru, [kasRow({ id: "k1", amountSen: -50_000_00, transferUuid: KUNCI })])).toBe(false);
  });
  it("meleset: debet Kas Besar (bukan kaki keluar)", () => {
    expect(kakiTransferTerlewat(baru, [kasRow({ id: "k1", amountSen: 50_000_00, kategori: "Setoran Hasil Penjualan" })])).toBe(false);
  });
  it("meleset: kaki Kas Besar void / tanggal lain", () => {
    expect(kakiTransferTerlewat(baru, [kasRow({ id: "k1", amountSen: -50_000_00, void: true })])).toBe(false);
    expect(kakiTransferTerlewat(baru, [kasRow({ id: "k1", amountSen: -50_000_00, tanggal: "2026-10-21" })])).toBe(false);
  });
  it("tak pernah memeriksa tab Kas Besar, kategori lain, atau kredit", () => {
    const kas = [kasRow({ id: "k1", amountSen: -50_000_00 })];
    expect(kakiTransferTerlewat({ ...baru, accountKind: "kas" }, kas)).toBe(false);
    expect(kakiTransferTerlewat({ ...baru, kategori: "Pindah Buku" }, kas)).toBe(false);
    expect(kakiTransferTerlewat({ ...baru, jenis: "kredit", amountSen: -50_000_00 }, kas)).toBe(false);
  });
});

describe("kandidatJadikanTransfer — daftar koreksi (R15)", () => {
  const bankRow = (o: Partial<BarisBankKoreksi> & Pick<BarisBankKoreksi, "id" | "amountSen">): BarisBankKoreksi => ({
    accountId: "akun-bca",
    tanggal: T,
    kategori: "Setoran Hasil Penjualan",
    transferUuid: null,
    void: false,
    dibuat: "2026-10-29T10:00:00Z",
    ...o,
  });

  it("satu kaki Kas Besar cocok ⇒ siap; terlama dulu", () => {
    const r = kandidatJadikanTransfer(
      [bankRow({ id: "b2", amountSen: 200, tanggal: "2026-10-03" }), bankRow({ id: "b1", amountSen: 100, tanggal: "2026-10-02" })],
      [kasRow({ id: "k1", amountSen: -100, tanggal: "2026-10-02" }), kasRow({ id: "k2", amountSen: -200, tanggal: "2026-10-03" })],
    );
    expect(r.siap.map((s) => [s.bank.id, s.kas.id])).toEqual([["b1", "k1"], ["b2", "k2"]]);
    expect(r.periksaManual).toEqual([]);
  });

  it("dua kaki Kas Besar bernominal sama di hari itu ⇒ periksa manual, tanpa tombol", () => {
    const r = kandidatJadikanTransfer([bankRow({ id: "b1", amountSen: 100 })], [kasRow({ id: "k1", amountSen: -100 }), kasRow({ id: "k2", amountSen: -100 })]);
    expect(r.siap).toEqual([]);
    expect(r.periksaManual[0]!.alasan).toMatch(/2 kaki keluar Kas Besar/);
  });

  it("tanpa kaki Kas Besar ⇒ periksa manual (setoran langsung: Imam Bonjol, Adisucipto, Bakau 1 Okt)", () => {
    const r = kandidatJadikanTransfer([bankRow({ id: "b1", amountSen: 17_034_100_000 })], []);
    expect(r.siap).toEqual([]);
    expect(r.periksaManual[0]!.alasan).toMatch(/Tak ada kaki keluar Kas Besar/);
  });

  it("satu kaki Kas Besar diperebutkan dua baris bank ⇒ keduanya periksa manual", () => {
    const r = kandidatJadikanTransfer([bankRow({ id: "b1", amountSen: 100 }), bankRow({ id: "b2", amountSen: 100 })], [kasRow({ id: "k1", amountSen: -100 })]);
    expect(r.siap).toEqual([]);
    expect(r.periksaManual).toHaveLength(2);
  });

  it("yang sudah bertaut / void / kategori lain tidak tampil", () => {
    const r = kandidatJadikanTransfer(
      [
        bankRow({ id: "b1", amountSen: 100, transferUuid: KUNCI }),
        bankRow({ id: "b2", amountSen: 100, void: true }),
        bankRow({ id: "b3", amountSen: 100, kategori: "Pindah Buku" }),
      ],
      [kasRow({ id: "k1", amountSen: -100 })],
    );
    expect(r).toEqual({ siap: [], periksaManual: [] });
  });

  it("baris bank dari setoran pengawas yang disetujui ⇒ periksa manual, walau ada kaki Kas Besar sama", () => {
    const r = kandidatJadikanTransfer([bankRow({ id: "b1", amountSen: 100, dariSetoranPengawas: true })], [kasRow({ id: "k1", amountSen: -100 })]);
    expect(r.siap).toEqual([]);
    expect(r.periksaManual[0]!.alasan).toMatch(/setoran pengawas/);
  });

  it("kaki Kas Besar 'Pindah Buku' lama ⇒ siap, dengan catatan aturan cocok 6", () => {
    const r = kandidatJadikanTransfer([bankRow({ id: "b1", amountSen: 100 })], [kasRow({ id: "k1", amountSen: -100, kategori: "Pindah Buku" })]);
    expect(r.siap[0]!.catatan).toBe(CATATAN_KAKI_PINDAH_BUKU);
  });
});

describe("vonis pembatalan & koreksi (R11, R17)", () => {
  const dua = [{ void: false }, { void: false }];
  it("boleh dibatalkan bila dua kaki hidup, tak dicocokkan, hari & bulan terbuka", () => {
    expect(vonisBatalTransfer({ legs: dua, dicocokkan: false, hariTutup: false, bulanTutup: false })).toBeNull();
  });
  it.each([
    ["dicocokkan", { dicocokkan: true }, /cocok/],
    ["hari tutup", { hariTutup: true }, /sudah ditutup/],
    ["bulan tutup", { bulanTutup: true }, /Bulan ini sudah ditutup/],
  ])("ditolak bila %s", (_n, o, pola) => {
    expect(vonisBatalTransfer({ legs: dua, dicocokkan: false, hariTutup: false, bulanTutup: false, ...o })).toMatch(pola);
  });
  it("kaki void / kurang dari dua ⇒ ditolak", () => {
    expect(vonisBatalTransfer({ legs: [{ void: false }], dicocokkan: false, hariTutup: false, bulanTutup: false })).toMatch(/tak ditemukan/);
    expect(vonisBatalTransfer({ legs: [{ void: true }, { void: false }], dicocokkan: false, hariTutup: false, bulanTutup: false })).toMatch(/tak ditemukan/);
  });

  const j = { bulanTutup: false, hariTutup: false, dicocokkan: false, bolehHariTutup: false, alasan: "" };
  it("jadikan transfer: hari terbuka boleh tanpa alasan", () => {
    expect(vonisJadikanTransfer(j)).toBeNull();
  });
  it("jadikan transfer: hari tertutup ⇒ keuangan ditolak (butuh HoF); HoF tanpa alasan ditolak; HoF beralasan boleh", () => {
    expect(vonisJadikanTransfer({ ...j, hariTutup: true })).toMatch(/Head of Finance/);
    expect(vonisJadikanTransfer({ ...j, hariTutup: true, bolehHariTutup: true })).toMatch(/alasan koreksi wajib/);
    expect(vonisJadikanTransfer({ ...j, hariTutup: true, bolehHariTutup: true, alasan: "Ref REPORT6" })).toBeNull();
  });
  it("jadikan transfer: bulan tertutup / dicocokkan ⇒ ditolak, siapa pun", () => {
    expect(vonisJadikanTransfer({ ...j, bulanTutup: true, bolehHariTutup: true, alasan: "x" })).toMatch(/Bulan/);
    expect(vonisJadikanTransfer({ ...j, dicocokkan: true })).toMatch(/dicocokkan/);
  });
});

describe("baris sistem 'transfer' (R10)", () => {
  it("barisSistemDari mengenali kaki transfer; penjelasannya menunjuk 'Batalkan transfer'", () => {
    expect(barisSistemDari({ saldoAwal: false, transfer: true })).toBe("transfer");
    expect(barisSistemDari({ saldoAwal: false })).toBeNull();
    expect(PENJELASAN_BARIS_SISTEM.transfer).toMatch(/Batalkan transfer/);
  });

  it("barisBuku menandai kaki bertransfer_uuid sebagai baris sistem dan meneruskan kuncinya", () => {
    const mutasi = [
      { id: "a", accountId: "akun-kas", businessDate: T, jenis: "kredit" as const, categorySide: "kredit" as const, categoryLabel: "Setoran ke Bank", amount: -100, saldoAwal: false, void: false, keterangan: "x", transferUuid: KUNCI },
      { id: "b", accountId: "akun-kas", businessDate: T, jenis: "kredit" as const, categorySide: "kredit" as const, categoryLabel: "Setoran ke Bank", amount: -50, saldoAwal: false, void: false, keterangan: "y", transferUuid: null },
    ];
    const b = barisBuku(mutasi, "akun-kas", T, "2026-10-21");
    expect(b.map((x) => [x.barisSistem, x.transferUuid])).toEqual([["transfer", KUNCI], [null, null]]);
  });
});
