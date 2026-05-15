#!/usr/bin/env bash
# Stop hook: stage all changes, generate a real commit message via `claude -p`
# (요약 기반), then commit and push. Falls back to a file-list summary if claude
# is unavailable or fails.

set -u

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$PROJECT_DIR" || exit 0

git add -A 2>/dev/null

if git diff --cached --quiet; then
  exit 0
fi

names=$(git diff --cached --name-only)
count=$(printf '%s\n' "$names" | wc -l | tr -d ' ')

stat=$(git diff --cached --stat 2>/dev/null)
body=$(git diff --cached --no-color 2>/dev/null | head -c 60000)
payload=$(printf '## Changed files (%s)\n%s\n\n## Stat\n%s\n\n## Diff\n%s\n' \
  "$count" "$names" "$stat" "$body")

msg=""

CLAUDE_BIN="$(command -v claude 2>/dev/null || true)"
if [ -z "$CLAUDE_BIN" ]; then
  for cand in \
    "$HOME"/.nvm/versions/node/*/bin/claude \
    /usr/local/bin/claude \
    /opt/homebrew/bin/claude; do
    [ -x "$cand" ] && CLAUDE_BIN="$cand" && break
  done
fi

# Portable timeout: prefer GNU `timeout`, fall back to `gtimeout` (coreutils on
# macOS), otherwise run without a timeout limit.
TIMEOUT_BIN=""
for t in timeout gtimeout; do
  if command -v "$t" >/dev/null 2>&1; then
    TIMEOUT_BIN="$t"
    break
  fi
done

run_claude() {
  if [ -n "$TIMEOUT_BIN" ]; then
    "$TIMEOUT_BIN" 50 "$CLAUDE_BIN" -p --model haiku
  else
    "$CLAUDE_BIN" -p --model haiku
  fi
}

if [ -n "$CLAUDE_BIN" ]; then
  prompt='아래 git diff를 보고 커밋 메시지 한 줄을 작성해줘.
규칙:
- conventional commit 접두사 사용 (feat / fix / docs / style / refactor / perf / test / chore / build / ci 중 하나)
- 한국어, 72자 이내, 마침표 없음
- 가장 중요한 변경 한 가지만 요약
- 출력은 메시지 한 줄만, 다른 텍스트/따옴표/코드블록 금지'

  raw=$(printf '%s\n\n%s\n' "$prompt" "$payload" | run_claude 2>/dev/null)

  # Strip markdown code fences if claude wrapped its answer in ``` ... ```.
  cleaned=$(printf '%s' "$raw" \
    | tr -d '\r' \
    | sed -e '/^[[:space:]]*```/d' \
    | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' \
    | grep -v '^$' \
    | head -1)

  msg=$(printf '%s' "$cleaned" | sed -E 's/^["`'"'"']+//; s/["`'"'"']+$//')
fi

if [ -z "$msg" ]; then
  preview=$(printf '%s\n' "$names" | head -3 | tr '\n' ',' | sed 's/,$//' | sed 's/,/, /g')
  [ "$count" -gt 3 ] && preview="$preview, +$((count-3))"
  msg="chore: $preview"
fi

git commit -m "$msg" >/dev/null 2>&1 || exit 0
git push 2>/dev/null || true
