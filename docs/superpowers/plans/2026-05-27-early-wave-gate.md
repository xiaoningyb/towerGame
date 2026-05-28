# 提前开下一轮门禁实现计划

> **给代理执行者：** 必需子技能：使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 按任务逐步实现本计划。步骤使用复选框（`- [ ]`）语法方便跟踪。

**目标：** 只有当前轮敌人已经全部出现后，才允许提前开启下一轮。

**架构：** 保持现有单文件微信小游戏结构。新增一个集中判断是否允许开下一轮的辅助函数，然后同时在 `startWave()` 和 `drawControls()` 中使用它，确保实际行为和按钮状态一致。

**技术栈：** 微信小游戏 Canvas，`/Users/xiaoning1/Documents/towerGame/game.js` 中的原生 JavaScript，Markdown 文档。

---

### 任务 1：限制提前开下一轮

**文件：**
- 修改：`/Users/xiaoning1/Documents/towerGame/game.js`
- 修改：`/Users/xiaoning1/Documents/towerGame/README.md`

- [ ] **步骤 1：新增波次开启判断函数**

在 `/Users/xiaoning1/Documents/towerGame/game.js` 的 `startWave()` 附近加入：

```js
function canStartNextWave() {
  if (state.gameOver) return false
  if (!state.running) return true
  return spawnQueue.length === 0
}
```

- [ ] **步骤 2：在 `startWave()` 中使用判断函数**

把 `startWave()` 内第一行：

```js
if (state.gameOver) return
```

替换为：

```js
if (!canStartNextWave()) return
```

预期行为：当 `spawnQueue.length > 0` 时，点击波次按钮不能追加下一轮。

- [ ] **步骤 3：更新波次按钮文案和禁用状态**

在 `drawControls()` 中，把：

```js
layout.actionButtons[0].text = `开始第 ${state.wave + 1} 轮`
```

替换为：

```js
const canStartWave = canStartNextWave()
const earlyWaveReady = state.running && spawnQueue.length === 0 && enemies.length > 0
layout.actionButtons[0].text = earlyWaveReady ? `提前开始第 ${state.wave + 1} 轮` : `开始第 ${state.wave + 1} 轮`
```

然后把 `layout.actionButtons.forEach` 内的 `disabled` 计算替换为：

```js
const disabled = button.id === 'speed'
  ? state.gameOver
  : button.id === 'map'
    ? state.running || state.gameOver
    : !canStartWave
```

预期行为：当前轮仍在刷怪时，波次按钮禁用；刷怪完成但仍有敌人存活时，按钮显示 `提前开始第 N 轮` 并可点击。

- [ ] **步骤 4：更新 README 文案**

在 `/Users/xiaoning1/Documents/towerGame/README.md` 中，把波次开启说明替换为：

```md
- 点击“开始第 N 轮”刷出一轮敌人；本轮敌人全部出现后，即使场上还有敌人，也可以点击“提前开始第 N 轮”追加下一轮，并根据预计提前清场时间发放一笔金币奖励。
```

- [ ] **步骤 5：验证语法**

运行：

```bash
node --check game.js
```

预期：无输出，退出码为 `0`。

- [ ] **步骤 6：在微信开发者工具中手动验证**

检查：

```text
1. 开始第 1 轮。
2. 敌人仍在刷出时，波次按钮禁用。
3. 第 1 轮敌人全部出现、但尚未全部被消灭时，按钮显示“提前开始第 2 轮”。
4. 点击按钮；第 2 轮追加到队列，并增加提前奖励金币。
5. 第 2 轮刷怪期间，按钮再次禁用，直到第 2 轮敌人全部出现。
```

- [ ] **步骤 7：如果仓库已准备好提交，则提交聚焦变更**

只有当项目文件已经被明确跟踪时才提交。如果仓库仍显示整个项目都是未跟踪状态，不要创建范围很大的初始提交。

```bash
git add game.js README.md docs/superpowers/specs/2026-05-27-early-wave-gate-design.md docs/superpowers/plans/2026-05-27-early-wave-gate.md
git commit -m "feat: gate early wave starts"
```
