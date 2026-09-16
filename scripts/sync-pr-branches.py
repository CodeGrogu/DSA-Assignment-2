#!/usr/bin/env python3
"""
sync-pr-branches.py
Automates synchronization of all 40 implementation pull request branches
(PRs #121 to #160, corresponding to feature/parent-issue-1 to feature/parent-issue-40)
with latest main in CodeGrogu/DSA-Assignment-2.

Usage:
  python scripts/sync-pr-branches.py [--dry-run] [--pr <number>] [--delay <seconds>] [--start <p>] [--end <p>]
"""

import argparse
import json
import subprocess
import sys
import time

REPO = "CodeGrogu/DSA-Assignment-2"

def run_cmd(cmd_args, max_retries=3):
    for attempt in range(max_retries):
        proc = subprocess.run(cmd_args, capture_output=True, text=True)
        if proc.returncode == 0:
            return proc
        
        combined = (proc.stderr + " " + proc.stdout).lower()
        if "secondary rate limit" in combined or "rate limit exceeded" in combined or "403" in combined:
            backoff = 30 * (attempt + 1)
            print(f"  [RATE-LIMIT] Encountered rate limit/403. Backing off for {backoff}s...")
            time.sleep(backoff)
            continue
        return proc
    return proc

def check_behind_by(parent_num):
    branch = f"feature/parent-issue-{parent_num}"
    cmd = [
        "gh", "api",
        f"repos/{REPO}/compare/main...{branch}",
        "--jq", "{behind_by: .behind_by, status: .status, ahead_by: .ahead_by}"
    ]
    res = run_cmd(cmd)
    if res.returncode != 0:
        return None, res.stderr.strip()
    try:
        data = json.loads(res.stdout)
        return data.get("behind_by", 0), None
    except Exception as e:
        return None, str(e)

def update_pr_branch(pr_num, dry_run=False):
    if dry_run:
        print(f"  [DRY-RUN] Would update PR #{pr_num} branch with latest main")
        return True, "Dry-run simulated"

    cmd = ["gh", "pr", "update-branch", str(pr_num)]
    res = run_cmd(cmd)
    if res.returncode == 0:
        return True, res.stdout.strip()
    else:
        return False, res.stderr.strip()

def main():
    parser = argparse.ArgumentParser(description="Synchronize PR branches with latest main.")
    parser.add_argument("--dry-run", action="store_true", help="Preview updates without triggering mutations.")
    parser.add_argument("--pr", type=int, default=None, help="Target a specific PR number (121 to 160).")
    parser.add_argument("--delay", type=float, default=2.5, help="Delay in seconds between updates (default: 2.5s).")
    parser.add_argument("--start", type=int, default=1, help="Starting parent issue number (1-40, default: 1).")
    parser.add_argument("--end", type=int, default=40, help="Ending parent issue number (1-40, default: 40).")
    args = parser.parse_args()

    print("=================================================================")
    print("      Automated Pull Request Branch Synchronization Engine       ")
    print(f"  Mode: {'DRY RUN (Read Only)' if args.dry_run else 'LIVE MUTATION'}")
    print(f"  Pacing Delay: {args.delay}s")
    print("=================================================================\n")

    if args.pr is not None:
        if not (121 <= args.pr <= 160):
            print(f"Error: PR number {args.pr} out of range (must be between 121 and 160).")
            sys.exit(1)
        p = args.pr - 120
        parent_range = [p]
    else:
        parent_range = list(range(args.start, args.end + 1))

    total_targets = len(parent_range)
    updated_count = 0
    already_synced_count = 0
    errors_count = 0

    start_time = time.time()

    for idx, p in enumerate(parent_range, 1):
        pr_num = 120 + p
        branch = f"feature/parent-issue-{p}"

        print(f"[{idx}/{total_targets}] Inspecting PR #{pr_num} (branch: '{branch}')...")

        behind_by, err = check_behind_by(p)
        if err:
            print(f"  [ERROR] Could not compare branch '{branch}': {err}")
            errors_count += 1
            time.sleep(1.0)
            continue

        if behind_by == 0:
            print(f"  [UP-TO-DATE] PR #{pr_num} branch is already synchronized with main (behind_by = 0).")
            already_synced_count += 1
        else:
            print(f"  [BEHIND] PR #{pr_num} branch is {behind_by} commit(s) behind main. Updating...")
            success, msg = update_pr_branch(pr_num, dry_run=args.dry_run)
            if success:
                print(f"  [SUCCESS] PR #{pr_num} update-branch complete: {msg}")
                updated_count += 1
            else:
                print(f"  [FAILED] Failed to update PR #{pr_num}: {msg}")
                errors_count += 1

            time.sleep(args.delay)

    elapsed = time.time() - start_time
    print("\n=================================================================")
    print("                      SUMMARY REPORT                             ")
    print("=================================================================")
    print(f"Total PRs Inspected:        {total_targets}")
    print(f"Already Synchronized:       {already_synced_count}")
    print(f"Branches Updated:           {updated_count}")
    print(f"Errors Encountered:         {errors_count}")
    print(f"Total Execution Time:       {elapsed:.1f}s")
    print("=================================================================\n")

if __name__ == "__main__":
    main()
