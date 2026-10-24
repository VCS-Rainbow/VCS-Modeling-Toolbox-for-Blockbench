/**
 * 物品模型映射装配（Item Model Definition Assembly）—— Blockbench 模型格式插件
 * ---------------------------------------------------------------------------
 * 注册模型格式 `item_model_definition_assembly`，用于可视化装配 Minecraft Java 版
 * 的「物品模型映射」（assets/<ns>/items/<id>.json）。
 *
 * 结构约定：
 *   - 每个分组（bone）= 一个物品模型映射节点；分组属性里可设 type（composite /
 *     model / range_dispatch / condition / empty）、引用模型、tints、property 等；
 *   - 分组自己的方块 → 生成一个 items/*.json 引用的模型文件（也可用「引用模型」
 *     直接指向已有的 Java 版模型，从而“调用 Java 版方块/物品模型作为子项”）；
 *   - 分组在 Blockbench 里的旋转/位置 → 写到该节点的 transformation；
 *   - 支持从其它格式「转换项目」为本格式（can_convert_to）。
 */

(function () {
'use strict';

const FORMAT_ID = 'item_model_definition_assembly';
const FACE_KEYS = ['north', 'east', 'south', 'west', 'up', 'down'];
const UNIT_PER_BLOCK = 16;
const MAPPING_TYPES = ['composite', 'model', 'range_dispatch', 'condition', 'empty'];

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
let action_export_zip = null;
let action_merge_pack = null;
let action_check = null;
let action_group_props = null;

/* =========================================================================
 * 基础工具
 * ========================================================================= */

function clean(value) {
	const number = Number(value);
	if (!isFinite(number)) return 0;
	const rounded = Math.round(number * 1e6) / 1e6;
	return Math.abs(rounded) < 1e-6 ? 0 : rounded;
}

function cleanAll(list) { return list.map(clean); }
function labelOf(node) { return (node && node.name) ? node.name : 'unnamed'; }
function isGroup(node) { return typeof Group !== 'undefined' && node instanceof Group; }
function isCube(node) { return typeof Cube !== 'undefined' && node instanceof Cube; }

function sanitizePath(value, fallback) {
	const cleaned = String(value == null ? '' : value)
		.toLowerCase()
		.replace(/\\/g, '/')
		.replace(/[^a-z0-9_\-./]+/g, '_')
		.replace(/\/{2,}/g, '/')
		.replace(/_{2,}/g, '_')
		.replace(/^[_.\-/]+/, '')
		.replace(/[_.\-/]+$/, '');
	const safe = cleaned.split('/').filter(segment => segment && segment !== '.' && segment !== '..').join('/');
	return safe || (fallback || 'item');
}

function sanitizeNamespace(value) {
	const cleaned = String(value == null ? '' : value)
		.toLowerCase()
		.replace(/[^a-z0-9_\-.]+/g, '_')
		.replace(/^[_.\-]+/, '')
		.replace(/[_.\-]+$/, '');
	return cleaned || 'custom';
}

function cloneDisplay() { return JSON.parse(JSON.stringify(BLOCK_DISPLAY)); }

/** 内联序列化：数组/对象写在一行（贴近 Blockbench 自己的输出，便于审查） */
function inlineJSON(value) {
	if (Array.isArray(value)) return '[' + value.map(inlineJSON).join(', ') + ']';
	if (value && typeof value === 'object') {
		return '{' + Object.keys(value).map(key => JSON.stringify(key) + ': ' + inlineJSON(value[key])).join(', ') + '}';
	}
	return JSON.stringify(value === undefined ? null : value);
}

/** 模型文件：textures 一行、每个元素一行、display 每个位置一行 */
function formatModelFile(model) {
	const lines = ['{'];
	const keys = Object.keys(model);
	keys.forEach((key, index) => {
		const comma = index === keys.length - 1 ? '' : ',';
		if (key === 'elements' && Array.isArray(model.elements)) {
			if (!model.elements.length) { lines.push('\t"elements": []' + comma); return; }
			lines.push('\t"elements": [');
			model.elements.forEach((element, position) => {
				lines.push('\t\t' + inlineJSON(element) + (position === model.elements.length - 1 ? '' : ','));
			});
			lines.push('\t]' + comma);
		} else if (key === 'display' && model.display) {
			const positions = Object.keys(model.display);
			if (!positions.length) { lines.push('\t"display": {}' + comma); return; }
			lines.push('\t"display": {');
			positions.forEach((position, position_index) => {
				lines.push('\t\t' + JSON.stringify(position) + ': ' + inlineJSON(model.display[position])
					+ (position_index === positions.length - 1 ? '' : ','));
			});
			lines.push('\t}' + comma);
		} else {
			lines.push('\t' + JSON.stringify(key) + ': ' + inlineJSON(model[key]) + comma);
		}
	});
	lines.push('}');
	return lines.join('\n');
}

/** 映射节点：放得下就一行，否则按层级展开 */
function formatNode(node, depth) {
	const pad = '\t'.repeat(depth);
	const pad_in = pad + '\t';
	const fields = ['"type": ' + JSON.stringify(node.type)];
	if (node.model) fields.push('"model": ' + JSON.stringify(node.model));
	if (node.property) fields.push('"property": ' + JSON.stringify(node.property));
	if (node.index !== undefined) fields.push('"index": ' + JSON.stringify(node.index));
	if (node.scale !== undefined) fields.push('"scale": ' + inlineJSON(node.scale));
	if (node.tints) fields.push('"tints": ' + inlineJSON(node.tints));
	if (node.transformation) fields.push('"transformation": ' + inlineJSON(node.transformation));
	if (node.on_true) fields.push('"on_true": ' + formatNode(node.on_true, depth + 1));
	if (node.on_false) fields.push('"on_false": ' + formatNode(node.on_false, depth + 1));
	if (Array.isArray(node.entries)) {
		const entry_pad = pad + '\t\t';
		fields.push('"entries": [\n' + node.entries.map(entry =>
			entry_pad + '{"threshold": ' + JSON.stringify(entry.threshold) + ', "model": ' + formatNode(entry.model, depth + 2) + '}'
		).join(',\n') + '\n' + pad_in + ']');
	}
	if (node.fallback) fields.push('"fallback": ' + formatNode(node.fallback, depth + 1));
	if (Array.isArray(node.models)) {
		if (!node.models.length) {
			fields.push('"models": []');
		} else {
			const child_pad = pad + '\t\t';
			const children = node.models.map(child => child_pad + formatNode(child, depth + 2));
			fields.push('"models": [\n' + children.join(',\n') + '\n' + pad_in + ']');
		}
	}
	if (fields.every(field => field.indexOf('\n') < 0)) {
		const single = '{' + fields.join(', ') + '}';
		if (single.length + pad.length <= 180) return single;
	}
	return '{\n' + fields.map(field => pad_in + field).join(',\n') + '\n' + pad + '}';
}

function formatMappingFile(mapping) {
	return '{\n\t"model": ' + formatNode(mapping.model, 1) + '\n}';
}

/* =========================================================================
 * 旋转数学 / 变换
 * ========================================================================= */

function readLocalQuaternion(node) {
	const mesh = node ? node.mesh : null;
	if (typeof THREE !== 'undefined' && THREE && THREE.Quaternion) {
		const source = mesh && mesh.quaternion;
		if (source && isFinite(source.x) && isFinite(source.y) && isFinite(source.z) && isFinite(source.w)
			&& (source.x * source.x + source.y * source.y + source.z * source.z + source.w * source.w) > 1e-12) {
			return { x: source.x, y: source.y, z: source.z, w: source.w };
		}
		const rotation = (node && node.rotation) || [0, 0, 0];
		if (rotation[0] || rotation[1] || rotation[2]) {
			const order = (mesh && mesh.rotation && mesh.rotation.order) || 'ZYX';
			const euler = new THREE.Euler(
				(rotation[0] || 0) * Math.PI / 180,
				(rotation[1] || 0) * Math.PI / 180,
				(rotation[2] || 0) * Math.PI / 180,
				order
			);
			const quaternion = new THREE.Quaternion().setFromEuler(euler);
			return { x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w };
		}
		return { x: 0, y: 0, z: 0, w: 1 };
	}
	const rotation = (node && node.rotation) || [0, 0, 0];
	const active = [0, 1, 2].filter(axis => Math.abs(rotation[axis] || 0) > 1e-9);
	if (active.length === 0) return { x: 0, y: 0, z: 0, w: 1 };
	if (active.length > 1) return null;
	const half = (rotation[active[0]] || 0) * Math.PI / 360;
	const sin = Math.sin(half);
	return { x: active[0] === 0 ? sin : 0, y: active[0] === 1 ? sin : 0, z: active[0] === 2 ? sin : 0, w: Math.cos(half) };
}

function quaternionToMatrix(q) {
	const xx = q.x * q.x, yy = q.y * q.y, zz = q.z * q.z;
	const xy = q.x * q.y, xz = q.x * q.z, yz = q.y * q.z;
	const wx = q.w * q.x, wy = q.w * q.y, wz = q.w * q.z;
	return [
		1 - 2 * (yy + zz), 2 * (xy - wz), 2 * (xz + wy),
		2 * (xy + wz), 1 - 2 * (xx + zz), 2 * (yz - wx),
		2 * (xz - wy), 2 * (yz + wx), 1 - 2 * (xx + yy),
	];
}

function rotateVector(m, v) {
	return [
		m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
		m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
		m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
	];
}

function projectValue(name, fallback) {
	if (typeof Project === 'undefined' || !Project) return fallback;
	const value = Project[name];
	return (value === undefined || value === null || value === '') ? fallback : value;
}

/* =========================================================================
 * 导出器
 * ========================================================================= */

class AssemblyExporter {

	constructor(settings) {
		this.namespace = settings.namespace;
		this.item_id = settings.item_id;
		this.item_stem = sanitizePath(String(settings.item_id).replace(/\//g, '_'), 'item');
		this.center_pivot = settings.center_pivot !== false;
		this.block_display = settings.block_display !== false;
		this.warnings = [];
		this.models = [];
		this.textures = [];
		this.texture_refs = new Map();
		this.texture_scales = new Map();
		this.used_model_names = new Set();
		this.used_texture_names = new Set();
		this.negative_count = 0;
		this.long_angle_count = 0;
	}

	warn(message) {
		if (!message || this.warnings.indexOf(message) >= 0) return;
		if (this.warnings.length >= 40) return;
		this.warnings.push(message);
	}

	uniqueName(base, used) {
		if (!used.has(base)) { used.add(base); return base; }
		let index = 2;
		while (used.has(base + '_' + index)) index++;
		const name = base + '_' + index;
		used.add(name);
		return name;
	}

	/* ------------------------------ 纹理 ------------------------------ */

	uvScaleForTexture(texture) {
		if (this.texture_scales.has(texture)) return this.texture_scales.get(texture);
		let width = 0;
		let height = 0;
		try {
			if (texture && typeof texture.getUVWidth === 'function') width = Number(texture.getUVWidth()) || 0;
			if (texture && typeof texture.getUVHeight === 'function') height = Number(texture.getUVHeight()) || 0;
		} catch (error) { /* 忽略 */ }
		if (!width && texture) width = Number(texture.uv_width) || 0;
		if (!height && texture) height = Number(texture.uv_height) || 0;
		if (!width) width = Number(projectValue('texture_width', 16)) || 16;
		if (!height) height = Number(projectValue('texture_height', 16)) || 16;
		const scale = { u: width > 0 ? UNIT_PER_BLOCK / width : 1, v: height > 0 ? UNIT_PER_BLOCK / height : 1 };
		this.texture_scales.set(texture, scale);
		return scale;
	}

	resolveTexture(face) {
		if (!face) return null;
		try {
			if (typeof face.getTexture === 'function') {
				const texture = face.getTexture();
				if (texture && texture.uuid) return texture;
			}
		} catch (error) { /* 忽略 */ }
		if (!face.texture) return null;
		const list = (typeof Texture !== 'undefined' && Texture.all) ? Texture.all : [];
		return list.find(texture => texture.uuid === face.texture) || null;
	}

	textureRef(texture) {
		if (this.texture_refs.has(texture)) return this.texture_refs.get(texture);
		const base = sanitizePath(String(texture.name || 'texture').replace(/\.png$/i, ''), 'texture');
		const name = this.uniqueName(base, this.used_texture_names);
		const reference = this.namespace + ':item/' + name;
		this.texture_refs.set(texture, reference);
		this.textures.push({ name, texture });
		return reference;
	}

	/* ------------------------------ 元素 ------------------------------ */

	elementRotation(cube) {
		const rotation = (cube && cube.rotation) ? cube.rotation : [0, 0, 0];
		const active = [0, 1, 2].filter(axis => Math.abs(Number(rotation[axis]) || 0) > 1e-6);
		if (active.length !== 1) return null;
		const axis = active[0];
		const angle = clean(Number(rotation[axis]) || 0);
		if (Math.abs(angle) > 45.001) this.long_angle_count++;
		const origin = (cube && cube.origin) ? cube.origin : [0, 0, 0];
		return {
			origin: cleanAll([Number(origin[0]) || 0, Number(origin[1]) || 0, Number(origin[2]) || 0]),
			axis: ['x', 'y', 'z'][axis],
			angle,
			rescale: !!cube.rescale,
		};
	}

	compileElement(cube, texture_order) {
		try {
			if (cube.autouv && typeof cube.mapAutoUV === 'function') cube.mapAutoUV();
		} catch (error) { /* 忽略 */ }

		const inflate = typeof cube.inflate === 'number' ? cube.inflate : 0;
		const raw_from = [0, 1, 2].map(axis => (cube.from ? (Number(cube.from[axis]) || 0) : 0));
		const raw_to = [0, 1, 2].map(axis => (cube.to ? (Number(cube.to[axis]) || 0) : 0));
		const from = raw_from.map(value => value - inflate);
		const to = raw_to.map(value => value + inflate);
		if (raw_from.some((value, axis) => value > raw_to[axis])) this.negative_count++;

		const faces = {};
		let face_count = 0;
		for (const direction of FACE_KEYS) {
			const face = cube.faces ? cube.faces[direction] : null;
			if (!face) continue;
			const texture = this.resolveTexture(face);
			if (!texture) continue;
			if (!texture_order.has(texture)) texture_order.set(texture, String(texture_order.size));

			const scale = this.uvScaleForTexture(texture);
			const raw_uv = face.uv || [0, 0, 0, 0];
			const scaled = [
				(Number(raw_uv[0]) || 0) * scale.u,
				(Number(raw_uv[1]) || 0) * scale.v,
				(Number(raw_uv[2]) || 0) * scale.u,
				(Number(raw_uv[3]) || 0) * scale.v,
			];
			const uv = scaled.map(value => clean(Math.min(UNIT_PER_BLOCK, Math.max(0, value))));
			const entry = { uv, texture: '#' + texture_order.get(texture) };
			if (face.rotation) entry.rotation = clean(face.rotation);
			if (typeof face.tint === 'number' && face.tint > 0) entry.tintindex = face.tint;
			faces[direction] = entry;
			face_count++;
		}
		if (!face_count) {
			this.warn('方块 “' + labelOf(cube) + '” 没有任何带纹理的面，已跳过。');
			return null;
		}

		const element = { from: cleanAll(from), to: cleanAll(to), faces };
		const rotation = this.elementRotation(cube);
		if (rotation) element.rotation = rotation;
		if (cube.shade === false) element.shade = false;
		return element;
	}

	/** 生成本层方块的模型文件，返回引用 */
	addModel(cubes, hint) {
		const texture_order = new Map();
		const elements = [];
		for (const cube of cubes) {
			const element = this.compileElement(cube, texture_order);
			if (element) elements.push(element);
		}
		if (!elements.length) return null;

		// 居中：把这份几何的中点移到 (8,8,8)，真正的位移/旋转交给 transformation。
		// Java 模型元素的 from/to 有 [-16,32] 限制，transformation 则自由得多。
		const shift = this.centerElements(elements);
		for (const element of elements) {
			element.from = element.from.map((value, axis) => clean(value - shift[axis]));
			element.to = element.to.map((value, axis) => clean(value - shift[axis]));
			if (element.rotation) {
				element.rotation.origin = element.rotation.origin.map((value, axis) => clean(value - shift[axis]));
			}
		}

		const textures = {};
		let particle = null;
		for (const [texture, key] of texture_order) {
			const reference = this.textureRef(texture);
			textures[key] = reference;
			if (!particle) particle = reference;
		}
		if (particle) textures.particle = particle;

		const model = { textures, elements };
		if (this.block_display) model.display = cloneDisplay();

		const base = sanitizePath(this.item_stem + '_' + (hint || 'part'), 'model');
		const name = this.uniqueName(base, this.used_model_names);
		this.models.push({ name, data: model });
		return { reference: this.namespace + ':item/' + name, shift };
	}

	/** 元素集合的包围盒中点（考虑元素自转），返回需要平移的量：中点 − (8,8,8) */
	centerElements(elements) {
		const min = [Infinity, Infinity, Infinity];
		const max = [-Infinity, -Infinity, -Infinity];
		for (const element of elements) {
			let corners = [];
			for (const x of [element.from[0], element.to[0]]) {
				for (const y of [element.from[1], element.to[1]]) {
					for (const z of [element.from[2], element.to[2]]) corners.push([x, y, z]);
				}
			}
			if (element.rotation) {
				const axis = Math.max(0, ['x', 'y', 'z'].indexOf(element.rotation.axis));
				const angle = (element.rotation.angle || 0) * Math.PI / 180;
				const c = Math.cos(angle);
				const s = Math.sin(angle);
				const R = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
				const i = (axis + 1) % 3;
				const j = (axis + 2) % 3;
				R[i][i] = c; R[i][j] = -s; R[j][i] = s; R[j][j] = c;
				const origin = element.rotation.origin || [0, 0, 0];
				corners = corners.map(p => {
					const v = [p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]];
					const r = [0, 1, 2].map(row => R[row][0] * v[0] + R[row][1] * v[1] + R[row][2] * v[2]);
					return [r[0] + origin[0], r[1] + origin[1], r[2] + origin[2]];
				});
			}
			for (const p of corners) {
				for (let k = 0; k < 3; k++) {
					if (p[k] < min[k]) min[k] = p[k];
					if (p[k] > max[k]) max[k] = p[k];
				}
			}
		}
		if (!isFinite(min[0])) return [0, 0, 0];
		return [0, 1, 2].map(k => (min[k] + max[k]) / 2 - UNIT_PER_BLOCK / 2);
	}

	/* ------------------------------ 变换 ------------------------------ */

	/**
	 * 分组变换 → transformation
	 *
	 * 元素坐标已经被居中过（模型中点移到 (8,8,8)），记平移量 d = 中点 − (8,8,8)。
	 * 于是原始坐标 p = p′ + d，目标映射为 p′ → R·(p′ + d − O) + O
	 *   = R·p′ + [R·d + O − R·O]
	 * 分解形式里 translation 就是该常数项除以 16：
	 *   t = [R·d + O′ − R·O′] / 16      （O′ = O，或 O − (8,8,8)）
	 */
	buildTransformation(node, shift) {
		const quaternion = readLocalQuaternion(node);
		if (!quaternion) return null;
		const length = Math.hypot(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
		if (length > 1e-9) {
			quaternion.x /= length; quaternion.y /= length; quaternion.z /= length; quaternion.w /= length;
		}
		let flip = quaternion.w < 0;
		if (!flip && Math.abs(quaternion.w) < 1e-9) {
			for (const component of [quaternion.x, quaternion.y, quaternion.z]) {
				if (Math.abs(component) > 1e-9) { flip = component < 0; break; }
			}
		}
		if (flip) {
			quaternion.x = -quaternion.x; quaternion.y = -quaternion.y;
			quaternion.z = -quaternion.z; quaternion.w = -quaternion.w;
		}

		const d = Array.isArray(shift) ? shift : [0, 0, 0];
		const has_shift = Math.abs(d[0]) + Math.abs(d[1]) + Math.abs(d[2]) > 1e-6;
		if (Math.abs(quaternion.w) > 1 - 1e-7 && !has_shift) return null;

		const matrix = quaternionToMatrix(quaternion);
		const origin = (node && node.origin) ? node.origin : [0, 0, 0];
		const offset = this.center_pivot ? UNIT_PER_BLOCK / 2 : 0;
		const pivot = [
			(Number(origin[0]) || 0) - offset,
			(Number(origin[1]) || 0) - offset,
			(Number(origin[2]) || 0) - offset,
		];
		const rotated = rotateVector(matrix, pivot);
		const moved = rotateVector(matrix, d);
		return {
			translation: cleanAll([0, 1, 2].map(axis =>
				(moved[axis] + pivot[axis] - rotated[axis]) / UNIT_PER_BLOCK)),
			left_rotation: cleanAll([quaternion.x, quaternion.y, quaternion.z, quaternion.w]),
			scale: [1, 1, 1],
			right_rotation: [0, 0, 0, 1],
		};
	}

	/* ------------------------------ 结构 ------------------------------ */

	normalizeType(value) {
		const type = String(value || 'composite').toLowerCase().replace(/^minecraft:/, '');
		return MAPPING_TYPES.indexOf(type) >= 0 ? type : 'composite';
	}

	parseTints(value) {
		if (!value) return null;
		try {
			const parsed = typeof value === 'string' ? JSON.parse(value) : value;
			if (Array.isArray(parsed) && parsed.length) return parsed;
		} catch (error) {
			this.warn('分组 tints 不是合法 JSON，已忽略：' + String(value).slice(0, 60));
		}
		return null;
	}

	/** 本层几何：优先「引用模型」，否则根据自身方块生成模型文件 */
	ownModelRef(group, cubes, hint) {
		const reference = group.imm_model;
		if (reference) return { reference: String(reference).trim(), shift: [0, 0, 0] };
		if (!cubes.length) return null;
		return this.addModel(cubes, hint);
	}

	buildNode(group, hint) {
		const children = (group.children || []).filter(child => child && child.export !== false);
		const child_groups = children.filter(child => isGroup(child));
		const cubes = children.filter(child => isCube(child));
		const type = this.normalizeType(group.imm_type);

		const own = this.ownModelRef(group, cubes, hint);
		const own_ref = own ? own.reference : null;
		const own_shift = own ? own.shift : [0, 0, 0];

		const node = { type: 'minecraft:' + type };
		const transformation = this.buildTransformation(group, own_shift);
		if (transformation) node.transformation = transformation;

		if (type === 'empty') return node;

		if (type === 'model') {
			if (!own_ref) {
				this.warn('分组 “' + labelOf(group) + '” 是 model 类型但没有方块也没有引用模型，已跳过。');
				return null;
			}
			node.model = own_ref;
			const tints = this.parseTints(group.imm_tints);
			if (tints) node.tints = tints;
			return node;
		}

		if (type === 'range_dispatch') {
			node.property = String(group.imm_property || 'minecraft:custom_model_data');
			const scale = Number(group.imm_scale);
			if (isFinite(scale) && scale && scale !== 1) node.scale = clean(scale);
			const index = Number(group.imm_index);
			if (String(group.imm_index || '').length && isFinite(index)) node.index = index;
			node.entries = [];
			for (const child of child_groups) {
				const child_node = this.buildNode(child, hint + '_' + sanitizePath(labelOf(child), 'group'));
				if (!child_node) continue;
				const threshold = Number(child.imm_threshold);
				node.entries.push({ threshold: isFinite(threshold) ? clean(threshold) : 0, model: child_node });
			}
			if (own_ref) node.fallback = { type: 'minecraft:model', model: own_ref };
			if (!node.entries.length && !node.fallback) return null;
			return node;
		}

		const models = [];
		if (own_ref) models.push({ type: 'minecraft:model', model: own_ref });
		for (const child of child_groups) {
			const child_node = this.buildNode(child, hint + '_' + sanitizePath(labelOf(child), 'group'));
			if (child_node) models.push(child_node);
		}
		if (!models.length) {
			this.warn('分组 “' + labelOf(group) + '” 里没有可导出的内容，已跳过。');
			return null;
		}

		if (type === 'condition') {
			node.property = String(group.imm_property || 'minecraft:selected');
			node.on_true = models[0];
			node.on_false = models[1] || { type: 'minecraft:empty' };
			if (models.length > 2) {
				this.warn('分组 “' + labelOf(group) + '” 是 condition 类型，只有前两个子项会作为 on_true/on_false。');
			}
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
				const built = this.buildNode(node, sanitizePath(labelOf(node), 'group'));
				if (built) models.push(built);
			} else if (isCube(node)) {
				loose.push(node);
			}
		}

		if (loose.length) {
			const built = this.addModel(loose, 'root');
			if (built) {
				const node = { type: 'minecraft:model', model: built.reference };
				if (built.shift.some(value => Math.abs(value) > 1e-6)) {
					node.transformation = {
						translation: cleanAll(built.shift.map(value => value / UNIT_PER_BLOCK)),
						left_rotation: [0, 0, 0, 1],
						scale: [1, 1, 1],
						right_rotation: [0, 0, 0, 1],
					};
				}
				models.push(node);
			}
		}
		if (!models.length) {
			throw new Error('当前项目里没有可导出的分组或方块。');
		}
		return { model: { type: 'minecraft:composite', models } };
	}

	buildNotes() {
		const notes = [];
		if (this.negative_count) {
			notes.push('负尺寸（from > to）方块：' + this.negative_count + ' 个，已原样输出（与 Blockbench 一致）。');
		}
		if (this.long_angle_count) {
			notes.push('单轴旋转角超出 ±45° 的方块：' + this.long_angle_count + ' 个，已写成元素 rotation，游戏可能拒绝。');
		}
		for (const warning of this.warnings) notes.push('- ' + warning);
		return notes.length ? notes.join('\n') : null;
	}

	/** 产出资源包文件列表 */
	buildFiles() {
		const mapping = this.buildMapping();
		const files = [
			{ path: 'assets/' + this.namespace + '/items/' + this.item_id + '.json', data: formatMappingFile(mapping) },
		];
		for (const model of this.models) {
			files.push({ path: 'assets/' + this.namespace + '/models/item/' + model.name + '.json', data: formatModelFile(model.data) });
		}
		for (const texture of this.textures) {
			const source = texture.texture && texture.texture.source;
			if (typeof source === 'string' && source.startsWith('data:image')) {
				const comma = source.indexOf(',');
				if (comma > 0) {
					files.push({
						path: 'assets/' + this.namespace + '/textures/item/' + texture.name + '.png',
						data: source.slice(comma + 1),
						base64: true,
					});
					continue;
				}
			}
			this.warn('纹理 “' + texture.name + '” 没有内嵌数据，需手动放到 assets/' + this.namespace + '/textures/item/');
		}
		const notes = this.buildNotes();
		if (notes) files.push({ path: this.item_stem + '.notes.txt', data: notes });
		return { files, mapping };
	}
}

/* =========================================================================
 * 导出入口
 * ========================================================================= */

function createExporter() {
	return new AssemblyExporter({
		namespace: sanitizeNamespace(projectValue('imm_namespace', 'custom')),
		item_id: sanitizePath(String(projectValue('model_identifier', '') || (Project && Project.name) || 'item'), 'item'),
		center_pivot: projectValue('imm_center_pivot', false) === true,
		block_display: projectValue('imm_block_display', true) !== false,
	});
}

function compileAssembly() {
	const exporter = createExporter();
	return formatMappingFile(exporter.buildMapping());
}

function exportResourcePack() {
	if (typeof Project === 'undefined' || !Project) {
		Blockbench.showQuickMessage('请先打开一个项目', 3000);
		return;
	}
	if (typeof JSZip === 'undefined') {
		Blockbench.showMessageBox({ title: '缺少 JSZip', message: '当前环境没有 JSZip，无法打包。', icon: 'error' });
		return;
	}
	try {
		const exporter = createExporter();
		const { files } = exporter.buildFiles();
		const zip = new JSZip();
		for (const file of files) {
			if (file.base64) zip.file(file.path, file.data, { base64: true });
			else zip.file(file.path, file.data);
		}
		zip.generateAsync({ type: 'blob' }).then(content => {
			Blockbench.export({
				type: 'Zip Archive',
				extensions: ['zip'],
				name: exporter.item_stem,
				content,
				savetype: 'zip',
			});
			Blockbench.showQuickMessage('已生成资源包：' + files.length + ' 个文件', 4000);
			const notes = exporter.buildNotes();
			if (notes) console.warn('[物品模型映射装配] 提示：\n' + notes);
		});
	} catch (error) {
		console.error(error);
		Blockbench.showMessageBox({ title: '导出失败', message: String((error && error.message) || error), icon: 'error' });
	}
}

let group_menu_attached = false;

/** 尝试把动作挂到分组的右键菜单（Group.prototype.menu 可能晚于插件加载才创建，所以会多次尝试） */
function attachGroupMenu() {
	if (group_menu_attached || !action_group_props) return group_menu_attached;
	try {
		if (typeof Group === 'undefined' || !Group.prototype) return false;
		if (Group.prototype.menu && typeof Group.prototype.menu.addAction === 'function') {
			Group.prototype.menu.addAction(action_group_props);
			group_menu_attached = true;
			console.log('[物品模型映射装配] 已加入分组右键菜单');
		}
	} catch (error) {
		console.warn('[物品模型映射装配] 挂载分组右键菜单失败：', error);
	}
	return group_menu_attached;
}

/** 找到当前选中的分组（Blockbench 各版本把分组选存放在不同位置，逐个兜底） */
function pickTargetGroup() {
	const found = [];
	const push = (node) => { if (isGroup(node) && found.indexOf(node) < 0) found.push(node); };
	try { if (typeof Group !== 'undefined' && Group.first_selected) push(Group.first_selected); } catch (error) { /* 忽略 */ }
	try { if (typeof Group !== 'undefined' && Array.isArray(Group.selected)) Group.selected.forEach(push); } catch (error) { /* 忽略 */ }
	try {
		if (typeof Outliner !== 'undefined' && Outliner && Array.isArray(Outliner.selected)) Outliner.selected.forEach(push);
	} catch (error) { /* 忽略 */ }
	return found[0] || null;
}

/** Blockbench 不会渲染被 exposed 的分组属性，所以自带一个编辑对话框 */
function openGroupProperties() {
	const group = pickTargetGroup();
	if (!group) {
		Blockbench.showMessageBox({
			title: '请先选中分组',
			message: '先在 outliner（大纲）里点选一个分组，再运行「编辑分组映射属性…」。',
			icon: 'info',
		});
		return;
	}

	new Dialog({
		id: 'imm_group_properties',
		title: '分组映射属性 — ' + labelOf(group),
		width: 660,
		form: {
			imm_type: {
				label: '映射类型',
				type: 'select',
				value: String(group.imm_type || 'composite'),
				options: {
					composite: 'composite（并列渲染子项）',
					model: 'model（引用一个模型）',
					range_dispatch: 'range_dispatch（数值分支）',
					condition: 'condition（布尔分支）',
					empty: 'empty（不渲染）',
				},
			},
			imm_model: {
				label: '引用模型（Java 版模型 id，留空 = 用本层方块生成模型文件）',
				type: 'text',
				value: String(group.imm_model || ''),
			},
			imm_property: {
				label: 'property（range_dispatch / condition 用）',
				type: 'text',
				value: String(group.imm_property || ''),
			},
			imm_index: {
				label: 'index（custom_model_data 下标）',
				type: 'number',
				value: Number(group.imm_index) || 0,
			},
			imm_threshold: {
				label: 'threshold（父层是 range_dispatch 时）',
				type: 'number',
				value: Number(group.imm_threshold) || 0,
			},
			imm_scale: {
				label: 'scale（range_dispatch）',
				type: 'number',
				value: Number(group.imm_scale) || 1,
			},
			imm_tints: {
				label: 'tints（JSON，仅 model 类型）',
				type: 'text',
				value: String(group.imm_tints || ''),
			},
		},
		onConfirm(result) {
			try {
				Undo.initEdit({ groups: [group] });
				group.imm_type = result.imm_type;
				group.imm_model = result.imm_model;
				group.imm_property = result.imm_property;
				group.imm_index = Number(result.imm_index) || 0;
				group.imm_threshold = Number(result.imm_threshold) || 0;
				group.imm_scale = Number(result.imm_scale) || 1;
				group.imm_tints = result.imm_tints;
				Undo.finishEdit('修改分组映射属性');
				Blockbench.showQuickMessage('已更新 “' + labelOf(group) + '” 的映射属性', 2500);
			} catch (error) {
				console.error(error);
				Blockbench.showMessageBox({ title: '修改失败', message: String((error && error.message) || error), icon: 'error' });
			}
		},
	}).show();
}

/* ---------- 直接合并到资源包（桌面版） ---------- */

const MERGE_MANIFEST = '.imm-assembly-manifest.json';

function getScopedFs(scope_root) {
	if (typeof requireNativeModule !== 'function') return null;
	try {
		return requireNativeModule('fs', {
			scope: scope_root,
			message: '需要读写资源包目录才能直接合并导出',
			show_permission_dialog: true,
		});
	} catch (error) {
		console.warn('[物品模型映射装配] 无法获取 fs：', error);
		return null;
	}
}

function getPathModule() {
	try { return (typeof requireNativeModule === 'function') ? requireNativeModule('path') : null; }
	catch (error) { return null; }
}

function isSafeGeneratedPath(relative_path) {
	if (!relative_path || relative_path.startsWith('/') || relative_path.includes('..')) return false;
	return relative_path.startsWith('assets/');
}

async function mergeIntoPack() {
	if (typeof Project === 'undefined' || !Project) {
		Blockbench.showQuickMessage('请先打开一个项目', 3000);
		return;
	}
	let root = String(projectValue('imm_pack_path', '') || '').trim();

	const runMerge = (target_root) => {
		try {
			const exporter = createExporter();
			const { files: all_files } = exporter.buildFiles();
			// 只把 assets/ 下的内容写进资源包；.notes.txt 之类留给 zip 导出（避免污染资源包根目录）
			const files = all_files.filter(file => file.path.startsWith('assets/'));
			const pathmod = getPathModule();
			const fs_module = getScopedFs(target_root);
			if (!fs_module || !pathmod) {
				Blockbench.showMessageBox({
					title: '当前环境不支持直接合并',
					message: '需要桌面版 Blockbench（网页版没有本地文件权限）。请改用「导出装配资源包 (zip)」。',
					icon: 'warning',
				});
				return;
			}

			// 上一轮写过的文件清单（用于清理重命名后残留的模型文件）
			const manifest_path = pathmod.join(target_root, MERGE_MANIFEST);
			let previous = [];
			try {
				if (fs_module.existsSync(manifest_path)) {
					const parsed = JSON.parse(fs_module.readFileSync(manifest_path, 'utf8'));
					if (Array.isArray(parsed && parsed.files)) previous = parsed.files.filter(value => typeof value === 'string');
				}
			} catch (error) { /* 清单损坏就跳过清理 */ }

			// 计算改动清单（覆盖 / 新建 / 删除），先让用户确认
			const current = new Set(files.map(file => file.path));
			const overwritten = [];
			const added = [];
			for (const file of files) {
				if (fs_module.existsSync(pathmod.join(target_root, file.path))) overwritten.push(file.path);
				else added.push(file.path);
			}
			const stale = [];
			for (const relative_path of previous) {
				if (current.has(relative_path) || !isSafeGeneratedPath(relative_path)) continue;
				if (fs_module.existsSync(pathmod.join(target_root, relative_path))) stale.push(relative_path);
			}

			const lines = ['目标：' + target_root, ''];
			const section = (title, list) => {
				if (!list.length) return;
				lines.push(title + '（' + list.length + ' 个）');
				list.slice(0, 20).forEach(item => lines.push('  ' + item));
				if (list.length > 20) lines.push('  … 其余 ' + (list.length - 20) + ' 个');
				lines.push('');
			};
			section('覆盖已有文件', overwritten);
			section('新建文件', added);
			section('删除过期文件', stale);
			if (!overwritten.length && !added.length && !stale.length) lines.push('（没有任何变化）');
			lines.push('合并后游戏里按 F3+T 重载资源包。');

			Blockbench.showMessageBox({
				title: '合并到资源包 — 确认改动',
				message: lines.join('\n'),
				buttons: ['取消', '重新选择…', '合并'],
				confirm: 2,
				cancel: 0,
			}, button => {
				if (button === 1) { pickRoot(); return; }
				if (button !== 2) return;
				try {
					let written = 0;
					for (const file of files) {
						const full_path = pathmod.join(target_root, file.path);
						fs_module.mkdirSync(pathmod.dirname(full_path), { recursive: true });
						Blockbench.writeFile(full_path, {
							content: file.base64 ? ('data:image/png;base64,' + file.data) : file.data,
							savetype: file.base64 ? 'image' : 'text',
						});
						if (!fs_module.existsSync(full_path)) throw new Error('写入失败：' + full_path);
						written++;
					}
					let removed = 0;
					for (const relative_path of stale) {
						try {
							fs_module.unlinkSync(pathmod.join(target_root, relative_path));
							removed++;
						} catch (error) { /* 删不掉就算了 */ }
					}
					Blockbench.writeFile(manifest_path, {
						content: JSON.stringify({ version: 1, files: Array.from(current) }, null, 2),
						savetype: 'text',
					});
					Project.imm_pack_path = target_root;
					Project.saved = false;
					Blockbench.showQuickMessage('已合并 ' + written + ' 个文件'
						+ (removed ? ('，清理 ' + removed + ' 个过期文件') : '') + ' → 游戏里按 F3+T 重载', 5000);
					const notes = exporter.buildNotes();
					if (notes) console.warn('[物品模型映射装配] 提示：\n' + notes);
				} catch (write_error) {
					console.error(write_error);
					Blockbench.showMessageBox({
						title: '合并失败',
						message: String((write_error && write_error.message) || write_error),
						icon: 'error',
					});
				}
			});
		} catch (error) {
			console.error(error);
			Blockbench.showMessageBox({ title: '合并失败', message: String((error && error.message) || error), icon: 'error' });
		}
	};

	const pickRoot = async () => {
		if (typeof Blockbench.pickDirectory !== 'function') {
			Blockbench.showMessageBox({
				title: '当前环境不支持选择文件夹',
				message: '网页版无法选择本地文件夹。请改用「导出装配资源包 (zip)」，或直接在项目设置里填写「合并目标资源包路径」。',
				icon: 'warning',
			});
			return;
		}
		const picked = await Promise.resolve(Blockbench.pickDirectory({ resource_id: 'imm_merge_pack', title: '选择目标资源包文件夹' }));
		if (!picked) { Blockbench.showQuickMessage('已取消', 2000); return; }
		runMerge(picked);
	};

	if (!root) { await pickRoot(); return; }

	runMerge(root);
}

/** 诊断：列出每个分组的 origin / rotation / 四元数 / 算出来的 translation */
function checkAssembly() {
	if (typeof Project === 'undefined' || !Project) return;
	const lines = [];
	const root = (typeof Outliner !== 'undefined' && Outliner && Outliner.root) ? Outliner.root : [];
	const fmt = (v) => '[' + v.map(x => (Math.round(x * 1000) / 1000)).join(', ') + ']';

	const debugTransform = (group) => {
		try {
			const quaternion = readLocalQuaternion(group);
			if (!quaternion) return 'q=?';
			const q = '[' + [quaternion.x, quaternion.y, quaternion.z, quaternion.w]
				.map(v => (Math.round(v * 1000) / 1000)).join(', ') + ']';
			const exporter = new AssemblyExporter({ namespace: 'x', item_id: 'x', center_pivot: false });
			const transformation = exporter.buildTransformation(group);
			const t = transformation ? fmt(transformation.translation) : '[0, 0, 0]';
			const angle = 2 * Math.acos(Math.min(1, Math.abs(quaternion.w))) * 180 / Math.PI;
			return 'q=' + q + ' 角=' + angle.toFixed(1) + '° t=' + t;
		} catch (error) { return 'q=ERR'; }
	};

	const walk = (nodes, depth) => {
		for (const node of nodes) {
			if (!node) continue;
			if (isGroup(node)) {
				const type = String(node.imm_type || 'composite').replace(/^minecraft:/, '');
				const own = (node.children || []).filter(child => isCube(child)).length;
				lines.push('  '.repeat(depth) + '• ' + labelOf(node) + '  [' + type + '] cubes=' + own
					+ (node.imm_model ? ' → ' + node.imm_model : ''));
				lines.push('  '.repeat(depth + 1) + 'origin=' + fmt(node.origin || [0, 0, 0])
					+ ' rot=' + fmt(node.rotation || [0, 0, 0]) + ' ' + debugTransform(node));
				walk(node.children || [], depth + 1);
			}
		}
	};
	walk(root, 0);
	Blockbench.showMessageBox({
		title: '装配结构 / 变换诊断',
		message: lines.length ? lines.join('\n') : '（没有分组）',
		icon: 'info',
	});
}

/* =========================================================================
 * 属性（分组 / 项目）
 * ========================================================================= */

function registerProperties() {
	const format_condition = { formats: [FORMAT_ID] };

	new Property(ModelProject, 'string', 'imm_namespace', {
		label: '命名空间（namespace）',
		default: 'custom',
		exposed: true,
		condition: format_condition,
		description: '导出时写入 assets/<namespace>/items/<id>.json',
	});
	new Property(ModelProject, 'boolean', 'imm_center_pivot', {
		label: '旋转枢轴用 (0.5,0.5,0.5)（= 像素 8,8,8）；关闭则用原点 (0,0,0)',
		default: false,
		exposed: true,
		condition: format_condition,
		description: 'translation 坐标系里原点 = 模型角落 (0,0,0)，物品中心 = (0.5,0.5,0.5)。默认关闭：枢轴 = block 原点，t = O/16 − R·(O/16)；开启则枢轴 = 中心，t = (O−8)/16 − R·((O−8)/16)。',
	});
	new Property(ModelProject, 'boolean', 'imm_block_display', {
		label: '模型附带方块 display 变换',
		default: true,
		exposed: true,
		condition: format_condition,
		description: '给生成的模型补上原版 block/block 的 display，手持/GUI 位置正常',
	});

	new Property(ModelProject, 'string', 'imm_pack_path', {
		label: '合并目标资源包路径',
		default: '',
		exposed: true,
		condition: format_condition,
		description: '「合并到资源包…」写入的目录；留空则每次弹文件夹选择。合并会覆盖同名文件并清理上一轮生成的过期模型。',
	});

	new Property(Group, 'string', 'imm_type', {
		label: '映射类型',
		default: 'composite',
		enum_values: MAPPING_TYPES,
		exposed: true,
		condition: format_condition,
		description: 'composite / model / range_dispatch / condition / empty',
	});
	new Property(Group, 'string', 'imm_model', {
		label: '引用模型（Java 版模型 id）',
		default: '',
		exposed: true,
		condition: format_condition,
		description: '如 sqsp:item/inker/jet_rifle/sac.full：本层直接用该 Java 版方块/物品模型作为子项；留空则用本层方块生成模型文件',
	});
	new Property(Group, 'string', 'imm_property', {
		label: 'property',
		default: '',
		exposed: true,
		condition: format_condition,
		description: 'range_dispatch / condition 的 property，如 minecraft:custom_model_data、minecraft:selected',
	});
	new Property(Group, 'number', 'imm_index', {
		label: 'index',
		default: 0,
		exposed: true,
		condition: format_condition,
		description: 'custom_model_data 的下标',
	});
	new Property(Group, 'number', 'imm_threshold', {
		label: 'threshold（父层为 range_dispatch 时）',
		default: 0,
		exposed: true,
		condition: format_condition,
	});
	new Property(Group, 'number', 'imm_scale', {
		label: 'scale（range_dispatch）',
		default: 1,
		exposed: true,
		condition: format_condition,
	});
	new Property(Group, 'string', 'imm_tints', {
		label: 'tints（JSON，仅 model 类型）',
		default: '',
		exposed: true,
		condition: format_condition,
		description: '例如 [{"type":"custom_model_data","index":0,"default":0}]',
	});
}

/* =========================================================================
 * 注册
 * ========================================================================= */

Plugin.register('item_model_definition_assembly', {
	title: '物品模型映射装配',
	author: 'Blockbench',
	icon: 'account_tree',
	description: '新增“物品模型映射装配”模型格式：每个分组对应一个 composite/range_dispatch/condition/model 子项，分组变换写入 transformation，可引用 Java 版模型作为子项，并导出完整资源包。',
	version: '1.5.0',
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
			description: '按物品模型映射（composite / range_dispatch / condition / model）组织分组，导出 assets/<ns>/items/<id>.json',
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

		action_export_zip = new Action('imm_export_pack', {
			name: '导出装配资源包 (zip)',
			description: '导出 items/*.json + models/item/*.json + textures/item/*.png',
			icon: 'archive',
			category: 'file',
			condition: () => (typeof Format !== 'undefined' && Format && Format.id === FORMAT_ID),
			click() { exportResourcePack(); },
		});
		MenuBar.addAction(action_export_zip, 'file.export');

		action_merge_pack = new Action('imm_merge_pack', {
			name: '合并到资源包…',
			description: '把 items / models / textures 直接写入目标资源包（覆盖旧文件，并清理上一轮生成的过期模型）',
			icon: 'folder_open',
			category: 'file',
			condition: () => (typeof Format !== 'undefined' && Format && Format.id === FORMAT_ID),
			click() { void mergeIntoPack(); },
		});
		MenuBar.addAction(action_merge_pack, 'file.export');

		action_check = new Action('imm_check_structure', {
			name: '检查装配结构',
			description: '列出分组对应的映射类型与引用模型',
			icon: 'checklist',
			category: 'tools',
			condition: () => (typeof Format !== 'undefined' && Format && Format.id === FORMAT_ID),
			click() { checkAssembly(); },
		});
		MenuBar.addAction(action_check, 'tools');

		action_group_props = new Action('imm_group_properties', {
			name: '编辑分组映射属性…',
			description: '设置映射类型、引用模型、property / index / threshold / tints',
			icon: 'tune',
			category: 'tools',
			condition: () => (typeof Format !== 'undefined' && Format && Format.id === FORMAT_ID),
			click() { openGroupProperties(); },
		});
		MenuBar.addAction(action_group_props, 'tools');
		attachGroupMenu();
		['select_project', 'finished_loading_project', 'update_selection'].forEach(event_name => {
			try { Blockbench.on(event_name, () => attachGroupMenu()); } catch (error) { /* 忽略 */ }
		});
	},
	onunload() {
		group_menu_attached = false;
		if (action_export_zip) { action_export_zip.delete(); action_export_zip = null; }
		if (action_merge_pack) { action_merge_pack.delete(); action_merge_pack = null; }
		if (action_group_props) { action_group_props.delete(); action_group_props = null; }
		if (action_check) { action_check.delete(); action_check = null; }
		if (codec_object) { codec_object.delete(); codec_object = null; }
		if (format_object) { format_object.delete(); format_object = null; }
	},
});

})();
