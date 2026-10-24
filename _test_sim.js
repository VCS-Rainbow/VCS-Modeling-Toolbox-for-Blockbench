/* 离线单测：模拟求值（select / range_dispatch / condition / fallback）与 pack.mcmeta 版本表
 * 用法：node _test_sim.js   （mock 最小 Blockbench 环境，通过 globalThis.__IMM_TEST__ 取内部函数） */
const path = require('path');

const PLUGIN = 'C:\\Users\\Rainbow_\\blockbench_item_model_mapping_isolated\\item_model_definition_assembly.js';

/* ---------- 最小 mock ---------- */
class Quaternion { constructor() { this.x = 0; this.y = 0; this.z = 0; this.w = 1; } setFromEuler() { return this; } normalize() { return this; } lengthSq() { return 1; } copy() { return this; } }
class Euler { constructor(x = 0, y = 0, z = 0, order = 'XYZ') { Object.assign(this, { x, y, z, order }); } }

/* 极简 DOM：够 buildSimPanel 组装结构，并能触发 change / input / click 事件 */
class FakeEl {
	constructor(tag) { this.tagName = String(tag).toUpperCase(); this.children = []; this.style = { cssText: '' }; this._text = ''; this._html = ''; this.parentElement = null; this.value = undefined; this.checked = false; this.disabled = false; this.type = ''; this.listeners = []; }
	appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
	insertBefore(child, ref) { child.parentElement = this; const at = this.children.indexOf(ref); this.children.splice(at < 0 ? this.children.length : at, 0, child); return child; }
	addEventListener(type, fn) { this.listeners.push({ type, fn }); }
	fire(type) { for (const listener of this.listeners) if (listener.type === type) listener.fn({ target: this, preventDefault() { } }); }
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
eq('版本是 0.39.0', api.VERSION, '0.39.0');
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

/* ---------- 面板结构：大类/槽可折叠，输入直接可见 ---------- */
console.log('\n[面板结构]');
const simUi = api.getSimUi();
const containsText = (el, text) => !!el && (String(el._text || '').includes(text) || (el.children || []).some(child => containsText(child, text)));
const insideDetails = (el) => { let node = el; while (node) { if (node.tagName === 'DETAILS') return true; node = node.parentElement; } return false; };
eq('面板已创建', !!simUi, true);
const floatsRow = simUi && simUi.rows && simUi.rows.floats;
eq('floats 行有 3 个槽', floatsRow.slots.length, 3);
eq('其它大类各有 1 个槽', simUi.rows.strings.slots.length === 1 && simUi.rows.selected.slots.length === 1, true);
const rowHeader = floatsRow.els.body.parentElement.children[0];
eq('大类标题行含名称', containsText(rowHeader, 'cmdata.floats'), true);
eq('大类默认展开', floatsRow.els.body.style.display, 'flex');
floatsRow.els.toggle.fire('click');
eq('点箭头后大类折叠', floatsRow.els.body.style.display, 'none');
floatsRow.els.toggle.fire('click');
eq('再点恢复展开', floatsRow.els.body.style.display, 'flex');
const slot0 = floatsRow.slots[0];
eq('槽标题行含「槽 1 / 索引 / 值」', ['槽 1', '索引', '值'].every(t => containsText(slot0.els.val.parentElement.parentElement, t)), true);
eq('槽默认折叠（标题行仍可见）', slot0.els.body.style.display, 'none');
slot0.els.toggle.fire('click');
eq('点箭头后槽展开', slot0.els.body.style.display, 'flex');
eq('槽内有自动变化参数（周期/步长/规则/下限/上限）', ['自动变化', '周期', '步长', '规则', '下限', '上限'].every(t => containsText(slot0.els.body, t)), true);
eq('大类标题行没有「自动变化」复选框', containsText(rowHeader, '自动变化'), false);
eq('行内没有 <details> 包裹输入', insideDetails(slot0.els.val), false);

/* ---------- 值改变会驱动求值（0.38 的回归） ---------- */
console.log('\n[值驱动求值]');
const gModel = (name, model) => new global.Group({ name, imm_type: 'model', imm_model: model });
const rangeGroup = new global.Group({ name: 'range', imm_type: 'range_dispatch', imm_property: 'minecraft:custom_model_data', imm_index: 0 });
rangeGroup.children.push(gModel('low', 'ns:item/low'), gModel('high', 'ns:item/high'));
global.Outliner.root.push(rangeGroup);
eq('编辑值会自动启用该大类', (() => { slot0.els.val.value = '1'; slot0.els.val.fire('input'); return floatsRow.enabled && floatsRow.els.enable.checked; })(), true);
eq('值 1 → 命中 high', /✔ ns:item\/high/.test(simUi.out.textContent), true);
eq('槽角标显示命中数', slot0.els.badge.textContent, '命中 1');
slot0.els.val.value = '0';
slot0.els.val.fire('input');
eq('值 0 → 命中 low', /✔ ns:item\/low/.test(simUi.out.textContent), true);
eq('槽展开后有活跃项/关联分组', /range/.test(slot0.els.usage.innerHTML), true);

/* ---------- 运行状态 ---------- */
console.log('\n[运行状态]');
eq('初始为「▶ 运行 / 已停止」', simUi.runBtn.textContent + '|' + simUi.status.textContent, '▶ 运行|已停止');
simUi.runBtn.fire('click');
eq('运行后按钮变「■ 停止」', simUi.runBtn.textContent, '■ 停止');
eq('运行后状态可见', /运行中/.test(simUi.status.textContent), true);
simUi.runBtn.fire('click');
eq('停止后按钮恢复', simUi.runBtn.textContent, '▶ 运行');
eq('停止后状态恢复', simUi.status.textContent, '已停止');
floatsRow.els.enable.checked = false;
floatsRow.els.enable.fire('change');
simUi.runBtn.fire('click');
eq('没有启用的数值大类时不会误报运行中', simUi.runBtn.textContent, '▶ 运行');
simUi.runBtn.fire('click');

/* ---------- 汇总 ---------- */
console.log('\n通过 ' + pass + ' / ' + (pass + fail) + (fail ? ('，失败 ' + fail) : ''));
process.exit(fail ? 1 : 0);
