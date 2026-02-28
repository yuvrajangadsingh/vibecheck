#!/bin/bash
set -euo pipefail

# --- Validate inputs ---
case "${INPUT_SEVERITY:-warn}" in
  error|warn|info) ;;
  *) echo "::error::Invalid severity '${INPUT_SEVERITY}'. Must be: error, warn, info"; exit 2 ;;
esac

case "${INPUT_FAIL_ON:-error}" in
  error|warn|info|none) ;;
  *) echo "::error::Invalid fail-on '${INPUT_FAIL_ON}'. Must be: error, warn, info, none"; exit 2 ;;
esac

# --- Helpers: escape GitHub workflow command values ---
escape_property() {
  local v="$1"
  v="${v//\%/%25}"
  v="${v//$'\r'/%0D}"
  v="${v//$'\n'/%0A}"
  v="${v//:/%3A}"
  v="${v//,/%2C}"
  printf '%s' "$v"
}

escape_data() {
  local v="$1"
  v="${v//\%/%25}"
  v="${v//$'\r'/%0D}"
  v="${v//$'\n'/%0A}"
  printf '%s' "$v"
}

# --- Install vibecheck ---
echo "::group::Installing vibecheck"
npm install -g "@yuvrajangadsingh/vibecheck@${INPUT_VERSION:-latest}" 2>&1
echo "::endgroup::"

# --- Build args ---
VIBECHECK_ARGS=(. --json --severity "${INPUT_SEVERITY:-warn}")

if [ -n "${INPUT_IGNORE:-}" ]; then
  IFS=',' read -ra PATTERNS <<< "$INPUT_IGNORE"
  for p in "${PATTERNS[@]}"; do
    trimmed="${p#"${p%%[![:space:]]*}"}"
    trimmed="${trimmed%"${trimmed##*[![:space:]]}"}"
    [ -n "$trimmed" ] && VIBECHECK_ARGS+=(--ignore "$trimmed")
  done
fi

# --- Scan ---
echo "::group::Scanning"
SCAN_STDERR=$(mktemp)
SCAN_EXIT=0
SCAN_OUTPUT=$(vibecheck "${VIBECHECK_ARGS[@]}" 2>"$SCAN_STDERR") || SCAN_EXIT=$?
echo "::endgroup::"

# Exit code 2 = config/runtime error
if [ "$SCAN_EXIT" -eq 2 ]; then
  echo "::error::vibecheck failed with a runtime error"
  cat "$SCAN_STDERR" >&2
  rm -f "$SCAN_STDERR"
  exit 1
fi
rm -f "$SCAN_STDERR"

# Validate JSON structure
if [ -z "$SCAN_OUTPUT" ] || ! echo "$SCAN_OUTPUT" | jq -e 'has("findings") and (.findings | type == "array")' >/dev/null 2>&1; then
  echo "::error::vibecheck produced invalid output (missing findings array)"
  exit 1
fi

# --- Parse results ---
FILES_SCANNED=$(echo "$SCAN_OUTPUT" | jq '.filesScanned // 0')
DURATION=$(echo "$SCAN_OUTPUT" | jq '.duration // 0 | floor')

# --- Filter to changed files if in PR context ---
CHANGED_FILES=""
PR_NUMBER=""
CHANGED_FETCH_OK="false"

if [ "${INPUT_CHANGED_ONLY:-true}" = "true" ] && [ -f "${GITHUB_EVENT_PATH:-/dev/null}" ]; then
  PR_NUMBER=$(jq -r '.pull_request.number // empty' "$GITHUB_EVENT_PATH" 2>/dev/null || true)
  if [ -n "$PR_NUMBER" ]; then
    echo "::group::Fetching changed files for PR #$PR_NUMBER"
    FETCH_ERR=$(mktemp)
    if CHANGED_FILES=$(GITHUB_TOKEN="${INPUT_GITHUB_TOKEN}" gh pr diff "$PR_NUMBER" --name-only 2>"$FETCH_ERR"); then
      CHANGED_FETCH_OK="true"
    else
      echo "::warning::Failed to fetch PR changed files. Reporting all findings."
      cat "$FETCH_ERR" >&2
    fi
    rm -f "$FETCH_ERR"
    echo "::endgroup::"
  fi
fi

if [ "$CHANGED_FETCH_OK" = "true" ]; then
  FINDINGS=$(echo "$SCAN_OUTPUT" | jq --arg files "$CHANGED_FILES" '
    ($files | split("\n") | map(select(length > 0))) as $cf |
    .findings | map(select(.file as $f | $cf | any(. == $f)))
  ')
else
  FINDINGS=$(echo "$SCAN_OUTPUT" | jq '.findings')
fi

FILTERED_COUNT=$(echo "$FINDINGS" | jq 'length')

# --- No issues ---
if [ "$FILTERED_COUNT" -eq 0 ]; then
  echo "::notice::vibecheck: no issues found"
  {
    echo "## vibecheck passed"
    echo ""
    echo "No AI code smells detected. Scanned $FILES_SCANNED files in ${DURATION}ms."
  } >> "$GITHUB_STEP_SUMMARY"
  exit 0
fi

# --- Emit annotations (single jq pass, escaped for workflow commands) ---
echo "$FINDINGS" | jq -r '.[] | [.file, (.line | tostring), .rule, .severity, .message] | @tsv' | while IFS=$'\t' read -r file line rule severity message; do
  case "$severity" in
    error)  cmd="error" ;;
    warn)   cmd="warning" ;;
    *)      cmd="notice" ;;
  esac

  esc_file=$(escape_property "$file")
  esc_rule=$(escape_property "$rule")
  esc_msg=$(escape_data "$message")

  echo "::${cmd} file=${esc_file},line=${line},title=vibecheck: ${esc_rule}::${esc_msg}"
done

# --- Step summary ---
ERRORS_F=$(echo "$FINDINGS" | jq '[.[] | select(.severity == "error")] | length')
WARNINGS_F=$(echo "$FINDINGS" | jq '[.[] | select(.severity == "warn")] | length')
INFOS_F=$(echo "$FINDINGS" | jq '[.[] | select(.severity == "info")] | length')

{
  echo "## vibecheck results"
  echo ""
  if [ -n "$PR_NUMBER" ]; then
    echo "Found **$FILTERED_COUNT** issue(s) in PR #${PR_NUMBER} changed files."
  else
    echo "Found **$FILTERED_COUNT** issue(s) across $FILES_SCANNED files."
  fi
  echo ""
  echo "| Severity | Count |"
  echo "|----------|-------|"
  [ "$ERRORS_F" -gt 0 ] && echo "| Error | $ERRORS_F |"
  [ "$WARNINGS_F" -gt 0 ] && echo "| Warning | $WARNINGS_F |"
  [ "$INFOS_F" -gt 0 ] && echo "| Info | $INFOS_F |"
  echo ""
  echo "<details>"
  echo "<summary>All findings ($FILTERED_COUNT)</summary>"
  echo ""
  echo "| File | Line | Rule | Severity | Message |"
  echo "|------|------|------|----------|---------|"
  echo "$FINDINGS" | jq -r '.[] | [.file, (.line | tostring), .rule, .severity, (.message | gsub("\n"; " "))] | @tsv' | while IFS=$'\t' read -r f l r s m; do
    f="${f//|/\\|}"; r="${r//|/\\|}"; m="${m//|/\\|}"
    echo "| \`$f\` | $l | \`$r\` | $s | $m |"
  done
  echo ""
  echo "</details>"
  echo ""
  echo "*Scanned in ${DURATION}ms with [vibecheck](https://github.com/yuvrajangadsingh/vibecheck)*"
} >> "$GITHUB_STEP_SUMMARY"

# --- Exit code ---
FAIL_ON="${INPUT_FAIL_ON:-error}"

case "$FAIL_ON" in
  error)
    if [ "$ERRORS_F" -gt 0 ]; then
      echo "::error::vibecheck found $ERRORS_F error(s)"
      exit 1
    fi
    ;;
  warn)
    if [ "$ERRORS_F" -gt 0 ] || [ "$WARNINGS_F" -gt 0 ]; then
      echo "::error::vibecheck found errors/warnings"
      exit 1
    fi
    ;;
  info)
    if [ "$FILTERED_COUNT" -gt 0 ]; then
      echo "::error::vibecheck found $FILTERED_COUNT issue(s)"
      exit 1
    fi
    ;;
  none) ;;
esac

exit 0
