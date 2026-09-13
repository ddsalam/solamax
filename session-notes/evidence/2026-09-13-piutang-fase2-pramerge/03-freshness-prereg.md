# Preregistrasi diagnosis kesegaran F1

Hipotesis berikut dikunci sebelum kueri produksi read-only dijalankan:

1. **F1-H1:** 41 cycle `failed` didominasi kegagalan berulang karena cycle lama telah dilewati cycle yang lebih baru, bukan kegagalan formula snapshot.
2. **F1-H2:** tabel source cycle tidak mempunyai lease/heartbeat. Cycle `staging` dengan sequence di bawah sequence terbaru sudah kalah menurut kontrak collector dan merupakan yatim yang menunggu retirement; hanya cycle terbaru yang mungkin masih aktif, dan umur serta kelengkapan bukti domain menjadi indikator terbatasnya.
3. **F1-H3:** karena sesudah koreksi mundur belum ada source cycle baru yang mencapai `complete`, `source_change` dan watermark `dirty` tidak membawa invalidasi baru; pointer 13-09 tetap `pending_replacement=false`.
4. **F1-H4:** semua baris aktif bertanggal 13-09 milik tujuh pelanggan pembeda yang tidak ada di cut masuk ke mirror sesudah laporan dicetak pukul 12:45 WIB. Jika benar, laporan 13-09 konsisten dengan semantik `dtgl <= D` untuk himpunan pembeda ini.
5. **F1-H5:** skema pointer hanya menyimpan keadaan kini. Tanpa tabel riwayat perubahan pointer, nilai `pending_replacement=false` sekarang tidak dapat membuktikan secara historis bahwa flag itu “tidak pernah” menyala; kesimpulan harus dibatasi pada keadaan dan jejak yang benar-benar tersimpan.

Seluruh kueri memakai unit 1, transaksi `REPEATABLE READ READ ONLY`, `SET LOCAL app.unit_ids='1'`, dan `ROLLBACK`. Tidak ada row yang diubah atau dihapus.
