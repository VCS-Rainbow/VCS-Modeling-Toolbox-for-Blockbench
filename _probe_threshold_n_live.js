(async () => {
	try {
		globalThis.__IMM_TEST__ = globalThis.__IMM_TEST__ || {};
		const pid = 'item_model_definition_assembly';
		let p = (typeof Plugins !== 'undefined') ? Plugins.all.find(x => x.id === pid) : null;
		if (!p) return JSON.stringify({ error: 'plugin-not-found' });
		await p.reload();
		p = Plugins.all.find(x => x.id === pid);
		const api = globalThis.__IMM_TEST__ && globalThis.__IMM_TEST__.api;
		if (!api) return JSON.stringify({ error: 'no-api', version: p && p.version });

		const R = [];
		const ok = (label, cond, detail) => R.push({ label, pass: !!cond, detail: cond ? undefined : detail });

		const ex = api.createExporter();
		const vt = (fmt, i, n) => ex.evalThreshold(fmt, i, n);
		ok('ni n=5 → 0,5,10', JSON.stringify([0, 1, 2].map(i => vt('ni', i, 5))) === JSON.stringify([0, 5, 10]), [0, 1, 2].map(i => vt('ni', i, 5)));
		ok('2n n=3 → 6', vt('2n', 1, 3) === 6, vt('2n', 1, 3));
		ok('n+i n=10 i=2 → 12', vt('n+i', 2, 10) === 12, vt('n+i', 2, 10));
		ok('5-i 仍是 5,4,3', JSON.stringify([0, 1, 2].map(i => vt('5-i', i))) === JSON.stringify([5, 4, 3]), [0, 1, 2].map(i => vt('5-i', i)));

		// 脱离 Outliner 的分组树，直接 buildNode（不碰用户工程、不读文件：叶子用 empty 类型）
		const beforeRoot = (typeof Outliner !== 'undefined' && Outliner.root) ? Outliner.root.length : -1;
		const mk = (name, type, extra) => new Group(Object.assign({ name, imda_type: type }, extra || {}));
		const slots = mk('slots', 'range_dispatch', { imda_property: 'custom_model_data', imda_index: 0, imda_threshold_format: 'i' });
		for (let k = 0; k < 5; k++) { const g = mk('c' + k, 'empty'); g.parent = slots; slots.children.push(g); }
		const b5 = mk('b5', 'range_dispatch', { imda_property: 'custom_model_data', imda_index: 0, imda_threshold_format: 'ni' });
		for (let k = 0; k < 3; k++) { const g = mk('s' + k, 'empty'); g.parent = b5; b5.children.push(g); }
		b5.parent = slots; slots.children.push(b5);

		const node = ex.buildNode(slots, 'x', [0, 0, 0]);
		ok('外层 6 entries', node && node.entries && node.entries.length === 6, node && node.entries && node.entries.length);
		ok('外层阈值 0..5', node && JSON.stringify(node.entries.map(e => e.threshold)) === JSON.stringify([0, 1, 2, 3, 4, 5]), node && node.entries.map(e => e.threshold));
		const inner = node && node.entries[5] && node.entries[5].model;
		ok('第 6 分支是嵌套 range_dispatch', inner && inner.type === 'minecraft:range_dispatch', inner && inner.type);
		ok('嵌套阈值 ni(n=5) = 0,5,10', inner && JSON.stringify(inner.entries.map(e => e.threshold)) === JSON.stringify([0, 5, 10]), inner && inner.entries.map(e => e.threshold));

		// 清理脱离树
		try { for (const g of [slots, b5]) for (const c of (g.children || []).slice()) { try { c.remove(); } catch (e) { } } try { slots.remove(); } catch (e) { } } catch (e) { }
		ok('未污染 Outliner.root', ((typeof Outliner !== 'undefined' && Outliner.root) ? Outliner.root.length : -1) === beforeRoot, { before: beforeRoot, after: (typeof Outliner !== 'undefined' && Outliner.root) ? Outliner.root.length : -1 });

		const failed = R.filter(x => !x.pass);
		return JSON.stringify({ version: api.VERSION, pass: R.length - failed.length, total: R.length, failed: failed.map(f => f.label + ' :: ' + JSON.stringify(f.detail)) });
	} catch (e) {
		return JSON.stringify({ error: String(e && e.message || e), stack: String(e && e.stack || '').split('\n').slice(0, 6) });
	}
})()
