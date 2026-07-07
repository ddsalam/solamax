#!/usr/bin/env bash
# preflight-rls-cutover.sh — HARD GATE before applying migration 0016 on a live env. (F1)
#
# Exits NONZERO unless BOTH the backend (ingest) and dashboard Cloud Run services are
# serving the RLS-aware image at 100% traffic. Prevents the outage window:
#   - 0016 enforced while an OLD dashboard revision still serves -> current_setting NULL
#     -> 0 rows -> IB dashboard blank.
#   - 0016 enforced before the backend image ships -> ingest WITH CHECK violated
#     -> 500 -> IB agent pipeline stalls.
#
# "RLS-aware" is identified by a Cloud Run REVISION LABEL `rls-aware=1` that the deploy sets
# on the new revision (gcloud run deploy ... --labels rls-aware=1). The gate requires the
# serving revision to carry that label AND take 100% of traffic (a single active revision).
#
# Usage (live):     REGION=asia-southeast2 bash preflight-rls-cutover.sh
#                   -> exit 0 = safe to apply 0016; nonzero = DO NOT MIGRATE.
# Usage (selftest): bash preflight-rls-cutover.sh --selftest   (no gcloud; proves gate logic)
set -euo pipefail
REGION="${REGION:-asia-southeast2}"
BACKEND_SVC="${BACKEND_SVC:-solamax-ingest}"
DASHBOARD_SVC="${DASHBOARD_SVC:-solamax-dashboard}"

# Pure gate logic (TESTABLE): stdin = {"traffic":[{revisionName,percent}...],"label":"..."}.
# Prints "OK <rev>" and exits 0 iff exactly one active revision at 100% AND label=="1".
# Script via -c (NOT a heredoc) so stdin stays free for the piped JSON. Plain string
# concatenation (no f-strings) → no quote/backslash issues inside the -c single-quoted arg.
_check() {
python3 -c '
import sys, json
name = sys.argv[1]
d = json.load(sys.stdin)
active = [t for t in d.get("traffic", []) if t.get("percent", 0) > 0]
if len(active) != 1:
    print("FAIL " + name + ": " + str(len(active)) + " active revisions (need exactly one at 100%)"); sys.exit(1)
pct = active[0].get("percent")
if pct != 100:
    print("FAIL " + name + ": serving revision at " + str(pct) + "% (need 100%)"); sys.exit(1)
rev = str(active[0].get("revisionName"))
if str(d.get("label")) != "1":
    print("FAIL " + name + ": serving revision " + rev + " not RLS-aware (label rls-aware!=1)"); sys.exit(1)
print("OK " + name + ": " + rev + " @100% rls-aware=1"); sys.exit(0)
' "$1"
}

# Live gathering: traffic from `services describe`, label from `revisions describe`.
gate_service() {
  local svc="$1"
  local traffic rev label
  traffic=$(gcloud run services describe "$svc" --region "$REGION" --format=json \
            | python3 -c 'import sys,json;print(json.dumps(json.load(sys.stdin).get("status",{}).get("traffic",[])))')
  rev=$(echo "$traffic" | python3 -c 'import sys,json;a=[t for t in json.load(sys.stdin) if t.get("percent",0)>0];print(a[0]["revisionName"] if len(a)==1 else "")')
  if [ -z "$rev" ]; then echo "{\"traffic\":$traffic,\"label\":\"\"}" | _check "$svc"; return; fi
  label=$(gcloud run revisions describe "$rev" --region "$REGION" \
            --format='value(metadata.labels.rls-aware)' 2>/dev/null || echo "")
  echo "{\"traffic\":$traffic,\"label\":\"${label:-}\"}" | _check "$svc"
}

if [ "${1:-}" = "--selftest" ]; then
  echo "== preflight gate self-test (fixtures; no gcloud) =="
  fail=0
  t(){ printf "%-42s -> " "$1"; if echo "$2" | _check "svc" >/tmp/pf.out 2>&1; then got=PASS; else got=FAIL; fi
       if [ "$got" = "$3" ]; then echo "✅ $got (expected $3): $(cat /tmp/pf.out)"; else echo "❌ $got (expected $3): $(cat /tmp/pf.out)"; fail=1; fi; }
  t "100% + rls-aware=1"        '{"traffic":[{"revisionName":"r-new","percent":100}],"label":"1"}'                 PASS
  t "split 60/40 (rollout mid)" '{"traffic":[{"revisionName":"r-new","percent":60},{"revisionName":"r-old","percent":40}],"label":"1"}' FAIL
  t "100% but label missing"    '{"traffic":[{"revisionName":"r-old","percent":100}],"label":""}'                 FAIL
  t "100% but rls-aware=0"      '{"traffic":[{"revisionName":"r-old","percent":100}],"label":"0"}'                FAIL
  t "no active revision"        '{"traffic":[],"label":"1"}'                                                       FAIL
  echo "selftest result: $([ $fail = 0 ] && echo ALL-PASS || echo SOME-FAILED)"; exit $fail
fi

echo "== RLS cutover preflight (region=$REGION) =="
ok=0
gate_service "$BACKEND_SVC"   || ok=1
gate_service "$DASHBOARD_SVC" || ok=1
if [ $ok -ne 0 ]; then
  echo "GATE FAILED — DO NOT apply migration 0016. Deploy the RLS-aware images to 100% first."
  exit 1
fi
echo "GATE PASSED — both services RLS-aware @100%. Safe to apply 0016 (out-of-band)."
