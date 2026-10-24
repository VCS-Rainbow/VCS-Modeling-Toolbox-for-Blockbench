/**
 * 物品模型映射装配 — Blockbench 模型格式插件（重写版 0.8.0）
 * 格式 id: item_model_definition_assembly
 *
 * 设计要点
 * - 每个分组 = 一个物品模型映射节点：composite / model / range_dispatch / condition / empty
 * - 分组变换写入 transformation：
 *     translation 单位 = 格；坐标系原点 = 方块空间 (0,0,0)，物品中心 = (0.5,0.5,0.5)
 *     作用顺序 right_rotation → scale → left_rotation → translation
 *     姿态放 left_rotation，scale 留给形状（保持刚体）
 * - 元素 from/to 原样（负尺寸 from > to 也原样）；每份模型几何居中到 (8,8,8)，
 *   位移/旋转交给 transformation，保证 from/to 落在 [-16,32]
 * - 同层元素写进同一个模型文件；多轴旋转的方块拆成独立子项（元素只能单轴）
 * - 紧凑 JSON 输出
 */

(function () {
'use strict';

const FORMAT_ID = 'item_model_definition_assembly';
const VERSION = '0.10.3';
const FACE_KEYS = ['north', 'east', 'south', 'west', 'up', 'down'];
const UNIT = 16;
const CENTER = UNIT / 2;
const MAPPING_TYPES = ['composite', 'model', 'range_dispatch', 'condition', 'empty'];
const MANIFEST = '.imm-assembly-manifest.json';

const BLOCK_DISPLAY = {
	thirdperson_righthand: { rotation: [75, 45, 0], translation: [0, 2.5, 0], scale: [0.375, 0.375, 0.375] },
	thirdperson_lefthand: { rotation: [75, 45, 0], translation: [0, 2.5, 0], scale: [0.375, 0.375, 0.375] },
	firstperson_righthand: { rotation: [0, 45, 0], translation: [0, 0, 0], scale: [0.4, 0.4, 0.4] },
	firstperson_lefthand: { rotation: [0, 225, 0], translation: [0, 0, 0], scale: [0.4, 0.4, 0.4] },
	ground: { rotation: [0, 0, 0], translation: [0, 3, 0], scale: [0.25, 0.25, 0.25] },
	gui: { rotation: [30, 225, 0], translation: [0, 0, 0], scale: [0.625, 0.625, 0.625] },
	fixed: { rotation: [0, 0, 0], translation: [0, 0, 0], scale: [0.5, 0.5, 0.5] },
};

let format_object = null;
let codec_object = null;
const actions = {};

/* ============================== 小工具 ============================== */

const clean = (v) => { const n = Number(v); if (!isFinite(n)) return 0; const r = Math.round(n * 1e6) / 1e6; return Math.abs(r) < 1e-6 ? 0 : r; };
const cleanAll = (list) => list.map(clean);
const labelOf = (node) => (node && node.name) ? node.name : 'unnamed';
const isGroup = (node) => typeof Group !== 'undefined' && node instanceof Group;
const isCube = (node) => typeof Cube !== 'undefined' && node instanceof Cube;
const num = (v) => Number(v) || 0;

function sanitizePath(value, fallback) {
	const s = String(value == null ? '' : value).toLowerCase().replace(/\\/g, '/')
		.replace(/[^a-z0-9_\-./]+/g, '_').replace(/\/{2,}/g, '/').replace(/_{2,}/g, '_')
		.replace(/^[_.\-/]+/, '').replace(/[_.\-/]+$/, '');
	const safe = s.split('/').filter(seg => seg && seg !== '.' && seg !== '..').join('/');
	return safe || (fallback || 'item');
}

function sanitizeNamespace(value) {
	const s = String(value == null ? '' : value).toLowerCase().replace(/[^a-z0-9_\-.]+/g, '_')
		.replace(/^[_.\-]+/, '').replace(/[_.\-]+$/, '');
	return s || 'custom';
}

const inline = (v) => Array.isArray(v) ? '[' + v.map(inline).join(', ') + ']'
	: (v && typeof v === 'object') ? '{' + Object.keys(v).map(k => JSON.stringify(k) + ': ' + inline(v[k])).join(', ') + '}'
	: JSON.stringify(v === undefined ? null : v);

/** 模型文件：textures 一行、每个元素一行、display 每个位置一行 */
function formatModel(model) {
	const lines = ['{'];
	const keys = Object.keys(model);
	keys.forEach((key, index) => {
		const comma = index === keys.length - 1 ? '' : ',';
		if (key === 'elements') {
			lines.push('\t"elements": [');
			model.elements.forEach((el, i) => lines.push('\t\t' + inline(el) + (i === model.elements.length - 1 ? '' : ',')));
			lines.push('\t]' + comma);
		} else if (key === 'display') {
			const pos = Object.keys(model.display);
			lines.push('\t"display": {');
			pos.forEach((p, i) => lines.push('\t\t' + JSON.stringify(p) + ': ' + inline(model.display[p]) + (i === pos.length - 1 ? '' : ',')));
			lines.push('\t}' + comma);
		} else {
			lines.push('\t' + JSON.stringify(key) + ': ' + inline(model[key]) + comma);
		}
	});
	lines.push('}');
	return lines.join('\n');
}

/** 映射节点：放得下就一行，嵌套层级展开 */
function formatNode(node, depth) {
	const pad = '\t'.repeat(depth);
	const padIn = pad + '\t';
	const fields = ['"type": ' + JSON.stringify(node.type)];
	for (const key of ['model', 'property', 'index', 'scale', 'tints', 'transformation']) {
		if (node[key] !== undefined) fields.push(JSON.stringify(key) + ': ' + inline(node[key]));
	}
	for (const key of ['on_true', 'on_false', 'fallback']) {
		if (node[key]) fields.push(JSON.stringify(key) + ': ' + formatNode(node[key], depth + 1));
	}
	if (Array.isArray(node.entries)) {
		const entryPad = pad + '\t\t';
		fields.push('"entries": [\n' + node.entries.map(e =>
			entryPad + '{"threshold": ' + JSON.stringify(e.threshold) + ', "model": ' + formatNode(e.model, depth + 2) + '}').join(',\n')
			+ '\n' + padIn + ']');
	}
	if (Array.isArray(node.models)) {
		if (!node.models.length) fields.push('"models": []');
		else {
			const childPad = pad + '\t\t';
			fields.push('"models": [\n' + node.models.map(c => childPad + formatNode(c, depth + 2)).join(',\n') + '\n' + padIn + ']');
		}
	}
	if (fields.every(f => f.indexOf('\n') < 0)) {
		const one = '{' + fields.join(', ') + '}';
		if (one.length + pad.length <= 180) return one;
	}
	return '{\n' + fields.map(f => padIn + f).join(',\n') + '\n' + pad + '}';
}

const formatMapping = (mapping) => '{\n\t"model": ' + formatNode(mapping.model, 1) + '\n}';

/* ============================== 旋转 ============================== */

/**
 * 读取节点旋转（四元数）：以数据 rotation（度）+ 欧拉顺序为准，mesh.quaternion 仅作兜底。
 * 深层分组的 mesh 可能仍是单位四元数（未同步/未渲染），不能依赖它。
 */
function readQuaternion(node) {
	const rotation = (node && node.rotation) || [0, 0, 0];
	const hasData = [0, 1, 2].some(a => Math.abs(num(rotation[a])) > 1e-9);
	const mesh = node ? node.mesh : null;
	const order = (mesh && mesh.rotation && mesh.rotation.order)
		|| (typeof Format !== 'undefined' && Format && Format.euler_order)
		|| 'ZYX';
	if (!hasData) {
		const q = mesh && mesh.quaternion;
		if (q && isFinite(q.x) && (q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w) > 1e-12) {
			return { x: q.x, y: q.y, z: q.z, w: q.w };
		}
		return { x: 0, y: 0, z: 0, w: 1 };
	}
	if (typeof THREE !== 'undefined' && THREE && THREE.Quaternion && THREE.Euler) {
		const e = new THREE.Euler(
			num(rotation[0]) * Math.PI / 180,
			num(rotation[1]) * Math.PI / 180,
			num(rotation[2]) * Math.PI / 180,
			order
		);
		const q = new THREE.Quaternion().setFromEuler(e);
		return { x: q.x, y: q.y, z: q.z, w: q.w };
	}
	const active = [0, 1, 2].filter(a => Math.abs(num(rotation[a])) > 1e-9);
	if (active.length > 1) return null;
	const half = num(rotation[active[0]]) * Math.PI / 360, s = Math.sin(half);
	return { x: active[0] === 0 ? s : 0, y: active[0] === 1 ? s : 0, z: active[0] === 2 ? s : 0, w: Math.cos(half) };
}

function quatMatrix(q) {
	const { x, y, z, w } = q;
	return [
		1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
		2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
		2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y),
	];
}

const rotVec = (m, v) => [
	m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
	m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
	m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];

function projectValue(name, fallback) {
	if (typeof Project === 'undefined' || !Project) return fallback;
	const v = Project[name];
	return (v === undefined || v === null || v === '') ? fallback : v;
}

/* ============================== 导出器 ============================== */

class Exporter {
	constructor(settings) {
		this.namespace = settings.namespace;
		this.item_id = settings.item_id;
		this.stem = sanitizePath(String(settings.item_id).replace(/\//g, '_'), 'item');
		this.centerPivot = settings.center_pivot === true;
		this.blockDisplay = settings.block_display !== false;
		this.warnings = [];
		this.models = [];
		this.textures = [];
		this.textureRefs = new Map();
		this.uvScales = new Map();
		this.modelNames = new Set();
		this.textureNames = new Set();
		this.negativeCount = 0;
	}

	warn(msg) { if (msg && this.warnings.indexOf(msg) < 0 && this.warnings.length < 40) this.warnings.push(msg); }

	unique(base, set) {
		if (!set.has(base)) { set.add(base); return base; }
		let i = 2;
		while (set.has(base + '_' + i)) i++;
		const name = base + '_' + i;
		set.add(name);
		return name;
	}

	uvScale(texture) {
		if (this.uvScales.has(texture)) return this.uvScales.get(texture);
		let w = 0, h = 0;
		try {
			if (texture && typeof texture.getUVWidth === 'function') w = num(texture.getUVWidth());
			if (texture && typeof texture.getUVHeight === 'function') h = num(texture.getUVHeight());
		} catch (e) { /* ignore */ }
		if (!w && texture) w = num(texture.uv_width);
		if (!h && texture) h = num(texture.uv_height);
		if (!w) w = num(projectValue('texture_width', 16)) || 16;
		if (!h) h = num(projectValue('texture_height', 16)) || 16;
		const s = { u: UNIT / w, v: UNIT / h };
		this.uvScales.set(texture, s);
		return s;
	}

	resolveTexture(face) {
		if (!face) return null;
		try {
			if (typeof face.getTexture === 'function') {
				const t = face.getTexture();
				if (t && t.uuid) return t;
			}
		} catch (e) { /* ignore */ }
		if (!face.texture) return null;
		const all = (typeof Texture !== 'undefined' && Texture.all) ? Texture.all : [];
		return all.find(t => t.uuid === face.texture) || null;
	}

	textureRef(texture) {
		if (this.textureRefs.has(texture)) return this.textureRefs.get(texture);
		const base = sanitizePath(String(texture.name || 'texture').replace(/\.png$/i, ''), 'texture');
		const name = this.unique(base, this.textureNames);
		const ref = this.namespace + ':item/' + name;
		this.textureRefs.set(texture, ref);
		this.textures.push({ name, texture });
		return ref;
	}

	/** 单轴旋转 → 元素 rotation；多轴返回 null（由子项 transformation 表达） */
	elementRotation(cube) {
		const r = (cube && cube.rotation) || [0, 0, 0];
		const active = [0, 1, 2].filter(a => Math.abs(num(r[a])) > 1e-6);
		if (active.length !== 1) return null;
		const axis = active[0];
		const origin = (cube && cube.origin) || [0, 0, 0];
		return {
			origin: cleanAll([num(origin[0]), num(origin[1]), num(origin[2])]),
			axis: ['x', 'y', 'z'][axis],
			angle: clean(num(r[axis])),
			rescale: !!cube.rescale,
		};
	}

	needsOwnNode(cube) {
		const r = (cube && cube.rotation) || [0, 0, 0];
		return [0, 1, 2].filter(a => Math.abs(num(r[a])) > 1e-6).length > 1;
	}

	compileElement(cube, order) {
		try { if (cube.autouv && typeof cube.mapAutoUV === 'function') cube.mapAutoUV(); } catch (e) { /* ignore */ }
		const inflate = typeof cube.inflate === 'number' ? cube.inflate : 0;
		const from = [0, 1, 2].map(a => (cube.from ? num(cube.from[a]) : 0) - inflate);
		const to = [0, 1, 2].map(a => (cube.to ? num(cube.to[a]) : 0) + inflate);
		if (from.some((v, a) => v > to[a])) this.negativeCount++;

		const faces = {};
		let count = 0;
		for (const dir of FACE_KEYS) {
			const face = cube.faces ? cube.faces[dir] : null;
			if (!face) continue;
			const texture = this.resolveTexture(face);
			if (!texture) continue;
			if (!order.has(texture)) order.set(texture, String(order.size));
			const s = this.uvScale(texture);
			const raw = face.uv || [0, 0, 0, 0];
			const uv = [
				clean(Math.min(16, Math.max(0, num(raw[0]) * s.u))), clean(Math.min(16, Math.max(0, num(raw[1]) * s.v))),
				clean(Math.min(16, Math.max(0, num(raw[2]) * s.u))), clean(Math.min(16, Math.max(0, num(raw[3]) * s.v))),
			];
			const entry = { uv, texture: '#' + order.get(texture) };
			if (face.rotation) entry.rotation = clean(face.rotation);
			if (typeof face.tint === 'number' && face.tint >= 0) entry.tintindex = face.tint;
			faces[dir] = entry;
			count++;
		}
		if (!count) { this.warn('方块 “' + labelOf(cube) + '” 没有带纹理的面，已跳过。'); return null; }

		const element = { from: cleanAll(from), to: cleanAll(to), faces };
		const rotation = this.elementRotation(cube);
		if (rotation) element.rotation = rotation;
		if (cube.shade === false) element.shade = false;
		return element;
	}

	/** 居中平移量：只用 from/to 的包围盒（不按元素自转取 AABB，避免枢轴很远时把坐标放大） */
	centerShift(elements) {
		const min = [Infinity, Infinity, Infinity];
		const max = [-Infinity, -Infinity, -Infinity];
		for (const el of elements) {
			for (let a = 0; a < 3; a++) {
				const lo = Math.min(el.from[a], el.to[a]);
				const hi = Math.max(el.from[a], el.to[a]);
				if (lo < min[a]) min[a] = lo;
				if (hi > max[a]) max[a] = hi;
			}
		}
		if (!isFinite(min[0])) return [0, 0, 0];
		return [0, 1, 2].map(a => (min[a] + max[a]) / 2 - CENTER);
	}

	addModel(cubes, hint) {
		const order = new Map();
		const elements = [];
		for (const cube of cubes) {
			const el = this.compileElement(cube, order);
			if (el) elements.push(el);
		}
		if (!elements.length) return null;

		const shift = this.centerShift(elements);
		for (const el of elements) {
			el.from = el.from.map((v, a) => clean(v - shift[a]));
			el.to = el.to.map((v, a) => clean(v - shift[a]));
			if (el.rotation) el.rotation.origin = el.rotation.origin.map((v, a) => clean(v - shift[a]));
		}

		const textures = {};
		let particle = null;
		for (const [texture, key] of order) {
			const ref = this.textureRef(texture);
			textures[key] = ref;
			if (!particle) particle = ref;
		}
		if (particle) textures.particle = particle;

		const model = { textures, elements };
		if (this.blockDisplay) model.display = JSON.parse(JSON.stringify(BLOCK_DISPLAY));

		const name = this.unique(sanitizePath(this.stem + '_' + (hint || 'part'), 'model'), this.modelNames);
		this.models.push({ name, data: model });
		return { reference: this.namespace + ':item/' + name, shift };
	}

	/**
	 * 分组/方块 → transformation
	 * 元素已平移 d（d = 包围盒中点 − (8,8,8)），原始坐标 p = p′ + d：
	 *   p′ → R·(p′ + d − O) + O = R·p′ + [R·d + O − R·O]
	 * translation = 常数项 / 16（单位：格）；枢轴 = O（原点模式）或 O − (8,8,8)（中心模式）
	 */
	buildTransformation(node, shift, parent_shift) {
		const q = readQuaternion(node);
		if (!q) return null;
		const len = Math.hypot(q.x, q.y, q.z, q.w);
		if (len > 1e-9) { q.x /= len; q.y /= len; q.z /= len; q.w /= len; }
		let flip = q.w < 0;
		if (!flip && Math.abs(q.w) < 1e-9) {
			for (const c of [q.x, q.y, q.z]) if (Math.abs(c) > 1e-9) { flip = c < 0; break; }
		}
		if (flip) { q.x = -q.x; q.y = -q.y; q.z = -q.z; q.w = -q.w; }

		const d = Array.isArray(shift) ? shift : [0, 0, 0];
		const dp = Array.isArray(parent_shift) ? parent_shift : [0, 0, 0];
		const hasShift = Math.abs(d[0]) + Math.abs(d[1]) + Math.abs(d[2]) > 1e-6;
		if (Math.abs(q.w) > 1 - 1e-7 && !hasShift) return null;

		const m = quatMatrix(q);
		const origin = (node && node.origin) || [0, 0, 0];
		const offset = this.centerPivot ? CENTER : 0;
		const pivot = [num(origin[0]) - offset, num(origin[1]) - offset, num(origin[2]) - offset];
		const rp = rotVec(m, pivot);
		const rd = rotVec(m, d);
		return {
			translation: cleanAll([0, 1, 2].map(a => (rd[a] + pivot[a] - rp[a] - dp[a]) / UNIT)),
			left_rotation: cleanAll([q.x, q.y, q.z, q.w]),
			scale: [1, 1, 1],
			right_rotation: [0, 0, 0, 1],
		};
	}

	normalizeType(value) {
		const t = String(value || 'composite').toLowerCase().replace(/^minecraft:/, '');
		return MAPPING_TYPES.indexOf(t) >= 0 ? t : 'composite';
	}

	/** 按来源类型构造 tints；imm_tints 的原始 JSON 优先 */
	buildTints(group) {
		// 纹理着色：索引为空 → 不输出任何 tints；类型默认 custom_model_data
		const index_text = String(group.imm_tint_index == null ? '' : group.imm_tint_index).trim();
		if (!/^-?\d+$/.test(index_text)) return null;
		const index = Number(index_text);
		const type = (String(group.imm_tint_type || 'custom_model_data').replace(/^minecraft:/, '').trim()) || 'custom_model_data';
		const value_text = String(group.imm_tint_value == null ? '' : group.imm_tint_value).trim();
		if (type === 'custom_model_data') return [{ type: 'custom_model_data', index, default: index }];
		if (type === 'constant') return [{ type: 'constant', value: value_text.length ? Number(value_text) : 0 }];
		if (type === 'grass') return [{ type: 'grass' }];
		const entry = { type };
		if (value_text.length) entry.default = Number(value_text) || 0;
		return [entry];
	}


	parseTints(value) {
		if (!value) return null;

		// 数字简写：填 0 等价于 custom_model_data 染色源 index 0
		const text = String(value).trim();
		if (/^-?\d+$/.test(text)) {
			const index = Number(text);
			return [{ type: 'custom_model_data', index, default: index }];
		}		try {
			const parsed = typeof value === 'string' ? JSON.parse(value) : value;
			if (Array.isArray(parsed) && parsed.length) return parsed;
		} catch (e) { this.warn('分组 tints 不是合法 JSON，已忽略。'); }
		return null;
	}

	buildCubeNode(cube, hint, parent_shift) {
		const built = this.addModel([cube], hint + '_' + sanitizePath(labelOf(cube), 'cube'));
		if (!built) return null;
		const node = { type: 'minecraft:model', model: built.reference };
		const transformation = this.buildTransformation(cube, built.shift, parent_shift);
		if (transformation) node.transformation = transformation;
		return node;
	}

	buildNode(group, hint, parent_shift) {
		const children = (group.children || []).filter(c => c && c.export !== false);
		const childGroups = children.filter(isGroup);
		const cubes = children.filter(isCube);
		const type = this.normalizeType(group.imm_type);

		const inlineCubes = [];
		const ownCubes = [];
		for (const cube of cubes) (this.needsOwnNode(cube) ? ownCubes : inlineCubes).push(cube);

		let built = null;
		if (group.imm_model) built = { reference: String(group.imm_model).trim(), shift: [0, 0, 0] };
		else if (inlineCubes.length) built = this.addModel(inlineCubes, hint);

		const node = { type: 'minecraft:' + type };
		const own_shift = built ? built.shift : [0, 0, 0];
		const transformation = this.buildTransformation(group, own_shift, parent_shift);
		if (transformation) node.transformation = transformation;

		const extras = ownCubes.map(cube => this.buildCubeNode(cube, hint, parent_shift)).filter(Boolean);

		if (type === 'empty') return node;

		if (type === 'model') {
			const ref = built ? built.reference : (extras[0] ? extras[0].model : null);
			if (!ref) { this.warn('分组 “' + labelOf(group) + '” 是 model 类型但没有可用模型，已跳过。'); return null; }
			node.model = ref;
			const tints = this.buildTints(group);
			if (tints) node.tints = tints;
			return node;
		}

		if (type === 'range_dispatch') {
			if (group.imm_tints) this.warn('分组 "' + labelOf(group) + '" 的 tints 只在 model / composite 生效，range_dispatch 已忽略。');
			node.property = String(group.imm_property || 'minecraft:custom_model_data');
			const scale = num(group.imm_scale);
			if (scale && scale !== 1) node.scale = clean(scale);
			if (String(group.imm_index || '').length) node.index = clean(group.imm_index);
			node.entries = [];
			for (const child of childGroups) {
				const childNode = this.buildNode(child, hint + '_' + sanitizePath(labelOf(child), 'group'), own_shift);
				if (childNode) node.entries.push({ threshold: clean(num(child.imm_threshold)), model: childNode });
			}
			const fallback = built ? { type: 'minecraft:model', model: built.reference } : (extras[0] || null);
			if (fallback) node.fallback = fallback;
			if (!node.entries.length && !node.fallback) return null;
			return node;
		}

		const models = [];
		const tints = this.buildTints(group);
				if (built) {
					const model_node = { type: 'minecraft:model', model: built.reference };
					if (tints) model_node.tints = tints;
					models.push(model_node);
				} else if (tints) {
					this.warn('分组 "' + labelOf(group) + '" 设置了 tints 但没有自己的模型，已忽略。');
				}
		for (const extra of extras) models.push(extra);
		for (const child of childGroups) {
			const childNode = this.buildNode(child, hint + '_' + sanitizePath(labelOf(child), 'group'), own_shift);
			if (childNode) models.push(childNode);
		}
		if (!models.length) { this.warn('分组 “' + labelOf(group) + '” 没有可导出内容，已跳过。'); return null; }

		if (type === 'condition') {
			node.property = String(group.imm_property || 'minecraft:selected');
			node.on_true = models[0];
			node.on_false = models[1] || { type: 'minecraft:empty' };
			if (models.length > 2) this.warn('condition 分组只使用前两个子项。');
			return node;
		}

		node.models = models;
		return node;
	}

	buildMapping() {
		const root = (typeof Outliner !== 'undefined' && Outliner && Outliner.root) ? Outliner.root : [];
		const models = [];
		const loose = [];
		for (const node of root) {
			if (!node || node.export === false) continue;
			if (isGroup(node)) {
				const built = this.buildNode(node, sanitizePath(labelOf(node), 'group'), [0, 0, 0]);
				if (built) models.push(built);
			} else if (isCube(node)) loose.push(node);
		}
		if (loose.length) {
			const inlineCubes = loose.filter(c => !this.needsOwnNode(c));
			const ownCubes = loose.filter(c => this.needsOwnNode(c));
			if (inlineCubes.length) {
				const built = this.addModel(inlineCubes, 'root');
				if (built) {
					const node = { type: 'minecraft:model', model: built.reference };
					if (built.shift.some(v => Math.abs(v) > 1e-6)) {
						node.transformation = {
							translation: cleanAll(built.shift.map(v => v / UNIT)),
							left_rotation: [0, 0, 0, 1], scale: [1, 1, 1], right_rotation: [0, 0, 0, 1],
						};
					}
					models.push(node);
				}
			}
			for (const cube of ownCubes) {
				const node = this.buildCubeNode(cube, 'root', [0, 0, 0]);
				if (node) models.push(node);
			}
		}
		if (!models.length) throw new Error('当前项目没有可导出的分组或方块。');
		return { model: { type: 'minecraft:composite', models } };
	}

	buildNotes() {
		const notes = [];
		if (this.negativeCount) notes.push('负尺寸（from > to）方块：' + this.negativeCount + ' 个，已原样输出。');
		for (const w of this.warnings) notes.push('- ' + w);
		return notes.length ? notes.join('\n') : null;
	}

	buildFiles() {
		const mapping = this.buildMapping();
		const files = [{ path: 'assets/' + this.namespace + '/items/' + this.item_id + '.json', data: formatMapping(mapping) }];
		for (const model of this.models) {
			files.push({ path: 'assets/' + this.namespace + '/models/item/' + model.name + '.json', data: formatModel(model.data) });
		}
		for (const texture of this.textures) {
			const source = texture.texture && texture.texture.source;
			if (typeof source === 'string' && source.startsWith('data:image')) {
				const comma = source.indexOf(',');
				if (comma > 0) {
					files.push({ path: 'assets/' + this.namespace + '/textures/item/' + texture.name + '.png', data: source.slice(comma + 1), base64: true });
					continue;
				}
			}
			this.warn('纹理 “' + texture.name + '” 未内嵌，需手动放置。');
		}
		const notes = this.buildNotes();
		if (notes) files.push({ path: this.stem + '.notes.txt', data: notes });
		return { files, mapping };
	}
}

function createExporter() {
	return new Exporter({
		namespace: sanitizeNamespace(projectValue('imm_namespace', 'custom')),
		item_id: sanitizePath(String(projectValue('model_identifier', '') || (Project && Project.name) || 'item'), 'item'),
		center_pivot: projectValue('imm_center_pivot', false) === true,
		block_display: projectValue('imm_block_display', true) !== false,
	});
}

function compileAssembly() {
	return formatMapping(createExporter().buildMapping());
}

/* ============================== 动作 ============================== */

function exportZip() {
	if (typeof Project === 'undefined' || !Project) { Blockbench.showQuickMessage('请先打开项目', 3000); return; }
	if (typeof JSZip === 'undefined') { Blockbench.showMessageBox({ title: '缺少 JSZip', message: '无法打包。', icon: 'error' }); return; }
	try {
		const exporter = createExporter();
		const { files } = exporter.buildFiles();
		const zip = new JSZip();
		for (const file of files) {
			if (file.base64) zip.file(file.path, file.data, { base64: true });
			else zip.file(file.path, file.data);
		}
		zip.generateAsync({ type: 'blob' }).then(content => {
			Blockbench.export({ type: 'Zip Archive', extensions: ['zip'], name: exporter.stem, content, savetype: 'zip' });
			Blockbench.showQuickMessage('已生成资源包：' + files.length + ' 个文件', 4000);
			const notes = exporter.buildNotes();
			if (notes) console.warn('[装配] ' + notes);
		});
	} catch (error) {
		console.error(error);
		Blockbench.showMessageBox({ title: '导出失败', message: String((error && error.message) || error), icon: 'error' });
	}
}

function getScopedFs(root) {
	try {
		if (typeof requireNativeModule !== 'function') return null;
		return requireNativeModule('fs', { scope: root, message: '需要读写资源包目录', show_permission_dialog: true });
	} catch (e) { return null; }
}

function getPath() {
	try { return (typeof requireNativeModule === 'function') ? requireNativeModule('path') : null; } catch (e) { return null; }
}

async function pickPack() {
	if (typeof Blockbench.pickDirectory !== 'function') {
		Blockbench.showMessageBox({ title: '无法选择文件夹', message: '请在项目设置里填写「合并目标资源包路径」，或改用 zip 导出。', icon: 'warning' });
		return null;
	}
	const picked = await Promise.resolve(Blockbench.pickDirectory({ resource_id: 'imm_pack', title: '选择目标资源包根目录' }));
	return picked || null;
}

function mergeToPack() {
	if (typeof Project === 'undefined' || !Project) { Blockbench.showQuickMessage('请先打开项目', 3000); return; }
	const root = String(projectValue('imm_pack_path', '') || '').trim();
	if (!root) { pickPack().then(picked => { if (picked) runMerge(picked); }); return; }
	runMerge(root);
}

function runMerge(root) {
	const pathmod = getPath();
	const fs = getScopedFs(root);
	if (!pathmod || !fs) {
		Blockbench.showMessageBox({ title: '不支持直接合并', message: '需要桌面版 Blockbench；网页版请用 zip 导出。', icon: 'warning' });
		return;
	}
	let plan;
	try {
		const exporter = createExporter();
		const files = exporter.buildFiles().files.filter(f => f.path.startsWith('assets/'));
		const manifestPath = pathmod.join(root, MANIFEST);
		let previous = [];
		try {
			if (fs.existsSync(manifestPath)) {
				const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
				if (parsed && Array.isArray(parsed.files)) previous = parsed.files.filter(v => typeof v === 'string');
			}
		} catch (e) { /* 清单坏了就跳过清理 */ }
		const current = new Set(files.map(f => f.path));
		const overwrite = [], added = [];
		for (const f of files) (fs.existsSync(pathmod.join(root, f.path)) ? overwrite : added).push(f.path);
		const stale = previous.filter(p => !current.has(p) && p.startsWith('assets/') && !p.includes('..') && fs.existsSync(pathmod.join(root, p)));
		plan = { files, root, pathmod, fs, manifestPath, current, overwrite, added, stale };
	} catch (error) {
		console.error(error);
		Blockbench.showMessageBox({ title: '生成失败', message: String((error && error.message) || error), icon: 'error' });
		return;
	}

	const lines = ['目标：' + plan.root, ''];
	const section = (title, list) => {
		if (!list.length) return;
		lines.push(title + '（' + list.length + ' 个）');
		list.slice(0, 20).forEach(p => lines.push('  ' + p));
		if (list.length > 20) lines.push('  … 其余 ' + (list.length - 20) + ' 个');
		lines.push('');
	};
	section('覆盖已有文件', plan.overwrite);
	section('新建文件', plan.added);
	section('删除过期文件', plan.stale);
	lines.push('合并后游戏里按 F3+T 重载资源包。');

	Blockbench.showMessageBox({
		title: '合并到资源包 — 确认改动',
		message: lines.join('\n'),
		buttons: ['取消', '重新选择…', '合并'],
		confirm: 2,
		cancel: 0,
	}, button => {
		if (button === 1) { pickPack().then(picked => { if (picked) runMerge(picked); }); return; }
		if (button !== 2) return;
		try {
			let written = 0;
			for (const file of plan.files) {
				const full = plan.pathmod.join(plan.root, file.path);
				plan.fs.mkdirSync(plan.pathmod.dirname(full), { recursive: true });
				Blockbench.writeFile(full, {
					content: file.base64 ? ('data:image/png;base64,' + file.data) : file.data,
					savetype: file.base64 ? 'image' : 'text',
				});
				if (!plan.fs.existsSync(full)) throw new Error('写入失败：' + full);
				written++;
			}
			let removed = 0;
			for (const p of plan.stale) {
				try { plan.fs.unlinkSync(plan.pathmod.join(plan.root, p)); removed++; } catch (e) { /* ignore */ }
			}
			Blockbench.writeFile(plan.manifestPath, {
				content: JSON.stringify({ version: 1, files: Array.from(plan.current) }, null, 2),
				savetype: 'text',
			});
			Project.imm_pack_path = plan.root;
			Project.saved = false;
			Blockbench.showQuickMessage('已合并 ' + written + ' 个文件' + (removed ? ('，清理 ' + removed + ' 个') : '') + ' → 按 F3+T 重载', 5000);
		} catch (error) {
			console.error(error);
			Blockbench.showMessageBox({ title: '合并失败', message: String((error && error.message) || error), icon: 'error' });
		}
	});
}

function pickTargetGroup() {
	const found = [];
	const push = (n) => { if (isGroup(n) && found.indexOf(n) < 0) found.push(n); };
	try { if (typeof Group !== 'undefined' && Group.first_selected) push(Group.first_selected); } catch (e) { /* ignore */ }
	try { if (typeof Group !== 'undefined' && Array.isArray(Group.selected)) Group.selected.forEach(push); } catch (e) { /* ignore */ }
	try { if (typeof Outliner !== 'undefined' && Outliner && Array.isArray(Outliner.selected)) Outliner.selected.forEach(push); } catch (e) { /* ignore */ }
	return found[0] || null;
}

function editGroupProps() {
	const group = pickTargetGroup();
	if (!group) {
		Blockbench.showMessageBox({ title: '请先选中分组', message: '先在 outliner 里点选一个分组。', icon: 'info' });
		return;
	}
	new Dialog({
		id: 'imm_group_props',
		title: '分组映射属性 — ' + labelOf(group),
		width: 660,
		form: {
			imm_type: {
				label: '映射类型（imm_type）', type: 'select', value: String(group.imm_type || 'composite'),
				options: { composite: 'composite', model: 'model', range_dispatch: 'range_dispatch', condition: 'condition', empty: 'empty' },
			},
			imm_model: { label: '引用模型', description: '键名 imm_model。填 Java 模型 id；留空则用本层方块生成模型文件', type: 'text', value: String(group.imm_model || ''), condition: (r) => r.imm_type !== 'empty' },
			imm_property: { label: 'property', description: '键名 imm_property。range_dispatch / condition 的取值来源', type: 'text', value: String(group.imm_property || ''), condition: (r) => r.imm_type === 'range_dispatch' || r.imm_type === 'condition' },
			imm_index: { label: 'index', description: '键名 imm_index。仅 range_dispatch：custom_model_data 的下标', type: 'number', value: num(group.imm_index), condition: (r) => r.imm_type === 'range_dispatch' },
			imm_threshold: { label: 'threshold', description: '键名 imm_threshold。仅当父分组是 range_dispatch 时生效', type: 'number', value: num(group.imm_threshold), condition: (r) => r.imm_type === 'range_dispatch' },
			imm_scale: { label: 'scale', description: '键名 imm_scale。仅 range_dispatch：数值缩放', type: 'number', value: num(group.imm_scale) || 1, condition: (r) => r.imm_type === 'range_dispatch' },
						imm_tint_type: { label: '纹理着色类型（imm_tint_type）', type: 'select', value: String(group.imm_tint_type || 'custom_model_data'), options: { '': '（不生成 tints）', custom_model_data: 'custom_model_data', constant: 'constant', dye: 'dye', potion: 'potion', grass: 'grass', team: 'team' }, description: '纹理着色来源类型；保存为键 imm_tint_type', condition: (r) => r.imm_type === 'model' || r.imm_type === 'composite' },
			imm_tint_index: { label: '纹理着色索引', description: '键名 imm_tint_index。留空表示不输出 tints；填整数才输出（如 0）', type: 'text', value: String(group.imm_tint_index == null ? '' : group.imm_tint_index), condition: (r) => (r.imm_type === 'model' || r.imm_type === 'composite') && r.imm_tint_type === 'custom_model_data' },
			imm_tint_value: { label: '纹理着色值', description: '键名 imm_tint_value。constant 填 ARGB 整数；dye/potion/team 可填默认颜色', type: 'text', value: String(group.imm_tint_value == null ? '' : group.imm_tint_value), condition: (r) => (r.imm_type === 'model' || r.imm_type === 'composite') && ['constant', 'dye', 'potion', 'team'].indexOf(r.imm_tint_type) >= 0 },
		},
		onConfirm(result) {
			try {
				Undo.initEdit({ groups: [group] });
				group.imm_type = result.imm_type;
				if (result.imm_model !== undefined) group.imm_model = result.imm_model;
				if (result.imm_property !== undefined) group.imm_property = result.imm_property;
				if (result.imm_index !== undefined) group.imm_index = num(result.imm_index);
				if (result.imm_threshold !== undefined) group.imm_threshold = num(result.imm_threshold);
				if (result.imm_scale !== undefined) group.imm_scale = num(result.imm_scale) || 1;
				if (result.imm_tints !== undefined) group.imm_tints = result.imm_tints;
				if (result.imm_tint_type !== undefined) group.imm_tint_type = result.imm_tint_type;
				if (result.imm_tint_index !== undefined) group.imm_tint_index = num(result.imm_tint_index);
				if (result.imm_tint_value !== undefined) group.imm_tint_value = result.imm_tint_value;
								// 按 index 自动勾选着色：本层 index 下发给直接子项，子项自己的 index 优先
				// 生效的 tint index：tints 数字简写 > tints[0].index > imm_index（0 视为未设置）
				const tintIndexOf = (g) => {
					const raw = String(g.imm_tints || '').trim();
					if (/^-?\d+$/.test(raw)) return Number(raw);
					try {
						const parsed = raw ? JSON.parse(raw) : null;
						if (Array.isArray(parsed) && parsed.length && typeof parsed[0].index === 'number') return parsed[0].index;
					} catch (e) { /* ignore */ }
					const index_text = String(g.imm_tint_index == null ? '' : g.imm_tint_index).trim();
					return /^-?\d+$/.test(index_text) ? Number(index_text) : undefined;
				};
				const root_index = tintIndexOf(group);
				let tinted = 0;
				const walkTint = (node, inherited) => {
					const own = tintIndexOf(node);
					const effective = (own !== undefined) ? own : inherited;
					for (const child of node.children || []) {
						if (isGroup(child)) { walkTint(child, effective); continue; }
						if (!isCube(child)) continue;
						const faces = Object.values(child.faces || {});
						if (!faces.length) continue;
						if (faces.some(f => typeof f.tint === 'number' && f.tint >= 0)) continue;
						if (effective === undefined) continue;
						for (const f of faces) f.tint = effective;
						tinted++;
					}
				};
				walkTint(group, root_index);
				if (tinted) {
					Project.saved = false;
					try { Canvas.updateAll(); } catch (e) { /* ignore */ }
					try { if (typeof UVEditor !== 'undefined' && UVEditor.updateView) UVEditor.updateView(); } catch (e) { /* ignore */ }
				}
Undo.finishEdit('修改分组映射属性');
				Blockbench.showQuickMessage('已更新 “' + labelOf(group) + '”' + (tinted ? ('，为 ' + tinted + ' 个方块自动勾选着色') : ''), 2500);
			} catch (error) {
				console.error(error);
				Blockbench.showMessageBox({ title: '修改失败', message: String((error && error.message) || error), icon: 'error' });
			}
		},
	}).show();
}

function checkStructure() {
	if (typeof Project === 'undefined' || !Project) return;
	const lines = [];
	const root = (typeof Outliner !== 'undefined' && Outliner && Outliner.root) ? Outliner.root : [];
	const fmt = (v) => '[' + v.map(x => Math.round(x * 1000) / 1000).join(', ') + ']';
	const info = (group) => {
		try {
			const transformation = createExporter().buildTransformation(group, [0, 0, 0]);
			const q = readQuaternion(group);
			const angle = q ? (2 * Math.acos(Math.min(1, Math.abs(q.w))) * 180 / Math.PI).toFixed(1) : '?';
			return '角=' + angle + '° t=' + (transformation ? fmt(transformation.translation) : '[0,0,0]');
		} catch (e) { return 'q=ERR'; }
	};
	const walk = (nodes, depth) => {
		for (const node of nodes) {
			if (!isGroup(node)) continue;
			const type = String(node.imm_type || 'composite').replace(/^minecraft:/, '');
			lines.push('  '.repeat(depth) + '• ' + labelOf(node) + ' [' + type + '] cubes=' + (node.children || []).filter(isCube).length);
			lines.push('  '.repeat(depth + 1) + 'origin=' + fmt(node.origin || [0, 0, 0]) + ' rot=' + fmt(node.rotation || [0, 0, 0]) + ' ' + info(node));
			walk(node.children || [], depth + 1);
		}
	};
	walk(root, 0);
	Blockbench.showMessageBox({ title: '装配结构 / 变换诊断', message: lines.join('\n') || '（没有分组）', icon: 'info' });
}

/* ============================== 注册 ============================== */

function registerProperties() {
	const cond = { formats: [FORMAT_ID] };
	const P = (target, type, name, options) => new Property(target, type, name, Object.assign({ condition: cond, exposed: true }, options));

	P(ModelProject, 'string', 'imm_namespace', { label: '命名空间（namespace）', default: 'custom' });
	P(ModelProject, 'boolean', 'imm_center_pivot', { label: '旋转枢轴用 (0.5,0.5,0.5)（= 像素 8,8,8）', default: false });
	P(ModelProject, 'boolean', 'imm_block_display', { label: '模型附带方块 display 变换', default: true });
	P(ModelProject, 'string', 'imm_pack_path', { label: '合并目标资源包路径', default: '' });

	// 面着色：Blockbench 的 UV 编辑器“着色”开关绑定 Face.properties.tint（默认 -1 表示未着色）
	P(Face, 'number', 'tint', { label: '着色 index', default: -1 });

	P(Group, 'string', 'imm_type', { label: '映射类型（imm_type）', default: 'composite', enum_values: MAPPING_TYPES });
	P(Group, 'string', 'imm_model', { label: '引用模型（imm_model）', default: '' });
	P(Group, 'string', 'imm_property', { label: 'property', default: '' });
	P(Group, 'number', 'imm_index', { label: 'index（仅 range_dispatch：custom_model_data 下标）', default: 0 });
	P(Group, 'number', 'imm_threshold', { label: 'threshold', default: 0 });
	P(Group, 'number', 'imm_scale', { label: 'scale', default: 1 });
	P(Group, 'string', 'imm_tint_type', { label: 'tints 来源类型', default: '', enum_values: ['', 'custom_model_data', 'constant', 'dye', 'potion', 'grass', 'team'] });
	P(Group, 'number', 'imm_tint_index', { label: 'tints 来源 index（custom_model_data）', default: 0 });
	P(Group, 'string', 'imm_tint_value', { label: 'tints 来源值（constant 的 ARGB / 其它 default）', default: '' });
	P(Group, 'string', 'imm_tints', { label: 'tints（JSON，仅 model / composite 自带模型）', default: '' });
}

let menuAttached = false;
function attachGroupMenu() {
	if (menuAttached || !actions.props) return;
	try {
		if (typeof Group !== 'undefined' && Group.prototype && Group.prototype.menu && typeof Group.prototype.menu.addAction === 'function') {
			Group.prototype.menu.addAction(actions.props);
			menuAttached = true;
			console.log('[装配] 已加入分组右键菜单');
		}
	} catch (error) { /* ignore */ }
}

Plugin.register('item_model_definition_assembly', {
	title: '物品模型映射装配',
	author: 'Blockbench',
	icon: 'account_tree',
	description: '新增“物品模型映射装配”格式：每个分组 = 一个 composite/range_dispatch/condition/model 子项，分组变换写入 transformation，可引用 Java 版模型，支持转换项目与直接合并到资源包。',
	version: VERSION,
	variant: 'both',
	min_version: '5.0.0',
	tags: ['Minecraft: Java Edition'],
	contributes: { formats: [FORMAT_ID] },
	onload() {
		registerProperties();

		format_object = new ModelFormat(FORMAT_ID, {
			id: FORMAT_ID,
			name: '物品模型映射装配',
			icon: 'icon-format_block',
			category: 'minecraft',
			target: 'Minecraft: Java Edition',
			description: '按物品模型映射组织分组，导出 assets/<ns>/items/<id>.json',
			show_on_start_screen: true,
			show_in_new_list: true,
			can_convert_to: true,
			box_uv: false,
			optional_box_uv: true,
			single_texture: false,
			per_texture_uv_size: true,
			bone_rig: true,
			centered_grid: false,
			rotate_cubes: true,
			rotation_limit: false,
			rotation_snap: false,
			integer_size: false,
			display_mode: true,
			animation_mode: false,
			euler_order: 'ZYX',
			model_identifier: true,
			parent_model_id: true,
			java_face_properties: true,
			block_size: 16,
			forward_direction: '-z',
		});

		codec_object = new Codec(FORMAT_ID, {
			name: '物品模型映射 (items/*.json)',
			extension: 'json',
			format: format_object,
			remember: false,
			load_filter: { type: 'json', extensions: ['json'] },
			compile: compileAssembly,
		});
		format_object.codec = codec_object;

		const condition = () => (typeof Format !== 'undefined' && Format && Format.id === FORMAT_ID);
		actions.zip = new Action('imm_export_zip', { name: '导出装配资源包 (zip)', description: 'items + models + textures', icon: 'archive', category: 'file', condition, click: exportZip });
		actions.merge = new Action('imm_merge_pack', { name: '合并到资源包…', description: '直接写入资源包并覆盖旧文件', icon: 'folder_open', category: 'file', condition, click: mergeToPack });
		actions.check = new Action('imm_check', { name: '检查装配结构', description: '列出分组类型与变换诊断', icon: 'checklist', category: 'tools', condition, click: checkStructure });
		actions.props = new Action('imm_group_props', { name: '编辑分组映射属性…', description: '映射类型 / 引用模型 / property 等', icon: 'tune', category: 'tools', condition, click: editGroupProps });

		MenuBar.addAction(actions.zip, 'file.export');
		MenuBar.addAction(actions.merge, 'file.export');
		MenuBar.addAction(actions.check, 'tools');
		MenuBar.addAction(actions.props, 'tools');
		attachGroupMenu();
		for (const event of ['select_project', 'finished_loading_project', 'update_selection']) {
			try { Blockbench.on(event, attachGroupMenu); } catch (e) { /* ignore */ }
		}
	},
	onunload() {
		menuAttached = false;
		for (const key of Object.keys(actions)) {
			try { if (actions[key]) actions[key].delete(); } catch (e) { /* ignore */ }
			actions[key] = null;
		}
		if (codec_object) { try { codec_object.delete(); } catch (e) { /* ignore */ } codec_object = null; }
		if (format_object) { try { format_object.delete(); } catch (e) { /* ignore */ } format_object = null; }
	},
});

})();
