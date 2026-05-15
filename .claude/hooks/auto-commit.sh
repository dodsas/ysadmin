#!/usr/bin/env bash
# Stop hook:
#   1) stage all changes, generate a commit message via `claude -p` (요약 기반),
#      commit, then push. Falls back to a file-list summary if claude is
#      unavailable.
#   2) if running inside a worktree under .claude/worktrees/, try to merge the
#      worktree branch into main (in the main checkout), push main, and remove
#      the worktree directory + branch. Aborts and keeps the worktree if
#      anything looks off (merge conflict, dirty main checkout, etc).

set -u

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$PROJECT_DIR" || exit 0

# Worktrees use a .git *file* pointing at the main repo's .git/worktrees/<name>.
# The main checkout has a .git *directory*.
is_worktree=0
[ -f "$PROJECT_DIR/.git" ] && is_worktree=1

# ----- Auto-commit any pending changes -----
git add -A 2>/dev/null

if ! git diff --cached --quiet; then
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

  git commit -m "$msg" >/dev/null 2>&1 || true

  if ! git push 2>/dev/null; then
    cur_branch=$(git symbolic-ref --short HEAD 2>/dev/null || true)
    [ -n "$cur_branch" ] && git push -u origin "$cur_branch" 2>/dev/null || true
  fi
fi

# ----- Worktree auto-cleanup -----
# Runs only when this hook fires inside a worktree. The semantics are:
# "the session inside the worktree has stopped → consider the work done →
#  fold it into main and tear the worktree down."
# Safety: skip cleanup if main has uncommitted changes, the worktree is
# still dirty, the merge conflicts, or `git worktree remove` refuses.
if [ "$is_worktree" -eq 1 ]; then
  worktree_path=$(git rev-parse --show-toplevel 2>/dev/null || true)
  worktree_branch=$(git symbolic-ref --short HEAD 2>/dev/null || true)
  main_path=$(git worktree list --porcelain 2>/dev/null \
    | awk '/^worktree /{print substr($0,10); exit}')

  if [ -n "$worktree_path" ] && [ -n "$worktree_branch" ] \
     && [ -n "$main_path" ] && [ "$worktree_path" != "$main_path" ] \
     && [ -z "$(git status --porcelain 2>/dev/null)" ]; then
    (
      cd "$main_path" || exit 1
      main_branch=$(git symbolic-ref --short HEAD 2>/dev/null || true)
      [ "$main_branch" = "main" ] || exit 1
      [ -z "$(git status --porcelain)" ] || exit 1
      if git merge --no-edit "$worktree_branch" >/dev/null 2>&1; then
        git push >/dev/null 2>&1 || true
        if git worktree remove "$worktree_path" >/dev/null 2>&1; then
          git branch -d "$worktree_branch" >/dev/null 2>&1 || true
        fi
      else
        git merge --abort >/dev/null 2>&1 || true
      fi
    )
  fi
fi
