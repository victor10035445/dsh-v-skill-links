/**
 * 设置节控制器冒烟：在 Node 里用 stub 物化客户端 factory（捕获 __ModuleLoader__.load），
 * 用 mock settingsScope 驱动「技能管理」节 face，验证——
 *  1. 节/标签页契约（settings.section：id v-skills、order 5、label 解析；三个 tab 顺序）；
 *  2. 创建即发布（available=true，不再卡在 available:false 渲染 null）；
 *  3. 作用域变更跟随（effective/overridden/commands/buttons）；
 *  4. edit→dirty→save 写 directories 节并清暂存；
 *  5. 自定义指令：新增/编辑/删除暂存 → save 写 commands 节（小写归一）；
 *  6. 快捷按钮：新增/编辑（autoSend）/重名 → save 写 buttons 节；
 *  7. resetField/resetCommands/resetButtons 走 unset；
 *  8. settings.plugin.item 不再注册（旧卡片移除）；
 *  9. dock 槽位注册契约 + 两个触发源 + onPick POST /run。
 * 运行：node test/settings-card-smoke.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const here = fileURLToPath(new URL(".", import.meta.url));
const code = readFileSync(join(here, "..", "lib", "client.js"), "utf8");

/* ── 环境桩：捕获 load()，stub react / client-runtime / fetch ── */
let definition = null;
const windowStub = { __ModuleLoader__: { load: (def) => { definition = def; } } };
const reactStub = {
	createElement: (type, props, ...children) => ({ type, props, children }),
	useCallback: (fn) => fn,
	useState: (init) => [init, () => {}],
	useSyncExternalStore: (_sub, get) => get(),
	useRef: (init) => ({ current: init }),
	useMemo: (fn) => fn(),
};
/* 官方 primitives 桩：Button 记为可识别的元素形状（web shell 静态表的替身）。 */
const primitivesStub = { Button: (props, ...children) => ({ type: "Button", props, children }) };
/* 官方 slots 工具桩：resolveSlotLabel 解析函数标签。 */
const slotsPkgStub = { resolveSlotLabel: (label) => (typeof label === "function" ? label() : label) };
let storeCreated = 0;
const runtimeStub = {
	createSnapshotStore: (init) => {
		storeCreated += 1;
		let state = init;
		const listeners = new Set();
		return {
			getSnapshot: () => state,
			subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
			set: (next) => { state = next; for (const l of [...listeners]) l(); },
			update: () => {},
		};
	},
};
const fetchCalls = [];
globalThis.fetch = async (url, init) => {
	fetchCalls.push({ url: String(url), init });
	return {
		ok: true,
		status: 200,
		json: async () => ({ ok: true, name: JSON.parse(init.body).name }),
	};
};
const requireStub = (spec) => (spec === "react" ? reactStub : spec === "@deepseek-ai/dsh-client-runtime/client" ? runtimeStub : spec === "@deepseek-ai/dsh-client-ui-primitives" ? primitivesStub : spec === "@deepseek-ai/dsh-client-ui-slots" ? slotsPkgStub : null);

new Function("window", "require", code)(windowStub, requireStub);
assert.ok(definition, "捕获到 load 定义");
const plugin = definition.factory(requireStub);
assert.equal(typeof plugin.apply, "function");

/* ── mock ctx：settingsScope + slots + locale + inputTriggers ── */
const scopeListeners = new Set();
let snap = {
	status: "ready",
	value: {
		directories: ["F:/x"],
		commands: [{ name: "greet", prompt: "你好，/greet 已触发" }],
		buttons: [{ name: "新建", prompt: "使用 /alpha 做一件事", autoSend: true }],
	},
	base: { directories: ["F:/base"] },
	user: null,
	revision: 1,
	writable: true,
	mode: "host",
};
const calls = { set: [], unset: [] };
const scope = {
	getSnapshot: () => snap,
	subscribe: (fn) => { scopeListeners.add(fn); return () => scopeListeners.delete(fn); },
	set: async (field, value) => { calls.set.push([field, value]); snap = { ...snap, user: { ...(snap.user ?? {}), [field]: value }, revision: snap.revision + 1 }; },
	unset: async (field) => { calls.unset.push(field); snap = { ...snap, user: null, revision: snap.revision + 1 }; },
};
let boundSpec = null;
let registeredSection = null;
const registeredTabs = [];
let pluginItemRegistrations = 0;
let registeredDock = null;
const registeredSources = [];
const disposers = [];
const localeTable = { nav: "技能管理", title: "技能管理", tabMapping: "技能映射", tabCommands: "自定义指令", tabQuick: "快捷功能" };
const ctx = {
	effect(fn, label) { disposers.push({ label, dispose: fn() }); },
	locale: {
		register: () => () => {},
		bind: (ns) => (key) => localeTable[key] ?? key,
		getSnapshot: () => ({ revision: 1 }),
		subscribe: () => () => {},
	},
	slots: {
		register: (options, component) => ({ options, component }),
		inject: (name, fn) => {
			if (name === "settings.section") registeredSection = fn();
			if (name === "settings.v-skills.tab") registeredTabs.push(fn());
			if (name === "settings.plugin.item") pluginItemRegistrations += 1;
			if (name === "conversation.composer.dock") registeredDock = fn();
		},
	},
	get(name) {
		if (name === "settingsScope") return { bind: (spec) => { boundSpec = spec; return scope; } };
		if (name === "inputTriggers") return { registerSource: (src) => { registeredSources.push(src); return () => {}; } };
		throw new Error(`unexpected service ${name}`);
	},
};

plugin.apply(ctx);
await new Promise((r) => setImmediate(r));

/* ── 1. 节/标签页契约；旧卡片不再注册；face 创建即发布 ── */
assert.ok(registeredSection, "settings.section 槽位已注册");
assert.equal(registeredSection.options.name, "settings.section");
assert.equal(registeredSection.options.id, "v-skills", "节 id");
assert.equal(registeredSection.options.order, 5, "通用(0)之后、模型(10)之前");
assert.equal(registeredSection.options.label(), "技能管理", "label 解析到词典 nav");
assert.deepEqual(registeredSection.options.children["settings.v-skills.tab"], { kind: "list", scope: "root" }, "children 声明节内标签页槽");
assert.equal(registeredTabs.length, 3, "三个标签页注册");
assert.deepEqual(registeredTabs.map((t) => t.options.id), ["mapping", "commands", "quick"], "标签页 id 顺序");
assert.deepEqual(registeredTabs.map((t) => t.options.label()), ["技能映射", "自定义指令", "快捷功能"], "标签页标题解析");
assert.equal(pluginItemRegistrations, 0, "settings.plugin.item 旧卡片已移除");
const face = registeredTabs[0].options.inject().face;
assert.equal(boundSpec.namespace, "v-skill-links", "绑定设置命名空间");
const initial = face.getSnapshot();
assert.ok(initial, "卡片状态非空");
assert.equal(initial.available, true, "创建即发布：available=true（回归：曾漏掉初始 publish）");
assert.equal(initial.status, "ready");
assert.equal(initial.writable, true);
assert.deepEqual(initial.effective, ["F:/x"]);
assert.equal(initial.overridden, false, "用户层为空 → 未覆盖");
assert.equal(initial.text, "F:/x", "草稿种自生效值");
assert.deepEqual(initial.effectiveCommands.map((c) => c.name), ["greet"], "生效指令跟随设置");
assert.equal(initial.commandsOverridden, false);
assert.deepEqual(initial.effectiveButtons.map((b) => b.name), ["新建"], "生效快捷按钮跟随设置");
assert.equal(initial.effectiveButtons[0].autoSend, true, "autoSend 跟随设置");
assert.equal(initial.buttonsOverridden, false, "用户层 buttons 为空 → 未覆盖");

/* ── 1.5 快捷按钮 CRUD：新增 → 编辑（含 autoSend）→ 重名 → 保存 ── */
face.addButton();
assert.equal(face.getSnapshot().buttonsDraft.length, 2, "新增一行空按钮");
assert.equal(face.getSnapshot().buttonsInvalid, true, "空行按钮应标记非法");
assert.equal(face.getSnapshot().buttonsInvalidReason, "buttonNameRequired");
face.editButton(1, "name", "新建");
assert.equal(face.getSnapshot().buttonsInvalidReason, "buttonDup", "与生效按钮重名（trim 后）");
face.editButton(1, "name", " Ship ");
face.editButton(1, "prompt", "发布前检查");
face.editButton(1, "autoSend", true);
assert.equal(face.getSnapshot().buttonsInvalid, false, "填齐后通过校验");
assert.equal(face.getSnapshot().buttonsDirty, true, "按钮草稿为脏");
assert.equal(face.getSnapshot().dirty, true, "按钮草稿计入整体 dirty");
await face.save();
const buttonsWrite = calls.set.find(([field]) => field === "buttons");
assert.deepEqual(buttonsWrite[1], [
	{ name: "新建", prompt: "使用 /alpha 做一件事", autoSend: true },
	{ name: "Ship", prompt: "发布前检查", autoSend: true },
], "保存写 trim 后的按钮数组（name 不做小写归一）");
assert.equal(face.getSnapshot().buttonsDirty, false, "保存后按钮暂存清空");
assert.equal(face.getSnapshot().buttonsOverridden, true, "保存后用户层有 buttons 覆盖");
face.addButton();
assert.equal(face.getSnapshot().buttonsDraft.length, 2, "再增一行");
face.removeButton(1);
assert.equal(face.getSnapshot().buttonsDraft.length, 1, "删除恢复草稿");
face.discard();
assert.equal(face.getSnapshot().buttonsDirty, false, "放弃修改清按钮暂存");

/* ── 2. 作用域变更跟随（目录 + 指令） ── */
snap = { ...snap, value: { directories: ["F:/x", "F:/y"], commands: [{ name: "greet", prompt: "p1" }, { name: "ship", prompt: "p2" }] } };
for (const l of [...scopeListeners]) l();
assert.deepEqual(face.getSnapshot().effective, ["F:/x", "F:/y"], "scope 变更即时反映");
assert.equal(face.getSnapshot().commandsDraft.length, 2, "指令草稿跟随生效值");

/* ── 3. edit → dirty → save（directories） ── */
face.edit("directories", "F:/x\nF:/y\n\n F:/z ");
assert.equal(face.getSnapshot().dirty, true, "暂存即脏");
assert.equal(face.getSnapshot().invalid, false);
await face.save();
assert.deepEqual(calls.set.at(-1), ["directories", ["F:/x", "F:/y", "F:/z"]], "保存写解析后的目录数组");
assert.equal(face.getSnapshot().dirty, false, "保存成功清暂存");
assert.equal(face.getSnapshot().overridden, true, "保存后用户层有覆盖");

/* ── 4. 自定义指令：新增 → 编辑 → 保存（小写归一） ── */
face.addCommand();
assert.equal(face.getSnapshot().commandsDraft.length, 3, "新增一行空指令");
assert.equal(face.getSnapshot().commandsInvalid, true, "空行指令应标记非法");
assert.equal(face.getSnapshot().commandsInvalidReason, "commandNameRequired");
face.editCommand(2, "name", "Ship-It");
face.editCommand(2, "prompt", "发布前跑一遍检查");
assert.equal(face.getSnapshot().commandsInvalid, false, "填齐后通过校验");
assert.equal(face.getSnapshot().commandsDirty, true, "指令草稿为脏");
await face.save();
const commandsWrite = calls.set.find(([field]) => field === "commands");
assert.deepEqual(commandsWrite[1], [
	{ name: "greet", prompt: "p1" },
	{ name: "ship", prompt: "p2" },
	{ name: "ship-it", prompt: "发布前跑一遍检查" },
], "保存写小写归一的指令数组");
assert.equal(face.getSnapshot().commandsDirty, false, "保存后指令暂存清空");
assert.equal(face.getSnapshot().commandsOverridden, true, "保存后用户层有 commands 覆盖");

/* ── 5. 删除 + 重名校验 ── */
face.editCommand(0, "name", "ship");
assert.equal(face.getSnapshot().commandsInvalid, true, "重名应非法");
assert.equal(face.getSnapshot().commandsInvalidReason, "commandDup");
face.removeCommand(0);
assert.equal(face.getSnapshot().commandsInvalid, false, "删除后恢复合法");
face.discard();
assert.equal(face.getSnapshot().dirty, false, "放弃修改清全部暂存");

/* ── 6. resetField / resetCommands / resetButtons 走 unset ── */
await face.resetField();
assert.deepEqual(calls.unset, ["directories"]);
await face.resetCommands();
assert.deepEqual(calls.unset, ["directories", "commands"]);
assert.equal(face.getSnapshot().commandsOverridden, false, "重置后无 commands 覆盖");
await face.resetButtons();
assert.deepEqual(calls.unset, ["directories", "commands", "buttons"]);
assert.equal(face.getSnapshot().buttonsOverridden, false, "重置后无 buttons 覆盖");

/* ── 6.5 dock 槽位注册契约：conversation.composer.dock + inject 提供按钮快照 face ── */
snap = { ...snap, value: { ...snap.value, buttons: [{ name: "新建", prompt: "使用 /alpha 做一件事", autoSend: true }] } };
for (const l of [...scopeListeners]) l();
assert.ok(registeredDock, "conversation.composer.dock 槽位已注册");
assert.equal(registeredDock.options.name, "conversation.composer.dock");
assert.equal(registeredDock.options.id, "v-quick-buttons");
assert.equal(registeredDock.options.order, -1, "紧贴输入卡片（stats=0 在其下）");
const dockFace = registeredDock.options.inject();
assert.ok(dockFace.buttons && typeof dockFace.buttons.getSnapshot === "function", "inject 提供按钮快照 store");
assert.deepEqual(dockFace.buttons.getSnapshot().buttons.map((b) => b.name), ["新建"], "dock face 快照投影 settings buttons");
assert.equal(dockFace.buttons.getSnapshot().buttons[0].autoSend, true);

/* ── 7. 两个触发源：映射技能 + 自定义指令 ── */
const skillSource = registeredSources.find((s) => s.name === "映射技能");
const commandSource = registeredSources.find((s) => s.name === "自定义指令");
assert.ok(skillSource && skillSource.order === -1, "映射技能源置顶");
assert.ok(commandSource && commandSource.order === -0.5, "自定义指令源紧跟其后");

/* ── 8. onPick 返回 handled 并 POST /run ── */
const outcome = commandSource.onPick({
	candidate: { name: "ship-it", description: "" },
	session: { sessionId: "session-abc" },
});
assert.equal(outcome, "handled", "选中即由源内部处理");
await new Promise((r) => setImmediate(r));
const runCall = fetchCalls.at(-1);
assert.ok(runCall.url.endsWith("/api/v-skill-links/run"), "POST /run");
assert.deepEqual(JSON.parse(runCall.init.body), { sessionId: "session-abc", name: "ship-it" });

for (const d of disposers) d.dispose?.();
console.log("settings-card-smoke: ok");
