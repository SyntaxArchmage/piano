# ISA4.0 VLIW Packet Format & Encoding

128-bit VLIW packet 内含 4 或 5 个 slot,按 slot 类型组合不同指令包语义。

## Instruction Slot Types

| Instruction Type | Description |
|-----------------|-------------|
| CTRL | Program flow control instructions |
| SALU | Scalar computation and MOV instructions (32-bit integer, 64-bit ops) |
| SLDST | 64-bit/32-bit/16-bit/8-bit scalar load/store instructions |
| MALU | Matrix ALU data instructions. Supports INT8/UINT8/UINT16/INT16/UINT32/INT32/UINT64/INT64 (integer), FP8/BF16/FP16/FP32 (floating point) |
| VMOV | Vector/matrix register-to-register mov, scalar-to-vector/matrix mov, initialization |
| VLDST | Vector/matrix register load/store instructions |
| MLI | Middle Level instructions. Fixed packing with MLI_HINT or MLI_GEMM; cannot pack with other instruction types |

## VPT (Vector Pipeline Thread) Model

- MALU/VMOV/VLDST series support up to 2 VPT operand semantics
- Each vector/matrix instruction drives 2 independent groups of vector/matrix registers, yielding 2 sets of results
- TCTL register allows dynamic switching of VPT count: 0 VPT (scalar-only), 1 VPT (fixed VPT0), or 2 VPT
- Scalar registers and scalar instruction results can be shared by all VPTs

## Register & Architecture State

1. **L0 registers**: Independent per software thread
   - Two VPTs within a thread share L0 vector/matrix registers, but L0 scalar registers are shared by all VPTs
2. **SPR registers**: Mostly independent per software thread, but some SPRs are shared per hardware thread
3. **CSR registers**: Accessible by all software threads
