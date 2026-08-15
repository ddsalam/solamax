"use client";

import { useState, useTransition } from "react";
import { simpanHargaBeli } from "@/lib/harga-beli-actions";
import type { BarisHargaBeli, RingkasPenjaga } from "@/lib/keuangan-harga-model";

/**
 * Blok 1 Layar 3 — Harga beli per produk (mockup layar 3).
 *
 * ⛔ Harga jual hanya DITAMPILKAN. Tak ada satu pun input untuknya di sini, dan
 * server pun membaca ulang harga jual sendiri saat menyimpan — jadi tak ada
 * jalan bagi browser menentukan nilai yang dipakai penjaga P1.
 *
 * NADA PERINGATAN — ini pertama kalinya P1/P2 punya wajah. Keduanya ditulis
 * sebagai PERMINTAAN PERHATIAN, bukan penghalang:
 *   · P1 memakai kata "boleh disimpan" lebih dulu, baru syaratnya. Ia terpicu
 *     pada 16,4% hari di sejarah Bakau — pola yang secara operasional SAH pada
 *     masa transisi harga. Peringatan yang berbunyi seperti tuduhan, pada pola
 *     yang sah, akan mengubah centang jadi refleks dalam sebulan.
 *   · P2 menyebut BERAPA HARI dan APA yang harus dilakukan, bukan sekadar
 *     "harga beli usang".
 *
 * Aksesibilitas (DS SolaGroup, pembacanya direksi berumur): body ≥17px, caption
 * ≥16px, target ≥44px, fokus selalu terlihat. Peringatan memakai `role="status"`
 * supaya pembaca layar mengumumkannya tanpa merebut fokus.
 */

const rp = (n: number | null, desimal = 2): string =>
  n === null
    ? "—"
    : n.toLocaleString("id-ID", { minimumFractionDigits: desimal, maximumFractionDigits: desimal });

const tanggalPanjang = (iso: string | null): string => {
  if (iso === null) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  const bulan = [
    "Jan", "Feb", "Mar", "Apr", "Mei", "Jun",
    "Jul", "Agu", "Sep", "Okt", "Nov", "Des",
  ];
  return `${d} ${bulan[(m ?? 1) - 1]} ${y}`;
};

export function HargaBeliPanel({
  code,
  date,
  baris,
  penjaga,
  bolehTulis,
}: {
  code: string;
  date: string;
  baris: BarisHargaBeli[];
  penjaga: RingkasPenjaga;
  /** Gerbang §2.6. Form disembunyikan bila false — server tetap yang menegakkan. */
  bolehTulis: boolean;
}) {
  const [buka, setBuka] = useState<string | null>(null);
  const [harga, setHarga] = useState("");
  const [sejak, setSejak] = useState(date);
  const [catatan, setCatatan] = useState("");
  const [akui, setAkui] = useState(false);
  const [alasan, setAlasan] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [kurang, setKurang] = useState<ReadonlyArray<"acknowledgement" | "reason">>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const aktif = baris.find((b) => b.productKey === buka) ?? null;
  const hargaNum = Number(harga.replace(/[^\d.,]/g, "").replace(/\./g, "").replace(",", "."));
  // Pratinjau P1 di layar. Ini KENYAMANAN, bukan penjaga — yang menegakkan ada
  // di server, yang membaca harga jualnya sendiri.
  const p1Pratinjau =
    aktif !== null &&
    aktif.hargaJual !== null &&
    Number.isFinite(hargaNum) &&
    hargaNum > aktif.hargaJual;

  const tutup = (): void => {
    setBuka(null);
    setHarga("");
    setCatatan("");
    setAkui(false);
    setAlasan("");
    setErr(null);
    setKurang([]);
  };

  const simpan = (): void => {
    if (aktif === null) return;
    setErr(null);
    setKurang([]);
    setMsg(null);
    start(async () => {
      const res = await simpanHargaBeli({
        code,
        date,
        productKey: aktif.productKey,
        effectiveFrom: sejak,
        price: hargaNum,
        sourceNote: catatan,
        acknowledged: akui,
        reason: alasan,
      });
      if (!res.ok) {
        setErr(res.error);
        setKurang(res.missing ?? []);
        return;
      }
      setMsg(
        res.p1
          ? `Harga beli ${aktif.nama} tersimpan — pengakuan harga di atas jual ikut tercatat.`
          : `Harga beli ${aktif.nama} tersimpan, berlaku sejak ${tanggalPanjang(sejak)}.`,
      );
      tutup();
    });
  };

  return (
    <section aria-labelledby="blok-harga-beli">
      <div className="section-h">
        <h3 id="blok-harga-beli" className="text-h3">
          1 · Harga beli per produk
        </h3>
        <span className="fs16 t-tertiary">Berlaku sampai diganti · dari faktur Pertamina</span>
      </div>

      {penjaga.kosong.length > 0 && (
        <div className="banner danger keu-banner" role="status">
          <b>
            {penjaga.kosong.length} produk belum punya harga beli pada tanggal ini
          </b>
          <p className="keu-p">
            {penjaga.kosong.map((b) => b.nama).join(", ")} — selama kosong, harga pokok dan
            nilai persediaan produk itu <strong>dihitung sebagai tidak ada</strong>, bukan nol.
            Laba akan terlihat lebih besar dari yang sebenarnya.
          </p>
        </div>
      )}

      {penjaga.p2.length > 0 && (
        <div className="banner warning keu-banner" role="status">
          <b>Harga jual sudah berubah, harga beli belum menyusul</b>
          <ul className="keu-list">
            {penjaga.p2.map((b) => (
              <li key={b.productKey}>
                <strong>{b.nama}</strong> — harga jual terakhir berubah{" "}
                {b.p2StaleDays} hari lalu (ambang {penjaga.graceDays} hari). Perbarui harga
                belinya, atau biarkan bila memang belum ada faktur baru.
              </li>
            ))}
          </ul>
        </div>
      )}

      {penjaga.p1.length > 0 && (
        <div className="banner warning keu-banner" role="status">
          <b>Harga beli di atas harga jual pada {penjaga.p1.length} produk</b>
          <p className="keu-p">
            {penjaga.p1.map((b) => b.nama).join(", ")} — ini <strong>boleh</strong> terjadi
            pada masa transisi harga, dan angkanya tersimpan apa adanya. Yang dicatat
            SolaMax adalah pengakuannya, supaya persediaan yang dinilai di atas harga
            jualnya tidak lewat tanpa ada yang tahu.
          </p>
        </div>
      )}

      {msg !== null && (
        <div className="banner info keu-banner" role="status">
          {msg}
        </div>
      )}

      <div className="card tbl-card tbl-scroll">
        <div className={`grid-head cols-hargabeli${bolehTulis ? "" : " ro"}`}>
          <span>Produk</span>
          <span className="right">Harga beli</span>
          <span className="right">Harga jual</span>
          <span className="right">Margin / liter</span>
          <span>Berlaku sejak</span>
          {bolehTulis && <span className="right">Tindakan</span>}
        </div>
        {baris.map((b) => (
          <div className={`grid-row cols-hargabeli${bolehTulis ? "" : " ro"}`} key={b.productKey}>
            <span className="w600">
              {b.nama}
              {b.p1Aktif && (
                <span className="keu-pill" title="Harga beli di atas harga jual">
                  di atas jual
                </span>
              )}
            </span>
            <span className="right num">
              {b.hargaBeli === null ? (
                <span className="t-danger w600">belum diisi</span>
              ) : (
                rp(b.hargaBeli)
              )}
            </span>
            {/* Harga jual: dari EasyMax, tidak pernah diketik. */}
            <span className="right num t-secondary">{rp(b.hargaJual)}</span>
            <span className={`right num ${b.margin !== null && b.margin < 0 ? "t-danger" : ""}`}>
              {rp(b.margin)}
            </span>
            <span className="fs16 t-secondary">
              {tanggalPanjang(b.berlakuSejak)}
              {b.p2Due && (
                <span className="keu-pill" title={`Harga jual berubah ${b.p2StaleDays} hari lalu`}>
                  perlu diperbarui
                </span>
              )}
            </span>
            {bolehTulis && (
              <span className="right">
                <button
                  type="button"
                  className="btn-outline sm"
                  onClick={() => {
                    tutup();
                    setBuka(b.productKey);
                    setSejak(date);
                  }}
                >
                  Perbarui
                </button>
              </span>
            )}
          </div>
        ))}
      </div>

      {bolehTulis && aktif !== null && (
        <div className="card card-pad-lg keu-form">
          <h4 className="text-h3">Perbarui harga beli — {aktif.nama}</h4>
          <p className="fs16 t-tertiary mt2">
            Harga jual {rp(aktif.hargaJual)} diambil dari EasyMax dan tidak bisa diketik di sini.
          </p>

          <div className="keu-2col">
            <label className="keu-fld">
              <span className="keu-label">Harga beli per liter</span>
              <input
                className="manual-input num"
                inputMode="decimal"
                value={harga}
                onChange={(e) => setHarga(e.target.value)}
                placeholder="0,00"
                aria-describedby="hb-hint"
              />
              <span className="fs16 t-tertiary" id="hb-hint">
                Dari faktur Pertamina. Berlaku sampai ada harga berikutnya.
              </span>
            </label>
            <label className="keu-fld">
              <span className="keu-label">Berlaku sejak</span>
              <input
                className="manual-input num"
                type="date"
                value={sejak}
                onChange={(e) => setSejak(e.target.value)}
              />
              <span className="fs16 t-tertiary">
                Tanggal faktur, bukan tanggal pengisian — harga lama tetap berlaku untuk
                hari-hari sebelumnya.
              </span>
            </label>
          </div>

          <label className="keu-fld">
            <span className="keu-label">Catatan sumber (opsional)</span>
            <input
              className="manual-input"
              value={catatan}
              onChange={(e) => setCatatan(e.target.value)}
              placeholder="mis. Faktur PT Pertamina Patra Niaga 1234/2026"
            />
          </label>

          {p1Pratinjau && (
            <div className="banner warning keu-banner" role="status">
              <b>Harga ini di atas harga jual — boleh disimpan, tetapi harus diakui</b>
              <p className="keu-p">
                Selisihnya {rp(hargaNum - (aktif.hargaJual ?? 0))} per liter. Pola ini sah pada
                masa transisi harga; yang SolaMax minta hanyalah jejak bahwa Anda menyadarinya.
              </p>
              <label className="keu-attest">
                <input
                  type="checkbox"
                  checked={akui}
                  onChange={(e) => setAkui(e.target.checked)}
                  aria-invalid={kurang.includes("acknowledgement")}
                />
                <span>
                  Saya sadar harga beli ini di atas harga jual, dan angkanya memang demikian.
                </span>
              </label>
              <label className="keu-fld">
                <span className="keu-label">Alasan (wajib)</span>
                <textarea
                  className="manual-input"
                  rows={2}
                  value={alasan}
                  onChange={(e) => setAlasan(e.target.value)}
                  aria-invalid={kurang.includes("reason")}
                  placeholder="mis. harga jual belum naik menyusul faktur 12 Jan"
                />
              </label>
            </div>
          )}

          {err !== null && (
            <div className="banner danger keu-banner" role="alert">
              {err}
            </div>
          )}

          <div className="manual-form-actions">
            <button type="button" className="btn-navy" onClick={simpan} disabled={pending}>
              {pending ? "Menyimpan…" : "Simpan harga beli"}
            </button>
            <button type="button" className="btn-outline" onClick={tutup} disabled={pending}>
              Batal
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
