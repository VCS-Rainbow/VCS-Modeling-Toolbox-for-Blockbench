(async function () {
	try {
		const api = globalThis.__IMM_TEST__ && globalThis.__IMM_TEST__.api;
		const CT = api.getCallTag();
		function find(nodes, out) { for (const n of nodes) { if (n.type === 'imda_call_tag') out.push(n); if (n.children && n.children.length) find(n.children, out); } return out; }
		const tags = find(Outliner.root, []);
		const locs = (typeof Locator !== 'undefined' && Locator.all) ? Locator.all.length : -1;
		if (!tags.length) return JSON.stringify({ status: 'no calltag in outliner', rootLen: Outliner.root.length, locatorAll: locs });
		const ct = tags[0];
		try { ct.select && ct.select(); } catch (e) {}
		const ev = { clientX: 200, clientY: 200, which: 3 };
		ct.menu.open(ev, ct);
		const node = ct.menu.node;
		const items = [...node.querySelectorAll('li')].map(li => (li.className || '') + '|' + li.innerText);
		const result = {
			status: 'ok', name: ct.name,
			childCount: node.childElementCount,
			liCount: node.querySelectorAll('li').length,
			items,
			menuStructureLen: ct.menu.structure.length,
			menuStructure: ct.menu.structure.map(s => typeof s === 'string' ? s : (s && s.id) || (s && s.constructor && s.constructor.name)),
		};
		try { ct.menu.hide(); } catch (e) {}
		return JSON.stringify(result);
	} catch (e) { return 'ERR ' + e.message + ' | ' + e.stack; }
})()
