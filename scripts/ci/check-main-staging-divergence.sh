#!/usr/bin/env bash
set -euo pipefail

# Proposal-only guard: detect non-merge patches that reached main but are absent
# from staging. This script is intentionally not registered in a workflow yet.

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

hotfix_allow_file="${HOTFIX_ALLOW_FILE:-}"
selftest_mode="${SOLAMAX_DIVERGENCE_GUARD_SELFTEST:-}"
if [[ -n "$selftest_mode" && "$selftest_mode" != "1" ]]; then
  fail "SOLAMAX_DIVERGENCE_GUARD_SELFTEST must be 1 when set"
fi

if [[ "$selftest_mode" == "1" ]]; then
  staging_ref="${SOLAMAX_GUARD_TEST_STAGING_REF:?self-test staging ref is required}"
  main_ref="${SOLAMAX_GUARD_TEST_MAIN_REF:?self-test main ref is required}"
  now_epoch="${SOLAMAX_GUARD_TEST_NOW_EPOCH:?self-test clock is required}"
  git_bin="${SOLAMAX_GUARD_TEST_GIT_BIN:-git}"
else
  staging_ref="origin/staging"
  main_ref="origin/main"
  git_bin="git"
  now_epoch="$(date +%s)" || fail "cannot read the current clock"
fi

[[ "$now_epoch" =~ ^[0-9]+$ ]] || fail "self-test clock must be a Unix timestamp"
"$git_bin" rev-parse --is-inside-work-tree >/dev/null 2>&1 || fail "run this check inside a Git worktree"
"$git_bin" rev-parse --verify "${staging_ref}^{commit}" >/dev/null 2>&1 || fail "cannot resolve staging ref: ${staging_ref}"
"$git_bin" rev-parse --verify "${main_ref}^{commit}" >/dev/null 2>&1 || fail "cannot resolve main ref: ${main_ref}"

allow_shas=()
allow_starts_at=()
allow_expires_at=()
allow_start_epochs=()
allow_expiry_epochs=()
allow_reasons=()

if [[ -n "$hotfix_allow_file" ]]; then
  normalized_allowances="$(node - "$hotfix_allow_file" <<'NODE'
const fs = require("node:fs");
const path = process.argv[2];
let source;
try {
  source = fs.readFileSync(path, "utf8");
} catch (error) {
  console.error(`ERROR: cannot read HOTFIX_ALLOW_FILE ${path}: ${error.message}`);
  process.exit(1);
}

const seen = new Set();
const records = [];
const parseUtc = (raw, lineNo, field) => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(raw)) {
    throw new Error(`${path}:${lineNo}: ${field} is not strict UTC RFC3339`);
  }
  const epoch = Date.parse(raw);
  if (!Number.isFinite(epoch) || new Date(epoch).toISOString() !== raw.replace(/Z$/, ".000Z")) {
    throw new Error(`${path}:${lineNo}: ${field} is not a real UTC timestamp`);
  }
  return Math.floor(epoch / 1000);
};

try {
  for (const [index, line] of source.split(/\r?\n/).entries()) {
    const lineNo = index + 1;
    if (line.trim() === "" || line.startsWith("#")) continue;
    const fields = line.split("\t");
    if (fields.length !== 4) throw new Error(`${path}:${lineNo}: expected exactly four tab-separated fields`);
    const [sha, startsAt, expiresAt, reason] = fields;
    if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`${path}:${lineNo}: SHA must be 40 lowercase hexadecimal characters`);
    if (!startsAt || !expiresAt || !reason) throw new Error(`${path}:${lineNo}: start, expiry, and rationale are required`);
    if (seen.has(sha)) throw new Error(`${path}:${lineNo}: duplicate SHA ${sha}`);
    seen.add(sha);
    const startsEpoch = parseUtc(startsAt, lineNo, "start");
    const expiryEpoch = parseUtc(expiresAt, lineNo, "expiry");
    if (expiryEpoch <= startsEpoch) throw new Error(`${path}:${lineNo}: expiry must be after start`);
    if (expiryEpoch - startsEpoch > 86400) throw new Error(`${path}:${lineNo}: hotfix window exceeds 24 hours`);
    records.push([sha, startsAt, expiresAt, startsEpoch, expiryEpoch, reason].join("\t"));
  }
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
}

process.stdout.write(records.join("\n"));
NODE
  )" || fail "invalid HOTFIX_ALLOW_FILE"

  while IFS=$'\t' read -r sha starts_at expires_at starts_epoch expiry_epoch reason; do
    [[ -n "$sha" ]] || continue
    allow_shas+=("$sha")
    allow_starts_at+=("$starts_at")
    allow_expires_at+=("$expires_at")
    allow_start_epochs+=("$starts_epoch")
    allow_expiry_epochs+=("$expiry_epoch")
    allow_reasons+=("$reason")
  done <<< "$normalized_allowances"
fi

main_only_output="$(
  "$git_bin" log --right-only --cherry-pick --no-merges --format='%H' \
    "${staging_ref}...${main_ref}"
)" || fail "cannot enumerate patches in ${main_ref} that are absent from ${staging_ref}"

main_only_commits=()
while IFS= read -r commit; do
  [[ -n "$commit" ]] && main_only_commits+=("$commit")
done <<< "$main_only_output"

if [[ "${#main_only_commits[@]}" -eq 0 ]]; then
  printf 'PASS: %s has no non-merge patch absent from %s.\n' "$main_ref" "$staging_ref"
  exit 0
fi

main_first_parent_output="$("$git_bin" rev-list --first-parent --reverse "$main_ref")" || \
  fail "cannot enumerate the first-parent history of ${main_ref}"
main_first_parent_commits=()
while IFS= read -r commit; do
  [[ -n "$commit" ]] && main_first_parent_commits+=("$commit")
done <<< "$main_first_parent_output"
[[ "${#main_first_parent_commits[@]}" -gt 0 ]] || fail "${main_ref} has no first-parent history"

uncovered_commits=()
uncovered_states=()
uncovered_starts=()
uncovered_expiries=()
uncovered_reasons=()
for commit in "${main_only_commits[@]}"; do
  landing_commit=""
  for first_parent_commit in "${main_first_parent_commits[@]}"; do
    if "$git_bin" merge-base --is-ancestor "$commit" "$first_parent_commit"; then
      landing_commit="$first_parent_commit"
      break
    else
      ancestor_status=$?
      if [[ "$ancestor_status" -ne 1 ]]; then
        fail "cannot locate the audited main landing for ${commit}"
      fi
    fi
  done
  [[ -n "$landing_commit" ]] || fail "cannot locate the audited main landing for ${commit}"
  landing_epoch="$("$git_bin" show -s --format='%ct' "$landing_commit")" || \
    fail "cannot read the audited main landing timestamp for ${commit}"
  [[ "$landing_epoch" =~ ^[0-9]+$ ]] || \
    fail "invalid audited main landing timestamp for ${commit}: ${landing_epoch}"
  landing_deadline_epoch=$((landing_epoch + 86400))

  allow_index=-1
  for index in "${!allow_shas[@]}"; do
    if [[ "${allow_shas[$index]}" == "$commit" ]]; then
      allow_index="$index"
      break
    fi
  done

  if [[ "$allow_index" -lt 0 ]]; then
    uncovered_commits+=("$commit")
    uncovered_states+=("not-allowlisted")
    uncovered_starts+=("")
    uncovered_expiries+=("")
    uncovered_reasons+=("")
    continue
  fi

  starts_at="${allow_starts_at[$allow_index]}"
  expires_at="${allow_expires_at[$allow_index]}"
  starts_epoch="${allow_start_epochs[$allow_index]}"
  expiry_epoch="${allow_expiry_epochs[$allow_index]}"
  reason="${allow_reasons[$allow_index]}"
  if [[ "$expiry_epoch" -gt "$landing_deadline_epoch" ]]; then
    fail "hotfix allowance for ${commit} expires after audited main landing + 24 hours (landing ${landing_commit}, epoch ${landing_epoch})"
  fi
  if [[ "$now_epoch" -lt "$starts_epoch" ]]; then
    uncovered_commits+=("$commit")
    uncovered_states+=("not-started")
    uncovered_starts+=("$starts_at")
    uncovered_expiries+=("$expires_at")
    uncovered_reasons+=("$reason")
    continue
  fi
  if [[ "$now_epoch" -ge "$expiry_epoch" ]]; then
    uncovered_commits+=("$commit")
    uncovered_states+=("expired")
    uncovered_starts+=("$starts_at")
    uncovered_expiries+=("$expires_at")
    uncovered_reasons+=("$reason")
    continue
  fi

  printf 'NOTICE: temporary hotfix window active for %.12s from %s until %s — %s\n' \
    "$commit" "$starts_at" "$expires_at" "$reason"
done

if [[ "${#uncovered_commits[@]}" -eq 0 ]]; then
  printf 'PASS: every main-only patch is inside an explicit, unexpired hotfix window.\n'
  exit 0
fi

printf 'FAIL: %s contains patch(es) absent from %s:\n' "$main_ref" "$staging_ref" >&2
for index in "${!uncovered_commits[@]}"; do
  commit="${uncovered_commits[$index]}"
  state="${uncovered_states[$index]}"
  starts_at="${uncovered_starts[$index]}"
  expires_at="${uncovered_expiries[$index]}"
  reason="${uncovered_reasons[$index]}"
  subject="$("$git_bin" show -s --format='%s' "$commit")" || \
    fail "cannot read commit subject for ${commit}"
  if [[ "$state" == "expired" ]]; then
    printf '  - %.12s %s [allowance expired %s: %s]\n' \
      "$commit" "$subject" "$expires_at" "$reason" >&2
  elif [[ "$state" == "not-started" ]]; then
    printf '  - %.12s %s [allowance starts %s: %s]\n' \
      "$commit" "$subject" "$starts_at" "$reason" >&2
  else
    printf '  - %.12s %s [no hotfix allowance]\n' "$commit" "$subject" >&2
  fi
done
printf '%s\n' \
  'Recovery: back-merge main into staging (preferred), or land the exact patch in staging.' \
  'Do not resolve this by deleting evidence or extending an allowance without owner review.' >&2
exit 1
