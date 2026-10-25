# AGENTS.md — VCS' Modeling Toolbox (VMT) / IMDA

本文件对本仓库的所有后续改动生效。违反下面的约定视为 bug。

## 1. 生成 Blockbench 对象：必须同时调用 `addTo` 和 `init`

任何新建的 **Group / Locator / Cube**（以及后续可能新增的 Outliner 节点类型）都必须：

1. 创建对象；
2. 调用 `addTo(parent)`（根节点用 `addTo()`）；
3. 调用 `init()`。

顺序固定为 **先 add，后 init**；不要只调用其中一个。

统一封装：

```js
function addAndInit(node, parent) {
    if (!node) return node;
    try {
        if (parent) node.addTo(parent);
        else node.addTo();
    } catch (e) { /* ignore */ }
    try { if (typeof node.init === 'function') node.init(); } catch (e) { /* ignore */ }
    return node;
}
```

禁止写法：

```js
new Group({...}).addTo(parent);          // 缺 init
const g = new Group({...});
g.init();                                // 缺 add
```

## 2. 新增/修改导出节点

- 产出 mapping 节点时必须设置 `node_name`（由源分组名来）；
- 不要为了“承载 display”往 composite 里塞空模型：composite 子项是平行关系，display 是每个模型独立的；
- 静态祖先的 `transformation` 不能丢：拼接子节点前不要用 `nodeIsEmpty()` 判断空 shell。

## 3. 命名与兼容

- 插件名：**VCS' Modeling Toolbox（VMT）**
- 装配模块：**Item Model Definition Assembly（IMDA）**
- 格式 id 固定 `item_model_definition_assembly`
- `imda_*` 是主键；`imm_*` 是隐藏兼容别名，不新增旧前缀。

## 4. 动画时间轴

- 逐帧只改 `transformation`，同一分组的静态模型文件所有帧复用；
- 采样前把 `animator.keyframes` 回填到通道，并同步 `animation.time` 与 `Timeline.time`；
- 只有真正带姿态的节点生成 `range_dispatch`；静态祖先保留原层级与 transformation。

## 5. 改动后必须验证

- `node --check item_model_definition_assembly.js`
- `node _test_sim.js`
- `node _test_assembly.js`
- 相关新行为补最小回归测试，再部署到 `%APPDATA%\Blockbench\plugins`。
