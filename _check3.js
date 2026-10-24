/* 校验：按 Minecraft 语义还原插件输出的世界坐标，与 bbmodel 里的真实摆位比较 */
const fs = require('fs');
const path = require('path');

const BB = 'C:\\Game\\Minecraft\\.minecraft\\resourcepacks\\Squilker Sparkle Res\\assets\\sqsp\\models\\item\\inker\\jet_rifle\\sac_assembly.bbmodel';
const OUT = path.join(process.env.TEMP || '.', 'im_out');
const NS = 'sqsptst';
const ITEM = 'sac_assembly';

/* ---------- 矩阵 ---------- */
const I = () => [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
function mul(a, b) { return a.map((row, i) => [0, 1, 2, 3].map(j => [0, 1, 2, 3].reduce((s, k) => s + row[k] * b[k][j], 0))); }
function tr(t) { const m = I(); m[0][3] = t[0]; m[1][3] = t[1]; m[2][3] = t[2]; return m; }
function ap(m, p) { return [0, 1, 2].map(i => m[i][0] * p[0] + m[i][1] * p[1] + m[i][2] * p[2] + m[i][3]); }
function axisRot(axis, deg) {
	const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), m = I();
	const [i, j] = [[1, 2], [0, 2], [0, 1]][axis];
	m[i][i] = c; m[i][j] = -s; m[j][i] = s; m[j][j] = c;
	return m;
}
function quatRot(q) {
	const [x, y, z, w] = q;
	return [
		[1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y), 0],
		[2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x), 0],
		[2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y), 0],
		[0, 0, 0, 1],
	];
}
const about = (pivot, r) => mul(mul(tr(pivot), r), tr([-pivot[0], -pivot[1], -pivot[2]]));
const corners = (a, b) => { const o = []; for (const x of [a[0], b[0]]) for (const y of [a[1], b[1]]) for (const z of [a[2], b[2]]) o.push([x, y, z]); return o; };
const centroid = pts => [0, 1, 2].map(i => pts.reduce((s, p) => s + p[i], 0) / pts.length);

/* ---------- 输入：bbmodel 真实摆位 ---------- */
const bb = JSON.parse(fs.readFileSync(BB, 'utf8'));
const groups = new Map((bb.groups || []).map(g => [g.uuid, g]));
const elements = new Map((bb.elements || []).filter(e => e.from && e.to).map(e => [e.uuid, e]));
const intended = [];

function walk(nodes, m) {
	for (const node of nodes) {
		if (typeof node === 'string') {
			if (groups.has(node)) walk([groups.get(node)], m);
			else if (elements.has(node)) walk([{ uuid: node }], m);
			continue;
		}
		if (!node || typeof node !== 'object') continue;
		if (Array.isArray(node.children)) {
			const g = groups.get(node.uuid) || node;
			const origin = node.origin || g.origin || [0, 0, 0];
			const r = node.rotation || g.rotation || [0, 0, 0];
			const rm = mul(axisRot(2, r[2]), mul(axisRot(1, r[1]), axisRot(0, r[0])));
			walk(node.children, mul(m, about(origin, rm)));
		} else if (node.uuid && elements.has(node.uuid)) {
			const e = elements.get(node.uuid);
			const r = e.rotation || [0, 0, 0];
			const rm = mul(axisRot(2, r[2]), mul(axisRot(1, r[1]), axisRot(0, r[0])));
			const em = mul(m, about(e.origin || [0, 0, 0], rm));
			intended.push(centroid(corners(e.from, e.to).map(p => ap(em, p))));
		}
	}
}
/* 顶层：优先用 bbmodel 的 outliner 树，其次退回 groups */
walk(bb.outliner || [], I());
if (!intended.length) walk([...groups.values()], I());

/* ---------- 输出：按 Minecraft 语义还原 ---------- */
const mapping = JSON.parse(fs.readFileSync(path.join(OUT, 'assets', NS, 'items', ITEM + '.json'), 'utf8'));
const emitted = [];
let element_count = 0, long_angles = 0;

function nodeMatrix(n, parent) {
	const t = n.transformation;
	if (!t) return parent;
	let m = tr(t.translation.map(v => v * 16));
	m = mul(m, quatRot(t.left_rotation));
	if (t.right_rotation) m = mul(m, quatRot(t.right_rotation));
	// 导出时用了 center_pivot = true：元素空间里要按 C=(8,8,8) 共轭
	m = mul(tr([8, 8, 8]), mul(m, tr([-8, -8, -8])));
	return mul(parent, m);
}
function walkOut(n, parent) {
	if (!n || typeof n !== 'object') return;
	const m = nodeMatrix(n, parent);
	if (n.type === 'minecraft:model' && n.model) {
		const rel = n.model.split(':')[1].replace(/^item\//, '');
		const file = path.join(OUT, 'assets', NS, 'models', 'item', rel + '.json');
		if (!fs.existsSync(file)) { console.log('MISSING MODEL', rel); return; }
		const model = JSON.parse(fs.readFileSync(file, 'utf8'));
		for (const e of model.elements || []) {
			element_count++;
			let em = m;
			if (e.rotation) {
				const axis = { x: 0, y: 1, z: 2 }[e.rotation.axis];
				if (Math.abs(e.rotation.angle) > 45) long_angles++;
				em = mul(m, about(e.rotation.origin || [0, 0, 0], axisRot(axis, e.rotation.angle)));
			}
			emitted.push(centroid(corners(e.from, e.to).map(p => ap(em, p))));
		}
	}
	for (const c of n.models || []) walkOut(c, m);
}
walkOut(mapping.model, I());

/* ---------- 比较 ---------- */
let worst = 0, total = 0;
for (const p of emitted) {
	let best = Infinity;
	for (const q of intended) best = Math.min(best, Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]));
	worst = Math.max(worst, best);
	total += best;
}
console.log('intended cubes:', intended.length, '| emitted elements:', element_count, '| |angle|>45:', long_angles);
console.log('centroid 误差  max=' + worst.toFixed(4) + '  mean=' + (total / Math.max(1, emitted.length)).toFixed(4) + '  (单位=模型像素)');
