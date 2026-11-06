(async function () {
	const log = {};
	try {
		// 1) 还原选择：只保留真正在 Outliner.root 里的节点
		const rootSet = new Set();
		const walk = (ns) => { for (const n of ns) { rootSet.add(n); if (n.children && n.children.length) walk(n.children); } };
		walk(Outliner.root);
		const beforeSel = (Outliner.selected || []).length;
		const kept = (Outliner.selected || []).filter(n => n && rootSet.has(n));
		try { Outliner.selected.length = 0; for (const s of kept) Outliner.selected.push(s); } catch (e) {}
		log.selBefore = beforeSel; log.selAfter = (Outliner.selected || []).length;

		// 2) 找出所有 probe 残留节点并从 uuids 清理
		let strays = [];
		try { for (const k in Locator.all) { const n = Locator.all[k]; if (n && /^probe-menu/.test(n.name)) strays.push(n); } } catch (e) {}
		for (const n of strays) { try { n.remove(); } catch (e) {} }
		log.straysRemoved = strays.length;
		log.rootLen = Outliner.root.length;
		return JSON.stringify(log);
	} catch (e) { return 'ERR ' + e.message + ' | ' + JSON.stringify(log); }
})()
