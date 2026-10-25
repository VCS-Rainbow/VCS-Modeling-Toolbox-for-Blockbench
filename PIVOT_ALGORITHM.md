# 枢轴 / 几何中心算法约定

本文记录 VMT（VCS' Modeling Toolbox）里所有“枢轴归中”和“源模型几何中心”的计算约定。以后改动相关代码必须同时检查这里列出的两处实现。

## 必须共用同一套中心算法

以下功能计算出的几何中心必须一致：

- `Tools → 辅助功能 → 枢轴归位（对齐几何中心）…`
- `Tools → 辅助功能 → 参考源文件重建枢轴点…`
- 其它任何“把枢轴放到几何中心”的功能

统一入口（插件内）：

```js
averagePoints(points) // 对一组已变换到同一坐标系的点求平均
```

### Blockbench 工程节点

`fixGroupPivot(group)` 的流程：

1. `pivotContentPoints(group)` 收集分组本地下所有后代方块的中心；
2. 每个方块中心先按方块自身 `rotation`（`origin` 为旋转中心）旋转；
3. 子分组按 `origin/rotation` 递归变换；
4. 得到分组本地的点集；
5. 再用当前分组的 `rotation/origin` 变换到父坐标系；
6. `averagePoints(rendered)` 得到目标枢轴；
7. 平移内容补偿，保持外观不变。

### Java 源模型

`sourceModelGeometryCenter(reference)` 的流程：

1. `resolveJavaModel()` 读取并沿 `parent` 合并 `elements/groups`；
2. 建立 element 下标 → 祖先分组链；
3. 每个 element 取 `from/to` 中点；
4. 按 element 自身 `rotation` 旋转：
   - `{ angle, axis, origin }` → 对应轴的欧拉角；
   - `{ x, y, z, origin }` → 欧拉角；
5. 按祖先分组链的 `origin/rotation` 依次变换；
6. `averagePoints(points)` 得到源模型几何中心；
7. 与模型坐标原点 `[0,0,0]` 的差即 `sourceOffset`。

## 关键注意

- **不要用包围盒中心替代平均中心。** 源模型元素带旋转时，两者差别很大（例如 `sac.full`：平均中心 `(1.4799,-4.4524,0)`，包围盒中心 `(1.0591,-3.7754,0)`）。
- 分组 `origin` 是父坐标系里的位置；把局部偏移应用到 `origin` 时必须先乘分组旋转 `R`，不能乘 `R⁻¹`。
- 方块/元素自身的 `rotation.origin` 必须参与，否则带旋转的元素中心会偏。
- 源模型分组链的 `origin` 只作为旋转中心，不会自动平移几何；不要额外加 origin 平移。

## 相关代码位置

- `averagePoints()`：共用平均函数
- `fixGroupPivot()` / `pivotContentPoints()` / `pivotCubeCenter()`：Blockbench 侧
- `sourceModelGeometryCenter()`：Java 源模型侧
- `rebuildPivotFromSourceDialog()`：参考源文件重建枢轴点
- `restoreGroupPivotFromRecord()` / `restoreCubePivotFromRecord()`：从 `imda_pivot_offset` 记录恢复

## 记录格式

「枢轴归位」写：

```js
imda_pivot_offset = JSON.stringify([x, y, z])
```

含义：归中前枢轴相对几何中心的位移，已旋转到节点局部坐标系。

「从记录重建枢轴点」按当前几何中心 + 当前旋转还原：

```js
pivot = center + R * imda_pivot_offset
```
