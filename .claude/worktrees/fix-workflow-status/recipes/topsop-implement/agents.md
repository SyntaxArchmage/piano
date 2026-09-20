# topsop implement

implement stage 承接 `optimization-proposal`：把其中的**恰好一个**变量落到指定 kernel / host dispatch 源码，发起编译（代码改动先 sanitizer 再 normal），保留 `so_commit` / `so_mtime` 凭证，产出 `topsop-implementation-report`。

- 只实现 + 编译，不验证正确性（那是 verify stage）、不 profile、不 benchmark。
- 一次只改一个变量，不 bundle。首版架构必须正确，不写 naive 实现"以后再优化"。
- 编译失败如实报 `compile_failed`，修复只针对编译器输出的实际错误，禁止绕过根因、禁止弱化测试。
- 工具不可用时报 `blocked: tools_unavailable_<reason>`；编译失败时报 `compile_failed` 带真实 stderr 摘要。

本 worker 只落地单一变量并证明它编译通过。
