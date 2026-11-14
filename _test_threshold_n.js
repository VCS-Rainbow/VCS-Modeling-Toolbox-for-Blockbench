/* range_dispatch 分支编号格式的变量 n 测试（0.73.0）
 *  n = 本分支在上层节点里的编号（阈值）。
 *  例：外层 slots 格式 `i` → 第 6 个分支 slots[5]；它自己的格式 `ni` → 子分支 0,5,10。
 *
 *  对照：node _test_threshold_n.js
 */
const PLUGIN = 'C:\\Users\\Rainbow_\\blockbench_item_model_mapping_isolated\\item_model_definition_assembly.js';

/* ---------- mock 环境（与 _test_convert.js 同一套） ---------- */
class FakeEl {
	constructor(t) { this.tagName = String(t).toUpperCase(); this.children = []; this.style = { cssText: '' }; this._text = ''; this.listeners = []; this.options = []; }
	appendChild(c) { c.parentElement = this; this.children.push(c); return c; }
	insertBefore(c, r) { c.parentElement = this; const i = this.children.indexOf(r); this.children.splice(i < 0 ? this.children.length : i, 0, c); return c; }
	addEventListener(t, fn) { this.listeners.push({ type: t, fn }); }
	get firstChild() { return this.children[0] || null; }
	set textContent(v) { this._text = String(v); this.children = []; }
	get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
	set innerHTML(v) { if (v === '') this.children = []; }
	get innerHTML() { return ''; }
	querySelectorAll() { return []; }
}
global.document = { createElement: (t) => new FakeEl(t) };
global.Panel = class { constructor(id, o) { this.id = id; this.node = new FakeEl('div'); this.options = o || {}; } show() { } delete() { } };
global.THREE = {
	Quaternion: class { constructor() { Object.assign(this, { x: 0, y: 0, z: 0, w: 1 }); } setFromEuler() { return this; } normalize() { return this; } lengthSq() { return 1; } copy() { return this; } },
	Euler: class { constructor(x = 0, y = 0, z = 0, order = 'XYZ') { Object.assign(this, { x, y, z, order }); } },
	MeshBasicMaterial: class { constructor(o) { Object.assign(this, o || {}); this.color = { set() { } }; } dispose() { } },
	SpriteMaterial: class { constructor(o) { Object.assign(this, o || {}); this.color = { set() { } }; } },
	Sprite: class { constructor() { this.scale = { set() { } }; } },
	Object3D: class { constructor() { this.rotation = { order: 'ZYX' }; this.position = { set() { } }; } },
	TextureLoader: class { load() { return {}; } },
};
if (!Array.prototype.safePush) Array.prototype.safePush = function (v) { if (v != null && this.indexOf(v) < 0) this.push(v); return this; };
if (!Array.prototype.remove) Array.prototype.remove = function (v) { const i = this.indexOf(v); if (i >= 0) this.splice(i, 1); return this; };
if (!Array.prototype.last) Array.prototype.last = function () { return this[this.length - 1]; };
if (!Array.prototype.empty) Array.prototype.empty = function () { this.length = 0; return this; };
global.Texture = class { constructor(o) { Object.assign(this, o); } }; Texture.all = [];
global.Cube = class { constructor(o) { Object.assign(this, o); this.faces = this.faces || {}; } addTo(p) { if (p) { this.parent = p; p.children.push(this); } return this; } init() { return this; } remove() { return this; } getParentArray() { return this.parent ? this.parent.children : global.Outliner.root; } }; Cube.all = [];
global.OutlinerElement = class {
	constructor(o) { Object.assign(this, o || {}); if (!this.uuid) this.uuid = 'el-' + Math.random(); if (!('parent' in this)) this.parent = 'root'; }
	addTo(p) {
		if (this.parent && this.parent !== 'root' && Array.isArray(this.parent.children)) { const i = this.parent.children.indexOf(this); if (i >= 0) this.parent.children.splice(i, 1); }
		if (p && p !== 'root' && Array.isArray(p.children)) { this.parent = p; if (p.children.indexOf(this) < 0) p.children.push(this); }
		else { this.parent = 'root'; if (global.Outliner.root.indexOf(this) < 0) global.Outliner.root.push(this); }
		return this;
	}
	init() {
		global.OutlinerNode = global.OutlinerNode || {}; global.OutlinerNode.uuids = global.OutlinerNode.uuids || {};
		global.OutlinerNode.uuids[this.uuid] = this;
		if (!this.parent || (this.parent === 'root' && global.Outliner.root.indexOf(this) === -1)) this.addTo('root');
		return this;
	}
	remove() {
		if (this.parent && this.parent !== 'root' && Array.isArray(this.parent.children)) { const i = this.parent.children.indexOf(this); if (i >= 0) this.parent.children.splice(i, 1); }
		const j = global.Outliner.root.indexOf(this); if (j >= 0) global.Outliner.root.splice(j, 1);
		this.parent = null; return this;
	}
	getParentArray() { return (this.parent === 'root' || !this.parent) ? global.Outliner.root : this.parent.children; }
	markAsSelected() { this.selected = true; global.Outliner.selected.safePush(this); return this; }
	unselect() { this.selected = false; global.Outliner.selected.remove(this); return this; }
	clickSelect() { }
};
global.OutlinerElement.types = {}; global.OutlinerElement.behavior_overrides = [];
global.OutlinerElement.registerType = function (c, id) { this.types[id] = c; c.prototype.type = id; if (!c.all) c.all = []; if (!c.selected) c.selected = []; };
global.Group = class extends global.OutlinerElement { constructor(o) { super(o); this.children = []; if (!this.uuid) this.uuid = 'grp-' + Math.random(); } }; Group.all = []; Group.multi_selected = [];
global.immAddAndInit = function (node, parent) { if (!node) return node; if (parent) node.addTo(parent); else node.addTo(); node.init(); return node; };
global.Locator = class extends global.OutlinerElement { constructor(o) { super(o); if (!o || !o.uuid) this.uuid = 'loc-' + Math.random(); Locator.all.safePush(this); } }; Locator.all = [];
Locator.behavior = { unique_name: true, movable: true, rotatable: true };
global.Menu = class { constructor(s) { this.structure = Array.isArray(s) ? s.slice() : []; } addAction(a) { this.structure.push(a); } };
global.MenuSeparator = class { constructor(id) { this.id = id; } };
global.NodePreviewController = class { constructor(t) { t.preview_controller = this; } dispatchEvent() { } };
global.Outliner = { root: [], selected: [], ROOT: 'root', buttons: { visibility: {}, locked: {}, export: {} } };
global.Project = { name: 'threshold_n', imda_pack_version: '26.2', imda_pack_path: '' };
global.Properties = [];
global.Property = class { constructor(target, type, name, options) { global.Properties.push({ target, type, name, options }); } };
global.Format = { id: 'item_model_definition_assembly', euler_order: 'ZYX' };
global.ModelProject = class { };
global.Face = class { };
let plugin_options = null;
global.Plugin = { register(id, options) { plugin_options = options; } };
global.Action = class { constructor(id, options) { Object.assign(this, options); this.id = id; } delete() { } };
global.MenuBar = { addAction() { }, removeAction() { }, update() { }, menus: { file: { structure: [] } } };
global.Dialog = class { constructor(o) { this.options = o; } show() { return this; } };
global.Codec = class { constructor(id, data) { Object.assign(this, data); this.id = id; } delete() { } };
global.ModelFormat = class { constructor(id, data) { Object.assign(this, data); this.id = id; } delete() { } };
global.Blockbench = { showQuickMessage(m) { global.__lastMsg = String(m); }, showMessageBox(o) { global.__lastBox = o; }, on() { }, writeFile() { }, pickDirectory() { return null; } };
global.Undo = { initEdit() { }, finishEdit() { }, history: [], index: 0 };
global.__IMM_TEST__ = {};
global.requireNativeModule = (name) => { try { return require(name); } catch (e) { return null; } };

require(PLUGIN);
plugin_options.onload();
const api = global.__IMM_TEST__.api;

let pass = 0, fail = 0;
const ok = (label, cond, detail) => { if (cond) { pass++; console.log('  \u2714 ' + label); } else { fail++; console.log('  \u2718 ' + label + (detail === undefined ? '' : ('\n      ' + JSON.stringify(detail)))); } };
const eq = (label, actual, expected) => ok(label + (JSON.stringify(actual) === JSON.stringify(expected) ? '' : ('  \u2190 \u5b9e\u9645 ' + JSON.stringify(actual))), JSON.stringify(actual) === JSON.stringify(expected));

console.log('\u7248\u672c\uff1a' + api.VERSION);
const ex = api.createExporter();

/* ---------- evalThreshold 的 n ---------- */
console.log('\n[evalThreshold n]');
eq('i 基础不变', [0, 1, 2].map(i => ex.evalThreshold('i', i)), [0, 1, 2]);
eq('ni\uff08n=5\uff09', [0, 1, 2].map(i => ex.evalThreshold('ni', i, 5)), [0, 5, 10]);
eq('\u5b57\u9762 n', [0, 1, 2].map(i => ex.evalThreshold('n', i, 7)), [7, 7, 7]);
eq('2n', [0, 1, 2].map(i => ex.evalThreshold('2n', i, 3)), [6, 6, 6]);
eq('n+i', [0, 1, 2].map(i => ex.evalThreshold('n+i', i, 10)), [10, 11, 12]);
eq('ni\uff08n \u7f3a\u7701=1\uff09', [0, 1, 2].map(i => ex.evalThreshold('ni', i)), [0, 1, 2]);
eq('n \u663e\u5f0f\u4e3a 0 \u65f6\u7528 0', [0, 1, 2].map(i => ex.evalThreshold('ni', i, 0)), [0, 0, 0]);
eq('n*i \u663e\u5f0f\u5199\u6cd5', [0, 1, 2].map(i => ex.evalThreshold('n*i', i, 4)), [0, 4, 8]);
eq('5-i \u4ecd\u7136\u6b63\u5e38', [0, 1, 2].map(i => ex.evalThreshold('5-i', i)), [5, 4, 3]);
eq('10+2i \u4ecd\u7136\u6b63\u5e38', [0, 1, 2].map(i => ex.evalThreshold('10+2i', i)), [10, 12, 14]);
eq('0,1,3 \u5b57\u9762\u8868', [0, 1, 2, 3].map(i => ex.evalThreshold('0,1,3', i)), [0, 1, 3, 4]);

/* ---------- 导出级：嵌套 range_dispatch 传递 n ---------- */
console.log('\n[\u5bfc\u51fa\u5c42\u9012\u5f52 n]');
global.Outliner.root.length = 0;
const leaf = (name, ref) => { const g = new global.Group({ name, imda_type: 'model', imda_model: ref }); return g; };

// 外层 slots：格式 i，6 个子分支（第 6 个 index=5 即编号 slots[5]）
const slots = new global.Group({ name: 'slots', imda_type: 'range_dispatch', imda_property: 'custom_model_data', imda_index: 0, imda_threshold_format: 'i' });
for (let k = 0; k < 5; k++) global.immAddAndInit(leaf('c' + k, 'ns:m' + k), slots);
// 第 6 个分支是嵌套 range_dispatch，格式 ni
const branch5 = new global.Group({ name: 'slots[?]', imda_type: 'range_dispatch', imda_property: 'custom_model_data', imda_index: 0, imda_threshold_format: 'ni' });
for (let k = 0; k < 3; k++) global.immAddAndInit(leaf('s' + k, 'ns:s' + k), branch5);
global.immAddAndInit(branch5, slots);
global.immAddAndInit(slots, null);

const mapping = api.createExporter().buildMapping();
const outer = mapping.model.models.find(n => n && n.type === 'minecraft:range_dispatch' && n.entries && n.entries.length === 6);
ok('找到外层 range_dispatch\uff086 个 entries\uff09', !!outer);
if (outer) {
	eq('\u5916\u5c42\u9608\u503c\u4e3a 0..5', outer.entries.map(e => e.threshold), [0, 1, 2, 3, 4, 5]);
	const inner = outer.entries[5] && outer.entries[5].model;
	ok('\u7b2c 6 \u4e2a\u5206\u652f\u662f\u5d4c\u5957 range_dispatch', !!inner && inner.type === 'minecraft:range_dispatch');
	eq('\u5d4c\u5957\u5206\u652f\u7684\u9608\u503c\uff08ni\uff0cn=5\uff09= 0,5,10', inner && inner.entries.map(e => e.threshold), [0, 5, 10]);
}

// 顶层 range_dispatch（上层没有编号）用 ni → n 默认 1 → 0,1,2
global.Outliner.root.length = 0;
const topN = new global.Group({ name: 'topN', imda_type: 'range_dispatch', imda_property: 'custom_model_data', imda_index: 0, imda_threshold_format: 'ni' });
for (let k = 0; k < 3; k++) global.immAddAndInit(leaf('t' + k, 'ns:t' + k), topN);
global.immAddAndInit(topN, null);
const m2 = api.createExporter().buildMapping();
const topNode = m2.model.models.find(n => n && n.type === 'minecraft:range_dispatch');
ok('\u627e\u5230\u9876\u5c42 range_dispatch', !!topNode);
eq('\u9876\u5c42 ni\uff08n \u9ed8\u8ba4 1\uff09= 0,1,2', topNode && topNode.entries.map(e => e.threshold), [0, 1, 2]);

/* ---------- 缺省 n = 同层兄弟分组从上往下数的序号（slots{a,b,c} → 1,2,3） ---------- */
console.log('\n[缺省 n = 同层序号]');
global.Outliner.root.length = 0;
const slotsC = new global.Group({ name: 'slotsC', imda_type: 'composite' });
global.immAddAndInit(slotsC, null);
const mkBranch = (name) => {
	const g = new global.Group({ name, imda_type: 'range_dispatch', imda_property: 'custom_model_data', imda_index: 0, imda_threshold_format: 'ni' });
	for (let k = 0; k < 2; k++) global.immAddAndInit(leaf(name + '_l' + k, 'ns:' + name + k), g);
	global.immAddAndInit(g, slotsC);
	return g;
};
const sa = mkBranch('a'), sb = mkBranch('b'), sc = mkBranch('c');
eq('siblingBranchNumber a/b/c = 1/2/3', [sa, sb, sc].map(g => api.siblingBranchNumber(g)), [1, 2, 3]);
const m3 = api.createExporter().buildMapping();
const br = (name) => (m3.model.models || []).find(n => n && n.type === 'minecraft:range_dispatch' && n.entries && n.entries.length === 2 && n.entries[0].model && String(n.entries[0].model.model || '').indexOf(name) >= 0);
const findRd = () => {
	const out = [];
	const walk = (nodes) => { for (const n of (nodes || [])) { if (!n || typeof n !== 'object') continue; if (n.type === 'minecraft:range_dispatch') out.push(n); for (const k of ['models', 'on_true', 'on_false', 'fallback']) if (n[k]) walk(Array.isArray(n[k]) ? n[k] : [n[k]]); if (n.cases) for (const c of n.cases) walk([c.model]); if (n.entries) for (const e of n.entries) walk([e.model]); } };
	walk(m3.model.models);
	return out;
};
const rds = findRd();
eq('三个子 range_dispatch 都导出', rds.length, 3);
eq('a 的 n=1 → ni 得 0,1', rds[0] && rds[0].entries.map(e => e.threshold), [0, 1]);
eq('b 的 n=2 → ni 得 0,2', rds[1] && rds[1].entries.map(e => e.threshold), [0, 2]);
eq('c 的 n=3 → ni 得 0,3', rds[2] && rds[2].entries.map(e => e.threshold), [0, 3]);

/* ---------- f / s：f = 容器所在层的元素数（含自身），s = 容器自身的子项数（不递归） ---------- */
console.log('\n[f / s]');
// 直接测解析器：不依赖大纲
eq('f 字面', [0, 1].map(i => ex.evalThreshold('f', i, undefined, { f: 3, s: 2 })), [3, 3]);
eq('s 字面', [0, 1].map(i => ex.evalThreshold('s', i, undefined, { f: 3, s: 2 })), [2, 2]);
eq('f-s', [0, 1].map(i => ex.evalThreshold('f-s', i, undefined, { f: 3, s: 2 })), [1, 1]);
eq('f*10+i（f 参与，单调升序）', [0, 1, 2].map(i => ex.evalThreshold('f*10+i', i, undefined, { f: 1, s: 1 })), [10, 11, 12]);
eq('f-1-i 在 5 分支容器里', [0, 1, 2, 3, 4].map(i => ex.evalThreshold('f-1-i', i, undefined, { f: 5, s: 1 })), [4, 3, 2, 1, 0]);
eq('s*i', [0, 1, 2].map(i => ex.evalThreshold('s*i', i, undefined, { f: 1, s: 4 })), [0, 4, 8]);
eq('2f（隐式乘法）', [0, 1].map(i => ex.evalThreshold('2f', i, undefined, { f: 3, s: 1 })), [6, 6]);
eq('fs', [0, 1].map(i => ex.evalThreshold('fs', i, undefined, { f: 3, s: 2 })), [6, 6]);
eq('f 缺省按 1', [0, 1].map(i => ex.evalThreshold('f', i)), [1, 1]);
eq('s 缺省按 1', [0, 1].map(i => ex.evalThreshold('s-i', i)), [1, 0]);
eq('f 与 ni 共存', [0, 1].map(i => ex.evalThreshold('f+n-i', i, 2, { f: 10, s: 1 })), [12, 11]);

// 结构口径：a:{ a1:{b1,b2}, a2:{}, a3:{} }
console.log('\n[f / s 结构口径]');
global.Outliner.root.length = 0;
const fsA = new global.Group({ name: 'a', imda_type: 'composite' });
const fsA1 = new global.Group({ name: 'a1', imda_type: 'composite' });
const fsA2 = new global.Group({ name: 'a2', imda_type: 'composite' });
const fsA3 = new global.Group({ name: 'a3', imda_type: 'composite' });
const fsB1 = new global.Group({ name: 'b1', imda_type: 'composite' });
const fsB2 = new global.Group({ name: 'b2', imda_type: 'composite' });
global.immAddAndInit(fsB1, fsA1); global.immAddAndInit(fsB2, fsA1);
global.immAddAndInit(fsA1, fsA); global.immAddAndInit(fsA2, fsA); global.immAddAndInit(fsA3, fsA);
global.immAddAndInit(fsA, null);
eq('a1 的 f = 3（与 a2/a3 同层）', api.countLayerItems(fsA), 3);
eq('a1 的 s = 2（b1 + b2）', api.countLayerItems(fsA1), 2);
eq('a 的 f = 1（根目录只有 a）', api.countLayerItems({ children: global.Outliner.root }), 1);
eq('a 的 s = 3（a1+a2+a3）', api.countLayerItems(fsA), 3);
eq('thresholdFormatVars(a1)', api.thresholdFormatVars(fsA1), { f: 3, s: 2 });
eq('thresholdFormatVars(a)', api.thresholdFormatVars(fsA), { f: 1, s: 3 });

// 普通定位点不算；复调用标签算 1
const fsLoc = new global.Locator({ name: 'loc' });
global.immAddAndInit(fsLoc, fsA2);
eq('普通定位点不计数', api.countLayerItems(fsA2), 0);
const fsCall = api.newCallTag({ name: 'call', position: [0, 0, 0], rotation: [0, 0, 0] });
global.immAddAndInit(fsCall, fsA2);
eq('复调用标签算 1', api.countLayerItems(fsA2), 1);

// 直属 cube 合并算 1；inline 子分组递归数 cube
const fsCube1 = new global.Cube({ name: 'c1', from: [0, 0, 0], to: [1, 1, 1] });
const fsCube2 = new global.Cube({ name: 'c2', from: [0, 0, 0], to: [1, 1, 1] });
global.immAddAndInit(fsCube1, fsA3); global.immAddAndInit(fsCube2, fsA3);
eq('两个直属 cube 合并算 1', api.countLayerItems(fsA3), 1);
const fsInline = new global.Group({ name: 'inl', imda_type: 'inline' });
const fsInlineCube = new global.Cube({ name: 'ic', from: [0, 0, 0], to: [1, 1, 1] });
global.immAddAndInit(fsInlineCube, fsInline);
global.immAddAndInit(fsInline, fsA3);
eq('inline 子分组递归数 cube（1 个 cube + 1 个合并组）', api.countLayerItems(fsA3), 2);
eq('inline 自身按内部 cube 数', api.countLayerItems(fsInline), 1);

// 导出层：外层 range_dispatch 用 f*10+i（f = 所在层元素数，含自身）
// 注意导出的 entries 会按 threshold 升序重排，所以测试格式特意取单调递增。
console.log('\n[f 导出层]');
global.Outliner.root.length = 0;
const fOuter = new global.Group({ name: 'fOuter', imda_type: 'range_dispatch', imda_property: 'custom_model_data', imda_index: 0, imda_threshold_format: 'f*10+i' });
for (let k = 0; k < 3; k++) global.immAddAndInit(leaf('f' + k, 'ns:f' + k), fOuter);
global.immAddAndInit(fOuter, null);
const mF = api.createExporter().buildMapping();
const fNode = (mF.model.models || []).find(n => n && n.type === 'minecraft:range_dispatch');
ok('找到 fOuter', !!fNode);
eq('根层只有它自己 → f=1', api.thresholdFormatVars(fOuter).f, 1);
eq('f*10+i 生效', fNode && fNode.entries.map(e => e.threshold), [10, 11, 12]);

// 嵌在别的分组里时 f 跟着变：inner 与 sibling 同层 → f = 2 → 20,21,22
global.Outliner.root.length = 0;
const fWrap = new global.Group({ name: 'wrap', imda_type: 'composite' });
const fSibling = new global.Group({ name: 'sibling', imda_type: 'composite' });
const fInner = new global.Group({ name: 'inner', imda_type: 'range_dispatch', imda_property: 'custom_model_data', imda_index: 0, imda_threshold_format: 'f*10+i' });
for (let k = 0; k < 3; k++) global.immAddAndInit(leaf('g' + k, 'ns:g' + k), fInner);
global.immAddAndInit(fInner, fWrap); global.immAddAndInit(fSibling, fWrap);
global.immAddAndInit(fWrap, null);
const mF2 = api.createExporter().buildMapping();
const findInner = () => {
	const out = [];
	const walk = (nodes) => { for (const n of (nodes || [])) { if (!n || typeof n !== 'object') continue; if (n.type === 'minecraft:range_dispatch') out.push(n); for (const k of ['models', 'on_true', 'on_false', 'fallback']) if (n[k]) walk(Array.isArray(n[k]) ? n[k] : [n[k]]); if (n.cases) for (const c of n.cases) walk([c.model]); if (n.entries) for (const e of n.entries) walk([e.model]); } };
	walk(mF2.model.models);
	return out;
};
const innerRd = findInner()[0];
eq('同层有 inner/sibling → f=2', api.thresholdFormatVars(fInner).f, 2);
eq('f*10+i → 20,21,22', innerRd && innerRd.entries.map(e => e.threshold), [20, 21, 22]);

// 子级回退格式也用「子分组自己」的 f / s
console.log('\n[f / s 子级回退]');
global.Outliner.root.length = 0;
const fbWrap = new global.Group({ name: 'fbWrap', imda_type: 'composite' });
const fbChild = new global.Group({ name: 'fbChild', imda_type: 'range_dispatch', imda_property: 'custom_model_data', imda_index: 0, imda_threshold_format: 'f*10+i' });
global.immAddAndInit(leaf('x0', 'ns:x0'), fbChild);
global.immAddAndInit(leaf('x1', 'ns:x1'), fbChild);
global.immAddAndInit(leaf('x2', 'ns:x2'), fbChild);
const fbSibling = new global.Group({ name: 'fbSibling', imda_type: 'composite' });
global.immAddAndInit(fbChild, fbWrap); global.immAddAndInit(fbSibling, fbWrap);
global.immAddAndInit(fbWrap, null);
const mFB = api.createExporter().buildMapping();
const fbNode = (() => { const out = []; const walk = (nodes) => { for (const n of (nodes || [])) { if (!n || typeof n !== 'object') continue; if (n.type === 'minecraft:range_dispatch') out.push(n); for (const k of ['models', 'on_true', 'on_false', 'fallback']) if (n[k]) walk(Array.isArray(n[k]) ? n[k] : [n[k]]); if (n.cases) for (const c of n.cases) walk([c.model]); if (n.entries) for (const e of n.entries) walk([e.model]); } }; walk(mFB.model.models); return out[0]; })();
eq('子级 f=2 → 20,21,22', fbNode && fbNode.entries.map(e => e.threshold), [20, 21, 22]);
eq('子级 s = 3（x0/x1/x2）', api.thresholdFormatVars(fbChild).s, 3);

/* ---------- 复调用标签：引用目标后按当前位置重算编号 ---------- */
console.log('\n[复调用重算编号]');
global.Outliner.root.length = 0;
// 目标 sacpack：格式 (f-n)i，2 个子项（_empty / _full）
const mkPack = (name) => {
	const g = new global.Group({ name, imda_type: 'range_dispatch', imda_property: 'custom_model_data', imda_index: 1, imda_threshold_format: '(f-n)i' });
	global.immAddAndInit(leaf(name + '_empty', 'ns:' + name + 'e'), g);
	global.immAddAndInit(leaf(name + '_full', 'ns:' + name + 'f'), g);
	return g;
};
const pack11 = mkPack('pack11');
const pack32 = mkPack('pack32');
const pack53 = mkPack('pack53');
// mock 的 Group.addTo 不会自动维护 Group.all，这里手动登记（buildCallNode 按 uuid 找目标）
global.Group.all = [pack11, pack32, pack53];
// 一个 composite，里面 3 个复调用标签分别指向 3 个 pack
const callHost = new global.Group({ name: 'callHost', imda_type: 'composite' });
global.immAddAndInit(pack11, null); global.immAddAndInit(pack32, null); global.immAddAndInit(pack53, null);
global.immAddAndInit(callHost, null);
const mkCall = (target, name) => {
	const c = api.newCallTag({ name, position: [0, 0, 0], rotation: [0, 0, 0] });
	global.immAddAndInit(c, callHost);
	c.imda_call_target = target.uuid;
	return c;
};
const c1 = mkCall(pack11, '调用 pack11');
const c2 = mkCall(pack32, '调用 pack32');
const c3 = mkCall(pack53, '调用 pack53');

const mCall = api.createExporter().buildMapping();
const findCalls = (nodes, out) => {
	for (const n of (nodes || [])) {
		if (!n || typeof n !== 'object') continue;
		if (n.type === 'minecraft:range_dispatch' && Array.isArray(n.entries)) out.push(n);
		for (const k of ['models', 'on_true', 'on_false', 'fallback']) if (n[k]) findCalls(Array.isArray(n[k]) ? n[k] : [n[k]], out);
		if (n.cases) for (const c of n.cases) findCalls([c.model], out);
		if (n.entries) for (const e of n.entries) findCalls([e.model], out);
	}
	return out;
};
// pack 目标自身也会被导出成 range_dispatch（node_name = pack11…），排除掉只留复调用克隆
const PACK_NAMES = ['pack11', 'pack32', 'pack53'];
const onlyCalls = (nodes) => nodes.filter(n => PACK_NAMES.indexOf(String(n.node_name || '')) < 0);
const callNodes = onlyCalls(findCalls(mCall.model.models, []));
ok('找到 3 个复调用 range_dispatch', callNodes.length === 3, callNodes.length);
// host 层元素数 f=3；三个标签 n=0/1/2 → (f-n)*i：i=0→0，i=1→(3-n)
eq('调用 1 编号（f=3,n=0）→ [0,3]', callNodes[0] && callNodes[0].entries.map(e => e.threshold), [0, 3]);
eq('调用 2 编号（f=3,n=1）→ [0,2]', callNodes[1] && callNodes[1].entries.map(e => e.threshold), [0, 2]);
eq('调用 3 编号（f=3,n=2）→ [0,1]', callNodes[2] && callNodes[2].entries.map(e => e.threshold), [0, 1]);

// 同一目标被引用两次、位置不同 → 编号也不同
global.Outliner.root.length = 0;
const dupHost = new global.Group({ name: 'dupHost', imda_type: 'composite' });
const dupA = new global.Group({ name: 'dupA', imda_type: 'composite' });
global.immAddAndInit(pack11, null);
global.Group.all = [pack11];
global.immAddAndInit(dupHost, null); global.immAddAndInit(dupA, null);
const dupCall1 = api.newCallTag({ name: 'd1', position: [0, 0, 0], rotation: [0, 0, 0] }); global.immAddAndInit(dupCall1, dupHost); dupCall1.imda_call_target = pack11.uuid;
const dupCall2 = api.newCallTag({ name: 'd2', position: [0, 0, 0], rotation: [0, 0, 0] }); global.immAddAndInit(dupCall2, dupHost); dupCall2.imda_call_target = pack11.uuid;
const mDup = api.createExporter().buildMapping();
const dupNodes = onlyCalls(findCalls(mDup.model.models, []));
ok('同一目标两次引用', dupNodes.length === 2, dupNodes.length);
eq('引用1（f=2,n=0）→ [0,2]', dupNodes[0] && dupNodes[0].entries.map(e => e.threshold), [0, 2]);
eq('引用2（f=2,n=1）→ [0,1]', dupNodes[1] && dupNodes[1].entries.map(e => e.threshold), [0, 1]);

// range_dispatch 里的复调用：n 用它在父级里的 threshold
global.Outliner.root.length = 0;
const rdHost = new global.Group({ name: 'rdHost', imda_type: 'range_dispatch', imda_property: 'custom_model_data', imda_index: 0, imda_threshold_format: 'i' });
global.immAddAndInit(pack11, null);
global.Group.all = [pack11];
const rdCall = api.newCallTag({ name: 'rdCall', position: [0, 0, 0], rotation: [0, 0, 0] }); global.immAddAndInit(rdCall, rdHost); rdCall.imda_call_target = pack11.uuid;
global.immAddAndInit(rdHost, null);
const mRd = api.createExporter().buildMapping();
// rdHost 本身也是 range_dispatch；复调用克隆是它 entries 里的 model。取 2 个 entries 的那个。
const rdAll = findCalls(mRd.model.models, []);
const rdNode = rdAll.find(n => Array.isArray(n.entries) && n.entries.length === 2) || rdAll[0];
// rdHost 层元素数 f=1（根目录只有 rdHost）；n = 该调用在 rdHost 里的 threshold = 0
// (f-n)*i → i=0→0，i=1→1
eq('range 里调用 n=父级 threshold（0）', rdNode && rdNode.entries.map(e => e.threshold), [0, 1]);

if (fail) { console.log('\n\u5931\u8d25 ' + fail + ' \u9879'); process.exit(1); }
console.log('\n\u901a\u8fc7 ' + pass + ' / ' + (pass + fail));