"""Bounded timing profile for the promoted native CUDA GEMM source."""

from __future__ import annotations

import json
import re
import subprocess
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path

from verify import BUILD, ROOT, nvcc


SOURCE = ROOT / "state" / "current-best.cu"
BINARY = BUILD / "profile-matmul"
REPORT_PATH = ROOT / "state" / "profile-timing.json"


def run(command: list[str]) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(command, cwd=ROOT, text=True, capture_output=True)
    except OSError as error:
        return subprocess.CompletedProcess(command, 127, "", str(error))


def device_info() -> tuple[str, str]:
    result = run(["nvidia-smi", "--query-gpu=name,compute_cap", "--format=csv,noheader"])
    if result.returncode == 0 and result.stdout.strip():
        pieces = [piece.strip() for piece in result.stdout.splitlines()[0].split(",", 1)]
        return pieces[0], pieces[1] if len(pieces) > 1 else "unknown"
    return "unknown", "unknown"


def main() -> int:
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    if not SOURCE.is_file():
        report = {"status": "blocked", "target_operator": "matmul.cu:matmul_kernel", "device": {"name": "unknown", "architecture": "unknown"}, "analysis": "Promoted source is missing.", "blocker": str(SOURCE), "raw_path": str(REPORT_PATH)}
    else:
        BUILD.mkdir(parents=True, exist_ok=True)
        try:
            compiler = nvcc()
        except (OSError, RuntimeError) as error:
            compiler = None
            compile_result = subprocess.CompletedProcess([], 127, "", str(error))
        if compiler is not None:
            compile_result = run([compiler, "-O3", "-std=c++17", "-o", str(BINARY), str(SOURCE)])
        if compile_result.returncode != 0:
            report = {"status": "blocked", "target_operator": "matmul.cu:matmul_kernel", "device": {"name": "unknown", "architecture": "unknown"}, "analysis": "Promoted source did not compile.", "blocker": (compile_result.stderr or compile_result.stdout).strip(), "raw_path": str(REPORT_PATH)}
        else:
            verify_result = run([str(BINARY), "--verify"])
            bench_result = run([str(BINARY), "--bench"])
            output = (bench_result.stdout + bench_result.stderr).strip()
            tflops = re.search(r"TFLOPS:\s*([0-9.]+)", output)
            kernel_ms = re.search(r"KERNEL_MS:\s*([0-9.]+)", output)
            if verify_result.returncode != 0 or bench_result.returncode != 0 or tflops is None:
                diagnostics = "\n".join(part for part in (
                    verify_result.stdout,
                    verify_result.stderr,
                    bench_result.stdout,
                    bench_result.stderr,
                ) if part.strip()).strip()
                report = {"status": "blocked", "target_operator": "matmul.cu:matmul_kernel", "device": {"name": "unknown", "architecture": "unknown"}, "analysis": "Promoted source could not produce verified timing evidence.", "blocker": diagnostics or "benchmark emitted no TFLOPS", "raw_path": str(REPORT_PATH)}
            else:
                name, architecture = device_info()
                report = {
                    "status": "timing-only",
                    "target_operator": "matmul.cu:matmul_kernel",
                    "device": {"name": name, "architecture": architecture},
                    # Do not turn an unavailable timing field into a fake zero.
                    "metrics": {} if kernel_ms is None else {"launch_overhead": float(kernel_ms.group(1))},
                    "bottlenecks": [{"type": "compute", "description": "Native GEMM timing evidence; hardware counters were not collected.", "evidence": f"TFLOPS={tflops.group(1)}"}],
                    "analysis": "The promoted native CUDA source passed its CPU-reference check; this report intentionally claims timing only.",
                    "source": {"path": "state/current-best.cu", "digest": "sha256:" + sha256(SOURCE.read_bytes()).hexdigest()},
                    "raw_output": output,
                    "measured_at": datetime.now(timezone.utc).isoformat(),
                    "raw_path": str(REPORT_PATH),
                }
    REPORT_PATH.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
