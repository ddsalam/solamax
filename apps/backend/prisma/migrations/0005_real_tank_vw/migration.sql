-- real_tank kini di-sync dari view EasyMax `vw_realtm` (bukan tb_realtank mentah):
-- kunci natural CKDTANGKI + kapasitas otoritatif NKAPASITAS yang ditampilkan
-- layar ATG EasyMax (mis. DEX 9.000 L) — menggantikan kapasitas kalibrasi yang
-- salah. Tabel ini snapshot keadaan-kini (ditimpa tiap siklus), jadi aman
-- di-DROP & buat ulang; tak ada histori yang hilang.
DROP TABLE IF EXISTS "public"."real_tank";

CREATE TABLE "public"."real_tank" (
    "unit_id"     SMALLINT NOT NULL,
    "ckdtangki"   CHAR(5)  NOT NULL,
    "nkapasitas"  DECIMAL,
    "ntinggi"     DECIMAL,
    "nvolume"     DECIMAL,
    "nsuhu"       DECIMAL,
    "ntinggiair"  DECIMAL,
    "nvolumeair"  DECIMAL,
    "nstatus"     SMALLINT,
    "dtanggaljam" TIMESTAMPTZ NOT NULL,
    "ingested_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "real_tank_pkey" PRIMARY KEY ("unit_id","ckdtangki")
);

-- Grant SELECT ke role app dashboard (lihat 0004 — public tak tertutup default privileges).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_app') THEN
    GRANT SELECT ON "public"."real_tank" TO dashboard_app;
  END IF;
END
$$;
