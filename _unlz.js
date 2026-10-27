#!/usr/bin/env node
/**
 * _unlz.js — 解压 Blockbench 的 `<lz>` 压缩项目（`*.bbmodel` 备份）
 *
 * Blockbench 保存的备份是 `<lz>` + lz-string 的 StorageBinaryString 编码。
 * 本脚本从 `app.asar` 的 `dist/bundle.js` 里抠出 lz-string 模块（`var ci;` … `var Lw=ci;`）
 * 在 vm 里执行，再用 `ci.decompress(..., {inputEncoding:'StorageBinaryString'})` 还原。
 *
 * 用法：
 *   node _unlz.js <in.bbmodel> [out.json]      # 解压并写普通 JSON（省略 out 则打印到 stdout）
 *   node _unlz.js --probe <in.bbmodel>         # 只打印元信息（大小/顶层键/分组数）
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ASAR = 'C:\\Program Files\\Blockbench\\resources\\app.asar';
const BUNDLE_CACHE = path.join(require('os').tmpdir(), 'bb_bundle_utf8.txt');
const LZ_CACHE = path.join(require('os').tmpdir(), 'bb_lz_module.js');

function loadLzModule() {
    if (fs.existsSync(LZ_CACHE)) return fs.readFileSync(LZ_CACHE, 'utf8');
    let src;
    if (fs.existsSync(BUNDLE_CACHE)) {
        src = fs.readFileSync(BUNDLE_CACHE, 'utf8');
    } else {
        src = fs.readFileSync(ASAR).toString('utf8');
        fs.writeFileSync(BUNDLE_CACHE, src, 'utf8');
    }
    // lz-string 模块在 bundle 里是 `var ci;` … `var Lw=ci;`
    const start = src.indexOf('var ci;');
    if (start < 0) throw new Error('bundle 里找不到 `var ci;`（Blockbench 版本变了？）');
    const end = src.indexOf('var Lw=ci;', start);
    if (end < 0) throw new Error('bundle 里找不到 `var Lw=ci;`');
    const code = src.slice(start, end + 'var Lw=ci;'.length);
    fs.writeFileSync(LZ_CACHE, code, 'utf8');
    return code;
}

function makeLz() {
    const code = loadLzModule();
    const sandbox = {};
    sandbox.window = sandbox;
    sandbox.self = sandbox;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(code + '\n;globalThis.__lz = ci;', sandbox, { filename: 'bb-lz-string.js' });
    if (!sandbox.__lz || typeof sandbox.__lz.decompress !== 'function') throw new Error('lz-string 模块加载失败');
    return sandbox.__lz;
}

function decompressFile(file) {
    const raw = fs.readFileSync(file).toString('utf8');
    if (!raw.startsWith('<lz>')) return raw;
    const payload = raw.slice(4);
    const lz = makeLz();
    return lz.decompress(payload, { inputEncoding: 'StorageBinaryString', outputEncoding: 'String' });
}

if (require.main === module) {
    const args = process.argv.slice(2);
    const probe = args.includes('--probe');
    const files = args.filter(a => !a.startsWith('--'));
    if (!files.length) {
        console.error('用法：node _unlz.js [--probe] <in.bbmodel> [out.json]');
        process.exit(2);
    }
    const text = decompressFile(files[0]);
    if (probe) {
        const data = JSON.parse(text);
        let groups = 0;
        (function walk(list) {
            for (const node of (list || [])) {
                if (node && node.type === 'group') { groups++; walk(node.children); }
            }
        })(data.elements || []);
        console.log(JSON.stringify({
            bytes: text.length,
            keys: Object.keys(data),
            model_format: data.meta && data.meta.model_format,
            root_nodes: (data.elements || []).length,
            groups,
        }, null, 2));
    } else if (files[1]) {
        fs.writeFileSync(files[1], text, 'utf8');
        console.log('已写入 ' + files[1] + '（' + text.length + ' 字符）');
    } else {
        process.stdout.write(text);
    }
}

module.exports = { decompressFile };
