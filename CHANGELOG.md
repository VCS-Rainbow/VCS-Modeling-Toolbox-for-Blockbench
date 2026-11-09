# 更新日志

版本规则：**开发阶段主版本号保持 0（0.x.y）**——修 bug 用 patch（0.6.x），加功能用 minor（0.x.0），每次改动都 bump 并打 git tag `v<版本>`；正式发布时才升到 1.0.0。

## 0.73.16
- **修 0.73.15 遗留：非 IMDA 格式仍会残留空的右键菜单分隔线。** 0.73.15 只按 `id` 过滤 `imda_*`，但 `MenuSeparator` 经 Blockbench 渲染后会在 `menu.structure` 里变成 `null` 占位，过滤不掉；而 `attachGroupMenu()` 在 `update_selection` 上高频执行，导致分隔线不断累积（实测 Cube 菜单积了 26 个 `null`），最终使其它格式的方块右键菜单异常。
  - 新增 `imdaMenuSnapshots`（`WeakMap`）：首次改写前保存**干净的原生菜单结构**（同时剔除历史遗留的 `null` 与 `imda_*`）。
  - 非 IMDA 格式：`cleanAllImdaMenus(true)` 直接**整体恢复快照**，不再做增量过滤。
  - `cleanImdaMenu()` 同时剔除 `null`/`undefined` 项。
  - 插件卸载时也恢复快照。
- 单测：菜单隔离 5 项继续通过，`_test_sim.js` 合计 **381 项**。

## 0.73.15
- **修：插件会改写其它格式的右键菜单，导致非 IMDA 项目里方块不能正常弹出右键菜单。** 根因是插件把菜单项/分隔线挂到了 Blockbench 内置原型（`Cube.prototype.menu`、`Group.prototype.menu`、`Locator.prototype.menu`、`Animation.prototype.menu`）上，且加载时无条件执行；其它格式下虽然 `condition` 会隐藏项，但菜单结构已被污染（可能出现空菜单）。
  - 新增 `cleanImdaMenu()` / `cleanAllImdaMenus()`：移除所有 `imda_*` 项并清掉挂载标记。
  - `attachGroupMenu()` 开头先无条件清理，再 `if (!isImdaFormat()) return;`——非 IMDA 格式不再做任何菜单写入。
  - `attachAnimationTimelineMenu()` 同样按格式门控：非 IMDA 会移除已挂的 `imda_timeline_*` 项。
  - `时间轴属性…` 动作的 `condition` 增加 `isImdaFormat()`。
  - 插件 `onunload` 时清理所有原型菜单，卸载后不留残留。
- 单测：新增「菜单格式隔离」5 项（非 IMDA 不写入分组/方块菜单、原项保留、切回 IMDA 能重新挂载），`_test_sim.js` 合计 **381 项**。

## 0.73.14
- **修：display 副本模型缺少 `textures.particle`，Minecraft 报 `Missing texture references ... particle`**。副本原本只有 `{ parent, display }`，从父模型继承贴图；而源模型（如 `sac.empty`/`sac.full`）本身没有 `particle`，于是副本也被判缺贴图。
  - 新增 `Exporter.referenceParticleTexture()`：沿源模型 `parent` 链找第一个真实贴图路径（优先 `textures.particle`，次选任意非 `#` 引用的贴图）。
  - `unifyReferenceDisplay()` 生成的副本补 `textures: { particle: <路径> }`。
  - 旧生成模型（`addModel`）本来就写 `particle`，不受影响。
  - 注：日志里的 `minecraft:block/moving_piston`、`structure_void` 等是原版/其它模型，与插件无关。
- 单测：新增「父链贴图补 particle」与「只补 particle」断言，`_test_sim.js` 合计 **376 项**；其余套件 29+76+25+44+22 全通过。

## 0.73.13
- **子模型文件名去掉重复的主文件名前缀**：目录已经是 `models/item/jet_rifle/`，文件名不再写 `jet_rifle_`，直接 `sac.empty_display.json`、`bone5_group3_group2.json` 等。
  - `addModel()`：名字改为 `sanitizePath(hint)`，不再拼 `this.stem + '_'`。
  - `unifyReferenceDisplay()`：display 副本名改为 `<源模型最后一段>_display`，不再带 `jet_rifle_`。
  - `displayCarrierReference()`：载体名改为 `display`（`unique` 自动避让）。
- **display 只写“显示调整页里改过的槽位”**：
  - 新增 `DEFAULT_DISPLAY`（Blockbench 各槽默认变换）与 `sameSlotTransform()`。
  - `desiredDisplay()`：项目有显示调整数据时，逐槽与默认值比较，**相同则跳过**；没有显示调整数据时才回退到内置手持预设 `BLOCK_DISPLAY`。
  - 不再依赖 `imda_display_all_slots` 开关（保留属性但不再影响输出）。
- 单测：`_test_sim.js` 更新为新语义并新增「默认值不输出」断言，合计 **374 项**；其余套件 29+76+25+44+22 全通过。

## 0.73.12
- **修：display 副本文件名里带出源模型的目录段**，导致路径嵌套成 `models/item/jet_rifle/jet_rifle_item/inker/jet_rifle/sac.empty_display.json`。现在副本名只取源模型 id 的**最后一段文件名**（`sqsp:item/inker/jet_rifle/sac.empty` → `sac.empty`），并去掉所有 `/`，统一落在 `models/item/<item_id>/` 下。
  - `unifyReferenceDisplay()`（copy 模式）的 `base` 改为 `refLeaf`（`split(':').pop().split('/').pop()`）。
  - `addModel()` 的模型名也把 `/` 压成 `_`，避免分组标签里的斜杠再次制造子目录。
- 单测：新增 3 项（副本名不含斜杠、带目录源模型取 `sac.empty`、引用落在 item_id 目录）；`_test_sim.js` 合计 **373 项**。

## 0.73.11
- **生成的子模型统一放到 `models/item/<主文件名>/` 目录下**。以前子模型跟随命名空间子空间（`models/item/<subpath>/`），例如主文件 `items/inker/jet_rifle.json` 的子模型落在 `models/item/inker/jet_rifle_xxx.json`；现在改为落到 `models/item/jet_rifle/jet_rifle_xxx.json`（`inker` 不再进入子模型目录）。
  - 新增 `Exporter.modelDir()`：取 `item_id` 的最后一段作为子模型目录名。
  - 新增 `Exporter.modelRefBase()`：模型引用前缀改为 `ns:item/<item_id>/`；`addModel` / `unifyReferenceDisplay` / `displayCarrierReference` 三处引用统一走它。
  - `buildFiles()` 里模型文件路径改为 `assets/<ns>/models/item/<modelDir>/<name>.json`；主文件 `items/...` 路径不变（仍带 subpath）。
  - `createModelFromGroup()` 写盘目录同步改为 `models/item/<modelDir>/`，与引用一致。
- 单测：`_test_sim.js` 更新子空间路径断言并新增「主文件名子目录」5 项（`modelDir`/`modelRefBase`/引用/文件路径/不再落 `inker/`）；合计 **369 项**，其余套件 29+76+25+44+22 全通过。

## 0.73.10
- **引用模型的 display（显示调整）覆盖方式改为「新建以源模型为 parent 的子模型」**。原来检测到 imda 显示参数与引用模型不一致时，会把源模型的完整数据（elements/textures…）复制一份再改 `display`；现在改为只生成 `{ parent: <源模型 id>, display: <imda 显示参数> }` 的轻量模型文件，几何/纹理全部继承源模型，只覆盖显示调整，避免复制大模型、也避免两处几何不一致。
  - `unifyReferenceDisplay()`（copy 模式）改写：输出 `{ parent, display }`，不再 `Object.assign({}, source.data, …)`。
  - 新增 `effectiveReferenceDisplay()`：沿源模型的 `parent` 链求**有效 display**（子槽覆盖父槽），用于判断是否真的“不适配”。
  - 新增 `sameDisplay()`：归一化比较（忽略零旋转/零平移/单位缩放，6 位小数），避免因默认值/键序差异误判。
  - `readReferenceModel()` 返回值补充 `fsmod`，供父链读取。
  - overwrite 模式不变（仍直接改写源模型文件的 `display`）；源模型不在本地资源包时保持原引用不动。
- 单测：`_test_sim.js` 新增「引用模型 display 覆盖」6 项（生成 parent+display、不内联 elements/textures、缓存复用、已适配不新增、父链继承判定），合计 **364 项全部通过**。

## 0.73.9
- **编号格式变量 `n` 的缺省值改为「本分支在同层分组里从上往下数的序号」**（原来缺省一律 1）。例：`slots{ a, b, c }` 三个子分组的 `n` 分别是 **1 / 2 / 3**，于是它们各自写 `ni` 时，子分支阈值分别得到 `0,1` / `0,2` / `0,3`。
  - 新增 `siblingBranchNumber(node)`：返回节点在同层分支子项（分组 + 复调用标签，按大纲顺序）中的 1 起序号；根目录下返回 `undefined`。
  - `branchSelfNumber(group)`：挂在 `range_dispatch` 下仍优先用它的 `imda_threshold`；否则退回 `siblingBranchNumber()`（根目录下才是 undefined → `evalThreshold` 缺省 1）。
  - 导出器把该序号沿 `buildNode(..., selfNumber)` 往下传：新增 `Exporter.siblingIndexOf(parent, child)`，`select` 分支和普通 composite/model 的子分组递归都会传（`range_dispatch` 子分支仍传各自算出的阈值）。
  - 属性面板「分支编号格式」说明同步更新。
- 单测：`_test_threshold_n.js` 增到 22 项（新增 `siblingBranchNumber` = 1/2/3 与导出级 `ni` → `0,1`/`0,2`/`0,3`）；合计 22 + 25 + 76 + 350 + 29 + 44 = **546 项**。
- 备注：仍无 CDP，未真机验证；文件已部署，重载插件/重启后生效。

## 0.73.8
- **修：range_dispatch 总控下的「复调用标签」名字前不显示序号**。复调用标签是自定义元素 `imda_call_tag`（继承 `Locator`，但导出器把它也当作 range_dispatch 的 `entries`），而 `syncBranchLabels` / `sortBranchChildren` / `stripChildPrefixes` 之前只处理 `isGroup` 子节点，导致标签永远不加 `[阈值]` 前缀。
  - 新增 `branchChildNodes(group)`：分支子节点 = 分组 + 复调用标签（`isCallTag`），顺序与导出一致（先分组，再标签）。
  - `syncBranchLabels` / `sortBranchChildren` / `stripChildPrefixes` / `stripStrayBranchPrefixes` 全部改为同时处理复调用标签；标签阈值取 `imda_call_overrides.threshold`（无则按序号），与导出语义一致。
  - 新增 `add_locator` 事件触发分支同步；`复调用选中的分组`、`添加复调用标签` 在父级是分支容器时也会刷新序号。
  - 载入/重载插件及 `select_project` / `finished_loading_project` 时跑一次 `syncAllBranchLabels()`（只改名/阈值、不排序），让已存在的结构也能立刻补上序号。
- 单测：`_test_sequence_child.js` 增到 44 项（新增 range_dispatch 下复调用标签编号、分组优先顺序、改回 composite 去前缀、`syncAllBranchLabels`）；合计 44 + 17 + 25 + 76 + 350 + 29 = **541 项**。
- 备注：仍无 CDP，未真机验证；文件已部署，重载插件/重启后生效。
## 0.73.7
- **生成复调用序列后更新「大纲格式」**：生成完成后对容器执行 `sortBranchChildren` + `syncBranchLabels`，让子分支名按容器类型刷新前缀（range_dispatch → `[阈值]`、condition → `[on_true]/[on_false]`、select → `[when]`），必要时按阈值重排；这两步放在 `Undo.finishEdit` 之前，改名/重排都进撤销记录。另外对 outliner 面板 `Panels.outliner.inside_vue` 调用 `$forceUpdate()`，让程序化新增的节点立即重绘。
- 单测：`_test_sequence_child.js` 增到 38 项（新增“分支名带 [阈值] 前缀”）；合计 38 + 17 + 25 + 76 + 350 + 29 = **535 项**。
- 备注：本轮仍无 CDP（Blockbench 无调试端口），未做真机热重载；文件已部署，重载插件/重启后生效。
## 0.73.6
- **生成复调用序列：子节点的映射属性可以在对话框里选**（原来每个 `#分支` 子分组写死 `imda_type='composite'`）。
  - 对话框新增「子节点类型（每个 #分支）」，可选 composite / inline / model / internal / range_dispatch / condition / select / empty（与「编辑分组映射属性」同一套类型）。
  - 选 `range_dispatch` / `condition` / `select` 这类**分支总控**类型后，出现对应子选项：property、index、分支编号格式、scale，以及 property 相关字段（compass target、time source、wobble、normalize、period、remaining）；容器为 condition 时还能选 on_true/on_false。
  - 实现：`buildSequenceChildResult(options)` 把对话框选择整理成 `imda_*` 结果对象，生成时对每个 `#分支` 子分组调用 `assignGroupMapProps(node, childResult)`（复用属性面板同一套赋值/清空逻辑），再按容器 range_dispatch 写 `imda_threshold`。
  - 容器相关字段（property/index/阈值格式/起点/步长）改成仅在「容器节点类型 = range_dispatch」时显示。
  - 单测新增 `_test_sequence_child.js`（37 项：`buildSequenceChildResult` 各类型/字段、`assignGroupMapProps` 集成、`generateCallSequence` 端到端生成子节点类型/字段）。
- 单测合计：37 + 17 + 25 + 76 + 350 + 29 = **534 项**。
- 备注：本轮 Blockbench 以**无远程调试端口**方式重启（CDP 9222 不可用），未做真机热重载验证；插件文件已部署，重启 Blockbench 或重载插件后生效。
## 0.73.5
- **复调用标签右键菜单再调整**：
  - 顺序改为：`… → 提取变换 → 应用变换 →（分割线）→ 实例化同组复调用标签 → 编辑复调用标签…`。即「实例化」在「编辑」正上方（编辑仍在最下），并在「实例化/编辑」与「提取/应用」之间加一条分割线。
  - **提取变换 = Ctrl+Shift+C，应用变换 = Ctrl+Shift+V**：把快捷键设在基础动作 `imda_extract_pose` / `imda_apply_pose` 上（全局生效，工具菜单/右键都可用）；右键菜单项用「普通对象」渲染（`{name,icon,keybind,condition,click}`），`keybind` 只用于显示标签、**不重复注册**全局快捷键，避免触发两次。
  - 真机验证：菜单末尾依次为 提取变换(Ctrl+Shift+C) / 应用变换(Ctrl+Shift+V) / 分割线 / 实例化 / 编辑；两个基础动作 `BarItems` 的 keybind 为 key=67/86、ctrl+shift，标签正确。
- 单测合计：17 + 25 + 76 + 350 + 29 = **497 项**。
## 0.73.4
- **调整复调用标签右键菜单顺序**：「编辑复调用标签…」固定放到菜单最下（实例化同组复调用标签 → 提取变换 → 应用变换 → 编辑复调用标签…）。仅调整 `attachCallMenu` 里 `addAction` 的先后，逻辑不变。
- 真机验证：菜单末尾依次为 实例化 / 提取变换 / 应用变换 / 编辑复调用标签…（编辑为最后一项）。
## 0.73.3
- **修「右键复调用标签的菜单里只剩通用项、插件动作全没了」**。
  - 根因：`CallTag` 是自定义元素类型，每次重载插件都会 `registerType` 一个**新类**；而大纲里已有的复调用标签节点仍属于**上一次注册的旧类**，它们的 `prototype.menu` 是各自独立的 `Menu` 对象。之前 `attachGroupMenu` 只给「当前 CallTag 类 + Locator 类」的原型挂插件的 4 个动作，**没管旧类**，所以重载后这些节点的右键只剩复制/重命名/删除等通用项。
  - 修复：`attachGroupMenu` 现在收集「Locator 原型 + 当前 CallTag 原型 + 大纲里每个复调用标签节点自己的 `node.menu`」三处的去重 Menu 对象，逐一挂载插件动作；因此无论节点属于哪一代类，右键都有「实例化同组复调用标签 / 编辑复调用标签… / 提取变换 / 应用变换」。
  - 用 `menu.__imdaCallAttached` 标记幂等，`update_selection` 高频触发也不会重复叠加；`menuActions` 键加入自增序号 `menuActionSeq`，避免旧类菜单与当前类菜单共用键互相覆盖。
  - `onunload` 同步清理所有（含旧类节点的）Menu 上的 `imda_*` 项并清标志、重置序号，重载不留残项。
  - 真机验证（0.73.3，assembly 工程实测 4 个旧类标签）：重载后旧节点菜单由 12 项 → 17 项（含 4 个插件动作）；5 次 `update_selection` 后仍为 17 项、渲染无重复；二次重载后仍 17 项。
- 单测合计：17 + 25 + 76 + 350 + 29 = **497 项**（菜单属 Blockbench 运行时，用真机探针验证）。
## 0.73.2
- **编号格式的变量 `n` 缺省值改为 1**（原来缺省 0）：当本分支上层没有编号（例如顶层 range_dispatch）时，`ni` 现在等价于 `i`（0,1,2），而不是全是 0。
  - `evalThreshold` 里 `n` 缺失/非数字时按 1。
  - `syncBranchLabels` 刷新名字时改用 `branchSelfNumber(group)`：只有分组确实挂在 `range_dispatch` 下才算有编号（取其 `imda_threshold`），否则视为“无编号”→ 1，保证界面显示和导出结果一致。
  - 真·0 号分支（`imda_threshold=0` 且在 range_dispatch 下）仍然用 0。
  - `_test_threshold_n.js` 17 项（新增“缺省=1”“显式 0 用 0”“顶层 ni=0,1,2”）。
- 单测合计：17 + 25 + 76 + 350 + 29 = **497 项**。
## 0.73.1
- **修「编辑分组映射属性…」改完 Ctrl+Z 撤不干净（看起来像撤不掉）**：
  - 旧实现 `Undo.initEdit({ groups: targets })` 只快照**目标分组本身**，而 `getChildlessCopy` 不含子节点。可改映射类型时 `syncBranchLabels` 会给子分支加 `[n]` 前缀、`sortBranchChildren` 会重排子节点——这些都没进撤销记录。于是撤销后父分组的属性回去了、子分支的名字/顺序却还在，观感就是“属性没撤回”。
  - 改法：撤销范围扩大到「目标分组 + 其整棵子树 + 父分组」，aspects 用 `{ outliner: true（结构/顺序）, groups: <这些分组>（名字/自定义属性）, elements: <子树里的方块>（walkTint 会改 faces[].tint） }`；`finishEdit` 用同一组 aspects。`outliner` 负责找回复排后的顺序，`groups`（含子节点）负责找回原名，方块负责着色。
  - 另外：`applyChanges` 出错时调用 `Undo.cancelEdit()` 结束当前撤销会话，避免留下半截 `current_save` 让后续 Ctrl+Z 全部失效。
  - 验证：真机探针检查撤销记录——`before.groups` 现在包含子分支且是**旧名字**（`P3, b1, b2`）、`before.outliner` 存在；apply 后 `post` 是 `P3, [0] b1, [1] b2`。
- 说明：插件的 `imda_*` 属性没有声明 `inputs.element_panel`，**不会出现在 Blockbench 右侧原生属性面板**；「属性编辑」只能走插件的「编辑分组映射属性…」对话框（Blockbench 自身面板只登记带 `inputs.element_panel` 的属性）。
- 单测 494 项全过（撤销属于 Blockbench 运行时行为，单测里的 Undo 是桩）。
## 0.73.0
- **range_dispatch 分支编号格式新增变量 `n`**：`n` = 本分支在上层节点里的编号（阈值）。
  - 例：外层 `slots` 格式 `i` → 第 6 个分支 `slots[5]`；它自己的格式 `ni` → 子分支阈值 `0,5,10`（= 5 × i）。
  - 支持 `n`、`ni`、`2n`、`n+i`、`n*i` 等写法，和原有 `i` 共用同一套隐式乘法规则（`2i→2*i`、`ni→n*i`、`2n→2*n`）。
  - 实现：
    - `evalThreshold(format, index, n)` 增加第三参 `n`（缺省按 0）。
    - `Exporter.buildNode(group, hint, parent_shift, selfNumber)` 新增 `selfNumber`；`range_dispatch` 循环里先把每个子分支的阈值算出来，再把它作为 `n` 递归传给子分支的 `buildNode`（所以嵌套 `ni` 用的就是子分支自己的编号，不依赖是否手动同步过）。
    - `syncBranchLabels` 刷新名字/阈值时用分组自身的 `imda_threshold` 当 `n`。
  - 单测：新增 `_test_threshold_n.js`（14 项：`evalThreshold` 的各写法 + 导出级嵌套 `ni` = 0,5,10）；真机探针 `_probe_threshold_n_live.js` 9/9（真实 Blockbench 运行时、在"脱离大纲的分组树"上跑 `buildNode`，不碰用户工程）。
- 单测合计：`_test_threshold_n.js` 14 + `_test_convert.js` 25 + `_test_all_items.js` 76 + `_test_sim.js` 350 + `_test_export.js` 29 = **494 项**。
## 0.72.0
- **重新设计「将分组转化为复调用标签」**。旧实现和「复调用选中的分组」产出的节点完全一样（同样指向分组自己的位置/旋转、`imda_call_target = 分组自身.uuid`），只是多设了一个 `group.export = false`；导出后净效果不变，等于没转化 —— 这就是用户看到的「结果和复调用标签一样」。
  - **新语义**：选中分组 → 弹窗选一个**已存在的其它分组** T → 把选中分组**原位替换**为指向 T 的调用标签。
  - 标签**只保留原分组自身的位姿**（位置 = 原 `origin`，旋转 = 原 `rotation`），几何由目标 T 提供；原分组连同几何删除。
  - **原位替换**保留兄弟顺序：`at = siblings.indexOf(group)` → `addAndInit` → 把标签挪到 `at` → `group.remove()`。
  - **多选**：一个弹窗选一个 T，全部指向它；只处理"最外层"选中分组（子分组随祖先一起删）；候选目标排除被删分组及其全部后代（避免选中一个会被连带删掉的分组）。
  - **修一个真机隐患**：`CallTag.init()` 会把根级标签塞进 `Group.first_selected`（正是这次要删的那个分组）；若不处理，标签会跟着被删。转换时检测到被重挂就强制拉回目标父级。
  - **单测**：新增 `_test_convert.js`（25 项：根级/嵌套原位替换、兄弟顺序、位姿、目标、最外层过滤、删除集合候选、无目标不动手）；真机探针 `_probe_convert_live.js` 12/12（用真实 Blockbench CallTag 类在"脱离大纲"的分组树上验证，绝不碰用户真实工程）。
- 单测合计：`_test_convert.js` 25 + `_test_all_items.js` 76 + `_test_sim.js` 350 + `_test_export.js` 29 = **480 项**。
## 0.71.1
- **修「生成全物品模型表」把每个分支都跑成根级节点**：`new Group()` 的 `parent` 默认是 `'root'`，原来只把 case 分组 `push` 进 `container.children` 而没有改 `parent`；随后调用 `caseGroup.init()` 时，真实 Blockbench 的 `OutlinerNode.init()` 有一段
  ```js
  if (!this.parent || (this.parent === 'root' && Outliner.root.indexOf(this) === -1)) this.addTo('root')
  ```
  于是每个 case 既在容器 children 里、又被自己塞进根目录 —— 表现就是「除了 [all items] 容器，最上层还有一大堆引用节点」。
  - 改法：case 分组改用 `caseGroup.addTo(container)`（`addTo` 会同时改 `parent` 并加入 children）；容器先 `addAndInit` 进大纲，**再** init 子节点（此时它们 `parent` 已指向容器，不会再触发那段判断）。
  - 同时修掉 `_test_all_items.js` 里 mock 的两处失真（`addTo` 不认 `'root'` 字符串、`init()` 没复刻上面那段副作用），并加了回归断言：生成后 `Outliner.root.length === 1`、没有 case 混进根目录、每个 case 的 `parent` 指向容器。
- 单测：`_test_sim.js` 350 + `_test_export.js` 29 + `_test_all_items.js` 76 = **455 项**。
- 新增 Tools →「清理大纲重复节点」：删掉"同时挂在某个分组 children 里、又挂在根目录下"的重复节点。已经用 0.71.0 生成过表的工程，用这个一次性清掉遗留的重复分支（容器里的原件保留）。生成表时也会自动先清一次。
## 0.71.0
- **新增「生成全物品模型表」**（Tools → 结构）：扫描资源包里的全部 `assets/*/models/**/*.json` 与 `assets/*/items/**/*.json`，生成一个 `select` 容器，每个路径一个 `model` 分支。
  - `when` 列表同时包含**无类型路径**（`sqsp:inker/jet_rifle/gun`）与**带类型路径**（`sqsp:models/inker/jet_rifle/gun` / `sqsp:items/inker/jet_rifle/gun`），任一种匹配都能选中。
  - **映射优先**：同一路径既有模型又有映射时只保留映射分支，模型不单独成 case（其无类型路径已并入映射的 `when`，且只出现一次）。
  - **两种匹配依据**：
    - `custom_model_data` → `"property": "minecraft:custom_model_data"` + `"index"`，`when` 是字符串数组；
    - 物品数据 → `"property": "minecraft:component"` + `"component": "minecraft:custom_data"`，`when` 元素是 `{"id": "ns:path"}` 对象数组。
  - **黑名单**：多行正则，按相对路径匹配，可反复使用（存进 `imda_all_items_blacklist`）。无效正则会被单独报告并跳过，不影响其它条目。
  - **只导入模型 / 只导入映射**：两个复选框。
  - 生成前会把所有映射定义**预读进项目缓存**（`primeMappingCache`）：导出路径只读缓存、不碰文件系统，避免权限弹窗；读不到 `model` 字段的"假映射"会被跳过而不是导出成非法引用。
- **修 `parseMappingReference` 不支持带空格路径**：原来是 `[^\s]+`，资源包里 `jet_rifle copy.json` 这类文件名会被判成非法引用，导出时退化成 `minecraft:model` + `"model": "ns:items/…"`（原版 model 字段只能指向 `models/`，整条分支失效）。实测真实资源包有 20 个映射条目，修好后 19 个能正确内联成 `minecraft:composite`，剩下 1 个是真的没有 `model` 字段。
- **修 `select` 导出的两处**：`when` 为空的分支会被跳过并告警（原版会当成永不命中）；`when` 支持对象字面量（component 模式需要）。
- 新增 `imda_case_when` 属性面板字段（原来只有导出用，界面里改不到）。
- 新增 `_test_all_items.js`（63 项）：用**真实的临时目录树**当资源包，覆盖递归扫描、黑名单正则、无效正则、只导入、映射优先、带空格路径、无 model 字段跳过、两种 property 模式、导出 JSON 形态、`parseWhen` 兼容性。
- 单测：`_test_sim.js` 350 + `_test_export.js` 29 + `_test_all_items.js` 63 = **442 项**。
## 0.70.2
- 更正文档口径：`node_name` 是**用户要求**的字段（导出带来源分组名，方便人工复核 JSON 时对上是哪个分组），不是“应当关闭的非标准字段”。`_test_export.js` 的字段白名单继续对它单独放行并只统计数量。
## 0.70.1
- **修 range_dispatch 的 property 漏前缀（导出直接失效）**：0.69.14 把 `imda_property` 改成存裸名后，`buildNode` 里那行 `String(group.imda_property || 'minecraft:custom_model_data')` 只在**字段为空**时才带前缀，非空时把 `"property": "custom_model_data"` 原样写进文件 —— 原版不认这个值，整条 range_dispatch 失效。现在统一 `'minecraft:' + 裸名`。
- **修 range_dispatch 的 entries 阈值顺序**：原版语义是「取最后一个 threshold ≤ 当前值的条目」（Minecraft Wiki 原文：*Will select last entry with threshold less or equal to property value*），也就是**判定顺序 = entries 数组顺序**。分支编号格式写成 `5-i` 时，大纲里 `[5][4][3][2][1]` 算出的阈值是 5,4,3,2,1（递减），原样输出会让每个值都命中列表末尾那条分支。现在导出时按阈值**升序稳定排序**（同值保持大纲顺序）。
- **新增 `_test_export.js`（29 项断言）**：这是之前完全缺失的一环 —— 以前 300 多条断言只验证「内存里的映射结构」，从来没把文件**写到磁盘**再校验。现在覆盖：
  - 落盘后逐个 `JSON.parse`（自定义格式化器 `formatMapping` / `formatModel` 是手写拼字符串，语法错只有这一步能发现）；
  - 定义树逐字段校验（类型白名单、每类允许的字段、`transformation` 四个分量、四元数归一化、`scale` 无 0、`model` 引用格式、`range_dispatch` 阈值严格升序、`select` 的 `when` 必须是数组、`condition` 两侧齐全）；
  - 物品模型文件（`from`/`to`/`faces`/`display` 数值分量）；
  - 纹理引用与实际导出文件对账（引用了却没人提供 → 报错）；
  - 路径命名规范与重复检测；
  - **真实工程回归**：直接读 `assembly.bbmodel` 备份，跑一遍完整导出并校验（不写回任何文件）。
- 模拟面板新增「⏭ 步进」按钮：所有勾选的自动槽各推进一格并立刻求值，**不启动循环、不改运行状态**。推进规则抽成 `simAdvanceSlot()`，与「运行」共用同一套。
- 单测：`_test_sim.js` 350 项 + `_test_export.js` 29 项。
## 0.70.0
- **新增独立元素类型「复调用标签」（`imda_call_tag`）**，不再借用 Locator：
  - `ensureCallTagType()` 用官方 `OutlinerElement.registerType()` 注册，继承 `Locator`（保留 position / rotation / visibility / locked、精灵标记、保存加载链路），因此 `instanceof Locator` 仍成立 —— 插件里所有既有复调用代码（`Locator.all` / `Locator.selected` / `isLocator()`）一行都没改。
  - 自己的标题「复调用标签」、图标 `content_copy`、青色 3D 标记精灵、独立右键菜单；`unique_name: false`（同一目标会被多个分支反复调用，重名是常态）。
  - 名字净化放宽到支持中文（`调用 sacpack1` 不会被抹掉）。
  - 所有创建入口统一走 `newCallTag()`：复调用选中的分组、转换为复调用标签、生成复调用序列、动画时间轴帧标签。
  - 新增 Tools 菜单「添加复调用标签」（`addEmptyCallTag()`）：Blockbench 的「添加元素」菜单是**硬编码列表**，插件无法往里插，所以只能自己给入口 —— 在选中分组（或根目录）里建一个空标签，再用「编辑复调用标签」指定目标。
  - 旧的 Locator 型标签仍然完全可用（`isCallTag()` 两者都认）；新增 Tools 菜单「把旧复调用标签升级为独立元素…」（`upgradeLegacyCallTags()`，保留 uuid / 位姿 / 全部覆盖，可撤销）。
- **Shift + 左键跨分组连选**（修「1~5 分组 + 6 标签，点 6 再 Shift 点 1 只选中 6 和 1」）：
  - 根因：Blockbench 自带 Shift 连选只在**同一父级的兄弟数组**里取区间，且分组用 `Group.multi_selected.last()`、元素用 `Outliner.selected.last()` 两条独立记忆 —— 先点标签再点分组时两个 last 对不上，直接退化成普通加选。
  - 补丁 `installOutlinerRangeSelect()` 接管 `Group#clickSelect` / `OutlinerElement#clickSelect`：改为按**大纲先序表**取闭区间，区间内分组递归选中、元素 `markAsSelected`；锚点由插件自己记录。
  - 只在**跨父级或区间含复调用标签**时接管，同父级且无标签的情况完全交给 Blockbench 原生逻辑（原生行为本身正确）。
  - `onunload` 恢复原 `clickSelect`。
- 单测 350 项（新增 32 项：类型注册/标题/图标/可重名/继承关系、newCallTag 字段、旧标签兼容识别、升级保留 uuid/位姿/覆盖、先序表、正向与反向跨层连选）。
## 0.69.14
- **修「生成复调用序列」的 property 创建后没生效**：`generateCallSequence` 原来把 `imda_property` 写成 `'minecraft:custom_model_data'`（带前缀），而分组属性面板的 select 选项值是裸名（`custom_model_data`）→ 面板认不出选项、回落到「（未设置）」，看上去就是没应用，`compass` / `count` 这些条件字段也全都不显示。现在存裸名。
- **序列的阈值格式跟属性面板对齐**：对话框新增「分支编号格式（同属性面板）」输入框，复用同一个 `evalThreshold()`（支持 `i` / `2i` / `10+2i` / `0,1,3` / `2:2i`），填了就优先于「起点 + i × 步长」；格式同时写进容器的 `imda_threshold_format`，创建后属性面板显示与导出一致。
- **洋葱皮：位姿对齐时直接点亮源节点；不一致时临时实例化**：新增 `simPoseIsSame(locator, target)`（位置 + 旋转，容差 1e-4）。复调用标签所在分支被选中时：
  - 位姿**完全一致** → `simLightUpCallTargets()` 直接把源分组标记为活跃，**优先级高于「模拟输入未命中时的隐藏」**（`mark` 是 OR 合并，天然压过 inactive）；
  - 位姿**不一致** → `simEnsureCallInstance()` 临时复制目标分组一份、摆到标签位姿上、写入 `__immTempCall` 标记并 `export=false`（绝不进导出），熄灭时由 `simDropCallInstance()` 收回、转回复调用标签。副本登记在模块级 `simTempCalls`（`locator.uuid → {locator, group}`）；`simRestoreView()` 第 4 段会全量回收（含重载后登记表丢失、只剩标记的残留）。
  - 诊断用 `sim.lastLights = { lit, mismatched }`。
- 单测 318 项（新增 29 项：阈值格式解析、序列创建后 property / format / index / threshold、位姿相同/不同判定、点亮压过未命中隐藏、熄灭不点亮、临时实例化的创建/位姿/导出标记/收回/源节点不被改动）。
## 0.69.13
- **修「不活跃分支 = 不处理」时仍是洋葱皮 + 锁定**（三个原因一起修）：
  - `simRestoreView()` 原来只按 `sim.viewTouched` 恢复，而这份清单是内存里的 Set；**插件重载后清空**，但 `__immGhost` / `__immHidden` / `__immLock` 是挂在 mesh / 元素上的，标记还活着 → 显示「不处理」却没人去恢复。现在除了按清单恢复，还会**全量扫一遍大纲**把残留标记清掉。
  - 锁定基线原来存在 `group.__immLock` 上，重载后 `sim` 对象重建、但元素上的 `locked = true` 留着，于是锁**永远解不开**。现在基线存在 `globalThis.__immLockStore`（跨重载存活，按 `uuid|type` 建键）。
  - `simApplyGroupVisual` 在非锁定模式下只解锁 `seen` 里的分组；现在额外调用 `simUnlockAll()` 兜底。
- 新增 `simUnlockAll()`；`simRestoreView()` 改为「按清单 + 全量扫描 + 解锁仓库」三段式。
- 单测 289 项（新增 6 项：基线进 globalThis、模拟重载后切「不处理」仍能解锁、不处理模式无残留半透明/隐藏）。
## 0.69.12
- **多级分支的视图联动**（`sac_slots` 这类结构）：
  - `simEvaluate` 给每条 item 带完整 `branches` 链（每层容器记「选了哪一支」），不再只记最内层——外层 `range_dispatch` 会把内层 branch 覆盖掉，之前 `[5] → 调用 sacpack2 → [0] _empty2` 全判不出来。
  - 空分支（只有复调用 Locator、不产出 item）靠求值时的 `trace.seen/selected` 判定活性，不再靠“有没有命中节点”猜。
  - 分支内容 = 分支自身 + 直属子分组 + 直属复调用标签指向的目标分组（`[4]`..`[1]` 里只有标签，模型挂在 `[5]` 里）。
  - `uuid → 分组` 索引优先从大纲真实树建立：`Group.all` 里残留的同名同 uuid 旧副本没有几何，解析到它们等于什么都没做。
  - `entries` 按分组深度排序（祖先先、后代后），深层判定覆盖祖先的整棵递归。
- 单测 283 项。
## 0.69.11
- **复选框只管「要不要自动变化」，不再决定值存不存在**（按用户要求）：
  - `simTick` 不再跳过未勾选的槽：**所有槽的手动值一律写进 inputs 参与求值**，勾不勾结果一致。
  - 命中角标同理，未勾选的槽也照常计算（只是不参与自动轮换）。
  - 槽复选框取消后不再变灰，槽名后标「（不自动）」，值原样留在输入框与 `slot.value` 里。
- **改值不再自动打开循环**：删掉 `ensureEnabled()`（改值/改索引时自动勾上大类与槽复选框）。现在改手动值不会勾选任何复选框、不会启动计时器，值直接生效。
- **步长填 0 现在真的不动**：`readSlot()` 里 `Number(step.value) || 0.5` 会把 0 当假值回退成 0.5，导致「步长 0 仍然在变」。改为只有留空/非法才回退 0.5，`openSimulator()` 的对话框路径同样修正。
- 单测 283 项（新增 9 项：复选框语义、改值不打开循环、步长 0 / 留空 / 0.25）。
## 0.69.10
- **复选框不再冲掉值**：`readSlot()` 忽略空输入（不再用空串覆盖 `slot.value`）；勾选/取消勾选只切开关，不回写输入框。
- 单测 274 项。
## 0.69.9
- **分支活跃判定改用 `branchActive`**：某些分支内层 `condition` 不满足时该分支所有 item 都是 `hit=false`，用 `hit` 汇总会把整条分支判成不活跃 → 整块被隐藏。现在 `range_dispatch` / `select` / `condition` 给每个 item 带上 `branch` + `branchActive`，`simViewEntries` 对分支分组看 `branchActive`，普通分组才看 `hit`。
- 单测 274 项。
## 0.69.8
- **复调用克隆的分支判不出来**：克隆出来的 item 节点登记在**源分组**上，`simEvaluate` 只返回 `node`，`simViewEntries` 用 `node → group` 映射就永远找不到「[5] 这一支」，切值后不轮换。现在每个求值结果额外带 `branch`（所属分支节点），`simViewEntries` 优先按它定位分组。
- 单测 274 项。
## 0.69.7
- **去掉 fail-open**：0.69.6 的「容器下没有任何分支命中时保持全部可见」会在「只有第 5 支有内容」时让整块永远可见，看起来就是「不轮换」。改为严格按条件隐藏/半透明。
- 单测 274 项。
## 0.69.6
- **修「不活跃分支不轮换」的根因**：`simViewEntries` 找「分支容器」时是从**命中项**反推的，而 `sac_slots` 这类容器本身不产出 item（空 composite），导致它的分支从来不被枚举 → 永远不参与隐藏/半透明。
  现在改为从 `sim.groupNodes` 的**全部已映射分组**里找容器；进入 entries 的仍只限于「真正产出 item 的分组」+「容器直属子分组」。
- **fail-open 保护**：若某容器下没有任何分支命中（数据未建好/分支全空），不做隐藏，避免整块消失。
- 单测 274 项。
## 0.69.4
- **右键菜单**：「编辑分组映射属性」固定放到最下面（结构动作 → 位姿 → 枢轴 → 属性）。
- **模拟输入面板**：控制条（运行/停止、刷新、不活跃分支视图模式、状态）改为面板顶部的固定区域，下面的输入行与结果区单独滚动——滚到任何位置都能直接点停止/刷新。
- **视图联动支持嵌套分组**：原来只处理分组的**直属**方块/子级，`sac_slots` 这类「分支 → 内层分组 → 方块」的结构不会变；现在递归到所有后代方块（半透明）与所有后代分组（完全隐藏），恢复时同样递归。
- **分支容器下的空分支也参与联动**：`simViewEntries` 现在把 `range_dispatch` / `condition` / `select` 的**每个直属子分组**都纳入（含没有产出节点的空 composite），命中判定看该分支自身或任意后代是否有命中节点，避免「没进映射的分支永远不隐藏」。
- 单测 274 项（新增 6 项：空分支纳入联动、嵌套方块半透明、嵌套分组隐藏/恢复）。
## 0.69.3
- 修「重载插件后右键菜单重复注册」：`menuVariant()` 生成的 Action 之前没被释放，重载会报 `imda_menu_* has a duplicate ID`。现在 `onunload` 里统一 `delete()` 掉 `menuActions` 里的全部菜单动作，并清理 Group/Locator/Cube 三个 `prototype.menu` 里的 `imda_` 项；菜单也改为「每次先清理再重建」，不再依赖挂在 prototype 上的持久标记。
## 0.69.2
- 菜单动作释放补全（menuActions.delete + 清 structure）。
## 0.69.1
- 右键菜单守卫改为每次重建，避免重载后残留。
## 0.69.0
- **引用其他物品模型映射**：`imda_model` 支持写成 `<命名空间>:items/<路径>`（对应 `assets/<命名空间>/items/<路径>.json`）。导出时读取该映射文件的 `model` 定义并内联为 `composite` 包裹，外层仍保留本分组的 `transformation`、`node_name`、tints 逻辑；读取失败会 warn 并退回普通模型引用。
- **工具 → 更新所有调用**：清空映射缓存、重扫全部复调用标签与 `imda_model` 引用、重排分支名，并汇总「失效复调用 / 映射读取失败 / 分支名刷新数」；有问题时弹窗列出。
- **右键菜单按条件拆分**：分组右键按 `imda_type` 显示不同项（model → 选择引用文件 / 导入引用模型；composite·inline → 从分组创建模型 / 复调用 / 转化标签）；复调用标签右键只在 `imda_call_target` 非空时显示「实例化 / 编辑复调用」；方块右键增加位姿项。菜单项都带 `condition`，不满足就不显示。
- **提取变换 / 应用变换**：提取选中分组（`origin`+`rotation`）或复调用标签（`position`+`rotation`）的位姿，再套用到所有选中的同类元素；分组会连同子树一起平移，枢轴落到同一位置，可撤销。
- **引用模型支持资源管理器选择**：分组属性里新增「从资源包选择引用…」（`type: 'file'`，支持拖放），选中 `assets/<ns>/models|items/*.json` 后自动解析路径写成引用（`models` → `<ns>:路径`，`items` → `<ns>:items/路径`），并提供独立菜单项「选择引用模型 / 物品映射文件…」。
- 单测 268 项（新增：映射引用解析、路径→引用解析、提取/应用变换、更新所有调用的统计）。
## 0.68.117
- **修「选中分组时 gizmo / 枢轴标记不在中心」**。实测结论（assembly.bbmodel）：
  - Blockbench 的 `Group.select()` 会把子元素一起选中；多选时 gizmo 取 `getSelectionCenter()` = 被选元素 `getWorldCenter()` 的**包围盒中心**（本格式 `centered_grid=false` 再 +8），而 `getWorldCenter()` 本身就是方块渲染包围盒的中心 —— 所以**大 gizmo 本来就在几何中心**，偏的是画在 `group.origin` 上的枢轴标记。
  - 直接改 `group.origin` 不会移动大 gizmo（实测前后完全一致），但会移动枢轴标记。
  - 方块 `origin` 是 Java 模型导入时留下的（常见 `[0,0,0]` 或旋转原点），与几何无关。
- **「枢轴归位」不再改方块枢轴**：原来那一步 `centerCubePivot(child, g.origin)` 会把方块整体挪走（Blockbench 方块网格 = 位置取 origin、顶点相对 origin 构建，init 后改 origin 不重建顶点就会移位）。实测在真实工程上渲染包围盒会炸开。现在只做分组 origin 归中 —— 全模型实测：8 个分组 origin 归到内容质心，**渲染包围盒完全不变**。
- **导入引用模型时为方块设好枢轴**：`origin` 在 `cube.init()` 之前设为自身几何中心（带 `rotation` 的元素仍保留 Java 旋转原点），从源头避免 `[0,0,0]` 这类错位枢轴。
- 单测 252 项（新增：枢轴归位只动分组 origin、不动方块 origin/from/to）。
## 0.68.116
- **修「复调用选中的分组」撤销不删标签**：`Undo.finishEdit` 没传 aspects，新建的 Locator 不在 `elements` 里，Ctrl+Z 只会还原 outliner（Blockbench 把不认识的节点丢回根目录），看起来就是「只撤销了移动，标签还在」。现在 finish 带上 `{ outliner, elements: 新建 Locator }`，实测撤销后标签被删除。
- 同类问题一并修：**「解析动画时间轴」**（新建 `[timeline]` 分组 + N 个帧标签未进 finish）、**「导入引用模型」**（新建导入分组/方块未进 finish）——这两个操作以前撤销后都会留下孤儿节点。
- **「规范化结构」** 把「删除无效 internal」和「cube 收进 inline」合并为**一条**撤销记录（以前要按两次 Ctrl+Z）。
- **「分组属性 → 继续并删除」** 把删除引用模型子元素和修改属性合并为一条撤销记录。
- 单测 248 项（新增：复调用 finish 带新建 Locator、规范化只产生一条撤销记录且 init/finish aspects 正确）。
## 0.68.115
- **修「实例化后整条分支不导出」**：`复调用选中的分组` 会把源分组标成 `export = false`（只由标签引用），而 `duplicate()` 出来的副本连 `export` 一并继承，导致 `实例化复调用标签` 生成的分支虽然出现在 outliner 里、却**完全不被导出**（真实工程 `bone7` 的 5 个分支全是这样，导出 JSON 里连 `bone7` 节点都不存在）。
  现在实例化后会把副本及其整棵子树的 `export === false` 恢复为 `true`，并在 Console 打印 `[装配] 实例化恢复导出 N 个节点`；源分组仍保持不导出。
- 单测 238 项（新增：实例化副本恢复导出、子节点恢复导出、源分组仍不导出）。
## 0.68.114
- 修 `range_dispatch` 导出优先级：**父级 `imda_threshold_format` 优先**，子分组自带的 `imda_threshold_format` 只描述「它自己 entries 的编号」，不再顶掉父级格式。此前 `bone7` 的 `5-i` 被子分支 `sacpackN` 自带的 `i` / `i+N` 覆盖，导出阈值变成 0,1,1,2…，与名字前缀 `[5..1]` 相反 —— 即「正序倒序交替」的根因。父级没写格式时才回退到子级格式（保持旧行为）。
- `syncBranchLabels()` 现在也处理 `select` 类型：此前被函数开头的类型判断挡在门外，select 分支的 `[when]` 前缀永远不刷新。
- 单测 235 项（新增：父级 `5-i` 覆盖子级自带格式、`threshold_force` 仍优先、同步后子分支 threshold 与名字前缀同向）。
## 0.68.110
- 自动同步时不再调用 `sortBranchChildren()`，分支顺序完全保留 outliner 中的实际顺序；只有显式修改分组属性时才会排序。解决递减格式/选择分支时分组位置反复变化。
## 0.68.109
- 修复递减格式（如 `5-i`）导致序列顺序反复翻转：`sortBranchChildren()` 在父分组有 `imda_threshold_format` 时直接跳过，不再用格式化后的 threshold 反推排序。
- 单测 232 项。
## 0.68.108
- 不再绑定 outliner 的 `mouseup` / `dragend` 自动同步；选择或普通点击不会触发 `sortBranchChildren()`，解决序列分支正序/倒序反复重排。
- `sortBranchChildren()` 发生重排时输出父分组、重排前后的名称与排序键，便于定位。
## 0.68.107
- Locator 右键菜单重排加 `locatorMenuAttached` 守卫，避免每次选择/刷新都重复重排和刷 Console。
## 0.68.106
- 停止在 `update_selection` 和 outliner `mouseup` 时自动重排分支；只有添加/删除分组和真正的 `dragend` 才同步，选择序列分支不再导致正序/倒序反复翻转。
## 0.68.113
- 恢复 Locator 右键菜单挂载守卫，避免每次 `update_selection` 重复输出 `已重排复调用标签右键菜单`。
## 0.68.112
- 选择/拖拽不再触发分支同步：移除 `update_selection` 和 outliner hook，只在 `add_group` / `remove_group` 时同步。
- `sortBranchChildren()` 每次调用输出 parent/type/format/order；`scheduleBranchSync()` 输出触发原因、同步前后顺序；真正重排仍输出 before/after 的 name/threshold/key。
## 0.68.111
- 基于 0.68.105：`sortBranchChildren()` 在父分组有 `imda_threshold_format` 时跳过排序，解决 `5-i` 这类递减格式与 `syncBranchLabels()` 互相翻转。
- 每次实际重排时输出 parent、type、threshold_format、before/after 的 name/threshold/key，便于定位。
- 单测 231 项。
## 0.68.105
- 修复只选中分组、没有 Locator 时“生成复调用序列”误报选中数量不足：`orderedSequenceItems()` 现在读取 `Group.multi_selected` / `Group.selected` / `Group.first_selected`，不再只看 `Outliner.selected`。
- 单测 229 项。
## 0.68.104
- `syncBranchLabels()` 在格式生效时把计算出的 threshold 写回子节点，属性面板不再全部显示 0；分支名和数值保持一致。
- 单测 227 项。
## 0.68.103
- 实例化每个副本后调用 `syncBranchLabels()` 刷新该副本自己的分支名前缀，避免只有被右键/第一个分组的大纲标签更新。
- 新增四个 range 分组不同 `threshold_format` 的导出测试，单测 224 项。
## 0.68.102
- 修复 `"{}"` 空覆盖被误判为“已有覆盖”，导致右键同组实例化时 3/4/5 不继承 sacpack2 的格式；改为按解析后的字段数判断，并输出每个标签的覆盖日志。
## 0.68.101
- 右键“实例化同组复调用标签”：自动收集同一父分组下的兄弟标签，并让没有单独覆盖的兄弟继承右键标签的覆盖；解决只处理右键节点、3/4/5 不生效。
## 0.68.100
- 右键“实例化选中的复调用标签”不再只取第一个；多选 3/4/5 时会一起实例化各自的覆盖。
## 0.68.99
- 基于 `v0.68.85` 的最终尝试：实例化 Undo 的 init/finish aspects 分离（删除 Locator 只进 init，新建分组/方块只进 finish），并收集嵌套分组。
- 修复 `duplicate()` 后重复 `created.init()` 造成同一 Group 两次进入 `Project.groups`。
- 覆盖在加入父级/init 后应用；修正 property 前缀、补齐 ignore_default；threshold（含 0）用 `imda_threshold_force` 优先于父级 threshold_format。
- range_dispatch 导出优先读取子分支 `imda_threshold_format`。
- 新增实例化集成测试，单测 217 项。
## 0.68.98
- 导出 range_dispatch 时优先使用子分支自己的 imda_threshold_format，不再无条件被父级格式覆盖；实例化覆盖的 	hreshold_format 现在会进入最终 JSON。
## 0.68.97
- 实例化覆盖前清除副本继承的 imda_threshold_force，避免旧阈值标记污染未覆盖阈值的新分支。
## 0.68.96
- 把 `imda_call_target`/`imda_call_overrides` 等字段登记为 `Locator` 的 Property，Blockbench `getUndoCopy()` 重建 Locator 时不再丢失复调用目标与覆盖。
- 修复 `property` 覆盖被通用字段循环写回 `minecraft:` 前缀；`property` 现统一去掉前缀。
- 补 property/threshold=0 覆盖回归测试，单测 223 项。
## 0.68.95
- 修正实例化撤销：不再只依赖 outliner 快照，`initEdit` 同时登记父分组和待删除 Locator，`finishEdit` 登记新建分组/方块。撤销时才能重建 Locator、真正删除新增分组，而不是被 Blockbench 的未处理节点兜底重新挂到 root。
- 显式从 `Blockbench.Project.undo` 取撤销栈，避免插件作用域里全局 `Undo` 不可用；兜底补写仍保留。
- 覆盖的 `threshold` 加 `imda_threshold_force` 标记；导出父级 `range_dispatch` 时优先使用该阈值，解决父级 `threshold_format` 总是覆盖子分支阈值（含阈值 0）的问题。
- 把 imda_call_* 字段登记为 Locator 的 Property，确保 Blockbench getUndoCopy() 重建 Locator 时保留复调用目标/覆盖，而不是变成空标签。
- 单测 220 项。
## 0.68.94
- 实例化撤销改为 outliner 全量快照；若 `finishEdit` 没有把这一步写进历史，就用前后快照补写一条，避免 current_save 丢失导致 Ctrl+Z 完全无反应。
- 实例化覆盖逐个 Locator 应用并统计；快捷消息显示带覆盖的数量，Console 输出每个标签的覆盖前后值。
- 单测 216 项。
## 0.68.93
- 修复实例化撤销无响应：`Undo.initEdit` 未定义/未登记 `parentGroups`，而 `finishEdit` 引用它抛 ReferenceError，导致 Undo 事务没有关闭。
- 单测 210 项。
## 0.68.92
- 实例化撤销增加保险：记录每次生成的分组，在 undo 事件匹配「实例化」时删除残留分组。
- 单测 210 项。
## 0.68.91
- 修 UUID 重生成不同步 OutlinerNode.uuids 导致撤销彻底失效：改 UUID 时同步注销旧项、注册新项。
- 单测 210 项。
## 0.68.90
- 重写实例化（基于 0.68.86）：复制后递归生成唯一 UUID（crypto.randomUUID + 递增序号，避免同毫秒重复），并把父分组纳入 Undo。
- 单测 210 项。
## 0.68.89
- 修批量实例化 UUID 冲突：duplicate() 后递归生成新 UUID，避免副本与源/彼此同 UUID 导致撤销、覆盖只对第一个生效。
- 单测 209 项。
## 0.68.88
- 实例化撤销数据纳入父分组，让 before/post 的 groups 差异能正确删除新建分组；覆盖应用增加控制台日志。
- 单测 209 项。
## 0.68.87
- 修实例化撤销残留分组：Undo.initEdit 启用 groups aspect，finishEdit 的 createdGroups 才会被记录。
- 单测 209 项。
## 0.68.86
- 实例化覆盖改为每个 Locator 在 `created.init()` 之后单独应用，避免批量时只有第一个副本保留覆盖。
- 单测 209 项。
## 0.68.85
- Locator 右键菜单每次加载先移除旧项与分隔线，再按「实例化此标签 → 编辑复调用标签」重排。
- 单测 207 项。
## 0.68.84
- 实例化时把复调用覆盖属性写入复制分组（property/index/scale/threshold_format/range/condition 等），编号格式随实例继承。
- Locator 右键菜单顺序改为「实例化此标签」在上、「编辑复调用标签」在下。
- 单测 207 项。
## 0.68.83
- 重写实例化：登记创建分组与所有 cube 到 Undo，恢复撤销；按原 Locator 在父级中的位置插入复制组，保持大纲顺序。
- 复调用覆盖改为应用到目标 clone 之后再包位姿层，修复 threshold_format 等覆盖不生效。
- Locator 右键补齐「实例化此标签」，缺失时自动补挂。
- 单测 207 项。
## 0.68.82
- 恢复实例化函数 else 分支内的 walk 调用，确认框与实例化恢复。
- 单测 207 项。
## 0.68.81
- 彻底删除实例化函数 if/else 外残留的 walk 调用，确认框恢复显示。
- 单测 207 项。
## 0.68.79
- 修实例化无确认/无效果：删除 if/else 外误留的 walk 调用（引用块级变量导致 ReferenceError）。
- 「实例化此标签」只处理当前右键的 Locator。
- 单测 207 项。
## 0.68.78
- 修「实例化选中的复调用标签」仍实例化全部：函数现已接收 targets；所选入口使用 selectedCallTags，右键「实例化此标签」只处理当前标签。
- 实例化确认框改为左「实例化」、右「取消」。
- 单测 207 项。
## 0.68.77
- Tools 新增「实例化所选复调用标签」；Locator 右键新增「实例化此标签」，复用同一实例化逻辑。
- 单测 207 项。
## 0.68.76
- 引用模型节点改为其他类型时弹窗确认；继续会删除其下属分组/元素，再应用类型变更，删除可撤销。
- 单测 207 项。
## 0.68.75
- 规范化结构新增 internal 清理：父级既不是 internal 也不是 model 的 internal 分组（含子树）直接删除，可撤销。
- 单测 207 项。
## 0.68.74
- 直接选中非 internal 分组时不再触发向上整组选择；只有选择里出现 internal 分组才继续上溯到 model。
- 单测 205 项。
## 0.68.73
- 复调用覆盖新增「分支编号格式」：源类型 range_dispatch 时显示；导出克隆节点后按格式重算 entries 阈值。
- 单测 205 项。
## 0.68.72
- 修复调用编辑页：覆盖字段改用 `ov_` 前缀，不再覆盖「目标分组」字段；按源类型/属性条件显示对应字段（同分组属性对话框）。
- 单测 205 项。
## 0.68.71
- 复调用编辑页按源分组类型生成同款映射字段（property/index/scale/component/range/condition 等），源类型只读；留空不覆盖，值存 `imda_call_overrides` JSON。
- 导出时把覆盖应用到克隆节点；range 分支阈值从覆盖读取。
- 单测 205 项。
## 0.68.70
- 复调用标签支持覆盖参数：threshold / property / index / scale；编辑对话框显示源映射类型（只读）。
- 导出时克隆目标节点后应用 property/index/scale；复调用挂在 range_dispatch 下时按 threshold 生成 entries。
- 单测 203 项。
## 0.68.69
- 修实例化撤销残留方块：复制子树里的 cube 全部收集进 Undo `elements`，原 Locator 也登记。
- 单测 203 项。
## 0.68.68
- 修实例化后子分组枢轴错位：改为平移整棵子树坐标（子分组 origin + 方块 from/to/origin），不再使用只移方块的枢轴补偿函数。
- 单测 203 项。
## 0.68.67
- 修实例化位置错误：复制目标分组后，除 origin/rotation 外还按 `P_locator - O_target` 平移内部内容，使几何与 Locator 调用一致。
- 单测 203 项。
## 0.68.66
- 实例化复调用：复制出的分组继承 Locator 的名称、位置和旋转；Undo 带上新建分组与原 Locator，撤回后不再残留方块。
- 单测 203 项。
## 0.68.65
- 修「实例化所有复调用标签」提示 0 个：Blockbench 分组复制 API 是 `duplicate()`，之前只调 `clone()` 导致每个标签被跳过。
- 单测 203 项。

## 0.68.64
- 修复调用序列：只选复调用 Locator 且目标相同时，自动把目标分组补为满数量节点的本体，避免节点里只有调用。
- 序列节点名改为按实际数量 `#N`，递减方向显示 `#5/#4/#3…`，不再随生成顺序递增。
- 少数量节点的 Locator 名称/目标改为指向目标分组，避免出现「调用 调用 X」。
- 单测 203 项。

## 0.68.63
- 「生成复调用序列…」支持把复调用 Locator 作为序列项：按大纲顺序与分组混排；满节点放入原始项，少数量节点复制 Locator 的位置/旋转/目标。普通 Locator 不参与。
- 对话框选择校验改为分组合复调用 Locator 一起计算。
- 单测 202 项。

## 0.68.62
- 修「生成复调用序列…」菜单消失：Action 不再以“已选 ≥2 个分组”为显示条件，始终显示；未选够时点击弹提示。
- 单测 200 项。

## 0.68.61
- 项目设置新增物品根参数：`hand_animation_on_swap`、`oversized_in_gui`、`swap_animation_scale`。
- `items/*.json` 根对象按非默认值输出这些参数，`model` 保持不变。
- 单测 200 项。

## 0.68.60
- 修 cooldown 时间轴帧被倒置：只倒置阈值（第一帧 1 → 最后一帧 0），entries 保持原帧顺序，不再 reverse。
- 单测 197 项。

## 0.68.59
- 时间轴属性支持 cooldown：阈值钳制到 0..1 并倒置（第一帧 1、最后一帧 0），entries 按阈值升序。
- 时间轴增加与分组一致的属性：compass target/wobble、time source/wobble、count/damage normalize、use_cycle period、use_duration remaining；动画右键与时间轴属性对话框均可设置。
- 单测 197 项。

## 0.68.58
- 修动画右键菜单「时间轴属性…」再次缺失：挂载时校验菜单里是否真有该 Action，标记失效就重置重挂；项目加载后和 800ms 后各补一次。
- 单测 194 项。

## 0.68.57
- 修旧引用模型数据与导出不一致：没有 `imda_model_origin` 且没有 `imda_model_shift` 的旧导入分组，源原点按 `[0,0,0]` 计算，抵消旧导入已烘入的 `group.origin`。
- 单测 194 项。

## 0.68.56
- 抽出共用 `averagePoints()`，枢轴归中与源模型几何中心使用同一平均算法。
- 新增 `PIVOT_ALGORITHM.md`：记录中心/旋转/局部偏移的约定和易错点。
- 单测 194 项。

## 0.68.54
- 修「参考源文件重建枢轴点」偏移方向：源偏移是模型局部坐标，转到父坐标应乘 `R` 而不是 `R⁻¹`。
- 单测 194 项。

## 0.68.52
- 新增「参考源文件重建枢轴点…」：读取源模型几何中心相对坐标原点的偏移，按当前旋转换算成局部坐标，移动分组枢轴与复调用 Locator，保持外观；普通 Locator 不处理。
- 「枢轴归位」现在给分组/方块记录 `imda_pivot_offset`（归中前枢轴相对几何中心的局部偏移）。
- 新增「从记录重建枢轴点…」，按记录恢复分组和方块枢轴。
- 单测 194 项。

## 0.68.51
- 引用模型导入：源模型几何整体平移 `目标枢轴 - 源模型原点`，使 `sac.full` 原点与分组枢轴重合；记录 `imda_model_origin`，导出时用同一偏移。
- 单测 192 项。

## 0.68.50
- 引用模型导入时，把目标分组的 origin/rotation 同步为源模型根分组的 origin/rotation，使枢轴与 `sac.full` 坐标原点重合。
- 单测 192 项。

## 0.68.49
- 修引用模型双重变换：导入时不再把目标分组 origin 加到方块坐标（`import_base = [0,0,0]`），否则导出时分组 transformation 会再次应用 origin，产生约一格偏移。
- 需要重新导入引用模型以重建内部方块坐标。
- 单测 192 项。

## 0.68.48
- 修整组选中后 gizmo 枢轴：设置 `Group.first_selected = model 分组`，Blockbench 用 `first_selected.origin` 作为枢轴，和直接点模型分组一致。
- 单测 192 项。

## 0.68.47
- 修整组选中后枢轴不对：把目标 model 分组移到 `Group.multi_selected` 首位，Blockbench 用首项算枢轴。
- 单测 192 项。

## 0.68.46
- 基于回退的 0.68.41 重写内部结构整组选择：internal 分组不再等待“子项全选”，直接沿父级上溯，遇到 model 分组选中后停止。
- 允许选中列表首项为 internal 分组，并把它加入上溯起点。
- 单测 192 项。

## 0.68.45
- 修整组选中在 `ink` 停下：Blockbench 原生选择在事件后覆盖我们的结果；现在同步选中后再用 `setTimeout(0)` 修正一次。
- 单测 192 项。

## 0.68.44
- 修引用模型整组选中：Blockbench 点击内部元素后选中的是 `internal` 分组；现在检测到 internal 分组就直接向上找到 model 分组并整组选中。
- 单测 192 项。

## 0.68.43
- 引用模型内部元素整组选中：只选一个方块且其最近 model 分组为引用模型时，直接整组选中该 model 分组，绕过分组/内建早退；不依赖 inline 判断。
- 单测 191 项。

## 0.68.42
- 修引用模型内部元素无法整组选中：`guardBoxSelection` 的 inline 早退现在会排除属于 `model` 引用模型的元素。
- 单测 191 项。

## 0.68.41
- 修分组属性「映射类型」下拉为空：手写 options 漏了 `internal`；补上 `internal（内部结构）`。
- 单测 190 项。

## 0.68.40
- 新增映射类型 `internal`（内部结构）：引用模型导入的子骨骼不再设为 inline，而是 internal。
- 点击 internal 分组内元素时，选择会一路向上直到引用模型分组（model）。
- 引用模型的 tint 配置向 internal 子分组与所有内部方块面传播；预览着色沿祖先查找 tint。
- 单测 190 项。

## 0.68.39
- 新增「修复失效的复调用目标…」：扫描所有目标 UUID 不存在的复调用标签，统一改为指定分组，不需要多选。
- 当前 assembly 项目里 sacpack3/4/5 的标签目标仍是旧 UUID，可用此功能一次修复。
- 单测 188 项。

## 0.68.38
- 恢复到 0.68.37 最新代码；F5 改为 `合并到资源包…`（`imda_merge_pack`）的默认快捷键，不再绑定导出映射。
- 单测 188 项。

## 0.68.37
- **修项目/分组/元素设置 UI 全消失**：全量重命名时 `P()` 仍把同一 `imda_*` 注册两次，第二次 `exposed:false` 覆盖了 UI 注册；现在只注册一次并 `exposed:true`。
- 单测 188 项。

## 0.68.36
- 找导出菜单项增加 Keybinds.actions 名称回退，并在 1.5s 后重试；找到后把 F5 写入它的 keybind 并保存。
- 单测 188 项。

## 0.68.35
- F5 不再绑在插件自建 Action 上，改为查找「导出物品模型映射」菜单项并写入它的 keybind（`keybind.set(...).save()`）。
- 删除插件 Action 的 F5 keybind，避免抢占。
- 单测 188 项。

## 0.68.34
- F5 改为在 File → Export 菜单树中查找并触发「导出物品模型映射」菜单项本身，不再直接调用 codec.export；找不到时才回退。
- 单测 188 项。

## 0.68.33
- F5 改为直接调用 `codec_object.export()`，与原来的「导出物品模型映射」按钮完全一致（含保存对话框），不再直出 JSON。
- 单测 188 项。

## 0.68.31
- 移除新增的「导出物品模型映射 (JSON)」菜单项；F5 只作为原映射导出的快捷键，不再增加 UI 入口。
- 单测 188 项。

## 0.68.30
- 修 F5 不生效：Action 构造参数应为 `keybind`，不是 `default_keybind`；`new Keybind({key:116})` 现在会注册为默认快捷键。
- 单测 188 项。

## 0.68.29
- 新增 `File → Export → 导出物品模型映射 (JSON)`，默认快捷键 **F5**（Keybind key 116），只写 items/*.json。
- 单测 188 项。

## 0.68.28
- **全量重命名：所有 `imm_*` → `imda_*`**，不再保留旧前缀属性、双前缀同步和迁移工具。
- 旧项目在加载/导出前自动把 `imm_*` 键迁移为 `imda_*` 并删除旧键（`migrateLegacyAll`）。
- 移除 Tools 的「迁移属性前缀」入口和相关兼容函数。
- 单测 188 项（旧前缀迁移、复调用等）。

## 0.68.27
- **修导出后复调用目标变空**：`adoptImdaAll()` 之前无条件用 `imda_*` 覆盖 `imm_*`，别名默认空值会把真实目标清空；现在只在旧键不存在时回填，绝不覆盖已有值。
- 单测 193 项。

## 0.68.26
- 批量编辑复调用标签会遍历大纲，把 `selected === true` 的 Locator 也纳入（右键多选时数组里常只剩一个）。
- 确认后如果目标 UUID 不在 `Group.all`，弹窗提示“目标分组不存在”，不再静默写成未设置。
- 单测 191 项。

## 0.68.25
- 修复复调用标签“改目标分组后又变回模型 id”：目标 UUID 失效时不再把 UUID 预填进模型 id 字段，避免 model 优先覆盖分组选择。
- 新增 `callModelPrefill()` 并加单测。
- 单测 191 项。

## 0.68.24
- 批量编辑复调用标签的选中集合改为 `Outliner.selected` + `Locator.selected` 的并集，避免多选时只拿到一个。
- 说明：目标 UUID 不存在的标签会在导出时跳过；当前项目 sacpack3/4/5 的标签仍是旧 UUID。
- 单测 188 项。

## 0.68.23
- 批量编辑复调用标签：`编辑复调用标签` 现在对 `Locator.selected` 里所有标签写入同一目标，统一 Undo；之前只改传入的第一个/最后一个。
- 单测 188 项。

## 0.68.22
- 复调用输出的 `node_name` 改用 Locator 标签名，不再沿用目标分组名。
- 复调用目标 UUID 失效时会警告并跳过（导出 notes 可见）；多标签只输出一个时先检查目标 UUID 是否仍存在。
- 单测 188 项。

## 0.68.21
- 复调用标签现在使用 Locator 自己的位置/旋转：克隆目标节点后包一层相对目标分组的补偿 transformation（旋转差 + 平移差）。
- 多个指向同一分组的复调用各自输出独立副本，不再重叠在本体位置。
- 单测扩到 187 项（四个复调用 + 位置补偿）。

## 0.68.20
- 修复调用标签不输出：`range_dispatch` / `select` 分组下的 Locator 之前被清空；现在合并到 fallback。
- 修复 fallback 内的复调用占位不解析：resolver 现在也处理对象属性里的 `__imm_call_group`。
- 新增 range_dispatch 下复调用的回归测试。
- 单测 186 项。

## 0.68.19
- 恢复模型装配下的分区：`[ 模型装配 ] - 结构`、`复调用`、`调试`、`时间轴`，以及 `[ 辅助功能 ]`。
- 单测 184 项。

## 0.68.18
- Tools 的 VCS 标题上方补一条分隔线；菜单加载前会清理旧项，重载插件即可，无需完全退出。
- 单测 184 项。

## 0.68.17
- 修 Tools 菜单重复/旧标题残留：加载前清理上一次 VMT 添加的分隔线、标题项和 imm_*/imda_* Action；分组/动画右键菜单同样清理。
- VCS 标题项固定 id 并加 `label` 图标，避免显示 `?`。
- 单测 184 项。

## 0.68.16
- Tools 标题拆开：`==VCS Modeling Toolbox==` 为不可点击标题项，`[ 模型装配 ]` 恢复为普通带文字分隔线；时间轴/辅助功能不变。
- 单测 184 项。

## 0.68.15
- 清理 Tools 重复分区（时间轴/辅助功能各出现两次）；标题恢复为单条分隔线 `==VCS Modeling Toolbox==  [ 模型装配 ]`，避免标题菜单项显示复选框。
- 单测 184 项。

## 0.68.14
- Tools 标题改为不可点击的标题菜单项，前后插分隔线：`==VCS Modeling Toolbox==`、`[ 模型装配 ]` 不再被相邻分隔线规则吞掉。
- 单测 184 项。

## 0.68.13
- 修 Tools 标题丢失：Blockbench 会跳过相邻分隔线；`==VCS Modeling Toolbox==` 与 `[ 模型装配 ]` 合并为一条可见标题，`时间轴`、`[ 辅助功能 ]` 保持独立。
- 单测 184 项。

## 0.68.12
- Tools 菜单改为：`==VCS Modeling Toolbox==` → `[ 模型装配 ]` → `时间轴` → `[ 辅助功能 ]`。
- 模型装配包含结构/复调用/调试操作；时间轴和辅助功能独立分区。
- 单测 184 项。

## 0.68.11
- 修 Tools 第一个分区标题不显示：结构标题前加一个无标题分隔线作锚点。
- 单测 184 项。

## 0.68.10
- Tools 分区标题统一：`VMT模型装配 - 结构 / 复调用 / 时间轴 / 调试`，通用功能归入 `VMT辅助功能`。
- 单测 184 项。

## 0.68.9
- Tools 菜单重组：结构 / 复调用 / 时间轴 / 选择视图 / 调试；检查结构、规范化结构、迁移属性前缀归入“调试”。
- 移除“诊断：模拟视图联动”入口。
- “规范化结构”去掉 composite 括号备注，作为后续所有规范化操作的统一入口。
- 批量选择开关改名“批量选组时取消元素选择”，设置说明明确为“只保留分组，取消方块/定位点选择”。
- 单测 184 项。

## 0.68.8
- 分组右键菜单新增「将分组转化为复调用标签」「生成复调用序列…」。
- 转化为复调用标签：同位置创建 Locator 指向分组，并设置原分组不再直接导出；导出时按需构建调用目标。
- Tools 菜单按“结构 / 复调用 / 时间轴 / 选择视图 / 迁移”分区，并用 MenuSeparator 分隔。
- 单测 184 项。

## 0.68.7
- 新增 `Tools → 规范化结构（composite 内联模型）…`：每个 composite 的直属 cube 收进一个 `inline` 子分组，等价于导出结构，保持位置/旋转，可撤销。
- 单测 184 项。

## 0.68.6
- 修序列生成撤销：`finishEdit` 传入移动分组 + 新建容器/节点/Locator 的 aspects，撤销能恢复分组父级并删除生成物。
- 序列节点命名改为 `<容器名> #1`、`<容器名> #2`…。
- 单测 181 项。

## 0.68.5
- 复调用序列生成器支持：方向（递增/递减）、节点类型（默认 range_dispatch，可选 composite）、每次分组数步长、range_dispatch 的 property/index、阈值起点与阈值步长。
- 节点按输出顺序写 `imm_threshold = 起点 + i × 阈值步长`；满节点只放一次本体。
- 单测 181 项。

## 0.68.4
- 新增 **AGENTS.md** 与 HANDOFF 0.1：新建 Group/Locator/Cube 必须 add + init 都调用。
- 统一 `addAndInit()`，序列生成、复调用、时间轴、实例化等路径改用该封装。
- 单测 177 项。

## 0.68.3
- 新增 `Tools → 生成递减复调用序列…`：按大纲顺序选 a1…aN，生成 N 个节点；节点 1 放本体，后续依次用 a1…a(N-step)、a1…a(N-2step) … 的复调用，最后只引用 a1。
- 可配置容器名与递减数量；容器插入第一个分组的父级下。
- 单测 177 项（大纲顺序）。

## 0.68.2
- **修时间轴丢失静态祖先 transformation**：祖先 shell 用空 composite 暂存，`nodeIsEmpty()` 在子节点拼入前判空，把整个 shell（含 group3/group 的变换和 node_name）丢掉。现在先拼子节点，再判断是否为空。
- 移除无效的 display carrier（composite 子项是平行关系）。
- 新增回归测试：静态容器 + 子节点动画时，容器的 transformation/node_name/静态兄弟必须保留。
- 单测 176 项。

## 0.68.1
- 时间轴根第一个子项改为真实模型 carrier（复用已有模型，`transformation.scale = [0,0,0]` 隐藏几何），用于让游戏从第一个模型解析 display。
- 3 层额外空 composite 正常，已排除嵌套深度。
- 单测 173 项。

## 0.68.0
- 移除无效的 display 载体模型（composite 子项是平行关系，空模型不能承载 display）。
- 新增项目属性「调试：额外空 composite 层数」：导出时在映射根外包 N 层空 composite，用于检测嵌套深度是否导致 display 失效。
- 单测 173 项。

## 0.67.9
- 时间轴根 composite 前插入一个空几何的 display 载体模型，让 `range_dispatch` 结构下游戏仍能解析手持/GUI display。
- 单测 173 项。

## 0.67.8
- 时间轴根统一包回 `composite`，`range_dispatch` 作为子节点；用于排查根为 range_dispatch 时 display 不生效、模型朝上的问题。
- 单测 173 项。

## 0.67.7
- 默认 display 只输出手持槽位（thirdperson/firstperson）；GUI/地面/固定/head 仅在项目设置「display 输出全部槽位」开启时输出，避免被 Blockbench 预置的 gui 旋转带成朝上。
- 单测 171 项。

## 0.67.6
- 修模型在游戏里朝上：display 未填的槽位回退到内置手持预设（旋转/缩放），显示调整页有值的槽位覆盖预设；不再输出空 display。
- 单测 171 项。

## 0.67.5
- 修动画右键「时间轴属性…」不出现：之前在 Action 创建前就挂菜单并把标记置 true，`addAction(undefined)` 失败后再不重试。现在在 Action 创建后挂载，成功才置标记，并移除轮询。
- `Tools → 时间轴属性…` 同时保留。
- 单测 171 项。

## 0.67.4
- 新增确定入口 `Tools → 时间轴属性…`（选中动画时可用），设置 range_dispatch property/index。
- 动画右键菜单挂载改为多次重试（不同版本 Animation 菜单创建时机不同）。
- 单测 171 项。

## 0.67.3
- 动画右键菜单新增「时间轴属性…」，不依赖原生「属性…」对话框的实现；可设置 range_dispatch property 与 index。
- 原生动画属性对话框补丁保留，并延迟重试挂载。
- 单测 171 项。

## 0.67.2
- 接管 `Animation.prototype.propertiesDialog`（仅 IMDA 格式）：保留名称/循环/覆盖/吸附/Molang 字段，并追加 `时间轴 range_dispatch property` 与 `时间轴 custom_model_data index`。
- 之前用 `Dialog.show` 追加无效，因为原生表单在构造时已生成。
- 单测 171 项。

## 0.67.1
- 动画属性对话框注入 `时间轴 range_dispatch property`（custom_model_data / cooldown / count / damage / time / use_cycle / use_duration / compass）与 `时间轴 custom_model_data index` 字段。
- 采样时把 `animator.keyframes` 回填到通道，并同步 `Timeline.time`；修复所有帧姿态相同。
- 时间轴总控 `* timeline`；帧节点 `frame 时.分.秒.帧`；模型文件按分组路径命名、所有帧复用。
- 单测 171 项。

## 0.67.0
- 修逐帧姿态全部相同：采样时同步 `Timeline.time`，并把存档里 `animator.keyframes` 回填到 rotation/position 通道后再插值。
- 时间轴命名：总控 range 为 `* timeline`；帧节点为 `frame 时.分.秒.帧`（帧从 1 起）。
- 时间轴模型文件不再统一用 `timeline` hint，改为按分组路径命名；同一分组所有帧复用同一模型。
- 动画属性新增 `imda_timeline_property` / `imda_timeline_index`，可在动画右键属性里改该时间线的 range_dispatch 来源与 index。
- 单测 171 项。

## 0.66.9
- 时间轴改为**递归到真正有姿态的节点**，在它原来的层级位置替换成 `range_dispatch`；静态祖先（bone5/bone7/sacpack）保持原 composite 层级，不再把整个 bone7 子树搬进每一帧。
- 纯容器分组即使自身没有模型，也保留 transformation + node_name 的 shell，避免丢父级变换。
- 嵌套 range 使用时间轴分组/项目的时间轴 property 与 index。
- 单测 170 项。

## 0.66.8
- 修时间线 range_dispatch 节点缺少 node_name：内层帧 range 使用来源根分组名，自动总时间轴使用 `[动画时间轴]`，手动时间轴使用分组名。
- 单测 170 项。

## 0.66.7
- 修 `node_name` 未出现在导出文件：`formatNode` 字段白名单补上 `node_name`。
- 修 Tools 菜单漏挂 Action：解析时间轴、移除时间线标签、实例化复调用标签、迁移属性前缀现在都在 `Tools` 下。
- 单测 169 项。

## 0.66.6
- 关键帧检测改为 `some(Boolean)`：通道数组里的空占位不再被当成有动画，未绑关键帧的分组不会进入时间轴。
- 自动时间轴按子树拆分：只有**确实有姿态**的分支进入 `range_dispatch` 帧；静态兄弟节点放在时间轴外只输出一次。
- 对“根静态、子分支动画”的分组递归拆 shell + 嵌套 range，减少 sacpack 这类未动画分组被逐帧复制。
- 单测 168 项保持通过。

## 0.66.5
- 导出 mapping 的每个分组节点新增 `node_name`，记录对应 Blockbench 大纲分组名；可用项目属性「输出 node_name」关闭。
- 自动时间轴的合成节点不写 node_name（没有对应大纲分组）。
- 单测 168 项。

## 0.66.4
- **设置页改为读 `imda_*`**：Property 注册以 `imda_*` 为主键、`imm_*` 为隐藏别名；`projectValue` 优先读新键，缺失时回退旧键。
- 迁移动作重新包含 Project 级设置；迁移后设置页仍能显示（读 `imda_*`）。
- 加载/导出时双向同步 `imm_*` 与 `imda_*`，旧项目设置不会丢失。
- 单测 167 项。

## 0.66.3
- 修迁移后 Project 级设置（资源包路径等）消失：迁移只处理 Group/Locator/Cube，不再动 Project。
- 启动/加载项目时把已有 `imda_*` 同步回 `imm_*`，已经被迁移过的项目设置可恢复。
- 单测扩到 167 项。

## 0.66.2
- 新增 `Tools → 迁移属性前缀（imm_ → imda_）…`：默认复制（保留旧键），可选重命名（删除旧键）。
- 插件同时注册 `imm_*` 与 `imda_*` 两套属性；导出/编辑前把 `imda_*` 同步到运行时，迁移后旧代码路径仍可用。
- 单测 165 项（迁移复制/重命名）。

## 0.66.1
- 命名统一：插件名 **VCS' Modeling Toolbox（VMT）**；装配模块 **Item Model Definition Assembly（IMDA）**；中文“物品模型定义装配”。
- 格式 id `item_model_definition_assembly` 与 `imm_*` 属性前缀保持不变（兼容旧项目）；`imm` 不再解释为 Item Model Mapping。

## 0.66.0
- **display 改用项目“显示调整”页参数**：读取 `Project.display_settings`，按槽位输出 rotation/translation/scale；没有该数据时才回退旧预设。
- **命名空间支持子空间**：`sqsptst:weapon/shotgun` → items/models 路径和模型引用都带 `weapon/shotgun/` 子路径。
- **恢复逐帧动画导出**：`range_dispatch(timeline)` 会优先用 Locator 帧标签，否则自动采样当前动画（FPS / index / property 可配），不再需要手动打标签。
- 新增 `Tools → 移除动画时间线复调用标签`、`Tools → 实例化所有复调用标签`；旧的手动解析仍保留。
- 引用模型分组新增“强制统一显示调整”：不处理 / 生成模型副本（默认）/ 覆盖源模型参数；与当前显示页不一致时按档位处理。
- Locator 注册 `imm_frame` / `imm_pose` 属性，帧标签可随项目保存。
- 单测扩到 **160 项**。

## 0.62.8
- **display 对齐引用模型**（`sac.full` / `anime/*`）：只输出 `thirdperson_*`（scale 0.85）和 `firstperson_*`（scale 0.68），**不再输出 gui / ground / fixed**（这些上下文按默认 identity 渲染）。
- 修生成模型在 GUI/地面被压到 0.625/0.25、手持 0.375 导致比引用模型小一倍多的问题。
- 单测 147 项保持通过（display 断言改为手持 0.85、无 gui）。

## 0.62.7
- **display 恢复为 0.20 的 `block/block` 预设**（GUI 0.625 / 地面 0.25 / 手持 0.375），与 0.20 正常版本的输出一致。
- 移除 0.62.6 的 `imm_export_scale` 整体缩放（已否决）。
- 对比确认：0.20 与 0.62.2 的 `centerShift` / `compileElement` / `addModel` / `buildTransformation` 完全相同，几何与缩放逻辑未变。

## 0.62.6
- 新增项目属性 **整体缩放**（`imm_export_scale`，默认 1）：写入根 `transformation.scale`，用于整体放大/缩小装配（纯 transformation 层面，不动 from/to）。
- 检查导出 mapping：所有 `left_rotation` 四元数范数均为 1，不存在四元数隐性缩放。
- 单测扩到 **148 项**。

## 0.62.5
- 回退 0.62.4 的 translation 单位改动：`transformation.translation` 仍是**格**，它只影响偏移、不影响尺寸。
- 模型偏小/引用模型偏大仍需从 display 或几何数据定位。

## 0.62.4
- **修 transformation.translation 单位错误**：item model definition 的 translation 与模型 `display.translation` 同单位（1/16 格 = 像素），旧实现多除了 16，导致所有子件位移被缩小、整体又小又偏；引用模型没有这段位移，看起来就大一倍。
- 单测新增 translation 单位断言（16px → 16，不是 1）。
- 单测扩到 **147 项**。

## 0.62.3
- **修模型在游戏里偏小**：模型自带的 display 从 `block/block` 预设改为 `item/generated` 标准预设（GUI scale 1.0、地面 0.5、手持 0.55/1.7、fixed 1.0）。
- 项目属性 `imm_block_display` 保留原键名，标签改为「模型附带 item/generated display 变换（推荐开）」。
- 单测扩到 **146 项**（GUI/ground display 缩放断言）。

## 0.62.2
- **修选中父分组时 gizmo 动不了**：当首选节点是分组、或 `Group.selected` 非空时，框选选择守卫直接让路，不再重算选择；子分组/方块仍可单独移动。
- 单测扩到 **144 项**。

## 0.62.1
- 选中**单个元素**也会触发：选中它的父分组 + 同层全部元素（像单击分组），并继续向上递归；不再要求至少 2 个方块。
- 保留：装配格式强制开启、全局默认关闭、`inline` 内建模型元素例外。
- 单测扩到 **143 项**。

## 0.62.0
- **框选改为「向上递归选组」**：只有当一个分组的**所有子项（子分组 + 元素）都被选中**时，才把该分组也选中，并继续向祖父级判断；只选中部分子项时不选该组。
- 保留：装配格式内强制开启、全局默认关闭、`inline` 内建模型元素例外。
- 单测扩到 **142 项**。

## 0.61.5
- 框选改选分组时**不再取消方块自身的选择**：先保留框选到的方块，再把父分组按“点击分组”展开选中，避免取消动作触发选择重算导致子分组不亮。

## 0.61.4
- 修框选后子分组不高亮：方块被框选时父分组可能已经 `selected`，旧逻辑 `if (group.selected) continue` 跳过了展开。现在始终按“点击分组”处理（`group.select({ctrlOrCmd:true})`），仅当**分组及其全部子项都已选中**时才跳过。
- 单测扩到 **140 项**。

## 0.61.3
- 修框选改选分组仍只选中分组：`updateSelection()` 移到守卫生效期间调用，避免 `update_selection` 二次触发再次取消子元素；并增加“方块已在选中分组内则跳过”的判断。
- 单测 **139 项**保持通过。

## 0.61.2
- 框选方块改选分组时，现在像**单击分组**一样：分组自身 + 它内部所有元素一起被选中（`markAsSelected` 递归子元素）。
- 修复二次触发守卫会把子元素取消、只剩分组的问题：父分组已处于选中状态时直接跳过。
- 单测扩到 **139 项**。

## 0.61.1
- 框选改组的「内建模型」例外收窄：**只认 `inline`（内联模型）分组**；`model`（引用模型）分组及其元素不再例外，仍会改选父分组。
- 单测扩到 **138 项**。

## 0.61.0
- **框选改选分组规则调整**：全局设置默认关闭；**装配格式（`item_model_definition_assembly`）内强制开启**，不看开关。
- 例外：若选中的方块**全部属于内建模型**（`inline` 分组，或祖先里有 `model` 引用模型的分组），则保持原选择，不改为父分组，方便直接编辑引用模型内部。
- 单测扩到 **137 项**：装配强制开启、内建模型例外、其它格式默认关闭。

## 0.60.0
- **新增可选开关「框选/多选方块时自动改选所属分组」**（默认关）：一次选中 2 个及以上方块时，自动取消方块、改为选中它们各自的父分组；单选 1 个方块不处理。
- 开关位置：`Settings → 编辑`，或 `Tools → 开关：框选方块时改选所属分组`；与锁定/批量选择守卫共用 `update_selection` 机制。

## 0.59.0
- **纹理引用/导出路径按贴图真实位置解析**：从 `assets/<ns>/textures/<path>.png` 推出引用 `<ns>:<path>`，导出写回 `assets/<ns>/textures/<path>.png`；不再强制 `<项目命名空间>:item/<贴图名>`。
- 例：`.../assets/sqsp/textures/item/inker/jet_rifle/sac.full.png` → `"0": "sqsp:item/inker/jet_rifle/sac.full"`，输出路径 `assets/sqsp/textures/item/inker/jet_rifle/sac.full.png`。
- 解析不到路径时回退到项目命名空间 + `folder/name`。

## 0.58.0
- **新增可选开关「批量选择分组时自动取消单个元素」**（默认关）：同时选中 2 个及以上分组时，自动把一起被选中的方块/定位点踢出选择，避免批量操作误改单个元素；只选 1 个分组时不干预。
- 开关位置：`Settings → 编辑`，或 `Tools → 开关：批量选择时取消单个元素`；实现上监听 `update_selection`，与锁定守卫同一套机制。

## 0.57.0
- **枢轴归位同时处理元素**：分组 `origin` 归到自身内容中心后，把该组每个方块的旋转枢轴（`origin`）归到**父分组的几何中心**，并补偿 `from/to`，**世界外观不变**。
- 嵌套分组逐层处理；提示会分别统计分组与方块。

## 0.56.1
- 导出时对“居中后仍超出 -16~32”的元素给出警告（列出模型/元素数量），便于定位被异常组变换破坏的分组。

## 0.56.0
- **移除映射装配格式的 -16~32 方块坐标限制**：不再定义 `cube_size_limiter` / `coordinate_limits`，新建/移动/缩放方块不会被夹回 [-16,32]。
- 注意：导出到 Java 物品模型时若坐标超出原版范围，需要自行保证合法性。

## 0.55.1
- **修「锁定后仍能选中」**：锁定不活跃分支时立即取消这些元素的选择，并监听 `update_selection` 把任何被选中的锁定元素（分组/方块）踢出选择；半透明并锁定/完全隐藏并锁定下都无法选中/编辑。

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
