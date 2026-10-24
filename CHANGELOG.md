# 更新日志

版本规则：**每次改动都 bump 版本号**——修 bug 用 patch（1.5.x），加功能用 minor（1.x.0），并打 git tag `v<版本>`。

## 1.5.0
- **每份模型几何居中到 (8,8,8)**：元素 `from/to` 与元素 `rotation.origin` 一起平移，所有位移/旋转改由 `transformation` 承担，元素坐标始终在 `[-16,32]` 内。
- 无旋转的分组现在也会输出纯平移的 `transformation`（用于承载居中偏移）。

## 1.4.0
- 「检查装配结构」升级为**变换诊断**：逐个分组打印 `origin` / `rot` / 四元数 / 旋转角 / 计算出的 `translation`。

## 1.3.0
- 合并到资源包时，确认框**列出将被覆盖 / 新建 / 删除的具体文件**（每类最多 20 条）。
- 网页版等无本地文件权限的环境给出降级提示。

## 1.2.0
- 新增 **合并到资源包…**：用 `pickDirectory` + `requireNativeModule('fs', {scope})` + `writeFile` 直接写入目标资源包，覆盖同名文件，并用 `.imm-assembly-manifest.json` 清理上一轮生成的过期文件；目标路径记入项目设置。

## 1.1.0
- 分组属性编辑对话框（`Tools → 编辑分组映射属性…`，也尝试挂到分组右键菜单）：`imm_type` / `imm_model` / `imm_property` / `imm_index` / `imm_threshold` / `imm_scale` / `imm_tints`。
- 说明：Blockbench 不会把 `exposed` 的分组属性渲染成面板，故自带对话框。
- 项目属性：`imm_namespace` / `imm_center_pivot` / `imm_block_display` / `imm_pack_path`。
- 变换枢轴默认改为 block 原点 `(0,0,0)`（= 像素 0,0,0）；`(0.5,0.5,0.5)`（= 像素 8,8,8）为可选项。

## 1.0.0
- 注册模型格式 `item_model_definition_assembly`（物品模型映射装配）。
- 每个分组 → 一个映射节点：`composite` / `model` / `range_dispatch` / `condition` / `empty`。
- 分组变换 → `transformation`（`left_rotation` 四元数 + `translation` 枢轴补偿，单位：格）。
- 每层分组的方块合并进同一模型文件，`from/to` 保留负尺寸，单轴旋转写成元素 `rotation`。
- 支持 `can_convert_to`（Project → Convert）与 `parent_model_id`；导出 zip（items + models + textures + notes）。
