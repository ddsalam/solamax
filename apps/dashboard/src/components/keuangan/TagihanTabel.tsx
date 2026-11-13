import { dateShort, rp } from "@/lib/format";
import {
  BATAS_JATUH_TEMPO_EASYMAX_HARI,
  tagihanJatuhTempoLabel,
  tagihanStatusBayarLabel,
  tagihanSumberJatuhTempoLabel,
  type TagihanStatus,
} from "@/lib/tagihan-model";
import {
  TAGIHAN_BELUM_TERSEDIA,
  type CocokSaldoPelanggan,
  type TagihanBaris,
  type TagihanPembayaranBaris,
} from "@/lib/tagihan-queries";
import { tagihanFakturHref } from "@/lib/tagihan-route";

/**
 * Bagian bersama layar Tagihan pelanggan (rencana 2026-11-13 U7/U8): pil
 * status, tabel faktur (S1 dan S6), tabel pembayaran (S2 dan S6), baris
 * cocok-silang R20 (S3 dan S6), dan keadaan "belum tersedia" (KTD11).
 *
 * ⛔ Tidak ada vonis di sini. Status, penanda dan angka datang jadi dari
 * `deriveTagihanStatus`; berkas ini hanya menyajikannya.
 */

/** Tanggal ISO → "11 Jun 2026"; kosong/`null` → "—". */
export function tanggalTagihan(iso: string | null | undefined): string {
  return iso ? dateShort(iso) : "—";
}

/** Penjelasan penanda "beda dengan EasyMax" — dipakai `title` di daftar dan panel di rincian. */
export const PENJELASAN_BEDA_EASYMAX =
  "Status atau sisa hitungan SolaMax (nilai faktur dikurangi pembayaran yang tidak batal) tidak sama dengan yang tercatat di EasyMax. Buka faktur untuk melihat keduanya berdampingan.";

export function penjelasanJtTakWajar(jatuhTempoEasymax: string | null): string {
  return `Jatuh tempo di EasyMax${jatuhTempoEasymax ? ` (${tanggalTagihan(jatuhTempoEasymax)})` : ""} sebelum tanggal faktur atau lebih dari ${BATAS_JATUH_TEMPO_EASYMAX_HARI} hari sesudahnya, jadi tidak dipakai. Jatuh tempo dihitung dari termin SolaMax.`;
}

const NADA_JATUH_TEMPO = {
  lewat_jatuh_tempo: "danger",
  belum_jatuh_tempo: "neutral",
  termin_belum_diatur: "warning",
} as const;

const NADA_BAYAR = {
  sebagian: "warning",
  lunas: "success",
  lebih_bayar: "info",
} as const;

/**
 * Pil status satu faktur. Faktur bersisa selalu punya pil jatuh tempo; faktur
 * yang dibayar sebagian membawa DUA pil (R5).
 */
export function TagihanStatusPills({
  status,
}: {
  status: Pick<TagihanStatus, "statusBayar" | "statusJatuhTempo" | "hariLewat" | "hariMenujuJatuhTempo">;
}) {
  const jatuhTempo = tagihanJatuhTempoLabel(status);
  const bayar = tagihanStatusBayarLabel(status.statusBayar);
  return (
    <span className="tagihan-pills">
      {jatuhTempo && status.statusJatuhTempo && (
        <span className={`status-pill ${NADA_JATUH_TEMPO[status.statusJatuhTempo]}`}>{jatuhTempo}</span>
      )}
      {bayar && status.statusBayar !== "belum_dibayar" && (
        <span className={`status-pill ${NADA_BAYAR[status.statusBayar]}`}>{bayar}</span>
      )}
    </span>
  );
}

/**
 * Tabel faktur — kolom S1. `tampilkanPelanggan={false}` untuk halaman
 * pelanggan (S6), tempat nama pelanggan sudah menjadi judul halaman.
 */
export function TagihanFakturTabel({
  unitCode,
  baris,
  tampilkanPelanggan = true,
  label,
}: {
  unitCode: string;
  baris: readonly TagihanBaris[];
  tampilkanPelanggan?: boolean;
  label: string;
}) {
  return (
    <div className="tbl-scroll">
      <table className="tagihan-tbl" aria-label={label}>
        <thead>
          <tr>
            <th scope="col">{tampilkanPelanggan ? "Pelanggan · no. faktur" : "No. faktur"}</th>
            <th scope="col">Tgl faktur</th>
            <th scope="col">Jatuh tempo</th>
            <th scope="col" className="right">Nilai</th>
            <th scope="col" className="right">Dibayar</th>
            <th scope="col" className="right">Sisa</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {baris.map((b) => {
            const { faktur, status } = b;
            const sumber = tagihanSumberJatuhTempoLabel(status);
            return (
              <tr key={faktur.kode}>
                <td>
                  {tampilkanPelanggan && (
                    <>
                      <strong>{b.namaPelanggan?.trim() || "Nama belum tersedia"}</strong>
                      <span className="tagihan-sub mono">{faktur.customerCode || "—"}</span>
                    </>
                  )}
                  <a className="tagihan-kode mono" href={tagihanFakturHref(unitCode, faktur.kode)}>
                    {faktur.kode}
                  </a>
                  {(status.bedaStatus || status.bedaSisa) && (
                    <span className="tagihan-sub tagihan-tanda" title={PENJELASAN_BEDA_EASYMAX}>
                      beda dengan EasyMax
                    </span>
                  )}
                </td>
                <td className="num">
                  {b.tanggalFakturKosong ? "—" : tanggalTagihan(faktur.tanggalFaktur)}
                  {b.tanggalFakturKosong && <span className="tagihan-sub">kosong di EasyMax</span>}
                </td>
                <td className="num">
                  {tanggalTagihan(status.jatuhTempo)}
                  {sumber && <span className="tagihan-sub">{sumber}</span>}
                  {status.jtEasymaxTakWajar && (
                    <span
                      className="tagihan-sub tagihan-tanda"
                      title={penjelasanJtTakWajar(faktur.jatuhTempoEasymax)}
                    >
                      JT EasyMax tak wajar
                    </span>
                  )}
                </td>
                <td className="right num">{rp(status.nilai)}</td>
                <td className="right num">
                  {rp(status.dibayar)}
                  {b.tanggalBayarTerakhir && (
                    <span className="tagihan-sub">terakhir {tanggalTagihan(b.tanggalBayarTerakhir)}</span>
                  )}
                </td>
                <td className="right num w600">{rp(status.sisa)}</td>
                <td>
                  <TagihanStatusPills status={status} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Jumlah pembayaran yang DIHITUNG, rupiah bulat: pembayaran batal dan
 * pembayaran pada faktur batal tak pernah ikut (R6).
 */
export function totalPembayaranHidup(
  pembayaran: readonly Pick<TagihanPembayaranBaris, "jumlah" | "batal" | "fakturBatal">[],
): number {
  return Math.round(pembayaran.reduce((total, p) => (p.batal || p.fakturBatal ? total : total + p.jumlah), 0)) || 0;
}

/**
 * Tabel pembayaran. Pembayaran batal tetap tampil — dicoret, dengan alasannya
 * — dan tidak ikut baris total. `unitCode` diisi = tampilkan kolom faktur
 * (S6, lintas faktur).
 */
export function TagihanPembayaranTabel({
  pembayaran,
  unitCode,
  label,
}: {
  pembayaran: readonly TagihanPembayaranBaris[];
  unitCode?: string;
  label: string;
}) {
  const batal = pembayaran.filter((p) => p.batal || p.fakturBatal).length;
  const kolom = unitCode ? 5 : 4;
  return (
    <div className="tbl-scroll">
      <table className="tagihan-tbl" aria-label={label}>
        <thead>
          <tr>
            <th scope="col">No. pembayaran</th>
            {unitCode && <th scope="col">Faktur</th>}
            <th scope="col">Tanggal</th>
            <th scope="col">No. bukti</th>
            <th scope="col" className="right">Jumlah</th>
          </tr>
        </thead>
        <tbody>
          {pembayaran.map((p) => (
            <tr key={`${p.kodeFaktur}/${p.kode}`} className={p.batal ? "tagihan-batal" : undefined}>
              <td>
                <span className="tagihan-coret mono">{p.kode}</span>
                {p.batal && (
                  <span className="tagihan-sub tagihan-tanda">
                    Batal{p.alasanBatal ? ` — ${p.alasanBatal}` : " — alasan tidak dicatat"}
                  </span>
                )}
                {!p.batal && p.keterangan && <span className="tagihan-sub">{p.keterangan}</span>}
              </td>
              {unitCode && (
                <td>
                  <a className="mono" href={tagihanFakturHref(unitCode, p.kodeFaktur)}>{p.kodeFaktur}</a>
                  {p.fakturBatal && <span className="tagihan-sub tagihan-tanda">faktur batal</span>}
                </td>
              )}
              <td className="num"><span className="tagihan-coret">{tanggalTagihan(p.tanggal)}</span></td>
              <td><span className="tagihan-coret">{p.bukti ?? "—"}</span></td>
              <td className="right num"><span className="tagihan-coret">{rp(p.jumlah)}</span></td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" colSpan={kolom - 1}>
              Total pembayaran{batal > 0 ? ` (${batal} pembayaran batal atau pada faktur batal tidak dihitung)` : ""}
            </th>
            <td className="right num w600" data-tagihan-total-bayar>{rp(totalPembayaranHidup(pembayaran))}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/**
 * Baris cocok-silang R20: sisa faktur + belum ditagihkan di samping saldo
 * piutang "Saldo pelanggan", dan selisihnya. Selisih DITAMPILKAN, tidak
 * dijelaskan (KTD8); tanpa snapshot terbit → "belum tersedia", bukan nol.
 */
export function TagihanCocokSaldo({ cocok }: { cocok: CocokSaldoPelanggan }) {
  const kelompok = cocok.kelompokSaldo === "online" ? "Piutang Online" : "Piutang Lokal";
  return (
    <dl className="tagihan-cocok">
      <div>
        <dt>Sisa faktur + belum ditagihkan</dt>
        <dd className="num">
          {rp(cocok.jumlah)}
          <span className="tagihan-sub">{rp(cocok.sisaFaktur)} + {rp(cocok.belumDitagihkan)}</span>
        </dd>
      </div>
      <div>
        <dt>
          Saldo piutang (Saldo pelanggan
          {cocok.saldoPerTanggal ? `, per ${tanggalTagihan(cocok.saldoPerTanggal)}` : ""})
        </dt>
        <dd className="num">
          {cocok.saldoPiutang === null ? "belum tersedia" : rp(cocok.saldoPiutang)}
          {cocok.saldoPiutang !== null && <span className="tagihan-sub">{kelompok}</span>}
        </dd>
      </div>
      <div>
        <dt>Selisih</dt>
        <dd className="num w600">{cocok.selisih === null ? "belum tersedia" : rp(cocok.selisih)}</dd>
      </div>
    </dl>
  );
}

/** KTD11: unit belum pernah menyelesaikan satu siklus tagihan — BUKAN nol faktur. */
export function TagihanBelumTersedia({ unit }: { unit: { code: string; name: string } }) {
  return (
    <section className="b6-piutang-not-ready na-panel" aria-labelledby="tagihan-belum-tersedia">
      <span className="b6-piutang-state-tag missing">Belum ada data</span>
      <h2 id="tagihan-belum-tersedia">{TAGIHAN_BELUM_TERSEDIA}</h2>
      <p>SPBU {unit.code} · {unit.name}</p>
      <p>
        Faktur dan pembayaran tampil setelah komputer SPBU ini menyelesaikan satu siklus sinkron tagihan yang lengkap dari EasyMax.
      </p>
      <p className="b6-piutang-not-zero">Belum tersedia bukan berarti tidak ada faktur atau tidak ada tunggakan.</p>
    </section>
  );
}
