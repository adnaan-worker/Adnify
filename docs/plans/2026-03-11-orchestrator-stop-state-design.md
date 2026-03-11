# Orchestrator Stop-State Cleanup Design

**Problem:** 手动停止编排执行后，顶层执行器会停下，但 `plan task`、`execution task`、`work package`、租约与排队状态没有一起回收，导致 UI 残留 `executing/queued`，并且同一条 plan 再次启动时会复用脏状态。

## Approaches

1. **仅修 UI 文案/展示**
   - 优点：改动最小。
   - 缺点：后台状态仍然是脏的，重启执行仍可能异常。

2. **在 `stopPlanExecution()` 里分散清理各类状态**
   - 优点：入口直接。
   - 缺点：状态散落在执行器里，后续暂停/异常收尾也容易再次漏清。

3. **在 store 中增加原子“停止回收”动作（推荐）**
   - 优点：把 plan task、execution task、work package、lease、queue、selection 一次性收敛到可重启状态；执行器只负责触发。
   - 缺点：需要补一组较完整的状态回归测试。

## Recommended Design

- 在 `orchestratorSlice` 增加一个面向“手动停止”的原子回收 action。
- 回收范围仅覆盖**运行时残留状态**：
  - `plan.tasks`: `running -> pending`
  - `executionTask.state`: 回到 `planning`
  - `workPackages`: `executing/leasing/running/verifying/waiting-approval -> queued`
  - `ownershipLeases`: 统一标记为 `released`
  - `executionQueueItems`: 统一标记为 `cancelled`
  - 清掉当前任务/选择中的 handoff/proposal 指针
- **保留已完成结果**：`completed/applied/failed/reassigned/proposal-ready/handoff` 不回滚，避免用户丢失已形成的审阅上下文。
- `stopPlanExecution()` 继续负责：停调度器、`abortAll()`、清理隔离工作区；随后调用新的 store cleanup action。
- 同一条 plan 下次重新执行时，应从干净的 runtime 状态继续，而不是复用假 `executing` 状态。

## Testing

- 先写一个失败测试：停止后，运行中的 work package 与 plan task 会回到可重启状态，排队项/租约被取消或释放。
- 再验证：已完成或已形成 proposal 的 work package 不被错误擦除。
