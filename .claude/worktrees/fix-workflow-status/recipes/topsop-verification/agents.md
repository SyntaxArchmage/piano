# topsop verification

候选正确性验证 stage。通过正式 `ophal test` 入口先跑 target case、再跑完整回归，产出且只产出 `verification-report`。

- `compile.passed` / `run.passed` 必须与 exit code 一致；只有 compile、run、numeric check 全部通过时 verdict 才能是 `pass`。
- 根据真实 diff 证据做有界修复；禁止绕过根因或弱化测试。
- 不 profile、不 benchmark、不做最终 summary。
