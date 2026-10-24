# 交接文档 — 物品模型映射装配（Blockbench 插件）

> 生成时间：2026-10-24 · 当前版本 **0.37.0**（tag `v0.37.0`）
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

### 2.5 资源包工程

- 项目设置项「资源包工程路径（pack.mcmeta 所在目录）」。
- `File → 选择资源包工程路径…`（系统原生文件夹选择框，`Blockbench.pickDirectory`）。
- 合并前校验 `pack.mcmeta`；缺失时给「选择… / 创建 pack.mcmeta」。
- 创建时按**目标版本**写格式字段：`File → 目标 Minecraft 版本…`（下拉，项目设置 `imm_pack_version`，默认 `26.2`）。
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
- 每类输入独立一行，勾选启用；`floats` / `colors` 有 **0/1/2 三个索引槽**（标题 `索引 [i]`），每槽可改索引与值。
- `floats` 保留自动变化（自动 / 脉冲周期（间隔，秒，默认 0.2）/ 步长 / 往复|循环 / 上下限）；`colors`/`strings`/`flags` 隐藏自动变化。
- 参数分三簇：`索引+值` / `自动+周期+步长` / `规则+下限+上限`；窄时按簇换行、宽时并排。
- 关联分组：容器（如 `bone7`）在上、直属子分支全列出；不活跃折叠进 `<details>`；活跃子分支加粗标蓝（容器始终灰色、无 `[!]`）。
- 活跃判定：`activeIndex = max{ k | k ≤ 当前值 }`（k 来自子分组名 `[k]` 前缀）。

---

## 3. 版本历史（近期，git tag）

```
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
2. **关联分组活跃判定的通用化**：`strings`/`flags` 行目前没有按 case/flag 判定，只列分组；另外 `refreshUsage` 里 `row.value.split(',')[row.index - (row.index)]` 恒取第 0 项，多下标槽的活跃判定不准。
3. **UV 缩放按 PNG 真实尺寸**：现在用 `texture.uv_width`，若与 PNG 实际尺寸不一致 UV 会偏。
4. **模型 `groups` 字段未用于还原层级**：导入的是扁平方块。
5. **「装配属性」常驻面板**：尚未实现（原计划 Panel + 随选择刷新）。
6. **模拟结果驱动视图**：未实现“未命中分组隐藏 / 幽灵半透明”（注意：不得改动纹理与 UV，只能动运行时材质）。

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
| `cube_size_limiter` | Java 格式带 `coordinate_limits:[-16,32]` + test/move/clamp；本格式已移植 |

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
- 大改动前用 `git log -S 'symbol'` 查这个函数/字符串是否在某次重构里被误删（`simEvaluate` 就是 0.30.1 删掉了、直到 0.37.0 才发现）。
- 改坏就 `git checkout -- item_model_definition_assembly.js` 回滚（多处历史版本可 `git checkout v0.xx.y -- 文件`）。

### 5.5 校验命令

```powershell
$node = 'C:\Users\Rainbow_\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
& $node --check 'C:\Users\Rainbow_\blockbench_item_model_mapping_isolated\item_model_definition_assembly.js'
& $node 'C:\Users\Rainbow_\blockbench_item_model_mapping_isolated\_test_assembly.js'   # 离线冒烟
& $node 'C:\Users\Rainbow_\blockbench_item_model_mapping_isolated\_test_sim.js'         # 求值单测（34 项）
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

- `_test_sim.js` 通过 `globalThis.__IMM_TEST__ = {}`（require 之前设置）拿到 `api = { simEvaluate, simValue, packMcmetaData, packFormatLabel, packMcmetaFormat, PACK_VERSIONS, VERSION }`；生产环境不设这个全局就没有副作用。
- `packMcmetaData(description, versionId)` 是 `pack.mcmeta` 的唯一生成入口；改版本表只改 `PACK_VERSIONS`。
