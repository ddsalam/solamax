-- Kosong berarti belum diisi, berbeda dari nol eksplisit. Tetap dalam liter,
-- dengan presisi DECIMAL(14,2) yang sama. Jangan menebak ulang nol historis:
-- migrasi ini hanya melonggarkan kolom dan menghapus default, tanpa backfill.
-- Deploy migrasi ini SEBELUM dashboard yang menyimpan kuantitas nullable.
ALTER TABLE "app"."usulan_so"
    ALTER COLUMN "penerimaan_hari" DROP NOT NULL,
    ALTER COLUMN "penerimaan_hari" DROP DEFAULT,
    ALTER COLUMN "permintaan_besok" DROP NOT NULL,
    ALTER COLUMN "permintaan_besok" DROP DEFAULT,
    ALTER COLUMN "usulan_penebusan" DROP NOT NULL,
    ALTER COLUMN "usulan_penebusan" DROP DEFAULT;
