(async () => {
	try {
		globalThis.__IMM_TEST__ = globalThis.__IMM_TEST__ || {};
		const pid = 'item_model_definition_assembly';
		let p = Plugins.all.find(x => x.id === pid);
		await p.reload();
		const api = globalThis.__IMM_TEST__.api;
		const histLen = Undo.history.length, idx = Undo.index, saved = Project.saved;
		let P, B1, B2, res = {};
		try {
			P = new Group({ name: 'P3', imda_type: 'composite', origin: [8, 8, 8], rotation: [0, 0, 0] });
			P.uuid = '__P3__'; OutlinerNode.uuids[P.uuid] = P;
			B1 = new Group({ name: 'b1', imda_type: 'model', imda_model: 'ns:a', origin: [8, 8, 8], rotation: [0, 0, 0] });
			B2 = new Group({ name: 'b2', imda_type: 'model', imda_model: 'ns:b', origin: [8, 8, 8], rotation: [0, 0, 0] });
			for (const b of [B1, B2]) { b.parent = P; P.children.push(b); b.uuid = '__' + b.name + '__'; OutlinerNode.uuids[b.uuid] = b; }
			// 复刻 applyChanges 的新撤销范围
			const affected = []; const affectedCubes = [];
			const add = (g) => { if (g && g.type === 'group' && affected.indexOf(g) < 0) affected.push(g); };
			for (const g of api.collectGroupSubtree(P)) add(g);
			Undo.initEdit({ outliner: true, groups: affected, elements: affectedCubes });
			api.assignGroupMapProps(P, { imda_type: 'range_dispatch', imda_property: 'custom_model_data', imda_index: 0, imda_threshold_format: 'i' });
			api.sortBranchChildren(P); api.syncBranchLabels(P);
			Undo.finishEdit('x', { outliner: true, groups: affected, elements: affectedCubes });
			const n = Undo.history[Undo.history.length - 1];
			const names = (s) => (s && s.groups ? s.groups.map(g => g.name) : null);
			res = {
				affectedNames: affected.map(g => g.name),
				beforeGroups: names(n && n.before),
				postGroups: names(n && n.post),
				hasBeforeOutliner: !!(n && n.before && n.before.outliner),
				beforeB1Name: n && n.before && n.before.groups && (n.before.groups.find(g => g.uuid === '__b1__') || {}).name,
			};
		} finally {
			for (const g of [B1, B2, P]) { try { if (g) g.remove(); } catch (e) { } }
			for (const u of ['__P3__', '__b1__', '__b2__']) { try { delete OutlinerNode.uuids[u]; } catch (e) { } }
			Undo.history.length = histLen; Undo.index = idx; try { Project.saved = saved; } catch (e) { }
		}
		return JSON.stringify(res);
	} catch (e) { return JSON.stringify({ fatal: String(e && e.message || e) }); }
})()
