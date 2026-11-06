(async function () {
	try {
		const api = globalThis.__IMM_TEST__.api;
		const before = Outliner.root.length;
		const tag = api.newCallTag({ name: 'probe-menu', target: 'x', position: [0, 0, 0], rotation: [0, 0, 0] });
		// 确保脱离大纲（不要进入 Outliner.root）
		try { tag.parent = null; } catch (e) {}
		tag.menu.open({ clientX: 200, clientY: 200, which: 3 }, tag);
		const node = tag.menu.node;
		const lis = [...node.querySelectorAll('li')];
		const rows = lis.map(li => {
			const isSep = li.classList.contains('menu_separator');
			const kb = li.querySelector('.keybinding_label');
			return { sep: isSep, text: (li.innerText || '').replace(/\n/g, '/'), kb: kb ? kb.textContent : '' };
		});
		tag.menu.hide();
		const nonSep = rows.filter(r => !r.sep);
		const res = {
			rootUnchanged: Outliner.root.length === before,
			lastSixNonSep: nonSep.slice(-6),
			lastTenRaw: rows.slice(-9),
		};
		try { tag.remove(); } catch (e) {}
		res.rootUnchangedAfterRemove = Outliner.root.length === before;
		return JSON.stringify(res);
	} catch (e) { return 'ERR ' + e.message + ' | ' + e.stack; }
})()
