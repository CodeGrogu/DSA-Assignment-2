#!/usr/bin/env python3
"""Check Ballerina formatting without changing the checkout or comparing EOL styles."""

import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent


def normalized_text(path: Path) -> str:
    # Ballerina writes platform-native newlines; Git checks out *.bal with LF.
    with path.open("r", encoding="utf-8", newline=None) as source:
        return source.read()


def check_package(package: Path, bal: str) -> bool:
    sources = sorted(
        source for source in package.rglob("*.bal")
        if not any(part in {"target", ".ballerina"} for part in source.relative_to(package).parts)
    )
    with tempfile.TemporaryDirectory(prefix="bal-format-") as temporary:
        copy = Path(temporary)
        shutil.copyfile(package / "Ballerina.toml", copy / "Ballerina.toml")
        for source in sources:
            destination = copy / source.relative_to(package)
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, destination)

        result = subprocess.run(
            [bal, "format"], cwd=copy, capture_output=True, text=True, check=False
        )
        if result.returncode != 0:
            print(f"[FAIL] {package.relative_to(ROOT)}: {result.stdout}{result.stderr}")
            return False

        changed = [str(source.relative_to(ROOT)) for source in sources
                   if normalized_text(source) != normalized_text(copy / source.relative_to(package))]
        if changed:
            print(f"[FAIL] Formatting needed: {', '.join(changed)}")
            return False
        print(f"[PASS] {package.relative_to(ROOT)}")
        return True


def main() -> int:
    bal = shutil.which("bal") or shutil.which("bal.bat")
    if bal is None:
        print("[ERROR] Ballerina CLI (bal) not found", file=sys.stderr)
        return 1

    packages = sorted(path.parent for group in ("modules", "services")
                      for path in (ROOT / group).glob("*/Ballerina.toml"))
    if not packages:
        print("[ERROR] No Ballerina packages found", file=sys.stderr)
        return 1
    results = [check_package(package, bal) for package in packages]
    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(main())
