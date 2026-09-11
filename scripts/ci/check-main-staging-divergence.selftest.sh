#!/usr/bin/env bash
set -euo pipefail

check_script="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/check-main-staging-divergence.sh"
test_root="$(mktemp -d "${TMPDIR:-/tmp}/solamax-main-staging-guard.XXXXXX")"
trap 'rm -rf "$test_root"' EXIT

fail() {
  printf 'SELFTEST FAIL: %s\n' "$*" >&2
  exit 1
}

run_check() {
  local now_epoch="$1" git_bin="${2:-git}"
  (
    cd "$test_root"
    SOLAMAX_DIVERGENCE_GUARD_SELFTEST=1 \
      SOLAMAX_GUARD_TEST_STAGING_REF=staging \
      SOLAMAX_GUARD_TEST_MAIN_REF=main \
      SOLAMAX_GUARD_TEST_NOW_EPOCH="$now_epoch" \
      SOLAMAX_GUARD_TEST_GIT_BIN="$git_bin" \
      HOTFIX_ALLOW_FILE="$test_root/hotfix.allow" \
      "$check_script" 2>&1
  )
}

expect_green() {
  local name="$1" now="$2" output
  output="$(run_check "$now")" || fail "$name should be green; output: $output"
  grep -q 'PASS:' <<< "$output" || fail "$name did not report PASS"
  printf 'ok - %s\n' "$name"
}

expect_red() {
  local name="$1" now="$2" expected="$3" git_bin="${4:-git}" output
  if output="$(run_check "$now" "$git_bin")"; then
    fail "$name should be red; output: $output"
  fi
  grep -q "$expected" <<< "$output" || fail "$name did not report $expected; output: $output"
  printf 'ok - %s\n' "$name"
}

git_at() {
  local timestamp="$1"
  shift
  GIT_AUTHOR_DATE="$timestamp" GIT_COMMITTER_DATE="$timestamp" git -C "$test_root" "$@"
}

git -C "$test_root" init -q --initial-branch=staging
git -C "$test_root" config user.name 'SolaMax guard self-test'
git -C "$test_root" config user.email 'guard-selftest@invalid.local'
printf 'root\n' > "$test_root/state.txt"
git -C "$test_root" add state.txt
git_at '2029-12-29T00:00:00Z' commit -qm 'initial state'
git -C "$test_root" branch main
: > "$test_root/hotfix.allow"

# State 1: a normal staging -> main promotion adds only a merge commit to main.
printf 'promoted from staging\n' >> "$test_root/state.txt"
git_at '2029-12-30T00:00:00Z' commit -qam 'feature through staging'
git -C "$test_root" switch -q main
git_at '2029-12-30T01:00:00Z' merge -q --no-ff staging -m 'promote staging to main'
expect_green 'normal promotion is quiet' 1800000000

# State 2: different commits with the same patch exercise --cherry-pick.
git -C "$test_root" switch -q staging
printf 'patch-equivalent content\n' > "$test_root/equivalent.txt"
git -C "$test_root" add equivalent.txt
git_at '2029-12-30T02:00:00Z' commit -qm 'patch as committed on staging'
staging_equivalent_sha="$(git -C "$test_root" rev-parse HEAD)"
git -C "$test_root" switch -q main
printf 'patch-equivalent content\n' > "$test_root/equivalent.txt"
git -C "$test_root" add equivalent.txt
git_at '2029-12-30T03:00:00Z' commit -qm 'same patch committed separately on main'
main_equivalent_sha="$(git -C "$test_root" rev-parse HEAD)"
[[ "$staging_equivalent_sha" != "$main_equivalent_sha" ]] || fail 'patch-equivalent commits must have different SHAs'
git -C "$test_root" log --right-only --no-merges --format='%H' staging...main | \
  grep -qx "$main_equivalent_sha" || fail 'main-side commit should be visible without --cherry-pick'
expect_green 'same patch with a different SHA is quiet' 1800000000

# State 3: an undeclared hotfix PR patch exists only on main. Its inner commit
# deliberately predates the merge so landing time must come from first-parent main.
git -C "$test_root" switch -q -c emergency-hotfix
printf 'direct main hotfix\n' >> "$test_root/state.txt"
git_at '2029-12-01T00:00:00Z' commit -qam 'hotfix destined directly for main'
hotfix_sha="$(git -C "$test_root" rev-parse HEAD)"
git -C "$test_root" switch -q main
git_at '2030-01-01T00:00:00Z' merge -q --no-ff emergency-hotfix -m 'merge emergency hotfix into main'
hotfix_landing_sha="$(git -C "$test_root" rev-parse HEAD)"
expect_red 'undeclared main-only patch is red' 1800000000 'no hotfix allowance'

# A failed git log must fail closed instead of being mistaken for an empty diff.
real_git_bin="$(command -v git)"
fake_git_bin="$test_root/git-with-log-failure"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'if [[ "${1:-}" == "log" ]]; then' \
  '  printf "injected git log failure\\n" >&2' \
  '  exit 73' \
  'fi' \
  'exec "${REAL_GIT_BIN:?}" "$@"' > "$fake_git_bin"
chmod +x "$fake_git_bin"
export REAL_GIT_BIN="$real_git_bin"
expect_red 'git log failure fails closed' 1800000000 \
  'cannot enumerate patches in main that are absent from staging' "$fake_git_bin"

# State 4: the exact SHA has an explicit exception whose end is exactly
# landing + 24 hours. The old inner-commit timestamp must not shorten it.
printf '%s\t2030-01-01T00:00:00Z\t2030-01-02T00:00:00Z\towner-reviewed emergency hotfix\n' \
  "$hotfix_sha" > "$test_root/hotfix.allow"
expect_green 'exact 24-hour landing window is quiet' 1893499200

# One second beyond a 24-hour record is invalid.
printf '%s\t2030-01-01T00:00:00Z\t2030-01-02T00:00:01Z\ttoo-long emergency window\n' \
  "$hotfix_sha" > "$test_root/hotfix.allow"
expect_red 'window longer than 24 hours is rejected' 1893499200 'hotfix window exceeds 24 hours'

# Moving both ends later cannot launder or renew the audited landing deadline.
printf '%s\t2030-01-01T23:59:59Z\t2030-01-02T23:59:59Z\trenewed emergency window\n' \
  "$hotfix_sha" > "$test_root/hotfix.allow"
expect_red 'renewed window past landing deadline is rejected' 1893542400 \
  'expires after audited main landing + 24 hours'

# State 5: expiry makes the valid exception red; back-merge proves recovery.
printf '%s\t2030-01-01T00:00:00Z\t2030-01-02T00:00:00Z\towner-reviewed emergency hotfix\n' \
  "$hotfix_sha" > "$test_root/hotfix.allow"
expect_red 'expired hotfix window is red' 1893542400 'allowance expired'
git -C "$test_root" switch -q staging
git_at '2030-01-02T01:00:00Z' merge -q --no-ff main -m 'back-merge main into staging'
expect_green 'back-merge restores green' 1893542400

[[ "$hotfix_landing_sha" != "$hotfix_sha" ]] || fail 'merged hotfix landing must differ from its inner commit'
printf 'SELFTEST PASS: core states, adversarial boundaries, fail-closed behavior, and recovery passed.\n'
