# 物品模型映射装配（item_model_definition_assembly）

独立的 Blockbench 插件，注册同名模型格式 `item_model_definition_assembly`，用于**可视化装配** Minecraft Java 版物品模型映射（`assets/<ns>/items/<id>.json`）。

> 与之前那个导出插件（`item_model_mapping.js`）是两回事：这个是**模型格式**（可在新建模型/转换项目时选择），那个是一次性转换器。两者共用同一套导出规则（元素 rotation、UV 按纹理 uv 空间换算、负尺寸原样输出、紧凑 JSON 格式）。

## 安装 / 使用

1. 把 `item_model_definition_assembly.js` 拖进 Blockbench（或放到 `%APPDATA%\Blockbench\plugins\`）；
2. **新建模型**时选择「物品模型映射装配」，或用 **Project → Convert**（转换项目）把通用格式项目转成本格式；
3. 在**项目设置**里填 `命名空间`；`物品 ID` 取项目设置的 model identifier（缺省用项目名）；
4. 用分组（bone）搭结构，在**分组属性**里设置映射类型等；
5. 导出 / 落地：
   - `File → Export → 物品模型映射 (items/*.json)`：只导出映射 JSON（本格式的原生文件）；
   - `File → Export → 导出装配资源包 (zip)`：导出 `items/*.json` + `models/item/*.json` + `textures/item/*.png` + `.notes.txt`；
   - `File → Export → 合并到资源包…`：**直接写进目标资源包**（见下）；
   - `Tools → 检查装配结构`：按层级列出每个分组的类型/引用模型。

## 直接合并到资源包（调参用）

`File → Export → 合并到资源包…`：

1. 第一次会弹文件夹选择，选中资源包根目录（含 `assets/` 的那层）；路径会记到**项目设置 →「合并目标资源包路径」**，之后每次直接复用（也可以在项目设置里手动填写）；
2. **确认框会先列出将被改动的文件**（每类最多显示 20 个，超出部分显示“其余 N 个”）：
   - **覆盖已有文件**：资源包里已存在、这次会被覆写的路径；
   - **新建文件**：资源包里还不存在的路径；
   - **删除过期文件**：上一轮清单里记录过、这次不再生成、且磁盘上仍存在的路径；
   按钮：`取消 / 重新选择… / 合并`；
3. 合并时：
   - 写入 `assets/<ns>/items/<id>.json`、`assets/<ns>/models/item/*.json`、`assets/<ns>/textures/item/*.png`，**同名文件直接覆盖**；
   - 在资源包根写一个清单 `.imm-assembly-manifest.json`，记录本轮写了哪些文件；下一轮会**删掉上一轮写过、这轮已不存在的文件**（例如分组改名后残留下来的旧模型）；
   - 完成后提示文件数量，游戏里 `F3+T` 重载资源包即可看到效果。

限制：需要**桌面版**（网页版没有本地文件权限，会提示改用 zip）；写入使用 Blockbench 的 `pickDirectory` / `requireNativeModule('fs', {scope})` / `writeFile`，权限对话框由 Blockbench 弹出。

## 目标版本与 `pack.mcmeta`

新建资源包工程（目标目录里没有 `pack.mcmeta` 时选「创建 pack.mcmeta」）会按**目标版本**写格式字段：

- **1.21.9 起**（25w31a，资源包格式 65.0+）用 `min_format` / `max_format`，`pack_format` 变为可选；
- **1.21.8 及更早**用 `pack_format`。

`项目设置 →「目标 Minecraft 版本（pack.mcmeta 格式）」`是下拉框（Blockbench 会把带 `options` 的项目属性渲染成 select），保存在项目属性 `imm_pack_version`。内置表（数值来自 minecraft.wiki，2026-10-24 校对）：

| 版本 | 资源包格式 | 写法 |
| --- | --- | --- |
| 26.3 | 97.1 | `min_format` / `max_format` = `[97,1]` |
| **26.2（默认）** | **88.0** | `min_format` / `max_format` = `88` |
| 26.1 / 26.1.2 | 84.0 | `min_format` / `max_format` = `84` |
| 1.21.11 | 75.0 | `min_format` / `max_format` |
| 1.21.9 – 1.21.10 | 69.0 | `min_format` / `max_format` |
| 1.21.7 – 1.21.8 | 64 | `pack_format` |
| 1.21.6 | 63 | `pack_format` |
| 1.21.5 | 55 | `pack_format` |
| 1.21.4 | 46 | `pack_format` |

> 旧版本把 26.2 的格式写成 71（那是 1.21.5 的值），已修正。26.2 的正确写法示例：
> `{"pack":{"description":"…","min_format":88,"max_format":88}}`。

## 分组属性

> **打开方式**：Blockbench 不会把 `exposed` 的分组属性渲染成面板（官方 Property 文档：`exposed` 目前只对「项目设置」和「关键帧数据点」生效）。所以请先选中分组，再用 **Tools →「编辑分组映射属性…」**（或右键分组，若该版本支持）打开编辑对话框。

| 属性 | 说明 |
| --- | --- |
| `映射类型`（`imm_type`） | `composite`（默认）/ `model` / `range_dispatch` / `condition` / `empty` |
| `引用模型`（`imm_model`） | 填 Java 版模型 id（如 `sqsp:item/inker/jet_rifle/sac.full`）时，本层输出为该模型的引用；**留空则用本层自己的方块生成模型文件** |
| `property`（`imm_property`） | `range_dispatch` / `condition` 的属性（如 `minecraft:custom_model_data`、`minecraft:selected`） |
| `index`（`imm_index`） | `custom_model_data` 的下标 |
| `threshold`（`imm_threshold`） | 当**父层**是 `range_dispatch` 时，本层作为 entries 的阈值 |
| `scale`（`imm_scale`） | `range_dispatch` 的 scale |
| `tints`（`imm_tints`） | 仅 `model` 类型有效，JSON，如 `[{"type":"custom_model_data","index":0,"default":0}]` |

## 项目属性

| 属性 | 默认 | 说明 |
| --- | --- | --- |
| `命名空间`（`imm_namespace`） | `custom` | 决定 `assets/<ns>/...` |
| `变换原点用物品中心 (8,8,8)`（`imm_center_pivot`） | 开 | Minecraft 的物品模型变换以物品中心为原点，建议保持开启 |
| `模型附带 item/generated display 变换`（`imm_block_display`） | 开 | 给生成的模型补原版 `item/generated` 的 display（GUI scale 1.0、地面 0.5） |
| `资源包工程路径`（`imm_pack_path`） | 空 | 合并目标目录（`pack.mcmeta` 所在目录），由「选择资源包工程路径…」写入 |
| `目标 Minecraft 版本`（`imm_pack_version`） | `26.2` | 决定 `pack.mcmeta` 的格式字段，见上文；在项目设置里直接下拉选择 |

## 模拟输入面板（`视图 → 面板 → 模拟输入`）

按 `custom_model_data` / 物品属性预览「当前装配会命中哪些模型」：

- 每类输入独立一行：`floats`（range_dispatch）、`strings`（select）、`flags`（condition）、`colors`、`selected` / `using_item` / `damage` / `count` / `time`；
- **行首复选框 = 自动变化开关**（不是“是否参与求值”）：不勾选也照样用手动值参与求值；勾选后点「▶ 运行」才会自动变化。行尾显示「自动」表示已勾选；
- **每个槽（索引）一行**：折叠箭头 + 槽复选框 + 槽号 + 索引 + 值 + 角标；点箭头展开该槽的：
  - **自动参数**（`floats` / `damage` / `count` / `time`）：周期（秒）/ 步长 / 往复|循环 / 上下限；
  - **`colors` 专用**：周期（秒）+ 预设颜色（逗号分隔，运行时在预设色之间轮换）；
  - **关联分组 / 活跃项**：按该槽自己的下标与值，把 `[编号]` 前缀阈值最大的子分支加粗标蓝；未活跃的点「▸ 未活跃 N 项」展开；
- **槽复选框 = 是否参与**（默认开）：关掉后该槽不参与求值与自动变化，变淡、无角标；改值/索引只会自动勾上该槽，不会打开自动；
- 角标：分支输入显示该槽单独求值的命中数；`colors` 显示该颜色索引关联的分组数（`N 组`，颜色不影响分支命中）；
- 运行中按钮变为 **「■ 停止」** 并高亮，右侧显示「运行中 · N 个自动槽」；没有勾选任何行时点运行只提示、不进入运行态；
- 结构/属性改动后如果预览没跟上，点 **「⟳ 刷新」** 强制重建映射（平时输入变化只重算求值，映射有缓存）；
- **不活跃分支视图联动**（右下角下拉）：`不处理` / `半透明` / `半透明并锁定` / `完全隐藏` / `完全隐藏并锁定`；锁定模式下未活跃分组及其子项运行时 `locked = true`，关闭/切换时恢复原状态。
  - 半透明用同贴图的 `MeshBasicMaterial`（`transparent + opacity 0.28 + depthWrite false`；Blockbench 的贴图 ShaderMaterial 的 `opacity` 不生效），**不改纹理与 UV**、不写项目、不进撤销；
  - 完全隐藏只设 `group.mesh.visible = false`（运行时），不改分组的 `visibility`；
  - 关闭联动、切换项目、卸载插件时自动恢复；
  - Blockbench 在选中/更新时会重置材质与可见性，所以联动开启时每 250ms 重贴一次；
  - 如果视图毫无反应，用 `Tools → 诊断：模拟视图联动` 看「映射节点→分组 / 匹配到分组」数量，先确认不是 0。
- **colors 预览着色**：`colors` 槽的值（ARGB 整数）会作用到带 `tintindex` 的方块——取方块第一个着色面的 tintindex 作为 colors 下标，用运行时材质着色（不改纹理/UV）；清空 colors 或关闭模拟时恢复。不活跃分支的幽灵/隐藏优先，不叠加着色。
- 结果区列出每个分支的 ✔/✘ 与命中数；改值即时重算（40ms 防抖）。

求值规则（`_test_sim.js` 覆盖）：

- `range_dispatch`：取 `threshold <= 当前值` 中最大的那个；**没有命中阈值时才用 `fallback`**（旧实现条件写反）；
- `select`：`custom_model_data` 读 `strings[index]`，与 `cases[].when` 逐项比较，**第一个命中**的 case 生效，否则 `fallback`；
- `condition`：`custom_model_data` 读 `flags[index]`；`selected` / `using_item` / `damaged` 走对应输入；**被选中的分支（含走 `on_false` 时）算命中**。


## 输出结构

每个分组 = 一个映射节点；分组自己的方块 → 引用的模型文件；子分组 = 子节点：

```json
{
	"model": {
		"type": "minecraft:composite",
		"models": [
			{
				"type": "minecraft:composite",
				"transformation": {"translation": [0.101983, 0.082637, 0.026139], "left_rotation": [-0.545792, 0.756699, -0.26283, 0.245842], "scale": [1, 1, 1], "right_rotation": [0, 0, 0, 1]},
				"models": [
					{"type": "minecraft:model", "model": "ns:item/xxx_group"}
				]
			},
			{"type": "minecraft:model", "model": "sqsp:item/some/existing_model"},
			{
				"type": "minecraft:range_dispatch",
				"property": "minecraft:custom_model_data",
				"entries": [
					{"threshold": 0, "model": {...}},
					{"threshold": 1, "model": {...}}
				]
			}
		]
	}
}
```

## 变换规则（与导出插件一致）

**坐标系**：物品模型映射的 `transformation` 在 **block 空间**里生效（1 单位 = 1 格 = 16 像素）。这个坐标系里：

- **原点 = 模型角落 (0,0,0)** —— 旋转枢轴默认就在这里；
- **物品中心 = (0.5,0.5,0.5)**（即像素 8,8,8）。

**顺序**：`right_rotation → scale → left_rotation → translation`（几何先旋转、最后平移）。因为旋转绕 block 原点进行，枢轴补偿必须写进 `translation`：

```
o = O / 16                       // 分组 pivot（像素）换算到 block 空间；默认枢轴在原点
t = o − R·o                      // 若枢轴用物品中心：o = (O − 8) / 16
```

分组变换 `p′ = R·(p − O) + O` 写成 `transformation`：

| 字段 | 值 | 说明 |
| --- | --- | --- |
| `left_rotation` | `R` 的四元数 `[x,y,z,w]` | 放在 **left** 而不是 right：left 在 scale 之后作用，`scale` 就能留给"形状本身的变换"，物体保持刚体；用 right 会先旋转再缩放，物体被压成非刚体（菱形） |
| `scale` | `[1,1,1]` | 预留为形状变换 |
| `translation` | `o − R·o`（单位：1/16 格 = 像素） | 把旋转枢轴表达出来；与模型 `display.translation` 同单位，默认 `o = O`，开启"枢轴用 (0.5,0.5,0.5)"时 `o = O−8` |
| `right_rotation` | `[0,0,0,1]` | 单位四元数 |

> 两种枢轴约定的差异是 `(R·C − C)/16`（`C = 8`），对 sacpack1 那种 155° 的分组能差到 1.7 格（27 像素），所以选错会明显散架。

方块的自身旋转写进**元素** `rotation: {origin, axis, angle, rescale}`（单轴）；多轴旋转的方块原生元素表达不了，会退化为该方块自己的子项（附 `transformation`）。

## 关于“调用 Java 版模型作为子项”（需求 1）

Blockbench 5.x 的实现方式有两条，本插件都接上了：

1. **格式级 `parent_model_id`**：`ModelFormat` 的选项 `parent_model_id: true`，会在**项目设置**里生成一个 parent model id 字段（`Project.parent_model_id`）；
2. **分组级 `引用模型`（`imm_model`）**：直接写 Java 版模型 id，导出成 `{"type":"minecraft:model","model":"<id>"}` —— 这就是“把 Java 版方块/物品模型当作子项”。

> 导入时按模型文件的 `groups` 创建分组，并标记为 `inline`（内联模型）；组的 origin/rotation 会一并写入。

编辑器里想看到被引用模型的几何体：用 `File → Import` 导入该 Java Block/Item 模型并选择“导入到当前项目”，再把它放进对应分组（导入的方块可删可留，导出时用 `imm_model` 指向原模型即可）。

## 已知限制

- **不支持导入**（`parse` 未实现）：本格式的输出是“装配描述”，几何分散在多个模型文件里，回读需要一并解析它们；目前请用 `.bbmodel` 保存工程。
- `condition` 只取前两个子项作为 `on_true` / `on_false`；`range_dispatch` 的 entries 来自子分组 + 各自 `threshold`。
- 单轴旋转角超出 ±45° 的元素会被原样写出（`.notes.txt` 里会统计数量），游戏可能拒绝加载。
- 负尺寸（`from > to`）方块按 Blockbench 的做法原样输出。
- 纹理必须内嵌在 `.bbmodel`（data URL）才会被打包，否则 `.notes.txt` 会提示手动放置路径。

## 分组属性适用范围

编辑对话框（`Tools → 编辑分组映射属性…`）会**按所选映射类型**只显示该类型用得上的字段。

| 属性 | composite | model | range_dispatch | condition | empty |
| --- | --- | --- | --- | --- | --- |
| `imm_model` 引用模型 | ✓ | ✓ | ✓（作为 fallback） | ✓ | — |
| `imm_tints` 染色来源 | ✓（本层自带模型时） | ✓ | — | — | — |
| `imm_property` | — | — | ✓ | ✓ | — |
| `imm_index` | — | — | ✓ | — | — |
| `imm_scale` | — | — | ✓ | — | — |
| `imm_threshold` | — | — | ✓（用于父层为 range_dispatch 时） | — | — |

说明：

- `index` 和 `tints` 是两个不同用途的属性：`index` 只用于 `range_dispatch` 选择 `custom_model_data` 的下标；`tints` 是 `model` 节点的染色来源列表。
- `tints` 必须是 **JSON 数组**，例如 `[{"type":"custom_model_data","index":0,"default":0}]`；填 `"0"` 之类不是合法 JSON，会被忽略并在 `.notes.txt` 提示。
- 面的 `tintindex` 由 UV 编辑器里的“着色”开关决定（Blockbench 写 `tint: 0`），导出时**只要面有 `tint` 字段就输出 `tintindex`（含 0）**。

## 分支编号

`range_dispatch` / `condition` / `select` 的子分组名会自动加 `[k]` 前缀（`range_dispatch` 的编号由父分组的「编号格式」决定）。

分组**移出分支容器**（拖到根目录或普通父级）后，`[k]` / `⚠` 前缀会自动去掉，不需要手动改名。

## 枢轴归位（`Tools → 枢轴归位…`）

嵌套旋转的分组，`origin` 常常离几何中心很远——表现为旋转/移动工具的手柄飘在远处，Blockbench 自带「枢纽居中」在多层旋转下也会歪。

本工具把每个分组的 `origin` 移到它（含子分组）所有方块中心的平均值，同时补偿方块坐标，**外观完全不变**：

- 补偿量 `d = (I − R⁻¹)(O′ − O)`（在分组本地坐标里）；子分组的内容再按 `R_c⁻¹ d` 递归；
- 嵌套多次旋转也正确（真实 `assembly.bbmodel` 153 个角点验证误差为 0）；
- 范围可选「全部分组」或「选中的分组（含子分组）」，支持撤销。

## 内联模型（inline）

分组类型新增 `inline`：**本组方块在装配体里现做**，导出结构等同 `composite`（本组方块烘焙成一个模型文件）；`model` 则专门表示**引用已有模型**（`imm_model`）。

用途：区分“这里是一份就地建模的几何”和“这里只是引用了外部模型”，方便后续筛选、替换和复调用。

## 从分组创建模型

`Tools → 从分组创建模型…`（或分组右键）：

1. 把选中分组的方块烘焙成一个模型文件，写到 `assets/<namespace>/models/item/<名字>.json`（需要先设置资源包工程路径）；
2. 几何会自动居中（元素坐标平移到以 (8,8,8) 为中心）；
3. 分组改为 `model` 类型并引用新模型，同时把居中补偿量记到隐藏属性 `imm_model_shift`，所以**外观不变**；
4. 分组里的方块保留下来作为编辑参考，导出时由引用模型代替。

## 复调用标签

`Tools → 复调用选中的分组`（或分组右键）：在选中分组的**枢轴位置**创建一个 **Locator** 标签（位置/旋转同该分组），属性 `imm_call_target` 指向该分组的 UUID。

右键该 Locator 可选「编辑复调用标签…」，修改目标分组或直接填模型 id（写回 `imm_call_target`）；`Tools → 编辑复调用标签…` 同样可用。

导出时标签会被**替换为目标分组的映射节点**（深拷贝并保留其 `transformation`）：

- 目标若是 `composite` / `range_dispatch` / `select` / `condition`，其分支结构一并复制；
- 目标几何的模型文件只生成一次，复调用共享同一模型 id；
- 找不到目标或出现自引用时会警告并跳过；标签建议只放在 `composite` / `inline` 分组里。

也可以把 `imm_call_target` 直接写成模型 id（如 `sqsp:item/xxx`），导出成对该模型的引用。
## 安装（自动加载）

把 `item_model_definition_assembly.js` 和 `item_model_definition_assembly.about.md` 一起放到：

```
%APPDATA%\Blockbench\plugins\
```

重启 Blockbench 即自动加载。

注意：如果同时安装了 animated_java，它的 **Blockbench Patch Manager** 会在启动时卸载并重载插件，可能把本插件留在未加载状态（表现为需要手动刷新）。遇到时在插件列表里禁用 Patch Manager，或重启后手动重载一次本插件。