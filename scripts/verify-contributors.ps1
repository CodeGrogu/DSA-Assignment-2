# Verifies every team member has at least one non-merge commit.
# Exit 0 = all verified, 1 = verification failed, 2 = not a git repository.

$ErrorActionPreference = 'Stop'

# Ensure running inside a valid Git repository
$root = git rev-parse --show-toplevel 2>$null
if (-not $root) { 
    Write-Host "[ERROR] Not inside a Git repository." -ForegroundColor Red
    exit 2 
}
Set-Location $root

# Team members and their corresponding author search patterns (Name, Email, or Username)
$members = @(
    @{ Name = 'Jaden Awaseb'; Pattern = 'Jaden|acehood3556|73761054' },
    @{ Name = 'Florinda';     Pattern = 'Florriinnddaa|florinda.funya' },
    @{ Name = 'Nangu Tjizoo'; Pattern = 'Nangu.Tjizoo|knangukuii' },
    @{ Name = 'Jerganov';     Pattern = 'Jerganov|klvntapiwa3' },
    @{ Name = 'Kataliina';    Pattern = 'Kataliina|kataliinamassipa' },
    @{ Name = 'Henchoz';      Pattern = 'Henchoz|henryheita0' },
    @{ Name = 'Kondwani';     Pattern = 'kondwani11220|kondwanikunkwenzu' },
  @{ Name = 'May-Lee Mulundu'; Pattern = 'May-Lee|Mayleendapewa' })

$hasFailure = $false
Write-Host "`n--- CONTRIBUTOR AUDIT REPORT ---" -ForegroundColor Cyan

foreach ($member in $members) {
    # Fetch non-merge commit hashes matching author pattern across all branches
    $commits = @(git log --all --no-merges -i -E --author="$($member.Pattern)" --format="%h")
    $count = $commits.Count

    if ($count -ge 1) {
        $statusLabel = "OK"
        $statusColor = "Green"
    } else {
        $statusLabel = "MISSING"
        $statusColor = "Red"
        $hasFailure = $true
    }

    # Output formatted log entry
    Write-Host ("{0,-28} | Commits: {1,3} | " -f $member.Name, $count) -NoNewline
    Write-Host ("[{0}]" -f $statusLabel) -ForegroundColor $statusColor
}

Write-Host "--------------------------------" -ForegroundColor Cyan

if ($hasFailure) {
    Write-Host "[FAIL] One or more members have no verified non-merge commits." -ForegroundColor Red
    exit 1
} else {
    Write-Host "[SUCCESS] All team members have verified non-merge commits!" -ForegroundColor Green
    exit 0
}
