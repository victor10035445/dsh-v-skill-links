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
/* 模拟真实 store（@deepseek-ai/dsh-client-store）的冻结语义：set 前对入参递归 Object.freeze
 * 再整态替换（fix-dsh-012-compat design D4）；编辑路径因此在冻结输入上受测（design D3 不变量）。 */
const deepFreeze = (value) => {
	if (value === null || typeof value !== "object") return value;
	for (const key of Object.keys(value)) deepFreeze(value[key]);
	return Object.freeze(value);
};
const runtimeStub = {
	createSnapshotStore: (init) => {
		storeCreated += 1;
		let state = init;
		const listeners = new Set();
		return {
			getSnapshot: () => state,
			subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
			set: (next) => { state = deepFreeze(next); for (const l of [...listeners]) l(); },
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
const requireStub = (spec) => (spec === "react" ? reactStub : spec === "@deepseek-ai/dsh-client-store" ? runtimeStub : spec === "@deepseek-ai/dsh-client-ui-primitives" ? primitivesStub : spec === "@deepseek-ai/dsh-client-ui-slots" ? slotsPkgStub : null);

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
/* ── 设置 seam 三态开关（change add-dual-host-seam-compat）：主场景 = 仅 settingsScope（0.1.5 web CLI）。── */
const providedSeams = new Set(["settingsScope"]);
/* configForms 通道假件（0.2.0 桌面端）：只实现官方 ConfigFormController 的四个方法。 */
const cfState = {
	entryIds: [],
	snapshot: { status: "unavailable", value: undefined, base: undefined, user: undefined, revision: undefined, writable: true, mode: "host" },
	accept: true,
	set: [],
	unset: [],
};
const configFormsService = {
	get(entryId) {
		cfState.entryIds.push(entryId);
		return {
			getSnapshot: () => cfState.snapshot,
			subscribe: () => () => {},
			set: async (field, value) => { cfState.set.push([field, value]); return cfState.accept; },
			unset: async (field) => { cfState.unset.push(field); return cfState.accept; },
		};
	},
};
/* 可选注入桩（add-quick-button-model）：remote / sessions 齐备 → 目录桥创建，面板拿得到候选项。 */
const injectCalls = [];
const modelCatalogCalls = [];
const modelGroups = [
	{
		id: "p1", name: "Provider One",
		models: [
			{ id: "m-a", name: "Model A", reasoning: { efforts: [{ id: "low", name: "Low" }, { id: "max", name: "Max" }] } },
			{ id: "m-b", name: "Model B" },
		],
	},
];
const injectScope = {
	remote: {
		session: {
			modelCatalog: async () => { modelCatalogCalls.push(1); return { ok: true, value: { groups: modelGroups } }; },
			selectModel: async () => ({ ok: true, value: { selected: {} } }),
		},
		$on: () => () => {},
	},
	sessions: { subagentAddress: () => undefined },
	on: () => () => {},
};
const ctx = {
	effect(fn, label) { disposers.push({ label, dispose: fn() }); },
	inject(deps, fn) {
		injectCalls.push(deps);
		/* 设置 seam 子注入（change add-dual-host-seam-compat）：服务缺失时 cordis 根本不调回调
		   （只让该子任务 pending），这里如实模拟——MUST NOT 给新通道误喂非 scope 对象。 */
		if (deps.includes("settingsScope")) return providedSeams.has("settingsScope")
			? fn({ settingsScope: { bind: (spec) => { boundSpec = spec; return scope; } } })
			: undefined;
		if (deps.includes("configForms")) return providedSeams.has("configForms") ? fn({ configForms: configFormsService }) : undefined;
		/* 模拟宿主 cordis 服务门（0.1.5-rc.2 回归保护）：remote.session 是独立服务键，
		   作用域未声明时 `scope.remote.session` 读取直接抛错（目录桥随之永不就绪）。 */
		const remote = deps.includes("remote.session") ? injectScope.remote
			: Object.defineProperty(Object.create(injectScope.remote), "session", {
				get() { throw new Error('cannot get property "remote.session" without inject'); },
			});
		return fn({ ...injectScope, remote });
	},
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
		/* settingsScope MUST NOT 再经 ctx.get 静态读取（本插件改为运行时子注入）；读到即回归。 */
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

/* ── 1.6 按钮模型绑定（add-quick-button-model）：editButton("model") 草稿 / 保存 / 取消绑定 / 回退 ── */
assert.deepEqual(injectCalls, [["settingsScope"], ["configForms"], ["remote", "remote.session", "sessions"]],
	"静态 inject 列表不动：设置双通道 + 模型目录全部走运行时可选子注入（remote.session 是 cordis 独立服务键，MUST 声明）");
assert.equal(modelCatalogCalls.length, 1, "目录桥构造即预取一次（官方模型目录同款）");
const quickTab = registeredTabs.find((t) => t.options.id === "quick");
const quickProps = quickTab.options.inject();
assert.ok(quickProps.models && typeof quickProps.models.getSnapshot === "function", "快捷功能标签页拿到模型目录快照面");
assert.equal(quickProps.models.getSnapshot().catalog.status, "ready", "目录加载成功（status ready）");
assert.deepEqual(quickProps.models.getSnapshot().catalog.groups.map((g) => g.id), ["p1"], "目录 groups 透传（与会话模型菜单同源）");
face.addButton();
face.editButton(1, "name", "Plain");
face.editButton(1, "prompt", "无绑定的按钮");
face.editButton(0, "model", { provider: "p1", model: "m-a", reasoningEffort: "max" });
assert.deepEqual(face.getSnapshot().buttonsDraft[0].model,
	{ provider: "p1", model: "m-a", reasoningEffort: "max" }, "模型绑定进草稿（键序固定 provider→model→reasoningEffort）");
assert.equal(face.getSnapshot().buttonsDirty, true, "模型绑定计入按钮脏标记");
await face.save();
const modelWrite = calls.set.filter(([field]) => field === "buttons").at(-1);
assert.deepEqual(modelWrite[1][0].model, { provider: "p1", model: "m-a", reasoningEffort: "max" }, "保存写出 model 三元组");
assert.ok(!("model" in modelWrite[1][1]), "未绑定条目 MUST NOT 输出 model 键");
assert.equal(face.getSnapshot().buttonsDirty, false, "保存后按钮暂存清空");
/* 生效值携带绑定 → 草稿跟随；取消绑定删键；放弃修改回退原绑定 */
snap = { ...snap, value: { ...snap.value, buttons: [{ name: "新建", prompt: "使用 /alpha 做一件事", autoSend: true, model: { provider: "p1", model: "m-a", reasoningEffort: "max" } }] } };
for (const l of [...scopeListeners]) l();
assert.deepEqual(face.getSnapshot().buttonsDraft[0].model,
	{ provider: "p1", model: "m-a", reasoningEffort: "max" }, "生效绑定随 settingsScope 跟进草稿");
face.editButton(0, "model", undefined);
assert.equal(face.getSnapshot().buttonsDirty, true, "取消绑定翻起 dirty");
assert.ok(!("model" in face.getSnapshot().buttonsDraft[0]), "取消绑定时 MUST 删除 model 键（不留 model: undefined）");
face.discard();
assert.deepEqual(face.getSnapshot().buttonsDraft[0].model,
	{ provider: "p1", model: "m-a", reasoningEffort: "max" }, "放弃修改回退到生效绑定");

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

/* ══════════════ 9. 设置 seam 三态宿主矩阵（change add-dual-host-seam-compat，task 4.2/4.3） ══════════════
   三态：仅 settingsScope（上面整段主场景）/ 仅 configForms（0.2.0 桌面端）/ 两者皆无。
   断言三态下客户端均激活完成，设置卡分别呈可写、按 configForms 能力、合成只读 scope。 */
const applyWith = (seams) => {
	const seen = { section: null, tabs: [], dock: null, sources: [], injects: [] };
	const localCtx = {
		effect: (fn) => { fn(); return () => {}; },
		inject(deps, fn) {
			seen.injects.push(deps);
			if (deps.includes("settingsScope")) return seams.settingsScope ? fn({ settingsScope: seams.settingsScope }) : undefined;
			if (deps.includes("configForms")) return seams.configForms ? fn({ configForms: seams.configForms }) : undefined;
			return undefined; /* 模型目录桥：三态矩阵不关心（降级路径已由主场景覆盖） */
		},
		locale: { register: () => () => {}, bind: () => (key) => key, getSnapshot: () => ({ revision: 1 }), subscribe: () => () => {} },
		slots: {
			register: (options, component) => ({ options, component }),
			inject: (name, fn) => {
				if (name === "settings.section") seen.section = fn();
				if (name === "settings.v-skills.tab") seen.tabs.push(fn());
				if (name === "conversation.composer.dock") seen.dock = fn();
			},
		},
		get(name) {
			if (name === "inputTriggers") return { registerSource: (src) => { seen.sources.push(src); return () => {}; } };
			throw new Error(`unexpected service ${name}`);
		},
	};
	plugin.apply(localCtx);
	seen.face = seen.tabs.find((t) => t.options.id === "mapping")?.options.inject().face;
	return seen;
};

/* 9a. 仅 configForms（0.2.0 桌面端）：命名空间未 served（本插件未声明 volatile 字段）⇒ 只读降级。 */
cfState.entryIds.length = 0;
const cfOnly = applyWith({ configForms: configFormsService });
assert.deepEqual(cfOnly.injects, [["settingsScope"], ["configForms"], ["remote", "remote.session", "sessions"]],
	"configForms 子注入已注册（settingsScope 侧保持 pending，不影响本体激活）");
assert.deepEqual(cfState.entryIds, ["dsh-v-skill-links"], "configForms 以 profile 条目 id 取键（describe 的 ns = entry.options.id）");
assert.ok(cfOnly.section && cfOnly.tabs.length === 3 && cfOnly.dock && cfOnly.sources.length === 2,
	"仅 configForms 的宿主上节/三标签页/dock/两个触发源照常注册（激活不被通道形态阻塞）");
const cfInitial = cfOnly.face.getSnapshot();
assert.equal(cfInitial.available, true, "命名空间未 served 仍挂载（available=true：面板不整页空白）");
assert.equal(cfInitial.status, "ready", "unavailable 归一到 ready 只读快照");
assert.equal(cfInitial.writable, false, "文档级 writable 不透传：宿主只服务带 volatile 的条目 ⇒ 按只读");
assert.deepEqual(cfInitial.effective, [], "未 served ⇒ 空 value（技能目录仍走宿主 API）");
assert.ok(!cfOnly.face.getSnapshot().buttonsDraft.length && !cfOnly.face.getSnapshot().effectiveButtons.length, "按钮列表为空（dock 网格不渲染）");
assert.deepEqual(cfOnly.dock.options.inject().buttons.getSnapshot().buttons, [], "dock 按钮快照为空列表");
/* 只读态下动作不落到写路径：save/discard/reset 均提前返回 */
cfOnly.face.edit("directories", "F:/x");
await cfOnly.face.save();
await cfOnly.face.resetField();
await cfOnly.face.resetButtons();
assert.deepEqual(cfState.set, [], "只读降级下 MUST NOT 触达宿主写路径");
assert.deepEqual(cfState.unset, [], "只读降级下 MUST NOT 触达 unset");
assert.equal(cfOnly.face.getSnapshot().dirty, true, "只读态草稿仍在（保存被 writable 拦下，非静默丢失）");

/* 9b. 两者皆无：合成只读 scope（status ready / writable false / 空 value），激活照常。 */
const none = applyWith({});
assert.deepEqual(none.injects, [["settingsScope"], ["configForms"], ["remote", "remote.session", "sessions"]],
	"两个设置通道都注册（服务皆缺 → 两个子 fiber 保持 pending，不阻塞本体）");
assert.ok(none.section && none.tabs.length === 3 && none.dock && none.sources.length === 2, "皆无 seam 时槽位注册与触发源照常");
const noneState = none.face.getSnapshot();
assert.equal(noneState.available, true, "合成只读 scope 让面板可渲染（notWritable 形态）");
assert.equal(noneState.status, "ready");
assert.equal(noneState.writable, false, "合成只读 scope：writable false");
assert.equal(noneState.text, "", "空 value ⇒ 目录草稿为空");
assert.deepEqual(none.dock.options.inject().buttons.getSnapshot().buttons, [], "按钮列表为空（dock 网格不渲染）");

/* ══════════════ 10. seam 层直测（导出内部面）：只读底座 / attach 所有权 / 通道归一 ══════════════ */
const ro = plugin.createReadOnlyScope();
assert.equal(ro.getSnapshot().status, "ready", "只读底座快照 status ready");
assert.equal(ro.getSnapshot().writable, false, "只读底座 writable false");
assert.deepEqual(ro.getSnapshot().value, {}, "只读底座空 value");
assert.equal(typeof ro.subscribe(() => {}), "function", "只读底座 subscribe 返回 disposer");
await assert.rejects(ro.set("buttons", []), /read-only/, "只读底座 set 拒绝");
await assert.rejects(ro.unset("buttons"), /read-only/, "只读底座 unset 拒绝");

/* bind 原样透传（零适配）：0.1.5 路径逐字节不变 */
const passthrough = { getSnapshot: () => ({ status: "ready" }), subscribe: () => () => {}, set: async () => {}, unset: async () => {} };
let passthroughSpec = null;
const bound = plugin.bindSettingsScopeChannel({ settingsScope: { bind: (spec) => { passthroughSpec = spec; return passthrough; } } });
assert.equal(bound, passthrough, "settingsScope 通道原样透传");
assert.equal(passthroughSpec.namespace, "v-skill-links", "命名空间 = SETTINGS_NS");
assert.equal(passthroughSpec.decode({ a: 1 }).a, 1, "decode 透传对象节");
assert.equal(passthroughSpec.decode(null), undefined, "decode 拒绝非对象节");
assert.equal(plugin.bindSettingsScopeChannel({ settingsScope: {} }), undefined, "服务形状不符 → 降级");
assert.equal(plugin.bindSettingsScopeChannel({}), undefined, "服务缺失 → 降级");

/* attach 所有权：先到者持有、后到者忽略；句柄只拆自己接的连接且幂等 */
const makeSeamScope = (tag) => {
	const listeners = new Set();
	const snapshot = { status: "ready", value: { tag }, base: {}, user: null, writable: true, mode: "host" };
	return {
		getSnapshot: () => snapshot,
		subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
		set: async () => {},
		unset: async () => {},
		subscriberCount: () => listeners.size,
		emit: () => { for (const l of [...listeners]) l(); },
	};
};
const active = plugin.createActiveScope();
assert.equal(active.getSnapshot().writable, false, "未 attach 时保持合成只读");
const seamA = makeSeamScope("A");
const seamB = makeSeamScope("B");
let forwarded = 0;
active.subscribe(() => { forwarded += 1; });
const handleA = active.attach(seamA);
assert.equal(typeof handleA, "function", "attach 返回活动连接句柄");
assert.equal(active.getSnapshot().value.tag, "A", "接通后快照来自通道作用域");
assert.equal(seamA.subscriberCount(), 1, "活动连接被订阅（变更向外转发）");
assert.equal(forwarded, 1, "attach 即通知本层订阅者重取快照（面板立刻从只读态翻到可写态）");
seamA.emit();
assert.equal(forwarded, 2, "通道变更转发到本层订阅者");
await active.set("buttons", []);
assert.equal(active.attach(seamB), null, "已有活动连接：后到者被忽略（返回 null，不登记 disposer）");
assert.equal(seamB.subscriberCount(), 0, "被忽略的通道 MUST NOT 被订阅");
handleA();
assert.equal(active.getSnapshot().writable, false, "句柄拆回合成只读底座");
assert.equal(seamA.subscriberCount(), 0, "拆后不再订阅旧通道");
handleA();
assert.equal(active.getSnapshot().writable, false, "dispose 幂等（重复调用无副作用）");
const handleB = active.attach(seamB);
assert.equal(typeof handleB, "function", "前一连接拆走后，另一通道可接手");
assert.equal(active.getSnapshot().value.tag, "B");
assert.equal(active.attach(seamA), null, "B 持有期间 A 仍被忽略");
handleB();
active.dispose();
assert.equal(seamB.subscriberCount(), 0, "dispose 卸载内层订阅");

/* configForms 归一：served + host + writable → 透传并可写；memory / 未 served → 只读；false 结果抛错 */
const makeForms = (snapshot) => {
	const state = { snapshot, accept: true, calls: { set: [], unset: [] } };
	return {
		state,
		service: {
			get: () => ({
				getSnapshot: () => state.snapshot,
				subscribe: () => () => {},
				set: async (field, value) => { state.calls.set.push([field, value]); return state.accept; },
				unset: async (field) => { state.calls.unset.push(field); return state.accept; },
			}),
		},
	};
};
const served = makeForms({
	status: "ready", value: { buttons: [{ name: "x", prompt: "p", autoSend: false }] }, base: {}, user: null,
	revision: 3, writable: true, mode: "host",
});
const servedScope = plugin.adaptConfigFormsChannel({ configForms: served.service });
assert.equal(servedScope.getSnapshot().writable, true, "served + host：writable 透传");
assert.deepEqual(servedScope.getSnapshot().value.buttons.map((b) => b.name), ["x"], "served：value 透传");
await servedScope.set("buttons", []);
await servedScope.unset("buttons");
assert.deepEqual(served.state.calls.set, [["buttons", []]], "可写时写路径落宿主 form.set");
assert.deepEqual(served.state.calls.unset, ["buttons"], "可写时 unset 落宿主 form.unset（重置为组合层）");
served.state.accept = false;
await assert.rejects(servedScope.set("buttons", []), /refused/, "宿主拒绝（返回 false）抛错 → 卡片走 saveFailed 而非静默成功");
served.state.snapshot = { ...served.state.snapshot, mode: "memory" };
assert.equal(servedScope.getSnapshot().writable, false, "memory（非回环页面）写入落空 ⇒ 按只读呈现");
/* 写路径缺失（未来 API 变动）⇒ 通道降级只读（design D3 兜底口径） */
const noWriteApi = plugin.adaptConfigFormsChannel({
	configForms: { get: () => ({ getSnapshot: () => ({ status: "ready", value: {}, writable: true, mode: "host" }), subscribe: () => () => {} }) },
});
assert.equal(noWriteApi.getSnapshot().writable, false, "form 无 set/unset ⇒ 只读");
await assert.rejects(noWriteApi.set("buttons", []), /read-only/);
assert.equal(plugin.adaptConfigFormsChannel({ configForms: {} }), undefined, "configForms 形状不符 → 降级");
assert.equal(plugin.adaptConfigFormsChannel({}), undefined, "configForms 缺失 → 降级");

for (const d of disposers) d.dispose?.();
console.log("settings-card-smoke: ok");
