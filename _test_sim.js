/* 离线单测：模拟求值（select / range_dispatch / condition / fallback）与 pack.mcmeta 版本表
 * 用法：node _test_sim.js   （mock 最小 Blockbench 环境，通过 globalThis.__IMM_TEST__ 取内部函数） */
const path = require('path');

const PLUGIN = 'C:\\Users\\Rainbow_\\blockbench_item_model_mapping_isolated\\item_model_definition_assembly.js';

/* ---------- 最小 mock ---------- */
class Quaternion { constructor() { this.x = 0; this.y = 0; this.z = 0; this.w = 1; } setFromEuler() { return this; } normalize() { return this; } lengthSq() { return 1; } copy() { return this; } }
class Euler { constructor(x = 0, y = 0, z = 0, order = 'XYZ') { Object.assign(this, { x, y, z, order }); } }

/* 极简 DOM：够 buildSimPanel 组装结构，便于断言“控件没有被塞进 <details>” */
class FakeEl {
	constructor(tag) { this.tagName = String(tag).toUpperCase(); this.children = []; this.style = { cssText: '' }; this._text = ''; this._html = ''; this.parentElement = null; }
	appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
	insertBefore(child, ref) { child.parentElement = this; const at = this.children.indexOf(ref); this.children.splice(at < 0 ? this.children.length : at, 0, child); return child; }
	addEventListener() { }
	get firstChild() { return this.children[0] || null; }
	get lastElementChild() { return this.children[this.children.length - 1] || null; }
	set textContent(value) { this._text = String(value); this.children = []; }
	get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
	set innerHTML(value) { this._html = String(value); if (value === '') this.children = []; }
	get innerHTML() { return this._html; }
	querySelectorAll() { return []; }
}
global.document = { createElement: (tag) => new FakeEl(tag) };
global.Panel = class { constructor(id, options) { this.id = id; this.node = new FakeEl('div'); this.options = options || {}; } show() { } delete() { } };

global.THREE = { Quaternion, Euler };
global.Texture = class { constructor(o) { Object.assign(this, o); } }; Texture.all = [];
global.Cube = class { constructor(o) { Object.assign(this, o); } }; global.Cube.all = [];
global.Group = class { constructor(o) { Object.assign(this, o); this.children = []; } }; global.Group.all = [];
global.Outliner = { root: [], selected: [] };
global.Project = { name: 'test', imm_pack_version: '26.2' };
global.Properties = [];
global.Property = class { constructor(target, type, name, options) { global.Properties.push({ target, type, name, options }); } };
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
eq('版本是 0.38.0', api.VERSION, '0.38.0');
eq('测试钩子暴露 simEvaluate', typeof api.simEvaluate, 'function');

/* ---------- 项目设置里的目标版本（应为下拉） ---------- */
console.log('\n[项目设置]');
const packProp = (global.Properties || []).find(p => p && p.name === 'imm_pack_version');
eq('注册了 imm_pack_version', !!packProp, true);
eq('带 options（Blockbench 据此渲染下拉）', typeof (packProp && packProp.options && packProp.options.options), 'function');
const versionOptions = (packProp && packProp.options && packProp.options.options) ? packProp.options.options() : {};
eq('下拉含 26.2', Object.prototype.hasOwnProperty.call(versionOptions, '26.2'), true);
eq('下拉含 26.3', Object.prototype.hasOwnProperty.call(versionOptions, '26.3'), true);
eq('26.2 选项带格式号 88', /88/.test(String(versionOptions['26.2'])), true);
eq('1.21.5 选项标注 pack_format', /pack_format/.test(String(versionOptions['1.21.5'])), true);
global.Project.imm_pack_version = '';
api.ensurePackVersion();
eq('老项目空值自动补 26.2（下拉不会落到第一项）', global.Project.imm_pack_version, '26.2');

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

/* ---------- 面板结构：输入控件必须直接可见，不能被塞进 <details> ---------- */
console.log('\n[面板结构]');
const simUi = api.getSimUi();
const containsText = (el, text) => !!el && (String(el._text || '').includes(text) || (el.children || []).some(child => containsText(child, text)));
const insideDetails = (el) => { let node = el; while (node) { if (node.tagName === 'DETAILS') return true; node = node.parentElement; } return false; };
eq('面板已创建', !!simUi, true);
const floatsRow = simUi && simUi.rows && simUi.rows.floats;
eq('floats 行存在', !!floatsRow, true);
const floatsBox = floatsRow && floatsRow.el.usage.parentElement;
eq('行容器不是 <details>', floatsBox && floatsBox.tagName, 'DIV');
eq('标题行可见 cmdata.floats 且不在折叠层', containsText(floatsBox.children[0], 'cmdata.floats') && !insideDetails(floatsBox.children[0]), true);
eq('三个槽', floatsRow.pairs.length, 3);
eq('槽 1 在行内（不在折叠层）', containsText(floatsBox.children[1], '槽 1') && !insideDetails(floatsRow.pairs[0].pv), true);
eq('floats 值输入不在折叠层', insideDetails(floatsRow.el.val), false);
eq('floats 有自动变化行', (floatsBox.children || []).some(c => containsText(c, '自动变化')), true);
const stringsBox = simUi.rows.strings.el.usage.parentElement;
eq('strings 标题在标题行', containsText(stringsBox.children[0], 'cmdata.strings'), true);
eq('strings 的索引/值在标题行内', containsText(stringsBox.children[0], '索引') && containsText(stringsBox.children[0], '值'), true);
eq('strings 行没有 <details>', stringsBox.children.some(c => c.tagName === 'DETAILS'), false);
eq('没有任何行用 <details> 包裹输入', Object.keys(simUi.rows).every(k => !simUi.rows[k].el.usage.parentElement.children.some(c => c.tagName === 'DETAILS')), true);
eq('colors 不显示自动变化', simUi.rows.colors.el.usage.parentElement.children.some(c => containsText(c, '自动变化')), false);

/* ---------- 汇总 ---------- */
console.log('\n通过 ' + pass + ' / ' + (pass + fail) + (fail ? ('，失败 ' + fail) : ''));
process.exit(fail ? 1 : 0);
