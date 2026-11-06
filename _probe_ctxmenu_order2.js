(async function () {
	try {
		function find(nodes, out) { for (const n of nodes) { if (n.type === 'imda_call_tag') out.push(n); if (n.children && n.children.length) find(n.children, out); } return out; }
		const tags = find(Outliner.root, []);
		const ct = tags[0];
		if (!ct) return JSON.stringify({ status: 'no calltag' });
		ct.menu.open({ clientX: 200, clientY: 200, which: 3 }, ct);
		const node = ct.menu.node;
		const lis = [...node.querySelectorAll('li')];
		const rows = lis.map(li => {
			const isSep = li.classList.contains('menu_separator');
			const kb = li.querySelector('.keybinding_label');
			return { sep: isSep, text: (li.innerText || '').replace(/\n/g, '/'), kb: kb ? kb.textContent : '' };
		});
		const tail = rows.filter(r => !r.sep).slice(-6);
		ct.menu.hide();
		const api = globalThis.__IMM_TEST__.api;
		return JSON.stringify({
			status: 'ok', name: ct.name,
			extractKey: String((Plugins.all.find(p => p.id === 'item_model_definition_assembly'), '') ),
			rowsTail: tail,
			rawTail: rows.slice(-10),
		});
	} catch (e) { return 'ERR ' + e.message + ' | ' + e.stack; }
})()
