/**
 * 快捷按钮客户端冒烟：物化客户端 factory（捕获 __ModuleLoader__.load），验证——
 *  1. appendPrompt 纯函数（空草稿填入 / 非空追加 \n / 非字符串兜底）；
 *  2. buttonsSectionOf 投影（空节 / 旧文档兼容 / 残缺条目丢弃 / autoSend 归一）；
 *  3. createButtonsStore（scope 快照投影 + 订阅跟随 + dispose）；
 *  4. dock 注册契约（composer.dock + input.dock hero 双条目：id / order / locale / inject 快照 face /
 *     hero 标记）；
 *  5. QuickButtonsGrid 组件契约（空列表 null / 缺 face null / outline+sm 元素形状 /
 *     data-v-button / 截断容器 / 点击追加与 autoSend→submit / phase 非 plain 禁用 /
 *     hero 门控：非 blank 返回 null、blank 渲染且带修饰类、与 composer 条目互斥）。
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
const runtimeStub = {
	createSnapshotStore: (init) => {
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
const requireStub = (spec) => (spec === "react" ? reactStub : spec === "@deepseek-ai/dsh-client-runtime/client" ? runtimeStub : spec === "@deepseek-ai/dsh-client-ui-primitives" ? primitivesStub : spec === "@deepseek-ai/dsh-client-ui-slots" ? slotsPkgStub : null);

new Function("window", "require", code)(windowStub, requireStub);
assert.ok(definition, "捕获到 load 定义");
const plugin = definition.factory(requireStub);

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

/* ── 4. dock 注册契约 + apply 接线 ── */
let scopeSnapShared = { status: "ready", value: { buttons: [{ name: "新建", prompt: "使用 xxx 技能做 xxx 事", autoSend: true }] } };
const sharedListeners = new Set();
const sharedScope = {
	getSnapshot: () => scopeSnapShared,
	subscribe: (fn) => { sharedListeners.add(fn); return () => sharedListeners.delete(fn); },
};
let registeredDock = null;
let registeredHero = null;
const ctx = {
	effect: (fn) => { fn(); return () => {}; },
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

/* ── 5g. hero 门控（design D10）：仅 blank 渲染且带修饰类；非 blank / 缺 session 返回 null ── */
const heroBlank = Grid({
	session: { composerPhase: "blank" },
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
	session: { composerPhase: "blank" },
	input: { draft: "帮我看看", phase: "plain" },
	inputActions: heroActions,
	buttons: heroProps.buttons,
	hero: true,
	t: (k) => k,
});
childrenOf(heroWithDraft)[0].props.onClick();
assert.deepEqual(heroActions.calls.setDraft, ["帮我看看\n使用 xxx 技能做 xxx 事"], "hero 条目追加语义一致");
assert.equal(heroActions.calls.submit, 1, "hero 条目 autoSend 即提交（发起第一回合）");
/* 非 blank（含过渡态）一律返回 null */
for (const phase of ["engaging", "adjudicating", "submitting"]) {
	assert.equal(Grid({
		session: { composerPhase: phase },
		input: { draft: "", phase: "plain" },
		inputActions: makeActions(),
		buttons: heroProps.buttons,
		hero: true,
		t: (k) => k,
	}), null, `composerPhase=${phase} 时 hero 条目返回 null`);
}
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
	session: { composerPhase: "engaging" },
	input: { draft: "", phase: "plain" },
	inputActions: makeActions(),
	buttons: dockProps.buttons,
	t: (k) => k,
});
assert.equal(composerDuringSession.props.className, "v-qb-grid", "composer 条目无 hero 修饰类、会话态接管渲染");

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

console.log("quick-buttons-client-smoke: ok");
