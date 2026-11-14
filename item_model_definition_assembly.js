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
const VERSION = '0.73.20';
const FACE_KEYS = ['north', 'east', 'south', 'west', 'up', 'down'];
const UNIT = 16;
const CENTER = UNIT / 2;
const MAPPING_TYPES = ['composite', 'inline', 'model', 'internal', 'range_dispatch', 'range_dispatch_timeline', 'condition', 'select', 'empty'];
/** 复调用标签的独立元素类型 id（在 Outliner 里与方块/定位点/分组并列） */
const CALL_TAG_TYPE = 'imda_call_tag';
/** 复调用标签类：在 ensureCallTagType() 里赋值（依赖 Blockbench 运行时） */
let CallTag = null;
/** 复调用标签的 3D 标记贴图（与定位点区分色） */
let callTagSpriteMap = null;
const MANIFEST = '.imm-assembly-manifest.json';

const BLOCK_DISPLAY = {
	thirdperson_righthand: { rotation: [0, -90, 55], translation: [0, 4, 0.5], scale: [0.85, 0.85, 0.85] },
	thirdperson_lefthand: { rotation: [0, 90, -55], translation: [0, 4, 0.5], scale: [0.85, 0.85, 0.85] },
	firstperson_righthand: { rotation: [0, -90, 25], translation: [1.13, 3.2, 1.13], scale: [0.68, 0.68, 0.68] },
	firstperson_lefthand: { rotation: [0, 90, -25], translation: [1.13, 3.2, 1.13], scale: [0.68, 0.68, 0.68] },
};

/** Blockbench “显示调整”页各槽的默认值；与默认值相同的槽位不写进模型（视为用户没改过）。 */
const DEFAULT_DISPLAY = {
	thirdperson_righthand: { rotation: [0, -90, 55], translation: [0, 4, 0.5], scale: [0.85, 0.85, 0.85] },
	thirdperson_lefthand: { rotation: [0, 90, -55], translation: [0, 4, 0.5], scale: [0.85, 0.85, 0.85] },
	firstperson_righthand: { rotation: [0, -90, 25], translation: [1.13, 3.2, 1.13], scale: [0.68, 0.68, 0.68] },
	firstperson_lefthand: { rotation: [0, 90, -25], translation: [1.13, 3.2, 1.13], scale: [0.68, 0.68, 0.68] },
	ground: { rotation: [0, 0, 0], translation: [0, 2, 0], scale: [0.5, 0.5, 0.5] },
	gui: { rotation: [30, -135, 0], translation: [0, 0, 0], scale: [0.625, 0.625, 0.625] },
	head: { rotation: [0, -180, 0], translation: [0, 13, 7], scale: [1, 1, 1] },
	fixed: { rotation: [0, -180, 0], translation: [0, 0, 0], scale: [1, 1, 1] },
};

/** 两个 display 槽位变换是否等价（缺省 rotation/translation 视为 0，scale 视为 1）。 */
function sameSlotTransform(a, b) {
	const vec = (v, fallback) => Array.isArray(v) ? [0, 1, 2].map(i => Math.round(num(v[i]) * 1e6) / 1e6) : fallback.slice();
	const ra = vec(a && a.rotation, [0, 0, 0]), rb = vec(b && b.rotation, [0, 0, 0]);
	const ta = vec(a && a.translation, [0, 0, 0]), tb = vec(b && b.translation, [0, 0, 0]);
	const sa = vec(a && a.scale, [1, 1, 1]), sb = vec(b && b.scale, [1, 1, 1]);
	const eq = (x, y) => x.every((v, i) => Math.abs(v - y[i]) < 1e-6);
	return eq(ra, rb) && eq(ta, tb) && eq(sa, sb);
}

let format_object = null;
let codec_object = null;
const actions = {};

/* ============================== 小工具 ============================== */

const clean = (v) => { const n = Number(v); if (!isFinite(n)) return 0; const r = Math.round(n * 1e6) / 1e6; return Math.abs(r) < 1e-6 ? 0 : r; }
/** 读取 Blockbench “显示调整”页的参数；没有该数据时返回 null（回退到内置预设） */
function readProjectDisplay() {
	if (typeof Project === 'undefined' || !Project || !Project.display_settings) return null;
	const out = {};
	for (const slot of Object.keys(Project.display_settings)) {
		const ds = Project.display_settings[slot];
		if (!ds) continue;
		let data = null;
		try { data = (typeof ds.export === 'function') ? ds.export() : null; } catch (e) { data = null; }
		if (!data) {
			data = {};
			if (Array.isArray(ds.rotation)) data.rotation = ds.rotation.slice();
			if (Array.isArray(ds.translation)) data.translation = ds.translation.slice();
			if (Array.isArray(ds.scale)) data.scale = ds.scale.slice();
		}
		const clean = {};
		if (Array.isArray(data.rotation) && data.rotation.some(v => Math.abs(num(v)) > 1e-6)) clean.rotation = data.rotation.map(v => Math.round(num(v) * 1e6) / 1e6);
		if (Array.isArray(data.translation) && data.translation.some(v => Math.abs(num(v)) > 1e-6)) clean.translation = data.translation.map(v => Math.round(num(v) * 1e6) / 1e6);
		if (Array.isArray(data.scale) && data.scale.some(v => Math.abs(num(v) - 1) > 1e-6)) clean.scale = data.scale.map(v => Math.round(num(v) * 1e6) / 1e6);
		if (Object.keys(clean).length) out[slot] = clean;
	}
	return out;
}
;
const cleanAll = (list) => list.map(clean);
const labelOf = (node) => (node && node.name) ? node.name : 'unnamed';
const isGroup = (node) => typeof Group !== 'undefined' && node instanceof Group;
const isCube = (node) => typeof Cube !== 'undefined' && node instanceof Cube;
const isLocator = (node) => typeof Locator !== 'undefined' && node instanceof Locator;
/** 复调用标签：独立的元素类型（imda_call_tag），不再借用 Locator。
 *  旧工程里的复调用标签仍是 Locator，靠 imda_call_target 识别，两者都要认。
 *  注意 CallTag 继承 Locator，所以 `isLocator()` 对它是 true ——
 *  现有所有复调用相关代码路径（Locator.all / Locator.selected / isLocator 判断）都能继续工作。 */
const isCallTagType = (node) => !!node && (String(node.type || '') === CALL_TAG_TYPE || (!!CallTag && node instanceof CallTag));
const isCallTag = (node) => isCallTagType(node) || (isLocator(node) && !!String(node.imda_call_target || '').trim());
/** 任何“能当复调用标签用”的节点（新类型 + 旧 Locator 标签） */
const isCallLike = (node) => isLocator(node) || isCallTagType(node);
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
/** 命名空间支持子空间：sqsptst:weapon/shotgun → {namespace:'sqsptst', subpath:'weapon/shotgun'} */
function parseNamespaceSetting(value) {
	const raw = String(value == null ? '' : value).trim().replace(/\\/g, '/');
	const colon = raw.indexOf(':');
	const ns = colon >= 0 ? raw.slice(0, colon) : raw;
	const subRaw = colon >= 0 ? raw.slice(colon + 1) : '';
	const subpath = subRaw.split('/').map(seg => String(seg).toLowerCase().replace(/[^a-z0-9_\-]+/g, '_').replace(/^_+|_+$/g, ''))
		.filter(seg => seg && seg !== '.' && seg !== '..').join('/');
	return { namespace: sanitizeNamespace(ns), subpath };
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
	for (const key of ['node_name', 'model', 'property', 'index', 'scale', 'tints', 'transformation', 'component', 'ignore_default', 'predicate', 'value', 'keybind', 'target', 'wobble', 'normalize', 'source', 'period', 'remaining']) {
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

const formatMapping = (mapping) => {
	const extra = [];
	const hand = projectValue('imda_hand_animation_on_swap', true);
	if (hand === false) extra.push('\t"hand_animation_on_swap": false');
	if (projectValue('imda_oversized_in_gui', false) === true) extra.push('\t"oversized_in_gui": true');
	const swapScale = Number(projectValue('imda_swap_animation_scale', 1));
	if (isFinite(swapScale) && swapScale !== 1) extra.push('\t"swap_animation_scale": ' + JSON.stringify(clean(swapScale)));
	return '{\n' + (extra.length ? extra.join(',\n') + ',\n' : '') + '\t"model": ' + formatNode(mapping.model, 1) + '\n}';
};

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

function quatMul(a, b) {
	return {
		x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
		y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
		z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
		w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
	};
}
function quatConj(q) { return { x: -q.x, y: -q.y, z: -q.z, w: q.w }; }
function quatRotateVec(q, v) {
	const p = quatMul(quatMul(q, { x: v[0], y: v[1], z: v[2], w: 0 }), quatConj(q));
	return [p.x, p.y, p.z];
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
function setProjectValue(name, value) {
	if (typeof Project === 'undefined' || !Project) return;
	Project[name] = value;
}

/* ---------- 旧前缀迁移：imm_* → imda_*（仅在加载/导出时执行一次） ---------- */
function migrateLegacyNode(node) {
	if (!node) return 0;
	const OLD = 'i' + 'mm_';
	let count = 0;
	try {
		for (const key of Object.keys(node)) {
			if (!key.startsWith(OLD)) continue;
			const next = 'imda_' + key.slice(OLD.length);
			if (node[next] === undefined) node[next] = node[key];
			try { delete node[key]; } catch (e) { /* ignore */ }
			count++;
		}
	} catch (e) { /* ignore */ }
	return count;
}
function migrateLegacyAll() {
	let total = 0;
	if (typeof Project !== 'undefined' && Project) total += migrateLegacyNode(Project);
	for (const group of ((typeof Group !== 'undefined' && Group.all) ? Group.all : [])) total += migrateLegacyNode(group);
	for (const locator of ((typeof Locator !== 'undefined' && Locator.all) ? Locator.all : [])) total += migrateLegacyNode(locator);
	for (const cube of ((typeof Cube !== 'undefined' && Cube.all) ? Cube.all : [])) total += migrateLegacyNode(cube);
	return total;
}

/** 复调用标签元素类型：注册一次，独立于 Locator 出现在「添加元素」菜单里。
 *
 *  为什么继承 Locator：Locator 已经拥有 position/rotation/visibility/locked、
 *  精灵标记渲染、以及 `Format.locators` 开关下的保存/加载链路；
 *  继承后 `instanceof Locator` 仍成立，插件里所有既有的复调用代码
 *  （`Locator.all` / `Locator.selected` / `isLocator()`）一行都不用改。
 *  独立类型带来的好处：Outliner 里有自己的名字/图标/条件菜单，
 *  并且「Shift 连选」时能被当作区间端点（见 installOutlinerRangeSelect）。 */
function ensureCallTagType() {
	if (CallTag) return CallTag;
	if (typeof Locator === 'undefined' || typeof OutlinerElement === 'undefined') return null;
	CallTag = class CallTag extends Locator {
		constructor(data, uuid) {
			super(data, uuid);
			// Locator 的构造会把 name 落到 Property 默认值（'locator'），这里换成标签语义的默认名
			if (!data || !data.name) this.name = '调用';
		}
		// Locator.init() 会把根级的 Locator 塞进 Group.first_selected，这里保持同样行为
		init() {
			if (this.parent == Outliner.ROOT && typeof Group !== 'undefined' && Group.first_selected) {
				this.addTo(Group.first_selected);
			}
			return super.init();
		}
	};
	CallTag.prototype.type = CALL_TAG_TYPE;
	CallTag.prototype.title = '复调用标签';
	CallTag.prototype.icon = 'content_copy';
	CallTag.prototype.visibility = true;
	// 中文名很常见（'调用 sacpack1'），放宽名字净化规则，避免读写工程时被抹掉
	CallTag.prototype.name_regex = () => 'a-zA-Z0-9_\\- \u4e00-\u9fa5';
	// 允许重名：同一个目标会被多个分支反复调用，名字重复是常态
	CallTag.behavior = Object.assign({}, Locator.behavior || {}, { unique_name: false });
	if (typeof Outliner !== 'undefined' && Outliner.buttons) {
		CallTag.prototype.buttons = [Outliner.buttons.export, Outliner.buttons.locked, Outliner.buttons.visibility];
	}
	try {
		// 继承来的 menu 是 Locator 共享的同一个对象，先克隆一份再交给插件的右键菜单流程
		const base = (Locator.prototype && Locator.prototype.menu) || null;
		if (base && typeof Menu !== 'undefined') {
			const structure = Array.isArray(base.structure) ? base.structure.slice() : [];
			CallTag.prototype.menu = new Menu(structure);
		}
	} catch (e) { /* ignore */ }
	try { OutlinerElement.registerType(CallTag, CALL_TAG_TYPE); } catch (e) { console.warn('[装配] 注册复调用标签类型失败', e); return null; }
	// 3D 标记：沿用定位点贴图，但染成青色，方便和普通定位点区分
	try {
		if (typeof THREE !== 'undefined' && THREE.TextureLoader) {
			callTagSpriteMap = new THREE.TextureLoader().load('assets/locator.png');
			if (THREE.NearestFilter) callTagSpriteMap.magFilter = callTagSpriteMap.minFilter = THREE.NearestFilter;
		}
	} catch (e) { /* ignore */ }
	try {
		if (Locator.preview_controller && typeof NodePreviewController !== 'undefined') {
			new NodePreviewController(CallTag, {
				setup(element) {
					let mesh = new THREE.Object3D();
					Project.nodes_3d[element.uuid] = mesh;
					mesh.name = element.uuid;
					mesh.type = element.type;
					mesh.isElement = true;
					mesh.visible = element.visibility;
					mesh.rotation.order = Format.euler_order;
					const material = new THREE.SpriteMaterial({
						map: callTagSpriteMap,
						alphaTest: 0.1,
						sizeAttenuation: false,
						color: 0x4fd1ff,
					});
					const sprite = new THREE.Sprite(material);
					sprite.name = element.uuid;
					sprite.type = element.type;
					sprite.isElement = true;
					sprite.no_export = true;
					mesh.add(sprite);
					mesh.sprite = sprite;
					this.updateTransform(element);
					this.dispatchEvent('setup', { element });
				},
				updateTransform(element) {
					NodePreviewController.prototype.updateTransform.call(this, element);
					this.updateWindowSize(element);
				},
				updateSelection(element) {
					const { mesh } = element;
					if (mesh && mesh.sprite) {
						mesh.sprite.material.color.set(element.selected ? 0x4fd1ff : 0x2b8fb3);
						mesh.sprite.material.depthTest = !element.selected;
						mesh.renderOrder = element.selected ? 100 : 0;
						mesh.sprite.visible = !!Canvas.show_element_markers;
					}
					this.dispatchEvent('update_selection', { element });
				},
				updateWindowSize(element) {
					const size = 0.4 * Preview.selected.camera.fov / Preview.selected.height;
					if (element.mesh && element.mesh.sprite) element.mesh.sprite.scale.set(size, size, size);
				},
			});
		}
	} catch (e) { console.warn('[装配] 复调用标签预览控制器注册失败', e); }
	console.log('[装配] 已注册复调用标签元素类型 ' + CALL_TAG_TYPE);
	return CallTag;
}

/** 新建复调用标签（所有入口统一走这里，旧工程读进来的 Locator 标签不受影响） */
function newCallTag(data) {
	const tag = ensureCallTagType();
	if (!tag) {
		// 极端兜底：Blockbench 版本不支持自定义元素类型时退回 Locator
		return (typeof Locator !== 'undefined') ? new Locator(data) : null;
	}
	const {
		name, position, rotation, ignore_inherited_scale, target, overrides,
	} = data || {};
	const node = new tag({
		name: name || '调用',
		position: Array.isArray(position) ? position.slice() : [0, 0, 0],
		rotation: Array.isArray(rotation) ? rotation.slice() : [0, 0, 0],
		ignore_inherited_scale: ignore_inherited_scale !== false,
	});
	if (target != null) node.imda_call_target = String(target);
	if (overrides != null) node.imda_call_overrides = (typeof overrides === 'string') ? overrides : JSON.stringify(overrides);
	return node;
}

/** 把旧工程里的 Locator 型复调用标签升级成独立类型（保留 uuid 与全部覆盖字段）。 */
function upgradeLegacyCallTags() {
	const tag = ensureCallTagType();
	if (!tag) return 0;
	const legacy = [];
	const walk = (nodes) => {
		for (const node of (nodes || [])) {
			if (isGroup(node)) walk(node.children);
			else if (isLocator(node) && !isCallTagType(node) && String(node.imda_call_target || '').trim()) legacy.push(node);
		}
	};
	try { walk((typeof Outliner !== 'undefined' && Outliner && Outliner.root) ? Outliner.root : []); } catch (e) { /* ignore */ }
	if (!legacy.length) return 0;
	let done = 0;
	try { Undo.initEdit({ outliner: true, elements: legacy.slice() }); } catch (e) { /* ignore */ }
	const created = [];
	for (const old of legacy) {
		try {
			const parent = old.parent && isGroup(old.parent) ? old.parent : null;
			const siblings = parent ? parent.children : ((typeof Outliner !== 'undefined' && Outliner) ? Outliner.root : []);
			const at = siblings.indexOf(old);
			const node = new tag({ name: old.name, position: (old.position || [0, 0, 0]).slice(), rotation: (old.rotation || [0, 0, 0]).slice(), ignore_inherited_scale: old.ignore_inherited_scale !== false });
			node.uuid = old.uuid;
			node.imda_call_target = String(old.imda_call_target || '');
			for (const key of ['imda_call_overrides', 'imda_call_threshold', 'imda_call_property', 'imda_call_index', 'imda_call_scale', 'imda_frame', 'imda_pose']) {
				if (old[key] !== undefined) node[key] = old[key];
			}
			node.export = old.export !== false;
			node.visibility = old.visibility !== false;
			addAndInit(node, parent);
			if (at >= 0) { const now = siblings.indexOf(node); if (now >= 0) siblings.splice(now, 1); siblings.splice(Math.min(at, siblings.length), 0, node); }
			try { old.remove(); } catch (e) { /* ignore */ }
			created.push(node);
			done++;
		} catch (error) { console.warn('[装配] 升级复调用标签失败', error); }
	}
	try { Undo.finishEdit('升级复调用标签为独立元素类型', { outliner: true, elements: created }); } catch (e) { /* ignore */ }
	try { Canvas.updateAll(); } catch (e) { /* ignore */ }
	try { Project.saved = false; } catch (e) { /* ignore */ }
	return done;
}

/** 在 Blockbench 原生动画属性对话框里追加时间轴 range_dispatch 设置 */
/** 当前动画的时间轴 range_dispatch 设置 */
function showAnimationTimelineDialog(animation) {
	animation = animation || ((typeof Animation !== 'undefined' && Animation) ? Animation.selected : null);
	if (!animation) { Blockbench.showQuickMessage('请先选择一个动画。', 2500); return; }
	new Dialog({
		id: 'imda_animation_timeline',
		title: '时间轴属性 — ' + (animation.name || 'animation'),
		width: 480,
		form: {
			imda_timeline_property: {
				label: 'range_dispatch property',
				type: 'select',
				value: animation.imda_timeline_property || 'custom_model_data',
				options: { custom_model_data: 'custom_model_data', cooldown: 'cooldown', count: 'count', damage: 'damage', time: 'time', use_cycle: 'use_cycle', use_duration: 'use_duration', compass: 'compass' },
			},
			imda_timeline_index: { label: 'custom_model_data index', type: 'number', value: num(animation.imda_timeline_index) },
			imda_timeline_target: { label: 'compass target', type: 'select', value: String(animation.imda_timeline_target || ''), options: { '': '（未设置）', lodestone: 'lodestone', none: 'none', spawn: 'spawn', recovery: 'recovery' }, condition: (r) => r.imda_timeline_property === 'compass' },
			imda_timeline_source: { label: 'time source', type: 'select', value: String(animation.imda_timeline_source || ''), options: { '': '（未设置）', daytime: 'daytime', random: 'random', moon_phase: 'moon_phase' }, condition: (r) => r.imda_timeline_property === 'time' },
			imda_timeline_wobble: { label: 'wobble（摆动浮动）', type: 'checkbox', value: animation.imda_timeline_wobble !== false, condition: (r) => r.imda_timeline_property === 'compass' || r.imda_timeline_property === 'time' },
			imda_timeline_normalize: { label: 'normalize（归一化）', type: 'checkbox', value: animation.imda_timeline_normalize !== false, condition: (r) => r.imda_timeline_property === 'count' || r.imda_timeline_property === 'damage' },
			imda_timeline_period: { label: 'period（周期）', type: 'number', value: num(animation.imda_timeline_period) || 1, condition: (r) => r.imda_timeline_property === 'use_cycle' },
			imda_timeline_remaining: { label: 'remaining（用剩余时间）', type: 'checkbox', value: animation.imda_timeline_remaining === true, condition: (r) => r.imda_timeline_property === 'use_duration' },
		},
		onConfirm(result) {
			try { Undo.initEdit({ animations: [animation] }); } catch (e) { /* ignore */ }
			animation.imda_timeline_property = result.imda_timeline_property || 'custom_model_data';
			animation.imda_timeline_index = num(result.imda_timeline_index);
	animation.imda_timeline_target = String(result.imda_timeline_target || '');
	animation.imda_timeline_source = String(result.imda_timeline_source || '');
	animation.imda_timeline_wobble = result.imda_timeline_wobble !== false;
	animation.imda_timeline_normalize = result.imda_timeline_normalize !== false;
	animation.imda_timeline_period = num(result.imda_timeline_period) || 1;
	animation.imda_timeline_remaining = result.imda_timeline_remaining === true;
			try { Undo.finishEdit('Edit timeline property'); } catch (e) { /* ignore */ }
			try { Project.saved = false; } catch (e) { /* ignore */ }
			Blockbench.showQuickMessage('已保存时间轴属性', 2000);
		},
	}).show();
}

function attachAnimationTimelineMenu() {
	if (typeof Animation === 'undefined' || !Animation || !Animation.prototype) return false;
	const menu = Animation.prototype.menu;
	if (!menu || typeof menu.addAction !== 'function') return false;
	const hasAction = () => { try { return Array.isArray(menu.structure) && menu.structure.some(item => item === actions.animationTimeline || (item && item.id === actions.animationTimeline.id)); } catch (e) { return false; } };
	const hasSeparator = () => { try { return Array.isArray(menu.structure) && menu.structure.some(item => item && item.id === 'imda_timeline_sep'); } catch (e) { return false; } };
	// 非 IMDA 格式：不往动画右键菜单里塞任何插件项，已塞过的也清掉。
	if (!isImdaFormat()) {
		try {
			if (hasAction() || hasSeparator()) {
				menu.structure = menu.structure.filter(item => item !== actions.animationTimeline && !(item && (item.id === 'imda_timeline_sep' || String(item.id || '').startsWith('imda_'))));
			}
		} catch (e) { /* ignore */ }
		menu.__imdaTimelineAdded = false;
		return false;
	}
	if (!actions.animationTimeline) return false;
	if (menu.__imdaTimelineAdded && hasAction()) return true;
	menu.__imdaTimelineAdded = false;
	try { if (!hasAction()) { menu.addAction(new MenuSeparator('imda_timeline_sep')); menu.addAction(actions.animationTimeline); } menu.__imdaTimelineAdded = true; return true; } catch (e) { return false; }
}

function installAnimationPropertiesPatch() {
	if (typeof Animation === 'undefined' || !Animation || !Animation.prototype) return;
	if (Animation.prototype.__imdaDialogPatched) return;
	Animation.prototype.__imdaDialogPatched = true;
	const original = Animation.prototype.propertiesDialog;
	Animation.prototype.propertiesDialog = function () {
		if (typeof Format === 'undefined' || Format.id !== FORMAT_ID) return original.apply(this, arguments);
		const animation = this;
		new Dialog({
			id: 'imda_animation_properties',
			title: animation.name,
			width: 660,
			resizeable: 'x',
			form: {
				name: { label: 'generic.name', value: animation.name },
				loop: {
					label: 'menu.animation.loop', type: 'inline_select', value: animation.loop,
					options: { once: 'menu.animation.loop.once', hold: 'menu.animation.loop.hold', loop: 'menu.animation.loop.loop' },
				},
				override: { label: 'menu.animation.override', type: 'checkbox', value: !!animation.override },
				snapping: { label: 'menu.animation.snapping', type: 'number', value: animation.snapping, step: 1, min: 10, max: 500 },
				anim_time_update: { label: 'menu.animation.anim_time_update', type: 'text', value: animation.anim_time_update || '' },
				blend_weight: { label: 'menu.animation.blend_weight', type: 'text', value: animation.blend_weight || '' },
				start_delay: { label: 'menu.animation.start_delay', type: 'text', value: animation.start_delay || '' },
				loop_delay: { label: 'menu.animation.loop_delay', type: 'text', value: animation.loop_delay || '' },
				_: '_',
				imda_timeline_property: {
					label: '时间轴 range_dispatch property',
					type: 'select',
					value: animation.imda_timeline_property || 'custom_model_data',
					options: { custom_model_data: 'custom_model_data', cooldown: 'cooldown', count: 'count', damage: 'damage', time: 'time', use_cycle: 'use_cycle', use_duration: 'use_duration', compass: 'compass' },
				},
				imda_timeline_index: { label: '时间轴 custom_model_data index', type: 'number', value: num(animation.imda_timeline_index) },
			imda_timeline_target: { label: 'compass target', type: 'select', value: String(animation.imda_timeline_target || ''), options: { '': '（未设置）', lodestone: 'lodestone', none: 'none', spawn: 'spawn', recovery: 'recovery' }, condition: (r) => r.imda_timeline_property === 'compass' },
			imda_timeline_source: { label: 'time source', type: 'select', value: String(animation.imda_timeline_source || ''), options: { '': '（未设置）', daytime: 'daytime', random: 'random', moon_phase: 'moon_phase' }, condition: (r) => r.imda_timeline_property === 'time' },
			imda_timeline_wobble: { label: 'wobble（摆动浮动）', type: 'checkbox', value: animation.imda_timeline_wobble !== false, condition: (r) => r.imda_timeline_property === 'compass' || r.imda_timeline_property === 'time' },
			imda_timeline_normalize: { label: 'normalize（归一化）', type: 'checkbox', value: animation.imda_timeline_normalize !== false, condition: (r) => r.imda_timeline_property === 'count' || r.imda_timeline_property === 'damage' },
			imda_timeline_period: { label: 'period（周期）', type: 'number', value: num(animation.imda_timeline_period) || 1, condition: (r) => r.imda_timeline_property === 'use_cycle' },
			imda_timeline_remaining: { label: 'remaining（用剩余时间）', type: 'checkbox', value: animation.imda_timeline_remaining === true, condition: (r) => r.imda_timeline_property === 'use_duration' },
			},
			onConfirm(result) {
				try {
					try { Undo.initEdit({ animations: [animation] }); } catch (e) { /* ignore */ }
					animation.name = String(result.name || animation.name).trim() || animation.name;
					animation.loop = result.loop || animation.loop;
					animation.override = !!result.override;
					animation.snapping = Math.max(10, Math.min(500, num(result.snapping) || animation.snapping));
					animation.anim_time_update = String(result.anim_time_update || '');
					animation.blend_weight = String(result.blend_weight || '');
					animation.start_delay = String(result.start_delay || '');
					animation.loop_delay = String(result.loop_delay || '');
					animation.imda_timeline_property = result.imda_timeline_property || 'custom_model_data';
					animation.imda_timeline_index = num(result.imda_timeline_index);
	animation.imda_timeline_target = String(result.imda_timeline_target || '');
	animation.imda_timeline_source = String(result.imda_timeline_source || '');
	animation.imda_timeline_wobble = result.imda_timeline_wobble !== false;
	animation.imda_timeline_normalize = result.imda_timeline_normalize !== false;
	animation.imda_timeline_period = num(result.imda_timeline_period) || 1;
	animation.imda_timeline_remaining = result.imda_timeline_remaining === true;
					try { Undo.finishEdit('Edit animation'); } catch (e) { /* ignore */ }
					try { Project.saved = false; } catch (e) { /* ignore */ }
					try { Canvas.updateAll(); } catch (e) { /* ignore */ }
				} catch (error) { console.warn('[装配] 保存动画属性失败', error); }
			},
		}).show();
	};
}

/* ============================== 导出器/* ============================== 对象创建约定 ============================== */
/** 硬性约定：新建 Group/Locator/Cube 必须 add + init 都调用（先 add 后 init） */
function addAndInit(node, parent) {
	if (!node) return node;
	try { if (parent) node.addTo(parent); else node.addTo(); } catch (e) { /* ignore */ }
	try { if (typeof node.init === 'function') node.init(); } catch (e) { /* ignore */ }
	return node;
}

/* ============================== 导出器 ============================== */

class Exporter {
	constructor(settings) {
		this.namespace = settings.namespace;
		this.subpath = settings.subpath || '';
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
		this.projectDisplay = readProjectDisplay();
		this.displayAllSlots = settings.display_all_slots === true;
		this.timelinePoses = null;
		this.timelineSkip = null;
		this.groupShifts = new Map();
		this.modelCache = new Map();
		this.displayCopies = new Map();
		this.overwrites = [];
		this.cubeIds = new WeakMap();
		this.cubeIdSeq = 0;
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

	/** 生成模型文件所在的子目录（相对 models/item/）：用主文件名 item_id，例如主文件 items/inker/jet_rifle.json → models/item/jet_rifle/ */
	modelDir() {
		const seg = String(this.item_id || '').replace(/\\/g, '/').split('/').filter(Boolean);
		return sanitizePath(seg.length ? seg[seg.length - 1] : 'item', 'item');
	}

	/** 生成模型的引用前缀，形如 ns:item/jet_rifle/ */
	modelRefBase() {
		return this.namespace + ':item/' + this.modelDir() + '/';
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
		const rotation = cube.__imda_omit_rotation ? null : this.elementRotation(cube);
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
		const cubeKey = (cube) => { if (!cube) return '?'; if (cube.uuid) return cube.uuid; if (cube.name) return cube.name; let id = this.cubeIds.get(cube); if (!id) { id = 'cube-' + (++this.cubeIdSeq); this.cubeIds.set(cube, id); } return id; };
		const modelKey = cubes.map(cubeKey).join('|');
		if (this.modelCache.has(modelKey)) return this.modelCache.get(modelKey);
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
		const display = this.blockDisplay ? this.desiredDisplay() : null;
		if (display && Object.keys(display).length) model.display = JSON.parse(JSON.stringify(display));

		const name = this.unique(sanitizePath(hint || 'part', 'model').replace(/\//g, '_') || 'part', this.modelNames);
		this.models.push({ name, data: model });
		const built = { reference: this.modelRefBase() + name, shift };
		this.modelCache.set(modelKey, built);
		return built;
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
		const translate = (node && Array.isArray(node.__imda_translate)) ? node.__imda_translate : null;
		const hasShift = Math.abs(d[0]) + Math.abs(d[1]) + Math.abs(d[2]) > 1e-6;
		if (Math.abs(q.w) > 1 - 1e-7 && !hasShift && !(translate && translate.some(v => Math.abs(num(v)) > 1e-6))) return null;

		const m = quatMatrix(q);
		const origin = (node && node.origin) || [0, 0, 0];
		const offset = this.centerPivot ? CENTER : 0;
		const pivot = [num(origin[0]) - offset, num(origin[1]) - offset, num(origin[2]) - offset];
		const rp = rotVec(m, pivot);
		const rd = rotVec(m, d);
		return {
			translation: cleanAll([0, 1, 2].map(a => (rd[a] + pivot[a] - rp[a] - dp[a] + (translate ? num(translate[a]) : 0)) / UNIT)),
			left_rotation: cleanAll([q.x, q.y, q.z, q.w]),
			scale: [1, 1, 1],
			right_rotation: [0, 0, 0, 1],
		};
	}

	/** 分支阈值格式：i / i*2 / 10+i*5 / 0,1,3 / ni / fi / f-1-i / si */
	/**
	 * 分支阈值格式
	 *   i         → 0,1,2…
	 *   2i / i*2  → 0,2,4…
	 *   10+2i     → 10,12,14…
	 *   0,1,3     → 字面列表，超出末尾按 +1 顺延
	 *   2:2i      → 每个值重复 2 次：2,2,4,4,6,6…（冒号前是重复次数/步长）
	 *   ni        → 0·n,1·n,2·n…（n = 本分支在上层节点里的编号；如上层编号 5 → 0,5,10；
	 *               没有显式编号时取「同层兄弟分组从上往下数的序号」，slots{a,b,c} → n = 1,2,3）
	 *   f         → 本分支同层元素的数量（含自身）；f-1-i 即倒序编号
	 *   s         → 本分支的子项数量（不递归）
	 */
	/** 分支子节点在父级里的 1 起序号（分组 + 复调用标签，按大纲顺序）——编号格式变量 n 的缺省值来源。
	 *  例：slots{a,b,c} → a/b/c 得 1/2/3。 */
	siblingIndexOf(parent, child) {
		try {
			const kids = branchChildNodes(parent);
			const i = kids.indexOf(child);
			return i < 0 ? undefined : i + 1;
		} catch (e) { return undefined; }
	}

	evalThreshold(format, index, n, extra) {
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
		// n = 本分支在上层节点里的编号（阈值本身）；缺省（上层没有编号）当 1，于是 `ni` 等价于 `i`
		const nv = (n === undefined || n === null || n === '' || !isFinite(Number(n))) ? 1 : Number(n);
		// f = 本分支所在层级的元素数（含自身）；s = 本分支自己的子项数（不递归）。缺省同 n 按 1。
		const vars = (extra && typeof extra === 'object') ? extra : {};
		const numeric = (v) => (v === undefined || v === null || v === '' || !isFinite(Number(v))) ? 1 : Number(v);
		const fv = numeric(vars.f);
		const sv = numeric(vars.s);
		if (text.indexOf(',') >= 0) {
			const list = text.split(',').map(v => Number(v)).filter(v => isFinite(v));
			if (!list.length) return null;
			return step < list.length ? list[step] : list[list.length - 1] + (step - list.length + 1);
		}
		try {
			// 让 2i / 10+2i / ni / 2f / fs 这类写法变成合法 JS 表达式（隐式乘法）
			const js = text
				.replace(/i/g, '*i')                // 2i / ni / fi → 2*i / n*i / f*i
				.replace(/(\d)([nfs])/g, '$1*$2')   // 2n / 2f / 2s → 2*n / 2*f / 2*s
				.replace(/([nfs])(?=[nfs])/g, '$1*') // fs / nf → f*s / n*f
				.replace(/^\*/, '')
				.replace(/([+\-*/])\*/g, '$1');
			const fn = new Function('i', 'n', 'f', 's', '"use strict";return (' + js + ');');
			const value = Number(fn(step, nv, fv, sv));
			return isFinite(value) ? value : null;
		} catch (error) { return null; }
	}

	normalizeType(value) {
		const t = String(value || 'composite').toLowerCase().replace(/^minecraft:/, '');
		return MAPPING_TYPES.indexOf(t) >= 0 ? t : 'composite';
	}

	/** 按来源类型构造 tints；imda_tints 的原始 JSON 优先 */
	buildTints(group) {
		// 纹理着色：索引为空 → 不输出任何 tints；类型默认 custom_model_data
		const index_text = String(group.imda_tint_index == null ? '' : group.imda_tint_index).trim();
		if (!/^-?\d+$/.test(index_text)) return null;
		// 明确选择“不生成 tints”（空字符串）时直接退出；只有从未设置（undefined）才按默认 custom_model_data
		if (group.imda_tint_type === '' || group.imda_tint_type === 'none') return null;
		const index = Number(index_text);
		const type = (String(group.imda_tint_type == null ? 'custom_model_data' : group.imda_tint_type).replace(/^minecraft:/, '').trim()) || 'custom_model_data';
		const value_text = String(group.imda_tint_value == null ? '' : group.imda_tint_value).trim();
		if (type === 'custom_model_data') return [{ type: 'custom_model_data', index, default: index }];
		if (type === 'constant') return [{ type: 'constant', value: value_text.length ? Number(value_text) : 0 }];
		if (type === 'grass') return [{ type: 'grass' }];
		const entry = { type };
		if (value_text.length) entry.default = Number(value_text) || 0;
		return [entry];
	}


	/** select 的 when：支持 JSON 数组（元素可为字符串/数字/布尔/对象），或逗号分隔（数字/布尔/字符串）。
	 *  component 属性下 when 的元素是**对象**（如 `{"id": "sqsp:gun"}`），所以必须整段按 JSON 解析。 */
	parseWhen(value) {
		const text = String(value == null ? '' : value).trim();
		if (!text) return [];
		if (text.charAt(0) === '[') {
			try {
				const parsed = JSON.parse(text);
				if (Array.isArray(parsed)) return parsed;
			} catch (e) { /* fallthrough */ }
			// 手写时常常漏引号（[a, b]），退回按逗号切
		}
		// 单个对象字面量也接受：{"id": "ns:path"} → [{id:'ns:path'}]
		if (text.charAt(0) === '{') {
			try {
				const parsed = JSON.parse(text);
				if (parsed && typeof parsed === 'object') return [parsed];
			} catch (e) { /* fallthrough */ }
		}
		return text.replace(/^\[|\]$/g, '').split(',').map(part => {
			const t = part.trim().replace(/^["']|["']$/g, '');
			if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
			if (t === 'true') return true;
			if (t === 'false') return false;
			if (t.charAt(0) === '{') { try { return JSON.parse(t); } catch (e) { /* ignore */ } }
			return t;
		}).filter(t => t !== '');
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

	buildNode(group, hint, parent_shift, selfNumber) {
		if (this.normalizeType(group.imda_type) === 'range_dispatch_timeline') return this.buildTimelineNode(group, hint, parent_shift);
		const pose = this.timelinePoses ? this.timelinePoses.get(group.uuid || group.name) : null;
		if (pose) {
			group = Object.assign({}, group, {
				origin: Array.isArray(pose.origin) ? pose.origin.slice() : group.origin,
				rotation: Array.isArray(pose.rotation) ? pose.rotation.slice() : group.rotation,
				children: group.children,
				__imda_translate: Array.isArray(pose.position) ? pose.position.slice() : null,
			});
		} else if (this.timelinePoses && this.groupNodeCache.has(group) && !this.nodeIsEmpty(this.groupNodeCache.get(group)) && !this.hasPoseInSubtree(group)) {
			return this.groupNodeCache.get(group);
		}
		const children = (group.children || []).filter(c => c && c.export !== false);
		const childGroups = children.filter(isGroup).filter(c => !this.timelineSkip || !this.timelineSkip.has(c));
		const cubes = children.filter(isCube);
		let type = this.normalizeType(group.imda_type);
		if (type === 'internal') type = 'composite';

		const inlineCubes = [];
		const ownCubes = [];
		for (const cube of cubes) (this.needsOwnNode(cube) ? ownCubes : inlineCubes).push(cube);

		let built = null;
		if (type === 'model' && group.imda_model) {
			let shift = [0, 0, 0];
			try {
				const parsed = JSON.parse(String(group.imda_model_shift || ''));
				if (Array.isArray(parsed) && parsed.length === 3 && parsed.every(v => isFinite(Number(v)))) shift = parsed.map(Number);
			} catch (e) { /* ignore */ }
			built = { reference: String(group.imda_model).trim(), shift };
		}
		else if (inlineCubes.length) built = this.addModel(inlineCubes, hint);

		// inline（内联模型）在导出结构里等同于 composite：自身方块烘焙成模型，子分组各自输出
		const outputType = type === 'inline' ? 'composite' : type;
		const node = { type: 'minecraft:' + outputType };
		this.applyNodeName(node, group);
		try { this.groupNodes.set(node, group); } catch (e) { /* ignore */ }
		try { this.groupNodeCache.set(group, node); } catch (e) { /* ignore */ }
		let own_shift = built ? built.shift : [0, 0, 0];
		if (type === 'model') {
			const O = Array.isArray(group.origin) ? group.origin : [0, 0, 0];
			let Os = O;
			let hasOrigin = false;
			try { const parsed = JSON.parse(String(group.imda_model_origin || '')); if (Array.isArray(parsed) && parsed.length === 3) { Os = parsed; hasOrigin = true; } } catch (e) { /* ignore */ }
			// 旧导入数据：方块坐标里已经加了 group.origin，但没有记录 imda_model_origin
			if (!hasOrigin && !String(group.imda_model_shift || '').trim()) Os = [0, 0, 0];
			const delta = [0, 1, 2].map(a => (Number(O[a]) || 0) - (Number(Os[a]) || 0));
			own_shift = [0, 1, 2].map(a => (Number(own_shift[a]) || 0) + delta[a]);
		}
		this.groupShifts.set(group, own_shift);
		const transformation = this.buildTransformation(group, own_shift, parent_shift);
		if (transformation) node.transformation = transformation;

		// 引用其他物品模型映射（imda_model 写成 `ns:items/路径`）：
		// 读取目标 items/*.json 里的 model 定义，内联为 composite 包裹，外层仍带本分组的 transformation。
		if (type === 'model' && parseMappingReference(group.imda_model)) {
			const def = loadMappingDefinition(String(group.imda_model).trim(), { readOnly: true });
			if (def && def.model) {
				node.type = 'minecraft:composite';
				node.models = [def.model];
				try { this.mappingRefs = (this.mappingRefs || 0) + 1; } catch (e) { /* ignore */ }
				return node;
			}
			this.warn('分组 “' + labelOf(group) + '” 引用物品映射失败：' + ((def && def.error) || '未知错误'));
		}

		const extras = ownCubes.map(cube => this.buildCubeNode(cube, hint, parent_shift)).filter(Boolean);
		const callLocators = children.filter(isLocator);
		// 复调用标签的「当前编号」：range_dispatch 里是它作为 entry 的 threshold（见下方循环）；
		// composite / inline 里没有阈值，用它在同层 call 标签里的 0 起序号（与导出顺序一致）。
		const calls = callLocators.map((locator, callIndex) => this.buildCallNode(locator, this.callSelfNumber(locator, group, callIndex), group)).filter(Boolean);
		if (calls.length && type !== 'composite' && type !== 'inline' && type !== 'range_dispatch' && type !== 'select') {
			this.warn('复调用标签只支持放在 composite / inline 分组里，已忽略 ' + calls.length + ' 个。');
			calls.length = 0;
		}

		if (type === 'empty') return node;

		if (type === 'model') {
			const ref = built ? built.reference : (extras[0] ? extras[0].model : null);
			if (!ref) { this.warn('分组 “' + labelOf(group) + '” 是 model 类型但没有可用模型，已跳过。'); return null; }
			node.model = this.unifyReferenceDisplay(ref, group.imda_display_mode);
			const tints = this.buildTints(group);
			if (tints) node.tints = tints;
			return node;
		}

		if (type === 'select') {
			const prop = String(group.imda_property || 'custom_model_data').replace(/^minecraft:/, '').trim() || 'custom_model_data';
			node.property = 'minecraft:' + prop;
			// index 只对 custom_model_data 有意义；component 用 component 字段（组件类型 ID）。
			if (prop === 'custom_model_data') node.index = clean(num(group.imda_index));
			else if (prop === 'component') node.component = String(group.imda_component || 'minecraft:custom_data');
			node.cases = [];
			for (const child of childGroups) {
				const siblingNo = this.siblingIndexOf(group, child);
				const childNode = this.buildNode(child, hint + '_' + sanitizePath(labelOf(child), 'group'), own_shift, siblingNo);
				if (!childNode) continue;
				const when = this.parseWhen(child.imda_case_when);
				// when 为空说明这个 case 谁都不匹配，原版会当成永不命中，留着只会误导；跳过并告警
				if (!when.length) { this.warn('select 分支 “' + labelOf(child) + '” 的 when 为空，已跳过。'); continue; }
				node.cases.push({ when, model: childNode });
			}
			let fallback = built ? { type: 'minecraft:model', model: built.reference } : (extras[0] || null);
			if (calls.length) fallback = this.composeWithCalls(fallback, calls);
			if (fallback) { this.groupNodes.set(fallback, group); node.fallback = fallback; }
			if (!node.cases.length && !node.fallback) return null;
			return node;
		}

		if (type === 'range_dispatch') {
			if (group.imda_tints) this.warn('分组 "' + labelOf(group) + '" 的 tints 只在 model / composite 生效，range_dispatch 已忽略。');
			// imda_property 存的是裸名（属性面板的选项值），导出必须补 minecraft: 前缀；
			// 这里以前写成 `|| 'minecraft:custom_model_data'`，只有字段为空时才带前缀，
			// 非空时原样输出 "property": "custom_model_data" —— 原版不认，整条 range_dispatch 失效。
			node.property = 'minecraft:' + String(group.imda_property || 'custom_model_data').replace(/^minecraft:/, '').trim().replace(/^$/, 'custom_model_data');
			// custom_model_data 必须有 index，未填时默认 0
			if (node.property === 'minecraft:custom_model_data' && node.index === undefined) node.index = 0;
			const numeric = node.property.replace(/^minecraft:/, '');
			if (numeric === 'compass') {
				if (group.imda_range_target) node.target = String(group.imda_range_target);
				if (group.imda_range_wobble === false) node.wobble = false;
			} else if (numeric === 'count' || numeric === 'damage') {
				if (group.imda_range_normalize === false) node.normalize = false;
			} else if (numeric === 'time') {
				if (group.imda_range_source) node.source = String(group.imda_range_source);
				if (group.imda_range_wobble === false) node.wobble = false;
			} else if (numeric === 'use_cycle') {
				const period = num(group.imda_range_period);
				if (period > 0) node.period = clean(period);
			} else if (numeric === 'use_duration') {
				if (group.imda_range_remaining === true) node.remaining = true;
			}
			const scale = num(group.imda_scale);
			if (scale && scale !== 1) node.scale = clean(scale);
			if (String(group.imda_index || '').length) node.index = clean(group.imda_index);
			node.entries = [];
			let branch_index = 0;
			for (const child of childGroups) {
				const manualText = String(child.imda_threshold == null ? '' : child.imda_threshold).trim();
				const manual = num(child.imda_threshold);
				// 父级编号格式优先：子分组自己的 imda_threshold_format 描述的是“它自己 entries 的编号”，
				// 不是它在父级里的位置。若让子级格式覆盖父级，bone7 的 5-i 会被 sacpackN 自带的 i/i+N
				// 顶掉，输出变成 0,1,1,2…（与名字前缀 [5..1] 相反）。只有父级没写格式时才回退到子级格式。
				// 第三个参数 selfNumber = 本 range_dispatch 自己在上层节点里的编号，供格式里的变量 n 使用。
				// 第四个参数 extra = 格式变量 f / s，取「格式所有者」自己的统计：
				// 父级格式 → 用本容器 group 算；子级回退格式 → 用子分组 child 算。
				const parentFormatted = this.evalThreshold(group.imda_threshold_format, branch_index, selfNumber, thresholdFormatVars(group));
				const childFormatted = parentFormatted === null ? this.evalThreshold(child.imda_threshold_format, branch_index, undefined, thresholdFormatVars(child)) : null;
				const formatted = parentFormatted !== null ? parentFormatted : childFormatted;
				// 实例化覆盖的阈值（包括 0）优先于父级 threshold_format。
				const threshold = (child.imda_threshold_force && manualText !== '') ? manual : (formatted !== null ? formatted : (manual !== 0 ? manual : branch_index));
				// 这个 threshold 就是“子分支在本节点里的编号”，把它作为 n 一路传给子分支的 buildNode。
				const childNode = this.buildNode(child, hint + '_' + sanitizePath(labelOf(child), 'group'), own_shift, threshold);
				if (!childNode) continue;
				node.entries.push({ threshold: clean(threshold), model: childNode });
				branch_index++;
			}
			for (const locator of callLocators) {
				try {
					const rawThreshold = String((callOverridesOf(locator).threshold == null ? '' : callOverridesOf(locator).threshold)).trim();
					const selfNo = /^-?\d+(\.\d+)?$/.test(rawThreshold) ? Number(rawThreshold) : branch_index;
					const callNode = this.buildCallNode(locator, selfNo, group);
					if (!callNode) continue;
					node.entries.push({ threshold: clean(selfNo), model: callNode });
					branch_index++;
				} catch (e) { /* ignore */ }
			}
			calls.length = 0;
			let fallback = built ? { type: 'minecraft:model', model: built.reference } : (extras[0] || null);
			if (calls.length) fallback = this.composeWithCalls(fallback, calls);
			if (fallback) { this.groupNodes.set(fallback, group); node.fallback = fallback; }
			if (!node.entries.length && !node.fallback) return null;
			// 原版语义：range_dispatch 取「最后一个 threshold ≤ 当前值」的条目，
			// 也就是 entries 的顺序就是判定顺序。分支编号格式写成 `5-i` 时，大纲里
			// 子分组是 [5][4][3][2][1]，算出的阈值就是 5,4,3,2,1（递减）；
			// 原样输出会让「所有 threshold 都 ≤ 当前值」时永远命中最末尾那条，
			// 每个值都选错分支。所以这里按阈值升序稳定排序（同值保持大纲顺序）。
			node.entries = node.entries
				.map((entry, index) => ({ entry, index }))
				.sort((a, b) => (a.entry.threshold - b.entry.threshold) || (a.index - b.index))
				.map(pair => pair.entry);
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
			const childNode = this.buildNode(child, hint + '_' + sanitizePath(labelOf(child), 'group'), own_shift, this.siblingIndexOf(group, child));
			if (childNode) models.push(childNode);
		}
		if (!models.length) { this.warn('分组 “' + labelOf(group) + '” 没有可导出内容，已跳过。'); return null; }

		if (type === 'condition') {
			const pred = String(group.imda_property || 'minecraft:selected').replace(/^minecraft:/, '').trim() || 'selected';
						node.property = 'minecraft:' + pred;
						if (pred === 'custom_model_data') node.index = clean(num(group.imda_index));
						else if (pred === 'has_component') {
							node.component = String(group.imda_component || '');
							if (group.imda_ignore_default) node.ignore_default = true;
						} else if (pred === 'component') {
							node.predicate = String(group.imda_predicate || '');
							const raw = String(group.imda_value == null ? '' : group.imda_value).trim();
							if (raw.length) { try { node.value = JSON.parse(raw); } catch (e) { node.value = raw; } }
						} else if (pred === 'keybind_down') {
							node.keybind = String(group.imda_keybind || '');
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
	desiredDisplay() {
		if (!this.blockDisplay) return {};
		const custom = this.projectDisplay || {};
		// 没有“显示调整”数据：回退到内置手持预设，保证模型在手里不至于完全没变换。
		if (!Object.keys(custom).length) return JSON.parse(JSON.stringify(BLOCK_DISPLAY));
		// 有显示调整数据：只输出用户真正改过的槽位（与 Blockbench 默认值不同）。
		const out = {};
		for (const slot of Object.keys(custom)) {
			const def = DEFAULT_DISPLAY[slot];
			if (def && sameSlotTransform(custom[slot], def)) continue;
			out[slot] = custom[slot];
		}
		return out;
	}

	readReferenceModel(reference) {
		const root = String(projectValue('imda_pack_path', '') || '').trim();
		if (!root) return null;
		try {
			const pathmod = getPath();
			const fsmod = getScopedFs(root);
			if (!pathmod || !fsmod) return null;
			const abs = modelPathOf(pathmod, root, reference);
			if (!fsmod.existsSync(abs)) return null;
			return { data: JSON.parse(fsmod.readFileSync(abs, 'utf8')), abs, root, pathmod, fsmod };
		} catch (e) { return null; }
	}

	/** 沿 parent 链求引用模型的“有效 display”（子槽覆盖父槽），用于判断是否需要覆盖。 */
	effectiveReferenceDisplay(reference, source) {
		const eff = {};
		const seen = {};
		let data = source && source.data;
		for (let depth = 0; depth < 12 && data; depth++) {
			const disp = data.display;
			if (disp && typeof disp === 'object') {
				for (const slot of Object.keys(disp)) {
					if (!(slot in eff) && disp[slot] && typeof disp[slot] === 'object') eff[slot] = disp[slot];
				}
			}
			const parent = typeof data.parent === 'string' ? data.parent.trim() : '';
			if (!parent || seen[parent]) break;
			seen[parent] = true;
			let next = null;
			try {
				const abs = modelPathOf(source.pathmod, source.root, parent);
				if (source.fsmod.existsSync(abs)) next = JSON.parse(source.fsmod.readFileSync(abs, 'utf8'));
			} catch (e) { next = null; }
			data = next;
		}
		return eff;
	}

	/** display 归一化比较：忽略零旋转/零平移/单位缩放，数值取 6 位小数。 */
	sameDisplay(a, b) {
		const norm = (disp) => {
			const out = {};
			if (!disp || typeof disp !== 'object') return out;
			for (const slot of Object.keys(disp)) {
				const d = disp[slot];
				if (!d || typeof d !== 'object') continue;
				const s = {};
				const r = Array.isArray(d.rotation) ? d.rotation.map(v => Math.round(num(v) * 1e6) / 1e6) : null;
				const t = Array.isArray(d.translation) ? d.translation.map(v => Math.round(num(v) * 1e6) / 1e6) : null;
				const c = Array.isArray(d.scale) ? d.scale.map(v => Math.round(num(v) * 1e6) / 1e6) : null;
				if (r && r.some(v => Math.abs(v) > 1e-6)) s.rotation = r;
				if (t && t.some(v => Math.abs(v) > 1e-6)) s.translation = t;
				if (c && c.some(v => Math.abs(v - 1) > 1e-6)) s.scale = c;
				if (Object.keys(s).length) out[slot] = s;
			}
			return out;
		};
		return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
	}

	/** 找引用模型（含父链）可用的 particle 贴图：优先 textures.particle，其次任意真实路径贴图。 */
	referenceParticleTexture(reference, source) {
		let data = source && source.data;
		const seen = {};
		const pick = (textures) => {
			if (!textures || typeof textures !== 'object') return null;
			if (typeof textures.particle === 'string') {
				const p = textures.particle.trim();
				if (p && p.charAt(0) !== '#') return p;
			}
			for (const key of Object.keys(textures)) {
				const v = textures[key];
				if (typeof v === 'string' && v.trim() && v.trim().charAt(0) !== '#') return v.trim();
			}
			return null;
		};
		let current = String(reference || '').trim();
		for (let depth = 0; depth < 12 && data; depth++) {
			const found = pick(data.textures);
			if (found) return found;
			const parent = typeof data.parent === 'string' ? data.parent.trim() : '';
			if (!parent || seen[parent]) break;
			seen[parent] = true;
			let next = null;
			try {
				if (source && source.pathmod && source.fsmod) {
					const abs = modelPathOf(source.pathmod, source.root, parent);
					if (source.fsmod.existsSync(abs)) next = JSON.parse(source.fsmod.readFileSync(abs, 'utf8'));
				}
			} catch (e) { next = null; }
			data = next;
		}
		return null;
	}

	/** 强制统一引用模型的 display：
	 *  copy      = 检测到与引用模型（含父链）的 display 不适配时，新建一个以源模型为 parent、覆盖 display 的模型；
	 *  overwrite = 直接改写资源包里的源模型文件；
	 *  none      = 不处理。 */
	unifyReferenceDisplay(reference, mode) {
		if (!reference || mode === 'none') return reference;
		const desired = this.desiredDisplay();
		if (!desired || !Object.keys(desired).length) return reference;
		const source = this.readReferenceModel(reference);
		// 源模型不在本地资源包里，无法判断差异：保持原引用
		if (!source || !source.data) return reference;
		const effective = this.effectiveReferenceDisplay(reference, source);
		if (this.sameDisplay(effective, desired)) return reference;
		if (mode === 'overwrite') {
			const rel = source.pathmod.relative(source.root, source.abs).replace(/\\/g, '/');
			const data = Object.assign({}, source.data, { display: desired });
			this.overwrites.push({ path: rel, data: formatModel(data) });
			return reference;
		}
		const key = reference + '|' + JSON.stringify(desired);
		if (this.displayCopies.has(key)) return this.displayCopies.get(key);
		// 只用源模型的最后一段文件名作为副本名，避免 name 里带出 item/inker/... 这类目录段嵌套进文件名。
		const refLeaf = String(reference).split(':').pop().split('/').filter(Boolean).pop() || 'ref';
		const base = sanitizePath(refLeaf, 'ref').replace(/\//g, '_') + '_display';
		const name = this.unique(base, this.modelNames);
		// 仅保留 parent + display：几何/纹理全部继承源模型，只覆盖显示调整参数。
		const parentId = /:/.test(String(reference)) ? String(reference).trim() : ('minecraft:' + String(reference).trim());
		const data = { parent: parentId, display: JSON.parse(JSON.stringify(desired)) };
		// 补 particle：源模型（含父链）常缺 `textures.particle`，Minecraft 会对继承它的副本报
		// “Missing texture references ... particle”。这里取源模型第一个真实贴图路径补上。
		const particle = this.referenceParticleTexture(reference, source);
		if (particle) data.textures = { particle };
		this.models.push({ name, data });
		const ref = this.modelRefBase() + name;
		this.displayCopies.set(key, ref);
		return ref;
	}

	composeWithCalls(base, calls) {
		if (!calls || !calls.length) return base;
		if (!base) return calls.length === 1 ? calls[0] : { type: 'minecraft:composite', models: calls };
		return { type: 'minecraft:composite', models: [base].concat(calls) };
	}

	/** 复调用标签 → 占位节点。
	 *  selfNumber = 该标签在**当前容器**里的编号（即它在父 range_dispatch 里的 threshold），
	 *  引用目标分组后要用它重算目标 entries 的编号（否则会沿用目标原来位置算出的阈值）。
	 *  parentGroup = 该标签当前所在的容器，用于算 f（同层元素数）。 */
	buildCallNode(locator, selfNumber, parentGroup) {
		const target = String((locator && locator.imda_call_target) || '').trim();
		if (!target) return null;
		if (target.indexOf(':') >= 0) return { type: 'minecraft:model', model: target };
		let group = null;
		try { if (typeof Group !== 'undefined' && Array.isArray(Group.all)) group = Group.all.find(g => g && g.uuid === target) || null; } catch (e) { /* ignore */ }
		if (!group) { this.warn('复调用标签 “' + labelOf(locator) + '” 找不到目标分组：' + target); return null; }
		return {
			type: 'minecraft:empty',
			__imda_call_group: group,
			__imda_call_name: String(locator.name || labelOf(locator)),
			__imda_call_pose: { position: (locator.position || [0, 0, 0]).slice(), rotation: (locator.rotation || [0, 0, 0]).slice() },
			__imda_call_overrides: callOverridesOf(locator),
			__imda_call_self_number: selfNumber,
			__imda_call_parent: parentGroup || null,
		};
	}

	/** 复调用标签在「当前容器」里的编号（供重算被引目标的 entries 用），**从 1 起**，
	 *  与编辑器里的 `siblingBranchNumber()` / 分组子项口径完全一致：
	 *  - 父级是 range_dispatch → 用它作为 entry 的 threshold（0 起，与 entries 对齐）；
	 *  - 否则（composite / inline / 根）→ 同层分支子项里从上往下数的序号（1 起）。 */
	callSelfNumber(locator, parentGroup, callIndex) {
		const parentType = parentGroup ? String(parentGroup.imda_type || '').replace(/^minecraft:/, '') : '';
		if (parentType === 'range_dispatch') {
			const raw = String((callOverridesOf(locator).threshold == null ? '' : callOverridesOf(locator).threshold)).trim();
			if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
			const siblings = branchChildNodes(parentGroup);
			const idx = siblings.indexOf(locator);
			return idx >= 0 ? idx : callIndex;
		}
		if (parentGroup) {
			const siblings = branchChildNodes(parentGroup);
			const idx = siblings.indexOf(locator);
			if (idx >= 0) return idx + 1;
		}
		return callIndex + 1;
	}


	/** 把占位替换为目标分组的映射节点（深拷贝，保留 transformation） */
	resolveCallTarget(placeholder) {
		const group = placeholder && placeholder.__imda_call_group;
		if (!group) return null;
		let target = this.groupNodeCache ? this.groupNodeCache.get(group) : null;
		if (!target) {
			try { target = this.buildNode(group, sanitizePath(labelOf(group), 'group'), [0, 0, 0]); } catch (e) { target = null; }
			if (target) this.groupNodeCache.set(group, target);
		}
		if (!target) { this.warn('复调用目标没有可导出的映射节点，已跳过。'); return null; }
		const clone = JSON.parse(JSON.stringify(target));
		this.stripCallPlaceholders(clone);
		// 目标分组原本的 entries 阈值是按「目标自己原来的位置」算的（f / n 都是旧值）。
		// 作为复调用标签插进新容器后，f 与 n 都变了，必须按当前位置重新算一遍编号，
		// 否则 [2] sac_slots #3 里的三个调用会沿用 [5]/[4]/[3]，而不是 [3]/[2]/[1]。
		try { this.recomputeCallEntries(clone, group, placeholder); } catch (e) { /* ignore */ }
		try {
			const ov = placeholder.__imda_call_overrides || {};
			if (ov.property) clone.property = 'minecraft:' + String(ov.property).replace(/^minecraft:/, '');
			for (const key of ['index', 'scale', 'period']) if (ov[key] !== undefined && ov[key] !== '') clone[key] = clean(num(ov[key]));
			for (const key of ['wobble', 'normalize', 'remaining', 'ignore_default']) if (ov[key] === 'true' || ov[key] === 'false') clone[key] = ov[key] === 'true';
			for (const key of ['component', 'predicate', 'value', 'keybind', 'target', 'source', 'condition']) if (ov[key] !== undefined && ov[key] !== '') clone[key] = String(ov[key]);
			if (ov.threshold_format && clone.type === 'minecraft:range_dispatch' && Array.isArray(clone.entries)) {
				const callVars = this.callFormatVars(group, placeholder.__imda_call_parent);
				clone.entries.forEach((entry, k) => { const threshold = this.evalThreshold(ov.threshold_format, k, placeholder.__imda_call_self_number, callVars); if (threshold !== null) entry.threshold = clean(threshold); });
				this.sortEntries(clone);
			}
		} catch (e) { /* ignore */ }
		const result = this.wrapCallPose(clone, group, placeholder.__imda_call_pose) || clone;
		if (placeholder.__imda_call_name) result.node_name = placeholder.__imda_call_name;
		return result;
	}

	/** 复调用标签的格式变量：f = 标签当前所在层的元素数，s = 被引分组自己的子项数。 */
	callFormatVars(targetGroup, parentGroup) {
		return {
			f: (parentGroup && isGroup(parentGroup)) ? countLayerItems(parentGroup) : 1,
			s: countLayerItems(targetGroup),
		};
	}

	/** 按阈值升序稳定排序 entries（与 buildNode 里 range_dispatch 的导出排序一致）。 */
	sortEntries(node) {
		if (!node || !Array.isArray(node.entries)) return;
		node.entries = node.entries
			.map((entry, index) => ({ entry, index }))
			.sort((a, b) => (Number(a.entry.threshold) - Number(b.entry.threshold)) || (a.index - b.index))
			.map(pair => pair.entry);
	}

	/** 复调用标签引用目标后，按「标签当前的结构」重算被引目标 entries 的编号。 */
	recomputeCallEntries(clone, group, placeholder) {
		if (!clone || clone.type !== 'minecraft:range_dispatch' || !Array.isArray(clone.entries)) return;
		const format = String(group && group.imda_threshold_format || '');
		if (!format) return;
		const selfNumber = placeholder ? placeholder.__imda_call_self_number : undefined;
		const parentGroup = placeholder ? placeholder.__imda_call_parent : null;
		const vars = this.callFormatVars(group, parentGroup);
		clone.entries.forEach((entry, k) => {
			const threshold = this.evalThreshold(format, k, selfNumber, vars);
			if (threshold !== null) entry.threshold = clean(threshold);
		});
		this.sortEntries(clone);
	}

	/** 把 Locator 的绝对位置/旋转转换为相对目标分组的补偿 transformation */
	wrapCallPose(clone, group, pose) {
		if (!pose || !Array.isArray(pose.position) || !Array.isArray(pose.rotation)) return clone;
		const O = Array.isArray(group.origin) ? group.origin : [0, 0, 0];
		const identity = { x: 0, y: 0, z: 0, w: 1 };
		const qg = readQuaternion(group) || identity;
		const ql = readQuaternion({ rotation: pose.rotation }) || identity;
		let qd = quatMul(ql, quatConj(qg));
		const len = Math.hypot(qd.x, qd.y, qd.z, qd.w) || 1;
		qd = { x: qd.x / len, y: qd.y / len, z: qd.z / len, w: qd.w / len };
		const rotatedO = quatRotateVec(qd, [num(O[0]), num(O[1]), num(O[2])]);
		const t = [0, 1, 2].map(a => clean((num(pose.position[a]) - rotatedO[a]) / UNIT));
		const sameRot = Math.abs(qd.w) > 1 - 1e-6 && Math.abs(qd.x) + Math.abs(qd.y) + Math.abs(qd.z) < 1e-6;
		if (sameRot && Math.abs(t[0]) + Math.abs(t[1]) + Math.abs(t[2]) < 1e-6) return clone;
		return {
			type: 'minecraft:composite',
			transformation: { translation: t, left_rotation: [clean(qd.x), clean(qd.y), clean(qd.z), clean(qd.w)], scale: [1, 1, 1], right_rotation: [0, 0, 0, 1] },
			models: [clone],
		};
	}

	resolveCallPlaceholders(node) {
		if (!node || typeof node !== 'object') return;
		if (Array.isArray(node)) {
			for (let i = node.length - 1; i >= 0; i--) {
				const item = node[i];
				if (item && typeof item === 'object' && item.__imda_call_group) {
					const clone = this.resolveCallTarget(item);
					if (clone) node[i] = clone; else node.splice(i, 1);
				} else this.resolveCallPlaceholders(item);
			}
			return;
		}
		for (const key of Object.keys(node)) {
			const value = node[key];
			if (value && typeof value === 'object' && value.__imda_call_group) {
				const clone = this.resolveCallTarget(value);
				if (clone) node[key] = clone; else delete node[key];
			} else if (value && typeof value === 'object') this.resolveCallPlaceholders(value);
		}
	}
	/** 克隆体内残留的复调用占位改成 empty，避免自引用无限展开 */
	stripCallPlaceholders(node) {
		if (!node || typeof node !== 'object') return;
		if (Array.isArray(node)) {
			for (let i = node.length - 1; i >= 0; i--) {
				const item = node[i];
				if (item && typeof item === 'object' && item.__imda_call_group) node[i] = { type: 'minecraft:empty' };
				else this.stripCallPlaceholders(item);
			}
			return;
		}
		for (const key of Object.keys(node)) {
			const value = node[key];
			if (value && typeof value === 'object') this.stripCallPlaceholders(value);
		}
	}

	/** 映射节点记录来源分组名（可在项目设置关闭） */
	applyNodeName(node, group) {
		if (!node || !group) return node;
		if (projectValue('imda_export_node_names', true) === false) return node;
		if (group.uuid === '__imda_auto_timeline') return node;
		node.node_name = String((group && group.name) || labelOf(group));
		return node;
	}

	/** 分组子树里是否有任何节点带当前帧姿态 */
	hasPoseInSubtree(group) {
		if (!this.timelinePoses || !group) return false;
		if (this.timelinePoses.has(group.uuid || group.name)) return true;
		for (const child of (group.children || [])) {
			if (isGroup(child) && this.hasPoseInSubtree(child)) return true;
		}
		return false;
	}

	/** 空节点判断 */
	nodeIsEmpty(node) {
		if (!node) return true;
		const type = String(node.type || '');
		if (type === 'minecraft:composite') return !(node.models || []).length;
		if (type === 'minecraft:range_dispatch') return !(node.entries || []).length && !node.fallback;
		if (type === 'minecraft:select') return !(node.cases || []).length && !node.fallback;
		if (type === 'minecraft:condition') return !node.on_true && !node.on_false;
		return false;
	}

	/** range_dispatch(timeline)：优先用 Locator 的 imda_frame/imda_pose，否则自动采样当前动画 */
	buildTimelineNode(group, hint, parent_shift) {
		const frames = new Map();
		for (const locator of (group.children || []).filter(isLocator)) {
			const frame = num(locator.imda_frame);
			if (!isFinite(frame) || frame < 0) continue;
			let pose = {};
			try { pose = JSON.parse(String(locator.imda_pose || '{}')); } catch (e) { pose = {}; }
			const map = frames.get(frame) || new Map();
			for (const uuid of Object.keys(pose || {})) if (pose[uuid] && typeof pose[uuid] === 'object') map.set(uuid, pose[uuid]);
			frames.set(frame, map);
		}
		this.timelineFps = Math.max(1, num(projectValue('imda_anim_fps', 20)) || 20);
		this.timelineProperty = group.imda_property || 'custom_model_data';
		this.timelineIndex = (group.imda_index != null) ? num(group.imda_index) : num(projectValue('imda_anim_index', 0));
		this.timelineAttrs = { target: group.imda_range_target, source: group.imda_range_source, wobble: group.imda_range_wobble, normalize: group.imda_range_normalize, period: group.imda_range_period, remaining: group.imda_range_remaining };
		if (!frames.size) return this.buildAutoTimeline(group, hint, parent_shift);
		return this.buildFrameEntries(group, Array.from(frames.keys()).sort((a, b) => a - b), frames, hint, parent_shift);
	}

	/** 从当前动画自动采样帧（不依赖项目里的标签） */
	buildAutoTimeline(group, hint, parent_shift) {
		const animation = (typeof Animation !== 'undefined' && Animation) ? (Animation.selected || (Array.isArray(Animation.all) ? Animation.all[0] : null)) : null;
		if (!animation) { this.warn('时间轴分组没有帧标签，且当前没有选中动画。'); return null; }
		const fps = Math.max(1, num(projectValue('imda_anim_fps', 20)) || 20);
		let duration = num(animation.length);
		if (!(duration > 0) && typeof Timeline !== 'undefined') duration = num(Timeline.length);
		if (!(duration > 0)) { this.warn('动画长度为 0，无法自动输出时间轴。'); return null; }
		const frameCount = Math.max(1, Math.ceil(duration * fps));
		const sampled = sampleTimelinePoses(animation, fps, frameCount);
		if (!sampled.animated.length) { this.warn('当前动画没有带关键帧的分组。'); return null; }
		const frames = new Map();
		for (let frame = 0; frame < sampled.poses.length; frame++) {
			const map = new Map();
			for (const uuid of Object.keys(sampled.poses[frame])) map.set(uuid, sampled.poses[frame][uuid]);
			frames.set(frame, map);
		}
		this.timelineFps = fps;
		this.timelineProperty = animation.imda_timeline_property || animation.imda_timeline_property || group.imda_property || projectValue('imda_anim_property', 'custom_model_data') || 'custom_model_data';
		this.timelineIndex = (animation.imda_timeline_index != null) ? num(animation.imda_timeline_index) : ((group.imda_index != null) ? num(group.imda_index) : num(projectValue('imda_anim_index', 0)));
		this.timelineAttrs = { target: animation.imda_timeline_target, source: animation.imda_timeline_source, wobble: animation.imda_timeline_wobble, normalize: animation.imda_timeline_normalize, period: animation.imda_timeline_period, remaining: animation.imda_timeline_remaining };
		return this.buildFrameEntries(group, Array.from(frames.keys()), frames, hint, parent_shift);
	}

	poseInFrame(group, map) {
		if (!group || !map) return false;
		if (map.has(group.uuid || group.name)) return true;
		for (const child of (group.children || [])) if (isGroup(child) && this.poseInFrame(child, map)) return true;
		return false;
	}

	/** 空几何的 display 载体：放在时间轴根 composite 的第一个子项，保证 display 能被解析 */
	displayCarrierReference() {
		if (this.displayCarrier) return this.displayCarrier;
		const name = this.unique('display', this.modelNames);
		const data = { display: this.desiredDisplay(), elements: [] };
		this.models.push({ name, data });
		this.displayCarrier = this.modelRefBase() + name;
		return this.displayCarrier;
	}

	/** 在姿态节点原位置替换为 range_dispatch；静态祖先保持原层级 */
	frameLabel(frame, fps) {
		const total = Math.max(0, Math.floor(num(frame)));
		const sec = Math.floor(total / fps);
		const ff = (total % fps) + 1;
		const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
		return 'frame ' + h + '.' + m + '.' + s + '.' + ff;
	}

	buildTimelineRange(prop, index, attrs, name) {
		const node = { type: 'minecraft:range_dispatch', property: 'minecraft:' + prop };
		if (name) node.node_name = name;
		if (prop === 'custom_model_data') node.index = clean(index);
		if (prop === 'compass') { if (attrs.target) node.target = String(attrs.target); if (attrs.wobble === false) node.wobble = false; }
		if (prop === 'time') { if (attrs.source) node.source = String(attrs.source); if (attrs.wobble === false) node.wobble = false; }
		if (prop === 'count' || prop === 'damage') { if (attrs.normalize === false) node.normalize = false; }
		if (prop === 'use_cycle') { const period = num(attrs.period); if (period > 0) node.period = clean(period); }
		if (prop === 'use_duration' && attrs.remaining === true) node.remaining = true;
		return node;
	}

	buildTimelineTree(group, sorted, frames, hint, parent_shift, isRoot) {
		const groupHint = (hint ? hint + '_' : '') + sanitizePath(labelOf(group), 'group');
		const anyPose = sorted.some(frame => this.poseInFrame(group, frames.get(frame)));
		if (!anyPose) { this.timelinePoses = null; this.timelineSkip = null; return this.buildNode(group, groupHint, parent_shift); }
		const ownPose = sorted.some(frame => { const map = frames.get(frame); return map && map.has(group.uuid || group.name); });
		const prop = String(this.timelineProperty || projectValue('imda_anim_property', 'custom_model_data') || 'custom_model_data').replace(/^minecraft:/, '').trim() || 'custom_model_data';
		const index = (this.timelineIndex != null) ? this.timelineIndex : num(projectValue('imda_anim_index', 0));
		const makeRange = (entries, name) => {
			let finalEntries = entries;
			if (prop === 'cooldown' && entries.length) {
				const thresholds = cooldownThresholds(entries.length);
				finalEntries = entries.map((entry, i) => ({ threshold: thresholds[i], model: entry.model }));
			}
			const node = this.buildTimelineRange(prop, index, this.timelineAttrs || {}, name);
			node.entries = finalEntries;
			return node;
		};;
		if (ownPose) {
			const entries = [];
			for (const frame of sorted) {
				this.timelinePoses = frames.get(frame);
				const node = this.buildNode(group, groupHint, parent_shift);
				this.timelinePoses = null;
				if (node && !this.nodeIsEmpty(node)) {
					const framed = { type: 'minecraft:composite', node_name: this.frameLabel(frame, this.timelineFps || 20), models: [node] };
					entries.push({ threshold: frame, model: framed });
				}
			}
			return entries.length ? makeRange(entries, isRoot ? '* timeline' : labelOf(group) + ' 动画') : null;
		}
		const childGroups = (group.children || []).filter(c => c && c.export !== false && isGroup(c));
		this.timelineSkip = new Set(childGroups); this.timelinePoses = null;
		const shell = this.buildNode(group, groupHint, parent_shift);
		this.timelineSkip = null;
		let shellNode = shell;
		if (!shellNode && childGroups.length) {
			const ownShift = this.groupShifts.get(group) || [0, 0, 0];
			const tr = this.buildTransformation(group, ownShift, parent_shift);
			shellNode = { type: 'minecraft:composite', models: [] };
			if (tr) shellNode.transformation = tr;
			this.applyNodeName(shellNode, group);
		}
		const parentShift = this.groupShifts.get(group) || [0, 0, 0];
		const childNodes = [];
		for (const child of childGroups) {
			const node = this.buildTimelineTree(child, sorted, frames, groupHint, parentShift, false);
			if (node && !this.nodeIsEmpty(node)) childNodes.push(node);
		}
		if (!shellNode) return childNodes.length ? (childNodes.length === 1 ? childNodes[0] : { type: 'minecraft:composite', models: childNodes }) : null;
		if (shellNode.type === 'minecraft:composite') {
			shellNode.models = (shellNode.models || []).concat(childNodes);
			if (!shellNode.models.length && !shellNode.transformation && !shellNode.node_name) return null;
			return shellNode;
		}
		return childNodes.length ? { type: 'minecraft:composite', models: [shellNode].concat(childNodes) } : shellNode;
	}

	buildFrameEntries(group, sorted, frames, hint, parent_shift) {
		const roots = ((typeof Outliner !== 'undefined' && Outliner && Outliner.root) ? Outliner.root : []).filter(n => isGroup(n) && n !== group && this.normalizeType(n.imda_type) !== 'range_dispatch_timeline' && n.export !== false);
		const animated = roots.some(root => sorted.some(frame => this.poseInFrame(root, frames.get(frame))));
		if (!animated) return null;
		const nodes = [];
		for (const root of roots) {
			const node = this.buildTimelineTree(root, sorted, frames, '', parent_shift, true);
			if (node && !this.nodeIsEmpty(node)) nodes.push(node);
		}
		this.timelinePoses = null; this.timelineSkip = null;
		if (!nodes.length) return null;
		return { type: 'minecraft:composite', models: nodes };
	}

	buildMapping() {
		const root = (typeof Outliner !== 'undefined' && Outliner && Outliner.root) ? Outliner.root : [];
		const timelineRoot = (root || []).find(node => isGroup(node) && this.normalizeType(node.imda_type) === 'range_dispatch_timeline');
if (timelineRoot) {
  const timelineNode = this.buildTimelineNode(timelineRoot, sanitizePath(labelOf(timelineRoot), 'timeline'), [0, 0, 0]);
  if (!timelineNode) throw new Error('时间轴分组没有可导出的帧。');
  const timelineResult = { model: timelineNode };
  this.resolveCallPlaceholders(timelineResult.model);
  return timelineResult;
}
if (projectValue('imda_anim_auto', true) !== false && typeof Animation !== 'undefined' && Animation && (Animation.selected || (Array.isArray(Animation.all) && Animation.all.length))) {
  const synthetic = { uuid: '__imda_auto_timeline', name: '[auto timeline]', imda_type: 'range_dispatch_timeline', imda_property: String(projectValue('imda_anim_property', 'custom_model_data') || 'custom_model_data'), imda_index: projectValue('imda_anim_index', 0), children: [] };
  const autoNode = this.buildAutoTimeline(synthetic, 'timeline', [0, 0, 0]);
  if (autoNode) { const autoResult = { model: autoNode }; this.resolveCallPlaceholders(autoResult.model); return autoResult; }
}
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

	/** 调试：在映射根外包 N 层空 composite，用于检测嵌套深度对 display 的影响 */
	wrapExtraLayers(node) {
		const count = Math.max(0, Math.min(10, num(projectValue('imda_extra_composite_layers', 0))));
		let out = node;
		for (let i = 0; i < count; i++) out = { type: 'minecraft:composite', models: [out] };
		return out;
	}

	buildFiles() {
		const mapping = this.buildMapping();
		const sub = this.subpath ? this.subpath + '/' : '';
		const modelSub = this.modelDir() ? this.modelDir() + '/' : '';
		const files = [{ path: 'assets/' + this.namespace + '/items/' + sub + this.item_id + '.json', data: formatMapping(mapping) }];
		for (const model of this.models) {
			files.push({ path: 'assets/' + this.namespace + '/models/item/' + modelSub + model.name + '.json', data: formatModel(model.data) });
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
		for (const overwrite of this.overwrites) files.push({ path: overwrite.path, data: overwrite.data });
		const notes = this.buildNotes();
		if (notes) files.push({ path: this.stem + '.notes.txt', data: notes });
		return { files, mapping };
	}
}

/** 采样当前动画：poses[frame][uuid] = {rotation, origin, position} */
function sampleTimelinePoses(animation, fps, frameCount) {
	const animated = [];
	for (const group of (typeof Group !== 'undefined' ? Group.all : [])) {
		let animator = null;
		try { animator = animation.getBoneAnimator(group); } catch (e) { animator = null; }
		if (!animator) continue;
		try {
			if (Array.isArray(animator.keyframes)) {
				for (const kf of animator.keyframes) {
					const ch = kf && kf.channel;
					if (!ch) continue;
					if (!Array.isArray(animator[ch])) animator[ch] = [];
					if (animator[ch].indexOf(kf) < 0) animator[ch].push(kf);
				}
			}
		} catch (e) { /* ignore */ }
		const hasRealKeys = (arr) => Array.isArray(arr) && arr.some(k => !!k);
		const hasKeys = hasRealKeys(animator.keyframes) || !!(animator.channels && Object.keys(animator.channels).some(k => hasRealKeys(animator.channels[k])));
		if (!hasKeys) continue;
		animated.push({ group, animator, baseRotation: (group.rotation || [0, 0, 0]).slice(), baseOrigin: (group.origin || [0, 0, 0]).slice() });
	}
	const oldTime = animation.time;
	const oldTimelineTime = (typeof Timeline !== 'undefined' && Timeline) ? Timeline.time : null;
	const poses = [];
	for (let frame = 0; frame < frameCount; frame++) {
		try { animation.time = frame / fps; } catch (e) { /* ignore */ }
		try { if (typeof Timeline !== 'undefined' && Timeline) Timeline.time = frame / fps; } catch (e) { /* ignore */ }
		const map = {};
		for (const item of animated) {
			let rotation = item.baseRotation.slice();
			let position = [0, 0, 0];
			try {
				const delta = item.animator.interpolate('rotation');
				if (Array.isArray(delta)) rotation = rotation.map((v, i) => num(v) + num(delta[i]));
			} catch (e) { /* ignore */ }
			try {
				const delta = item.animator.interpolate('position');
				if (Array.isArray(delta)) position = delta.map(v => num(v));
			} catch (e) { /* ignore */ }
			map[item.group.uuid || item.group.name] = { rotation, origin: item.baseOrigin.slice(), position };
		}
		poses.push(map);
	}
	try { animation.time = oldTime; } catch (e) { /* ignore */ }
	try { if (typeof Timeline !== 'undefined' && Timeline && oldTimelineTime != null) Timeline.time = oldTimelineTime; } catch (e) { /* ignore */ }
	return { animated, poses };
}

/** 旧流程：把当前动画逐帧烘焙成 [timeline] 分组 + Locator 标签（导出时会自动采样，一般不需要） */
function bakeTimelineToCallTags() {
	const animation = (typeof Animation !== 'undefined' && Animation) ? (Animation.selected || (Array.isArray(Animation.all) ? Animation.all[0] : null)) : null;
	if (!animation) { Blockbench.showMessageBox({ title: '没有动画', message: '请先打开动画模式并选择一个动画。', icon: 'info' }); return; }
	const fps = Math.max(1, num(projectValue('imda_anim_fps', 20)) || 20);
	let duration = num(animation.length);
	if (!(duration > 0) && typeof Timeline !== 'undefined') duration = num(Timeline.length);
	if (!(duration > 0)) { Blockbench.showMessageBox({ title: '动画长度为 0', message: '时间轴上没有可采样的关键帧。', icon: 'info' }); return; }
	const sampled = sampleTimelinePoses(animation, fps, Math.max(1, Math.ceil(duration * fps)));
	if (!sampled.animated.length) { Blockbench.showMessageBox({ title: '没有关键帧', message: '当前动画里没有带关键帧的分组。', icon: 'info' }); return; }
	const oldTimeline = (Outliner.root || []).filter(node => isGroup(node) && String(node.imda_type || '') === 'range_dispatch_timeline');
	try { Undo.initEdit({ outliner: true, groups: oldTimeline, elements: [] }); } catch (e) { /* ignore */ }
	for (const old of oldTimeline) { try { old.remove(); } catch (e) { /* ignore */ } }
	const timeline = new Group({ name: '[timeline]', imda_type: 'range_dispatch_timeline', imda_property: 'minecraft:custom_model_data', imda_index: num(projectValue('imda_anim_index', 0)) || 0, origin: [8, 8, 8], rotation: [0, 0, 0] });
	addAndInit(timeline, null);
	const createdLocators = [];
	for (let frame = 0; frame < sampled.poses.length; frame++) {
		try {
			const locator = newCallTag({ name: 'frame ' + frame, position: [8, 8, 8], rotation: [0, 0, 0] });
			if (!locator) continue;
			addAndInit(locator, timeline);
			locator.imda_frame = frame;
			locator.imda_pose = JSON.stringify(sampled.poses[frame]);
			locator.imda_call_target = 'timeline';
			createdLocators.push(locator);
		} catch (error) { console.warn('[装配] 创建帧标签失败', error); }
	}
	// 新建的分组/帧标签都要进 finish aspects，否则撤销时只会还原 outliner、留下孤儿节点
	try { Undo.finishEdit('解析时间轴为复调用标签', { outliner: true, groups: [timeline], elements: createdLocators }); } catch (e) { /* ignore */ }
	try { Canvas.updateAll(); } catch (e) { /* ignore */ }
	try { Project.saved = false; } catch (e) { /* ignore */ }
	try { simInvalidate(); } catch (e) { /* ignore */ }
	Blockbench.showQuickMessage('已解析时间轴：' + sampled.poses.length + ' 帧 × ' + sampled.animated.length + ' 个动画分组（' + fps + ' FPS）', 5000);
}

function createExporter() {
	migrateLegacyAll();
	return new Exporter({
		...(function(){ const parsed = parseNamespaceSetting(projectValue('imda_namespace', 'custom')); return { namespace: parsed.namespace, subpath: parsed.subpath }; })(),
		item_id: sanitizePath(String(projectValue('model_identifier', '') || (Project && Project.name) || 'item'), 'item'),
		center_pivot: projectValue('imda_center_pivot', false) === true,
		block_display: projectValue('imda_block_display', true) !== false,
		display_all_slots: projectValue('imda_display_all_slots', false) === true,
	});
}

/** F5：触发 Blockbench 原本的 Export action（与按钮一致） */
function findExportMenuItem(items) {
	for (const raw of (items || [])) {
		let item = raw;
		if (typeof raw === 'string') {
			item = (typeof BarItems !== 'undefined' && BarItems) ? BarItems[raw] : null;
		}
		if (!item) continue;
		const name = String(item.name || '');
		if (name.indexOf('物品模型映射') >= 0 || name.indexOf('Item Model Mapping') >= 0) return item;
		if (Array.isArray(item.children)) {
			const found = findExportMenuItem(item.children);
			if (found) return found;
		}
	}
	return null;
}

function bindF5ToOriginalExport() {
	if (typeof MenuBar === 'undefined' || !MenuBar.menus) return false;
	try {
		const fileMenu = (typeof MenuBar !== 'undefined' && MenuBar.menus) ? MenuBar.menus.file : null;
		if (!fileMenu) return false;
		let item = findExportMenuItem(fileMenu.structure);
		if (!item) {
			try { item = Keybinds.actions.find(a => String(a.name || '').indexOf('物品模型映射') >= 0 || String(a.name || '').indexOf('Item Model Mapping') >= 0) || null; } catch (e) { item = null; }
		}
		if (!item) { console.warn('[装配] 未找到「导出物品模型映射」菜单项，F5 未绑定'); return false; }
		if (!item.keybind || typeof item.keybind.set !== 'function') { console.warn('[装配] 导出菜单项没有 keybind，F5 未绑定', item.id || item.name); return false; }
		item.keybind.set(new Keybind({ key: 116 })).save();
		if (typeof Keybinds !== 'undefined' && Array.isArray(Keybinds.actions) && Keybinds.actions.indexOf(item) < 0 && item.id) {
			try { Keybinds.actions.push(item); } catch (e) { /* ignore */ }
		}
		console.log('[装配] 已把 F5 绑定到', item.id || item.name);
		return true;
	} catch (error) { console.warn('[装配] 绑定 F5 失败', error); return false; }
}

function triggerOriginalExport() {
	try {
		const fileMenu = (typeof MenuBar !== 'undefined' && MenuBar.menus) ? MenuBar.menus.file : null;
		const item = fileMenu ? findExportMenuItem(fileMenu.structure) : null;
		if (item) {
			if (typeof item.trigger === 'function') { item.trigger(); return; }
			if (typeof item.click === 'function') { item.click(); return; }
		}
	} catch (error) { console.warn('[装配] 查找导出菜单失败', error); }
	try { if (codec_object && typeof codec_object.export === 'function') { codec_object.export(); return; } } catch (error) { console.warn('[装配] codec.export 失败', error); }
	try { exportMappingJSON(); } catch (error) { console.error(error); }
}

/** 快捷导出：只导出 items/*.json 映射文件 */
function exportMappingJSON() {
	try {
		const exporter = createExporter();
		const mapping = exporter.buildMapping();
		Blockbench.export({
			type: 'Item Model Mapping',
			extensions: ['json'],
			name: exporter.stem,
			content: formatMapping(mapping),
			savetype: 'text',
		});
		Blockbench.showQuickMessage('已导出物品模型映射 JSON', 2500);
	} catch (error) {
		console.error(error);
		Blockbench.showMessageBox({ title: '导出失败', message: String((error && error.message) || error), icon: 'error' });
	}
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
	const picked = await Promise.resolve(Blockbench.pickDirectory({ resource_id: 'imda_pack', title: '选择目标资源包根目录' }));
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

/** 生成 pack.mcmeta 的 pack 段；versionId 缺省时取项目设置 imda_pack_version */
function packMcmetaData(description, versionId) {
	const version = findPackVersion(versionId || projectValue('imda_pack_version', DEFAULT_PACK_VERSION));
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

/** 老项目没有 imda_pack_version 时补默认值，避免项目设置的下拉落到第一项（26.3） */
function ensurePackVersion() {
	try {
		if (typeof Project !== 'undefined' && Project && !projectValue('imda_pack_version', '')) setProjectValue('imda_pack_version', DEFAULT_PACK_VERSION);
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
		if (typeof Project !== 'undefined' && Project) { setProjectValue('imda_pack_path', root); Project.saved = false; }
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
	try { setProjectValue('imda_pack_path', picked); Project.saved = false; } catch (e) { /* ignore */ }
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
	const root = String(projectValue('imda_pack_path', '') || '').trim();
	if (!root) { chooseOrCreatePack(); return; }
	const checkPath = getPath();
	const checkFs = getScopedFs(root);
	if (checkPath && checkFs && !readPackMcmeta(checkFs, checkPath, root)) {
		Blockbench.showMessageBox({
			title: '不是资源包工程',
			message: '该目录下没有 pack.mcmeta：\n' + root + '\n\n选择其它目录，或为它创建 pack.mcmeta。',
			buttons: ['取消', '选择…', '创建 pack.mcmeta'], confirm: 2, cancel: 0,
		}, (button) => {
			if (button === 1) pickPack().then(picked => { if (picked) { setProjectValue('imda_pack_path', picked); runMerge(picked); } });
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
			setProjectValue('imda_pack_path', plan.root);
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
function scheduleBranchSync(target, reason) {
	if (branchSyncTimer) clearTimeout(branchSyncTimer);
	branchSyncTimer = setTimeout(() => {
		branchSyncTimer = null;
		try {
			const active = (typeof document !== 'undefined') ? document.activeElement : null;
			if (active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName || '')) return;
			const group = target || pickTargetGroup();
			try { console.log('[装配] 分支同步触发', JSON.stringify({ reason: reason || '', target: group && group.name, parent: group && group.parent && group.parent.name })); } catch (e) { /* ignore */ }
			let changed = stripStrayBranchPrefixes();
			if (group) {
				const parent = group.parent || null;
				const beforeSelf = Array.isArray(group.children) ? group.children.filter(isGroup).map(c => (c.name || '') + ':' + c.imda_threshold) : [];
				const beforeParent = parent && Array.isArray(parent.children) ? parent.children.filter(isGroup).map(c => (c.name || '') + ':' + c.imda_threshold) : [];
				changed += sortBranchChildren(group) + syncBranchLabels(group);
				if (parent) changed += sortBranchChildren(parent) + syncBranchLabels(parent);
				const afterSelf = Array.isArray(group.children) ? group.children.filter(isGroup).map(c => (c.name || '') + ':' + c.imda_threshold) : [];
				const afterParent = parent && Array.isArray(parent.children) ? parent.children.filter(isGroup).map(c => (c.name || '') + ':' + c.imda_threshold) : [];
				if (changed) { try { console.log('[装配] 分支同步完成', JSON.stringify({ group: group.name, parent: parent && parent.name, beforeSelf, afterSelf, beforeParent, afterParent, changed })); } catch (e) { /* ignore */ } }
			}
			if (changed) { simInvalidate(); try { Project.saved = false; Canvas.updateAll(); } catch (e) { /* ignore */ } }
		} catch (error) { /* ignore */ }
	}, 250);
}

function sortBranchChildren(parent) {
	if (!parent || !Array.isArray(parent.children)) return 0;
	const type = String(parent.imda_type || '').replace(/^minecraft:/, '');
	if (type !== 'range_dispatch' && type !== 'condition') return 0;
	const thresholdFormat = String(parent.imda_threshold_format || '').trim();
	// 分支子节点 = 分组 + 复调用标签（导出器把复调用标签也算 range_dispatch entries）
	const items = branchChildNodes(parent);
	try { console.log('[装配] sortBranchChildren', JSON.stringify({ parent: parent.name || '', type, threshold_format: thresholdFormat, order: items.map(g => ({ name: g.name || '', threshold: isGroup(g) ? g.imda_threshold : callTagBranchThreshold(g) })) })); } catch (e) { /* ignore */ }
	// 格式（如 5-i）已经定义了“第 i 个分支”的 threshold；再用 threshold 排序会和 syncBranchLabels 互相翻转。
	if (type === 'range_dispatch' && thresholdFormat) return 0;
	if (items.length < 2) return 0;
	const keyOf = (child) => {
		if (type === 'condition') {
			const label = String(child.imda_condition || '').toLowerCase();
			if (label === 'on_true' || label === 'on_false') return label === 'on_true' ? 0 : 1;
			return items.indexOf(child);
		}
		if (isGroup(child)) return Number(child.imda_threshold) || 0;
		const t = callTagBranchThreshold(child);
		return t !== null ? t : items.indexOf(child);
	};
	const sorted = items.slice().sort((a, b) => keyOf(a) - keyOf(b));
	const unchanged = sorted.every((child, index) => child === items[index]);
	if (unchanged) return 0;
	try {
		console.log('[装配] 分支重排', JSON.stringify({
			parent: parent.name || '',
			type,
			threshold_format: thresholdFormat,
			before: items.map(g => ({ name: g.name || '', threshold: isGroup(g) ? g.imda_threshold : callTagBranchThreshold(g), key: keyOf(g) })),
			after: sorted.map(g => ({ name: g.name || '', threshold: isGroup(g) ? g.imda_threshold : callTagBranchThreshold(g), key: keyOf(g) })),
		}));
	} catch (e) { /* ignore */ }
	const others = parent.children.filter(child => items.indexOf(child) < 0);
	parent.children.length = 0;
	for (const child of sorted.concat(others)) parent.children.push(child);
	return sorted.length;
}

/* 切换类型时清掉不属于该类型的字段 */
function resetTypeSpecificProps(group, newType) {
	const type = String(newType || '').replace(/^minecraft:/, '');
	const branchTypes = ['condition', 'range_dispatch', 'select'];
	if (type !== 'condition' && type !== 'select') group.imda_condition = '';
	if (type !== 'select') group.imda_case_when = '';
	if (type !== 'range_dispatch') { group.imda_threshold_format = ''; group.imda_threshold = 0; }
	if (type === 'composite' || type === 'model' || type === 'empty') {
		group.imda_property = '';
		group.imda_component = '';
		group.imda_ignore_default = false;
		group.imda_predicate = '';
		group.imda_value = '';
		group.imda_keybind = '';
		group.imda_range_target = '';
		group.imda_range_source = '';
		group.imda_range_period = 1;
		group.imda_range_wobble = true;
		group.imda_range_normalize = true;
		group.imda_range_remaining = false;
	}
	if (type === 'condition') {
		group.imda_range_target = '';
		group.imda_range_source = '';
		group.imda_range_period = 1;
	}
	if (type === 'range_dispatch' || type === 'select') {
		group.imda_component = '';
		group.imda_ignore_default = false;
		group.imda_predicate = '';
		group.imda_value = '';
		group.imda_keybind = '';
	}
	return type;
}

/* 结构性容器名（不是分支前缀，规范化时不许剥）
   「生成复调用序列」「生成全物品模型表」「解析动画时间轴」都会建这种占位容器。 */
const STRUCTURAL_CONTAINER_NAMES = ['[sequence]', '[all items]', '[timeline]'];
function isStructuralContainerName(name) {
	return STRUCTURAL_CONTAINER_NAMES.indexOf(String(name == null ? '' : name).trim()) >= 0;
}

/* 剥掉所有子分组的 [..] / ⚠ 前缀（父分组不再是分支容器时用） */
function stripChildPrefixes(group) {
	let changed = 0;
	for (const child of (group.children || []).filter(c => isGroup(c) || isCallTag(c))) {
		if (isStructuralContainerName(child.name)) continue;
		const base = String(child.name || '').replace(/^\[[^\]]*\]\s*/, '').replace(/^\u26a0\s*/, '');
		if (base !== child.name) { child.name = base; changed++; }
		if (isGroup(child) && child.imda_auto_disabled) { child.imda_auto_disabled = false; changed++; }
	}
	return changed;
}

/* 分组/复调用标签被挪出分支容器（或挪到根目录）后，去掉名字里的 [k] / ⚠ 前缀 */
function stripStrayBranchPrefixes() {
	const branchTypes = ['condition', 'range_dispatch', 'select'];
	let changed = 0;
	const strip = (node) => {
		if (isStructuralContainerName(node.name)) return;
		const base = String(node.name || '').replace(/^\[[^\]]*\]\s*/, '').replace(/^\u26a0\s*/, '');
		if (base && base !== node.name) { node.name = base; changed++; }
		if (node.imda_auto_disabled) { node.imda_auto_disabled = false; changed++; }
	};
	const walk = (nodes, parent) => {
		for (const node of nodes || []) {
			const parentType = parent ? String(parent.imda_type || '').replace(/^minecraft:/, '') : '';
			if (isGroup(node)) {
				if (branchTypes.indexOf(parentType) < 0) strip(node);
				walk(node.children, node);
			} else if (isCallTag(node)) {
				// 复调用标签没有子节点；只有父级不是分支容器时才需要去掉旧前缀
				if (branchTypes.indexOf(parentType) < 0) strip(node);
			}
		}
	};
	walk((typeof Outliner !== 'undefined' && Outliner && Outliner.root) ? Outliner.root : [], null);
	return changed;
}

/** 规范单个分组的名字本体（分支前缀 [x] / ⚠ 由 syncBranchLabels 负责）：
 *  - 首尾空白、连续空白压成一个空格；
 *  - `[inline]` 标记只在 inline 分组上保留一个，且固定放在末尾
 *    （`createUniqueName` 会产生 `bone [inline]_1` 这种，也要归一）。 */
function cleanGroupName(name, type) {
	const wantsInline = String(type || '').replace(/^minecraft:/, '') === 'inline';
	let text = String(name == null ? '' : name).replace(/\s+/g, ' ').trim();
	// 去掉所有 [inline] 标记（含 createUniqueName 产生的 `[inline]_1`），末尾的 _N 去重号保留但贴回来
	text = text.replace(/\s*\[inline\]\s*/gi, ' ').replace(/\s+/g, ' ').trim();
	text = text.replace(/\s+(_\d+)$/, '$1');
	text = text || 'group';
	return wantsInline ? (text + ' [inline]') : text;
}

/** 「规范化结构」的子步骤：按父级的分支编号格式重算 threshold（序号），
 *  刷新名字里的 [x] 前缀，并规范分组名称格式。不做重排（顺序由用户决定）。
 *  返回 { renamed, numbered }（分别是被改名的节点数、被改阈值的分组数）。 */
function normalizeGroupNumbersAndNames() {
	const root = (typeof Outliner !== 'undefined' && Outliner && Outliner.root) ? Outliner.root : [];
	const nameBefore = new Map();
	const numBefore = new Map();
	const collect = (nodes) => {
		for (const node of nodes || []) {
			if (isGroup(node)) {
				nameBefore.set(node, String(node.name == null ? '' : node.name));
				numBefore.set(node, String(node.imda_threshold == null ? '' : node.imda_threshold));
				collect(node.children);
			} else if (isCallTag(node)) {
				nameBefore.set(node, String(node.name == null ? '' : node.name));
			}
		}
	};
	collect(root);

	// 1. 去掉不属于当前父级的分支前缀 [x] / ⚠
	stripStrayBranchPrefixes();
	// 2. 规范名字本体（空白、重复的 [inline]）
	const walkNames = (nodes) => {
		for (const node of nodes || []) {
			if (!isGroup(node)) continue;
			const type = String(node.imda_type || 'composite').replace(/^minecraft:/, '');
			const next = cleanGroupName(node.name, type);
			if (next !== node.name) node.name = next;
			walkNames(node.children);
		}
	};
	walkNames(root);
	// 3. 按父级格式重算 threshold 并刷新 [x] 前缀
	syncAllBranchLabels();

	let renamed = 0, numbered = 0;
	for (const [node, before] of nameBefore) {
		const now = String(node.name == null ? '' : node.name);
		if (now !== before) renamed++;
		if (numBefore.has(node)) {
			const nowNum = String(node.imda_threshold == null ? '' : node.imda_threshold);
			if (nowNum !== numBefore.get(node)) numbered++;
		}
	}
	return { renamed, numbered };
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
/** 平均点：分组枢轴归中与源模型几何中心必须共用这一套 */
/** cooldown 时间轴阈值：按原帧顺序返回，第一帧 1，最后一帧 0 */
function cooldownThresholds(count) {
	const n = Math.max(0, Math.floor(num(count)));
	if (!n) return [];
	if (n === 1) return [1];
	return Array.from({ length: n }, (_, i) => clean(1 - i / (n - 1)));
}

function averagePoints(points) {
	if (!points || !points.length) return null;
	return [0, 1, 2].map(a => points.reduce((sum, p) => sum + p[a], 0) / points.length);
}
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

/** 整棵子树坐标平移 delta（含子分组 origin 与所有方块），用于实例化到新位置 */
function translateGroupCoordinates(group, delta) {
	for (const child of (group.children || [])) {
		if (isCube(child)) {
			addVec(child.from, delta);
			addVec(child.to, delta);
			if (Array.isArray(child.origin)) addVec(child.origin, delta);
		} else if (isGroup(child)) {
			if (Array.isArray(child.origin)) addVec(child.origin, delta);
			translateGroupCoordinates(child, delta);
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
	try { cube.imda_pivot_offset = JSON.stringify(rotVec(quatMatrix(pivotConj(pivotQuat(cube))), d)); } catch (e) { /* ignore */ }
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
	const target = averagePoints(rendered);
	try { group.imda_pivot_offset = JSON.stringify(rotVec(quatMatrix(pivotConj(q)), [origin[0] - target[0], origin[1] - target[1], origin[2] - target[2]])); } catch (e) { /* ignore */ }
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
		// 注意：**不再**把方块的 rotation 枢轴改到父级 origin。
		// 实测（assembly.bbmodel）这一步会改变方块的渲染位置（几何相对 origin 构建，
		// 改 origin 而不重建顶点 = 模型被挪走），而且对“选中分组时 gizmo 的位置”没有帮助：
		//   gizmo = getSelectionCenter() = 被选方块 getWorldCenter() 的包围盒中心，
		//   而 getWorldCenter() 本来就是方块渲染包围盒的中心。
		// 方块枢轴改为在“创建时”就设成自身几何中心（见 importModelReference）。
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

function pivotOffsetOf(node) {
	try { const value = JSON.parse(String(node && node.imda_pivot_offset || '')); if (Array.isArray(value) && value.length === 3) return value.map(Number); } catch (e) { /* ignore */ }
	return null;
}

function groupContentCenter(group) {
	const points = pivotContentPoints(group);
	if (!points.length) return Array.isArray(group.origin) ? group.origin.slice() : [0, 0, 0];
	const q = pivotQuat(group), origin = group.origin || [0, 0, 0];
	const rendered = points.map(p => rotateAroundQuat(q, origin, p));
	return [0, 1, 2].map(i => rendered.reduce((sum, p) => sum + p[i], 0) / rendered.length);
}

function moveGroupPivot(group, target) {
	const old = (group.origin || [0, 0, 0]).slice();
	const d = [target[0] - old[0], target[1] - old[1], target[2] - old[2]];
	const back = rotVec(quatMatrix(pivotConj(pivotQuat(group))), d);
	const shift = [d[0] - back[0], d[1] - back[1], d[2] - back[2]];
	pivotTranslateContents(group, shift);
	group.origin = target.slice();
	return Math.hypot(d[0], d[1], d[2]);
}

function restoreGroupPivotFromRecord(group) {
	const offset = pivotOffsetOf(group);
	if (!offset) return 0;
	const center = groupContentCenter(group);
	const world = rotVec(quatMatrix(pivotQuat(group)), offset);
	return moveGroupPivot(group, [center[0] + world[0], center[1] + world[1], center[2] + world[2]]);
}

function restoreCubePivotFromRecord(cube) {
	const offset = pivotOffsetOf(cube);
	if (!offset || !isGroup(cube.parent)) return 0;
	const world = rotVec(quatMatrix(pivotQuat(cube)), offset);
	const base = Array.isArray(cube.parent.origin) ? cube.parent.origin : [0, 0, 0];
	const target = [base[0] + world[0], base[1] + world[1], base[2] + world[2]];
	return centerCubePivot(cube, target);
}

function restorePivotFromRecordDialog() {
	const groups = selectedGroups();
	const scope = groups.length ? groups : ((typeof Outliner !== 'undefined' && Outliner && Outliner.root) ? Outliner.root.filter(isGroup) : []);
	const allGroups = [];
	walkGroups(scope, g => allGroups.push(g));
	const cubes = [];
	for (const g of allGroups) for (const c of (g.children || [])) if (isCube(c)) cubes.push(c);
	if (!allGroups.length && !cubes.length) { Blockbench.showQuickMessage('没有可重建枢轴的分组，请先选中分组。', 2500); return; }
	try { Undo.initEdit({ groups: allGroups, elements: cubes }); } catch (e) { /* ignore */ }
	let restoredGroups = 0, restoredCubes = 0;
	for (const g of allGroups) {
		if (restoreGroupPivotFromRecord(g) > 0.001) restoredGroups++;
		for (const c of (g.children || [])) if (isCube(c) && restoreCubePivotFromRecord(c) > 0.001) restoredCubes++;
	}
	try { Undo.finishEdit('从记录重建枢轴点'); } catch (e) { /* ignore */ }
	try { Canvas.updateAll(); } catch (e) { /* ignore */ }
	try { Project.saved = false; } catch (e) { /* ignore */ }
	simInvalidate();
	Blockbench.showQuickMessage('从记录重建枢轴点：' + restoredGroups + ' 个分组、' + restoredCubes + ' 个方块', 4000);
}

function sourceModelGeometryCenter(reference) {
	const root = String(projectValue('imda_pack_path', '') || '').trim();
	if (!root) return { error: '先在项目设置里填写资源包工程路径。' };
	const pathmod = getPath(), fsmod = getScopedFs(root);
	if (!pathmod || !fsmod) return { error: '需要桌面版 Blockbench 才能读取源模型。' };
	const resolved = resolveJavaModel(pathmod, fsmod, root, reference);
	if (resolved.error) return { error: resolved.error };
	const elements = resolved.elements || [];
	if (!elements.length) return { error: '源模型没有 elements。' };
	const chains = new Map();
	const walkSourceGroups = (nodes, chain) => {
		for (const src of (nodes || [])) {
			if (!src || typeof src !== 'object') continue;
			const next = chain.concat([{ origin: Array.isArray(src.origin) ? src.origin : [0, 0, 0], rotation: Array.isArray(src.rotation) ? src.rotation : [0, 0, 0] }]);
			for (const child of (src.children || [])) if (typeof child === 'number') chains.set(child, next);
			walkSourceGroups((src.children || []).filter(c => c && typeof c === 'object'), next);
		}
	};
	walkSourceGroups(resolved.groups || [], []);
	const sourceRotationEuler = (rotation) => {
		if (!rotation || typeof rotation !== 'object') return [0, 0, 0];
		if (rotation.axis) {
			const angle = Number(rotation.angle) || 0;
			if (rotation.axis === 'x') return [angle, 0, 0];
			if (rotation.axis === 'y') return [0, angle, 0];
			return [0, 0, angle];
		}
		return [Number(rotation.x) || 0, Number(rotation.y) || 0, Number(rotation.z) || 0];
	};
	const points = [];
	for (let index = 0; index < elements.length; index++) {
		const el = elements[index];
		if (!el || !Array.isArray(el.from) || !Array.isArray(el.to)) continue;
		let center = [0, 1, 2].map(a => (Number(el.from[a]) + Number(el.to[a])) / 2);
		const elq = readQuaternion({ rotation: sourceRotationEuler(el.rotation) });
		const elOrigin = Array.isArray(el.rotation && el.rotation.origin) ? el.rotation.origin : [0, 0, 0];
		if (elq) center = rotateAroundQuat(elq, elOrigin, center);
		for (const group of (chains.get(index) || [])) {
			const q = readQuaternion({ rotation: group.rotation });
			if (q) center = rotateAroundQuat(q, group.origin, center);
		}
		points.push(center);
	}
	if (!points.length) return { error: '源模型没有有效几何。' };
	const center = averagePoints(points);
	return { center, count: points.length };
}

function selectedCallTags() {
	const found = [];
	const add = (node) => { if (isLocator(node) && String(node.imda_call_target || '').trim() && found.indexOf(node) < 0) found.push(node); };
	try { for (const node of ((typeof Outliner !== 'undefined' && Outliner && Outliner.selected) ? Outliner.selected : [])) add(node); } catch (e) { /* ignore */ }
	try { for (const node of ((typeof Locator !== 'undefined' && Locator && Locator.selected) ? Locator.selected : [])) add(node); } catch (e) { /* ignore */ }
	try {
		const walk = (nodes) => { for (const node of (nodes || [])) { if (isLocator(node) && node.selected) add(node); else if (isGroup(node)) walk(node.children); } };
		walk((typeof Outliner !== 'undefined' && Outliner) ? Outliner.root : []);
	} catch (e) { /* ignore */ }
	return found;
}

/** 右键实例化时把同一父组里的兄弟复调用标签一起收进来；无覆盖的继承第一个标签的覆盖。 */
function expandCallTagSiblings(list) {
	const out = Array.isArray(list) ? list.slice() : [];
	const source = out[0];
	const sourceOverrides = source ? callOverridesOf(source) : {};
	const parent = source && source.parent;
	if (!parent || !Array.isArray(parent.children)) return out;
	for (const node of parent.children) {
		if (!isLocator(node) || out.indexOf(node) >= 0) continue;
		if (!String(node.imda_call_target || '').trim()) continue;
		// "{}" 也是非空字符串，必须按解析后的字段数判断，否则空覆盖会阻止继承。
		if (Object.keys(sourceOverrides).length && Object.keys(callOverridesOf(node)).length === 0) {
			node.imda_call_overrides = JSON.stringify(sourceOverrides);
		}
		out.push(node);
	}
	return out;
}

function rebuildPivotFromSourceDialog() {
	const groups = selectedGroups();
	const calls = selectedCallTags();
	if (!groups.length && !calls.length) { Blockbench.showMessageBox({ title: '没有目标', message: '先选中要重建枢轴的分组或复调用标签。', icon: 'info' }); return; }
	const firstGroup = groups.find(g => String(g.imda_model || '').trim());
	const defaultRef = firstGroup ? String(firstGroup.imda_model || '').trim() : '';
	new Dialog({
		id: 'imda_rebuild_pivot_source',
		title: '参考源文件重建枢轴点',
		width: 560,
		form: {
			reference: { label: '源模型 id', type: 'text', value: defaultRef, description: '例如 sqsp:item/inker/jet_rifle/sac.full；几何中心会相对模型坐标原点计算。' },
			info: { label: '范围', type: 'textarea', readonly: true, value: '分组 ' + groups.length + ' 个；复调用标签 ' + calls.length + ' 个\n只移动复调用标签，普通 Locator 不会处理。' },
		},
		onConfirm(result) {
			const reference = String(result.reference || '').trim();
			if (!reference) return;
			const source = sourceModelGeometryCenter(reference);
			if (source.error) { Blockbench.showMessageBox({ title: '读取源模型失败', message: source.error, icon: 'error' }); return; }
			const sourceOffset = source.center;
			const undoGroups = [], undoElements = [];
			for (const g of groups) { undoGroups.push(g); for (const c of (g.children || [])) if (isCube(c)) undoElements.push(c); }
			undoElements.push(...calls);
			try { Undo.initEdit({ groups: undoGroups, elements: undoElements }); } catch (e) { /* ignore */ }
			let groupCount = 0, callCount = 0;
			for (const group of groups) {
				fixGroupPivot(group);
				const local = rotVec(quatMatrix(pivotQuat(group)), sourceOffset);
				const current = Array.isArray(group.origin) ? group.origin : [0, 0, 0];
				moveGroupPivot(group, [current[0] - local[0], current[1] - local[1], current[2] - local[2]]);
				groupCount++;
			}
			for (const locator of calls) {
				const local = rotVec(quatMatrix(pivotQuat(locator)), sourceOffset);
				const pos = Array.isArray(locator.position) ? locator.position : [0, 0, 0];
				locator.position = [pos[0] - local[0], pos[1] - local[1], pos[2] - local[2]];
				callCount++;
			}
			try { Undo.finishEdit('参考源文件重建枢轴点'); } catch (e) { /* ignore */ }
			try { Canvas.updateAll(); } catch (e) { /* ignore */ }
			try { Project.saved = false; } catch (e) { /* ignore */ }
			simInvalidate();
			Blockbench.showQuickMessage('参考源文件重建枢轴点：' + groupCount + ' 个分组、' + callCount + ' 个复调用标签；源偏移 [' + sourceOffset.map(v => v.toFixed(3)).join(', ') + ']', 5000);
		},
	}).show();
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
		id: 'imda_fix_pivot',
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

/** 本节点在「同层兄弟分组」里从上往下数的序号（1 起）：作为编号格式变量 n 的缺省值。
 *  例：slots{a,b,c} → a/b/c 的 n 分别是 1/2/3。合并 复调用标签（它们也是分支子项）。
 *  没有父级（根目录）时返回 undefined。 */
function siblingBranchNumber(node) {
	const parent = node && node.parent;
	if (!parent || !isGroup(parent)) return undefined;
	const siblings = branchChildNodes(parent);
	const index = siblings.indexOf(node);
	return index < 0 ? undefined : index + 1;
}

/** 本分组在上层节点里的编号（供编号格式的 n 用）：挂在 range_dispatch 下就用它的阈值，
 *  否则退回「同层兄弟分组里的 1 起序号」；根目录下返回 undefined（evalThreshold 缺省按 1）。 */
function branchSelfNumber(group) {
	const parent = group && group.parent;
	if (parent && isGroup(parent) && String(parent.imda_type || '').replace(/^minecraft:/, '') === 'range_dispatch') {
		const v = group.imda_threshold;
		if (v !== undefined && v !== null && String(v).trim() !== '' && isFinite(Number(v))) return Number(v);
	}
	return siblingBranchNumber(group);
}

/** 分支容器的“分支子节点”：分组 + 复调用标签（imda_call_tag 自定义元素，也兼容旧式带 imda_call_target 的 Locator）。
 *  顺序与导出器一致：先所有分组，再所有复调用标签。 */
function branchChildNodes(group) {
	const children = (group && Array.isArray(group.children)) ? group.children : [];
	const groups = children.filter(isGroup);
	const calls = children.filter(c => !isGroup(c) && isCallTag(c));
	return groups.concat(calls);
}

/** 递归数子树里的 cube（inline 分组的语义就是「把这些方块烘焙成一个模型」）。 */
function countInlineCubes(group) {
	let n = 0;
	for (const child of (group && Array.isArray(group.children) ? group.children : [])) {
		if (isCube(child)) n++;
		else if (isGroup(child)) n += countInlineCubes(child);
	}
	return n;
}

/** 数「一层」的元素数量（编号格式变量 f / s 的唯一口径）：
 *  - 分组、复调用标签各算 1；普通定位点不算；
 *  - 容器**自身是 inline（内联模型）**时递归数它内部的 cube（至少 1）；
 *  - 否则把该层的直属 cube 视作一个内联模型分组，合并算 1。
 *  group 既可以是 Group，也可以是 `{ children: Outliner.root }` 这样的伪容器。 */
function countLayerItems(group) {
	if (!group) return 1;
	const type = String(group.imda_type || '').replace(/^minecraft:/, '');
	if (type === 'inline') return Math.max(1, countInlineCubes(group));
	const children = Array.isArray(group.children) ? group.children : [];
	let n = 0;
	let hasLooseCube = false;
	for (const child of children) {
		if (isCube(child)) { hasLooseCube = true; continue; }
		if (isGroup(child)) { n++; continue; }
		if (isCallTag(child)) { n++; continue; }
		// 普通定位点 / 其它元素：不计数
	}
	if (hasLooseCube) n += 1;
	return n;
}

/** 编号格式变量 f / s 的取值（针对「格式所有者」那一个容器）：
 *  - f = 所有者所在层级的元素数（含自身）：a1 与 a2、a3 同层 → f = 3；
 *  - s = 所有者自己的子项数（不递归）：a1 = { b1, b2 } → s = 2。
 *  例：a:{ a1:{ b1:{}, b2:{} }, a2:{}, a3:{} }，a1 的格式 f-s → f=3, s=2，结果 1。
 *  所有者本身是 inline 分组时，s 退回「递归数它内部的 cube」。 */
function thresholdFormatVars(owner) {
	const isInlineOwner = isGroup(owner) && String(owner.imda_type || '').replace(/^minecraft:/, '') === 'inline';
	let f = 1;
	let s = 1;
	if (isGroup(owner)) {
		const parent = owner.parent;
		if (parent && isGroup(parent)) f = countLayerItems(parent);
		else if (typeof Outliner !== 'undefined' && Outliner && Array.isArray(Outliner.root) && Outliner.root.indexOf(owner) >= 0) f = countLayerItems({ children: Outliner.root });
		s = isInlineOwner ? countInlineCubes(owner) : countLayerItems(owner);
	}
	return { f, s };
}

/** 复调用标签作为 range_dispatch 分支时的有效阈值（导出语义：override.threshold，有则用）；返回 null 表示没有显式值。 */
function callTagBranchThreshold(node) {
	try {
		const ov = callOverridesOf(node);
		const raw = String(ov && ov.threshold != null ? ov.threshold : '').trim();
		if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
	} catch (e) { /* ignore */ }
	return null;
}

function syncBranchLabels(group) {
	const type = String((group && group.imda_type) || '').replace(/^minecraft:/, '');
	// select 也有分支前缀（[when] …），此前被这里挡在门外，导致 select 分支名永远不刷新
	if (type !== 'range_dispatch' && type !== 'condition' && type !== 'select') return 0;
	// 分支子节点同时包含分组和复调用标签（导出器把复调用标签也当 range_dispatch 的 entries）
	const children = branchChildNodes(group);
	let exporter = null;
	let changed = 0;
	children.forEach((child, index) => {
		let label = null;
		if (type === 'condition') {
			label = index === 0 ? 'on_true' : (index === 1 ? 'on_false' : null);
		} else if (type === 'select') {
			const when = String(child.imda_case_when || '').trim();
			label = when ? when.replace(/^\[|\]$/g, '').split(',')[0].trim() : ('case' + index);
		} else if (isGroup(child)) {
			try { if (!exporter) exporter = createExporter(); } catch (e) { exporter = null; }
			const formatted = exporter ? exporter.evalThreshold(group.imda_threshold_format, index, branchSelfNumber(group), thresholdFormatVars(group)) : null;
			// 格式生效时把数值同步回子节点，属性面板的 threshold 才不会永远显示 0。
			if (formatted !== null) child.imda_threshold = formatted;
			const manual = Number(child.imda_threshold) || 0;
			label = String(formatted !== null ? formatted : (manual !== 0 ? manual : index));
		} else {
			// 复调用标签：导出阈值 = override.threshold（有则用），否则它在分支里的序号
			const manual = callTagBranchThreshold(child);
			label = String(manual !== null ? manual : index);
		}
		const base = String(child.name || '').replace(/^\[[^\]]*\]\s*/, '').replace(/^\u26a0\s*/, '');
				// 没有对应标签（例如类型从 range_dispatch 改成 condition）→ 只剥掉旧前缀
				if (label === null) {
						// condition 只输出前两个分支，其余标上 ⚠ 提醒（导出时会被忽略）
						const ignored = type === 'condition' && index >= 2;
						const target = (ignored ? '\u26a0 ' : '') + base;
						if (ignored) {
							if (isGroup(child) && child.export !== false) { child.export = false; changed++; }
							if (projectValue('imda_hide_unavailable', true) !== false && child.visibility !== false) { child.visibility = false; changed++; }
						} else if (isGroup(child) && child.export === false && child.imda_auto_disabled) {
							child.export = true; child.imda_auto_disabled = false; changed++;
						}
						if (ignored) child.imda_auto_disabled = true;
						if (target !== child.name) { child.name = target; changed++; }
						return;
					}
		const prefix = '[' + label + '] ';
		const next = prefix + base;
		if (next !== child.name) { child.name = next; changed++; }
	});
	return changed;
}

/** 遍历大纲，给所有分支容器的子节点（分组 + 复调用标签）刷新名字前缀。只改名/阈值，不排序。 */
function syncAllBranchLabels() {
	let changed = 0;
	const walk = (nodes) => {
		for (const node of (nodes || [])) {
			if (!isGroup(node)) continue;
			try { changed += syncBranchLabels(node); } catch (e) { /* ignore */ }
			walk(node.children);
		}
	};
	try { walk((typeof Outliner !== 'undefined' && Outliner && Outliner.root) ? Outliner.root : []); } catch (e) { /* ignore */ }
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
	group.imda_type = result.imda_type;
	resetTypeSpecificProps(group, result.imda_type);
	const type = String(group.imda_type || '').replace(/^minecraft:/, '');
	if (type !== 'range_dispatch' && type !== 'condition' && type !== 'select') stripChildPrefixes(group);
	if (result.imda_model !== undefined) group.imda_model = result.imda_model;
	// 从资源管理器选的引用文件 → 按路径自动解析成引用串（models → ns:路径；items → ns:items/路径）
	if (result.imda_model_file) {
		const parsed = referenceFromPickedPath(result.imda_model_file);
		if (parsed && parsed.reference) {
			group.imda_model = parsed.reference;
			console.log('[装配] 引用解析', result.imda_model_file, '→', parsed.reference);
		} else if (parsed && parsed.error) {
			console.warn('[装配] ' + parsed.error);
			try { Blockbench.showQuickMessage('无法解析引用路径，已保留原值', 3000); } catch (e) { /* ignore */ }
		}
	}
				if (result.imda_display_mode !== undefined) group.imda_display_mode = result.imda_display_mode;
	if (result.imda_property !== undefined) group.imda_property = result.imda_property;
	if (result.imda_component !== undefined) group.imda_component = result.imda_component;
	if (result.imda_ignore_default !== undefined) group.imda_ignore_default = !!result.imda_ignore_default;
	if (result.imda_predicate !== undefined) group.imda_predicate = result.imda_predicate;
	if (result.imda_value !== undefined) group.imda_value = result.imda_value;
	if (result.imda_keybind !== undefined) group.imda_keybind = result.imda_keybind;
	if (result.imda_range_target !== undefined) group.imda_range_target = result.imda_range_target;
	if (result.imda_range_source !== undefined) group.imda_range_source = result.imda_range_source;
	if (result.imda_range_wobble !== undefined) group.imda_range_wobble = !!result.imda_range_wobble;
	if (result.imda_range_normalize !== undefined) group.imda_range_normalize = !!result.imda_range_normalize;
	if (result.imda_range_period !== undefined) group.imda_range_period = num(result.imda_range_period);
	if (result.imda_range_remaining !== undefined) group.imda_range_remaining = !!result.imda_range_remaining;
	if (result.imda_index !== undefined) group.imda_index = num(result.imda_index);
	if (result.imda_threshold !== undefined) group.imda_threshold = num(result.imda_threshold);
	if (result.imda_threshold_format !== undefined) group.imda_threshold_format = result.imda_threshold_format;
	if (result.imda_condition !== undefined) group.imda_condition = result.imda_condition;
	if (result.imda_scale !== undefined) group.imda_scale = num(result.imda_scale) || 1;
	if (result.imda_tints !== undefined) group.imda_tints = result.imda_tints;
	if (result.imda_align_center !== undefined) group.imda_align_center = !!result.imda_align_center;
	if (result.imda_tint_type !== undefined) group.imda_tint_type = (result.imda_tint_type === '' ? 'none' : result.imda_tint_type);
	if (result.imda_tint_index !== undefined) group.imda_tint_index = num(result.imda_tint_index);
	if (result.imda_tint_value !== undefined) group.imda_tint_value = result.imda_tint_value;
}

function editGroupProps() {
	migrateLegacyAll();
	const group = pickTargetGroup();
	const parent = (group && group.parent) || null;
	const parent_type = String((parent && parent.imda_type) || '').replace(/^minecraft:/, '');
	if (!group) {
		Blockbench.showMessageBox({ title: '请先选中分组', message: '先在 outliner 里点选一个分组。', icon: 'info' });
		return;
	}
	new Dialog({
		id: 'imda_group_props',
		title: '分组映射属性 — ' + labelOf(group) + (selectedGroups().length > 1 ? ('（共 ' + selectedGroups().length + ' 个）') : ''),
		width: 660,
		form: {
			imda_type: {
				label: '映射类型（type）', description: '语法：{"type": "minecraft:<类型>"}\n作用：决定本节点是哪一种物品模型映射。\n可选：composite / model / range_dispatch / condition / empty', type: 'select', value: String(group.imda_type || 'composite'),
				options: { composite: 'composite', inline: 'inline（内联模型）', model: 'model（引用模型）', internal: 'internal（内部结构）', range_dispatch: 'range_dispatch', range_dispatch_timeline: 'range_dispatch(timeline)（逐帧时间轴）', condition: 'condition', select: 'select', empty: 'empty' },
			},
			imda_model: { label: '引用模型（model）', description: '语法：{"type": "minecraft:model", "model": "<命名空间>:item/<路径>"}\n作用：本节点直接引用一个 Java 版模型；\n留空则由本层方块生成模型文件。\n引用其他物品映射：写成 <命名空间>:items/<路径>（对应 assets/<命名空间>/items/<路径>.json），导出时会把目标映射的 model 内联进来。', type: 'text', value: String(group.imda_model || ''), condition: (r) => r.imda_type === 'model' },
			imda_model_file: { label: '从资源包选择引用…', type: 'file', value: '', description: '用资源管理器选 assets/<命名空间>/models/… 或 assets/<命名空间>/items/…，会按路径自动解析并写入上一行的「引用模型」（items → ns:items/路径）。', condition: (r) => r.imda_type === 'model' },
			imda_display_mode: { label: '强制统一显示调整', type: 'select', value: String(group.imda_display_mode || 'copy'), options: { copy: '生成模型副本', none: '不处理', overwrite: '覆盖源模型参数' }, description: '引用模型的 display 与当前“显示调整”页不一致时：\n生成副本 = 在项目里生成一份改好 display 的模型副本（默认）\n不处理 = 保持原模型\n覆盖源模型参数 = 直接改写资源包里的原模型文件', condition: (r) => r.imda_type === 'model' },
			imda_property: { label: 'property（谓词 / 属性）', type: 'select', value: String(group.imda_property || '').replace(/^minecraft:/, ''), options: { '': '（未设置）', selected: 'selected', broken: 'broken', damaged: 'damaged', carried: 'carried', extended_view: 'extended_view', using_item: 'using_item', view_entity: 'view_entity', 'fishing_rod/cast': 'fishing_rod/cast', 'bundle/has_selected_item': 'bundle/has_selected_item', custom_model_data: 'custom_model_data', has_component: 'has_component', component: 'component', keybind_down: 'keybind_down', compass: 'compass（range）', count: 'count（range）', damage: 'damage（range）', time: 'time（range）', use_cycle: 'use_cycle（range）', use_duration: 'use_duration（range）', 'bundle/fullness': 'bundle/fullness（range）', cooldown: 'cooldown（range）', 'crossbow/pull': 'crossbow/pull（range）', context_dimension: 'context_dimension（select）', block_state: 'block_state（select）', local_time: 'local_time（select）' }, description: 'condition：谓词（selected / broken / custom_model_data / has_component / component / keybind_down …）；\nrange_dispatch：数值属性（custom_model_data / compass / count / damage / time / use_cycle / use_duration）', condition: (r) => r.imda_type === 'range_dispatch' || r.imda_type === 'condition' },
			imda_component: { label: 'component（has_component 用）', type: 'text', value: String(group.imda_component || ''), description: '语法："component": "minecraft:lodestone_tracker"', condition: (r) => r.imda_property === 'has_component' },
			imda_ignore_default: { label: 'ignore_default', type: 'checkbox', value: !!group.imda_ignore_default, description: 'has_component：组件值与默认值相同时是否视为不存在', condition: (r) => r.imda_property === 'has_component' },
			imda_predicate: { label: 'predicate（component 用）', type: 'text', value: String(group.imda_predicate || ''), description: '语法："predicate": "minecraft:stored_enchantments"', condition: (r) => r.imda_property === 'component' },
			imda_value: { label: 'value（component 用，JSON）', type: 'text', value: String(group.imda_value == null ? '' : group.imda_value), description: '语法："value": [ { ... } ]', condition: (r) => r.imda_property === 'component' },
			imda_keybind: { label: 'keybind（keybind_down 用）', type: 'text', value: String(group.imda_keybind || ''), description: '语法："keybind": "key.jump"', condition: (r) => r.imda_property === 'keybind_down' },			imda_index: { label: '分派下标（index）', description: '语法："index": 0\n作用：仅 range_dispatch，指定从 property 的哪个下标取值。', type: 'number', value: num(group.imda_index), condition: (r) => r.imda_type === 'range_dispatch' },
			imda_threshold_format: { label: '分支编号格式（entries[].threshold）', type: 'text', value: String(group.imda_threshold_format || ''), description: '语法：i → 0,1,2；2i 或 i*2 → 0,2,4；10+2i → 10,12,14；0,1,3 → 字面列表；2:2i → 每个值重复 2 次、索引从 1 起（2,2,4,4,6,6…）。\n变量 n = 本分支在上层节点里的编号：如本分支是 slots[5]，格式 ni → 子分支 0,5,10；没有显式编号时取「同层兄弟分组从上往下数的序号」（slots{a,b,c} → n = 1,2,3）。\n变量 f = **本容器所在层级的元素数（含自身）**；s = **本容器自己的子项数（不递归）**。例：a:{ a1:{b1,b2}, a2:{}, a3:{} }，a1 的格式 f-s → f=3、s=2，结果 1；a 的格式 f-s → f=1、s=3。\n作用：range_dispatch 的子分组按顺序取这些阈值；留空为 0,1,2…', condition: (r) => r.imda_type === 'range_dispatch' },
			imda_threshold: { label: '分支编号 / 阈值（entries[].threshold）', type: 'number', value: num(group.imda_threshold), description: '语法：{"threshold": 0}\n作用：父分组为 range_dispatch 时，本分组的阈值；修改后自动按阈值重排。', condition: (r) => r.imda_type === 'range_dispatch' || parent_type === 'range_dispatch' },
			imda_condition: { label: '分支条件（on_true / on_false）', type: 'select', value: String(group.imda_condition || ''), options: { '': '（按位置）', on_true: 'on_true', on_false: 'on_false' }, description: '语法："on_true" / "on_false"\n作用：父分组为 condition 时决定本分支走哪一支；修改后自动重排。', condition: (r) => parent_type === 'condition' },
			imda_scale: { label: '数值缩放（scale）', description: '语法："scale": 1.0\n作用：仅 range_dispatch，property 数值乘以该倍数后再查阈值。', type: 'number', value: num(group.imda_scale) || 1, condition: (r) => r.imda_type === 'range_dispatch' },
						imda_tint_type: { label: '纹理着色类型（tints[].type）', description: '语法："tints": [{"type": "<类型>"}]\n作用：染色来源类型（默认 custom_model_data）。\n可选：custom_model_data / constant / dye / potion / grass / team\n仅“纹理着色索引”非空时生效。', type: 'select', value: String(group.imda_tint_type == null ? 'custom_model_data' : (group.imda_tint_type === 'none' ? '' : group.imda_tint_type)), options: { '': '（不生成 tints）', custom_model_data: 'custom_model_data', constant: 'constant', dye: 'dye', potion: 'potion', grass: 'grass', team: 'team' }, description: '纹理着色来源类型；保存为键 imda_tint_type', condition: (r) => r.imda_type === 'model' || r.imda_type === 'composite' },
			imda_range_target: { label: 'compass target', type: 'select', value: String(group.imda_range_target || ''), options: { '': '（未设置）', lodestone: 'lodestone', none: 'none', spawn: 'spawn', recovery: 'recovery' }, description: '语法："target": "spawn"\n作用：compass 必填，指定指南针指向目标。', condition: (r) => r.imda_property === 'compass' },
			imda_range_source: { label: 'time source', type: 'select', value: String(group.imda_range_source || ''), options: { '': '（未设置）', daytime: 'daytime', random: 'random', moon_phase: 'moon_phase' }, description: '语法："source": "daytime"\n作用：time 必填，指定时间来源。', condition: (r) => r.imda_property === 'time' },
			imda_range_wobble: { label: 'wobble（摆动浮动）', type: 'checkbox', value: group.imda_range_wobble !== false, description: '默认 true；关闭后摆动立即平滑到正确值。', condition: (r) => r.imda_property === 'compass' || r.imda_property === 'time' },
			imda_range_normalize: { label: 'normalize（归一化）', type: 'checkbox', value: group.imda_range_normalize !== false, description: '默认 true：返回 0~1 进度而非原始值（count / damage）。', condition: (r) => r.imda_property === 'count' || r.imda_property === 'damage' },
			imda_range_period: { label: 'period（周期）', type: 'number', value: num(group.imda_range_period) || 1, description: '语法："period": 10.0\n作用：use_cycle 的取模周期（>0）。', condition: (r) => r.imda_property === 'use_cycle' },
			imda_range_remaining: { label: 'remaining（用剩余时间）', type: 'checkbox', value: group.imda_range_remaining === true, description: '默认 false；true 时使用剩余使用时间。', condition: (r) => r.imda_property === 'use_duration' },
			imda_align_center: { label: '导入时自动对齐到模型中点', type: 'checkbox', value: group.imda_align_center === true, description: '勾选后导入引用模型时，把模型包围盒中点移到 (8,8,8)，偏移写入本层 translation。', condition: (r) => r.imda_type === 'model' },
			imda_tint_index: { label: '纹理着色索引（tints[].index）', description: '语法："tints": [{"type": "custom_model_data", "index": 0, "default": 0}]\n作用：custom_model_data 的下标。\n留空：不输出 tints，模型不染色。', type: 'text', value: String(group.imda_tint_index == null ? '' : group.imda_tint_index), condition: (r) => (r.imda_type === 'model' || r.imda_type === 'composite') && r.imda_tint_type === 'custom_model_data' },
			imda_tint_value: { label: '纹理着色值（tints[].value / .default）', description: '语法：{"type": "constant", "value": -1} 或 {"type": "dye", "default": -1}\n作用：constant 填 ARGB 整数；\ndye / potion / team 可填默认颜色。', type: 'text', value: String(group.imda_tint_value == null ? '' : group.imda_tint_value), condition: (r) => (r.imda_type === 'model' || r.imda_type === 'composite') && ['constant', 'dye', 'potion', 'team'].indexOf(r.imda_tint_type) >= 0 },
		},
		onConfirm(result) {
			const selectedNow = selectedGroups();
			let targetsNow = selectedNow.length ? selectedNow.slice() : [group];
			if (selectedNow.length && selectedNow.indexOf(group) < 0) targetsNow = [group];
			if (targetsNow.indexOf(group) < 0) targetsNow.unshift(group);
			const warnGroups = String(result.imda_type || 'composite') !== 'model' ? targetsNow.filter(g => String(g.imda_type || '').replace(/^minecraft:/, '') === 'model' && (g.children || []).length > 0) : [];
			const applyChanges = (deleteGroups) => {
			const extraGroups = Array.isArray(deleteGroups) ? deleteGroups : [];
			try {
				const selected = selectedGroups();
				let targets = selected.length ? selected.slice() : [group];
				if (selected.length && selected.indexOf(group) < 0) targets = [group];
				if (targets.indexOf(group) < 0) targets.unshift(group);
				// 撤销范围必须覆盖“会一起被改动”的所有节点：目标分组 + 它们整棵子树 + 父分组。
				// 只快照目标分组本身（childless）是不够的：改类型时 syncBranchLabels 会给子分支加
				// `[n]` 前缀、sortBranchChildren 会重排，只快照目标分组会导致 Ctrl+Z 后子分支名字/顺序
				// 还原不了，看起来就像“属性编辑撤不掉”。outliner 负责结构/顺序，groups 负责名字/自定义
				// 属性，elements 负责方块着色（walkTint 会改 cube.faces[].tint）。
				const affected = [];
				const affectedCubes = [];
				const addAffected = (g) => { if (isGroup(g) && affected.indexOf(g) < 0) affected.push(g); };
				for (const t of targets) {
					for (const g of collectGroupSubtree(t)) addAffected(g);
					if (t.parent && isGroup(t.parent)) addAffected(t.parent);
				}
				for (const g of affected) for (const c of (g.children || [])) if (isCube(c) && affectedCubes.indexOf(c) < 0) affectedCubes.push(c);
				// “继续并删除”把删子元素和改属性合成同一条撤销记录
				Undo.initEdit({ outliner: true, groups: affected, elements: affectedCubes });
				for (const g of extraGroups) for (const child of (g.children || []).slice()) {
					try { if (typeof child.remove === 'function') child.remove(); } catch (e) { /* ignore */ }
				}
				const tintIndexOf = (g) => {
					const raw = String(g.imda_tints || '').trim();
					if (/^-?\d+$/.test(raw)) return Number(raw);
					try {
						const parsed = raw ? JSON.parse(raw) : null;
						if (Array.isArray(parsed) && parsed.length && typeof parsed[0].index === 'number') return parsed[0].index;
					} catch (e) { /* ignore */ }
					const index_text = String(g.imda_tint_index == null ? '' : g.imda_tint_index).trim();
					return /^-?\d+$/.test(index_text) ? Number(index_text) : undefined;
				};
				let tinted = 0, sortedCount = 0, relabeled = 0;
				const walkTint = (node, inherited) => {
					const own = tintIndexOf(node);
					const effective = (own !== undefined) ? own : inherited;
					for (const child of node.children || []) {
						if (isGroup(child)) {
							if (effective !== undefined && String(child.imda_type || '').replace(/^minecraft:/, '') === 'internal') {
								if (node.imda_tint_type !== undefined && node.imda_tint_type !== '') child.imda_tint_type = node.imda_tint_type;
								if (node.imda_tint_index !== undefined && String(node.imda_tint_index).trim() !== '') child.imda_tint_index = node.imda_tint_index;
								if (node.imda_tint_value !== undefined) child.imda_tint_value = node.imda_tint_value;
								if (node.imda_tints !== undefined) child.imda_tints = node.imda_tints;
							}
							walkTint(child, effective);
							continue;
						}
						if (!isCube(child)) continue;
						const faces = Object.values(child.faces || {});
						if (!faces.length) continue;
						
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
				Undo.finishEdit('修改分组映射属性', { outliner: true, groups: affected, elements: affectedCubes });
				simInvalidate();
				try { Canvas.updateAll(); } catch (e) { /* ignore */ }
				const modelRef = String(group.imda_model || '').trim();
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
				// 出错时务必结束当前撤销会话，否则会留下半截 current_save，令后续 Ctrl+Z 失效
				try { Undo.cancelEdit(); } catch (e) { /* ignore */ }
				Blockbench.showMessageBox({ title: '修改失败', message: String((error && error.message) || error), icon: 'error' });
			}
			};
			if (warnGroups.length) {
				Blockbench.showMessageBox({
					title: '引用模型将转换为其他类型',
					message: '以下引用模型分组将改为 ' + result.imda_type + '，其下属的 internal 分组与元素会被删除：\n' + warnGroups.map(g => labelOf(g)).join('、') + '\n\n继续？',
					buttons: ['取消', '继续并删除'], confirm: 1, cancel: 0,
				}, (button) => {
					if (button !== 1) return;
					applyChanges(warnGroups);
				});
				return;
			}
			applyChanges();
		},
	}).show();
}

/** 从分组创建模型：烘焙组内方块、写到资源包 models/item、分组改为引用并记录居中补偿 */
/** 在选中的分组（或根目录）里新建一个空复调用标签，之后用「编辑复调用标签」指定目标。
 *  Blockbench 的「添加元素」菜单是硬编码列表，插件无法往里插，只能由自己给一个入口。 */
function addEmptyCallTag() {
	if (!ensureCallTagType()) {
		Blockbench.showMessageBox({ title: '无法创建', message: '当前 Blockbench 版本不支持注册自定义元素类型。', icon: 'warning' });
		return;
	}
	const parent = pickTargetGroup() || (Group.first_selected || null);
	const origin = parent && Array.isArray(parent.origin) ? parent.origin.slice() : [8, 8, 8];
	const rotation = parent && Array.isArray(parent.rotation) ? parent.rotation.slice() : [0, 0, 0];
	try { Undo.initEdit({ outliner: true, elements: [] }); } catch (e) { /* ignore */ }
	let tag = null;
	try {
		tag = newCallTag({ name: '调用', position: origin, rotation, ignore_inherited_scale: true });
		if (tag) { addAndInit(tag, parent); try { tag.select(); } catch (e) { /* ignore */ } }
	} catch (error) { console.error('[装配] 创建复调用标签失败', error); }
	// 若父分组是分支容器（range_dispatch/condition/select），新建的复调用标签也要带序号前缀
	try { if (parent && isGroup(parent)) { sortBranchChildren(parent); syncBranchLabels(parent); } } catch (e) { /* ignore */ }
	try { Undo.finishEdit('添加复调用标签', { outliner: true, elements: tag ? [tag] : [] }); } catch (e) { /* ignore */ }
	try { Canvas.updateAll(); } catch (e) { /* ignore */ }
	try { Project.saved = false; } catch (e) { /* ignore */ }
	simInvalidate();
	if (tag) {
		Blockbench.showQuickMessage('已添加复调用标签，右键「编辑复调用标签…」指定目标', 4000);
		try { if (settings && settings.create_rename && settings.create_rename.value) tag.rename(); } catch (e) { /* ignore */ }
	}
}

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
	// 新建的 Locator 必须进 finish 的 elements，否则撤销时 Blockbench 只会把 outliner 还原，
	// 不认识的节点会被丢回根目录而不是删除（表现为“只撤销了移动，标签还在”）。
	const createdLocators = [];
	for (const group of groups) {
		try {
			const locator = newCallTag({ name: '调用 ' + labelOf(group), position: (group.origin || [0, 0, 0]).slice(), rotation: (group.rotation || [0, 0, 0]).slice(), ignore_inherited_scale: true });
			if (!locator) continue;
			if (group.parent) locator.addTo(group.parent); else locator.addTo();
			try { locator.init(); } catch (e) { /* ignore */ }
			locator.imda_call_target = group.uuid;
			createdLocators.push(locator);
			created++;
		} catch (error) { console.error('[装配] 创建复调用标签失败', error); }
	}
	// 若目标父级是分支容器（range_dispatch/condition/select），新建的复调用标签要带序号前缀
	try {
		const parents = [];
		for (const loc of createdLocators) { const p = loc && loc.parent; if (p && isGroup(p) && parents.indexOf(p) < 0) parents.push(p); }
		for (const p of parents) { sortBranchChildren(p); syncBranchLabels(p); }
	} catch (e) { /* ignore */ }
	try { Undo.finishEdit('复调用选中的分组', { outliner: true, elements: createdLocators }); } catch (e) { /* ignore */ }
	try { Canvas.updateAll(); } catch (e) { /* ignore */ }
	try { Project.saved = false; } catch (e) { /* ignore */ }
	simInvalidate();
	Blockbench.showQuickMessage('已创建 ' + created + ' 个复调用标签', 3000);
}

/** 属性前缀迁移：imda_* → imda_*（默认复制，可选删除旧键） */
/** 把所有 composite 分组的直属 cube 收进 inline 子分组，等价于导出时的内联模型 */
function scanInvalidInternalGroups() {
	const invalid = [];
	const walk = (nodes, parent) => {
		for (const node of (nodes || [])) {
			if (!isGroup(node)) continue;
			const type = String(node.imda_type || '').replace(/^minecraft:/, '');
			if (type === 'internal') {
				const parentType = String(parent && parent.imda_type || '').replace(/^minecraft:/, '');
				if (!parent || (parentType !== 'internal' && parentType !== 'model')) { invalid.push(node); continue; }
			}
			walk(node.children, node);
		}
	};
	walk((typeof Outliner !== 'undefined' && Outliner) ? Outliner.root : [], null);
	const cubes = [];
	const collect = (node) => { for (const child of (node.children || [])) { if (isCube(child)) cubes.push(child); else if (isGroup(child)) collect(child); } };
	for (const group of invalid) collect(group);
	return { groups: invalid, cubes };
}

function removeInvalidInternalGroups(options) {
	const scan = scanInvalidInternalGroups();
	const invalid = scan.groups;
	if (!invalid.length) return 0;
	const ownUndo = !(options && options.noUndo);
	if (ownUndo) { try { Undo.initEdit({ outliner: true, groups: invalid, elements: scan.cubes }); } catch (e) { /* ignore */ } }
	for (const group of invalid) {
		try { if (typeof group.remove === 'function') group.remove(); else if (group.parent && Array.isArray(group.parent.children)) group.parent.children.splice(group.parent.children.indexOf(group), 1); } catch (e) { /* ignore */ }
	}
	if (ownUndo) { try { Undo.finishEdit('删除无效 internal 分组', { outliner: true, groups: invalid, elements: scan.cubes }); } catch (e) { /* ignore */ } }
	return invalid.length;
}

function normalizeCompositeCubes() {
	// 「删除无效 internal」「cube 收进 inline」「刷新序号与分组名」合成同一个撤销会话，
	// 否则一次“规范化”要按好几次 Ctrl+Z 才能完全回退。
	const invalidScan = scanInvalidInternalGroups();
	const invalidSet = new Set(invalidScan.groups);
	const insideInvalid = (node) => {
		let p = node && node.parent;
		while (p) { if (invalidSet.has(p)) return true; p = p.parent; }
		return false;
	};
	const groups = (typeof Group !== 'undefined' && Group.all) ? Group.all.slice() : [];
	const targets = groups.filter(group => group && !invalidSet.has(group) && !insideInvalid(group) && (group.imda_type === undefined || group.imda_type === '' || group.imda_type === 'composite'));
	const removedInternal = invalidScan.groups.length;
	let moved = 0;
	const created = [];
	const changed = [];
	try { Undo.initEdit({ outliner: true, groups: targets.slice().concat(invalidScan.groups), elements: invalidScan.cubes }); } catch (e) { /* ignore */ }
	for (const group of invalidScan.groups) {
		try { if (typeof group.remove === 'function') group.remove(); else if (group.parent && Array.isArray(group.parent.children)) group.parent.children.splice(group.parent.children.indexOf(group), 1); } catch (e) { /* ignore */ }
	}
	for (const group of targets) {
		const cubes = (group.children || []).filter(c => isCube(c));
		if (!cubes.length) continue;
		const inline = new Group({ name: labelOf(group) + ' [inline]', imda_type: 'inline', origin: [8, 8, 8], rotation: [0, 0, 0] });
		addAndInit(inline, group);
		try { if (typeof inline.createUniqueName === 'function') inline.createUniqueName(); } catch (e) { /* ignore */ }
		for (const cube of cubes) {
			try { cube.addTo(inline); moved++; } catch (error) { console.warn('[装配] 移动 cube 到 inline 失败', error); }
		}
		created.push(inline);
		changed.push(group);
	}
	// 3. 按父级「分支编号格式」重算 threshold（序号）、刷新 [x] 名字前缀、规范分组名格式。
	//    必须在 cube 收进 inline 之后跑：此时名字本体已经定型，[inline] 后缀才不会被误当分支前缀。
	let nameStats = { renamed: 0, numbered: 0 };
	try { nameStats = normalizeGroupNumbersAndNames(); } catch (error) { console.warn('[装配] 刷新序号/名称失败', error); }
	try { Undo.finishEdit('规范化结构', { outliner: true, groups: groups.filter(g => g && !invalidSet.has(g)).concat(created), elements: [] }); } catch (e) { /* ignore */ }
	try { Canvas.updateAll(); } catch (e) { /* ignore */ }
	try { Project.saved = false; } catch (e) { /* ignore */ }
	try { simInvalidate(); } catch (e) { /* ignore */ }
	const parts = [];
	if (removedInternal) parts.push('删除 ' + removedInternal + ' 个无效 internal 分组');
	if (created.length) parts.push(changed.length + ' 个 composite，移动 ' + moved + ' 个 cube 到 ' + created.length + ' 个 inline 分组');
	parts.push('刷新 ' + nameStats.renamed + ' 个分组名，重算 ' + nameStats.numbered + ' 个分支序号');
	Blockbench.showQuickMessage('规范化完成：' + parts.join('；'), 4500);
	return created.length;
}

function openNormalizeDialog() {
	Blockbench.showMessageBox({
		title: '规范化结构',
		message: '1. 删除父级不是 internal/model 的 internal 分组；\n2. 把每个 composite 分组的直属 cube 收进一个 inline 子分组（等价于导出时的内联模型）；\n3. 按父级的「分支编号格式」重算各分支的 threshold（序号）并刷新名字前缀 [x]；\n4. 规范分组名称格式（多余空白、重复的 [inline] 后缀）。\n不会改变位置/旋转，也不会重排分支顺序，可一次撤销。',
		buttons: ['取消', '规范化'], confirm: 1, cancel: 0,
	}, (button) => { if (button === 1) { try { normalizeCompositeCubes(); } catch (error) { Blockbench.showMessageBox({ title: '规范化失败', message: String((error && error.message) || error), icon: 'error' }); } } });
}

/** 按大纲顺序排列选中分组 */
function orderedSelectedGroups() {
	const selected = new Set(selectedGroups());
	const ordered = [];
	const walk = (nodes) => {
		for (const node of (nodes || [])) {
			if (!isGroup(node) || node.export === false) continue;
			if (selected.has(node)) ordered.push(node);
			walk(node.children);
		}
	};
	walk((typeof Outliner !== 'undefined' && Outliner) ? Outliner.root : []);
	return ordered;
}

/** 序列节点覆盖的分组数量：递减 N…1，递增 1…N */
function orderedSequenceItems() {
	const selected = new Set();
	// Blockbench 的分组选中在 Group.multi_selected / Group.selected，不在 Outliner.selected；
	// 只选分组时原来会得到 0 项，误报“选中数量不够”。
	try { for (const node of selectedGroups()) selected.add(node); } catch (e) { /* ignore */ }
	try { if (typeof Group !== 'undefined' && Group.first_selected && isGroup(Group.first_selected)) selected.add(Group.first_selected); } catch (e) { /* ignore */ }
	try { for (const node of (Outliner.selected || [])) { if (node && (isGroup(node) || (isLocator(node) && String(node.imda_call_target || '').trim()))) selected.add(node); } } catch (e) { /* ignore */ }
	const ordered = [];
	const walk = (nodes) => {
		for (const node of (nodes || [])) {
			if (selected.has(node)) ordered.push(node);
			if (isGroup(node)) walk(node.children);
		}
	};
	walk((typeof Outliner !== 'undefined' && Outliner) ? Outliner.root : []);
	// 只选了复调用标签时，把它们的共同目标分组补成本体项，保证满数量节点里有真实分组
	if (ordered.length && !ordered.some(isGroup) && ordered.every(isLocator)) {
		const targets = ordered.map(l => String(l.imda_call_target || '').trim()).filter(Boolean);
		if (targets.length === ordered.length && targets.every(t => t === targets[0])) {
			const targetGroup = ((typeof Group !== 'undefined' && Group.all) ? Group.all : []).find(g => g && g.uuid === targets[0]);
			if (targetGroup) ordered.unshift(targetGroup);
		}
	}
	return ordered;
}

function sequenceCounts(total, step, direction) {
	const counts = [];
	step = Math.max(1, Math.floor(num(step) || 1));
	if (String(direction) === 'increase') {
		for (let count = 1; count <= total; count += step) counts.push(count);
		if (counts[counts.length - 1] !== total) counts.push(total);
	} else {
		for (let count = total; count >= 1; count -= step) counts.push(count);
		if (counts[counts.length - 1] !== 1) counts.push(1);
	}
	return counts;
}

/** 序列生成器用的阈值格式解析：直接复用属性面板那套 evalThreshold，保证两边完全一致。
 *  vars = 格式变量 f / s（生成时容器刚建好、子项还没填进去，由调用方按预期结构算）。 */
function sequenceFormatValue(format, index, vars) {
	try {
		const exporter = createExporter();
		return exporter.evalThreshold(format, index, undefined, vars);
	} catch (e) { return null; }
}

/** 序列生成器：把对话框里「子节点」的选项整理成可传给 assignGroupMapProps 的 imda_* 结果对象。
 *  子节点类型可以与容器不同，选了分支总控（range_dispatch / condition / select）后其对应子选项才生效。 */
function buildSequenceChildResult(options) {
	options = options || {};
	const type = String(options.childType || 'composite').replace(/^minecraft:/, '');
	const result = { imda_type: type };
	const isBranch = (type === 'range_dispatch' || type === 'condition' || type === 'select');
	const prop = String(options.childProperty == null ? '' : options.childProperty).replace(/^minecraft:/, '').trim();
	if (isBranch) {
		result.imda_property = prop;
		if (type === 'range_dispatch') {
			if (options.childIndex !== undefined) result.imda_index = num(options.childIndex);
			if (options.childThresholdFormat !== undefined) result.imda_threshold_format = String(options.childThresholdFormat == null ? '' : options.childThresholdFormat).trim();
			if (options.childScale !== undefined) result.imda_scale = num(options.childScale) || 1;
		}
		if (prop === 'compass' && options.childRangeTarget !== undefined) result.imda_range_target = options.childRangeTarget;
		if (prop === 'time' && options.childRangeSource !== undefined) result.imda_range_source = options.childRangeSource;
		if ((prop === 'compass' || prop === 'time') && options.childRangeWobble !== undefined) result.imda_range_wobble = !!options.childRangeWobble;
		if ((prop === 'count' || prop === 'damage') && options.childRangeNormalize !== undefined) result.imda_range_normalize = !!options.childRangeNormalize;
		if (prop === 'use_cycle' && options.childRangePeriod !== undefined) result.imda_range_period = num(options.childRangePeriod) || 1;
		if (prop === 'use_duration' && options.childRangeRemaining !== undefined) result.imda_range_remaining = !!options.childRangeRemaining;
	}
	// on_true/on_false 只在「子节点的父级（即容器）是 condition」时有意义
	if (String(options.nodeType || 'range_dispatch') === 'condition' && options.childCondition !== undefined) {
		result.imda_condition = options.childCondition;
	}
	return result;
}

/** 生成复调用序列：满节点放本体，其余节点用 a1…ak 的复调用 */
function generateCallSequence(options) {
	options = options || {};
	const items = orderedSequenceItems();
	if (items.length < 2) { Blockbench.showMessageBox({ title: '项目不足', message: '按顺序选中至少 2 个分组或复调用 Locator（a1…aN）。普通定位点不参与。', icon: 'info' }); return; }
	if (typeof Locator === 'undefined') { Blockbench.showMessageBox({ title: '不支持定位点', message: '当前 Blockbench 没有 Locator。', icon: 'warning' }); return; }
	const total = items.length;
	const countStep = Math.max(1, Math.floor(num(options.countStep) || 1));
	const direction = String(options.direction || 'decrease') === 'increase' ? 'increase' : 'decrease';
	const type = String(options.nodeType || 'range_dispatch') === 'composite' ? 'composite' : 'range_dispatch';
	const counts = sequenceCounts(total, countStep, direction);
	const parent = items[0].parent || null;
	const allSameParent = items.every(g => (g.parent || null) === parent);
	const sequenceName = String(options.name || '').trim() || '[sequence]';
	// imda_property 全程存「不带 minecraft: 前缀」的裸名（属性面板 select 的选项值也是裸名）。
	// 以前这里存 'minecraft:custom_model_data'，属性面板认不出选项、回落到「（未设置）」，
	// 看上去就是「property 没应用」，compass / count 这些条件字段也全都不显示。
	const property = String(options.property || 'custom_model_data').replace(/^minecraft:/, '').trim() || 'custom_model_data';
	const thresholdFormat = String(options.thresholdFormat == null ? '' : options.thresholdFormat).trim();
	const index = num(options.index);
	const thresholdStart = num(options.thresholdStart);
	const thresholdStep = num(options.thresholdStep);
	// 子节点（每个 #分支）自身的映射属性：类型可选，分支总控类型会有对应子选项
	const childResult = buildSequenceChildResult(options);
	const groupsMoved = items.filter(isGroup);
	try { Undo.initEdit({ outliner: true, groups: groupsMoved, elements: items.filter(isLocator) }); } catch (e) { /* ignore */ }
	const container = new Group({ name: sequenceName, imda_type: type, origin: [8, 8, 8], rotation: [0, 0, 0] });
	if (type === 'range_dispatch') {
		container.imda_property = property;
		container.imda_index = index;
		container.imda_threshold_format = thresholdFormat;
	}
	addAndInit(container, parent);
	// 容器此时已挂进大纲，f 能正确数到「同层元素（含自身）」；
	// s 要按「即将生成的子项数」算——此刻 children 还是空的，不能直接数。
	const containerF = thresholdFormatVars(container).f;
	const containerVars = { f: containerF, s: counts.length };
	const generatedGroups = [container];
	const generatedLocators = [];
	let created = 0;
	for (let i = 0; i < counts.length; i++) {
		const count = counts[i];
		const isBody = count === total;
		const node = new Group({ name: sequenceName + ' #' + count, origin: [8, 8, 8], rotation: [0, 0, 0] });
		// 先把「子节点类型/属性」应用上去（assignGroupMapProps 会 set imda_type + 清空不适用的字段）
		assignGroupMapProps(node, childResult);
		generatedGroups.push(node);
		if (type === 'range_dispatch') {
			// 与属性面板同一个解析器：格式优先，留空才退回 起点 + i × 步长
			const formatted = thresholdFormat ? sequenceFormatValue(thresholdFormat, i, containerVars) : null;
			node.imda_threshold = formatted !== null ? formatted : (thresholdStart + i * thresholdStep);
			if (thresholdFormat && formatted === null) console.warn('[装配] 无法解析分支编号格式：' + thresholdFormat + '，已回退到起点/步长');
		}
		addAndInit(node, container);
		if (isBody) {
			for (const item of items) { try { item.addTo(node); } catch (e) { /* ignore */ } }
			continue;
		}
		for (const item of items.slice(0, count)) {
			try {
				const sourceGroup = isGroup(item) ? item : null;
				const position = sourceGroup ? (sourceGroup.origin || [0, 0, 0]).slice() : (Array.isArray(item.position) ? item.position.slice() : [0, 0, 0]);
				const rotation = sourceGroup ? (sourceGroup.rotation || [0, 0, 0]).slice() : (Array.isArray(item.rotation) ? item.rotation.slice() : [0, 0, 0]);
				const targetGroup = sourceGroup || (((typeof Group !== 'undefined' && Group.all) ? Group.all : []).find(g => g && g.uuid === String(item.imda_call_target || '').trim()) || null);
				const locator = newCallTag({ name: sourceGroup ? ('调用 ' + labelOf(sourceGroup)) : (item.name || ('调用 ' + labelOf(item))), position, rotation, ignore_inherited_scale: true });
				if (!locator) continue;
				addAndInit(locator, node);
				generatedLocators.push(locator);
				locator.imda_call_target = targetGroup ? targetGroup.uuid : String(item.imda_call_target || '').trim();
				created++;
			} catch (error) { console.warn('[装配] 创建序列复调用失败', error); }
		}
	}
	// 更新「大纲格式」：按容器类型刷新子分支名字前缀（range_dispatch → [阈值]、condition → [on_true]、select → [when]），
	// 并在必要时按阈值重排分支。放在 finishEdit 之前，改名/重排才会进撤销记录。
	try { sortBranchChildren(container); } catch (e) { /* ignore */ }
	try { syncBranchLabels(container); } catch (e) { /* ignore */ }
	try { Undo.finishEdit('生成复调用序列', { outliner: true, groups: groupsMoved.concat(generatedGroups), elements: generatedLocators }); } catch (e) { /* ignore */ }
	try { Canvas.updateAll(); } catch (e) { /* ignore */ }
	// 让 outliner 面板立即重绘：程序化新增节点不一定触发 Vue 响应式更新
	try {
		const vue = (typeof Panels !== 'undefined' && Panels.outliner && Panels.outliner.inside_vue) ? Panels.outliner.inside_vue : null;
		if (vue && typeof vue.$forceUpdate === 'function') vue.$forceUpdate();
	} catch (e) { /* ignore */ }
	try { Project.saved = false; } catch (e) { /* ignore */ }
	try { simInvalidate(); } catch (e) { /* ignore */ }
	if (!allSameParent) console.warn('[装配] 序列项父级不同，容器放在第一项的父级下。');
	Blockbench.showQuickMessage('已生成 ' + sequenceName + '（' + direction + '）：' + counts.length + ' 个节点，' + created + ' 个复调用', 4000);
}


function openSequenceDialog() {
	
	if (orderedSequenceItems().length < 2) { Blockbench.showMessageBox({ title: '项目不足', message: '先在 outliner 里按顺序选中至少 2 个分组或复调用 Locator，再生成复调用序列。', icon: 'info' }); return; }
	new Dialog({
		id: 'imda_sequence',
		title: '生成复调用序列',
		width: 560,
		form: {
			name: { label: '容器名称', type: 'text', value: '[sequence]' },
			direction: { label: '方向', type: 'select', value: 'decrease', options: { decrease: '递减（aN…a1）', increase: '递增（a1…aN）' } },
			nodeType: { label: '容器节点类型', type: 'select', value: 'range_dispatch', options: { range_dispatch: 'range_dispatch', composite: 'composite' } },
			countStep: { label: '每次递增/递减的分组数（步长）', type: 'number', value: 1, step: 1, min: 1, max: 64 },
			_: '_',
			property: { label: '容器 range_dispatch 来源（property）', type: 'select', value: 'custom_model_data', options: { custom_model_data: 'custom_model_data', cooldown: 'cooldown', count: 'count', damage: 'damage', time: 'time', use_cycle: 'use_cycle', use_duration: 'use_duration', compass: 'compass' }, condition: (r) => r.nodeType === 'range_dispatch' },
			index: { label: '容器 custom_model_data index', type: 'number', value: 0, condition: (r) => r.nodeType === 'range_dispatch' },
			thresholdFormat: { label: '容器分支编号格式（同属性面板）', type: 'text', value: '', description: '语法与分组属性里的「分支编号格式」完全一致：i → 0,1,2；2i → 0,2,4；10+2i → 10,12,14；0,1,3 → 字面列表；2:2i → 重复 2 次；ni → 0,n,2n；f → 本容器所在层级的元素数（含自身）；s → 本容器自身的子项数（不递归）。\n填了格式时它优先于下面的起点/步长（格式里也支持用 i 当序号、n 当上层编号）。', condition: (r) => r.nodeType === 'range_dispatch' },
			thresholdStart: { label: '容器阈值起点（未填格式时）', type: 'number', value: 0, condition: (r) => r.nodeType === 'range_dispatch' },
			thresholdStep: { label: '容器阈值步长（未填格式时）', type: 'number', value: 1, step: 1, min: -100, max: 100, condition: (r) => r.nodeType === 'range_dispatch' },
			__child: '_',
			childType: { label: '子节点类型（每个 #分支）', type: 'select', value: 'composite', options: { composite: 'composite', inline: 'inline（内联模型）', model: 'model（引用模型）', internal: 'internal（内部结构）', range_dispatch: 'range_dispatch', condition: 'condition', select: 'select', empty: 'empty' }, description: '生成的每个 #分支 子分组使用的映射类型。选 range_dispatch / condition / select 这类分支总控后，下面会出现对应子选项。默认 composite。' },
			childProperty: { label: '子节点 property（分支总控）', type: 'select', value: '', options: { '': '（未设置）', selected: 'selected', broken: 'broken', damaged: 'damaged', carried: 'carried', custom_model_data: 'custom_model_data', has_component: 'has_component', component: 'component', keybind_down: 'keybind_down', compass: 'compass（range）', count: 'count（range）', damage: 'damage（range）', time: 'time（range）', use_cycle: 'use_cycle（range）', use_duration: 'use_duration（range）', 'bundle/fullness': 'bundle/fullness（range）', cooldown: 'cooldown（range）', 'crossbow/pull': 'crossbow/pull（range）', context_dimension: 'context_dimension（select）', block_state: 'block_state（select）', local_time: 'local_time（select）' }, condition: (r) => ['range_dispatch', 'condition', 'select'].indexOf(r.childType) >= 0, description: '子节点的 property / 谓词；range_dispatch、condition、select 生效。' },
			childIndex: { label: '子节点 index（range_dispatch）', type: 'number', value: 0, condition: (r) => r.childType === 'range_dispatch' },
			childThresholdFormat: { label: '子节点分支编号格式（其自身 entries）', type: 'text', value: '', condition: (r) => r.childType === 'range_dispatch', description: '子节点自身是 range_dispatch 时，它给自己的子分支用的编号格式（语法同属性面板）；一般留空。' },
			childScale: { label: '子节点 scale（range_dispatch）', type: 'number', value: 1, condition: (r) => r.childType === 'range_dispatch' },
			childCondition: { label: '子节点分支条件（on_true / on_false）', type: 'select', value: '', options: { '': '（按位置）', on_true: 'on_true', on_false: 'on_false' }, condition: (r) => r.nodeType === 'condition', description: '仅当容器是 condition 时，子节点按 on_true/on_false 占位。' },
			childRangeTarget: { label: '子节点 compass target', type: 'select', value: '', options: { '': '（未设置）', lodestone: 'lodestone', none: 'none', spawn: 'spawn', recovery: 'recovery' }, condition: (r) => r.childProperty === 'compass' },
			childRangeSource: { label: '子节点 time source', type: 'select', value: '', options: { '': '（未设置）', daytime: 'daytime', random: 'random', moon_phase: 'moon_phase' }, condition: (r) => r.childProperty === 'time' },
			childRangeWobble: { label: '子节点 wobble（摆动）', type: 'checkbox', value: true, condition: (r) => r.childProperty === 'compass' || r.childProperty === 'time' },
			childRangeNormalize: { label: '子节点 normalize（归一化）', type: 'checkbox', value: true, condition: (r) => r.childProperty === 'count' || r.childProperty === 'damage' },
			childRangePeriod: { label: '子节点 period（use_cycle）', type: 'number', value: 1, condition: (r) => r.childProperty === 'use_cycle' },
			childRangeRemaining: { label: '子节点 remaining（use_duration）', type: 'checkbox', value: false, condition: (r) => r.childProperty === 'use_duration' },
			info: { type: 'info', text: '容器：range_dispatch 用 property/index + 分支编号格式（或 起点 + i × 步长）算各 #分支 的 threshold；composite 时忽略这些。\n子节点：每个 #分支 子分组按「子节点类型」生成，选分支总控类型时其对应子选项才生效。满节点只放一次本体。' },
		},
		onConfirm(result) { generateCallSequence(result); },
	}).show();
}

/** 移除项目里所有 range_dispatch(timeline) 分组及其帧标签 */
function removeTimelineTags() {
	const groups = ((typeof Outliner !== 'undefined' && Outliner && Outliner.root) ? Outliner.root : []).filter(node => isGroup(node) && String(node.imda_type || '') === 'range_dispatch_timeline');
	if (!groups.length) { Blockbench.showQuickMessage('没有动画时间线复调用标签。', 2500); return; }
	try { Undo.initEdit({ outliner: true, groups, elements: [] }); } catch (e) { /* ignore */ }
	for (const group of groups) { try { group.remove(); } catch (e) { /* ignore */ } }
	try { Undo.finishEdit('移除动画时间线复调用标签'); } catch (e) { /* ignore */ }
	try { Canvas.updateAll(); } catch (e) { /* ignore */ }
	try { Project.saved = false; } catch (e) { /* ignore */ }
	Blockbench.showQuickMessage('已移除 ' + groups.length + ' 个时间线标签分组', 3000);
}

/** 把所有复调用 Locator 实例化成真实的分组/模型节点 */
function applyCallOverridesToGroup(group, locator) {
	if (!group || !locator) return;
	try {
		const ov = callOverridesOf(locator);
		group.imda_threshold_force = false;
		if (ov.property) group.imda_property = String(ov.property).replace(/^minecraft:/, '');
		for (const key of ['index', 'scale', 'threshold', 'threshold_format', 'component', 'predicate', 'value', 'keybind', 'target', 'source', 'wobble', 'normalize', 'period', 'remaining', 'condition', 'ignore_default']) {
			if (ov[key] === undefined || ov[key] === '') continue;
			const prop = ({ threshold: 'imda_threshold', threshold_format: 'imda_threshold_format', target: 'imda_range_target', source: 'imda_range_source', wobble: 'imda_range_wobble', normalize: 'imda_range_normalize', period: 'imda_range_period', remaining: 'imda_range_remaining', ignore_default: 'imda_ignore_default' })[key] || ('imda_' + key);
			if (['wobble', 'normalize', 'remaining', 'ignore_default'].includes(key)) group[prop] = ov[key] === 'true';
			else group[prop] = ov[key];
		}
		if (ov.threshold !== undefined && ov.threshold !== '') group.imda_threshold_force = true;
	} catch (e) { /* ignore */ }
}

function instantiateCallTags(targets) {
	const locators = [];
	if (Array.isArray(targets)) {
		for (const node of targets) if (isLocator(node) && String(node.imda_call_target || '').trim() && locators.indexOf(node) < 0) locators.push(node);
	} else {
		const walk = (nodes) => { for (const node of (nodes || [])) { if (isLocator(node) && String(node.imda_call_target || '').trim()) locators.push(node); else if (isGroup(node)) walk(node.children); } };
		walk((typeof Outliner !== 'undefined' && Outliner) ? Outliner.root : []);
	}
	if (!locators.length) { Blockbench.showQuickMessage('没有复调用标签。', 2500); return; }
	Blockbench.showMessageBox({
		title: '实例化复调用标签',
		message: '将把 ' + locators.length + ' 个复调用标签替换为真实分组/模型节点（可撤销）。',
		buttons: ['实例化', '取消'], confirm: 0, cancel: 1,
	}, (button) => {
		if (button !== 0) return;
		const parentGroups = [];
		for (const locator of locators) {
			const parent = locator.parent;
			if (isGroup(parent) && parentGroups.indexOf(parent) < 0) parentGroups.push(parent);
		}
		let undo = null;
		try { undo = (Blockbench.Project && Blockbench.Project.undo) || (typeof Undo !== 'undefined' ? Undo : null); } catch (e) { undo = null; }
		// 删除的 Locator 只进 init；新建的分组/方块只进 finish。
		const initAspects = { outliner: true, groups: parentGroups.slice(), elements: locators.slice() };
		try { if (undo) undo.initEdit(initAspects); } catch (e) { console.warn('[装配] 实例化 initEdit 失败', e); }
		let done = 0;
		const createdGroups = [];
		const createdCubes = [];
		const collectGroups = (node) => { for (const child of (node.children || [])) { if (isGroup(child)) { createdGroups.push(child); collectGroups(child); } } };
		const collectCubes = (node) => { for (const child of (node.children || [])) { if (isGroup(child)) collectCubes(child); else createdCubes.push(child); } };
		for (const locator of locators) {
			try {
				const target = String(locator.imda_call_target || '').trim();
				const groups = (typeof Group !== 'undefined' && Group.all) ? Group.all : [];
				const targetGroup = groups.find(g => g && g.uuid === target);
				const parent = locator.parent || null;
				const siblings = parent && Array.isArray(parent.children) ? parent.children : ((typeof Outliner !== 'undefined' && Outliner && Array.isArray(Outliner.root)) ? Outliner.root : []);
				const index = siblings.indexOf(locator);
				let created = null;
				if (targetGroup) {
					created = (typeof targetGroup.duplicate === 'function') ? targetGroup.duplicate() : ((typeof targetGroup.clone === 'function') ? targetGroup.clone() : null);
					if (created) {
						const oldOrigin = Array.isArray(created.origin) ? created.origin.slice() : [0, 0, 0];
						const nextOrigin = Array.isArray(locator.position) ? locator.position.slice() : oldOrigin;
						created.name = locator.name || (labelOf(targetGroup) + ' 实例');
						try { translateGroupCoordinates(created, [nextOrigin[0] - oldOrigin[0], nextOrigin[1] - oldOrigin[1], nextOrigin[2] - oldOrigin[2]]); } catch (e) { /* ignore */ }
						created.origin = nextOrigin;
						created.rotation = Array.isArray(locator.rotation) ? locator.rotation.slice() : (created.rotation || [0, 0, 0]);
						created.selected = false;
					}
				} else if (target) {
					created = new Group({ name: '实例 ' + target.split(':').pop(), imda_type: 'model', imda_model: target, origin: (locator.position || [0, 0, 0]).slice(), rotation: (locator.rotation || [0, 0, 0]).slice() });
				}
				if (!created) continue;
				if (parent) created.addTo(parent); else created.addTo();
				// duplicate() 内部已经 init 过；重复 init 会把同一个 Group 再 push 进 Project.groups。
				if (!targetGroup) { try { created.init(); } catch (e) { /* ignore */ } }
				try { if (created.preview_controller && created.preview_controller.updateTransform) created.preview_controller.updateTransform(created); } catch (e) { /* ignore */ }
				applyCallOverridesToGroup(created, locator);
				// 复调用源分组通常 export=false（`复调用选中的分组` 会把源分组标记为不直接导出，
				// 只由标签引用）。实例化出来的副本必须重新参与导出，否则整条分支在导出里直接消失
				// ——真实工程 bone7 的 5 个分支全是这种情况，导出 JSON 里连 bone7 节点都没有。
				let reEnabled = 0;
				if (created.export === false) { created.export = true; reEnabled++; }
				const enableExportDeep = (node) => {
					for (const child of (node.children || [])) {
						if (!isGroup(child)) continue;
						if (child.export === false) { child.export = true; reEnabled++; }
						enableExportDeep(child);
					}
				};
				enableExportDeep(created);
				if (reEnabled) { try { console.log('[装配] 实例化恢复导出', reEnabled, '个节点'); } catch (e) { /* ignore */ } }
				try { console.log('[装配] 实例化覆盖', locator.name || 'Locator', JSON.stringify(callOverridesOf(locator)), '→ fmt=' + String(created.imda_threshold_format || '') + ' th=' + String(created.imda_threshold)); } catch (e) { /* ignore */ }
				if (index >= 0) { const at = siblings.indexOf(created); if (at >= 0) siblings.splice(at, 1); siblings.splice(Math.min(index, siblings.length), 0, created); }
				createdGroups.push(created);
				collectGroups(created);
				collectCubes(created);
				try { locator.remove(); } catch (e) { /* ignore */ }
				done++;
			} catch (error) { console.warn('[装配] 实例化复调用失败', error); }
		}
		const finishAspects = { outliner: true, groups: parentGroups.concat(createdGroups), elements: createdCubes };
		// 实例化把 call 标签换成真实分组后，父容器里各分支的「位置」才最终确定。
		// 先按阈值重排、再刷新编号——否则每个实例化出来的分支会用「它暂时排在末尾」时的
		// n 去算阈值（实测 [2] sac_slots #3 里 full 依次得到 4,3,2，而不是 3,2,1）。
		for (const parent of parentGroups) {
			try { sortBranchChildren(parent); } catch (e) { /* ignore */ }
			try { syncBranchLabels(parent); } catch (e) { /* ignore */ }
		}
		for (const group of createdGroups) { try { syncBranchLabels(group); } catch (e) { /* ignore */ } }
		try { undo && undo.finishEdit('实例化复调用标签', finishAspects); } catch (e) { console.warn('[装配] 实例化 finishEdit 失败', e); }
		try { console.log('[装配] 实例化撤销记录', undo.history.length, undo.index, (undo.history[undo.history.length - 1] || {}).action); } catch (e) { /* ignore */ }
		try { Canvas.updateAll(); } catch (e) { /* ignore */ }
		try { Project.saved = false; } catch (e) { /* ignore */ }
		Blockbench.showQuickMessage('已实例化 ' + done + ' 个复调用标签', 3000);
	});
}

/** 收集所有分组（Outliner 顺序，深度优先）。 */
function collectAllGroups() {
	const out = [];
	const walk = (nodes) => { for (const node of (nodes || [])) { if (!isGroup(node)) continue; out.push(node); walk(node.children); } };
	try { walk((typeof Outliner !== 'undefined' && Outliner) ? Outliner.root : []); } catch (e) { /* ignore */ }
	return out;
}

/** 从一个分组出发收集它和它的所有后代分组。 */
function collectGroupSubtree(group) {
	const out = [];
	const walk = (g) => { if (!isGroup(g)) return; out.push(g); for (const c of (g.children || [])) if (isGroup(c)) walk(c); };
	walk(group);
	return out;
}

/** 只保留“最外层”的选中分组：若某被选分组的祖先也被选中，它会被祖先一并删除，跳过。 */
function outermostSelectedGroups(groups) {
	const selected = new Set(groups);
	return groups.filter(group => {
		let p = group && group.parent;
		while (p && isGroup(p)) { if (selected.has(p)) return false; p = p.parent; }
		return true;
	});
}

/** 核心：把 groups 原位替换为指向 targetGroup 的调用标签（调用前已确保 targetGroup 不在删除集合里）。
 *  每个标签保留原分组自身的位姿（origin + rotation），原分组连同几何被删除。
 *  返回 { converted, locators }。 */
function applyConvertGroupsToCallTags(groups, targetGroup) {
	const locators = [];
	let converted = 0;
	if (!targetGroup) return { converted, locators };
	for (const group of groups) {
		try {
			const parent = group.parent && isGroup(group.parent) ? group.parent : null;
			const siblings = parent ? parent.children : ((typeof Outliner !== 'undefined' && Outliner) ? Outliner.root : []);
			const at = siblings.indexOf(group);
			const locator = newCallTag({ name: '调用 ' + labelOf(targetGroup), position: (group.origin || [0, 0, 0]).slice(), rotation: (group.rotation || [0, 0, 0]).slice(), ignore_inherited_scale: true, target: targetGroup.uuid });
			if (!locator) continue;
			addAndInit(locator, parent);
			// CallTag.init() 会把“根级标签”塞进 Group.first_selected，而那个分组正是我们马上要删的。
			// 这里强制拉回到目标父级（根级 → null），否则标签会跟着被删掉。
			const wantRoot = !parent;
			const isRoot = !locator.parent || locator.parent === 'root';
			if (wantRoot !== isRoot) { try { locator.addTo(parent); } catch (e) { /* ignore */ } }
			// 原位替换：把新标签挪到原分组所在的兄弟位次，再删掉原分组（保持大纲顺序）
			if (at >= 0) { const now = siblings.indexOf(locator); if (now >= 0) siblings.splice(now, 1); siblings.splice(Math.min(at, siblings.length), 0, locator); }
			locators.push(locator);
			try { group.remove(); } catch (e) { console.warn('[装配] 删除原分组失败', e); }
			converted++;
		} catch (error) { console.warn('[装配] 转换为复调用标签失败', error); }
	}
	return { converted, locators };
}

/** 将分组转化为复调用标签（0.72.0 重新设计）：
 *  选中分组 → 弹窗指定一个「已存在的其它分组」→ 把选中分组**原位替换**为指向它的调用标签，
 *  只保留各分组自身的位姿（origin + rotation），原分组连同几何删除。
 *  旧实现只是建一个指向自己的标签再把原分组藏起来，导出后净效果不变，等于没转化。 */
function convertSelectedGroupsToCallTags() {
	if (typeof Locator === 'undefined') { Blockbench.showMessageBox({ title: '不支持定位点', message: '当前 Blockbench 没有 Locator。', icon: 'warning' }); return; }
	const picked = selectedGroups();
	if (!picked.length) { Blockbench.showMessageBox({ title: '请先选中分组', message: '在 outliner 里选中要转换的分组。', icon: 'info' }); return; }
	const groups = outermostSelectedGroups(picked);
	// 删除集合：最外层选中分组 + 它们的全部后代（删父连带删子，这些都不能再当调用目标）
	const willRemove = new Set();
	for (const group of groups) for (const node of collectGroupSubtree(group)) willRemove.add(node);
	const candidates = collectAllGroups().filter(group => group && !willRemove.has(group));
	if (!candidates.length) {
		Blockbench.showMessageBox({ title: '没有可调用的分组', message: '除了将被替换的分组之外，项目里没有其它已存在的分组可作为调用目标。', icon: 'info' });
		return;
	}
	const options = {};
	for (const group of candidates) options[group.uuid] = labelOf(group);
	new Dialog({
		id: 'imda_convert_call',
		title: '将分组转化为复调用标签',
		width: 560,
		form: {
			target: { label: '调用目标（已存在的分组）', type: 'select', value: '', options, description: '选中的分组会被删除，并在原位替换为指向该目标的调用标签；标签保留各自原有的位置与旋转，几何由目标分组提供。' },
			list: { label: '将被替换的分组（' + groups.length + ' 个）', type: 'textarea', value: groups.map(group => labelOf(group)).join('\n'), readonly: true, description: '这些分组及其几何会被删除。目标分组不能落在它们的子树里。' },
		},
		onConfirm(result) {
			const target = String(result.target || '').trim();
			const targetGroup = candidates.find(group => group && group.uuid === target) || null;
			if (!targetGroup) { Blockbench.showQuickMessage('未选择有效的目标分组，已取消。', 3000); return; }
			try { Undo.initEdit({ outliner: true, groups: groups.slice(), elements: [] }); } catch (e) { /* ignore */ }
			const applied = applyConvertGroupsToCallTags(groups, targetGroup);
			try { Undo.finishEdit('将分组转换为复调用标签', { outliner: true, groups: groups.slice(), elements: applied.locators }); } catch (e) { /* ignore */ }
			try { Canvas.updateAll(); } catch (e) { /* ignore */ }
			try { Project.saved = false; } catch (e) { /* ignore */ }
			try { simInvalidate(); } catch (e) { /* ignore */ }
			Blockbench.showQuickMessage('已将 ' + applied.converted + ' 个分组替换为指向「' + labelOf(targetGroup) + '」的调用标签（原几何已删除）', 5000);
		},
	}).show();
}

/** 编辑一个复调用 Locator 的目标（分组 UUID 或模型 id） */
function callModelPrefill(target, matchedGroup) {
	if (matchedGroup) return '';
	const value = String(target || '').trim();
	if (!value) return '';
	return value.indexOf(':') >= 0 ? value : '';
}

function callOverridesOf(locator) {
	let parsed = {};
	try { parsed = JSON.parse(String(locator && locator.imda_call_overrides || '{}')) || {}; } catch (e) { parsed = {}; }
	const legacy = { threshold: locator && locator.imda_call_threshold, property: locator && locator.imda_call_property, index: locator && locator.imda_call_index, scale: locator && locator.imda_call_scale };
	for (const key of Object.keys(legacy)) if ((parsed[key] === undefined || parsed[key] === '') && legacy[key] !== undefined && legacy[key] !== '') parsed[key] = legacy[key];
	return parsed;
}

function callOverrideFields(source, locator) {
	const src = source || {};
	const ov = callOverridesOf(locator);
	const val = (key) => String(ov[key] == null ? '' : ov[key]).replace(/^minecraft:/, '');
	const srcType = String(src.imda_type || 'composite').replace(/^minecraft:/, '');
	const parentType = String((locator && locator.parent && locator.parent.imda_type) || '').replace(/^minecraft:/, '');
	const isRange = srcType === 'range_dispatch';
	const isCondition = srcType === 'condition';
	const tri = { '': '（不覆盖）', true: 'true', false: 'false' };
	return {
		sourceType: { label: '源映射类型（只读）', type: 'text', value: srcType, readonly: true, description: '复调用的类型始终跟随目标分组，不能单独修改。' },
		ov_threshold: { label: '阈值覆盖（父级 range_dispatch）', type: 'text', value: val('threshold'), condition: () => parentType === 'range_dispatch', description: '留空=不覆盖；数字作为 entries[].threshold。' },
		ov_property: { label: 'property 覆盖', type: 'select', value: val('property'), options: { '': '（不覆盖）', selected: 'selected', broken: 'broken', damaged: 'damaged', carried: 'carried', custom_model_data: 'custom_model_data', has_component: 'has_component', component: 'component', keybind_down: 'keybind_down', compass: 'compass', count: 'count', damage: 'damage', time: 'time', use_cycle: 'use_cycle', use_duration: 'use_duration', 'bundle/fullness': 'bundle/fullness', cooldown: 'cooldown', 'crossbow/pull': 'crossbow/pull' }, condition: () => isRange || isCondition, description: '留空=不覆盖；源节点：' + (String(src.imda_property || '').replace(/^minecraft:/, '') || '（空）') },
		ov_component: { label: 'component 覆盖', type: 'text', value: val('component'), condition: (r) => r.ov_property === 'has_component', description: 'has_component 用；留空不覆盖。' },
		ov_ignore_default: { label: 'ignore_default 覆盖', type: 'select', value: val('ignore_default'), options: tri, condition: (r) => r.ov_property === 'has_component', description: '留空不覆盖。' },
		ov_predicate: { label: 'predicate 覆盖', type: 'text', value: val('predicate'), condition: (r) => r.ov_property === 'component', description: '留空不覆盖。' },
		ov_value: { label: 'value 覆盖（JSON）', type: 'text', value: val('value'), condition: (r) => r.ov_property === 'component', description: '留空不覆盖。' },
		ov_keybind: { label: 'keybind 覆盖', type: 'text', value: val('keybind'), condition: (r) => r.ov_property === 'keybind_down', description: '留空不覆盖。' },
		ov_threshold_format: { label: '分支编号格式覆盖', type: 'text', value: val('threshold_format'), condition: () => isRange, description: '同分组属性：i / 2i / 10+2i / 0,1,3 / ni（n=上层编号）/ f（所在层元素数）/ s（自身子项数）；留空不覆盖。源节点：' + String(src.imda_threshold_format || '') },
		ov_index: { label: 'index 覆盖', type: 'text', value: val('index'), condition: () => isRange, description: '留空不覆盖；源节点：' + String(src.imda_index == null ? '' : src.imda_index) },
		ov_scale: { label: 'scale 覆盖', type: 'text', value: val('scale'), condition: () => isRange, description: '留空不覆盖。' },
		ov_target: { label: 'compass target 覆盖', type: 'select', value: val('target'), options: { '': '（不覆盖）', lodestone: 'lodestone', none: 'none', spawn: 'spawn', recovery: 'recovery' }, condition: (r) => r.ov_property === 'compass', description: '留空不覆盖。' },
		ov_source: { label: 'time source 覆盖', type: 'select', value: val('source'), options: { '': '（不覆盖）', daytime: 'daytime', random: 'random', moon_phase: 'moon_phase' }, condition: (r) => r.ov_property === 'time', description: '留空不覆盖。' },
		ov_wobble: { label: 'wobble 覆盖', type: 'select', value: val('wobble'), options: tri, condition: (r) => r.ov_property === 'compass' || r.ov_property === 'time', description: '留空不覆盖。' },
		ov_normalize: { label: 'normalize 覆盖', type: 'select', value: val('normalize'), options: tri, condition: (r) => r.ov_property === 'count' || r.ov_property === 'damage', description: '留空不覆盖。' },
		ov_period: { label: 'period 覆盖', type: 'text', value: val('period'), condition: (r) => r.ov_property === 'use_cycle', description: '留空不覆盖。' },
		ov_remaining: { label: 'remaining 覆盖', type: 'select', value: val('remaining'), options: tri, condition: (r) => r.ov_property === 'use_duration', description: '留空不覆盖。' },
		ov_condition: { label: 'condition 覆盖', type: 'select', value: val('condition'), options: { '': '（不覆盖）', on_true: 'on_true', on_false: 'on_false' }, condition: () => parentType === 'condition', description: '留空不覆盖。' },
	};
}

function editCallTag(locator) {
	const selected = [];
	try { if (typeof Outliner !== 'undefined' && Array.isArray(Outliner.selected)) for (const item of Outliner.selected) { if (typeof Locator !== 'undefined' && item instanceof Locator) selected.push(item); } } catch (e) { /* ignore */ }
	try { if (typeof Locator !== 'undefined' && Locator && Array.isArray(Locator.selected)) for (const item of Locator.selected) if (selected.indexOf(item) < 0) selected.push(item); } catch (e) { /* ignore */ }
	try {
		const walkSelected = (nodes) => { for (const node of (nodes || [])) { if (typeof Locator !== 'undefined' && node instanceof Locator && node.selected && selected.indexOf(node) < 0) selected.push(node); if (isGroup(node)) walkSelected(node.children); } };
		walkSelected((typeof Outliner !== 'undefined' && Outliner) ? Outliner.root : []);
	} catch (e) { /* ignore */ }
	if (locator && selected.indexOf(locator) < 0) selected.push(locator);
	let locators = selected.filter((item, index) => item && selected.indexOf(item) === index);
	if (!locators.length) return;
	const first = locators[0];
	const currentTargets = locators.map(l => String(l.imda_call_target || '').trim());
	const commonTarget = currentTargets.every(t => t === currentTargets[0]) ? currentTargets[0] : '';
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
		if (group.uuid === commonTarget) matchedGroup = group.uuid;
	}
	new Dialog({
		id: 'imda_edit_call',
		title: '编辑复调用标签' + (locators.length > 1 ? ('（' + locators.length + ' 个）') : (' — ' + (first.name || 'Locator'))),
		width: 560,
		form: {
			target: { label: '目标分组', type: 'select', value: matchedGroup, options, description: '批量编辑时会把所有选中标签指向同一目标；导出时替换为目标分组的映射节点。' },
			model: { label: '或模型 id（优先）', type: 'text', value: callModelPrefill(commonTarget, matchedGroup), description: '例如 namespace:item/foo；填写后忽略上面的分组选择。失效的旧 UUID 不会预填到这里。' },
			...callOverrideFields(groups.find(g => g.uuid === matchedGroup) || null, first),
		},
		onConfirm(result) {
			try {
				const model = String(result.model || '').trim();
				const target = model || String(result.target || '').trim();
				try { Undo.initEdit({ elements: locators }); } catch (e) { /* ignore */ }
				const overrides = {};
				const map = { ov_threshold: 'threshold', ov_threshold_format: 'threshold_format', ov_property: 'property', ov_index: 'index', ov_scale: 'scale', ov_component: 'component', ov_ignore_default: 'ignore_default', ov_predicate: 'predicate', ov_value: 'value', ov_keybind: 'keybind', ov_target: 'target', ov_source: 'source', ov_wobble: 'wobble', ov_normalize: 'normalize', ov_period: 'period', ov_remaining: 'remaining', ov_condition: 'condition' };
				for (const key of Object.keys(map)) {
					const text = String(result[key] == null ? '' : result[key]).trim();
					if (text !== '') overrides[map[key]] = text;
				}
				for (const item of locators) {
					item.imda_call_target = target;
					item.imda_call_overrides = JSON.stringify(overrides);
					item.imda_call_threshold = overrides.threshold || '';
					item.imda_call_property = overrides.property || '';
					item.imda_call_index = overrides.index || '';
					item.imda_call_scale = overrides.scale || '';
				}
				console.log('[装配] 编辑复调用标签', locators.length, '→', target);
				if (target && target.indexOf(':') < 0 && typeof Group !== 'undefined' && Array.isArray(Group.all) && !Group.all.some(g => g && g.uuid === target)) {
					Blockbench.showMessageBox({ title: '目标分组不存在', message: '目标 UUID 不在当前项目里：' + target + '\n请重新选择目标分组。', icon: 'warning' });
				}
				try { Undo.finishEdit('编辑复调用标签'); } catch (e) { /* ignore */ }
				simInvalidate();
				try { Canvas.updateAll(); } catch (e) { /* ignore */ }
				try { Project.saved = false; } catch (e) { /* ignore */ }
				Blockbench.showQuickMessage(target ? ('已设置 ' + locators.length + ' 个复调用标签 → ' + target) : ('已清空 ' + locators.length + ' 个复调用目标'), 3000);
			} catch (error) {
				console.error(error);
				Blockbench.showMessageBox({ title: '修改失败', message: String((error && error.message) || error), icon: 'error' });
			}
		},
	}).show();
}

function invalidCallTags() {
	const groups = new Map();
	try { for (const g of ((typeof Group !== 'undefined' && Group.all) ? Group.all : [])) groups.set(g.uuid, g); } catch (e) { /* ignore */ }
	const list = [];
	try {
		for (const locator of ((typeof Locator !== 'undefined' && Locator.all) ? Locator.all : [])) {
			const target = String(locator.imda_call_target || '').trim();
			if (!target || target.indexOf(':') >= 0) continue;
			if (!groups.has(target)) list.push(locator);
		}
	} catch (e) { /* ignore */ }
	return list;
}

function repairCallTargetsDialog() {
	const broken = invalidCallTags();
	if (!broken.length) { Blockbench.showQuickMessage('没有失效的复调用标签。', 2500); return; }
	const options = {};
	for (const group of ((typeof Group !== 'undefined' && Group.all) ? Group.all : [])) options[group.uuid] = labelOf(group);
	new Dialog({
		id: 'imda_repair_calls',
		title: '修复失效的复调用目标（' + broken.length + ' 个）',
		width: 560,
		form: {
			target: { label: '统一指向', type: 'select', value: '', options, description: '把所有目标 UUID 已不存在的复调用标签改为该分组。' },
			list: { label: '失效标签', type: 'textarea', value: broken.map(l => l.name || l.uuid).join('\n'), readonly: true },
		},
		onConfirm(result) {
			const target = String(result.target || '').trim();
			if (!target) return;
			try { Undo.initEdit({ elements: broken }); } catch (e) { /* ignore */ }
			for (const locator of broken) locator.imda_call_target = target;
			try { Undo.finishEdit('修复复调用目标'); } catch (e) { /* ignore */ }
			try { Project.saved = false; } catch (e) { /* ignore */ }
			Blockbench.showQuickMessage('已修复 ' + broken.length + ' 个复调用目标', 3000);
		},
	}).show();
}

function createModelFromGroup(group) {
	if (!group) return;
	const root = String(projectValue('imda_pack_path', '') || '').trim();
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
		id: 'imda_create_model',
		title: '从分组创建模型',
		width: 560,
		form: {
			name: { label: '模型名', type: 'text', value: sanitizePath(labelOf(group), 'group'), description: '写入 assets/<namespace>/models/item/<主文件名>/<名字>.json；分组会改为引用该模型，并记录居中补偿以保持外观。' },
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
			const dir = pathmod.join(root, 'assets', exporter.namespace, 'models', 'item', ...(exporter.modelDir() ? exporter.modelDir().split('/') : []));
			const file = pathmod.join(dir, model.name + '.json');
			try {
				fsmod.mkdirSync(dir, { recursive: true });
				Blockbench.writeFile(file, { content: formatModel(model.data), savetype: 'text' });
			} catch (error) {
				Blockbench.showMessageBox({ title: '写入失败', message: String((error && error.message) || error), icon: 'error' });
				return;
			}
			try { Undo.initEdit({ groups: [group] }); } catch (e) { /* ignore */ }
			group.imda_type = 'model';
			group.imda_model = built.reference;
			group.imda_model_shift = JSON.stringify(built.shift);
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
			const type = String(node.imda_type || 'composite').replace(/^minecraft:/, '');
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
	const importKey = String((group && group.uuid) || '') + '|' + String((group && group.imda_model) || '');
	// 冷却已回退：不再按时间拒绝重复导入
	importingModel = true;
	lastImportKey = importKey;
	lastImportAt = Date.now();
	setTimeout(() => { importingModel = false; }, 1200);
	if (!group) return false;
	const reference = String(group.imda_model || '').trim();
	if (!reference) return false;
	const root = String(projectValue('imda_pack_path', '') || '').trim();
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
	// 源模型原点 → 目标分组枢轴：把源模型整体平移，使坐标原点与分组枢轴重合
	const sourceRootForImport = (resolved.groups || [])[0];
	const sourceOriginForImport = Array.isArray(sourceRootForImport && sourceRootForImport.origin) ? sourceRootForImport.origin : [0, 0, 0];
	const targetOriginForImport = Array.isArray(group.origin) ? group.origin : [0, 0, 0];
	const import_base = [0, 1, 2].map(a => (Number(targetOriginForImport[a]) || 0) - (Number(sourceOriginForImport[a]) || 0));
	try { group.imda_model_origin = JSON.stringify(sourceOriginForImport.slice()); } catch (e) { /* ignore */ }
	try {
		try { if (typeof unselectAll === 'function') unselectAll(); } catch (e) { /* ignore */ }
		Undo.initEdit({ groups: [group], elements: (group.children || []).filter(isCube) });
		// 清空原有子项与方块
		// 确保分组可见（可能被“隐藏不可用分支”关闭过）
		try { group.visibility = true; group.export = true; group.imda_auto_disabled = false; } catch (e) { /* ignore */ }
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
		const sourceTintType = group.imda_tint_type;
		const hasSourceTint = sourceTintType !== undefined && sourceTintType !== null && sourceTintType !== '' && sourceTintType !== 'none';
		const sourceTintIndex = String(group.imda_tint_index == null ? '' : group.imda_tint_index).trim();
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
					node.imda_type = 'internal';
					if (hasSourceTint) {
						node.imda_tint_type = sourceTintType;
						if (group.imda_tint_index !== undefined) node.imda_tint_index = group.imda_tint_index;
						if (group.imda_tint_value !== undefined) node.imda_tint_value = group.imda_tint_value;
						if (group.imda_tints !== undefined) node.imda_tints = group.imda_tints;
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
		// 枢轴必须在 init 之前定好：Blockbench 的方块网格是“网格位置=origin、顶点相对 origin”构建的，
		// init 之后再改 origin 会把方块整体挪走。方块的默认 origin 是 [0,0,0]（方块原点，
		// 不是几何中心），选中分组时 gizmo/枢轴标记就会偏。这里直接把 origin 设为几何中心；
		// 带 rotation 的元素保留 Java 的旋转原点（下方 rotation 分支会覆盖），以免改变外观。
		if (!el.rotation) {
			try {
				cube.origin = [0, 1, 2].map(a => (Number(cube.from[a]) + Number(cube.to[a])) / 2);
			} catch (e) { /* ignore */ }
		}
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
		if (group.imda_align_center === true && created.length) {
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
			group.imda_offset = [0, 1, 2].map(a => (min[a] + max[a]) / 2 - 8);
		} else {
			group.imda_offset = [0, 0, 0];
		}
		// 新建的导入分组/方块必须进 finish aspects，否则撤销后它们不会被删除（只会被 outliner 丢回根目录）
		Undo.finishEdit('导入引用模型', { outliner: true, groups: [group].concat(importedGroups), elements: created });
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

/* ============================== 引用其他物品模型映射（assets/<ns>/items/*.json） ============================== */

/** 映射引用语法：`ns:items/路径`（对应 assets/ns/items/路径.json）；不是映射引用返回 null */
function parseMappingReference(reference) {
	const text = String(reference == null ? '' : reference).trim();
	// 路径里允许空格（资源包里 "jet_rifle copy.json" 这种很常见），
	// 之前用 [^\s]+ 会把带空格的路径判成不合法，导出时退化成非法引用。
	const m = /^([a-z0-9_.\-]+):items\/([^\s].*?)$/i.exec(text);
	if (!m) return null;
	return { ns: m[1], path: m[2].replace(/\.json$/i, '') };
}

function mappingPathOf(pathmod, root, reference) {
	const parsed = parseMappingReference(reference);
	if (!parsed) return null;
	return pathmod.join(root, 'assets', parsed.ns, 'items', parsed.path + '.json');
}

/** 读取被引用的物品模型映射文件，取出其中的 model 节点
 *  - 结果缓存在项目里（`imda_mapping_cache`），导出时只读缓存，避免导出路径碰文件系统/权限弹窗；
 *  - `fresh: true` 强制重读（「更新所有调用」与选文件后调用）；
 *  - `readOnly: true` 只读缓存，不读盘（导出用）。 */
function loadMappingDefinition(reference, options) {
	const opts = options || {};
	const key = String(reference == null ? '' : reference).trim();
	const parsed = parseMappingReference(key);
	if (!parsed) return { error: '不是物品映射引用（应形如 ns:items/路径）' };
	const cache = mappingCacheRead();
	if (!opts.fresh && cache[key]) return { model: cache[key], cached: true };
	if (opts.readOnly) return { error: '尚未缓存该映射，请先执行「更新所有调用」或重新选择文件' };
	const root = String(projectValue('imda_pack_path', '') || '').trim();
	if (!root) return { error: '未设置「资源包工程路径」' };
	const pathmod = getPath();
	const fsmod = getScopedFs(root);
	if (!pathmod || !fsmod) return { error: '无法读取资源包（需要桌面版 Blockbench 且已授权该目录）' };
	const file = mappingPathOf(pathmod, root, key);
	const json = readJSONFile(pathmod, fsmod, file);
	if (!json) return { error: '找不到映射文件：' + file };
	if (!json.model) return { error: '该文件没有 model 字段：' + file };
	cache[key] = json.model;
	mappingCacheWrite(cache);
	return { model: json.model, file };
}

function mappingCacheRead() {
	try {
		const raw = String(projectValue('imda_mapping_cache', '') || '');
		const parsed = raw ? JSON.parse(raw) : null;
		return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
	} catch (e) { return {}; }
}

function mappingCacheWrite(map) {
	try { setProjectValue('imda_mapping_cache', JSON.stringify(map || {})); } catch (e) { /* ignore */ }
}

function clearMappingCache() {
	mappingCacheWrite({});
}

/** 从选中的文件路径解析出引用（models → ns:路径；items → ns:items/路径） */
function referenceFromPickedPath(picked) {
	const raw = String(picked == null ? '' : picked).trim().replace(/\\/g, '/');
	if (!raw) return { error: '没有选择文件' };
	const root = String(projectValue('imda_pack_path', '') || '').trim().replace(/\\/g, '/').replace(/\/+$/, '');
	const rel = root && raw.toLowerCase().indexOf(root.toLowerCase()) === 0
		? raw.slice(root.length).replace(/^\/+/, '')
		: raw;
	const re = /(?:^|\/)assets\/([^/]+)\/(models|items)\/(.+)\.json$/i;
	const m = re.exec(rel) || re.exec(raw);
	if (!m) return { error: '无法从路径解析出 assets/<命名空间>/models|items/…：\n' + raw };
	const ns = m[1];
	const kind = String(m[2]).toLowerCase();
	const sub = m[3].replace(/\.json$/i, '');
	return {
		kind,
		ns,
		path: sub,
		reference: kind === 'items' ? (ns + ':items/' + sub) : (ns + ':' + sub),
	};
}

/* ============================== 全物品模型表 ============================== */

/** 递归列出目录下所有文件（相对 root 的 posix 路径） */
function listFilesRecursive(fsmod, pathmod, absRoot, extFilter) {
	const out = [];
	const walk = (dir, depth) => {
		if (depth > 24) return;
		let entries = [];
		try { entries = fsmod.readdirSync(dir, { withFileTypes: true }) || []; } catch (e) { return; }
		for (const entry of entries) {
			const name = String((entry && entry.name) || entry || '');
			if (!name || name === '.' || name === '..') continue;
			const abs = pathmod.join(dir, name);
			let isDir = false;
			try { isDir = entry && typeof entry.isDirectory === 'function' ? entry.isDirectory() : fsmod.statSync(abs).isDirectory(); } catch (e) { continue; }
			if (isDir) { walk(abs, depth + 1); continue; }
			if (extFilter && !extFilter.test(name)) continue;
			out.push(pathmod.relative(absRoot, abs).replace(/\\/g, '/'));
		}
	};
	walk(absRoot, 0);
	return out;
}

/** 黑名单：每个正则独立匹配相对路径（posix）；返回命中的那条（用于报告） */
function matchBlacklist(rel, patterns) {
	for (const pattern of (patterns || [])) {
		const text = String(pattern || '').trim();
		if (!text) continue;
		try {
			if (new RegExp(text).test(rel)) return text;
		} catch (e) { /* 无效正则跳过，由调用方统一报告 */ }
	}
	return null;
}

/** 扫描资源包里的模型与映射文件，返回候选条目。
 *  entry = { kind:'model'|'items', ns, path, untyped:'ns:path', typed:'ns:models/…'|'ns:items/…', rel, abs, skip } */
function scanPackEntries(options) {
	const opts = options || {};
	const root = String(projectValue('imda_pack_path', '') || '').trim();
	if (!root) return { error: '未设置「资源包工程路径」（项目设置里填 pack.mcmeta 所在目录）' };
	const pathmod = getPath();
	const fsmod = getScopedFs(root);
	if (!pathmod || !fsmod) return { error: '无法读取资源包（需要桌面版 Blockbench 且已授权该目录）' };
	const includeModels = opts.includeModels !== false;
	const includeItems = opts.includeItems !== false;
	const blacklist = Array.isArray(opts.blacklist) ? opts.blacklist : [];
	const entries = [];
	const invalidPatterns = [];
	for (const pattern of blacklist) {
		const text = String(pattern || '').trim();
		if (!text) continue;
		try { new RegExp(text); } catch (e) { invalidPatterns.push(text); }
	}

	const collect = (kind) => {
		const folder = (kind === 'items') ? 'items' : 'models';
		const assetsRoot = pathmod.join(root, 'assets');
		// 一次遍历拿到全部 assets 下的 json（相对 root 的路径，形如 assets/<ns>/<folder>/…），
		// 再按命名空间 + 目录筛出自己这一 kind，避免对每个命名空间重复深扫。
		let allRels = [];
		try { allRels = listFilesRecursive(fsmod, pathmod, root, /\.json$/i); } catch (e) { return; }
		for (const rel of allRels) {
			const m = /^assets\/([^/]+)\/([^/]+)\/(.+)\.json$/i.exec(rel);
			if (!m) continue;
			if (m[2].toLowerCase() !== folder) continue;
			const sub = m[3];
			entries.push({
				kind,
				ns: m[1],
				path: sub,
				untyped: m[1] + ':' + sub,
				typed: m[1] + ':' + folder + '/' + sub,
				rel,
				blockedBy: matchBlacklist(rel, blacklist),
			});
		}
	};
	if (includeModels) collect('model');
	if (includeItems) collect('items');

	// 同一无类型路径既有模型又有映射 → 映射优先（模型丢弃，路径并入映射的 when 列表）
	const byUntyped = new Map();
	for (const entry of entries) {
		if (entry.blockedBy) continue;
		const list = byUntyped.get(entry.untyped) || [];
		list.push(entry);
		byUntyped.set(entry.untyped, list);
	}
	const winners = [];
	const droppedModels = [];
	for (const [untyped, list] of byUntyped) {
		const itemsEntry = list.find(e => e.kind === 'items');
		const modelEntry = list.find(e => e.kind === 'model');
		if (itemsEntry && modelEntry) {
			// 映射优先：模型不单独成 case，只在映射的 when 列表里补无类型路径
			droppedModels.push(modelEntry);
			winners.push(Object.assign({}, itemsEntry, { alsoHasModel: true }));
			continue;
		}
		winners.push(itemsEntry || modelEntry);
	}
	winners.sort((a, b) => (a.untyped < b.untyped ? -1 : a.untyped > b.untyped ? 1 : 0));
	return {
		entries: winners,
		scanned: entries.length,
		blocked: entries.filter(e => e.blockedBy),
		droppedModels,
		invalidPatterns,
		root,
	};
}

/** 批量把映射定义读进项目缓存（一次写盘），供 buildAllItemsTree 使用。
 *  为什么必须预读：`ns:items/…` 这类引用在导出时走 `loadMappingDefinition({readOnly:true})`，
 *  只读缓存不碰文件系统（导出路径不能弹权限框）。不预读的话导出会退化成
 *  `minecraft:model` + `"model": "ns:items/…"` —— 原版 model 字段只能指向 models/，
 *  这是非法引用，整条分支失效。 */
function primeMappingCache(entries) {
	const list = (entries || []).filter(e => e && e.kind === 'items');
	if (!list.length) return { primed: 0, failed: [] };
	const root = String(projectValue('imda_pack_path', '') || '').trim();
	if (!root) return { primed: 0, failed: list.map(e => ({ entry: e, error: '未设置资源包工程路径' })) };
	const pathmod = getPath();
	const fsmod = getScopedFs(root);
	if (!pathmod || !fsmod) return { primed: 0, failed: list.map(e => ({ entry: e, error: '无法读取资源包' })) };
	const cache = mappingCacheRead();
	const failed = [];
	let primed = 0;
	for (const entry of list) {
		const key = entry.ns + ':items/' + entry.path;
		try {
			const json = readJSONFile(pathmod, fsmod, mappingPathOf(pathmod, root, key));
			if (!json) { failed.push({ entry, error: '找不到文件' }); continue; }
			if (!json.model) { failed.push({ entry, error: '该文件没有 model 字段' }); continue; }
			cache[key] = json.model;
			primed++;
		} catch (e) { failed.push({ entry, error: String((e && e.message) || e) }); }
	}
	try { mappingCacheWrite(cache); } catch (e) { /* ignore */ }
	return { primed, failed };
}

/** 生成「全物品模型表」：select 容器 + 每个路径一个 case 分组。
 *  - property = custom_model_data → `"index": <index>`，when 里放路径字符串（floats/strings 需按实际数据类型匹配）
 *  - property = component       → `"component": "minecraft:custom_data"`，when 里放 `{ id: "ns:path" }` 形态的匹配值 */
function buildAllItemsTree(options) {
	const opts = options || {};
	const scan = scanPackEntries(opts);
	if (scan.error) return scan;
	const entries = scan.entries;
	if (!entries.length) return { error: '没有可导入的模型或映射（检查资源包路径、黑名单与「只导入」选项）', scan };
	const useComponent = String(opts.property || 'custom_model_data') === 'component';
	const name = String(opts.name || '').trim() || '[all items]';
	const index = num(opts.index);
	// 先把所有映射定义读进缓存：导出时只读缓存，不碰文件系统
	const priming = primeMappingCache(entries);
	// 预读失败的映射不能建分支：导出时它拿不到定义，会退化成
	// `minecraft:model` + `"model": "ns:items/…"`（非法引用，原版 model 字段只能指向 models/）。
	// 直接从候选里剔除，并在报告里说明原因（典型原因：文件没有 model 字段、不是映射文件）。
	const failedKeys = new Set((priming.failed || []).map(f => f.entry && f.entry.untyped));
	const usable = entries.filter(e => !(e.kind === 'items' && failedKeys.has(e.untyped)));
	const skippedMappings = (priming.failed || []).filter(f => f.entry && failedKeys.has(f.entry.untyped));
	if (!usable.length) return { error: '没有可用的模型或映射（映射预读全部失败）', scan, priming };

	const container = new Group({
		name,
		imda_type: 'select',
		imda_property: useComponent ? 'component' : 'custom_model_data',
		imda_index: useComponent ? 0 : index,
		imda_component: useComponent ? 'minecraft:custom_data' : '',
		origin: [8, 8, 8],
		rotation: [0, 0, 0],
	});
	const created = [container];
	for (const entry of usable) {
		const modelRef = entry.kind === 'items'
			? (entry.ns + ':items/' + entry.path)
			: (entry.ns + ':' + entry.path);
		const caseGroup = new Group({
			name: '[' + entry.untyped + '] ' + sanitizePath(entry.path.split('/').pop(), 'case'),
			imda_type: 'model',
			imda_model: modelRef,
			origin: [8, 8, 8],
			rotation: [0, 0, 0],
		});
		// when 列表：无类型路径 + 带类型路径；映射优先时无类型路径只出现一次
		const when = [];
		const pushWhen = (value) => {
			const key = JSON.stringify(value);
			if (!when.some(existing => JSON.stringify(existing) === key)) when.push(value);
		};
		if (useComponent) {
			// component 模式下 when 是组件值：custom_data 的 id 字段
			pushWhen({ id: entry.untyped });
			pushWhen({ id: entry.typed });
		} else {
			// custom_model_data 模式：when 是字符串列表，无类型 + 带类型都放进去
			pushWhen(entry.untyped);
			pushWhen(entry.typed);
		}
		caseGroup.imda_case_when = JSON.stringify(when);
		caseGroup.__allItemsEntry = entry;
		// 必须用 addTo 而不是直接 push：`new Group()` 的 parent 默认是 'root'，
		// 只 push 进 children 不改 parent 的话，后面调 caseGroup.init() 会命中
		// `parent === 'root' && Outliner.root 里没有它` → 自己 addTo('root')，
		// 结果每个 case 既在容器 children 里、又成了根目录下的一级节点。
		// 这里只 addTo 不 init：容器还没挂进大纲，提前 init 子节点会找不到父级 mesh。
		caseGroup.addTo(container);
		created.push(caseGroup);
	}
	return { container, created, entries: usable, skippedMappings, scan, priming };
}

/** 清理大纲里的重复节点：同一个对象既在某个分组的 children 里、又在 Outliner.root 里。
 *  这是 0.71.0「生成全物品模型表」留下的痕迹 —— 当时 case 分组只 push 进 children、
 *  没改 parent，随后 init() 把它们又 addTo('root') 了一遍。修复后不会再产生，
 *  但已经生成的工程需要清一次（删掉根目录那份，保留容器里的）。 */
function repairOutlinerDuplicates() {
	const roots = (typeof Outliner !== 'undefined' && Outliner.root) ? Outliner.root : null;
	if (!roots) return { removed: 0 };
	const nested = new Set();
	const visit = (node) => {
		if (!node || !Array.isArray(node.children)) return;
		for (const child of node.children) {
			if (!child) continue;
			nested.add(child);
			visit(child);
		}
	};
	for (const node of roots) visit(node);
	let removed = 0;
	for (const node of roots.slice()) {
		if (!nested.has(node)) continue;
		const at = roots.indexOf(node);
		if (at >= 0) { roots.splice(at, 1); removed++; }
	}
	if (removed) {
		try { Canvas.updateAll(); } catch (e) { /* ignore */ }
		try { Project.saved = false; } catch (e) { /* ignore */ }
	}
	return { removed };
}

function repairOutlinerDuplicatesAction() {
	try { Undo.initEdit({ outliner: true }); } catch (e) { /* ignore */ }
	const result = repairOutlinerDuplicates();
	try { Undo.finishEdit('清理大纲重复节点', { outliner: true }); } catch (e) { /* ignore */ }
	if (result.removed) Blockbench.showQuickMessage('已清理 ' + result.removed + ' 个重复挂在根目录的节点', 4000);
	else Blockbench.showQuickMessage('大纲里没有重复节点', 3000);
}

/** 对话框：生成全物品模型表 */
function openAllItemsDialog() {
	const root = String(projectValue('imda_pack_path', '') || '').trim();
	if (!root) {
		Blockbench.showMessageBox({ title: '缺少资源包工程路径', message: '请先在项目设置里指定资源包工程路径（pack.mcmeta 所在目录）。', icon: 'warning' });
		return;
	}
	new Dialog({
		id: 'imda_all_items',
		title: '生成全物品模型表',
		width: 640,
		form: {
			name: { label: '容器名称', type: 'text', value: '[all items]' },
			property: {
				label: '匹配依据（property）',
				type: 'select',
				value: 'custom_model_data',
				options: {
					custom_model_data: '物品模型数据（custom_model_data）',
					component: '物品数据（custom_data.id）',
				},
				description: 'custom_model_data：when 放路径字符串（floats/strings 里放 ns:path）。\n物品数据：property 用 component，匹配 minecraft:custom_data 的 id 字段。',
			},
			index: { label: 'custom_model_data index', type: 'number', value: 0, description: '仅 custom_model_data 模式使用。' },
			_: '_',
			includeModels: { label: '导入模型（assets/*/models/*）', type: 'checkbox', value: true },
			includeItems: { label: '导入映射（assets/*/items/*）', type: 'checkbox', value: true },
			blacklist: {
				label: '黑名单正则（每行一个）',
				type: 'textarea',
				value: String(projectValue('imda_all_items_blacklist', '') || ''),
				description: '按相对路径匹配（如 assets/sqsp/models/item/debug/ 或 /_old/），命中的模型/映射会被剔除。下次打开会记住。',
			},
		},
		onConfirm(result) {
			const includeModels = !!result.includeModels;
			const includeItems = !!result.includeItems;
			if (!includeModels && !includeItems) {
				Blockbench.showMessageBox({ title: '没有选择来源', message: '至少要勾选「导入模型」或「导入映射」之一。', icon: 'info' });
				return;
			}
			const blacklist = String(result.blacklist || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
			try { setProjectValue('imda_all_items_blacklist', blacklist.join('\n')); } catch (e) { /* ignore */ }
			const built = buildAllItemsTree({
				name: result.name, property: result.property, index: result.index,
				includeModels, includeItems, blacklist,
			});
			if (built.error) {
				Blockbench.showMessageBox({ title: '无法生成', message: built.error, icon: 'warning' });
				return;
			}
			try { Undo.initEdit({ outliner: true, groups: [] }); } catch (e) { /* ignore */ }
			// 顺手清掉旧版本可能留下的重复根节点，避免生成后大纲里出现两套
			try { repairOutlinerDuplicates(); } catch (e) { /* ignore */ }
			// 顺序很重要：先把容器挂进大纲（容器 parent = 'root'，init 才能建出 mesh），
			// 再 init 子节点（它们 parent 已指向容器，init 不会再把自己塞进根目录）。
			addAndInit(built.container, null);
			for (const node of built.created) {
				if (node === built.container) continue;
				try { if (node.init) node.init(); } catch (e) { /* ignore */ }
			}
			try { Undo.finishEdit('生成全物品模型表', { outliner: true, groups: built.created }); } catch (e) { /* ignore */ }
			try { Canvas.updateAll(); } catch (e) { /* ignore */ }
			try { Project.saved = false; } catch (e) { /* ignore */ }
			try { simInvalidate(); } catch (e) { /* ignore */ }
			const scan = built.scan || {};
			const priming = built.priming || {};
			const notes = [];
			notes.push('已生成 ' + built.entries.length + ' 个分支');
			if (priming.primed) notes.push('预读 ' + priming.primed + ' 个映射');
			if (scan.blocked && scan.blocked.length) notes.push('黑名单剔除 ' + scan.blocked.length + ' 个');
			if (scan.droppedModels && scan.droppedModels.length) notes.push('同路径映射优先，跳过 ' + scan.droppedModels.length + ' 个模型');
			if (built.skippedMappings && built.skippedMappings.length) notes.push('映射无效跳过 ' + built.skippedMappings.length + ' 个（无 model 字段/读取失败）');
			if (scan.invalidPatterns && scan.invalidPatterns.length) notes.push('无效正则 ' + scan.invalidPatterns.length + ' 条已忽略：' + scan.invalidPatterns.join(' / '));
			Blockbench.showQuickMessage(notes.join('；'), 6000);
			if (scan.invalidPatterns && scan.invalidPatterns.length) console.warn('[装配] 无效黑名单正则', scan.invalidPatterns);
			if (built.skippedMappings && built.skippedMappings.length) console.warn('[装配] 跳过的映射', built.skippedMappings.slice(0, 20));
		},
	}).show();
}

/* ============================== 提取 / 应用变换（位姿） ============================== */

let poseClipboard = null;

function poseOfNode(node) {
	if (!node) return null;
	if (isGroup(node)) {
		return {
			kind: 'group',
			label: String(node.name || ''),
			origin: (Array.isArray(node.origin) ? node.origin : [0, 0, 0]).map(Number),
			rotation: (Array.isArray(node.rotation) ? node.rotation : [0, 0, 0]).map(Number),
		};
	}
	if (isLocator(node)) {
		return {
			kind: 'locator',
			label: String(node.name || ''),
			origin: (Array.isArray(node.position) ? node.position : [0, 0, 0]).map(Number),
			rotation: (Array.isArray(node.rotation) ? node.rotation : [0, 0, 0]).map(Number),
		};
	}
	return null;
}

/** 提取选中元素的位姿（分组：origin + rotation；复调用标签：position + rotation） */
function extractPose() {
	const groups = selectedGroups();
	const locators = selectedCallTags();
	const node = groups[0] || locators[0] || null;
	if (!node) { Blockbench.showQuickMessage('先选中一个分组或复调用标签', 2600); return null; }
	const pose = poseOfNode(node);
	poseClipboard = pose;
	Blockbench.showQuickMessage('已提取变换：' + (pose.label || '') + '  origin [' + pose.origin.map(v => Math.round(Number(v) * 1000) / 1000).join(', ') + ']', 3000);
	return pose;
}

/** 把提取的位姿应用到所有选中的分组/复调用标签（连同子树平移，保证枢轴落到同一位置） */
function applyPose(pose) {
	const source = pose || poseClipboard;
	if (!source) { Blockbench.showQuickMessage('还没有提取过变换（先用「提取变换」）', 2800); return 0; }
	const groups = selectedGroups();
	const locators = selectedCallTags();
	if (!groups.length && !locators.length) { Blockbench.showQuickMessage('先选中要应用的目标', 2600); return 0; }
	const targets = source.kind === 'locator' ? locators : groups;
	if (!targets.length) {
		Blockbench.showMessageBox({ title: '目标类型不匹配', message: '提取的是' + (source.kind === 'locator' ? '复调用标签' : '分组') + '的变换，请选中同类型的目标。', icon: 'info' });
		return 0;
	}
	const cubeList = [];
	walkGroups(groups.length ? groups : [], g => { for (const c of (g.children || [])) if (isCube(c)) cubeList.push(c); });
	try { Undo.initEdit({ groups: groups.slice(), elements: cubeList }); } catch (e) { /* ignore */ }
	let applied = 0;
	for (const target of targets) {
		try {
			if (isGroup(target)) {
				const old = (Array.isArray(target.origin) ? target.origin : [0, 0, 0]).map(Number);
				const delta = [0, 1, 2].map(a => (Number(source.origin[a]) || 0) - (Number(old[a]) || 0));
				if (Math.hypot(delta[0], delta[1], delta[2]) > 1e-9) translateGroupCoordinates(target, delta);
				target.origin = source.origin.slice();
				target.rotation = source.rotation.slice();
			} else {
				target.position = source.origin.slice();
				target.rotation = source.rotation.slice();
			}
			applied++;
		} catch (error) { console.warn('[装配] 应用变换失败', error); }
	}
	try { Undo.finishEdit('应用变换'); } catch (e) { /* ignore */ }
	try { Canvas.updateAll(); } catch (e) { /* ignore */ }
	try { Project.saved = false; } catch (e) { /* ignore */ }
	simInvalidate();
	Blockbench.showQuickMessage('已把变换应用到 ' + applied + ' 个目标', 2600);
	return applied;
}

/** 用资源管理器选一个 models/items 文件，解析成引用串写进分组 */
function pickModelFileForGroup(group) {
	const target = group || pickTargetGroup();
	if (!target) { Blockbench.showMessageBox({ title: '请先选中分组', message: '先在 outliner 里选中一个分组。', icon: 'info' }); return; }
	const applyPicked = (files) => {
		const file = files && files[0];
		if (!file) return;
		const picked = file.path || file.name || '';
		const parsed = referenceFromPickedPath(picked);
		if (!parsed || !parsed.reference) {
			Blockbench.showMessageBox({ title: '无法解析路径', message: (parsed && parsed.error) || String(picked), icon: 'warning' });
			return;
		}
		try { Undo.initEdit({ groups: [target] }); } catch (e) { /* ignore */ }
		target.imda_model = parsed.reference;
		try {
			if (parsed.kind === 'items') {
				const def = loadMappingDefinition(parsed.reference, { fresh: true });
				if (def && def.error) Blockbench.showQuickMessage('引用已写入，但读取失败：' + def.error, 4000);
			}
		} catch (e) { /* ignore */ }
		try { target.imda_type = 'model'; } catch (e) { /* ignore */ }
		try { Undo.finishEdit('设置引用模型'); } catch (e) { /* ignore */ }
		try { Canvas.updateAll(); } catch (e) { /* ignore */ }
		try { Project.saved = false; } catch (e) { /* ignore */ }
		simInvalidate();
		Blockbench.showQuickMessage('引用已设为 ' + parsed.reference + '（' + (parsed.kind === 'items' ? '物品映射' : '模型') + '）', 3500);
	};
	try {
		const result = Blockbench.import({ type: 'JSON', extensions: ['json'], readtype: 'text' }, applyPicked);
		if (result && typeof result.then === 'function') result.then(applyPicked).catch(() => { /* 用户取消 */ });
	} catch (e) { console.warn('[装配] 选择文件失败', e); }
}

/* ============================== 更新所有调用 ============================== */
/** 刷新所有复调用标签与外部物品映射引用：清缓存、重解析、重排分支名并汇总问题 */
function refreshAllCalls() {
	const groups = [];
	walkGroups((typeof Outliner !== 'undefined' && Outliner && Outliner.root) ? Outliner.root : [], g => groups.push(g));
	const groupByUuid = new Map();
	for (const g of groups) { try { if (g.uuid) groupByUuid.set(g.uuid, g); } catch (e) { /* ignore */ } }

	let callTags = 0, brokenCalls = 0, modelRefs = 0, mappingRefs = 0, mappingErrors = 0, relabeled = 0;
	const problems = [];
	const visit = (nodes) => {
		for (const node of (nodes || [])) {
			if (isLocator(node)) {
				const target = String(node.imda_call_target || '').trim();
				if (!target) continue;
				callTags++;
				if (target.indexOf(':') < 0 && !groupByUuid.has(target)) {
					brokenCalls++;
					problems.push('复调用目标不存在：' + (node.name || '') + ' → ' + target);
				}
			} else if (isGroup(node)) {
				const model = String(node.imda_model || '').trim();
				if (model) {
					modelRefs++;
					if (parseMappingReference(model)) {
						mappingRefs++;
						const def = loadMappingDefinition(model, { fresh: true });
						if (!def || def.error) { mappingErrors++; problems.push('物品映射引用失败：' + (node.name || '') + ' → ' + model + '（' + ((def && def.error) || '未知') + '）'); }
					}
				}
				visit(node.children);
			}
		}
	};
	visit((typeof Outliner !== 'undefined' && Outliner && Outliner.root) ? Outliner.root : []);
	for (const g of groups) relabeled += syncBranchLabels(g);
	try { Canvas.updateAll(); } catch (e) { /* ignore */ }
	simInvalidate();
	try { Project.saved = true; } catch (e) { /* ignore */ }
	const summary = '复调用标签 ' + callTags + '（失效 ' + brokenCalls + '）· 引用模型 ' + modelRefs
		+ '（其中物品映射 ' + mappingRefs + '，失败 ' + mappingErrors + '）· 刷新分支名 ' + relabeled;
	if (problems.length) {
		Blockbench.showMessageBox({
			title: '更新所有调用：发现 ' + problems.length + ' 个问题',
			message: summary + '\n\n' + problems.slice(0, 20).join('\n') + (problems.length > 20 ? '\n…' : ''),
			icon: 'warning',
		});
	} else {
		Blockbench.showQuickMessage('已更新所有调用：' + summary, 4000);
	}
	return { callTags, brokenCalls, modelRefs, mappingRefs, mappingErrors, relabeled, problems };
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
	lastTrace: null,      // 最近一次求值的分支 trace（{seen, selected}，空分支活性靠它）
	uuidIndex: null,      // uuid → 大纲里的分组（复调用解析用，结构变了要清）
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
		// 结构重建时 uuid 索引也要重来（分组可能被删除/替换）
		sim.uuidIndex = null;
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
function tintGroupOf(group) {
	let node = group;
	while (isGroup(node)) {
		const type = String(node.imda_tint_type == null ? '' : node.imda_tint_type).replace(/^minecraft:/, '').trim();
		const index = String(node.imda_tint_index == null ? '' : node.imda_tint_index).trim();
		if (type && type !== 'none' && /^-?\d+$/.test(index)) return node;
		node = node.parent;
	}
	return null;
}

function simTintColorOf(cube) {
	const faces = cube && cube.faces;
	if (!faces) return null;
	// 分组明确“不生成 tints”时不着色
	const group = tintGroupOf(cube.parent);
	if (!group) return null;
	if (group.imda_tint_type === '' || group.imda_tint_type === 'none') return null;
	const type = String(group.imda_tint_type == null ? 'custom_model_data' : group.imda_tint_type).replace(/^minecraft:/, '').trim() || 'custom_model_data';
	if (type !== 'custom_model_data') return null;
	const indexText = String(group.imda_tint_index == null ? '' : group.imda_tint_index).trim();
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
		const type = String(node.imda_type || '').replace(/^minecraft:/, '');
		if (type === 'inline') return true;
		node = node.parent;
	}
	return false;
}

/** 一次选中多个方块时，改为选中它们各自的父分组 */
function selectionGroupForCube(parent) {
	let node = parent;
	let last = parent;
	while (isGroup(node)) {
		last = node;
		const type = String(node.imda_type || '').toLowerCase().replace(/^minecraft:/, '');
		if (type !== 'internal') return node;
		node = node.parent;
	}
	return last;
}

function guardBoxSelection() {
	if (guardingBox || !boxGroupsEnabled()) return;
	if (typeof Outliner === 'undefined' || !Outliner || !Array.isArray(Outliner.selected)) return;
	const typeOf = (g) => String(g && g.imda_type || '').replace(/^minecraft:/, '');
	const selectedInternalGroups = Outliner.selected.filter(g => isGroup(g) && typeOf(g) === 'internal');

	if (Outliner.selected.some(g => isGroup(g) && typeOf(g) !== 'internal')) return;
	if (typeof Group !== 'undefined' && Group && Array.isArray(Group.selected) && Group.selected.length && !Group.selected.some(g => typeOf(g) === 'internal')) return;
	const selectedCubes = Outliner.selected.filter(isCube);
	if (!selectedCubes.length && !selectedInternalGroups.length) return;
	const parents = [];
	for (const cube of selectedCubes) {
		const parent = cube && cube.parent;
		if (isGroup(parent) && parents.indexOf(parent) < 0) parents.push(parent);
	}
	for (const group of selectedInternalGroups) if (parents.indexOf(group) < 0) parents.push(group);
	if (!parents.length) return;
	// 只选了内建模型里的元素：保持原样，便于直接编辑引用模型内部
	if (!selectedInternalGroups.length && parents.every(isBuiltInModelGroup)) return;
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
			try { Group.first_selected = group; } catch (e) { /* ignore */ }
			try {
				const arr = Group.multi_selected;
				if (Array.isArray(arr)) {
					const at = arr.indexOf(group);
					if (at > 0) arr.splice(at, 1);
					if (at !== 0) arr.unshift(group);
				}
			} catch (e) { /* ignore */ }
			for (const child of (group.children || [])) {
				if (!isSelected(child)) changed = true;
				pushSelected(child);
			}
		};
		for (const parent of parents) {
			if (parent.selected && isSelected(parent) && (parent.children || []).every(isSelected)) continue;
			selectWholeGroup(parent);
		}
		// internal 直接上溯，直到引用模型（model）后停止
		let node = parents[0] || null;
		while (isGroup(node)) {
			const type = typeOf(node);
			const children = (node.children || []);
			if (type === 'internal' || type === 'model' || (children.length && children.every(isSelected))) selectWholeGroup(node);
			if (type === 'model') break;
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

/** 锁定基线仓库：模块级变量在插件重载 / 脚本重新求值后会被重建，
 *  而 `locked = true` 是写在元素对象上的，能活下来 → 重载后就再也解不开。
 *  用 globalThis 保存（跨重载存活），并在每次解锁时按 uuid 找回基线。 */
function simLockStore() {
	const key = '__immLockStore';
	if (!globalThis[key]) globalThis[key] = new Map();
	return globalThis[key];
}

function nodeKey(node) {
	if (!node) return '';
	return String(node.uuid || node.name || '') + '|' + String(node.type || '');
}

function simLockGroup(group, on) {
	if (!group) return;
	const store = simLockStore();
	const key = nodeKey(group);
	if (on) {
		// 已经有基线（本组或祖先）就不重复记录，避免把“已被锁”当成原始状态
		let ancestor = group;
		while (ancestor) {
			if (store.has(nodeKey(ancestor))) return;
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
		store.set(key, saved);
		for (const pair of saved) { try { pair[0].locked = true; } catch (e) { /* ignore */ } }
		guardLockedSelection();
	} else {
		const saved = store.get(key);
		if (!saved) return;
		for (const pair of saved) { try { pair[0].locked = pair[1]; } catch (e) { /* ignore */ } }
		store.delete(key);
	}
}

/** 把基线仓库里所有还记着的锁都解开（重载后 / 卸载 / 切「不处理」时的兜底） */
function simUnlockAll() {
	const store = simLockStore();
	for (const [, saved] of Array.from(store.entries())) {
		for (const pair of saved) { try { pair[0].locked = pair[1]; } catch (e) { /* ignore */ } }
	}
	store.clear();
}

/** 递归遍历分组下所有方块（视图联动必须覆盖嵌套子分组，否则 sac_slots 这类嵌套分支不会变） */
function simEachCubeDeep(node, fn) {
	for (const child of (node.children || [])) {
		if (isCube(child)) fn(child);
		else if (isGroup(child)) simEachCubeDeep(child, fn);
	}
}

/** 递归遍历分组下所有子分组 */
function simEachGroupDeep(node, fn) {
	for (const child of (node.children || [])) {
		if (!isGroup(child)) continue;
		fn(child);
		simEachGroupDeep(child, fn);
	}
}

function simRestoreGroup(group) {
	simEachCubeDeep(group, cube => simGhostCube(cube, false));
	simHideGroup(group, false);
	simEachGroupDeep(group, child => simHideGroup(child, false));
	simLockGroup(group, false);
}

/** 分组在 outliner 里的深度（用于按“祖先先、后代后”应用样式，让后代的判定覆盖祖先） */
function simGroupDepth(group) {
	let depth = 0;
	let node = group;
	while (node && node.parent && isGroup(node.parent)) { depth++; node = node.parent; }
	return depth;
}

/** uuid → 分组（复调用标签解析目标用）。
 *  必须优先用**大纲里真实存在**的分组：`Group.all` 里可能残留已从大纲移除的旧副本
 *  （实例化/复制过程留下的），它们同名同 uuid 但没有几何，解析到它们等于什么也没做。 */
function simUuidIndex() {
	if (sim.uuidIndex) return sim.uuidIndex;
	const index = new Map();
	const walk = (nodes) => {
		for (const n of nodes || []) {
			if (!isGroup(n)) continue;
			if (n.uuid) index.set(String(n.uuid), n);
			walk(n.children);
		}
	};
	walk((typeof Outliner !== 'undefined' && Outliner && Outliner.root) ? Outliner.root : []);
	sim.uuidIndex = index;
	return index;
}

function simGroupByUuid(uuid) {
	const key = String(uuid || '').trim();
	if (!key) return null;
	const index = simUuidIndex();
	if (index.has(key)) return index.get(key);
	// 兜底：目标不在大纲里（被折叠进别的分支 / 尚未实例化），最后才看 Group.all
	try {
		const all = (typeof Group !== 'undefined' && Group && Group.all) ? Group.all : [];
		for (const group of all) if (group && String(group.uuid) === key) return group;
	} catch (e) { /* ignore */ }
	return null;
}

/** 一个分支分组“实际显示的是什么”：
 *  - 直属子分组（`[5]` 里直接放着 sacpack1…sacpack5）
 *  - 直属复调用标签指向的目标分组（`[4]` 里只有 4 个标签 → 指向 sacpack1…sacpack4）
 *  只收「直属」这一层：更深的 range/select/condition 分支由它自己那一轮处理。
 *  现实数据里 `[4]`..`[1]` 分支**没有自己的几何**，只有一串复调用标签，
 *  它们的模型其实挂在外面的 `[5]` 里；不顺着标签找到目标，
 *  切到 4/3/2/1 时就没有任何东西变实，洋葱皮完全看不出来。 */
function simBranchContent(branch) {
	const set = new Set();
	if (!branch || !isGroup(branch)) return set;
	set.add(branch);
	const targets = new Set();
	const resolveLocator = (locator) => {
		const target = simGroupByUuid(locator && locator.imda_call_target);
		if (!target) return;
		targets.add(target);
		// target 自己也可能只是一串标签，继续展开
		for (const child of (target.children || [])) if (isLocator(child)) resolveLocator(child);
	};
	for (const child of (branch.children || [])) {
		if (isGroup(child)) set.add(child);
		else if (isLocator(child)) resolveLocator(child);
	}
	// 目标分组及其直属子分组一并纳入（复调用指向的是「一串弹匣」）
	for (const target of targets) {
		set.add(target);
		for (const child of (target.children || [])) if (isGroup(child)) set.add(child);
	}
	return set;
}

/** 临时实例化的复调用副本：locator.uuid → { locator, group }。
 *  位姿不一致时只能复制一份来“点亮”，熄灭时必须删掉、把状态还给复调用标签。 */
const simTempCalls = new Map();

function simTempCallKey(locator) {
	return String((locator && (locator.uuid || locator.name)) || '');
}

/** 删除某个复调用标签对应的临时副本（只删我们自己建、带标记的那一份） */
function simDropCallInstance(locator) {
	const key = simTempCallKey(locator);
	const record = simTempCalls.get(key);
	if (!record) return false;
	simTempCalls.delete(key);
	const group = record.group;
	if (!group || !group.__immTempCall) return false;
	try { simRestoreGroup(group); } catch (e) { /* ignore */ }
	try { group.remove(); } catch (e) { /* ignore */ }
	return true;
}

/** 熄灭 / 关闭联动 / 重载兜底：把所有临时副本收掉 */
function simDropAllCallInstances() {
	let dropped = 0;
	for (const key of Array.from(simTempCalls.keys())) {
		try { if (simDropCallInstance({ uuid: key })) dropped++; } catch (e) { /* ignore */ }
	}
	// 兜底：标记还在、登记表丢了的（插件重载）也从大纲里摘掉
	try {
		const found = [];
		const walk = (nodes) => {
			for (const node of nodes || []) {
				if (!isGroup(node)) continue;
				if (node.__immTempCall) found.push(node);
				else walk(node.children);
			}
		};
		walk((typeof Outliner !== 'undefined' && Outliner && Outliner.root) ? Outliner.root : []);
		for (const group of found) { try { group.remove(); } catch (e) { /* ignore */ } }
		dropped += found.length;
	} catch (e) { /* ignore */ }
	return dropped;
}

/** 位姿不一致时的临时实例化：复制目标分组一份、摆到标签的位姿上，标记为临时。
 *  仅在「标签所在分支被选中」且位姿不一致时调用；熄灭时由 simDropCallInstance 收回。 */
function simEnsureCallInstance(locator, target) {
	if (!locator || !target) return null;
	const key = simTempCallKey(locator);
	const existing = simTempCalls.get(key);
	if (existing && existing.group && existing.group.__immTempCall) return existing.group;
	let created = null;
	try {
		created = (typeof target.duplicate === 'function') ? target.duplicate()
			: ((typeof target.clone === 'function') ? target.clone() : null);
	} catch (e) { created = null; }
	if (!created) return null;
	try {
		// 只做“点亮”用的视图副本：绝不参与导出，避免被误保存后污染资源包
		created.export = false;
		created.__immTempCall = true;
		created.name = '临时实例 ' + String(target.name || '');
		const oldOrigin = Array.isArray(created.origin) ? created.origin.slice() : [0, 0, 0];
		const nextOrigin = Array.isArray(locator.position) ? locator.position.slice() : oldOrigin;
		try { translateGroupCoordinates(created, [nextOrigin[0] - oldOrigin[0], nextOrigin[1] - oldOrigin[1], nextOrigin[2] - oldOrigin[2]]); } catch (e) { /* ignore */ }
		created.origin = nextOrigin;
		created.rotation = Array.isArray(locator.rotation) ? locator.rotation.slice() : (created.rotation || [0, 0, 0]);
		created.selected = false;
		const parent = locator.parent && isGroup(locator.parent) ? locator.parent : null;
		// duplicate() 会把副本插到目标分组的兄弟位置；用 addTo 正规挪到标签的父级
		// （addTo 会先把它从旧父级的 children 里摘掉，不会留两份）
		try { if (parent) created.addTo(parent); } catch (e) { /* ignore */ }
		created.isOpen = false;
		simTempCalls.set(key, { locator, group: created });
		try { if (created.preview_controller && created.preview_controller.updateTransform) created.preview_controller.updateTransform(created); } catch (e) { /* ignore */ }
		return created;
	} catch (e) {
		try { if (created) created.remove(); } catch (err) { /* ignore */ }
		return null;
	}
}

/** 复调用标签与目标分组的位姿是否“完全相同”（枢轴点位姿对齐）。
 *  对齐时可以**直接把源节点点亮**（不再复制一份），否则只能临时实例化/降级处理。 */
function simPoseIsSame(locator, target) {
	if (!locator || !target) return false;
	const eps = 1e-4;
	const pos = Array.isArray(locator.position) ? locator.position : null;
	const origin = Array.isArray(target.origin) ? target.origin : null;
	if (!pos || !origin) return false;
	for (let a = 0; a < 3; a++) if (Math.abs(Number(pos[a]) - Number(origin[a])) > eps) return false;
	const rotA = Array.isArray(locator.rotation) ? locator.rotation : [0, 0, 0];
	const rotB = Array.isArray(target.rotation) ? target.rotation : [0, 0, 0];
	for (let a = 0; a < 3; a++) if (Math.abs(Number(rotA[a]) - Number(rotB[a])) > eps) return false;
	return true;
}

/** 把一个已命中分支里的「位姿对齐的复调用标签」的源节点点亮。
 *  规则：源节点与标签枢轴位姿完全一致 → 不复制，直接把源分组（及其直属子分组）临时置为可见/不透明，
 *  并且**优先级高于未命中隐藏**：同一分组即使被别的分支标成不活跃，也仍然亮着。
 *  位姿不一致时不点亮（复制语义要实例化，等确认后再做），只记账供诊断。 */
function simLightUpCallTargets(state, mark) {
	const lit = [];
	const mismatched = [];
	if (!state || typeof mark !== 'function') return { lit, mismatched };
	const walk = (nodes) => {
		for (const node of (nodes || [])) {
			if (isLocator(node)) {
				const target = simGroupByUuid(node.imda_call_target);
				if (!target) continue;
				// 标签自己必须处在一个“被选中”的分支里，否则它根本不显示，点亮没有意义
				let ancestor = node.parent;
				let active = null;
				while (ancestor && isGroup(ancestor)) {
					if (state.has(ancestor)) { active = !!state.get(ancestor); break; }
					ancestor = ancestor.parent;
				}
				if (active !== true) continue;
				if (simPoseIsSame(node, target)) {
					if (lit.indexOf(target) < 0) lit.push(target);
				} else {
					mismatched.push({ locator: node, target });
				}
				continue;
			}
			if (isGroup(node)) walk(node.children);
		}
	};
	try { walk((typeof Outliner !== 'undefined' && Outliner && Outliner.root) ? Outliner.root : []); } catch (e) { /* ignore */ }
	// 点亮 = 强制活跃；mark 是 OR 合并，所以天然压过“未命中的不活跃”。
	// 只点亮目标分组本身：它内部的分支该不该亮，仍由它自己那一轮 trace 决定
	// （deep 标记会把目标里未选中的子分支也强行点亮，洋葱皮就没了）。
	for (const target of lit) mark(target, true);
	// 位姿不一致的：临时实例化一份并标记点亮；熄灭时收回（只动我们自己建的副本）
	for (const item of mismatched) {
		const copy = simEnsureCallInstance(item.locator, item.target);
		if (copy) mark(copy, true);
	}
	// 已经不再被点亮的临时副本立刻收掉，避免关掉分支后留一份“幽灵分身”
	try {
		for (const [key, record] of Array.from(simTempCalls.entries())) {
			if (!record || !record.locator) continue;
			const stillWanted = mismatched.some(item => simTempCallKey(item.locator) === key);
			if (!stillWanted) simDropCallInstance(record.locator);
		}
	} catch (e) { /* ignore */ }
	return { lit, mismatched };
}

/** simViewEntries 的输入缓存：simTick 求值时会顺带记录分支容器的选中情况 */
function simTraceEvaluate(mapping, inputs) {
	const trace = { seen: new Set(), selected: new Set() };
	const items = simEvaluate(mapping && mapping.model, inputs, trace);
	return { items, trace };
}

function simViewEntries(items) {
	const map = sim.groupNodes;
	if (!map) return [];
	const trace = sim.lastTrace || null;
	const hitGroups = new Set();
	const mappedGroups = new Set();   // 仅用于找「分支容器」
	const itemGroups = new Set();     // 真正产出 item 的分组（才进 entries 第 1 类）
	try { for (const group of map.values()) if (group) mappedGroups.add(group); } catch (e) { /* ignore */ }
	for (const item of items || []) {
		// 1) 整条分支链：`sac_slots → [5] → 调用 sacpack2 → [0] _empty2` 每一层都要有活性，
		//    只取最内层（旧 branch）会被外层覆盖，多级嵌套就判不出“哪一支真的在显示”。
		//    并且必须「整条链都选中」才算活跃：外层 [5] 没被选中时，内层 _empty2 虽然自己
		//    这一档命中了，屏幕上根本看不到它，不能把它当成活跃分支。
		const chain = Array.isArray(item && item.branches) ? item.branches : [];
		if (chain.length) {
			// 每一层 range/select/condition 都记录了自己有没有被选中（active）；
			// 只有**整条链都选中**时，这个 item 才真的会显示出来（item.hit 已经是各层相与）。
			const chainActive = chain.every(link => link && link.active);
			for (const link of chain) {
				const group = link && link.node ? map.get(link.node) : null;
				if (!group) continue;
				mappedGroups.add(group);
				itemGroups.add(group);
				if (chainActive) hitGroups.add(group);
			}
			// 叶子：只有整条链都选中、且自身 truly hit，才算“真的会被渲染”
			const leafGroup = map.get(item && item.node);
			if (leafGroup) {
				mappedGroups.add(leafGroup);
				itemGroups.add(leafGroup);
				if (chainActive && item.hit) hitGroups.add(leafGroup);
			}
			continue;
		}
		// 2) 兜底：没有 branches 的旧结构（或克隆 item）只看 branch / node
		const branchGroup = item && item.branch ? map.get(item.branch) : null;
		const group = branchGroup || map.get(item && item.node);
		if (!group) continue;
		mappedGroups.add(group);
		itemGroups.add(group);
		// 分支分组用 branchActive（“这一支被选中”）判定；普通分组才用 hit（“真的会被渲染”）。
		if (branchGroup ? item.branchActive : item.hit) hitGroups.add(group);
	}
	const state = new Map();
	const mark = (group, active) => { if (!group) return; state.set(group, !!state.get(group) || !!active); };
	// 1) 只有真正产出 item 的分组按命中状态进入（其余分组不参与，避免把整棵树都标成不活跃）
	for (const group of itemGroups) mark(group, hitGroups.has(group));
	// 2) 分支容器的**每个**直属子分组都参与（含没有产出 item 的空分支）。
	//    判定优先用求值时的 trace：容器选中了哪一支，是求值器直接告诉我们的；
	//    空分支（`[4] sac_slots #4` 里只有 4 个复调用标签）不产出 item，
	//    光看“有没有命中节点”永远判不出它到底该不该显示。
	const nodeOfGroup = new Map();
	try { for (const [node, group] of map) if (group && !nodeOfGroup.has(group)) nodeOfGroup.set(group, node); } catch (e) { /* ignore */ }
	const traceSeen = (trace && trace.seen) || null;
	const traceSelected = (trace && trace.selected) || null;
	const activityOf = (child) => {
		const node = nodeOfGroup.get(child);
		if (node && traceSeen && traceSeen.has(node)) return !!(traceSelected && traceSelected.has(node));
		// 没有 trace（旧数据 / 未进映射的分支）时退回“自身或后代有命中节点”
		let active = hitGroups.has(child);
		if (!active) simEachGroupDeep(child, node2 => { if (hitGroups.has(node2)) active = true; });
		return active;
	};
	for (const group of mappedGroups) {
		const parent = group.parent;
		if (!parent || !isGroup(parent)) continue;
		const type = String(parent.imda_type || '').replace(/^minecraft:/, '');
		if (type !== 'range_dispatch' && type !== 'condition' && type !== 'select') continue;
		for (const child of (parent.children || [])) {
			if (!isGroup(child)) continue;
			const active = activityOf(child);
			// 分支的「内容」不只是它自己：`[4]` 里只有一串复调用标签，
			// 真正的模型挂在标签指向的分组上（那些分组物理上位于 `[5]` 里）。
			// 只标记分支节点本身的话，切到 4/3/2/1 时没有任何东西变实，
			// 看上去就是「整块都变洋葱皮」——用户说的“没呈现出洋葱皮效果”。
			// mark 是「活跃优先」（OR）：同一个分组被活跃分支引用时不会被别的分支抹成不活跃，
			// 应用时按深度从浅到深，深层的活跃判定会覆盖祖先的整棵递归。
			for (const target of simBranchContent(child)) mark(target, active);
		}
	}
	// 3) 复调用标签「位姿完全对齐」时直接点亮源节点（点在就亮，而不是复制一份）。
	//    OR 合并保证它压过上面因未命中得到的 inactive；熄灭时还原成普通的未命中状态。
	try {
		const lights = simLightUpCallTargets(state, mark);
		sim.lastLights = lights;
	} catch (e) { sim.lastLights = null; }
	const entries = [];
	for (const [group, active] of state) entries.push({ group, active });
	// 祖先先应用、后代后应用：`[5]` 是活跃的（会把 70 个方块全部恢复不透明），
	// 若它排在 `[2] _full2`（不活跃、要半透明）之后，就会把内层的半透明又擦掉。
	entries.sort((a, b) => simGroupDepth(a.group) - simGroupDepth(b.group));
	return entries;
}

function simRestoreView() {
	// 1) 按清单恢复（覆盖不在大纲里的临时分组；单测与内部调用会用到）
	if (sim.viewTouched) {
		for (const group of Array.from(sim.viewTouched)) {
			try { simRestoreGroup(group); } catch (e) { /* ignore */ }
		}
		sim.viewTouched.clear();
	}
	// 2) 再全量扫一遍大纲：`__immGhost` / `__immHidden` 是挂在 mesh 上的标记，
	//    插件重载（或 sim 对象被重建）后清单会丢，标记却还在，
	//    于是「不活跃分支 = 不处理」看起来仍是半透明 + 锁定，且再没人去解开。
	const groups = [];
	const cubes = [];
	const walk = (nodes) => {
		for (const node of nodes || []) {
			if (isGroup(node)) { groups.push(node); walk(node.children); }
			else if (isCube(node)) cubes.push(node);
		}
	};
	try { walk((typeof Outliner !== 'undefined' && Outliner && Outliner.root) ? Outliner.root : []); } catch (e) { /* ignore */ }
	for (const cube of cubes) { try { simGhostCube(cube, false); } catch (e) { /* ignore */ } }
	for (const group of groups) { try { simHideGroup(group, false); } catch (e) { /* ignore */ } }
	// 3) 锁一律按基线仓库还原（仓库放在 globalThis，重载后还在）
	try { simUnlockAll(); } catch (e) { /* ignore */ }
	// 4) 临时实例化的复调用副本全部收回（熄灭 = 变回复调用标签）
	try { simDropAllCallInstances(); } catch (e) { /* ignore */ }
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
			simEachGroupDeep(group, child => simHideGroup(child, false));
			// 递归到所有后代方块：嵌套子分组里的方块也要变半透明
			simEachCubeDeep(group, cube => simGhostCube(cube, !entry.active));
		} else if (baseMode === 'hide') {
			simEachCubeDeep(group, cube => simGhostCube(cube, false));
			simHideGroup(group, !entry.active);
			// 递归隐藏所有后代分组（Blockbench 每个分组有独立 mesh，只隐藏父级不会隐藏子级）
			simEachGroupDeep(group, child => simHideGroup(child, !entry.active));
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
	// 关掉锁定 / 切到「不处理」时也要把之前的锁全部解开：
	// 只按 viewTouched 恢复的话，重载插件后清单是空的，锁会永久留下。
	if (!lock) {
		for (const group of seen) simLockGroup(group, false);
		simUnlockAll();
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
	if (!sim_panel) { try { if (typeof Panels !== 'undefined' && Panels['imda_sim_panel']) sim_panel = Panels['imda_sim_panel']; } catch (e) { /* ignore */ } }
	if (sim_panel) { if (show_panel !== false) sim_panel.show(); return sim_panel; }
	if (typeof Panel === 'undefined' || typeof document === 'undefined') return null;
	sim_panel = new Panel('imda_sim_panel', { name: '模拟输入', icon: 'play_circle', condition: { formats: [FORMAT_ID] }, default_position: { slot: 'right_bar', float: false }, resizable: true, growable: true });
	const root = document.createElement('div');
	root.style.cssText = 'padding:8px;display:flex;flex-direction:column;gap:4px;font-size:12px;overflow:hidden;height:100%';
	// 控制条固定在顶部，行与结果放进可滚动区：滚到任何位置都能点「运行 / 停止 / 刷新」
	const scrollBody = document.createElement('div');
	scrollBody.style.cssText = 'display:flex;flex-direction:column;gap:4px;flex:1 1 auto;overflow:auto;min-height:0';
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
		stateEl.title = '勾选后这一类的数值槽会自动变化（点上方「运行」生效）；不勾选只是不自动变化，手动值照样参与求值';
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
			slotEnable.title = '这个槽要不要参与自动变化（点上方「运行」后生效）；不影响值的存在，也不影响手动值参与求值';
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
				// 空输入不要覆盖已记录的值：勾选/取消勾选时不应该把值“弄没”
				const text = String(val.value == null ? '' : val.value).trim();
				if (text !== '') slot.value = text;
				slot.period = Math.max(50, (Number(period.value) || 0.2) * 1000);
				if (slot.key === 'colors' || key === 'colors') {
					const list = String(presets.value || '').split(/[,\s;]+/).map(t => t.trim()).filter(Boolean).map(t => Number(t)).filter(v => isFinite(v));
					slot.presets = list.length ? list : [Number(val.value) || 0];
				}
				// 步长允许 0（= 自动变化时数值不动）；只有留空/非法才回退默认 0.5
				const stepText = String(step.value == null ? '' : step.value).trim();
				slot.step = (stepText === '' || !isFinite(Number(stepText))) ? 0.5 : Number(stepText);
				slot.rule = rule.value;
				slot.min = Number(minI.value) || 0;
				slot.max = Number(maxI.value) || 4;
			};
			// 复选框 = 「要不要自动变化」，与值是否存在无关：不勾也不变淡、值照常参与求值，
			// 只在槽名后面标一个「不自动」提醒。
			const refreshSlotState = () => {
				slotName.textContent = (multi ? ('槽 ' + (slotIndex + 1)) : '取值') + (slot.enabled ? '' : '（不自动）');
				slotBox.style.opacity = '1';
			};
			const setSlotOpen = (open) => {
				slot.open = open;
				slotBody.style.display = open ? 'flex' : 'none';
				slotToggle.textContent = open ? '▾' : '▸';
			};
			slotToggle.addEventListener('click', (event) => { if (event && event.preventDefault) event.preventDefault(); setSlotOpen(!slot.open); });
			// 改值 / 改索引【不】碰任何复选框：复选框只是「要不要自动变化」，
			// 手动输入的值无论如何都参与求值，所以不需要替用户勾上什么。
			val.addEventListener('input', () => { readSlot(); simScheduleTick(); });
			val.addEventListener('change', () => { readSlot(); simScheduleTick(); });
			idx.addEventListener('input', () => { readSlot(); simScheduleTick(); });
			// 勾选/取消勾选只切换「要不要自动变化」，不回写输入框内容，也不影响求值
			slotEnable.addEventListener('change', () => { slot.enabled = slotEnable.checked; refreshSlotState(); simUpdateRunUi(); simTick(); });
			[period, step, rule, minI, maxI, presets].forEach(el => el.addEventListener('change', () => { readSlot(); refreshSlotState(); simUpdateRunUi(); simTick(); }));
			slot.els = { toggle: slotToggle, body: slotBody, enable: slotEnable, idx, val, badge, usage: usageEl, period, step, rule, min: minI, max: maxI, presets,
				// 只读镜像：方便测试/调试确认“存下来的值”，不参与逻辑
				get slotValue() { return slot.value; }, get slotStep() { return slot.step; }, get slotIndex() { return slot.index; } };
			refreshSlotState();
			setSlotOpen(false);
			row.slots.push(slot);
		}
		box.appendChild(header);
		box.appendChild(body);
		scrollBody.appendChild(box);
		row.els = { enable, state: stateEl, toggle: rowToggle, body };
		enable.addEventListener('change', () => { row.enabled = enable.checked; refreshRowState(); simUpdateRunUi(); simTick(); });
		refreshRowState();
		setRowOpen(true);
		sim_ui.rows[key] = row;
	}
	const controlRow = mk('div', {}, 'display:flex;align-items:center;gap:8px;flex:0 0 auto;padding:2px 0 6px;border-bottom:1px solid rgba(128,128,128,.3)');
	const runBtn = mk('button', { textContent: '▶ 运行' }, 'padding:4px 10px;');
	const stepBtn = mk('button', { textContent: '⏭ 步进', title: '把勾选的自动槽往前推一格（走一步、立刻求值，不启动循环）' }, 'padding:4px 10px;');
	const statusEl = mk('span', { textContent: '已停止' }, 'font-size:10px;opacity:.75');
	controlRow.appendChild(runBtn);
	controlRow.appendChild(stepBtn);
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
	stepBtn.addEventListener('click', () => simStepOnce());
	refreshBtn.addEventListener('click', () => { simInvalidate(); simTick(); });
	root.appendChild(controlRow);
	root.appendChild(scrollBody);
	scrollBody.appendChild(out);
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
			const type = String(node.imda_type || '').replace(/^minecraft:/, '');
			const propRaw = String(node.imda_property || '').replace(/^minecraft:/, '').trim();
			const prop = propRaw || ((type === 'range_dispatch' || type === 'select' || type === 'condition') ? 'custom_model_data' : '');
			const index = Number(node.imda_index) || 0;
			const name = labelOf(node);
			const branchChildren = (node.children || []).filter(isGroup).map(c => labelOf(c));
			// colors：按分组 tints 配置（custom_model_data + index）关联；明确“不生成”则不关联
			const tintIndices = new Set();
			if (node.imda_tint_type !== '' && node.imda_tint_type !== 'none') {
				const tintType = String(node.imda_tint_type == null ? 'custom_model_data' : node.imda_tint_type).replace(/^minecraft:/, '').trim() || 'custom_model_data';
				const rawTintIndex = String(node.imda_tint_index == null ? '' : node.imda_tint_index).trim();
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

/** 按输入求值整棵映射树，返回 [{ node, hit }]；hit=false 表示该分支没有被选中。
 *  第三个参数 trace 可选：{ seen:Set, selected:Set } 记录“容器下出现了哪些分支节点、选中了哪些”。
 *  空分支（只有复调用标签 / 空 composite）不产出 item，只能靠 trace 才知道它被选中了。 */
function simEvaluate(node, inputs, trace) {
	const result = [];
	if (!node) return result;
	const noteSeen = (child) => { if (trace && trace.seen && child) trace.seen.add(child); };
	const noteSelected = (child) => {
		if (!trace || !child) return;
		if (trace.seen) trace.seen.add(child);
		if (trace.selected) trace.selected.add(child);
	};
	const type = String(node.type || '').replace(/^minecraft:/, '');
	if (type === 'composite') {
		for (const child of node.models || []) result.push(...simEvaluate(child, inputs, trace));
		return result;
	}
	// 每个 item 带一条「分支链」：从最外层容器到最内层，记录每一层选了哪一支、是否选中。
	// 只记最内层的 branch 是不够的——外层 range_dispatch 包装时会把内层的 branch 覆盖掉，
	// 视图联动就只能看到最外层分支，`[5] → 调用 sacpack2 → [0] _empty2` 这类多级结构全都判不出来。
	const pushWithChain = (item, branchNode, branchActive) => {
		const branches = (item.branches || []).concat([{ node: branchNode, active: !!branchActive }]);
		result.push({ node: item.node, hit: item.hit, branch: branchNode, branchActive: !!branchActive, branches });
	};
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
			noteSeen(entry.model);
			if (isBest) noteSelected(entry.model);
			for (const item of simEvaluate(entry.model, inputs, trace)) {
				pushWithChain({ node: item.node, hit: item.hit && isBest, branches: item.branches }, entry.model, isBest);
			}
		}
		// 没有命中的阈值时才用 fallback（原实现条件写反了）
		if (!best && node.fallback) {
			noteSelected(node.fallback);
			for (const item of simEvaluate(node.fallback, inputs, trace)) pushWithChain(item, node.fallback, true);
		}
		return result;
	}
	if (type === 'select') {
		const value = simSelectValue(node, inputs);
		let matched = null;
		for (const item of node.cases || []) {
			const isMatch = !matched && simWhenMatches(item && item.when, value);
			if (isMatch) matched = item;
			noteSeen(item.model);
			if (isMatch) noteSelected(item.model);
			for (const model of simEvaluate(item.model, inputs, trace)) {
				pushWithChain({ node: model.node, hit: model.hit && isMatch, branches: model.branches }, item.model, isMatch);
			}
		}
		if (!matched && node.fallback) {
			noteSelected(node.fallback);
			for (const item of simEvaluate(node.fallback, inputs, trace)) pushWithChain(item, node.fallback, true);
		}
		return result;
	}
	if (type === 'condition') {
		// 被选中的那一支算命中；另一支也求值但标 hit=false（结果区与视图联动都要知道它没生效）
		const ok = simConditionValue(node, inputs);
		noteSeen(node.on_true); noteSeen(node.on_false);
		noteSelected(ok ? node.on_true : node.on_false);
		for (const item of simEvaluate(ok ? node.on_true : node.on_false, inputs, trace)) pushWithChain(item, ok ? node.on_true : node.on_false, true);
		for (const item of simEvaluate(ok ? node.on_false : node.on_true, inputs, trace)) pushWithChain({ node: item.node, hit: false, branches: item.branches }, ok ? node.on_false : node.on_true, false);
		return result;
	}
	if (type === 'model') { result.push({ node, hit: true, branches: [] }); return result; }
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
		// 复选框只控制「是否参与自动变化」，不控制值是否存在：
		// 手动值一律写进 inputs 参与求值，勾不勾都一样。
		for (const slot of row.slots) {
			simApplySlot(inputs, key, slot);
			lines.push(simSlotLabel(key, slot));
		}
	}
	// 求值时顺带记录“每个分支容器选了哪一支”，视图联动靠它判定空分支的活性
	const traced = simTraceEvaluate(mapping, inputs);
	const items = traced.items;
	const hits = items.filter(item => item.hit && item.node.model).map(item => item.node.model);
	sim.lastItems = items;
	sim.lastTrace = traced.trace;
	try { simApplyView(items); } catch (error) { /* ignore */ }
	try { simApplyTints(); } catch (error) { /* ignore */ }
	// 每个槽单独求值一次，得到它自己的命中数（角标）
	for (const key of Object.keys(sim_ui.rows)) {
		const row = sim_ui.rows[key];
		for (const slot of row.slots) {
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
		// 两个复选框都只是「运行开关」，不影响值是否存在 / 是否参与求值：
		// 大类复选框 = 这一类的自动变化；槽复选框 = 这一个槽的自动变化。
		if (!row.enabled || row.kind !== 'number') continue;
		for (const slot of row.slots) if (slot.enabled) list.push({ key, slot });
	}
	return list;
}

/** 把一个自动槽往前推一格（运行循环与「步进」按钮共用同一套推进规则）。
 *  返回是否真的有槽被推进。 */
function simAdvanceSlot(item) {
	if (!item || !item.slot) return false;
	const slot = item.slot;
	if (item.key === 'colors') {
		const list = (slot.presets && slot.presets.length) ? slot.presets : [Number(slot.value) || 0];
		slot.presetIndex = ((slot.presetIndex || 0) + 1) % list.length;
		slot.value = String(list[slot.presetIndex]);
	} else {
		let value = num(slot.value) + slot.step * slot.dir;
		if (slot.rule === 'wrap') { if (value > slot.max) value = slot.min; }
		else {
			if (value > slot.max) { value = slot.max; slot.dir = -1; }
			if (value < slot.min) { value = slot.min; slot.dir = 1; }
		}
		slot.value = String(value);
	}
	if (slot.els && slot.els.val) slot.els.val.value = slot.value;
	return true;
}

/** 「步进」按钮：所有勾选的自动槽各推进一格，立刻求值。不启动循环、不改运行状态。 */
function simStepOnce() {
	const autos = simAutoSlots();
	if (!autos.length) {
		Blockbench.showQuickMessage('没有勾选要步进的大类：先勾上数值输入（如 cmdata.floats / colors）前面的复选框', 3500);
		return 0;
	}
	let moved = 0;
	for (const item of autos) { try { if (simAdvanceSlot(item)) moved++; } catch (e) { /* ignore */ } }
	try { simTick(); } catch (e) { /* ignore */ }
	try { simApplyTints(); } catch (e) { /* ignore */ }
	if (moved) {
		const label = autos.map(item => simSlotLabel(item.key, item.slot)).join('，');
		try { Blockbench.showQuickMessage('步进：' + label, 2200); } catch (e) { /* ignore */ }
	}
	return moved;
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
				simAdvanceSlot(item);
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
		id: 'imda_simulator',
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
			const stepValue = (result.step == null || String(result.step).trim() === '' || !isFinite(Number(result.step))) ? 0.5 : Number(result.step);
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
		try { if (typeof Animation !== 'undefined') {
			new Property(Animation, 'string', 'imda_timeline_property', { default: 'custom_model_data', label: '时间轴 range_dispatch property', description: 'custom_model_data / cooldown / count / damage / time / use_cycle / use_duration / compass 等' });
			new Property(Animation, 'number', 'imda_timeline_index', { default: 0, label: '时间轴 custom_model_data index' });
	new Property(Animation, 'string', 'imda_timeline_target', { default: '', label: '时间轴 compass target' });
	new Property(Animation, 'string', 'imda_timeline_source', { default: '', label: '时间轴 time source' });
	new Property(Animation, 'boolean', 'imda_timeline_wobble', { default: true, label: '时间轴 wobble' });
	new Property(Animation, 'boolean', 'imda_timeline_normalize', { default: true, label: '时间轴 normalize' });
	new Property(Animation, 'number', 'imda_timeline_period', { default: 1, label: '时间轴 use_cycle period' });
	new Property(Animation, 'boolean', 'imda_timeline_remaining', { default: false, label: '时间轴 use_duration remaining' });
		} } catch (e) { /* ignore */ }
	const cond = { formats: [FORMAT_ID] };
	const P = (target, type, name, options) => new Property(target, type, name, Object.assign({ condition: cond, exposed: true }, options));
P(ModelProject, 'string', 'imda_namespace', { label: '命名空间（可带子空间，如 sqsptst:weapon/shotgun）', default: 'custom' });
	P(ModelProject, 'boolean', 'imda_center_pivot', { label: '旋转枢轴用 (0.5,0.5,0.5)（= 像素 8,8,8）', default: false });
	P(ModelProject, 'boolean', 'imda_block_display', { label: '模型附带“显示调整”页的 display', default: true });
P(ModelProject, 'number', 'imda_anim_fps', { label: '时间轴 FPS', default: 20, min: 1, max: 120 });
P(ModelProject, 'number', 'imda_anim_index', { label: '时间轴 custom_model_data index', default: 0 });
P(ModelProject, 'string', 'imda_anim_property', { label: '时间轴 range_dispatch property', default: 'custom_model_data' });
P(ModelProject, 'number', 'imda_extra_composite_layers', { label: '调试：额外空 composite 层数', default: 0, min: 0, max: 10 });
	P(ModelProject, 'boolean', 'imda_display_all_slots', { label: 'display 输出全部槽位（GUI/地面/固定）', default: false });
	P(ModelProject, 'boolean', 'imda_export_node_names', { label: '输出 node_name（来源分组名）', default: true });
	P(ModelProject, 'boolean', 'imda_anim_auto', { label: '导出时自动采样动画时间轴', default: true });
	P(ModelProject, 'boolean', 'imda_hand_animation_on_swap', { label: 'hand_animation_on_swap（切换物品时播放过渡动画）', default: true });
	P(ModelProject, 'boolean', 'imda_oversized_in_gui', { label: 'oversized_in_gui（GUI 内允许超出槽位）', default: false });
	P(ModelProject, 'number', 'imda_swap_animation_scale', { label: 'swap_animation_scale（切换动画速度倍率）', default: 1, min: 0, step: 0.05 });
	P(ModelProject, 'boolean', 'imda_hide_unavailable', { label: '隐藏当前条件下不可用的分组', default: true });
	P(ModelProject, 'string', 'imda_pack_path', { label: '资源包工程路径（pack.mcmeta 所在目录）', default: '' });
	P(ModelProject, 'string', 'imda_mapping_cache', { default: '', exposed: false });
	P(ModelProject, 'string', 'imda_all_items_blacklist', { label: '全物品模型表：黑名单正则（每行一个）', default: '' });
	P(ModelProject, 'string', 'imda_pack_version', {
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

	P(Group, 'string', 'imda_type', { label: '映射类型（type）', description: '语法：{"type": "minecraft:<类型>"}\n作用：决定本节点是哪一种物品模型映射。\ncomposite=结构分组；inline=内联模型（本组方块烘焙成模型）；model=引用模型；internal=内部结构（引用模型内部骨骼，不单独导出）；还有 range_dispatch / condition / select / empty', default: 'composite', enum_values: MAPPING_TYPES });
	P(Group, 'string', 'imda_model', { label: '引用模型（imda_model）', default: '' });
	P(Group, 'string', 'imda_display_mode', { label: '强制统一显示调整', default: 'copy' });
	try { new Property(Group, 'string', 'imda_model_shift', { default: '', exposed: false, condition: cond }); } catch (e) { /* ignore */ }
	try { new Property(Group, 'string', 'imda_model_origin', { default: '', exposed: false, condition: cond }); } catch (e) { /* ignore */ }
	try { new Property(Group, 'string', 'imda_pivot_offset', { default: '', exposed: false, condition: cond }); } catch (e) { /* ignore */ }
	try { new Property(Cube, 'string', 'imda_pivot_offset', { default: '', exposed: false, condition: cond }); } catch (e) { /* ignore */ }
	if (typeof Locator !== 'undefined') {
		try { new Property(Locator, 'string', 'imda_call_target', { label: '复调用目标（分组 UUID 或模型 id）', default: '', exposed: false }); } catch (e) { /* ignore */ }
		try { new Property(Locator, 'string', 'imda_call_threshold', { label: '复调用阈值覆盖', default: '', exposed: false }); } catch (e) { /* ignore */ }
		try { new Property(Locator, 'string', 'imda_call_property', { label: '复调用 property 覆盖', default: '', exposed: false }); } catch (e) { /* ignore */ }
		try { new Property(Locator, 'string', 'imda_call_index', { label: '复调用 index 覆盖', default: '', exposed: false }); } catch (e) { /* ignore */ }
		try { new Property(Locator, 'string', 'imda_call_scale', { label: '复调用 scale 覆盖', default: '', exposed: false }); } catch (e) { /* ignore */ }
		try { new Property(Locator, 'string', 'imda_call_overrides', { label: '复调用映射属性覆盖（JSON）', default: '', exposed: false }); } catch (e) { /* ignore */ }
		try { new Property(Locator, 'number', 'imda_frame', { default: 0, exposed: false }); } catch (e) { /* ignore */ }
		try { new Property(Locator, 'string', 'imda_pose', { default: '', exposed: false }); } catch (e) { /* ignore */ }
	}
	P(Group, 'string', 'imda_property', { label: '取值来源 / 条件（property / when）', default: '' });
	P(Group, 'number', 'imda_index', { label: 'index（仅 range_dispatch：custom_model_data 下标）', default: 0 });
	P(Group, 'string', 'imda_range_target', { label: 'compass target', default: '' });
	P(Group, 'string', 'imda_range_source', { label: 'time source', default: '' });
	P(Group, 'boolean', 'imda_range_wobble', { label: 'wobble', default: true });
	P(Group, 'boolean', 'imda_range_normalize', { label: 'normalize', default: true });
	P(Group, 'number', 'imda_range_period', { label: 'period', default: 1 });
	P(Group, 'boolean', 'imda_range_remaining', { label: 'remaining', default: false });
	P(Group, 'string', 'imda_component', { label: 'component', default: '' });
	P(Group, 'string', 'imda_case_when', { label: 'select 分支的 when（JSON 数组）', default: '' });
	P(Group, 'boolean', 'imda_align_center', { label: '引用模型导入时自动对齐到模型中点', default: false });
	P(Group, 'boolean', 'imda_ignore_default', { label: 'ignore_default', default: false });
	P(Group, 'string', 'imda_predicate', { label: 'predicate', default: '' });
	P(Group, 'string', 'imda_value', { label: 'value', default: '' });
	P(Group, 'string', 'imda_keybind', { label: 'keybind', default: '' });
	P(Group, 'string', 'imda_condition', { label: '分支条件（on_true/on_false）', default: '' });
	P(Group, 'string', 'imda_threshold_format', { label: '分支编号格式', description: 'i / i*2 / 10+i*5 / 0,1,3 / ni（n=上层编号）/ f（本容器所在层级的元素数，含自身）/ s（本容器自身的子项数，不递归）', default: '' });
	P(Group, 'number', 'imda_threshold', { label: '分支编号 / 阈值（entries[].threshold）', default: 0 });
	P(Group, 'boolean', 'imda_threshold_force', { default: false, exposed: false });
	P(Group, 'number', 'imda_scale', { label: '数值缩放（scale）', default: 1 });
	P(Group, 'string', 'imda_tint_type', { label: 'tints 来源类型', default: '', enum_values: ['', 'none', 'custom_model_data', 'constant', 'dye', 'potion', 'grass', 'team'] });
	P(Group, 'number', 'imda_tint_index', { label: 'tints 来源 index（custom_model_data）', default: 0 });
	P(Group, 'string', 'imda_tint_value', { label: 'tints 来源值（constant 的 ARGB / 其它 default）', default: '' });
	P(Group, 'string', 'imda_tints', { label: 'tints（JSON，仅 model / composite 自带模型）', default: '' });
}

function cleanOwnMenu(menu) {
	if (!menu || !Array.isArray(menu.structure)) return;
	try {
		menu.structure = menu.structure.filter(item => {
			if (!item) return true;
			const id = String(item.id || '');
			if (id.startsWith('imda_') || id.startsWith('imda_')) return false;
			const name = String(item.name || '');
			if (name.startsWith('==VCS') || name.startsWith('[ 模型装配 ]')) return false;
			return true;
		});
		menu.__imdaTimelineAdded = false;
	} catch (e) { /* ignore */ }
}

let menuAttached = false;
let locatorMenuAttached = false;
let cubeMenuAttached = false;
let menuActions = {};
/** 复调用标签右键菜单动作的唯一序号：每次给一个 Menu 对象挂动作都用新键，
 *  避免重载后旧类菜单与当前类菜单共用同一个 menuActions 键导致互删。 */
let menuActionSeq = 0;

/* ============================== 大纲 Shift 连选 ============================== */
/** Blockbench 自带 Shift 连选的两个限制，导致「1~5 分组 + 6 标签，点 6 再 Shift 点 1」
 *  只会选中 6 和 1：
 *  1. **只在同一父级的兄弟数组里取区间**（`getParentArray().forEach`），
 *     而分组走 `Group.multi_selected.last()`、元素走 `Outliner.selected.last()`，
 *     两条记忆是分开的 —— 先点标签再点分组时，两个 last 根本对不上，直接退化成普通加选。
 *  2. 分组那条分支里 `s.multiSelect()` 会**递归选中所有后代**，标签那条不会，
 *     混选时区间两端的行为不一致。
 *  这个补丁改成「按大纲可视顺序取区间」：把整个大纲展平成先序列表，
 *  用插件自己记的锚点（上一次单选/连选点到的节点）和当前节点算出闭区间，
 *  区间内的分组与元素一律按「分组递归选中、元素 markAsSelected」处理。
 *  只接管**跨父级或含复调用标签**的情形，其余情况完全交给 Blockbench 原生逻辑。 */
const outlinerRangeSelect = {
	anchor: null,       // 上一次点击落下的节点（连选起点）
	lookup: null,       // uuid → node
	order: null,        // 先序展平表
	patching: false,
	pendingFinish: false,
};

/** 大纲先序展平：只收 Group 与其子孙，顺序与 outliner 面板一致（折叠的也算，区间要跨层级） */
function outlinerFlatOrder() {
	const list = [];
	const walk = (nodes) => {
		for (const node of (nodes || [])) {
			list.push(node);
			if (isGroup(node)) walk(node.children);
		}
	};
	try { walk((typeof Outliner !== 'undefined' && Outliner && Outliner.root) ? Outliner.root : []); } catch (e) { /* ignore */ }
	return list;
}

function outlinerNodeSelected(node) {
	if (!node) return false;
	if (isGroup(node)) { try { return (Group.multi_selected || []).indexOf(node) >= 0; } catch (e) { return !!node.selected; } }
	try { return Outliner.selected.indexOf(node) >= 0; } catch (e) { return !!node.selected; }
}

/** 区间连选：把 [from, to] 之间（按先序表）的所有分组与元素都选上。
 *  返回真正被新选中的节点数；0 表示这个情形不该由我们接管。 */
function outlinerRangeSelectTo(target) {
	const order = outlinerFlatOrder();
	const anchor = outlinerRangeSelect.anchor;
	if (!anchor) return 0;
	const a = order.indexOf(anchor);
	const b = order.indexOf(target);
	if (a < 0 || b < 0) return 0;
	const from = Math.min(a, b);
	const to = Math.max(a, b);
	const touchingCallTag = order.slice(from, to + 1).some(n => isCallTagType(n));
	// 同一父级、且区间里没有复调用标签 → 交给原生逻辑（原生行为本身是对的）
	const sameParent = (anchor.parent || null) === (target.parent || null);
	if (sameParent && !touchingCallTag) return 0;
	let added = 0;
	try { Undo.initSelection(); } catch (e) { /* ignore */ }
	for (let i = from; i <= to; i++) {
		const node = order[i];
		if (!node || node.locked) continue;
		if (isGroup(node)) {
			if (!node.selected) added++;
			node.selected = true;
			try { if (typeof node.multiSelect === 'function') node.multiSelect(); } catch (e) { /* ignore */ }
			try { (Group.multi_selected || []).safePush(node); } catch (e) { /* ignore */ }
			for (const child of (node.children || [])) {
				if (child.locked) continue;
				if (!child.selected) added++;
				try { child.markAsSelected(true); } catch (e) { /* ignore */ }
			}
		} else {
			if (outlinerNodeSelected(node)) continue;
			added++;
			try { node.markAsSelected(true); } catch (e) { /* ignore */ }
			try { Outliner.selected.safePush(node); } catch (e) { /* ignore */ }
		}
	}
	try { updateSelection(); } catch (e) { /* ignore */ }
	try { TickUpdates.selection = true; } catch (e) { /* ignore */ }
	// 补一条撤销记录（原生 clickSelect 已经在 initSelection 之后被我们跳过，这里自己收尾）
	outlinerRangeSelect.pendingFinish = true;
	return added;
}

/** 接管 Group#clickSelect 与 OutlinerElement#clickSelect 的 Shift 分支 */
function installOutlinerRangeSelect() {
	if (outlinerRangeSelect.patching) return;
	if (typeof Group === 'undefined' || typeof OutlinerElement === 'undefined') return;
	outlinerRangeSelect.patching = true;
	const isImda = () => { try { return Format && Format.id === FORMAT_ID; } catch (e) { return false; } };
	/** 统一判断“这次点击要不要走区间连选” */
	const shouldRange = (node, event, outlinerClick) => {
		if (!isImda() || !outlinerClick || !event) return false;
		if (!(event.shiftKey === true || (typeof Pressing !== 'undefined' && Pressing.overrides && Pressing.overrides.shift))) return false;
		if (typeof Modes !== 'undefined' && Modes.animate) return false;
		const anchor = outlinerRangeSelect.anchor;
		if (!anchor || anchor === node) return false;
		// 锚点必须还在文档里，否则按普通加选处理
		return outlinerFlatOrder().indexOf(anchor) >= 0;
	};
	const wrap = (proto, label) => {
		const original = proto && proto.clickSelect;
		if (typeof original !== 'function' || original.__imdaRange) return;
		const patched = function (event, outlinerClick) {
			try {
				if (shouldRange(this, event, outlinerClick) && outlinerRangeSelectTo(this) > 0) {
					outlinerRangeSelect.anchor = this;
					try { Undo.finishSelection('Select elements'); } catch (e) { /* ignore */ }
					return this;
				}
			} catch (e) { /* 出错就走原生 */ }
			const result = original.call(this, event, outlinerClick);
			// 记录锚点：只有“单选”（不带 Shift/Ctrl）才重置锚点，连选时保留起点
			try {
				const multi = event && (event.shiftKey || event.ctrlKey || event.metaKey || (typeof Pressing !== 'undefined' && Pressing.overrides && (Pressing.overrides.shift || Pressing.overrides.ctrl)));
				if (!multi) outlinerRangeSelect.anchor = this;
				else if (!outlinerRangeSelect.anchor) outlinerRangeSelect.anchor = this;
			} catch (e) { /* ignore */ }
			return result;
		};
		patched.__imdaRange = true;
		patched.__imdaOriginal = original;
		proto.clickSelect = patched;
		try { console.log('[装配] 已接管 ' + label + ' 的 Shift 连选'); } catch (e) { /* ignore */ }
	};
	wrap(Group.prototype, 'Group');
	wrap(OutlinerElement.prototype, 'OutlinerElement');
	outlinerRangeSelect.patching = false;
}

function uninstallOutlinerRangeSelect() {
	outlinerRangeSelect.anchor = null;
	const restore = (proto) => {
		try {
			const patched = proto && proto.clickSelect;
			if (patched && patched.__imdaRange && typeof patched.__imdaOriginal === 'function') proto.clickSelect = patched.__imdaOriginal;
		} catch (e) { /* ignore */ }
	};
	restore(typeof Group !== 'undefined' ? Group.prototype : null);
	restore(typeof OutlinerElement !== 'undefined' ? OutlinerElement.prototype : null);
}

/** 右键菜单用的动作副本：共用 click，但带自己的显示条件（不同节点类型出现不同项） */
function menuVariant(base, id, condition) {
	if (!base) return null;
	return new Action(id, {
		name: base.name,
		description: base.description,
		icon: base.icon,
		category: base.category,
		condition,
		click: function () { return typeof base.click === 'function' ? base.click.apply(base, arguments) : undefined; },
	});
}

function isImdaFormat() {
	try { return typeof Format !== 'undefined' && Format && Format.id === FORMAT_ID; } catch (e) { return false; }
}
function pickTargetLocator() {
	try { if (typeof CallTag !== 'undefined' && CallTag && CallTag.selected && CallTag.selected.length) return CallTag.selected[0]; } catch (e) { /* ignore */ }
	try { if (typeof Locator !== 'undefined' && Locator && Locator.selected && Locator.selected.length) return Locator.selected[0]; } catch (e) { /* ignore */ }
	try { const hit = (Outliner.selected || []).filter(isCallLike); if (hit.length) return hit[0]; } catch (e) { /* ignore */ }
	return null;
}
function isCallTagNode(node) {
	return !!node && isCallLike(node) && !!String(node.imda_call_target || '').trim();
}
/** 分组类型判定（range_dispatch / condition / select / model / composite / inline …） */
function targetGroupTypeIn(types) {
	const g = pickTargetGroup();
	if (!g) return false;
	const type = String(g.imda_type || 'composite').replace(/^minecraft:/, '');
	return types.indexOf(type) >= 0;
}

/** 各内置原型菜单的原始结构快照：非 IMDA 格式时用它完整还原，避免残留插件分隔线/空项。 */
const imdaMenuSnapshots = new WeakMap();

/** 从某个右键菜单里移除所有 imda_* 项并清掉挂载标记（用于重载前清理）。 */
function cleanImdaMenu(menu) {
	try {
		if (!menu || !Array.isArray(menu.structure)) return;
		menu.structure = menu.structure.filter(item => {
			if (item === null || item === undefined) return false;
			const id = typeof item === 'string' ? item : (item && item.id) || '';
			return !String(id).startsWith('imda_');
		});
		if (menu.__imdaCallAttached) delete menu.__imdaCallAttached;
	} catch (e) { /* ignore */ }
}

/** 清理所有可能被插件改写过的原型菜单（Group / Locator / CallTag / Cube）。
 *  restore=true 时直接恢复到插件改写前的原始快照（非 IMDA 格式必须用这个）。 */
function cleanAllImdaMenus(restore) {
	const menus = [];
	const push = (m) => { if (m && menus.indexOf(m) < 0) menus.push(m); };
	try { push((typeof Group !== 'undefined' && Group.prototype) ? Group.prototype.menu : null); } catch (e) { /* ignore */ }
	try { push((typeof Locator !== 'undefined' && Locator.prototype) ? Locator.prototype.menu : null); } catch (e) { /* ignore */ }
	try { push((typeof CallTag !== 'undefined' && CallTag && CallTag.prototype) ? CallTag.prototype.menu : null); } catch (e) { /* ignore */ }
	try { push((typeof Cube !== 'undefined' && Cube.prototype) ? Cube.prototype.menu : null); } catch (e) { /* ignore */ }
	menus.forEach(menu => {
		try {
			if (!menu || !Array.isArray(menu.structure)) return;
			if (!imdaMenuSnapshots.has(menu)) {
				// 快照必须是“干净的原生菜单”：剔除历史版本可能残留的 null 分隔线与 imda_* 项。
				imdaMenuSnapshots.set(menu, menu.structure.filter(item => {
					if (item === null || item === undefined) return false;
					const id = typeof item === 'string' ? item : (item && item.id) || '';
					return !String(id).startsWith('imda_');
				}));
			}
			if (restore) menu.structure = imdaMenuSnapshots.get(menu).slice();
			cleanImdaMenu(menu);
		} catch (e) { /* ignore */ }
	});
}

function attachGroupMenu() {
	// 关键：所有对 Blockbench 内置原型（Group/Locator/CallTag/Cube）的菜单改写都必须严格限定在 IMDA 格式。
	// 否则会让其它格式的方块/分组右键菜单被塞进 imda 项，甚至打不开。
	// 因此先无条件清掉所有 imda_* 项；非 IMDA 格式更进一步，直接恢复原始菜单快照后返回。
	const imda = isImdaFormat();
	cleanAllImdaMenus(!imda);
	if (!imda) return;
	const addSeparator = (menu) => {
		try { if (typeof MenuSeparator !== 'undefined') menu.addAction(new MenuSeparator('imda_menu_sep')); } catch (e) { /* ignore */ }
	};
	const cleanByPrefix = (menu) => cleanImdaMenu(menu);
	// 分组右键：按分组类型给不同项
	try {
		const menu = (typeof Group !== 'undefined' && Group.prototype) ? Group.prototype.menu : null;
		if (menu && typeof menu.addAction === 'function' && actions.props) {
			{
				cleanByPrefix(menu);
				menuActions.props = menuVariant(actions.props, 'imda_menu_props', () => isImdaFormat() && !!pickTargetGroup());
				menuActions.pickModel = menuVariant(actions.pickModelFile, 'imda_menu_pick_model', () => isImdaFormat() && targetGroupTypeIn(['model']));
				menuActions.importModel = menuVariant(actions.import, 'imda_menu_import_model', () => isImdaFormat() && targetGroupTypeIn(['model']));
				menuActions.createModel = menuVariant(actions.createModel, 'imda_menu_create_model', () => isImdaFormat() && targetGroupTypeIn(['composite', 'inline']));
				menuActions.call = menuVariant(actions.call, 'imda_menu_call', () => isImdaFormat() && targetGroupTypeIn(['composite', 'inline']));
				menuActions.convertCall = menuVariant(actions.convertCall, 'imda_menu_convert_call', () => isImdaFormat() && selectedGroups().length > 0);
				menuActions.pivot = menuVariant(actions.pivot, 'imda_menu_pivot', () => isImdaFormat() && !!pickTargetGroup());
				menuActions.extractPose = menuVariant(actions.extractPose, 'imda_menu_extract_pose', () => isImdaFormat() && !!pickTargetGroup());
				menuActions.applyPose = menuVariant(actions.applyPose, 'imda_menu_apply_pose', () => isImdaFormat() && !!pickTargetGroup());
				addSeparator(menu);
				// 顺序：结构动作 → 位姿 → 枢轴 → 属性（属性固定在最下面）
				[menuActions.createModel, menuActions.pickModel, menuActions.importModel,
					menuActions.call, menuActions.convertCall, null, menuActions.extractPose, menuActions.applyPose,
					null, menuActions.pivot, null, menuActions.props].forEach(item => { if (item) menu.addAction(item); else addSeparator(menu); });
				menuAttached = true;
				console.log('[装配] 已加入分组右键菜单（按类型条件显示）');
			}
		}
	} catch (error) { /* ignore */ }
	// 复调用标签右键：只有真正的复调用标签才显示实例化/编辑。
	// 关键：CallTag 是自定义元素类型，重载插件时会重新注册一个「新类」，
	// 而大纲里已有的复调用标签节点仍属于上一次注册的「旧类」，它们的
	// prototype.menu 是各自独立的 Menu 对象（旧类没有挂过这些动作）。
	// 所以不能只挂「当前类」的原型，必须把现有每个复调用标签节点自己的
	// menu（可能来自旧类）也一起挂上，否则重载后右键只剩通用项。
	const attachCallMenu = (menu, key, label) => {
		try {
			if (!menu || typeof menu.addAction !== 'function' || !actions.editCall) return false;
			if (menu.__imdaCallAttached) return true; // 同一个 Menu 对象已挂过，直接跳过（update_selection 会高频触发）
			cleanByPrefix(menu);
			// 用「普通对象」作为菜单项：l() 渲染器支持 {name,icon,keybind,condition,click}，
			// keybind 只用于显示（不注册全局快捷键，避免和基础动作重复触发）。
			const mkItem = (id, base, cond, showKey) => {
				const item = {
					id,
					name: base.name,
					icon: base.icon,
					description: base.description,
					condition: cond,
					click: function (v, ev) { return typeof base.click === 'function' ? base.click.call(base, v, ev) : undefined; },
				};
				if (showKey && base.keybind) {
					const txt = String(base.keybind.toString() || '').trim();
					if (txt) item.keybind = base.keybind;
				}
				return item;
			};
			const instItem = mkItem('imda_menu_instantiate_this', actions.instantiateThis, () => isImdaFormat() && isCallTagNode(pickTargetLocator()), false);
			const editItem = mkItem('imda_menu_edit_call', actions.editCall, () => isImdaFormat() && isCallTagNode(pickTargetLocator()), false);
			const extractItem = mkItem('imda_menu_extract_pose_loc', actions.extractPose, () => isImdaFormat() && !!pickTargetLocator(), true);
			const applyItem = mkItem('imda_menu_apply_pose_loc', actions.applyPose, () => isImdaFormat() && !!pickTargetLocator(), true);
			menuActions['instantiateThis:' + key] = instItem;
			menuActions['editCall:' + key] = editItem;
			menuActions['extractPoseLoc:' + key] = extractItem;
			menuActions['applyPoseLoc:' + key] = applyItem;
			// 顺序：提取变换 / 应用变换 →（分割线）→ 实例化 → 编辑（编辑固定最下，实例化在其上）
			addSeparator(menu);
			menu.addAction(extractItem);
			menu.addAction(applyItem);
			addSeparator(menu);
			menu.addAction(instItem);
			menu.addAction(editItem);
			menu.__imdaCallAttached = true;
			console.log('[装配] 已重排' + label + '右键菜单（按目标条件显示）');
			return true;
		} catch (error) { return false; }
	};
	try {
		// 收集所有需要挂载的 Menu 对象：Locator 原型、当前 CallTag 原型、
		// 以及现有大纲里每个复调用标签节点自己的 menu（覆盖重载前的旧类）。
		const callMenus = [];
		const addCallMenu = (menu) => { if (menu && typeof menu.addAction === 'function' && callMenus.indexOf(menu) < 0) callMenus.push(menu); };
		try { addCallMenu((typeof Locator !== 'undefined' && Locator.prototype) ? Locator.prototype.menu : null); } catch (e) { /* ignore */ }
		try { addCallMenu((typeof CallTag !== 'undefined' && CallTag && CallTag.prototype) ? CallTag.prototype.menu : null); } catch (e) { /* ignore */ }
		try {
			const walk = (nodes) => {
				for (const node of (nodes || [])) {
					if (isCallLike(node)) { try { addCallMenu(node.menu); } catch (e) { /* ignore */ } }
					if (isGroup(node)) walk(node.children);
				}
			};
			walk((typeof Outliner !== 'undefined' && Outliner) ? Outliner.root : []);
		} catch (e) { /* ignore */ }
		callMenus.forEach((menu, i) => {
			const label = (i === 0 && menu === ((typeof Locator !== 'undefined' && Locator.prototype) ? Locator.prototype.menu : null)) ? '定位点' : '复调用标签';
			if (attachCallMenu(menu, 'call' + (menuActionSeq++), label)) locatorMenuAttached = true;
		});
	} catch (error) { /* ignore */ }
	// 方块右键：位姿提取/应用（方块也能作为来源）
	try {
		const menu = (typeof Cube !== 'undefined' && Cube.prototype) ? Cube.prototype.menu : null;
		if (menu && typeof menu.addAction === 'function') {
			cleanByPrefix(menu);
			addSeparator(menu);
			menuActions.extractPoseCube = menuVariant(actions.extractPose, 'imda_menu_extract_pose_cube', () => isImdaFormat() && selectedGroups().length > 0);
			menuActions.applyPoseCube = menuVariant(actions.applyPose, 'imda_menu_apply_pose_cube', () => isImdaFormat() && selectedGroups().length > 0);
			menu.addAction(menuActions.extractPoseCube);
			menu.addAction(menuActions.applyPoseCube);
			cubeMenuAttached = true;
		}
	} catch (error) { /* ignore */ }
}

Plugin.register('item_model_definition_assembly', {
	title: "VCS' Modeling Toolbox",
	author: 'Blockbench',
	icon: 'account_tree',
	description: "VCS' Modeling Toolbox (VMT) — 物品模型定义装配 (IMDA)：每个分组 = 一个 composite/range_dispatch/condition/model 子项，分组变换写入 transformation，可引用 Java 版模型，支持转换项目与直接合并到资源包。",
	version: VERSION,
	variant: 'both',
	min_version: '5.0.0',
	tags: ['Minecraft: Java Edition'],
	contributes: { formats: [FORMAT_ID] },
	onload() {
		try { migrateLegacyAll(); } catch (e) { /* ignore */ }
		try { installAnimationPropertiesPatch(); } catch (e) { /* ignore */ }
		try { attachAnimationTimelineMenu(); } catch (e) { /* ignore */ }
		
		try { if (typeof Blockbench !== 'undefined' && Blockbench.on) Blockbench.on('load_project', () => { try { migrateLegacyAll(); } catch (e) { /* ignore */ } try { attachAnimationTimelineMenu(); } catch (e) { /* ignore */ } }); } catch (e) { /* ignore */ }
		console.log('[装配] onload 开始，版本 ' + VERSION);
		try {
		try {
			if (typeof Setting !== 'undefined') {
				immBoxSetting = new Setting('imda_box_select_groups', {
					name: '框选/多选方块时自动改选所属分组',
					description: '一次选中两个及以上方块时，自动取消方块、改为选中它们各自的父分组；单选一个方块不处理。',
					category: 'edit',
					type: 'checkbox',
					value: false,
				});
				immBatchSetting = new Setting('imda_batch_groups_only', {
					name: '批量选择分组时只保留分组（取消方块/定位点选择）',
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
		try { ensureCallTagType(); } catch (error) { console.error('[装配] 复调用标签类型注册失败', error); }
		try { installOutlinerRangeSelect(); } catch (error) { console.error('[装配] 区间选择补丁失败', error); }
		ensurePackVersion();

		format_object = new ModelFormat(FORMAT_ID, {
			id: FORMAT_ID,
			name: '物品模型定义装配（IMDA）',
			icon: 'icon-format_block',
			category: 'minecraft',
			target: 'Minecraft: Java Edition',
			description: '按 Item Model Definition Assembly（IMDA）组织分组，导出 assets/<ns>/items/<id>.json',
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
			animation_mode: true,
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
		actions.zip = new Action('imda_export_zip', { name: '导出装配资源包 (zip)', description: 'items + models + textures', icon: 'archive', category: 'file', condition, click: exportZip });
		actions.merge = new Action('imda_merge_pack', { name: '合并到资源包…', description: '直接写入资源包并覆盖旧文件；默认快捷键 F5', icon: 'folder_open', category: 'file', condition, keybind: (typeof Keybind !== 'undefined') ? new Keybind({ key: 116 }) : undefined, click: mergeToPack });
		actions.import = new Action('imda_import_model', { name: '导入引用模型（当前分组）', description: '按 imda_model 从资源包工程导入 Java 模型为方块', icon: 'file_download', category: 'tools', condition: () => (typeof Format !== 'undefined' && Format && Format.id === FORMAT_ID), click: () => { const g = pickTargetGroup(); if (!g) { Blockbench.showMessageBox({ title: '请先选中分组', message: '先在 outliner 里选中一个分组。', icon: 'info' }); return; } if (!String(g.imda_model || '').trim()) { Blockbench.showMessageBox({ title: '没有引用模型', message: '该分组没有填写 imda_model（引用模型）。', icon: 'info' }); return; } importModelReference(g); } });
		actions.allItems = new Action('imda_all_items', { name: '生成全物品模型表…', description: '扫描资源包全部模型与映射文件，生成一张 select 表：每个路径都能被选中（when 同时含无类型与带类型路径）', icon: 'list_alt', category: 'tools', condition: () => isImdaFormat(), click: openAllItemsDialog });
	actions.repairOutliner = new Action('imda_repair_outliner', { name: '清理大纲重复节点', description: '删掉同时挂在某个分组里、又挂在根目录下的重复节点（0.71.0 生成表的遗留）', icon: 'cleaning_services', category: 'tools', condition: () => isImdaFormat(), click: repairOutlinerDuplicatesAction });
	actions.call = new Action('imda_call_group', { name: '复调用选中的分组', description: '在分组枢轴处创建复调用标签，导出时替换为目标分组', icon: 'content_copy', category: 'tools', condition, click: callSelectedGroup });
		actions.addCallTag = new Action('imda_add_call_tag', { name: '添加复调用标签', description: '在选中分组（或根目录）里新建一个空复调用标签，再用「编辑复调用标签」指定目标', icon: 'add', category: 'tools', condition: () => (typeof Format !== 'undefined' && Format && Format.id === FORMAT_ID), click: addEmptyCallTag });
	actions.bakeTimeline = new Action('imda_bake_timeline', { name: '解析动画时间轴（写入帧标签，旧流程）', description: '按项目 FPS 采样当前动画，生成 range_dispatch(timeline) 分组与逐帧 Locator；导出时也会自动采样，一般不需要手动执行', icon: 'timeline', category: 'tools', condition: () => typeof Animation !== 'undefined' && Animation && (Animation.selected || (Array.isArray(Animation.all) && Animation.all.length)), click: () => bakeTimelineToCallTags() });
	actions.removeTimeline = new Action('imda_remove_timeline', { name: '移除动画时间线复调用标签', description: '删除项目里所有 range_dispatch(timeline) 分组及其 Locator 帧标签', icon: 'delete', category: 'tools', condition: () => !!(typeof Outliner !== 'undefined' && Outliner && Outliner.root.some(n => isGroup(n) && String(n.imda_type || '') === 'range_dispatch_timeline')), click: () => removeTimelineTags() });
	actions.instantiateCalls = new Action('imda_instantiate_calls', { name: '实例化所有复调用标签', description: '把复调用 Locator 替换为真实的分组/模型节点（可撤销）', icon: 'content_copy', category: 'tools', condition: () => !!(typeof Outliner !== 'undefined' && Outliner), click: () => instantiateCallTags() });
		actions.instantiateSelected = new Action('imda_instantiate_selected_calls', { name: '实例化选中的复调用标签', description: '把当前选中的复调用标签替换为真实的分组/模型节点（可撤销）', icon: 'content_copy', category: 'tools', condition: () => selectedCallTags().length > 0, click: () => instantiateCallTags(selectedCallTags()) });
		actions.instantiateThis = new Action('imda_instantiate_this_call', {
			name: '实例化同组复调用标签',
			description: '把当前选中的复调用标签，以及同一父分组下的其他复调用标签一起替换为真实分组（可撤销）',
			icon: 'content_copy',
			category: 'tools',
			condition: () => selectedCallTags().length > 0,
			click: () => instantiateCallTags(expandCallTagSiblings(selectedCallTags())),
		});
	actions.animationTimeline = new Action('imda_animation_timeline', { name: '时间轴属性…', description: '设置该动画导出时间轴使用的 range_dispatch property 与 index', icon: 'timeline', category: 'animation', condition: () => isImdaFormat() && typeof Animation !== 'undefined' && !!Animation.selected, click: () => showAnimationTimelineDialog() });
	actions.sequence = new Action('imda_sequence', { name: '生成复调用序列…', description: '按大纲顺序生成递增/递减复调用序列，节点类型可选 range_dispatch / composite', icon: 'format_list_numbered', category: 'tools', condition: () => (typeof Format !== 'undefined' && Format && Format.id === FORMAT_ID), click: () => openSequenceDialog() });
	actions.convertCall = new Action('imda_convert_call', { name: '将分组转化为复调用标签…', description: '弹窗指定一个已存在的分组，把选中分组原位替换为指向它的调用标签（只保留原分组的位置与旋转，原几何删除）', icon: 'content_copy', category: 'tools', condition: () => (typeof Format !== 'undefined' && Format.id === FORMAT_ID) && selectedGroups().length > 0, click: () => convertSelectedGroupsToCallTags() });
	actions.normalize = new Action('imda_normalize', { name: '规范化结构…', description: '按当前导出规范整理项目结构：清理无效 internal、composite 直属 cube → inline 子分组、按父级编号格式重算分支序号并刷新 [x] 名字前缀、规范分组名称格式', icon: 'account_tree', category: 'tools', condition: () => (typeof Format !== 'undefined' && Format.id === FORMAT_ID), click: () => openNormalizeDialog() });
		actions.createModel = new Action('imda_create_model', { name: '从分组创建模型…', description: '把选中分组的方块烘焙成 models/item 模型，并改为引用（自动居中）', icon: 'file_upload', category: 'tools', condition, click: () => { const group = pickTargetGroup(); if (!group) { Blockbench.showMessageBox({ title: '请先选中分组', message: '先在 outliner 里选中一个分组。', icon: 'info' }); return; } createModelFromGroup(group); } });
		actions.check = new Action('imda_check', { name: '检查装配结构', description: '列出分组类型与变换诊断', icon: 'checklist', category: 'tools', condition, click: checkStructure });
		actions.pack = new Action('imda_pick_pack', { name: '选择资源包工程路径…', description: '打开系统文件夹选择框，设为资源包工程目录', icon: 'folder_open', category: 'file', condition: () => (typeof Format !== 'undefined' && Format && Format.id === FORMAT_ID), click: pickPackPath });
		actions.sim = new Action('imda_simulate', { name: '模拟输入…', description: '按 custom_model_data / selected 预览分支命中', icon: 'play_circle', category: 'tools', condition: () => (typeof Format !== 'undefined' && Format && Format.id === FORMAT_ID), click: () => { const panel = buildSimPanel(false); if (panel) { panel.show(); return; } openSimulator(); } });
		actions.pivot = new Action('imda_fix_pivot', { name: '枢轴归位（对齐几何中心）…', description: '把分组 origin 移到几何中心，补偿方块坐标，外观不变', icon: 'center_focus_strong', category: 'tools', condition, click: openPivotFix });
		actions.pivotRestore = new Action('imda_restore_pivot', { name: '从记录重建枢轴点…', description: '按「枢轴归位」保存的局部偏移，把分组/方块枢轴移回原来的位置', icon: 'restore', category: 'tools', condition, click: restorePivotFromRecordDialog });
		actions.pivotFromSource = new Action('imda_pivot_from_source', { name: '参考源文件重建枢轴点…', description: '读取源模型几何中心相对原点的偏移，按当前旋转换算为局部坐标，移动分组枢轴和复调用标签并保持外观', icon: 'my_location', category: 'tools', condition, click: rebuildPivotFromSourceDialog });
		actions.props = new Action('imda_group_props', { name: '编辑分组映射属性…', description: '映射类型 / 引用模型 / property 等', icon: 'tune', category: 'tools', condition, click: editGroupProps });
		actions.boxToggle = new Action('imda_box_toggle', { name: '开关：框选方块时改选所属分组', description: '切换“一次选中多个方块时自动改为选中其父分组”', icon: 'select_all', category: 'tools', click: () => { if (!immBoxSetting) { Blockbench.showQuickMessage('当前 Blockbench 不支持该设置', 2500); return; } const next = !boxGroupsEnabled(); setBoxSelectGroups(next); try { if (typeof immBoxSetting.save === 'function') immBoxSetting.save(); } catch (e) { /* ignore */ } Blockbench.showQuickMessage('框选方块改选所属分组：' + (next ? '开' : '关') + (typeof Format !== 'undefined' && Format && Format.id === FORMAT_ID ? '（装配格式内强制开启）' : ''), 2600); } });
		actions.batchToggle = new Action('imda_batch_toggle', { name: '开关：批量选组时取消元素选择', description: '切换“同时选中多个分组时自动取消方块/定位点选择”', icon: 'select_all', category: 'tools', click: () => { if (!immBatchSetting) { Blockbench.showQuickMessage('当前 Blockbench 不支持该设置', 2500); return; } const next = !batchGroupsOnlyEnabled(); setBatchGroupsOnly(next); try { if (typeof immBatchSetting.save === 'function') immBatchSetting.save(); } catch (e) { /* ignore */ } Blockbench.showQuickMessage('批量选择时取消单个元素：' + (next ? '开' : '关'), 2200); } });
		actions.editCall = new Action('imda_edit_call', { name: '编辑复调用标签…', description: '修改选中的复调用标签指向的分组或模型 id', icon: 'edit', category: 'tools', condition: () => !!pickTargetLocator(), click: () => { const locator = pickTargetLocator(); if (!locator) { Blockbench.showMessageBox({ title: '请先选中复调用标签', message: '在 outliner 里选中一个复调用标签。', icon: 'info' }); return; } editCallTag(locator); } });
		actions.upgradeCalls = new Action('imda_upgrade_calls', { name: '把旧复调用标签升级为独立元素…', description: '把旧工程里用 Locator 表示的复调用标签换成独立的「复调用标签」元素类型（保留 uuid 与全部覆盖，可撤销）', icon: 'upgrade', category: 'tools', condition: () => { try { return isImdaFormat() && ((typeof Locator !== 'undefined' && Locator.all) ? Locator.all.some(l => l && String(l.imda_call_target || '').trim() && !isCallTagType(l)) : false); } catch (e) { return false; } }, click: () => { const done = upgradeLegacyCallTags(); simInvalidate(); Menu.update(); Blockbench.showQuickMessage(done ? ('已升级 ' + done + ' 个复调用标签') : '没有需要升级的复调用标签', 3000); } });
		actions.repairCalls = new Action('imda_repair_calls', { name: '修复失效的复调用目标…', description: '扫描所有目标 UUID 已不存在的复调用标签，统一改成指定分组', icon: 'build', category: 'tools', condition: () => (typeof Format !== 'undefined' && Format && Format.id === FORMAT_ID) && invalidCallTags().length > 0, click: repairCallTargetsDialog });
		actions.refreshCalls = new Action('imda_refresh_calls', { name: '更新所有调用', description: '重新读取所有复调用目标与外部物品映射引用（清缓存、重排分支名、列出失效项）', icon: 'refresh', category: 'tools', condition: () => (typeof Format !== 'undefined' && Format && Format.id === FORMAT_ID), click: () => refreshAllCalls() });
		actions.pickModelFile = new Action('imda_pick_model_file', { name: '选择引用模型 / 物品映射文件…', description: '用资源管理器选 assets/<命名空间>/models/…（模型引用）或 assets/<命名空间>/items/…（物品映射引用），自动解析并写入该分组的「引用模型」', icon: 'folder_open', category: 'tools', condition: () => (typeof Format !== 'undefined' && Format && Format.id === FORMAT_ID) && !!pickTargetGroup(), click: () => pickModelFileForGroup(pickTargetGroup()) });
		actions.extractPose = new Action('imda_extract_pose', { name: '提取变换', description: '记录选中分组 / 复调用标签的位姿（origin + rotation），供「应用变换」使用', icon: 'content_copy', category: 'tools', keybind: (typeof Keybind !== 'undefined') ? new Keybind({ key: 67, ctrl: true, shift: true }) : undefined, condition: () => (typeof Format !== 'undefined' && Format && Format.id === FORMAT_ID) && (selectedGroups().length > 0 || selectedCallTags().length > 0), click: () => extractPose() });
		actions.applyPose = new Action('imda_apply_pose', { name: '应用变换', description: '把提取到的位姿套用到所有选中的同类元素（子树一起平移，枢轴落到同一位置）', icon: 'content_paste', category: 'tools', keybind: (typeof Keybind !== 'undefined') ? new Keybind({ key: 86, ctrl: true, shift: true }) : undefined, condition: () => (typeof Format !== 'undefined' && Format && Format.id === FORMAT_ID) && (selectedGroups().length > 0 || selectedCallTags().length > 0), click: () => applyPose() });

		addMenu(actions.zip, 'file.export');
		addMenu(actions.merge, 'file.export');
		placeInFileMenu(actions.pack, ['save_model', 'export', 'import']);
		
		const toolsMenu = (typeof MenuBar !== 'undefined' && MenuBar.menus) ? MenuBar.menus.tools : null;
		const toolSep = (id, label) => { try { if (toolsMenu && typeof MenuSeparator !== 'undefined') toolsMenu.addAction(new MenuSeparator(id, label)); } catch (e) { /* ignore */ } };
		const toolHeading = (label) => { try { if (toolsMenu) toolsMenu.addAction({ id: 'imda_vmt_heading', name: label, icon: 'label', click: null }); } catch (e) { /* ignore */ } };
		cleanOwnMenu(toolsMenu);
		const tool = (action) => addMenu(action, 'tools');
		toolSep('imda_vmt_top');
		toolHeading('==VCS Modeling Toolbox==');
		toolSep('imda_group_assembly', '[ 模型装配 ] - 结构');
		tool(actions.allItems);
		tool(actions.repairOutliner);
		tool(actions.props);
		tool(actions.import);
		tool(actions.pickModelFile);
		tool(actions.createModel);
		tool(actions.sequence);
		toolSep('imda_group_pose', '变换');
		tool(actions.extractPose);
		tool(actions.applyPose);
		toolSep('imda_group_calls', '复调用');
		tool(actions.addCallTag);
		tool(actions.call);
		tool(actions.convertCall);
		tool(actions.editCall);
		tool(actions.refreshCalls);
		tool(actions.repairCalls);
		tool(actions.instantiateCalls);
		tool(actions.instantiateSelected);
		tool(actions.upgradeCalls);
		toolSep('imda_group_debug', '调试');
		tool(actions.check);
		tool(actions.normalize);
		toolSep('imda_group_timeline', '时间轴');
		tool(actions.animationTimeline);
		tool(actions.bakeTimeline);
		tool(actions.removeTimeline);
		toolSep('imda_group_aux', '[ 辅助功能 ]');
		tool(actions.boxToggle);
		tool(actions.batchToggle);
		tool(actions.pivot);
		tool(actions.pivotRestore);
		tool(actions.pivotFromSource);

		try { attachAnimationTimelineMenu(); setTimeout(() => { try { attachAnimationTimelineMenu(); } catch (e) { /* ignore */ } }, 800); } catch (e) { /* ignore */ }
		try { buildSimPanel(false); } catch (e) { console.warn('[装配] 面板创建失败（可忽略）', e); }
		// 面板会自动出现在「视图 → 面板」里，不再占用 Tools 菜单
		attachGroupMenu();
		// 载入/重载插件时给现有分支容器（含 range_dispatch 下的复调用标签）补上序号前缀
		try {
			if (syncAllBranchLabels()) { try { if (typeof Panels !== 'undefined' && Panels.outliner && Panels.outliner.inside_vue && Panels.outliner.inside_vue.$forceUpdate) Panels.outliner.inside_vue.$forceUpdate(); } catch (e) { /* ignore */ } }
		} catch (e) { /* ignore */ }
		// 避免普通选中触发 sortBranchChildren / syncBranchLabels。
		try { Blockbench.on('update_selection', () => { try { guardLockedSelection(); } catch (e) { /* ignore */ } try { guardBatchSelection(); } catch (e) { /* ignore */ } try { guardBoxSelection(); } catch (e) { /* ignore */ } }); } catch (e) { /* ignore */ }
		for (const event of ['add_group', 'remove_group', 'add_locator']) {
			try { Blockbench.on(event, (data) => { simInvalidate(); scheduleBranchSync(data && data.object, event); }); } catch (e) { /* ignore */ }
		}
		for (const event of ['select_project', 'finished_loading_project', 'update_selection']) {
			try { Blockbench.on(event, () => { try { simRestoreView(); simRestoreTints(); } catch (viewError) { /* ignore */ } simInvalidate(); attachGroupMenu(); }); } catch (e) { /* ignore */ }
		}
		for (const event of ['select_project', 'finished_loading_project']) {
			try { Blockbench.on(event, ensurePackVersion); } catch (e) { /* ignore */ }
		}
		for (const event of ['select_project', 'finished_loading_project']) {
			try {
				Blockbench.on(event, () => {
					try {
						if (syncAllBranchLabels()) {
							try { if (typeof Panels !== 'undefined' && Panels.outliner && Panels.outliner.inside_vue && Panels.outliner.inside_vue.$forceUpdate) Panels.outliner.inside_vue.$forceUpdate(); } catch (e) { /* ignore */ }
						}
					} catch (e) { /* ignore */ }
				});
			} catch (e) { /* ignore */ }
		}
		try {
			if (typeof globalThis !== 'undefined' && globalThis.__IMM_TEST__) {
				globalThis.__IMM_TEST__.api = { VERSION, attachGroupMenu, cleanAllImdaMenus, attachAnimationTimelineMenu, PACK_VERSIONS, DEFAULT_PACK_VERSION, packMcmetaData, packFormatLabel, packMcmetaFormat, ensurePackVersion, simValue, simEvaluate, simTick, simInvalidate, stripStrayBranchPrefixes, fixGroupPivot, averagePoints, cooldownThresholds, moveGroupPivot, restoreGroupPivotFromRecord, restoreCubePivotFromRecord, sourceModelGeometryCenter, collectInputUsage, modelElementsHaveTintIndex, guardLockedSelection, guardBatchSelection, guardBoxSelection, setBoxSelectGroups, setBatchGroupsOnly, centerCubePivot, simApplyGroupVisual, simRestoreView, simSetViewMode, simApplyTints, simRestoreTints, simTintColorOf, assignGroupMapProps, createExporter, sampleTimelinePoses, parseNamespaceSetting, formatMapping, removeInvalidInternalGroups, selectionGroupForCube, tintGroupOf, migrateLegacyAll, migrateLegacyNode, callOverridesOf, applyCallOverridesToGroup, expandCallTagSiblings, sortBranchChildren, syncBranchLabels, syncAllBranchLabels, siblingBranchNumber, branchChildNodes, callTagBranchThreshold, applyPivotFix, parseMappingReference, referenceFromPickedPath, loadMappingDefinition, clearMappingCache, poseOfNode, extractPose, applyPose, refreshAllCalls, callSelectedGroup, bakeTimelineToCallTags, instantiateCallTags, callModelPrefill, orderedSelectedGroups, orderedSequenceItems, sequenceCounts, sequenceFormatValue, generateCallSequence, buildSequenceChildResult, simPoseIsSame, simLightUpCallTargets, simEnsureCallInstance, simDropCallInstance, simDropAllCallInstances, getSimTempCalls: () => simTempCalls, ensureCallTagType, newCallTag, upgradeLegacyCallTags, getCallTag: () => CallTag, CALL_TAG_TYPE, isLocator, isCallTagType, isCallTag, isCallLike, outlinerFlatOrder, outlinerRangeSelectTo, installOutlinerRangeSelect, uninstallOutlinerRangeSelect, getRangeSelectState: () => outlinerRangeSelect, scanPackEntries, buildAllItemsTree, matchBlacklist, listFilesRecursive, simStepOnce, simAdvanceSlot, primeMappingCache, repairOutlinerDuplicates, applyConvertGroupsToCallTags, collectAllGroups, collectGroupSubtree, outermostSelectedGroups, normalizeCompositeCubes, normalizeGroupNumbersAndNames, cleanGroupName, thresholdFormatVars, countLayerItems, countInlineCubes, instantiateCallTags, applyCallOverridesToGroup, pivotContentPoints, rotateAroundQuat, readQuaternion, simViewEntries, getSimState: () => sim, buildSimPanel, getSimUi: () => sim_ui, getSimPanel: () => sim_panel };
			}
		} catch (hookError) { /* ignore */ }
			} catch (error) {
			console.error('[装配] onload 失败：', error);
		}
	},
	onunload() {
		try {
			Object.keys(menuActions || {}).forEach(key => { const act = menuActions[key]; try { if (act && typeof act.delete === 'function') act.delete(); } catch (e) { /* ignore */ } });
			menuActions = {};
		} catch (e) { /* ignore */ }
		try {
			// 收集所有可能挂过 imda 右键项的 Menu：各类原型 + 现有大纲节点的
			// menu（后者覆盖“重载前旧类”的节点，重载后旧类菜单也要清干净）。
			const cleanMenus = [];
			const addClean = (menu) => { if (menu && Array.isArray(menu.structure) && cleanMenus.indexOf(menu) < 0) cleanMenus.push(menu); };
			for (const proto of [typeof Group !== 'undefined' ? Group : null, typeof Locator !== 'undefined' ? Locator : null, typeof CallTag !== 'undefined' && CallTag ? CallTag : null, typeof Cube !== 'undefined' ? Cube : null]) {
				try { addClean(proto && proto.prototype && proto.prototype.menu); } catch (e) { /* ignore */ }
			}
			try {
				const walk = (nodes) => {
					for (const node of (nodes || [])) {
						if (isCallLike(node)) { try { addClean(node.menu); } catch (e) { /* ignore */ } }
						if (isGroup(node)) walk(node.children);
					}
				};
				walk((typeof Outliner !== 'undefined' && Outliner) ? Outliner.root : []);
			} catch (e) { /* ignore */ }
			for (const menu of cleanMenus) {
				menu.structure = menu.structure.filter(item => { const id = typeof item === 'string' ? item : (item && item.id) || ''; return !String(id).startsWith('imda_'); });
				try { delete menu.__imdaCallAttached; } catch (e) { /* ignore */ }
			}
		} catch (menuError) { /* ignore */ }
		menuActionSeq = 0;
		try { uninstallOutlinerRangeSelect(); } catch (e) { /* ignore */ }
		try { if (sim.timer) { clearInterval(sim.timer); sim.timer = null; } } catch (e) { /* ignore */ }
		try { if (sim.tickTimer) { clearTimeout(sim.tickTimer); sim.tickTimer = null; } } catch (e) { /* ignore */ }
		try { simStopViewLoop(); } catch (e) { /* ignore */ }
		try { simRestoreView(); } catch (e) { /* ignore */ }
		try { simRestoreTints(); } catch (e) { /* ignore */ }
		try { if (sim_panel && typeof sim_panel.delete === 'function') sim_panel.delete(); } catch (e) { /* ignore */ }
		sim_panel = null;
		sim_ui = null;
		menuAttached = false;
		try { cleanAllImdaMenus(true); } catch (e) { /* ignore */ }
		for (const key of Object.keys(actions)) {
			try { if (actions[key]) actions[key].delete(); } catch (e) { /* ignore */ }
			actions[key] = null;
		}
		if (codec_object) { try { codec_object.delete(); } catch (e) { /* ignore */ } codec_object = null; }
		if (format_object) { try { format_object.delete(); } catch (e) { /* ignore */ } format_object = null; }
		// 自定义元素类型不删（Blockbench 没有 unregisterType）；但要把 CallTag 的静态引用清掉，
		// 让下一次 onload 重新注册，避免判定用的是旧闭包里的类。
		// 注意：`OutlinerElement.types['imda_call_tag']` 指向的仍是旧类，重载后由 ensureCallTagType 覆盖。
		try { if (typeof OutlinerElement !== 'undefined' && OutlinerElement.types && CallTag && OutlinerElement.types[CALL_TAG_TYPE] === CallTag) delete OutlinerElement.types[CALL_TAG_TYPE]; } catch (e) { /* ignore */ }
		CallTag = null;
		callTagSpriteMap = null;
	},
});

})();
