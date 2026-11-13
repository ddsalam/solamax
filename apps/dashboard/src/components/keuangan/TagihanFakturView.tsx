import { rp } from "@/lib/format";
import {
  STATUS_EASYMAX_LUNAS,
  TAGIHAN_NILAI_KOSONG,
  tagihanStatusBayarLabel,
  tagihanSumberJatuhTempoLabel,
} from "@/lib/tagihan-model";
import { BATAS_BARIS_TAGIHAN, type TagihanFakturRinci } from "@/lib/tagihan-queries";
import { tagihanKesegaranLabel } from "@/lib/tagihan-route";
import {
  PENJELASAN_NILAI_KOSONG,
  TagihanPembayaranTabel,
  TagihanStatusPills,
  penjelasanJtTakWajar,
  tanggalTagihan,
  totalPembayaranHidup,
} from "./TagihanTabel";

/**
 * S2 Rincian faktur (rencana 2026-11-13 U8; R4, R17). Komponen server murni.
 *
 * Nilai EasyMax (flag status, kolom sisa, jatuh tempo mentah) HANYA tampil di
 * panel pembanding, dan panel itu hanya ada bila model memasang penandanya —
 * faktur yang cocok tidak dibebani angka kedua.
 */
export interface TagihanFakturViewProps {
  unit: { code: string; name: string };
  rinci: TagihanFakturRinci;
  /** Kembali ke S1. */
  daftarHref: string;
  /**
   * Halaman pelanggan (S6) pada tanggal Saldo pelanggan yang dipilih pemanggil.
   * `null` = halaman itu tidak ada (kode pelanggan kosong, atau pelanggannya tak
   * ada di snapshot terbit terakhir): nama & kode tampil sebagai teks biasa —
   * tautan yang berujung 404 tidak pernah dirender.
   */
  pelangganHref: string | null;
}

function Butir({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function PanelBeda({ rinci }: { rinci: TagihanFakturRinci }) {
  const { status, faktur } = rinci;
  if (!status || !(status.bedaStatus || status.bedaSisa || status.jtEasymaxTakWajar)) return null;
  return (
    <aside className="banner warning tagihan-beda" aria-labelledby="tagihan-beda-judul">
      <span className="dot warning" aria-hidden="true" />
      <div>
        <strong id="tagihan-beda-judul">Beda dengan EasyMax</strong>
        <p className="keu-p">
          SolaMax menghitung dari nilai faktur dan pembayaran yang tidak batal. Angka EasyMax di bawah hanya pembanding; minta SPBU memeriksa faktur ini di EasyMax.
        </p>
        <div className="tbl-scroll">
          <table className="tagihan-tbl" aria-label="Perbandingan hitungan SolaMax dan EasyMax">
            <thead>
              <tr>
                <th scope="col">Yang dibandingkan</th>
                <th scope="col">Hitungan SolaMax</th>
                <th scope="col">Tercatat di EasyMax</th>
              </tr>
            </thead>
            <tbody>
              {status.bedaStatus && (
                <tr>
                  <th scope="row">Status bayar</th>
                  <td>{tagihanStatusBayarLabel(status.statusBayar) ?? "Belum dibayar"}</td>
                  <td>{faktur.statusEasymax === STATUS_EASYMAX_LUNAS ? "Lunas" : "Belum lunas"}</td>
                </tr>
              )}
              {status.bedaSisa && (
                <tr>
                  <th scope="row">Sisa tagihan</th>
                  <td className="num">{rp(status.sisa)}</td>
                  <td className="num">{faktur.sisaEasymax === null ? "—" : rp(faktur.sisaEasymax)}</td>
                </tr>
              )}
              {status.jtEasymaxTakWajar && (
                <tr>
                  <th scope="row">Jatuh tempo</th>
                  <td className="num">{status.jatuhTempo ? tanggalTagihan(status.jatuhTempo) : "Termin belum diatur"}</td>
                  <td className="num">
                    {tanggalTagihan(faktur.jatuhTempoEasymax)}
                    <span className="tagihan-sub">tidak dipakai</span>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {status.jtEasymaxTakWajar && <p className="keu-p">{penjelasanJtTakWajar(faktur.jatuhTempoEasymax)}</p>}
      </div>
    </aside>
  );
}

export function TagihanFakturView({ unit, rinci, daftarHref, pelangganHref }: TagihanFakturViewProps) {
  const { faktur, status } = rinci;
  const sumber = status ? tagihanSumberJatuhTempoLabel(status) : null;
  const biayaAdmin = Math.round(rinci.biayaAdmin ?? 0);
  // Faktur batal tak punya status; nilainya dibaca langsung dari faktur.
  const nilaiKosong = status ? status.nilaiKosong : faktur.nilai === null;
  return (
    <div className="b6-piutang-page">
      <header className="b6-piutang-heading">
        <div>
          <div className="text-eyebrow t-tertiary">Keuangan · Tagihan pelanggan · Rincian faktur</div>
          <h1 className="text-h3 t-brand">Faktur {faktur.kode}</h1>
          <p>
            {rinci.namaPelanggan?.trim() || "Nama belum tersedia"} · {faktur.customerCode || "—"} · SPBU {unit.code} · {unit.name}
          </p>
          <p className="tagihan-kesegaran">{tagihanKesegaranLabel(rinci.kesiapan.selesaiAt)}</p>
        </div>
        <div className="b6-piutang-exports no-print" aria-label="Navigasi rincian faktur">
          <a className="btn-outline" href={daftarHref}>← Kembali ke daftar</a>
          {pelangganHref !== null && <a className="btn-outline" href={pelangganHref}>Halaman pelanggan</a>}
        </div>
      </header>

      {status === null && (
        <div className="banner danger" role="status">
          <span className="dot danger" aria-hidden="true" />
          <div>
            <strong>Faktur batal</strong>
            <p className="keu-p">
              {rinci.alasanBatal ? `Alasan: ${rinci.alasanBatal}.` : "Alasan pembatalan tidak dicatat di EasyMax."}{" "}
              Faktur batal tidak punya status dan tidak dihitung dalam total atau daftar mana pun.
            </p>
          </div>
        </div>
      )}

      <section className="card tagihan-rinci" aria-label="Ringkasan faktur">
        <dl>
          <Butir label="Pelanggan">
            {pelangganHref !== null
              ? <a href={pelangganHref}>{rinci.namaPelanggan?.trim() || "Nama belum tersedia"}</a>
              : <span>{rinci.namaPelanggan?.trim() || "Nama belum tersedia"}</span>}
            <span className="tagihan-sub mono">{faktur.customerCode || "—"}</span>
          </Butir>
          <Butir label="No. faktur"><span className="mono">{faktur.kode}</span></Butir>
          <Butir label="Tanggal faktur">
            <span className="num">{rinci.tanggalFakturKosong ? "—" : tanggalTagihan(faktur.tanggalFaktur)}</span>
            {rinci.tanggalFakturKosong && <span className="tagihan-sub">kosong di EasyMax</span>}
          </Butir>
          {status && (
            <Butir label="Jatuh tempo">
              <span className="num">{status.jatuhTempo ? tanggalTagihan(status.jatuhTempo) : "Termin belum diatur"}</span>
              {sumber && <span className="tagihan-sub">{sumber}</span>}
            </Butir>
          )}
          <Butir label="Nilai faktur">
            <span className="num">{nilaiKosong ? "—" : rp(status ? status.nilai : faktur.nilai ?? 0)}</span>
            {nilaiKosong && <span className="tagihan-sub tagihan-tanda">{TAGIHAN_NILAI_KOSONG}</span>}
            {biayaAdmin !== 0 && (
              <span className="tagihan-sub">termasuk biaya admin {rp(biayaAdmin)}</span>
            )}
          </Butir>
          {status && <Butir label="Dibayar"><span className="num">{rp(status.dibayar)}</span></Butir>}
          {status && <Butir label="Sisa"><span className="num w600">{nilaiKosong ? "—" : rp(status.sisa)}</span></Butir>}
          <Butir label="Status">
            {status ? <TagihanStatusPills status={status} /> : <span className="status-pill danger">Faktur batal</span>}
            {status?.statusBayar === "belum_dibayar" && <span className="tagihan-sub">belum ada pembayaran</span>}
          </Butir>
          {rinci.keterangan && <Butir label="Keterangan">{rinci.keterangan}</Butir>}
        </dl>
      </section>

      {status?.nilaiKosong && (
        <div className="banner warning" role="status" data-tagihan-nilai-kosong>
          <span className="dot warning" aria-hidden="true" />
          <div>
            <strong>Nilai faktur kosong</strong>
            <p className="keu-p">{PENJELASAN_NILAI_KOSONG}</p>
          </div>
        </div>
      )}

      <PanelBeda rinci={rinci} />

      <section className="card b6-piutang-list" aria-labelledby="tagihan-dokumen-judul">
        <div className="b6-piutang-list-meta">
          <div>
            <h2 id="tagihan-dokumen-judul">Dokumen penjualan dalam faktur ini</h2>
            <p>{rinci.dokumen.length.toLocaleString("id-ID")} dokumen · tanggal dan jumlah dari buku piutang</p>
          </div>
        </div>
        {rinci.dokumenTanpaBuku > 0 && (
          <p className="tagihan-catatan">
            {rinci.dokumenTanpaBuku.toLocaleString("id-ID")} dokumen tidak ditemukan di buku piutang; jumlahnya ditulis “—” dan tidak ikut total.
          </p>
        )}
        {rinci.dokumen.length === 0 ? (
          <div className="empty-inline b6-piutang-empty">Faktur ini tidak menautkan dokumen penjualan.</div>
        ) : (
          <div className="tbl-scroll">
            <table className="tagihan-tbl" aria-label="Dokumen penjualan dalam faktur ini">
              <thead>
                <tr>
                  <th scope="col">No. dokumen</th>
                  <th scope="col">Tanggal</th>
                  <th scope="col" className="right">Jumlah</th>
                </tr>
              </thead>
              <tbody>
                {rinci.dokumen.map((d) => (
                  <tr key={d.kodeDokumen}>
                    <td className="mono">{d.kodeDokumen}</td>
                    <td className="num">{tanggalTagihan(d.tanggal)}</td>
                    <td className="right num">{d.jumlah === null ? "—" : rp(d.jumlah)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" colSpan={2}>Total dokumen</th>
                  <td className="right num w600">{rp(rinci.totalDokumen)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      <section className="card b6-piutang-list" aria-labelledby="tagihan-bayar-judul">
        <div className="b6-piutang-list-meta">
          <div>
            <h2 id="tagihan-bayar-judul">Pembayaran</h2>
            <p>
              {rinci.pembayaran.length.toLocaleString("id-ID")} pembayaran tercatat · {rp(totalPembayaranHidup(rinci.pembayaran))} dihitung
            </p>
          </div>
        </div>
        {rinci.pembayaranTerpotong && (
          <p className="tagihan-catatan" data-tagihan-bayar-terpotong>
            Hanya {BATAS_BARIS_TAGIHAN.toLocaleString("id-ID")} pembayaran terbaru yang dibaca; daftar ini, juga dibayar, sisa, dan status di atas, tidak lengkap.
          </p>
        )}
        {rinci.pembayaran.length === 0 ? (
          <div className="empty-inline b6-piutang-empty">Belum ada pembayaran tercatat untuk faktur ini.</div>
        ) : (
          <TagihanPembayaranTabel pembayaran={rinci.pembayaran} label={`Pembayaran faktur ${faktur.kode}`} />
        )}
      </section>
    </div>
  );
}
