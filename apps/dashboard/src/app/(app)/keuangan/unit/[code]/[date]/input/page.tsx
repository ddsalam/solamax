import { notFound } from "next/navigation";
import { BiayaPanel } from "@/components/keuangan/BiayaPanel";
import { BukuKasPanel } from "@/components/keuangan/BukuKasPanel";
import { EdcPanel } from "@/components/keuangan/EdcPanel";
import { HargaBeliPanel } from "@/components/keuangan/HargaBeliPanel";
import { unitLabel } from "@/lib/config";
import { DATE_RE } from "@/lib/selection-keys";
import {
  getAkunKas,
  getHargaBeliRows,
  getHargaJualHistory,
  getKategoriMutasi,
  getMutasiKas,
  getBiayaHarian,
  getPetaKategori,
  getProdukUnit,
  getReasonCodeClosing,
  getSetoranPengawas,
  getSettlements,
} from "@/lib/keuangan-input-queries";
import { barisHargaBeli, ringkasPenjaga } from "@/lib/keuangan-harga-model";
import { saldoAkun } from "@/lib/keuangan-kas";
import {
  barisBuku,
  kakiBuku,
  nilaiTertunda,
  tawaranSetoran,
  type BarisBuku,
  type KakiBuku,
} from "@/lib/keuangan-kas-model";
import {
  alasanTakBolehInput,
  canInputKeuangan,
  canViewLaporanKeuangan,
  PESAN_TAK_BOLEH_INPUT,
} from "@/lib/keuangan-wewenang";
import { getDataScope } from "@/lib/scope";

export const dynamic = "force-dynamic";

/**
 * LAYAR 3 — Input keuangan harian (mockup layar 3).
 *
 * Empat blok isian. Yang sudah dihitung SolaMax sendiri — volume, stok, sisa DO,
 * tera, piutang pelanggan — **tidak muncul di sini sama sekali**.
 *
 * Putaran ini membangun **blok 1** saja (harga beli). Blok 2–4 (buku kas besar &
 * lima buku bank · settlement EDC · biaya operasional) menyusul sebagai PR
 * masing-masing. Kerangkanya sengaja menyebut ketiganya sebagai keadaan kosong
 * yang EKSPLISIT: halaman yang diam soal blok yang belum ada membuat pembacanya
 * mengira itu semua isinya.
 *
 * Gerbang: `getDataScope()` → `requireUnit(code)` (di luar scope = 404 identik,
 * tak membocorkan keberadaan unit lintas-tenant). Hak TULIS terpisah dari hak
 * BACA — §2.6, `canInputKeuangan`.
 */
export default async function InputKeuanganPage({
  params,
}: {
  params: Promise<{ code: string; date: string }>;
}) {
  const { code, date } = await params;
  if (!DATE_RE.test(date)) notFound();

  const scope = await getDataScope();
  const unit = scope.requireUnit(code);
  // ⛔ GERBANG BACA — ditambahkan 17 Agu 2026 setelah tinjauan pra-promosi
  // menemukan rute ini SATU-SATUNYA dari lima yang tidak punya gerbang baca.
  //
  // Konsekuensinya bukan teoretis: pengawas yang membukanya melihat harga beli,
  // SALDO tujuh rekening kas/bank, settlement EDC, dan klasifikasi akuntansi —
  // panel-panelnya merender tabelnya tanpa peduli `bolehTulis`, yang hanya
  // menyembunyikan formulir.
  //
  // Dasarnya BUKAN keputusan baru: §10.13 sudah memutuskan pengawas tidak
  // melihat "saldo tujuh rekening", dan saldo yang sama ada di layar ini. Yang
  // hilang adalah penerapannya di rute ini, bukan keputusannya.
  if (!canViewLaporanKeuangan({ role: scope.role, email: scope.email })) notFound();

  const bolehTulis = canInputKeuangan({ role: scope.role, email: scope.email });
  const alasan = alasanTakBolehInput({ role: scope.role, email: scope.email });

  const [produk, buyRows, sellHistory, akun, mutasi, kategori, setoran] = await Promise.all([
    getProdukUnit(unit.unit_id),
    getHargaBeliRows(unit.unit_id),
    getHargaJualHistory(unit.unit_id, date),
    getAkunKas(unit.unit_id),
    getMutasiKas(unit.unit_id, date),
    getKategoriMutasi(unit.unit_id),
    getSetoranPengawas(unit.unit_id, date),
  ]);

  // Blok 3 — jendela settlement: 60 hari ke belakang supaya kontrol MDR% punya
  // lebih dari satu bulan untuk dibandingkan. Pergeseran tarif hanya terlihat
  // bila ada bulan pembanding.
  const [settlements, reasonCodes, biaya, petaKategori] = await Promise.all([
    getSettlements(unit.unit_id, mundur(date, 60), date),
    getReasonCodeClosing(unit.unit_id),
    getBiayaHarian(unit.unit_id, date),
    getPetaKategori(unit.unit_id, date),
  ]);

  const baris = barisHargaBeli(produk, buyRows, sellHistory, date);
  const penjaga = ringkasPenjaga(baris);

  // Blok 2 — saldo DIHITUNG di sini, tak pernah dibaca dari kolom mana pun.
  const kemarin = hariSebelum(date);
  const bukuPerAkun: Record<string, BarisBuku[]> = {};
  const saldoAwalPerAkun: Record<string, number> = {};
  const kakiPerAkun: Record<string, KakiBuku> = {};
  for (const a of akun) {
    const awal = saldoAkun(mutasi, a.id, kemarin);
    const rows = barisBuku(mutasi, a.id, date, kemarin);
    saldoAwalPerAkun[a.id] = awal;
    bukuPerAkun[a.id] = rows;
    kakiPerAkun[a.id] = kakiBuku(rows, awal);
  }
  const sudahDipakai = new Set(
    mutasi.filter((m) => !m.void && m.sourceManualEntryId).map((m) => m.sourceManualEntryId!),
  );
  const tawaran = tawaranSetoran(setoran, sudahDipakai);

  return (
    <>
      <h1 className="text-h3 t-brand">Input keuangan harian</h1>
      <div className="fs16 t-secondary mt2">
        {unit.name} · {unitLabel(unit.code)} — {date}
      </div>
      <p className="fs16 t-tertiary mt2">
        Empat blok isian. Angka yang sudah dihitung SolaMax sendiri — volume, stok, sisa DO,
        tera, piutang pelanggan — tidak muncul di sini sama sekali.
      </p>

      {!bolehTulis && (
        <div className="banner info keu-banner" role="status">
          <b>Anda melihat halaman ini sebagai pembaca</b>
          <p className="keu-p">
            {alasan === null ? "" : PESAN_TAK_BOLEH_INPUT[alasan]} Angkanya tetap terbuka untuk
            diperiksa siapa pun yang boleh melihat unit ini.
          </p>
        </div>
      )}

      <div className="mt6">
        <HargaBeliPanel
          code={unit.code}
          date={date}
          baris={baris}
          penjaga={penjaga}
          bolehTulis={bolehTulis}
        />
      </div>

      {akun.length === 0 ? (
        <>
          <div className="section-h mt10">
            <h3 className="text-h3">2 · Buku kas besar &amp; buku bank</h3>
          </div>
          {/* KOSONG SECARA EKSPLISIT. Panel yang diam pada unit tanpa akun kas
              terbaca sebagai "tidak ada mutasi hari ini" — padahal bukunya
              sendiri yang belum ada. */}
          <div className="card empty-inline">
            Belum ada akun kas untuk unit ini. Buku kas besar dan buku bank baru bisa dipakai
            setelah daftar rekening riilnya didaftarkan — itu pekerjaan data, bukan cacat
            aplikasi.{" "}
            {/* Kalimat yang menyebut pekerjaannya tanpa memberi pintunya membuat
                orang mencarinya sendiri. Pintunya hanya bagi yang berwenang. */}
            {bolehTulis && (
              <a href={`/keuangan/unit/${unit.code}/akun-kas`}>Daftarkan rekeningnya di sini.</a>
            )}
          </div>
        </>
      ) : (
      <div className="mt10">
        <BukuKasPanel
          code={unit.code}
          date={date}
          akun={akun}
          bukuPerAkun={bukuPerAkun}
          saldoAwalPerAkun={saldoAwalPerAkun}
          kakiPerAkun={kakiPerAkun}
          kategori={kategori}
          tawaran={tawaran}
          nilaiTertunda={nilaiTertunda(tawaran)}
          bolehTulis={bolehTulis}
        />
      </div>
      )}

      <div className="mt10">
        <EdcPanel
          code={unit.code}
          date={date}
          settlements={settlements}
          akun={akun}
          reasonCodes={reasonCodes}
          bolehTulis={bolehTulis}
        />
      </div>

      <div className="mt10">
        <BiayaPanel
          code={unit.code}
          date={date}
          baris={biaya}
          peta={petaKategori}
          bolehTulis={bolehTulis}
        />
      </div>
    </>
  );
}

/** Tanggal bisnis satu hari sebelum `date` — UTC murni, bebas zona waktu. */
function hariSebelum(date: string): string {
  return mundur(date, 1);
}

/** `date` dikurangi `n` hari, tetap sebagai tanggal bisnis `YYYY-MM-DD`. */
function mundur(date: string, n: number): string {
  const t = Date.parse(`${date}T00:00:00Z`) - n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}
