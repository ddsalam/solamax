import Link from "next/link";
import { notFound } from "next/navigation";
import { unitLabel } from "@/lib/config";
import { getAkunKas, getDayClose } from "@/lib/keuangan-input-queries";
import { panelBalance, panelIncome } from "@/lib/keuangan-laporan-model";
import { getBahanLaporan } from "@/lib/keuangan-laporan-queries";
import {
  barisUnit,
  LABEL_STATUS,
  PENJELASAN_STATUS,
  ringkasPapan,
  urutkanPapan,
  type BarisUnit,
} from "@/lib/keuangan-papan-model";
import { canInputKeuangan, canViewLaporanKeuangan } from "@/lib/keuangan-wewenang";
import { getDataScope, type ScopedUnit } from "@/lib/scope";
import { getSelection } from "@/lib/selection";
import { DATE_RE } from "@/lib/selection-keys";

export const dynamic = "force-dynamic";

/**
 * LAYAR 1 — Papan keuangan grup (mockup layar 1). **READ-ONLY.**
 *
 * ⛔ Pertanyaan pertama papan ini adalah **apakah pembukuan unit masih
 * seimbang**, baru labanya — laba dari pembukuan yang tidak seimbang bukan laba,
 * melainkan angka.
 *
 * ⚠️ **ONGKOS YANG DIBATASI DENGAN SENGAJA.** Menyusun laporan penuh untuk
 * setiap unit mahal. Papan ini hanya menyusunnya untuk unit yang
 * **termodelkan** — yang punya daftar rekening kas. Batas itu bukan penghematan
 * diam-diam: ia tertulis di sini.
 *
 * 📌 **DIUKUR 18 Agu 2026, bukan ditaksir** — dan taksiran lama SALAH:
 *
 * | besaran | ditulis semula | TERUKUR |
 * |---|---|---|
 * | kueri per unit termodelkan | ≈16 | **22** |
 * | tujuh unit | ≈112 | **154** |
 *
 * Wall-clock (tier pengujian, **tabel kosong** — jadi ini **BATAS BAWAH**, bukan
 * ongkos sebenarnya): 1 unit **294 ms**, 7 unit paralel **847 ms**, rasio
 * **2,88×** pada `pool.max = 10`. Rasio yang jauh di bawah 7 menunjukkan
 * antreannya belum jenuh pada beban itu.
 *
 * ⛔ Yang **belum** terukur, dan disebut apa adanya: tier pengujian tak punya
 * satu pun baris `sales_header`/`cash_ledger`, sehingga suku yang dominan di
 * produksi — `getDailyGlByProduct` dan `getSaldoPelanggan` atas data EasyMax
 * nyata — **tidak ikut terukur di sini**. Angka di atas membatasi dari bawah;
 * ia tidak membuktikan papan tetap cepat di produksi.
 */
export default async function PapanKeuanganPage({
  searchParams,
}: {
  searchParams: Promise<{ tanggal?: string }>;
}) {
  const scope = await getDataScope();
  if (!canViewLaporanKeuangan({ role: scope.role, email: scope.email })) notFound();
  // Keadaan kosong menyebut pekerjaannya; tautannya hanya bagi yang bisa mengerjakannya.
  const bolehDaftar = canInputKeuangan({ role: scope.role, email: scope.email });

  const sp = await searchParams;
  const seleksi = getSelection(scope.units);
  const date = sp.tanggal && DATE_RE.test(sp.tanggal) ? sp.tanggal : seleksi.date;
  const kemarin = new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

  const baris = await Promise.all(scope.units.map((u) => barisUntukUnit(u, date, kemarin)));
  const urut = urutkanPapan(baris);
  const r = ringkasPapan(baris);

  const rp = (n: number | null): string =>
    n === null ? "belum bisa dihitung" : n.toLocaleString("id-ID", { maximumFractionDigits: 0 });

  return (
    <>
      <h1 className="text-h3 t-brand">Papan keuangan grup</h1>
      <p className="fs16 t-tertiary mt2">
        Kolom paling kanan adalah angka pemeriksa neraca — kalau ia bukan nol, angka di
        sebelah kirinya belum boleh dipercaya.
      </p>

      <div className="kpi-grid mt6">
        <div className="card card-pad">
          {/* ⛔ Penyebutnya "sudah diperiksa", BUKAN "termodelkan". Unit yang tak
              pernah dibuka tidak ada di pembilang MAUPUN penyebut — memasukkannya
              ke penyebut akan membuat kartunya berbunyi "0 / 1" seolah ia
              diperiksa lalu gagal, padahal ia belum diperiksa. */}
          <div className="fs16 t-tertiary">Pembukuan seimbang</div>
          <div className="tutup-angka num">
            {r.seimbang} / {r.diperiksa}
          </div>
          <div className="fs16 t-secondary">
            dari unit yang <strong>sudah diperiksa</strong> hari ini
            {r.belumPernahDibuka > 0 && (
              <>
                {" · "}
                <span className="t-danger">
                  {r.belumPernahDibuka} unit belum pernah dibuka — belum diperiksa, bukan seimbang
                </span>
              </>
            )}
          </div>
        </div>
        <div className="card card-pad">
          <div className="fs16 t-tertiary">Laba bersih hari ini</div>
          <div className="tutup-angka num">{rp(r.labaBersih)}</div>
          <div className="fs16 t-secondary">
            {r.takTerhitung.length > 0
              ? `belum lengkap: ${r.takTerhitung.join(", ")}`
              : `${r.termodelkan} unit termodelkan`}
          </div>
        </div>
        <div className="card card-pad">
          <div className="fs16 t-tertiary">Kas akhir</div>
          <div className="tutup-angka num">{rp(r.kasAkhir)}</div>
          <div className="fs16 t-secondary">seluruh akun kas unit termodelkan</div>
        </div>
      </div>

      <div className="banner info keu-banner" role="status">
        <b>Yang dinilai adalah LANGKAH HARIAN, bukan nilai kumulatif</b>
        <p className="keu-p">
          <em>Balance sheet check</em> kumulatif belum tersedia — saldo pembuka ekuitas hidup
          di workbook dan impor riwayat belum dikerjakan. Kolom di bawah menampilkan
          <strong> selisihnya terhadap kemarin</strong>, dan itulah yang gerbang §3.2 nilai.
        </p>
      </div>

      <div className="section-h mt6">
        <h2 className="text-h3">Per unit</h2>
        <span className="fs16 t-tertiary">diurut dari yang paling perlu dilihat</span>
      </div>

      <div className="card tbl-card tbl-scroll">
        <div className="grid-head cols-papan">
          <span>SPBU</span>
          <span className="right">Neraca — langkah harian</span>
          <span>Status</span>
          <span className="right">Laba bersih</span>
          <span className="right">Kas akhir</span>
        </div>
        {urut.map((b) => (
          <div className="grid-row cols-papan" key={b.unitId}>
            <span className="w600">
              {b.status === "belum_dimodelkan" ? (
                <>
                  {b.nama} <span className="meta">· {unitLabel(b.code)}</span>
                </>
              ) : (
                <Link href={`/keuangan/unit/${b.code}/tutup-hari/${date}`}>
                  {b.nama} <span className="meta">· {unitLabel(b.code)}</span>
                </Link>
              )}
            </span>
            {/* Pemeriksa lebih dulu, laba menyusul — urutan kolom mengikuti
                pertanyaan yang papan ini jawab. */}
            <span className={`right num ${b.nada === "buruk" ? "t-danger" : ""}`}>
              {b.langkahHarian === null ? (
                <span className="t-tertiary lap-kosong">belum bisa dihitung</span>
              ) : (
                b.langkahHarian.toLocaleString("id-ID")
              )}
            </span>
            <span className="fs16">
              <span className={`keu-chip status-${b.status}`}>{LABEL_STATUS[b.status]}</span>
              <span className="fs16 t-tertiary keu-p">
                {PENJELASAN_STATUS[b.status]}{" "}
                {b.status === "belum_dimodelkan" && bolehDaftar && (
                  <a href={`/keuangan/unit/${b.code}/akun-kas`}>Daftarkan rekeningnya.</a>
                )}
              </span>
            </span>
            <span className="right num t-secondary">
              {b.labaBersih === null ? <span className="t-tertiary">—</span> : rp(b.labaBersih)}
            </span>
            <span className="right num t-secondary">
              {b.kasAkhir === null ? <span className="t-tertiary">—</span> : rp(b.kasAkhir)}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

/**
 * Satu baris papan. Unit tanpa akun kas **tidak dihitung laporannya sama
 * sekali** — itulah yang menjaga ongkos papan ini tetap sebanding dengan jumlah
 * unit yang benar-benar termodelkan.
 */
async function barisUntukUnit(u: ScopedUnit, date: string, kemarin: string): Promise<BarisUnit> {
  const [akun, dayClose] = await Promise.all([getAkunKas(u.unit_id), getDayClose(u.unit_id, date)]);
  if (akun.length === 0) {
    return barisUnit({
      unitId: u.unit_id,
      code: u.code,
      nama: u.name,
      adaAkunKas: false,
      labaBersih: null,
      kasAkhir: null,
      langkahHarian: null,
      dayClose: dayClose === null ? null : { status: dayClose.status, differenceRp: dayClose.differenceRp },
    });
  }

  const bahan = await getBahanLaporan(u.unit_id, date, kemarin);
  const is = panelIncome({
    totals: bahan.totals,
    beban: bahan.beban,
    pendapatanLain: bahan.pendapatanLain,
    incomeAdjustment: null,
  });
  const netProfit = is.baris.find((x) => x.label === "Net profit")!.nilai;
  const bs = panelBalance({
    cashOnHand: bahan.kasAkhir,
    inventoryValue: bahan.totals.inventoryValue,
    soValue: bahan.totals.soValue,
    piutangEasymax: bahan.piutangEasymax,
    hutangPiutangNonEasymax: bahan.hutangPiutangNonEasymax,
    openedRetainedEarnings: null,
    netIncome: netProfit ?? 0,
    incomeAdjustment: null,
    totalAssetKemarin: bahan.totalAssetKemarin,
    deltaKontribusi: null,
  });

  return barisUnit({
    unitId: u.unit_id,
    code: u.code,
    nama: u.name,
    adaAkunKas: true,
    labaBersih: netProfit,
    kasAkhir: bahan.kasAkhir,
    langkahHarian: bs.langkahHarian,
    dayClose: dayClose === null ? null : { status: dayClose.status, differenceRp: dayClose.differenceRp },
  });
}
