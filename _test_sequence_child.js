/* 生成复调用序列：子节点属性（类型可选 + 分支总控子选项）测试（0.73.6）
 * 对照：node _test_sequence_child.js
 */
const PLUGIN = 'C:\\Users\\Rainbow_\\blockbench_item_model_mapping_isolated\\item_model_definition_assembly.js';

/* ---------- mock 环境（与 _test_threshold_n.js 同一套） ---------- */
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
global.Project = { name: 'seq_child', imda_pack_version: '26.2', imda_pack_path: '' };
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
const b = api.buildSequenceChildResult;

console.log('\n[buildSequenceChildResult]');
eq('默认 composite', b({}), { imda_type: 'composite' });
eq('composite 忽略子字段', b({ childType: 'composite', childProperty: 'compass', childIndex: 5 }), { imda_type: 'composite' });
eq('model 只有 type', b({ childType: 'model' }), { imda_type: 'model' });

const r1 = b({ childType: 'range_dispatch', childProperty: 'custom_model_data', childIndex: 2, childThresholdFormat: 'i', childScale: 1.5 });
eq('range type', r1.imda_type, 'range_dispatch');
eq('range property', r1.imda_property, 'custom_model_data');
eq('range index', r1.imda_index, 2);
eq('range threshold_format', r1.imda_threshold_format, 'i');
eq('range scale', r1.imda_scale, 1.5);

eq('property 去 minecraft: 前缀', b({ childType: 'range_dispatch', childProperty: 'minecraft:cooldown' }).imda_property, 'cooldown');

const r2 = b({ childType: 'range_dispatch', childProperty: 'compass', childRangeTarget: 'spawn', childRangeWobble: false });
eq('compass target', r2.imda_range_target, 'spawn');
eq('compass wobble false', r2.imda_range_wobble, false);
ok('未提供 index 时不写入 imda_index', !('imda_index' in r2));

const r3 = b({ childType: 'range_dispatch', childProperty: 'time', childRangeSource: 'daytime' });
eq('time source', r3.imda_range_source, 'daytime');

const r4 = b({ childType: 'range_dispatch', childProperty: 'count', childRangeNormalize: false });
eq('count normalize false', r4.imda_range_normalize, false);

const r5 = b({ childType: 'range_dispatch', childProperty: 'use_cycle', childRangePeriod: 7 });
eq('use_cycle period', r5.imda_range_period, 7);

const r6 = b({ childType: 'range_dispatch', childProperty: 'use_duration', childRangeRemaining: true });
eq('use_duration remaining', r6.imda_range_remaining, true);

const r7 = b({ childType: 'select', childProperty: 'context_dimension' });
eq('select type', r7.imda_type, 'select');
eq('select property', r7.imda_property, 'context_dimension');
ok('select 不带 scale/index/threshold_format', !('imda_scale' in r7) && !('imda_index' in r7) && !('imda_threshold_format' in r7));

const r8 = b({ childType: 'condition', childProperty: 'selected', nodeType: 'condition', childCondition: 'on_true' });
eq('condition type', r8.imda_type, 'condition');
eq('容器是 condition → 子节点带 on_true', r8.imda_condition, 'on_true');
const r9 = b({ childType: 'condition', childProperty: 'selected', nodeType: 'range_dispatch', childCondition: 'on_true' });
ok('容器非 condition → 子节点不带 imda_condition', !('imda_condition' in r9));

console.log('\n[assignGroupMapProps 应用到分组]');
const g = new global.Group({ name: 'x', imda_type: 'composite' });
api.assignGroupMapProps(g, b({ childType: 'range_dispatch', childProperty: 'custom_model_data', childIndex: 3, childThresholdFormat: '2i', childScale: 2 }));
eq('assign type', g.imda_type, 'range_dispatch');
eq('assign property', g.imda_property, 'custom_model_data');
eq('assign index', g.imda_index, 3);
eq('assign threshold_format', g.imda_threshold_format, '2i');
eq('assign scale', g.imda_scale, 2);

const g2 = new global.Group({ name: 'y', imda_type: 'range_dispatch', imda_property: 'count' });
api.assignGroupMapProps(g2, b({ childType: 'composite' }));
eq('改成 composite 会清掉 property', g2.imda_type, 'composite');
eq('改成 composite 会清掉 property(值)', g2.imda_property, '');

console.log('\n[generateCallSequence \u96c6\u6210]');
const isG = (n) => n instanceof global.Group;
global.Outliner.root.length = 0;
global.Outliner.selected.length = 0;
global.Group.selected = [];
const mkG = (name) => { const gg = new global.Group({ name, imda_type: 'composite', origin: [8, 8, 8], rotation: [0, 0, 0] }); global.immAddAndInit(gg, null); return gg; };
const aA = mkG('a1'), aB = mkG('a2'), aC = mkG('a3');
global.Group.selected = [aA, aB, aC];
api.generateCallSequence({ name: 'seqRD', nodeType: 'range_dispatch', direction: 'decrease', countStep: 1, property: 'custom_model_data', index: 0, thresholdStart: 0, thresholdStep: 1, childType: 'range_dispatch', childProperty: 'custom_model_data', childIndex: 1, childThresholdFormat: 'i', childScale: 2 });
const c1 = global.Outliner.root.find(n => isG(n) && n.name === 'seqRD');
ok('容器已生成', !!c1);
ok('容器类型 range_dispatch', !!c1 && c1.imda_type === 'range_dispatch');
const br1 = (c1 && c1.children || []).filter(isG);
eq('生成 3 个 #分支', br1.length, 3);
ok('全部子节点类型 = range_dispatch', br1.every(n => n.imda_type === 'range_dispatch'));
ok('全部子节点 index = 1', br1.every(n => n.imda_index === 1));
ok('全部子节点 scale = 2', br1.every(n => n.imda_scale === 2));
ok('全部子节点有数字 threshold（父容器赋值）', br1.every(n => typeof n.imda_threshold === 'number'));
ok('分支名带 [阈值] 前缀（大纲格式已更新）', br1.every(n => /^\[/.test(String(n.name))));

// 默认（不传 childType）→ 子节点保持 composite
global.Outliner.root.length = 0;
global.Group.selected = [];
const bA = mkG('b1'), bB = mkG('b2');
global.Group.selected = [bA, bB];
api.generateCallSequence({ name: 'seqCO', nodeType: 'range_dispatch', direction: 'decrease', countStep: 1, property: 'custom_model_data', index: 0, thresholdStart: 0, thresholdStep: 1 });
const c2 = global.Outliner.root.find(n => isG(n) && n.name === 'seqCO');
const br2 = (c2 && c2.children || []).filter(isG);
ok('默认子节点类型 = composite', br2.length > 0 && br2.every(n => n.imda_type === 'composite'));

if (fail) { console.log('\n\u5931\u8d25 ' + fail + ' \u9879'); process.exit(1); }
console.log('\n\u901a\u8fc7 ' + pass + ' / ' + (pass + fail));
