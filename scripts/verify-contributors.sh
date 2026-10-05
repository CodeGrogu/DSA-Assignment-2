#!/usr/bin/env bash
# Verifies every team member has at least one non-merge commit.
# Exit 0 = all verified, 1 = verification failed, 2 = not inside a git repo.

set -euo pipefail

# ANSI Color Codes
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

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
    "May-Lee Mulundu|May-Lee Mulundu|Mayleendapewa|itsyagirlmay"
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
    count=$(git log --all --no-merges -i -E --author="$pattern" --format=%h 2>/dev/null | wc -l | tr -d ' ')

    if [[ "$count" -ge 1 ]]; then
        printf "%-28s %-10s [${GREEN}OK${NC}]\n" "$name" "$count"
    else
        printf "%-28s %-10s [${RED}MISSING${NC}]\n" "$name" "$count"
        fail=1
    fi
done

printf "%.s-" {1..48}
echo ""

if [[ "$fail" -eq 0 ]]; then
    echo -e "${GREEN}[SUCCESS] All 8 team members have verified non-merge commits!${NC}"
else
    echo -e "${RED}[FAIL] One or more team members have no verified non-merge commits.${NC}"
fi

exit "$fail"
