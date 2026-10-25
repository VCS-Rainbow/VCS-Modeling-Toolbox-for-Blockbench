# 本轮会话纪要（2026-10-25）

项目：`blockbench_item_model_mapping_isolated`  
插件：**VCS' Modeling Toolbox (VMT)**  
模块：**Item Model Definition Assembly (IMDA)**

最终版本：**v0.68.85**  
最终测试：**207 / 207**  
远程仓库：`https://github.com/VCS-Rainbow/VCS-Modeling-Toolbox-for-Blockbench`

---

## 1. Tools 菜单排版

### 要求 / 反馈

- Tools 菜单需要显示：
  ```
  ---==VCS Modeling Toolbox==---
  ---[ 模型装配 ]---
  ---时间轴---
  ---[ 辅助功能 ]---
  ```
- 第一次修改后反馈“还是坏的”。
- 后续反馈“VCS Modelling 上面没有分割线”。
- 要求恢复「模型装配」下的其他分类，不是只留时间轴。

### 处理

- 发现 Blockbench 会跳过相邻分隔线：上一条是 `MenuSeparator` 时，当前分隔线不渲染。
- 尝试过合并标题、标题菜单项、`CustomMenuItem`，出现过显示成复选框/问号的问题。
- 最终结构：
  - `==VCS Modeling Toolbox==`：不可点击标题项，带 `label` 图标；
  - `[ 模型装配 ] - 结构`
  - `复调用`
  - `调试`
  - `时间轴`
  - `[ 辅助功能 ]`
- 增加 `cleanOwnMenu()`：每次加载先清理上次 VMT 添加的菜单项，避免重载后重复。
- 标题上方补分隔线。

### 结果

- 菜单标题、分区、重复项问题在 0.68.19 前后稳定。

---

## 2. 项目设置里的“显示位置动画”是什么

### 要求

- 询问项目设置里的「显示位置动画」是做什么的。

### 处理

- 定位到该设置不是 VMT/IMDA 的，而是已安装插件 `display_anim_preview.js`（Java 逐帧显示动画）。
- 属性键 `display_anim_variants`，按显示位置控制是否播放逐帧动画。

### 结果

- 说明与 VMT 时间轴导出无关，可直接禁用该插件。

---

## 3. 复调用标签不输出 / 位置 / 命名

### 要求 / 反馈

- “导出时复调用标签没有被输出。”
- 四个调用标签只输出一个。
- 输出的 `node_name` 是本体名，不是标签名。
- 批量选择复调用标签设置目标，只改最后一个。
- 修改目标后又变回“未设置”，模型 id 又出现。
- 导出后目标变空。
- 多选右键时选择集合只取到一个。
- 失效旧 UUID 标签需要修复。

### 处理

- `range_dispatch` / `select` 下的 Locator 之前被清空，改为合并到 fallback，并在后期改为 range 的 entries。
- 复调用克隆后补 Locator 位姿补偿：
  ```
  R_delta = R_locator · R_target⁻¹
  t = P_locator − R_delta · O_target
  ```
- 输出 `node_name` 改用 Locator 名。
- 批量编辑改用 `Outliner.selected + Locator.selected + selected 标记` 并集。
- 修复“失效 UUID 被预填进模型 id 字段”导致覆盖目标选择的问题：只有含 `:` 的模型 id 才预填。
- 修复 `adoptImdaAll` 用空 `imda_call_target` 覆盖真实值的问题；改为不覆盖已有键。
- 增加「修复失效的复调用目标…」，扫描目标 UUID 不存在的标签统一改目标。
- 导出时目标 UUID 不存在会警告并跳过。

### 结果

- 0.68.20、0.68.21、0.68.22、0.68.23、0.68.25、0.68.26 等版本逐步修复。

---

## 4. 全量 `imm_` → `imda_`

### 要求

- “把所有 imm_ 改成 imda_，不要保留。”

### 处理

- 全局替换代码、属性、Action、测试、README。
- 增加旧项目迁移 `migrateLegacyAll()`：加载/导出前把 `imm_*` 转成 `imda_*` 并删除旧键。
- 删除双前缀同步、迁移工具入口。

### 事故 / 反馈

- 项目设置 UI 全部消失。
- 用户指出：“是不是把 imm 的 UI 删光了，没把 imda 注册进 UI。”

### 根因与修复

- `P()` 里残留双前缀逻辑，同一个 `imda_*` 注册两次，第二次 `exposed:false` 覆盖了第一次。
- 改为单次注册、`exposed:true`。
- 用户要求先回退到 **v0.68.27**，已执行并部署。

### 结果

- 后续恢复到最新代码，并保留 UI 修复。

---

## 5. F5 快捷键

### 要求 / 反馈

- 默认给“导出物品模型映射”加 F5。
- 不要新增 JSON 菜单项，要原来的按钮。
- “按 F5 还是导出 JSON 文件那个按钮的效果。”
- 要打开“之前版本的那个对话框”。
- 最后明确：**F5 是合并到资源包，而不是导出物品模型映射。**

### 处理

- 尝试过新增导出 Action、`default_keybind`、`keybind`、触发原 export 菜单项、`codec.export()`。
- 最终：
  - 移除新增导出菜单项；
  - F5 绑定到 `合并到资源包…`（`imda_merge_pack`）；
  - `keybind: new Keybind({ key: 116 })`。
- 版本 0.68.38 恢复最新代码。

### 结果

- F5 = 合并到资源包。

---

## 6. 引用模型 / 内部结构 / 染色 / 枢轴

### 要求

- 引用模型分组不要设为 inline，新增「内部结构」类型。
- 点击元素自动选组时，如果分组是 internal，要一路向上选到引用模型。
- 引用模型 tint index 顺延到 internal 并影响所有内部元素。
- internal 页面下拉不能为空。
- 点击分组本身不应触发向上选取，除非是 internal。
- 引用模型改其他类型时警告会删除下属元素。

### 处理

- 新增 `internal` 类型，导入引用模型子分组设为 internal。
- `guardBoxSelection` 支持 internal 上溯到 model。
- `tintGroupOf()` 沿祖先查找 tint；`walkTint` 把 tint 下发到 internal 与所有面。
- 补 `internal（内部结构）` 下拉选项。
- 直接选中非 internal 分组时不再向上选取。
- 引用模型改类型时弹确认框，继续则删除下属分组/元素。
- 规范化结构时清理父级不是 internal/model 的 internal 分组。

### 结果

- 0.68.40 ~ 0.68.76 逐步完成。

---

## 7. 引用模型位置 / 源原点对齐

### 要求 / 反馈

- 输出的 group3 偏移一格。
- 删除 bone7 后正常。
- “不是视觉问题。”
- 引用模型的枢轴点和源文件坐标原点不重合。
- 要求“把源模型整体移动到它的坐标原点和分组枢轴点重合”。

### 调查

- 对比 `assembly.bbmodel` / `assembly_1`：
  - group3 的 origin/rotation、子 cube 数据一致；
  - group3 的累积矩阵在两份输出中完全一致；
  - bone7 与 group3 同层，不改变 group3 的 transformation；
  - bone7 实际包含 sacpack1 引用模型和复调用标签，删除 bone7 等于删除弹匣。
- 发现引用模型导入时把目标分组 origin 烘进方块坐标，导出又应用一次分组 origin，形成双重变换。
- 源模型 `sac.full` 的几何中心必须按 element 自身 rotation + 分组链计算，不能用包围盒中心。

### 处理

- 导入 `import_base` 改为 `目标枢轴 − 源模型原点`。
- 记录 `imda_model_origin`；导出时对 model 类型应用相同偏移。
- 兼容旧导入数据：没有 `imda_model_origin` 时按 `[0,0,0]` 计算。
- 增加共用 `averagePoints()`；新增算法笔记 `PIVOT_ALGORITHM.md`。

### 结果

- 源中心与「枢轴归位」使用同一套算法；
- `sac.full` 平均中心为 `(1.4799, -4.4524, 0)`。

---

## 8. 枢轴功能

### 要求

- 新增「参考源文件重建枢轴点」：
  - 先使枢轴居中；
  - 从源文件计算几何中心到原点的位移；
  - 按当前旋转转成局部坐标；
  - 保持模型不变地移动枢轴；
  - 对复调用 Locator 也可用，且只处理复调用标签，区分普通定位点。
- 「枢轴归位」保存归中前枢轴相对几何中心的位置；
- 新增「从记录重建枢轴点」。

### 处理

- 新增 `imda_pivot_offset` 记录。
- 新增「从记录重建枢轴点…」。
- 新增「参考源文件重建枢轴点…」：
  - `sourceModelGeometryCenter()` 读取源模型 element 中心 + 自身 rotation + 分组链；
  - 分组按 `R * sourceOffset` 移动；
  - 复调用 Locator 只移动 `imda_call_target` 非空的；
  - 普通 Locator 跳过。
- 抽出 `averagePoints()` 供两处共用。
- 新增 `PIVOT_ALGORITHM.md` 记录算法与易错点。

### 结果

- 0.68.52 ~ 0.68.56。

---

## 9. 动画时间轴 / cooldown / 根参数

### 要求

- 动画右键菜单里的「时间轴属性」消失，修复。
- cooldown 时间轴阈值钳制到 0..1 并倒置：第一帧 1，最后一帧 0。
- 不要反转帧，只倒置阈值。
- 其他时间轴 property 应有自己的属性。
- 项目设置可以调整：
  - `hand_animation_on_swap`
  - `oversized_in_gui`
  - `swap_animation_scale`

### 处理

- 时间轴菜单挂载增加校验、项目加载后重挂、延迟重挂。
- `cooldownThresholds()`：按原帧顺序返回 `1 → 0` 阈值，不 reverse entries。
- 时间轴增加 compass/time/count/damage/use_cycle/use_duration 字段。
- 项目设置新增三个根参数，导出 `items/*.json` 时非默认值才写入。

### 结果

- 0.68.58 ~ 0.68.61。

---

## 10. 复调用序列 / 弹匣容量

### 要求 / 反馈

- 「复调用序列」功能不见了。
- 定位器不算在选择里。
- 想表达：弹匣上限 5 = 弹匣1 + 复调用2/3/4/5。
- 生成后只有复调用，分组节点没了。
- 序列号递增，但内容递减。
- 实例化后撤回残留方块。
- 实例化后位置不对、子分组枢轴错位。
- 实例化后名称/变换没有继承。
- 实例化确认框按钮顺序不符合直觉。

### 处理

- 序列 Action 改为始终显示，点击时校验。
- 序列项支持分组 + 复调用 Locator。
- 只有 Locator 选中且目标相同时，自动补目标分组作为本体。
- 节点名改为按数量 `#N`。
- 实例化：
  - `duplicate()` 替代不存在的 `clone()`；
  - 继承 Locator 名称/位置/旋转；
  - 平移整棵子树（含子分组 origin 和 cube 坐标）；
  - 收集所有 cube 进 Undo；
  - 按原 Locator 在父级中的索引插入，保持大纲顺序；
  - 确认框改为左「实例化」、右「取消」。
- 新增：
  - Tools「实例化选中的复调用标签」；
  - Locator 右键「实例化此标签」。
- 修复 `walk` 作用域错误导致确认框不出现。

### 结果

- 0.68.62 ~ 0.68.85。

---

## 11. 复调用覆盖参数

### 要求 / 反馈

- 复调用可以调整源节点参数。
- 把源节点映射属性同步到复调用属性下面。
- 映射类型跟随源，保证结构一致。
- 阈值等可自定义，并在生成时覆盖。
- 编辑格式应与直接编辑节点一样，按源类型显示字段。
- 没有的覆盖项要清空/折叠。
- “你把编辑目标分组的功能都弄没了。”
- range_dispatch 还应能覆盖分支编号格式。
- 编号格式没有继承。

### 处理

- Locator 增加 `imda_call_overrides` JSON。
- 编辑页按源类型生成字段，留空不覆盖。
- 覆盖键使用 `ov_` 前缀，避免覆盖「目标分组」字段。
- 支持：
  - property/index/scale
  - threshold
  - threshold_format
  - component/predicate/value/keybind
  - compass/time/wobble/normalize/period/remaining
  - condition
- 导出时先把覆盖应用到目标 clone，再包位姿层。
- range 下复调用作为 entries，阈值从覆盖读取。
- 实例化时把覆盖属性写进复制分组。

### 结果

- 0.68.70 ~ 0.68.84。

---

## 12. 规范化 / 类型切换

### 要求

- 规范化结构时，internal 元素/分组的父级不是 internal 或引用模型节点就删除。

### 处理

- `removeInvalidInternalGroups()`：
  - 父级必须是 `internal` 或 `model`；
  - 否则删除整个子树；
  - 删除可撤销。
- 规范化提示中显示删除数量。

### 结果

- 0.68.75。

---

## 13. 最终状态

- 版本：`v0.68.85`
- 测试：`207 / 207`
- 已推送 GitHub：
  - `master`
  - 标签 `v0.68.81` ~ `v0.68.85` 等
- 主要文档：
  - `CHANGELOG.md`
  - `HANDOFF.md`
  - `PIVOT_ALGORITHM.md`
  - `item_model_definition_assembly_README.md`

---

## 14. 本轮暴露的问题 / 经验

1. **Blockbench 菜单分隔线不能相邻**，标题必须用非分隔项或合并。
2. **`P()` 属性只能注册一次**，别名覆盖 `exposed` 会导致整个设置 UI 消失。
3. **项目文件未保存时不要对比导出结果**，先 Ctrl+S。
4. **引用模型导入/导出必须使用同一套 origin 约定**，否则双重变换。
5. **源模型几何中心要按 element rotation + group 链求平均**，不能用包围盒。
6. **`Undo.finishEdit` 必须登记新建分组和所有后代 cube**，否则撤回残留。
7. **复调用覆盖要作用在目标 clone 上**，不能作用到外层位姿 wrapper。
8. **右键菜单旧结构不会自动重排**，需要移除旧项后重新插入。
