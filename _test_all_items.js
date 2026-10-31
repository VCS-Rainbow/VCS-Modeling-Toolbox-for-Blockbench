/* 全物品模型表（scanPackEntries / buildAllItemsTree / select when 导出）测试
 *
 * 这个功能只跑文件系统，不需要 Blockbench 运行时。测试里用一棵**真实的临时目录树**
 * 当资源包（而不是 mock fs），这样才能真的验证递归扫描、黑名单正则、映射优先。
 *
 * 用法：node _test_all_items.js [--keep]
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const PLUGIN = 'C:\\Users\\Rainbow_\\blockbench_item_model_mapping_isolated\\item_model_definition_assembly.js';
const PACK = path.join(os.tmpdir(), 'imm_pack_allitems');

/* ---------- 造一棵资源包目录树 ---------- */
function buildPack() {
	if (fs.existsSync(PACK)) fs.rmSync(PACK, { recursive: true, force: true });
	const write = (rel, data) => {
		const abs = path.join(PACK, rel);
		fs.mkdirSync(path.dirname(abs), { recursive: true });
		fs.writeFileSync(abs, typeof data === 'string' ? data : JSON.stringify(data, null, 2), 'utf8');
	};
	write('pack.mcmeta', { pack: { pack_format: 88 } });
	const model = (tex) => ({ textures: tex, elements: [] });
	// 只有模型
	write('assets/sqsp/models/inker/jet_rifle/gun.json', model({ 0: 'sqsp:inker/jet_rifle/gun' }));
	write('assets/sqsp/models/inker/jet_rifle/scope.json', model({ 0: 'sqsp:inker/jet_rifle/scope' }));
	// 只有映射
	write('assets/sqsp/items/inker/jet_rifle/bullet.json', { model: { type: 'minecraft:model', model: 'sqsp:inker/jet_rifle/gun' } });
	// 同路径既是模型又是映射 → 映射优先
	write('assets/sqsp/models/inker/jet_rifle/dual.json', model({ 0: 'sqsp:inker/jet_rifle/dual' }));
	write('assets/sqsp/items/inker/jet_rifle/dual.json', { model: { type: 'minecraft:model', model: 'sqsp:inker/jet_rifle/dual' } });
	// 另一个命名空间
	write('assets/other/models/tool/wrench.json', model({ 0: 'other:tool/wrench' }));
	// 黑名单要剔除的
	write('assets/sqsp/models/item/debug/probe.json', model({ 0: 'sqsp:item/debug/probe' }));
	write('assets/sqsp/models/_old/legacy.json', model({ 0: 'sqsp:_old/legacy' }));
	// 非 json 文件不应被扫进来
	write('assets/sqsp/models/inker/jet_rifle/gun.png', 'binary');
	// 带空格的文件名（资源包里很常见）—— 必须能正常解析
	write('assets/sqsp/models/inker/jet_rifle/gun copy.json', model({ 0: 'sqsp:inker/jet_rifle/gun' }));
	write('assets/sqsp/items/inker/jet_rifle/copy test.json', { model: { type: 'minecraft:model', model: 'sqsp:inker/jet_rifle/gun' } });
	// 没有 model 字段的"假映射"（整份模型内容塞在 items/ 里）—— 必须被跳过，不能导出非法引用
	write('assets/sqsp/items/inker/jet_rifle/broken.json', { textures: {}, elements: [] });
}
buildPack();

/* ---------- mock 环境 ---------- */
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
	constructor(o) { Object.assign(this, o || {}); if (!this.uuid) this.uuid = 'el-' + Math.random(); }
	addTo(p) { if (p) { this.parent = p; if (p.children.indexOf(this) < 0) p.children.push(this); } else if (global.Outliner.root.indexOf(this) < 0) { this.parent = 'root'; global.Outliner.root.push(this); } return this; }
	init() { return this; }
	remove() { if (this.parent && this.parent.children) { const i = this.parent.children.indexOf(this); if (i >= 0) this.parent.children.splice(i, 1); } const j = global.Outliner.root.indexOf(this); if (j >= 0) global.Outliner.root.splice(j, 1); return this; }
	getParentArray() { return this.parent && this.parent.children ? this.parent.children : global.Outliner.root; }
	markAsSelected() { this.selected = true; global.Outliner.selected.safePush(this); return this; }
	unselect() { this.selected = false; global.Outliner.selected.remove(this); return this; }
	clickSelect() { }
};
global.OutlinerElement.types = {}; global.OutlinerElement.behavior_overrides = [];
global.OutlinerElement.registerType = function (c, id) { this.types[id] = c; c.prototype.type = id; if (!c.all) c.all = []; if (!c.selected) c.selected = []; };
global.Group = class extends global.OutlinerElement { constructor(o) { super(o); this.children = []; if (!this.uuid) this.uuid = 'grp-' + Math.random(); } }; Group.all = []; Group.multi_selected = [];
global.Locator = class extends global.OutlinerElement { constructor(o) { super(o); if (!o || !o.uuid) this.uuid = 'loc-' + Math.random(); Locator.all.safePush(this); } }; Locator.all = [];
Locator.behavior = { unique_name: true, movable: true, rotatable: true };
global.Menu = class { constructor(s) { this.structure = Array.isArray(s) ? s.slice() : []; } addAction(a) { this.structure.push(a); } };
global.MenuSeparator = class { constructor(id) { this.id = id; } };
global.NodePreviewController = class { constructor(t) { t.preview_controller = this; } dispatchEvent() { } };
global.Outliner = { root: [], selected: [], ROOT: 'root', buttons: { visibility: {}, locked: {}, export: {} } };
global.Project = { name: 'allitems', imda_pack_version: '26.2', imda_pack_path: PACK };
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
// 真实 fs 交给插件：插件通过 requireNativeModule 拿 fs/path。
// Blockbench 传的是 { scope } 选项（它据此做权限沙箱），这里直接忽略选项返回真实模块。
global.requireNativeModule = (name) => require(name);

require(PLUGIN);
plugin_options.onload();
const api = global.__IMM_TEST__.api;

let pass = 0, fail = 0;
const ok = (label, cond, detail) => {
	if (cond) { pass++; console.log('  ✔ ' + label); }
	else { fail++; console.log('  ✘ ' + label + (detail === undefined ? '' : ('\n      ' + JSON.stringify(detail)))); }
};
const eq = (label, actual, expected) => ok(label + (JSON.stringify(actual) === JSON.stringify(expected) ? '' : ('  ← 实际 ' + JSON.stringify(actual))), JSON.stringify(actual) === JSON.stringify(expected));
const names = (list) => list.map(e => e.untyped);

console.log('版本：' + api.VERSION);

/* ---------- 扫描 ---------- */
console.log('\n[扫描资源包]');
const scanAll = api.scanPackEntries({});
ok('扫描成功', !scanAll.error, scanAll.error);
const all = names(scanAll.entries).sort();
eq('扫到全部路径（映射优先后 10 条）',
	all,
	['other:tool/wrench', 'sqsp:_old/legacy', 'sqsp:inker/jet_rifle/broken', 'sqsp:inker/jet_rifle/bullet',
		'sqsp:inker/jet_rifle/copy test', 'sqsp:inker/jet_rifle/dual', 'sqsp:inker/jet_rifle/gun',
		'sqsp:inker/jet_rifle/gun copy', 'sqsp:inker/jet_rifle/scope', 'sqsp:item/debug/probe']);
eq('png 文件没有被当成模型', all.some(n => /\.png$/.test(n)), false);

console.log('\n[映射优先]');
const dual = scanAll.entries.find(e => e.untyped === 'sqsp:inker/jet_rifle/dual');
eq('同路径映射胜出', dual && dual.kind, 'items');
eq('标记 alsoHasModel', dual && dual.alsoHasModel, true);
eq('被丢弃的模型有记录', scanAll.droppedModels.length, 1);
eq('丢弃的是模型而不是映射', scanAll.droppedModels[0] && scanAll.droppedModels[0].kind, 'model');
eq('非冲突的模型没被丢', scanAll.droppedModels[0].untyped, 'sqsp:inker/jet_rifle/dual');

console.log('\n[路径形态]');
const gun = scanAll.entries.find(e => e.untyped === 'sqsp:inker/jet_rifle/gun');
eq('无类型路径', gun && gun.untyped, 'sqsp:inker/jet_rifle/gun');
eq('带类型路径（模型）', gun && gun.typed, 'sqsp:models/inker/jet_rifle/gun');
const bullet = scanAll.entries.find(e => e.untyped === 'sqsp:inker/jet_rifle/bullet');
eq('带类型路径（映射）', bullet && bullet.typed, 'sqsp:items/inker/jet_rifle/bullet');

/* ---------- 黑名单 ---------- */
console.log('\n[黑名单]');
const blocked = api.scanPackEntries({ blacklist: ['/debug/', '/_old/'] });
eq('剔除了 debug 与 _old', names(blocked.entries).sort(),
	['other:tool/wrench', 'sqsp:inker/jet_rifle/broken', 'sqsp:inker/jet_rifle/bullet', 'sqsp:inker/jet_rifle/copy test',
		'sqsp:inker/jet_rifle/dual', 'sqsp:inker/jet_rifle/gun', 'sqsp:inker/jet_rifle/gun copy', 'sqsp:inker/jet_rifle/scope']);
eq('记录被剔除的条目', blocked.blocked.length, 2);
eq('记录命中规则', blocked.blocked.every(b => b.blockedBy), true);
const invalid = api.scanPackEntries({ blacklist: ['[unclosed'] });
eq('无效正则被记录但不炸', invalid.invalidPatterns.length, 1);
eq('无效正则不影响其它条目', names(invalid.entries).length, 10);

/* ---------- 只导入模型 / 只导入映射 ---------- */
console.log('\n[只导入]');
const onlyModels = api.scanPackEntries({ includeItems: false });
eq('只导入模型：不含映射路径', names(onlyModels.entries).some(n => n === 'sqsp:inker/jet_rifle/bullet'), false);
eq('只导入模型：dual 仍是模型', (onlyModels.entries.find(e => e.untyped === 'sqsp:inker/jet_rifle/dual') || {}).kind, 'model');
const onlyItems = api.scanPackEntries({ includeModels: false });
eq('只导入映射：只剩映射（含带空格名与无 model 字段的）', names(onlyItems.entries).sort(),
	['sqsp:inker/jet_rifle/broken', 'sqsp:inker/jet_rifle/bullet', 'sqsp:inker/jet_rifle/copy test', 'sqsp:inker/jet_rifle/dual']);

/* ---------- 生成树 ---------- */
console.log('\n[生成 select 树]');
const built = api.buildAllItemsTree({ name: '[test all]', property: 'custom_model_data', index: 3 });
ok('生成成功', !built.error, built.error);
eq('容器类型为 select', built.container.imda_type, 'select');
eq('容器 property', built.container.imda_property, 'custom_model_data');
eq('容器 index', built.container.imda_index, 3);
eq('容器名', built.container.name, '[test all]');
eq('子节点数 = 路径数', built.container.children.length, built.entries.length);
eq('每个子节点都是 model 类型', built.container.children.every(c => c.imda_type === 'model'), true);

const gunCase = built.container.children.find(c => c.imda_model === 'sqsp:inker/jet_rifle/gun');
ok('模型路径生成 model 引用', !!gunCase);
const gunWhen = JSON.parse(gunCase.imda_case_when);
eq('when 含无类型路径', gunWhen.indexOf('sqsp:inker/jet_rifle/gun') >= 0, true);
eq('when 含带类型路径', gunWhen.indexOf('sqsp:models/inker/jet_rifle/gun') >= 0, true);
eq('when 无重复', new Set(gunWhen).size, gunWhen.length);

const bulletCase = built.container.children.find(c => c.imda_model === 'sqsp:items/inker/jet_rifle/bullet');
ok('映射路径生成 items 引用', !!bulletCase);
const bulletWhen = JSON.parse(bulletCase.imda_case_when);
eq('映射 when 含无类型路径（唯一一次）', bulletWhen.filter(v => v === 'sqsp:inker/jet_rifle/bullet').length, 1);
eq('映射 when 含带类型路径', bulletWhen.indexOf('sqsp:items/inker/jet_rifle/bullet') >= 0, true);

/* ---------- 带空格路径 ---------- */
console.log('\n[带空格路径]');
// 带空格的模型路径：imda_model 用 ns:inker/jet_rifle/gun copy（无类型引用）
const spaceCase = built.container.children.find(c => String(c.imda_model || '').indexOf('gun copy') >= 0);
ok('带空格模型路径生成引用', !!spaceCase);
const spaceWhen = spaceCase ? JSON.parse(spaceCase.imda_case_when) : [];
eq('带空格的无类型路径在 when 里', spaceWhen.indexOf('sqsp:inker/jet_rifle/gun copy') >= 0, true);
eq('带空格的带类型路径在 when 里', spaceWhen.indexOf('sqsp:models/inker/jet_rifle/gun copy') >= 0, true);
const spaceItemsCase = built.container.children.find(c => c.imda_model === 'sqsp:items/inker/jet_rifle/copy test');
ok('带空格映射路径解析成功（未被误判为非法）', !!spaceItemsCase);

/* ---------- 无效映射必须被跳过 ---------- */
console.log('\n[无效映射]');
const brokenCase = built.container.children.find(c => c.imda_model === 'sqsp:items/inker/jet_rifle/broken');
eq('没有 model 字段的映射不生成分支', !!brokenCase, false);
eq('跳过记录里有它', (built.skippedMappings || []).some(s => s.entry && s.entry.untyped === 'sqsp:inker/jet_rifle/broken'), true);
ok('所有生成的分支都不会是无定义的 items 引用',
	built.container.children.every(c => !/^[a-z0-9_.\-]+:items\//.test(String(c.imda_model || '')) || (built.priming.primed > 0 && !(built.skippedMappings || []).some(s => ('sqsp:items/' + s.entry.path) === c.imda_model))));

/* ---------- component（物品数据）模式 ---------- */
console.log('\n[物品数据模式]');
const compBuilt = api.buildAllItemsTree({ name: '[comp]', property: 'component' });
ok('component 模式生成成功', !compBuilt.error, compBuilt.error);
eq('容器 property 为 component', compBuilt.container.imda_property, 'component');
eq('容器 component 指向 custom_data', compBuilt.container.imda_component, 'minecraft:custom_data');
const compGun = compBuilt.container.children.find(c => c.imda_model === 'sqsp:inker/jet_rifle/gun');
const compWhen = JSON.parse(compGun.imda_case_when);
eq('when 元素是对象', typeof compWhen[0], 'object');
eq('when 用 id 字段匹配无类型路径', compWhen[0].id, 'sqsp:inker/jet_rifle/gun');
eq('when 同时含带类型路径', compWhen.some(w => w && w.id === 'sqsp:models/inker/jet_rifle/gun'), true);

/* ---------- 导出的 select JSON 形态 ---------- */
console.log('\n[导出 JSON]');
global.Outliner.root.length = 0;
const wrap = new global.Group({ name: 'wrap', imda_type: 'composite', origin: [8, 8, 8], rotation: [0, 0, 0] });
built.container.addTo(wrap);
wrap.addTo();
global.Outliner.root.push(wrap);
global.Group.all = [wrap, built.container].concat(built.container.children || []);
const mapping = api.createExporter().buildMapping();
const text = api.formatMapping(mapping);
let parsed = null, parseErr = null;
try { parsed = JSON.parse(text); } catch (e) { parseErr = e.message; }
ok('导出文本可解析', !parseErr, parseErr);

const findSelect = (node, acc) => {
	if (!node || typeof node !== 'object') return acc;
	if (node.type === 'minecraft:select') acc.push(node);
	if (Array.isArray(node.models)) node.models.forEach(n => findSelect(n, acc));
	if (Array.isArray(node.entries)) node.entries.forEach(e => e && findSelect(e.model, acc));
	if (Array.isArray(node.cases)) node.cases.forEach(c => c && findSelect(c.model, acc));
	for (const k of ['on_true', 'on_false', 'fallback']) if (node[k]) findSelect(node[k], acc);
	return acc;
};
const selectNode = parsed ? findSelect(parsed.model, [])[0] : null;
ok('输出里有 select 节点', !!selectNode);
eq('property 带 minecraft: 前缀', selectNode && selectNode.property, 'minecraft:custom_model_data');
eq('index 保留', selectNode && selectNode.index, 3);
eq('cases 数量正确', selectNode && selectNode.cases.length, built.container.children.length);
ok('每个 case 的 when 都是非空数组', selectNode && selectNode.cases.every(c => Array.isArray(c.when) && c.when.length));
ok('每个 case 都有 model', selectNode && selectNode.cases.every(c => c && c.model));
eq('没有残留内部字段', text.indexOf('__allItemsEntry'), -1);

// component 模式的导出
global.Outliner.root.length = 0;
global.Group.all = [];
const wrap2 = new global.Group({ name: 'wrap2', imda_type: 'composite', origin: [8, 8, 8], rotation: [0, 0, 0] });
compBuilt.container.addTo(wrap2);
wrap2.addTo();
global.Outliner.root.push(wrap2);
global.Group.all = [wrap2, compBuilt.container].concat(compBuilt.container.children || []);
const compParsed = JSON.parse(api.formatMapping(api.createExporter().buildMapping()));
const compSelect = findSelect(compParsed.model, [])[0];
eq('component 模式 property', compSelect && compSelect.property, 'minecraft:component');
eq('component 模式 component 字段', compSelect && compSelect.component, 'minecraft:custom_data');
ok('component 模式 when 是对象数组', compSelect && compSelect.cases.every(c => Array.isArray(c.when) && c.when.every(w => w && typeof w === 'object' && typeof w.id === 'string')));

/* ---------- parseWhen 兼容性 ---------- */
console.log('\n[parseWhen]');
const exporterForWhen = api.createExporter();
eq('数组字面量', exporterForWhen.parseWhen('["a","b"]'), ['a', 'b']);
eq('单个对象字面量', exporterForWhen.parseWhen('{"id": "x:y"}'), [{ id: 'x:y' }]);
eq('逗号分隔（数字/布尔/字符串）', exporterForWhen.parseWhen('1,true,abc'), [1, true, 'abc']);
eq('空值', exporterForWhen.parseWhen(''), []);
eq('对象数组', exporterForWhen.parseWhen('[{"id":"a"},{"id":"b"}]'), [{ id: 'a' }, { id: 'b' }]);
eq('去引号', exporterForWhen.parseWhen('a, "b"'), ['a', 'b']);

/* ---------- 汇总 ---------- */
if (!process.argv.includes('--keep')) fs.rmSync(PACK, { recursive: true, force: true });
console.log('\n通过 ' + pass + ' / ' + (pass + fail));
if (fail) process.exit(1);
