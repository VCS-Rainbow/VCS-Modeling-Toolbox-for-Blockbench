(async function () {
	try {
		const api = globalThis.__IMM_TEST__ && globalThis.__IMM_TEST__.api;
		const CT = api.getCallTag();
		function find(nodes, out) { for (const n of nodes) { if (n.type === 'imda_call_tag') out.push(n); if (n.children && n.children.length) find(n.children, out); } return out; }
		const tags = find(Outliner.root, []);
		const inst = tags[0] || null;
		const structOf = (m) => m ? m.structure.map(s => typeof s === 'string' ? s : (s && s.id) || (s && s.constructor && s.constructor.name)) : null;
		// fresh detached calltag
		const fresh = api.newCallTag ? api.newCallTag({ name: 'probe', target: 'x', position: [0,0,0], rotation: [0,0,0] }) : null;
		const out = {
			hasCurrentClass: !!CT,
			currentProtoMenu: structOf(CT && CT.prototype.menu),
			instCount: tags.length,
			instName: inst && inst.name,
			instIsCurrent: inst ? (inst instanceof CT) : null,
			instCtorEq: inst ? (inst.constructor === CT) : null,
			instProtoMenu: inst ? structOf(inst.menu) : null,
			instMenuSameAsProto: inst ? (inst.menu === (inst.constructor.prototype.menu)) : null,
			freshIsCurrent: fresh ? (fresh instanceof CT) : null,
			freshMenuSameAsProto: fresh ? (fresh.menu === CT.prototype.menu) : null,
			freshMenu: fresh ? structOf(fresh.menu) : null,
		};
		// try opening fresh menu
		if (fresh) {
			try {
				fresh.menu.open({ clientX: 100, clientY: 100, which: 3 }, fresh);
				out.freshRenderedItems = [...fresh.menu.node.querySelectorAll('li')].map(li => li.innerText).filter(Boolean);
				out.freshChildCount = fresh.menu.node.childElementCount;
				fresh.menu.hide();
			} catch (e) { out.freshOpenErr = e.message; }
			try { fresh.remove(); } catch (e) {}
		}
		return JSON.stringify(out);
	} catch (e) { return 'ERR ' + e.message + ' | ' + e.stack; }
})()
