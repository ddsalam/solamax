import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { canManageAccess } from "./admin-rules";
import type { Role } from "./auth-context";
import {
  alasanTakBolehInput,
  canCloseException,
  canInputKeuangan,
  canNonaktifkanAkunKas,
  PESAN_TAK_BOLEH_INPUT,
  canOverrideAboveMax,
  canViewLaporanKeuangan,
  canNonaktifkanPihakLawan,
  canTambahPihakLawan,
  canTetapkanPihakLawanBaris,
  canTetapkanSaldoAwalPihakLawan,
  canBalikPasanganAntarUnit,
  canBatalkanBarisFinance,
  canJadikanTransfer,
  canJadikanTransferHariTutup,
  canAjukanBalikBaris,
  canSetujuiBalikBaris,
  canReklasifikasi,
  canCatatAntarUnit,
  canImporRekeningKoran,
  canTarikRekeningKoran,
  canBatalkanCocokBank,
  canCocokkanBank,
  canTutupBulan,
  canKelolaSettlementEdc,
  canAturTermin,
  PESAN_TAK_BOLEH_ATUR_TERMIN,
  pesanTakBolehAturTermin,
  pesanTakBolehInput,
  canKelolaPos,
  canSetujuiMemorial,
  canIsiSaldoAwalPos,
  canUsulkanMemorial,
  isHeadOfFinance,
  type WewenangCtx,
} from "./keuangan-wewenang";

const HOF = ["ddsalam@solagroup.co"];
const ctx = (over: Partial<WewenangCtx> = {}): WewenangCtx => ({
  role: "pengawas",
  email: "orang@solagroup.co",
  ...over,
});

describe("isHeadOfFinance — fail-closed", () => {
  it("cocok apa adanya", () => {
    expect(isHeadOfFinance("ddsalam@solagroup.co", HOF)).toBe(true);
  });

  it("tidak peka huruf besar/kecil dan spasi pinggir", () => {
    expect(isHeadOfFinance("  DDSalam@SolaGroup.CO ", HOF)).toBe(true);
  });

  it("email lain bukan HoF", () => {
    expect(isHeadOfFinance("lain@solagroup.co", HOF)).toBe(false);
  });

  it("null / kosong / spasi ⇒ false", () => {
    for (const e of [null, undefined, "", "   "]) {
      expect(isHeadOfFinance(e, HOF), String(e)).toBe(false);
    }
  });

  it("daftar KOSONG ⇒ tak seorang pun HoF (env belum dipasang = fail-closed)", () => {
    // Kalau baris ini pernah merah, env yang lupa diisi berubah jadi wewenang
    // penutupan-di-luar-toleransi untuk siapa saja.
    expect(isHeadOfFinance("ddsalam@solagroup.co", [])).toBe(false);
  });
});

describe("canCloseException — kapabilitas, BUKAN peran", () => {
  it("direksi boleh", () => {
    expect(canCloseException(ctx({ role: "direksi" }), HOF)).toBe(true);
  });

  it("super_admin boleh", () => {
    expect(canCloseException(ctx({ role: "super_admin" }), HOF)).toBe(true);
  });

  it("pengawas tidak boleh", () => {
    expect(canCloseException(ctx({ role: "pengawas" }), HOF)).toBe(false);
  });

  it("admin_perusahaan SAJA tidak boleh — mengelola akses ≠ wewenang keuangan", () => {
    expect(canCloseException(ctx({ role: "admin_perusahaan", email: "lain@x.co" }), HOF)).toBe(
      false,
    );
  });

  it("HoF boleh MESKI perannya admin_perusahaan — inilah kasus nyatanya", () => {
    // ddsalam@solagroup.co = app.users id 15, peran admin_perusahaan.
    // Kalau baris ini merah, HoF telah diperlakukan sebagai peran lagi.
    expect(
      canCloseException({ role: "admin_perusahaan", email: "ddsalam@solagroup.co" }, HOF),
    ).toBe(true);
  });

  it("HoF boleh meski perannya pengawas — kapabilitas berdiri sendiri", () => {
    expect(canCloseException({ role: "pengawas", email: "ddsalam@solagroup.co" }, HOF)).toBe(true);
  });

  it("Direksi mewarisi wewenang HoF tanpa perlu ada di daftar", () => {
    expect(canCloseException({ role: "direksi", email: "bukan-hof@x.co" }, [])).toBe(true);
  });

  it("daftar HoF kosong ⇒ hanya direksi/super_admin yang lolos", () => {
    expect(canCloseException(ctx({ role: "admin_perusahaan" }), [])).toBe(false);
    expect(canCloseException(ctx({ role: "direksi" }), [])).toBe(true);
  });
});

describe("ROLE_RANK tidak boleh disentuh", () => {
  const scopeRule = readFileSync(resolve(__dirname, "scope-rule.ts"), "utf8");

  it("tangga peran persis lima, tanpa head_of_finance", () => {
    // Penjaga struktural terhadap "perbaikan" yang paling mungkin diusulkan
    // orang berikutnya. Menaruh HoF di tangga ini merusak SALAH SATU dari dua
    // hal, tergantung posisinya: cakupan data Direksi, atau wewenang HoF.
    //
    // 📌 Penjaga ini BERBUNYI saat peran `keuangan` ditambahkan (0032, 15 Agu
    // 2026) — memang itu tugasnya. Yang berubah adalah daftarnya, BUKAN
    // aturannya: `head_of_finance` tetap terlarang di sini, dan alasannya utuh
    // (pemegang HoF punya peran lain yang akan tercabut; pemegang `keuangan`
    // tidak). Memperbarui daftar tanpa memperbarui larangan = melumpuhkan
    // penjaga sambil merasa sudah memeliharanya.
    expect(scopeRule).not.toMatch(/head_of_finance/);
    const rank = scopeRule.match(/ROLE_RANK[\s\S]*?\{([\s\S]*?)\}/)?.[1] ?? "";
    const entri = [...rank.matchAll(/^\s*(\w+):\s*\d+,/gm)].map((m) => m[1]);
    expect(entri).toEqual(["pengawas", "keuangan", "direksi", "admin_perusahaan", "super_admin"]);
  });

  it("modul wewenang keuangan tidak MEMAKAI ROLE_RANK (menyebutnya boleh)", () => {
    // Bedakan menyebut dari memakai: modul ini memang MENJELASKAN kenapa
    // ROLE_RANK tak boleh disentuh, dan penjelasan itu justru harus ada.
    // Yang dilarang adalah kodenya bersandar padanya.
    const src = readFileSync(resolve(__dirname, "keuangan-wewenang.ts"), "utf8");
    const kode = src
      .split("\n")
      .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
      .join("\n");
    expect(kode).not.toMatch(/ROLE_RANK/);
    expect(kode).not.toMatch(/from "\.\/scope-rule"/);
    // …dan penjelasannya memang ada (jangan hijau karena modulnya kosong).
    expect(src).toMatch(/ROLE_RANK/);
  });

  it("peringatan 'jangan pakai canCloseException utk tingkat 3' tetap ada", () => {
    const src = readFileSync(resolve(__dirname, "keuangan-wewenang.ts"), "utf8");
    expect(src).toMatch(/JANGAN memakai `?canCloseException`?/);
  });
});

describe("canOverrideAboveMax — tingkat ketiga, BERDIRI SENDIRI", () => {
  it("direksi & super_admin boleh (keputusan owner 13 Agu 2026)", () => {
    expect(canOverrideAboveMax({ role: "direksi", email: null })).toBe(true);
    expect(canOverrideAboveMax({ role: "super_admin", email: null })).toBe(true);
  });

  it("🔴 HoF TIDAK boleh — satu-satunya suku yang membedakan dua tingkat", () => {
    expect(canOverrideAboveMax({ role: "admin_perusahaan", email: "ddsalam@solagroup.co" })).toBe(
      false,
    );
    // …sementara pada tingkat kedua ia BOLEH. Pasangan pernyataan inilah yang
    // menjaga tangganya: menyatukan dua predikat memerahkan salah satunya.
    expect(canCloseException({ role: "admin_perusahaan", email: "ddsalam@solagroup.co" }, HOF)).toBe(
      true,
    );
  });

  it("pengawas & admin_perusahaan biasa tidak boleh", () => {
    expect(canOverrideAboveMax({ role: "pengawas", email: "x@y.co" })).toBe(false);
    expect(canOverrideAboveMax({ role: "admin_perusahaan", email: "x@y.co" })).toBe(false);
  });

  it("TIDAK bersandar pada canCloseException — dua predikat, bukan turunan", () => {
    // Kalau tingkat ketiga ditulis sebagai `canCloseException(...) && ...`,
    // perubahan pada tingkat kedua akan merembes ke tingkat ketiga diam-diam.
    // 📌 Dibatasi ke BADAN FUNGSINYA, bukan "dari sini sampai akhir berkas".
    // Bentuk lama memerah saat `canInputKeuangan` — yang letaknya di BAWAH —
    // mulai memakai `isHeadOfFinance` untuk menutup irisan HoF × keuangan
    // (§10.12). Asersi itu benar isinya dan salah cakupannya; asersi bercakupan
    // satu fungsi yang tak dibatasi akan memaksa penulisnya melonggarkan
    // aturannya sampai tak menjaga apa-apa.
    const src = readFileSync(resolve(__dirname, "keuangan-wewenang.ts"), "utf8");
    const mulai = src.indexOf("export function canOverrideAboveMax");
    const badan = src.slice(mulai, src.indexOf("\n}", mulai) + 2);
    expect(badan, "fungsi canOverrideAboveMax tidak ditemukan").toMatch(/return/);
    expect(badan).not.toMatch(/canCloseException\s*\(/);
    expect(badan).not.toMatch(/isHeadOfFinance\s*\(/);
  });
});

describe("canInputKeuangan — gerbang tulis Layar 3 (peran `keuangan`, 0032)", () => {
  const c = (role: Role, email: string | null = null) => ({ role, email });

  it("peran `keuangan` boleh; `super_admin` boleh", () => {
    expect(canInputKeuangan(c("keuangan"))).toBe(true);
    expect(canInputKeuangan(c("super_admin"))).toBe(true);
  });

  it("🔴 PENGAWAS TIDAK BOLEH — ini inti §2", () => {
    // Pengawas memiliki FAKTA transaksi; Finance memiliki klasifikasi &
    // penyajian akuntansi. Pengawas yang bisa mengetik harga beli meruntuhkan
    // pemisahan itu tanpa satu pun angka terlihat salah.
    expect(canInputKeuangan(c("pengawas"))).toBe(false);
  });

  it("direksi & admin_perusahaan TIDAK boleh mengetik — wewenang ≠ tangga cakupan data", () => {
    // Inilah yang ditolak saat memilih bentuk gerbang ini: kalau hak tulis
    // keuangan menempel pada tangga peran, setiap direksi di tenant mana pun
    // otomatis boleh mengetik mutasi bank.
    expect(canInputKeuangan(c("direksi"))).toBe(false);
    expect(canInputKeuangan(c("admin_perusahaan"))).toBe(false);
  });

  it("🔴 Head of Finance TIDAK mendapat hak tulis dari kapabilitasnya", () => {
    // Mengisi buku bukan mengesahkan selisih. HoF menyetujui penutupan (§3.2);
    // memberinya hak tulis membuat penyetuju memeriksa pekerjaannya sendiri.
    const hof = "hof@solagroup.co";
    expect(isHeadOfFinance(hof, [hof])).toBe(true);
    expect(canInputKeuangan(c("admin_perusahaan", hof))).toBe(false);
    expect(canInputKeuangan(c("direksi", hof))).toBe(false);
  });

  it("🔴 peran `keuangan` TIDAK mendapat wewenang penutupan §3.2", () => {
    // Arah sebaliknya, dan sama pentingnya: yang mengetik tidak menyetujui.
    expect(canCloseException(c("keuangan"), [])).toBe(false);
    expect(canOverrideAboveMax(c("keuangan"))).toBe(false);
  });

  it("`keuangan` tidak membuka /admin", () => {
    expect(canManageAccess({ userId: 1, role: "keuangan", tenantIds: ["t"] })).toBe(false);
  });

  it("dua predikat, bukan satu — daftar perannya memang berbeda", () => {
    // Kalau kelak seseorang menulis canInputKeuangan sebagai turunan
    // canCloseException, baris ini merah: keduanya HARUS berselisih.
    const semua: Role[] = ["pengawas", "keuangan", "direksi", "admin_perusahaan", "super_admin"];
    const tulis = semua.filter((r) => canInputKeuangan(c(r)));
    const tutup = semua.filter((r) => canCloseException(c(r), []));
    expect(tulis).not.toEqual(tutup);
    expect(tulis).toEqual(["keuangan", "super_admin"]);
    expect(tutup).toEqual(["direksi", "super_admin"]);
  });
});

describe("super_admin — pengecualian pemisahan tugas yang DINYATAKAN (§10.11)", () => {
  const c = (role: Role, email: string | null = null) => ({ role, email });

  it("🔴 super_admin memang lolos KEDUA sisi — ini break-glass, bukan lubang", () => {
    // Kalau baris ini kelak merah karena seseorang "merapikan" pemisahan tugas,
    // yang ia patahkan adalah jalan pemulihan: satu-peran-per-orang membuat
    // "sementara jadi keuangan" berarti kehilangan super_admin.
    expect(canInputKeuangan(c("super_admin"))).toBe(true);
    expect(canCloseException(c("super_admin"), [])).toBe(true);
    expect(canOverrideAboveMax(c("super_admin"))).toBe(true);
  });

  it("dan ia SATU-SATUNYA yang lolos keduanya — pengecualiannya tidak melebar", () => {
    // Penjaga arah sebaliknya: pengecualian yang dinyatakan boleh ada, tetapi
    // ia harus tetap satu. Peran kedua yang ikut lolos keduanya = pemisahan
    // tugas hilang tanpa ada yang memutuskannya.
    const semua: Role[] = ["pengawas", "keuangan", "direksi", "admin_perusahaan", "super_admin"];
    const keduanya = semua.filter((r) => canInputKeuangan(c(r)) && canCloseException(c(r), []));
    expect(keduanya).toEqual(["super_admin"]);
  });

  it("pengecualiannya TERTULIS di modul, bukan hanya berlaku diam-diam", () => {
    // Pengecualian yang tersirat akan dibaca sebagai kelalaian oleh pembaca
    // berikutnya — dan pembaca yang mengira menemukan lubang akan menambalnya.
    const src = readFileSync(resolve(__dirname, "keuangan-wewenang.ts"), "utf8");
    expect(src).toMatch(/super_admin` lolos KEDUANYA/);
    expect(src).toMatch(/§10\.11/);
  });
});

describe("irisan HoF × `keuangan` — ditutup di predikatnya (§10.12)", () => {
  const HOF2 = ["hof@solagroup.co"];
  const c = (role: Role, email: string | null = null) => ({ role, email });

  it("🔴 pemegang HoF yang diberi peran `keuangan` TIDAK boleh mengetik", () => {
    // Ia sudah lolos canCloseException. Menambahkan hak tulis membuat satu
    // orang mengetik sekaligus menyetujui — tepat pada orang yang wewenang
    // persetujuannya tertinggi setelah Direksi.
    expect(canInputKeuangan(c("keuangan", "hof@solagroup.co"), HOF2)).toBe(false);
    // …tetapi hak MENYETUJUI-nya tetap. Yang dicabut yang benar.
    expect(canCloseException(c("keuangan", "hof@solagroup.co"), HOF2)).toBe(true);
  });

  it("staf keuangan biasa tidak terdampak — kontrol POSITIF", () => {
    // Tanpa baris ini, penjaga di atas juga hijau bila canInputKeuangan selalu
    // false untuk peran `keuangan`.
    expect(canInputKeuangan(c("keuangan", "staf@solagroup.co"), HOF2)).toBe(true);
    expect(canInputKeuangan(c("keuangan", null), HOF2)).toBe(true);
  });

  it("daftar HoF kosong ⇒ tak seorang pun terkecualikan (env belum dipasang)", () => {
    expect(canInputKeuangan(c("keuangan", "hof@solagroup.co"), [])).toBe(true);
  });

  it("super_admin tetap lolos meski ia HoF — break-glass §10.11 tidak tergerus", () => {
    expect(canInputKeuangan(c("super_admin", "hof@solagroup.co"), HOF2)).toBe(true);
  });

  it("alasan penolakan dibedakan, dan pesannya punya SATU sumber", () => {
    expect(alasanTakBolehInput(c("pengawas"), HOF2)).toBe("bukan_keuangan");
    expect(alasanTakBolehInput(c("keuangan", "hof@solagroup.co"), HOF2)).toBe("hof_tidak_mengetik");
    expect(alasanTakBolehInput(c("keuangan", "staf@solagroup.co"), HOF2)).toBeNull();
    // Pesannya menyebut PERBAIKANNYA, bukan hanya penolakannya.
    expect(PESAN_TAK_BOLEH_INPUT.hof_tidak_mengetik).toMatch(/menyetujui/);
    expect(PESAN_TAK_BOLEH_INPUT.hof_tidak_mengetik).toMatch(/staf Keuangan/);
  });

  it("⚠️ batasnya: ini penjagaan RUNTIME, bukan uji atas irisan yang sebenarnya", () => {
    // HoF hidup di ENV, peran hidup di DB; tak ada satu proses pun yang melihat
    // keduanya saat build. Yang bisa diuji hanyalah bahwa irisannya TIDAK
    // BERBAHAYA — bukan bahwa irisannya kosong.
    const src = readFileSync(resolve(__dirname, "keuangan-wewenang.ts"), "utf8");
    expect(src).toMatch(/penjagaan \*\*runtime\*\*/);
  });
});


describe("canViewLaporanKeuangan — gerbang BACA Layar 2 (§10.13)", () => {
  const c = (role: Role, email: string | null = null) => ({ role, email });

  it("🔴 pengawas TIDAK bisa membuka laporan keuangan", () => {
    expect(canViewLaporanKeuangan(c("pengawas"))).toBe(false);
  });

  it("keuangan, direksi, admin_perusahaan, super_admin bisa", () => {
    for (const r of ["keuangan", "direksi", "admin_perusahaan", "super_admin"] as Role[]) {
      expect(canViewLaporanKeuangan(c(r)), r).toBe(true);
    }
  });

  it("🔴 BACA ≠ TULIS — dua gerbang berbeda ke DUA arah", () => {
    // direksi: boleh membaca, tidak boleh mengisi.
    expect(canViewLaporanKeuangan(c("direksi"))).toBe(true);
    expect(canInputKeuangan(c("direksi"))).toBe(false);
    // keuangan: boleh keduanya.
    expect(canViewLaporanKeuangan(c("keuangan"))).toBe(true);
    expect(canInputKeuangan(c("keuangan"))).toBe(true);
    // Daftarnya memang harus berselisih.
    const semua: Role[] = ["pengawas", "keuangan", "direksi", "admin_perusahaan", "super_admin"];
    expect(semua.filter((r) => canViewLaporanKeuangan(c(r)))).not.toEqual(
      semua.filter((r) => canInputKeuangan(c(r))),
    );
  });

  it("HoF (admin_perusahaan) boleh MEMBACA meski tak boleh mengisi", () => {
    const hof = "hof@solagroup.co";
    expect(canViewLaporanKeuangan(c("admin_perusahaan", hof))).toBe(true);
    expect(canInputKeuangan(c("admin_perusahaan", hof), [hof])).toBe(false);
  });

  it("gerbang baca tidak MEMAKAI gerbang tulis — dua predikat, bukan turunan", () => {
    const src = readFileSync(resolve(__dirname, "keuangan-wewenang.ts"), "utf8");
    const mulai = src.indexOf("export function canViewLaporanKeuangan");
    const badan = src.slice(mulai, src.indexOf("\n}", mulai) + 2);
    expect(badan, "fungsi canViewLaporanKeuangan tidak ditemukan").toMatch(/return/);
    expect(badan).not.toMatch(/canInputKeuangan\s*\(/);
  });
});

describe("canNonaktifkanAkunKas — asimetris terhadap canInputKeuangan (§10.18)", () => {
  const HOF3 = ["hof@solagroup.co"];
  const c = (role: Role, email: string | null = null) => ({ role, email });

  it("HoF boleh menonaktifkan; super_admin boleh (break-glass)", () => {
    expect(canNonaktifkanAkunKas(c("admin_perusahaan", "hof@solagroup.co"), HOF3)).toBe(true);
    expect(canNonaktifkanAkunKas(c("super_admin"), HOF3)).toBe(true);
  });

  it("🔴 peran `keuangan` boleh MENAMBAH tapi TIDAK menonaktifkan", () => {
    // Menambah menambah sesuatu yang TERLIHAT; menonaktifkan membuat saldo
    // berhenti terlihat. Yang menghilang tidak menampakkan diri.
    expect(canInputKeuangan(c("keuangan"))).toBe(true);
    expect(canNonaktifkanAkunKas(c("keuangan"), HOF3)).toBe(false);
  });

  it("🔴 dan HoF boleh menonaktifkan tapi TIDAK menambah — asimetrinya DUA arah", () => {
    const hof = c("admin_perusahaan", "hof@solagroup.co");
    expect(canNonaktifkanAkunKas(hof, HOF3)).toBe(true);
    expect(canInputKeuangan(hof, HOF3)).toBe(false);
  });

  it("pengawas & direksi tidak boleh keduanya", () => {
    for (const r of ["pengawas", "direksi"] as Role[]) {
      expect(canNonaktifkanAkunKas(c(r), HOF3), r).toBe(false);
      expect(canInputKeuangan(c(r)), r).toBe(false);
    }
  });

  it("dua predikat, bukan satu — daftar perannya memang berselisih", () => {
    const semua: Role[] = ["pengawas", "keuangan", "direksi", "admin_perusahaan", "super_admin"];
    const hof = "hof@solagroup.co";
    const tambah = semua.filter((r) => canInputKeuangan(c(r, hof), [hof]));
    const nonaktif = semua.filter((r) => canNonaktifkanAkunKas(c(r, hof), [hof]));
    expect(tambah).not.toEqual(nonaktif);
  });

  it("alasan asimetrinya TERTULIS — supaya tak 'dirapikan' jadi satu predikat", () => {
    const src = readFileSync(resolve(__dirname, "keuangan-wewenang.ts"), "utf8");
    expect(src).toMatch(/berhenti terlihat/);
    expect(src).toMatch(/Yang menghilang tidak menampakkan diri/);
  });
});

describe("pihak lawan (U3, R26) — satu predikat per keputusan", () => {
  const HOF4 = ["hof@solagroup.co"];
  const c = (role: Role, email: string | null = null) => ({ role, email });
  const hof = c("admin_perusahaan", "hof@solagroup.co");
  const hofKeuangan = c("keuangan", "hof@solagroup.co");
  const semua: Role[] = ["pengawas", "keuangan", "direksi", "admin_perusahaan", "super_admin"];
  const ketik = [
    ["canTambahPihakLawan", canTambahPihakLawan],
    ["canNonaktifkanPihakLawan", canNonaktifkanPihakLawan],
    ["canTetapkanPihakLawanBaris", canTetapkanPihakLawanBaris],
  ] as const;

  for (const [nama, p] of ketik) {
    it(`${nama}: keuangan & super_admin; 🔴 pengawas, direksi, HoF TIDAK`, () => {
      expect(semua.filter((r) => p(c(r), HOF4))).toEqual(["keuangan", "super_admin"]);
      // HoF menyetujui, tidak mengetik — juga bila entah bagaimana berperan keuangan (§10.12).
      expect(p(hof, HOF4)).toBe(false);
      expect(p(hofKeuangan, HOF4)).toBe(false);
    });
  }

  it("🔴 canTetapkanSaldoAwalPihakLawan: HoF & super_admin; staf keuangan & pengawas TIDAK", () => {
    expect(canTetapkanSaldoAwalPihakLawan(hof, HOF4)).toBe(true);
    expect(canTetapkanSaldoAwalPihakLawan(c("super_admin"), HOF4)).toBe(true);
    for (const r of ["pengawas", "keuangan", "direksi", "admin_perusahaan"] as Role[]) {
      expect(canTetapkanSaldoAwalPihakLawan(c(r), HOF4), r).toBe(false);
    }
  });

  it("saldo pembuka berselisih dengan menambah — dua arah, seperti §10.24", () => {
    expect(canTambahPihakLawan(hof, HOF4)).toBe(false);
    expect(canTetapkanSaldoAwalPihakLawan(c("keuangan"), HOF4)).toBe(false);
    const tambah = semua.filter((r) => canTambahPihakLawan(c(r, "hof@solagroup.co"), HOF4));
    const pembuka = semua.filter((r) => canTetapkanSaldoAwalPihakLawan(c(r, "hof@solagroup.co"), HOF4));
    expect(tambah).not.toEqual(pembuka);
  });

  it("alasan beda dengan nonaktif akun kas TERTULIS — supaya tak 'dirapikan' diam-diam", () => {
    const src = readFileSync(resolve(__dirname, "keuangan-wewenang.ts"), "utf8").replace(/\n\s*\*\s*/g, " ");
    expect(src).toMatch(/pihak lawan nonaktif TETAP tampil/);
  });
});

describe("pasangan antar unit (U4; R26, R30, R31) — satu predikat per keputusan", () => {
  const HOF5 = ["hof@solagroup.co"];
  const c = (role: Role, email: string | null = null) => ({ role, email });
  const hof = c("admin_perusahaan", "hof@solagroup.co");
  const semua: Role[] = ["pengawas", "keuangan", "direksi", "admin_perusahaan", "super_admin"];

  it("🔴 canCatatAntarUnit: keuangan & super_admin; pengawas, direksi, HoF TIDAK (§10.12)", () => {
    expect(semua.filter((r) => canCatatAntarUnit(c(r), HOF5))).toEqual(["keuangan", "super_admin"]);
    expect(canCatatAntarUnit(hof, HOF5)).toBe(false);
    expect(canCatatAntarUnit(c("keuangan", "hof@solagroup.co"), HOF5)).toBe(false);
  });

  it("🔴 canBalikPasanganAntarUnit: HoF & super_admin; staf Keuangan TIDAK (R31)", () => {
    expect(canBalikPasanganAntarUnit(hof, HOF5)).toBe(true);
    expect(canBalikPasanganAntarUnit(c("super_admin"), HOF5)).toBe(true);
    for (const r of ["pengawas", "keuangan", "direksi", "admin_perusahaan"] as Role[]) {
      expect(canBalikPasanganAntarUnit(c(r), HOF5), r).toBe(false);
    }
  });

  it("yang mencatat bukan yang membalik — daftar perannya berselisih dua arah", () => {
    const catat = semua.filter((r) => canCatatAntarUnit(c(r, "hof@solagroup.co"), HOF5));
    const balik = semua.filter((r) => canBalikPasanganAntarUnit(c(r, "hof@solagroup.co"), HOF5));
    expect(catat).not.toEqual(balik);
    expect(canCatatAntarUnit(hof, HOF5)).toBe(false);
    expect(canBalikPasanganAntarUnit(c("keuangan"), HOF5)).toBe(false);
  });
});

describe("transfer Kas Besar → bank (rencana 2026-11-11 KTD7) — satu predikat per keputusan", () => {
  const HOF6 = ["hof@solagroup.co"];
  const c = (role: Role, email: string | null = null) => ({ role, email });
  const hof = c("admin_perusahaan", "hof@solagroup.co");
  const semua: Role[] = ["pengawas", "keuangan", "direksi", "admin_perusahaan", "super_admin"];

  it("🔴 catat & batalkan transfer = mengetik: canInputKeuangan (keuangan non-HoF, super_admin); HoF TIDAK", () => {
    expect(semua.filter((r) => canInputKeuangan(c(r), HOF6))).toEqual(["keuangan", "super_admin"]);
    expect(canInputKeuangan(hof, HOF6)).toBe(false);
  });

  it("🔴 canJadikanTransfer: keuangan, super_admin, DAN HoF; pengawas & direksi TIDAK", () => {
    expect(semua.filter((r) => canJadikanTransfer(c(r), HOF6))).toEqual(["keuangan", "super_admin"]);
    expect(canJadikanTransfer(hof, HOF6)).toBe(true);
    expect(canJadikanTransfer(c("direksi"), HOF6)).toBe(false);
    expect(canJadikanTransfer(c("pengawas"), HOF6)).toBe(false);
  });

  it("🔴 canJadikanTransferHariTutup: HoF & super_admin saja; staf keuangan TIDAK", () => {
    expect(canJadikanTransferHariTutup(hof, HOF6)).toBe(true);
    expect(canJadikanTransferHariTutup(c("super_admin"), HOF6)).toBe(true);
    for (const r of ["pengawas", "keuangan", "direksi", "admin_perusahaan"] as Role[]) {
      expect(canJadikanTransferHariTutup(c(r), HOF6), r).toBe(false);
    }
  });
});

describe("impor rekening koran (U9; R26, R31) — satu predikat per keputusan", () => {
  const HOF5 = ["hof@solagroup.co"];
  const c = (role: Role, email: string | null = null) => ({ role, email });
  const hof = c("admin_perusahaan", "hof@solagroup.co");
  const semua: Role[] = ["pengawas", "keuangan", "direksi", "admin_perusahaan", "super_admin"];

  it("🔴 canImporRekeningKoran: keuangan & super_admin; HoF TIDAK (§10.12)", () => {
    expect(semua.filter((r) => canImporRekeningKoran(c(r), HOF5))).toEqual(["keuangan", "super_admin"]);
    expect(canImporRekeningKoran(hof, HOF5)).toBe(false);
    expect(canImporRekeningKoran(c("keuangan", "hof@solagroup.co"), HOF5)).toBe(false);
  });

  it("🔴 canTarikRekeningKoran: HoF & super_admin; staf Keuangan TIDAK (R31)", () => {
    expect(canTarikRekeningKoran(hof, HOF5)).toBe(true);
    expect(canTarikRekeningKoran(c("super_admin"), HOF5)).toBe(true);
    for (const r of ["pengawas", "keuangan", "direksi", "admin_perusahaan"] as Role[]) {
      expect(canTarikRekeningKoran(c(r), HOF5), r).toBe(false);
    }
  });
});

describe("kelompok cocok (U10; R26, R31) — satu predikat per keputusan", () => {
  const HOF5 = ["hof@solagroup.co"];
  const c = (role: Role, email: string | null = null) => ({ role, email });
  const hof = c("admin_perusahaan", "hof@solagroup.co");
  const semua: Role[] = ["pengawas", "keuangan", "direksi", "admin_perusahaan", "super_admin"];

  it("🔴 canCocokkanBank: keuangan & super_admin; HoF TIDAK (§10.12)", () => {
    expect(semua.filter((r) => canCocokkanBank(c(r), HOF5))).toEqual(["keuangan", "super_admin"]);
    expect(canCocokkanBank(hof, HOF5)).toBe(false);
    expect(canCocokkanBank(c("keuangan", "hof@solagroup.co"), HOF5)).toBe(false);
  });

  it("🔴 canBatalkanCocokBank: HoF & super_admin; staf Keuangan TIDAK (R31)", () => {
    expect(canBatalkanCocokBank(hof, HOF5)).toBe(true);
    expect(canBatalkanCocokBank(c("super_admin"), HOF5)).toBe(true);
    for (const r of ["pengawas", "keuangan", "direksi", "admin_perusahaan"] as Role[]) {
      expect(canBatalkanCocokBank(c(r), HOF5), r).toBe(false);
    }
  });
});

describe("tutup bulan (U12; R25) — HoF & super admin", () => {
  const HOF5 = ["hof@solagroup.co"];
  const c = (role: Role, email: string | null = null) => ({ role, email });

  it("🔴 canTutupBulan: HoF (peran apa pun) & super_admin; staf Keuangan TIDAK", () => {
    expect(canTutupBulan(c("admin_perusahaan", "hof@solagroup.co"), HOF5)).toBe(true);
    expect(canTutupBulan(c("super_admin"), HOF5)).toBe(true);
    for (const r of ["pengawas", "keuangan", "direksi", "admin_perusahaan"] as Role[]) {
      expect(canTutupBulan(c(r, "staf@solagroup.co"), HOF5), r).toBe(false);
    }
  });
});

describe("settlement EDC (keputusan owner 2 Nov 2026) — seluruh tim Finance", () => {
  const HOF5 = ["hof@solagroup.co"];
  const c = (role: Role, email: string | null = null) => ({ role, email });
  const semua: Role[] = ["pengawas", "keuangan", "direksi", "admin_perusahaan", "super_admin"];

  it("🔴 canKelolaSettlementEdc: keuangan & super_admin; peran lain TIDAK bila bukan HoF", () => {
    expect(semua.filter((r) => canKelolaSettlementEdc(c(r, "staf@solagroup.co"), HOF5))).toEqual([
      "keuangan",
      "super_admin",
    ]);
  });

  it("🔴 HoF lolos, apa pun perannya — termasuk irisan HoF × keuangan", () => {
    expect(canKelolaSettlementEdc(c("admin_perusahaan", "hof@solagroup.co"), HOF5)).toBe(true);
    expect(canKelolaSettlementEdc(c("keuangan", "hof@solagroup.co"), HOF5)).toBe(true);
  });

  it("🔴 pengecualian SEMPIT: canInputKeuangan untuk HoF tetap false (§10.12)", () => {
    expect(canInputKeuangan(c("admin_perusahaan", "hof@solagroup.co"), HOF5)).toBe(false);
    expect(canInputKeuangan(c("keuangan", "hof@solagroup.co"), HOF5)).toBe(false);
  });

  it("daftar HoF kosong ⇒ direksi tetap ditolak (fail-closed)", () => {
    expect(canKelolaSettlementEdc(c("direksi", "hof@solagroup.co"), [])).toBe(false);
  });
});

describe("termin pembayaran (rencana 2026-11-13 U4; R15, KTD9) — seluruh tim Finance", () => {
  const HOF5 = ["hof@solagroup.co"];
  const c = (role: Role, email: string | null = null) => ({ role, email });
  const semua: Role[] = ["pengawas", "keuangan", "direksi", "admin_perusahaan", "super_admin"];

  it("🔴 canAturTermin: keuangan & super_admin; peran lain TIDAK bila bukan HoF", () => {
    expect(semua.filter((r) => canAturTermin(c(r, "staf@solagroup.co"), HOF5))).toEqual([
      "keuangan",
      "super_admin",
    ]);
  });

  it("🔴 HoF lolos, apa pun perannya — termasuk irisan HoF × keuangan", () => {
    expect(canAturTermin(c("admin_perusahaan", "hof@solagroup.co"), HOF5)).toBe(true);
    expect(canAturTermin(c("keuangan", "hof@solagroup.co"), HOF5)).toBe(true);
  });

  it("🔴 direksi & pengawas ditolak; email kosong tak pernah jadi HoF", () => {
    expect(canAturTermin(c("direksi", "direksi@solagroup.co"), HOF5)).toBe(false);
    expect(canAturTermin(c("pengawas", "pengawas@solagroup.co"), HOF5)).toBe(false);
    expect(canAturTermin(c("direksi", null), HOF5)).toBe(false);
  });

  it("admin_perusahaan mengikuti canInputKeuangan: TIDAK, kecuali ia pemegang HoF", () => {
    const admin = c("admin_perusahaan", "admin@solagroup.co");
    expect(canInputKeuangan(admin, HOF5)).toBe(false);
    expect(canAturTermin(admin, HOF5)).toBe(false);
  });

  it("🔴 pengecualian SEMPIT: canInputKeuangan untuk HoF tetap false (§10.12)", () => {
    expect(canInputKeuangan(c("admin_perusahaan", "hof@solagroup.co"), HOF5)).toBe(false);
    expect(canInputKeuangan(c("keuangan", "hof@solagroup.co"), HOF5)).toBe(false);
  });

  it("daftar HoF kosong ⇒ hanya jalur peran yang tersisa (fail-closed)", () => {
    expect(canAturTermin(c("direksi", "hof@solagroup.co"), [])).toBe(false);
    expect(canAturTermin(c("admin_perusahaan", "hof@solagroup.co"), [])).toBe(false);
    expect(canAturTermin(c("keuangan", "hof@solagroup.co"), [])).toBe(true);
  });

  it("pesan tolak: satu sumber, menyebut tim Finance — BUKAN pesan 'HoF tidak mengetik'", () => {
    expect(pesanTakBolehAturTermin()).toBe(PESAN_TAK_BOLEH_ATUR_TERMIN);
    expect(PESAN_TAK_BOLEH_ATUR_TERMIN).toMatch(/staf Keuangan atau Head of Finance/);
    expect(PESAN_TAK_BOLEH_ATUR_TERMIN).not.toBe(pesanTakBolehInput(c("pengawas", "p@solagroup.co")));
  });
});

describe("daftar pos (rencana K6 U1; R4) — HoF & super admin", () => {
  const HOF5 = ["hof@solagroup.co"];
  const c = (role: Role, email: string | null = null) => ({ role, email });

  it("🔴 canKelolaPos: HoF (peran apa pun) & super_admin; staf Keuangan TIDAK", () => {
    expect(canKelolaPos(c("admin_perusahaan", "hof@solagroup.co"), HOF5)).toBe(true);
    expect(canKelolaPos(c("keuangan", "hof@solagroup.co"), HOF5)).toBe(true);
    expect(canKelolaPos(c("super_admin"), HOF5)).toBe(true);
    for (const r of ["pengawas", "keuangan", "direksi", "admin_perusahaan"] as Role[]) {
      expect(canKelolaPos(c(r, "staf@solagroup.co"), HOF5), r).toBe(false);
    }
  });

  it("daftar HoF kosong ⇒ tak seorang pun selain super_admin (fail-closed)", () => {
    expect(canKelolaPos(c("direksi", "hof@solagroup.co"), [])).toBe(false);
    expect(canKelolaPos(c("keuangan", "hof@solagroup.co"), [])).toBe(false);
  });
});

describe("buku besar (rencana K6 U9; R8, R9, KD13) — pengusul ≠ penyetuju", () => {
  const HOF5 = ["hof@solagroup.co"];
  const c = (role: Role, email: string | null = null) => ({ role, email });

  it("🔴 canUsulkanMemorial & canIsiSaldoAwalPos: HoF (peran apa pun) & super_admin; staf Keuangan TIDAK", () => {
    for (const f of [canUsulkanMemorial, canIsiSaldoAwalPos]) {
      expect(f(c("admin_perusahaan", "hof@solagroup.co"), HOF5)).toBe(true);
      expect(f(c("keuangan", "hof@solagroup.co"), HOF5)).toBe(true);
      expect(f(c("super_admin"), HOF5)).toBe(true);
      for (const r of ["pengawas", "keuangan", "direksi", "admin_perusahaan"] as Role[]) {
        expect(f(c(r, "staf@solagroup.co"), HOF5), r).toBe(false);
      }
      expect(f(c("keuangan", "hof@solagroup.co"), []), "daftar HoF kosong").toBe(false);
    }
  });

  it("🔴 canSetujuiMemorial: Direksi & super_admin — HoF TIDAK (yang mengetik tidak menyetujui)", () => {
    expect(canSetujuiMemorial(c("direksi"))).toBe(true);
    expect(canSetujuiMemorial(c("super_admin"))).toBe(true);
    // HoF, peran apa pun selain direksi, tidak bisa menyetujui memorial.
    expect(canSetujuiMemorial(c("admin_perusahaan", "ddsalam@solagroup.co"))).toBe(false);
    for (const r of ["pengawas", "keuangan", "admin_perusahaan"] as Role[]) {
      expect(canSetujuiMemorial(c(r)), r).toBe(false);
    }
  });

  it("canSetujuiMemorial berdiri sendiri — tidak menyebut isHeadOfFinance", () => {
    const src = readFileSync(resolve(__dirname, "keuangan-wewenang.ts"), "utf8");
    const i = src.indexOf("export function canSetujuiMemorial");
    const badan = src.slice(i, src.indexOf("\n}", i));
    expect(i).toBeGreaterThan(-1);
    expect(badan).not.toMatch(/isHeadOfFinance|canCloseException/);
  });
});

describe("Batalkan baris pintu Finance (rencana 2026-11-07 KTD7) — predikat sendiri", () => {
  const HOF5 = ["hof@solagroup.co"];
  const c = (role: Role, email: string | null = null) => ({ role, email });
  const semua: Role[] = ["pengawas", "keuangan", "direksi", "admin_perusahaan", "super_admin"];

  it("🔴 staf Keuangan, super admin, DAN Head of Finance (peran admin_perusahaan + ENV)", () => {
    expect(semua.filter((r) => canBatalkanBarisFinance(c(r), HOF5))).toEqual(["keuangan", "super_admin"]);
    // ⛔ Gerbang baru mewarisi pengecualian lama: HoF pernah tertolak Reklasifikasi
    // (27 Sep). Pemakai nyata Batalkan termasuk HoF — dipatok di sini.
    expect(canBatalkanBarisFinance(c("admin_perusahaan", "hof@solagroup.co"), HOF5)).toBe(true);
    expect(canBatalkanBarisFinance(c("keuangan", "hof@solagroup.co"), HOF5)).toBe(true);
  });

  it("pengawas, direksi, admin perusahaan biasa TIDAK", () => {
    for (const r of ["pengawas", "direksi", "admin_perusahaan"] as Role[]) {
      expect(canBatalkanBarisFinance(c(r, "orang@solagroup.co"), HOF5), r).toBe(false);
    }
  });

  it("anggotanya hari ini sama dengan reklasifikasi — keputusan Dion, bukan kebetulan", () => {
    for (const r of semua) {
      for (const e of [null, "hof@solagroup.co"]) {
        expect(canBatalkanBarisFinance(c(r, e), HOF5), `${r}/${e}`).toBe(canReklasifikasi(c(r, e), HOF5));
      }
    }
  });
});

describe("Balik baris pintu Finance (rencana 2026-11-07 KTD7, R10) — dua predikat, dua keputusan", () => {
  const HOF5 = ["hof@solagroup.co"];
  const c = (role: Role, email: string | null = null) => ({ role, email });
  const semua: Role[] = ["pengawas", "keuangan", "direksi", "admin_perusahaan", "super_admin"];

  it("🔴 mengajukan: staf Keuangan, super admin, HoF — anggota sama dengan Batalkan", () => {
    expect(semua.filter((r) => canAjukanBalikBaris(c(r), HOF5))).toEqual(["keuangan", "super_admin"]);
    expect(canAjukanBalikBaris(c("admin_perusahaan", "hof@solagroup.co"), HOF5)).toBe(true);
  });

  it("🔴 menyetujui: Direksi, super admin, HoF — tingkat kedua §3.2 (canCloseException); staf Keuangan TIDAK", () => {
    expect(semua.filter((r) => canSetujuiBalikBaris(c(r), HOF5))).toEqual(["direksi", "super_admin"]);
    expect(canSetujuiBalikBaris(c("admin_perusahaan", "hof@solagroup.co"), HOF5)).toBe(true);
    expect(canSetujuiBalikBaris(c("keuangan"), HOF5)).toBe(false);
    for (const r of semua) {
      expect(canSetujuiBalikBaris(c(r, "hof@solagroup.co"), HOF5), r).toBe(canCloseException(c(r, "hof@solagroup.co"), HOF5));
    }
  });
});
