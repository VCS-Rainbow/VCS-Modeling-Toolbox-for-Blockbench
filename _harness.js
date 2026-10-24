/* 离线跑插件：用真实 bbmodel 构造 mock Blockbench 环境，执行导出并落盘结果 */
const fs = require('fs');
const path = require('path');

const BB = 'C:\\Game\\Minecraft\\.minecraft\\resourcepacks\\Squilker Sparkle Res\\assets\\sqsp\\models\\item\\inker\\jet_rifle\\sac_assembly.bbmodel';
const PLUGIN = 'C:\\Users\\Rainbow_\\blockbench_item_model_mapping_isolated\\item_model_mapping.js';
const OUT = path.join(process.env.TEMP || '.', 'im_out');

/* ---------- 最小 THREE ---------- */
function axisQ(axis, deg) {
	const h = (deg * Math.PI / 180) / 2;
	const s = Math.sin(h);
	const v = [0, 0, 0];
	v[axis] = s;
	return { x: v[0], y: v[1], z: v[2], w: Math.cos(h) };
}
function qMul(a, b) {
	return {
		x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
		y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
		z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
		w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
	};
}
class Quaternion {
	constructor(x = 0, y = 0, z = 0, w = 1) { this.x = x; this.y = y; this.z = z; this.w = w; }
	setFromEuler(e) {
		const q = e.order === 'ZYX'
			? qMul(qMul(axisQ(2, e.z), axisQ(1, e.y)), axisQ(0, e.x))
			: qMul(qMul(axisQ(0, e.x), axisQ(1, e.y)), axisQ(2, e.z));
		this.x = q.x; this.y = q.y; this.z = q.z; this.w = q.w;
		return this;
	}
	normalize() { return this; }
	lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w; }
	copy(q) { this.x = q.x; this.y = q.y; this.z = q.z; this.w = q.w; return this; }
}
class Euler {
	constructor(x = 0, y = 0, z = 0, order = 'XYZ') { this.x = x; this.y = y; this.z = z; this.order = order; }
}

/* ---------- mock 数据结构 ---------- */
const bb = JSON.parse(fs.readFileSync(BB, 'utf8'));

class Texture {
	constructor(o) { Object.assign(this, o); }
}
Texture.all = [];

class Cube {
	constructor(o) {
		Object.assign(this, o);
		this.export = o.export !== false;
		this.mesh = { quaternion: new Quaternion().setFromEuler(new Euler(o.rotation[0], o.rotation[1], o.rotation[2], 'ZYX')), rotation: { order: 'ZYX' } };
	}
	size() { return [0, 0, 0]; }
	mapAutoUV() { }
}
Cube.all = [];

class Group {
	constructor(o) {
		Object.assign(this, o);
		this.export = o.export !== false;
		this.children = [];
		this.mesh = { quaternion: new Quaternion().setFromEuler(new Euler(o.rotation[0], o.rotation[1], o.rotation[2], 'ZYX')), rotation: { order: 'ZYX' } };
	}
}
Group.all = [];

const texture_by_id = new Map();
(bb.textures || []).forEach((t, index) => {
	const texture = new Texture({
		uuid: 'tex-' + (t.id !== undefined ? t.id : index),
		name: t.name || ('texture' + index),
		source: t.source,
		width: t.width,
		height: t.height,
		uv_width: t.uv_width,
		uv_height: t.uv_height,
	});
	Texture.all.push(texture);
	texture_by_id.set(String(t.id !== undefined ? t.id : index), texture);
	texture_by_id.set(texture.uuid, texture);
});

const element_map = new Map();
for (const e of bb.elements || []) {
	if (!e.from || !e.to) continue;
	const faces = {};
	for (const dir of ['north', 'east', 'south', 'west', 'up', 'down']) {
		const f = e.faces && e.faces[dir];
		if (!f) continue;
		const texture = texture_by_id.get(String(f.texture));
		faces[dir] = {
			uv: f.uv,
			texture: texture ? texture.uuid : null,
			rotation: f.rotation,
			tint: typeof f.tint === 'number' ? f.tint : 0,
			getTexture() { return texture || null; },
		};
	}
	const cube = new Cube({
		uuid: e.uuid, name: e.name || 'cube',
		from: e.from, to: e.to, origin: e.origin || [0, 0, 0],
		rotation: e.rotation || [0, 0, 0], inflate: e.inflate || 0,
		autouv: e.autouv === 1 || e.autouv === 2 ? 1 : 0,
		rescale: !!e.rescale, shade: e.shade !== false, faces,
		export: e.export !== false,
	});
	element_map.set(e.uuid, cube);
	Cube.all.push(cube);
}

const group_map = new Map();
for (const g of bb.groups || []) {
	group_map.set(g.uuid, new Group({
		uuid: g.uuid, name: g.name || 'group',
		origin: g.origin || [0, 0, 0], rotation: g.rotation || [0, 0, 0],
		export: g.export !== false,
	}));
}

function attach(children, parent) {
	for (const node of children) {
		if (typeof node === 'string') {
			const group = group_map.get(node);
			if (group) { group.parent = parent; if (parent) parent.children.push(group); continue; }
			const cube = element_map.get(node);
			if (cube) { cube.parent = parent; if (parent) parent.children.push(cube); }
			continue;
		}
		if (!node || typeof node !== 'object') continue;
		if (Array.isArray(node.children)) {
			const group = group_map.get(node.uuid) || new Group({
				uuid: node.uuid || ('g-' + Math.random()), name: node.name || 'group',
				origin: node.origin || [0, 0, 0], rotation: node.rotation || [0, 0, 0],
				export: node.export !== false,
			});
			group.origin = node.origin || group.origin;
			group.rotation = node.rotation || group.rotation;
			if (node.name) group.name = node.name;
			group_map.set(group.uuid, group);
			group.parent = parent;
			if (parent) parent.children.push(group);
			Group.all.push(group);
			attach(node.children, group);
		} else if (node.uuid) {
			const cube = element_map.get(node.uuid);
			if (cube) { cube.parent = parent; if (parent) parent.children.push(cube); }
		}
	}
}

const root = [];
attach(bb.outliner || [], null);
for (const group of group_map.values()) {
	if (!group.parent && !root.includes(group)) root.push(group);
}
for (const cube of element_map.values()) {
	if (!cube.parent) root.push(cube);
}

/* ---------- mock Blockbench ---------- */
let plugin_options = null;
const captured = { files: [], exported: null, messages: [] };

global.THREE = { Quaternion, Euler };
global.Texture = Texture;
global.Cube = Cube;
global.Group = Group;
global.Outliner = { root, elements: Cube.all, selected: [] };
global.Project = { name: 'sac_assembly', texture_width: bb.resolution ? bb.resolution.width : 16, texture_height: bb.resolution ? bb.resolution.height : 16 };
global.Format = { id: bb.meta ? bb.meta.model_format : 'java_block' };
global.Plugin = { register(id, options) { plugin_options = options; } };
global.Action = class { constructor(id, options) { Object.assign(this, options); this.id = id; } delete() { } };
global.MenuBar = { addAction(action) { captured.action = action; }, removeAction() { } };
global.Dialog = class { constructor(options) { captured.dialog = options; } show() { return this; } };
global.Blockbench = {
	showQuickMessage(message) { captured.messages.push(String(message)); },
	showMessageBox(options) { captured.messages.push('MSGBOX: ' + JSON.stringify(options)); },
	export(options) { captured.exported = options; return Promise.resolve(); },
};
global.JSZip = class {
	constructor() { this.entries = []; }
	file(file_path, data, options) { this.entries.push({ path: file_path, data, options }); }
	generateAsync() { captured.files = this.entries.slice(); return Promise.resolve({ zip: true }); }
};

require(PLUGIN);
if (!plugin_options) throw new Error('插件没有调用 Plugin.register');
plugin_options.onload();

const action = captured.action;
if (!action) throw new Error('没有注册 Action');
action.click();
if (!captured.dialog) throw new Error('没有打开对话框');

captured.dialog.onConfirm({
	namespace: 'sqsptst',
	item_id: 'sac_assembly',
	block_display: true,
	center_pivot: true,
	negative_size: 'raw',
});

/* ---------- 落盘 + 摘要 ---------- */
(async () => {
	await new Promise(resolve => setTimeout(resolve, 200));
	if (fs.existsSync(OUT)) fs.rmSync(OUT, { recursive: true, force: true });
	for (const entry of captured.files) {
		const target = path.join(OUT, entry.path);
		fs.mkdirSync(path.dirname(target), { recursive: true });
		if (entry.options && entry.options.base64) fs.writeFileSync(target, Buffer.from(entry.data, 'base64'));
		else fs.writeFileSync(target, String(entry.data), 'utf8');
	}
	console.log('files:', captured.files.length);
	for (const entry of captured.files) {
		const size = String(entry.data).length;
		console.log('  ' + entry.path + '  (' + size + ')');
	}
	console.log('messages:', JSON.stringify(captured.messages, null, 1));
	console.log('out dir:', OUT);
})();
