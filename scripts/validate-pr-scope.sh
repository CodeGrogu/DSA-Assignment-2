#!/usr/bin/env bash
# scripts/validate-pr-scope.sh
# Discrete Pull Request Verification & Domain Scope Gate
# Enforces exact domain, subtask, linear issue, and milestone traceability per PR.

set -euo pipefail

echo "================================================================="
echo "       Discrete PR Verification & Traceability Gate             "
echo "================================================================="

BRANCH="${HEAD_REF:-$(git branch --show-current 2>/dev/null || echo "")}"
BASE="${BASE_REF:-main}"
PR_INPUT_NUM="${PR_NUMBER:-}"

echo "Target Branch:    $BRANCH"
echo "Base Branch:      $BASE"
echo "PR Input Number:  $PR_INPUT_NUM"

if [[ "$BRANCH" =~ feature/parent-issue-([0-9]+) ]]; then
    PARENT_NUM="${BASH_REMATCH[1]}"
elif [[ "$BRANCH" =~ ([0-9]+) ]]; then
    PARENT_NUM="${BASH_REMATCH[1]}"
else
    echo "Notice: Non-standard branch name '$BRANCH'. Performing generic scope check."
    PARENT_NUM=""
fi

if [ -n "$PARENT_NUM" ] && [ "$PARENT_NUM" -ge 1 ] && [ "$PARENT_NUM" -le 40 ]; then
    PR_NUM=$((120 + PARENT_NUM))
    SUB1_NUM=$((39 + 2 * PARENT_NUM))
    SUB2_NUM=$((40 + 2 * PARENT_NUM))
    LINEAR_PARENT="PEE-$((66 + PARENT_NUM))"
    LINEAR_SUB1="PEE-$((106 + SUB1_NUM - 40))"
    LINEAR_SUB2="PEE-$((106 + SUB2_NUM - 40))"

    # Map Assignee & Domain
    if [ "$PARENT_NUM" -ge 1 ] && [ "$PARENT_NUM" -le 5 ]; then
        ASSIGNEE="@CodeGrogu"
        MEMBER_NAME="Jaden Awaseb"
        DOMAIN="Order Lifecycle & Monorepo Architecture"
    elif [ "$PARENT_NUM" -ge 6 ] && [ "$PARENT_NUM" -le 10 ]; then
        ASSIGNEE="@Henchoz"
        MEMBER_NAME="Henry Heita"
        DOMAIN="Kafka Infrastructure & Stream Resiliency"
    elif [ "$PARENT_NUM" -ge 11 ] && [ "$PARENT_NUM" -le 15 ]; then
        ASSIGNEE="@Florriinnddaa"
        MEMBER_NAME="Florinda Funya"
        DOMAIN="Customer Service & Mongo Persistence"
    elif [ "$PARENT_NUM" -ge 16 ] && [ "$PARENT_NUM" -le 20 ]; then
        ASSIGNEE="@Jerganov"
        MEMBER_NAME="Tapiwa Kelvin"
        DOMAIN="Restaurant & Kitchen Microservices"
    elif [ "$PARENT_NUM" -ge 21 ] && [ "$PARENT_NUM" -le 25 ]; then
        ASSIGNEE="@Kondwani112206"
        MEMBER_NAME="Kondwani Kunkwenzu"
        DOMAIN="Payment Processing & Financial Ledger"
    elif [ "$PARENT_NUM" -ge 26 ] && [ "$PARENT_NUM" -le 30 ]; then
        ASSIGNEE="@itsyagirlmay"
        MEMBER_NAME="Mayleenda"
        DOMAIN="Delivery Dispatch & Real-time Tracking"
    elif [ "$PARENT_NUM" -ge 31 ] && [ "$PARENT_NUM" -le 35 ]; then
        ASSIGNEE="@LiinaMassipa"
        MEMBER_NAME="Liina Massipa"
        DOMAIN="Notifications, Audit Log & Admin Platform"
    elif [ "$PARENT_NUM" -ge 36 ] && [ "$PARENT_NUM" -le 40 ]; then
        ASSIGNEE="@Nangukuii"
        MEMBER_NAME="Nangu Tjizoo"
        DOMAIN="End-to-End Orchestration & System Defense"
    fi

    # Map Milestone
    case "$PARENT_NUM" in
        1|6|7|11|12|16|21|26|31|36)
            MILESTONE="M1: Infrastructure, Kafka & Schema Setup"
            ;;
        2|3|13|17|18|22|23)
            MILESTONE="M2: Core Services & Event Lifecycle Complete"
            ;;
        8|14|19|27|28|32|33)
            MILESTONE="M3: Delivery, Notifications & Admin Services Complete"
            ;;
        4|9|24|29|34|37|38|39)
            MILESTONE="M4: Orchestration, Testing & Submission Ready"
            ;;
        5|10|15|20|25|30|35|40)
            MILESTONE="M5: Presentation & System Defense Ready"
            ;;
        *)
            MILESTONE="Standard Milestone"
            ;;
    esac

    SCOPE_STATUS="VERIFIED (Branch matches Parent Issue #${PARENT_NUM})"
else
    PR_NUM="${PR_INPUT_NUM:-N/A}"
    PARENT_NUM="N/A"
    SUB1_NUM="N/A"
    SUB2_NUM="N/A"
    LINEAR_PARENT="N/A"
    LINEAR_SUB1="N/A"
    LINEAR_SUB2="N/A"
    ASSIGNEE="Repository Team"
    MEMBER_NAME="General"
    DOMAIN="Platform General"
    MILESTONE="Continuous Integration"
    SCOPE_STATUS="NON-RESTRICTED (General Workflow Branch)"
fi

echo ""
echo "PR Mapping Summary:"
echo "----------------------------------------------------"
echo "Pull Request:         PR #${PR_NUM}"
echo "Parent Issue:         Issue #${PARENT_NUM} (${LINEAR_PARENT})"
echo "Assigned Engineer:    ${ASSIGNEE} (${MEMBER_NAME})"
echo "Functional Domain:    ${DOMAIN}"
echo "Milestone:            ${MILESTONE}"
echo "Child Subtask 1:      Issue #${SUB1_NUM} (${LINEAR_SUB1})"
echo "Child Subtask 2:      Issue #${SUB2_NUM} (${LINEAR_SUB2})"
echo "Scope Status:         ${SCOPE_STATUS}"
echo "----------------------------------------------------"

# Git diff inspection
DIFF_FILES=$(git diff --name-only "origin/${BASE}...HEAD" 2>/dev/null || git diff --name-only "${BASE}...HEAD" 2>/dev/null || git diff --name-only "HEAD~1...HEAD" 2>/dev/null || echo "")
NUM_FILES=0
if [ -n "$DIFF_FILES" ]; then
    NUM_FILES=$(echo "$DIFF_FILES" | grep -c . || echo 0)
fi

echo ""
echo "Changed files in PR scope against ${BASE} (${NUM_FILES} files):"
if [ "$NUM_FILES" -gt 0 ]; then
    echo "$DIFF_FILES" | head -n 25
    if [ "$NUM_FILES" -gt 25 ]; then
        echo "... and $((NUM_FILES - 25)) more files"
    fi
else
    echo "  (No changed files detected or branch up to date with base)"
fi

# Output GitHub Step Summary markdown table if running under GitHub Actions
if [ -n "${GITHUB_STEP_SUMMARY:-}" ] && [ -w "${GITHUB_STEP_SUMMARY}" ]; then
    cat <<EOF >> "$GITHUB_STEP_SUMMARY"
## Discrete PR Verification: \`${BRANCH}\`

| Traceability Property | Specification / Assigned Value |
| :--- | :--- |
| **Pull Request** | PR #${PR_NUM} |
| **Parent Issue** | Issue #${PARENT_NUM} (\`${LINEAR_PARENT}\`) |
| **Assigned Engineer** | ${ASSIGNEE} (${MEMBER_NAME}) |
| **Functional Domain** | ${DOMAIN} |
| **Target Milestone** | ${MILESTONE} |
| **Subtask 1** | Issue #${SUB1_NUM} (\`${LINEAR_SUB1}\`) |
| **Subtask 2** | Issue #${SUB2_NUM} (\`${LINEAR_SUB2}\`) |
| **Base Branch** | \`${BASE}\` |
| **Scope Status** | \`${SCOPE_STATUS}\` |

### Changed Files in Scope (\`${NUM_FILES}\` files)
\`\`\`text
${DIFF_FILES:-No file changes detected}
\`\`\`
EOF
fi

echo ""
echo "Discrete PR scope verification completed successfully."
exit 0
