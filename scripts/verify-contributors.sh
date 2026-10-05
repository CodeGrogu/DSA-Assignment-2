#!/usr/bin/env bash
# Verifies every team member has at least one non-merge commit.
# Exit 0 = all verified, 1 = verification failed, 2 = not inside a git repo.

set -euo pipefail

# ANSI Color Codes
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Ensure script is executed inside a Git repository root
repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || {
    echo -e "${RED}[ERROR] Not inside a Git repository.${NC}" >&2
    exit 2
}
cd "$repo_root"

# Format: "Display Name|author regex pattern"
MEMBERS=(
    "Jaden Awaseb|Jaden|acehood3556|73761054"
    "Florinda|Florriinnddaa|florinda.funya"
    "Nangu Tjizoo|Nangu.Tjizoo|knangukuii"
    "Jerganov|Jerganov|klvntapiwa3"
    "Kataliina|Kataliina|kataliinamassipa"
    "Henchoz|Henchoz|henryheita0"
    "Kondwani|kondwani11220|kondwanikunkwenzu"
    "MEMBER 8|REPLACE_WITH_AUTHOR_NAME_OR_EMAIL"
)

fail=0

echo -e "\n${CYAN}--- CONTRIBUTOR AUDIT REPORT ---${NC}"
printf "%-28s %-10s %s\n" "Member" "Commits" "Status"
printf "%.s-" {1..48}
echo ""

for entry in "${MEMBERS[@]}"; do
    name="${entry%%|*}"
    pattern="${entry#*|}"

    # Count matching non-merge commits across all branches
    count=$(git log --all --no-merges -i -E --author="$pattern" --format=%h 2>/dev/null | grep -c . || true)

    if [[ "$count"Here is the cleaned-up and formatted version of your script. Non-breaking space artifacts (hidden `\xA0` characters that often break Bash execution) have been removed, and the code structure has been standard-formatted for compatibility:

```bash
#!/usr/bin/env bash
# Verifies every team member has at least one non-merge commit. Exit 0 = all verified, 1 = someone missing.
set -uo pipefail
cd "$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "Not inside a git repo"; exit 2; }

# name|author regex (matches git author name or email, case-insensitive)
MEMBERS=(
  "Jaden Awaseb|Jaden|acehood3556|73761054"
  "Florinda|Florriinnddaa|florinda.funya"
  "Nangu Tjizoo|Nangu.Tjizoo|knangukuii"
  "Jerganov|Jerganov|klvntapiwa3"
  "Kataliina|Kataliina|kataliinamassipa"
  "Henchoz|Henchoz|henryheita0"
  "Kondwani|kondwani11220|kondwanikunkwenzu"
  "MEMBER 8 (replace name)|REPLACE_WITH_AUTHOR_NAME_OR_EMAIL"
)

fail=0
printf "%-28s %s\n" "Member" "Commits (non-merge, all branches)"
for entry in "${MEMBERS[@]}"; do
  name="${entry%%|*}"
  pattern="${entry#*|}"
  count=$(git log --all --no-merges -i -E --author="$pattern" --format=%h | wc -l | tr -d ' ')
  status="OK"
  [[ "$count" -ge 1 ]] || { status="MISSING"; fail=1; }
  printf "%-28s %s  [%s]\n" "$name" "$count" "$status"
done

if [[ $fail -eq 0 ]]; then
  echo "ALL 8 MEMBERS HAVE VERIFIED COMMITS"
else
  echo "CONTRIBUTOR AUDIT FAILED"
fi

exit $fail