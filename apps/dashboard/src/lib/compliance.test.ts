import { describe, expect, it } from "vitest";
import {
  adminStatus,
  pasangkanSetoranKemarin,
  ageText,
  isSelisihAbnormal,
  opnameStatus,
  salesStatus,
  SETORAN_TOLERANSI_RP,
  SHIFT_TARGET,
  setoranStatus,
  staleness,
  type AdminHari,
} from "./compliance";
import { uangTunai } from "./rekon";

describe("status modul", () => {
  it("penjualan: 3 shift hijau, 1-2 kuning, 0 merah", () => {
    expect(salesStatus(3)).toBe("green");
    expect(salesStatus(2)).toBe("yellow");
    expect(salesStatus(1)).toBe("yellow");
    expect(salesStatus(0)).toBe("red");
  });

  it("opname: semua tangki hijau, sebagian kuning, nol merah", () => {
    expect(opnameStatus(7, 7)).toBe("green");
    expect(opnameStatus(3, 7)).toBe("yellow");
    expect(opnameStatus(0, 7)).toBe("red");
    expect(opnameStatus(2, 0)).toBe("green"); // total tak diketahui → ada = hijau
  });

});

/**
 * Angka fixture di bawah adalah unit-hari NYATA dari DB pilot (snapshot
 * 2026-08-07 12:49 WIB), bukan karangan — supaya tesnya menguji aritmetika yang
 * benar-benar terjadi di SPBU, bukan aritmetika yang nyaman.
 */
describe("setoranStatus — toleransi Rp 1.000 (kuantum slip setoran)", () => {
  it("pembulatan ke ribuan terdekat BUKAN pelanggaran (IB 2026-07-24)", () => {
    // H berpecahan, I bulat ribuan: selisih +747. Ini pola 82 dari 95 hari.
    expect(setoranStatus(545_494_253.0, 545_495_000)).toBe("selaras");
  });

  it("pembulatan ke BAWAH juga selaras (IB 2026-07-31, −67)", () => {
    // Aturan lama `I ≥ H` memerahkan hari ini secara palsu. 10 dari 95 hari.
    expect(setoranStatus(429_606_067.0, 429_606_000)).toBe("selaras");
  });

  it("kelebihan setor nyata = kuning, bukan hijau (28 Oktober 2026-08-04, +605.048)", () => {
    // Aturan lama `I ≥ H` menghijaukan ini. 8 dari 95 hari lolos diam-diam.
    expect(setoranStatus(291_635_952.0, 292_241_000)).toBe("lebih_setor");
  });

  it("kelebihan setor besar tetap kuning (IB 2026-07-28, +1.622.495,50)", () => {
    expect(setoranStatus(524_378_504.5, 526_001_000)).toBe("lebih_setor");
  });

  it("kekurangan setor nyata = merah (IB 2026-07-16, −805.289,52)", () => {
    expect(setoranStatus(343_322_289.52, 342_517_000)).toBe("kurang_setor");
  });

  it("batas toleransi tegas di KEDUA sisi", () => {
    const h = 100_000_000;
    expect(setoranStatus(h, h + SETORAN_TOLERANSI_RP)).toBe("selaras");
    expect(setoranStatus(h, h - SETORAN_TOLERANSI_RP)).toBe("selaras");
    expect(setoranStatus(h, h + SETORAN_TOLERANSI_RP + 0.01)).toBe("lebih_setor");
    expect(setoranStatus(h, h - SETORAN_TOLERANSI_RP - 0.01)).toBe("kurang_setor");
  });

  it("kesamaan EKSAK tak pernah disyaratkan (0 dari 95 hari memenuhinya)", () => {
    // Kalau aturannya `i === h`, baris ini merah. H selalu berpecahan.
    expect(setoranStatus(480_195_426.5, 480_196_000)).toBe("selaras");
  });
});

describe("pasangkanSetoranKemarin — pemasangan D−1 (dipakai papan & feed)", () => {
  const hariKe = (d: string, setoran: number | null) => ({ d, setoran });

  it("menggeser TEPAT satu: tiap hari mendapat setoran hari sebelumnya", () => {
    const out = pasangkanSetoranKemarin([
      hariKe("2026-08-05", 100),
      hariKe("2026-08-06", 200),
      hariKe("2026-08-07", 300),
    ]);
    // Kalau geserannya salah arah/indeks (mis. `menaik[j + 1]`), baris ini merah.
    expect(out.map((o) => o.iSebelumnya)).toEqual([null, 100, 200]);
    expect(out.map((o) => o.hari.d)).toEqual(["2026-08-05", "2026-08-06", "2026-08-07"]);
  });

  it("hari tanpa setoran memasok null, bukan 0 — dan tak menghentikan deret", () => {
    const out = pasangkanSetoranKemarin([
      hariKe("2026-08-05", 100),
      hariKe("2026-08-06", null),
      hariKe("2026-08-07", 300),
    ]);
    expect(out.map((o) => o.iSebelumnya)).toEqual([null, 100, null]);
  });

  it("deret kosong & satu elemen tidak melempar", () => {
    expect(pasangkanSetoranKemarin([])).toEqual([]);
    expect(pasangkanSetoranKemarin([hariKe("2026-08-07", 5)])[0]?.iSebelumnya).toBeNull();
  });
});

describe("adminStatus", () => {
  const hari = (o: Partial<AdminHari> = {}): AdminHari => ({
    // Lantai adopsi jauh di masa lalu → tidak mengganggu cabang lain kecuali
    // kasus yang memang mengujinya.
    adopsi: "2020-01-01",
    nPendapatanLain: 1,
    nPengeluaran: 4,
    nSetoran: 1,
    h: 100_000_000,
    i: 100_000_000,
    shifts: 3,
    // Aturan salin-setoran MATI secara default: tiap tes yang mengujinya harus
    // menyalakannya sendiri, supaya tak ada tes lain yang berubah artinya.
    iSebelumnya: null,
    ...o,
  });
  // "hari ini" = 2026-08-07; jatuh tempo akhir D+1.
  const today = "2026-08-07";
  const lewatTempo = "2026-08-05"; // D+2 → sudah jatuh tempo
  const kemarin = "2026-08-06"; // D+1 → belum jatuh tempo

  it("MERAH: hari lewat tempo tanpa satu pun baris = belum diisi", () => {
    const v = adminStatus(hari({ nPendapatanLain: 0, nPengeluaran: 0, nSetoran: 0, i: null }), {
      businessDate: lewatTempo,
      today,
    });
    expect(v.kode).toBe("belum_diisi");
    expect(v.tone).toBe("red");
    expect(v.terisi).toBe(false);
  });

  it("MERAH: hari ber-atestasi & ada penjualan tapi setoran nihil (IB 2026-06-21, pola FG·)", () => {
    const v = adminStatus(hari({ nSetoran: 0, i: null }), { businessDate: lewatTempo, today });
    expect(v.kode).toBe("setoran_kosong");
    expect(v.tone).toBe("red");
  });

  it("MERAH: kurang setor di luar toleransi", () => {
    const v = adminStatus(hari({ h: 343_322_289.52, i: 342_517_000 }), {
      businessDate: lewatTempo,
      today,
    });
    expect(v.kode).toBe("kurang_setor");
    expect(v.tone).toBe("red");
  });

  it("KUNING: lebih setor di luar toleransi (keputusan Gate 1 — bukan hijau)", () => {
    const v = adminStatus(hari({ h: 291_635_952.0, i: 292_241_000 }), {
      businessDate: lewatTempo,
      today,
    });
    expect(v.kode).toBe("lebih_setor");
    expect(v.tone).toBe("yellow");
  });

  it("HIJAU: lengkap & selaras", () => {
    const v = adminStatus(hari({ h: 545_494_253.0, i: 545_495_000 }), {
      businessDate: lewatTempo,
      today,
    });
    expect(v.kode).toBe("selaras");
    expect(v.tone).toBe("green");
  });

  it("NIHIL ≠ belum diisi: seksi kosong di hari ber-atestasi tidak memerahkan", () => {
    // Bakau 2026-07-19 (pola ·GI): pendapatan_lain nol baris, tetap dinilai
    // dari sumbu setoran. Ini BATAS yang diketahui (4,1% hari), bukan kelalaian.
    const v = adminStatus(hari({ nPendapatanLain: 0 }), { businessDate: lewatTempo, today });
    expect(v.kode).toBe("selaras");
    expect(v.tone).toBe("green");
  });

  it("NETRAL: penjualan belum ter-ingest → tak terhitung, bukan temuan Rp 355 juta", () => {
    // Korek 2026-08-07 NYATA: shifts=0, H = F−G = 3.587.200, I = 359.447.000.
    // Tanpa cabang ini, I−H = +355.859.800 akan tampil sebagai kelebihan setor.
    const h = uangTunai({ A: 0, B: 0, C: 0, D: 0, F: 4_205_200, G: 618_000 });
    expect(h).toBe(3_587_200);
    const v = adminStatus(hari({ shifts: 0, h, i: 359_447_000 }), {
      businessDate: lewatTempo, // sekalipun sudah lewat tempo
      today,
    });
    expect(v.kode).toBe("tak_terhitung");
    expect(v.tone).toBe("pending");
    expect(setoranStatus(h, 359_447_000)).toBe("lebih_setor"); // kontrol: tanpa gerbang, ia MENYALA
  });

  it("NETRAL: hari berjalan & D+1 tak pernah merah, tapi terbaca terisi/kosong", () => {
    // KOSONG: sama untuk hari ini & kemarin.
    for (const bd of [today, kemarin]) {
      const kosong = adminStatus(
        hari({ nPendapatanLain: 0, nPengeluaran: 0, nSetoran: 0, i: null }),
        { businessDate: bd, today },
      );
      expect(kosong.tone).toBe("pending");
      expect(kosong.kode).toBe("belum_tempo_kosong");
      expect(kosong.terisi).toBe(false);
    }
    // TERISI: kodenya BERBEDA sejak gerbang hari-berjalan (2026-08-08).
    // Hari ini → `hari_berjalan` (H masih dirakit, tak dinilai sama sekali).
    // Kemarin  → `belum_tempo_terisi` (menunggu jatuh tempo, bukan menunggu data).
    const iniTerisi = adminStatus(hari({ nSetoran: 0, i: null }), { businessDate: today, today });
    expect(iniTerisi.kode).toBe("hari_berjalan");
    expect(iniTerisi.tone).toBe("pending");
    expect(iniTerisi.terisi).toBe(true); // sinyal real-time: siapa sudah mengisi

    const kmrTerisi = adminStatus(hari({ nSetoran: 0, i: null }), { businessDate: kemarin, today });
    expect(kmrTerisi.kode).toBe("belum_tempo_terisi");
    expect(kmrTerisi.terisi).toBe(true);
  });

  // === LANTAI ADOPSI (2026-08-07) — tiga syarat mengikat owner ==============

  it("PRA-ADOPSI: hari sebelum lantai TIDAK merah, dan punya NAMA sendiri", () => {
    // Bundaran Kotabaru mengadopsi 2026-08-02. 2026-07-28 tak boleh dinilai.
    const kosong = { nPendapatanLain: 0, nPengeluaran: 0, nSetoran: 0, i: null };
    const v = adminStatus(hari({ ...kosong, adopsi: "2026-08-02" }), {
      businessDate: "2026-07-28",
      today,
    });
    expect(v.kode).toBe("pra_adopsi"); // BERNAMA — bukan sekadar "pending"
    expect(v.tone).toBe("pending");
    // KONTROL: hari yang SAMA tanpa lantai memang merah — jadi lantainya yang
    // mengubah hasil, bukan kebetulan.
    expect(
      adminStatus(hari({ ...kosong, adopsi: "2020-01-01" }), {
        businessDate: "2026-07-28",
        today,
      }).kode,
    ).toBe("belum_diisi");
  });

  it("LANTAI TEPAT: hari PADA tanggal adopsi sudah dinilai (batas inklusif)", () => {
    const kosong = { nPendapatanLain: 0, nPengeluaran: 0, nSetoran: 0, i: null };
    expect(
      adminStatus(hari({ ...kosong, adopsi: "2026-08-02" }), {
        businessDate: "2026-08-01",
        today,
      }).kode,
    ).toBe("pra_adopsi");
    expect(
      adminStatus(hari({ ...kosong, adopsi: "2026-08-02" }), {
        businessDate: "2026-08-02",
        today,
      }).kode,
    ).toBe("belum_diisi");
  });

  it("SYARAT 1 — NON-ADOPSI TETAP TERLIHAT: adopsi null = kuning, bukan diam", () => {
    // Unit terdaftar tapi belum pernah memakai panel. Kalau ini netral, unit
    // yang tak pernah mengadopsi jadi PERMANEN tak terlihat — kegagalan alarm
    // kas lama, terbalik arahnya.
    const v = adminStatus(hari({ adopsi: null }), { businessDate: lewatTempo, today });
    expect(v.kode).toBe("belum_adopsi");
    expect(v.tone).toBe("yellow");
    expect(v.tone).not.toBe("pending");
    expect(v.tone).not.toBe("green");
  });

  it("SYARAT 2 — UNIT TAK TERDAFTAR GAGAL NYARING: undefined = MERAH", () => {
    // Cabang default TIDAK BOLEH netral/hijau — keduanya berbohong tentang unit
    // yang lantainya tak diketahui.
    const v = adminStatus(hari({ adopsi: undefined }), { businessDate: lewatTempo, today });
    expect(v.kode).toBe("config_hilang");
    expect(v.tone).toBe("red");
  });

  it("SYARAT 2 — bahkan hari yang SEMPURNA tetap merah bila unit tak terdaftar", () => {
    // Kasus paling menggoda untuk "diam-diam hijau": semua terisi & selaras.
    const v = adminStatus(
      hari({ adopsi: undefined, h: 545_494_253.0, i: 545_495_000 }),
      { businessDate: lewatTempo, today },
    );
    expect(v.kode).toBe("config_hilang");
    expect(v.tone).toBe("red");
  });

  it("lantai TIDAK menelan temuan asli pasca-adopsi (L4/L5 pra-registrasi)", () => {
    // Bakau adopsi 2026-07-08; temuan 2026-08-06 lebih setor +3.362.265.
    expect(
      adminStatus(hari({ adopsi: "2026-07-08", h: 100_000_000, i: 103_362_265 }), {
        businessDate: "2026-08-06",
        today: "2026-08-08",
      }).kode,
    ).toBe("lebih_setor");
    // IB adopsi 2026-06-21; temuan 2026-08-03 kurang setor −476.993.
    expect(
      adminStatus(hari({ adopsi: "2026-06-21", h: 539_143_993.5, i: 538_667_000 }), {
        businessDate: "2026-08-03",
        today,
      }).kode,
    ).toBe("kurang_setor");
  });

  // === UMPAN BALIK SEKETIKA (keputusan owner 2026-08-07, dari papan live) ====
  // Jatuh tempo H+1 HANYA melindungi hari yang BELUM diisi. Begitu pengawas
  // mengisi, hari itu dinilai SEKETIKA — termasuk bisa MERAH. Itu justru nilai
  // "real-time" yang dikejar papan ini: menahan umpan balik sampai lusa akan
  // membunuh manfaatnya. Dulu ini efek samping tak tertulis dari urutan cabang;
  // sekarang keputusan yang dijaga tes.
  it("BELUM jatuh tempo + setoran KURANG → tetap MERAH seketika", () => {
    const v = adminStatus(hari({ h: 343_322_289.52, i: 342_517_000 }), {
      businessDate: kemarin, // D+1 — belum jatuh tempo
      today,
    });
    expect(v.kode).toBe("kurang_setor");
    expect(v.tone).toBe("red");
    expect(v.tone).not.toBe("pending"); // TIDAK ditahan
  });

  it("BELUM jatuh tempo + setoran LEBIH → kuning seketika", () => {
    const v = adminStatus(hari({ h: 291_635_952.0, i: 292_241_000 }), {
      businessDate: kemarin,
      today,
    });
    expect(v.kode).toBe("lebih_setor");
    expect(v.tone).toBe("yellow");
  });

  it("BELUM jatuh tempo + selaras → HIJAU seketika (bukan netral)", () => {
    // Inilah yang menggantikan varian legenda "belum tempo · terisi": hari yang
    // sudah diisi meninggalkan keadaan netral sama sekali, jadi "siapa sudah
    // mengisi hari ini" terbaca dari sel yang BUKAN arsir.
    const v = adminStatus(hari({ h: 545_494_253.0, i: 545_495_000 }), {
      businessDate: kemarin,
      today,
    });
    expect(v.kode).toBe("selaras");
    expect(v.tone).toBe("green");
  });

  it("hanya hari KOSONG yang ditahan sampai jatuh tempo", () => {
    const kosong = { nPendapatanLain: 0, nPengeluaran: 0, nSetoran: 0, i: null };
    expect(adminStatus(hari(kosong), { businessDate: kemarin, today }).tone).toBe("pending");
    expect(adminStatus(hari(kosong), { businessDate: lewatTempo, today }).tone).toBe("red");
  });


  // === SALIN-SETORAN — angka kemarin diketik ulang ==========================
  //
  // Data hidup sudah BERSIH (pengawas mengoreksi kasusnya sendiri), jadi tak ada
  // baris produksi yang bisa membuktikan aturan ini. Fixture di bawah memikul
  // SELURUH bebannya — angkanya nyata, dari Korek 2026-08-07.

  /** Korek: Rp 359.447.000 diketik untuk 08-07 DAN 08-06; H 08-07 meleset 3,87 jt. */
  const SALIN = { H: 355_569_871.5, I: 359_447_000, I_KEMARIN: 359_447_000 } as const;

  it("KASUS ASAL Korek 08-07: I identik kemarin + tak selaras = `setoran_tersalin` MERAH", () => {
    // KONTROL LEBIH DULU: dengan iSebelumnya null, hari yang SAMA persis hanya
    // `lebih_setor` kuning. Jadi yang mengubah vonis adalah kesamaan dengan
    // kemarin — bukan angka lain di fixture ini.
    const kontrol = adminStatus(hari({ h: SALIN.H, i: SALIN.I, iSebelumnya: null }), {
      businessDate: lewatTempo,
      today,
    });
    expect(kontrol.kode).toBe("lebih_setor");
    expect(kontrol.tone).toBe("yellow");

    const v = adminStatus(
      hari({ h: SALIN.H, i: SALIN.I, iSebelumnya: SALIN.I_KEMARIN }),
      { businessDate: lewatTempo, today },
    );
    expect(v.kode).toBe("setoran_tersalin");
    expect(v.tone).toBe("red");
    // Selisih yang dilaporkan owner saat menemukannya.
    expect(SALIN.I - SALIN.H).toBeCloseTo(3_877_128.5, 2);
  });

  it("TIDAK menyala bila I identik kemarin TAPI selaras dengan H (kebetulan sah)", () => {
    // Dua hari bisa saja bersetoran sama dan dua-duanya benar. Menandai itu
    // akan melatih orang mengabaikan aturannya.
    const v = adminStatus(
      hari({ h: 545_494_253.0, i: 545_495_000, iSebelumnya: 545_495_000 }),
      { businessDate: lewatTempo, today },
    );
    expect(v.kode).toBe("selaras");
    expect(v.tone).toBe("green");
  });

  it("MERAH juga saat arahnya `kurang_setor` — yang ditandai SEBABNYA, bukan arah", () => {
    const v = adminStatus(
      hari({ h: 400_000_000, i: 359_447_000, iSebelumnya: 359_447_000 }),
      { businessDate: lewatTempo, today },
    );
    expect(v.kode).toBe("setoran_tersalin");
  });

  it("kesamaan harus PERSIS: beda Rp 1 dari kemarin = bukan salinan", () => {
    const v = adminStatus(
      hari({ h: SALIN.H, i: SALIN.I, iSebelumnya: SALIN.I_KEMARIN - 1 }),
      { businessDate: lewatTempo, today },
    );
    expect(v.kode).toBe("lebih_setor");
  });

  it("syarat (b) dipikul URUTAN: hari ini tetap `hari_berjalan`, bukan tersalin", () => {
    // Ini yang menjaga aturan baru dari artefak C/D yang masih tumbuh. Kalau
    // blok salin-setoran naik ke atas gerbang `hari_berjalan`, tes ini merah.
    const v = adminStatus(
      hari({ h: SALIN.H, i: SALIN.I, iSebelumnya: SALIN.I_KEMARIN }),
      { businessDate: today, today },
    );
    expect(v.kode).toBe("hari_berjalan");
  });

  it("gerbang `tak_terhitung` tetap mendahului: 2 shift + salinan = pending", () => {
    const v = adminStatus(
      hari({ h: SALIN.H, i: SALIN.I, iSebelumnya: SALIN.I_KEMARIN, shifts: 2 }),
      { businessDate: lewatTempo, today },
    );
    expect(v.kode).toBe("tak_terhitung");
    expect(v.tone).toBe("pending");
  });

  it("dua hari sama-sama TANPA setoran tidak menyalakan aturan", () => {
    // null == null tak boleh dibaca "identik". Kasus ini punya vonisnya sendiri.
    const v = adminStatus(hari({ nSetoran: 0, i: null, iSebelumnya: null }), {
      businessDate: lewatTempo,
      today,
    });
    expect(v.kode).toBe("setoran_kosong");
  });

  // === H MASIH DIRAKIT (2026-08-07) — kelas, bukan kasus ====================

  /** KOREK 2026-08-07 — kasus NYATA, angka NYATA, snapshot 22:15:22 WIB. */
  const KOREK_08_07 = {
    A: 294_467_294.5, B: 0, C: 17_999_091, D: 9_798_025, F: 4_205_200, G: 618_000,
    I: 359_447_000, shiftsSaatItu: 2,
  } as const;

  it("KOREK 2026-08-07 (2 dari 3 shift): TIDAK BOLEH `lebih_setor`", () => {
    const h = uangTunai(KOREK_08_07);
    expect(h).toBeCloseTo(270_257_378.5, 2); // cocok layar Rincian produksi
    // KONTROL: tanpa gerbang, aturan setoran MENYALA — jadi gerbangnyalah yang
    // mengubah hasil, bukan kebetulan.
    expect(setoranStatus(h, KOREK_08_07.I)).toBe("lebih_setor");
    const v = adminStatus(hari({ h, i: KOREK_08_07.I, shifts: KOREK_08_07.shiftsSaatItu }), {
      businessDate: lewatTempo,
      today,
    });
    expect(v.kode).toBe("tak_terhitung");
    expect(v.tone).toBe("pending");
  });

  it("hari 3-shift dengan I >> H TETAP `lebih_setor` (aturan tak dilemahkan)", () => {
    const h = uangTunai(KOREK_08_07);
    const v = adminStatus(hari({ h, i: KOREK_08_07.I, shifts: SHIFT_TARGET }), {
      businessDate: lewatTempo,
      today,
    });
    expect(v.kode).toBe("lebih_setor");
    expect(v.tone).toBe("yellow");
  });

  it("batas SHIFT_TARGET tegas: di bawahnya ditahan, tepat di atasnya dinilai", () => {
    const h = 100_000_000;
    for (let n = 0; n < SHIFT_TARGET; n++) {
      expect(
        adminStatus(hari({ h, i: 200_000_000, shifts: n }), { businessDate: lewatTempo, today }).kode,
        `shifts=${n} seharusnya ditahan`,
      ).toBe("tak_terhitung");
    }
    expect(
      adminStatus(hari({ h, i: 200_000_000, shifts: SHIFT_TARGET }), { businessDate: lewatTempo, today }).kode,
    ).toBe("lebih_setor");
  });

  it("sinyal 'penjualan belum lengkap' TIDAK hilang — salesStatus tetap bersuara", () => {
    expect(salesStatus(2)).toBe("yellow");
    expect(salesStatus(0)).toBe("red");
    expect(salesStatus(SHIFT_TARGET)).toBe("green");
  });

  it("hari LENGKAP tetap dinilai SEKETIKA walau belum jatuh tempo", () => {
    const v = adminStatus(hari({ h: 343_322_289.52, i: 342_517_000, shifts: SHIFT_TARGET }), {
      businessDate: kemarin,
      today,
    });
    expect(v.kode).toBe("kurang_setor");
    expect(v.tone).toBe("red");
  });

  // === HARI BERJALAN TIDAK DINILAI (owner meninjau ulang, 2026-08-08) =======

  it("HARI INI: setoran jauh dari H TIDAK dinilai — `hari_berjalan`", () => {
    // Bukti dua-pengamat: Korek 08-07 dengan 3/3 shift, A tak bergerak, H turun
    // 23.516.922 dalam 18 menit dari pertumbuhan C+D.
    const v = adminStatus(hari({ h: 355_569_871.5, i: 359_447_000, shifts: SHIFT_TARGET }), {
      businessDate: today,
      today,
    });
    expect(v.kode).toBe("hari_berjalan");
    expect(v.tone).toBe("pending");
    // KONTROL: tanpa gerbang hari-ini, aturan setoran MENYALA lebih_setor.
    expect(setoranStatus(355_569_871.5, 359_447_000)).toBe("lebih_setor");
  });

  it("KEMARIN tetap dinilai SEKETIKA — gerbangnya hanya hari ini", () => {
    const v = adminStatus(hari({ h: 355_569_871.5, i: 359_447_000, shifts: SHIFT_TARGET }), {
      businessDate: kemarin,
      today,
    });
    expect(v.kode).toBe("lebih_setor");
    expect(v.tone).toBe("yellow");
  });

  it("hari ini KOSONG tetap terbaca 'belum diisi · belum tempo', bukan hari_berjalan", () => {
    const v = adminStatus(hari({ nPendapatanLain: 0, nPengeluaran: 0, nSetoran: 0, i: null }), {
      businessDate: today,
      today,
    });
    expect(v.kode).toBe("belum_tempo_kosong");
    expect(v.terisi).toBe(false);
  });

  it("gerbang shift kini menjaga HARI LAMPAU yang shift-nya tak pernah masuk", () => {
    // Bukan lagi "hari ini belum lengkap" — itu ditangani gerbang hari-berjalan.
    // Yang tersisa: agent gagal, hari lampau tak pernah punya 3 shift.
    const v = adminStatus(hari({ shifts: 1, h: 100_000_000, i: 200_000_000 }), {
      businessDate: lewatTempo,
      today,
    });
    expect(v.kode).toBe("tak_terhitung");
    expect(v.tone).toBe("pending");
  });

  it("D+2 adalah hari pertama yang bisa merah (batas jatuh tempo)", () => {
    const kosong = { nPendapatanLain: 0, nPengeluaran: 0, nSetoran: 0, i: null };
    expect(adminStatus(hari(kosong), { businessDate: "2026-08-06", today }).tone).toBe("pending");
    expect(adminStatus(hari(kosong), { businessDate: "2026-08-05", today }).tone).toBe("red");
  });
});

describe("rekon — sumber tunggal H", () => {
  it("H = E + F − G, cocok dengan angka Rincian nyata (IB 2026-07-24)", () => {
    const h = uangTunai({
      A: 738_164_896.0,
      B: 0,
      C: 75_528_943,
      D: 130_374_047,
      F: 14_619_600,
      G: 1_387_253,
    });
    expect(h).toBeCloseTo(545_494_253.0, 2);
  });
});

describe("staleness", () => {
  const now = new Date("2026-06-12T00:00:00Z");

  it("belum pernah input = stale", () => {
    const s = staleness(null, 26, now);
    expect(s.stale).toBe(true);
    expect(s.ageText).toBe("belum pernah");
  });

  it("input segar tidak stale", () => {
    expect(staleness("2026-06-11T20:00:00Z", 26, now).stale).toBe(false);
  });

  it("kas dorman 2019 = stale bertahun-tahun (kasus IB)", () => {
    const s = staleness("2019-04-17", 7 * 24, now);
    expect(s.stale).toBe(true);
    expect(s.ageText).toContain("TAHUN");
  });
});

describe("selisih abnormal", () => {
  it("ambang absolut 100 L", () => {
    expect(isSelisihAbnormal(-150, null)).toBe(true);
    expect(isSelisihAbnormal(50, null)).toBe(false);
  });
  it("ambang persen 0,5% dari basis", () => {
    expect(isSelisihAbnormal(-60, 10_000)).toBe(true); // 0,6%
    expect(isSelisihAbnormal(-40, 10_000)).toBe(false); // 0,4%
  });
});

describe("ageText", () => {
  it("skala jam/hari/tahun", () => {
    expect(ageText(0.5)).toBe("baru saja");
    expect(ageText(30)).toBe("30 jam lalu");
    expect(ageText(24 * 10)).toBe("10 hari lalu");
    expect(ageText(24 * 365 * 7)).toContain("TAHUN");
  });
});
