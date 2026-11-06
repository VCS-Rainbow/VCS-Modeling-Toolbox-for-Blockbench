(async function () {
	try {
		const api = globalThis.__IMM_TEST__.api;
		const before = Outliner.root.length;
		const tag = api.newCallTag({ name: 'probe-menu', target: 'x', position: [0, 0, 0], rotation: [0, 0, 0] });
		try { tag.parent = null; } catch (e) {}
		// 临时把 tag 放进选择，让菜单条件成立（仅内存中的选择状态，打开后立刻还原）
		const savedSel = (Outliner.selected || []).slice();
		const savedMark = tag.selected;
		try { Outliner.selected.length = 0; Outliner.selected.push(tag); tag.selected = true; } catch (e) {}
		tag.menu.open({ clientX: 200, clientY: 200, which: 3 }, tag);
		const node = tag.menu.node;
		const rows = [...node.querySelectorAll('li')].map(li => {
			const isSep = li.classList.contains('menu_separator');
			const kb = li.querySelector('.keybinding_label');
			return { sep: isSep, text: (li.innerText || '').replace(/\n/g, '/'), kb: kb ? kb.textContent : '' };
		});
		tag.menu.hide();
		// 还原选择
		try { Outliner.selected.length = 0; for (const s of savedSel) Outliner.selected.push(s); tag.selected = savedMark; } catch (e) {}
		const nonSep = rows.filter(r => !r.sep);
		const res = {
			rootUnchanged: Outliner.root.length === before,
			lastEightNonSep: nonSep.slice(-8),
			lastNineRaw: rows.slice(-9),
		};
		try { tag.remove(); } catch (e) {}
		return JSON.stringify(res);
	} catch (e) { return 'ERR ' + e.message + ' | ' + e.stack; }
})()
