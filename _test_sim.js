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

global.THREE = {
	Quaternion, Euler,
	MeshBasicMaterial: class { constructor(o) { Object.assign(this, o || {}); this.color = { v: (o && o.color) || 0xffffff, setHex(h) { this.v = h; } }; } dispose() { } },
};
global.Texture = class { constructor(o) { Object.assign(this, o); } }; Texture.all = [];
global.Cube = class { constructor(o) { Object.assign(this, o); } addTo(parent) { if (this.parent && Array.isArray(this.parent.children)) { const old = this.parent.children.indexOf(this); if (old >= 0) this.parent.children.splice(old, 1); } if (parent) { this.parent = parent; if (Array.isArray(parent.children) && parent.children.indexOf(this) < 0) parent.children.push(this); } return this; } init() { return this; } }; global.Cube.all = [];
global.Group = class { constructor(o) { Object.assign(this, o); this.children = []; } addTo(parent) { if (this.parent && Array.isArray(this.parent.children)) { const old = this.parent.children.indexOf(this); if (old >= 0) this.parent.children.splice(old, 1); } if (parent) { this.parent = parent; if (Array.isArray(parent.children) && parent.children.indexOf(this) < 0) parent.children.push(this); } else if (Array.isArray(global.Outliner.root) && global.Outliner.root.indexOf(this) < 0) global.Outliner.root.push(this); return this; } init() { return this; } }; global.Group.all = [];
global.Locator = class { constructor(o) { Object.assign(this, o); this.uuid = (o && o.uuid) || ('loc-' + Math.random()); } addTo() { return this; } init() { return this; } };
global.Outliner = { root: [], selected: [] };
global.Project = { name: 'test', imda_pack_version: '26.2' };
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
eq('版本是 0.68.86', api.VERSION, '0.68.86');
eq('测试钩子暴露 simEvaluate', typeof api.simEvaluate, 'function');

/* ---------- 项目设置里的目标版本（应为下拉） ---------- */
console.log('\n[项目设置]');
const packProp = (global.Properties || []).find(p => p && p.name === 'imda_pack_version');
eq('注册了 imda_pack_version', !!packProp, true);
eq('带 options（Blockbench 据此渲染下拉）', typeof (packProp && packProp.options && packProp.options.options), 'function');
const versionOptions = (packProp && packProp.options && packProp.options.options) ? packProp.options.options() : {};
eq('下拉含 26.2', Object.prototype.hasOwnProperty.call(versionOptions, '26.2'), true);
eq('下拉含 26.3', Object.prototype.hasOwnProperty.call(versionOptions, '26.3'), true);
eq('26.2 选项带格式号 88', /88/.test(String(versionOptions['26.2'])), true);
eq('1.21.5 选项标注 pack_format', /pack_format/.test(String(versionOptions['1.21.5'])), true);
global.Project.imda_pack_version = '';
global.Project.imda_pack_version = '';
api.ensurePackVersion();
eq('老项目空值自动补 26.2（下拉不会落到第一项）', global.Project.imda_pack_version, '26.2');

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
const condBoth = api.simEvaluate(cond('minecraft:selected', 0), { floats: [], strings: [], flags: [], selected: true });
eq('condition 两个分支都列出', condBoth.length, 2);
eq('未选中的分支标为未命中', HIT(condBoth), ['t']);

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
eq('槽内有自动参数（周期/步长/规则/下限/上限）', ['周期', '步长', '规则', '下限', '上限'].every(t => containsText(slot0.els.body, t)), true);
eq('每个槽有独立开关（默认开）', !!slot0.els.enable && slot0.els.enable.checked, true);
eq('大类标题行没有「自动变化」复选框', containsText(rowHeader, '自动变化'), false);
eq('行内没有 <details> 包裹输入', insideDetails(slot0.els.val), false);

/* ---------- 值改变会驱动求值（0.38 的回归） ---------- */
console.log('\n[值驱动求值]');
const gModel = (name, model) => new global.Group({ name, imda_type: 'model', imda_model: model });
const rangeGroup = new global.Group({ name: 'range', imda_type: 'range_dispatch', imda_property: 'minecraft:custom_model_data', imda_index: 0 });
rangeGroup.children.push(gModel('low', 'ns:item/low'), gModel('high', 'ns:item/high'));
global.Outliner.root.push(rangeGroup);
eq('未勾选自动也能用手动值参与求值', (() => { slot0.els.val.value = '1'; slot0.els.val.fire('input'); return floatsRow.enabled === false; })(), true);
api.simTick();
eq('值 1 → 命中 high', /✔ ns:item\/high/.test(simUi.out.textContent), true);
eq('槽角标显示命中数', slot0.els.badge.textContent, '命中 1');
slot0.els.val.value = '0';
slot0.els.val.fire('input');
api.simTick();
eq('值 0 → 命中 low', /✔ ns:item\/low/.test(simUi.out.textContent), true);
eq('槽展开后有活跃项/关联分组', /range/.test(slot0.els.usage.innerHTML), true);
eq('未活跃项用自绘折叠按钮（不是 details）', /data-usage-toggle/.test(slot0.els.usage.innerHTML) && !/<details>/.test(slot0.els.usage.innerHTML), true);

/* ---------- 槽级开关 ---------- */
console.log('\n[槽级开关]');
const slot1 = floatsRow.slots[1];
slot0.els.val.value = '5';
slot0.els.val.fire('input');
slot1.els.idx.value = '0';
slot1.els.idx.fire('input');
slot1.els.val.value = '0';
slot1.els.val.fire('input');
api.simTick();
eq('两个槽都启用时按顺序写入（后写的 0 生效 → low）', /✔ ns:item\/low/.test(simUi.out.textContent), true);
slot1.els.enable.checked = false;
slot1.els.enable.fire('change');
api.simTick();
eq('关掉槽 2 后只剩槽 1 的值（5 → high）', /✔ ns:item\/high/.test(simUi.out.textContent), true);
eq('关掉的槽不再显示命中角标', slot1.els.badge.textContent, '');

/* ---------- 运行状态 ---------- */
console.log('\n[运行状态]');
eq('初始为「▶ 运行 / 已停止」', simUi.runBtn.textContent + '|' + simUi.status.textContent, '▶ 运行|已停止');
floatsRow.els.enable.checked = true;
floatsRow.els.enable.fire('change');
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

/* ---------- 不活跃分支联动（走真实 simTick + groupNodes） ---------- */
console.log('\n[不活跃分支联动]');
const lowGroup = rangeGroup.children[0];
const highGroup = rangeGroup.children[1];
const meshMat = () => ({ transparent: false, opacity: 1, depthWrite: true, clone() { return { transparent: false, opacity: 1, depthWrite: true, dispose() { } }; }, dispose() { } });
const lowCube = new global.Cube({ from: [0, 0, 0], to: [2, 2, 2], origin: [1, 1, 1], rotation: [0, 0, 0] });
lowCube.mesh = { material: meshMat() };
lowGroup.children.push(lowCube); lowGroup.mesh = { visible: true };
const highCube = new global.Cube({ from: [0, 0, 0], to: [2, 2, 2], origin: [1, 1, 1], rotation: [0, 0, 0] });
highCube.mesh = { material: meshMat() };
highGroup.children.push(highCube); highGroup.mesh = { visible: true };
floatsRow.els.enable.checked = true;
floatsRow.els.enable.fire('change');
slot0.els.val.value = '5';
slot0.els.val.fire('input');
api.simTick();
const simState = api.getSimState();
api.simSetViewMode('ghost');
api.simTick();
eq('半透明：未命中的 low 变透明', lowCube.mesh.material.transparent === true && Math.abs(lowCube.mesh.material.opacity - 0.28) < 1e-9, true);
eq('半透明：命中的 high 保持不透明', highCube.mesh.material.transparent, false);
eq('开启联动后有周期重贴', !!simState.viewTimer, true);
const ghostMaterial = lowCube.mesh.material;
lowCube.mesh.material = lowGroup.children[0].mesh.__immGhost.original; // 模拟 Blockbench 重置材质
api.simApplyGroupVisual([{ group: lowGroup, active: false }], 'ghost');
eq('材质被重置后能自动重贴', lowCube.mesh.material !== ghostMaterial && lowCube.mesh.material.transparent === true, true);
api.simSetViewMode('hide');
api.simTick();
eq('隐藏：未命中的 low 分组不可见', lowGroup.mesh.visible, false);
eq('隐藏：命中的 high 仍可见', highGroup.mesh.visible, true);
lowGroup.mesh.visible = true; // 模拟 Blockbench 重置可见性
api.simApplyGroupVisual([{ group: lowGroup, active: false }], 'hide');
eq('可见性被重置后能自动重贴', lowGroup.mesh.visible, false);
api.simSetViewMode('off');
api.simTick();
eq('关闭联动后恢复材质与可见性', lowCube.mesh.material.transparent === false && lowGroup.mesh.visible === true, true);
eq('关闭后停止周期重贴', simState.viewTimer, null);

/* ---------- 分支前缀清理 ---------- */
console.log('\n[分支前缀清理]');
const strayParent = new global.Group({ name: 'container', imda_type: 'composite' });
const strayChild = new global.Group({ name: '[0] stray', imda_type: 'model' });
strayChild.parent = strayParent; strayParent.children.push(strayChild);
const branchParent = new global.Group({ name: 'rd', imda_type: 'range_dispatch' });
const branchChild = new global.Group({ name: '[2] keep', imda_type: 'model' });
branchChild.parent = branchParent; branchParent.children.push(branchChild);
global.Outliner.root.push(strayParent, branchParent);
api.stripStrayBranchPrefixes();
eq('挪到普通父级/根目录后 [k] 被去掉', strayChild.name, 'stray');
eq('分支容器内的 [k] 保留', branchChild.name, '[2] keep');

/* ---------- 枢轴归位 ---------- */
console.log('\n[枢轴归位]');
const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const pivotWorld = (chain, point) => chain.reduceRight((p, g) => api.rotateAroundQuat(api.readQuaternion(g), g.origin, p), point);
const pivotCube = new global.Cube({ from: [0, 0, 0], to: [2, 2, 2], origin: [1, 1, 1], rotation: [0, 0, 0] });
const inner = new global.Group({ name: 'inner', origin: [6, 0, 0], rotation: [0, 0, 40] });
inner.children.push(pivotCube);
const outer = new global.Group({ name: 'outer', origin: [2, 1, 0], rotation: [0, 0, 25] });
outer.children.push(inner);
const chain = [outer, inner];
const cubeCenterWorld = () => pivotWorld(chain, api.rotateAroundQuat(api.readQuaternion(pivotCube), pivotCube.origin, [1, 1, 1]));
const beforePivot = cubeCenterWorld();
api.fixGroupPivot(outer);
api.fixGroupPivot(inner);
const afterPivot = cubeCenterWorld();
const parentCenter = [5, 6, 7];
const rebaseCube = new global.Cube({ from: [0, 0, 0], to: [2, 4, 6], origin: [10, 20, 30], rotation: [0, 0, 45] });
const rebaseCenterBefore = [(rebaseCube.from[0] + rebaseCube.to[0]) / 2, (rebaseCube.from[1] + rebaseCube.to[1]) / 2, (rebaseCube.from[2] + rebaseCube.to[2]) / 2];
const rebaseWorldBefore = api.rotateAroundQuat(api.readQuaternion(rebaseCube), rebaseCube.origin, rebaseCenterBefore);
api.centerCubePivot(rebaseCube, parentCenter);
const rebaseCenterAfter = [(rebaseCube.from[0] + rebaseCube.to[0]) / 2, (rebaseCube.from[1] + rebaseCube.to[1]) / 2, (rebaseCube.from[2] + rebaseCube.to[2]) / 2];
const rebaseWorldAfter = api.rotateAroundQuat(api.readQuaternion(rebaseCube), rebaseCube.origin, rebaseCenterAfter);
eq('方块枢轴移到父级中心', JSON.stringify(rebaseCube.origin), JSON.stringify(parentCenter));
eq('方块枢轴移动后世界位置不变（误差 < 1e-6）', dist3(rebaseWorldBefore, rebaseWorldAfter) < 1e-6, true);
eq('改枢轴后方块世界位置不变（误差 < 1e-6）', dist3(beforePivot, afterPivot) < 1e-6, true);
const outerPoints = api.pivotContentPoints(outer);
const outerQ = api.readQuaternion(outer);
const outerRendered = outerPoints.map(p => api.rotateAroundQuat(outerQ, outer.origin, p));
const outerCenter = [0, 1, 2].map(i => outerRendered.reduce((s, p) => s + p[i], 0) / outerRendered.length);
eq('外层枢轴落在内容中心（误差 < 1e-6）', dist3(outer.origin, outerCenter) < 1e-6, true);
eq('枢轴确实移动了', dist3(beforePivot, afterPivot) < 1e-6 && dist3(outer.origin, [2, 1, 0]) > 1, true);

/* ---------- 不活跃分支：半透明 / 隐藏 ---------- */
console.log('\n[不活跃分支视图]');
const makeMaterial = () => ({ transparent: false, opacity: 1, depthWrite: true, clone() { return { transparent: false, opacity: 1, depthWrite: true, dispose() { this.disposed = true; } }; }, dispose() { } });
const viewCube = new global.Cube({ from: [0, 0, 0], to: [2, 2, 2], origin: [1, 1, 1], rotation: [0, 0, 0] });
viewCube.mesh = { material: makeMaterial() };
const viewGroup = new global.Group({ name: 'viewGroup', imda_type: 'composite' });
viewGroup.children.push(viewCube);
viewGroup.mesh = { visible: true };
api.simApplyGroupVisual([{ group: viewGroup, active: false }], 'ghost');
eq('半透明：材质 transparent + opacity 0.28', viewCube.mesh.material.transparent === true && Math.abs(viewCube.mesh.material.opacity - 0.28) < 1e-9, true);
eq('半透明：不改分组可见性', viewGroup.mesh.visible, true);
api.simApplyGroupVisual([{ group: viewGroup, active: true }], 'ghost');
eq('活跃后恢复原材质', viewCube.mesh.material.transparent, false);
api.simApplyGroupVisual([{ group: viewGroup, active: false }], 'hide');
eq('隐藏：分组 mesh 不可见', viewGroup.mesh.visible, false);
eq('隐藏模式下不残留半透明', viewCube.mesh.material.transparent, false);
api.simApplyGroupVisual([{ group: viewGroup, active: true }], 'hide');
eq('恢复可见', viewGroup.mesh.visible, true);
api.simApplyGroupVisual([{ group: viewGroup, active: false }], 'ghost');
api.simApplyGroupVisual([], 'off');
eq('关闭联动后全部恢复', viewCube.mesh.material.transparent === false && viewGroup.mesh.visible === true, true);

/* ---------- 映射节点 → 分组覆盖 ---------- */
console.log('\n[映射节点→分组覆盖]');
const fakeComposite = new global.Group({ name: 'fakeComposite', imda_type: 'composite' });
const fakeCube = new global.Cube({ from: [0, 0, 0], to: [2, 2, 2], origin: [1, 1, 1], rotation: [0, 0, 0], export: true });
fakeComposite.children.push(fakeCube);
fakeComposite.mesh = { visible: true };
const savedRoot = global.Outliner.root.splice(0, global.Outliner.root.length, fakeComposite);
const fakeExporter = api.createExporter();
fakeExporter.addModel = () => ({ reference: 'ns:item/fake', shift: [0, 0, 0] });
const fakeMapping = fakeExporter.buildMapping();
const fakeItems = api.simEvaluate(fakeMapping.model, { floats: [], colors: [], strings: [], flags: [], selected: false, using_item: false, damage: 0, count: 0, time: 0 });
eq('composite 内联模型节点能反查分组', fakeItems.length > 0 && fakeItems.every(item => fakeExporter.groupNodes.get(item.node) === fakeComposite), true);
eq('映射节点带 node_name', fakeMapping.model.models[0].node_name, 'fakeComposite');
eq('序列化保留 node_name', api.formatMapping(fakeMapping).indexOf('node_name') >= 0, true);
global.Outliner.root.splice(0, global.Outliner.root.length, ...savedRoot);

/* ---------- 内联模型 / 引用模型 ---------- */
console.log('\n[内联模型]');
const inlineGroup = new global.Group({ name: 'inlineGroup', imda_type: 'inline' });
inlineGroup.children.push(new global.Cube({ from: [0, 0, 0], to: [2, 2, 2], origin: [1, 1, 1], rotation: [0, 0, 0], export: true }));
inlineGroup.mesh = { visible: true };
const savedRoot2 = global.Outliner.root.splice(0, global.Outliner.root.length, inlineGroup);
const inlineExporter = api.createExporter();
inlineExporter.addModel = () => ({ reference: 'ns:item/inlinefake', shift: [0, 0, 0] });
const inlineMapping = inlineExporter.buildMapping();
eq('inline 导出结构等同 composite', inlineMapping.model.type, 'minecraft:composite');
eq('inline 分组节点能反查', inlineExporter.groupNodes.get(inlineMapping.model.models[0]) === inlineGroup, true);
global.Outliner.root.splice(0, global.Outliner.root.length, ...savedRoot2);

const buildModelNode = (shiftText) => {
	const group = new global.Group({ name: 'internalRefGroup', imda_type: 'model', imda_model: 'ns:item/ref', imda_model_shift: shiftText, origin: [8, 8, 8], rotation: [0, 0, 0] });
	group.mesh = { visible: true };
	const saved = global.Outliner.root.splice(0, global.Outliner.root.length, group);
	const exporter = api.createExporter();
	const mapping = exporter.buildMapping();
	global.Outliner.root.splice(0, global.Outliner.root.length, ...saved);
	return mapping.model.models[0].transformation;
};
const plainTransform = buildModelNode('');
const shiftedTransform = buildModelNode('[0,0,8]');
eq('引用模型会应用居中补偿', JSON.stringify(plainTransform) !== JSON.stringify(shiftedTransform), true);

/* ---------- 复调用标签 ---------- */
console.log('\n[复调用标签]');
const targetGroup = new global.Group({ name: 'targetGroup', imda_type: 'composite', uuid: 'target-uuid', origin: [8, 8, 8], rotation: [0, 0, 0] });
targetGroup.children.push(new global.Cube({ from: [0, 0, 0], to: [2, 2, 2], origin: [1, 1, 1], rotation: [0, 0, 0], export: true }));
targetGroup.mesh = { visible: true };
const callerGroup = new global.Group({ name: 'callerGroup', imda_type: 'composite', uuid: 'caller-uuid' });
const callLocator = new global.Locator({ name: '调用 targetGroup', position: [10, 8, 8], rotation: [0, 0, 0] });
callLocator.imda_call_target = 'target-uuid';
callerGroup.children.push(callLocator);
const callLocator2 = new global.Locator({ name: '调用 targetGroup 2', position: [12, 8, 8], rotation: [0, 0, 0] }); callLocator2.imda_call_target = 'target-uuid'; callerGroup.children.push(callLocator2);
const callLocator3 = new global.Locator({ name: '调用 targetGroup 3', position: [14, 8, 8], rotation: [0, 0, 0] }); callLocator3.imda_call_target = 'target-uuid'; callerGroup.children.push(callLocator3);
const callLocator4 = new global.Locator({ name: '调用 targetGroup 4', position: [16, 8, 8], rotation: [0, 0, 0] }); callLocator4.imda_call_target = 'target-uuid'; callerGroup.children.push(callLocator4);
callerGroup.mesh = { visible: true };
global.Group.all.push(targetGroup);
const savedRoot3 = global.Outliner.root.splice(0, global.Outliner.root.length, targetGroup, callerGroup);
const callExporter = api.createExporter();
callExporter.addModel = () => ({ reference: 'ns:item/callfake', shift: [0, 0, 0] });
const callJSON = JSON.stringify(callExporter.buildMapping());
eq('四个复调用标签都被输出', (callJSON.match(/ns:item\/callfake/g) || []).length, 5);
eq('复调用标签位置生效', /0\.125/.test(callJSON), true);
eq('复调用使用标签名', /"node_name":"调用 targetGroup"/.test(callJSON), true);
eq('导出结果不含占位字段', callJSON.indexOf('__imda_call_group'), -1);
global.Outliner.root.splice(0, global.Outliner.root.length, ...savedRoot3);
global.Group.all.splice(global.Group.all.indexOf(targetGroup), 1);

/* ---------- colors 预览着色 ---------- */
console.log('\n[colors 预览着色]');
const tintCube = new global.Cube({ from: [0, 0, 0], to: [2, 2, 2], origin: [1, 1, 1], rotation: [0, 0, 0], export: true });
tintCube.faces = { north: { tint: 0, uv: [0, 0, 2, 2] }, east: { tint: -1 }, south: { tint: -1 } };
const tintOriginal = { map: { name: 'tex' }, side: 2 };
tintCube.mesh = { material: tintOriginal };
const tintGroup = new global.Group({ name: 'tintGroup', imda_type: 'composite', imda_tint_type: 'custom_model_data', imda_tint_index: '0' });
tintGroup.children.push(tintCube);
tintCube.parent = tintGroup;
tintGroup.mesh = { visible: true };
const noTintGroup = new global.Group({ name: 'noTintGroup', imda_type: 'composite', imda_tint_type: '', imda_tint_index: '0' });
const noTintCube = new global.Cube({ from: [0, 0, 0], to: [2, 2, 2], origin: [1, 1, 1], rotation: [0, 0, 0], export: true });
noTintCube.faces = { north: { tint: 0 } };
const noTintOriginal = { map: { name: 'nt' } };
noTintCube.mesh = { material: noTintOriginal };
noTintCube.parent = noTintGroup;
noTintGroup.children.push(noTintCube);
noTintGroup.mesh = { visible: true };
const savedRoot4 = global.Outliner.root.splice(0, global.Outliner.root.length, tintGroup, noTintGroup);
const simState2 = api.getSimState();
simState2.inputs.colors[0] = 0xFFFF0000 | 0;
api.simApplyTints();
eq('colors[0] 给 tintindex 0 的方块着色', tintCube.mesh.material.color.v, 0xff0000);
eq('着色不改原纹理对象', tintCube.mesh.material.map === tintOriginal.map, true);
eq('不生成 tints 的组不预览着色', noTintCube.mesh.material === noTintOriginal, true);
simState2.inputs.colors.length = 0;
api.simApplyTints();
eq('清空 colors 后恢复原材质', tintCube.mesh.material === tintOriginal, true);
const colorsRow = simUi.rows.colors;
eq('默认预设色为 16 个染料色', colorsRow.slots[0].presets.length, 16);
colorsRow.slots[0].els.presets.value = '0xFFFF0000, 0xFF00FF00';
colorsRow.slots[0].els.presets.fire('change');
eq('colors 预设色解析为数字', colorsRow.slots[0].presets.length === 2 && colorsRow.slots[0].presets[0] === 0xFFFF0000, true);
const colorsUsage = api.collectInputUsage();
eq('colors 关联分组包含 tintindex 0 所在分组', !!(colorsUsage['colors#0'] || []).find(entry => entry.parent === 'tintGroup'), true);
eq('不生成 tints 的组不关联 colors', !(colorsUsage['colors#0'] || []).find(entry => entry.parent === 'noTintGroup'), true);
const tintExporter = api.createExporter();
eq('不生成 tints 时 buildTints 为 null', tintExporter.buildTints({ imda_tint_type: '', imda_tint_index: 0 }), null);
eq('none 时 buildTints 为 null', tintExporter.buildTints({ imda_tint_type: 'none', imda_tint_index: 0 }), null);
eq('custom_model_data 时 buildTints 有值', Array.isArray(tintExporter.buildTints({ imda_tint_type: 'custom_model_data', imda_tint_index: 2 })), true);
global.Outliner.root.splice(0, global.Outliner.root.length, ...savedRoot4);

/* ---------- 批量分组属性 ---------- */
console.log('\n[批量分组属性]');
const batchA = new global.Group({ name: 'batchA' });
const batchB = new global.Group({ name: 'batchB' });
const batchResult = { imda_type: 'inline', imda_tint_type: '', imda_tint_index: 0 };
api.assignGroupMapProps(batchA, batchResult);
api.assignGroupMapProps(batchB, batchResult);
eq('同一结果应用到多个分组', batchA.imda_type === 'inline' && batchB.imda_type === 'inline' && batchA.imda_tint_type === 'none' && batchB.imda_tint_type === 'none', true);

/* ---------- 导入 tintindex 判定 ---------- */
console.log('\n[导入 tintindex 判定]');
eq('模型已有 tintindex', api.modelElementsHaveTintIndex([{ faces: { north: { tintindex: 0 }, east: {} } }]), true);
eq('模型没有 tintindex', api.modelElementsHaveTintIndex([{ faces: { north: { uv: [0, 0, 1, 1] } } }]), false);

/* ---------- 不活跃分支锁定 ---------- */
console.log('\n[不活跃分支锁定]');
const lockGroup = new global.Group({ name: 'lockGroup', imda_type: 'model', imda_model: 'ns:item/lock' });
lockGroup.mesh = { visible: true };
const lockCube = new global.Cube({ from: [0, 0, 0], to: [2, 2, 2], origin: [1, 1, 1], rotation: [0, 0, 0], export: true });
lockCube.parent = lockGroup; lockGroup.children.push(lockCube); lockCube.mesh = { material: { map: { name: 'lk' } } };
const activeGroup = new global.Group({ name: 'activeGroup' }); activeGroup.mesh = { visible: true };
const detach = function () { this.selected = false; const at = global.Outliner.selected.indexOf(this); if (at >= 0) global.Outliner.selected.splice(at, 1); };
lockGroup.selected = true; lockGroup.unselect = detach;
lockCube.selected = true; lockCube.unselect = detach;
global.Outliner.selected.push(lockGroup, lockCube);
api.simApplyGroupVisual([{ group: lockGroup, active: false }, { group: activeGroup, active: true }], 'ghost_lock');
eq('锁定后取消已选中元素', lockGroup.selected === false && lockCube.selected === false && global.Outliner.selected.length === 0, true);
eq('半透明并锁定：未活跃组被锁', lockGroup.locked, true);
eq('半透明并锁定：子方块被锁', lockCube.locked, true);
eq('半透明并锁定：活跃组不锁', !!activeGroup.locked, false);
eq('半透明并锁定：仍有半透明', lockCube.mesh.material.transparent === true, true);
api.simRestoreView();
eq('恢复后解锁分组', !!lockGroup.locked, false);
eq('恢复后解锁方块', !!lockCube.locked, false);
api.simApplyGroupVisual([{ group: lockGroup, active: false }], 'hide_lock');
eq('隐藏并锁定：分组隐藏', lockGroup.mesh.visible, false);
eq('隐藏并锁定：分组锁定', lockGroup.locked, true);
api.simRestoreView();
eq('隐藏并锁定：恢复可见', lockGroup.mesh.visible, true);

/* ---------- 批量选择守卫 ---------- */
console.log('\n[批量选择守卫]');
const bg1 = new global.Group({ name: 'bg1' });
const bg2 = new global.Group({ name: 'bg2' });
const bgCube = new global.Cube({ from: [0, 0, 0], to: [2, 2, 2], origin: [1, 1, 1], rotation: [0, 0, 0] });
const detachBatch = function () { this.selected = false; const at = global.Outliner.selected.indexOf(this); if (at >= 0) global.Outliner.selected.splice(at, 1); };
bg1.unselect = detachBatch; bg2.unselect = detachBatch; bgCube.unselect = detachBatch;
api.setBatchGroupsOnly(true); global.Outliner.selected.push(bg1, bg2, bgCube);
api.guardBatchSelection();
eq('多选分组时取消单个元素', global.Outliner.selected.indexOf(bgCube) < 0, true);
eq('多选分组时分组仍选中', global.Outliner.selected.indexOf(bg1) >= 0 && global.Outliner.selected.indexOf(bg2) >= 0, true);
global.Outliner.selected.length = 0; global.Outliner.selected.push(bg1, bgCube);
api.guardBatchSelection();
eq('只选一个分组时不干预', global.Outliner.selected.indexOf(bgCube) >= 0, true);
api.setBatchGroupsOnly(false); global.Outliner.selected.length = 0;

/* ---------- 纹理引用路径 ---------- */
console.log('\n[纹理引用路径]');
const pathTexture = new global.Texture({ name: 'sac.full', uuid: 'tex-path', path: 'C:/Game/Minecraft/.minecraft/resourcepacks/Squilker Sparkle Res/assets/sqsp/textures/item/inker/jet_rifle/sac.full.png', uv_width: 16, uv_height: 16 });
const pathExporter = api.createExporter();
eq('纹理引用使用实际命名空间和目录', pathExporter.textureRef(pathTexture), 'sqsp:item/inker/jet_rifle/sac.full');
eq('纹理输出路径保留原目录', pathExporter.textures[0].path, 'item/inker/jet_rifle/sac.full');
eq('纹理输出命名空间用 sqsp', pathExporter.textures[0].namespace, 'sqsp');

/* ---------- 框选改选分组 ---------- */
console.log('\n[框选改选分组]');
const boxGroup = new global.Group({ name: 'boxGroup' });
global.Outliner.root.push(boxGroup);

const boxCube1 = new global.Cube({ from: [0, 0, 0], to: [2, 2, 2], origin: [1, 1, 1], rotation: [0, 0, 0] });
const boxCube2 = new global.Cube({ from: [3, 0, 0], to: [5, 2, 2], origin: [4, 1, 1], rotation: [0, 0, 0] });
const detachBox = function () { this.selected = false; const at = global.Outliner.selected.indexOf(this); if (at >= 0) global.Outliner.selected.splice(at, 1); };
boxCube1.parent = boxGroup; boxCube2.parent = boxGroup; boxGroup.children.push(boxCube1, boxCube2); boxCube1.unselect = detachBox; boxCube2.unselect = detachBox;
boxGroup.markAsSelected = function () { this.selected = true; if (global.Outliner.selected.indexOf(this) < 0) global.Outliner.selected.push(this); for (const child of this.children) { child.selected = true; if (global.Outliner.selected.indexOf(child) < 0) global.Outliner.selected.push(child); } };
api.setBoxSelectGroups(true);
global.Outliner.selected.push(boxCube1, boxCube2);
api.guardBoxSelection();
eq('多选方块时改为选中父分组', global.Outliner.selected.indexOf(boxGroup) >= 0, true);
eq('分组及其元素一起被选中', global.Outliner.selected.indexOf(boxCube1) >= 0 && global.Outliner.selected.indexOf(boxCube2) >= 0, true);
api.guardBoxSelection();
eq('再次触发不会再把子元素取消', global.Outliner.selected.indexOf(boxCube1) >= 0 && global.Outliner.selected.indexOf(boxGroup) >= 0, true);
global.Outliner.selected.length = 0; boxCube1.selected = true; global.Outliner.selected.push(boxCube1);
api.guardBoxSelection();
eq('只选一个方块时不处理', global.Outliner.selected.indexOf(boxCube1) >= 0, true);
api.setBoxSelectGroups(false); global.Outliner.selected.length = 0;

/* ---------- 框选规则：强制开启 / 内建模型例外 ---------- */
console.log('\n[框选规则]');
api.setBoxSelectGroups(false);
boxGroup.selected = false;
global.Outliner.selected.length = 0;
boxCube1.selected = true; boxCube2.selected = true;
global.Outliner.selected.push(boxCube1, boxCube2);
api.guardBoxSelection();
eq('装配格式内强制开启（不靠设置）', global.Outliner.selected.indexOf(boxGroup) >= 0, true);
const boxInlineGroup = new global.Group({ name: 'boxInlineGroup', imda_type: 'inline' });
const boxInlineCube1 = new global.Cube({ from: [0, 0, 0], to: [2, 2, 2], origin: [1, 1, 1], rotation: [0, 0, 0] });
const boxInlineCube2 = new global.Cube({ from: [3, 0, 0], to: [5, 2, 2], origin: [4, 1, 1], rotation: [0, 0, 0] });
boxInlineCube1.parent = boxInlineGroup; boxInlineCube2.parent = boxInlineGroup;
boxInlineCube1.unselect = detachBox; boxInlineCube2.unselect = detachBox;
boxInlineGroup.markAsSelected = function () { this.selected = true; if (global.Outliner.selected.indexOf(this) < 0) global.Outliner.selected.push(this); };
global.Outliner.selected.length = 0; boxInlineCube1.selected = true; boxInlineCube2.selected = true;
global.Outliner.selected.push(boxInlineCube1, boxInlineCube2);
api.guardBoxSelection();
eq('只选内建模型元素时保持原样', global.Outliner.selected.indexOf(boxInlineCube1) >= 0 && global.Outliner.selected.indexOf(boxInlineGroup) < 0, true);
const boxRefGroup = new global.Group({ name: 'boxRefGroup', imda_type: 'model', imda_model: 'ns:item/ref' });
global.Outliner.root.push(boxRefGroup);
const refCube1 = new global.Cube({ from: [0, 0, 0], to: [2, 2, 2], origin: [1, 1, 1], rotation: [0, 0, 0] });
const refCube2 = new global.Cube({ from: [3, 0, 0], to: [5, 2, 2], origin: [4, 1, 1], rotation: [0, 0, 0] });
refCube1.parent = boxRefGroup; refCube2.parent = boxRefGroup; boxRefGroup.children.push(refCube1, refCube2); refCube1.unselect = detachBox; refCube2.unselect = detachBox;
boxRefGroup.markAsSelected = function () { this.selected = true; if (global.Outliner.selected.indexOf(this) < 0) global.Outliner.selected.push(this); for (const child of this.children) { child.selected = true; if (global.Outliner.selected.indexOf(child) < 0) global.Outliner.selected.push(child); } };
global.Outliner.selected.length = 0; refCube1.selected = true; refCube2.selected = true;
global.Outliner.selected.push(refCube1, refCube2);
api.guardBoxSelection();
eq('引用模型分组不享受例外', global.Outliner.selected.indexOf(boxRefGroup) >= 0 && global.Outliner.selected.indexOf(refCube1) >= 0, true);

const savedFormatId = global.Format.id; global.Format.id = 'other';
global.Outliner.selected.length = 0; boxCube1.selected = true; boxCube2.selected = true;
global.Outliner.selected.push(boxCube1, boxCube2);
api.guardBoxSelection();
eq('其它格式默认关闭', global.Outliner.selected.indexOf(boxCube1) >= 0 && global.Outliner.selected.indexOf(boxGroup) < 0, true);
global.Format.id = savedFormatId; global.Outliner.selected.length = 0;

/* ---------- 部分选中 / 向上递归 ---------- */
console.log('\n[分组向上递归]');
const partialGroup = new global.Group({ name: 'partialGroup' });
global.Outliner.root.push(partialGroup);
const pc1 = new global.Cube({ from: [0, 0, 0], to: [1, 1, 1], origin: [0, 0, 0], rotation: [0, 0, 0] });
const pc2 = new global.Cube({ from: [2, 0, 0], to: [3, 1, 1], origin: [2, 0, 0], rotation: [0, 0, 0] });
const pc3 = new global.Cube({ from: [4, 0, 0], to: [5, 1, 1], origin: [4, 0, 0], rotation: [0, 0, 0] });
pc1.parent = partialGroup; pc2.parent = partialGroup; pc3.parent = partialGroup;
partialGroup.children.push(pc1, pc2, pc3);
global.Outliner.selected.length = 0; pc1.selected = true; pc2.selected = false; pc3.selected = false; partialGroup.selected = false;
global.Outliner.selected.push(pc1);
api.guardBoxSelection();
eq('只选一个元素也选中父组', !!partialGroup.selected, true);
eq('同层元素一起被选中', pc2.selected === true && pc3.selected === true, true);

const childGroup = new global.Group({ name: 'childGroup' });
const parentGroup = new global.Group({ name: 'parentGroup' });
global.Outliner.root.push(parentGroup);
const gc1 = new global.Cube({ from: [0, 0, 0], to: [1, 1, 1], origin: [0, 0, 0], rotation: [0, 0, 0] });
const gp1 = new global.Cube({ from: [2, 0, 0], to: [3, 1, 1], origin: [2, 0, 0], rotation: [0, 0, 0] });
gc1.parent = childGroup; childGroup.children.push(gc1);
gp1.parent = parentGroup; parentGroup.children.push(childGroup, gp1);
global.Outliner.selected.length = 0; gc1.selected = true; gp1.selected = true; childGroup.selected = false; parentGroup.selected = false;
global.Outliner.selected.push(gc1, gp1);
api.guardBoxSelection();
eq('子组全部子项选中后选中子组', !!childGroup.selected, true);
eq('继续向上选中父组', !!parentGroup.selected, true);
global.Outliner.selected.length = 0;

/* ---------- 分组优先选择时守卫让路 ---------- */
console.log('\n[分组 gizmo 让路]');
const gizmoGroup = new global.Group({ name: 'gizmoGroup' });
const gizmoCube = new global.Cube({ from: [0, 0, 0], to: [1, 1, 1], origin: [0, 0, 0], rotation: [0, 0, 0] });
gizmoCube.parent = gizmoGroup; gizmoGroup.children.push(gizmoCube);
global.Group.selected = [gizmoGroup];
global.Outliner.selected.length = 0; global.Outliner.selected.push(gizmoGroup);
api.guardBoxSelection();
eq('分组优先选择时不改写选择', gizmoCube.selected !== true, true);
global.Group.selected = []; global.Outliner.selected.length = 0;

/* ---------- display 变换 ---------- */
console.log('\n[display 变换]');
const dispTex = new global.Texture({ name: 'dispTex', uuid: 'tex-disp', uv_width: 16, uv_height: 16 });
global.Texture.all.push(dispTex);
const dispCube = new global.Cube({ from: [0, 0, 0], to: [4, 4, 4], origin: [2, 2, 2], rotation: [0, 0, 0] });
dispCube.faces = { north: { texture: 'tex-disp', uv: [0, 0, 16, 16] } };
const dispExporter = api.createExporter();
dispExporter.addModel([dispCube], 'displayTest');
eq('手持 display scale = 0.85（对齐引用模型）', dispExporter.models[0].data.display.thirdperson_righthand.scale, [0.85, 0.85, 0.85]);
eq('不再输出 gui display', dispExporter.models[0].data.display.gui, undefined);
eq('未设置槽位回退手持预设', dispExporter.models[0].data.display.firstperson_righthand.scale, [0.68, 0.68, 0.68]);

/* ---------- transformation 单位 ---------- */
console.log('\n[transformation 单位]');
const unitExporter = api.createExporter();
const unitTransformation = unitExporter.buildTransformation({ origin: [0, 0, 0], rotation: [0, 0, 0] }, [16, 0, 0], [0, 0, 0]);
eq('translation 以格为单位（16px = 1）', unitTransformation.translation, [1, 0, 0]);


/* ---------- 项目显示调整 / 子空间 / 时间轴采样 ---------- */
console.log('\n[显示调整 / 子空间 / 时间轴]');
global.Project.display_settings = {
  gui: { export() { return { scale: [1.25, 1.25, 1.25] }; } },
  thirdperson_righthand: { export() { return { rotation: [0, -90, 55], translation: [0, 4, 0.5], scale: [0.85, 0.85, 0.85] }; } },
};
global.Project.imda_display_all_slots = true;
const displayExporter = api.createExporter();
displayExporter.addModel([dispCube], 'displayFromProject');
eq('display 使用显示调整页的 gui', displayExporter.models[0].data.display.gui.scale, [1.25, 1.25, 1.25]);
eq('display 使用显示调整页的手持', displayExporter.models[0].data.display.thirdperson_righthand.scale, [0.85, 0.85, 0.85]);
eq('未在显示调整页出现的上下文不输出', displayExporter.models[0].data.display.ground, undefined);
delete global.Project.display_settings;
delete global.Project.imda_display_all_slots;
const parsedNs = api.parseNamespaceSetting('sqsptst:weapon/shotgun');
eq('命名空间解析', parsedNs.namespace, 'sqsptst');
eq('子空间解析', parsedNs.subpath, 'weapon/shotgun');
global.Project.imda_namespace = 'sqsptst:weapon/shotgun';
const subExporter = api.createExporter();
subExporter.addModel([dispCube], 'subpath');
eq('模型引用带子空间', subExporter.models[0] && subExporter.models.length > 0, true);
eq('子空间模型引用前缀', subExporter.models[0].name.indexOf('subpath') >= 0, true);
const savedSubRoot = global.Outliner.root.splice(0, global.Outliner.root.length, dispCube);
const subFiles = subExporter.buildFiles().files;
eq('items 路径带子空间', subFiles.some(f => f.path === 'assets/sqsptst/items/weapon/shotgun/' + Project.model_identifier + '.json' || f.path.indexOf('assets/sqsptst/items/weapon/shotgun/') === 0), true);
eq('models 路径带子空间', subFiles.some(f => f.path.indexOf('assets/sqsptst/models/item/weapon/shotgun/') === 0), true);
global.Outliner.root.splice(0, global.Outliner.root.length, ...savedSubRoot);
delete global.Project.imda_namespace;
const sampleAnim = { time: 0.5, getBoneAnimator(group) { return group === dispCube.parent ? null : { keyframes: [{}], channels: { rotation: [{}], position: [{}] }, interpolate(ch) { return ch === 'rotation' ? [0, 10, 0] : (ch === 'position' ? [0, 1, 0] : [1, 1, 1]); } }; } };
console.log('（时间轴采样在动画导出单测中覆盖）');

/* ---------- 自动时间轴 ---------- */
console.log('\n[自动时间轴]');
const autoGroup = new global.Group({ name: 'autoGroup', imda_type: 'composite', origin: [8, 8, 8], rotation: [0, 0, 0] });
const autoCube = new global.Cube({ from: [0, 0, 0], to: [4, 4, 4], origin: [2, 2, 2], rotation: [0, 0, 0] });
autoCube.faces = { north: { texture: 'tex-disp', uv: [0, 0, 16, 16] } };
autoCube.parent = autoGroup; autoGroup.children.push(autoCube);
const savedRootAuto = global.Outliner.root.splice(0, global.Outliner.root.length, autoGroup);
const savedGroupAllAuto = global.Group.all; global.Group.all = [autoGroup];
const autoAnimator = { keyframes: [{}], channels: { rotation: [{}], position: [{}] }, interpolate(ch) { if (ch === 'rotation') return [0, 0, 0]; if (ch === 'position') return [0, Number(global.Animation.selected.time) * 10, 0]; return [1, 1, 1]; } };
global.Animation = { selected: { length: 0.1, time: 0, getBoneAnimator(group) { return group === autoGroup ? autoAnimator : null; } }, all: [] };
const autoMapping = api.createExporter().buildMapping();
eq('时间轴根是 composite', autoMapping.model.type, 'minecraft:composite');
const autoRange = autoMapping.model.models.find(n => n.type === 'minecraft:range_dispatch');
eq('自动输出 range_dispatch', !!autoRange, true);
eq('时间轴节点带 node_name', autoRange.node_name, '* timeline');
eq('自动输出两帧', autoRange.entries.length, 2);
eq('帧阈值 0/1', autoRange.entries.map(e => e.threshold), [0, 1]);
eq('帧节点名', autoRange.entries[0].model.node_name, 'frame 0.0.0.1');
eq('逐帧 transformation 不同', JSON.stringify(autoRange.entries[0].model) !== JSON.stringify(autoRange.entries[1].model), true);
delete global.Animation;
global.Group.all = savedGroupAllAuto;
global.Outliner.root.splice(0, global.Outliner.root.length, ...savedRootAuto);
/* ---------- 时间轴保留静态祖先变换 ---------- */
console.log('\n[时间轴静态祖先]');
const tlParent = new global.Group({ name: 'tlParent', imda_type: 'composite', origin: [8, 8, 8], rotation: [0, 0, 45] });
const tlBone = new global.Group({ name: 'tlBone', imda_type: 'composite', origin: [8, 8, 8], rotation: [0, 0, 0] });
const tlStatic = new global.Group({ name: 'tlStatic', imda_type: 'composite', origin: [8, 8, 8], rotation: [0, 0, 0] });
const tlBoneCube = new global.Cube({ from: [0, 0, 0], to: [2, 2, 2], origin: [1, 1, 1], rotation: [0, 0, 0] });
tlBoneCube.faces = { north: { texture: 'tex-disp', uv: [0, 0, 16, 16] } }; tlBoneCube.parent = tlBone; tlBone.children.push(tlBoneCube);
const tlStaticCube = new global.Cube({ from: [2, 0, 0], to: [4, 2, 2], origin: [3, 1, 1], rotation: [0, 0, 0] });
tlStaticCube.faces = { north: { texture: 'tex-disp', uv: [0, 0, 16, 16] } }; tlStaticCube.parent = tlStatic; tlStatic.children.push(tlStaticCube);
const tlParentCube = new global.Cube({ from: [0, 2, 0], to: [2, 4, 2], origin: [1, 3, 1], rotation: [0, 0, 0] });
tlParentCube.faces = { north: { texture: 'tex-disp', uv: [0, 0, 16, 16] } }; tlParentCube.parent = tlParent; tlParent.children.push(tlParentCube);
tlBone.parent = tlParent; tlParent.children.push(tlBone); tlStatic.parent = tlParent; tlParent.children.push(tlStatic);
const savedTlRoot = global.Outliner.root.splice(0, global.Outliner.root.length, tlParent);
const savedTlAll = global.Group.all; global.Group.all = [tlParent, tlBone, tlStatic];
const tlAnimator = { keyframes: [{}], channels: { rotation: [{}] }, interpolate(ch) { return ch === 'rotation' ? [0, 0, 30] : [0, 0, 0]; } };
global.Animation = { selected: { length: 0.05, time: 0, getBoneAnimator(group) { return group === tlBone ? tlAnimator : null; } }, all: [] };
const tlMapping = api.createExporter().buildMapping();
const tlParentNode = tlMapping.model.models.find(n => n.node_name === 'tlParent');
eq('时间轴保留静态祖先 transformation', !!tlParentNode && !!tlParentNode.transformation, true);
eq('时间轴保留静态祖先 node_name', !!tlParentNode, true);
eq('静态兄弟仍在时间轴外', !!tlParentNode && tlParentNode.models.some(n => n.node_name === 'tlStatic'), true);
delete global.Animation; global.Group.all = savedTlAll; global.Outliner.root.splice(0, global.Outliner.root.length, ...savedTlRoot);
/* ---------- 递减序列顺序 ---------- */
console.log('\n[递减序列]');
const seq1 = new global.Group({ name: 'a1', imda_type: 'composite' });
const seq2 = new global.Group({ name: 'a2', imda_type: 'composite' });
const seq3 = new global.Group({ name: 'a3', imda_type: 'composite' });
const savedSeqRoot = global.Outliner.root.splice(0, global.Outliner.root.length, seq1, seq2, seq3);
seq1.selected = true; seq3.selected = true; seq2.selected = true; global.Outliner.selected = [seq3, seq1, seq2];
eq('按大纲顺序排列 a1..aN', api.orderedSelectedGroups().map(g => g.name), ['a1', 'a2', 'a3']);
eq('递减序列计数', api.sequenceCounts(5, 1, 'decrease'), [5, 4, 3, 2, 1]);
eq('递增序列计数', api.sequenceCounts(5, 1, 'increase'), [1, 2, 3, 4, 5]);
eq('步长 2 递增', api.sequenceCounts(5, 2, 'increase'), [1, 3, 5]);
eq('步长 2 递减', api.sequenceCounts(5, 2, 'decrease'), [5, 3, 1]);
global.Outliner.selected = [];
global.Outliner.root.splice(0, global.Outliner.root.length, ...savedSeqRoot);
/* ---------- 规范化结构 ---------- */
console.log('\n[规范化结构]');
const normGroup = new global.Group({ name: 'normGroup', imda_type: 'composite' });
const normCube = new global.Cube({ from: [0, 0, 0], to: [2, 2, 2], origin: [1, 1, 1], rotation: [0, 0, 0] });
normCube.parent = normGroup; normGroup.children.push(normCube);
const savedNormRoot = global.Outliner.root.splice(0, global.Outliner.root.length, normGroup);
const savedNormAll = global.Group.all; global.Group.all = [normGroup];
const normCreated = api.normalizeCompositeCubes();
const normInline = normGroup.children.find(n => n.imda_type === 'inline');
eq('生成 inline 子分组', normCreated >= 1 && !!normInline, true);
eq('cube 移入 inline', normCube.parent === normInline, true);
eq('composite 不再有直属 cube', normGroup.children.some(n => n === normCube), false);
global.Group.all = savedNormAll; global.Outliner.root.splice(0, global.Outliner.root.length, ...savedNormRoot);
/* ---------- range_dispatch 下的复调用 ---------- */
console.log('\n[range 复调用]');
const rangeCallGroup = new global.Group({ name: 'rangeCall', imda_type: 'range_dispatch', imda_property: 'minecraft:custom_model_data', imda_index: 0 });
const rangeCallLocator = new global.Locator({ name: '调用 target', position: [0, 0, 0], rotation: [0, 0, 0] });
rangeCallLocator.imda_call_target = 'target-uuid';
rangeCallGroup.children.push(rangeCallLocator);
if (global.Group.all.indexOf(targetGroup) < 0) global.Group.all.push(targetGroup);
const savedRangeRoot = global.Outliner.root.splice(0, global.Outliner.root.length, rangeCallGroup);
const rangeCallExporter = api.createExporter();
rangeCallExporter.addModel = () => ({ reference: 'ns:item/rangecallfake', shift: [0, 0, 0] });
const rangeCallJSON = JSON.stringify(rangeCallExporter.buildMapping());
eq('range_dispatch 下的复调用被输出', rangeCallJSON.indexOf('rangecallfake') >= 0, true);
eq('range 复调用不含占位字段', rangeCallJSON.indexOf('__imda_call_group'), -1);
global.Outliner.root.splice(0, global.Outliner.root.length, ...savedRangeRoot);
/* ---------- 旧前缀迁移 ---------- */
console.log('\n[旧前缀迁移]');
const OLD = 'i' + 'mm_';
const legacyNode = {};
legacyNode[OLD + 'call_target'] = 'target-uuid';
legacyNode[OLD + 'type'] = 'composite';
legacyNode[OLD + 'index'] = 3;
api.migrateLegacyNode(legacyNode);
eq('旧前缀迁移 call_target', legacyNode.imda_call_target, 'target-uuid');
eq('旧前缀迁移 type', legacyNode.imda_type, 'composite');
eq('旧前缀迁移 index', legacyNode.imda_index, 3);
eq('旧键被删除', Object.keys(legacyNode).some(k => k.startsWith(OLD)), false);
/* ---------- 内部结构 ---------- */
console.log('\n[内部结构]');
const internalRefGroup = new global.Group({ name: 'refModel', imda_type: 'model', imda_model: 'ns:item/foo', imda_tint_type: 'custom_model_data', imda_tint_index: '2' });
const internalInnerGroup = new global.Group({ name: 'inner', imda_type: 'internal' });
internalInnerGroup.parent = internalRefGroup; internalRefGroup.children.push(internalInnerGroup);
const internalInnerCube = new global.Cube({ from: [0,0,0], to: [1,1,1], origin: [0,0,0], rotation: [0,0,0] });
internalInnerCube.parent = internalInnerGroup; internalInnerGroup.children.push(internalInnerCube);
eq('内部结构向上选中引用模型组', api.selectionGroupForCube(internalInnerCube.parent) === internalRefGroup, true);
eq('内部结构继承引用模型 tint 链', internalInnerGroup.parent === internalRefGroup, true);
/* ---------- 复调用模型 id 预填 ---------- */
console.log('\n[复调用预填]');
eq('失效 UUID 不预填模型 id', api.callModelPrefill('6d52650e-a35b-ca94-5ce5-de00d6a3cd51', ''), '');
eq('匹配分组时不预填模型 id', api.callModelPrefill('some-uuid', 'some-uuid'), '');
eq('模型 id 正常预填', api.callModelPrefill('ns:item/foo', ''), 'ns:item/foo');

/* ---------- 内部结构选择 ---------- */
console.log('\n[内部结构选择]');
const selModel = new global.Group({ name: 'selModel', imda_type: 'model', imda_model: 'ns:item/ref' });
const selInternal = new global.Group({ name: 'selInternal', imda_type: 'internal' });
selInternal.parent = selModel; selModel.children.push(selInternal);
const selCube = new global.Cube({ from: [0,0,0], to: [1,1,1], origin: [0,0,0], rotation: [0,0,0] });
selCube.parent = selInternal; selInternal.children.push(selCube);
global.Outliner.selected.length = 0; selCube.selected = true; global.Outliner.selected.push(selCube);
api.guardBoxSelection();
eq('internal 子项直接上溯到 model', global.Outliner.selected.indexOf(selModel) >= 0, true);
global.Outliner.selected.length = 0; selInternal.selected = true; global.Outliner.selected.push(selInternal);
api.guardBoxSelection();
eq('只选 internal 分组也上溯到 model', global.Outliner.selected.indexOf(selModel) >= 0, true);
/* ---------- 枢轴记录重建 ---------- */
console.log('\n[枢轴记录]');
const recordPivotGroup = new global.Group({ name: 'recordPivotGroup', imda_type: 'composite', origin: [0, 0, 0], rotation: [0, 0, 0] });
const recordPivotCube = new global.Cube({ from: [10, 0, 0], to: [12, 0, 0], origin: [11, 0, 0], rotation: [0, 0, 0] });
recordPivotCube.parent = recordPivotGroup; recordPivotGroup.children.push(recordPivotCube);
api.fixGroupPivot(recordPivotGroup);
eq('归中后枢轴在几何中心', recordPivotGroup.origin[0], 11);
api.restoreGroupPivotFromRecord(recordPivotGroup);
eq('从记录恢复到原枢轴', recordPivotGroup.origin[0], 0);
/* ---------- cooldown 时间轴 ---------- */
console.log('\n[cooldown 时间轴]');
const cool = api.cooldownThresholds(4);
eq('cooldown 帧数', cool.length, 4);
eq('cooldown 第一帧为 1', cool[0], 1);
eq('cooldown 最后一帧为 0', cool[3], 0);
/* ---------- 物品根参数 ---------- */
console.log('\n[物品根参数]');
global.Project.imda_hand_animation_on_swap = false;
global.Project.imda_oversized_in_gui = true;
global.Project.imda_swap_animation_scale = 0;
const rootJson = api.formatMapping({ model: { type: 'minecraft:model', model: 'ns:item/x' } });
eq('根参数 hand_animation_on_swap', rootJson.indexOf('hand_animation_on_swap') >= 0, true);
eq('根参数 oversized_in_gui', rootJson.indexOf('oversized_in_gui') >= 0, true);
eq('根参数 swap_animation_scale', rootJson.indexOf('swap_animation_scale') >= 0, true);
delete global.Project.imda_hand_animation_on_swap; delete global.Project.imda_oversized_in_gui; delete global.Project.imda_swap_animation_scale;
/* ---------- 序列项（分组+Locator） ---------- */
console.log('\n[序列项]');
const seqGroup = new global.Group({ name: 'seqGroup', imda_type: 'composite' });
const seqCall = new global.Locator({ name: 'seqCall', position: [0,0,0], rotation: [0,0,0] });
seqCall.imda_call_target = 'target-uuid';
global.Outliner.root.length = 0; global.Outliner.root.push(seqGroup, seqCall);
global.Outliner.selected.length = 0; global.Outliner.selected.push(seqCall, seqGroup);
const seqItems = api.orderedSequenceItems();
eq('序列项包含分组和复调用 Locator', seqItems.length, 2);
eq('序列项按大纲顺序', seqItems[0] === seqGroup && seqItems[1] === seqCall, true);
/* ---------- 序列自动补本体 ---------- */
console.log('\n[序列自动补本体]');
const seqTarget = new global.Group({ name: 'seqTarget', imda_type: 'composite', uuid: 'seq-target-uuid' });
const seqCallA = new global.Locator({ name: '调用 A', position: [1,0,0], rotation: [0,0,0] }); seqCallA.imda_call_target = 'seq-target-uuid';
const seqCallB = new global.Locator({ name: '调用 B', position: [2,0,0], rotation: [0,0,0] }); seqCallB.imda_call_target = 'seq-target-uuid';
global.Group.all.push(seqTarget); global.Outliner.root.length = 0; global.Outliner.root.push(seqCallA, seqCallB);
global.Outliner.selected.length = 0; global.Outliner.selected.push(seqCallA, seqCallB);
const seqAuto = api.orderedSequenceItems();
eq('只选同目标 Locator 时自动补目标分组', seqAuto[0] === seqTarget && seqAuto.length === 3, true);
/* ---------- 复调用覆盖 ---------- */
console.log('\n[复调用覆盖]');
const ovLocator = new global.Locator({ name: 'ov', position: [0,0,0], rotation: [0,0,0] });
ovLocator.imda_call_overrides = JSON.stringify({ property: 'cooldown', index: '2', threshold: '4' });
const ovParsed = api.callOverridesOf(ovLocator);
eq('复调用覆盖 property', ovParsed.property, 'cooldown');
eq('复调用覆盖 threshold', ovParsed.threshold, '4');
/* ---------- internal 清理 ---------- */
console.log('\n[internal 清理]');
const invParent = new global.Group({ name: 'invParent', imda_type: 'composite' });
const invInternal = new global.Group({ name: 'invInternal', imda_type: 'internal' });
invInternal.parent = invParent; invParent.children.push(invInternal);
const valModel = new global.Group({ name: 'valModel', imda_type: 'model' });
const valInternal = new global.Group({ name: 'valInternal', imda_type: 'internal' });
valInternal.parent = valModel; valModel.children.push(valInternal);
global.Outliner.root.length = 0; global.Outliner.root.push(invParent, valModel);
api.removeInvalidInternalGroups();
eq('无效 internal 被删除', invParent.children.indexOf(invInternal), -1);
eq('model 下的 internal 保留', valModel.children.indexOf(valInternal) >= 0, true);
/* ---------- 批量实例化覆盖 ---------- */
console.log('\n[批量实例化覆盖]');
const ovGroupA = new global.Group({ name: 'ovA', imda_type: 'range_dispatch' });
const ovGroupB = new global.Group({ name: 'ovB', imda_type: 'range_dispatch' });
const ovLocA = new global.Locator({ name: 'a', position: [0,0,0], rotation: [0,0,0] }); ovLocA.imda_call_overrides = JSON.stringify({ threshold_format: 'i' });
const ovLocB = new global.Locator({ name: 'b', position: [0,0,0], rotation: [0,0,0] }); ovLocB.imda_call_overrides = JSON.stringify({ threshold_format: '2i' });
api.applyCallOverridesToGroup(ovGroupA, ovLocA); api.applyCallOverridesToGroup(ovGroupB, ovLocB);
eq('批量覆盖 A', ovGroupA.imda_threshold_format, 'i');
eq('批量覆盖 B', ovGroupB.imda_threshold_format, '2i');
/* ---------- 汇总 ---------- */
console.log('\n通过 ' + pass + ' / ' + (pass + fail) + (fail ? ('，失败 ' + fail) : ''));
process.exit(fail ? 1 : 0);
