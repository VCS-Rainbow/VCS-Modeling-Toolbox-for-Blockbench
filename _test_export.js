/* 导出校验测试：把 compile() 与 buildFiles() 的结果落盘，再按 Minecraft
 * 物品模型定义（item_model_definition_assembly）的语法逐条校验。
 *
 * 与 _test_sim.js 的区别：那边只断言「内存里的结构对不对」，这边断言
 * 「写出来的文件能不能被游戏吃下去」——格式化器（formatMapping / formatModel）
 * 的自定义拼字符串如果有语法错，只有落盘 + JSON.parse 才能发现。
 *
 * 用法：node _test_export.js [--keep]
 *   --keep  保留临时输出目录，便于人工翻看
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const PLUGIN = 'C:\\Users\\Rainbow_\\blockbench_item_model_mapping_isolated\\item_model_definition_assembly.js';
const OUT = path.join(os.tmpdir(), 'imm_export_check');

/* ---------- mock 环境（与 _test_sim.js 保持同一套最小实现） ---------- */
class Quaternion { constructor() { Object.assign(this, { x: 0, y: 0, z: 0, w: 1 }); } setFromEuler() { return this; } normalize() { return this; } lengthSq() { return 1; } copy() { return this; } }
class Euler { constructor(x = 0, y = 0, z = 0, order = 'XYZ') { Object.assign(this, { x, y, z, order }); } }
class FakeEl {
	constructor(tag) { this.tagName = String(tag).toUpperCase(); this.children = []; this.style = { cssText: '' }; this._text = ''; this.parentElement = null; this.value = undefined; this.checked = false; this.listeners = []; }
	appendChild(c) { c.parentElement = this; this.children.push(c); return c; }
	insertBefore(c, ref) { c.parentElement = this; const at = this.children.indexOf(ref); this.children.splice(at < 0 ? this.children.length : at, 0, c); return c; }
	addEventListener(t, fn) { this.listeners.push({ type: t, fn }); }
	fire(t) { for (const l of this.listeners) if (l.type === t) l.fn({ target: this, preventDefault() { } }); }
	get firstChild() { return this.children[0] || null; }
	get lastElementChild() { return this.children[this.children.length - 1] || null; }
	set textContent(v) { this._text = String(v); this.children = []; }
	get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
	set innerHTML(v) { if (v === '') this.children = []; }
	get innerHTML() { return ''; }
	querySelectorAll() { return []; }
}
global.document = { createElement: (t) => new FakeEl(t) };
global.Panel = class { constructor(id, o) { this.id = id; this.node = new FakeEl('div'); this.options = o || {}; } show() { } delete() { } };
global.THREE = {
	Quaternion, Euler,
	MeshBasicMaterial: class { constructor(o) { Object.assign(this, o || {}); this.color = { v: 0, set() { } }; } dispose() { } },
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
global.Cube = class {
	constructor(o) { Object.assign(this, o); this.faces = this.faces || {}; }
	addTo(p) { if (this.parent && Array.isArray(this.parent.children)) { const i = this.parent.children.indexOf(this); if (i >= 0) this.parent.children.splice(i, 1); } if (p) { this.parent = p; p.children.push(this); } return this; }
	init() { return this; }
	remove() { if (this.parent && Array.isArray(this.parent.children)) { const i = this.parent.children.indexOf(this); if (i >= 0) this.parent.children.splice(i, 1); } const j = global.Outliner.root.indexOf(this); if (j >= 0) global.Outliner.root.splice(j, 1); return this; }
	getParentArray() { return this.parent ? this.parent.children : global.Outliner.root; }
}; Cube.all = [];
global.OutlinerElement = class {
	constructor(o) { Object.assign(this, o || {}); if (!this.uuid) this.uuid = 'el-' + Math.random(); }
	addTo(p) {
		if (this.parent && Array.isArray(this.parent.children)) { const i = this.parent.children.indexOf(this); if (i >= 0) this.parent.children.splice(i, 1); }
		if (p) { this.parent = p; if (p.children.indexOf(this) < 0) p.children.push(this); }
		else if (global.Outliner.root.indexOf(this) < 0) { this.parent = 'root'; global.Outliner.root.push(this); }
		return this;
	}
	init() { return this; }
	remove() {
		if (this.parent && Array.isArray(this.parent.children)) { const i = this.parent.children.indexOf(this); if (i >= 0) this.parent.children.splice(i, 1); }
		const j = global.Outliner.root.indexOf(this); if (j >= 0) global.Outliner.root.splice(j, 1);
		return this;
	}
	getParentArray() { return (this.parent === 'root' || !this.parent) ? global.Outliner.root : this.parent.children; }
	markAsSelected() { this.selected = true; global.Outliner.selected.safePush(this); return this; }
	unselect() { this.selected = false; global.Outliner.selected.remove(this); return this; }
	clickSelect() { }
};
global.OutlinerElement.types = {};
global.OutlinerElement.behavior_overrides = [];
global.OutlinerElement.registerType = function (ctor, id) { this.types[id] = ctor; ctor.prototype.type = id; if (!ctor.all) ctor.all = []; if (!ctor.selected) ctor.selected = []; };
global.Group = class extends global.OutlinerElement {
	constructor(o) { super(o); this.children = []; if (!this.uuid) this.uuid = 'grp-' + Math.random(); }
}; Group.all = []; Group.multi_selected = [];
global.Locator = class extends global.OutlinerElement { constructor(o) { super(o); if (!o || !o.uuid) this.uuid = 'loc-' + Math.random(); Locator.all.safePush(this); } }; Locator.all = [];
Locator.behavior = { unique_name: true, movable: true, rotatable: true };
global.Menu = class { constructor(s) { this.structure = Array.isArray(s) ? s.slice() : []; } addAction(a) { this.structure.push(a); } };
global.MenuSeparator = class { constructor(id) { this.id = id; } };
global.NodePreviewController = class { constructor(type) { type.preview_controller = this; } dispatchEvent() { } };
global.Outliner = { root: [], selected: [], ROOT: 'root', buttons: { visibility: {}, locked: {}, export: {} } };
global.Project = { name: 'export_check', imda_pack_version: '26.2' };
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
global.Blockbench = { showQuickMessage() { }, showMessageBox() { }, on() { }, writeFile() { }, pickDirectory() { return null; } };
global.Undo = { initEdit() { }, finishEdit() { }, history: [], index: 0 };
global.__IMM_TEST__ = {};

require(PLUGIN);
plugin_options.onload();
const api = global.__IMM_TEST__.api;

/* ---------- 断言 ---------- */
let pass = 0, fail = 0;
const ok = (label, cond, detail) => {
	if (cond) { pass++; console.log('  ✔ ' + label); }
	else { fail++; console.log('  ✘ ' + label + (detail === undefined ? '' : ('\n      ' + JSON.stringify(detail)))); }
};

/* ---------- 构建一个覆盖全部节点类型的工程 ---------- */
function cube(name, from, to, origin, rotation, tex) {
	const c = new global.Cube({ name, from, to, origin, rotation: rotation || [0, 0, 0], autouv: 0 });
	c.faces = {};
	for (const dir of ['north', 'east', 'south', 'west', 'up', 'down']) {
		c.faces[dir] = { uv: [0, 0, 16, 16], texture: tex, rotation: 0, tint: 0, getTexture() { return null; } };
	}
	return c;
}

const tex = new global.Texture({ uuid: 'tex-main', name: 'gun', uv_width: 64, uv_height: 64, source: 'data:image/png;base64,iVBORw0KGgo=' });
global.Texture.all.push(tex);
global.Project.imda_namespace = 'sqsp:item/test';
global.Project.model_identifier = 'export_check';

// 根：composite，内含 cube + 子分组
const rootGroup = new global.Group({ name: 'rig', imda_type: 'composite', origin: [8, 8, 8], rotation: [0, 0, 0] });
const rigCube = cube('body', [0, 0, 0], [4, 4, 4], [2, 2, 2], [0, 0, 0], 'tex-main');
rigCube.addTo(rootGroup);

// 1) 旋转分组 → 需要 transformation
const rotGroup = new global.Group({ name: 'rotated', imda_type: 'composite', origin: [8, 8, 8], rotation: [15, 25, 35] });
rotGroup.addTo(rootGroup);
cube('rot_part', [0, 0, 0], [2, 2, 2], [1, 3, 1], [0, 0, 20], 'tex-main').addTo(rotGroup);

// 2) model 引用
const modelGroup = new global.Group({ name: 'ref', imda_type: 'model', imda_model: 'minecraft:item/apple', origin: [8, 8, 8], rotation: [0, 0, 0], imda_tint_type: 'custom_model_data', imda_tint_index: '2' });
modelGroup.addTo(rootGroup);

// 3) range_dispatch
const rd = new global.Group({ name: 'slots', imda_type: 'range_dispatch', imda_property: 'custom_model_data', imda_index: 0, imda_threshold_format: '5-i', origin: [8, 8, 8], rotation: [0, 0, 0] });
rd.addTo(rootGroup);
for (let k = 5; k >= 1; k--) {
	const b = new global.Group({ name: 'slot' + k, imda_type: 'model', imda_model: 'minecraft:item/stick', origin: [8, 8, 8], rotation: [0, 0, 0] });
	b.addTo(rd);
}

// 4) select
const sel = new global.Group({ name: 'kinds', imda_type: 'select', imda_property: 'custom_model_data', origin: [8, 8, 8], rotation: [0, 0, 0] });
sel.addTo(rootGroup);
const caseA = new global.Group({ name: 'case_a', imda_type: 'model', imda_model: 'minecraft:item/apple', imda_case_when: '"a"', origin: [8, 8, 8], rotation: [0, 0, 0] });
caseA.addTo(sel);
const caseB = new global.Group({ name: 'case_b', imda_type: 'model', imda_model: 'minecraft:item/bread', imda_case_when: '1,2', origin: [8, 8, 8], rotation: [0, 0, 0] });
caseB.addTo(sel);

// 5) condition
const cond = new global.Group({ name: 'when_selected', imda_type: 'condition', imda_property: 'selected', origin: [8, 8, 8], rotation: [0, 0, 0] });
cond.addTo(rootGroup);
new global.Group({ name: 'on_true', imda_type: 'model', imda_model: 'minecraft:item/apple', origin: [8, 8, 8], rotation: [0, 0, 0] }).addTo(cond);
new global.Group({ name: 'on_false', imda_type: 'model', imda_model: 'minecraft:item/stick', origin: [8, 8, 8], rotation: [0, 0, 0] }).addTo(cond);

// 6) empty
const emptyGroup = new global.Group({ name: 'nothing', imda_type: 'empty', origin: [8, 8, 8], rotation: [0, 0, 0] });
emptyGroup.addTo(rootGroup);

// 7) 复调用标签
const targetGroup = new global.Group({ name: 'bullet', imda_type: 'model', imda_model: 'minecraft:item/gold_nugget', origin: [8, 8, 8], rotation: [0, 0, 0] });
targetGroup.addTo(rootGroup);
const tag = api.newCallTag({ name: '调用 bullet', position: [8, 8, 8], rotation: [0, 0, 0], target: targetGroup.uuid });
tag.addTo(rootGroup);

global.Outliner.root.length = 0;
global.Outliner.root.push(rootGroup);
global.Group.all = [rootGroup, rotGroup, modelGroup, rd, sel, cond, emptyGroup, targetGroup]
	.concat(rd.children || []).concat(sel.children || []).concat(cond.children || []);

console.log('版本：' + api.VERSION);

/* ---------- 1) 映射文件：写到磁盘再解析 ---------- */
console.log('\n[映射文件（items/*.json）]');
const exporter = api.createExporter();
let files = [];
try { files = exporter.buildFiles().files; } catch (e) { ok('buildFiles 不抛错', false, String(e && e.message)); }
ok('buildFiles 不抛错', files.length > 0, files.length);

if (fs.existsSync(OUT)) fs.rmSync(OUT, { recursive: true, force: true });
for (const f of files) {
	const target = path.join(OUT, f.path);
	fs.mkdirSync(path.dirname(target), { recursive: true });
	if (f.base64) fs.writeFileSync(target, Buffer.from(f.data, 'base64'));
	else fs.writeFileSync(target, String(f.data), 'utf8');
}
ok('文件已落盘', fs.existsSync(OUT), OUT);

const jsonFiles = files.filter(f => !f.base64 && /\.json$/.test(f.path));
const mappingFile = files.find(f => /\/items\/.*\.json$/.test(f.path));
const modelFiles = files.filter(f => /\/models\/item\/.*\.json$/.test(f.path));
ok('存在 items 映射文件', !!mappingFile);
ok('存在 models 物品模型文件', modelFiles.length > 0, modelFiles.length);
ok('映射文件路径符合 assets/<ns>/items/<id>.json', !!mappingFile && /^assets\/[a-z0-9_]+\/items\/([a-z0-9_\-]+\/)*[a-z0-9_\-]+\.json$/.test(mappingFile.path), mappingFile && mappingFile.path);

// 每个 JSON 都必须能被 JSON.parse —— 这是格式化器最大的风险点
let badJson = [];
for (const f of jsonFiles) {
	try { JSON.parse(String(f.data)); } catch (e) { badJson.push({ path: f.path, error: e.message }); }
}
ok('所有 JSON 文件语法合法（JSON.parse 通过）', badJson.length === 0, badJson);

/* ---------- 2) 映射文件的语法校验 ---------- */
console.log('\n[映射文件语法]');
const mapping = mappingFile ? JSON.parse(String(mappingFile.data)) : null;
ok('顶层有 model 字段', !!(mapping && mapping.model));
ok('顶层没有多余字段', !!mapping && Object.keys(mapping).every(k => ['model', 'oversized_in_gui', 'hand_animation_on_swap', 'swap_animation_scale'].indexOf(k) >= 0), mapping && Object.keys(mapping));

// 递归校验定义节点
const DEF_TYPES = ['minecraft:empty', 'minecraft:model', 'minecraft:composite', 'minecraft:range_dispatch', 'minecraft:select', 'minecraft:condition'];
const problems = [];
const refOk = (ref) => typeof ref === 'string' && /^[a-z0-9_.\-]+:[a-z0-9_./\-]+$/.test(ref);
const vecOk = (v, n) => Array.isArray(v) && v.length === n && v.every(x => typeof x === 'number' && isFinite(x));
// transformation 是**所有** items model 类型共有的顶层字段（原版文档明确写了 composite /
// condition / select / range_dispatch 会与子项组合），只有 empty 和 bundle/selected_item 不支持。
const COMMON = ['type', 'transformation'];
// node_name 是用户要求的字段：导出带来源分组名，方便人工复核 JSON 时对上是哪个分组。
// 原版解码器忽略未知字段，不影响加载，所以校验时单独放行并只统计数量。
const NONSTANDARD = ['node_name'];
const nonstandardSeen = [];
const walkDef = (node, at) => {
	if (!node || typeof node !== 'object') { problems.push(at + ' 不是对象'); return; }
	if (DEF_TYPES.indexOf(node.type) < 0) { problems.push(at + ' 类型非法：' + node.type); return; }
	const allowed = COMMON.concat({
		'minecraft:empty': [],
		'minecraft:model': ['model', 'tints'],
		'minecraft:composite': ['models'],
		'minecraft:range_dispatch': ['property', 'index', 'scale', 'entries', 'target', 'wobble', 'normalize', 'source', 'period', 'remaining'],
		'minecraft:select': ['property', 'index', 'component', 'cases', 'fallback'],
		'minecraft:condition': ['property', 'component', 'ignore_default', 'predicate', 'value', 'keybind', 'on_true', 'on_false'],
	}[node.type] || []);
	for (const key of Object.keys(node)) {
		if (NONSTANDARD.indexOf(key) >= 0) { nonstandardSeen.push(key); continue; }
		if (allowed.indexOf(key) < 0) problems.push(at + ' 出现不该有的字段：' + key);
	}
	if (node.transformation) {
		const t = node.transformation;
		if (!vecOk(t.translation, 3) || !vecOk(t.left_rotation, 4) || !vecOk(t.scale, 3) || !vecOk(t.right_rotation, 4)) {
			problems.push(at + ' transformation 分量非法');
		}
	}
	if (node.type === 'minecraft:empty' && node.transformation) problems.push(at + ' empty 不支持 transformation');
	if (node.type === 'minecraft:model') {
		if (!refOk(node.model)) problems.push(at + ' model 引用格式非法：' + JSON.stringify(node.model));
		if (node.tints && !Array.isArray(node.tints)) problems.push(at + ' tints 不是数组');
	}
	if (node.type === 'minecraft:composite') {
		if (!Array.isArray(node.models) || !node.models.length) problems.push(at + ' composite 的 models 为空');
		else node.models.forEach((c, i) => walkDef(c, at + '.models[' + i + ']'));
	}
	if (node.type === 'minecraft:range_dispatch') {
		if (typeof node.property !== 'string' || !node.property.startsWith('minecraft:')) problems.push(at + ' property 缺少 minecraft: 前缀：' + node.property);
		if (!Array.isArray(node.entries) || !node.entries.length) problems.push(at + ' entries 为空');
		else {
			node.entries.forEach((e, i) => {
				if (typeof e.threshold !== 'number' || !isFinite(e.threshold)) problems.push(at + '.entries[' + i + '] threshold 不是数字：' + JSON.stringify(e.threshold));
				if (!e.model) problems.push(at + '.entries[' + i + '] 缺少 model');
				else walkDef(e.model, at + '.entries[' + i + ']');
			});
			// 阈值必须严格递增（原版按顺序匹配，乱序会导致分支永远选不中）
			for (let i = 1; i < node.entries.length; i++) {
				if (node.entries[i].threshold <= node.entries[i - 1].threshold) problems.push(at + ' 阈值没有严格递增：' + node.entries.map(e => e.threshold).join(','));
			}
		}
	}
	if (node.type === 'minecraft:select') {
		if (typeof node.property !== 'string' || !node.property.startsWith('minecraft:')) problems.push(at + ' property 缺少前缀');
		if (!Array.isArray(node.cases) || !node.cases.length) problems.push(at + ' cases 为空');
		else node.cases.forEach((c, i) => {
			if (!Array.isArray(c.when) || !c.when.length) problems.push(at + '.cases[' + i + '] when 不是数组');
			if (!c.model) problems.push(at + '.cases[' + i + '] 缺少 model');
			else walkDef(c.model, at + '.cases[' + i + ']');
		});
	}
	if (node.type === 'minecraft:condition') {
		if (typeof node.property !== 'string' || !node.property.startsWith('minecraft:')) problems.push(at + ' property 缺少前缀');
		for (const side of ['on_true', 'on_false']) {
			if (!node[side]) problems.push(at + ' 缺少 ' + side);
			else walkDef(node[side], at + '.' + side);
		}
	}
};
if (mapping && mapping.model) walkDef(mapping.model, 'model');
ok('定义树全部合法（类型/字段/引用/阈值顺序）', problems.length === 0, problems.slice(0, 8));
// node_name 是用户要求的调试字段（方便人工复核导出结果），不算问题，只报数量
console.log('  · node_name（人工复核用，按设计保留）出现 ' + nonstandardSeen.length + ' 次');

// 占位字段绝不能漏到文件里
const mappingText = mappingFile ? String(mappingFile.data) : '';
ok('不含内部占位字段 __imda_call_group', mappingText.indexOf('__imda_call_group') < 0);
ok('不含内部占位字段 __imda_call_pose', mappingText.indexOf('__imda_call_pose') < 0);

// transformation 结构
console.log('\n[transformation]');
const transformations = [];
(function collect(node) {
	if (!node || typeof node !== 'object') return;
	if (node.transformation) transformations.push(node.transformation);
	if (Array.isArray(node.models)) node.models.forEach(collect);
	if (Array.isArray(node.entries)) node.entries.forEach(e => e && collect(e.model));
	if (Array.isArray(node.cases)) node.cases.forEach(c => c && collect(c.model));
	for (const k of ['on_true', 'on_false', 'fallback']) if (node[k]) collect(node[k]);
})(mapping && mapping.model);
ok('旋转分组产出了 transformation', transformations.length > 0, transformations.length);
const badTrans = transformations.filter(t =>
	!vecOk(t.translation, 3) || !vecOk(t.left_rotation, 4) || !vecOk(t.scale, 3) || !vecOk(t.right_rotation, 4));
ok('transformation 四个分量齐全且为数字', badTrans.length === 0, badTrans.slice(0, 2));
const badQuat = transformations.filter(t => Math.abs(Math.hypot(t.left_rotation[0], t.left_rotation[1], t.left_rotation[2], t.left_rotation[3]) - 1) > 1e-3);
ok('left_rotation 是单位四元数', badQuat.length === 0, badQuat.slice(0, 2));
const badScale = transformations.filter(t => t.scale.some(v => v === 0));
ok('scale 无 0（原版会当作退化矩阵）', badScale.length === 0, badScale.slice(0, 2));

/* ---------- 3) 物品模型文件（models/item/*.json） ---------- */
console.log('\n[物品模型文件]');
ok('至少生成 1 个模型文件', modelFiles.length > 0, modelFiles.length);
const modelProblems = [];
for (const f of modelFiles) {
	let data = null;
	try { data = JSON.parse(String(f.data)); } catch (e) { modelProblems.push(f.path + ' 语法错误：' + e.message); continue; }
	if (data.textures === undefined) modelProblems.push(f.path + ' 缺少 textures');
	if (data.elements !== undefined && !Array.isArray(data.elements)) modelProblems.push(f.path + ' elements 不是数组');
	for (const el of (data.elements || [])) {
		if (!Array.isArray(el.from) || el.from.length !== 3) modelProblems.push(f.path + ' 元素缺少 from');
		if (!Array.isArray(el.to) || el.to.length !== 3) modelProblems.push(f.path + ' 元素缺少 to');
		if (!el.faces || typeof el.faces !== 'object') modelProblems.push(f.path + ' 元素缺少 faces');
	}
	if (data.display) {
		for (const slot of Object.keys(data.display)) {
			const d = data.display[slot];
			if (d.rotation && !vecOk(d.rotation, 3)) modelProblems.push(f.path + ' display.' + slot + ' rotation 非法');
			if (d.translation && !vecOk(d.translation, 3)) modelProblems.push(f.path + ' display.' + slot + ' translation 非法');
			if (d.scale && !vecOk(d.scale, 3)) modelProblems.push(f.path + ' display.' + slot + ' scale 非法');
		}
	}
}
ok('模型文件结构合法', modelProblems.length === 0, modelProblems.slice(0, 6));

const modelTextures = [];
for (const f of modelFiles) {
	const data = JSON.parse(String(f.data));
	for (const k of Object.keys(data.textures || {})) modelTextures.push({ path: f.path, key: k, ref: data.textures[k] });
}
// 纹理引用是 ns:path，path 相对 assets/<ns>/textures/（原版不要求 item/ 前缀，
// 例如 "sqsp:gun" 指向 assets/sqsp/textures/gun.png，是合法的）
const badTexRef = modelTextures.filter(t => typeof t.ref !== 'string' || !/^[a-z0-9_.\-]+:[a-z0-9_./\-]+$/.test(t.ref));
ok('纹理引用格式合法（命名空间:路径）', badTexRef.length === 0, badTexRef.slice(0, 3));

// 关键闭环：模型里引用的每个纹理，都必须真的有对应文件被导出（或来自外部资源包）
const exportedTexPaths = new Set(files.filter(f => /\/textures\/.*\.png$/.test(f.path))
	.map(f => f.path.replace(/^assets\/([^/]+)\/textures\/(.+)\.png$/, '$1:$2')));
const missingTex = modelTextures.map(t => t.ref).filter(ref => !exportedTexPaths.has(ref));
ok('模型引用的纹理都有对应文件（或外部资源包提供）', missingTex.length === 0, { missing: missingTex.slice(0, 4), exported: [...exportedTexPaths].slice(0, 4) });

/* ---------- 4) 文件命名规范 ---------- */
console.log('\n[命名规范]');
const badNames = files.filter(f => {
	const segments = f.path.split('/');
	return segments.some(s => s.length && !/^[a-z0-9_.\-]+$/.test(s));
});
ok('所有路径只含小写/数字/下划线/连字符/点', badNames.length === 0, badNames.map(f => f.path).slice(0, 4));
const dupPaths = files.map(f => f.path).filter((p, i, a) => a.indexOf(p) !== i);
ok('没有重复路径', dupPaths.length === 0, dupPaths);

/* ---------- 5) 覆盖率自检：每类节点都真的出现在输出里 ---------- */
console.log('\n[节点类型覆盖]');
(function types() {
	const seen = new Set();
	(function collect(node) {
		if (!node || typeof node !== 'object') return;
		if (node.type) seen.add(node.type);
		if (Array.isArray(node.models)) node.models.forEach(collect);
		if (Array.isArray(node.entries)) node.entries.forEach(e => e && collect(e.model));
		if (Array.isArray(node.cases)) node.cases.forEach(c => c && collect(c.model));
		for (const k of ['on_true', 'on_false', 'fallback']) if (node[k]) collect(node[k]);
	})(mapping && mapping.model);
	for (const t of ['minecraft:composite', 'minecraft:model', 'minecraft:range_dispatch', 'minecraft:select', 'minecraft:condition']) {
		ok('输出含 ' + t, seen.has(t));
	}
})();

/* ---------- 汇总 ---------- */
console.log('\n输出目录：' + OUT + (process.argv.includes('--keep') ? '（保留）' : ''));

/* ---------- 6) 真实工程回归（assembly.bbmodel 备份，若存在） ---------- */
const backups = 'C:\\Users\\Rainbow_\\AppData\\Roaming\\Blockbench\\backups';
if (fs.existsSync(backups)) {
	const candidates = fs.readdirSync(backups).filter(f => /assembly.*\.bbmodel$/.test(f)).sort();
	if (candidates.length) {
		console.log('\n[真实工程回归]');
		const latest = candidates[candidates.length - 1];
		console.log('  使用备份：' + latest);
		let data = null;
		try {
			const { decompressFile } = require(path.join(__dirname, '_unlz.js'));
			data = JSON.parse(decompressFile(path.join(backups, latest)));
		} catch (e) { console.log('  · 跳过（解压失败：' + e.message + '）'); }
		if (data) {
			// 只做“读出来 + 导出 + 校验”，不写回任何文件
			const savedRoot = global.Outliner.root.slice();
			const savedAll = global.Group.all.slice();
			try {
				const groupByUuid = new Map();
				(global.Outliner.root.length = 0);
				global.Group.all = [];
				const build = (rec) => {
					const g = new global.Group({
						name: rec.name, uuid: rec.uuid, imda_type: rec.imda_type, imda_model: rec.imda_model,
						imda_property: rec.imda_property, imda_index: rec.imda_index, imda_threshold: rec.imda_threshold,
						imda_threshold_format: rec.imda_threshold_format, imda_threshold_force: rec.imda_threshold_force,
						imda_tint_type: rec.imda_tint_type, imda_tint_index: rec.imda_tint_index,
						origin: rec.origin || [8, 8, 8], rotation: rec.rotation || [0, 0, 0],
					});
					g.export = rec.export !== false;
					groupByUuid.set(rec.uuid, g);
					global.Group.all.push(g);
					for (const child of (rec.children || [])) {
						if (typeof child === 'string') {
							const cube = cube('c', [0, 0, 0], [2, 2, 2], [1, 1, 1], [0, 0, 0], 'tex-main');
							cube.uuid = child;
							cube.addTo(g);
						}
					}
					for (const child of (rec.children || [])) {
						if (child && typeof child === 'object' && child.children) build(child).addTo(g);
					}
					return g;
				};
				// outliner 是嵌套结构；groups 里是同名记录，取 outliner 为准
				const walkOut = (list, parent) => {
					for (const item of (list || [])) {
						if (!item || typeof item !== 'object') continue;
						const rec = (data.groups || []).find(g => g.uuid === item.uuid);
						if (rec) {
							const g = build(Object.assign({}, rec, { children: [] }));
							if (parent) g.addTo(parent); else g.addTo();
							walkOut(item.children, g);
						}
					}
				};
				walkOut(data.outliner, null);
				global.Project.imda_namespace = data.imda_namespace || 'custom';
				global.Project.model_identifier = data.model_identifier || 'assembly';

				const realFiles = api.createExporter().buildFiles().files;
				const realJson = realFiles.filter(f => !f.base64 && /\.json$/.test(f.path));
				const badReal = [];
				for (const f of realJson) { try { JSON.parse(String(f.data)); } catch (e) { badReal.push(f.path + ': ' + e.message); } }
				ok('真实工程：所有 JSON 合法', badReal.length === 0, badReal.slice(0, 3));

				const realItems = realFiles.find(f => /\/items\/.*\.json$/.test(f.path));
				let realMapping = null;
				try { realMapping = realItems ? JSON.parse(String(realItems.data)) : null; } catch (e) { realMapping = null; }
				ok('真实工程：items 文件可解析', !!realMapping);

				// 复用同一套定义树校验
				const realProblems = [];
				const realNonstandard = [];
				const vec = (v, n) => Array.isArray(v) && v.length === n && v.every(x => typeof x === 'number' && isFinite(x));
				const walkReal = (node, at) => {
					if (!node || typeof node !== 'object') { realProblems.push(at + ' 不是对象'); return; }
					if (DEF_TYPES.indexOf(node.type) < 0) { realProblems.push(at + ' 类型非法：' + node.type); return; }
					const allowed = COMMON.concat({
						'minecraft:empty': [],
						'minecraft:model': ['model', 'tints'],
						'minecraft:composite': ['models'],
						'minecraft:range_dispatch': ['property', 'index', 'scale', 'entries', 'target', 'wobble', 'normalize', 'source', 'period', 'remaining'],
						'minecraft:select': ['property', 'index', 'component', 'cases', 'fallback'],
						'minecraft:condition': ['property', 'component', 'ignore_default', 'predicate', 'value', 'keybind', 'on_true', 'on_false'],
					}[node.type] || []);
					for (const key of Object.keys(node)) {
						if (NONSTANDARD.indexOf(key) >= 0) { realNonstandard.push(key); continue; }
						if (allowed.indexOf(key) < 0) realProblems.push(at + ' 多余字段：' + key);
					}
					if (node.transformation && (!vec(node.transformation.translation, 3) || !vec(node.transformation.left_rotation, 4) || !vec(node.transformation.scale, 3) || !vec(node.transformation.right_rotation, 4))) {
						realProblems.push(at + ' transformation 非法');
					}
					if (node.type === 'minecraft:model' && !refOk(node.model)) realProblems.push(at + ' model 引用非法：' + JSON.stringify(node.model));
					if (node.type === 'minecraft:range_dispatch') {
						if (typeof node.property !== 'string' || node.property.indexOf('minecraft:') !== 0) realProblems.push(at + ' property 缺前缀：' + node.property);
						const list = node.entries || [];
						if (!list.length) realProblems.push(at + ' entries 为空');
						for (let i = 1; i < list.length; i++) if (list[i].threshold <= list[i - 1].threshold) realProblems.push(at + ' 阈值未升序：' + list.map(e => e.threshold).join(','));
						list.forEach((e, i) => walkReal(e.model, at + '.entries[' + i + ']'));
					}
					if (node.type === 'minecraft:composite') (node.models || []).forEach((c, i) => walkReal(c, at + '.models[' + i + ']'));
					if (node.type === 'minecraft:select') (node.cases || []).forEach((c, i) => walkReal(c.model, at + '.cases[' + i + ']'));
					if (node.type === 'minecraft:condition') for (const side of ['on_true', 'on_false']) if (node[side]) walkReal(node[side], at + '.' + side);
				};
				if (realMapping && realMapping.model) walkReal(realMapping.model, 'model');
				ok('真实工程：定义树合法', realProblems.length === 0, realProblems.slice(0, 6));
				console.log('  · 真实工程 node_name（人工复核用）' + realNonstandard.length + ' 次；文件总数 ' + realFiles.length);
			} finally {
				global.Outliner.root.length = 0;
				savedRoot.forEach(n => global.Outliner.root.push(n));
				global.Group.all = savedAll;
			}
		}
	}
}

if (!process.argv.includes('--keep') && fs.existsSync(OUT)) fs.rmSync(OUT, { recursive: true, force: true });
console.log('\n通过 ' + pass + ' / ' + (pass + fail));
if (fail) process.exit(1);
