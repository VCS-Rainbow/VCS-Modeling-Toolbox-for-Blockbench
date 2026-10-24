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
const VERSION = '0.27.0';
const FACE_KEYS = ['north', 'east', 'south', 'west', 'up', 'down'];
const UNIT = 16;
const CENTER = UNIT / 2;
const MAPPING_TYPES = ['composite', 'model', 'range_dispatch', 'condition', 'select', 'empty'];
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
	for (const key of ['model', 'property', 'index', 'scale', 'tints', 'transformation', 'component', 'ignore_default', 'predicate', 'value', 'keybind', 'target', 'wobble', 'normalize', 'source', 'period', 'remaining']) {
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
	if (Array.isArray(node.cases)) {
		const casePad = pad + '\t\t';
		fields.push('"cases": [\n' + node.cases.map(c => casePad + '{"when": ' + inline(c.when) + ', "model": ' + formatNode(c.model, depth + 2) + '}').join(',\n') + '\n' + padIn + ']');
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

	/** 分支阈值格式：i / i*2 / 10+i*5 / 0,1,3 */
	/**
	 * 分支阈值格式
	 *   i         → 0,1,2…
	 *   2i / i*2  → 0,2,4…
	 *   10+2i     → 10,12,14…
	 *   0,1,3     → 字面列表，超出末尾按 +1 顺延
	 *   2:2i      → 每个值重复 2 次：2,2,4,4,6,6…（冒号前是重复次数/步长）
	 */
	evalThreshold(format, index) {
		let text = String(format == null ? '' : format).replace(/\s+/g, '');
		if (!text) return null;
		let repeat = 1;
		const colon = text.indexOf(':');
		if (colon > 0) {
			const count = Number(text.slice(0, colon));
			if (isFinite(count) && count >= 1) repeat = Math.floor(count);
			text = text.slice(colon + 1);
		}
		if (!text) return null;
		// 带前缀时索引从 1 开始（2:2i → 2,2,4,4,6,6…），无前缀时从 0 开始（i → 0,1,2…）
		const step = repeat > 1 ? Math.floor(index / repeat) + 1 : Math.floor(index / repeat);
		if (text.indexOf(',') >= 0) {
			const list = text.split(',').map(v => Number(v)).filter(v => isFinite(v));
			if (!list.length) return null;
			return step < list.length ? list[step] : list[list.length - 1] + (step - list.length + 1);
		}
		try {
			// 让 2i / 10+2i 这类写法变成合法 JS 表达式
			const js = text.replace(/i/g, '*i').replace(/^\*/, '').replace(/([+\-*/])\*/g, '$1');
			const fn = new Function('i', '"use strict";return (' + js + ');');
			const value = Number(fn(step));
			return isFinite(value) ? value : null;
		} catch (error) { return null; }
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


	/** select 的 when：支持 JSON 数组，或逗号分隔（数字/布尔/字符串） */
	parseWhen(value) {
		const text = String(value == null ? '' : value).trim();
		if (!text) return [];
		if (text.charAt(0) === '[') {
			try { const parsed = JSON.parse(text); if (Array.isArray(parsed)) return parsed; } catch (e) { /* fallthrough */ }
		}
		return text.split(',').map(part => {
			const t = part.trim();
			if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
			if (t === 'true') return true;
			if (t === 'false') return false;
			return t;
		});
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
		if (type === 'model' && group.imm_model) built = { reference: String(group.imm_model).trim(), shift: [0, 0, 0] };
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

		if (type === 'select') {
			const prop = String(group.imm_property || 'custom_model_data').replace(/^minecraft:/, '').trim() || 'custom_model_data';
			node.property = 'minecraft:' + prop;
			if (prop === 'custom_model_data') node.index = clean(num(group.imm_index));
			else if (prop === 'component') node.component = String(group.imm_component || '');
			node.cases = [];
			for (const child of childGroups) {
				const childNode = this.buildNode(child, hint + '_' + sanitizePath(labelOf(child), 'group'), own_shift);
				if (!childNode) continue;
				node.cases.push({ when: this.parseWhen(child.imm_case_when), model: childNode });
			}
			const fallback = built ? { type: 'minecraft:model', model: built.reference } : (extras[0] || null);
			if (fallback) node.fallback = fallback;
			if (!node.cases.length && !node.fallback) return null;
			return node;
		}

		if (type === 'range_dispatch') {
			if (group.imm_tints) this.warn('分组 "' + labelOf(group) + '" 的 tints 只在 model / composite 生效，range_dispatch 已忽略。');
			node.property = String(group.imm_property || 'minecraft:custom_model_data');
			// custom_model_data 必须有 index，未填时默认 0
			if (node.property === 'minecraft:custom_model_data' && node.index === undefined) node.index = 0;
			const numeric = node.property.replace(/^minecraft:/, '');
			if (numeric === 'compass') {
				if (group.imm_range_target) node.target = String(group.imm_range_target);
				if (group.imm_range_wobble === false) node.wobble = false;
			} else if (numeric === 'count' || numeric === 'damage') {
				if (group.imm_range_normalize === false) node.normalize = false;
			} else if (numeric === 'time') {
				if (group.imm_range_source) node.source = String(group.imm_range_source);
				if (group.imm_range_wobble === false) node.wobble = false;
			} else if (numeric === 'use_cycle') {
				const period = num(group.imm_range_period);
				if (period > 0) node.period = clean(period);
			} else if (numeric === 'use_duration') {
				if (group.imm_range_remaining === true) node.remaining = true;
			}
			const scale = num(group.imm_scale);
			if (scale && scale !== 1) node.scale = clean(scale);
			if (String(group.imm_index || '').length) node.index = clean(group.imm_index);
			node.entries = [];
			let branch_index = 0;
			for (const child of childGroups) {
				const childNode = this.buildNode(child, hint + '_' + sanitizePath(labelOf(child), 'group'), own_shift);
				if (!childNode) continue;
				const manual = num(child.imm_threshold);
				const formatted = this.evalThreshold(group.imm_threshold_format, branch_index);
				node.entries.push({ threshold: clean(formatted !== null ? formatted : (manual !== 0 ? manual : branch_index)), model: childNode });
				branch_index++;
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
			const pred = String(group.imm_property || 'minecraft:selected').replace(/^minecraft:/, '').trim() || 'selected';
						node.property = 'minecraft:' + pred;
						if (pred === 'custom_model_data') node.index = clean(num(group.imm_index));
						else if (pred === 'has_component') {
							node.component = String(group.imm_component || '');
							if (group.imm_ignore_default) node.ignore_default = true;
						} else if (pred === 'component') {
							node.predicate = String(group.imm_predicate || '');
							const raw = String(group.imm_value == null ? '' : group.imm_value).trim();
							if (raw.length) { try { node.value = JSON.parse(raw); } catch (e) { node.value = raw; } }
						} else if (pred === 'keybind_down') {
							node.keybind = String(group.imm_keybind || '');
						}
			node.on_true = models[built ? 1 : 0] || { type: 'minecraft:empty' };
			node.on_false = models[built ? 2 : 1] || { type: 'minecraft:empty' };
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

/* 先正常添加（完成注册），再把条目从菜单末尾搬到指定动作之后 */
function placeInFileMenu(action, afterIds) {
	try {
		MenuBar.addAction(action, 'file');
		const menu = MenuBar.menus.file;
		const st = menu.structure;
		const keyOf = (entry) => (typeof entry === 'string') ? entry : (entry && entry.id);
		let from = -1;
		st.forEach((entry, i) => { if (keyOf(entry) === action.id) from = i; });
		if (from < 0) return false;
		const item = st.splice(from, 1)[0];
		let target = -1;
		for (const want of afterIds) {
			st.forEach((entry, i) => { if (keyOf(entry) === want) target = i; });
			if (target >= 0) break;
		}
		if (target < 0) { st.push(item); MenuBar.update(); return false; }
		st.splice(target + 1, 0, item);
		try { MenuBar.update(); } catch (e) { /* ignore */ }
		return true;
	} catch (error) { console.warn('[装配] File 菜单定位失败', error); return false; }
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

const PACK_FORMATS = { '26.2': 71 };
const PACK_VERSION_ID = '26.2';

function readPackMcmeta(fsmod, pathmod, root) {
	try {
		const p = pathmod.join(root, 'pack.mcmeta');
		if (!fsmod.existsSync(p)) return null;
		return JSON.parse(fsmod.readFileSync(p, 'utf8'));
	} catch (e) { return null; }
}

function createPackProject(root) {
	const pathmod = getPath();
	const fsmod = getScopedFs(root);
	if (!pathmod || !fsmod) { Blockbench.showMessageBox({ title: '不支持写入', message: '需要桌面版 Blockbench。', icon: 'warning' }); return false; }
	try {
		const format = PACK_FORMATS[PACK_VERSION_ID] || 71;
		const data = { pack: { pack_format: format, description: ((typeof Project !== 'undefined' && Project && Project.name) ? Project.name : 'Resource Pack') + ' · Blockbench' } };
		fsmod.mkdirSync(root, { recursive: true });
		Blockbench.writeFile(pathmod.join(root, 'pack.mcmeta'), { content: JSON.stringify(data, null, '\t'), savetype: 'text' });
		if (typeof Project !== 'undefined' && Project) { Project.imm_pack_path = root; Project.saved = false; }
		Blockbench.showQuickMessage('已创建资源包工程 pack.mcmeta（pack_format=' + format + '，' + PACK_VERSION_ID + '）', 4000);
		return true;
	} catch (error) {
		Blockbench.showMessageBox({ title: '创建失败', message: String((error && error.message) || error), icon: 'error' });
		return false;
	}
}

async function pickPackPath() {
	const picked = await pickPack();
	if (!picked) return;
	try { Project.imm_pack_path = picked; Project.saved = false; } catch (e) { /* ignore */ }
	const pathmod = getPath();
	const fsmod = getScopedFs(picked);
	if (pathmod && fsmod && !readPackMcmeta(fsmod, pathmod, picked)) {
		Blockbench.showMessageBox({
			title: '不是资源包工程',
			message: '该目录下没有 pack.mcmeta：\n' + picked + '\n\n可以直接为它创建一个。',
			buttons: ['好', '创建 pack.mcmeta'], confirm: 1, cancel: 0,
		}, (button) => { if (button === 1) createPackProject(picked); });
	} else {
		Blockbench.showQuickMessage('资源包工程路径：' + picked, 4000);
	}
}

function chooseOrCreatePack() {
	Blockbench.showMessageBox({
		title: '资源包工程路径',
		message: '尚未设置「资源包工程路径」。\n请选择一个已有的资源包目录，或创建一个新的。',
		buttons: ['取消', '选择…', '创建…'], confirm: 2, cancel: 0,
	}, (button) => {
		if (button === 1) pickPack().then(picked => { if (picked) pickPackPath(); });
		else if (button === 2) pickPack().then(picked => { if (picked && createPackProject(picked)) runMerge(picked); });
	});
}

function mergeToPack() {
	if (typeof Project === 'undefined' || !Project) { Blockbench.showQuickMessage('请先打开项目', 3000); return; }
	const root = String(projectValue('imm_pack_path', '') || '').trim();
	if (!root) { chooseOrCreatePack(); return; }
	const checkPath = getPath();
	const checkFs = getScopedFs(root);
	if (checkPath && checkFs && !readPackMcmeta(checkFs, checkPath, root)) {
		Blockbench.showMessageBox({
			title: '不是资源包工程',
			message: '该目录下没有 pack.mcmeta：\n' + root + '\n\n选择其它目录，或为它创建 pack.mcmeta。',
			buttons: ['取消', '选择…', '创建 pack.mcmeta'], confirm: 2, cancel: 0,
		}, (button) => {
			if (button === 1) pickPack().then(picked => { if (picked) { Project.imm_pack_path = picked; runMerge(picked); } });
			else if (button === 2 && createPackProject(root)) runMerge(root);
		});
		return;
	}
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

/* 把分支编号 / 条件写进子分组名最前方（幂等：先剥掉旧前缀） */
/* 按分支编号/条件重排父分组的子分组（range_dispatch 按阈值升序，condition 按 on_true < on_false） */
/* 新建/拖入/选择变化后，自动重排并编号（防抖，且在输入框聚焦时不打扰） */
let branchSyncTimer = null;
function scheduleBranchSync(target) {
	if (branchSyncTimer) clearTimeout(branchSyncTimer);
	branchSyncTimer = setTimeout(() => {
		branchSyncTimer = null;
		try {
			const active = (typeof document !== 'undefined') ? document.activeElement : null;
			if (active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName || '')) return;
			const group = target || pickTargetGroup();
			if (!group) return;
			const parent = group.parent || null;
			let changed = sortBranchChildren(group) + syncBranchLabels(group);
			if (parent) changed += sortBranchChildren(parent) + syncBranchLabels(parent);
			if (changed) { try { Project.saved = false; Canvas.updateAll(); } catch (e) { /* ignore */ } }
		} catch (error) { /* ignore */ }
	}, 250);
}

function sortBranchChildren(parent) {
	if (!parent || !Array.isArray(parent.children)) return 0;
	const type = String(parent.imm_type || '').replace(/^minecraft:/, '');
	if (type !== 'range_dispatch' && type !== 'condition') return 0;
	const groups = parent.children.filter(isGroup);
	if (groups.length < 2) return 0;
	const keyOf = (child) => {
		if (type === 'condition') {
			const label = String(child.imm_condition || '').toLowerCase();
			if (label === 'on_true' || label === 'on_false') return label === 'on_true' ? 0 : 1;
			return groups.indexOf(child);
		}
		return Number(child.imm_threshold) || 0;
	};
	const sorted = groups.slice().sort((a, b) => keyOf(a) - keyOf(b));
	const unchanged = sorted.every((child, index) => child === groups[index]);
	if (unchanged) return 0;
	const others = parent.children.filter(child => !isGroup(child));
	parent.children.length = 0;
	for (const child of sorted.concat(others)) parent.children.push(child);
	return sorted.length;
}

/* 切换类型时清掉不属于该类型的字段 */
function resetTypeSpecificProps(group, newType) {
	const type = String(newType || '').replace(/^minecraft:/, '');
	const branchTypes = ['condition', 'range_dispatch', 'select'];
	if (type !== 'condition' && type !== 'select') group.imm_condition = '';
	if (type !== 'select') group.imm_case_when = '';
	if (type !== 'range_dispatch') { group.imm_threshold_format = ''; group.imm_threshold = 0; }
	if (type === 'composite' || type === 'model' || type === 'empty') {
		group.imm_property = '';
		group.imm_component = '';
		group.imm_ignore_default = false;
		group.imm_predicate = '';
		group.imm_value = '';
		group.imm_keybind = '';
		group.imm_range_target = '';
		group.imm_range_source = '';
		group.imm_range_period = 1;
		group.imm_range_wobble = true;
		group.imm_range_normalize = true;
		group.imm_range_remaining = false;
	}
	if (type === 'condition') {
		group.imm_range_target = '';
		group.imm_range_source = '';
		group.imm_range_period = 1;
	}
	if (type === 'range_dispatch' || type === 'select') {
		group.imm_component = '';
		group.imm_ignore_default = false;
		group.imm_predicate = '';
		group.imm_value = '';
		group.imm_keybind = '';
	}
	return type;
}

/* 剥掉所有子分组的 [..] / ⚠ 前缀（父分组不再是分支容器时用） */
function stripChildPrefixes(group) {
	let changed = 0;
	for (const child of (group.children || []).filter(isGroup)) {
		const base = String(child.name || '').replace(/^\[[^\]]*\]\s*/, '').replace(/^\u26a0\s*/, '');
		if (base !== child.name) { child.name = base; changed++; }
		if (child.imm_auto_disabled) { child.imm_auto_disabled = false; changed++; }
	}
	return changed;
}

function syncBranchLabels(group) {
	const type = String((group && group.imm_type) || '').replace(/^minecraft:/, '');
	if (type !== 'range_dispatch' && type !== 'condition') return 0;
	const children = (group.children || []).filter(isGroup);
	let exporter = null;
	let changed = 0;
	children.forEach((child, index) => {
		let label = null;
		if (type === 'condition') {
			label = index === 0 ? 'on_true' : (index === 1 ? 'on_false' : null);
		} else if (type === 'select') {
			const when = String(child.imm_case_when || '').trim();
			label = when ? when.replace(/^\[|\]$/g, '').split(',')[0].trim() : ('case' + index);
		} else {
			try { if (!exporter) exporter = createExporter(); } catch (e) { exporter = null; }
			const formatted = exporter ? exporter.evalThreshold(group.imm_threshold_format, index) : null;
			const manual = Number(child.imm_threshold) || 0;
			label = String(formatted !== null ? formatted : (manual !== 0 ? manual : index));
		}
		const base = String(child.name || '').replace(/^\[[^\]]*\]\s*/, '').replace(/^\u26a0\s*/, '');
				// 没有对应标签（例如类型从 range_dispatch 改成 condition）→ 只剥掉旧前缀
				if (label === null) {
						// condition 只输出前两个分支，其余标上 ⚠ 提醒（导出时会被忽略）
						const ignored = type === 'condition' && index >= 2;
						const target = (ignored ? '\u26a0 ' : '') + base;
						if (ignored) {
							if (child.export !== false) { child.export = false; changed++; }
							if (projectValue('imm_hide_unavailable', true) !== false && child.visibility !== false) { child.visibility = false; changed++; }
						} else if (child.export === false && child.imm_auto_disabled) {
							child.export = true; child.imm_auto_disabled = false; changed++;
						}
						if (ignored) child.imm_auto_disabled = true;
						if (target !== child.name) { child.name = target; changed++; }
						return;
					}
		const prefix = '[' + label + '] ';
		const next = prefix + base;
		if (next !== child.name) { child.name = next; changed++; }
	});
	return changed;
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
	const parent = (group && group.parent) || null;
	const parent_type = String((parent && parent.imm_type) || '').replace(/^minecraft:/, '');
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
				label: '映射类型（type）', description: '语法：{"type": "minecraft:<类型>"}\n作用：决定本节点是哪一种物品模型映射。\n可选：composite / model / range_dispatch / condition / empty', type: 'select', value: String(group.imm_type || 'composite'),
				options: { composite: 'composite', model: 'model', range_dispatch: 'range_dispatch', condition: 'condition', select: 'select', empty: 'empty' },
			},
			imm_model: { label: '引用模型（model）', description: '语法：{"type": "minecraft:model", "model": "<命名空间>:item/<路径>"}\n作用：本节点直接引用一个 Java 版模型；\n留空则由本层方块生成模型文件。', type: 'text', value: String(group.imm_model || ''), condition: (r) => r.imm_type === 'model' },
			imm_property: { label: 'property（谓词 / 属性）', type: 'select', value: String(group.imm_property || ''), options: { '': '（未设置）', selected: 'selected', broken: 'broken', damaged: 'damaged', carried: 'carried', extended_view: 'extended_view', using_item: 'using_item', view_entity: 'view_entity', 'fishing_rod/cast': 'fishing_rod/cast', 'bundle/has_selected_item': 'bundle/has_selected_item', custom_model_data: 'custom_model_data', has_component: 'has_component', component: 'component', keybind_down: 'keybind_down', compass: 'compass（range）', count: 'count（range）', damage: 'damage（range）', time: 'time（range）', use_cycle: 'use_cycle（range）', use_duration: 'use_duration（range）', 'bundle/fullness': 'bundle/fullness（range）', cooldown: 'cooldown（range）', 'crossbow/pull': 'crossbow/pull（range）', context_dimension: 'context_dimension（select）', block_state: 'block_state（select）', local_time: 'local_time（select）' }, description: 'condition：谓词（selected / broken / custom_model_data / has_component / component / keybind_down …）；\nrange_dispatch：数值属性（custom_model_data / compass / count / damage / time / use_cycle / use_duration）', condition: (r) => r.imm_type === 'range_dispatch' || r.imm_type === 'condition' },
			imm_component: { label: 'component（has_component 用）', type: 'text', value: String(group.imm_component || ''), description: '语法："component": "minecraft:lodestone_tracker"', condition: (r) => r.imm_property === 'has_component' },
			imm_ignore_default: { label: 'ignore_default', type: 'checkbox', value: !!group.imm_ignore_default, description: 'has_component：组件值与默认值相同时是否视为不存在', condition: (r) => r.imm_property === 'has_component' },
			imm_predicate: { label: 'predicate（component 用）', type: 'text', value: String(group.imm_predicate || ''), description: '语法："predicate": "minecraft:stored_enchantments"', condition: (r) => r.imm_property === 'component' },
			imm_value: { label: 'value（component 用，JSON）', type: 'text', value: String(group.imm_value == null ? '' : group.imm_value), description: '语法："value": [ { ... } ]', condition: (r) => r.imm_property === 'component' },
			imm_keybind: { label: 'keybind（keybind_down 用）', type: 'text', value: String(group.imm_keybind || ''), description: '语法："keybind": "key.jump"', condition: (r) => r.imm_property === 'keybind_down' },			imm_index: { label: '分派下标（index）', description: '语法："index": 0\n作用：仅 range_dispatch，指定从 property 的哪个下标取值。', type: 'number', value: num(group.imm_index), condition: (r) => r.imm_type === 'range_dispatch' },
			imm_threshold_format: { label: '分支编号格式（entries[].threshold）', type: 'text', value: String(group.imm_threshold_format || ''), description: '语法：i → 0,1,2；2i 或 i*2 → 0,2,4；10+2i → 10,12,14；0,1,3 → 字面列表；2:2i → 每个值重复 2 次、索引从 1 起（2,2,4,4,6,6…）。\n作用：range_dispatch 的子分组按顺序取这些阈值；留空为 0,1,2…', condition: (r) => r.imm_type === 'range_dispatch' },
			imm_threshold: { label: '分支编号 / 阈值（entries[].threshold）', type: 'number', value: num(group.imm_threshold), description: '语法：{"threshold": 0}\n作用：父分组为 range_dispatch 时，本分组的阈值；修改后自动按阈值重排。', condition: (r) => r.imm_type === 'range_dispatch' || parent_type === 'range_dispatch' },
			imm_condition: { label: '分支条件（on_true / on_false）', type: 'select', value: String(group.imm_condition || ''), options: { '': '（按位置）', on_true: 'on_true', on_false: 'on_false' }, description: '语法："on_true" / "on_false"\n作用：父分组为 condition 时决定本分支走哪一支；修改后自动重排。', condition: (r) => parent_type === 'condition' },
			imm_scale: { label: '数值缩放（scale）', description: '语法："scale": 1.0\n作用：仅 range_dispatch，property 数值乘以该倍数后再查阈值。', type: 'number', value: num(group.imm_scale) || 1, condition: (r) => r.imm_type === 'range_dispatch' },
						imm_tint_type: { label: '纹理着色类型（tints[].type）', description: '语法："tints": [{"type": "<类型>"}]\n作用：染色来源类型（默认 custom_model_data）。\n可选：custom_model_data / constant / dye / potion / grass / team\n仅“纹理着色索引”非空时生效。', type: 'select', value: String(group.imm_tint_type || 'custom_model_data'), options: { '': '（不生成 tints）', custom_model_data: 'custom_model_data', constant: 'constant', dye: 'dye', potion: 'potion', grass: 'grass', team: 'team' }, description: '纹理着色来源类型；保存为键 imm_tint_type', condition: (r) => r.imm_type === 'model' || r.imm_type === 'composite' },
			imm_range_target: { label: 'compass target', type: 'select', value: String(group.imm_range_target || ''), options: { '': '（未设置）', lodestone: 'lodestone', none: 'none', spawn: 'spawn', recovery: 'recovery' }, description: '语法："target": "spawn"\n作用：compass 必填，指定指南针指向目标。', condition: (r) => r.imm_property === 'compass' },
			imm_range_source: { label: 'time source', type: 'select', value: String(group.imm_range_source || ''), options: { '': '（未设置）', daytime: 'daytime', random: 'random', moon_phase: 'moon_phase' }, description: '语法："source": "daytime"\n作用：time 必填，指定时间来源。', condition: (r) => r.imm_property === 'time' },
			imm_range_wobble: { label: 'wobble（摆动浮动）', type: 'checkbox', value: group.imm_range_wobble !== false, description: '默认 true；关闭后摆动立即平滑到正确值。', condition: (r) => r.imm_property === 'compass' || r.imm_property === 'time' },
			imm_range_normalize: { label: 'normalize（归一化）', type: 'checkbox', value: group.imm_range_normalize !== false, description: '默认 true：返回 0~1 进度而非原始值（count / damage）。', condition: (r) => r.imm_property === 'count' || r.imm_property === 'damage' },
			imm_range_period: { label: 'period（周期）', type: 'number', value: num(group.imm_range_period) || 1, description: '语法："period": 10.0\n作用：use_cycle 的取模周期（>0）。', condition: (r) => r.imm_property === 'use_cycle' },
			imm_range_remaining: { label: 'remaining（用剩余时间）', type: 'checkbox', value: group.imm_range_remaining === true, description: '默认 false；true 时使用剩余使用时间。', condition: (r) => r.imm_property === 'use_duration' },
			imm_align_center: { label: '导入时自动对齐到模型中点', type: 'checkbox', value: group.imm_align_center === true, description: '勾选后导入引用模型时，把模型包围盒中点移到 (8,8,8)，偏移写入本层 translation。', condition: (r) => r.imm_type === 'model' },
			imm_tint_index: { label: '纹理着色索引（tints[].index）', description: '语法："tints": [{"type": "custom_model_data", "index": 0, "default": 0}]\n作用：custom_model_data 的下标。\n留空：不输出 tints，模型不染色。', type: 'text', value: String(group.imm_tint_index == null ? '' : group.imm_tint_index), condition: (r) => (r.imm_type === 'model' || r.imm_type === 'composite') && r.imm_tint_type === 'custom_model_data' },
			imm_tint_value: { label: '纹理着色值（tints[].value / .default）', description: '语法：{"type": "constant", "value": -1} 或 {"type": "dye", "default": -1}\n作用：constant 填 ARGB 整数；\ndye / potion / team 可填默认颜色。', type: 'text', value: String(group.imm_tint_value == null ? '' : group.imm_tint_value), condition: (r) => (r.imm_type === 'model' || r.imm_type === 'composite') && ['constant', 'dye', 'potion', 'team'].indexOf(r.imm_tint_type) >= 0 },
		},
		onConfirm(result) {
			try {
				Undo.initEdit({ groups: [group] });
				group.imm_type = result.imm_type;
				const new_type = resetTypeSpecificProps(group, result.imm_type);
				if (new_type !== 'range_dispatch' && new_type !== 'condition' && new_type !== 'select') stripChildPrefixes(group);
				const previous_model = String(group.imm_model || '').trim();
				if (result.imm_model !== undefined) group.imm_model = result.imm_model;
				const next_model = String(result.imm_model || '').trim();
				if (next_model && next_model !== previous_model) {
					Blockbench.showQuickMessage('引用模型已更新，请用 Tools → 导入引用模型（当前分组）导入几何', 4000);
				}
				if (result.imm_property !== undefined) group.imm_property = result.imm_property;
				if (result.imm_component !== undefined) group.imm_component = result.imm_component;
				if (result.imm_ignore_default !== undefined) group.imm_ignore_default = !!result.imm_ignore_default;
				if (result.imm_predicate !== undefined) group.imm_predicate = result.imm_predicate;
				if (result.imm_value !== undefined) group.imm_value = result.imm_value;
				if (result.imm_keybind !== undefined) group.imm_keybind = result.imm_keybind;
				if (result.imm_range_target !== undefined) group.imm_range_target = result.imm_range_target;
				if (result.imm_range_source !== undefined) group.imm_range_source = result.imm_range_source;
				if (result.imm_range_wobble !== undefined) group.imm_range_wobble = !!result.imm_range_wobble;
				if (result.imm_range_normalize !== undefined) group.imm_range_normalize = !!result.imm_range_normalize;
				if (result.imm_range_period !== undefined) group.imm_range_period = num(result.imm_range_period);
				if (result.imm_range_remaining !== undefined) group.imm_range_remaining = !!result.imm_range_remaining;
				if (result.imm_index !== undefined) group.imm_index = num(result.imm_index);
				if (result.imm_threshold !== undefined) group.imm_threshold = num(result.imm_threshold);
				if (result.imm_threshold_format !== undefined) group.imm_threshold_format = result.imm_threshold_format;
				if (result.imm_condition !== undefined) group.imm_condition = result.imm_condition;
				if (result.imm_scale !== undefined) group.imm_scale = num(result.imm_scale) || 1;
				if (result.imm_tints !== undefined) group.imm_tints = result.imm_tints;
				if (result.imm_align_center !== undefined) group.imm_align_center = !!result.imm_align_center;
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
				// 既处理“本分组是分支容器”（改它的编号格式/子项），也处理“本分组自己是某个分支”（改它的编号）
				const sortedSelf = sortBranchChildren(group);
				const relabelSelf = syncBranchLabels(group);
				const differentParent = parent && parent !== group;
				const sortedParent = differentParent ? sortBranchChildren(parent) : 0;
				const relabelParent = differentParent ? syncBranchLabels(parent) : 0;
				const sortedCount = sortedSelf + sortedParent;
				const relabeled = relabelSelf + relabelParent;
				if (tinted) {
					Project.saved = false;
					try { Canvas.updateAll(); } catch (e) { /* ignore */ }
					try { if (typeof UVEditor !== 'undefined' && UVEditor.updateView) UVEditor.updateView(); } catch (e) { /* ignore */ }
				}
Undo.finishEdit('修改分组映射属性');
				try { Canvas.updateAll(); } catch (e) { /* ignore */ }
				const modelRef = String(group.imm_model || '').trim();
				if (modelRef) {
					const existingCubes = (group.children || []).filter(isCube).length;
					const runImport = () => { try { importModelReference(group); } catch (e) { console.error('[装配] 导入失败', e); } };
					if (existingCubes > 0) {
						Blockbench.showMessageBox({
							title: '该分组已有元素',
							message: '分组 “' + labelOf(group) + '” 里已有 ' + existingCubes + ' 个方块。\n导入引用模型会删除它们并重新导入，是否继续？',
							buttons: ['取消', '继续导入'], confirm: 1, cancel: 0,
						}, (button) => { if (button === 1) runImport(); });
					} else { runImport(); }
				}
				Blockbench.showQuickMessage('已更新 “' + labelOf(group) + '”' + (tinted ? ('，为 ' + tinted + ' 个方块自动勾选着色') : '') + (sortedCount ? ('，重排 ' + sortedCount + ' 个分支') : '') + (relabeled ? ('，更新 ' + relabeled + ' 个分支名') : ''), 2500);
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

/* ============================== 引用模型导入 ============================== */

function readJSONFile(pathmod, fsmod, abs) {
	if (!fsmod.existsSync(abs)) return null;
	try { return JSON.parse(fsmod.readFileSync(abs, 'utf8')); } catch (e) { return null; }
}

/** 解析 ns:path 形式的模型 id -> 磁盘路径 */
function modelPathOf(pathmod, root, reference) {
	const id = String(reference || '').trim().replace(/^minecraft:/, 'minecraft:');
	const parts = id.split(':');
	const ns = parts.length > 1 ? parts[0] : 'minecraft';
	const path = parts.length > 1 ? parts[1] : parts[0];
	return pathmod.join(root, 'assets', ns, 'models', path + '.json');
}

/** 沿 parent 链合并 elements / textures（子模型优先） */
function resolveJavaModel(pathmod, fsmod, root, reference) {
	let current = String(reference || '').trim();
	const seen = {};
	let elements = null;
	const textureRefs = {};
	for (let depth = 0; depth < 12 && current; depth++) {
		if (seen[current]) break;
		seen[current] = true;
		const json = readJSONFile(pathmod, fsmod, modelPathOf(pathmod, root, current));
		if (!json) return { error: '找不到模型文件：' + current + '\n完整路径：' + modelPathOf(pathmod, root, current) + '\n资源包工程：' + root };
		if (!elements && Array.isArray(json.elements)) elements = json.elements;
		for (const key of Object.keys(json.textures || {})) {
			if (!(key in textureRefs)) textureRefs[key] = json.textures[key];
		}
		current = typeof json.parent === 'string' ? json.parent : '';
	}
	if (!elements || !elements.length) return { error: '该模型没有 elements（可能是纯引用模型）' };
	return { elements, textures: textureRefs };
}

/** 'sqsp:item/inker/jet_rifle/sac.full' -> Texture（找不到就按路径加载 PNG） */
function getOrCreateModelTexture(pathmod, fsmod, root, reference) {
	const id = String(reference || '').trim();
	if (!id) return null;
	const parts = id.split(':');
	const ns = parts.length > 1 ? parts[0] : 'minecraft';
	const path = parts.length > 1 ? parts[1] : parts[0];
	const png = pathmod.join(root, 'assets', ns, 'textures', path + '.png');
	const name = path.split('/').pop();
	const all = (typeof Texture !== 'undefined' && Texture.all) ? Texture.all : [];
	const norm = (v) => String(v || "").toLowerCase().replace(/\.png$/, "");
	const wantName = norm(name);
	const existing = all.find(t => { if (!t) return false; if (norm(t.name) === wantName) return true; const p = norm(String(t.path || "").replace(/\\/g, "/")); return p.endsWith("/" + norm(path) + ".png") || p.endsWith("/" + wantName + ".png"); });
	if (existing) return existing;
	if (!fsmod.existsSync(png)) { console.warn('[装配] 纹理不存在：' + png); return null; }
	try {
		const texture = new Texture({ name }).fromPath ? new Texture({ name }) : null;
		if (!texture) return null;
		texture.fromPath(png);
		texture.add(false);
		console.log('[装配] 已加载纹理', name, png);
		return texture;
	} catch (error) {
		console.warn('[装配] 纹理加载失败', png, error);
		return null;
	}
}

/** 把 Java 模型转成方块并放进分组；成功后才清空原有子项 */
let importingModel = false;
let lastImportKey = '';
let lastImportAt = 0;

function importModelReference(group) {
	if (importingModel) { console.warn('[装配] 忽略重复导入（进行中）'); return false; }
	const importKey = String((group && group.uuid) || '') + '|' + String((group && group.imm_model) || '');
	// 冷却已回退：不再按时间拒绝重复导入
	importingModel = true;
	lastImportKey = importKey;
	lastImportAt = Date.now();
	setTimeout(() => { importingModel = false; }, 1200);
	if (!group) return false;
	const reference = String(group.imm_model || '').trim();
	if (!reference) return false;
	const root = String(projectValue('imm_pack_path', '') || '').trim();
	if (!root) {
		Blockbench.showMessageBox({ title: '缺少资源包工程路径', message: '请先在项目设置里指定资源包工程路径（pack.mcmeta 所在目录）。', icon: 'warning' });
		return false;
	}
	const pathmod = getPath();
	const fsmod = getScopedFs(root);
	console.log('[装配] root=', root, '| fs ok=', !!fsmod, '| path ok=', !!pathmod);
	if (!pathmod || !fsmod) { Blockbench.showMessageBox({ title: '无法读取资源包', message: '需要桌面版 Blockbench，且需要授予该目录的读取权限。\n资源包工程：' + root, icon: 'warning' }); console.warn('[装配] fs 模块不可用，root=', root); return false; }
	console.log('[装配] 导入开始', reference, '->', modelPathOf(pathmod, root, reference));
	const resolved = resolveJavaModel(pathmod, fsmod, root, reference);
	console.log('[装配] 解析结果', resolved.error ? ('ERR: ' + resolved.error) : (resolved.elements.length + ' 个 element'));
	if (resolved.error) { Blockbench.showMessageBox({ title: '导入失败', message: resolved.error, icon: 'error' }); return false; }
	const elements = resolved.elements;
	const import_base = Array.isArray(group.origin) ? group.origin : [0, 0, 0];
	try {
		try { if (typeof unselectAll === 'function') unselectAll(); } catch (e) { /* ignore */ }
		Undo.initEdit({ groups: [group], elements: (group.children || []).filter(isCube) });
		// 清空原有子项与方块
		// 确保分组可见（可能被“隐藏不可用分支”关闭过）
		try { group.visibility = true; group.export = true; group.imm_auto_disabled = false; } catch (e) { /* ignore */ }
		let import_holder = group; // 直接导入到目标分组（其 mesh 已初始化）
		// 导入前清空本分组原有元素（保持“替换”语义）
		for (const old_child of (group.children || []).slice()) {
			try { old_child.remove(); } catch (e) { console.warn('[装配] 删除旧元素失败', e); }
		}
		const created = [];
		const textureMap = {};
		for (const key of Object.keys(resolved.textures || {})) {
			const value = String(resolved.textures[key] || '');
			const id = value.charAt(0) === '#' ? (resolved.textures[value.slice(1)] || value) : value;
			textureMap[key] = getOrCreateModelTexture(pathmod, fsmod, root, id);
		}
		const firstTexture = Object.keys(textureMap).map(k => textureMap[k]).find(Boolean) || null;
	elements.forEach((el, index) => {
		if (!el || !Array.isArray(el.from) || !Array.isArray(el.to)) return;
		const cube = new Cube({
			name: (el && el.name ? String(el.name) : ('part_' + index)),
			from: [
				(Number(el.from[0]) || 0) + (Number(import_base[0]) || 0),
				(Number(el.from[1]) || 0) + (Number(import_base[1]) || 0),
				(Number(el.from[2]) || 0) + (Number(import_base[2]) || 0),
			],
			to: [
				(Number(el.to[0]) || 0) + (Number(import_base[0]) || 0),
				(Number(el.to[1]) || 0) + (Number(import_base[1]) || 0),
				(Number(el.to[2]) || 0) + (Number(import_base[2]) || 0),
			],
		}).addTo(group);
		try { if (typeof cube.init === 'function') cube.init(); } catch (e) { console.warn('[装配] cube.init 失败', e); }
		if (typeof Cube !== 'undefined' && Array.isArray(Cube.all) && Cube.all.indexOf(cube) < 0) Cube.all.push(cube);
		try { cube.visibility = true; } catch (e) { /* ignore */ }
		for (const dirKey of Object.keys(cube.faces || {})) {
			if (cube.faces[dirKey]) cube.faces[dirKey].enabled = true;
		}
		if (el.shade === false) cube.shade = false;
		if (el.rotation) {
			const r = el.rotation;
			const o = Array.isArray(r.origin) ? r.origin : [0, 0, 0];
			const bx = Number(import_base[0]) || 0, by = Number(import_base[1]) || 0, bz = Number(import_base[2]) || 0;
			cube.origin = [(Number(o[0]) || 0) + bx, (Number(o[1]) || 0) + by, (Number(o[2]) || 0) + bz];
			if (r.axis) {
				// Java 原版格式：{ axis: "y", angle: 45, origin: [...] }
				const axis = ['x', 'y', 'z'].indexOf(String(r.axis));
				if (axis >= 0) { const rot = [0, 0, 0]; rot[axis] = Number(r.angle) || 0; cube.rotation = rot; }
			} else {
				// Blockbench 导出格式：{ x: 0, y: 0, z: 57.5, origin: [...] }
				cube.rotation = [Number(r.x) || 0, Number(r.y) || 0, Number(r.z) || 0];
			}
		}
		for (const dir of Object.keys(el.faces || {})) {
			const src = el.faces[dir];
			if (!src || !cube.faces[dir]) continue;
			const uv = Array.isArray(src.uv) ? src.uv : [0, 0, 0, 0];
			const texKey = String(src.texture || '').replace(/^#/, '');
			const texture = textureMap[texKey] || firstTexture;
			const scale = (texture && Number(texture.uv_width)) ? (Number(texture.uv_width) / 16) : 1;
			const scaleV = (texture && Number(texture.uv_height)) ? (Number(texture.uv_height) / 16) : scale;
			cube.faces[dir].uv = [
				(Number(uv[0]) || 0) * scale, (Number(uv[1]) || 0) * scaleV,
				(Number(uv[2]) || 0) * scale, (Number(uv[3]) || 0) * scaleV,
			];
			if (texture) cube.faces[dir].texture = texture.uuid;
			if (src.rotation) cube.faces[dir].rotation = Number(src.rotation) || 0;
			if (src.cullface) cube.faces[dir].cullface = String(src.cullface);
		}
		if (created.length === 0) {
			const keys = Object.keys(cube.faces || {});
			console.log("[装配] 首个方块", JSON.stringify({ from: cube.from, to: cube.to, faceKeys: keys, enabled: keys.map(k => cube.faces[k].enabled), texture: keys.map(k => cube.faces[k].texture), uv: keys.map(k => cube.faces[k].uv) }));
		}
		created.push(cube);
	});
		// 自动对齐：把模型包围盒中点移到 (8,8,8)，偏移写进本层 translation
		if (group.imm_align_center === true && created.length) {
			const min = [Infinity, Infinity, Infinity];
			const max = [-Infinity, -Infinity, -Infinity];
			for (const cube of created) {
				for (let a = 0; a < 3; a++) {
					const lo = Math.min(cube.from[a], cube.to[a]);
					const hi = Math.max(cube.from[a], cube.to[a]);
					if (lo < min[a]) min[a] = lo;
					if (hi > max[a]) max[a] = hi;
				}
			}
			group.imm_offset = [0, 1, 2].map(a => (min[a] + max[a]) / 2 - 8);
		} else {
			group.imm_offset = [0, 0, 0];
		}
		Undo.finishEdit('导入引用模型');
		try { if (typeof unselectAll === 'function') unselectAll(); } catch (e) { /* ignore */ }
		try { Canvas.updateView({ elements: created, element_aspects: { faces: true, uv: true } }); } catch (e) { /* ignore */ }
		try { Canvas.updateAll(); } catch (e) { /* ignore */ }
		Blockbench.showQuickMessage('已导入 ' + created.length + ' 个方块（' + reference + '）', 4000);
		return true;
	} catch (error) {
		console.error('[装配] 导入失败', error);
		Blockbench.showMessageBox({ title: '导入失败', message: String((error && error.message) || error), icon: 'error' });
		return false;
	}
}

/* ============================== 模拟输入面板 ============================== */

let sim_panel = null;
let sim_ui = null;

function buildSimPanel(show_panel) {
	if (sim_panel) { if (show_panel !== false) sim_panel.show(); return sim_panel; }
	if (typeof Panel === 'undefined') return null;
	if (typeof document === 'undefined') return null;
	sim_panel = new Panel('imm_sim_panel', {
		name: '模拟输入',
		icon: 'play_circle',
		condition: { formats: [FORMAT_ID] },
		default_position: { slot: 'right_bar', float: false },
		resizable: true,
		growable: true,
	});
	const root = document.createElement('div');
	root.style.cssText = 'padding:8px;display:flex;flex-direction:column;gap:6px;font-size:12px;overflow:auto;height:100%';
	const mk = (tag, props, style) => { const el = document.createElement(tag); Object.assign(el, props || {}); if (style) el.style.cssText = style; return el; };
	const row = (label, control) => { const wrap = mk('div', {}, 'display:flex;align-items:center;gap:6px'); wrap.appendChild(mk('span', { textContent: label }, 'width:96px;flex:0 0 auto')); wrap.appendChild(control); return wrap; };
	const propSel = mk('select', {}); ['custom_model_data', 'selected'].forEach(v => propSel.appendChild(mk('option', { value: v, textContent: v })));
	const indexInp = mk('input', { type: 'number', value: '0' }, 'width:70px');
	const valueInp = mk('input', { type: 'number', value: '0', step: '0.5' }, 'width:80px');
	const autoChk = mk('input', { type: 'checkbox' });
	const periodInp = mk('input', { type: 'number', value: '800' }, 'width:70px');
	const stepInp = mk('input', { type: 'number', value: '0.5', step: '0.1' }, 'width:70px');
	const ruleSel = mk('select', {}); [['pingpong', '往复'], ['wrap', '循环']].forEach(([v, t]) => ruleSel.appendChild(mk('option', { value: v, textContent: t })));
	const minInp = mk('input', { type: 'number', value: '0' }, 'width:70px');
	const maxInp = mk('input', { type: 'number', value: '4' }, 'width:70px');
	const runBtn = mk('button', { textContent: '运行 / 停止' }, 'padding:4px 8px');
	const out = mk('div', {}, 'white-space:pre-wrap;font-family:monospace;font-size:11px;opacity:.85;flex:1 1 auto;overflow:auto;border-top:1px solid rgba(128,128,128,.3);padding-top:6px');
	root.appendChild(row('取值来源', propSel));
	root.appendChild(row('下标 index', indexInp));
	root.appendChild(row('数值', valueInp));
	root.appendChild(row('自动变化', autoChk));
	root.appendChild(row('周期(ms)', periodInp));
	root.appendChild(row('步长', stepInp));
	root.appendChild(row('规则', ruleSel));
	root.appendChild(row('下限', minInp));
	root.appendChild(row('上限', maxInp));
	root.appendChild(runBtn);
	root.appendChild(out);
	sim_ui = { propSel, indexInp, valueInp, autoChk, periodInp, stepInp, ruleSel, minInp, maxInp, out };
	runBtn.addEventListener('click', () => toggleSim());
	// Panel 的内容容器是 panel.node（DOM），不是 nodes 数组
	sim_panel.node.innerHTML = '';
	sim_panel.node.appendChild(root);
	try { if (typeof Panels !== 'undefined' && Panels) Panels[sim_panel.id] = sim_panel; } catch (e) { /* ignore */ }
	if (show_panel !== false) sim_panel.show();
	return sim_panel;
}

function simTick() {
	if (!sim_ui) return;
	let mapping = null;
	try { mapping = createExporter().buildMapping(); } catch (error) { sim_ui.out.textContent = '无法生成映射：' + ((error && error.message) || error); return; }
	const index = Math.max(0, num(sim_ui.indexInp.value));
	const prop = sim_ui.propSel.value;
	sim.inputs.floats = sim.inputs.floats || [];
	if (prop === 'selected') sim.inputs.selected = num(sim_ui.valueInp.value) > 0;
	else sim.inputs.floats[index] = num(sim_ui.valueInp.value);
	const items = simEvaluate(mapping.model, sim.inputs);
	const hits = items.filter(item => item.hit).map(item => item.node.model).filter(Boolean);
	const lines = [];
	lines.push(prop === 'selected' ? ('selected = ' + sim.inputs.selected) : ('floats[' + index + '] = ' + sim.inputs.floats[index]));
	lines.push('命中 ' + hits.length + ' 个模型，总共 ' + items.length + ' 个分支');
	lines.push('');
	for (const item of items) {
		const name = item.node.model || item.node.type;
		lines.push((item.hit ? '  ✔ ' : '  ✘ ') + name);
	}
	sim_ui.out.textContent = lines.join('\n');
}

function toggleSim() {
	if (sim.timer) { clearInterval(sim.timer); sim.timer = null; sim_ui.out.textContent += '\n(已停止自动变化)'; return; }
	simTick();
	if (!sim_ui.autoChk.checked) return;
	const period = Math.max(80, num(sim_ui.periodInp.value) || 800);
	const stepValue = num(sim_ui.stepInp.value) || 0.5;
	const min = num(sim_ui.minInp.value);
	const max = num(sim_ui.maxInp.value);
	let dir = 1;
	sim.timer = setInterval(() => {
		try {
			let value = num(sim_ui.valueInp.value) + stepValue * dir;
			if (sim_ui.ruleSel.value === 'wrap') { if (value > max) value = min; }
			else { if (value > max) { value = max; dir = -1; } if (value < min) { value = min; dir = 1; } }
			sim_ui.valueInp.value = String(value);
			simTick();
		} catch (error) { /* ignore */ }
	}, period);
}


/* ============================== 模拟输入 ============================== */

const sim = { timer: null, value: 0, dir: 1, inputs: { floats: [0, 0, 0, 0, 0, 0, 0, 0], selected: false, damage: 0, use_remainder: false } };

function simValue(node, inputs) {
	const type = String((node && node.type) || '').replace(/^minecraft:/, '');
	const prop = String((node && node.property) || '').replace(/^minecraft:/, '');
	const index = Number(node && node.index) || 0;
	let value = 0;
	if (prop === 'custom_model_data') value = Number((inputs.floats || [])[index] || 0);
	else if (prop === 'selected') value = inputs.selected ? 1 : 0;
	else value = Number(inputs[prop] || 0);
	if (node && node.scale) value *= Number(node.scale);
	return value;
}

/** 按输入求值整棵映射树，返回 [{ node, hit }]（hit=false 表示该分支被条件挡掉） */
function simEvaluate(node, inputs, allowOutside) {
	const result = [];
	if (!node) return result;
	const type = String(node.type || '').replace(/^minecraft:/, '');
	if (type === 'composite') {
		for (const child of node.models || []) result.push(...simEvaluate(child, inputs, allowOutside));
		return result;
	}
	if (type === 'range_dispatch') {
		const value = simValue(node, inputs);
		let best = null;
		for (const entry of node.entries || []) {
			const threshold = Number(entry.threshold);
			if (threshold <= value && (!best || threshold >= Number(best.threshold))) best = entry;
		}
		for (const entry of node.entries || []) {
			const isBest = best === entry;
			for (const item of simEvaluate(entry.model, inputs, allowOutside)) result.push({ node: item.node, hit: item.hit && isBest });
		}
		if (best && node.fallback) for (const item of simEvaluate(node.fallback, inputs, allowOutside)) result.push({ node: item.node, hit: item.hit });
		return result;
	}
	if (type === 'condition') {
		const prop = String(node.property || 'minecraft:selected').replace(/^minecraft:/, '');
		const ok = prop === 'selected' ? !!inputs.selected : !!inputs[prop];
		for (const item of simEvaluate(ok ? node.on_true : node.on_false, inputs, allowOutside)) result.push({ node: item.node, hit: item.hit && ok });
		return result;
	}
	if (type === 'model') { result.push({ node, hit: true }); return result; }
	return result;
}

function openSimulator() {
	if (typeof Project === 'undefined' || !Project) return;
	const inputs = sim.inputs;
	let mapping = null;
	try { mapping = createExporter().buildMapping(); } catch (error) {
		Blockbench.showMessageBox({ title: '无法生成映射', message: String((error && error.message) || error), icon: 'error' });
		return;
	}
	new Dialog({
		id: 'imm_simulator',
		title: '模拟输入 — 预览分支命中',
		width: 720,
		form: {
			prop: { label: '取值来源 / 条件（property / when）', type: 'select', value: 'custom_model_data', options: { custom_model_data: 'custom_model_data', selected: 'selected' }, description: '决定用哪个输入值参与判断' },
			index: { label: '下标（index）', type: 'number', value: 0, description: 'custom_model_data 的 floats 下标' },
			value: { label: '数值', type: 'number', value: 0, description: '模拟的输入值' },
			auto: { label: '自动变化', type: 'checkbox', value: false, description: '按周期自动增减数值，实时预览' },
			period: { label: '周期（毫秒）', type: 'number', value: 800, description: '自动变化的间隔' },
			step: { label: '步长', type: 'number', value: 0.5, description: '每次变化量' },
			rule: { label: '规则', type: 'select', value: 'pingpong', options: { pingpong: '往复（到端点反向）', wrap: '循环（回到起点）' } },
			min: { label: '下限', type: 'number', value: 0 },
			max: { label: '上限', type: 'number', value: 4 },
		},
		onConfirm(result) {
			if (sim.timer) { clearInterval(sim.timer); sim.timer = null; }
			inputs.floats = inputs.floats || [];
			const index = Math.max(0, num(result.index));
			inputs.selected = false;
			const applying = (value) => {
				if (result.prop === 'selected') inputs.selected = Number(value) > 0;
				else inputs.floats[index] = Number(value);
				const hits = simEvaluate(mapping.model, inputs).filter(item => item.hit).map(item => item.node.model).filter(Boolean);
				return hits;
			};
			if (!result.auto) {
				const hits = applying(result.value);
				Blockbench.showMessageBox({
					title: '模拟结果',
					message: (result.prop === 'selected' ? 'selected = ' + (Number(result.value) > 0) : 'floats[' + index + '] = ' + result.value) + '\n\n命中的模型（' + hits.length + '）\n' + (hits.length ? hits.join('\n') : '（无）'),
					icon: 'info',
				});
				return;
			}
			let value = Number(result.value);
			let direction = 1;
			const period = Math.max(80, num(result.period) || 800);
			const stepValue = num(result.step) || 0.5;
			const min = num(result.min);
			const max = num(result.max);
			sim.timer = setInterval(() => {
				try {
					value += stepValue * direction;
					if (result.rule === 'wrap') { if (value > max) value = min; }
					else { if (value > max) { value = max; direction = -1; } if (value < min) { value = min; direction = 1; } }
					const hits = applying(value);
					Blockbench.showQuickMessage('模拟 ' + (result.prop === 'selected' ? 'selected=' + (Number(value) > 0) : 'floats[' + index + ']=' + value.toFixed(2)) + ' → 命中 ' + hits.length + ' 个模型', period - 50);
				} catch (error) { /* ignore */ }
			}, period);
			Blockbench.showQuickMessage('已开始自动模拟（再次执行可停止）', 3000);
		},
	}).show();
}


/* ============================== 注册 ============================== */

function registerProperties() {
	const cond = { formats: [FORMAT_ID] };
	const P = (target, type, name, options) => new Property(target, type, name, Object.assign({ condition: cond, exposed: true }, options));

	P(ModelProject, 'string', 'imm_namespace', { label: '命名空间（namespace）', default: 'custom' });
	P(ModelProject, 'boolean', 'imm_center_pivot', { label: '旋转枢轴用 (0.5,0.5,0.5)（= 像素 8,8,8）', default: false });
	P(ModelProject, 'boolean', 'imm_block_display', { label: '模型附带方块 display 变换', default: true });
	P(ModelProject, 'boolean', 'imm_hide_unavailable', { label: '隐藏当前条件下不可用的分组', default: true });
	P(ModelProject, 'string', 'imm_pack_path', { label: '资源包工程路径（pack.mcmeta 所在目录）', default: '' });

	// 面着色：Blockbench 的 UV 编辑器“着色”开关绑定 Face.properties.tint（默认 -1 表示未着色）
	P(Face, 'number', 'tint', { label: '着色 index', default: -1 });

	P(Group, 'string', 'imm_type', { label: '映射类型（type）', description: '语法：{"type": "minecraft:<类型>"}\n作用：决定本节点是哪一种物品模型映射。\n可选：composite / model / range_dispatch / condition / empty', default: 'composite', enum_values: MAPPING_TYPES });
	P(Group, 'string', 'imm_model', { label: '引用模型（imm_model）', default: '' });
	P(Group, 'string', 'imm_property', { label: '取值来源 / 条件（property / when）', default: '' });
	P(Group, 'number', 'imm_index', { label: 'index（仅 range_dispatch：custom_model_data 下标）', default: 0 });
	P(Group, 'string', 'imm_range_target', { label: 'compass target', default: '' });
	P(Group, 'string', 'imm_range_source', { label: 'time source', default: '' });
	P(Group, 'boolean', 'imm_range_wobble', { label: 'wobble', default: true });
	P(Group, 'boolean', 'imm_range_normalize', { label: 'normalize', default: true });
	P(Group, 'number', 'imm_range_period', { label: 'period', default: 1 });
	P(Group, 'boolean', 'imm_range_remaining', { label: 'remaining', default: false });
	P(Group, 'string', 'imm_component', { label: 'component', default: '' });
	P(Group, 'boolean', 'imm_align_center', { label: '引用模型导入时自动对齐到模型中点', default: false });
	P(Group, 'boolean', 'imm_ignore_default', { label: 'ignore_default', default: false });
	P(Group, 'string', 'imm_predicate', { label: 'predicate', default: '' });
	P(Group, 'string', 'imm_value', { label: 'value', default: '' });
	P(Group, 'string', 'imm_keybind', { label: 'keybind', default: '' });
	P(Group, 'string', 'imm_condition', { label: '分支条件（on_true/on_false）', default: '' });
	P(Group, 'string', 'imm_threshold_format', { label: '分支编号格式', description: 'i / i*2 / 10+i*5 / 0,1,3', default: '' });
	P(Group, 'number', 'imm_threshold', { label: '分支编号 / 阈值（entries[].threshold）', default: 0 });
	P(Group, 'number', 'imm_scale', { label: '数值缩放（scale）', default: 1 });
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
		console.log('[装配] onload 开始，版本 ' + VERSION);
		try {
		const addMenu = (action, path) => {
			try { if (action) MenuBar.addAction(action, path); }
			catch (error) { console.warn('[装配] 菜单挂载失败：' + path, error); }
		};
		try { registerProperties(); } catch (error) { console.error('[装配] 属性注册失败', error); }

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
			// 以下对齐 Java Block/Item 格式的软件内渲染参数
			render_sides: 'front',
			cullfaces: true,
			uv_rotation: true,
			java_cube_shading_properties: true,
			vertex_color_ambient_occlusion: true,
			cube_size_limiter: {
				coordinate_limits: [-16, 32],
				test(cube, options) {
					const opt = options || {};
					const from = opt.from || cube.from;
					const to = opt.to || cube.to;
					const inflate = opt.inflate == null ? cube.inflate : opt.inflate;
					return from.find((value, axis) => to[axis] + inflate > 32 || to[axis] + inflate < -16 || from[axis] - inflate > 32 || from[axis] - inflate < -16) !== undefined;
				},
				move(cube, options) {
					const opt = options || {};
					const from = opt.from || cube.from;
					const to = opt.to || cube.to;
					const inflate = opt.inflate == null ? cube.inflate : opt.inflate;
					[0, 1, 2].forEach(axis => {
						const over = to[axis] + inflate - 32;
						if (over > 0) {
							from[axis] -= over; to[axis] -= over;
							if (16 + from[axis] - inflate < 0) from[axis] = -16 + inflate;
						} else {
							const under = from[axis] - inflate + 16;
							if (under < 0) {
								from[axis] -= under; to[axis] -= under;
								if (to[axis] + inflate > 32) to[axis] = 32 - inflate;
							}
						}
					});
				},
				clamp(cube, options) {
					const opt = options || {};
					const from = opt.from || cube.from;
					const to = opt.to || cube.to;
					const inflate = opt.inflate == null ? cube.inflate : opt.inflate;
					[0, 1, 2].forEach(axis => {
						from[axis] = Math.min(32 - inflate, Math.max(-16 + inflate, from[axis]));
						to[axis] = Math.min(32 - inflate, Math.max(-16 + inflate, to[axis]));
					});
				},
			},
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
		actions.import = new Action('imm_import_model', { name: '导入引用模型（当前分组）', description: '按 imm_model 从资源包工程导入 Java 模型为方块', icon: 'file_download', category: 'tools', condition: () => (typeof Format !== 'undefined' && Format && Format.id === FORMAT_ID), click: () => { const g = pickTargetGroup(); if (!g) { Blockbench.showMessageBox({ title: '请先选中分组', message: '先在 outliner 里选中一个分组。', icon: 'info' }); return; } if (!String(g.imm_model || '').trim()) { Blockbench.showMessageBox({ title: '没有引用模型', message: '该分组没有填写 imm_model（引用模型）。', icon: 'info' }); return; } importModelReference(g); } });
		actions.check = new Action('imm_check', { name: '检查装配结构', description: '列出分组类型与变换诊断', icon: 'checklist', category: 'tools', condition, click: checkStructure });
		actions.pack = new Action('imm_pick_pack', { name: '选择资源包工程路径…', description: '打开系统文件夹选择框，设为资源包工程目录', icon: 'folder_open', category: 'file', condition: () => (typeof Format !== 'undefined' && Format && Format.id === FORMAT_ID), click: pickPackPath });
		actions.sim = new Action('imm_simulate', { name: '模拟输入…', description: '按 custom_model_data / selected 预览分支命中', icon: 'play_circle', category: 'tools', condition: () => (typeof Format !== 'undefined' && Format && Format.id === FORMAT_ID), click: () => { const panel = buildSimPanel(false); if (panel) { panel.show(); return; } openSimulator(); } });
		actions.props = new Action('imm_group_props', { name: '编辑分组映射属性…', description: '映射类型 / 引用模型 / property 等', icon: 'tune', category: 'tools', condition, click: editGroupProps });

		addMenu(actions.zip, 'file.export');
		addMenu(actions.merge, 'file.export');
		placeInFileMenu(actions.pack, ['save_model', 'export', 'import']);
		
		addMenu(actions.check, 'tools');
		addMenu(actions.import, 'tools');
		addMenu(actions.props, 'tools');
		try { buildSimPanel(false); } catch (e) { console.warn('[装配] 面板创建失败（可忽略）', e); }
		// 面板会自动出现在「视图 → 面板」里，不再占用 Tools 菜单
		attachGroupMenu();
		for (const event of ['add_group', 'remove_group', 'update_selection']) {
			try { Blockbench.on(event, (data) => scheduleBranchSync(data && data.object)); } catch (e) { /* ignore */ }
		}
		for (const event of ['select_project', 'finished_loading_project', 'update_selection']) {
			try { Blockbench.on(event, attachGroupMenu); } catch (e) { /* ignore */ }
		}
			} catch (error) {
			console.error('[装配] onload 失败：', error);
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
