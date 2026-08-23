import { describe, expect, it } from "vitest";
import { sebabKasDari } from "./keuangan-laporan-model";
import {
  kekuranganBagan,
  barisUnit,
  LABEL_STATUS,
  PENJELASAN_STATUS,
  ringkasPapan,
  urutkanPapan,
  type InputUnit,
} from "./keuangan-papan-model";

const u = (o: Partial<InputUnit> = {}): InputUnit => ({
  unitId: 2,
  code: "6378301",
  nama: "Bakau",
  adaAkunKas: true,
  kindAkun: ["kas", "edc_penampungan"],
  labaBersih: 11_875_869,
  kasAkhir: 7_304_915_872,
  langkahHarian: 0,
  dayClose: { status: "closed", differenceRp: 0 },
  ...o,
});

describe("status unit — ketiadaan baris ≠ status 'open' (§10.15)", () => {
  it("🔴 TIDAK ADA baris day_close ⇒ 'belum pernah dibuka', bukan 'belum ditutup'", () => {
    // Inilah batas yang §10.15 minta ditulis sebelum layar ini dibangun.
    // `WHERE status='open'` hanya menemukan hari yang pernah dibuka lalu
    // ditinggalkan, dan justru MELEWATKAN hari yang tak pernah disentuh.
    const b = barisUnit(u({ dayClose: null }));
    expect(b.status).toBe("belum_pernah_dibuka");
    expect(b.status).not.toBe("belum_ditutup");
  });

  it("🔴 'belum pernah dibuka' TIDAK boleh terbaca sebagai seimbang", () => {
    const b = barisUnit(u({ dayClose: null, langkahHarian: null }));
    expect(PENJELASAN_STATUS[b.status]).toMatch(/BUKAN 'seimbang'|bukan 'seimbang'/i);
    expect(b.nada).toBe("tak_terhitung");

    // 🔴 DATANYA YANG PENTING: `langkahHarian: 0`, bukan `null`. Bentuk lama uji
    // ini memakai `null`/`5`, dan satu angka bukan-nol menyembunyikan seluruh
    // kelasnya — judulnya menjanjikan kartunya, asersinya hanya menjaga barisnya.
    const nolTanpaJejak = barisUnit(u({ dayClose: null, langkahHarian: 0 }));
    const r = ringkasPapan([nolTanpaJejak]);
    expect(r.seimbang, "unit tanpa jejak ikut dihitung seimbang").toBe(0);
    expect(r.diperiksa, "unit tanpa jejak ikut jadi penyebut").toBe(0);
    expect(r.termodelkan).toBe(1);
    expect(r.belumPernahDibuka).toBe(1);
  });

  it("baris ada & open ⇒ belum ditutup; closed dalam toleransi ⇒ ditutup", () => {
    expect(barisUnit(u({ dayClose: { status: "open", differenceRp: 0 } })).status).toBe("belum_ditutup");
    expect(barisUnit(u()).status).toBe("ditutup_normal");
  });

  it("ditutup di luar toleransi ⇒ ditandai eksepsi, bukan 'ditutup' biasa", () => {
    const b = barisUnit(u({ dayClose: { status: "closed", differenceRp: 50_000 } }));
    expect(b.status).toBe("ditutup_eksepsi");
    expect(LABEL_STATUS[b.status]).toMatch(/eksepsi/);
  });

  it("tanpa akun kas ⇒ belum dimodelkan, dan angkanya null — bukan nol", () => {
    const b = barisUnit(u({ adaAkunKas: false }));
    expect(b.status).toBe("belum_dimodelkan");
    expect(b.labaBersih).toBeNull();
    expect(b.kasAkhir).toBeNull();
    expect(PENJELASAN_STATUS[b.status]).toMatch(/tim keuangan/);
  });

  it("🔴 BSCheck kumulatif SELALU null — belum ada saldo pembuka", () => {
    expect(barisUnit(u()).bsCheckKumulatif).toBeNull();
  });
});

describe("urutan papan — yang paling perlu dilihat lebih dulu", () => {
  it("belum pernah dibuka mendahului yang sudah ditutup", () => {
    const rows = [
      barisUnit(u({ nama: "A" })),
      barisUnit(u({ nama: "B", dayClose: null })),
      barisUnit(u({ nama: "C", adaAkunKas: false })),
      barisUnit(u({ nama: "D", dayClose: { status: "open", differenceRp: 0 } })),
    ];
    expect(urutkanPapan(rows).map((r) => r.nama)).toEqual(["B", "D", "A", "C"]);
  });

  it("🔴 dalam status yang sama, yang TAK TERHITUNG mendahului yang tepat nol", () => {
    // Saudaranya cacat kartu KPI, di fungsi sebelahnya: `langkahHarian ?? 0`
    // membuat ketiadaan duduk bersama nol — dan karena sort stabil, yang tak
    // diketahui justru jatuh ke bawah. Nol yang terbukti adalah kabar baik;
    // "tak bisa dihitung" adalah pertanyaan yang belum dijawab.
    const nol = barisUnit(u({ nama: "nol", langkahHarian: 0, dayClose: { status: "open", differenceRp: 0 } }));
    const takHitung = barisUnit(
      u({ nama: "takHitung", langkahHarian: null, dayClose: { status: "open", differenceRp: 0 } }),
    );
    expect(urutkanPapan([nol, takHitung]).map((r) => r.nama)).toEqual(["takHitung", "nol"]);
    // …dan urutannya tidak bergantung pada urutan masukan.
    expect(urutkanPapan([takHitung, nol]).map((r) => r.nama)).toEqual(["takHitung", "nol"]);
  });

  it("dalam status yang sama, selisih TERBESAR lebih dulu", () => {
    const rows = [
      barisUnit(u({ nama: "kecil", langkahHarian: 100, dayClose: { status: "open", differenceRp: 100 } })),
      barisUnit(u({ nama: "besar", langkahHarian: -52_779_482, dayClose: { status: "open", differenceRp: -52_779_482 } })),
    ];
    expect(urutkanPapan(rows).map((r) => r.nama)).toEqual(["besar", "kecil"]);
  });
});

describe("ringkasPapan — total yang tidak lengkap adalah null", () => {
  it("menghitung yang termodelkan, yang diperiksa, yang seimbang, dan yang tak berjejak", () => {
    const rows = [
      barisUnit(u({ nama: "A" })),
      // ⚠️ `langkahHarian: 0` DENGAN SENGAJA — inilah data yang menjatuhkan
      // bentuk lama. Memakai 5 di sini membuat ujinya benar di atas data yang
      // tak pernah melanggar aturannya.
      barisUnit(u({ nama: "B", dayClose: null, langkahHarian: 0 })),
      barisUnit(u({ nama: "C", adaAkunKas: false })),
    ];
    const r = ringkasPapan(rows);
    expect(r.termodelkan).toBe(2);
    expect(r.diperiksa).toBe(1);
    expect(r.seimbang).toBe(1);
    expect(r.belumPernahDibuka).toBe(1);
  });

  it("🔴 penyebut 'diperiksa' ≠ 'termodelkan' — dan bedanya harus terlihat", () => {
    // Kalau keduanya kebetulan sama pada seluruh fixture, penjaga di atas hijau
    // tanpa membuktikan apa pun.
    const rows = [barisUnit(u({ nama: "A" })), barisUnit(u({ nama: "B", dayClose: null, langkahHarian: 0 }))];
    const r = ringkasPapan(rows);
    expect(r.diperiksa).not.toBe(r.termodelkan);
  });

  it("🔴 satu unit termodelkan tak terhitung ⇒ TOTAL null, dan namanya disebut", () => {
    // Menjumlah yang ada saja melahirkan total yang terlihat sah dari himpunan
    // yang tidak lengkap — dan tak seorang pun tahu satu unit hilang darinya.
    const rows = [barisUnit(u({ nama: "A" })), barisUnit(u({ nama: "B", labaBersih: null }))];
    const r = ringkasPapan(rows);
    expect(r.labaBersih).toBeNull();
    expect(r.tanpaLaba).toEqual(["B"]);
  });

  it("🔴 DUA GERBANG TERPISAH: kas tak terhitung TIDAK menghapus laba (§10.21)", () => {
    // Kelas yang ditutup: satu `lengkap` menutup dua total, sehingga laba yang
    // SUDAH terbukti dari EasyMax lenyap hanya karena buku kas belum diisi.
    const rows = [
      barisUnit(u({ nama: "A", labaBersih: 10, kasAkhir: null })),
      barisUnit(u({ nama: "B", labaBersih: 5, kasAkhir: null })),
    ];
    const r = ringkasPapan(rows);
    expect(r.labaBersih).toBe(15); // ← tetap tampil
    expect(r.kasAkhir).toBeNull(); // ← yang tak diketahui tetap null
    expect(r.tanpaLaba).toEqual([]); // ← dan TIDAK menuduh A/B soal laba
    expect(r.tanpaKas).toEqual(["A", "B"]);
  });

  it("🔴 arah sebaliknya juga: laba tak terhitung tidak menghapus kas", () => {
    const rows = [
      barisUnit(u({ nama: "A", labaBersih: null, kasAkhir: 100 })),
      barisUnit(u({ nama: "B", labaBersih: 5, kasAkhir: 50 })),
    ];
    const r = ringkasPapan(rows);
    expect(r.labaBersih).toBeNull();
    expect(r.kasAkhir).toBe(150);
    expect(r.tanpaLaba).toEqual(["A"]);
    expect(r.tanpaKas).toEqual([]);
  });

  it("semua lengkap ⇒ total dijumlah — kontrol POSITIF", () => {
    const rows = [barisUnit(u({ nama: "A", labaBersih: 10, kasAkhir: 100 })),
                  barisUnit(u({ nama: "B", labaBersih: 5, kasAkhir: 50 }))];
    const r = ringkasPapan(rows);
    expect(r.labaBersih).toBe(15);
    expect(r.kasAkhir).toBe(150);
    expect(r.tanpaLaba).toEqual([]);
    expect(r.tanpaKas).toEqual([]);
  });

  it("unit BELUM DIMODELKAN tidak membuat total jadi null", () => {
    // Ia memang bukan bagian himpunan; menganggapnya 'tak terhitung' akan
    // membuat totalnya null selamanya sampai ketujuh unit didaftarkan.
    const rows = [barisUnit(u({ labaBersih: 10, kasAkhir: 100 })), barisUnit(u({ adaAkunKas: false }))];
    expect(ringkasPapan(rows).labaBersih).toBe(10);
  });
});

describe("kekuranganBagan — PENGAMATAN, bukan tuduhan (§10.22)", () => {
  it("unit dengan satu rekening bank: dua yang belum ada, dinamai", () => {
    expect(kekuranganBagan(["bank"])).toEqual(["Kas Besar", "EDC Penampungan"]);
  });

  it("bagan lengkap ⇒ tak ada tanda — kontrol POSITIF", () => {
    expect(kekuranganBagan(["kas", "bank", "edc_penampungan"])).toEqual([]);
  });

  it("🔴 unit TANPA akun sama sekali tidak ditandai — ia sudah punya penandanya", () => {
    // Dua penanda untuk satu keadaan membuat pembacanya menebak mana yang berlaku.
    expect(kekuranganBagan([])).toEqual([]);
    expect(barisUnit(u({ adaAkunKas: false, kindAkun: [] })).kekuranganBagan).toEqual([]);
  });

  it("hanya SATU yang hilang ⇒ hanya satu yang disebut", () => {
    expect(kekuranganBagan(["kas", "bank"])).toEqual(["EDC Penampungan"]);
    expect(kekuranganBagan(["edc_penampungan"])).toEqual(["Kas Besar"]);
  });

  it("barisUnit menurunkannya, bukan menerimanya — satu pembuat vonis", () => {
    expect(barisUnit(u({ kindAkun: ["bank"] })).kekuranganBagan).toEqual([
      "Kas Besar",
      "EDC Penampungan",
    ]);
  });
});

describe("sebabKasDari — DUA sebab yang berbeda, dinamai benar (§10.21)", () => {
  it("tanpa akun ⇒ belum_ada_akun_kas", () => {
    expect(sebabKasDari(0, 0)).toBe("belum_ada_akun_kas");
  });

  it("🔴 ADA akun tapi buku KOSONG ⇒ belum_ada_mutasi_kas, bukan belum_ada_akun_kas", () => {
    // Nama yang salah mengirim orang mencari akun yang sudah terdaftar.
    expect(sebabKasDari(7, 0)).toBe("belum_ada_mutasi_kas");
    expect(sebabKasDari(1, 0)).not.toBe("belum_ada_akun_kas");
  });

  it("ada akun DAN ada mutasi ⇒ kasnya bisa dihitung — kontrol POSITIF", () => {
    expect(sebabKasDari(1, 1)).toBeNull();
  });
});
