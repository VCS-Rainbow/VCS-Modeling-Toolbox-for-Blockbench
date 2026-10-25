/* 离线单测：模拟求值（select / range_dispatch / condition / fallback）与 pack.mcmeta 版本表
 * 用法：node _test_sim.js   （mock 最小 Blockbench 环境，通过 globalThis.__IMM_TEST__ 取内部函数） */
const path = require('path');

const PLUGIN = 'C:\\Users\\Rainbow_\\blockbench_item_model_mapping_isolated\\item_model_definition_assembly.js';

/* ---------- 最小 mock ---------- */
class Quaternion { constructor() { this.x = 0; this.y = 0; this.z = 0; this.w = 1; } setFromEuler() { return this; } normalize() { return this; } lengthSq() { return 1; } copy() { return this; } }
class Euler { constructor(x = 0, y = 0, z = 0, order = 'XYZ') { Object.assign(this, { x, y, z, order }); } }

/* 极简 DOM：够 buildSimPanel 组装结构，并能触发 change / input / click 事件 */
class FakeEl {
	constructor(tag) { this.tagName = String(tag).toUpperCase(); this.children = []; this.style = { cssText: '' }; this._text = ''; this._html = ''; this.parentElement = null; this.value = undefined; this.checked = false; this.disabled = false; this.type = ''; this.listeners = []; }
	appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
	insertBefore(child, ref) { child.parentElement = this; const at = this.children.indexOf(ref); this.children.splice(at < 0 ? this.children.length : at, 0, child); return child; }
	addEventListener(type, fn) { this.listeners.push({ type, fn }); }
	fire(type) { for (const listener of this.listeners) if (listener.type === type) listener.fn({ target: this, preventDefault() { } }); }
	get firstChild() { return this.children[0] || null; }
	get lastElementChild() { return this.children[this.children.length - 1] || null; }
	set textContent(value) { this._text = String(value); this.children = []; }
	get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
	set innerHTML(value) { this._html = String(value); if (value === '') this.children = []; }
	get innerHTML() { return this._html; }
	querySelectorAll() { return []; }
}
global.document = { createElement: (tag) => new FakeEl(tag) };
global.Panel = class { constructor(id, options) { this.id = id; this.node = new FakeEl('div'); this.options = options || {}; } show() { } delete() { } };

global.THREE = {
	Quaternion, Euler,
	MeshBasicMaterial: class { constructor(o) { Object.assign(this, o || {}); this.color = { v: (o && o.color) || 0xffffff, setHex(h) { this.v = h; } }; } dispose() { } },
};
global.Texture = class { constructor(o) { Object.assign(this, o); } }; Texture.all = [];
global.Cube = class { constructor(o) { Object.assign(this, o); } addTo(parent) { if (this.parent && Array.isArray(this.parent.children)) { const old = this.parent.children.indexOf(this); if (old >= 0) this.parent.children.splice(old, 1); } if (parent) { this.parent = parent; if (Array.isArray(parent.children) && parent.children.indexOf(this) < 0) parent.children.push(this); } return this; } init() { return this; } }; global.Cube.all = [];
global.Group = class { constructor(o) { Object.assign(this, o); this.children = []; } addTo(parent) { if (this.parent && Array.isArray(this.parent.children)) { const old = this.parent.children.indexOf(this); if (old >= 0) this.parent.children.splice(old, 1); } if (parent) { this.parent = parent; if (Array.isArray(parent.children) && parent.children.indexOf(this) < 0) parent.children.push(this); } else if (Array.isArray(global.Outliner.root) && global.Outliner.root.indexOf(this) < 0) global.Outliner.root.push(this); return this; } init() { return this; } }; global.Group.all = [];
global.Locator = class { constructor(o) { Object.assign(this, o); this.uuid = (o && o.uuid) || ('loc-' + Math.random()); } addTo() { return this; } init() { return this; } };
global.Outliner = { root: [], selected: [] };
global.Project = { name: 'test', imda_pack_version: '26.2' };
global.Properties = [];
global.Property = class { constructor(target, type, name, options) { global.Properties.push({ target, type, name, options }); } };
global.Format = { id: 'item_model_definition_assembly' };
global.ModelProject = class { };
global.Face = class { };
let plugin_options = null;
global.Plugin = { register(id, options) { plugin_options = options; } };
global.Action = class { constructor(id, options) { Object.assign(this, options); this.id = id; } delete() { } };
global.MenuBar = { addAction() { }, removeAction() { }, update() { }, menus: { file: { structure: [] } } };
global.Dialog = class { constructor(o) { this.options = o; } show() { return this; } };
global.Codec = class { constructor(id, data) { Object.assign(this, data); this.id = id; } delete() { } };
global.ModelFormat = class { constructor(id, data) { Object.assign(this, data); this.id = id; } delete() { } };
global.Blockbench = {
	showQuickMessage() { }, showMessageBox() { }, on() { }, writeFile() { }, pickDirectory() { return null; },
};

/* 测试钩子必须在 require 之前挂好 */global.requireNativeModule=(name)=>name==="fs"?require("fs"):require("path");
global.__IMM_TEST__ = {};
require("C:\\Users\\Rainbow_\\blockbench_item_model_mapping_isolated\\item_model_definition_assembly.js");
plugin_options.onload();
const api=global.__IMM_TEST__.api;
global.Project.imda_pack_path="C:\\Game\\Minecraft\\.minecraft\\resourcepacks\\Squilker Sparkle Res";
console.log(api.sourceModelGeometryCenter("sqsp:item/inker/jet_rifle/sac.full"));
