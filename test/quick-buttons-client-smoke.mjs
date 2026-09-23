/**
 * 快捷按钮客户端冒烟：物化客户端 factory（捕获 __ModuleLoader__.load），验证——
 *  1. appendPrompt 纯函数（空草稿填入 / 非空追加 \n / 非字符串兜底）；
 *  2. buttonsSectionOf 投影（空节 / 旧文档兼容 / 残缺条目丢弃 / autoSend 归一）；
 *  3. createButtonsStore（scope 快照投影 + 订阅跟随 + dispose）；
 *  4. dock 注册契约（composer.dock + input.dock hero 双条目：id / order / locale / inject 快照 face /
 *     hero 标记）；
 *  5. QuickButtonsGrid 组件契约（空列表 null / 缺 face null / outline+sm 元素形状 /
 *     data-v-button / 截断容器 / 点击追加与 autoSend→submit / phase 非 plain 禁用 /
 *     hero 门控：非 blank 返回 null、blank 渲染且带修饰类、与 composer 条目互斥）；
 *  6. 模型绑定（add-quick-button-model）：纯函数（等级最高 / 模型键 / 目录展开 / 绑定归一）、
 *     点击语义（先切后发 / 信封失败降级 / 未绑定零调用 / 子代理跳过 / in-flight 忽略连点）、
 *     面板模型与级别下拉（候选项 / 回显 / 漂移 / 降级 / 禁用）、目录桥（预取 / 事件重载 /
 *     连接重置 / 信封判定）。
 * 运行：node test/quick-buttons-client-smoke.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const here = fileURLToPath(new URL(".", import.meta.url));
const code = readFileSync(join(here, "..", "lib", "client.js"), "utf8");

/* ── 环境桩：捕获 load()，stub react / client-runtime / 官方 primitives ── */
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
const primitivesStub = { Button: (props, ...children) => ({ type: "Button", props, children }) };
const slotsPkgStub = { resolveSlotLabel: (label) => (typeof label === "function" ? label() : label) };
/* 模拟真实 store（@deepseek-ai/dsh-client-store）的冻结语义：set 前对入参递归 Object.freeze
 * 再整态替换（fix-dsh-012-compat design D4）；编辑路径因此在冻结输入上受测（design D3 不变量）。 */
const deepFreeze = (value) => {
	if (value === null || typeof value !== "object") return value;
	for (const key of Object.keys(value)) deepFreeze(value[key]);
	return Object.freeze(value);
};
const runtimeStub = {
	createSnapshotStore: (init) => {
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
const requireStub = (spec) => (spec === "react" ? reactStub : spec === "@deepseek-ai/dsh-client-store" ? runtimeStub : spec === "@deepseek-ai/dsh-client-ui-primitives" ? primitivesStub : spec === "@deepseek-ai/dsh-client-ui-slots" ? slotsPkgStub : null);

new Function("window", "require", code)(windowStub, requireStub);
assert.ok(definition, "捕获到 load 定义");
const plugin = definition.factory(requireStub);

/* 模型目录夹具（add-quick-button-model：会话模型菜单同源的宿主导出形状）。 */
const modelGroups = [
	{ id: "p1", name: "Provider One", models: [
		{ id: "m-a", name: "Model A", reasoning: { efforts: [{ id: "low", name: "Low" }, { id: "max", name: "Max" }] } },
		{ id: "m-b", name: "Model B" },
	] },
];

/* ── 1. appendPrompt 纯函数（spec「点击填入」口径） ── */
assert.equal(plugin.appendPrompt("", "使用 xxx 技能"), "使用 xxx 技能", "空草稿直接填入");
assert.equal(plugin.appendPrompt("帮我看看", "使用 xxx 技能"), "帮我看看\n使用 xxx 技能", "非空草稿换行追加");
assert.equal(plugin.appendPrompt(undefined, "p"), "p", "非字符串草稿按空处理");

/* ── 2. buttonsSectionOf 投影 ── */
assert.deepEqual(plugin.buttonsSectionOf(undefined), [], "无节 → 空列表");
assert.deepEqual(plugin.buttonsSectionOf({}), [], "空节 → 空列表");
assert.deepEqual(plugin.buttonsSectionOf({ buttons: "oops" }), [], "节非数组 → 空列表");
assert.deepEqual(
	plugin.buttonsSectionOf({
		buttons: [
			{ name: "新建", prompt: "p", autoSend: true },
			{ name: "", prompt: "残缺条目丢弃" },
			{ name: "无prompt", prompt: "" },
			null,
			{ name: "b", prompt: "p2" },
		],
	}),
	[
		{ name: "新建", prompt: "p", autoSend: true },
		{ name: "b", prompt: "p2", autoSend: false },
	],
	"残缺条目丢弃 + autoSend 归一",
);

/* ── 3. createButtonsStore：投影 + 订阅跟随 + dispose ── */
let scopeSnap = { status: "ready", value: { buttons: [{ name: "a", prompt: "p", autoSend: false }] } };
const scopeListeners = new Set();
const scope = {
	getSnapshot: () => scopeSnap,
	subscribe: (fn) => { scopeListeners.add(fn); return () => scopeListeners.delete(fn); },
};
const store = plugin.createButtonsStore(scope);
assert.deepEqual(store.getSnapshot().buttons, [{ name: "a", prompt: "p", autoSend: false }], "创建即发布");
scopeSnap = { status: "ready", value: { buttons: [{ name: "b", prompt: "p2", autoSend: true }, { name: "c", prompt: "p3" }] } };
for (const l of [...scopeListeners]) l();
assert.deepEqual(store.getSnapshot().buttons.map((b) => b.name), ["b", "c"], "scope 变更即时跟随");
scopeSnap = { status: "ready", value: { directories: [] } };
for (const l of [...scopeListeners]) l();
assert.deepEqual(store.getSnapshot().buttons, [], "旧文档（无 buttons 节）兼容");
store.dispose();
scopeSnap = { status: "ready", value: { buttons: [{ name: "x", prompt: "p" }] } };
for (const l of [...scopeListeners]) l();
assert.deepEqual(store.getSnapshot().buttons, [], "dispose 后不再跟随");

/* ── 3.5 模型绑定纯函数（add-quick-button-model，design D5/D10）：等级最高 / 模型键 / 目录展开 / 绑定归一 ── */
const { highestEffort, modelKeyOf, catalogOptions, buttonModelOf } = plugin;
assert.equal(highestEffort([{ id: "low" }, { id: "max" }, { id: "high" }]), "max", "已知等级序取最大（与列表书写顺序无关）");
assert.equal(highestEffort(["off", "minimal", "low", "medium", "high", "xhigh", "max"].map((id) => ({ id }))), "max", "全序取 max");
assert.equal(highestEffort([{ id: "custom-a" }, { id: "custom-b" }]), "custom-b", "未知等级 id：退回列表末项");
assert.equal(highestEffort([{ id: "low" }, { id: "max" }, { id: "weird" }]), "weird", "已知序中出现未知 id 同样退回末项（适配器实测升序）");
assert.equal(highestEffort([]), undefined, "空列表 → undefined（不写 reasoningEffort）");
assert.equal(highestEffort(undefined), undefined, "缺等级元数据 → undefined");
assert.equal(modelKeyOf({ provider: "p", model: "m" }), "p/m", "模型键（无等级形态）");
assert.equal(modelKeyOf({ provider: "p", model: "m", reasoningEffort: "max" }), "p/m/max", "模型键（含等级形态）");
assert.equal(modelKeyOf(undefined), "", "形状不足 → 空键");
assert.equal(modelKeyOf({ provider: "", model: "m" }), "", "缺 provider → 空键");
const options = catalogOptions(modelGroups);
assert.deepEqual(options.items, [
	{ key: "p1/m-a", label: "Provider One · Model A" },
	{ key: "p1/m-b", label: "Provider One · Model B" },
], "候选项按目录序（provider 分组序）+ provider.name · model.name");
assert.deepEqual(options.byKey.get("p1/m-a").efforts.map((e) => e.id), ["low", "max"], "模型 → 等级列表查表");
assert.deepEqual(options.byKey.get("p1/m-b").efforts, [], "无等级元数据的模型 → 空等级列表");
assert.deepEqual(catalogOptions([
	{ id: "p1", name: "P1", models: [{ id: "m", name: "M" }] },
	{ id: "p1", name: "同 provider 第二组", models: [{ id: "m", name: "重键被丢弃" }] },
]).items.map((i) => i.key), ["p1/m"], "重键先到先得（与宿主目录口径一致）");
assert.deepEqual(catalogOptions(undefined).items, [], "无目录 → 空候选项");
assert.deepEqual(buttonModelOf({ provider: "p", model: "m", reasoningEffort: "" }), { provider: "p", model: "m" }, "空等级串按未提供处理");
assert.equal(buttonModelOf({ provider: "p" }), undefined, "形状不足 → 未绑定");
assert.ok(!("reasoningEffort" in buttonModelOf({ provider: "p", model: "m" })), "无等级 MUST NOT 输出该键");
assert.deepEqual(Object.keys(buttonModelOf({ provider: "p", model: "m", reasoningEffort: "max" })), ["provider", "model", "reasoningEffort"], "键序固定");

/* ── 4. dock 注册契约 + apply 接线 ── */
let scopeSnapShared = { status: "ready", value: { buttons: [{ name: "新建", prompt: "使用 xxx 技能做 xxx 事", autoSend: true }] } };
const sharedListeners = new Set();
const sharedScope = {
	getSnapshot: () => scopeSnapShared,
	subscribe: (fn) => { sharedListeners.add(fn); return () => sharedListeners.delete(fn); },
};
let registeredDock = null;
let registeredHero = null;
/* 可选注入桩（add-quick-button-model）：remote / sessions 齐备 → 目录桥创建并预取。 */
const injectedDeps = [];
const selectModelCalls = [];
const switchModelResponses = [];
const injectScope = {
	remote: {
		session: {
			modelCatalog: async () => ({ ok: true, value: { groups: modelGroups } }),
			selectModel: async (request) => {
				selectModelCalls.push(request);
				return switchModelResponses.length > 0 ? switchModelResponses.shift() : { ok: true, value: { selected: {} } };
			},
		},
		$on: () => () => {},
	},
	sessions: { subagentAddress: (id) => (String(id).startsWith("subagent") ? { parentSessionId: "p", childSessionId: id, mode: "task" } : undefined) },
	on: () => () => {},
};
const ctx = {
	effect: (fn) => { fn(); return () => {}; },
	inject: (deps, fn) => {
		injectedDeps.push(deps);
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
		bind: () => (key) => key,
		getSnapshot: () => ({ revision: 1 }),
		subscribe: () => () => {},
	},
	slots: {
		register: (options, component) => ({ options, component }),
		inject: (name, fn) => {
			if (name === "conversation.composer.dock") registeredDock = fn();
			if (name === "conversation.input.dock") registeredHero = fn();
		},
	},
	get(name) {
		if (name === "settingsScope") return { bind: () => sharedScope };
		if (name === "inputTriggers") return { registerSource: () => () => {} };
		throw new Error(`unexpected service ${name}`);
	},
};
plugin.apply(ctx);
assert.ok(registeredDock, "conversation.composer.dock 槽位已注册");
assert.equal(registeredDock.options.name, "conversation.composer.dock");
assert.equal(registeredDock.options.id, "v-quick-buttons");
assert.equal(registeredDock.options.order, -1, "紧贴输入卡片（stats=0 在其下）");
assert.equal(registeredDock.options.locale, "v-skill-links.settings");
const dockProps = registeredDock.options.inject();
assert.ok(dockProps.buttons && typeof dockProps.buttons.getSnapshot === "function", "inject 提供按钮快照 face");
/* 6.1 口径（add-quick-button-model）：inject 收 sessionId；无参（无会话）时 MUST NOT 抛错且 canSwitch:false */
assert.equal(dockProps.sessionId, undefined, "inject() 无参（sessionId undefined）不抛错");
assert.equal(dockProps.canSwitch, false, "无会话 → canSwitch: false（点击路径按不可切换处理）");
assert.equal(typeof dockProps.switchModel, "function", "inject face 提供切换函数（收敛单处）");
assert.equal(typeof dockProps.notify, "function", "inject face 提供 toast 通道");
const dockPropsBound = registeredDock.options.inject("s-1");
assert.equal(dockPropsBound.sessionId, "s-1", "inject 透传 sessionId");
assert.equal(dockPropsBound.canSwitch, true, "普通会话可切换");
assert.equal(registeredDock.options.inject("subagent-1").canSwitch, false, "子代理会话 → canSwitch: false（跳过切换）");
assert.deepEqual(injectedDeps, [["remote", "remote.session", "sessions"]], "静态 inject 列表不动，模型目录服务集中在单处可选注入（remote.session 是 cordis 独立服务键，MUST 声明）");

/* ── 4b. hero 条目注册契约（design D10：新增会话首屏经 conversation.input.dock 渲染同一网格） ── */
assert.ok(registeredHero, "conversation.input.dock 槽位已注册（hero 条目）");
assert.equal(registeredHero.options.name, "conversation.input.dock");
assert.equal(registeredHero.options.id, "v-quick-buttons-hero");
assert.equal(registeredHero.options.order, 0, "与官方 queue/todo 条目并肩");
assert.equal(registeredHero.options.locale, "v-skill-links.settings");
const heroProps = registeredHero.options.inject();
assert.ok(heroProps.buttons && typeof heroProps.buttons.getSnapshot === "function", "hero inject 提供按钮快照 face");
assert.equal(heroProps.hero, true, "hero 标记进入 inject face");

/* ── 5. QuickButtonsGrid 组件契约 ── */
const Grid = plugin.QuickButtonsGrid;
const makeActions = () => {
	const calls = { setDraft: [], submit: 0 };
	return {
		calls,
		setDraft: (text) => calls.setDraft.push(text),
		submit: () => { calls.submit += 1; },
	};
};

/* 5a. 空列表 → null（零布局） */
const emptyStore = plugin.createButtonsStore({ getSnapshot: () => ({ status: "ready", value: {} }), subscribe: () => () => {} });
assert.equal(Grid({ input: { draft: "", phase: "plain" }, inputActions: makeActions(), buttons: emptyStore, t: (k) => k }), null, "空列表渲染 null");

/* 5b. 缺 inputActions → null（可选 chrome 不拖垮会话视图） */
assert.equal(Grid({ input: { draft: "", phase: "plain" }, buttons: store, t: (k) => k }), null, "缺 inputActions 渲染 null");

/* 5c. 正常渲染：outline/sm Button 元素 + data-v-button + title 兜底 + 截断容器 */
const childrenOf = (el) => [].concat(el.props.children !== undefined ? el.props.children : el.children).flat();
const actions = makeActions();
const grid = Grid({
	input: { draft: "帮我看看", phase: "plain" },
	inputActions: actions,
	buttons: dockProps.buttons,
	t: (k) => k,
});
assert.equal(grid.type, "div", "网格容器");
assert.equal(grid.props.className, "v-qb-grid");
assert.equal(grid.props.role, "group");
const buttons = childrenOf(grid);
assert.equal(buttons.length, 1);
assert.equal(buttons[0].type, primitivesStub.Button, "按钮底子为官方 primitives.Button");
assert.equal(buttons[0].props.variant, "outline");
assert.equal(buttons[0].props.size, "sm");
assert.equal(buttons[0].props.className, "v-qb-btn");
assert.equal(buttons[0].props["data-v-button"], "新建", "稳定 CSS 钩子 data-v-button");
assert.equal(buttons[0].props.title, "使用 xxx 技能做 xxx 事", "悬停展示完整 prompt（原生 title 兜底）");
assert.equal(buttons[0].props.disabled, false);
const label = childrenOf(buttons[0])[0];
assert.equal(label.props.className, "v-qb-label", "名字走截断容器");

/* 5d. 点击：非空草稿追加 \n + autoSend=true → submit（发送整个输入区） */
buttons[0].props.onClick();
assert.deepEqual(actions.calls.setDraft, ["帮我看看\n使用 xxx 技能做 xxx 事"], "追加语义（\n 拼接）");
assert.equal(actions.calls.submit, 1, "autoSend=true 填入后即提交");

/* 5e. 空草稿 + autoSend=false → 仅填入不提交 */
const actions2 = makeActions();
const grid2 = Grid({
	input: { draft: "", phase: "plain" },
	inputActions: actions2,
	buttons: plugin.createButtonsStore({ getSnapshot: () => ({ status: "ready", value: { buttons: [{ name: "b", prompt: "p2" }] } }), subscribe: () => () => {} }),
	t: (k) => k,
});
childrenOf(grid2)[0].props.onClick();
assert.deepEqual(actions2.calls.setDraft, ["p2"], "空草稿直接填入");
assert.equal(actions2.calls.submit, 0, "未勾选自动发送不提交");

/* 5f. phase 非 plain → 全部禁用（adjudicating/claimed/submitting） */
for (const phase of ["adjudicating", "claimed", "submitting"]) {
	const g = Grid({
		input: { draft: "", phase },
		inputActions: makeActions(),
		buttons: dockProps.buttons,
		t: (k) => k,
	});
	for (const b of childrenOf(g)) assert.equal(b.props.disabled, true, `phase=${phase} 时按钮禁用`);
}
/* phase=plain 恢复可用 */
const gPlain = Grid({ input: { draft: "", phase: "plain" }, inputActions: makeActions(), buttons: dockProps.buttons, t: (k) => k });
for (const b of childrenOf(gPlain)) assert.equal(b.props.disabled, false, "phase=plain 时按钮可用");

/* 5f+. 草稿来源（fix-dsh-012-compat design D5）：新版 composer.dock 槽位无 owner 份额
 * （不传 props.input），组件 SHALL 经标准工具 useInput 读当帧 InputState —— 点击追加
 * 而非替换（回归：原实现读 props.input 得 undefined → 草稿被整框替换）。 */
const actions3 = makeActions();
const grid3 = Grid({
	useInput: (selector) => selector({ draft: "帮我看看", phase: "plain" }),
	inputActions: actions3,
	buttons: dockProps.buttons,
	t: (k) => k,
});
childrenOf(grid3)[0].props.onClick();
assert.deepEqual(actions3.calls.setDraft, ["帮我看看\n使用 xxx 技能做 xxx 事"], "无 owner 份额时经 useInput 追加（不替换）");
assert.equal(actions3.calls.submit, 1, "useInput 路径 autoSend=true 即提交（与 5d 同口径）");
/* phase 门控同样读 useInput 快照 */
const gHookBusy = Grid({
	useInput: (selector) => selector({ draft: "", phase: "submitting" }),
	inputActions: makeActions(),
	buttons: dockProps.buttons,
	t: (k) => k,
});
for (const b of childrenOf(gHookBusy)) assert.equal(b.props.disabled, true, "phase 经 useInput 读取（submitting 禁用）");
/* useInput 与 owner 份额并存（hero：InputZone.input）时 useInput 优先，二者同形等价 */
const actions4 = makeActions();
const grid4 = Grid({
	useInput: (selector) => selector({ draft: "hook草稿", phase: "plain" }),
	input: { draft: "owner草稿", phase: "plain" },
	inputActions: actions4,
	buttons: dockProps.buttons,
	t: (k) => k,
});
childrenOf(grid4)[0].props.onClick();
assert.deepEqual(actions4.calls.setDraft, ["hook草稿\n使用 xxx 技能做 xxx 事"], "useInput 优先于 owner 份额");

/* ── 5g. hero 门控（design D10；fix-hero-gating-snapshot-fields D1）：仅空白会话首屏渲染
 *      且带修饰类；非 blank / 缺 session 返回 null。0.1.2-rc.1 起 SessionSnapshot 不再携带
 *      composerPhase 派生字段，fixture 一律用原始字段（openState/blank/running/promptAttempted）。 */
const BLANK_SNAPSHOT = { openState: "open", blank: true, running: false, promptAttempted: false };
const heroBlank = Grid({
	session: BLANK_SNAPSHOT,
	input: { draft: "", phase: "plain" },
	inputActions: makeActions(),
	buttons: heroProps.buttons,
	hero: true,
	t: (k) => k,
});
assert.ok(heroBlank, "blank 会话 hero 渲染网格");
assert.equal(heroBlank.props.className, "v-qb-grid v-qb-grid--hero", "hero 修饰类（CSS order 置于 hero 卡片下方）");
/* hero 条目点击语义与 composer 条目一致（autoSend 可直接发起第一回合） */
const heroActions = makeActions();
const heroWithDraft = Grid({
	session: BLANK_SNAPSHOT,
	input: { draft: "帮我看看", phase: "plain" },
	inputActions: heroActions,
	buttons: heroProps.buttons,
	hero: true,
	t: (k) => k,
});
childrenOf(heroWithDraft)[0].props.onClick();
assert.deepEqual(heroActions.calls.setDraft, ["帮我看看\n使用 xxx 技能做 xxx 事"], "hero 条目追加语义一致");
assert.equal(heroActions.calls.submit, 1, "hero 条目 autoSend 即提交（发起第一回合）");
/* 非 blank（含过渡态）一律返回 null：发出首条消息（promptAttempted 粘性翻转 engaging，即使
 * blank 尚未落地）、运行中、等待首回合、openState 未 open（loading/cold/error）、空快照 */
for (const [label, session] of Object.entries({
	"promptAttempted（发送已开始，blank 未落地）": { ...BLANK_SNAPSHOT, promptAttempted: true },
	"running（运行中）": { ...BLANK_SNAPSHOT, blank: false, running: true, promptAttempted: true },
	"awaitingFirstTurn（等待首回合）": { ...BLANK_SNAPSHOT, blank: false, awaitingFirstTurn: true, promptAttempted: true },
	"openState=loading（未 open）": { ...BLANK_SNAPSHOT, openState: "loading" },
	"空快照（字段全缺）": {},
})) {
	assert.equal(Grid({
		session,
		input: { draft: "", phase: "plain" },
		inputActions: makeActions(),
		buttons: heroProps.buttons,
		hero: true,
		t: (k) => k,
	}), null, `session ${label} 时 hero 条目返回 null`);
}
/* 回归守卫（fix-hero-gating-snapshot-fields）：旧形状快照（仅带已被上游移除的
 * composerPhase 派生字段）MUST NOT 再被当成 blank——门控不得依赖已移除字段 */
assert.equal(Grid({
	session: { composerPhase: "blank" },
	input: { draft: "", phase: "plain" },
	inputActions: makeActions(),
	buttons: heroProps.buttons,
	hero: true,
	t: (k) => k,
}), null, "旧 composerPhase 形状快照不再驱动 hero 门控（字段已移除）");
/* 缺 session（无会话首屏，无输入机）→ 保守不渲染 */
assert.equal(Grid({
	input: { draft: "", phase: "plain" },
	inputActions: makeActions(),
	buttons: heroProps.buttons,
	hero: true,
	t: (k) => k,
}), null, "缺 session（无会话首屏）hero 条目返回 null");
/* 互斥性：composer 条目不受 hero 门控——非 blank 时 hero 条目 null、composer 条目接管渲染 */
const composerDuringSession = Grid({
	session: { openState: "open", blank: false, running: true, promptAttempted: true },
	input: { draft: "", phase: "plain" },
	inputActions: makeActions(),
	buttons: dockProps.buttons,
	t: (k) => k,
});
assert.equal(composerDuringSession.props.className, "v-qb-grid", "composer 条目无 hero 修饰类、会话态接管渲染");

/* ── 5h. 模型绑定点击语义（add-quick-button-model，spec「按钮模型绑定与切换语义」） ── */
const boundStore = plugin.createButtonsStore({
	getSnapshot: () => ({ status: "ready", value: { buttons: [
		{ name: "绑定", prompt: "用强模型", autoSend: true, model: { provider: "p1", model: "m-a", reasoningEffort: "max" } },
		{ name: "跟随", prompt: "随便写", autoSend: true },
	] } }),
	subscribe: () => () => {},
});
/** 可控切换桩：记录调用、由测试决定何时以何信封结算。 */
const makeSwitch = () => {
	const calls = [];
	let settle = () => {};
	const promise = new Promise((resolve) => { settle = resolve; });
	return { calls, settle, switchModel: (sessionId, model) => { calls.push({ sessionId, model }); return promise; } };
};
const gridWith = (over = {}) => Grid({
	input: { draft: "", phase: "plain" },
	inputActions: over.actions ?? makeActions(),
	buttons: boundStore,
	sessionId: "s-1",
	canSwitch: true,
	switchModel: over.switchModel ?? null,
	notify: over.notify,
	t: (k) => k,
	...over.props,
});

/* 5h-1. autoSend + 绑定 + 可切换：先切后发（切换完成前 MUST NOT 提交） */
const sw1 = makeSwitch();
const act1 = makeActions();
const notes1 = [];
const g1 = gridWith({ actions: act1, switchModel: sw1.switchModel, notify: (text, isError) => notes1.push([text, isError]) });
const [boundBtn1, followBtn1] = childrenOf(g1);
boundBtn1.props.onClick();
assert.deepEqual(act1.calls.setDraft, ["用强模型"], "点击先追加填入（同步，现状不变）");
assert.equal(sw1.calls.length, 1, "有绑定且可切换 → 发起一次切换");
assert.deepEqual(sw1.calls[0], { sessionId: "s-1", model: { provider: "p1", model: "m-a", reasoningEffort: "max" } }, "切换请求 = 会话 + 绑定三元组");
assert.equal(act1.calls.submit, 0, "先切后发：切换完成前 MUST NOT 提交");
sw1.settle({ ok: true, error: "" });
await new Promise((r) => setImmediate(r));
assert.equal(act1.calls.submit, 1, "切换完成后才提交（该回合用绑定模型）");
assert.deepEqual(notes1, [], "切换成功不提示");

/* 5h-2. 信封 ok=false → toast 且不阻断（仍以会话当前模型提交） */
const sw2 = makeSwitch();
const act2 = makeActions();
const notes2 = [];
const g2 = gridWith({ actions: act2, switchModel: sw2.switchModel, notify: (text, isError) => notes2.push([text, isError]) });
childrenOf(g2)[0].props.onClick();
sw2.settle({ ok: false, error: "model-not-found: unknown model" });
await new Promise((r) => setImmediate(r));
assert.deepEqual(notes2, [["switchFailed" + "model-not-found: unknown model", true]], "切换失败 toast 提示（错误通道）");
assert.equal(act2.calls.submit, 1, "autoSend 降级为以会话当前模型提交（草稿不丢）");

/* 5h-2b. 切换通道不可用（桥缺失）→ unavailable toast */
const sw2b = makeSwitch();
const act2b = makeActions();
const notes2b = [];
const g2b = gridWith({ actions: act2b, switchModel: sw2b.switchModel, notify: (text, isError) => notes2b.push([text, isError]) });
childrenOf(g2b)[0].props.onClick();
sw2b.settle({ ok: false, unavailable: true, error: "" });
await new Promise((r) => setImmediate(r));
assert.deepEqual(notes2b, [["switchUnavailable", true]], "不可用通道 → 降级文案");

/* 5h-2c. 切换抛错 → 同样走 toast 降级（不阻断） */
const act2c = makeActions();
const notes2c = [];
const g2c = gridWith({ actions: act2c, switchModel: () => Promise.reject(new Error("boom")), notify: (text, isError) => notes2c.push([text, isError]) });
childrenOf(g2c)[0].props.onClick();
await new Promise((r) => setImmediate(r));
assert.deepEqual(notes2c, [["switchFailed" + "boom", true]], "抛错同样 toast");
assert.equal(act2c.calls.submit, 1, "抛错不阻断提交");

/* 5h-3. 未绑定按钮：零切换调用、零目录读取，行为与既有版本逐字一致 */
const sw3 = makeSwitch();
const act3 = makeActions();
const g3 = gridWith({ actions: act3, switchModel: sw3.switchModel, notify: () => { throw new Error("未绑定 MUST NOT 提示"); } });
childrenOf(g3)[1].props.onClick();
assert.equal(sw3.calls.length, 0, "未绑定按钮完全不碰模型");
assert.deepEqual(act3.calls.setDraft, ["随便写"], "未绑定走原路径（仅填入）");
assert.equal(act3.calls.submit, 1, "未绑定 autoSend 同步提交");

/* 5h-4. 子代理会话（canSwitch=false）：静默跳过切换、不报错、照常填入 */
const sw4 = makeSwitch();
const act4 = makeActions();
const notes4 = [];
const g4 = gridWith({ actions: act4, switchModel: sw4.switchModel, notify: (text, isError) => notes4.push([text, isError]), props: { canSwitch: false } });
childrenOf(g4)[0].props.onClick();
assert.equal(sw4.calls.length, 0, "子代理会话 MUST NOT 尝试切换");
assert.deepEqual(act4.calls.setDraft, ["用强模型"], "prompt 照常追加");
assert.equal(act4.calls.submit, 1, "autoSend 照常提交（会话当前模型）");
assert.deepEqual(notes4, [], "跳过切换不报错");

/* 5h-4b. 槽位未接线（无 switchModel）：按不可切换处理（不抛错） */
const act4b = makeActions();
const g4b = gridWith({ actions: act4b });
childrenOf(g4b)[0].props.onClick();
assert.deepEqual(act4b.calls.setDraft, ["用强模型"], "未接线时仍照常填入");
assert.equal(act4b.calls.submit, 1, "未接线时 autoSend 照常提交");

/* 5h-5. in-flight 保护：切换（及随后的提交）未完成期间忽略重复点击 */
const sw5 = makeSwitch();
const act5 = makeActions();
const g5 = gridWith({ actions: act5, switchModel: sw5.switchModel, notify: () => {} });
const btn5 = childrenOf(g5)[0];
btn5.props.onClick();
btn5.props.onClick();
btn5.props.onClick();
assert.deepEqual(act5.calls.setDraft, ["用强模型"], "in-flight 期间重复点击不产生第二次填入");
assert.equal(sw5.calls.length, 1, "in-flight 期间不发起第二次切换（防「第二次切换 + 第一次提交」错配）");
sw5.settle({ ok: true, error: "" });
await new Promise((r) => setImmediate(r));
assert.equal(act5.calls.submit, 1, "首个点击序列按既定口径完成（仅一次提交）");
btn5.props.onClick();
assert.equal(sw5.calls.length, 2, "序列结束后恢复可点击");

/* ── 6. QuickPanel 排序控件形态（add-quick-buttons-reorder，design D2/D3）：把手 / ↑↓ 按钮 ── */
const mkQuickState = (over = {}) => ({
	status: "ready", available: true, writable: true, mode: "host",
	dirty: false, invalid: false, invalidReason: "", saving: false, failed: false,
	text: "", overridden: false, effective: [], baseDirs: [], count: 0,
	commandsDraft: [], commandsDirty: false, commandsInvalid: false, commandsInvalidReason: "", commandsOverridden: false, effectiveCommands: [], baseCommandsCount: 0,
	buttonsDraft: [{ name: "A", prompt: "pa", autoSend: false }, { name: "B", prompt: "pb", autoSend: false }, { name: "C", prompt: "pc", autoSend: false }],
	buttonsDirty: false, buttonsInvalid: false, buttonsInvalidReason: "", buttonsOverridden: false, effectiveButtons: [], baseButtonsCount: 0,
	...over,
});
const quickFace = (over = {}) => ({ getSnapshot: () => mkQuickState(over), subscribe: () => () => {} });
const kidsOf = (el) => [].concat(el.props.children !== undefined ? el.props.children : (el.children ?? [])).flat()
	.filter((c) => c !== false && c !== null && c !== undefined && c !== true);
const qRows = (panel) => kidsOf(panel).filter((c) => c && c.props && c.props.className === "v-sc-row");
const qHead = (row) => kidsOf(row).find((c) => c.props && c.props.className === "v-sc-rowHead");
const qGrip = (row) => kidsOf(qHead(row))[0];
const qMoves = (row) => kidsOf(qHead(row)).filter((c) => c.props && c.props.className === "v-sc-move");

const qPanel = plugin.QuickPanel({ t: (k) => k, face: quickFace() });
const qRowList = qRows(qPanel);
assert.equal(qRowList.length, 3, "快捷功能面板渲染三行按钮卡片");
for (const [i, row] of qRowList.entries()) {
	const grip = qGrip(row);
	assert.equal(grip.type, "span", "行首为拖拽把手 span");
	assert.equal(grip.props.className, "v-sc-grip", "把手稳定 class（用户美化钩子）");
	assert.equal(grip.props.draggable, true, "把手 draggable 标记");
	assert.equal(grip.props["aria-label"], "gripLabel", "把手 aria-label（词典键）");
	assert.ok(!("draggable" in row.props), "整条卡片行不可拖拽（拖拽只从把手发起）");
	const [up, down] = qMoves(row);
	assert.equal(up.props.className, "v-sc-move", "上移按钮稳定 class");
	assert.equal(up.props.type, "button", "原生 button 键盘可达");
	assert.equal(up.props.title, "moveUp", "上移按钮 title（词典键）");
	assert.equal(down.props.title, "moveDown", "下移按钮 title（词典键）");
	assert.equal(up.props.disabled, i === 0, "首行上移禁用");
	assert.equal(down.props.disabled, i === qRowList.length - 1, "末行下移禁用");
}
/* 不可写 / 保存中：把手不可发起拖拽、上下移禁用（与行内既有控件同口径，spec） */
for (const over of [{ writable: false }, { saving: true }]) {
	const rows = qRows(plugin.QuickPanel({ t: (k) => k, face: quickFace(over) }));
	assert.equal(qGrip(rows[0]).props.draggable, false, "排序禁用时把手 draggable=false");
	for (const row of rows) for (const m of qMoves(row)) assert.equal(m.props.disabled, true, "排序禁用时上下移禁用");
}
/* 单条按钮：排序控件不产生任何效果（spec） */
const soloRows = qRows(plugin.QuickPanel({ t: (k) => k, face: quickFace({ buttonsDraft: [{ name: "A", prompt: "pa", autoSend: false }] }) }));
assert.equal(qGrip(soloRows[0]).props.draggable, false, "单条按钮把手不可拖");
for (const m of qMoves(soloRows[0])) assert.equal(m.props.disabled, true, "单条按钮上下移均禁用");
/* dock 网格渲染逻辑零改动：网格项无任何拖拽属性（dock 纯跟随，spec） */
assert.ok(!("draggable" in buttons[0].props) && !("onDragOver" in buttons[0].props) && !("onDrop" in buttons[0].props), "dock 网格渲染零改动（无拖拽属性）");

/* ── 7. 模型/级别下拉（add-quick-button-model，spec「按钮模型的设置交互」） ── */
const catalogFace = (catalog) => ({ getSnapshot: () => ({ catalog }), subscribe: () => () => {} });
const CATALOG_READY = { status: "ready", groups: modelGroups };
const qModelRow = (row) => kidsOf(row).find((c) => c.props && c.props.className === "v-sc-modelRow");
const qFields = (row) => kidsOf(qModelRow(row)).filter((c) => c.props && c.props.className === "v-sc-modelField");
/** 行内下拉：模型下拉 + （可选）级别下拉。 */
const qSelects = (row) => qFields(row).map((field) => kidsOf(field).find((c) => c.type === "select"));
const qOptions = (select) => kidsOf(select);
/** option 文案（react 桩把 children 放在 el.children）。 */
const qText = (el) => [].concat(el.children ?? []).flat()[0];
const panelWith = (draft, models, over = {}, edits = []) => ({
	edits,
	panel: plugin.QuickPanel({
		t: (k) => k,
		face: { getSnapshot: () => mkQuickState({ buttonsDraft: draft, ...over }), subscribe: () => () => {}, editButton: (i, f, v) => edits.push([i, f, v]) },
		models,
	}),
});
const boundDraft = [
	{ name: "绑定", prompt: "pa", autoSend: true, model: { provider: "p1", model: "m-a", reasoningEffort: "max" } },
	{ name: "跟随", prompt: "pb", autoSend: false },
	{ name: "模型漂移", prompt: "pc", autoSend: false, model: { provider: "gone", model: "m-x", reasoningEffort: "max" } },
];
/* 7a. 目录就绪：候选来自目录；已存绑定回显；未绑定落在「跟随会话模型」 */
const setupA = panelWith(boundDraft, catalogFace(CATALOG_READY));
const rowsA = qRows(setupA.panel);
const selectsA = rowsA.map(qSelects);
assert.equal(selectsA[0].length, 2, "带等级模型的行走渲染「模型 + 级别」两个下拉");
assert.equal(selectsA[1].length, 1, "未绑定行只渲染模型下拉（首项即跟随态）");
assert.equal(selectsA[2].length, 1, "目录中不存在的模型 → 无等级元数据可依，不渲染级别下拉");
assert.equal(selectsA[0][0].props.value, "p1/m-a", "模型下拉受控值 = provider/model 键");
assert.deepEqual(qOptions(selectsA[0][0]).map((o) => [o.props.value, qText(o)]), [
	["", "buttonModelFollow"], ["p1/m-a", "Provider One · Model A"], ["p1/m-b", "Provider One · Model B"],
], "首项「跟随会话模型（默认）」+ 目录候选（provider.name · model.name）");
assert.equal(selectsA[1][0].props.value, "", "未绑定 → 跟随态（空键）");
assert.deepEqual(qOptions(selectsA[1][0]).map((o) => o.props.value), ["", "p1/m-a", "p1/m-b"], "未绑定行同样列出候选");
assert.equal(selectsA[0][1].props.value, "max", "已存等级原样回显");
assert.deepEqual(qOptions(selectsA[0][1]).map((o) => [o.props.value, qText(o)]), [
	["low", "Low"], ["max", "Max"],
], "级别下拉按目录顺序（id 值 / name 文案）");
const driftOptions = qOptions(selectsA[2][0]);
assert.equal(selectsA[2][0].props.value, "gone/m-x", "已存但不在目录中的绑定原样回显（MUST NOT 静默改写）");
assert.deepEqual([driftOptions.at(-1).props.value, qText(driftOptions.at(-1))], ["gone/m-x", "gone/m-x · modelUnavailable"], "漂移值标「不可用」");
/* 7b. 交互：换模型按新模型等级重算并默认最高；无等级不写 reasoningEffort；选定「跟随」删键 */
selectsA[0][0].props.onChange({ target: { value: "p1/m-a" } });
assert.deepEqual(setupA.edits.at(-1), [0, "model", { provider: "p1", model: "m-a", reasoningEffort: "max" }], "选带等级模型 → 默认最高（design D5）");
selectsA[0][0].props.onChange({ target: { value: "p1/m-b" } });
assert.deepEqual(setupA.edits.at(-1), [0, "model", { provider: "p1", model: "m-b" }], "无等级模型 MUST NOT 携带 reasoningEffort");
selectsA[0][0].props.onChange({ target: { value: "" } });
assert.deepEqual(setupA.edits.at(-1), [0, "model", undefined], "选「跟随会话模型」→ 未绑定（editButton 删 model 键）");
const editCountBeforeDrift = setupA.edits.length;
selectsA[2][0].props.onChange({ target: { value: "gone/m-x" } });
assert.equal(setupA.edits.length, editCountBeforeDrift, "重选漂移项为空操作（保持原绑定）");
selectsA[0][1].props.onChange({ target: { value: "low" } });
assert.deepEqual(setupA.edits.at(-1), [0, "model", { provider: "p1", model: "m-a", reasoningEffort: "low" }], "改选更低等级写入该值");
/* 7c. 等级漂移：模型仍在但等级列表已不含已存等级 → 原样回显 + 标不可用 */
const effortDrift = panelWith(
	[{ name: "等级漂移", prompt: "p", autoSend: false, model: { provider: "p1", model: "m-a", reasoningEffort: "legacy" } }],
	catalogFace(CATALOG_READY),
);
const driftSelects = qSelects(qRows(effortDrift.panel)[0]);
assert.equal(driftSelects[1].props.value, "legacy", "已存等级原样选中");
assert.deepEqual([qOptions(driftSelects[1]).at(-1).props.value, qText(qOptions(driftSelects[1]).at(-1))], ["legacy", "legacy · modelUnavailable"], "等级漂移值作为额外一项标「不可用」");
driftSelects[1].props.onChange({ target: { value: "legacy" } });
assert.equal(effortDrift.edits.length, 0, "重选漂移等级为空操作（保存不改写）");
/* 7d. 目录不可用降级：仅「跟随会话模型」+ 降级提示；其余字段编辑照常 */
const degradedPanel = panelWith([{ name: "跟随", prompt: "p", autoSend: false }], null);
const degradedRows = qRows(degradedPanel.panel);
assert.deepEqual(qOptions(qSelects(degradedRows[0])[0]).map((o) => o.props.value), [""], "目录不可用 → 模型下拉只剩「跟随会话模型」");
assert.ok(kidsOf(degradedPanel.panel).some((c) => c.props && c.props.className === "v-sc-modelHint" && qText(c) === "modelCatalogFallback"), "显示降级提示");
const errCatalogPanel = panelWith([{ name: "跟随", prompt: "p", autoSend: false }], catalogFace({ status: "error", groups: [] }));
assert.ok(kidsOf(errCatalogPanel.panel).some((c) => c.props && c.props.className === "v-sc-modelHint"), "目录加载失败同样降级");
/* 7e. 不可写 / 保存中：下拉与行内既有控件同禁用 */
for (const over of [{ writable: false }, { saving: true }]) {
	const disabledRows = qRows(panelWith(boundDraft, catalogFace(CATALOG_READY), over).panel);
	for (const select of disabledRows.flatMap(qSelects)) assert.equal(select.props.disabled, true, "下拉与行内控件同禁用口径");
}

/* ── 8. 模型目录桥（add-quick-button-model，design D2/D3/D6）：预取 / 事件重载 / 重置 / 信封判定 ── */
const bridgeEvents = [];
const bridgeSelectCalls = [];
let bridgeCatalogResponse = { ok: true, value: { groups: modelGroups } };
let bridgeSelectResponse = { ok: true, value: { selected: {} } };
let bridgeSelectThrows = false;
const bridge = plugin.createModelBridge({
	remote: {
		session: {
			modelCatalog: async () => bridgeCatalogResponse,
			selectModel: async (request) => {
				bridgeSelectCalls.push(request);
				if (bridgeSelectThrows) throw new Error("offline");
				return bridgeSelectResponse;
			},
		},
		$on: (event, listener) => { bridgeEvents.push({ event, listener }); return () => {}; },
	},
	sessions: { subagentAddress: (id) => (id === "child-1" ? { parentSessionId: "p", childSessionId: id, mode: "task" } : undefined) },
	on: (event, listener) => { bridgeEvents.push({ event, listener }); return () => {}; },
});
assert.equal(bridge.getSnapshot().status, "loading", "构造即预取（官方模型目录同款）");
await new Promise((r) => setImmediate(r));
assert.equal(bridge.getSnapshot().status, "ready", "目录就绪");
assert.deepEqual(bridge.getSnapshot().groups.map((g) => g.id), ["p1"], "目录 groups 投影");
assert.deepEqual(plugin.catalogOptions(bridge.getSnapshot().groups).items.map((i) => i.key), ["p1/m-a", "p1/m-b"], "目录快照可直接展开出面板候选项");
assert.deepEqual(bridgeEvents.map((e) => e.event), [
	"llm/adapters-updated", "settings/document-updated", "credentials/reference-updated", "connection/reset",
], "订阅官方同款三个目录事件 + 连接重置");
/* 目录事件 → 重载 */
const fire = (event) => { for (const e of bridgeEvents.filter((x) => x.event === event)) e.listener(); };
fire("settings/document-updated");
assert.equal(bridge.getSnapshot().status, "loading", "目录事件触发重载");
await new Promise((r) => setImmediate(r));
assert.equal(bridge.getSnapshot().status, "ready", "重载完成");
/* 连接重置 → 清旧值后重载 */
fire("connection/reset");
assert.deepEqual(bridge.getSnapshot().groups, [], "连接重置清旧值");
await new Promise((r) => setImmediate(r));
assert.equal(bridge.getSnapshot().status, "ready", "重置后代际重载");
/* 切换：显式判结果信封（ok:false 不抛，交由点击路径降级） */
bridgeSelectResponse = { ok: false, error: { code: "model-not-found", message: "unknown model" } };
assert.deepEqual(await bridge.select("s-1", { provider: "p1", model: "m-a", reasoningEffort: "max" }),
	{ ok: false, error: "unknown model" }, "信封 ok=false → 失败结果（不抛异常）");
assert.deepEqual(bridgeSelectCalls.at(-1), { sessionId: "s-1", provider: "p1", model: "m-a", reasoningEffort: "max" }, "请求体 = 会话 + 三元组");
bridgeSelectResponse = { ok: true, value: { selected: {} } };
assert.deepEqual(await bridge.select("s-1", { provider: "p1", model: "m-b" }), { ok: true, error: "" }, "成功信封");
assert.deepEqual(bridgeSelectCalls.at(-1), { sessionId: "s-1", provider: "p1", model: "m-b" }, "无等级不携带 reasoningEffort");
bridgeSelectThrows = true;
assert.deepEqual(await bridge.select("s-1", { provider: "p1", model: "m-a" }), { ok: false, error: "offline" }, "调用抛错 → 同样归一为失败结果");
bridgeSelectThrows = false;
/* 可切换判据（design D7）：子代理 / 无会话 id 一律 false */
assert.equal(bridge.canSwitch("s-1"), true, "普通会话可切换");
assert.equal(bridge.canSwitch("child-1"), false, "子代理会话不可切换");
assert.equal(bridge.canSwitch(undefined), false, "无会话 id → false");
/* 命名空间缺失 / 目录加载失败 → 整体降级 */
bridgeCatalogResponse = { ok: false, error: { code: "offline", message: "no connection" } };
fire("llm/adapters-updated");
await new Promise((r) => setImmediate(r));
assert.equal(bridge.getSnapshot().status, "error", "目录信封失败 → error（面板降级为仅跟随）");
const bareBridge = plugin.createModelBridge({ remote: {}, sessions: {} });
assert.equal(bareBridge.getSnapshot().status, "error", "注入不可用（无该命名空间）→ 目录 error");
assert.deepEqual(await bareBridge.select("s-1", { provider: "p", model: "m" }), { ok: false, unavailable: true, error: "" },
	"命名空间缺失 → 切换 unavailable（点击路径统一 toast 降级）");
assert.equal(bareBridge.canSwitch("s-1"), false, "无法判定子代理人会话 → false（保守跳过）");
bridge.dispose();

console.log("quick-buttons-client-smoke: ok");
