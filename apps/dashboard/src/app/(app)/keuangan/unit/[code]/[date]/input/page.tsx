import { notFound } from "next/navigation";
import { BukuKasPanel } from "@/components/keuangan/BukuKasPanel";
import { HargaBeliPanel } from "@/components/keuangan/HargaBeliPanel";
import { unitLabel } from "@/lib/config";
import { DATE_RE } from "@/lib/selection-keys";
import {
  getAkunKas,
  getHargaBeliRows,
  getHargaJualHistory,
  getKategoriMutasi,
  getMutasiKas,
  getProdukUnit,
  getSetoranPengawas,
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
            aplikasi. Saat ini baru unit Bakau yang punya daftar itu.
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

      <div className="section-h mt8">
        <h3 className="text-h3">3 · Settlement EDC</h3>
      </div>
      <div className="card empty-inline">
        Belum dibangun — menyusul. Jurnal pencairan H+1 akan muncul sebagai usulan yang harus
        disetujui, bukan sebagai baris yang sudah diposting (§1.4).
      </div>

      <div className="section-h mt8">
        <h3 className="text-h3">4 · Biaya operasional &amp; pendapatan lain-lain</h3>
      </div>
      <div className="card empty-inline">
        Belum dibangun — menyusul. Baris dari Rincian Penjualan akan tampil read-only dengan
        keping asal-usulnya; tidak akan ada tombol Edit generik, sekarang maupun nanti (§2.3).
      </div>
    </>
  );
}

/** Tanggal bisnis satu hari sebelum `date` — UTC murni, bebas zona waktu. */
function hariSebelum(date: string): string {
  const t = Date.parse(`${date}T00:00:00Z`) - 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}
