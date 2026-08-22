import Link from "next/link";
import { todayWib } from "@/lib/periods";
import { UnitDateFilters } from "@/components/UnitDateFilters";
import { ukur } from "@/lib/ukur-kueri";
import { PapanExportMount } from "@/components/keuangan/PapanExportMount";
import { PapanCsvButton } from "@/components/keuangan/PapanCsvButton";
import { ptLabelForUnits, unitDotted } from "@/lib/config";
import { buildReportFilename } from "@/lib/export/filename";
import { dateShort, timeWib } from "@/lib/format";
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
 * 📌 **DIUKUR, bukan ditaksir** — sumbernya `ukur-kueri.ts`, dipasang di jalur
 * nyata dan bisa dijalankan ulang kapan saja
 * (`UKUR_LIVE_DB=1 … ukur-kueri.integration.test.ts`). Terukur 19 Agu 2026 di
 * tier PENGUJIAN:
 *
 * | besaran | TERUKUR |
 * |---|---|
 * | kueri logis `getBahanLaporan`, per unit termodelkan | **16** |
 * | round-trip SQL untuk 16 kueri itu | **64** |
 * | kueri logis satu papan, 3 unit (1 termodelkan) | **19** |
 *
 * ⛔ **KOREKSI ATAS ANGKA YANG PERNAH DITULIS DI SINI.** Baris ini sebelumnya
 * menyebut "22 kueri per unit termodelkan" dan menyatakan taksiran lama (≈16)
 * meleset 37%. **Itu salah, dan arah salahnya terbalik:** 16 adalah angka yang
 * benar untuk `getBahanLaporan`, sedangkan 22 adalah ongkos SATU PAPAN pada tier
 * 3-unit (16 + 3× `getAkunKas` + 3× `getDayClose`) yang keliru dibaca sebagai
 * per-unit. Yang melahirkan kekeliruan itu persis yang kini dijaga: angka tanpa
 * alat ukur yang bisa dijalankan ulang.
 *
 * 🔑 **Yang benar-benar baru: 64 round-trip untuk 16 kueri.** Tiap `qScoped`
 * berharga empat (BEGIN · set_config · kueri · COMMIT). Inilah besaran yang
 * menekan `pool.max = 10`, dan ia tak pernah terlihat selama yang dihitung hanya
 * "kueri".
 *
 * ⛔ Yang **belum** terukur, dan disebut apa adanya:
 *  · Tier pengujian tak punya satu pun baris `sales_header`/`cash_ledger`,
 *    sehingga suku dominan di produksi — `getDailyGlByProduct` dan
 *    `getSaldoPelanggan` atas data EasyMax nyata — tidak ikut terukur.
 *  · **Wall-clock dari laptop tidak sebanding dengan produksi** dan sengaja
 *    tidak dikutip di sini: 64 round-trip × RTT laptop→GCP mendominasi
 *    segalanya. Angka JUMLAH boleh dibawa ke mana saja; angka DURASI hanya sah
 *    dari log Cloud Run, dan instrumen ini menuliskannya di sana tiap kali papan
 *    dibuka.
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

  // 📏 Skop ukur PAPAN: membungkus seluruh loop, jadi barisnya adalah ongkos
  // satu halaman utuh — sementara tiap `getBahanLaporan` di dalamnya menulis
  // barisnya sendiri. Dua angka dari satu pemakaian nyata; tak ada beban tiruan.
  const baris = await ukur("papan", () =>
    Promise.all(scope.units.map((u) => barisUntukUnit(u, date, kemarin))),
  );
  const urut = urutkanPapan(baris);
  const r = ringkasPapan(baris);

  const rp = (n: number | null): string =>
    n === null ? "belum bisa dihitung" : n.toLocaleString("id-ID", { maximumFractionDigits: 0 });

  return (
    <>
      {/* ⛔ TANPA pemilih unit, dan itu keputusan: papan ini menampilkan SEMUA
          unit dalam cakupan sekaligus, jadi pemilih unit di sini tak mengubah
          apa pun — dan kontrol yang tak mengubah apa pun mengajari orang bahwa
          kontrol di halaman ini tak berarti. Yang berarti hanya TANGGAL, dan
          sampai hari ini halaman ini membaca `?tanggal=` tanpa punya cara
          mengubahnya sama sekali. */}
      <UnitDateFilters
        units={scope.units.map((u) => ({ code: u.code, name: u.name, dotted: unitDotted(u.code) }))}
        code={scope.units[0]?.code ?? ""}
        segment="keuangan-papan"
        dimensiUnit="tak_berlaku"
        date={date}
        today={todayWib()}
        maxDate={todayWib()}
      />
      <div className="section-h">
        <h1 className="text-h3 t-brand">Papan keuangan grup</h1>
        {/* "Cetak ringkasan" (mockup Layar 1). Ekspor terjadi di peramban pada
            halaman yang SUDAH lolos gerbang bacanya — bukan rute baru. */}
        <PapanCsvButton
          baris={baris}
          tanggal={date}
          filename={buildReportFilename({
            reportName: "Ringkasan-Keuangan-Grup",
            scope: ptLabelForUnits(scope.units.map((u) => u.code)),
            period: date,
            generated: date,
          }).replace(/\.pdf$/, ".csv")}
        />
        <PapanExportMount
          baris={baris}
          kop={{
            ptLabel: ptLabelForUnits(scope.units.map((u) => u.code)),
            judul: "Ringkasan keuangan grup",
            subjudul: `${scope.units.length} unit dalam cakupan — ${date}`,
            generatedLabel: `${dateShort(date)} · ${timeWib(new Date().toISOString())}`,
            dicetakOleh: scope.email ?? "",
          }}
          filename={buildReportFilename({
            reportName: "Ringkasan-Keuangan-Grup",
            scope: ptLabelForUnits(scope.units.map((u) => u.code)),
            period: date,
            generated: date,
          })}
        />
      </div>
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
            {r.tanpaLaba.length > 0
              ? `belum lengkap: ${r.tanpaLaba.join(", ")}`
              : `${r.termodelkan} unit termodelkan`}
          </div>
        </div>
        <div className="card card-pad">
          <div className="fs16 t-tertiary">Kas akhir</div>
          <div className="tutup-angka num">{rp(r.kasAkhir)}</div>
          {/* ⛔ Sebabnya DISEBUT, dan ia BERBEDA dari sebab laba (§10.21).
              Kartu yang diam saat angkanya null membuat pembacanya mengira nol. */}
          <div className="fs16 t-secondary">
            {r.tanpaKas.length > 0
              ? `belum ada mutasi kas: ${r.tanpaKas.join(", ")} — bukunya belum diisi, bukan nol`
              : "seluruh akun kas unit termodelkan"}
          </div>
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
              {/* §10.22 — PENGAMATAN, bukan tuduhan. Unitnya TETAP tampil:
                  menandai membuat kekurangannya terlihat, menyembunyikan
                  membuat unitnya yang tak terlihat. */}
              {b.kekuranganBagan.length > 0 && (
                <span className="fs16 t-tertiary keu-p">
                  bagan akun belum lengkap — belum ada {b.kekuranganBagan.join(" & ")}; tim
                  keuangan yang mendaftarkannya
                </span>
              )}
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
      kindAkun: [],
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
    sebabKas: bahan.sebabKas,
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
    kindAkun: akun.map((a) => a.kind),
    labaBersih: netProfit,
    kasAkhir: bahan.kasAkhir,
    langkahHarian: bs.langkahHarian,
    dayClose: dayClose === null ? null : { status: dayClose.status, differenceRp: dayClose.differenceRp },
  });
}
