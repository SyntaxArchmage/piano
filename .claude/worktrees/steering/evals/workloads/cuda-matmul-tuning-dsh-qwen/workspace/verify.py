"""Grader-owned compile, correctness, and benchmark entrypoint for matmul.cu."""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
BUILD = ROOT / ".tuna-build"
SOURCE = ROOT / "matmul.cu"
BINARY = BUILD / "matmul"


def nvcc() -> str:
    candidates = []
    from_path = shutil.which("nvcc")
    if from_path:
        candidates.append(from_path)
    candidates.extend(sorted(Path("/usr/local").glob("cuda*/bin/nvcc"), reverse=True))
    for candidate in candidates:
        if Path(candidate).is_file():
            return str(candidate)
    raise RuntimeError("nvcc not found in PATH or /usr/local/cuda*/bin")


def compile_candidate(source: Path = SOURCE, binary: Path = BINARY) -> subprocess.CompletedProcess[str]:
    BUILD.mkdir(parents=True, exist_ok=True)
    command = [nvcc(), "-O3", "-std=c++17", "-o", str(binary), str(source)]
    result = subprocess.run(command, cwd=ROOT, text=True, capture_output=True)
    sys.stdout.write(result.stdout)
    sys.stderr.write(result.stderr)
    return result


def run_binary(mode: str) -> int:
    try:
        result = subprocess.run([str(BINARY), mode], cwd=ROOT, text=True, capture_output=True)
    except OSError as error:
        print(f"cannot run {BINARY}: {error}", file=sys.stderr)
        return 1
    sys.stdout.write(result.stdout)
    sys.stderr.write(result.stderr)
    return result.returncode


def main(argv: list[str]) -> int:
    if len(argv) != 2 or argv[1] not in {"--compile", "--verify", "--bench"}:
        print("usage: verify.py --compile|--verify|--bench", file=sys.stderr)
        return 2
    try:
        compiled = compile_candidate()
    except (OSError, RuntimeError) as error:
        print(f"compile unavailable: {error}", file=sys.stderr)
        return 1
    if compiled.returncode != 0 or argv[1] == "--compile":
        return compiled.returncode
    return run_binary(argv[1])


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
