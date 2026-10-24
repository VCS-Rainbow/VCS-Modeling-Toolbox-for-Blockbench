/**
 * Item Model Mapping Exporter —— Blockbench 插件
 * ---------------------------------------------------------------------------
 * 把当前打开的 .bbmodel 项目转换成 Java 版（26.1+）的「物品模型映射」
 * （assets/<namespace>/items/<id>.json，见 zh.minecraft.wiki/w/物品模型映射）。
 *
 * 转换规则：
 *   1. 根节点是一个 minecraft:composite；
 *   2. 每一个骨骼 / 分组 = composite 的一个子项（一个 composite 节点），
 *      分组自己的方块 → 该子项里的 minecraft:model，
 *      子分组 → 该子项里继续嵌套的 composite；
 *   3. 分组（和带旋转的方块）的位置 / 旋转被写进子项的 transformation：
 *        p  →  R·(p - O) + O
 *      写成 Minecraft 的分解形式（作用顺序 right_rotation → scale → left_rotation → translation）：
 *        left_rotation = R 的四元数 [x, y, z, w]
 *        translation   = (O - R·O) / 16      （1 个映射单位 = 16 个 Blockbench 单位）
 *      这样旋转轴心（分组的 origin）被精确还原，不需要额外的嵌套；
 *   4. 子项的变换作用在父项之上（composite 的语义），与 Blockbench 中
 *      「父分组先转，子分组再转」完全一致。
 */

(function () {
'use strict';

/* =========================================================================
 * 常量
 * ========================================================================= */

const FACE_KEYS = ['north', 'east', 'south', 'west', 'up', 'down'];

/** 1 个 mapping 单位 = 16 个 Blockbench 单位 */
const UNIT_PER_BLOCK = 16;

/** 原版 block/block 的 display 变换，让 3D 物品在手持 / GUI 里位置正常 */
const BLOCK_DISPLAY = {
	thirdperson_righthand: { rotation: [75, 45, 0], translation: [0, 2.5, 0], scale: [0.375, 0.375, 0.375] },
	thirdperson_lefthand: { rotation: [75, 45, 0], translation: [0, 2.5, 0], scale: [0.375, 0.375, 0.375] },
	firstperson_righthand: { rotation: [0, 45, 0], translation: [0, 0, 0], scale: [0.4, 0.4, 0.4] },
	firstperson_lefthand: { rotation: [0, 225, 0], translation: [0, 0, 0], scale: [0.4, 0.4, 0.4] },
	ground: { rotation: [0, 0, 0], translation: [0, 3, 0], scale: [0.25, 0.25, 0.25] },
	gui: { rotation: [30, 225, 0], translation: [0, 0, 0], scale: [0.625, 0.625, 0.625] },
	fixed: { rotation: [0, 0, 0], translation: [0, 0, 0], scale: [0.5, 0.5, 0.5] },
};

let action_export = null;

/* =========================================================================
 * 小工具
 * ========================================================================= */

function deg2rad(degrees) {
	return (Number(degrees) || 0) * Math.PI / 180;
}

/** 去掉浮点噪声、-0，输出干净的 JSON 数字 */
function clean(value) {
	const number = Number(value);
	if (!isFinite(number)) return 0;
	const rounded = Math.round(number * 1e6) / 1e6;
	return Math.abs(rounded) < 1e-6 ? 0 : rounded;
}

function cleanAll(list) {
	return list.map(clean);
}

function labelOf(node) {
	if (!node) return 'unnamed';
	return node.name || node.type || 'unnamed';
}

function isGroup(node) {
	return typeof Group !== 'undefined' && node instanceof Group;
}

function isCube(node) {
	return typeof Cube !== 'undefined' && node instanceof Cube;
}

function hasRotation(node) {
	const rotation = node && node.rotation;
	if (!rotation) return false;
	return Math.abs(rotation[0] || 0) + Math.abs(rotation[1] || 0) + Math.abs(rotation[2] || 0) > 1e-6;
}

/* =========================================================================
 * 旋转数学
 * ========================================================================= */

/**
 * 读取节点（分组 / 方块）自身的局部旋转，返回普通对象 {x, y, z, w}。
 *
 * 优先读取 Three.js 场景对象上的四元数：Blockbench 视图里看到的就是它，
 * 因此欧拉角顺序、方块 rotation_axis 等细节都被自动覆盖，无需猜测。
 * 只有在拿不到 THREE / mesh 时才退回用属性计算。
 */
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
			const euler = new THREE.Euler(deg2rad(rotation[0]), deg2rad(rotation[1]), deg2rad(rotation[2]), order);
			const quaternion = new THREE.Quaternion().setFromEuler(euler);
			return { x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w };
		}
		return { x: 0, y: 0, z: 0, w: 1 };
	}

	// 兜底：没有 THREE 时只支持单轴旋转
	const rotation = (node && node.rotation) || [0, 0, 0];
	const active = [0, 1, 2].filter(axis => Math.abs(rotation[axis] || 0) > 1e-9);
	if (active.length === 0) return { x: 0, y: 0, z: 0, w: 1 };
	if (active.length > 1) return null;
	const half = deg2rad(rotation[active[0]]) / 2;
	const sin = Math.sin(half);
	return {
		x: active[0] === 0 ? sin : 0,
		y: active[0] === 1 ? sin : 0,
		z: active[0] === 2 ? sin : 0,
		w: Math.cos(half),
	};
}

/** 四元数 → 3x3 旋转矩阵（行主序，长度 9） */
function quaternionToMatrix(quaternion) {
	const { x, y, z, w } = quaternion;
	const xx = x * x, yy = y * y, zz = z * z;
	const xy = x * y, xz = x * z, yz = y * z;
	const wx = w * x, wy = w * y, wz = w * z;
	return [
		1 - 2 * (yy + zz), 2 * (xy - wz), 2 * (xz + wy),
		2 * (xy + wz), 1 - 2 * (xx + zz), 2 * (yz - wx),
		2 * (xz - wy), 2 * (yz + wx), 1 - 2 * (xx + yy),
	];
}

function rotateVector(matrix, vector) {
	const [x, y, z] = vector;
	return [
		matrix[0] * x + matrix[1] * y + matrix[2] * z,
		matrix[3] * x + matrix[4] * y + matrix[5] * z,
		matrix[6] * x + matrix[7] * y + matrix[8] * z,
	];
}

/* =========================================================================
 * 名称处理
 * ========================================================================= */

function sanitizePath(value, fallback) {
	const cleaned = String(value == null ? '' : value)
		.toLowerCase()
		.replace(/\\/g, '/')
		.replace(/[^a-z0-9_\-./]+/g, '_')
		.replace(/\/{2,}/g, '/')
		.replace(/_{2,}/g, '_')
		.replace(/^[_.\-/]+/, '')
		.replace(/[_.\-/]+$/, '');
	// 去掉空段与 . / .. 段，避免拼出穿越式路径
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

function cloneDisplay() {
	return JSON.parse(JSON.stringify(BLOCK_DISPLAY));
}

/** 内联序列化：数组/对象写在同一行（参考 Blockbench 自己的输出风格，便于审查） */
function inlineJSON(value) {
	if (Array.isArray(value)) return '[' + value.map(inlineJSON).join(', ') + ']';
	if (value && typeof value === 'object') {
		const parts = Object.keys(value).map(key => JSON.stringify(key) + ': ' + inlineJSON(value[key]));
		return '{' + parts.join(', ') + '}';
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
			if (!model.elements.length) {
				lines.push('\t"elements": []' + comma);
				return;
			}
			lines.push('\t"elements": [');
			model.elements.forEach((element, position) => {
				lines.push('\t\t' + inlineJSON(element) + (position === model.elements.length - 1 ? '' : ','));
			});
			lines.push('\t]' + comma);
		} else if (key === 'display' && model.display && typeof model.display === 'object') {
			const positions = Object.keys(model.display);
			if (!positions.length) {
				lines.push('\t"display": {}' + comma);
				return;
			}
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

/** 单个映射节点：放得下就写一行，否则按层级展开 */
function formatNode(node, depth) {
	const pad = '\t'.repeat(depth);
	const pad_in = pad + '\t';
	const fields = ['"type": ' + JSON.stringify(node.type)];
	if (node.model) fields.push('"model": ' + JSON.stringify(node.model));
	if (node.transformation) fields.push('"transformation": ' + inlineJSON(node.transformation));
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

/** 从纹理的 data URL 里取出 base64（.bbmodel 默认把纹理内嵌成 data URL） */
function textureBase64(texture) {
	const source = texture && texture.source;
	if (typeof source !== 'string') return null;
	if (!source.startsWith('data:image')) return null;
	const comma = source.indexOf(',');
	if (comma < 0) return null;
	return source.slice(comma + 1);
}

/* =========================================================================
 * 转换器
 * ========================================================================= */

class MappingExporter {

	constructor(settings) {
		this.namespace = settings.namespace;
		this.item_id = settings.item_id;
		this.item_stem = sanitizePath(String(settings.item_id).replace(/\//g, '_'), 'item');
		this.center_pivot = !!settings.center_pivot;
		this.block_display = settings.block_display !== false;

		this.warnings = [];
		this.model_files = [];          // {name, data}
		this.texture_files = [];        // {name, texture}
		this.texture_refs = new Map();  // Texture -> "ns:item/name"
		this.used_model_names = new Set();
		this.used_texture_names = new Set();
		this.negative_size = settings.negative_size || 'raw';
		this.negative_count = 0;
		this.long_angle_count = 0;
		this.missing_texture_count = 0;
		this.uv_scale_cache = new Map();
	}

	/* ------------------------------ 上下文 ------------------------------ */

	/**
	 * UV 换算：Java 模型的 uv 是 0-16 空间（整张贴图映射到 16×16）。
	 * Blockbench 里每个纹理有自己的 uv 空间（texture.uv_width/uv_height，
	 * 可能和工程分辨率不同，例如工程 16×16 而纹理 uv 空间 32×32），
	 * 必须按纹理自己的尺寸换算，否则 uv 会整体偏大/偏小。
	 */
	uvScaleForTexture(texture) {
		if (this.uv_scale_cache.has(texture)) return this.uv_scale_cache.get(texture);

		let width = 0;
		let height = 0;
		try {
			if (texture && typeof texture.getUVWidth === 'function') width = Number(texture.getUVWidth()) || 0;
			if (texture && typeof texture.getUVHeight === 'function') height = Number(texture.getUVHeight()) || 0;
		} catch (error) { /* 忽略，走下面的兜底 */ }
		if (!width && texture) width = Number(texture.uv_width) || 0;
		if (!height && texture) height = Number(texture.uv_height) || 0;
		if (!width) width = (typeof Project !== 'undefined' && Project && Project.texture_width) ? Project.texture_width : 16;
		if (!height) height = (typeof Project !== 'undefined' && Project && Project.texture_height) ? Project.texture_height : 16;

		const scale = {
			u: width > 0 ? UNIT_PER_BLOCK / width : 1,
			v: height > 0 ? UNIT_PER_BLOCK / height : 1,
		};
		this.uv_scale_cache.set(texture, scale);
		return scale;
	}

	warn(message) {
		if (!message || this.warnings.indexOf(message) >= 0) return;
		if (this.warnings.length >= 40) return;
		this.warnings.push(message);
	}

	uniqueName(base, used) {
		let name = base;
		if (!used.has(name)) {
			used.add(name);
			return name;
		}
		let index = 2;
		while (used.has(name + '_' + index)) index++;
		const unique = name + '_' + index;
		used.add(unique);
		return unique;
	}

	/* ------------------------------ 纹理 ------------------------------ */

	resolveTexture(face) {
		if (!face) return null;
		try {
			if (typeof face.getTexture === 'function') {
				const texture = face.getTexture();
				if (texture && texture.uuid) return texture;
			}
		} catch (error) { /* 忽略，走下面的兜底 */ }

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
		this.texture_files.push({ name, texture });
		return reference;
	}

	/* ------------------------------ 方块 ------------------------------ */

	compileElement(cube, texture_order) {
		// 自动 UV 需要先把 UV 写回方块
		try {
			if (cube.autouv && typeof cube.mapAutoUV === 'function') cube.mapAutoUV();
			else if (cube.autouv) this.warn('无法重算自动 UV（mapAutoUV 不可用），UV 可能不是最新值。');
		} catch (error) {
			this.warn('重算自动 UV 失败：' + ((error && error.message) || error));
		}

		const inflate = typeof cube.inflate === 'number' ? cube.inflate : 0;
		// 负尺寸（from > to）：Blockbench 原样导出、游戏也能正确渲染（贴图方向随之翻转）。
		// 所以默认保持原样，只有选"规范化"时才交换成 min/max 并镜像 uv。
		const raw_from = [0, 1, 2].map(axis => (cube.from ? (Number(cube.from[axis]) || 0) : 0));
		const raw_to = [0, 1, 2].map(axis => (cube.to ? (Number(cube.to[axis]) || 0) : 0));
		const negative = raw_from.map((value, axis) => value > raw_to[axis]);
		const has_negative = negative[0] || negative[1] || negative[2];

		if (has_negative) {
			this.negative_count++;
			if (this.negative_size === 'skip') {
				this.warn('方块 “' + labelOf(cube) + '” 是负尺寸，已按设置跳过。');
				return null;
			}
		}

		let from;
		let to;
		if (has_negative && this.negative_size === 'normalize') {
			from = raw_from.map((value, axis) => Math.min(value, raw_to[axis]) - inflate);
			to = raw_from.map((value, axis) => Math.max(value, raw_to[axis]) + inflate);
		} else {
			from = raw_from.map(value => value - inflate);
			to = raw_to.map(value => value + inflate);
		}

		const faces = {};
		let face_count = 0;
		for (const direction of FACE_KEYS) {
			const face = cube.faces ? cube.faces[direction] : null;
			if (!face) continue;

			const texture = this.resolveTexture(face);
			if (!texture) {
				this.warn('方块 “' + labelOf(cube) + '” 的 ' + direction + ' 面没有纹理，已跳过该面。');
				continue;
			}
			if (!texture_order.has(texture)) texture_order.set(texture, String(texture_order.size));

			// 换算到 Java 的 0-16 UV 空间（按该面所用纹理自己的 uv 空间）
			const raw_uv = face.uv || [0, 0, 0, 0];
			const uv_scale = this.uvScaleForTexture(texture);
			const scaled_uv = [
				(Number(raw_uv[0]) || 0) * uv_scale.u,
				(Number(raw_uv[1]) || 0) * uv_scale.v,
				(Number(raw_uv[2]) || 0) * uv_scale.u,
				(Number(raw_uv[3]) || 0) * uv_scale.v,
			];
			// 负尺寸会让被翻转轴的贴图方向反转，把对应面的 uv 分量反回来
			if (has_negative && this.negative_size === 'normalize') {
				const face_spans_x = (direction === 'north' || direction === 'south' || direction === 'up' || direction === 'down');
				const face_spans_y = (direction === 'north' || direction === 'south' || direction === 'east' || direction === 'west');
				const flip_u = (negative[0] && face_spans_x) || (negative[2] && (direction === 'east' || direction === 'west'));
				const flip_v = (negative[1] && face_spans_y) || (negative[2] && (direction === 'up' || direction === 'down'));
				if (flip_u) {
					const temp = scaled_uv[0];
					scaled_uv[0] = scaled_uv[2];
					scaled_uv[2] = temp;
				}
				if (flip_v) {
					const temp = scaled_uv[1];
					scaled_uv[1] = scaled_uv[3];
					scaled_uv[3] = temp;
				}
			}
			// Java 烘焙时 uv 越界会抛 "Cannot compute translucency out of bounds"，必须夹到 0-16
			const uv = scaled_uv.map(value => clean(Math.min(UNIT_PER_BLOCK, Math.max(0, value))));
			if (scaled_uv.some(value => value < -0.001 || value > UNIT_PER_BLOCK + 0.001)) {
				this.warn('方块 “' + labelOf(cube) + '” 的 ' + direction + ' 面 UV 超出纹理范围（'
					+ scaled_uv.map(clean).join(', ') + '），已夹到 0-16；请检查该面 UV 与纹理分辨率。');
			}
			const entry = {
				uv,
				texture: '#' + texture_order.get(texture),
			};
			if (face.rotation) entry.rotation = clean(face.rotation);
			if (typeof face.tint === 'number' && face.tint > 0) entry.tintindex = face.tint;

			faces[direction] = entry;
			face_count++;
		}

		if (!face_count) {
			this.warn('方块 “' + labelOf(cube) + '” 没有任何带纹理的面，已跳过。');
			return null;
		}

		if (cube.rescale) {
			this.warn('方块 “' + labelOf(cube) + '” 开启了 rotation rescale，映射中的旋转不会做 rescale 补偿。');
		}

		const element = {
			from: cleanAll(from),
			to: cleanAll(to),
			faces,
		};
		const rotation = this.compileElementRotation(cube);
		if (rotation) element.rotation = rotation;
		if (cube.shade === false) element.shade = false;
		return element;
	}

	/** 单轴旋转 → 原生元素的 rotation；多轴旋转返回 null（由 transformation 表达） */
	compileElementRotation(cube) {
		const rotation = (cube && cube.rotation) ? cube.rotation : [0, 0, 0];
		const active = [0, 1, 2].filter(axis => Math.abs(Number(rotation[axis]) || 0) > 1e-6);
		if (active.length !== 1) return null;

		const axis = active[0];
		const angle = clean(Number(rotation[axis]) || 0);
		if (Math.abs(angle) > 45.001) this.long_angle_count++;

		const origin = (cube && cube.origin) ? cube.origin : [0, 0, 0];
		return {
			origin: cleanAll([
				Number(origin[0]) || 0,
				Number(origin[1]) || 0,
				Number(origin[2]) || 0,
			]),
			axis: ['x', 'y', 'z'][axis],
			angle,
			rescale: !!cube.rescale,
		};
	}

	/** 多轴旋转的方块需要单独的 transformation 子项（原生元素元素只能单轴） */
	needsOwnNode(cube) {
		const rotation = (cube && cube.rotation) ? cube.rotation : [0, 0, 0];
		const active = [0, 1, 2].filter(axis => Math.abs(Number(rotation[axis]) || 0) > 1e-6);
		return active.length > 1;
	}

	/** 生成一个原生模型文件，返回 "ns:item/xxx" 引用；没有可用几何时返回 null */
	addModel(cubes, hint) {
		const texture_order = new Map();
		const elements = [];
		for (const cube of cubes) {
			const element = this.compileElement(cube, texture_order);
			if (element) elements.push(element);
		}
		if (!elements.length) return null;

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
		this.model_files.push({ name, data: model });
		return this.namespace + ':item/' + name;
	}

	/* ------------------------------ 变换 ------------------------------ */

	/**
	 * 把「绕原点 O 旋转 R」写成物质模型映射的 transformation：
	 *   left_rotation = R 的四元数，translation = (O - R·O) / 16
	 * 已经包含轴心修正，所以子项可以继承父项的变换后再叠加自己的变换。
	 */
	buildTransformation(node) {
		const quaternion = readLocalQuaternion(node);
		if (!quaternion) {
			this.warn('“' + labelOf(node) + '” 的旋转需要单轴之外的欧拉角顺序信息，当前环境无法换算，已忽略该旋转。');
			return null;
		}

		// 归一化：非单位四元数在 Minecraft 里会额外缩放模型
		const length = Math.hypot(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
		if (length > 1e-9) {
			quaternion.x /= length;
			quaternion.y /= length;
			quaternion.z /= length;
			quaternion.w /= length;
		}

		// 统一四元数符号（w >= 0；180° 时 w≈0，按 x→y→z 第一个非零分量取正），保证输出稳定
		let flip = quaternion.w < 0;
		if (!flip && Math.abs(quaternion.w) < 1e-9) {
			for (const component of [quaternion.x, quaternion.y, quaternion.z]) {
				if (Math.abs(component) > 1e-9) {
					flip = component < 0;
					break;
				}
			}
		}
		if (flip) {
			quaternion.x = -quaternion.x;
			quaternion.y = -quaternion.y;
			quaternion.z = -quaternion.z;
			quaternion.w = -quaternion.w;
		}
		if (Math.abs(quaternion.w) > 1 - 1e-7) return null; // 单位旋转，不需要 transformation

		const matrix = quaternionToMatrix(quaternion);
		const origin = (node && node.origin) ? node.origin : [0, 0, 0];
		// 默认以模型坐标原点为变换原点；勾选后改为以物品中心 (8,8,8) 为原点
		const offset = this.center_pivot ? UNIT_PER_BLOCK / 2 : 0;
		const pivot = [
			(Number(origin[0]) || 0) - offset,
			(Number(origin[1]) || 0) - offset,
			(Number(origin[2]) || 0) - offset,
		];
		const rotated_pivot = rotateVector(matrix, pivot);
		const translation = [
			(pivot[0] - rotated_pivot[0]) / UNIT_PER_BLOCK,
			(pivot[1] - rotated_pivot[1]) / UNIT_PER_BLOCK,
			(pivot[2] - rotated_pivot[2]) / UNIT_PER_BLOCK,
		];

		return {
			translation: cleanAll(translation),
			left_rotation: cleanAll([quaternion.x, quaternion.y, quaternion.z, quaternion.w]),
			scale: [1, 1, 1],
			right_rotation: [0, 0, 0, 1],
		};
	}

	/* ------------------------------ 结构 ------------------------------ */

	buildModelNode(cubes, hint) {
		const reference = this.addModel(cubes, hint);
		if (!reference) return null;
		return { type: 'minecraft:model', model: reference };
	}

	/** 带自身旋转的方块 → 一个带 transformation 的 model 子项（轴心 = 方块 origin） */
	buildCubeNode(cube, hint) {
		const reference = this.addModel([cube], hint);
		if (!reference) return null;
		const node = { type: 'minecraft:model', model: reference };
		const transformation = this.buildTransformation(cube);
		if (transformation) node.transformation = transformation;
		return node;
	}

	/**
	 * 一个分组 → 一个 composite 子项：
	 *   models = [ 自己的方块模型, 带旋转的方块子项..., 子分组子项... ]
	 */
	buildGroupNode(group, hint) {
		const children = Array.isArray(group.children) ? group.children : [];
		const plain_cubes = [];
		const rotated_cubes = [];
		const child_groups = [];

		for (const child of children) {
			if (!child) continue;
			if (child.export === false) {
				this.warn('“' + labelOf(child) + '” 被标记为不导出（export = false），已跳过。');
				continue;
			}
			if (isCube(child)) {
				if (this.needsOwnNode(child)) rotated_cubes.push(child);
				else plain_cubes.push(child);
			} else if (isGroup(child)) {
				child_groups.push(child);
			} else if (child) {
				this.warn('分组 “' + labelOf(group) + '” 里的元素 “' + labelOf(child) + '” 不是方块（'
					+ (child.type || 'unknown') + '），已跳过。');
			}
		}

		const models = [];

		if (plain_cubes.length) {
			const model_node = this.buildModelNode(plain_cubes, hint);
			if (model_node) models.push(model_node);
		}

		for (const cube of rotated_cubes) {
			const cube_node = this.buildCubeNode(cube, hint + '_' + sanitizePath(labelOf(cube), 'cube'));
			if (cube_node) models.push(cube_node);
		}

		for (const child of child_groups) {
			const child_node = this.buildGroupNode(child, hint + '_' + sanitizePath(labelOf(child), 'group'));
			if (child_node) models.push(child_node);
		}

		if (!models.length) {
			this.warn('分组 “' + labelOf(group) + '” 里没有可导出的几何体，已跳过。');
			return null;
		}

		const node = { type: 'minecraft:composite' };
		const transformation = this.buildTransformation(group);
		if (transformation) node.transformation = transformation;
		node.models = models;
		return node;
	}

	buildMapping() {
		const root = (typeof Outliner !== 'undefined' && Outliner && Outliner.root) ? Outliner.root : [];
		const models = [];
		const loose_cubes = [];

		for (const node of root) {
			if (!node) continue;
			if (node.export === false) {
				this.warn('“' + labelOf(node) + '” 被标记为不导出（export = false），已跳过。');
				continue;
			}
			if (isGroup(node)) {
				const group_node = this.buildGroupNode(node, sanitizePath(labelOf(node), 'group'));
				if (group_node) models.push(group_node);
			} else if (isCube(node)) {
				loose_cubes.push(node);
			} else if (node) {
				this.warn('顶层元素 “' + labelOf(node) + '” 不是方块或分组（' + (node.type || 'unknown') + '），已跳过。');
			}
		}

		// 没有分组的零散方块
		const plain = loose_cubes.filter(cube => !this.needsOwnNode(cube));
		const rotated = loose_cubes.filter(cube => this.needsOwnNode(cube));
		if (plain.length) {
			const model_node = this.buildModelNode(plain, 'root');
			if (model_node) models.push(model_node);
		}
		for (const cube of rotated) {
			const cube_node = this.buildCubeNode(cube, 'root_' + sanitizePath(labelOf(cube), 'cube'));
			if (cube_node) models.push(cube_node);
		}

		if (!models.length) {
			throw new Error('当前模型里没有可导出的方块（Cube）。请确认已经建模。');
		}
		return { model: { type: 'minecraft:composite', models } };
	}

	/* ------------------------------ 输出 ------------------------------ */

	buildFiles(mapping) {
		const files = [];
		const notes = [];

		files.push({
			path: 'assets/' + this.namespace + '/items/' + this.item_id + '.json',
			data: formatMappingFile(mapping),
		});

		for (const file of this.model_files) {
			files.push({
				path: 'assets/' + this.namespace + '/models/item/' + file.name + '.json',
				data: formatModelFile(file.data),
			});
		}

		const missing_textures = [];
		for (const file of this.texture_files) {
			const base64 = textureBase64(file.texture);
			if (base64) {
				files.push({
					path: 'assets/' + this.namespace + '/textures/item/' + file.name + '.png',
					data: base64,
					base64: true,
				});
			} else {
				missing_textures.push(file.name);
			}
		}

		this.missing_texture_count = missing_textures.length;

		if (missing_textures.length) {
			notes.push('以下纹理没有内嵌在 .bbmodel 里，请手动放到：');
			for (const name of missing_textures) {
				notes.push('  assets/' + this.namespace + '/textures/item/' + name + '.png    (引用：'
					+ this.namespace + ':item/' + name + ')');
			}
			notes.push('');
		}
		if (this.warnings.length) {
			notes.push('转换提示：');
			for (const warning of this.warnings) notes.push('  - ' + warning);
		}
		if (notes.length) {
			// 放在包根目录，避免被 items/ 目录的解析器扫到
			files.push({ path: this.item_stem + '.notes.txt', data: notes.join('\n') });
		}
		return files;
	}

	run() {
		const mapping = this.buildMapping();
		if (this.negative_count && this.negative_size !== 'skip') {
			this.warn('共 ' + this.negative_count + ' 个负尺寸（from > to）方块，处理方式：'
				+ (this.negative_size === 'normalize' ? '规范化为 min/max 并镜像 uv' : '原样输出（与 Blockbench 一致）') + '。');
		}
		if (this.long_angle_count) {
			this.warn('共 ' + this.long_angle_count + ' 个方块的单轴旋转角超出 ±45°，写成了元素 rotation；'
				+ '若游戏拒绝加载，请把这些方块改成多轴旋转（插件会改用 transformation 子项）。');
		}
		const files = this.buildFiles(mapping);
		const written_textures = this.texture_files.length - this.missing_texture_count;
		const summary = '物品模型映射已生成：' + (this.model_files.length + 1 + written_textures) + ' 个文件（'
			+ this.model_files.length + ' 个模型'
			+ (written_textures ? '，' + written_textures + ' 张纹理' : '') + '）';

		if (typeof JSZip === 'undefined') {
			// 极端兜底：没有 JSZip 时只导出映射 JSON
			Blockbench.showQuickMessage('缺少 JSZip，只导出映射 JSON', 4000);
			Blockbench.export({
				type: 'JSON',
				extensions: ['json'],
				name: this.item_id,
				content: JSON.stringify(mapping, null, 2),
				savetype: 'text',
			});
			return;
		}

		const zip = new JSZip();
		for (const file of files) {
			if (file.base64) zip.file(file.path, file.data, { base64: true });
			else zip.file(file.path, file.data);
		}

		zip.generateAsync({ type: 'blob' }).then(blob => {
			Blockbench.export({
				type: 'Zip Archive',
				extensions: ['zip'],
				name: this.item_stem,
				content: blob,
				savetype: 'zip',
			});
			Blockbench.showQuickMessage(summary, 4000);
			if (this.missing_texture_count) {
				Blockbench.showMessageBox({
					title: '纹理没有内嵌',
					message: this.missing_texture_count + ' 张纹理没有内嵌在 .bbmodel 里，包内已写出所需路径（见 '
						+ this.item_stem + '.notes.txt）。补齐这些 PNG 之前，游戏里相关面会显示缺失纹理。',
					icon: 'info',
				});
			}
			if (this.warnings.length) {
				console.warn('[Item Model Mapping] 提示：\n- ' + this.warnings.join('\n- '));
				Blockbench.showQuickMessage('有 ' + this.warnings.length + ' 条提示，详见控制台或包内 .notes.txt', 5000);
			}
		}).catch(error => {
			console.error(error);
			Blockbench.showMessageBox({
				title: '打包失败',
				message: String((error && error.message) || error),
				icon: 'error',
			});
		});
	}
}

/* =========================================================================
 * 界面
 * ========================================================================= */

function guessDefaults() {
	const project_name = (typeof Project !== 'undefined' && Project && Project.name) ? Project.name : 'item';
	const base = String(project_name).replace(/\.bbmodel$/i, '');
	return {
		namespace: 'custom',
		item_id: sanitizePath(base, 'item'),
	};
}

function runExport(result) {
	try {
		const namespace = sanitizeNamespace(result ? result.namespace : '');
		const item_id = sanitizePath(result ? result.item_id : '', 'item');
		const exporter = new MappingExporter({
			namespace,
			item_id,
			center_pivot: !!(result && result.center_pivot),
			block_display: !(result && result.block_display === false),
			negative_size: (result && result.negative_size) || 'raw',
		});
		exporter.run();
	} catch (error) {
		console.error(error);
		Blockbench.showMessageBox({
			title: '转换失败',
			message: String((error && error.message) || error),
			icon: 'error',
		});
	}
}

function openExportDialog() {
	if (typeof Project === 'undefined' || !Project) {
		Blockbench.showQuickMessage('请先打开一个 .bbmodel 模型', 3000);
		return;
	}
	const defaults = guessDefaults();
	new Dialog({
		id: 'item_model_mapping_export',
		title: '导出物品模型映射（items/*.json）',
		width: 720,
		form: {
			rule_info: {
				type: 'info',
				full_width: true,
				text: '每个分组（骨骼）→ composite 的一个子项；子项变换叠加在父项之上；'
					+ 'translation 1 个单位 = Blockbench 16 个单位（1 格）。',
			},
			version_info: {
				type: 'info',
				full_width: true,
				text: '输出需要 Java 版 26.1+（composite / model 等类型支持 transformation 字段）。',
			},
			namespace: {
				label: '命名空间 namespace',
				type: 'text',
				value: defaults.namespace,
			},
			item_id: {
				label: '物品 ID（assets/<namespace>/items/<id>.json）',
				type: 'text',
				value: defaults.item_id,
			},
			block_display: {
				label: '给模型加上方块物品的 display 显示变换（推荐）',
				type: 'checkbox',
				value: true,
			},
			negative_size: {
				label: '负尺寸方块（from > to）的处理',
				type: 'select',
				value: 'raw',
				options: {
					raw: '原样输出（与 Blockbench 一致，推荐）',
					normalize: '规范化成 min/max 并镜像 uv',
					skip: '跳过这些方块',
				},
			},
			center_pivot: {
				label: '以物品中心 (8,8,8) 作为变换原点（默认用模型原点）',
				type: 'checkbox',
				value: false,
			},
		},
		onConfirm(result) {
			runExport(result);
		},
	}).show();
}

/* =========================================================================
 * 插件注册
 * ========================================================================= */

Plugin.register('item_model_mapping', {
	title: 'Item Model Mapping Exporter',
	author: 'Blockbench',
	icon: 'account_tree',
	description: '把 .bbmodel 的每个分组转换成 Java 版物品模型映射（items/*.json）里 composite 的一个子项，并正确换算旋转与位移。',
	version: '1.0.0',
	variant: 'both',
	min_version: '4.9.0',
	tags: ['Minecraft: Java Edition'],
	onload() {
		action_export = new Action('export_item_model_mapping', {
			name: '导出物品模型映射',
			description: '分组 → composite 子项，输出 assets/<ns>/items/<id>.json 及每个分组的模型文件',
			icon: 'account_tree',
			category: 'file',
			condition: () => (typeof Project !== 'undefined' && !!Project),
			click() {
				openExportDialog();
			},
		});
		MenuBar.addAction(action_export, 'file.export');
	},
	onunload() {
		if (action_export) {
			action_export.delete();
			action_export = null;
		}
	},
});

})();
