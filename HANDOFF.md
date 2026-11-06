# 交接文档 — 物品模型映射装配（Blockbench 插件）

> 生成时间：2026-11-06 更新 · 当前版本 **0.73.3**
> 用途：换新会话继续开发前的完整交接。**先读这一份，再动代码。**
> 注意：0.68.86–0.68.98 的实例化撤销/覆盖改动已全部回退；0.68.113 是基线，0.68.114 修掉「导出阈值被子级格式覆盖」，0.68.115 修掉「实例化后 export=false 导致整条分支不导出」，0.68.116 修掉「撤销不删除新建节点」的 3 处问题，0.68.117 修掉「枢轴归位把方块挪走」并说明 gizmo 位置规则。
> **调试入口已升级：可用 `_bbcdp.js` 从终端直连软件内 Console + 全部 Blockbench 事件，见 `_BBCDP.md` 与 0.0.2。**

---

## 0. 当前正在进行的任务（交接时未完成）

**状态：0.68.113 已部署，用户验证后仍反馈「选择序列分支时顺序仍变化，且 Console 没有任何输出」。**  
**代码基线是 `v0.68.105`（其撤销/覆盖来自 0.68.85 的修复链）；0.68.86–0.68.98 不采用。0.68.113 单测 231/231，包含实例化撤销 aspects 与覆盖集成测试。**

### 0.0.1 最新一轮结论（2026-10-27，务必先读）

用户在本轮反馈两点：

1. **顺序仍然在变化，但 Console 没有任何输出。**
2. 追问「为什么刚才的输出是『右键菜单』」。

已完成的排查（通过读取真实 `assembly.bbmodel` 备份 + 反编译 `app.asar` 中 Blockbench 5.2.2 源码）：

- **「右键菜单」日志解释**：`[装配] 已重排复调用标签右键菜单` 来自 `attachLocatorMenu()/attachGroupMenu()`，是**挂载 Locator 右键菜单**时打印，**与排序无关**。旧版之所以刷屏，是因为 `attachGroupMenu()` 被绑在 `update_selection` 上、每选一次就重建菜单；0.68.112 起 `update_selection` 只跑选择守卫，`.113` 又恢复 `locatorMenuAttached` 守卫，所以现在不再刷。
- **Console 无输出是符合预期的**：`.112/.113` 已让「选择」不再触发 `scheduleBranchSync`，选择时本就不应出现 `[装配] 分支同步触发` / `sortBranchChildren`。**没有日志 ≠ 没改顺序，也不代表排序逻辑被触发。**
- **Blockbench 自身源码确认**：`Group.select()` / `multiSelect()` / `markAsSelected()` 只改 `selected` 标记，**不动 `children` 数组顺序**；outliner 的 Vue 模板直接 `v-for` 渲染 `node.children`，**没有按选中重排 / 按名字自动排序**。所以「选择导致顺序变化」不可能是 Blockbench 原生行为，只能来自插件改动 `children` 或改 `name` 前缀。
- **真实工程备份分析**（`%APPDATA%\Blockbench\backups\backup_27.10.26_0.28_assembly.bbmodel`，已用 Blockbench 内嵌 lz-string 解压）：
  - 容器 `bone7`：`imda_threshold_format = "5-i"`，子分支实际 outliner 顺序是
    `[5] sacpack1, [4] 调用 sacpack2, [3] 调用 sacpack3, [2] 调用 sacpack4, [1] 调用 sacpack5`（**这就是 `5-i` 期望的顺序，是对的**）。
  - **但每个子分支自己的 `imda_threshold` 字段却是 1,2,3,4,5（升序）**，与名字前缀 `[5..1]` 相反。
  - 0:18 与 0:28 两个备份顺序/数值完全一致 → **静止状态下顺序是稳定的**，用户看到的“变化”应发生在交互过程中。
  - 对比 0:08 工程里的 `sac_counts`（同样 `5-i`）：子分支 `imda_threshold` 是 5,4,3,2,1（降序、正确）。说明 `bone7` 是后续「实例化/覆盖」产物，且 **threshold 数值被写成了升序**。
- **定位到的真实缺陷（待修）**：
  1. `syncBranchLabels()` 用父级 `imda_threshold_format` 算出的 `formatted`（如 `5-i`→5,4,3,2,1）写回 `child.imda_threshold`；但导出器 `Exporter` 的 range 子循环**优先读子分支自己的 `imda_threshold_format`**（`childFormatted`），`sacpackN` 自身都带 `i`/`i+N`，于是父级 `5-i` 被子级格式覆盖，输出阈值变成 0,1,1,2… 而非 5,4,3,2,1。**子级格式只在“被显式覆盖”时才应优先；否则应继承父级格式。**
  2. `syncBranchLabels()` 的 `select` 分支实际不可达（函数开头只放行 `range_dispatch` / `condition`）。
  3. 若一次同步中先按子级格式/手动值算前缀，再被别处改回，就会出现「名字前缀升序/降序交替」的观感——这与用户描述的“正序倒序交替”高度吻合，且**不需要移动 `children`**。
- **调试环境（已升级，见 0.0.2 / `_BBCDP.md`）**：不要再开 `--user-data-dir` 临时 profile（插件不会加载，报“无效格式”）。正确做法是**完全退出** Blockbench 后带 `--remote-debugging-port=9222 --remote-allow-origins=*` 用**默认 profile** 启动，再用 `_bbcdp.js --watch` 从终端接 Console 与事件总线；接入/断开都不需要重启软件。
- **下一步（尚未做）**：
  - 修 `syncBranchLabels` + 导出器：父分支在“子级无显式覆盖时”必须继承父级 `threshold_format`，保证 `5-i` 输出 5,4,3,2,1；并把子分支 `imda_threshold` 写成与名字前缀一致的降序。
  - 若要彻底确认“选择时谁改了 children/name”，在真实实例里挂最小探针：`update_selection` 前后快照父分组 `children` 的 uuid 顺序 + 每个子节点 `name`，有变化才用 `Blockbench.showQuickMessage`/`console.warn` 报出（不要只 `console.log`，避免用户看不到）。
  - 每次改动后跑 `node --check` + `node _test_sim.js`，并让用户在**完全重启**后确认 onload 版本号。

### 0.0.2 0.68.114（2026-10-27，本轮已完成）

**a) 根因修复（0.0.1 里定位的两个缺陷）**

1. 导出器 `Exporter` 的 `range_dispatch` 子循环改为 **父级 `imda_threshold_format` 优先**：
   `parentFormatted` 有值就直接用，子分组的 `imda_threshold_format` 只在父级没写格式时回退使用。
   理由：子分组的 `threshold_format` 语义是「它自己 entries 的编号」，不是它在父级里的位置；
   让子级覆盖父级正是 `bone7` 的 `5-i` 被 `sacpackN` 的 `i`/`i+N` 顶掉、输出 0,1,1,2… 的原因。
   `imda_threshold_force`（实例化覆盖的显式阈值，含 0）仍然最高优先级。
2. `syncBranchLabels()` 开头放行 `select` 类型（此前 `select` 分支不可达，`[when]` 前缀永不刷新）。

单测 235/235（新增 4 项：父级 `5-i` 覆盖子级自带格式、`threshold_force` 仍优先、
同步后子分支 `imda_threshold` 与名字前缀同向、同步后不丢前缀）。

**b) 新增终端调试桥 `_bbcdp.js`（见 `_BBCDP.md`）**

- 用 CDP（`--remote-debugging-port`）接**主实例默认 profile**，插件照常加载；
  早先 9224 + 临时 `--user-data-dir` 的做法不再需要，也不会再出现「无效格式」。
- 终端可直接读：`console.*`、未捕获异常、以及**全部** `Blockbench.dispatchEvent` 事件
  （包装 `dispatchEvent`，带代际号 + 同名限流，默认屏蔽 `render_frame` 等每帧噪音）。
- 附带 `--eval`（页内执行任意 JS）与 `--snapshot`（打印 outliner 树 + `imda_*` 字段）。
- 下次排查「谁改了 children / name」时，直接 `--watch --out=_bbcdp.log`，
  看 `update_selection` / `add_group` / `finish_edit` 前后的 `[装配]` 日志即可，不必再看软件内 Console。


### 0.0.3 0.68.115（真实工程数据验证后补的修复，重要）

用 `_bbcdp.js` 把真实备份（`backups\backup_27.10.26_0.28_assembly.bbmodel`，先用 `_unlz.js` 解压）
载入运行中的 Blockbench，直接调 `Formats.item_model_definition_assembly.codec.compile()` 复核，发现：

- `bone7` 的 **5 个子分支全部 `export === false`**（40 个分组里 30 个如此），
  于是 `buildNode` 对每个子分组返回 `null`，`bone7` 因为没有任何 entries **整条不导出**
  —— 导出 JSON 里连 `bone7` 这个节点都不存在。
- 来源：`复调用选中的分组` 会把源分组标成 `export = false`（只由 Locator 引用），
  而 `instantiateCallTags` 用 `duplicate()` 复制时把 `export` 一并继承，**从不恢复**。
- 修复：实例化后把副本及其整棵子树的 `export === false` 恢复为 `true`，并打印
  `[装配] 实例化恢复导出 N 个节点`；源分组保持不导出。单测 238 项。

**改完后的真实数据复核**：`bone7` 导出为 `entries.threshold = [5,4,3,2,1]`，
与名字前缀 `[5] sacpack1 … [1] 调用 sacpack5` 完全一致（修复前该节点根本不出现）。

> 复核手法（可复用）：`_unlz.js` 解压备份 → 用 `--eval-file` 传一段
> `setupProject(Formats.item_model_definition_assembly)` + `Codecs.project.parse/load` +
> `codec.compile()` 的探针脚本 → 在 JSON 里按键名取 `entries[].threshold`。

### 0.0.4 0.68.116（撤销审计：同类问题全量排查）

**Blockbench Undo 语义（实测确认，务必记住）**

`Undo.finishEdit(name)` 不传 aspects 时会**复用 init 的 aspects**（`t = aspects || current_save.aspects`）。
所以：

- **只改属性 / 只删除**：`initEdit({groups/elements})` + `finishEdit(name)` 就够了（实测可正确回退）。
- **新建**节点：必须把新节点显式写进 **finish** 的 `elements` / `groups`。否则 `before`/`post` 两个快照里都没有它们，
  撤销时 `outliner` 只会把“不认识的节点”丢回根目录，**节点不会被删除** —— 表现为“只撤销了移动，标签还在”。

**本轮修掉的（都是「新建了却没进 finish」）**

| 功能 | 以前 | 现在 |
| --- | --- | --- |
| 复调用选中的分组（`imda_call_group`） | finish 无 aspects → Locator 留在根目录 | finish `{outliner, elements:[新建 Locator]}` |
| 解析动画时间轴（`imda_bake_timeline`） | 同上 → `[timeline]` 分组和帧标签残留 | finish `{outliner, groups:[timeline], elements:[帧标签]}` |
| 导入引用模型 | 同上 → 导入的分组/方块残留 | finish `{outliner, groups:[group].concat(importedGroups), elements:created}` |
| 规范化结构 | 删除 internal + 收 cube 分两条撤销 | 合并为一条 |
| 分组属性「继续并删除」 | 删子元素 + 改属性分两条撤销 | 合并为一条 |

**已核对无需改动的功能**（都是“只修改/只删除”，finish 省略 aspects 正确）：
枢轴归位 / 参考源重建枢轴 / 从分组创建模型 / 分组映射属性 / 编辑复调用标签 / 修复失效目标 /
移除时间线标签 / 生成复调用序列（新建的 groups+locators 已在 finish）/ 将分组转换为复调用标签（已带 locators）/
实例化复调用标签（0.68.113 已修，本轮真机复测：loc 4→3→4、grp 10→11→10，撤销完整恢复）。

**已知残留限制（非 bug，暂不处理）**

- 「从分组创建模型」「导出/合并资源包」会写磁盘文件，撤销只回退项目内的分组属性，**不会删除已写出的文件**。
- 「导入引用模型」新建的 `Texture` 不在 aspects 里，撤销后纹理会留在项目里（可能被其它分组引用，强删有风险）。
- `syncBranchLabels()` / `stripStrayBranchPrefixes()` 等**自动**改名/改阈值不在撤销栈内（属自动规范化；它们会把 `Project.saved` 置 false）。

**验证方式**：`_bbcdp.js --eval-file` 在真机里建组 → 执行动作 → `Undo.undo()` → 比对 `Locator.all/Group.all/Outliner.root`，
见本文件中「复调用创建撤销」相关探针脚本（已删除，逻辑记录在此）。

### 0.0.5 0.68.117（gizmo / 枢轴：为什么“不在中心”）

**Blockbench 的 gizmo 位置规则（读 5.2.2 源码 + 实测确认）**

- `Group.select()` 末尾是 `this.children.forEach(s => s.markAsSelected(true))` —— **点选分组必然连带选中全部子元素**，无法通过设置关闭。
- 多选时 `Transformer.position` = `getSelectionCenter()`，其实现是：遍历 `Outliner.selected`（**跳过 Group**），取每个元素 `getWorldCenter()` 的 **min/max 包围盒中心**；本格式 `Format.centered_grid === false`，所以最后再 `+(8,0,8)`。
- `Cube.getWorldCenter()` = `THREE.fastWorldPosition(cube.mesh)` = **该方块渲染包围盒的中心**（与 `cube.origin` 无关）。
  ⇒ 所以「选中 sacpack1」时那个大 gizmo 本来就在 9 个方块的几何包围中心附近；**看起来偏的是画在 `group.origin` 上的枢轴标记**。
- 实测证据：把 `sacpack1.origin` 从 `[8.094,3.943,8.252]` 精确移到内容质心 `[9.148,3.925,11.753]` 后，`Transformer.position` **一个数都没变**（`[9.038,4.72,10.657]` 前后一致）。

**方块 origin 从哪来的**

Java 模型没有 Blockbench 的枢轴概念。`importModelReference` 原来只在元素带 `rotation` 时写 `cube.origin = rotation.origin`，其余保持 `[0,0,0]`（方块原点，不是几何中心）；`duplicate()` 实例化还会把源方块的 origin 一并复制。于是 origin 与几何脱节（实测有的方块 origin 在 `[1.58,16.44,17.52]`，在模型外）。

**踩过的坑（务必记住）**

Blockbench 的方块网格是「`mesh.position = origin`，顶点相对 origin 构建」。**在 `init()` 之后改 `cube.origin` 而不重建顶点，方块就会被整体挪走**。
实测：`centerCubePivot(child, g.origin)`、Blockbench 自带 `center_individual_pivots`、以及「origin 改成几何中心 + updateView(geometry:true)」三种做法在这份模型上都会让渲染包围盒炸开（`y` 从 0.55 变成 -12.16 之类）。所以 0.68.117 **删掉了 `applyPivotFix` 里的方块枢轴那一步**。

**0.68.117 的改动**

1. `applyPivotFix` 只做 `fixGroupPivot(g)`（分组 origin → 内容质心，递归），不再动方块枢轴。
   全模型实测：8 个分组 origin 归中，**渲染包围盒前后完全一致**（外观不变）。
2. `importModelReference`：无 `rotation` 的元素在 `cube.init()` **之前**把 `origin` 设为自身几何中心，从源头避免错位枢轴（带 rotation 的仍保留 Java 旋转原点）。
3. 单测 252 项（新增 4 项：枢轴归位只动分组 origin、不动方块 origin/from/to）。

**仍未解决**

- 已有工程里那些错位的历史方块 origin 没有安全的修复手段（改 origin 必须重建顶点，而这边试过的重建路径都会移位）。若要修，需要在真实工程上逐组迭代验证「bbox 完全一致 + gizmo 居中」，别盲改。
- 结论：**想让“选中分组时那个小枢轴标记居中”，用 Tools → 枢轴归位（选中分组）即可**（0.68.117 起不会再动方块）。
### 0.0.6 0.69.0（引用其他映射 / 更新所有调用 / 右键菜单条件化 / 提取应用变换 / 文件选择）

**1) 引用其他物品模型映射**

- `imda_model` 新增语法 `<命名空间>:items/<路径>` → 对应 `assets/<命名空间>/items/<路径>.json`。
- 导出时把该文件里的 `model` 定义**内联**为 `composite` 包裹，外层保留本分组的 `transformation` / `node_name`；读取失败会 `warn` 并退回普通模型引用。
- **重要设计**：导出路径**不读文件系统**。映射内容缓存在项目属性 `imda_mapping_cache`（JSON 字符串）里，导出只读缓存。
  原因：`getScopedFs()` 会走 `requireNativeModule('fs', { show_permission_dialog: true })`，在非用户手势的上下文里调用会**直接把渲染进程搞崩**（本轮实测崩了两次）。
  缓存由「选择引用文件…」和「更新所有调用」填充（这两个都是用户手势，允许弹权限框）。

**2) 工具 → 更新所有调用**（`refreshAllCalls`）

重扫全部复调用标签与 `imda_model` 引用：统计失效目标、`fresh` 重读物品映射（写回缓存）、重排分支名，最后汇总；有问题时弹窗列出（最多 20 条）。

**3) 右键菜单条件化**

- 分组右键：`props`（任意分组）、`pick_model` / `import_model`（仅 `model` 类型）、`create_model` / `call`（仅 `composite`/`inline`）、`convert_call` / `pivot` / `extract_pose` / `apply_pose`。
- 复调用标签右键：`instantiate_this` / `edit_call` 仅在 `imda_call_target` 非空时出现；外加位姿两项。
- 方块右键：位姿两项。
- 实现方式：`menuVariant(base, id, condition)` 生成带条件的菜单副本（共用 `click`），菜单项按 `imda_` 前缀清理后重建；实测条件随选中类型正确切换（model ↔ composite ↔ 未选中）。

**4) 提取变换 / 应用变换**

`extractPose()` 记录选中分组（`origin`+`rotation`）或复调用标签（`position`+`rotation`）；`applyPose()` 套用到所有选中同类元素，分组连同子树按 `translateGroupCoordinates` 平移，枢轴落到同一位置，可撤销。

**5) 引用模型支持资源管理器选择**

- 分组属性新增 `imda_model_file`（Blockbench `type: 'file'` 表单字段，已确认 `FormElement.types.file` 存在），支持拖放。
- 选中后按路径自动解析：`assets/<ns>/models/…` → `<ns>:<路径>`；`assets/<ns>/items/…` → `<ns>:items/<路径>`。
- 另有独立菜单项「选择引用模型 / 物品映射文件…」（`Blockbench.import`），选完立刻读入并写缓存。

**测试**：单测 268 项（新增 16 项：映射引用解析、路径→引用、位姿提取/应用、更新所有调用统计）。真机验证（`_bbcdp.js`）：
导出 `refModel`（`imda_model = test:items/probe` + 预置项目缓存）→
`{"type":"minecraft:composite","node_name":"refModel","transformation":{…},"models":[{"type":"minecraft:composite","models":[{"type":"minecraft:model","model":"test:item/probe_part"}]}]}`。
### 0.0.7 0.69.4（右键菜单顺序 / 模拟面板固定控制条 / 嵌套分支视图联动）

1. **右键菜单**：`imda_menu_props`（编辑分组映射属性）移到最末：结构动作 → 位姿 → 枢轴 → 属性。
2. **模拟输入面板**：`root` 改 `overflow:hidden` flex 列，内部拆成 **固定 controlRow（运行/停止、刷新、视图模式、状态）+ 可滚动 scrollBody（输入行 + 结果）**。之前控制条在滚动流里，必须滚到底才能点停止。
3. **视图联动（半透明 / 完全隐藏）修复**（两个根因）：
   - 只处理**直属**子级：原 `simApplyGroupVisual` 只对 `group.children` 的 cube 调 `simGhostCube`、只隐藏分组自身 mesh。`sac_slots` 这种「分支 → 内层 inline 分组 → 方块」的结构完全不受影响。现新增 `simEachCubeDeep` / `simEachGroupDeep` 递归处理全部后代，`simRestoreGroup` 同样递归恢复。
   - 只处理「映射里有节点」的分支：`simViewEntries` 原来只遍历 `sim.groupNodes`，空分支永远不参与。现额外枚举 `range_dispatch` / `condition` / `select` 容器的**每个直属子分组**，命中判定 = 该分支自身或任意后代有命中节点。
4. 单测 274 项（+6：空分支纳入、嵌套方块半透明、嵌套分组隐藏/恢复）。

**真机验证（0.69.4）**：`vSlots`(range) → `slot0`(平铺) / `slot1`(内嵌 `slot1_inner`)，值 0 时 `slot0` 可见、`slot1` 与 `slot1_inner` 均 `visible=false`；菜单 ids 末尾为 `imda_menu_props`；面板 root 子节点为 [controlRow, scrollBody]。
### 0.0.9 视图联动：「不处理」残留洋葱皮 + 锁（0.69.12 / 0.69.13，2026-10-31）

**用户报告**：「选项【不活跃分支】的值为【不处理】时，还是洋葱皮+锁定」。

**三个根因（都在 0.69.13 修）**：

1. **恢复清单活不过重载**。`simRestoreView()` 只遍历 `sim.viewTouched`（内存 Set）。插件重载后 Set 清空，但 `mesh.__immGhost` / `mesh.__immHidden` / `node.__immLock` 这些**标记在对象上**，于是「不处理」= 没人去恢复。
   → 恢复改为三段：① 按清单 `simRestoreGroup` ② **全量扫大纲**清 `__immGhost` / `__immHidden` ③ `simUnlockAll()`。
2. **锁定基线随 `sim` 对象丢失**。原来存 `group.__immLock = saved`，重载后基线和 `sim` 一起没了，`locked = true` 却留着 → 永久锁死（实测残留 29 组 / 66 方块）。
   → 基线搬到 **`globalThis.__immLockStore`**（`Map<uuid|type, [[node, locked]...]>`），跨重载存活；`simLockGroup(on)` 会先查祖先避免把“已锁”当原始态。
3. **非锁定模式只解锁 `seen` 里的分组**。→ 额外 `simUnlockAll()` 兜底。

**真机验证（0.69.13）**：`ghost_lock` → 45 组锁 / 70 方块锁 / 50 半透明 / store=5；切 `off` → 全部归 0；重载插件后 `store` 仍是 5，再切 `off` 仍能全清。旧版本留下的 96 个孤立锁已用只读探针清掉（`Project.saved` 保持 `false`）。

单测 289 项（+6）。

### 0.0.23 复调用标签右键菜单在重载后只剩通用项（0.73.3，2026-11-06）

**现象**（用户报告）：右键复调用标签，菜单里插件动作（实例化/编辑/提取变换/应用变换）全没了，只剩复制/重命名/删除等通用项。

**根因**：`CallTag` 是自定义元素类型（`OutlinerElement.registerType`）。每次重载插件，`onunload` 把 `CallTag=null` 并删掉类型注册，`onload` 的 `ensureCallTagType()` 会 `registerType` 一个**新类**；但大纲里已经存在的复调用标签节点仍属于**上一次的旧类**（`inst instanceof 当前CallTag === false`），它们的 `prototype.menu` 是当年克隆出来的**独立 Menu 对象**。旧 `attachGroupMenu` 只给「当前 CallTag 原型 + Locator 原型」挂 4 个插件动作，识别不到这些旧类节点用的 Menu → 右键只剩通用项。新建的标签（当前类）则正常——所以单看新建节点会以为没 bug。

**修复**（`attachGroupMenu`）：
- 收集三处去重的 Menu 对象：`Locator.prototype.menu`、当前 `CallTag.prototype.menu`、以及遍历 `Outliner.root` 里**每个 `isCallLike(node)` 的 `node.menu`**（覆盖旧类节点），逐一 `attachCallMenu`。
- `attachCallMenu(menu, key, label)`：用 `menu.__imdaCallAttached` 幂等（`update_selection` 高频触发不重复叠加）；`menuActions` 键改用自增 `menuActionSeq`，避免旧类与当前类菜单共用键互相覆盖/误删。
- `onunload`：清理范围扩大到「各原型 Menu + 每个复调用标签节点的 `node.menu`」，过滤 `imda_*` 并 `delete menu.__imdaCallAttached`，`menuActionSeq=0`。

**真机验证**：`_probe_ctxmenu*.js`（不碰用户工程，只读现有节点）——重载前旧节点菜单 12 项（无插件动作）；重载后 17 项（4 个插件动作齐全）；`update_selection×5` 后仍 17 项、渲染 `实例化/编辑/应用` 各 1 次无重复；二次重载仍 17 项。

### 0.0.22 「编辑分组映射属性」Ctrl+Z 撤不干净（0.73.1，2026-11-06）

**现象**（用户报告）：改完分组映射属性，Ctrl+Z 好像撤不掉。

**排查**（解 app.asar 的 sourcemap 看 Blockbench 5.2.2 源码）：
- 右侧原生「属性」面板（`js/outliner/element_panel.ts`）只登记 `property.inputs.element_panel` 存在的属性。插件的 `imda_*` 都是 `new Property(..., {exposed:true})`，没有 `inputs`，所以**根本不出现在原生面板**——“属性编辑”只能走插件自己的「编辑分组映射属性…」对话框。
- 该对话框本来就有 `Undo.initEdit/finishEdit`，主属性（imda_type/model/property…）实测能撤销（真机 detached 往返：改→undo→回退→redo→再改）。
- 真正的问题：撤销用 `{ groups: targets }`，`getChildlessCopy` **不含子节点**。而改类型时 `syncBranchLabels` 给子分支加 `[n]` 前缀、`sortBranchChildren` 重排子节点——这些不在撤销记录里。撤销后父属性回去了、子分支名字/顺序还在 → 看起来“撤不掉”。
- 真机探针（`_probe_props_undo2.js`）确认：旧 aspects 下 `before.groups` 只有 `[P]`；修复后 `before.groups = [P3, b1, b2]`（旧名）、`before.outliner` 存在、`post = [P3, [0] b1, [1] b2]`。

**修复**（`editGroupProps` 的 `applyChanges`）：
```js
const affected = [];  // 目标分组 + 整棵子树 + 父分组
for (const t of targets) {
  for (const g of collectGroupSubtree(t)) addAffected(g);
  if (t.parent && isGroup(t.parent)) addAffected(t.parent);
}
const affectedCubes = [...];  // 子树里方块的 faces[].tint 会被 walkTint 改
Undo.initEdit({ outliner: true, groups: affected, elements: affectedCubes });
...
Undo.finishEdit('修改分组映射属性', { outliner: true, groups: affected, elements: affectedCubes });
```
- `outliner` 还原结构/顺序；`groups`（含子节点）还原名字/自定义属性；`elements` 还原方块着色。
- catch 里加 `Undo.cancelEdit()`，防止异常留下半截 `current_save` 让后续 Ctrl+Z 全失效。

**备注**：真机 detached 探针里 `Undo.undo()` 会抛 `Cannot read properties of undefined (reading 'position')`——来自 `Format.bone_rig` 分支对“没有 mesh 的脱离分组”调 `preview_controller.updateTransform`，是脱离测试树的假象；真实在 Outliner 里、有 mesh 的分组不会。因此验证改用“检查撤销快照 before/post + extend 还原”的方式。

### 0.0.21 range_dispatch 分支编号格式新增变量 `n`（0.73.0，2026-11-06）

**需求**：分支编号格式要能引用"本分支在上层节点里的编号" `n`。例：外层 `slots` 用格式 `i`，第 6 个分支就是 `slots[5]`；它自己的格式写 `ni`，则它的子分支阈值是 `0,5,10`（= n × i，n=5）。

**实现**：
- `evalThreshold(format, index, n)` 加第三参 `n`。表达式转换里新增两条隐式乘法：`(\d)n → $1*n`，配合原有 `i → *i`，`ni` 会变成 `n*i`。`new Function('i','n', …)` 同时注入两个变量。**（0.73.2 起 `n` 缺省为 1，见该条；最初是 0。）**
- `Exporter.buildNode(group, hint, parent_shift, selfNumber)` 新增 `selfNumber` = 本分组在上层节点里的编号。
  - `range_dispatch` 分支循环**调整了顺序**：先算 `threshold`（`evalThreshold(本组 format, branch_index, selfNumber)`），再把 `threshold` 作为第四参传给子分支的 `buildNode`。这样嵌套时子分支自己的 `n` 就是它被父级算出来的阈值，**不依赖 sync 是否跑过**。
  - `childFormatted`（父级没写格式时的旧回退）**不传 n**（用子自己的格式算子自己被父级取的阈值，n 在这里是循环的，交给缺省）。
- `syncBranchLabels(group)` 刷新子分支名字/阈值时，用 `branchSelfNumber(group)` 当 `n`：仅当分组确实挂在 `range_dispatch` 下才取其 `imda_threshold`，否则返回 undefined（evalThreshold 按缺省 1）。

**测试**：
- `_test_threshold_n.js`（0.73.2 起 17 项）：`evalThreshold` 的 `ni`/`n`/`2n`/`n+i`/`n*i`/缺省=1/显式 0/旧格式不回归；导出级：嵌套 `ni`(n=5)=0,5,10、顶层 `ni`(n 缺省)=0,1,2。
- 真机探针 `_probe_threshold_n_live.js`：`api.createExporter().evalThreshold` + 在"脱离 Outliner 的 empty 叶子树"上直接 `buildNode`，不碰用户工程。
- 单测合计 497 项（0.73.2）。

### 0.0.20 重新设计「将分组转化为复调用标签」（0.72.0，2026-11-06）

**现象**（用户报告）：`将分组转化为复调用标签` 的结果和"复调用标签"一样，等于没有转化。

**根因**：旧 `convertSelectedGroupsToCallTags()` 给每个选中分组 G 建一个调用标签，位置/旋转取 G 的 `origin`/`rotation`、`imda_call_target = G.uuid`，**再设 `G.export = false`**。而 `复调用选中的分组`（`callSelectedGroup`）建的是**完全相同**的标签（同样指向 G 自己），唯一差别就是多了 `export=false`。所以导出后净效果不变（几何通过调用又回来了），产出节点看起来就是"一个普通的复调用标签"。

**新语义**（用户确认的三点）：
1. 删除 G，原位替换为调用标签；
2. 位置锚点取 **G 自身的 `origin`**，旋转取 G 的 `rotation`（只换目标）；
3. 一个弹窗选一个已存在的目标分组 T，批量全部指向它。

**实现要点**（`convertSelectedGroupsToCallTags()` + 纯逻辑 `applyConvertGroupsToCallTags(groups, targetGroup)`）：
- 只处理**最外层**选中分组（`outermostSelectedGroups`）：父子都选中时子分组随祖先一并删，不再单独建标签。
- 删除集合 = 最外层选中分组 + 它们的所有后代（`collectGroupSubtree`）；**候选目标**从 `collectAllGroups()` 里排除删除集合（否则可能选中一个会被连带删掉的分组）。
- 原位替换：`at = siblings.indexOf(group)` → `addAndInit(locator, parent)` → 把标签 splice 回 `at` → `group.remove()`。siblings 在根级时就是 `Outliner.root`，在嵌套时是 `parent.children`。
- **关键真机陷阱**：`CallTag.init()` 有一段"根级标签会被塞进 `Group.first_selected`"的行为（`if (this.parent == Outliner.ROOT && Group.first_selected) this.addTo(Group.first_selected)`）。转换时 `Group.first_selected` 往往正是我们要删的那个分组，标签会被挪进它、随后 `group.remove()` 把标签一起删掉。代码里在 `addAndInit` 后检测 `wantRoot !== isRoot`，若被重挂就 `locator.addTo(parent)` 强制拉回。
- 撤销：`Undo.initEdit({ outliner: true, groups, elements: [] })` → 转换 → `Undo.finishEdit('将分组转换为复调用标签', { outliner: true, groups, elements: locators })`。

**测试**：
- `_test_convert.js`（25 项，mock 复刻 `CallTag.init` 的 `Group.first_selected` 重挂副作用）：根级与嵌套原位替换、兄弟顺序、位姿拷贝、目标、最外层过滤、候选排除待删子树、无目标不动手。
- 真机探针 `_probe_convert_live.js`：用**真实 Blockbench CallTag 类**在"脱离 Outliner 的分组树"上跑（不 `addTo` 根、绝不碰用户真实工程），12/12 通过，并断言 `Outliner.root.length` 前后不变。
- 单测合计：25 + 76 + 350 + 29 = **480 项**。

### 0.0.19 「生成全物品模型表」把分支跑成根级节点（0.71.1，2026-11-05）

**现象**（用户报告）：除了 `[all items]` 容器内的节点，大纲最上层还有很多和它们重复的引用节点。

**根因**：`new Group()` 的 `parent` 默认就是 `'root'`。第一版只写了 `container.children.push(caseGroup)`，**没有把 `parent` 改成 `container`**。紧接着对话框里对 `built.created` 逐个调 `caseGroup.init()`，而真实 Blockbench 的 `OutlinerNode.init()`（bundle 里 `init(): this { OutlinerNode.uuids[this.uuid] = this; if (!this.parent || (this.parent === 'root' && Outliner.root.indexOf(this) === -1)) { this.addTo('root') } return this }`）看到 `parent === 'root'` 且不在 `Outliner.root` 里，就自己 `addTo('root')` —— 于是每个 case 同时在容器 children 和根目录里。

**改法**：
```js
// 建树时（buildAllItemsTree 内）
caseGroup.addTo(container);   // 而不是 container.children.push(caseGroup)
// 挂载时（openAllItemsDialog → onConfirm）
addAndInit(built.container, null);              // 容器先进大纲
for (const node of built.created) {             // 再 init 子节点
    if (node === built.container) continue;
    node.init();                                 // 此时 parent 已指向容器，不会再 addTo('root')
}
```

**为什么原来的测试没抓到**：`_test_all_items.js` 的 mock 有两处失真 ——
1. `addTo(p)` 把 `'root'` 当普通父对象处理（真实实现把字符串 `'root'` 当根），传 `'root'` 会抛错或走错分支；
2. `init()` 直接 `return this`，**没有复刻上面那段 `addTo('root')` 副作用**。

两处都补齐后，回归脚本能明确区分：旧方式 5 个 case 跑到根目录（根节点 6 个），新方式只有容器 1 个（根节点 1 个）。

**真机验证**（真实资源包 134 个分支）：`Outliner.root.length === 1`、根节点只有 `[real all]`、混进根目录的 case 数 0、`parent` 不指向容器的 case 数 0、导出 319KB JSON 可解析。

**教训**：`new Group()` / `new Locator()` 的 `parent` 默认是 `'root'`。任何"把新节点塞进某个父级"的地方，都要用 `addTo(parent)` 而不是只 `children.push()`，否则后面对它调 `init()` 就会把它顶到根目录。全插件 `children.push` 只有两处（`sortBranchChildren` 重排已有子节点、`collectInputUsage` 的纯数据对象），都不新建节点，安全。

**已有工程的修复**：新增 Tools →「清理大纲重复节点」（`repairOutlinerDuplicates()`）。判据是"同一个对象既在某个分组的 `children` 里、又在 `Outliner.root` 里" —— 这种状态只可能是 bug 造成的，删掉根目录那份、保留容器里的原件。删容器再重新生成也可以（`Group.remove()` 会连带删子节点），但那样会丢掉对表的手工改动。生成表时也会先自动清一次，避免出现两套。

### 0.0.18 生成全物品模型表（0.71.0，2026-11-01）

**需求**：把资源包全部 `assets/*/models/*` 与 `assets/*/items/*` 导成一张 select 表，`when` 同时含无类型路径（`sqsp:inker/jet_rifle/gun`）与带类型路径（`sqsp:models/inker/jet_rifle/gun`），任一种匹配即可选中。

**实现**：
- `scanPackEntries(options)` → 一次递归遍历 `assets/**/*.json`（相对 **root** 的路径，形如 `assets/<ns>/<folder>/…`，正则才能匹配到 `assets/` 前缀 —— 第一版把相对基准写成了 `assets` 目录，结果恒为空）。按 `models` / `items` 分流，应用黑名单，再做「映射优先」合并。
- `buildAllItemsTree(options)` → 生成 `select` 容器 + 每个路径一个 `model` 分支。
- `primeMappingCache(entries)` → 生成前把映射定义批量读进 `imda_mapping_cache`。**关键**：导出走 `loadMappingDefinition({readOnly:true})`，只读缓存不碰文件系统（导出路径不能弹权限框）。不预读的话，`ns:items/…` 引用会退化成 `minecraft:model` + `"model": "ns:items/…"` —— 原版 `model` 字段只能指向 `models/`，非法，整条分支失效。
- property 两种模式：`custom_model_data`（`index` + 字符串 when）/ `component`（`component: "minecraft:custom_data"` + `{id:...}` 对象 when）。

**实测（真实资源包 `Squilker Sparkle Res`，138 个 json）**：扫描 138 → 生成 135 个分支 → 导出 108KB JSON 可解析；里面 115 个 `minecraft:model`（纯模型）、19 个 `minecraft:composite`（映射已内联）、**0 个非法 items 引用**。

**顺带修掉的三个真问题**：
1. `parseMappingReference` 用 `[^\s]+` 匹配路径 → **带空格的文件名**（`jet_rifle copy.json`）被判非法，导出退化成非法引用。改成允许空格。
2. 没有 `model` 字段的"假映射"（整份模型内容塞在 `items/` 里）会被导出成非法引用 → 现在预读阶段就识别并**跳过**，报告里说明原因。
3. `select` 的 `when` 为空时原版会当成永不命中 → 跳过并告警；`parseWhen` 增加对象字面量支持（component 模式必需）。

**测试**：`_test_all_items.js` 用**真实的临时目录树**当资源包（不是 mock fs），这样递归扫描、黑名单正则、映射优先、空格路径、无 model 字段跳过都是真跑出来的。63 项。

### 0.0.16 导出的映射文件从来没被验证过（0.70.1，2026-10-31）

**用户提问**：「你有没有测试过导出的物品模型映射文件是否正常？」

**诚实回答：没有。** 0.1–0.70.0 期间 350 条断言全部只验证「内存里的映射对象结构对不对」，没有一条把文件**写到磁盘**再读回来校验。而 `formatMapping` / `formatModel` 是**手写拼字符串**的格式化器（不是 `JSON.stringify`），语法错只有落盘 + `JSON.parse` 能发现。这是测试体系的真实缺口，不是小事。

补上 `_test_export.js`（29 项），当场抓到两个真 bug：

**Bug 1：range_dispatch 的 property 漏了 `minecraft:` 前缀**

0.69.14 我把 `imda_property` 改成存裸名（属性面板选项值），但 `buildNode` 里那行是：

```js
node.property = String(group.imda_property || 'minecraft:custom_model_data');
```

只有**字段为空**时才走默认值（带前缀），非空时把 `"property": "custom_model_data"` 原样写进文件。原版只认 `minecraft:` 命名空间 ID，这个值不认识 → **整条 range_dispatch 失效**。
→ 改成 `'minecraft:' + String(...).replace(/^minecraft:/,'').trim()`。

**Bug 2：entries 阈值顺序与大纲顺序相反**

Minecraft Wiki 原文（Items model definition § range_dispatch）：

> Will select last entry with threshold less or equal to property value.

也就是**判定顺序 = entries 数组顺序**，取「最后一个 threshold ≤ 当前值的条目」。分支编号格式 `5-i` 配上大纲里的 `[5][4][3][2][1]`，算出阈值 5,4,3,2,1 —— 原样输出时，任何值的「所有 threshold 都 ≤ 它」都会成立，于是**永远命中列表末尾那条**（threshold=1 的分支）。你工程里的 `sac_slots` 正是这个结构，5 个档位全部导错。
→ 导出时对 `node.entries` 按阈值**升序稳定排序**（同值保持大纲顺序）。

**`node_name` 的定性**：这是**用户明确要求**的字段 —— 导出时带上来源分组名，方便人工复核 JSON 时对上是哪个分组。原版解码器忽略未知字段，不影响加载。项目设置里可关（`imda_export_node_names`，默认开），`_test_export.js` 的字段白名单对它单独放行、只统计数量，不算问题。

**测试覆盖（`_test_export.js`）**：

1. 落盘后逐个 `JSON.parse`（覆盖格式化器语法）；
2. 定义树逐字段校验：类型白名单、每类允许的字段、`transformation` 四分量 + 四元数归一化 + `scale` 无 0、`model` 引用格式、`range_dispatch` 阈值严格升序、`select.when` 必须是数组、`condition` 两侧齐全；
3. 物品模型文件：`from`/`to`/`faces`/`display` 数值分量；
4. **纹理引用与实际导出文件对账**（引用了却没人提供就报错）；
5. 路径命名规范 + 重复检测；
6. **真实工程回归**：读 `assembly.bbmodel` 备份 → 完整导出 → 全部校验（只读，不写回）。

> 注意 `_unlz.js` 依赖 `app.asar` 里 lz-string 模块的位置（`var ci;` … `var Lw=ci;`），Blockbench 升级后可能失效 —— 那时第 6 项会打印「跳过」而不是失败。

### 0.0.17 模拟面板「步进」按钮（0.70.1）

`simAdvanceSlot(item)` 从「运行」循环里抽出来，成为唯一推进规则；`simStepOnce()` 对它循环调用后 `simTick()` + `simApplyTints()`。**不启动循环、不改运行状态**，只在没有勾选任何自动槽时给一条提示。按钮名「⏭ 步进」，在「▶ 运行」右边。

### 0.0.15 独立元素类型「复调用标签」+ Shift 跨层连选（0.70.0，2026-10-31）

**用户可以要求**：「加一个单独的『复调用标签』元素，并且使用 Shift+鼠标左键选择的时候可以直接选中」。现象：1~5 分组 + 6 标签，点 6 再 Shift 点 1，只选中 6 和 1，得再点 5 才能带上中间。

**1. 新元素类型（`imda_call_tag`）**

- 官方 API：`OutlinerElement.registerType(Ctor, id)`（见 [参考文档](https://web.blockbench.net/docs/classes/generated_outliner_abstract_outliner_element.OutlinerElement.html)）。它会补 `types[id]`、`prototype.type`、`behavior`、`name`/`export`/`locked`/`scope` 四个 Property、`Ctor.all`/`Ctor.selected` getter，并派发 `register_element_type` 事件。
- **没提供的部分必须自己写**：`NodePreviewController`（否则没有 mesh，画布上不可见）、`prototype.title/icon/buttons/menu`、Property 面板输入。
- 实现选择：**继承 `Locator`**。原因：Locator 已经有 position/rotation/visibility/locked 属性、精灵标记渲染、以及 `Format.locators` 下的保存/加载链路；继承后 `instanceof Locator` 仍成立，插件里 30 多处复调用代码零改动。
- **「添加元素」菜单插不进去**：Blockbench 的 `add_element` Action 里 `side_menu` 是写死的 id 数组（`add_mesh` / `add_cube` / `add_locator` / …），没有注册式扩展点。所以插件自己出一个 Tools 菜单项「添加复调用标签」（`addEmptyCallTag()`）。
- `ensureCallTagType()` 里做完整注册；`unique_name: false`（同一目标被多分支反复调用，重名是常态）；`name_regex` 放宽以支持中文名（默认净化规则会抹掉「调用」两个字）。
- 创建入口统一走 `newCallTag()`；`upgradeLegacyCallTags()` 把旧 Locator 标签换成新类型（保留 uuid / 位姿 / 覆盖，可撤销），对应 Tools 菜单「把旧复调用标签升级为独立元素…」。
- `.bbmodel` 风险已知：新类型写进工程后，**旧版 Blockbench（没有该插件的）会把这类节点静默丢掉**（`fromSave` 走 `OutlinerElement.types[obj.type]`，找不到就 `|| Cube` 兜底/跳过）。测试版不存在跨版本协作，接受。

**2. Shift 跨层连选**

- 根因（读 bundle 源码确认）：原生 `Group#select` 的 Shift 分支用 `this.getParentArray().forEach(...)`，**只在同一父级的兄弟数组里跑**；而且分组比的是 `Group.multi_selected.last()`、元素（`OutlinerElement#select`）比的是 `Outliner.selected.last()` —— 两条独立记忆。先点标签再点分组时两个 last 对不上 → 条件不成立 → 退化成普通加选（就是用户看到的「只选中 6 和 1」）。
- 补丁 `installOutlinerRangeSelect()`：接管 `Group#clickSelect` 与 `OutlinerElement#clickSelect`。
  - 锚点由插件自己记（`outlinerRangeSelect.anchor`），单选时重置、连选时保留。
  - `outlinerFlatOrder()` 把大纲展平成先序表，`outlinerRangeSelectTo(target)` 取闭区间，区间内分组递归选中（`multiSelect()` + 子项 `markAsSelected`）、元素 `markAsSelected`。
  - **只在跨父级或区间含复调用标签时接管**，同父级且无标签交给原生（原生行为本身是对的）。
  - `onunload` 用存下来的 `__imdaOriginal` 恢复原方法。

单测 350 项（+32）。

**用户报告**：「生成复调用序列的 property 好像没有在创建时成功应用。阈值的格式参考属性设置里的就行。」

- **根因**：`generateCallSequence` 把 `container.imda_property` 写成 `'minecraft:custom_model_data'`（**带前缀**），而分组属性面板的 select 选项值是**裸名**（`custom_model_data`）。面板认不出这个值 → 回落到「（未设置）」，看起来就是“没应用”；同时 `compass` / `count` / `damage` 这些条件字段的 `condition` 全部不成立，相关输入框直接不显示。导出端 `buildNode` 自己会补前缀，所以裸名才是唯一正确存法。
- **修法**：序列生成时 `String(options.property).replace(/^minecraft:/,'')` 后存裸名。
- **阈值格式**：对话框新增「分支编号格式（同属性面板）」输入框，直接复用 `Exporter.evalThreshold()`（`sequenceFormatValue()` 包一层），支持 `i` / `2i` / `10+2i` / `0,1,3` / `2:2i`，与属性面板定义完全一致；填了就优先于旧的「起点 + i × 步长」（两者都保留，格式留空才用起点/步长）。格式同时写进容器的 `imda_threshold_format`，创建后面板显示与导出一致。

### 0.0.14 洋葱皮：位姿对齐时直接点亮源节点（0.69.14）

**用户规则**：「如果引用的源节点和自身的枢轴点位姿变换完全相同，就直接临时点亮源节点，优先级高于模拟输入未命中时的隐藏。如果不一样，则可以临时实例化并标记，在熄灭时转化回复调用标签。」

- 新增 `simPoseIsSame(locator, target)`：比较 `locator.position` 与 `target.origin`、`locator.rotation` 与 `target.rotation`，容差 `1e-4`。
- 新增 `simLightUpCallTargets(state, mark)`，在 `simViewEntries()` 末尾调用（第 3 步）：
  - 遍历大纲里的复调用 Locator，先确认它**自己所在分支被选中**（向上找第一个出现在 `state` 里的祖先，必须为 `active === true`），否则熄灭状态不点亮；
  - 位姿相同 → 把目标分组 `mark(target, true)`。`mark` 是 **OR 合并**，所以天然压过“模拟输入未命中得到的 inactive”；
  - 位姿不同 → `simEnsureCallInstance()` **临时实例化**一份：`target.duplicate()` 复制、`translateGroupCoordinates()` 摆到标签位姿、设 `__immTempCall` 标记 + `export=false`（**绝不进导出**）、`addTo` 到标签父级；副本同样 `mark(copy, true)`。
  - 结果存进 `sim.lastLights = { lit, mismatched }`。
- **熄灭 = 转回复调用标签**：`simDropCallInstance()` 先 `simRestoreGroup()` 再 `remove()`；登记表 `simTempCalls`（`locator.uuid → {locator, group}`）里的每个副本在「本轮不再需要」时立刻收掉。`simRestoreView()` 新增第 4 段 `simDropAllCallInstances()`，全量兜底（含插件重载后登记表丢了、只剩 `__immTempCall` 标记的残留）。
- **只 mark 目标分组本身，不 deep**：目标内部的分支该不该亮仍由它自己那轮 trace 决定，deep 会把目标里未选中的子分支也强行点亮，洋葱皮就没了。

**真机数据（`assembly.bbmodel` 备份解析）**：`[4] sac_slots #4` 的 4 个标签、`[3]` 的 3 个、`[2]` 的 2 个、`[1]` 的 1 个，**全部位姿相同**（`调用 sacpack1` ↔ `sacpack1` 等，位置/旋转逐轴误差 < 1e-6），所以现网这段结构全走“点亮源节点”路径，不需要实例化；临时实例化是给将来的错位数据兜底的。

单测 318 项（+29）。

### 0.0.10 视图联动：多级分支（0.69.12）

`sac_slots` 结构：`[5]` 里放着 `sacpack1` + `调用 sacpack2..5`（各有 `[0] _empty` / `[n] _full`）；`[4]`..`[1]` 里**只有复调用 Locator**，模型物理上都在 `[5]`。

修的四点：
1. `simEvaluate` 每条 item 带完整 `branches` 链（每层记“选了哪一支”）；旧实现只保留最内层 `branch`，外层 `range_dispatch` 一包装就把内层覆盖掉。
2. 空分支（只有 Locator、不产出 item）活性靠 `trace.seen/selected`——求值时直接记录容器选了哪支；靠“有没有命中节点”永远猜不出来。
3. 分支内容 = 自身 + 直属子分组 + 直属 Locator 指向的目标分组（`[4]`..`[1]` 必须顺着标签找）。
4. `uuid → 分组` 优先从**大纲真实树**建索引：`Group.all` 里残留过同名同 uuid 的旧副本（没有几何），解析到它们等于没做。

**实测（ghost）**：`floats[0]=4` 时 `sacpack1` 变实心、`调用 sacpack5` 的 `[5] _full2` 变半透明；`=5` 时全反过来。空分支 `[4]`/`[3]`/`[1]` 活性随值正确切换。

**遗留设计问题（等用户拍板）**：`[4]`..`[1]` 没有自己的几何，洋葱皮只能靠“顺着标签找目标”近似；若要漂亮的“弹匣栈从 full 到 empty”，可能需要把 `[4]`..`[1]` 改成内含实体，或改由内层 `[0]`/`[n]` 判定（联动作用域模型改动）。

### 0.0.11 模拟面板复选框语义 + 步长 0（0.69.7 → 0.69.11，2026-10-31）

**用户诉求（原话）**：「我不希望模拟输入改值的时候自动打开循环」；「复选框不勾的时候，值也应当存在」。

**最终语义（0.69.11）**：

| 控件 | 作用 | 不影响 |
| --- | --- | --- |
| 大类复选框（`row.enabled`） | 这一类要不要跟着「▶ 运行」自动变化 | 值是否存在、是否参与求值 |
| 槽复选框（`slot.enabled`） | 这一个槽要不要自动变化；取消后槽名标「（不自动）」 | 值是否存在（原样保留）、是否参与求值 |

改动点：

1. `simTick()`：删掉 `if (!slot.enabled) continue;`——**所有槽的手动值都写进 `inputs`**。角标同理，不再跳过未勾选的槽。
2. `ensureEnabled()` 整个删除。改值/改索引不再自动勾上大类或槽复选框，也不会 `setInterval`。
3. `readSlot()`：`slot.step = Number(step.value) || 0.5` → 只有留空/非法才回退 0.5，**步长 0 保留 0**（原来 0 被当假值，所以「设 0 无效」）。`openSimulator()` 里 `num(result.step) || 0.5` 同样修正。
4. `refreshSlotState()`：不再把整个槽降到 `.5` 透明度（会让人以为“禁用了”），只改槽名文字。
5. `slot.els` 增加只读镜像 `slotValue` / `slotStep` / `slotIndex`，方便 CDP 探针与单测断言“存下来的值”。

**真机验证（0.69.11，CDP `--eval-file`）**：
- 两复选框全不勾 + 改值为 5 → `slotValue="5"`、`val.value="5"`、`inputs.floats[0]=5`；`running=false`。
- 勾上/取消大类或槽 → `slotValue` 与输入框始终 `"5"`；槽取消后 label=`槽 1（不自动）`、opacity=`1`。
- 步长 `0` → `slotStep=0`；留空 → `0.5`；`0.25` → `0.25`。
- 步长 0 + 运行 1.2s → 值恒为 `3`（不动），计时器确实在跑；步长 0.5 → 值从 `0` 变到 `1`。
- 全程 `Project.saved === false`（未保存工程）。

单测 283 项（新增 9 项）。
### 0.0.12 测试纪律（2026-10-30 事故）

**事故**：为清理模拟测试用的临时分组，脚本执行了 `for (node of Outliner.root) node.remove()` + `Outliner.root.length = 0`，而当时用户正开着 `assembly.bbmodel`，**把用户工程的内存态清空**（`cubes` 85 → 0）。磁盘文件未损坏（最后写入 22:42，事故在 23:0x），通过 `Codecs.project.load` 从磁盘重载恢复（85 方块 / 61 分组 / 12 根节点）。

**规则（已写入 AGENTS.md §6）**：
1. 测试结束**绝不保存工程文件**，绝不在用户工程上写盘。
2. **绝不整体清空 `Outliner.root`**；清理只按名字白名单删自己创建的节点（`simRoot` / `vRoot` / `probe*` / `branch*`）。
3. 测试优先在 `setupProject` 新建的空工程或临时 `.bbmodel` 里做。
4. 必须在用户工程上验证时，只做只读检查；改了要 `Undo` 回原状。
5. 只重载插件（`_bbcdp.js --reload-plugin`），不重启 Blockbench。
### 0.0 0.68.113 本次改动

1. `instantiateCallTags` 的撤销 aspects 改为：
   - init：`{ outliner: true, groups: 父分组去重, elements: 待删除 Locator }`
   - finish：`{ outliner: true, groups: 父分组 + 全部新建分组（含嵌套）, elements: 新建/复制的所有非分组节点 }`
   - 不再把 Locator 同时放进 init 和 finish。
2. 修正 `duplicate()` 后重复 `created.init()` 的问题；重复 init 会把同一 Group 两次 push 进 `Project.groups`。
3. 覆盖改为在节点加入父分组、完成 init 之后应用；`property` 统一去 `minecraft:` 前缀；支持 `ignore_default`；`threshold`（包括 0）标记 `imda_threshold_force`。
4. `range_dispatch` 导出优先使用子分支自己的 `imda_threshold_format`；`threshold_force` 优先于父级 `threshold_format`。
5. 右键“实例化同组复调用标签”：收集同一父分组下的兄弟标签；按解析后的字段数判断空覆盖（`"{}"` 不再算覆盖），没有单独覆盖的兄弟继承右键标签的覆盖。
6. 实例化每个副本后调用 `syncBranchLabels()`，刷新该副本自己的分支名。
7. `syncBranchLabels()` 格式生效时把 threshold 数值写回子节点，属性和分支名一致。
9. 序列选择修复：`orderedSequenceItems()` 同时读取 `Group.multi_selected` / `Group.selected` / `Group.first_selected`，只选分组也能生成序列。
10. 选择分支不再触发 `scheduleBranchSync`：移除 `update_selection`，并且不再绑定 outliner 的 `mouseup` / `dragend`；仅在 add/remove group 时同步。
11. `sortBranchChildren()` 在父分组有 `imda_threshold_format`（如 `5-i`）时跳过；选择/拖拽不再触发同步，只在 add/remove group 时同步。
12. `sortBranchChildren()` 每次调用输出 parent/type/format/order；`scheduleBranchSync()` 输出触发原因及同步前后顺序；实际重排输出 before/after 的 name/threshold/key。
13. 单测总数 231。

**仍待确认**：真实 Blockbench 中 Ctrl+Z 是否能完整撤回；若仍失败，优先检查 Console 的 `[装配] 实例化 initEdit 失败` / `finishEdit 失败`，以及 `Project.undo.history` 是否新增了「实例化复调用标签」。

### 0.1 用户目标

1. 选中复调用 Locator 后执行「实例化」，生成真实分组/模型节点。
2. 实例化完成后按一次 Ctrl+Z，必须完整恢复：
   - 删除所有新生成的分组和方块；
   - 恢复被删除的 Locator；
   - 恢复 Locator 的 `imda_call_target` 和 `imda_call_overrides`；
   - 恢复 outliner 顺序和选择状态。
3. 实例化时把每个 Locator 自己的 `imda_call_overrides` 应用到对应副本，不能只对第一个生效。

### 0.2 用户实际反馈

- 0.68.85：能实例化，但 Ctrl+Z 没有反应；覆盖没有生效。
- 0.68.86–0.68.98：反复修改 `Undo` aspects、UUID、兜底历史、threshold 强制标记，用户仍反馈“可以实例化，但撤销完全没响应，覆盖也没有”；最后按要求回退。
- 关键事实：不是“只撤销失败”，而是 **Ctrl+Z 完全没有响应**；说明 Undo 历史可能没有写入，或写入后 `current_save`/history 被污染。

### 0.3 0.68.85 当前实现与已确认的问题

文件 `item_model_definition_assembly.js`，函数 `instantiateCallTags` 约 2800–2868 行。

已确认/高概率的缺陷：

1. **init/finish aspects 不平衡**
   - init：`Undo.initEdit({ outliner: true, elements: locators.slice() })`
   - finish：`Undo.finishEdit('实例化复调用标签', { outliner: true, groups: createdGroups, elements: createdCubes.concat(locators) })`
   - Locator 同时出现在 init 和 finish 的 `elements`，不符合 Blockbench 的 aspect 约定：删除对象应只在 init，新增对象应只在 finish。
   - `createdGroups` 只收根分组，嵌套分组没有收；undo 的 groups 差异可能删不干净。

2. **outliner 快照无法独立完成撤销**
   - Blockbench `Outliner.loadJSON()` 对快照中不存在的节点不会删除，而是把未处理的 `Group.all`/`Outliner.elements` 节点重新 push 到 `Outliner.root`；仅靠 `outliner: true` 会留下新分组。
   - 被删除的 Locator 在 outliner 快照里只剩 UUID；快照不保存对象数据，必须靠 `elements` 的 undo save 重建。

3. **Locator 自定义字段不在 undo 快照里**
   - Blockbench `Locator` 继承 `OutlinerElement.getUndoCopy()`，它只通过构造器 `extend()` 复制 `Locator.properties` 中登记的字段。
   - 插件直接挂在 Locator 上的 `imda_call_target`、`imda_call_overrides`、`imda_call_threshold`、`imda_call_property`、`imda_call_index`、`imda_call_scale` 没有登记，undo 重建后可能变成空标签。

4. **覆盖应用时机错误**
   - 0.68.85 在 `created.addTo(parent)` **之前**、`created.init()` **之前**应用覆盖；`init()` 可能重置/覆盖这些字段。
   - `property` 先去掉 `minecraft:` 前缀，随后通用字段循环又把它写回原值（循环里包含 `property`）。
   - 目标分组是 `range_dispatch` 时，父级 `imda_threshold_format` 在导出时优先于子分组 `imda_threshold`；子分支的 `threshold_format` 也没有被导出器读取，所以覆盖阈值/格式可能完全不体现在 JSON。

5. **副本 UUID 冲突**
   - Blockbench `Group.duplicate()` 使用 `new this.constructor(this)`，会沿用原分组 UUID；保存项目里已发现两个“调用 sacpack2”分组 UUID 相同。
   - 副本 UUID 冲突会破坏 `OutlinerNode.uuids` 查找/撤销目标；但 0.68.89–0.97 的“递归重生成 UUID”曾因没同步 `OutlinerNode.uuids` 让撤销更坏，重做时必须同时处理注册表，且不要无条件改 UUID。

### 0.4 推荐的下一次实现顺序

1. 只改 `instantiateCallTags` 的撤销 aspects，先不动 UUID：
   - init：`{ outliner: true, groups: 父分组去重, elements: 待删除 Locator }`
   - finish：`{ outliner: true, groups: 父分组 + 全部新建分组（含嵌套）, elements: 全部新建方块 }`
   - 先验证 Ctrl+Z 能删除新分组、恢复 Locator。
2. 把 `imda_call_*` 登记为 `Locator` 的 Property，保证 `getUndoCopy()/getSaveCopy()` 能复制；或给 `Locator.getUndoCopy` 做受控补丁。
3. 再修覆盖：
   - 移到 `created.init()` 之后应用；
   - 循环排除 `property`，统一去 `minecraft:` 前缀；
   - 子分支阈值覆盖显式优先于父 range 的 `threshold_format`；
   - 导出器读取子分支 `threshold_format`。
   - **⚠ 修正（0.0.1 结论）：子分支 `threshold_format` 只能在“被显式覆盖”时优先；未显式覆盖时必须继承父级格式，否则父级 `5-i` 会被子级自带的 `i`/`i+N` 覆盖，输出 0,1,2… 而非 5,4,3,2,1。`syncBranchLabels` 写回的 `imda_threshold` 也必须与名字前缀同向（`5-i` → 5,4,3,2,1）。这是当前“顺序/阈值正倒序交替”的根因，优先级最高。**
4. 最后处理副本 UUID：只在检测到与目标/已有节点冲突时生成新 UUID，并同步 `OutlinerNode.uuids`。不要无条件重生成。
5. 每步都用真实 Blockbench 操作验证，并补一个“实例化→撤销”集成测试；不要再用 `undo` 事件兜底或手工 push history 掩盖问题。

### 0.5 验证清单

- `node --check item_model_definition_assembly.js`
- `node _test_sim.js`（0.68.85 基线 207/207）
- `node _test_assembly.js`（当前 mock 有 File 菜单报错，可能 exit 1，仅作冒烟）
- 真实 Blockbench：新建项目 → 选中一个复调用 Locator → 实例化 → Ctrl+Z 一次；检查分组、Locator、目标 UUID、覆盖 JSON。
- Console 关注：`[装配] 实例化复调用失败`、`Undo` 相关异常；0.68.85 没有额外撤销日志，重做时可加临时日志。
- **顺序/选择专项**：完全重启 Blockbench，确认 onload 打印当前版本号。选择序列分支时应**不出现** `[装配] 分支同步触发` / `[装配] sortBranchChildren`；若顺序仍变，说明是 `name` 前缀或导出阈值（见 0.0.1），不是排序。必要时在真机挂探针：`update_selection` 前后快照父分组 `children` 的 uuid 顺序 + 每个子节点 `name`，变化时用 `Blockbench.showQuickMessage`/`console.warn`（避免只看 `console.log`）。
- **备份分析工具**：Blockbench 的 `*.bbmodel` 备份是 `<lz>` + lz-string（`compressToUTF16`/StorageBinaryString，即 v2 的 `ci` 模块，源码在 `dist/bundle.js` 内）。本次已用 Node 从 `app.asar` 提取 `var ci;...var Lw=ci;` 段并 `vm` 执行，`ci.decompress(payload,{inputEncoding:'StorageBinaryString',outputEncoding:'String'})` 即可解压，用于核对真实数据结构。

---

## 1. 关键路径

| 用途 | 路径 |
| --- | --- |
| 插件源码仓库（git） | `C:\Users\Rainbow_\blockbench_item_model_mapping_isolated\` |
| 主插件文件 | `item_model_definition_assembly.js`（约 1800 行，单文件） |
| 旧导出器插件（参考实现） | `item_model_mapping.js` |
| 文档 / 说明 | `item_model_definition_assembly_README.md`、`item_model_mapping_README.md`、`CHANGELOG.md` |
| **安装目录（生效位置）** | `C:\Users\Rainbow_\AppData\Roaming\Blockbench\plugins\item_model_definition_assembly.js` |
| Blockbench 安装 | `C:\Program Files\Blockbench\Blockbench.exe`（源码在 `resources\app.asar` → `dist/bundle.js`，压缩混淆） |
| 实际资源包工程（只读参考） | `C:\Game\Minecraft\.minecraft\resourcepacks\Squilker Sparkle Res` |
| 输入模型 | `...\assets\sqsp\models\item\inker\jet_rifle\assembly.bbmodel`、`sac.full.json` 等 |
| 输出目录 | `...\assets\sqsptst\items\assembly.json` + `models/item/*.json` |
| Node（跑脚本/校验） | `C:\Users\Rainbow_\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe` |
| 离线测试脚本 | 仓库内 `_test_assembly.js`、`_harness.js`、`_check3.js`（mock Blockbench 全局） |
| **终端调试桥** | `_bbcdp.js`（CDP 接主实例 Console + 事件总线），用法见 `_BBCDP.md` |

---

## 2. 插件功能总览（当前版本）

模型格式 id：`item_model_definition_assembly`，名称「物品模型映射装配」。

### 2.1 映射类型（每个分组一个节点）

| 类型 | 输出结构 |
| --- | --- |
| `composite` | `models: [...]`（子分组 + 本层模型） |
| `model` | `model` + `tints`，可引用 Java 模型（`imm_model`） |
| `range_dispatch` | `property` / `index` / `scale` / `entries[{threshold, model}]` / `fallback` |
| `condition` | `property` + `on_true` / `on_false`（**不是 when**） |
| `select` | `property` / `index` + `cases[{when, model}]` + `fallback` |
| `empty` | `{"type":"minecraft:empty"}` |

字段与 wiki 对齐（26.x）。`condition` 谓词清单见 README；`range_dispatch` 数值属性附字段：
`compass → target/wobble`、`time → source/wobble`、`count/damage → normalize`、`use_cycle → period`、`use_duration → remaining`。

### 2.2 变换（transformation）

- 单位：`translation` 以**格**为单位（1 = 16px）；坐标系原点 = 方块空间 `(0,0,0)`，物品中心 = `(0.5,0.5,0.5)`＝像素 `(8,8,8)`，两者**不同**。
- 分解顺序：`right_rotation → scale → left_rotation → translation`；姿态写 `left_rotation`（四元数 `[x,y,z,w]`），`scale` 保持 1。
- 计算：`t = (R·d_i + O − R·O − d_parent)/16`
  - `d_i` = 该分组自身几何包围盒中点 − `(8,8,8)`（**每个分组各自居中**）
  - `d_parent` = **父层**的 `d`（关键：否则父层居中补偿会泄漏到子层，导致 bone/bone2/bone3 偏移约 1.4 格）
  - `O` = 分组 `origin`（默认 block 原点；可选 +8 中心模式）
- 根节点不再承载全局平移（曾经试过“全局只居中一次”，会把模型炸掉，已回退）。

### 2.3 元素导出

- `from/to` 原样输出（负尺寸保留，不交换 min/max、不镜像 UV）。
- 单轴旋转 → 元素 `rotation`；角度不裁剪（1.21.5 起 45° 限制取消；22.5 整数倍是旧规则）。
- UV 按每张纹理自身 `uv_width/height` 缩放到 0–16 并 clamp（否则触发 `Cannot compute translucency out of bounds`）。
- `tintindex`：面只要有 `tint` 字段就输出（**含 0**）。
- 多轴旋转的方块 → 拆成独立 `minecraft:model` 子项，用 `transformation` 表达旋转。
- 紧凑 JSON：元素一行、数组内联、映射按层级展开。

### 2.4 分组属性（对话框）

`Tools → 编辑分组映射属性…`（也有分组右键菜单）。字段按类型条件显示，标签用**输出键名**（`type` / `model` / `property` / `tints[].index` / `entries[].threshold` 等），
问号（description）里写语法与作用。

分支编号：`range_dispatch` 子分组按 outliner 顺序自动编号，导出阈值默认 `0,1,2…`；
父分组可写**编号格式**：`i` / `2i` / `i*2` / `10+2i` / 字面列表 `0,1,3` / `2:2i`（前缀=重复次数，索引从 1 起 → `2,2,4,4,6,6`）。
确认时会把编号写进子分组名（`[0] xxx`），并幂等去重。
分组被挪出分支容器（拖到根目录/普通父级）时，`stripStrayBranchPrefixes()` 会自动去掉 `[k]` / `⚠` 前缀（0.41.0）。

### 2.5 资源包工程

- 项目设置项「资源包工程路径（pack.mcmeta 所在目录）」。
- `File → 选择资源包工程路径…`（系统原生文件夹选择框，`Blockbench.pickDirectory`）。
- 合并前校验 `pack.mcmeta`；缺失时给「选择… / 创建 pack.mcmeta」。
- 创建时按**目标版本**写格式字段；目标版本在**项目设置**里下拉选择（`imm_pack_version`，默认 `26.2`）——Blockbench 会把带 `options` 的项目属性渲染成 select，不要另做菜单对话框。
  - 版本表 `PACK_VERSIONS` 已按 minecraft.wiki 校对（26.3=97.1、**26.2=88.0**、26.1=84.0、1.21.11=75.0、1.21.9/10=69.0、1.21.8=64、1.21.6=63、1.21.5=55、1.21.4=46）。
  - **1.21.9 起**（25w31a，65.0+）写 `min_format`/`max_format`；更早写 `pack_format`。minor≠0 时写 `[major,minor]`。
- 「合并到资源包…」：列出将覆盖/新建/删除的文件，写入后用 `.imm-assembly-manifest.json` 清理过期文件。

### 2.6 引用模型导入（`Tools → 导入引用模型（当前分组）`）

- 按 `assets/<ns>/models/<path>.json` 读取，沿 `parent` 链最多 12 层合并 `elements` / `textures`。
- 元素旋转支持两种格式：Java 原版 `{axis, angle, origin}` 与 Blockbench `{x,y,z,origin}`。
- 导入前清空该分组原有元素；`Canvas.updateAll()`；确认分组属性时若有元素会先弹确认框。
- 几何会按分组 `origin` 平移（模型原点与分组位置重合）；分组属性可勾「导入时自动对齐到模型中点」（写 `imm_offsets` → `translation`）。
- **成功关键**：`new Cube({...}).addTo(group)` 之后必须 `cube.init()`（否则没有 mesh、不进 `Cube.all`、看不见也选不中）；且必须 `addTo` 到**已初始化 mesh 的现有分组**，不要新建分组（新建分组没 init，子元素不渲染）。

### 2.7 模拟输入面板（视图 → 面板 → 模拟输入）

- 面板 id `imm_sim_panel`，内容挂 `panel.node`（不是 `nodes` 数组）。
- 结构（0.40.0）：**大类标题行**（折叠箭头 + 复选框 + 名称/提示 +「未启用」）→ 大类 body（默认展开）→ **每个槽一行**（折叠箭头 + **槽复选框** + 槽号 + 索引 + 值 + 命中角标）→ 槽 body（默认折叠）：自动变化控制器 + 关联分组。
- 折叠用 `<div>` + 箭头按钮控制 `style.display`，**不要用 `<details>` 包输入**（0.36.x 曾把名称/索引/值移进折叠 body，`<summary>` 里只剩「索引 0/1/2」）。
- **「未活跃」也不能用 `innerHTML` 里的原生 `<details>`**（0.40.0 修）：面板重渲染点不开。改成自绘按钮 + `data-usage-toggle` / `data-usage-body`，事件委托挂在 usageEl 上，展开状态存在 `sim.usageOpen`，`innerHTML` 重建后保持。
- 两个复选框（0.69.11 起语义已澄清）：**大类复选框**（`row.enabled`）= 这一类要不要自动变化；**槽复选框**（`slot.enabled`，默认开）= 这一个槽要不要自动变化。**两者都不影响值是否存在、也不影响求值**——`simTick` 里所有槽的手动值一律写入 `inputs`。自动变化只挑 `row.enabled && row.kind === 'number' && slot.enabled`。**改值/改索引不会勾任何复选框，也不会启动循环**（`ensureEnabled()` 已删除）。
- 运行状态：`simUpdateRunUi()` 维护按钮文案（▶ 运行 / ■ 停止）+ 高亮 + 右侧「已停止 / 运行中 · N 个自动槽」；没有数值槽时只弹提示、不进入运行态。
- 改值即时重算（`input` 事件，**40ms 防抖** `simScheduleTick`）。
- **性能**：`sim.mapping` 缓存 `buildMapping()`、`sim.usage` 缓存 `collectInputUsage()`；结构/属性变化时 `simInvalidate()` 置脏（组事件、分组属性确认、分支改名都会调）。`createExporter().buildMapping()` 很重，**绝不能在每次输入时重建**。另有「⟳ 刷新」按钮兜底。
- **行首复选框 = 自动变化开关（0.50.0）**：`row.enabled` 只影响 `simAutoSlots()`；`simTick` 里所有槽都参与求值。`colors` 自动用 `slot.presets` 轮换（`SIM_COLOR_PRESETS`），角标显示关联组数。
- **步长 0（0.69.11）**：`readSlot()` 原写法 `Number(step.value) || 0.5` 把 0 当假值，所以「步长设 0 无效」。现改为只有留空/非法才回退 0.5。`openSimulator()` 里同理。
- **colors 预览着色（0.48.0）**：`simApplyTints()` 在每个 tick 后遍历分组内方块，取第一个 `face.tint >= 0` 的 tintindex 作为 `colors[index]` 下标，用 `MeshBasicMaterial(map, color)` 替换运行时材质；`simRestoreTints()` 在清空/关闭/切项目/卸载时恢复。幽灵态优先，不叠加。
- 关联分组：容器（如 `bone7`）在上、直属子分支全列出；活跃子分支加粗标蓝（容器始终灰色、无 `[!]`）。
- 活跃判定：`activeIndex = max{ k | k ≤ 当前值 }`（k 来自子分组名 `[k]` 前缀）。
- 关联信息由 `refreshUsage()` **统一持有**（`simTick` 只调用它）：按每个槽自己的 `idx/val` 取下标与值，不要再从 DOM 顺序去猜目标节点。
- **不活跃分支视图联动（0.42.0）**：控制条右侧「不活跃分支：不处理 / 半透明 / 完全隐藏」。
  - 半透明：克隆**运行时材质**（`transparent` + `opacity 0.28` + `depthWrite false`），`mesh.__immGhost` 记原材质；**不碰纹理/UV/元素数据/项目/撤销**。
  - 完全隐藏：`group.mesh.visible = false`（运行时），`mesh.__immHidden` 记原值；不改 `group.visibility`。
  - 映射节点到分组靠 `Exporter.groupNodes`（旁路表，不参与导出）；`simGetMapping()` 里缓存为 `sim.groupNodes`。
  - 恢复时机：模式改回不处理、映射失败、切换项目、卸载插件；映射里消失的分组也会在下次 tick 恢复，避免残留幽灵。
- **重贴**：Blockbench 的 `updateSelection` 会把 `mesh.material` 换回纹理材质、`updateVisibility` 会把 `mesh.visible` 换回 `element.visibility`；0.43.0 在联动开启时每 250ms 重贴，并检测被重置后重新克隆。
- **幽灵材质（0.45.0）**：Blockbench 贴图是自定义 `ShaderMaterial`（alpha 取纹理，`material.opacity` 无效），所以半透明必须用 `THREE.MeshBasicMaterial` + 原贴图（`uniforms.map.value`），设 `transparent/opacity 0.28/depthWrite false/alphaTest 0`。
- **诊断**：`Tools → 诊断：模拟视图联动` 弹窗显示 模式 / groupNodes 数 / 分支数 / 匹配分组数 / 未命中分组的方块与材质数量；“没反应”先看这里是否匹配到 0 个分组。
- **匹配覆盖（0.44.0）**：`simEvaluate` 返回的 composite 内联 `model` 节点、range/select 的 fallback 节点、多轴方块独立节点也必须登记到 `groupNodes`（登记到所属分组 / 父分组），否则诊断会出现“groupNodes 20、匹配 1”。真实 bbmodel 核对为 10/10。
- condition 现在会同时求值两个分支（未选中的标 `hit=false`），结果区列出 ✘，视图联动也能隐藏未生效分支。

### 2.8 枢轴归位（Tools → 枢轴归位…）

- 问题：嵌套旋转下，分组 `origin` 常常离几何中心 17–48px；旋转/移动工具的手柄飘在远处，Blockbench 自带「枢纽居中」在多层旋转上会歪。
- 做法：把每个分组的 `origin` 移到它（**含所有后代**）方块中心的平均值，同时平移内容补偿，外观不变。
  - 补偿：`d = (I − R⁻¹)(O′ − O)`（分组本地坐标）；子分组递归 `R_c⁻¹ d`。
  - 注意：**不能用「世界坐标写回 origin」**——origin 在父坐标系，嵌套旋转必须递归换算。
- 实现：`pivotContentPoints()`（递归收集后代方块中心）、`pivotTranslateContents()`（递归补偿）、`fixGroupPivot()`；`applyPivotFix(selectedOnly)` 走 Undo + `Canvas.updateAll()` + `simInvalidate()`。
- 验证：`pivot_lab2.js`（临时脚本）在真实 `assembly.bbmodel` 上逐组/整树修正，153 个角点误差 0。
- 单测：`_test_sim.js` 用两层旋转分组断言「世界坐标不变 + 枢轴落在内容中心」。

### 2.9 内联模型 / 从分组创建模型

- `inline`（内联模型）：导出结构等同 composite（本组方块烘焙成模型）；`model` 表示引用 `imm_model`。
- `Tools → 从分组创建模型…`：`createModelFromGroup()` 用 `createExporter().addModel(cubes, hint)` 烘焙（会自动居中），`formatModel()` 写 `assets/<ns>/models/item/<name>.json`，然后把分组改为 `model` + `imm_model`，并把居中补偿写进隐藏属性 `imm_model_shift`（`buildNode` 的 model 分支会解析它作为 shift，保证外观不变）。

### 2.10 复调用标签（Locator）

- 格式开启 `locators: true`；`Tools / 分组右键 → 复调用选中的分组` 在分组 origin 处创建 Locator，`imm_call_target` = 分组 uuid。
- 导出：`buildCallNode()` 对分组目标返回占位 `{__imm_call_group}`；`buildMapping()` 结束后 `resolveCallPlaceholders()` 把占位替换为 `groupNodeCache` 里目标节点的深拷贝（保留 transformation），并用 `stripCallPlaceholders()` 去掉克隆体内残留占位（防自引用）。
- 目标也可以写模型 id（含 `:`）→ 直接输出 `minecraft:model`。
- 标签只建议放在 composite / inline 分组；其他类型会警告并忽略。
---

## 3. 版本历史（近期，git tag）

```
0.68.99  基于 0.68.85 的最终尝试：撤销 aspects、去重 init、覆盖强制阈值
0.68.98  实验：range 子分支 threshold_format 优先（已回退）
0.68.97  实验：清 threshold_force 继承（已回退）
0.68.96  实验：Locator 字段 Property + property 前缀（已回退）
0.68.95  实验：撤销 aspects + threshold_force（已回退）
0.68.94  实验：outliner 快照 + 手工补历史（已回退）
0.68.93  实验：补 parentGroups（已回退）
0.68.92  实验：undo 事件兜底（已回退）
0.68.91  实验：同步 UUID 注册表（已回退）
0.68.90  实验：重写 UUID/撤销（已回退）
0.68.89  实验：副本重生成 UUID（已回退）
0.68.88  实验：groups aspects / 覆盖日志（已回退）
0.68.87  实验：initEdit groups aspect（已回退）
0.68.86  实验：覆盖改到 init 后（已回退）
0.69.13 「不处理」不再残留洋葱皮/锁：恢复改为全量扫描 + 锁定基线搬到 globalThis 跨重载
0.69.12 多级分支视图联动：branches 链 + trace 判空分支 + 顺 Locator 找目标 + uuid 索引优先大纲
0.69.11 复选框只管自动变化（不勾值也在、也照样求值）；改值不再自动开循环；步长 0 保留
0.69.10 复选框不再冲掉值（readSlot 忽略空输入；勾选不回写输入框）
0.69.9 分支活跃判定改用 branchActive（内层 condition 不满足时不再误判整支不活跃）
0.69.8 求值结果带 branch，复调用克隆的分支也能正确隐藏/半透明
0.69.7 去掉 fail-open：严格按条件隐藏，修「只有第 5 支有内容时不轮换」
0.69.6 分支容器从全部映射分组枚举（空分支也参与联动）
0.69.4 菜单属性置底；模拟面板控制条固定；视图联动递归嵌套分组/空分支
0.69.3 重载插件不再重复注册右键菜单
0.69.0 引用 items/*.json 映射（内联+项目缓存）、更新所有调用、右键菜单条件化、提取/应用变换、引用文件选择器
0.68.117 枢轴归位不再动方块枢轴（会把方块挪走）；导入时把方块 origin 设为几何中心
0.68.116 撤销审计：复调用/时间轴/导入引用模型的新建节点进 finish aspects；规范化与属性删除合并撤销
0.68.115 实例化后恢复副本 export（否则整条分支不导出）；真实备份验证 bone7 输出 5,4,3,2,1
0.68.114 修 range 导出：父级 threshold_format 优先于子级自带格式；syncBranchLabels 支持 select
0.68.85  当前基线（回退点）：复调用实例化、覆盖字段、右键菜单
0.68.28  全量 imm_ → imda_，旧项目自动迁移
0.68.27  adopt 不再覆盖已有属性（修目标被清空）
0.68.26  批量编辑纳入 selected 标记，目标不存在时提示
0.68.25  修失效 UUID 预填模型 id 覆盖目标
0.68.24  批量编辑选中集合改为并集
0.68.23  批量编辑复调用标签
0.68.22  复调用 node_name 使用标签名
0.68.21  复调用应用 Locator 位置/旋转补偿
0.68.20  修 range/select 下复调用不输出
0.68.19  恢复模型装配下的结构/复调用/调试/时间轴分区
0.68.18  VCS 标题上方补分隔线
0.68.17  菜单加载前清理旧项
0.68.16  VCS 标题项 + 模型装配分隔线
0.68.15  清理 Tools 重复分区
0.68.14  Tools 标题改用标题菜单项 + 分隔线
0.68.13  修 Tools 相邻分隔线被跳过
0.68.12  Tools 标题改为 VCS/模型装配/时间轴/辅助功能
0.68.11  修第一个分区标题不显示
0.68.10  Tools 分区标题统一为 VMT 前缀
0.68.9  Tools 调试分区与入口整理
0.68.8  分组转复调用标签 + Tools 分区
0.68.7  规范化 composite 内联模型
0.68.6  修序列撤销与 #n 命名
0.68.5  序列生成器支持递增/递减与 range_dispatch 参数
0.68.4  addAndInit 约定与 AGENTS.md
0.68.3  递减复调用序列生成
0.68.2  修时间轴丢失静态祖先 transformation（朝上根因）
0.68.1  时间轴根真实模型 display carrier
0.68.0  额外空 composite 层数调试项
0.67.9  时间轴根加 display 载体模型
0.67.8  时间轴根包 composite，排查 display 朝上
0.67.7  display 默认只输出手持槽位
0.67.6  display 缺失槽位回退手持预设（修朝上）
0.67.5  修动画右键菜单挂载顺序
0.67.4  Tools 时间轴属性入口 + 右键重试
0.67.3  动画右键新增时间轴属性入口
0.67.2  接管动画属性对话框并追加时间轴字段
0.67.1  动画属性注入时间轴字段
0.67.0  修逐帧姿态采样/时间轴命名/动画属性
0.66.9  时间轴递归到动画节点，静态祖先保持层级
0.66.8  时间线 range 节点补 node_name
0.66.7  修 node_name 序列化与 Tools 菜单漏挂
0.66.6  时间轴只收动画子树，静态节点外置
0.66.5  导出节点新增 node_name（来源分组名）
0.66.4  设置页主键改为 imda_*，旧键作隐藏别名
0.66.3  迁移排除 Project 级设置并在加载时回同步
0.66.2  imm_ → imda_ 迁移选项
0.66.1  命名统一为 VMT / IMDA
0.66.0  显示页 display / 子空间 / 自动时间轴 / 复调用标签操作
0.62.8  display 对齐引用模型（仅手持 0.85/0.68，无 gui/ground）
0.62.7  display 恢复 0.20 的 block/block，移除整体缩放
0.62.6  根 transformation 整体缩放（imm_export_scale）
0.62.5  回退 translation 单位改动（单位仍是格）
0.62.4  transformation.translation 改用像素单位（修模型偏小/偏移）
0.62.3  display 改为 item/generated（修游戏内偏小）
0.62.2  选择守卫在分组优先选择时让路（修父分组 gizmo）
0.62.1  单元素也触发选父组+同层元素
0.62.0  框选改为向上递归：子项全选才选中分组
0.61.5  框选改组不再取消方块自身选择
0.61.4  框选改组始终展开子项（分组已 selected 也展开）
0.61.3  框选改组防二次触发（updateSelection 在守卫内）
0.61.2  框选改组改为“分组+全部子元素”同选
0.61.1  框选改组例外只认 inline，引用模型不例外
0.61.0  框选改组：装配内强制开启、内建模型元素例外
0.60.0  可选开关：框选/多选方块时自动改选父分组
0.59.0  纹理引用/输出路径按贴图真实 assets 路径解析
0.58.0  可选开关：批量选组时自动取消单个元素
0.57.0  枢轴归位同时把方块旋转枢轴归到父级几何中心（带补偿）
0.56.1  导出越界元素警告
0.56.0  移除映射装配格式的 -16~32 坐标限制
0.55.1  锁定分支不可选中（取消选中 + 选择守卫）
0.55.0  复调用标签右键编辑；分组菜单重排+分割线
0.54.0  不活跃分支「半透明/完全隐藏并锁定」
0.53.3  导入保留自带 tintindex；已有则不再全量补
0.53.2  引用模型导入把着色配置下发给所有子分组并补 face.tint
0.53.1  引用模型导入支持嵌套 groups（递归建组）
0.53.0  引用模型导入按模型 groups 建 inline 分组
0.52.1  colors 预设色改为 16 个染料色
0.52.0  批量编辑分组属性（多选时应用到所有选中分组）
0.51.0  “不生成 tints”用 none 哨兵持久化；导出/预览/关联都尊重
0.50.0  行首复选框=自动开关（不勾也参与求值）；colors 预设色轮换 + 角标改关联组数
0.49.0  colors 关联分组（按 tintindex / tints index 反查分组）
0.48.0  colors 驱动预览着色（tintindex 方块运行时着色）
0.47.0  Locator 复调用标签（导出替换为目标分组节点）+ 右键/工具菜单
0.46.0  inline 内联模型类型；从分组创建模型（自动居中 + 引用）
0.45.0  幽灵材质改 MeshBasicMaterial（Blockbench 贴图是 ShaderMaterial，opacity 无效）
0.44.0  视图联动登记 composite 内联/fallback/多轴方块节点；condition 未选分支也求值
0.43.0  视图联动改为开启时每 250ms 重贴（Blockbench 会重置材质/可见性）+ 诊断入口
0.42.0  不活跃分支视图联动：不处理 / 半透明 / 完全隐藏（只动运行时材质）
0.41.0  分支前缀自动清理；枢轴归位（嵌套旋转补偿，外观不变）
0.40.0  槽级开关；未活跃改自绘折叠（原生 details 打不开）；映射/用量缓存 + 输入防抖 + ⟳ 刷新
0.39.0  恢复 sim 状态对象（修“值没反应”）；面板：大类/槽双层折叠、每槽控制器+命中角标、运行状态
0.38.0  目标版本移入项目设置下拉；模拟面板每行「标题+输入」常显（去掉折叠）
0.37.0  pack_format 修正（26.2=88.0）+ 目标版本下拉；恢复 simEvaluate 并补 select/condition 求值
0.36.2  floats/colors 三下标槽 UI（带标题）
0.36.1  （锚点失败，未改动）
0.36.0  按 pair 写入逻辑
0.35.1  floats/colors 值框允许逗号多值
0.35.0  多值多下标写入；colors 等隐藏自动变化
0.34.2  容器不高亮；活跃项去掉 [!]
0.34.1  活跃分支按阈值比较判定（修“值 0 却全不活跃”）
0.34.0  关联分组：分割线 + 折叠 + 活跃高亮
0.33.x  关联分组独立刷新、重写收集逻辑（容器在前、仅直属、全列出）
0.32.x  关联分组元素重建 / 簇布局 / 面板复用
0.31.x  每行关联分组、自动开关行内、初始刷新
0.30.x  模拟面板重做：每输入一行、独立自动变化、三簇排版
0.29.0  输入来源扩为 cmdata 四类 + 物品属性
0.28.x  面板复用与卸载销毁（修重载重复面板）
0.27.0  导入支持 Blockbench 风格旋转
0.26.x  导入几何对齐分组 origin
0.25.0  导入保留元素名/替换旧元素/确认框
0.24.x  导入直接进目标分组 + 恢复 cube.init（修“不可控制”）
0.23.x  Cube.all 登记 / holder 分组排查
0.22.x  导入纹理绑定与 UV 缩放
0.21.0  引用模型导入（parent 链）
0.20.x  资源包工程路径校验/创建；引用模型仅 model 类型
0.19.x  select 类型、range_dispatch 附加字段、类型切换清理
0.17.0  撤销 when，property 改下拉
0.10–0.16  tints/纹理着色、Face.tint 注册、面板初版
0.9.x  Face.tint 注册（着色勾选真正生效）
0.8.x  重写：几何居中（后回退）、多轴拆子项、紧凑输出
```

---

## 4. 待办 / 已知问题（优先级从高到低）

1. **结果区折叠树**：目前结果区是纯文本；计划改成 `<details>` 树，显示每层 `range_dispatch` 的取值与命中/未命中。
2. **关联分组活跃判定的通用化**：`strings`/`flags` 行目前只列分组，没有按 case/flag 判定命中（`floats` 已按阈值判定；多下标槽恒取第 0 项的问题已在 0.38.0 修掉）。
3. **UV 缩放按 PNG 真实尺寸**：现在用 `texture.uv_width`，若与 PNG 实际尺寸不一致 UV 会偏。
4. **模型 `groups` 字段未用于还原层级**：导入的是扁平方块。
5. **「装配属性」常驻面板**：尚未实现（原计划 Panel + 随选择刷新）。

> 已实现：模拟结果驱动视图（0.42.0，`不处理 / 半透明 / 完全隐藏`）。

---

## 5. 踩坑与注意事项（务必读）

### 5.1 插件加载/重载

- Blockbench 从 `%APPDATA%\Blockbench\plugins\` **自动加载**目录内插件（本机已确认）。
- `onload` 抛错会导致插件被**禁用**（格式变“不可用”）；已用 try/catch 包住 `registerProperties` 与整个 onload。
- **面板重复**：重载时旧 `Panel` 若不销毁会累积；`onunload` 已 `sim_panel.delete()`，加载时优先复用 `Panels['imm_sim_panel']`。
- `animated_java` 的 **Blockbench Patch Manager** 会在启动时卸载/重载插件，可能把本插件留在未加载状态；必要时禁用它。
- `about.md` 的 404 是 CDN 取不到，纯噪音，不影响功能。

### 5.2 Blockbench API 事实（已实测）

| 事实 | 说明 |
| --- | --- |
| `Panel` 内容 | 挂 `panel.node`（DOM），**没有 `nodes` 数组** |
| 新建方块 | `new Cube({...})` 后必须 `cube.init()`，否则无 mesh、不在 `Cube.all`、不可见不可选 |
| 新建分组 | `new Group().addTo()` 后**没有 mesh**，其子元素不渲染；导入应加到已存在的、已初始化的分组 |
| 删除元素 | 用 `child.remove()`；不要 `remove(false)`（会破坏 outliner 与 undo 快照） |
| 菜单 | `MenuBar.addAction(action, 'file')` 只追加到末尾（贴首选项）；要插到指定位置需先添加再在 `MenuBar.menus.file.structure` 里搬移（元素可能是 id 字符串或 Action 实例） |
| 面属性 | 本格式需自己注册 `new Property(Face,'number','tint',{default:-1})`，否则 UV 编辑器“着色”勾选无效；导出用 `tint >= 0` |
| 元素旋转上限 | 1.21.5 起 ±45° 取消；22.5° 整数倍是旧规则 |
| `render_sides:'front'` | Java 格式用该选项让负尺寸方块显示为里外翻转；本格式已加 |
| `cube_size_limiter` | 已移除：映射装配格式不限制 -16~32（导出 Java 模型时自行保证合法） |

### 5.3 开发流程约定（用户要求）

- **每次改动都要 bump 版本号**：修 bug 用 patch，加功能用 minor；开发阶段保持 `0.x.y`。
- 每次改动：改 `version` → 写 `CHANGELOG.md` 一节 → `git commit` → `git tag v<版本>` → **复制到 `%APPDATA%\Blockbench\plugins\`**。
- 文本改动必须用 **UTF-8 安全**方式（用 node 读改写；PowerShell `Set-Content` 曾把中文写坏）。

### 5.4 补丁手法教训

- 文件是 **CRLF**；多行字符串匹配常常失败 → 用**单行锚点**或 `indexOf` + 行号插入。
- 每次替换后**打印命中情况**（ok/miss），miss 时不要以为改好了。
- `node --check` 只能验证语法，**验证不了运行时**（曾因“变量在声明前使用”导致面板空白）。
- 改 UI 组装时注意顺序：**先创建控件 → 再组装 DOM**；否则 `ReferenceError`。
- 用 `function foo() {` 当单行锚点会命中 `async function foo() {` 的**内部**，替换后 `async` 会落到前一段上（0.37.0 踩过：`async function pickPackPath` 变成 `async function pickPackVersion` + 非 async 的 `pickPackPath`，`await` 直接语法错误）。锚点要带上 `async ` 或改成整行唯一文本。
- 大改动前用 `git log -S 'symbol'` 查这个函数/字符串是否在某次重构里被误删（`simEvaluate` 与 `sim` 状态对象就是 0.30.1 一起删掉的：前者 0.37.0 才发现，后者直到 0.39.0 才暴露成“值完全没反应”）。
- 改坏就 `git checkout -- item_model_definition_assembly.js` 回滚（多处历史版本可 `git checkout v0.xx.y -- 文件`）。

### 5.5 校验命令

```powershell
$node = 'C:\Users\Rainbow_\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
& $node --check 'C:\Users\Rainbow_\blockbench_item_model_mapping_isolated\item_model_definition_assembly.js'
& $node 'C:\Users\Rainbow_\blockbench_item_model_mapping_isolated\_test_assembly.js'   # 离线冒烟
& $node 'C:\Users\Rainbow_\blockbench_item_model_mapping_isolated\_test_sim.js'         # 求值/面板/枢轴/视图/复调用/着色单测（235 项）
Copy-Item 'C:\Users\Rainbow_\blockbench_item_model_mapping_isolated\item_model_definition_assembly.js' `
  'C:\Users\Rainbow_\AppData\Roaming\Blockbench\plugins\item_model_definition_assembly.js' -Force
```

真机调试（终端看 Console + 事件）：

```powershell
# 1) 完全退出 Blockbench，再用调试端口启动（默认 profile，插件照常加载）
& 'C:\Program Files\Blockbench\Blockbench.exe' --remote-debugging-port=9222 --remote-allow-origins=*

# 2) 持续监听（建议写文件，PowerShell 直接看 stdout 会乱码）
& $node '_bbcdp.js' --watch --out=_bbcdp.log
Get-Content _bbcdp.log -Encoding utf8 -Tail 50

# 3) 看某类事件 / 打印 outliner 树 / 页内求值
& $node '_bbcdp.js' --watch --event-filter='^update_selection$|^add_group$|^finish_edit$'
& $node '_bbcdp.js' --snapshot
& $node '_bbcdp.js' --eval "Blockbench.version"
```

---

## 6. 新会话开场建议

1. 读本文档 + `CHANGELOG.md` 最后 10 条；
2. `git log --oneline | head -20` 确认状态；
3. 从「待办」第 1 项（结果区折叠树）或第 2 项（关联分组活跃判定）开始；
4. 改任何 UI 前，先在插件里加 `console.log` 打点，让用户贴日志，**不要盲改 DOM**。

### 6.1 新增的求值/版本钩子

- `_test_sim.js` 通过 `globalThis.__IMM_TEST__ = {}`（require 之前设置）拿到 `api = { simEvaluate, simValue, simTick, packMcmetaData, packFormatLabel, packMcmetaFormat, PACK_VERSIONS, VERSION, buildSimPanel, getSimUi, getSimPanel, stripStrayBranchPrefixes, fixGroupPivot, simApplyGroupVisual, simRestoreView, simSetViewMode, pivotContentPoints, rotateAroundQuat, readQuaternion }`；生产环境不设这个全局就没有副作用。它还 mock 了极简 `document` / `Panel`，用来断言面板结构（输入不能在 `<details>` 里）。
- `packMcmetaData(description, versionId)` 是 `pack.mcmeta` 的唯一生成入口；改版本表只改 `PACK_VERSIONS`。
