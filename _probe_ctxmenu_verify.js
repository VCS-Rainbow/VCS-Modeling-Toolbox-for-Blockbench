(async function () {
	try {
		const api = globalThis.__IMM_TEST__.api;
		const CT = api.getCallTag();
		const getItem = (id) => (CT.prototype.menu.structure || []).find(s => s && s.id === id);
		const ext = getItem('imda_menu_extract_pose_loc');
		const app = getItem('imda_menu_apply_pose_loc');
		const inst = getItem('imda_menu_instantiate_this');
		const edit = getItem('imda_menu_edit_call');
		const meta = (it) => it ? { id: it.id, name: it.name, icon: it.icon, kb: it.keybind ? String(it.keybind.toString()) : '', isAction: it instanceof Action } : null;

		// 用一个临时 Menu 只验证普通对象能被渲染出 keybind 标签（条件省略→必显示）
		let rendered = null;
		try {
			const m = new Menu([
				{ id: 'x_extract', name: '提取变换', icon: 'content_copy', keybind: ext && ext.keybind, click() {} },
				{ id: 'x_apply', name: '应用变换', icon: 'content_paste', keybind: app && app.keybind, click() {} },
			]);
			m.open({ clientX: 100, clientY: 100, which: 3 }, {});
			rendered = [...m.node.querySelectorAll('li')].map(li => {
				const kb = li.querySelector('.keybinding_label');
				return { text: (li.innerText || '').replace(/\n/g, '/'), kb: kb ? kb.textContent : '' };
			});
			m.hide();
		} catch (e) { rendered = 'render-err ' + e.message; }

		return JSON.stringify({
			structure: (CT.prototype.menu.structure || []).map(s => typeof s === 'string' ? s : (s && s.id) || (s && s.constructor && s.constructor.name)),
			extract: meta(ext), apply: meta(app), inst: meta(inst), edit: meta(edit),
			rendered,
		});
	} catch (e) { return 'ERR ' + e.message + ' | ' + e.stack; }
})()
