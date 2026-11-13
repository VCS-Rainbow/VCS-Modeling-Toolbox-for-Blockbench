/* 真机验证：先把 sac_slots 分支的名字/阈值人为改旧（模拟「改了父级格式但子级没跟着变」），
   跑一次「规范化」，读回结果，再从快照原样还原。只改 name / imda_threshold，不动结构几何。 */
(function () {
	const api = globalThis.__IMM_TEST__ && globalThis.__IMM_TEST__.api;
	if (!api) return 'no-api';
	const find = (name) => (Group.all || []).find(g => g && g.name === name) || null;
	const range = find('sac_slots');
	if (!range) return 'no-sac_slots';

	const kids = api.branchChildNodes(range);
	const snap = kids.map(k => ({ node: k, name: k.name, threshold: k.imda_threshold }));
	const rangeSnap = { name: range.name, format: range.imda_threshold_format };

	// 人为弄旧：名字前缀故意写错 + 阈值全部清成 0
	kids.forEach((k, i) => { k.name = '[99] stale' + i; k.imda_threshold = 0; });

	const stats = api.normalizeGroupNumbersAndNames();
	const after = kids.map(k => ({ name: k.name, threshold: k.imda_threshold, format: range.imda_threshold_format }));

	// 还原
	for (const s of snap) { s.node.name = s.name; s.node.imda_threshold = s.threshold; }
	range.name = rangeSnap.name; range.imda_threshold_format = rangeSnap.format;
	try { Panels.outliner.inside_vue.$forceUpdate(); } catch (e) { /* ignore */ }

	const restoredOk = snap.every(s => s.node.name === s.name && s.node.imda_threshold === s.threshold)
		&& range.imda_threshold_format === rangeSnap.format;

	return JSON.stringify({
		rangeFormat: rangeSnap.format,
		stats,
		after,
		restoredOk,
	}, null, 1);
})();
