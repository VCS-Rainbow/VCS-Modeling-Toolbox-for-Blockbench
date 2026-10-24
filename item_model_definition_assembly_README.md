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
| `模型附带方块 display 变换`（`imm_block_display`） | 开 | 给生成的模型补原版 `block/block` 的 display |

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
| `translation` | `o − R·o`（单位：格） | 把旋转枢轴表达出来；默认 `o = O/16`，开启"枢轴用 (0.5,0.5,0.5)"时 `o = (O−8)/16` |
| `right_rotation` | `[0,0,0,1]` | 单位四元数 |

> 两种枢轴约定的差异是 `(R·C − C)/16`（`C = 8`），对 sacpack1 那种 155° 的分组能差到 1.7 格（27 像素），所以选错会明显散架。

方块的自身旋转写进**元素** `rotation: {origin, axis, angle, rescale}`（单轴）；多轴旋转的方块原生元素表达不了，会退化为该方块自己的子项（附 `transformation`）。

## 关于“调用 Java 版模型作为子项”（需求 1）

Blockbench 5.x 的实现方式有两条，本插件都接上了：

1. **格式级 `parent_model_id`**：`ModelFormat` 的选项 `parent_model_id: true`，会在**项目设置**里生成一个 parent model id 字段（`Project.parent_model_id`）；
2. **分组级 `引用模型`（`imm_model`）**：直接写 Java 版模型 id，导出成 `{"type":"minecraft:model","model":"<id>"}` —— 这就是“把 Java 版方块/物品模型当作子项”。

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
## 安装（自动加载）

把 `item_model_definition_assembly.js` 和 `item_model_definition_assembly.about.md` 一起放到：

```
%APPDATA%\Blockbench\plugins\
```

重启 Blockbench 即自动加载。

注意：如果同时安装了 animated_java，它的 **Blockbench Patch Manager** 会在启动时卸载并重载插件，可能把本插件留在未加载状态（表现为需要手动刷新）。遇到时在插件列表里禁用 Patch Manager，或重启后手动重载一次本插件。