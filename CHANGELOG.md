# 更新日志

版本规则：**开发阶段主版本号保持 0（0.x.y）**——修 bug 用 patch（0.6.x），加功能用 minor（0.x.0），每次改动都 bump 并打 git tag `v<版本>`；正式发布时才升到 1.0.0。

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
