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
eq('ni\uff08n \u7f3a\u7701=0\uff09', [0, 1, 2].map(i => ex.evalThreshold('ni', i)), [0, 0, 0]);
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

if (fail) { console.log('\n\u5931\u8d25 ' + fail + ' \u9879'); process.exit(1); }
console.log('\n\u901a\u8fc7 ' + pass + ' / ' + (pass + fail));
