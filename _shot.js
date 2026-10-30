#!/usr/bin/env node
/* 临时：通过 CDP 截取 Blockbench 视口截图（只读，不改工程） */
'use strict';
const fs = require('fs');

const PORT = 9222;
const outFile = process.argv[2] || 'shot.png';

const get = (p) => new Promise((resolve, reject) => {
	const http = require('http');
	http.get({ host: '127.0.0.1', port: PORT, path: p }, res => {
		let body = '';
		res.on('data', d => body += d);
		res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
	}).on('error', reject);
});

(async () => {
	const targets = await get('/json/list');
	const page = targets.find(t => t.type === 'page');
	if (!page) throw new Error('没有 page target');
	const ws = new WebSocket(page.webSocketDebuggerUrl);
	let id = 0;
	const pending = new Map();
	const send = (method, params) => new Promise((resolve, reject) => {
		const mid = ++id;
		pending.set(mid, { resolve, reject });
		ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
	});
	ws.addEventListener('message', (ev) => {
		const msg = JSON.parse(ev.data);
		if (msg.id && pending.has(msg.id)) {
			const p = pending.get(msg.id);
			pending.delete(msg.id);
			if (msg.error) p.reject(new Error(msg.error.message));
			else p.resolve(msg.result);
		}
	});
	await new Promise((resolve, reject) => {
		ws.addEventListener('open', resolve, { once: true });
		ws.addEventListener('error', reject, { once: true });
	});
	const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
	fs.writeFileSync(outFile, Buffer.from(shot.data, 'base64'));
	console.log('saved ' + outFile + ' (' + Buffer.from(shot.data, 'base64').length + ' bytes)');
	ws.close();
	process.exit(0);
})().catch(err => { console.error('FAIL ' + err.message); process.exit(1); });
