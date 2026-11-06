(async function () {
	try {
		const p = Plugins.all.find(x => x.id === 'item_model_definition_assembly');
		if (!p) return 'plugin not found';
		await p.reload();
		const cur = Plugins.all.find(x => x.id === 'item_model_definition_assembly');
		return JSON.stringify({ reloaded: true, version: cur && cur.version });
	} catch (e) { return 'ERR ' + e.message + ' | ' + e.stack; }
})()
