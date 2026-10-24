/* 离线单测：模拟求值（select / range_dispatch / condition / fallback）与 pack.mcmeta 版本表
 * 用法：node _test_sim.js   （mock 最小 Blockbench 环境，通过 globalThis.__IMM_TEST__ 取内部函数） */
const path = require('path');

const PLUGIN = 'C:\\Users\\Rainbow_\\blockbench_item_model_mapping_isolated\\item_model_definition_assembly.js';

/* ---------- 最小 mock ---------- */
class Quaternion { constructor() { this.x = 0; this.y = 0; this.z = 0; this.w = 1; } setFromEuler() { return this; } normalize() { return this; } lengthSq() { return 1; } copy() { return this; } }
class Euler { constructor(x = 0, y = 0, z = 0, order = 'XYZ') { Object.assign(this, { x, y, z, order }); } }

global.THREE = { Quaternion, Euler };
global.Texture = class { constructor(o) { Object.assign(this, o); } }; Texture.all = [];
global.Cube = class { constructor(o) { Object.assign(this, o); } }; global.Cube.all = [];
global.Group = class { constructor(o) { Object.assign(this, o); this.children = []; } }; global.Group.all = [];
global.Outliner = { root: [], selected: [] };
global.Project = { name: 'test', imm_pack_version: '26.2' };
global.Properties = [];
global.Property = class { constructor(target, type, name, options) { global.Properties.push({ target, type, name, options }); } };
global.Properties[0] = null;
global.Format = { id: 'item_model_definition_assembly' };
global.ModelProject = class { };
global.Face = class { };
let plugin_options = null;
global.Plugin = { register(id, options) { plugin_options = options; } };
global.Action = class { constructor(id, options) { Object.assign(this, options); this.id = id; } delete() { } };
global.MenuBar = { addAction() { }, removeAction() { }, update() { }, menus: { file: { structure: [] } } };
global.Dialog = class { constructor(o) { this.options = o; } show() { return this; } };
global.Codec = class { constructor(id, data) { Object.assign(this, data); this.id = id; } delete() { } };
global.ModelFormat = class { constructor(id, data) { Object.assign(this, data); this.id = id; } delete() { } };
global.Blockbench = {
	showQuickMessage() { }, showMessageBox() { }, on() { }, writeFile() { }, pickDirectory() { return null; },
};

/* 测试钩子必须在 require 之前挂好 */
global.__IMM_TEST__ = {};
require(PLUGIN);
if (!plugin_options) { console.error('FAIL 插件没有调用 Plugin.register'); process.exit(1); }
plugin_options.onload();
const api = global.__IMM_TEST__.api;
if (!api) { console.error('FAIL 测试钩子没有暴露 api（onload 是否抛错？）'); process.exit(1); }

/* ---------- 断言小工具 ---------- */
let pass = 0, fail = 0;
const eq = (label, actual, expected) => {
	const a = JSON.stringify(actual), e = JSON.stringify(expected);
	if (a === e) { pass++; console.log('  ✔ ' + label); }
	else { fail++; console.log('  ✘ ' + label + '\n      期望 ' + e + '\n      实际 ' + a); }
};
const HIT = (items) => items.filter(i => i.hit).map(i => i.node.model);
const leaf = (model) => ({ type: 'minecraft:model', model });

console.log('版本：' + api.VERSION);
eq('版本是 0.37.0', api.VERSION, '0.37.0');
eq('测试钩子暴露 simEvaluate', typeof api.simEvaluate, 'function');

/* ---------- pack.mcmeta 版本表 ---------- */
console.log('\n[pack.mcmeta]');
const p262 = api.packMcmetaData('x', '26.2');
eq('26.2 → min/max_format 88', { min: p262.pack.min_format, max: p262.pack.max_format, legacy: p262.pack.pack_format }, { min: 88, max: 88, legacy: undefined });
eq('26.2 版本标签', api.packFormatLabel(p262.version), '88');
const p263 = api.packMcmetaData('x', '26.3');
eq('26.3 → [97,1]', { min: p263.pack.min_format, max: p263.pack.max_format }, { min: [97, 1], max: [97, 1] });
const p1215 = api.packMcmetaData('x', '1.21.5');
eq('1.21.5 → pack_format 55', { legacy: p1215.pack.pack_format, modern: p1215.pack.min_format }, { legacy: 55, modern: undefined });
const p1219 = api.packMcmetaData('x', '1.21.9');
eq('1.21.9 → min/max 69', { min: p1219.pack.min_format, max: p1219.pack.max_format }, { min: 69, max: 69 });
const pDefault = api.packMcmetaData('x', '不存在的版本');
eq('未知版本回退 26.2', pDefault.version.id, '26.2');
eq('packMcmetaFormat 读新版', api.packMcmetaFormat({ pack: { min_format: 88, max_format: 88 } }), '88');
eq('packMcmetaFormat 读旧版', api.packMcmetaFormat({ pack: { pack_format: 55 } }), '55');
eq('packMcmetaFormat 缺字段', api.packMcmetaFormat({ pack: { description: 'x' } }), null);

/* ---------- range_dispatch ---------- */
console.log('\n[range_dispatch]');
const range = {
	type: 'minecraft:range_dispatch', property: 'minecraft:custom_model_data', index: 0,
	entries: [
		{ threshold: 0, model: leaf('low') },
		{ threshold: 2, model: leaf('mid') },
	],
	fallback: leaf('fb'),
};
const rangeInputs = (v) => ({ floats: [v], strings: [], flags: [] });
eq('值 1 → low', HIT(api.simEvaluate(range, rangeInputs(1))), ['low']);
eq('值 2 → mid（阈值取最大的 <= 值）', HIT(api.simEvaluate(range, rangeInputs(2))), ['mid']);
eq('值 99 → mid', HIT(api.simEvaluate(range, rangeInputs(99))), ['mid']);
eq('值 -1 → fallback', HIT(api.simEvaluate(range, rangeInputs(-1))), ['fb']);
eq('值 -1 时非命中项与 fallback 都列出', api.simEvaluate(range, rangeInputs(-1)).length, 3);
eq('scale 生效（值 2 × 0.4 = 0.8 → low）', HIT(api.simEvaluate(Object.assign({}, range, { scale: 0.4 }), rangeInputs(2))), ['low']);
eq('无 fallback 且无命中 → 空', HIT(api.simEvaluate({ type: 'minecraft:range_dispatch', property: 'minecraft:custom_model_data', index: 0, entries: [{ threshold: 5, model: leaf('hi') }] }, rangeInputs(0))), []);

/* ---------- select ---------- */
console.log('\n[select]');
const select = {
	type: 'minecraft:select', property: 'minecraft:custom_model_data', index: 0,
	cases: [
		{ when: ['a', 'b'], model: leaf('m1') },
		{ when: ['b'], model: leaf('m2') },
	],
	fallback: leaf('mf'),
};
const sInputs = (v, index) => { const strings = []; strings[index || 0] = v; return { floats: [], strings, flags: [] }; };
const selectAt = (index) => Object.assign({}, select, { index });
eq('字符串 a → m1', HIT(api.simEvaluate(select, sInputs('a'))), ['m1']);
eq('字符串 b → 第一个命中的 m1（case 顺序优先）', HIT(api.simEvaluate(select, sInputs('b'))), ['m1']);
eq('未命中 → fallback', HIT(api.simEvaluate(select, sInputs('z'))), ['mf']);
eq('空字符串 → fallback', HIT(api.simEvaluate(select, sInputs(''))), ['mf']);
eq('index=1 读 strings[1]', HIT(api.simEvaluate(selectAt(1), sInputs('a', 1))), ['m1']);
eq('index=1 空 → fallback', HIT(api.simEvaluate(selectAt(2), sInputs('a', 1))), ['mf']);
eq('select 也列出未命中 case', api.simEvaluate(select, sInputs('a')).length, 2);

/* ---------- condition ---------- */
console.log('\n[condition]');
const cond = (property, index) => ({ type: 'minecraft:condition', property, index, on_true: leaf('t'), on_false: leaf('f') });
eq('flags[0]=true → on_true', HIT(api.simEvaluate(cond('minecraft:custom_model_data', 0), { floats: [], strings: [], flags: [true] })), ['t']);
eq('flags[0]=false → on_false', HIT(api.simEvaluate(cond('minecraft:custom_model_data', 0), { floats: [], strings: [], flags: [false] })), ['f']);
eq('selected=true → on_true', HIT(api.simEvaluate(cond('minecraft:selected', 0), { floats: [], strings: [], flags: [], selected: true })), ['t']);
eq('selected 缺省 → on_false', HIT(api.simEvaluate(cond('minecraft:selected', 0), { floats: [], strings: [], flags: [] })), ['f']);
eq('using_item=true → on_true', HIT(api.simEvaluate(cond('minecraft:using_item', 0), { floats: [], strings: [], flags: [], using_item: true })), ['t']);
eq('damage=3 → damaged 为真', HIT(api.simEvaluate(cond('minecraft:damaged', 0), { floats: [], strings: [], flags: [], damage: 3 })), ['t']);

/* ---------- composite 嵌套 ---------- */
console.log('\n[composite]');
const composite = { type: 'minecraft:composite', models: [leaf('base'), select] };
eq('composite 展开（base + 命中的 case）', HIT(api.simEvaluate(composite, sInputs('a'))), ['base', 'm1']);
eq('empty 不产生任何项', api.simEvaluate({ type: 'minecraft:empty' }, sInputs('a')).length, 0);
eq('null 节点安全', api.simEvaluate(null, sInputs('a')).length, 0);

/* ---------- 汇总 ---------- */
console.log('\n通过 ' + pass + ' / ' + (pass + fail) + (fail ? ('，失败 ' + fail) : ''));
process.exit(fail ? 1 : 0);
