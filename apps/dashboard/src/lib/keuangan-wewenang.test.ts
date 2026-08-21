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
