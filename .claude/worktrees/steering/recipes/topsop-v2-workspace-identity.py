#!/usr/bin/env python3
"""Compute the canonical Topsop tuning V2 workspace identity.

The v1 manifest format intentionally matches the digest already written by the
V2 characterize/promote workers:

    tracked:<sha256(git diff HEAD bytes)>\n
    untracked:<repo-relative path>:<sha256(file bytes)>\n
Untracked entries are sorted by their UTF-8 repo-relative path. The final
workspace_diff_digest is SHA-256 over the UTF-8 manifest bytes.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ALGORITHM = "topsop-v2-workspace-manifest-v1"


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def git_bytes(root: Path, *args: str) -> bytes:
    completed = subprocess.run(
        ["git", "-C", str(root), *args],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if completed.returncode != 0:
        message = completed.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"git {' '.join(args)} failed: {message}")
    return completed.stdout


def untracked_bytes(path: Path) -> bytes:
    if path.is_symlink():
        return os.readlink(path).encode("utf-8")
    if path.is_file():
        return path.read_bytes()
    raise RuntimeError(f"unsupported untracked path type: {path}")


def workspace_identity(root: Path) -> dict[str, object]:
    root = root.resolve(strict=True)
    head = git_bytes(root, "rev-parse", "--verify", "HEAD").decode().strip()
    tracked_diff = git_bytes(root, "diff", "HEAD")
    tracked_digest = sha256(tracked_diff)

    raw_paths = git_bytes(root, "ls-files", "--others", "--exclude-standard", "-z")
    encoded_paths = [item for item in raw_paths.split(b"\0") if item]
    paths: list[str] = []
    for encoded_path in encoded_paths:
        try:
            path = encoded_path.decode("utf-8")
        except UnicodeDecodeError as error:
            raise RuntimeError("untracked path is not valid UTF-8") from error
        if "\n" in path or "\r" in path:
            raise RuntimeError(f"untracked path contains a newline: {path!r}")
        paths.append(path)
    paths.sort()

    manifest_lines = [f"tracked:{tracked_digest}\n"]
    untracked: list[dict[str, str]] = []
    for relative_path in paths:
        digest = sha256(untracked_bytes(root / relative_path))
        manifest_lines.append(f"untracked:{relative_path}:{digest}\n")
        untracked.append(
            {"path": relative_path, "sha256": f"sha256:{digest}"}
        )

    manifest = "".join(manifest_lines).encode("utf-8")
    return {
        "schema_version": 1,
        "algorithm": ALGORITHM,
        "workspace_root": str(root),
        "head": head,
        "tracked_diff_sha256": f"sha256:{tracked_digest}",
        "untracked": untracked,
        "dirty": bool(tracked_diff or paths),
        "workspace_diff_digest": f"sha256:{sha256(manifest)}",
    }


def write_json(path: Path, payload: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    contents = (json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode()
    fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(contents)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    except BaseException:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
        raise


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workspace", required=True, type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    try:
        workspace = args.workspace.resolve(strict=True)
        if args.output is not None:
            output = args.output.expanduser().resolve(strict=False)
            try:
                output_inside_workspace = (
                    os.path.commonpath([str(output), str(workspace)]) == str(workspace)
                )
            except ValueError:
                output_inside_workspace = False
            if output_inside_workspace:
                raise RuntimeError("--output must be outside the measured workspace")
        else:
            output = None

        payload = workspace_identity(workspace)
        if output is None:
            json.dump(payload, sys.stdout, ensure_ascii=False, indent=2)
            sys.stdout.write("\n")
        else:
            write_json(output, payload)
    except (OSError, RuntimeError) as error:
        print(f"workspace identity failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
