#!/usr/bin/env node
/**
 * _bbcdp.js — 终端侧 Blockbench 控制台桥（CDP）
 *
 * 直接接入 Blockbench 渲染进程的 DevTools 会话（等价于软件内 Ctrl+Shift+I 的 Console），
 * 从终端实时读取：
 *   - console.log / warn / error / info / debug
 *   - 未捕获异常、浏览器日志（资源 404 等）
 *   - Blockbench 事件总线上的**全部**事件（通过挂钩 EventSystem.dispatchEvent）
 * 并且可以在页面里执行任意 JS（--eval）。
 *
 * 前置：Blockbench 必须以远程调试端口启动（主实例、默认 profile，插件照常加载）：
 *   & 'C:\Program Files\Blockbench\Blockbench.exe' --remote-debugging-port=9222 --remote-allow-origins=*
 * 注意：若已有实例在跑，新命令会被单实例锁转发而不生效 —— 必须先完全退出 Blockbench。
 * 用 --launch 可让本脚本自动检测并启动。
 *
 * 用法：
 *   node _bbcdp.js --launch --watch                 # 启动/接入并持续输出 console + 事件
 *   node _bbcdp.js --watch --out=_bbcdp.log         # 同上，并追加写入文件（便于事后回看）
 *   node _bbcdp.js --watch --event-filter="^update_selection$|^select$"
 *   node _bbcdp.js --eval="Blockbench.version"      # 一次性求值，打印结果
 *   node _bbcdp.js --eval-file=_probe.js            # 求值脚本文件内容
 *   node _bbcdp.js --eval="..." --eval="..."        # 可重复
 *   node _bbcdp.js --watch --no-events              # 只看 console
 *   node _bbcdp.js --list-targets                   # 只列出 CDP target
 *
 * 约定：本脚本只读不写 Blockbench 项目数据；--eval 的内容由调用方负责。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// ---------------------------------------------------------------------------
// 参数
// ---------------------------------------------------------------------------
// 内置探针：outliner 树快照（含 imda_* 字段），用于排查分支顺序/阈值
// ---------------------------------------------------------------------------
const SNAPSHOT_EXPR = `(function(){
    var KEYS = ['imda_type','imda_threshold','imda_threshold_format','imda_threshold_force','imda_property','imda_index','imda_scale','imda_model','imda_call_target'];
    function pad(d){ return new Array(d + 1).join('  '); }
    function line(node, depth, out){
        var props = [];
        for (var i = 0; i < KEYS.length; i++) {
            var v = node[KEYS[i]];
            if (v === undefined || v === null || v === '') continue;
            props.push(KEYS[i].replace('imda_', '') + '=' + JSON.stringify(v));
        }
        out.push(pad(depth) + (node.type || '?') + ' ' + (node.name || '') +
            ' #' + String(node.uuid || '').slice(0, 8) +
            (props.length ? '  |  ' + props.join(' ') : ''));
        var kids = node.children || [];
        for (var j = 0; j < kids.length; j++) line(kids[j], depth + 1, out);
    }
    var out = [];
    var roots = (typeof Outliner !== 'undefined' && Outliner.root) || [];
    for (var r = 0; r < roots.length; r++) line(roots[r], 0, out);
    return out.join('\\n');
})()`;

const argv = process.argv.slice(2);
const opts = {
    port: 9222,
    host: '127.0.0.1',
    evals: [],
    watch: false,
    events: true,
    eventFilter: null,
    out: null,
    launch: false,
    listTargets: false,
    blockbenchExe: 'C:\\Program Files\\Blockbench\\Blockbench.exe',
    waitMs: 20000,
    json: false,
    stdin: false,
    replay: false,
    reloadPlugin: null,
    testHook: false,
};

for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];
    const [k, ...rest] = raw.split('=');
    let val = rest.length ? rest.join('=') : null;
    // 支持空格分隔：--eval "CODE" / --port 9222 / --exe "路径"
    const takesValue = ['--port', '--host', '--eval', '--eval-file', '--event-filter', '--out', '--exe', '--reload-plugin'];
    if (val === null && k === '--eval' && i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        // 代码里通常含空格：把后续直到下一个 --flag 的参数全部拼进来，
        // 这样不论 shell 是否把整段代码当成一个参数都能工作
        const parts = [];
        while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) parts.push(argv[++i]);
        val = parts.join(' ');
    }
    if (val === null && takesValue.includes(k) && i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        val = argv[++i];
    }
    switch (k) {
        case '--port': opts.port = Number(val || 9222); break;
        case '--host': opts.host = val || '127.0.0.1'; break;
        case '--eval': if (val !== null) opts.evals.push(val); break;
        case '--eval-file': if (val) opts.evals.push(fs.readFileSync(val, 'utf8')); break;
        case '--watch': opts.watch = true; break;
        case '--no-events': opts.events = false; break;
        case '--event-filter': opts.eventFilter = val; break;
        case '--out': opts.out = val; break;
        case '--launch': opts.launch = true; break;
        case '--exe': opts.blockbenchExe = val; break;
        case '--list-targets': opts.listTargets = true; break;
        case '--json': opts.json = true; break;
        case '--stdin': opts.stdin = true; break;
        case '--replay': opts.replay = true; break;
        case '--reload-plugin': opts.reloadPlugin = val || 'item_model_definition_assembly'; break;
        case '--hook': opts.testHook = true; break;
        case '--snapshot': opts.evals.push(SNAPSHOT_EXPR); break;
        case '--help': case '-h': printHelp(); process.exit(0); break;
        default:
            if (k.startsWith('--')) { console.error(`未知参数: ${raw}`); printHelp(); process.exit(2); }
            break;
    }
}
if (!opts.watch && opts.evals.length === 0 && !opts.listTargets) opts.watch = true;
if (opts.stdin) opts.watch = true;

// 高频噪音事件：默认不转发（每帧都会触发，会淹没真正的日志）。
// 需要时用 --event-filter 显式请求，例如 --event-filter="render_frame"。
const NOISY_EVENTS = ['render_frame', 'update_camera', 'tick', 'frame', 'animate_preview', 'update_priorities'];

function printHelp() {
    console.log(`_bbcdp.js — 终端接入 Blockbench Console / 事件总线

  --launch                 未检测到调试端口时自动启动 Blockbench（带 --remote-debugging-port）
  --port=9222              远程调试端口（默认 9222）
  --watch                  持续输出 console / 异常 / 事件（默认行为）
  --no-events              不挂钩事件总线，只看 console
  --event-filter=<regex>   只转发名称匹配的 Blockbench 事件
  --out=<file>             同时追加写入文件（UTF-8）
  --eval=<js>              在页面里求值并打印结果（可重复）
  --eval-file=<file>       从文件读入求值代码
  --list-targets           只列出 CDP target 后退出
  --exe=<path>             Blockbench.exe 路径（配合 --launch）
  --stdin                  从标准输入逐行读 JS 求值（交互/管道），隐含 --watch
  --reload-plugin[=id]     重载插件（默认 item_model_definition_assembly），无需重启 Blockbench
  --hook                   重载前先设置 __IMM_TEST__ 测试钩子
  --replay                 附加时也输出接入前的 console 历史
  --json                   事件以 JSONL 输出
`);
}

// ---------------------------------------------------------------------------
// 输出
// ---------------------------------------------------------------------------
const outStream = opts.out ? fs.createWriteStream(path.resolve(opts.out), { flags: 'a', encoding: 'utf8' }) : null;
function emit(line) {
    process.stdout.write(line + '\n');
    if (outStream) outStream.write(line + '\n');
}
function ts() {
    const d = new Date();
    const p = (n, w = 2) => String(n).padStart(w, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}
function log(tag, text) { emit(`${ts()} ${tag} ${text}`); }

// ---------------------------------------------------------------------------
// 页面侧注入脚本：挂钩事件总线
// ---------------------------------------------------------------------------
function bridgeSource(filterSource) {
    return `(function(){
        try {
            // 配置放在全局，重复接入时只更新配置，不再重复包裹 dispatchEvent
            window.__bbcdpCfg = {
                re: ${filterSource} ? new RegExp(${filterSource}) : null,
                skip: ${JSON.stringify(NOISY_EVENTS)},
                max: 20
            };
            // 老包装器只更新配置；桥接代码本身变了就叠一层新包装器，并把旧代标记为惰性
            var VERSION = 2;
            if (window.__bbcdpHooked && window.__bbcdpBridgeVersion === VERSION) return 'config-updated';
            var GEN = window.__bbcdpGen = (window.__bbcdpGen || 0) + 1;
            var BUCKET_MS = 1000;
            var counts = {}, bucket = 0, muted = {};
            function short(v, depth) {
                if (v === null || v === undefined) return v;
                var t = typeof v;
                if (t === 'string') return v.length > 120 ? v.slice(0, 120) + '…' : v;
                if (t === 'number' || t === 'boolean') return v;
                if (t === 'function') return '[fn]';
                if (t === 'symbol' || t === 'bigint') return String(v);
                if (Array.isArray(v)) {
                    var head = v.length ? short(v[0], (depth || 0) + 1) : null;
                    return { __arr: v.length, head: head };
                }
                if (depth >= 1) {
                    if (v.uuid && v.name !== undefined) return v.name + '#' + String(v.uuid).slice(0, 8);
                    return '[obj]';
                }
                var out = {}, n = 0;
                for (var k in v) {
                    if (!Object.prototype.hasOwnProperty.call(v, k)) continue;
                    if (n++ >= 8) { out['…'] = true; break; }
                    try { out[k] = short(v[k], (depth || 0) + 1); } catch (e) { out[k] = '[err]'; }
                }
                return out;
            }
            function sendJSON(obj) {
                // binding（window.__bbcdp）由 CDP 会话建立；会话断开时不存在，静默跳过
                var fn = window.__bbcdp;
                if (typeof fn !== 'function') return;
                try { fn(JSON.stringify(obj)); } catch (e) { /* ignore */ }
            }
            function fire(name, data) {
                if (window.__bbcdpGen !== GEN) return; // 已被新代包装器取代
                var cfg = window.__bbcdpCfg || {};
                if (cfg.re && !cfg.re.test(name)) return;
                if (!cfg.re && cfg.skip && cfg.skip.indexOf(name) >= 0) return;
                // 同名事件限流：单桶最多 cfg.max 条，其余记入 muted，下一桶补一条汇总
                var now = Date.now(), b = Math.floor(now / BUCKET_MS);
                if (b !== bucket) {
                    bucket = b; counts = {};
                    for (var k in muted) {
                        if (muted[k] > 0) { sendJSON({ t: 'event', event: k, data: { muted: muted[k] } }); }
                    }
                    muted = {};
                }
                counts[name] = (counts[name] || 0) + 1;
                if (counts[name] > (cfg.max || 20)) { muted[name] = (muted[name] || 0) + 1; return; }
                var payload;
                try {
                    payload = short(data, 0);
                } catch (e) {
                    payload = '[unserializable]';
                }
                sendJSON({ t: 'event', event: name, data: payload });
            }
            var BB = window.Blockbench;
            if (!BB) return 'no-blockbench';
            // 沿原型链找到真正持有 dispatchEvent 的对象，挂上去覆盖所有实例
            var holder = BB;
            while (holder && !Object.prototype.hasOwnProperty.call(holder, 'dispatchEvent')) {
                holder = Object.getPrototypeOf(holder);
            }
            if (!holder || typeof holder.dispatchEvent !== 'function') return 'no-dispatchEvent';
            var original = holder.dispatchEvent;
            holder.dispatchEvent = function (name, data) {
                try { fire(name, data); } catch (e) { /* 绝不影响宿主 */ }
                return original.apply(this, arguments);
            };
            window.__bbcdpHooked = true;
            window.__bbcdpHolder = holder;
            window.__bbcdpBridgeVersion = VERSION;
            return 'ok(gen ' + GEN + ')';
        } catch (e) {
            return 'inject-error: ' + (e && e.message);
        }
    })()`;
}

// ---------------------------------------------------------------------------
// 极简 CDP 客户端
// ---------------------------------------------------------------------------
class Cdp {
    constructor(ws) {
        this.ws = ws;
        this.nextId = 0;
        this.pending = new Map();
        this.handlers = new Set();
        ws.addEventListener('message', (ev) => {
            let msg;
            try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)); } catch (e) { return; }
            if (msg.id && this.pending.has(msg.id)) {
                const { resolve, reject } = this.pending.get(msg.id);
                this.pending.delete(msg.id);
                if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.code})`));
                else resolve(msg.result);
                return;
            }
            for (const h of this.handlers) { try { h(msg); } catch (e) { /* ignore */ } }
        });
    }
    on(fn) { this.handlers.add(fn); }
    send(method, params = {}) {
        const id = ++this.nextId;
        const payload = JSON.stringify({ id, method, params });
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            this.ws.send(payload);
            setTimeout(() => {
                if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`CDP 超时: ${method}`)); }
            }, 30000);
        });
    }
}

async function httpJson(url) {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    return res.json();
}

async function waitForTargets(port, host, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    let lastErr = null;
    while (Date.now() < deadline) {
        try {
            return await httpJson(`http://${host}:${port}/json/list`);
        } catch (e) {
            lastErr = e;
            await new Promise(r => setTimeout(r, 500));
        }
    }
    throw new Error(`连不上 CDP 端口 ${host}:${port}（${lastErr && lastErr.message}）`);
}

function pickPage(targets) {
    if (!Array.isArray(targets) || !targets.length) return null;
    return targets.find(t => t.type === 'page' && /Blockbench/.test(`${t.title}${t.url}`))
        || targets.find(t => t.type === 'page')
        || null;
}

function launchBlockbench() {
    log('[launch]', `${opts.blockbenchExe} --remote-debugging-port=${opts.port}`);
    const child = spawn(opts.blockbenchExe, [
        `--remote-debugging-port=${opts.port}`,
        '--remote-allow-origins=*',
    ], { detached: true, stdio: 'ignore' });
    child.unref();
}

// ---------------------------------------------------------------------------
// 格式化 RemoteObject
// ---------------------------------------------------------------------------
function fmtRemote(o) {
    if (!o) return '';
    if (o.type === 'string') return o.value;
    if (o.type === 'undefined') return 'undefined';
    if ('value' in o) return typeof o.value === 'string' ? o.value : JSON.stringify(o.value);
    if (o.unserializableValue) return o.unserializableValue;
    if (o.preview && Array.isArray(o.preview.properties)) {
        const body = o.preview.properties.map(p => `${p.name}: ${p.value}`).join(', ');
        return `${o.description || ''} {${body}}`;
    }
    return o.description || o.className || o.type;
}

function fmtStackTrace(stack) {
    if (!stack || !Array.isArray(stack.callFrames) || !stack.callFrames.length) return '';
    const f = stack.callFrames[0];
    return ` @ ${f.url || '<page>'}:${(f.lineNumber || 0) + 1}`;
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
(async function main() {
    let targets = null;
    try {
        targets = await httpJson(`http://${opts.host}:${opts.port}/json/list`);
    } catch (e) {
        if (!opts.launch) {
            console.error(`[bbcdp] 无法连接 ${opts.host}:${opts.port}。\n` +
                `  Blockbench 需要用远程调试端口启动：\n` +
                `    & '${opts.blockbenchExe}' --remote-debugging-port=${opts.port} --remote-allow-origins=*\n` +
                `  （必须完全退出已有实例，单实例锁会让新参数失效）\n` +
                `  或加 --launch 让本脚本代劳。`);
            process.exit(1);
        }
        launchBlockbench();
        targets = await waitForTargets(opts.port, opts.host, opts.waitMs);
    }

    if (opts.listTargets) {
        for (const t of targets) console.log(`${t.type}\t${t.id}\t${t.title}\t${t.url}`);
        return;
    }

    const page = pickPage(targets);
    if (!page) { console.error('[bbcdp] 没有可用的 page target'); process.exit(1); }

    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
        ws.addEventListener('open', resolve, { once: true });
        ws.addEventListener('error', (e) => reject(new Error('WebSocket 连接失败: ' + (e.message || ''))), { once: true });
    });
    const cdp = new Cdp(ws);
    const attachMs = Date.now();

    if (!opts.json) log('[bbcdp]', `已接入 ${page.title} (${page.id.slice(0, 8)}) port=${opts.port}`);

    let lastEventKey = '', lastEventAt = 0;
    cdp.on((msg) => {
        if (!opts.watch) return; // 一次性求值模式不转发流
        switch (msg.method) {
            case 'Runtime.consoleAPICalled': {
                const p = msg.params;
                // 附加时 Runtime.enable 会重放历史日志；默认丢弃接入前的条目
                if (!opts.replay && typeof p.timestamp === 'number' && p.timestamp < attachMs - 1000) break;
                const text = (p.args || []).map(fmtRemote).join(' ');
                log(`[${p.type}]`, text + fmtStackTrace(p.stackTrace));
                break;
            }
            case 'Runtime.exceptionThrown': {
                const d = msg.params.exceptionDetails;
                const desc = (d.exception && (d.exception.description || d.exception.value)) || d.text;
                log('[exception]', String(desc).split('\n').slice(0, 6).join('\n    ')
                    + ` @ ${d.url || '<page>'}:${(d.lineNumber || 0) + 1}`);
                break;
            }
            case 'Log.entryAdded': {
                const e = msg.params.entry;
                if (!opts.replay && typeof e.timestamp === 'number' && e.timestamp < attachMs - 1000) break;
                log(`[log:${e.level}]`, `${e.text}${e.url ? ' ' + e.url : ''}`);
                break;
            }
            case 'Runtime.bindingCalled': {
                if (msg.params.name !== '__bbcdp') break;
                if (opts.json) { emit(msg.params.payload); break; }
                let obj = null;
                try { obj = JSON.parse(msg.params.payload); } catch (e) { emit(`[bridge] ${msg.params.payload}`); break; }
                // 去重：若页面残留旧版包装器（脚本升级后、未重启 Blockbench），同一事件会报两次
                const key = obj.event ? `${obj.event}|${JSON.stringify(obj.data)}` : '';
                const nowMs = Date.now();
                if (key && key === lastEventKey && nowMs - lastEventAt < 8) break;
                lastEventKey = key; lastEventAt = nowMs;
                if (obj.t === 'event') log('[event]', `${obj.event} ${JSON.stringify(obj.data)}`);
                else log('[bridge]', JSON.stringify(obj));
                break;
            }
            case 'Runtime.executionContextsCleared': {
                // 页面重载：重新挂 binding + 注入
                reinstall(cdp).catch(() => {});
                break;
            }
            default: break;
        }
    });

    // 一次性求值模式不启用 Runtime 域：Runtime.enable 会把整段 console 历史重放一遍
    if (opts.watch) {
        await cdp.send('Runtime.enable');
        await cdp.send('Log.enable');
        try { await cdp.send('Page.enable'); } catch (e) { /* 有些 Electron 版本不需要 */ }
    }

    async function reinstall(client) {
        if (opts.events) {
            try { await client.send('Runtime.addBinding', { name: '__bbcdp' }); } catch (e) { /* 已存在 */ }
            const r = await client.send('Runtime.evaluate', {
                expression: bridgeSource(opts.eventFilter ? JSON.stringify(opts.eventFilter) : 'null'),
                returnByValue: true,
                awaitPromise: false,
            });
            const v = r.result && r.result.value;
            if (!opts.json) log('[bbcdp]', `事件挂钩: ${v}`);
        }
    }

    if (opts.events) await reinstall(cdp);

    async function evaluateExpr(expr) {
        const res = await cdp.send('Runtime.evaluate', {
            expression: expr,
            returnByValue: true,
            awaitPromise: true,
            userGesture: true,
        });
        if (res.exceptionDetails) {
            const d = res.exceptionDetails;
            const desc = (d.exception && (d.exception.description || d.exception.value)) || d.text;
            log('[eval:error]', String(desc).split('\n').slice(0, 8).join('\n    '));
            process.exitCode = 1;
            return;
        }
        const r = res.result || {};
        let text;
        if (r.type === 'string') text = r.value;
        else if ('value' in r) text = JSON.stringify(r.value, null, 2);
        else text = fmtRemote(r);
        log('[eval]', typeof text === 'string' ? text : JSON.stringify(text));
    }

    // --reload-plugin：只重载插件（不重启 Blockbench）。用于“复制新文件到 plugins 目录”之后。
    if (opts.reloadPlugin) {
        const id = JSON.stringify(opts.reloadPlugin);
        const expr = `(async () => {
            try {
                ${opts.testHook ? 'globalThis.__IMM_TEST__ = globalThis.__IMM_TEST__ || {};' : ''}
                const pid = ${id};
                let p = Plugins.all.find(x => x.id === pid);
                if (!p) return 'plugin-not-found: ' + pid;
                const before = p.version;
                await p.reload();
                p = Plugins.all.find(x => x.id === pid);
                return JSON.stringify({ id: pid, before, version: p && p.version, disabled: !!(p && p.disabled), hook: !!globalThis.__IMM_TEST__ });
            } catch (e) { return 'reload-error: ' + ((e && e.message) || e); }
        })()`;
        await evaluateExpr(expr);
    }
    for (const expr of opts.evals) await evaluateExpr(expr);

    // 交互式：从 stdin 逐行读 JS 求值（可直接在终端输入，也可由编辑器/脚本管道喂入）
    if (opts.stdin) {
        opts.watch = true;
        const readline = require('readline');
        const rl = readline.createInterface({ input: process.stdin, terminal: false });
        rl.on('line', (line) => {
            const code = line.trim();
            if (!code) return;
            if (code === ':events-on') { opts.events = true; reinstall(cdp).catch(() => {}); return; }
            if (code === ':quit') { process.exit(0); }
            evaluateExpr(code).catch((e) => log('[eval:error]', e.message));
        });
        if (!opts.events) await reinstall(cdp);
    }

    if (!opts.watch) {
        try { ws.close(); } catch (e) { /* ignore */ }
        if (outStream) outStream.end();
        setTimeout(() => process.exit(process.exitCode || 0), 50);
        return;
    }

    const shutdown = () => {
        try { ws.close(); } catch (e) { /* ignore */ }
        if (outStream) { try { outStream.end(); } catch (e) { /* ignore */ } }
        process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
})().catch((e) => {
    console.error('[bbcdp] 失败:', e && e.message || e);
    process.exit(1);
});
