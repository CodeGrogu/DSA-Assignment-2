#!/usr/bin/env python3
"""
sync-native-assignees.py
Synchronizes native GitHub assignees for active collaborators across all 160 items
(40 parents #1-#40, 80 subtasks #41-#120, 40 PRs #121-#160) in CodeGrogu/DSA-Assignment-2.

Usage:
  python scripts/sync-native-assignees.py [--dry-run] [--user <username>] [--delay <seconds>]
"""

import argparse
import json
import subprocess
import sys
import time

REPO = "CodeGrogu/DSA-Assignment-2"

MEMBERS = [
    {
        "username": "CodeGrogu",
        "full_name": "Jaden Awaseb (Team Leader)",
        "parents": range(1, 6),
        "subtasks": range(41, 51),
        "prs": range(121, 126),
    },
    {
        "username": "Henchoz",
        "full_name": "Henry Heita",
        "parents": range(6, 11),
        "subtasks": range(51, 61),
        "prs": range(126, 131),
    },
    {
        "username": "Florriinnddaa",
        "full_name": "Florinda Immanuel",
        "parents": range(11, 16),
        "subtasks": range(61, 71),
        "prs": range(131, 136),
    },
    {
        "username": "Jerganov",
        "full_name": "Tapiwa Machekera",
        "parents": range(16, 21),
        "subtasks": range(71, 81),
        "prs": range(136, 141),
    },
    {
        "username": "Kondwani112206",
        "full_name": "Kondwani Kunkwenzu",
        "parents": range(21, 26),
        "subtasks": range(81, 91),
        "prs": range(141, 146),
    },
    {
        "username": "itsyagirlmay",
        "full_name": "May-Lee Mulundu",
        "parents": range(26, 31),
        "subtasks": range(91, 101),
        "prs": range(146, 151),
    },
    {
        "username": "LiinaMassipa",
        "full_name": "Liina Massipa",
        "parents": range(31, 36),
        "subtasks": range(101, 111),
        "prs": range(151, 156),
    },
    {
        "username": "Nangukuii",
        "full_name": "Nangukuii Kangootui",
        "parents": range(36, 41),
        "subtasks": range(111, 121),
        "prs": range(156, 161),
    },
]

def run_cmd(cmd_args, max_retries=3):
    """Run subprocess command with retry on rate limit."""
    for attempt in range(max_retries):
        proc = subprocess.run(cmd_args, capture_output=True, text=True)
        if proc.returncode == 0:
            return proc
        combined = (proc.stderr + " " + proc.stdout).lower()
        if "secondary rate limit" in combined or "rate limit exceeded" in combined or "403" in combined:
            backoff = 30 * (attempt + 1)
            print(f"  [RATE-LIMIT] Backing off for {backoff}s...")
            time.sleep(backoff)
            continue
        return proc
    return proc

def get_items_for_member(member):
    """Return list of (num, type) tuples assigned to member."""
    items = []
    for p in member["parents"]:
        items.append((p, "issue"))
    for s in member["subtasks"]:
        items.append((s, "issue"))
    for pr in member["prs"]:
        items.append((pr, "pr"))
    return items

def main():
    parser = argparse.ArgumentParser(description="Synchronize native GitHub assignees for active collaborators.")
    parser.add_argument("--dry-run", action="store_true", help="Preview assignments without modifying GitHub.")
    parser.add_argument("--user", type=str, default=None, help="Target a specific GitHub username.")
    parser.add_argument("--delay", type=float, default=0.75, help="Delay in seconds between API calls (default: 0.75).")
    args = parser.parse_args()

    print("=================================================================")
    print("      Native GitHub Assignee Synchronization Utility            ")
    print(f"  Mode: {'DRY RUN (Read Only)' if args.dry_run else 'LIVE MUTATION'}")
    print("=================================================================\n")

    # Fetch collaborators
    print(">>> Fetching active repository collaborators...")
    cmd_collab = ["gh", "api", f"repos/{REPO}/collaborators", "--jq", ".[].login"]
    res_collab = run_cmd(cmd_collab)
    if res_collab.returncode != 0:
        print(f"Error fetching collaborators: {res_collab.stderr.strip()}")
        sys.exit(1)

    active_collaborators = set(line.strip() for line in res_collab.stdout.splitlines() if line.strip())
    print(f"Active collaborators ({len(active_collaborators)}): {sorted(list(active_collaborators))}\n")

    members_to_check = MEMBERS
    if args.user:
        members_to_check = [m for m in MEMBERS if m["username"].lower() == args.user.lower()]
        if not members_to_check:
            print(f"Error: User '{args.user}' not found in team registry.")
            sys.exit(1)

    total_checked = 0
    already_assigned = 0
    newly_assigned = 0
    pending_skipped = 0
    errors = 0

    for m in members_to_check:
        username = m["username"]
        full_name = m["full_name"]
        items = get_items_for_member(m)

        if username not in active_collaborators:
            print(f">>> Member @{username} ({full_name}) is a PENDING INVITEE. Skipping native assignment for {len(items)} items.")
            pending_skipped += len(items)
            continue

        print(f">>> Checking {len(items)} items for active collaborator @{username} ({full_name})...")

        for num, itype in items:
            total_checked += 1
            # Check current assignees
            view_cmd = ["gh", itype, "view", str(num), "--json", "assignees"]
            view_res = run_cmd(view_cmd)
            if view_res.returncode != 0:
                print(f"  [FAIL] Could not inspect {itype.upper()} #{num}: {view_res.stderr.strip()}")
                errors += 1
                time.sleep(args.delay)
                continue

            try:
                data = json.loads(view_res.stdout)
                curr_assignees = [a["login"].lower() for a in data.get("assignees", [])]
            except Exception as e:
                print(f"  [FAIL] JSON parsing error on {itype.upper()} #{num}: {e}")
                errors += 1
                time.sleep(args.delay)
                continue

            if username.lower() in curr_assignees:
                already_assigned += 1
            else:
                if args.dry_run:
                    print(f"  [DRY-RUN] Would assign @{username} to {itype.upper()} #{num}")
                    newly_assigned += 1
                else:
                    edit_cmd = ["gh", itype, "edit", str(num), "--add-assignee", username]
                    edit_res = run_cmd(edit_cmd)
                    if edit_res.returncode == 0:
                        print(f"  [ASSIGNED] Added @{username} to {itype.upper()} #{num}")
                        newly_assigned += 1
                    else:
                        print(f"  [FAIL] Failed to assign @{username} to {itype.upper()} #{num}: {edit_res.stderr.strip()}")
                        errors += 1
                time.sleep(args.delay)

    print("\n=================================================================")
    print("                      SUMMARY REPORT                             ")
    print("=================================================================")
    print(f"Total Items Checked:        {total_checked}")
    print(f"Already Assigned:           {already_assigned}")
    print(f"Newly Assigned:             {newly_assigned}")
    print(f"Pending Invitees Skipped:   {pending_skipped}")
    print(f"Errors:                     {errors}")
    print("=================================================================\n")

if __name__ == "__main__":
    main()
