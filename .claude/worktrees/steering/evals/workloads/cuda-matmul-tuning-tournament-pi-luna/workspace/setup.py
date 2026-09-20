"""Initialize run-owned state for the native CUDA tuning case."""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from verify import SOURCE, compile_candidate, run_binary


ROOT = Path(__file__).resolve().parent
STATE = ROOT / "state"


def blocked_report(blocker: str, raw_output: str | None = None) -> dict[str, object]:
    return {
        "status": "blocked",
        "target": {"operator": "matmul", "shape": "512x512x512", "dtype": "f32"},
        "device": {"name": "unknown", "architecture": "unknown"},
        "toolchain": {"compiler": "nvcc", "runtime": "unknown", "profiler": "unavailable"},
        "blocker": blocker,
        **({"raw_output": raw_output} if raw_output else {}),
    }


def command_output(command: list[str]) -> tuple[int, str]:
    try:
        result = subprocess.run(command, cwd=ROOT, text=True, capture_output=True)
    except OSError as error:
        return 127, str(error)
    return result.returncode, (result.stdout + result.stderr).strip()


def device_info() -> tuple[str, str]:
    code, output = command_output([
        "nvidia-smi", "--query-gpu=name,compute_cap", "--format=csv,noheader",
    ])
    if code == 0 and output:
        pieces = [piece.strip() for piece in output.splitlines()[0].split(",", 1)]
        return (pieces[0], pieces[1] if len(pieces) > 1 else "unknown")
    return ("unknown", "unknown")


def compiler_info() -> str:
    # verify.py resolves the compiler for the actual build. Keep discovery
    # bounded to the same PATH/fixed CUDA roots when recording toolchain data.
    from verify import nvcc

    compiler = nvcc()
    result = subprocess.run([compiler, "--version"], cwd=ROOT, text=True, capture_output=True)
    return next((line.strip() for line in result.stdout.splitlines() if line.strip()), compiler)


def main() -> int:
    try:
        compile_result = compile_candidate()
    except (OSError, RuntimeError) as error:
        print(json.dumps(blocked_report(f"nvcc unavailable: {error}")))
        return 1
    if compile_result.returncode != 0:
        print(json.dumps(blocked_report(
            "seed compilation failed",
            (compile_result.stdout + compile_result.stderr).strip(),
        )))
        return compile_result.returncode
    verify_code = run_binary("--verify")
    if verify_code != 0:
        print(json.dumps(blocked_report("seed verification failed")))
        return verify_code
    bench_code, bench_output = command_output([sys.executable, "verify.py", "--bench"])
    if bench_code != 0:
        print(json.dumps(blocked_report("seed benchmark failed", bench_output)))
        return bench_code
    metric_match = re.search(r"TFLOPS:\s*([0-9.]+)", bench_output)
    if metric_match is None:
        print(json.dumps(blocked_report("seed benchmark emitted no TFLOPS", bench_output)))
        return 1
    custom_metric = float(metric_match.group(1))

    STATE.mkdir(parents=True, exist_ok=True)
    current_best = STATE / "current-best.cu"
    shutil.copy2(SOURCE, current_best)
    digest = "sha256:" + hashlib.sha256(SOURCE.read_bytes()).hexdigest()
    now = datetime.now(timezone.utc).isoformat()
    state = {
        "version": 1,
        "run_id": os.environ.get("TUNA_RUN_ID", "unknown"),
        "workspace": str(ROOT),
        "target": {"operator": "matmul", "shape": "512x512x512", "dtype": "f32", "layout": "row-major"},
        "device": {"name": device_info()[0], "architecture": device_info()[1]},
        "toolchain": {"compiler": compiler_info(), "runtime": "CUDA", "profiler": shutil.which("ncu") or "unavailable"},
        "current_best": {
            "path": "state/current-best.cu", "digest": digest, "sha256": digest,
            "iteration": -1, "verified": True, "metric_tflops": custom_metric,
            "metric": {"name": "tflops", "best": custom_metric, "direction": "higher"},
            "tflops": custom_metric,
        },
        "history": [],
        "created_at": now,
    }
    (STATE / "tuning-state.json").write_text(json.dumps(state, indent=2) + "\n")
    (STATE / "history.jsonl").write_text(json.dumps({"stage": "setup", "entry": "setup.py", "digest": digest, "timestamp": now}) + "\n")
    report = {
        "status": "ready",
        "target": {"operator": "matmul", "shape": "512x512x512", "dtype": "f32"},
        "device": state["device"],
        "toolchain": state["toolchain"],
        "baseline": {"custom_kernel": {"path": "matmul.cu", "digest": digest}, "custom_metric": custom_metric},
        "current_best": {"path": "state/current-best.cu", "digest": digest},
        "state_path": "state/tuning-state.json",
    }
    print(json.dumps(report))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
