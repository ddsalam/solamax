-- =====================================================================
-- FASE 0.5g — PROBE READ-ONLY: diagnosa LOCK go-live (MyISAM concurrent-insert)
-- =====================================================================
-- 🔒 SELECT/SHOW only. Jalankan: `pnpm --filter @solamax/agent probe8`
-- Pertanyaan: apakah SELECT pelanggan (~12s, view vw_jualplg) BENAR memblok
-- INSERT pompa di `tr_djualplg`? Di MyISAM, concurrent_insert mengizinkan
-- INSERT di AKHIR tabel bersamaan dgn SELECT ASAL tak ada "lubang" (Data_free=0).
-- EasyMax flag-cancel (bukan hard-delete) → mungkin tanpa lubang → lock MOOT.
-- =====================================================================

SHOW VARIABLES LIKE 'concurrent_insert';
SHOW TABLE STATUS LIKE 'tr_djualplg';
SHOW TABLE STATUS LIKE 'tr_hjualplg';

-- INTERPRETASI (dicetak otomatis oleh harness, per tabel):
--  Engine ≠ MyISAM (mis. InnoDB)            → SELECT tak table-lock → LOCK-GATE MOOT (CLOSED).
--  MyISAM + concurrent_insert=ALWAYS(2)     → append jalan walau ada lubang → CLOSED.
--  MyISAM + concurrent_insert≥1 + Data_free=0 → SELECT TAK blok append → CLOSED (window+interval cukup).
--  MyISAM + concurrent_insert≥1 + Data_free>0 → ada lubang → concurrent insert MATI → BLOCKING NYATA
--                                               → pertahankan window 3-hari + interval 15–30 mnt / off-peak.
--  MyISAM + concurrent_insert=NEVER(0)      → tak ada concurrent append → BLOCKING NYATA → interval lebar/off-peak.
-- Keputusan dicatat di FASE1-PLAN (go-live lock gate).
