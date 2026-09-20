# TopsAten Operator Development Guide on Libra

TopsAten operator development connects a public Host API to an OpBase implementation, a host-side kernel wrapper, device code, build wiring, and tests. This reference keeps only workflow-level facts that are stable across checkout layouts; locate concrete files by searching the current topsop checkout rather than copying paths from this document.

## Operator Layers

- Public API layer: declares the user-facing entry point and status / dtype / layout contracts.
- OpBase layer: stores arguments, validates them, selects fast path / fallback, and launches the wrapper.
- Host wrapper layer: prepares launch geometry, workspace offsets, and device arguments.
- Device layer: implements the kernel body for the selected path.
- Test layer: exercises the public API and compares against a CPU reference.

## Development Flow

1. Identify the public API semantics: inputs, outputs, optional tensors, dtype/layout support, shape constraints, and fallback behavior.
2. Find the closest existing operator by API name or stable symbol in the current checkout.
3. Trace the call chain from public API to OpBase, wrapper, and device entry.
4. Add or update the device implementation and wrapper together so the official call path reaches the kernel.
5. Add tests through the current checkout's build system and run the target by name.

## Host Checks

`CheckArgs()` should validate user-visible contracts before launch: null pointers, optional combinations, rank/shape/stride, dtype/layout support, workspace budget, and fallback coverage. Path selection stays on the host side because the kernel only receives the already-approved execution plan.

## Build and Test Notes

Use the CMake target names and test binaries from the current checkout. Do not copy example source file names or directory layouts from this reference; topsop organization can change between branches.
