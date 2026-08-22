import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AMBANG_DORMAN_HARI,
  dorman,
  keadaanPakai,
  kandidatAktifkanKembali,
  NAMA_BAKU,
  periksaNama,
  periksaNonaktif,
  PESAN_SALAH_NAMA,
  type AkunKasRow,
  type KonteksNama,
} from "./keuangan-akun-model";

const a = (o: Partial<AkunKasRow> = {}): AkunKasRow => ({
  id: "a1",
  nama: "Bank BCA - 5125036811",
  kind: "bank",
  active: true,
  closedAt: null,
  nMutasi: 0,
  mutasiTerakhir: "2026-08-15",
  ...o,
});

const ctx = (o: Partial<KonteksNama> = {}): KonteksNama => ({
  kind: "bank",
  namaUnit: "Bakau",
  akun: [],
  ...o,
});

describe("dorman — TURUNAN, bukan keadaan yang disimpan (§10.18)", () => {
  it("dipakai baru-baru ini ⇒ tidak dorman", () => {
    expect(dorman({ active: true, mutasiTerakhir: "2026-08-15" }, "2026-08-18")).toBe(false);
  });

  it("🔴 diam melewati ambang ⇒ dorman, TANPA kolom baru", () => {
    expect(dorman({ active: true, mutasiTerakhir: "2026-01-01" }, "2026-08-18")).toBe(true);
  });

  it("🔴 begitu dipakai lagi, tandanya HILANG SENDIRI", () => {
    // Inti keputusan §10.18: keadaan yang disimpan butuh seseorang mengubahnya;
    // turunan tidak. Baris ini yang membedakan keduanya.
    const lama = { active: true, mutasiTerakhir: "2026-01-01" };
    expect(dorman(lama, "2026-08-18")).toBe(true);
    const dipakaiLagi = { active: true, mutasiTerakhir: "2026-08-17" };
    expect(dorman(dipakaiLagi, "2026-08-18")).toBe(false);
  });

  it("tepat DI ambang sudah dorman; sehari sebelumnya belum — daya-beda", () => {
    const asOf = "2026-08-18";
    const tepat = new Date(Date.parse(`${asOf}T00:00:00Z`) - AMBANG_DORMAN_HARI * 86_400_000)
      .toISOString().slice(0, 10);
    const kurangSehari = new Date(Date.parse(`${asOf}T00:00:00Z`) - (AMBANG_DORMAN_HARI - 1) * 86_400_000)
      .toISOString().slice(0, 10);
    expect(dorman({ active: true, mutasiTerakhir: tepat }, asOf)).toBe(true);
    expect(dorman({ active: true, mutasiTerakhir: kurangSehari }, asOf)).toBe(false);
  });

  it("🔴 belum pernah dipakai BUKAN dorman — dua fakta berbeda (22 Agu 2026)", () => {
    // Ditemukan pada hari pertama modul dipakai sungguhan: rekening yang BARU
    // didaftarkan langsung berlencana Dorman. `null` bukan "buruk"; ia "belum".
    const baru = { active: true, mutasiTerakhir: null };
    expect(dorman(baru, "2026-08-18")).toBe(false);
    expect(keadaanPakai(baru, "2026-08-18")).toBe("belum_pernah_dipakai");
  });

  it("🔴 SUBJEK ASLINYA tetap tertandai: rekening diam 2–5 tahun masih dorman", () => {
    // Kalau perbaikan di atas ikut memadamkan mereka, ia bukan perbaikan.
    //
    // ⚠️ Keempat tanggal ini adalah empat rekening dorman Bakau dari temuan K0
    // (§8 butir 7) — mereka hidup di WORKBOOK, bukan sebagai baris
    // `app.cash_account`. Diperiksa di produksi 22 Agu 2026: ketiga-belas
    // rekening yang ada seluruhnya `belum_pernah_dipakai`, jadi lencana dorman
    // untuk sementara TAK PUNYA SUBJEK di sana. Ia baru punya begitu mutasi
    // mulai masuk dan sebuah rekening diam ≥ 90 hari — karena itu subjeknya
    // disediakan di sini, bukan diandaikan ada di DB.
    for (const tgl of ["2024-01-10", "2022-08-18", "2021-11-23", "2021-09-23"]) {
      expect(keadaanPakai({ active: true, mutasiTerakhir: tgl }, "2026-08-18"), tgl).toBe("dorman");
    }
  });

  it("keempat keadaan saling eksklusif dan lengkap", () => {
    const asOf = "2026-08-18";
    expect(keadaanPakai({ active: false, mutasiTerakhir: null }, asOf)).toBe("tidak_aktif");
    expect(keadaanPakai({ active: true, mutasiTerakhir: null }, asOf)).toBe("belum_pernah_dipakai");
    expect(keadaanPakai({ active: true, mutasiTerakhir: "2020-01-01" }, asOf)).toBe("dorman");
    expect(keadaanPakai({ active: true, mutasiTerakhir: "2026-08-17" }, asOf)).toBe("dipakai");
  });

  it("🔴 akun TIDAK AKTIF tidak dihitung dorman — dua penanda satu keadaan bikin menebak", () => {
    expect(dorman({ active: false, mutasiTerakhir: "2020-01-01" }, "2026-08-18")).toBe(false);
  });
});

describe("periksaNama — `nama` adalah IDENTITAS (bagian kunci unik)", () => {
  it("nama bank yang benar lolos — kontrol POSITIF", () => {
    expect(periksaNama("Bank BCA - 5125036811", ctx())).toEqual([]);
  });

  it("🔴 bank TANPA nomor ditolak, dan alasannya menyebut dua BCA Bakau", () => {
    expect(periksaNama("Bank BCA", ctx())).toEqual(["bank_tanpa_nomor"]);
    expect(PESAN_SALAH_NAMA.bank_tanpa_nomor).toMatch(/DUA rekening BCA/);
  });

  it("🔴 nama memuat nama SPBU ditolak", () => {
    expect(periksaNama("Kas Besar Bakau", ctx({ kind: "kas" }))).toContain("memuat_nama_spbu");
  });

  it("🔴 Kas Besar & EDC Penampungan harus PERSIS baku", () => {
    expect(periksaNama("Kas besar", ctx({ kind: "kas" }))).toContain("baku_harus_persis");
    expect(periksaNama(NAMA_BAKU.kas, ctx({ kind: "kas" }))).toEqual([]);
    expect(periksaNama("EDC penampungan", ctx({ kind: "edc_penampungan" }))).toContain("baku_harus_persis");
    expect(periksaNama(NAMA_BAKU.edc_penampungan, ctx({ kind: "edc_penampungan" }))).toEqual([]);
  });

  it("bentrok dengan akun AKTIF bernama sama ditolak (beda huruf besar pun)", () => {
    const akun = [{ id: "x", nama: "Bank BCA - 5125036811", active: true }];
    expect(periksaNama("bank bca - 5125036811", ctx({ akun }))).toContain("sudah_ada_aktif");
  });

  it("mengubah nama akun ITU SENDIRI tidak dianggap bentrok", () => {
    const akun = [{ id: "x", nama: "Bank BCA - 5125036811", active: true }];
    expect(periksaNama("Bank BCA - 5125036811", ctx({ akun, kecualiId: "x" }))).toEqual([]);
  });

  it("baris TIDAK AKTIF bernama sama BUKAN 'sudah ada aktif' — ia jalur reaktivasi", () => {
    const akun = [{ id: "x", nama: "Bank BCA - 5125036811", active: false }];
    expect(periksaNama("Bank BCA - 5125036811", ctx({ akun }))).not.toContain("sudah_ada_aktif");
  });
});

describe("jebakan reaktivasi — kunci unik BUKAN indeks parsial", () => {
  it("🔴 menemukan baris tidak-aktif bernama sama, dan menawarkannya", () => {
    // Tanpa ini, "Tambah" ditolak kunci unik dan galatnya terbaca seperti bug.
    const akun = [{ id: "lama", nama: "Bank BCA - 5125036811", active: false }];
    expect(kandidatAktifkanKembali("Bank BCA - 5125036811", akun)).toEqual({
      id: "lama",
      nama: "Bank BCA - 5125036811",
    });
  });

  it("akun AKTIF bernama sama bukan kandidat reaktivasi — kontrol NEGATIF", () => {
    const akun = [{ id: "x", nama: "Bank BCA - 5125036811", active: true }];
    expect(kandidatAktifkanKembali("Bank BCA - 5125036811", akun)).toBeNull();
  });

  it("nama yang belum pernah ada ⇒ null", () => {
    expect(kandidatAktifkanKembali("Bank BRI - 9", [])).toBeNull();
  });
});

describe("periksaNonaktif — mutasi yang menggantung harus TERLIHAT", () => {
  it("🔴 peringatan menyebut BERAPA, dan bahwa mutasinya TETAP dihitung", () => {
    const h = periksaNonaktif(a({ nMutasi: 143 }));
    expect(h.boleh).toBe(true);
    expect(h.peringatan).toMatch(/143 mutasi/);
    expect(h.peringatan).toMatch(/tetap dihitung/);
  });

  it("tanpa mutasi ⇒ tak ada peringatan (kontrol NEGATIF)", () => {
    expect(periksaNonaktif(a({ nMutasi: 0 })).peringatan).toBeNull();
  });

  it("akun yang sudah tidak aktif tak bisa dinonaktifkan lagi", () => {
    expect(periksaNonaktif(a({ active: false })).boleh).toBe(false);
  });
});

describe("🔴 LAYARNYA ikut dipisah, bukan hanya modelnya", () => {
  const PANEL = readFileSync(
    resolve(__dirname, "../components/keuangan/AkunKasPanel.tsx"),
    "utf8",
  );

  it("panel memakai keadaanPakai, bukan menghitung dorman sendiri", () => {
    expect(PANEL).toMatch(/keadaanPakai\(a, hariIni\)/);
    // Satu pembuat vonis: panel tak boleh memanggil `dorman(` maupun menyentuh
    // ambangnya sendiri.
    expect(PANEL).not.toMatch(/\bdorman\(/);
    expect(PANEL).not.toMatch(/mutasiTerakhir === null \?/);
  });

  it("rekening BARU tidak lagi berlencana Dorman — keempat cabang ada", () => {
    for (const k of ["tidak_aktif", "belum_pernah_dipakai", "dorman"]) {
      expect(PANEL, `cabang ${k} hilang`).toContain(`"${k}"`);
    }
    // Kalimat yang menenangkan pembacanya, bukan yang menuduhnya.
    expect(PANEL).toContain("wajar untuk rekening yang baru didaftarkan");
  });
});
