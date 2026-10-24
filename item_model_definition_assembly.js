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
const VERSION = '0.62.4';
const FACE_KEYS = ['north', 'east', 'south', 'west', 'up', 'down'];
const UNIT = 16;
const CENTER = UNIT / 2;
const MAPPING_TYPES = ['composite', 'inline', 'model', 'range_dispatch', 'condition', 'select', 'empty'];
const MANIFEST = '.imm-assembly-manifest.json';

const ITEM_DISPLAY = {
	thirdperson_righthand: { rotation: [0, 0, 0], translation: [0, 3, 1], scale: [0.55, 0.55, 0.55] },
	thirdperson_lefthand: { rotation: [0, 0, 0], translation: [0, 3, 1], scale: [0.55, 0.55, 0.55] },
	firstperson_righthand: { rotation: [0, -135, 25], translation: [0, 4, 2], scale: [1.7, 1.7, 1.7] },
	firstperson_lefthand: { rotation: [0, 135, -25], translation: [0, 4, 2], scale: [1.7, 1.7, 1.7] },
	ground: { rotation: [0, 0, 0], translation: [0, 2, 0], scale: [0.5, 0.5, 0.5] },
	gui: { rotation: [0, 0, 0], translation: [0, 0, 0], scale: [1, 1, 1] },
	fixed: { rotation: [0, 0, 0], translation: [0, 0, 0], scale: [1, 1, 1] },
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
const isLocator = (node) => typeof Locator !== 'undefined' && node instanceof Locator;
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
		this.groupNodes = new Map(); // 映射节点 → 来源分组（视图联动用，不参与导出）
		this.groupNodeCache = new Map(); // 分组 → 已构建的映射节点（复调用克隆用）
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

/** 从贴图文件路径解析 assets/<namespace>/textures/<path>.png；解析不到则用贴图名 */
	textureLocation(texture) {
		const rawPath = String((texture && (texture.path || texture.file_path)) || '').replace(/\\/g, '/');
		const match = rawPath.match(/(?:^|\/)assets\/([^/]+)\/textures\/(.+?)\.png$/i);
		if (match) {
			return { namespace: sanitizeNamespace(match[1]), path: sanitizePath(match[2], 'texture') };
		}
		const folder = String((texture && texture.folder) || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
		const base = sanitizePath(String((texture && texture.name) || 'texture').replace(/\.png$/i, ''), 'texture');
		return { namespace: this.namespace, path: (folder ? sanitizePath(folder, 'texture') + '/' : '') + base };
	}

	textureRef(texture) {
		if (this.textureRefs.has(texture)) return this.textureRefs.get(texture);
		const location = this.textureLocation(texture);
		const base = sanitizePath(String(location.path || 'texture').split('/').pop(), 'texture');
		const name = this.unique(base, this.textureNames);
		const ref = location.namespace + ':' + location.path;
		this.textureRefs.set(texture, ref);
		this.textures.push({ name, texture, namespace: location.namespace, path: location.path });
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

		const outside = elements.filter(el => el.from.concat(el.to).some(v => v < -16 - 1e-6 || v > 32 + 1e-6));
		if (outside.length) this.warn('模型 “' + (hint || 'part') + '” 有 ' + outside.length + ' 个元素居中后仍超出 -16~32；请检查该分组的枢轴/旋转（源数据可能已被异常变换）');

		const textures = {};
		let particle = null;
		for (const [texture, key] of order) {
			const ref = this.textureRef(texture);
			textures[key] = ref;
			if (!particle) particle = ref;
		}
		if (particle) textures.particle = particle;

		const model = { textures, elements };
		if (this.blockDisplay) model.display = JSON.parse(JSON.stringify(ITEM_DISPLAY));

		const name = this.unique(sanitizePath(this.stem + '_' + (hint || 'part'), 'model'), this.modelNames);
		this.models.push({ name, data: model });
		return { reference: this.namespace + ':item/' + name, shift };
	}

	/**
	 * 分组/方块 → transformation
	 * 元素已平移 d（d = 包围盒中点 − (8,8,8)），原始坐标 p = p′ + d：
	 *   p′ → R·(p′ + d − O) + O = R·p′ + [R·d + O − R·O]
	 * translation = 常数项（单位：1/16 格，与模型 display.translation 一致）；枢轴 = O（原点模式）或 O − (8,8,8)（中心模式）
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
			translation: cleanAll([0, 1, 2].map(a => rd[a] + pivot[a] - rp[a] - dp[a])),
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
		// 明确选择“不生成 tints”（空字符串）时直接退出；只有从未设置（undefined）才按默认 custom_model_data
		if (group.imm_tint_type === '' || group.imm_tint_type === 'none') return null;
		const index = Number(index_text);
		const type = (String(group.imm_tint_type == null ? 'custom_model_data' : group.imm_tint_type).replace(/^minecraft:/, '').trim()) || 'custom_model_data';
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
		if (cube && cube.parent && isGroup(cube.parent)) this.groupNodes.set(node, cube.parent);
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
		if (type === 'model' && group.imm_model) {
			let shift = [0, 0, 0];
			try {
				const parsed = JSON.parse(String(group.imm_model_shift || ''));
				if (Array.isArray(parsed) && parsed.length === 3 && parsed.every(v => isFinite(Number(v)))) shift = parsed.map(Number);
			} catch (e) { /* ignore */ }
			built = { reference: String(group.imm_model).trim(), shift };
		}
		else if (inlineCubes.length) built = this.addModel(inlineCubes, hint);

		// inline（内联模型）在导出结构里等同于 composite：自身方块烘焙成模型，子分组各自输出
		const outputType = type === 'inline' ? 'composite' : type;
		const node = { type: 'minecraft:' + outputType };
		try { this.groupNodes.set(node, group); } catch (e) { /* ignore */ }
		try { this.groupNodeCache.set(group, node); } catch (e) { /* ignore */ }
		const own_shift = built ? built.shift : [0, 0, 0];
		const transformation = this.buildTransformation(group, own_shift, parent_shift);
		if (transformation) node.transformation = transformation;

		const extras = ownCubes.map(cube => this.buildCubeNode(cube, hint, parent_shift)).filter(Boolean);
		const calls = children.filter(isLocator).map(locator => this.buildCallNode(locator)).filter(Boolean);
		if (calls.length && type !== 'composite' && type !== 'inline') {
			this.warn('复调用标签只支持放在 composite / inline 分组里，已忽略 ' + calls.length + ' 个。');
			calls.length = 0;
		}

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
			if (fallback) { this.groupNodes.set(fallback, group); node.fallback = fallback; }
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
			if (fallback) { this.groupNodes.set(fallback, group); node.fallback = fallback; }
			if (!node.entries.length && !node.fallback) return null;
			return node;
		}

		const models = [];
		const tints = this.buildTints(group);
				if (built) {
					const model_node = { type: 'minecraft:model', model: built.reference };
					if (tints) model_node.tints = tints;
					this.groupNodes.set(model_node, group);
					models.push(model_node);
				} else if (tints) {
					this.warn('分组 "' + labelOf(group) + '" 设置了 tints 但没有自己的模型，已忽略。');
				}
		for (const extra of extras) models.push(extra);
		for (const call of calls) models.push(call);
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


	/** 定位点 → 复调用节点：指向分组时先占位，构建完成后克隆目标节点 */
	buildCallNode(locator) {
		const target = String((locator && locator.imm_call_target) || '').trim();
		if (!target) return null;
		if (target.indexOf(':') >= 0) return { type: 'minecraft:model', model: target };
		let group = null;
		try { if (typeof Group !== 'undefined' && Array.isArray(Group.all)) group = Group.all.find(g => g && g.uuid === target) || null; } catch (e) { /* ignore */ }
		if (!group) { this.warn('复调用标签 “' + labelOf(locator) + '” 找不到目标分组：' + target); return null; }
		return { type: 'minecraft:empty', __imm_call_group: group };
	}

	/** 把占位替换为目标分组的映射节点（深拷贝，保留 transformation） */
	resolveCallPlaceholders(node) {
		if (!node || typeof node !== 'object') return;
		if (Array.isArray(node)) {
			for (let i = node.length - 1; i >= 0; i--) {
				const item = node[i];
				if (item && typeof item === 'object' && item.__imm_call_group) {
					const target = this.groupNodeCache ? this.groupNodeCache.get(item.__imm_call_group) : null;
					if (!target) { this.warn('复调用目标没有可导出的映射节点，已跳过。'); node.splice(i, 1); continue; }
					const clone = JSON.parse(JSON.stringify(target));
					this.stripCallPlaceholders(clone);
					node[i] = clone;
				} else this.resolveCallPlaceholders(item);
			}
			return;
		}
		for (const key of Object.keys(node)) {
			const value = node[key];
			if (value && typeof value === 'object') this.resolveCallPlaceholders(value);
		}
	}

	/** 克隆体内残留的复调用占位改成 empty，避免自引用无限展开 */
	stripCallPlaceholders(node) {
		if (!node || typeof node !== 'object') return;
		if (Array.isArray(node)) {
			for (let i = node.length - 1; i >= 0; i--) {
				const item = node[i];
				if (item && typeof item === 'object' && item.__imm_call_group) node[i] = { type: 'minecraft:empty' };
				else this.stripCallPlaceholders(item);
			}
			return;
		}
		for (const key of Object.keys(node)) {
			const value = node[key];
			if (value && typeof value === 'object') this.stripCallPlaceholders(value);
		}
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
			} else if (isLocator(node)) {
				const call = this.buildCallNode(node);
				if (call) models.push(call);
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
							translation: cleanAll(built.shift),
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
		const result = { model: { type: 'minecraft:composite', models } };
		this.resolveCallPlaceholders(result.model);
		return result;
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
					const textureNamespace = texture.namespace || this.namespace;
					const texturePath = texture.path || ('item/' + texture.name);
					files.push({ path: 'assets/' + textureNamespace + '/textures/' + texturePath + '.png', data: source.slice(comma + 1), base64: true });
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

/* 资源包格式表：数值来自 minecraft.wiki（Pack_format / Template:Resource pack format），2026-10-24 校对。
 * 1.21.9 起（25w31a，resource 65.0）pack.mcmeta 改用 min_format / max_format；更早的版本用 pack_format。
 * major >= 65 视为新版格式。minor 为 0 时按整数写（等价于 [major,0]）。 */
const PACK_VERSIONS = [
	{ id: '26.3', major: 97, minor: 1 },
	{ id: '26.2', major: 88, minor: 0 },
	{ id: '26.1.2', major: 84, minor: 0 },
	{ id: '26.1', major: 84, minor: 0 },
	{ id: '1.21.11', major: 75, minor: 0 },
	{ id: '1.21.10', major: 69, minor: 0 },
	{ id: '1.21.9', major: 69, minor: 0 },
	{ id: '1.21.8', major: 64, minor: 0 },
	{ id: '1.21.7', major: 64, minor: 0 },
	{ id: '1.21.6', major: 63, minor: 0 },
	{ id: '1.21.5', major: 55, minor: 0 },
	{ id: '1.21.4', major: 46, minor: 0 },
];
const DEFAULT_PACK_VERSION = '26.2';
const PACK_MODERN_MIN_MAJOR = 65;

function findPackVersion(id) {
	return PACK_VERSIONS.find(v => v.id === id)
		|| PACK_VERSIONS.find(v => v.id === DEFAULT_PACK_VERSION)
		|| PACK_VERSIONS[0];
}

function packFormatLabel(version) {
	return version.major + (version.minor ? '.' + version.minor : '');
}

/** 生成 pack.mcmeta 的 pack 段；versionId 缺省时取项目设置 imm_pack_version */
function packMcmetaData(description, versionId) {
	const version = findPackVersion(versionId || projectValue('imm_pack_version', DEFAULT_PACK_VERSION));
	const pack = { description };
	if (version.major >= PACK_MODERN_MIN_MAJOR) {
		const value = version.minor ? [version.major, version.minor] : version.major;
		pack.min_format = value;
		pack.max_format = value;
	} else {
		pack.pack_format = version.major;
	}
	return { version, pack };
}

/** 读出现有 pack.mcmeta 声明的格式文本（用于提示版本不一致） */
function packMcmetaFormat(mcmeta) {
	const pack = (mcmeta && mcmeta.pack) || null;
	if (!pack) return null;
	const asText = (v) => (Array.isArray(v) ? v.join('.') : String(v));
	if (pack.min_format != null || pack.max_format != null) return asText(pack.max_format != null ? pack.max_format : pack.min_format);
	if (pack.pack_format != null) return asText(pack.pack_format);
	return null;
}

/** 老项目没有 imm_pack_version 时补默认值，避免项目设置的下拉落到第一项（26.3） */
function ensurePackVersion() {
	try {
		if (typeof Project !== 'undefined' && Project && !Project.imm_pack_version) Project.imm_pack_version = DEFAULT_PACK_VERSION;
	} catch (e) { /* ignore */ }
}

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
		const description = ((typeof Project !== 'undefined' && Project && Project.name) ? Project.name : 'Resource Pack') + ' · Blockbench';
		const built = packMcmetaData(description);
		const data = { pack: built.pack };
		fsmod.mkdirSync(root, { recursive: true });
		Blockbench.writeFile(pathmod.join(root, 'pack.mcmeta'), { content: JSON.stringify(data, null, '\t'), savetype: 'text' });
		if (typeof Project !== 'undefined' && Project) { Project.imm_pack_path = root; Project.saved = false; }
		const field = built.pack.min_format != null
			? ('min_format/max_format=' + packFormatLabel(built.version))
			: ('pack_format=' + built.pack.pack_format);
		Blockbench.showQuickMessage('已创建 pack.mcmeta（' + built.version.id + '，' + field + '）', 4000);
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
		let note = '';
		if (pathmod && fsmod) {
			const actual = packMcmetaFormat(readPackMcmeta(fsmod, pathmod, picked));
			const expected = packFormatLabel(packMcmetaData('', '').version);
			if (actual) note = '（pack.mcmeta 格式 ' + actual + (actual === expected ? '' : '，目标 ' + expected) + '）';
		}
		Blockbench.showQuickMessage('资源包工程路径：' + picked + note, 4000);
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
			let changed = stripStrayBranchPrefixes();
			const group = target || pickTargetGroup();
			if (group) {
				const parent = group.parent || null;
				changed += sortBranchChildren(group) + syncBranchLabels(group);
				if (parent) changed += sortBranchChildren(parent) + syncBranchLabels(parent);
			}
			if (changed) { simInvalidate(); try { Project.saved = false; Canvas.updateAll(); } catch (e) { /* ignore */ } }
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

/* 分组被挪出分支容器（或挪到根目录）后，去掉名字里的 [k] / ⚠ 前缀 */
function stripStrayBranchPrefixes() {
	const branchTypes = ['condition', 'range_dispatch', 'select'];
	let changed = 0;
	const walk = (nodes, parent) => {
		for (const node of nodes || []) {
			if (!isGroup(node)) continue;
			const parentType = parent ? String(parent.imm_type || '').replace(/^minecraft:/, '') : '';
			if (branchTypes.indexOf(parentType) < 0) {
				const base = String(node.name || '').replace(/^\[[^\]]*\]\s*/, '').replace(/^\u26a0\s*/, '');
				if (base && base !== node.name) { node.name = base; changed++; }
				if (node.imm_auto_disabled) { node.imm_auto_disabled = false; changed++; }
			}
			walk(node.children, node);
		}
	};
	walk((typeof Outliner !== 'undefined' && Outliner && Outliner.root) ? Outliner.root : [], null);
	return changed;
}

/* 拖拽重排分组不会触发 add_group，这里兜底：outliner 上松开鼠标/拖拽结束就跑一次同步 */
let outlinerHookBound = false;
function bindOutlinerHook() {
	if (outlinerHookBound || typeof document === 'undefined' || !document.addEventListener) return;
	outlinerHookBound = true;
	const onMaybeReparent = (event) => {
		const target = event && event.target;
		if (!target || !target.closest || !target.closest('#outliner')) return;
		simInvalidate();
		scheduleBranchSync(pickTargetGroup());
	};
	try { document.addEventListener('mouseup', onMaybeReparent, true); } catch (e) { /* ignore */ }
	try { document.addEventListener('dragend', onMaybeReparent, true); } catch (e) { /* ignore */ }
}

/* ============================== 枢轴归位 ============================== */
/* 分组变换 A(p) = R(p − O) + O（O 在父坐标系里）。把枢轴从 O 挪到 O′ 时，
 * 内容坐标要平移 d = (I − R⁻¹)(O′ − O) 才能保持外观不变；子分组再按 R_c⁻¹ d 递归。 */
const PIVOT_IDENTITY = { x: 0, y: 0, z: 0, w: 1 };

function pivotQuat(node) {
	try { const q = readQuaternion(node); if (q) return q; } catch (e) { /* ignore */ }
	return PIVOT_IDENTITY;
}

function pivotConj(q) { return { x: -q.x, y: -q.y, z: -q.z, w: q.w }; }

function rotateAroundQuat(q, origin, point) {
	const rel = [point[0] - origin[0], point[1] - origin[1], point[2] - origin[2]];
	const rot = rotVec(quatMatrix(q), rel);
	return [rot[0] + origin[0], rot[1] + origin[1], rot[2] + origin[2]];
}

function addVec(target, delta) {
	if (!Array.isArray(target)) return;
	target[0] += delta[0]; target[1] += delta[1]; target[2] += delta[2];
}

/** 方块自身变换后的中心（分组本地坐标） */
function pivotCubeCenter(cube) {
	const from = cube.from || [0, 0, 0], to = cube.to || [0, 0, 0];
	const center = [(num(from[0]) + num(to[0])) / 2, (num(from[1]) + num(to[1])) / 2, (num(from[2]) + num(to[2])) / 2];
	return rotateAroundQuat(pivotQuat(cube), cube.origin || [0, 0, 0], center);
}

/** 分组本地坐标里、包含所有后代方块的中心点集合 */
function pivotContentPoints(group) {
	const points = [];
	for (const child of (group.children || [])) {
		if (isCube(child)) points.push(pivotCubeCenter(child));
		else if (isGroup(child)) {
			const q = pivotQuat(child), origin = child.origin || [0, 0, 0];
			for (const p of pivotContentPoints(child)) points.push(rotateAroundQuat(q, origin, p));
		}
	}
	return points;
}

/** 把分组（及其后代）的内容整体平移 d（本分组本地坐标） */
function pivotTranslateContents(group, delta) {
	for (const child of (group.children || [])) {
		if (isCube(child)) {
			addVec(child.from, delta);
			addVec(child.to, delta);
			if (Array.isArray(child.origin)) addVec(child.origin, delta);
		} else if (isGroup(child)) {
			const inv = rotVec(quatMatrix(pivotConj(pivotQuat(child))), delta);
			pivotTranslateContents(child, inv);
		}
	}
}

/** 把方块的 rotation 枢轴（origin）移到它自己的 from/to 几何中心；返回移动距离 */
/** 把方块的 rotation 枢轴移到 target（父分组的几何中心），并补偿 from/to 保持外观不变 */
function centerCubePivot(cube, target) {
	if (!cube || !Array.isArray(cube.from) || !Array.isArray(cube.to) || !Array.isArray(target)) return 0;
	const old = Array.isArray(cube.origin) ? cube.origin.slice() : [0, 0, 0];
	const moved = Math.hypot(target[0] - num(old[0]), target[1] - num(old[1]), target[2] - num(old[2]));
	if (moved <= 1e-9) { cube.origin = target.slice(); return 0; }
	const d = [num(old[0]) - target[0], num(old[1]) - target[1], num(old[2]) - target[2]];
	const back = rotVec(quatMatrix(pivotConj(pivotQuat(cube))), d);
	const shift = [back[0] - d[0], back[1] - d[1], back[2] - d[2]];
	addVec(cube.from, shift);
	addVec(cube.to, shift);
	cube.origin = target.slice();
	return moved;
}

/** 把枢轴移到“自身 + 后代方块”的几何中心；方块同步补偿，外观不变。返回枢轴移动距离 */
function fixGroupPivot(group) {
	const points = pivotContentPoints(group);
	if (!points.length) return 0;
	const q = pivotQuat(group);
	const origin = (group.origin || [0, 0, 0]).slice();
	const rendered = points.map(p => rotateAroundQuat(q, origin, p));
	const target = [0, 1, 2].map(i => rendered.reduce((sum, p) => sum + p[i], 0) / rendered.length);
	const delta = [target[0] - origin[0], target[1] - origin[1], target[2] - origin[2]];
	const back = rotVec(quatMatrix(pivotConj(q)), delta);
	const shift = [delta[0] - back[0], delta[1] - back[1], delta[2] - back[2]];
	pivotTranslateContents(group, shift);
	group.origin = target;
	return Math.hypot(delta[0], delta[1], delta[2]);
}

function walkGroups(nodes, callback) {
	for (const node of nodes || []) {
		if (!isGroup(node)) continue;
		callback(node);
		walkGroups(node.children, callback);
	}
}

function selectedGroups() {
	const found = [];
	const push = (n) => { if (isGroup(n) && found.indexOf(n) < 0) found.push(n); };
	try { if (typeof Group !== 'undefined' && Array.isArray(Group.selected)) Group.selected.forEach(push); } catch (e) { /* ignore */ }
	try { if (typeof Outliner !== 'undefined' && Outliner && Array.isArray(Outliner.selected)) Outliner.selected.forEach(push); } catch (e) { /* ignore */ }
	return found;
}

function applyPivotFix(selectedOnly) {
	const roots = (typeof Outliner !== 'undefined' && Outliner && Outliner.root) ? Outliner.root : [];
	const targets = selectedOnly ? selectedGroups() : roots.filter(isGroup);
	if (!targets.length) {
		Blockbench.showMessageBox({ title: '没有目标', message: selectedOnly ? '先在 outliner 里选中至少一个分组。' : '当前项目没有分组。', icon: 'info' });
		return;
	}
	const groups = [], cubes = [];
	walkGroups(targets, g => { groups.push(g); for (const c of (g.children || [])) if (isCube(c)) cubes.push(c); });
	try { Undo.initEdit({ groups, elements: cubes }); } catch (e) { /* ignore */ }
	let fixed = 0, total = 0, max = 0;
	let cubesFixed = 0, cubeTotal = 0, cubeMax = 0;
	const run = (g) => {
		const moved = fixGroupPivot(g);
		if (moved > 0.001) { fixed++; total += moved; if (moved > max) max = moved; }
		// 分组枢轴已到自身内容中心；本层方块的旋转枢轴再归到这个父级中心（带补偿，外观不变）
		for (const child of (g.children || [])) {
			if (!isCube(child)) continue;
			const movedCube = centerCubePivot(child, g.origin);
			if (movedCube > 0.001) { cubesFixed++; cubeTotal += movedCube; if (movedCube > cubeMax) cubeMax = movedCube; }
		}
		for (const child of (g.children || [])) if (isGroup(child)) run(child);
	};
	for (const t of targets) run(t);
	try { Undo.finishEdit('枢轴归位'); } catch (e) { /* ignore */ }
	try { Canvas.updateAll(); } catch (e) { /* ignore */ }
	try { Project.saved = false; } catch (e) { /* ignore */ }
	simInvalidate();
	Blockbench.showQuickMessage(((fixed || cubesFixed)
		? ('枢轴归位：' + fixed + ' 个分组、' + cubesFixed + ' 个方块枢轴已归中' + (cubesFixed ? ('（方块平均 ' + (cubeTotal / cubesFixed).toFixed(1) + 'px，最大 ' + cubeMax.toFixed(1) + 'px）') : ''))
		: '所有分组和方块枢轴已经在几何中心附近'), 4000);
}

function diagnoseSimView() {
	const items = sim.lastItems || [];
	const entries = simViewEntries(items);
	const inactive = entries.filter(entry => !entry.active);
	const lines = [
		'模式：' + (sim.viewMode || 'off'),
		'映射节点 → 分组：' + (sim.groupNodes ? sim.groupNodes.size : 0),
		'本次求值分支：' + items.length + '（命中 ' + items.filter(item => item.hit).length + '）',
		'匹配到分组：' + entries.length + '（未命中 ' + inactive.length + '）',
	];
	if (!entries.length) lines.push('', '没有匹配到分组：检查分组是否真的生成了映射节点（范围/条件/选择的分支）。');
	for (const entry of inactive.slice(0, 6)) {
		const cubes = (entry.group.children || []).filter(isCube);
		const withMesh = cubes.filter(cube => cube.mesh);
		const withMaterial = withMesh.filter(cube => cube.mesh.material);
		lines.push('', '· ' + labelOf(entry.group) + '：mesh=' + !!entry.group.mesh + '，方块 ' + cubes.length + '（有 mesh ' + withMesh.length + '，有材质 ' + withMaterial.length + '）');
		const firstMaterial = withMaterial.length ? (Array.isArray(withMaterial[0].mesh.material) ? withMaterial[0].mesh.material[0] : withMaterial[0].mesh.material) : null;
		if (firstMaterial) lines.push('  材质：' + (firstMaterial.type || '未知') + (firstMaterial.uniforms ? '（uniforms: ' + Object.keys(firstMaterial.uniforms).join(', ') + '）' : ''));
	}
	Blockbench.showMessageBox({ title: '模拟视图联动诊断', message: lines.join('\n'), icon: 'info' });
	console.log('[装配] view diag', { mode: sim.viewMode, groupNodes: sim.groupNodes ? sim.groupNodes.size : 0, items: items.length, entries: entries.length, inactive: inactive.length });
}

function openPivotFix() {
	if (typeof Project === 'undefined' || !Project) { Blockbench.showQuickMessage('请先打开项目', 3000); return; }
	new Dialog({
		id: 'imm_fix_pivot',
		title: '枢轴归位（对齐几何中心）',
		width: 560,
		form: {
			scope: {
				label: '范围',
				type: 'select',
				value: 'all',
				options: { all: '全部分组', selected: '选中的分组（含子分组）' },
				description: '把每个分组的 origin 归到自身内容中心，再把该组方块的旋转枢轴归到父分组的几何中心；方块坐标同步补偿，外观不变。嵌套旋转也会正确换算。',
			},
		},
		onConfirm(result) { applyPivotFix(result.scope === 'selected'); },
	}).show();
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

/** 把对话框结果写进一个分组（批量编辑复用） */
function assignGroupMapProps(group, result) {
	group.imm_type = result.imm_type;
	resetTypeSpecificProps(group, result.imm_type);
	const type = String(group.imm_type || '').replace(/^minecraft:/, '');
	if (type !== 'range_dispatch' && type !== 'condition' && type !== 'select') stripChildPrefixes(group);
	if (result.imm_model !== undefined) group.imm_model = result.imm_model;
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
	if (result.imm_tint_type !== undefined) group.imm_tint_type = (result.imm_tint_type === '' ? 'none' : result.imm_tint_type);
	if (result.imm_tint_index !== undefined) group.imm_tint_index = num(result.imm_tint_index);
	if (result.imm_tint_value !== undefined) group.imm_tint_value = result.imm_tint_value;
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
		title: '分组映射属性 — ' + labelOf(group) + (selectedGroups().length > 1 ? ('（共 ' + selectedGroups().length + ' 个）') : ''),
		width: 660,
		form: {
			imm_type: {
				label: '映射类型（type）', description: '语法：{"type": "minecraft:<类型>"}\n作用：决定本节点是哪一种物品模型映射。\n可选：composite / model / range_dispatch / condition / empty', type: 'select', value: String(group.imm_type || 'composite'),
				options: { composite: 'composite', inline: 'inline（内联模型）', model: 'model（引用模型）', range_dispatch: 'range_dispatch', condition: 'condition', select: 'select', empty: 'empty' },
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
						imm_tint_type: { label: '纹理着色类型（tints[].type）', description: '语法："tints": [{"type": "<类型>"}]\n作用：染色来源类型（默认 custom_model_data）。\n可选：custom_model_data / constant / dye / potion / grass / team\n仅“纹理着色索引”非空时生效。', type: 'select', value: String(group.imm_tint_type == null ? 'custom_model_data' : (group.imm_tint_type === 'none' ? '' : group.imm_tint_type)), options: { '': '（不生成 tints）', custom_model_data: 'custom_model_data', constant: 'constant', dye: 'dye', potion: 'potion', grass: 'grass', team: 'team' }, description: '纹理着色来源类型；保存为键 imm_tint_type', condition: (r) => r.imm_type === 'model' || r.imm_type === 'composite' },
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
				const selected = selectedGroups();
				let targets = selected.length ? selected.slice() : [group];
				if (selected.length && selected.indexOf(group) < 0) targets = [group];
				if (targets.indexOf(group) < 0) targets.unshift(group);
				Undo.initEdit({ groups: targets });
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
				let tinted = 0, sortedCount = 0, relabeled = 0;
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
				for (const target of targets) {
					assignGroupMapProps(target, result);
					walkTint(target, tintIndexOf(target));
					const targetParent = target.parent || null;
					const sortedSelf = sortBranchChildren(target);
					const relabelSelf = syncBranchLabels(target);
					sortedCount += sortedSelf;
					relabeled += relabelSelf;
					if (targetParent && targetParent !== target) {
						sortedCount += sortBranchChildren(targetParent);
						relabeled += syncBranchLabels(targetParent);
					}
				}
				if (tinted) {
					Project.saved = false;
					try { Canvas.updateAll(); } catch (e) { /* ignore */ }
					try { if (typeof UVEditor !== 'undefined' && UVEditor.updateView) UVEditor.updateView(); } catch (e) { /* ignore */ }
				}
				Undo.finishEdit('修改分组映射属性');
				simInvalidate();
				try { Canvas.updateAll(); } catch (e) { /* ignore */ }
				const modelRef = String(group.imm_model || '').trim();
				if (targets.length === 1 && modelRef) {
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
				Blockbench.showQuickMessage('已更新 ' + targets.length + ' 个分组' + (tinted ? ('，为 ' + tinted + ' 个方块自动勾选着色') : '') + (sortedCount ? ('，重排 ' + sortedCount + ' 个分支') : '') + (relabeled ? ('，更新 ' + relabeled + ' 个分支名') : ''), 2500);
			} catch (error) {
				console.error(error);
				Blockbench.showMessageBox({ title: '修改失败', message: String((error && error.message) || error), icon: 'error' });
			}
		},
	}).show();
}

/** 从分组创建模型：烘焙组内方块、写到资源包 models/item、分组改为引用并记录居中补偿 */
function callSelectedGroup() {
	if (typeof Locator === 'undefined') {
		Blockbench.showMessageBox({ title: '不支持定位点', message: '当前 Blockbench 版本没有 Locator。', icon: 'warning' });
		return;
	}
	const groups = selectedGroups();
	if (!groups.length) {
		Blockbench.showMessageBox({ title: '请先选中分组', message: '在 outliner 里选中至少一个分组，再执行复调用。', icon: 'info' });
		return;
	}
	try { Undo.initEdit({ outliner: true, elements: [] }); } catch (e) { /* ignore */ }
	let created = 0;
	for (const group of groups) {
		try {
			const locator = new Locator({ name: '调用 ' + labelOf(group), position: (group.origin || [0, 0, 0]).slice(), rotation: (group.rotation || [0, 0, 0]).slice(), ignore_inherited_scale: true });
			if (group.parent) locator.addTo(group.parent); else locator.addTo();
			try { locator.init(); } catch (e) { /* ignore */ }
			locator.imm_call_target = group.uuid;
			created++;
		} catch (error) { console.error('[装配] 创建复调用标签失败', error); }
	}
	try { Undo.finishEdit('复调用选中的分组'); } catch (e) { /* ignore */ }
	try { Canvas.updateAll(); } catch (e) { /* ignore */ }
	try { Project.saved = false; } catch (e) { /* ignore */ }
	simInvalidate();
	Blockbench.showQuickMessage('已创建 ' + created + ' 个复调用标签', 3000);
}

/** 编辑一个复调用 Locator 的目标（分组 UUID 或模型 id） */
function editCallTag(locator) {
	if (!locator) return;
	const current = String(locator.imm_call_target || '').trim();
	const groups = [];
	const walk = (nodes) => {
		for (const node of (nodes || [])) {
			if (!isGroup(node)) continue;
			groups.push(node);
			walk(node.children);
		}
	};
	walk((typeof Outliner !== 'undefined' && Outliner) ? Outliner.root : []);
	const options = { '': '（未设置）' };
	let matchedGroup = '';
	for (const group of groups) {
		options[group.uuid] = labelOf(group);
		if (group.uuid === current) matchedGroup = group.uuid;
	}
	new Dialog({
		id: 'imm_edit_call',
		title: '编辑复调用标签 — ' + (locator.name || 'Locator'),
		width: 560,
		form: {
			target: { label: '目标分组', type: 'select', value: matchedGroup, options, description: '导出时这个 Locator 会被替换成目标分组的映射节点（保留其 transformation）。' },
			model: { label: '或模型 id（优先）', type: 'text', value: (matchedGroup || !current) ? '' : current, description: '例如 namespace:item/foo；填写后忽略上面的分组选择。' },
		},
		onConfirm(result) {
			try {
				const model = String(result.model || '').trim();
				const target = model || String(result.target || '').trim();
				try { Undo.initEdit({ elements: [locator] }); } catch (e) { /* ignore */ }
				locator.imm_call_target = target;
				try { Undo.finishEdit('编辑复调用标签'); } catch (e) { /* ignore */ }
				simInvalidate();
				try { Canvas.updateAll(); } catch (e) { /* ignore */ }
				try { Project.saved = false; } catch (e) { /* ignore */ }
				Blockbench.showQuickMessage(target ? ('复调用标签已指向 ' + target) : '已清空复调用目标', 2500);
			} catch (error) {
				console.error(error);
				Blockbench.showMessageBox({ title: '修改失败', message: String((error && error.message) || error), icon: 'error' });
			}
		},
	}).show();
}

function createModelFromGroup(group) {
	if (!group) return;
	const root = String(projectValue('imm_pack_path', '') || '').trim();
	if (!root) {
		Blockbench.showMessageBox({ title: '需要资源包工程', message: '先通过 File → 选择资源包工程路径… 设置目标资源包，再创建模型。', icon: 'warning' });
		return;
	}
	const cubes = (group.children || []).filter(isCube);
	if (!cubes.length) {
		Blockbench.showMessageBox({ title: '没有方块', message: '分组 “' + labelOf(group) + '” 里没有可直接烘焙的方块。', icon: 'info' });
		return;
	}
	new Dialog({
		id: 'imm_create_model',
		title: '从分组创建模型',
		width: 560,
		form: {
			name: { label: '模型名', type: 'text', value: sanitizePath(labelOf(group), 'group'), description: '写入 assets/<namespace>/models/item/<名字>.json；分组会改为引用该模型，并记录居中补偿以保持外观。' },
		},
		onConfirm(result) {
			const hint = sanitizePath(result.name || labelOf(group), 'group');
			const exporter = createExporter();
			let built = null;
			try { built = exporter.addModel(cubes, hint); } catch (e) { built = null; }
			if (!built) {
				Blockbench.showMessageBox({ title: '创建失败', message: '这些方块没有可导出的纹理面。', icon: 'error' });
				return;
			}
			const model = exporter.models[exporter.models.length - 1];
			const pathmod = getPath();
			const fsmod = getScopedFs(root);
			if (!pathmod || !fsmod || !model) {
				Blockbench.showMessageBox({ title: '无法写入', message: '需要桌面版 Blockbench，并且资源包路径可用。', icon: 'warning' });
				return;
			}
			const dir = pathmod.join(root, 'assets', exporter.namespace, 'models', 'item');
			const file = pathmod.join(dir, model.name + '.json');
			try {
				fsmod.mkdirSync(dir, { recursive: true });
				Blockbench.writeFile(file, { content: formatModel(model.data), savetype: 'text' });
			} catch (error) {
				Blockbench.showMessageBox({ title: '写入失败', message: String((error && error.message) || error), icon: 'error' });
				return;
			}
			try { Undo.initEdit({ groups: [group] }); } catch (e) { /* ignore */ }
			group.imm_type = 'model';
			group.imm_model = built.reference;
			group.imm_model_shift = JSON.stringify(built.shift);
			try { Undo.finishEdit('从分组创建模型'); } catch (e) { /* ignore */ }
			try { Canvas.updateAll(); } catch (e) { /* ignore */ }
			try { Project.saved = false; } catch (e) { /* ignore */ }
			simInvalidate();
			Blockbench.showQuickMessage('已创建 ' + built.reference + '（已居中，分组改为引用）', 4000);
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
	let groups = null;
	const textureRefs = {};
	for (let depth = 0; depth < 12 && current; depth++) {
		if (seen[current]) break;
		seen[current] = true;
		const json = readJSONFile(pathmod, fsmod, modelPathOf(pathmod, root, current));
		if (!json) return { error: '找不到模型文件：' + current + '\n完整路径：' + modelPathOf(pathmod, root, current) + '\n资源包工程：' + root };
		if (!elements && Array.isArray(json.elements)) {
			elements = json.elements;
			groups = Array.isArray(json.groups) ? json.groups : null;
		}
		for (const key of Object.keys(json.textures || {})) {
			if (!(key in textureRefs)) textureRefs[key] = json.textures[key];
		}
		current = typeof json.parent === 'string' ? json.parent : '';
	}
	if (!elements || !elements.length) return { error: '该模型没有 elements（可能是纯引用模型）' };
	return { elements, groups, textures: textureRefs };
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

/** 模型文件里是否已有任意 tintindex（有则不整体补，保留原有分布） */
function modelElementsHaveTintIndex(elements) {
	for (const element of (elements || [])) {
		for (const face of Object.values((element && element.faces) || {})) {
			if (!face) continue;
			const tint = (typeof face.tintindex === 'number') ? face.tintindex : ((typeof face.tint === 'number') ? face.tint : -1);
			if (tint >= 0) return true;
		}
	}
	return false;
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
		// 模型文件里的 groups → Blockbench 分组（内联模型）；children 可以是元素下标或子分组对象
		const importedGroups = [];
		// 目标分组的着色配置要下发给所有导入子分组
		const sourceTintType = group.imm_tint_type;
		const hasSourceTint = sourceTintType !== undefined && sourceTintType !== null && sourceTintType !== '' && sourceTintType !== 'none';
		const sourceTintIndex = String(group.imm_tint_index == null ? '' : group.imm_tint_index).trim();
		const elementGroup = {};
		const buildImportGroups = (list, parentNode) => {
			for (const src of (list || [])) {
				if (!src || typeof src !== 'object') continue;
				const origin = Array.isArray(src.origin)
					? src.origin.map((v, a) => (Number(v) || 0) + (Number(import_base[a]) || 0))
					: [Number(import_base[0]) || 0, Number(import_base[1]) || 0, Number(import_base[2]) || 0];
				const rotation = Array.isArray(src.rotation) ? src.rotation.map(v => Number(v) || 0) : [0, 0, 0];
				let node = null;
				try {
					node = new Group({ name: String(src.name || 'group'), origin, rotation }).addTo(parentNode);
					try { if (typeof node.init === 'function') node.init(); } catch (e) { /* ignore */ }
					try { if (typeof node.createUniqueName === 'function') node.createUniqueName(); } catch (e) { /* ignore */ }
					node.imm_type = 'inline';
					if (hasSourceTint) {
						node.imm_tint_type = sourceTintType;
						if (group.imm_tint_index !== undefined) node.imm_tint_index = group.imm_tint_index;
						if (group.imm_tint_value !== undefined) node.imm_tint_value = group.imm_tint_value;
						if (group.imm_tints !== undefined) node.imm_tints = group.imm_tints;
					}
					importedGroups.push(node);
				} catch (error) { console.warn('[装配] 创建导入分组失败', error); continue; }
				const nested = [];
				for (const child of (src.children || [])) {
					if (typeof child === 'number') elementGroup[child] = node;
					else if (child && typeof child === 'object') nested.push(child);
				}
				if (nested.length) buildImportGroups(nested, node);
			}
		};
		buildImportGroups(resolved.groups || [], import_holder);
		console.log('[装配] 导入分组', importedGroups.length, '个（inline）');
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
		}).addTo(elementGroup[index] || import_holder);
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
			const srcTint = (typeof src.tintindex === 'number') ? src.tintindex : ((typeof src.tint === 'number') ? src.tint : null);
			if (srcTint !== null && srcTint >= 0) cube.faces[dir].tint = srcTint;
		}
		if (created.length === 0) {
			const keys = Object.keys(cube.faces || {});
			console.log("[装配] 首个方块", JSON.stringify({ from: cube.from, to: cube.to, faceKeys: keys, enabled: keys.map(k => cube.faces[k].enabled), texture: keys.map(k => cube.faces[k].texture), uv: keys.map(k => cube.faces[k].uv) }));
		}
		created.push(cube);
	});
		// 着色配置有效时，给所有导入方块补 tintindex（面原本没有 tint 的才补）
		const importedHasTint = modelElementsHaveTintIndex(elements);
		if (hasSourceTint && !importedHasTint && /^-?\d+$/.test(sourceTintIndex)) {
			const tintValue = Number(sourceTintIndex);
			const applyTint = (nodes) => {
				for (const node of (nodes || [])) {
					if (isCube(node)) {
						for (const face of Object.values(node.faces || {})) {
							if (typeof face.tint !== 'number' || face.tint < 0) face.tint = tintValue;
						}
					} else if (isGroup(node)) applyTint(node.children);
				}
			};
			applyTint(group.children);
		}
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

/* 模拟状态：0.30.1 重构面板时和 simEvaluate 一起被误删，0.39.0 恢复 */
const SIM_COLOR_PRESETS = [
	'0xFFF9FFFE', '0xFFF9801D', '0xFFC74EBD', '0xFF3AB3DA',
	'0xFFFED83D', '0xFF80C71F', '0xFFF38BAA', '0xFF474F52',
	'0xFF9D9D97', '0xFF169C9C', '0xFF8932B8', '0xFF3C44AA',
	'0xFF835432', '0xFF5E7C16', '0xFF1D1D21', '0xFFB02E26',
];
const sim = {
	timer: null,
	dir: 1,
	dirty: true,          // 结构/属性变了要重建映射
	mapping: null,        // buildMapping() 缓存（输入变化时不重建）
	usage: null,          // collectInputUsage() 缓存
	tickTimer: null,      // 输入防抖
	usageOpen: {},        // 「未活跃」展开状态，重渲染后保持
	viewMode: 'off',      // 不活跃分支：off / ghost / hide
	groupNodes: null,     // 映射节点 → 分组（随 mapping 一起缓存）
	viewTouched: null,    // 被视图联动改过的分组集合
	lastItems: null,      // 最近一次求值结果（周期重贴用）
	viewTimer: null,      // Blockbench 会重置 mesh，需要定时重贴
	inputs: { floats: [], colors: [], strings: [], flags: [], selected: false, using_item: false, damage: 0, count: 0, time: 0 },
};

/** 结构可能变了：下次 simTick 重建映射与关联表 */
function simInvalidate() {
	sim.dirty = true;
	sim.usage = null;
}

function simGetMapping() {
	if (!sim.mapping || sim.dirty) {
		const exporter = createExporter();
		sim.mapping = exporter.buildMapping();
		sim.groupNodes = exporter.groupNodes || null;
		sim.usage = null;
		sim.dirty = false;
	}
	return sim.mapping;
}

function simGetUsage() {
	if (!sim.usage) sim.usage = collectInputUsage();
	return sim.usage;
}

/** 输入框逐字符触发：合并成一次重算，避免每个键都重建映射 */
function simScheduleTick() {
	if (sim.tickTimer) return;
	sim.tickTimer = setTimeout(() => {
		sim.tickTimer = null;
		try { simTick(); } catch (error) { /* ignore */ }
	}, 40);
}

function simBlankInputs() {
	return { floats: [], colors: [], strings: [], flags: [], selected: false, using_item: false, damage: 0, count: 0, time: 0 };
}

/** 把一个槽的值写进 inputs（key = floats / colors / strings / flags / selected / …） */
function simApplySlot(inputs, key, slot) {
	const value = String(slot.value);
	switch (key) {
		case 'floats': inputs.floats[slot.index] = num(value); break;
		case 'colors': inputs.colors[slot.index] = num(value) | 0; break;
		case 'strings': inputs.strings[slot.index] = value; break;
		case 'flags': inputs.flags[slot.index] = (value === 'true' || value === '1'); break;
		case 'selected':
		case 'using_item': inputs[key] = (value === 'true' || value === '1' || num(value) > 0); break;
		default: inputs[key] = num(value);
	}
}

/* ============================== 模拟视图联动 ============================== */
/* 只改运行时材质/可见性：不碰纹理、UV、元素数据，也不写项目/撤销。 */

/* 预览着色：按面的 tintindex 取 colors[tintindex]，只替换运行时材质，不改纹理/UV */
function simTintColorOf(cube) {
	const faces = cube && cube.faces;
	if (!faces) return null;
	// 分组明确“不生成 tints”时不着色
	const group = cube.parent;
	if (!group) return null;
	if (group.imm_tint_type === '' || group.imm_tint_type === 'none') return null;
	const type = String(group.imm_tint_type == null ? 'custom_model_data' : group.imm_tint_type).replace(/^minecraft:/, '').trim() || 'custom_model_data';
	if (type !== 'custom_model_data') return null;
	const indexText = String(group.imm_tint_index == null ? '' : group.imm_tint_index).trim();
	if (!/^-?\d+$/.test(indexText)) return null;
	let hasTintedFace = false;
	for (const dir of FACE_KEYS) {
		const face = faces[dir];
		if (face && typeof face.tint === 'number' && face.tint >= 0) { hasTintedFace = true; break; }
	}
	if (!hasTintedFace) return null;
	const index = Number(indexText);
	const raw = (sim.inputs.colors || [])[index];
	if (raw == null) return null;
	const argb = raw >>> 0;
	if (((argb >>> 24) & 0xff) === 0) return null;
	return (((argb >> 16) & 0xff) << 16) | (((argb >> 8) & 0xff) << 8) | (argb & 0xff);
}

function simRestoreCubeTint(mesh) {
	if (!mesh || !mesh.__immTint) return;
	const saved = mesh.__immTint;
	try { mesh.material = saved.original; } catch (e) { /* ignore */ }
	const clones = Array.isArray(saved.cloned) ? saved.cloned : [saved.cloned];
	for (const clone of clones) {
		if (!clone || clone === saved.original) continue;
		try { if (typeof clone.dispose === 'function') clone.dispose(); } catch (e) { /* ignore */ }
	}
	delete mesh.__immTint;
}

function simApplyCubeTint(cube, color) {
	const mesh = cube && cube.mesh;
	if (!mesh || !mesh.material) return;
	// 幽灵优先：不活跃分支的半透明/隐藏态下不再叠着色
	if (mesh.__immGhost) { simRestoreCubeTint(mesh); return; }
	if (mesh.__immTint) {
		if (mesh.__immTint.key === String(color)) return;
		simRestoreCubeTint(mesh);
	}
	if (color == null) return;
	try {
		const original = mesh.material;
		const make = (material) => {
			const map = (material && material.uniforms && material.uniforms.map && material.uniforms.map.value) || (material && material.map) || null;
			const options = { map, color, transparent: true, depthWrite: true };
			if (material && typeof material.side === 'number') options.side = material.side;
			const basic = new THREE.MeshBasicMaterial(options);
			basic.alphaTest = 0.01;
			return basic;
		};
		const cloned = Array.isArray(original) ? original.map(make) : make(original);
		mesh.__immTint = { key: String(color), original, cloned };
		mesh.material = cloned;
	} catch (error) { /* ignore */ }
}

function simApplyTints() {
	if (typeof Outliner === 'undefined' || !Outliner) return;
	const walk = (nodes) => {
		for (const node of nodes || []) {
			if (!isGroup(node)) continue;
			for (const child of (node.children || [])) if (isCube(child)) simApplyCubeTint(child, simTintColorOf(child));
			walk(node.children);
		}
	};
	walk(Outliner.root);
}

function simRestoreTints() {
	if (typeof Outliner === 'undefined' || !Outliner) return;
	const walk = (nodes) => {
		for (const node of nodes || []) {
			if (!isGroup(node)) continue;
			for (const child of (node.children || [])) if (isCube(child)) simRestoreCubeTint(child.mesh);
			walk(node.children);
		}
	};
	walk(Outliner.root);
}

function simGhostCube(cube, on) {
	const mesh = cube && cube.mesh;
	if (!mesh || !mesh.material) return;
	if (on) {
		simRestoreCubeTint(mesh);
		if (mesh.__immGhost) {
			if (mesh.material === mesh.__immGhost.cloned) return;
			// Blockbench 把材质换回去了：丢弃旧记录，按当前材质重新克隆
			try {
				const stale = Array.isArray(mesh.__immGhost.cloned) ? mesh.__immGhost.cloned : [mesh.__immGhost.cloned];
				for (const item of stale) { if (item && item !== mesh.__immGhost.original && typeof item.dispose === 'function') item.dispose(); }
			} catch (error) { /* ignore */ }
			delete mesh.__immGhost;
		}
		const original = mesh.material;
		// Blockbench 的贴图材质是自定义 ShaderMaterial（alpha 直接取纹理），material.opacity 不生效；
		// 幽灵材质改用同贴图的 MeshBasicMaterial，opacity 才能真正半透明。
		const tint = (material) => {
			if (!material) return material;
			const map = (material.uniforms && material.uniforms.map && material.uniforms.map.value) || material.map || null;
			try {
				if (typeof THREE !== 'undefined' && THREE && THREE.MeshBasicMaterial) {
					const options = { map, transparent: true, opacity: 0.28, depthWrite: false };
					if (typeof material.side === 'number') options.side = material.side;
					const ghost = new THREE.MeshBasicMaterial(options);
					ghost.alphaTest = 0;
					ghost.toneMapped = false;
					if (!map && ghost.color && ghost.color.set) ghost.color.set(0x9aa4ad);
					return ghost;
				}
			} catch (e) { /* fall through */ }
			try {
				const clone = material.clone();
				clone.transparent = true;
				clone.opacity = 0.28;
				clone.depthWrite = false;
				clone.alphaTest = 0;
				clone.needsUpdate = true;
				return clone;
			} catch (e) { return material; }
		};
		const cloned = Array.isArray(original) ? original.map(tint) : tint(original);
		mesh.__immGhost = { original, cloned };
		mesh.material = cloned;
	} else if (mesh.__immGhost) {
		const saved = mesh.__immGhost;
		try { mesh.material = saved.original; } catch (e) { /* ignore */ }
		const clones = Array.isArray(saved.cloned) ? saved.cloned : [saved.cloned];
		for (const clone of clones) {
			if (!clone || clone === saved.original) continue;
			try { if (typeof clone.dispose === 'function') clone.dispose(); } catch (e) { /* ignore */ }
		}
		delete mesh.__immGhost;
	}
}

function simHideGroup(group, on) {
	const mesh = group && group.mesh;
	if (!mesh) return;
	if (on) {
		if (mesh.__immHidden) {
			if (mesh.visible === false) return;
			delete mesh.__immHidden;
		}
		mesh.__immHidden = { visible: mesh.visible };
		mesh.visible = false;
	} else if (mesh.__immHidden) {
		try { mesh.visible = mesh.__immHidden.visible; } catch (e) { /* ignore */ }
		delete mesh.__immHidden;
	}
}

let guardingLocked = false;
/** 把已选中的锁定元素踢出选择（锁定分支不可选中） */
function guardLockedSelection() {
	if (guardingLocked) return;
	if (typeof Outliner === 'undefined' || !Outliner || !Outliner.selected) return;
	guardingLocked = true;
	try {
		for (const element of Outliner.selected.slice()) {
			if (!element || !element.locked) continue;
			try { if (typeof element.unselect === 'function') element.unselect(); } catch (e) { /* ignore */ }
		}
	} finally { guardingLocked = false; }
}

/** 运行时锁定/解锁分组及其所有子项（保存/恢复原有 lock 状态） */
let guardingBox = false;
let immBoxSetting = null;
let immBoxFallback = false;
function boxGroupsEnabled() {
	// 装配格式内强制开启；其它格式按开关（默认关）
	try { if (typeof Format !== 'undefined' && Format && Format.id === FORMAT_ID) return true; } catch (e) { /* ignore */ }
	return immBoxSetting ? (immBoxSetting.value === true) : immBoxFallback;
}
function setBoxSelectGroups(value) {
	immBoxFallback = !!value;
	if (immBoxSetting) immBoxSetting.value = !!value;
	return boxGroupsEnabled();
}
/** 内建模型：仅 inline（内联模型）分组；引用模型（model）不算例外 */
function isBuiltInModelGroup(group) {
	let node = group;
	while (node && isGroup(node)) {
		const type = String(node.imm_type || '').replace(/^minecraft:/, '');
		if (type === 'inline') return true;
		node = node.parent;
	}
	return false;
}

/** 一次选中多个方块时，改为选中它们各自的父分组 */
function guardBoxSelection() {
	// 用户点选的是分组（含父分组优先级）：不要重算选择，交给 Blockbench 原生 gizmo 逻辑
	if (Array.isArray(Outliner.selected) && Outliner.selected.length && isGroup(Outliner.selected[0])) return;
	if (typeof Group !== 'undefined' && Group && Array.isArray(Group.selected) && Group.selected.length) return;
	if (guardingBox || !boxGroupsEnabled()) return;
	if (typeof Outliner === 'undefined' || !Outliner || !Array.isArray(Outliner.selected)) return;
	const selectedCubes = Outliner.selected.filter(isCube);
	if (!selectedCubes.length) return;
	const parents = [];
	for (const cube of selectedCubes) {
		const parent = cube && cube.parent;
		if (isGroup(parent) && parents.indexOf(parent) < 0) parents.push(parent);
	}
	if (!parents.length) return;
	// 只选了内建模型里的元素：保持原样，便于直接编辑引用模型内部
	if (parents.every(isBuiltInModelGroup)) return;
	const isSelected = (node) => !!(node && (node.selected || (Array.isArray(Outliner.selected) && Outliner.selected.indexOf(node) >= 0)));
	guardingBox = true;
	let changed = false;
	try {
		const pushSelected = (node) => {
			try { if (typeof node.markAsSelected === 'function') node.markAsSelected(); else node.selected = true; } catch (e) { node.selected = true; }
			if (Array.isArray(Outliner.selected) && Outliner.selected.indexOf(node) < 0) Outliner.selected.push(node);
		};
		// 像单击分组：选中分组自身 + 它的全部子项（同层/后代都选上）
		const selectWholeGroup = (group) => {
			if (!group.selected) { group.selected = true; changed = true; }
			try { if (typeof group.multiSelect === 'function') group.multiSelect(); } catch (e) { /* ignore */ }
			pushSelected(group);
			for (const child of (group.children || [])) {
				if (!isSelected(child)) changed = true;
				pushSelected(child);
			}
		};
		for (const parent of parents) {
			if (parent.selected && isSelected(parent) && (parent.children || []).every(isSelected)) continue;
			selectWholeGroup(parent);
		}
		// 继续向上：祖先的所有子项都选中时也选中它
		let node = parents[0] ? parents[0].parent : null;
		while (isGroup(node)) {
			const children = (node.children || []);
			if (children.length && children.every(isSelected)) selectWholeGroup(node);
			node = node.parent;
		}
		if (changed) { try { if (typeof updateSelection === 'function') updateSelection(); } catch (e) { /* ignore */ } }
	} finally { guardingBox = false; }
}

let guardingBatch = false;
let immBatchSetting = null;
let immBatchFallback = false;
function batchGroupsOnlyEnabled() { return immBatchSetting ? (immBatchSetting.value === true) : immBatchFallback; }
function setBatchGroupsOnly(value) {
	immBatchFallback = !!value;
	return batchGroupsOnlyEnabled();
}
/** 批量选中多个分组时，把同时选中的方块/定位点踢出选择 */
function guardBatchSelection() {
	if (guardingBatch || !batchGroupsOnlyEnabled()) return;
	if (typeof Outliner === 'undefined' || !Outliner || !Outliner.selected) return;
	const groups = selectedGroups();
	if (groups.length < 2) return;
	guardingBatch = true;
	try {
		for (const element of Outliner.selected.slice()) {
			if (!element || isGroup(element)) continue;
			if (!isCube(element) && !isLocator(element)) continue;
			try { if (typeof element.unselect === 'function') element.unselect(); } catch (e) { /* ignore */ }
		}
	} finally { guardingBatch = false; }
}

function simLockGroup(group, on) {
	if (!group) return;
	if (on) {
		if (group.__immLock) return;
		let ancestor = group.parent;
		while (ancestor) {
			if (ancestor.__immLock) return;
			ancestor = ancestor.parent;
		}
		const saved = [];
		const walk = (node) => {
			saved.push([node, !!node.locked]);
			for (const child of (node.children || [])) {
				if (isGroup(child) || isCube(child)) walk(child);
			}
		};
		walk(group);
		group.__immLock = saved;
		for (const pair of saved) { try { pair[0].locked = true; } catch (e) { /* ignore */ } }
		guardLockedSelection();
	} else if (group.__immLock) {
		for (const pair of group.__immLock) { try { pair[0].locked = pair[1]; } catch (e) { /* ignore */ } }
		delete group.__immLock;
	}
}

function simRestoreGroup(group) {
	for (const child of (group.children || [])) if (isCube(child)) simGhostCube(child, false);
	simHideGroup(group, false);
	simLockGroup(group, false);
}

function simViewEntries(items) {
	const map = sim.groupNodes;
	if (!map) return [];
	const hits = new Map();
	for (const item of items || []) {
		const group = map.get(item && item.node);
		if (!group) continue;
		hits.set(group, !!hits.get(group) || !!(item && item.hit));
	}
	const entries = [];
	for (const [group, active] of hits) entries.push({ group, active });
	return entries;
}

function simRestoreView() {
	if (!sim.viewTouched) return;
	for (const group of sim.viewTouched) simRestoreGroup(group);
	sim.viewTouched.clear();
}

/** 对 [{group, active}] 应用不活跃样式；mode = off / ghost / hide */
function simApplyGroupVisual(entries, mode) {
	if (!sim.viewTouched) sim.viewTouched = new Set();
	if (!mode || mode === 'off') { simRestoreView(); return; }
	const lock = (mode === 'ghost_lock' || mode === 'hide_lock');
	const baseMode = (mode === 'ghost_lock') ? 'ghost' : ((mode === 'hide_lock') ? 'hide' : mode);
	const seen = new Set();
	for (const entry of entries || []) {
		const group = entry && entry.group;
		if (!group) continue;
		seen.add(group);
		sim.viewTouched.add(group);
		if (baseMode === 'ghost') {
			simHideGroup(group, false);
			for (const child of (group.children || [])) if (isCube(child)) simGhostCube(child, !entry.active);
		} else if (baseMode === 'hide') {
			for (const child of (group.children || [])) if (isCube(child)) simGhostCube(child, false);
			simHideGroup(group, !entry.active);
		}
		// 锁定时只锁未活跃分支；切回普通模式会恢复原有锁定状态
		if (lock && !entry.active) simLockGroup(group, true);
		else simLockGroup(group, false);
	}
	// 已经不在映射里的分组要恢复，避免退出/改结构后残留幽灵
	for (const group of Array.from(sim.viewTouched)) {
		if (seen.has(group)) continue;
		simRestoreGroup(group);
		sim.viewTouched.delete(group);
	}
}

function simApplyView(items) { simApplyGroupVisual(simViewEntries(items), sim.viewMode || 'off'); }

function simStopViewLoop() {
	if (sim.viewTimer) { clearInterval(sim.viewTimer); sim.viewTimer = null; }
}

function simStartViewLoop() {
	if (sim.viewTimer) return;
	sim.viewTimer = setInterval(() => {
		try { if (sim.lastItems) simApplyView(sim.lastItems); } catch (error) { /* ignore */ }
		try { simApplyTints(); } catch (error) { /* ignore */ }
	}, 250);
}

/** 切换不活跃分支的显示方式；off 时立刻恢复 */
function simSetViewMode(mode) {
	sim.viewMode = mode || 'off';
	if (sim.viewMode === 'off') {
		simStopViewLoop();
		simRestoreView();
		simRestoreTints();
		return;
	}
	simStartViewLoop();
	simApplyView(sim.lastItems || []);
	try { simApplyTints(); } catch (error) { /* ignore */ }
}


function simSlotLabel(key, slot) {
	if (key === 'floats' || key === 'colors') return key + '[' + slot.index + '] = ' + slot.value;
	if (key === 'strings') return 'strings[' + slot.index + '] = "' + slot.value + '"';
	if (key === 'flags') return 'flags[' + slot.index + '] = ' + slot.value;
	return key + ' = ' + slot.value;
}


function buildSimPanel(show_panel) {
	if (!sim_panel) { try { if (typeof Panels !== 'undefined' && Panels['imm_sim_panel']) sim_panel = Panels['imm_sim_panel']; } catch (e) { /* ignore */ } }
	if (sim_panel) { if (show_panel !== false) sim_panel.show(); return sim_panel; }
	if (typeof Panel === 'undefined' || typeof document === 'undefined') return null;
	sim_panel = new Panel('imm_sim_panel', { name: '模拟输入', icon: 'play_circle', condition: { formats: [FORMAT_ID] }, default_position: { slot: 'right_bar', float: false }, resizable: true, growable: true });
	const root = document.createElement('div');
	root.style.cssText = 'padding:8px;display:flex;flex-direction:column;gap:4px;font-size:12px;overflow:auto;height:100%';
	const mk = (tag, props, style) => { const el = document.createElement(tag); Object.assign(el, props || {}); if (style) el.style.cssText = style; return el; };
	const cell = (labelText, inputEl, width) => { const wrap = mk('label', {}, 'display:flex;flex-direction:column;gap:2px;font-size:10px;opacity:.75;white-space:nowrap;min-width:0;flex:1 1 0' + (width ? (';flex:0 0 ' + width) : '') + ';overflow:hidden'); wrap.appendChild(mk('span', { textContent: labelText })); wrap.appendChild(inputEl); return wrap; };
	const SPECS = [
		['floats', 'cmdata.floats', 'number', 'range_dispatch 数值'],
		['colors', 'cmdata.colors', 'number', '染色'],
		['strings', 'cmdata.strings', 'text', 'select 文本'],
		['flags', 'cmdata.flags', 'bool', 'condition 布尔'],
		['selected', 'selected', 'bool', ''],
		['damage', 'damage', 'number', ''],
		['count', 'count', 'number', ''],
		['time', 'time', 'number', ''],
		['using_item', 'using_item', 'bool', ''],
	];
	simInvalidate();
	sim_ui = { rows: {}, out: null, runBtn: null, status: null };
	for (const spec of SPECS) {
		const key = spec[0], label = spec[1], kind = spec[2], hint = spec[3] || '';
		const multi = (key === 'floats' || key === 'colors');
		const row = { key, label, kind, hint, enabled: false, open: true, slots: [] };
		const box = mk('div', {}, 'border-top:1px solid rgba(128,128,128,.25);padding:4px 0');
		const header = mk('div', {}, 'display:flex;align-items:center;gap:6px;flex-wrap:wrap');
		const rowToggle = mk('button', { textContent: '▾', title: '折叠 / 展开' }, 'border:none;background:transparent;cursor:pointer;padding:0;font-size:11px;line-height:1;width:12px;opacity:.7');
		const enable = mk('input', { type: 'checkbox' });
		const enableWrap = mk('label', {}, 'display:flex;align-items:center;gap:4px;cursor:pointer');
		enableWrap.appendChild(enable);
		enableWrap.appendChild(mk('span', { textContent: label }, 'font-weight:600;font-size:11px'));
		if (hint) enableWrap.appendChild(mk('span', { textContent: hint }, 'font-size:10px;opacity:.55'));
		const stateEl = mk('span', { textContent: '自动' }, 'font-size:10px;color:#7fd0ff');
		stateEl.title = '勾选后参与自动变化（点上方「运行」生效）；不勾选仍会用手动值参与求值';
		header.appendChild(rowToggle);
		header.appendChild(enableWrap);
		header.appendChild(stateEl);
		const body = mk('div', {}, 'display:flex;flex-direction:column;gap:4px;padding:4px 0 0 16px');
		const refreshRowState = () => {
			box.style.opacity = '1';
			stateEl.style.display = row.enabled ? 'inline' : 'none';
		};
		const setRowOpen = (open) => {
			row.open = open;
			body.style.display = open ? 'flex' : 'none';
			rowToggle.textContent = open ? '▾' : '▸';
		};
		rowToggle.addEventListener('click', (event) => { if (event && event.preventDefault) event.preventDefault(); setRowOpen(!row.open); });
		const slotCount = multi ? 3 : 1;
		for (let slotIndex = 0; slotIndex < slotCount; slotIndex++) {
			const slot = { index: slotIndex, enabled: true, value: kind === 'bool' ? 'false' : (kind === 'text' ? '' : '0'), period: (key === 'colors' ? 1000 : 200), step: 0.5, rule: 'pingpong', min: 0, max: 4, dir: 1, lastTick: 0, open: false, presetIndex: 0, presets: key === 'colors' ? SIM_COLOR_PRESETS.map(v => Number(v)) : [] };
			const slotBox = mk('div', {}, 'border:1px solid rgba(128,128,128,.18);border-radius:3px;padding:3px 5px;display:flex;flex-direction:column;gap:3px');
			const slotHead = mk('div', {}, 'display:flex;align-items:center;gap:6px;flex-wrap:wrap');
			const slotToggle = mk('button', { textContent: '▸', title: '展开自动变化 / 关联分组' }, 'border:none;background:transparent;cursor:pointer;padding:0;font-size:11px;line-height:1;width:12px;opacity:.7');
			const slotEnable = mk('input', { type: 'checkbox' });
			slotEnable.checked = true;
			const slotName = mk('span', { textContent: multi ? ('槽 ' + (slotIndex + 1)) : '取值' }, 'font-size:10px;opacity:.65;min-width:26px');
			const idx = mk('input', { type: 'number', value: String(slotIndex) }, 'width:44px');
			const val = mk('input', { type: (kind === 'text' || kind === 'bool') ? 'text' : 'number', value: slot.value }, 'width:72px');
			const badge = mk('span', { textContent: '' }, 'font-size:10px;color:#7fd0ff');
			slotHead.appendChild(slotToggle);
			const slotEnableWrap = mk('label', {}, 'display:flex;align-items:center;gap:4px;cursor:pointer');
			slotEnableWrap.appendChild(slotEnable);
			slotEnableWrap.appendChild(slotName);
			slotHead.appendChild(slotEnableWrap);
			slotHead.appendChild(cell('索引', idx, '52px'));
			slotHead.appendChild(cell('值', val, '78px'));
			slotHead.appendChild(badge);
			const slotBody = mk('div', {}, 'display:none;flex-direction:column;gap:4px;padding:3px 0 2px 16px');
			const period = mk('input', { type: 'number', value: (key === 'colors' ? '1' : '0.2'), step: '0.1' }, 'width:100%;min-width:0');
			const step = mk('input', { type: 'number', value: '0.5', step: '0.1' }, 'width:100%;min-width:0');
			const rule = mk('select', {}, 'width:100%;min-width:0');
			[['pingpong', '往复'], ['wrap', '循环']].forEach(([v, t]) => rule.appendChild(mk('option', { value: v, textContent: t })));
			const minI = mk('input', { type: 'number', value: '0' }, 'width:100%;min-width:0');
			const maxI = mk('input', { type: 'number', value: '4' }, 'width:100%;min-width:0');
			const presets = mk('input', { type: 'text', value: SIM_COLOR_PRESETS.join(', ') }, 'width:100%;min-width:0');
			const usageEl = mk('div', {}, 'font-size:10px;line-height:1.45;white-space:pre-wrap');
			usageEl.addEventListener('click', (event) => {
				const target = event && event.target;
				const btn = (target && target.closest) ? target.closest('[data-usage-toggle]') : null;
				if (!btn) return;
				const uid = btn.getAttribute('data-usage-toggle');
				let body = null;
				try { body = usageEl.querySelector('[data-usage-body="' + uid + '"]'); } catch (e) { /* ignore */ }
				if (!body) return;
				const open = body.style.display === 'none';
				sim.usageOpen[uid] = open;
				body.style.display = open ? 'block' : 'none';
				btn.textContent = (open ? '▾ ' : '▸ ') + '未活跃 ' + btn.getAttribute('data-count') + ' 项';
			});
			if (key === 'colors') {
				const colorRow = mk('div', {}, 'display:flex;align-items:flex-end;gap:8px;flex-wrap:wrap');
				colorRow.appendChild(cell('周期（秒）', period, '62px'));
				colorRow.appendChild(cell('预设颜色（逗号分隔，运行时轮换）', presets));
				slotBody.appendChild(colorRow);
			} else if (kind === 'number') {
				const autoRow = mk('div', {}, 'display:flex;align-items:flex-end;gap:8px;flex-wrap:wrap');
				autoRow.appendChild(cell('周期（秒）', period, '62px'));
				autoRow.appendChild(cell('步长', step, '56px'));
				autoRow.appendChild(cell('规则', rule, '72px'));
				autoRow.appendChild(cell('下限', minI, '56px'));
				autoRow.appendChild(cell('上限', maxI, '56px'));
				slotBody.appendChild(autoRow);
			} else {
				slotBody.appendChild(mk('div', { textContent: '（文本 / 布尔输入不支持自动变化）' }, 'font-size:10px;opacity:.5'));
			}
			slotBody.appendChild(usageEl);
			slotBox.appendChild(slotHead);
			slotBox.appendChild(slotBody);
			body.appendChild(slotBox);
			const readSlot = () => {
				slot.enabled = slotEnable.checked;
				slot.index = Number(idx.value) || 0;
				slot.value = val.value;
				slot.period = Math.max(50, (Number(period.value) || 0.2) * 1000);
				if (slot.key === 'colors' || key === 'colors') {
					const list = String(presets.value || '').split(/[,\s;]+/).map(t => t.trim()).filter(Boolean).map(t => Number(t)).filter(v => isFinite(v));
					slot.presets = list.length ? list : [Number(val.value) || 0];
				}
				slot.step = Number(step.value) || 0.5;
				slot.rule = rule.value;
				slot.min = Number(minI.value) || 0;
				slot.max = Number(maxI.value) || 4;
			};
			const refreshSlotState = () => { slotBox.style.opacity = slot.enabled ? '1' : '.5'; };
			const setSlotOpen = (open) => {
				slot.open = open;
				slotBody.style.display = open ? 'flex' : 'none';
				slotToggle.textContent = open ? '▾' : '▸';
			};
			slotToggle.addEventListener('click', (event) => { if (event && event.preventDefault) event.preventDefault(); setSlotOpen(!slot.open); });
			// 改值（或索引）说明就是想用这个槽：自动勾上槽和大类，避免“改了没反应”
			const ensureEnabled = () => {
				if (slotEnable.checked) return;
				slotEnable.checked = true;
				readSlot();
				refreshSlotState();
			};
			val.addEventListener('input', () => { ensureEnabled(); readSlot(); simScheduleTick(); });
			val.addEventListener('change', () => { ensureEnabled(); readSlot(); simScheduleTick(); });
			idx.addEventListener('input', () => { ensureEnabled(); readSlot(); simScheduleTick(); });
			[slotEnable, period, step, rule, minI, maxI, presets].forEach(el => el.addEventListener('change', () => { readSlot(); refreshSlotState(); simUpdateRunUi(); simTick(); }));
			slot.els = { toggle: slotToggle, body: slotBody, enable: slotEnable, idx, val, badge, usage: usageEl, period, step, rule, min: minI, max: maxI, presets };
			refreshSlotState();
			setSlotOpen(false);
			row.slots.push(slot);
		}
		box.appendChild(header);
		box.appendChild(body);
		root.appendChild(box);
		row.els = { enable, state: stateEl, toggle: rowToggle, body };
		enable.addEventListener('change', () => { row.enabled = enable.checked; refreshRowState(); simUpdateRunUi(); simTick(); });
		refreshRowState();
		setRowOpen(true);
		sim_ui.rows[key] = row;
	}
	const controlRow = mk('div', {}, 'display:flex;align-items:center;gap:8px;margin-top:4px');
	const runBtn = mk('button', { textContent: '▶ 运行' }, 'padding:4px 10px;');
	const statusEl = mk('span', { textContent: '已停止' }, 'font-size:10px;opacity:.75');
	controlRow.appendChild(runBtn);
	const refreshBtn = mk('button', { textContent: '⟳ 刷新', title: '结构/属性改动没生效时点这里重建映射' }, 'padding:4px 8px;');
	controlRow.appendChild(refreshBtn);
	const viewSel = mk('select', {}, 'font-size:10px;margin-left:auto');
	[['off', '不活跃分支：不处理'], ['ghost', '不活跃分支：半透明'], ['ghost_lock', '不活跃分支：半透明并锁定'], ['hide', '不活跃分支：完全隐藏'], ['hide_lock', '不活跃分支：完全隐藏并锁定']].forEach(([value, text]) => viewSel.appendChild(mk('option', { value, textContent: text })));
	viewSel.value = sim.viewMode || 'off';
	viewSel.addEventListener('change', () => { simSetViewMode(viewSel.value); simTick(); });
	controlRow.appendChild(statusEl);
	controlRow.appendChild(viewSel);
	const out = mk('div', {}, 'white-space:pre-wrap;font-family:monospace;font-size:11px;opacity:.85;flex:1 1 auto;overflow:auto;border-top:1px solid rgba(128,128,128,.3);padding-top:6px;margin-top:4px');
	sim_ui.out = out;
	sim_ui.runBtn = runBtn;
	sim_ui.status = statusEl;
	runBtn.addEventListener('click', () => toggleSim());
	refreshBtn.addEventListener('click', () => { simInvalidate(); simTick(); });
	root.appendChild(controlRow); root.appendChild(out);
	simUpdateRunUi();
	sim_panel.node.innerHTML = '';
	sim_panel.node.appendChild(root);
	try { if (typeof Panels !== 'undefined' && Panels) Panels[sim_panel.id] = sim_panel; } catch (e) { /* ignore */ }
	if (show_panel !== false) sim_panel.show();
	try { simTick(); } catch (e) { /* ignore */ }
	try { refreshUsage(); } catch (e) { /* ignore */ }
	return sim_panel;
}

/* 遍历分组，得到 输入键+下标 -> [分组名] */
function collectInputUsage() {
	const map = {};
	const add = (key, index, parent, children) => {
		const k = key + '#' + (index || 0);
		map[k] = map[k] || [];
		const exist = map[k].find(entry => entry.parent === parent);
		if (exist) { for (const c of children) if (exist.children.indexOf(c) < 0) exist.children.push(c); }
		else map[k].push({ parent, children: children.slice() });
	};
	const walk = (nodes) => {
		for (const node of nodes || []) {
			if (!node || !isGroup(node)) continue;
			const type = String(node.imm_type || '').replace(/^minecraft:/, '');
			const propRaw = String(node.imm_property || '').replace(/^minecraft:/, '').trim();
			const prop = propRaw || ((type === 'range_dispatch' || type === 'select' || type === 'condition') ? 'custom_model_data' : '');
			const index = Number(node.imm_index) || 0;
			const name = labelOf(node);
			const branchChildren = (node.children || []).filter(isGroup).map(c => labelOf(c));
			// colors：按分组 tints 配置（custom_model_data + index）关联；明确“不生成”则不关联
			const tintIndices = new Set();
			if (node.imm_tint_type !== '' && node.imm_tint_type !== 'none') {
				const tintType = String(node.imm_tint_type == null ? 'custom_model_data' : node.imm_tint_type).replace(/^minecraft:/, '').trim() || 'custom_model_data';
				const rawTintIndex = String(node.imm_tint_index == null ? '' : node.imm_tint_index).trim();
				if (tintType === 'custom_model_data' && /^-?\d+$/.test(rawTintIndex)) tintIndices.add(Number(rawTintIndex));
			}
			for (const tintIndex of tintIndices) add('colors', tintIndex, name, []);
			if (type === 'range_dispatch' && prop === 'custom_model_data') add('floats', index, name, branchChildren);
			else if (type === 'select' && prop === 'custom_model_data') add('strings', index, name, branchChildren);
			else if (type === 'condition' && prop === 'custom_model_data') add('flags', index, name, branchChildren);
			else if (prop && prop !== 'custom_model_data') add(prop, 0, name, []);
			else if (prop === 'selected') add('selected', 0, name, []);
			walk(node.children || []);
		}
	};
	walk((typeof Outliner !== 'undefined' && Outliner && Outliner.root) ? Outliner.root : []);
	return map;
}
function refreshUsage() {
	if (!sim_ui || !sim_ui.rows) return;
	try {
		const usageMap = simGetUsage();
		const prefixOf = (name) => { const m = String(name || '').match(/^\[(-?\d+(?:\.\d+)?)\]/); return m ? Number(m[1]) : null; };
		const groupsHtml = (groups, value, uidPrefix) => {
			const html = [];
			groups.forEach((g, gi) => {
				if (gi > 0) html.push('<hr style="border:none;border-top:1px solid rgba(128,128,128,.25);margin:4px 0">');
				// 按“阈值 <= 当前值”里最大的那个，判定活跃子分支
				let activeIndex = null;
				for (const child of g.children) {
					const k = prefixOf(child);
					if (k === null) continue;
					if (k <= value && (activeIndex === null || k > activeIndex)) activeIndex = k;
				}
				const isActiveChild = (child) => { const k = prefixOf(child); return k !== null && k === activeIndex; };
				html.push('<div style="opacity:.8">· ' + g.parent + '</div>');
				for (const c of g.children.filter(isActiveChild)) html.push('<div style="font-weight:700;color:#7fd0ff">' + c + '</div>');
				const inact = g.children.filter(c => !isActiveChild(c));
				if (inact.length) {
					const uid = uidPrefix + ':' + gi;
					const open = !!sim.usageOpen[uid];
					html.push('<div style="margin-top:2px">');
					html.push('<button data-usage-toggle="' + uid + '" data-count="' + inact.length + '" style="border:none;background:transparent;color:inherit;padding:0;cursor:pointer;font-size:10px;opacity:.6">' + (open ? '▾ ' : '▸ ') + '未活跃 ' + inact.length + ' 项</button>');
					html.push('<div data-usage-body="' + uid + '" style="display:' + (open ? 'block' : 'none') + ';padding-left:10px">');
					for (const c of inact) html.push('<div style="opacity:.45">· ' + c + '</div>');
					html.push('</div></div>');
				}
			});
			return html;
		};
		for (const key of Object.keys(sim_ui.rows)) {
			const row = sim_ui.rows[key];
			for (const slot of row.slots) {
				const usageEl = slot.els && slot.els.usage;
				if (!usageEl) continue;
				const groups = usageMap[key + '#' + slot.index] || [];
				if (!groups.length) { usageEl.innerHTML = '<div style="opacity:.45">关联分组：（无）</div>'; continue; }
				usageEl.innerHTML = groupsHtml(groups, num(slot.value), key + '#' + slot.index).join('');
			}
		}
	} catch (error) { console.error('[装配] refreshUsage error', error); }
}
/* ============================== 模拟求值/* ============================== 模拟求值/* ============================== 模拟求值 ============================== */

/** range_dispatch 的数值来源：custom_model_data → floats[index]；其余走物品属性 */
function simValue(node, inputs) {
	const prop = String((node && node.property) || '').replace(/^minecraft:/, '');
	const index = Number(node && node.index) || 0;
	let value = 0;
	if (prop === 'custom_model_data') value = Number((inputs.floats || [])[index] || 0);
	else if (prop === 'selected') value = inputs.selected ? 1 : 0;
	else if (prop === 'using_item') value = inputs.using_item ? 1 : 0;
	else if (prop === 'damage') value = Number(inputs.damage || 0);
	else if (prop === 'count') value = Number(inputs.count || 0);
	else if (prop === 'time') value = Number(inputs.time || 0);
	else value = Number(inputs[prop] || 0);
	if (!isFinite(value)) value = 0;
	if (node && node.scale) value *= Number(node.scale);
	return value;
}

/** select 的取值：custom_model_data → strings[index]；其余走同名输入 */
function simSelectValue(node, inputs) {
	const prop = String((node && node.property) || '').replace(/^minecraft:/, '');
	const index = Number(node && node.index) || 0;
	if (prop === 'custom_model_data') {
		const list = inputs.strings || [];
		return String(list[index] == null ? '' : list[index]);
	}
	const raw = inputs[prop];
	return raw == null ? '' : String(raw);
}

/** select 的 when：数组里任意一项等于当前值即命中（数字/布尔按字符串比较） */
function simWhenMatches(when, value) {
	const list = Array.isArray(when) ? when : [when];
	if (!list.length) return false;
	return list.some(entry => String(entry) === String(value));
}

/** condition 的布尔判定：custom_model_data → flags[index]；selected / using_item / damaged 走对应输入 */
function simConditionValue(node, inputs) {
	const prop = String((node && node.property) || 'minecraft:selected').replace(/^minecraft:/, '');
	const index = Number(node && node.index) || 0;
	if (prop === 'custom_model_data') return !!(inputs.flags || [])[index];
	if (prop === 'selected') return !!inputs.selected;
	if (prop === 'using_item') return !!inputs.using_item;
	if (prop === 'damaged') return Number(inputs.damage || 0) > 0;
	return !!inputs[prop];
}

/** 按输入求值整棵映射树，返回 [{ node, hit }]；hit=false 表示该分支没有被选中 */
function simEvaluate(node, inputs) {
	const result = [];
	if (!node) return result;
	const type = String(node.type || '').replace(/^minecraft:/, '');
	if (type === 'composite') {
		for (const child of node.models || []) result.push(...simEvaluate(child, inputs));
		return result;
	}
	if (type === 'range_dispatch') {
		const value = simValue(node, inputs);
		let best = null;
		for (const entry of node.entries || []) {
			const threshold = Number(entry && entry.threshold);
			if (!isFinite(threshold) || threshold > value) continue;
			if (!best || threshold >= Number(best.threshold)) best = entry;
		}
		for (const entry of node.entries || []) {
			const isBest = best === entry;
			for (const item of simEvaluate(entry.model, inputs)) result.push({ node: item.node, hit: item.hit && isBest });
		}
		// 没有命中的阈值时才用 fallback（原实现条件写反了）
		if (!best && node.fallback) for (const item of simEvaluate(node.fallback, inputs)) result.push(item);
		return result;
	}
	if (type === 'select') {
		const value = simSelectValue(node, inputs);
		let matched = null;
		for (const item of node.cases || []) {
			const isMatch = !matched && simWhenMatches(item && item.when, value);
			if (isMatch) matched = item;
			for (const model of simEvaluate(item.model, inputs)) result.push({ node: model.node, hit: model.hit && isMatch });
		}
		if (!matched && node.fallback) for (const item of simEvaluate(node.fallback, inputs)) result.push(item);
		return result;
	}
	if (type === 'condition') {
		// 被选中的那一支算命中；另一支也求值但标 hit=false（结果区与视图联动都要知道它没生效）
		const ok = simConditionValue(node, inputs);
		for (const item of simEvaluate(ok ? node.on_true : node.on_false, inputs)) result.push(item);
		for (const item of simEvaluate(ok ? node.on_false : node.on_true, inputs)) result.push({ node: item.node, hit: false });
		return result;
	}
	if (type === 'model') { result.push({ node, hit: true }); return result; }
	return result;
}

function simTick() {
	if (!sim_ui || !sim_ui.rows) return;
	let mapping = null;
	try { mapping = simGetMapping(); } catch (error) {
		try { simRestoreView(); } catch (restoreError) { /* ignore */ }
		if (sim_ui.out) sim_ui.out.textContent = '无法生成映射：' + ((error && error.message) || error);
		return;
	}
	// 清空后再按启用的行/槽写入（禁用 = 不参与求值）
	const inputs = sim.inputs;
	inputs.floats.length = 0;
	inputs.colors.length = 0;
	inputs.strings.length = 0;
	inputs.flags.length = 0;
	inputs.selected = false;
	inputs.using_item = false;
	inputs.damage = 0;
	inputs.count = 0;
	inputs.time = 0;
	const lines = [];
	for (const key of Object.keys(sim_ui.rows)) {
		const row = sim_ui.rows[key];
		// 行复选框只管“自动变化”，手动值始终参与求值
		for (const slot of row.slots) {
			if (!slot.enabled) continue;
			simApplySlot(inputs, key, slot);
			lines.push(simSlotLabel(key, slot));
		}
	}
	const items = simEvaluate(mapping.model, inputs);
	const hits = items.filter(item => item.hit && item.node.model).map(item => item.node.model);
	sim.lastItems = items;
	try { simApplyView(items); } catch (error) { /* ignore */ }
	try { simApplyTints(); } catch (error) { /* ignore */ }
	// 每个槽单独求值一次，得到它自己的命中数（角标）
	for (const key of Object.keys(sim_ui.rows)) {
		const row = sim_ui.rows[key];
		for (const slot of row.slots) {
			if (!slot.enabled) { if (slot.els) slot.els.badge.textContent = ''; continue; }
			if (key === 'colors') {
				const groups = simGetUsage()['colors#' + slot.index] || [];
				if (slot.els) slot.els.badge.textContent = groups.length ? (groups.length + ' 组') : '';
				continue;
			}
			const solo = simBlankInputs();
			simApplySlot(solo, key, slot);
			const count = simEvaluate(mapping.model, solo).filter(item => item.hit && item.node.model).length;
			if (slot.els) slot.els.badge.textContent = count ? ('命中 ' + count) : '';
		}
	}
	lines.push('');
	lines.push('命中 ' + hits.length + ' / 分支 ' + items.length);
	lines.push('');
	for (const item of items) lines.push((item.hit ? '  ✔ ' : '  ✘ ') + (item.node.model || item.node.type));
	if (sim_ui.out) sim_ui.out.textContent = lines.join('\n');
	try { refreshUsage(); } catch (e) { /* ignore */ }
}
function simAutoSlots() {
	const list = [];
	if (!sim_ui || !sim_ui.rows) return list;
	for (const key of Object.keys(sim_ui.rows)) {
		const row = sim_ui.rows[key];
		// 行复选框 = 自动变化开关；槽复选框 = 是否参与（求值与自动都看它）
		if (!row.enabled || row.kind !== 'number') continue;
		for (const slot of row.slots) if (slot.enabled) list.push({ key, slot });
	}
	return list;
}

function simUpdateRunUi() {
	if (!sim_ui || !sim_ui.runBtn) return;
	const running = !!sim.timer;
	sim_ui.runBtn.textContent = running ? '■ 停止' : '▶ 运行';
	sim_ui.runBtn.style.background = running ? 'rgba(127,208,255,.25)' : '';
	sim_ui.runBtn.style.borderColor = running ? 'rgba(127,208,255,.8)' : '';
	if (sim_ui.status) {
		const count = simAutoSlots().length;
		sim_ui.status.textContent = running ? ('运行中 · ' + count + ' 个自动槽') : '已停止';
		sim_ui.status.style.color = running ? '#7fd0ff' : '';
	}
}

function toggleSim() {
	if (sim.timer) { clearInterval(sim.timer); sim.timer = null; simUpdateRunUi(); simTick(); return; }
	const autos = simAutoSlots();
	if (!autos.length) {
		Blockbench.showQuickMessage('没有勾选要自动变化的大类：在数值输入（如 cmdata.floats / colors）前面打勾，再点运行', 3500);
		simUpdateRunUi();
		return;
	}
	const period = Math.min.apply(null, autos.map(item => item.slot.period));
	sim.timer = setInterval(() => {
		try {
			// 每拍重算：中途勾选/取消大类时自动跟随，全部关掉就停下
			const current = simAutoSlots();
			if (!current.length) { clearInterval(sim.timer); sim.timer = null; simUpdateRunUi(); return; }
			const now = Date.now();
			for (const item of current) {
				const slot = item.slot;
				if (!slot.lastTick) slot.lastTick = now;
				if (now - slot.lastTick < slot.period) continue;
				slot.lastTick = now;
				if (item.key === 'colors') {
					const list = (slot.presets && slot.presets.length) ? slot.presets : [Number(slot.value) || 0];
					slot.presetIndex = ((slot.presetIndex || 0) + 1) % list.length;
					slot.value = String(list[slot.presetIndex]);
				} else {
					let value = num(slot.value) + slot.step * slot.dir;
					if (slot.rule === 'wrap') { if (value > slot.max) value = slot.min; }
					else { if (value > slot.max) { value = slot.max; slot.dir = -1; } if (value < slot.min) { value = slot.min; slot.dir = 1; } }
					slot.value = String(value);
				}
				if (slot.els && slot.els.val) slot.els.val.value = slot.value;
			}
			simTick();
		} catch (error) { /* ignore */ }
	}, period);
	simUpdateRunUi();
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
	P(ModelProject, 'boolean', 'imm_block_display', { label: '模型附带 item/generated display 变换（推荐开）', default: true });
	P(ModelProject, 'boolean', 'imm_hide_unavailable', { label: '隐藏当前条件下不可用的分组', default: true });
	P(ModelProject, 'string', 'imm_pack_path', { label: '资源包工程路径（pack.mcmeta 所在目录）', default: '' });
	P(ModelProject, 'string', 'imm_pack_version', {
		label: '目标 Minecraft 版本（pack.mcmeta 格式）',
		default: DEFAULT_PACK_VERSION,
		options: () => {
			const list = {};
			for (const version of PACK_VERSIONS) {
				list[version.id] = version.id + '（资源包格式 ' + packFormatLabel(version)
					+ (version.major >= PACK_MODERN_MIN_MAJOR ? '，min/max_format' : '，pack_format') + '）';
			}
			return list;
		},
	});

	// 面着色：Blockbench 的 UV 编辑器“着色”开关绑定 Face.properties.tint（默认 -1 表示未着色）
	P(Face, 'number', 'tint', { label: '着色 index', default: -1 });

	P(Group, 'string', 'imm_type', { label: '映射类型（type）', description: '语法：{"type": "minecraft:<类型>"}\n作用：决定本节点是哪一种物品模型映射。\ncomposite=结构分组；inline=内联模型（本组方块烘焙成模型）；model=引用模型；还有 range_dispatch / condition / select / empty', default: 'composite', enum_values: MAPPING_TYPES });
	P(Group, 'string', 'imm_model', { label: '引用模型（imm_model）', default: '' });
	try { new Property(Group, 'string', 'imm_model_shift', { default: '', exposed: false, condition: cond }); } catch (e) { /* ignore */ }
	if (typeof Locator !== 'undefined') {
		try { new Property(Locator, 'string', 'imm_call_target', { label: '复调用目标（分组 UUID 或模型 id）', default: '', exposed: false }); } catch (e) { /* ignore */ }
	}
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
	P(Group, 'string', 'imm_tint_type', { label: 'tints 来源类型', default: '', enum_values: ['', 'none', 'custom_model_data', 'constant', 'dye', 'potion', 'grass', 'team'] });
	P(Group, 'number', 'imm_tint_index', { label: 'tints 来源 index（custom_model_data）', default: 0 });
	P(Group, 'string', 'imm_tint_value', { label: 'tints 来源值（constant 的 ARGB / 其它 default）', default: '' });
	P(Group, 'string', 'imm_tints', { label: 'tints（JSON，仅 model / composite 自带模型）', default: '' });
}

let menuAttached = false;
let locatorMenuAttached = false;
function attachGroupMenu() {
	const addSeparator = (menu) => {
		try { if (typeof MenuSeparator !== 'undefined') menu.addAction(new MenuSeparator('imm_menu_sep')); } catch (e) { /* ignore */ }
	};
	try {
		if (!menuAttached && actions.props && typeof Group !== 'undefined' && Group.prototype && Group.prototype.menu && typeof Group.prototype.menu.addAction === 'function') {
			const menu = Group.prototype.menu;
			addSeparator(menu);
			if (actions.createModel) menu.addAction(actions.createModel);
			if (actions.call) menu.addAction(actions.call);
			menu.addAction(actions.props);
			menuAttached = true;
			console.log('[装配] 已加入分组右键菜单');
		}
	} catch (error) { /* ignore */ }
	try {
		if (!locatorMenuAttached && actions.editCall && typeof Locator !== 'undefined' && Locator.prototype && Locator.prototype.menu && typeof Locator.prototype.menu.addAction === 'function') {
			const menu = Locator.prototype.menu;
			addSeparator(menu);
			menu.addAction(actions.editCall);
			locatorMenuAttached = true;
			console.log('[装配] 已加入复调用标签右键菜单');
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
		try {
			if (typeof Setting !== 'undefined') {
				immBoxSetting = new Setting('imm_box_select_groups', {
					name: '框选/多选方块时自动改选所属分组',
					description: '一次选中两个及以上方块时，自动取消方块、改为选中它们各自的父分组；单选一个方块不处理。',
					category: 'edit',
					type: 'checkbox',
					value: false,
				});
				immBatchSetting = new Setting('imm_batch_groups_only', {
					name: '批量选择分组时自动取消单个元素',
					description: '同时选中两个及以上分组时，自动取消被一起选中的方块/定位点，避免批量操作误改单个元素。',
					category: 'edit',
					type: 'checkbox',
					value: false,
				});
			}
		} catch (e) { /* ignore */ }
		const addMenu = (action, path) => {
			try { if (action) MenuBar.addAction(action, path); }
			catch (error) { console.warn('[装配] 菜单挂载失败：' + path, error); }
		};
		try { registerProperties(); } catch (error) { console.error('[装配] 属性注册失败', error); }
		ensurePackVersion();

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
			locators: true,
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
		actions.call = new Action('imm_call_group', { name: '复调用选中的分组', description: '在分组枢轴处创建复调用标签（Locator），导出时替换为目标分组', icon: 'content_copy', category: 'tools', condition, click: callSelectedGroup });
		actions.createModel = new Action('imm_create_model', { name: '从分组创建模型…', description: '把选中分组的方块烘焙成 models/item 模型，并改为引用（自动居中）', icon: 'file_upload', category: 'tools', condition, click: () => { const group = pickTargetGroup(); if (!group) { Blockbench.showMessageBox({ title: '请先选中分组', message: '先在 outliner 里选中一个分组。', icon: 'info' }); return; } createModelFromGroup(group); } });
		actions.check = new Action('imm_check', { name: '检查装配结构', description: '列出分组类型与变换诊断', icon: 'checklist', category: 'tools', condition, click: checkStructure });
		actions.pack = new Action('imm_pick_pack', { name: '选择资源包工程路径…', description: '打开系统文件夹选择框，设为资源包工程目录', icon: 'folder_open', category: 'file', condition: () => (typeof Format !== 'undefined' && Format && Format.id === FORMAT_ID), click: pickPackPath });
		actions.sim = new Action('imm_simulate', { name: '模拟输入…', description: '按 custom_model_data / selected 预览分支命中', icon: 'play_circle', category: 'tools', condition: () => (typeof Format !== 'undefined' && Format && Format.id === FORMAT_ID), click: () => { const panel = buildSimPanel(false); if (panel) { panel.show(); return; } openSimulator(); } });
		actions.viewDiag = new Action('imm_view_diag', { name: '诊断：模拟视图联动', description: '打印匹配到的分组/方块/材质数量', icon: 'bug_report', category: 'tools', condition, click: diagnoseSimView });
		actions.pivot = new Action('imm_fix_pivot', { name: '枢轴归位（对齐几何中心）…', description: '把分组 origin 移到几何中心，补偿方块坐标，外观不变', icon: 'center_focus_strong', category: 'tools', condition, click: openPivotFix });
		actions.props = new Action('imm_group_props', { name: '编辑分组映射属性…', description: '映射类型 / 引用模型 / property 等', icon: 'tune', category: 'tools', condition, click: editGroupProps });
		actions.boxToggle = new Action('imm_box_toggle', { name: '开关：框选方块时改选所属分组', description: '切换“一次选中多个方块时自动改为选中其父分组”', icon: 'select_all', category: 'tools', click: () => { if (!immBoxSetting) { Blockbench.showQuickMessage('当前 Blockbench 不支持该设置', 2500); return; } const next = !boxGroupsEnabled(); setBoxSelectGroups(next); try { if (typeof immBoxSetting.save === 'function') immBoxSetting.save(); } catch (e) { /* ignore */ } Blockbench.showQuickMessage('框选方块改选所属分组：' + (next ? '开' : '关') + (typeof Format !== 'undefined' && Format && Format.id === FORMAT_ID ? '（装配格式内强制开启）' : ''), 2600); } });
		actions.batchToggle = new Action('imm_batch_toggle', { name: '开关：批量选择时取消单个元素', description: '切换“同时选中多个分组时自动取消方块/定位点选择”', icon: 'select_all', category: 'tools', click: () => { if (!immBatchSetting) { Blockbench.showQuickMessage('当前 Blockbench 不支持该设置', 2500); return; } const next = !batchGroupsOnlyEnabled(); setBatchGroupsOnly(next); try { if (typeof immBatchSetting.save === 'function') immBatchSetting.save(); } catch (e) { /* ignore */ } Blockbench.showQuickMessage('批量选择时取消单个元素：' + (next ? '开' : '关'), 2200); } });
		actions.editCall = new Action('imm_edit_call', { name: '编辑复调用标签…', description: '修改选中的复调用 Locator 指向的分组或模型 id', icon: 'edit', category: 'tools', condition: () => (typeof Locator !== 'undefined' && Locator && Locator.selected && Locator.selected.length > 0), click: () => { const locator = (Locator.selected && Locator.selected[0]) || null; if (!locator) { Blockbench.showMessageBox({ title: '请先选中复调用标签', message: '在 outliner 里选中一个 Locator（复调用标签）。', icon: 'info' }); return; } editCallTag(locator); } });

		addMenu(actions.zip, 'file.export');
		addMenu(actions.merge, 'file.export');
		placeInFileMenu(actions.pack, ['save_model', 'export', 'import']);
		
		addMenu(actions.check, 'tools');
		addMenu(actions.createModel, 'tools');
		addMenu(actions.call, 'tools');
		addMenu(actions.import, 'tools');
		addMenu(actions.props, 'tools');
		addMenu(actions.editCall, 'tools');
		addMenu(actions.batchToggle, 'tools');
		addMenu(actions.boxToggle, 'tools');
		addMenu(actions.pivot, 'tools');
		addMenu(actions.viewDiag, 'tools');
		try { buildSimPanel(false); } catch (e) { console.warn('[装配] 面板创建失败（可忽略）', e); }
		// 面板会自动出现在「视图 → 面板」里，不再占用 Tools 菜单
		attachGroupMenu();
		bindOutlinerHook();
		try { Blockbench.on('update_selection', () => { try { guardLockedSelection(); } catch (e) { /* ignore */ } try { guardBatchSelection(); } catch (e) { /* ignore */ } try { guardBoxSelection(); } catch (e) { /* ignore */ } }); } catch (e) { /* ignore */ }
		for (const event of ['add_group', 'remove_group', 'update_selection']) {
			try { Blockbench.on(event, (data) => { simInvalidate(); scheduleBranchSync(data && data.object); }); } catch (e) { /* ignore */ }
		}
		for (const event of ['select_project', 'finished_loading_project', 'update_selection']) {
			try { Blockbench.on(event, () => { try { simRestoreView(); simRestoreTints(); } catch (viewError) { /* ignore */ } simInvalidate(); attachGroupMenu(); }); } catch (e) { /* ignore */ }
		}
		for (const event of ['select_project', 'finished_loading_project']) {
			try { Blockbench.on(event, ensurePackVersion); } catch (e) { /* ignore */ }
		}
		try {
			if (typeof globalThis !== 'undefined' && globalThis.__IMM_TEST__) {
				globalThis.__IMM_TEST__.api = { VERSION, PACK_VERSIONS, DEFAULT_PACK_VERSION, packMcmetaData, packFormatLabel, packMcmetaFormat, ensurePackVersion, simValue, simEvaluate, simTick, simInvalidate, stripStrayBranchPrefixes, fixGroupPivot, collectInputUsage, modelElementsHaveTintIndex, guardLockedSelection, guardBatchSelection, guardBoxSelection, setBoxSelectGroups, setBatchGroupsOnly, centerCubePivot, simApplyGroupVisual, simRestoreView, simSetViewMode, simApplyTints, simRestoreTints, simTintColorOf, assignGroupMapProps, createExporter, pivotContentPoints, rotateAroundQuat, readQuaternion, simViewEntries, getSimState: () => sim, buildSimPanel, getSimUi: () => sim_ui, getSimPanel: () => sim_panel };
			}
		} catch (hookError) { /* ignore */ }
			} catch (error) {
			console.error('[装配] onload 失败：', error);
		}
	},
	onunload() {
		try { if (sim.timer) { clearInterval(sim.timer); sim.timer = null; } } catch (e) { /* ignore */ }
		try { if (sim.tickTimer) { clearTimeout(sim.tickTimer); sim.tickTimer = null; } } catch (e) { /* ignore */ }
		try { simStopViewLoop(); } catch (e) { /* ignore */ }
		try { simRestoreView(); } catch (e) { /* ignore */ }
		try { simRestoreTints(); } catch (e) { /* ignore */ }
		try { if (sim_panel && typeof sim_panel.delete === 'function') sim_panel.delete(); } catch (e) { /* ignore */ }
		sim_panel = null;
		sim_ui = null;
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
