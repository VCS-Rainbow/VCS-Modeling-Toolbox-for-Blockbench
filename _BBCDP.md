# 终端接入 Blockbench 控制台（`_bbcdp.js`）

用途：不用盯着软件内 Ctrl+Shift+I 的 Console，直接在终端读 Blockbench 渲染进程的
**console 输出 / 未捕获异常 / 全部 Blockbench 事件**，并能在页面里执行任意 JS。
用于调试「选择分支时顺序变化」「实例化/撤销」这类只能看运行时行为的缺陷。

## 0. 前提：带远程调试端口启动（一次性）

CDP 端口只能在启动时打开，且必须**完全退出**已有实例（Blockbench 有单实例锁，
新进程会把参数转发给旧实例后自行退出，端口的 flag 会失效）：

```powershell
& 'C:\Program Files\Blockbench\Blockbench.exe' --remote-debugging-port=9222 --remote-allow-origins=*
```

用默认 user-data 目录（`%APPDATA%\Blockbench`）启动，所以 `plugins\` 下的插件照常加载，
**不会再出现早先 9224 临时 profile 那种「无效格式 / 插件没加载」的问题**。

校验端口活着：

```powershell
(Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:9222/json/list').Content
```

之后启动、停止本工具都不需要重启 Blockbench，可以反复接入/断开。

## 1. 持续监听（主用法）

```powershell
$node = 'C:\Users\Rainbow_\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
& $node _bbcdp.js --watch --out=_bbcdp.log
```

输出行格式：

```
18:43:58.041 [log]      [装配] 分支同步触发 ...   @ PLUGINS/(Plugin):item_model_definition_assembly.js:1234
18:43:58.042 [event]    update_selection {"name":"bone7","uuid":"..."}
18:43:58.043 [exception] TypeError: ...
18:43:58.044 [log:error] Failed to load resource ...
```

- `[log] [warning] [error]` = 页面的 `console.*`（含插件自己的中文日志，UTF-8 正常）
- `[exception]` = 未捕获异常
- `[event]` = `Blockbench.dispatchEvent(name, data)` 的全部事件
- `[log:*]` 前缀的是浏览器层日志（资源 404、CDN 超时等噪音）

常用开关：

| 参数 | 说明 |
| --- | --- |
| `--out=<file>` | 同时追加写入文件（UTF-8；**PowerShell 直接看 stdout 会乱码**，用 `Get-Content -Encoding utf8` 读文件最稳） |
| `--event-filter=^update_selection$\|^select$` | 只看指定事件（正则） |
| `--no-events` | 不挂钩事件总线，只看 console |
| `--launch` | 端口没开时自动带 flag 启动 Blockbench |
| `--replay` | 附加时连接入前的 console 历史一起输出（默认丢弃） |
| `--stdin` | 从标准输入逐行读 JS 求值（`:quit` 退出） |
| `--json` | 事件按 JSONL 输出 |

噪音控制：`render_frame`、`update_camera`、`tick` 等每帧事件默认屏蔽；
其余同名事件每秒最多 20 条，超出部分按秒汇总成 `{"muted":N}`。

## 2. 一次性求值

```powershell
& $node _bbcdp.js --eval "Blockbench.version"
& $node _bbcdp.js --snapshot          # 内置：outliner 树 + imda_* 字段
```

`--snapshot` 直接给分组顺序/阈值排查用，输出形如：

```
group bone7 #a1b2c3d4  |  type="range_dispatch" threshold_format="5-i"
  group [5] sacpack1 #... |  threshold=5
  group [4] 调用 sacpack2 #... |  threshold=4
```

注意：`--eval` 里的代码若含空格，本脚本会把 `--eval` 之后的参数拼成一个表达式，
所以 `--eval "a(1, 2)"` 这种写法在 PowerShell / Start-Process 下都能用。

## 3. 事件名参考

Blockbench 5.2.2 的 `dist/bundle.js` 里共有 159 个 `dispatchEvent('...')` 事件名。
与本插件相关的常用项：

```
update_selection  select  unselect_all  select_all  added_to_selection
add_group  add_cube  add_locator  remove  delete
init_edit  finish_edit  undo  redo  create_undo_save
load_project  new_project  save_project  select_project  close_project
update_settings  update_project_settings  change_active_panel
update_outliner(无)  ——  outliner 变化没有单独事件，靠 add_group/remove/finish_edit
```

## 4. 实现要点（给后续维护）

- 事件挂钩：沿原型链找到持有 `dispatchEvent` 的对象，包装它，fire 前不改变宿主行为；
  包装器带「代」（`window.__bbcdpGen`），脚本升级后叠新包装器、旧代自动惰性。
- 事件数据序列化在页面侧完成（`short()`，节点显示为 `名字#uuid前8位`，最多 8 个键），
  通过 `Runtime.addBinding('__bbcdp')` 送回来；页面侧异常全部吞掉，绝不影响宿主。
- `--eval` 模式**不启用** `Runtime`/`Log` 域：否则 `Runtime.enable` 会把整段 console
  历史重放一遍（启动时插件日志上千行）。
- 终端去重：同一事件 + 同一数据在 8ms 内重复，只输出一次（兼容页面里残留旧包装器）。
