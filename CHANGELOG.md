# 更新日志

版本规则：**开发阶段主版本号保持 0（0.x.y）**——修 bug 用 patch（0.6.x），加功能用 minor（0.x.0），每次改动都 bump 并打 git tag `v<版本>`；正式发布时才升到 1.0.0。

## 0.55.0
- **复调用标签支持右键编辑**：选中 Locator 右键 →「编辑复调用标签…」，可选择目标分组或直接填模型 id，写回 `imm_call_target`；Tools 菜单同样可用。
- **分组右键菜单重排**：内置选项之后加一条分割线，顺序为「从分组创建模型…」→「复调用选中的分组」→「编辑分组映射属性…」。

## 0.54.0
- **不活跃分支视图联动新增「半透明并锁定」「完全隐藏并锁定」**：未活跃分组及其子项在运行时 `locked = true`，避免误选/误编辑；只锁未活跃分支，活跃分支不动。
- 切换模式、关闭联动、切项目/卸载时恢复原有锁定状态；手动解锁后不会在周期重贴时被强行再锁。

## 0.53.3
- **引用模型导入保留自带 tintindex**：面的 `tintindex`（兼容 `tint`）会原样写入；只要模型里**任意一个面**已有 tintindex，就不再用目标分组的索引给所有面整体补 tint；只有模型完全没有 tintindex 时才补全。

## 0.53.2
- **引用模型的着色配置下发给所有子项分组**：导入时把目标分组的 `imm_tint_type` / `imm_tint_index` / `imm_tint_value` / `imm_tints` 复制到每个导入子分组（inline），并给导入方块的缺失面补上 `face.tint = 着色 index`（已有的不覆盖）。
- 目标分组设为「不生成 tints」（`''` / `none`）时不下发。

## 0.53.1
- **修引用模型导入分组被拍平**：模型文件的 `groups` 是**嵌套**结构（`children` 里既可能是元素下标，也可能是子分组对象），旧实现只处理下标，子分组对象被当成 `NaN`，所以结构全平。现在递归建组。
- 每个导入组仍标记为 `inline`（内联模型）；`origin` / `rotation` 按模型坐标 + 目标分组原点偏移写入。

## 0.53.0
- **引用模型导入保留模型内分组**：按 Java 模型文件的 `groups` 创建 Blockbench 分组，并标记为 **`inline`（内联模型）**；
  - 组的 `origin` / `rotation` 会写入（`origin` 按目标分组原点偏移），元素按 `children` 归入对应组；
  - 不属于任何组的元素仍直接导入到目标分组；
  - 以前所有元素会被拍平到目标分组，现在保留模型原本的分组结构。

## 0.52.1
- `colors` 默认预设色改为 **16 个 Minecraft 染料色**（ARGB，alpha = 0xFF）：`F9FFFE / F9801D / C74EBD / 3AB3DA / FED83D / 80C71F / F38BAA / 474F52 / 9D9D97 / 169C9C / 8932B8 / 3C44AA / 835432 / 5E7C16 / 1D1D21 / B02E26`；点「运行」时按此列表轮换。
- 单测扩到 **111 项**：默认预设色数量。
## 0.52.0
- **批量编辑分组属性**：多选分组后打开「编辑分组映射属性…」，确认时应用到**所有选中分组**（右键的分组不在选中里时只改它）；标题显示「共 N 个」。
- 撤销一次覆盖全部改动；分支重排/编号、tints 自动勾选、`imm_tint_type` 等逐组处理；「引用模型」导入提示只在单选时弹出。
- 单测扩到 **110 项**：同一结果批量应用到多个分组。
## 0.51.0
- **修「纹理着色类型设为不生成 tints 但仍变色 / 重新打开又变回 custom_model_data」**：
  - 属性对话框不再用 `||` 把空值兜底成 `custom_model_data`；选择「不生成」时存为显式哨兵 `none`，避免被属性默认值吞掉、保存/重开后丢失；
  - `buildTints()` 对 `''` / `none` 返回 `null`，不再输出 tints；
  - 预览着色与 colors 关联分组也尊重该设置：不生成 → 不着色、不列入关联；颜色索引改用分组的 tints 来源 index；
  - 保存重开后仍显示「（不生成 tints）」。
- 单测扩到 **109 项**：none/空值的 buildTints 与预览/关联。
## 0.50.0
- **行首复选框改为「自动变化」开关**：不勾选也照样用手动值参与求值；勾选后点「运行」才自动变化。手动改值只会自动勾上该槽，不再打开自动。
- **colors 自动变化改为预设色轮换**：槽展开后是「周期（秒）+ 预设颜色（逗号分隔）」，运行时在预设色之间循环；不再用步长/上下限。
- **colors 角标改为关联分组数**（`N 组`）：颜色不参与分支判定，之前显示分支命中数会误导。
- 单测扩到 **104 项**：手动值在未勾选自动时仍生效、colors 预设色解析。
## 0.49.0
- **colors 关联分组**：`collectInputUsage()` 现在也会收集颜色关联——按方块面的 `tint`（tintindex）以及 `model`/`composite` 的 `tints`（`custom_model_data` 的 `index`）反查所属分组，模拟面板 `colors` 行的「关联分组」不再恒为（无）。
- 单测扩到 **103 项**：colors 关联分组。
## 0.48.0
- **colors 驱动预览着色**：模拟面板里改 `colors[i]`，带 `tintindex = i` 的方块会在视图里着色（运行时材质，不改纹理/UV）。
  - 每个方块取**第一个着色面的 tintindex** 作为 colors 下标（多 tintindex 的方块暂不支持逐面着色）；
  - 用带原贴图的 `MeshBasicMaterial` 替换该方块的运行时材质，原贴图对象不变；清空 colors / 关闭模拟时恢复；
  - 幽灵/隐藏优先级更高：不活跃分支仍显示半透明/隐藏，不叠加着色。
- 单测扩到 **102 项**：colors 着色与恢复。
## 0.47.0
- **新增「复调用标签」元素**：给格式开启 `locators`，用 Blockbench 的 Locator 承载（无几何，有位置/旋转），自定义属性 `imm_call_target`（目标分组 UUID 或模型 id）。
- **Tools / 分组右键「复调用选中的分组」**：在选中分组的枢轴处创建标签（position/rotation 同分组），并指向该分组。
- **导出**：标签位置替换为目标分组的映射节点（深拷贝、保留其 `transformation`），composite / range_dispatch / select / condition 的结构一并复制；几何模型文件只生成一次；找不到目标或循环引用会警告并跳过；标签只建议放在 composite / inline 分组。
- 单测扩到 **99 项**：新增复调用替换与占位清理断言。

## 0.46.0
- **新增分组类型 `inline`（内联模型）**：导出结构等同 composite（本组方块烘焙成模型），用来区分「引用模型（model）」和装配体里现做的模型。
- **Tools / 右键「从分组创建模型…」**：把分组里的方块烘焙成 `assets/<ns>/models/item/<名字>.json`（自动居中）写入资源包；分组改为 `model` 引用，并用隐藏属性 `imm_model_shift` 记录居中补偿，外观不变。
- 单测扩到 **97 项**：inline 导出结构、引用模型居中补偿。
## 0.45.0
- **修「半透明变成完全消失」**：Blockbench 的贴图材质是**自定义 `ShaderMaterial`**，片元 alpha 直接取纹理（`gl_FragColor = vec4(..., color.a)`），`material.opacity` 完全不参与；克隆后设 `opacity` 不会变半透明（还会因为 `transparent`/`depthWrite` 改动出怪）。
  - 幽灵材质改为 **`THREE.MeshBasicMaterial`**，复用原材质的贴图（`uniforms.map.value` 或 `material.map`），设 `transparent + opacity 0.28 + depthWrite false + alphaTest 0`；
  - 没有贴图时用灰色兜底；数组材质逐个替换；
  - 恢复时仍还原原材质并释放幽灵材质。
- 诊断弹窗增加**材质类型**（如 `ShaderMaterial（uniforms: map, SHADE, …）`），方便确认走的是哪条分支。
- 单测仍为 **94 项**（测试 mock 没有 `MeshBasicMaterial`，走克隆兜底路径）。

## 0.44.0
- **修视图联动只匹配到 1 个分组**（诊断里 `映射节点→分组 20`、`匹配到分组 1`）：`simEvaluate` 返回的多是 composite 内部的临时 `model` 节点，它们没有登记到 `groupNodes`。现在这些节点也登记到所属分组：
  - composite 自己几何生成的 `model_node`；
  - `range_dispatch` / `select` 的 fallback 节点；
  - 多轴方块拆出的独立节点（登记到它的父分组）。
- **condition 的未选中分支也参与求值**（标 `hit=false`）：结果区会把它列为 ✘，视图联动也能把未生效的分支隐藏/半透明；命中数不变。
- 用真实 `assembly.bbmodel` 离线核对：`groupNodes 25 / 分支 10 / 匹配 10`（此前 composite 叶子全部匹配不到）。
- 单测扩到 **94 项**：新增 condition 两分支、composite 内联节点反查分组。

## 0.43.0
- **修视图联动“改了没反应”**：Blockbench 在选中/更新时会重置 `mesh.material`（`updateSelection` 里按 `texture.getMaterial()` 重设）与 `mesh.visible`（`updateVisibility`），0.42.0 只贴一次，很容易被盖回去。
  - 现在联动开启时每 **250ms 重贴**一次；检测到材质/可见性被重置会自动重新克隆/隐藏；
  - 下拉统一走 `simSetViewMode()`，切回「不处理」立即恢复并停止重贴。
- 新增 **`Tools → 诊断：模拟视图联动`**：弹出「模式 / 映射节点→分组数 / 本次分支数 / 匹配到分组数 / 未命中分组及其方块与材质数量」，用来定位“根本没匹配到分组”的情况。
- 单测扩到 **91 项**：新增材质被重置、可见性被重置后的重贴断言。

## 0.42.0
- **视图联动：不活跃分支自动隐藏 / 半透明**（交接文档待办 8）。模拟面板控制条新增「不活跃分支：不处理 / 半透明 / 完全隐藏」。
  - **半透明**：只克隆**运行时材质**并设 `transparent + opacity 0.28 + depthWrite false`，不改纹理、UV 与元素数据，也不写项目/撤销。
  - **完全隐藏**：只设 `group.mesh.visible = false`（运行时），不动 `group.visibility`。
  - 关闭联动 / 切换项目 / 卸载插件时自动恢复；结构变化后已不在映射里的分组也会恢复，避免残留「幽灵」。
  - 导出器新增旁路表 `groupNodes`（映射节点 → 来源分组），**不参与导出**。
- 单测扩到 **87 项**：新增半透明、隐藏、恢复等断言。

## 0.41.0
- **分支前缀自动清理**：分组从 `range_dispatch` / `condition` / `select` 下挪到根目录或普通父级时，名称里的 `[k]` / `⚠` 前缀会被自动去掉；仍在分支容器里的编号保留。
- **新增「枢轴归位（对齐几何中心）…」**（Tools）：把每个分组的 `origin` 移到它（含子分组）所有方块中心的平均值，同时补偿方块坐标，**模型外观不变**。
  - 补偿公式 `d = (I − R⁻¹)(O′ − O)`；子分组按 `R_c⁻¹ d` 递归，嵌套多次旋转也正确（用真实 `assembly.bbmodel` 的 153 个角点验证，误差 0）。
  - 解决「嵌套旋转后旋转/移动工具的手柄离几何很远、内置『枢纽居中』会歪」的问题。
  - 范围可选「全部分组 / 选中的分组（含子分组）」，支持撤销。
- 单测扩到 **75 项**：新增前缀清理、枢轴归位后世界坐标不变等断言。

## 0.40.0
- **修「未活跃项打不开」**：关联分组里的未活跃折叠原本是 `innerHTML` 里的原生 `<details>`，在面板重渲染/事件环境下点不开。改成自绘「▸ 未活跃 N 项」按钮 + 内容块，事件委托挂在槽的容器上（`innerHTML` 重建后依然有效），展开状态记在 `sim.usageOpen` 里，重算后不会自动收起。
- **每个槽可单独开关**：槽标题行加了复选框（默认开），只影响该槽是否参与求值与自动变化；关掉的槽变淡且不显示命中角标。改值/改索引会自动勾上该槽和它的大类。
- **性能优化**（输入不再卡）：
  - `buildMapping()` 结果缓存到 `sim.mapping`，输入变化只重算求值，不再每次重建整棵映射；结构/属性变化时由事件与 `simInvalidate()` 置脏，并补了一个 **「⟳ 刷新」** 按钮兜底；
  - `collectInputUsage()` 同样缓存；
  - 值/索引输入框走 **40ms 防抖**（`simScheduleTick`），连续敲字不会每键重建；
  - 自动变化的每拍会重新检查启用状态，全部关掉自动停。
- 单测扩到 **70 项**：新增槽级开关（关掉后不再参与求值）、未活跃项用自绘按钮等断言。

## 0.39.0
- **修复「值完全没反应」**：`simTick` 依赖的 `sim` 状态对象与 `simEvaluate` 一起在 0.30.1 被误删，任何输入变化都在 try/catch 里静默抛 `ReferenceError`。现已恢复；改值会立即重算，并自动勾选该大类（避免“改了没反应”的错觉）。
- **模拟面板按需求重排**：
  - 大类标题行：折叠箭头 + 复选框 + 名称/提示 +「未启用」状态；整个大类可折叠（默认展开）。
  - 每个槽（索引）独立一行：折叠箭头 + 槽号 + 索引 + 值 + **命中角标**；展开后是该槽自己的**自动变化控制器**（周期/步长/规则/上下限）与**关联分组/活跃项**。
  - 去掉 `floats` 下多余的「自动变化」复选框：大类复选框就是开关，点「运行」后所有已启用的数值槽按各自控制器变化。
  - 运行状态可见：按钮在「▶ 运行 / ■ 停止」之间切换并高亮，右侧显示「已停止 / 运行中 · N 个自动槽」；没有可自动变化的数值槽时给出提示且不进入运行态。
- 单测扩到 **65 项**：新增折叠/展开、每槽命中角标、值驱动求值、运行状态等断言。

## 0.38.0
- **目标版本移入项目设置**：`项目设置 → 目标 Minecraft 版本（pack.mcmeta 格式）` 改为下拉（Blockbench 对带 `options` 的属性渲染为 select）；删除 File 菜单里的「目标 Minecraft 版本…」（它是重复入口，且当时只是个对话框）。老项目没有该字段时自动补 `26.2`，避免下拉落到第一项 `26.3`。
- **模拟输入面板重排**：每行改为「标题 + 输入始终可见」，不再用 `<details>` 把 `cmdata.floats` / 索引 / 值折叠起来——旧组装在最后把名称与输入整簇移进了可折叠的 body，`<summary>` 里只剩下「索引 0/1/2」，看起来像标题。
  - 第一行：勾选 + 名称 + 中文提示（如 `cmdata.floats · range_dispatch 数值`）；`floats` / `colors` 下面是三个可见的「槽 1/2/3（索引 + 值）」。
  - 「自动变化」只保留在 `floats`；自动变化时三个槽一起动，能直接看到数值在变。
  - 关联分组按**每个槽自己的下标与值**渲染，并统一交给 `refreshUsage` 写入（`simTick` 不再和它抢 DOM），顺手修掉恒取第 0 项的老问题。
  - 去掉重复的关联信息容器和依赖 `details` 顺序的 DOM 查询。
- 单测扩到 **53 项**，新增「面板结构」断言：标题与输入必须在行内、不得位于 `<details>` 里。

## 0.37.0
- **修正 `pack.mcmeta` 的格式号**：26.2 的资源包格式是 **88.0**（旧代码写死 71，那是 1.21.5 的值）。版本表按 minecraft.wiki 校对到 26.3。
- **1.21.9 起改用 `min_format` / `max_format`**（25w31a 起 `pack_format` 变为可选）；按目标版本自动决定写哪一组字段，`minor ≠ 0` 时写 `[major, minor]`。
- 新增 `imm_pack_version` 项目属性（0.38.0 起在项目设置里是下拉），可选 1.21.4 – 26.3；新建资源包工程按所选版本写 `pack.mcmeta`。
- **恢复 0.30.1 被误删的 `simEvaluate` / `simValue`**：模拟面板此前点「运行 / 停止」会抛 `ReferenceError: simEvaluate is not defined`。
- **补全模拟求值**：`select` 按 `strings[index]` 匹配 `cases[].when`（首个命中优先，否则 `fallback`）；`condition` 支持 `custom_model_data → flags[index]`、`using_item`、`damaged`。
- 修正 `range_dispatch` 的 fallback 条件写反（有命中阈值时不该再用 fallback）。
- 修正 `condition` 走到 `on_false` 时被标成「未命中」的问题。
- 新增离线单测 `_test_sim.js`（34 项断言），覆盖 select / range_dispatch / condition / composite / pack 版本表；`_test_assembly.js` 的 mock 补上 `Face`。

## 0.7.0
- **补上多轴旋转的回退路径**（对齐旧插件）：多轴旋转的方块不再静默丢旋转，而是拆成独立的 `minecraft:model` 子项，用 `transformation` 表达旋转（枢轴 = 方块 `origin`）；单轴方块仍合并在本分组的模型文件里。
- `range_dispatch` 的 fallback 现在也能用这种独立子项。

## 0.6.1
- **回退 1.5.0 的“几何居中到 (8,8,8)”**：包围盒按元素自转后的角点计算，当元素自转枢轴离方块很远时会算出过大的平移量，把 `from/to` 推到 40 以上。回到旧插件的行为：方块坐标原样写出。

## 0.6.0
- **每份模型几何居中到 (8,8,8)**：元素 `from/to` 与元素 `rotation.origin` 一起平移，所有位移/旋转改由 `transformation` 承担，元素坐标始终在 `[-16,32]` 内。
- 无旋转的分组现在也会输出纯平移的 `transformation`（用于承载居中偏移）。

## 0.5.0
- 「检查装配结构」升级为**变换诊断**：逐个分组打印 `origin` / `rot` / 四元数 / 旋转角 / 计算出的 `translation`。

## 0.4.0
- 合并到资源包时，确认框**列出将被覆盖 / 新建 / 删除的具体文件**（每类最多 20 条）。
- 网页版等无本地文件权限的环境给出降级提示。

## 0.3.0
- 新增 **合并到资源包…**：用 `pickDirectory` + `requireNativeModule('fs', {scope})` + `writeFile` 直接写入目标资源包，覆盖同名文件，并用 `.imm-assembly-manifest.json` 清理上一轮生成的过期文件；目标路径记入项目设置。

## 0.2.0
- 分组属性编辑对话框（`Tools → 编辑分组映射属性…`，也尝试挂到分组右键菜单）：`imm_type` / `imm_model` / `imm_property` / `imm_index` / `imm_threshold` / `imm_scale` / `imm_tints`。
- 说明：Blockbench 不会把 `exposed` 的分组属性渲染成面板，故自带对话框。
- 项目属性：`imm_namespace` / `imm_center_pivot` / `imm_block_display` / `imm_pack_path`。
- 变换枢轴默认改为 block 原点 `(0,0,0)`（= 像素 0,0,0）；`(0.5,0.5,0.5)`（= 像素 8,8,8）为可选项。

## 0.1.0
- 注册模型格式 `item_model_definition_assembly`（物品模型映射装配）。
- 每个分组 → 一个映射节点：`composite` / `model` / `range_dispatch` / `condition` / `empty`。
- 分组变换 → `transformation`（`left_rotation` 四元数 + `translation` 枢轴补偿，单位：格）。
- 每层分组的方块合并进同一模型文件，`from/to` 保留负尺寸，单轴旋转写成元素 `rotation`。
- 支持 `can_convert_to`（Project → Convert）与 `parent_model_id`；导出 zip（items + models + textures + notes）。
