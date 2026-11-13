/* 真机验证 f / s：构造 a:{ a1:{b1,b2}, a2:{}, a3:{} } 的临时结构，读阈值格式解析结果，
   然后按名字白名单删除自己造的节点。不碰用户既有分组。 */
(function () {
	const api = globalThis.__IMM_TEST__ && globalThis.__IMM_TEST__.api;
	if (!api) return 'no-api';

	const mk = (name, type) => {
		const g = new Group({ name, imda_type: type || 'composite', origin: [8, 8, 8], rotation: [0, 0, 0] });
		g.addTo(); g.init();
		return g;
	};
	const tag = '__fsProbe_';
	const a = mk(tag + 'a');
	const a1 = new Group({ name: tag + 'a1', imda_type: 'range_dispatch', imda_property: 'custom_model_data', imda_index: 0, imda_threshold_format: 'f-s', origin: [8, 8, 8], rotation: [0, 0, 0] });
	a1.addTo(a); a1.init();
	const a2 = new Group({ name: tag + 'a2', imda_type: 'composite', origin: [8, 8, 8], rotation: [0, 0, 0] });
	a2.addTo(a); a2.init();
	const a3 = new Group({ name: tag + 'a3', imda_type: 'composite', origin: [8, 8, 8], rotation: [0, 0, 0] });
	a3.addTo(a); a3.init();
	const b1 = new Group({ name: tag + 'b1', imda_type: 'model', imda_model: 'minecraft:item/paper', origin: [8, 8, 8], rotation: [0, 0, 0] });
	b1.addTo(a1); b1.init();
	const b2 = new Group({ name: tag + 'b2', imda_type: 'model', imda_model: 'minecraft:item/paper', origin: [8, 8, 8], rotation: [0, 0, 0] });
	b2.addTo(a1); b2.init();

	const varsA1 = api.thresholdFormatVars(a1);
	const varsA = api.thresholdFormatVars(a);
	const ex = api.createExporter();
	const resolved = [0, 1, 2, 3].map(i => ex.evalThreshold('f-s', i, undefined, varsA1));

	// 导出层：a1 的 entries 阈值应全是 1
	let exported = null;
	try {
		const built = ex.buildNode(a1, '__fsProbe', [0, 0, 0]);
		exported = built && built.entries ? built.entries.map(e => String(e.threshold)) : null;
	} catch (err) { exported = 'ERR: ' + err.message; }

	// 按名字白名单删除自己造的节点（从最深层开始）
	for (const node of [b1, b2, a1, a2, a3, a]) {
		try { node.remove(); } catch (e) { /* ignore */ }
	}
	try { Panels.outliner.inside_vue.$forceUpdate(); } catch (e) { /* ignore */ }

	const leftovers = (Group.all || []).filter(g => g && String(g.name || '').indexOf(tag) === 0).map(g => g.name);
	return JSON.stringify({ varsA1, varsA, resolved, exported, leftovers }, null, 1);
})();
