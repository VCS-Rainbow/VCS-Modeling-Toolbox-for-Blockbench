(async () => {
	try {
		globalThis.__IMM_TEST__ = globalThis.__IMM_TEST__ || {};
		const pid = 'item_model_definition_assembly';
		let p = (typeof Plugins !== 'undefined') ? Plugins.all.find(x => x.id === pid) : null;
		if (!p) return JSON.stringify({ error: 'plugin-not-found' });
		await p.reload();
		p = Plugins.all.find(x => x.id === pid);
		const api = globalThis.__IMM_TEST__ && globalThis.__IMM_TEST__.api;
		if (!api) return JSON.stringify({ error: 'no-api', version: p && p.version, hookKeys: Object.keys(globalThis.__IMM_TEST__ || {}) });

		const R = [];
		const ok = (label, cond, detail) => { R.push({ label, pass: !!cond, detail: cond ? undefined : detail }); };

		// 在“脱离 Outliner 的”分组树上测试：P 本身不 addTo，children 手工挂，绝不碰用户真实工程
		const P = new Group({ name: 'P2' });
		const pa = new Group({ name: 'pa' }); pa.parent = P; P.children.push(pa);
		const pg = new Group({ name: 'pg', origin: [4, 5, 6], rotation: [0, 90, 0] }); pg.parent = P; P.children.push(pg);
		const pb = new Group({ name: 'pb' }); pb.parent = P; P.children.push(pb);
		const T = new Group({ name: 'T2', origin: [8, 8, 8], rotation: [0, 0, 0] });

		const beforeRootLen = (typeof Outliner !== 'undefined' && Outliner.root) ? Outliner.root.length : -1;

		const r = api.applyConvertGroupsToCallTags([pg], T);
		ok('转换 1 个', r.converted === 1, r.converted);
		ok('新建 1 个标签', r.locators.length === 1, r.locators.length);
		const loc = r.locators[0];
		ok('P 子顺序 pa/标签/pb', JSON.stringify(P.children.map(n => n.name).slice(0, 4)) === JSON.stringify(['pa', '调用 T2', 'pb']) || (P.children.length === 3 && P.children[0] === pa && P.children[1] === loc && P.children[2] === pb), P.children.map(n => n.name));
		ok('标签 parent 为 P', loc.parent === P, String(loc.parent));
		ok('是真实 CallTag 类型', api.isCallTagType(loc), loc.type);
		ok('位置取 pg.origin', JSON.stringify(loc.position) === JSON.stringify([4, 5, 6]), loc.position);
		ok('旋转取 pg.rotation', JSON.stringify(loc.rotation) === JSON.stringify([0, 90, 0]), loc.rotation);
		ok('目标指向 T', loc.imda_call_target === T.uuid, { got: loc.imda_call_target, want: T.uuid });
		ok('ignore_inherited_scale', loc.ignore_inherited_scale === true, loc.ignore_inherited_scale);
		ok('pg 已从 P 删除', P.children.indexOf(pg) < 0);
		ok('未污染用户 Outliner.root', ((typeof Outliner !== 'undefined' && Outliner.root) ? Outliner.root.length : -1) === beforeRootLen, { before: beforeRootLen, after: (typeof Outliner !== 'undefined' && Outliner.root) ? Outliner.root.length : -1 });

		// 目标为空：不应动手
		const r2 = api.applyConvertGroupsToCallTags([pa], null);
		ok('无目标不转换', r2.converted === 0 && P.children.indexOf(pa) >= 0, r2.converted);

		// 清理我们造出来的标签（删掉挂在脱离树上的），避免残留 Locator.all
		try { if (loc && loc.remove) loc.remove(); } catch (e) { }

		const failed = R.filter(x => !x.pass);
		return JSON.stringify({ version: api.VERSION, pass: R.length - failed.length, total: R.length, failed: failed.map(f => f.label + ' :: ' + JSON.stringify(f.detail)) });
	} catch (e) {
		return JSON.stringify({ error: String(e && e.message || e), stack: String(e && e.stack || '').split('\n').slice(0, 6) });
	}
})()
