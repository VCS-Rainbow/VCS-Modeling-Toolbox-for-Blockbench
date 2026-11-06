(async function () {
	try {
		function find(nodes, out) { for (const n of nodes) { if (n.type === 'imda_call_tag') out.push(n); if (n.children && n.children.length) find(n.children, out); } return out; }
		function imdaCount(menu) {
			if (!menu || !Array.isArray(menu.structure)) return -1;
			return menu.structure.filter(s => { const id = typeof s === 'string' ? s : (s && s.id) || ''; return String(id).startsWith('imda_menu_'); }).length;
		}
		function totalImda(menu) {
			if (!menu || !Array.isArray(menu.structure)) return -1;
			return menu.structure.filter(s => { const id = typeof s === 'string' ? s : (s && s.id) || ''; return String(id).startsWith('imda_'); }).length;
		}
		const CT = globalThis.__IMM_TEST__.api.getCallTag();
		const tags = find(Outliner.root, []);
		const inst = tags[0];
		const before = { inst: totalImda(inst.menu), loc: totalImda(Locator.prototype.menu), cur: totalImda(CT.prototype.menu) };
		for (let i = 0; i < 5; i++) { try { Blockbench.dispatchEvent('update_selection', {}); } catch (e) {} }
		const after = { inst: totalImda(inst.menu), loc: totalImda(Locator.prototype.menu), cur: totalImda(CT.prototype.menu) };
		// render inst menu, count plugin items via innerText
		inst.menu.open({ clientX: 100, clientY: 100, which: 3 }, inst);
		const txt = inst.menu.node.innerText;
		const dupCheck = {
			instantiate: (txt.match(/实例化同组复调用标签/g) || []).length,
			edit: (txt.match(/编辑复调用标签/g) || []).length,
			apply: (txt.match(/应用变换/g) || []).length,
		};
		inst.menu.hide();
		return JSON.stringify({ before, after, dupCheck, tagCount: tags.length, instSameMenu: inst.menu === inst.constructor.prototype.menu });
	} catch (e) { return 'ERR ' + e.message + ' | ' + e.stack; }
})()
