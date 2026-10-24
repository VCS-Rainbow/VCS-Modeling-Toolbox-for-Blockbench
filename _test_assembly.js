/* 离线冒烟测试：mock Blockbench 环境，跑“物品模型映射装配”插件的 compile / zip 导出 */
const fs = require('fs');
const path = require('path');

const BB = 'C:\\Game\\Minecraft\\.minecraft\\resourcepacks\\Squilker Sparkle Res\\assets\\sqsp\\models\\item\\inker\\jet_rifle\\sac_assembly.bbmodel';
const PLUGIN = 'C:\\Users\\Rainbow_\\blockbench_item_model_mapping_isolated\\item_model_definition_assembly.js';
const OUT = path.join(process.env.TEMP || '.', 'imm_out');

/* ---- 最小 THREE ---- */
const ax = (a, d) => { const h = d * Math.PI / 360, s = Math.sin(h), v = [0, 0, 0]; v[a] = s; return { x: v[0], y: v[1], z: v[2], w: Math.cos(h) }; };
const qm = (a, b) => ({ x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y, y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x, z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w, w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z });
class Quaternion { constructor(x = 0, y = 0, z = 0, w = 1) { Object.assign(this, { x, y, z, w }); } setFromEuler(e) { const q = e.order === 'ZYX' ? qm(qm(ax(2, e.z), ax(1, e.y)), ax(0, e.x)) : qm(qm(ax(0, e.x), ax(1, e.y)), ax(2, e.z)); Object.assign(this, q); return this; } normalize() { return this; } lengthSq() { return 1; } copy(q) { Object.assign(this, q); return this; } }
class Euler { constructor(x = 0, y = 0, z = 0, order = 'XYZ') { Object.assign(this, { x, y, z, order }); } }

/* ---- mock 数据 ---- */
const bb = JSON.parse(fs.readFileSync(BB, 'utf8'));
class Texture { constructor(o) { Object.assign(this, o); } } Texture.all = [];
class Cube { constructor(o) { Object.assign(this, o); this.mesh = { quaternion: new Quaternion().setFromEuler(new Euler(o.rotation[0], o.rotation[1], o.rotation[2], 'ZYX')), rotation: { order: 'ZYX' } }; } mapAutoUV() { } } Cube.all = [];
class Group { constructor(o) { Object.assign(this, o); this.children = []; this.mesh = { quaternion: new Quaternion().setFromEuler(new Euler(o.rotation[0], o.rotation[1], o.rotation[2], 'ZYX')), rotation: { order: 'ZYX' } }; } } Group.all = [];

const texById = new Map();
(bb.textures || []).forEach((t, i) => {
	const texture = new Texture({ uuid: 'tex-' + (t.id !== undefined ? t.id : i), name: t.name, source: t.source, uv_width: t.uv_width, uv_height: t.uv_height });
	Texture.all.push(texture); texById.set(String(t.id !== undefined ? t.id : i), texture); texById.set(texture.uuid, texture);
});
const cubeByUuid = new Map();
for (const e of bb.elements || []) {
	if (!e.from || !e.to) continue;
	const faces = {};
	for (const dir of ['north', 'east', 'south', 'west', 'up', 'down']) {
		const f = e.faces && e.faces[dir]; if (!f) continue;
		const texture = texById.get(String(f.texture));
		faces[dir] = { uv: f.uv, texture: texture ? texture.uuid : null, rotation: f.rotation, tint: f.tint || 0, getTexture: () => texture || null };
	}
	const cube = new Cube({ uuid: e.uuid, name: e.name || 'cube', from: e.from, to: e.to, origin: e.origin || [0, 0, 0], rotation: e.rotation || [0, 0, 0], inflate: e.inflate || 0, autouv: e.autouv ? 1 : 0, rescale: !!e.rescale, shade: e.shade !== false, faces, export: e.export !== false });
	cubeByUuid.set(e.uuid, cube); Cube.all.push(cube);
}
const groupByUuid = new Map();
for (const g of bb.groups || []) groupByUuid.set(g.uuid, new Group({ uuid: g.uuid, name: g.name, origin: g.origin, rotation: g.rotation, export: g.export !== false }));
function attach(nodes, parent) {
	for (const node of nodes) {
		if (typeof node === 'string') {
			if (groupByUuid.has(node)) attach([groupByUuid.get(node)], parent);
			else if (cubeByUuid.has(node)) { const c = cubeByUuid.get(node); c.parent = parent; if (parent) parent.children.push(c); }
			continue;
		}
		if (!node || typeof node !== 'object') continue;
		if (Array.isArray(node.children)) {
			const g = groupByUuid.get(node.uuid) || new Group({ uuid: node.uuid || ('g' + Math.random()), name: node.name, origin: node.origin || [0, 0, 0], rotation: node.rotation || [0, 0, 0] });
			g.name = node.name || g.name; g.origin = node.origin || g.origin; g.rotation = node.rotation || g.rotation;
			groupByUuid.set(g.uuid, g); g.parent = parent; if (parent) parent.children.push(g); Group.all.push(g);
			attach(node.children, g);
		} else if (node.uuid && cubeByUuid.has(node.uuid)) {
			const c = cubeByUuid.get(node.uuid); c.parent = parent; if (parent) parent.children.push(c);
		}
	}
}
attach(bb.outliner || [], null);
const root = [];
for (const g of groupByUuid.values()) if (!g.parent && !root.includes(g)) root.push(g);
for (const c of cubeByUuid.values()) if (!c.parent && !root.includes(c)) root.push(c);

/* ---- mock Blockbench ---- */
const captured = { files: [], properties: [], messages: [] };
global.THREE = { Quaternion, Euler };
global.Texture = Texture; global.Cube = Cube; global.Group = Group;
global.Outliner = { root };
global.ModelProject = class { };
global.Face = class { };
global.Project = { name: 'sac_assembly', model_identifier: 'sac_assembly', imm_namespace: 'sqsptst', imm_center_pivot: true, imm_block_display: false };
global.Format = { id: 'item_model_definition_assembly' };
global.Properties = [];
global.Property = class { constructor(target, type, name, options) { captured.properties.push({ name, type, options }); } };
let plugin_options = null;
global.Plugin = { register(id, options) { plugin_options = options; } };
global.Action = class { constructor(id, options) { Object.assign(this, options); this.id = id; captured.actions = captured.actions || []; captured.actions.push(this); } delete() { } };
global.MenuBar = { addAction() { } };
global.Dialog = class { constructor(o) { captured.dialog = o; } show() { return this; } };
global.Blockbench = {
	showQuickMessage: m => captured.messages.push(String(m)),
	showMessageBox: o => captured.messages.push('BOX: ' + (o && o.message)),
	export: o => { captured.exported = o; return Promise.resolve(); },
};
global.JSZip = class { constructor() { this.e = []; } file(p, d, o) { this.e.push({ path: p, data: d, options: o }); } generateAsync() { captured.files = this.e.slice(); return Promise.resolve({ zip: true }); } };
global.Codec = class { constructor(id, data) { Object.assign(this, data); this.id = id; captured.codec = this; } delete() { } };
global.ModelFormat = class { constructor(id, data) { Object.assign(this, data); this.id = id; captured.format = this; } delete() { } };

require(PLUGIN);
plugin_options.onload();

/* ---- 给分组设一点属性，验证各类型 ---- */
const topGroups = root.filter(g => g instanceof Group);
topGroups.forEach((g, index) => {
	g.imm_type = index === 1 ? 'model' : (index === 2 ? 'range_dispatch' : 'composite');
	if (index === 1) g.imm_model = 'sqsp:item/inker/jet_rifle/sac.full';
	if (index === 2) { g.imm_property = 'minecraft:custom_model_data'; g.imm_index = 0; }
	for (const child of g.children || []) {
		if (child instanceof Group) child.imm_threshold = (child.imm_threshold || 0) + 1;
	}
});

console.log('format id:', captured.format && captured.format.id, '| can_convert_to:', captured.format && captured.format.can_convert_to);
console.log('codec:', captured.codec && captured.codec.name, '| properties:', captured.properties.map(p => p.name).join(', '));
console.log('actions:', (captured.actions || []).map(a => a.name).join(' | '));

const mapping = captured.codec.compile();
console.log('---- mapping (compile) ----');
console.log(mapping.split('\n').slice(0, 40).join('\n'));
console.log('... total lines:', mapping.split('\n').length);

/* zip 导出 */
const zipAction = (captured.actions || []).find(a => a.id === 'imm_export_pack');
if (zipAction) zipAction.click();
const mergeAction = (captured.actions || []).find(a => a.id === 'imm_merge_pack');
if (mergeAction) mergeAction.click();
setTimeout(() => {
	console.log('---- zip files ----');
	for (const f of captured.files) console.log('  ' + f.path + '  (' + String(f.data).length + ')');
	console.log('messages:', JSON.stringify(captured.messages.slice(0, 4)));
	if (fs.existsSync(OUT)) fs.rmSync(OUT, { recursive: true, force: true });
	for (const f of captured.files) {
		const target = path.join(OUT, f.path);
		fs.mkdirSync(path.dirname(target), { recursive: true });
		if (f.options && f.options.base64) fs.writeFileSync(target, Buffer.from(f.data, 'base64'));
		else fs.writeFileSync(target, String(f.data), 'utf8');
	}
	console.log('out:', OUT);
}, 300);
