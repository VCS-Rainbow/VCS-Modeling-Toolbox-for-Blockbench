/* 「将分组转化为复调用标签」重新设计（0.72.0）测试
 *
 * 新语义：选中分组 G → 弹窗指定一个已存在的分组 T → 把 G **原位替换**为指向 T 的调用标签，
 * 只保留 G 自身的位姿（origin + rotation），G 连同几何删除。
 *
 * 这里只测核心纯逻辑 applyConvertGroupsToCallTags / outermostSelectedGroups /
 * collectGroupSubtree / collectAllGroups（Dialog 的交互部分在真机探针里验证）。
 *
 * 用法：node _test_convert.js
 */
const path = require('path');

const PLUGIN = 'C:\\Users\\Rainbow_\\blockbench_item_model_mapping_isolated\\item_model_definition_assembly.js';

/* ---------- mock 环境（与 _test_all_items.js 同一套 Blockbench 运行时底座） ---------- */
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
		if (p && p !== 'root' && Array.isArray(p.children)) {
			this.parent = p;
			if (p.children.indexOf(this) < 0) p.children.push(this);
		} else {
			this.parent = 'root';
			if (global.Outliner.root.indexOf(this) < 0) global.Outliner.root.push(this);
		}
		return this;
	}
	init() {
		global.OutlinerNode = global.OutlinerNode || {};
		global.OutlinerNode.uuids = global.OutlinerNode.uuids || {};
		global.OutlinerNode.uuids[this.uuid] = this;
		if (!this.parent || (this.parent === 'root' && global.Outliner.root.indexOf(this) === -1)) this.addTo('root');
		return this;
	}
	remove() {
		if (this.parent && this.parent !== 'root' && Array.isArray(this.parent.children)) { const i = this.parent.children.indexOf(this); if (i >= 0) this.parent.children.splice(i, 1); }
		const j = global.Outliner.root.indexOf(this); if (j >= 0) global.Outliner.root.splice(j, 1);
		this.parent = null;
		return this;
	}
	getParentArray() { return (this.parent === 'root' || !this.parent) ? global.Outliner.root : this.parent.children; }
	markAsSelected() { this.selected = true; global.Outliner.selected.safePush(this); return this; }
	unselect() { this.selected = false; global.Outliner.selected.remove(this); return this; }
	clickSelect() { }
};
global.OutlinerElement.types = {}; global.OutlinerElement.behavior_overrides = [];
global.OutlinerElement.registerType = function (c, id) { this.types[id] = c; c.prototype.type = id; if (!c.all) c.all = []; if (!c.selected) c.selected = []; };
global.Group = class extends global.OutlinerElement { constructor(o) { super(o); this.children = []; if (!this.uuid) this.uuid = 'grp-' + Math.random(); } }; Group.all = []; Group.multi_selected = [];
global.immAddAndInit = function (node, parent) {
	if (!node) return node;
	if (parent) node.addTo(parent); else node.addTo();
	node.init();
	return node;
};
global.Locator = class extends global.OutlinerElement { constructor(o) { super(o); if (!o || !o.uuid) this.uuid = 'loc-' + Math.random(); Locator.all.safePush(this); } }; Locator.all = [];
Locator.behavior = { unique_name: true, movable: true, rotatable: true };
global.Menu = class { constructor(s) { this.structure = Array.isArray(s) ? s.slice() : []; } addAction(a) { this.structure.push(a); } };
global.MenuSeparator = class { constructor(id) { this.id = id; } };
global.NodePreviewController = class { constructor(t) { t.preview_controller = this; } dispatchEvent() { } };
global.Outliner = { root: [], selected: [], ROOT: 'root', buttons: { visibility: {}, locked: {}, export: {} } };
global.Project = { name: 'convert', imda_pack_version: '26.2', imda_pack_path: '' };
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
const ok = (label, cond, detail) => {
	if (cond) { pass++; console.log('  \u2714 ' + label); }
	else { fail++; console.log('  \u2718 ' + label + (detail === undefined ? '' : ('\n      ' + JSON.stringify(detail)))); }
};
const eq = (label, actual, expected) => ok(label + (JSON.stringify(actual) === JSON.stringify(expected) ? '' : ('  \u2190 \u5b9e\u9645 ' + JSON.stringify(actual))), JSON.stringify(actual) === JSON.stringify(expected));

console.log('\u7248\u672c\uff1a' + api.VERSION);

const newGroup = (name, o) => { const g = new global.Group(Object.assign({ name }, o || {})); return g; };
const attachRoot = (node) => { node.addTo(); node.init(); return node; };

/* ---------- 1) 根级：原位替换，保持兄弟顺序 ---------- */
console.log('\n[\u6839\u7ea7\u539f\u4f4d\u66ff\u6362]');
global.Outliner.root.length = 0;
global.Outliner.selected.length = 0;
global.Group.first_selected = null;
const A = attachRoot(newGroup('A'));
const G = attachRoot(newGroup('G', { origin: [1, 2, 3], rotation: [10, 20, 30] }));
const B = attachRoot(newGroup('B'));
const T = attachRoot(newGroup('T'));
// 还原真实 Blockbench 的隐患：当前选中的分组会被 CallTag.init 当作落脚点
global.Group.first_selected = G;
const r1 = api.applyConvertGroupsToCallTags([G], T);
eq('\u8f6c\u6362 1 \u4e2a', r1.converted, 1);
eq('\u65b0\u5efa 1 \u4e2a\u6807\u7b7e', r1.locators.length, 1);
const loc1 = r1.locators[0];
eq('\u6839\u76ee\u5f55\u987a\u5e8f\uff1aA / \u6807\u7b7e / B / T', global.Outliner.root.map(n => n.name), ['A', '\u8c03\u7528 T', 'B', 'T']);
ok('\u6807\u7b7e\u5c31\u5728\u539f G \u7684\u4f4d\u7f6e', global.Outliner.root.indexOf(loc1) === 1);
ok('\u539f\u5206\u7ec4 G \u5df2\u4ece\u6839\u76ee\u5f55\u5220\u9664', global.Outliner.root.indexOf(G) < 0);
ok('\u6807\u7b7e\u4e0d\u5728\u88ab\u5220\u5206\u7ec4\u91cc', G.children.indexOf(loc1) < 0);
eq('\u6807\u7b7e parent \u4e3a root', loc1.parent, 'root');
eq('\u4f4d\u7f6e\u53d6 G \u81ea\u8eab origin', loc1.position, [1, 2, 3]);
eq('\u65cb\u8f6c\u53d6 G \u81ea\u8eab rotation', loc1.rotation, [10, 20, 30]);
eq('\u76ee\u6807\u6307\u5411 T', loc1.imda_call_target, T.uuid);
ok('\u662f\u590d\u8c03\u7528\u6807\u7b7e\u7c7b\u578b', api.isCallTagType(loc1));
eq('ignore_inherited_scale', loc1.ignore_inherited_scale, true);
ok('position \u662f\u65b0\u6570\u7ec4\u5f15\u7528\uff08\u4e0d\u5171\u4eab G \u7684\uff09', loc1.position !== G.origin);

/* ---------- 2) 嵌套：在父分组内原位替换 ---------- */
console.log('\n[\u5d4c\u5957\u539f\u4f4d\u66ff\u6362]');
global.Outliner.root.length = 0;
global.Group.first_selected = null;
const P = attachRoot(newGroup('P'));
const pa = newGroup('pa'); pa.addTo(P); pa.init();
const pg = newGroup('pg', { origin: [4, 5, 6], rotation: [0, 90, 0] }); pg.addTo(P); pg.init();
const pb = newGroup('pb'); pb.addTo(P); pb.init();
const T2 = attachRoot(newGroup('T2'));
const r2 = api.applyConvertGroupsToCallTags([pg], T2);
eq('\u8f6c\u6362 1 \u4e2a', r2.converted, 1);
eq('P \u5b50\u987a\u5e8f\uff1apa / \u6807\u7b7e / pb', P.children.map(n => n.name), ['pa', '\u8c03\u7528 T2', 'pb']);
ok('\u6807\u7b7e parent \u4e3a P', r2.locators[0].parent === P);
eq('\u4f4d\u7f6e\u53d6 pg origin', r2.locators[0].position, [4, 5, 6]);
eq('\u65cb\u8f6c\u53d6 pg rotation', r2.locators[0].rotation, [0, 90, 0]);
ok('pg \u5df2\u5220\u9664', P.children.indexOf(pg) < 0);

/* ---------- 3) 最外层过滤 + 删除集合 ---------- */
console.log('\n[\u6700\u5916\u5c42\u4e0e\u5220\u9664\u96c6\u5408]');
global.Outliner.root.length = 0;
global.Group.first_selected = null;
const AP = attachRoot(newGroup('AP'));
const CH = newGroup('CH'); CH.addTo(AP); CH.init();
const GR = newGroup('GR'); GR.addTo(CH); GR.init();
eq('outermost\uff08\u7236\u5b50\u90fd\u9009\u4e2d\u65f6\u53ea\u4fdd\u7559\u7236\uff09', api.outermostSelectedGroups([AP, CH, GR]).map(g => g.name), ['AP']);
eq('collectGroupSubtree \u542b\u5168\u90e8\u540e\u4ee3', api.collectGroupSubtree(AP).map(g => g.name).sort(), ['AP', 'CH', 'GR']);
const allG = api.collectAllGroups();
eq('collectAllGroups \u6b63\u786e', allG.map(g => g.name).sort(), ['AP', 'CH', 'GR']);
// 模拟对话框里的候选过滤：删除集合里的分组不能当目标
const willRemove = new Set();
for (const g of api.outermostSelectedGroups([AP, CH])) for (const n of api.collectGroupSubtree(g)) willRemove.add(n);
const OUT = newGroup('OUT'); OUT.addTo(); OUT.init();
const cands = api.collectAllGroups().filter(g => !willRemove.has(g));
eq('\u5019\u9009\u91cc\u4e0d\u542b\u5f85\u5220\u5206\u7ec4\u53ca\u5176\u540e\u4ee3', cands.map(g => g.name).sort(), ['OUT']);

/* ---------- 4) 目标为空时不动手 ---------- */
console.log('\n[\u65e0\u76ee\u6807]');
global.Outliner.root.length = 0;
global.Group.first_selected = null;
const Z = attachRoot(newGroup('Z'));
const r3 = api.applyConvertGroupsToCallTags([Z], null);
eq('\u65e0\u76ee\u6807\u4e0d\u8f6c\u6362', r3.converted, 0);
ok('Z \u4ecd\u5728', global.Outliner.root.indexOf(Z) >= 0);

if (fail) { console.log('\n\u5931\u8d25 ' + fail + ' \u9879'); process.exit(1); }
console.log('\n\u901a\u8fc7 ' + pass + ' / ' + (pass + fail));
