# Item Model Mapping Exporter（Blockbench 插件）

把 `.bbmodel` 模型转换成 Java 版（26.1+）的**物品模型映射**（`assets/<namespace>/items/<id>.json`，
见 [物品模型映射 - Minecraft Wiki](https://zh.minecraft.wiki/w/%E7%89%A9%E5%93%81%E6%A8%A1%E5%9E%8B%E6%98%A0%E5%B0%84)）。

- 每一个骨骼 / 分组（Group）→ `composite` 映射的**一个子项**（一个 `minecraft:composite` 节点）；
- 分组的位置、旋转被写进该子项的 `transformation`，并在换算时**修正轴心（pivot）**；
- 子项的变换叠加在父项之上（`composite` 的语义），与 Blockbench 里「父分组先转、子分组再转」完全一致；
- `translation` 按 **1 个单位 = 16 个 Blockbench 单位**（1 格）换算。

---

## 1. 安装

插件就是一个 JS 文件 `item_model_mapping.js`。

**方式 A（推荐）**：把 `item_model_mapping.js` 复制到
`%APPDATA%\Blockbench\plugins\`（Windows），重启 Blockbench。

**方式 B**：直接把 `.js` 文件拖进 Blockbench 窗口，然后在弹窗里选择 “Load Plugin”。

重新加载：`Ctrl + J`（插件 → 重新加载）。

## 2. 使用

1. 打开要转换的 `.bbmodel`（建议用 **Java Block/Item** 格式的项目，UV 才与 Java 模型一致）；
2. 菜单 **文件(File) → 导出(Export) → 导出物品模型映射**；
3. 在对话框里填写：
   | 字段 | 说明 |
   | --- | --- |
   | 命名空间 namespace | 资源包命名空间，如 `custom`（默认） |
   | 物品 ID | 对应 `assets/<ns>/items/<id>.json`，可含子目录，如 `weapon/staff` |
   | 给模型加上方块物品的 display 显示变换 | 默认开，给生成的模型补上原版 `block/block` 的 display，手持/GUI 里位置正常 |
   | 以物品中心 (8,8,8) 作为变换原点 | 默认关，见 §4 说明 |
4. 保存 `.zip`，解压后把 `assets/` 合并进资源包即可。

## 3. 输出结构

```
assets/<ns>/items/<id>.json                  ← 物品模型映射（转换结果）
assets/<ns>/models/item/<id>_<分组路径>.json  ← 每个分组自己的方块几何（重名自动加 _2 后缀）
assets/<ns>/textures/item/<纹理名>.png        ← .bbmodel 内嵌的纹理（能取到才导出）
<id 里的 / 换成 _>.notes.txt                 ← 仅在有问题时生成：缺失纹理、被跳过的元素等
```

映射文件形状：

```json
{
  "model": {
    "type": "minecraft:composite",
    "models": [
      {
        "type": "minecraft:composite",
        "transformation": { "translation": [0, 0, 1], "left_rotation": [0, 0.707107, 0, 0.707107],
                            "scale": [1, 1, 1], "right_rotation": [0, 0, 0, 1] },
        "models": [
          { "type": "minecraft:model", "model": "custom:item/staff_handle" },
          {
            "type": "minecraft:composite",
            "transformation": { "…": "子分组自己的变换" },
            "models": [ { "type": "minecraft:model", "model": "custom:item/staff_handle_head" } ]
          }
        ]
      }
    ]
  }
}
```

- 顶层 `model` 永远是 `composite`；它的每个子项对应一个顶层分组；
- 每个分组节点里：先是「该分组自己的方块」模型，然后是带自身旋转的方块子项，最后是各个子分组；
- 没有放进分组的零散方块，会作为顶层 `composite` 里的一个 `minecraft:model` 子项导出。

## 4. 变换是怎么换算的（重点）

### 4.1 一个分组 = 一次「绕自身轴心旋转」

Blockbench 里，分组对其内部几何体的作用等价于：

```
p′ = R · (p − O) + O          R = 分组旋转矩阵，O = 分组的 origin（轴心，模型坐标）
   = R · p + (O − R · O)
```

物品模型映射的 `transformation` 用分解形式时，四个字段的**作用顺序**是
`right_rotation → scale → left_rotation → translation`，即 `p ↦ T + L·S·R·p`。
把上式对进去（S 取单位阵）：

| 映射字段 | 写入值 |
| --- | --- |
| `right_rotation` | `[0, 0, 0, 1]`（单位四元数，占位） |
| `scale` | `[1, 1, 1]` |
| `left_rotation` | `R` 的四元数 `[x, y, z, w]` |
| `translation` | `(O − R·O) / 16` |

- 除以 16 就是题目中的换算：**映射里 1 个单位 = Blockbench 16 个单位（1 格）**；
- 因为平移量里已经含了 `O − R·O`，旋转轴心被精确还原，**不需要**为了 pivot 再套一层节点；
- 旋转矩阵直接取自 Blockbench 场景对象上的四元数（`mesh.quaternion`），所以欧拉角顺序、
  方块的 `rotation_axis` 等细节都自动正确，不存在 “XYZ/ZYX 到底用哪个” 的猜测。

**例**：某分组 `origin = (8, 16, 8)`，绕 Y 轴旋转 90°。
`R·O = (8, 16, −8)`（Y 轴 90°：`(x,y,z) → (z, y, −x)`），
`O − R·O = (0, 0, 16)`，所以 `translation = [0, 0, 1]`（= 16 个 Blockbench 单位），
`left_rotation = [0, 0.707107, 0, 0.707107]`。
代入验证：轴心 `(8,16,8) → R·(8,16,8) + (0,0,16) = (8,16,8)`，是不动点 ✓。

### 4.2 父子叠加

`composite` 的变换作用在子节点的变换**之上**（`p″ = 父变换(子变换(p))`），
Blockbench 里也是父分组的旋转作用在已经旋转过的子分组上，两者顺序一致，
所以只要每个分组各自写入「自己那一层」的变换，整条骨骼链就自动正确，**不需要**自己做矩阵连乘。

### 4.3 轴心所在的坐标空间

默认按**方块展示实体**的语义：变换原点在模型元素坐标空间的 `(0,0,0)` 角上，
`translation` 以格为单位（1 = 16 像素）。这也是 `p′ = R·(p−O)+O` 直接映射过来的前提。

如果游戏按“物品中心”解释这个变换（原点在 `(8,8,8)`），两种约定的差别是 `(C − R·C)/16`，
`C = (8,8,8)`：**没被旋转的部分完全不变**，只有**旋转过的分组/方块**才会绕错轴心。
所以排错时要看的是「未旋转的部分对、旋转过的部分位置不对」，而不是“整体位移”。
勾选对话框里的「以物品中心 (8,8,8) 作为变换原点」重新导出即可（等价于用 `O − (8,8,8)` 代换上式里的 `O`）。

## 5. 限制与注意事项

- **需要 Java 版 26.1+**：`transformation` 字段在 26.1（快照 11）起才对 `composite`、`model` 等类型全面开放；
  更早的 1.21.x 只有部分类型支持，旧版本会直接忽略这个字段。
- **带自身旋转的方块**（Cube 的 `rotation` 非零）：原生模型元素只支持单轴、±45°，
  为了不丢精度，这类方块会被导出成**一个带 `transformation` 的 `minecraft:model` 子项**
  （轴心 = 方块的 `origin`），几何体放在单独模型文件里。
  开了 `rotation rescale` 的方块不会有 rescale 补偿（会给出提示）。
- **UV**：Java 模型的 uv 是 **0–16 空间**（整张贴图映射到 16×16）。插件会先看模型里 uv 的极值：
  已经在 0–16 内就直接使用（Java 格式的正常情况）；超出则按 `Project.texture_width/height` 换算到 0–16
  （基岩版/通用格式，或工程分辨率与 Java 不一致时）。换算后仍越界的值会被**夹到 0–16**——否则游戏烘焙时
  会抛 `Cannot compute translucency out of bounds` 并让整个模型失效——同时在 `.notes.txt` 里列出具体方块与面，
  提示你回到 Blockbench 修那些面的 UV 或纹理分辨率。
- **动画不烘焙**：导出读的是分组/方块当前的 `rotation`、`origin` 属性值；时间轴停在某一帧时就是那一帧的姿态。
- **只处理 `Cube`**：`Mesh`、`VoxelShape` 等其它元素会被跳过，并在提示中列出。
- 标记为「不导出」（`export = false`）的分组/方块会被跳过；隐藏（`visibility = false`）但未标不导出的仍会导出。
- 未指定纹理的面会退回 Blockbench 的默认纹理；完全取不到纹理对象时才会跳过该面。
- 纹理只有在以 data URL 内嵌于 `.bbmodel` 时才能自动打包，否则会弹窗提示，并在 `<id>.notes.txt` 里列出需要手动放置的路径。

## 6. 快速自检清单

导出后如果游戏里效果不对，按顺序排查：

1. 资源包路径对不对：`assets/<ns>/items/<id>.json`、`assets/<ns>/models/item/*.json`、`assets/<ns>/textures/item/*.png`；
2. 物品是否真的用了这个映射：给物品设置 `minecraft:item_model` 组件（如 `/give @s minecraft:paper[minecraft:item_model="custom:xxx"]`）；
3. 没旋转的部分正确、旋转过的部分位置不对 → 勾上「以物品中心为原点」（同理，反过来就是把它取消勾选）；
4. 整体不动 → 你可能忘了 Java 版需要 26.1+，旧版本读不到 `transformation`；
5. 旋转方向反了 → 检查你的模型是否需要在 Blockbench 里改旋转符号（本插件不做额外镜像）。
