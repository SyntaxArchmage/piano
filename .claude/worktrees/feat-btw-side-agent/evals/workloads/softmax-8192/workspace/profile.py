"""Bounded profile/timing entrypoint for the promoted softmax candidate."""

import importlib.util
import json
import shutil
import time
from pathlib import Path


def load_kernel():
    path = Path("state/current-best.py")
    spec = importlib.util.spec_from_file_location("tuna_current_best", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load promoted source: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    report_path = Path("state/profile-timing.json")
    try:
        import torch

        if not torch.cuda.is_available():
            raise RuntimeError("CUDA is not available")
        module = load_kernel()
        torch.manual_seed(0)
        m = n = 8192
        source = torch.randn((m, n), device="cuda", dtype=torch.float32)
        reference = torch.softmax(source, dim=-1)
        result = module.run(source)
        if not torch.allclose(result, reference, rtol=1e-3, atol=1e-3):
            error = (result - reference).abs().max().item()
            raise RuntimeError(f"promoted source failed verification (max abs error {error})")
        for _ in range(2):
            module.run(source)
        torch.cuda.synchronize()
        start = time.perf_counter()
        for _ in range(5):
            module.run(source)
        torch.cuda.synchronize()
        elapsed_ms = (time.perf_counter() - start) * 1000.0 / 5.0
        bytes_moved = 2 * m * n * 4
        bandwidth_gbps = bytes_moved / (elapsed_ms / 1000.0) / 1e9
        state = json.loads(Path("state/tuning-state.json").read_text())
        peak_bandwidth = state.get("device", {}).get("memory_bandwidth_gbps")
        utilization = bandwidth_gbps / peak_bandwidth if isinstance(peak_bandwidth, (int, float)) and peak_bandwidth > 0 else None
        metrics = {"launch_overhead": elapsed_ms}
        if utilization is not None:
            metrics["memory_bandwidth_utilization"] = max(0.0, min(1.0, utilization))
        profiler = shutil.which("ncu")
        report = {
            "status": "timing-only",
            "target_operator": "kernel.py:run",
            "device": {
                "name": torch.cuda.get_device_name(),
                "architecture": f"sm_{torch.cuda.get_device_capability()[0]}{torch.cuda.get_device_capability()[1]}",
            },
            "metrics": metrics,
            "bottlenecks": [{
                "type": "memory",
                "description": "Timing-only effective bandwidth; hardware counters were not collected.",
                "evidence": f"elapsed_ms={elapsed_ms:.4f}, effective_bandwidth_gbps={bandwidth_gbps:.4f}",
            }],
            "analysis": (
                "The promoted kernel passed the numerical check. This report uses real CUDA timing and derived "
                f"bandwidth; Nsight Compute is {'available' if profiler else 'not available'} and no compute/occupancy "
                "counter is claimed."
            ),
            "raw_path": str(report_path),
        }
    except Exception as error:
        report = {
            "status": "blocked",
            "target_operator": "kernel.py:run",
            "device": {"name": "unknown", "architecture": "unknown"},
            "analysis": "The bounded profile entrypoint could not produce a verified timing report.",
            "blocker": str(error),
            "raw_path": str(report_path),
        }
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report))


if __name__ == "__main__":
    main()
