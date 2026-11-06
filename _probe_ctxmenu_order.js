(async function () {
	try {
		function find(nodes, out) { for (const n of nodes) { if (n.type === 'imda_call_tag') out.push(n); if (n.children && n.children.length) find(n.children, out); } return out; }
		const tags = find(Outliner.root, []);
		const ct = tags[0];
		if (!ct) return JSON.stringify({ status: 'no calltag' });
		ct.menu.open({ clientX: 200, clientY: 200, which: 3 }, ct);
		const node = ct.menu.node;
		const items = [...node.querySelectorAll('li')].map(li => li.innerText.replace(/\n/g, '/')).filter(Boolean);
		const struct = ct.menu.structure.map(s => typeof s === 'string' ? s : (s && s.id) || (s && s.constructor && s.constructor.name));
		ct.menu.hide();
		return JSON.stringify({ status: 'ok', name: ct.name, lastItems: items.slice(-6), struct });
	} catch (e) { return 'ERR ' + e.message + ' | ' + e.stack; }
})()
