# 交接文档 — 物品模型映射装配（Blockbench 插件）

> 生成时间：2026-10-24 · 当前版本 **0.61.5**（tag `v0.61.5`）
> 用途：换新会话继续开发前的完整交接。**先读这一份，再动代码。**

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
- 两个开关：**大类复选框**（`row.enabled`）与**槽复选框**（`slot.enabled`，默认开）。两者都开才参与求值；自动变化只挑 `row.enabled && row.kind === 'number' && slot.enabled`。改值/改索引会自动勾上槽和大类。
- 运行状态：`simUpdateRunUi()` 维护按钮文案（▶ 运行 / ■ 停止）+ 高亮 + 右侧「已停止 / 运行中 · N 个自动槽」；没有数值槽时只弹提示、不进入运行态。
- 改值即时重算（`input` 事件，**40ms 防抖** `simScheduleTick`）。
- **性能**：`sim.mapping` 缓存 `buildMapping()`、`sim.usage` 缓存 `collectInputUsage()`；结构/属性变化时 `simInvalidate()` 置脏（组事件、分组属性确认、分支改名都会调）。`createExporter().buildMapping()` 很重，**绝不能在每次输入时重建**。另有「⟳ 刷新」按钮兜底。
- **行首复选框 = 自动变化开关（0.50.0）**：`row.enabled` 只影响 `simAutoSlots()`；`simTick` 里所有 `slot.enabled` 的槽都参与求值（手动值不再被行复选框挡掉）。`colors` 自动用 `slot.presets` 轮换（`SIM_COLOR_PRESETS`），角标显示关联组数。
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
& $node 'C:\Users\Rainbow_\blockbench_item_model_mapping_isolated\_test_sim.js'         # 求值/面板/枢轴/视图/复调用/着色单测（140 项）
Copy-Item 'C:\Users\Rainbow_\blockbench_item_model_mapping_isolated\item_model_definition_assembly.js' `
  'C:\Users\Rainbow_\AppData\Roaming\Blockbench\plugins\item_model_definition_assembly.js' -Force
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
