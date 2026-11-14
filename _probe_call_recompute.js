/* 真机只读验证：导出 jet_rifle，检查 [2] sac_slots #3 下三个复调用 range_dispatch 的 entries 阈值。
   期望 [0,3] / [0,2] / [0,1]。不修改工程。 */
(function () {
	const api = globalThis.__IMM_TEST__ && globalThis.__IMM_TEST__.api;
	if (!api) return 'no-api';
	let mapping;
	try { mapping = api.createExporter().buildMapping(); } catch (e) { return 'build-error: ' + ((e && e.message) || e); }
	const hits = [];
	const walk = (nodes, path) => {
		for (const n of (nodes || [])) {
			if (!n || typeof n !== 'object') continue;
			const nm = String(n.node_name || '');
			if (n.type === 'minecraft:range_dispatch' && /^调用 sacpack/.test(nm)) {
				hits.push({ node_name: nm, thresholds: (n.entries || []).map(e => String(e.threshold)) });
			}
			for (const k of ['models', 'on_true', 'on_false', 'fallback']) if (n[k]) walk(Array.isArray(n[k]) ? n[k] : [n[k]], path);
			if (n.cases) for (const c of n.cases) walk([c.model], path);
			if (n.entries) for (const e of n.entries) walk([e.model], path);
		}
	};
	walk(mapping.model.models, []);
	return JSON.stringify({ count: hits.length, sample: hits.slice(0, 18) }, null, 1);
})();
