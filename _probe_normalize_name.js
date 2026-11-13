/* 在真实工程里做一次「规范化序号/名称」的干跑：快照 → 运行 → 记录 diff → 原样还原。
   只读结论，不改工程结构，也不写 Undo。 */
(function () {
	const api = globalThis.__IMM_TEST__ && globalThis.__IMM_TEST__.api;
	if (!api) return 'no-api';
	const root = (typeof Outliner !== 'undefined' && Outliner && Outliner.root) ? Outliner.root : [];
	const snap = [];
	const collect = (nodes) => {
		for (const node of nodes || []) {
			if (node instanceof Group) {
				snap.push({
					node,
					name: node.name,
					threshold: node.imda_threshold,
					exported: node.export,
					visibility: node.visibility,
					autoDisabled: node.imda_auto_disabled,
				});
				collect(node.children);
			} else if (node && node.name !== undefined) {
				snap.push({ node, name: node.name });
			}
		}
	};
	collect(root);

	const stats = api.normalizeGroupNumbersAndNames();

	const changed = [];
	for (const entry of snap) {
		const node = entry.node;
		if (entry.name !== node.name) {
			changed.push({ kind: 'name', before: entry.name, after: node.name });
		}
		if (entry.threshold !== undefined && String(entry.threshold) !== String(node.imda_threshold)) {
			changed.push({ kind: 'threshold', name: node.name, before: entry.threshold, after: node.imda_threshold });
		}
	}

	// 原样还原
	for (const entry of snap) {
		const node = entry.node;
		node.name = entry.name;
		if (entry.threshold !== undefined) node.imda_threshold = entry.threshold;
		if (entry.exported !== undefined) node.export = entry.exported;
		if (entry.visibility !== undefined) node.visibility = entry.visibility;
		if (entry.autoDisabled !== undefined) node.imda_auto_disabled = entry.autoDisabled;
	}
	try { Panels.outliner.inside_vue.$forceUpdate(); } catch (e) { /* ignore */ }
	return JSON.stringify({ stats, count: changed.length, sample: changed.slice(0, 25) }, null, 1);
})();
