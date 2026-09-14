import csv
from pathlib import Path
here=Path(__file__).resolve().parent
easymax=here.parent / "2026-09-13-piutang-fase2-gerbang-a/easymax-ib-2026-09-13.csv"
orphan={r["customer_code"].strip() for r in csv.DictReader((here / "orphan-codes.csv").open())}
reference={r["customer_code"].strip() for r in csv.DictReader(easymax.open())}
print(f"orphan_unique_codes={len(orphan)}")
print(f"easymax_unique_codes={len(reference)}")
print(f"intersection_count={len(orphan & reference)}")
print(f"intersection={sorted(orphan & reference)}")
raise SystemExit(1 if orphan & reference else 0)
