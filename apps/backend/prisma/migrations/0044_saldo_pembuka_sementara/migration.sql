-- 0044_saldo_pembuka_sementara — saldo pembuka boleh Rp 0 bila DITANDAI SEMENTARA.
--
-- ⛔ KEPUTUSAN OWNER 26 Sep 2026 (KEUANGAN-HARIAN §10.26). §10.24 menolak saldo
-- pembuka nol supaya "saldo pembuka lengkap" tak pernah palsu. Owner memutuskan
-- pembukuan MULAI 1 Oktober 2026 walau angka rekening koran belum di tangan: saldo
-- pembuka diisi Rp 0 untuk sementara. Agar nol itu tidak menyamar sebagai angka
-- sungguhan, ia wajib membawa penanda — dan penanda itu terlihat di layar Kelola
-- akun kas dan Pemantauan sampai diganti angka rekening koran.
--
-- Aturannya: nol HANYA sah untuk baris saldo pembuka yang ditandai sementara.
-- Semua baris lain tetap tunduk pada `cash_ledger_tanda` apa adanya.

ALTER TABLE "app"."cash_ledger"
    ADD COLUMN IF NOT EXISTS "saldo_awal_sementara" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "app"."cash_ledger"
    DROP CONSTRAINT IF EXISTS "cash_ledger_sementara_hanya_saldo_awal";
ALTER TABLE "app"."cash_ledger"
    ADD CONSTRAINT "cash_ledger_sementara_hanya_saldo_awal" CHECK (
        NOT "saldo_awal_sementara" OR "saldo_awal"
    );

-- `cash_ledger_tanda` (0029) didefinisikan ulang dengan SATU jalan tambahan:
-- adjustment bernominal nol yang adalah saldo pembuka sementara.
ALTER TABLE "app"."cash_ledger" DROP CONSTRAINT IF EXISTS "cash_ledger_tanda";
ALTER TABLE "app"."cash_ledger"
    ADD CONSTRAINT "cash_ledger_tanda" CHECK (
        ("jenis" = 'debet'  AND "amount" > 0)
        OR ("jenis" = 'kredit' AND "amount" < 0)
        OR ("jenis" = 'adjustment' AND "amount" <> 0)
        OR ("jenis" = 'adjustment' AND "saldo_awal" AND "saldo_awal_sementara" AND "amount" = 0)
    );
