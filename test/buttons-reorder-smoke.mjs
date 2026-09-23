/**
 * 快捷按钮排序冒烟（add-quick-buttons-reorder）：物化客户端 factory（捕获 __ModuleLoader__.load），
 * 分三段验证——
 *  1. moveButton 纯函数（design D5）：换位正确 / 相邻交换 / 边界（首行上移、末行下移、单条、
 *     越界、相等、非整数）为等价原序的新数组 / 输入数组不被 mutate / 元素引用保持；
 *  2. 控制器 face.moveButton（design D4，host 式合并 mock：value = { ...base, ...user }）：
 *     reorder 翻起 buttonsDirty、save() 复用既有路径按新顺序写数组、discard() 回退生效顺序、
 *     resetButtons() 回组合层数组序、边界空操作不产生未保存修改标记的变化（spec 口径）；
 *  3. QuickPanel 交互胶水（design D2/D3，带真实 useState 的 react 桩驱动拖拽状态机）：
 *     把手 draggable 仅置于把手、指示线随 dragover 上/下缘出现且 dragleave/dragend 清理、
 *     dragover 阶段草稿不动、drop 才落位、↑↓ 按钮逐位交换与边界禁用、不可写/保存中/单条禁用。
 * 运行：node test/buttons-reorder-smoke.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const here = fileURLToPath(new URL(".", import.meta.url));
const code = readFileSync(join(here, "..", "lib", "client.js"), "utf8");

/* ── 环境桩：捕获 load()；react 桩的 useState 带真实状态槽（可跨顶层渲染驱动拖拽状态机） ── */
let definition = null;
const windowStub = { __ModuleLoader__: { load: (def) => { definition = def; } } };
const makeReactStub = () => {
	const slots = []; // useState 状态槽：同组件跨顶层渲染保留（模拟重渲染）
	let cursor = 0;
	const reactStub = {
		createElement: (type, props, ...children) => ({ type, props, children }),
		useCallback: (fn) => fn,
		useRef: (init) => ({ current: init }),
		useMemo: (fn) => fn(),
		useSyncExternalStore: (_sub, get) => get(),
		useState: (init) => {
			const i = cursor++;
			if (slots[i] === undefined) slots[i] = typeof init === "function" ? init() : init;
			return [slots[i], (next) => { slots[i] = typeof next === "function" ? next(slots[i]) : next; }];
		},
	};
	return { reactStub, render(fn) { cursor = 0; return fn(); } };
};
const { reactStub, render } = makeReactStub();
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
assert.equal(typeof plugin.moveButton, "function", "排序纯函数已导出");

/* ═══════════════ 1. moveButton 纯函数（task 4.1，design D5） ═══════════════ */
const A = { name: "A", prompt: "pa", autoSend: false };
const B = { name: "B", prompt: "pb", autoSend: true };
const C = { name: "C", prompt: "pc", autoSend: false };

/* 换位正确性（remove-then-insert 口径） */
assert.deepEqual(plugin.moveButton([A, B, C], 0, 2), [B, C, A], "第 1 条移到末位");
assert.deepEqual(plugin.moveButton([A, B, C], 2, 0), [C, A, B], "末条移到首位");
assert.deepEqual(plugin.moveButton([A, B, C], 0, 1), [B, A, C], "向后相邻交换");
assert.deepEqual(plugin.moveButton([A, B, C], 2, 1), [A, C, B], "向前相邻交换");
assert.deepEqual(plugin.moveButton([A, B, C], 0, 0), [A, B, C], "原位自换");
/* 元素引用保持（排序只动位置、不动内容） */
const moved = plugin.moveButton([A, B, C], 0, 2);
assert.ok(moved[0] === B && moved[1] === C && moved[2] === A, "元素引用原样保持");
/* 输入数组不被 mutate */
const source = [A, B, C];
plugin.moveButton(source, 0, 2);
plugin.moveButton(source, 1, 1);
assert.deepEqual(source, [A, B, C], "输入数组不被 mutate");
assert.notEqual(plugin.moveButton(source, 0, 2), source, "换位返回新数组");
/* 越界 / 相等 / 非整数 → 等价原序的新数组（spec「边界行为为空操作」的纯函数底座） */
for (const [from, to] of [[0, -1], [0, 3], [-1, 0], [3, 0], [1, 1], [-5, 99], [0.5, 1]]) {
	const out = plugin.moveButton([A, B, C], from, to);
	assert.deepEqual(out, [A, B, C], `from=${from},to=${to} 等价原序`);
	assert.notEqual(out, source, `from=${from},to=${to} 仍返回新数组`);
}
assert.deepEqual(plugin.moveButton([A], 0, 0), [A], "单条空操作");
assert.deepEqual(plugin.moveButton([], 0, 1), [], "空列表空操作");
assert.deepEqual(plugin.moveButton(null, 0, 1), [], "非数组输入兜底空列表");

/* ═══════════════ 2. 控制器 face.moveButton（task 4.2，design D4） ═══════════════ */
const scopeListeners2 = new Set();
const baseDoc = {
	directories: ["F:/base"],
	buttons: [
		{ name: "C", prompt: "pc", autoSend: false },
		{ name: "B", prompt: "pb", autoSend: false },
		{ name: "A", prompt: "pa", autoSend: false },
	],
};
let userDoc = {
	buttons: [
		{ name: "A", prompt: "pa", autoSend: true },
		{ name: "B", prompt: "pb", autoSend: false },
		{ name: "C", prompt: "pc", autoSend: false },
	],
};
const mkSnap = () => ({ status: "ready", value: { ...baseDoc, ...userDoc }, base: baseDoc, user: userDoc, revision: 1, writable: true, mode: "host" });
let snap2 = mkSnap();
const notify2 = () => { for (const l of [...scopeListeners2]) l(); };
const calls2 = { set: [], unset: [] };
const scope2 = {
	getSnapshot: () => snap2,
	subscribe: (fn) => { scopeListeners2.add(fn); return () => scopeListeners2.delete(fn); },
	set: async (field, value) => {
		calls2.set.push([field, value]);
		userDoc = { ...userDoc, [field]: value };
		snap2 = { ...snap2, value: { ...baseDoc, ...userDoc }, user: userDoc, revision: snap2.revision + 1 };
		notify2();
	},
	unset: async (field) => {
		calls2.unset.push(field);
		userDoc = { ...userDoc };
		delete userDoc[field];
		if (Object.keys(userDoc).length === 0) userDoc = null;
		snap2 = { ...snap2, value: { ...baseDoc, ...(userDoc ?? {}) }, user: userDoc, revision: snap2.revision + 1 };
		notify2();
	},
};
let registeredQuick = null;
const ctx2 = {
	effect: (fn) => { fn(); return () => {}; },
	/* 可选注入桩（add-quick-button-model）：本用例只需面板草稿面；目录桥降级即可。 */
	inject: (deps, fn) => fn({ remote: {}, sessions: {}, on: () => () => {} }),
	locale: {
		register: () => () => {},
		bind: () => (key) => key,
		getSnapshot: () => ({ revision: 1 }),
		subscribe: () => () => {},
	},
	slots: {
		register: (options, component) => ({ options, component }),
		inject: (name, fn) => {
			if (name === "settings.v-skills.tab") {
				const reg = fn();
				if (reg.options.id === "quick") registeredQuick = reg;
			}
		},
	},
	get(name) {
		if (name === "settingsScope") return { bind: () => scope2 };
		if (name === "inputTriggers") return { registerSource: () => () => {} };
		throw new Error(`unexpected service ${name}`);
	},
};
plugin.apply(ctx2);
const face = registeredQuick.options.inject().face;
const names = () => face.getSnapshot().buttonsDraft.map((b) => b.name);

assert.deepEqual(names(), ["A", "B", "C"], "草稿初始跟随生效值（用户层覆盖序）");
assert.equal(face.getSnapshot().buttonsOverridden, true);
assert.equal(face.getSnapshot().buttonsDirty, false);

face.moveButton(0, 2);
assert.deepEqual(names(), ["B", "C", "A"], "reorder 写回暂存草稿");
assert.equal(face.getSnapshot().buttonsDirty, true, "纯调序翻起 buttonsDirty（dirty 口径零改动，task 2.2）");
assert.equal(face.getSnapshot().dirty, true, "按钮脏标记计入整体 dirty");
assert.equal(face.getSnapshot().buttonsInvalid, false, "换位不增删条目，buttonIssue 校验口径不受影响");

face.moveButton(2, 0);
assert.deepEqual(names(), ["A", "B", "C"], "移回原位");
assert.equal(face.getSnapshot().buttonsDirty, false, "回到生效顺序即不脏（JSON.stringify 等价）");

/* 边界空操作：不报错、不产生未保存修改标记的变化（spec「边界行为为空操作」） */
face.moveButton(0, -1);
face.moveButton(0, 3);
face.moveButton(1, 1);
face.moveButton(-5, 99);
assert.deepEqual(names(), ["A", "B", "C"], "越界/相等为等价原序空操作");
assert.equal(face.getSnapshot().buttonsDirty, false, "边界空操作不翻脏标记");

/* 保存写出按新顺序的数组（spec「保存新顺序」；save() 复用既有路径零改动） */
face.moveButton(0, 1);
assert.deepEqual(names(), ["B", "A", "C"]);
await face.save();
const write = calls2.set.find(([field]) => field === "buttons");
assert.deepEqual(write[1].map((b) => b.name), ["B", "A", "C"], "save() 按新顺序写 buttons 数组");
assert.deepEqual(write[1][0], { name: "B", prompt: "pb", autoSend: false }, "写出行保持 { name, prompt, autoSend } 形状");
assert.equal(face.getSnapshot().buttonsDirty, false, "保存后清暂存");
assert.deepEqual(names(), ["B", "A", "C"], "保存后草稿跟随生效值（dock 经同一 scope 反应式跟随）");
assert.equal(face.getSnapshot().buttonsOverridden, true);

/* 放弃修改回退生效顺序（spec「排序草稿可放弃与重置」） */
face.moveButton(1, 0);
assert.equal(face.getSnapshot().buttonsDirty, true);
face.discard();
assert.deepEqual(names(), ["B", "A", "C"], "放弃后草稿顺序回退为当前生效顺序");
assert.equal(face.getSnapshot().buttonsDirty, false);

/* 重置按钮回组合层数组序 */
await face.resetButtons();
assert.deepEqual(calls2.unset, ["buttons"], "重置走既有 unset 路径");
assert.deepEqual(names(), ["C", "B", "A"], "重置后回组合层（cordis.patch.yml）数组书写顺序");
assert.equal(face.getSnapshot().buttonsOverridden, false);

/* 单条按钮：排序不产生任何效果（spec） */
await scope2.set("buttons", [{ name: "Solo", prompt: "p", autoSend: false }]);
face.moveButton(0, 0);
face.moveButton(0, -1);
face.moveButton(0, 5);
assert.deepEqual(names(), ["Solo"], "单条按钮排序空操作");
assert.equal(face.getSnapshot().buttonsDirty, false);

/* ═══════════════ 3. QuickPanel 交互胶水（design D2/D3） ═══════════════ */
/* 复位作用域到已知三按钮态，面板直接渲染真实控制器 face（全链路：拖拽 → moveButton → 草稿）。 */
userDoc = { buttons: [{ name: "A", prompt: "pa", autoSend: true }, { name: "B", prompt: "pb", autoSend: false }, { name: "C", prompt: "pc", autoSend: false }] };
snap2 = mkSnap();
notify2();
face.discard(); /* 清掉第 2 段遗留的单条暂存草稿，回到跟随生效值 */

const childrenOf = (el) => [].concat(el.props !== undefined && el.props.children !== undefined ? el.props.children : (el.children ?? [])).flat()
	.filter((c) => c !== false && c !== null && c !== undefined && c !== true);
const rowsOf = (panel) => childrenOf(panel).filter((c) => c && c.props && c.props.className === "v-sc-row");
const headOf = (row) => childrenOf(row).find((c) => c.props && c.props.className === "v-sc-rowHead");
const gripOf = (row) => childrenOf(headOf(row))[0];
const movesOf = (row) => childrenOf(headOf(row)).filter((c) => c.props && c.props.className === "v-sc-move");
const dropLineOf = (row) => childrenOf(row).find((c) => c.props && c.props.className === "v-sc-dropLine");
const countDropLines = (rows) => rows.reduce((n, row) => n + (dropLineOf(row) ? 1 : 0), 0);
const renderPanel = () => render(() => plugin.QuickPanel({ t: (k) => k, face }));
const dragOverAt = (row, clientY) => row.props.onDragOver({
	preventDefault() {},
	clientY,
	currentTarget: { getBoundingClientRect: () => ({ top: 0, height: 100 }) },
});
const dragStart = (grip) => grip.props.onDragStart({ dataTransfer: { setData() {}, effectAllowed: null } });

let panel = renderPanel();
let rows = rowsOf(panel);
assert.equal(rows.length, 3, "三行按钮卡片");
assert.equal(gripOf(rows[0]).type, "span", "行首为把手 span");
assert.equal(gripOf(rows[0]).props.className, "v-sc-grip", "把手稳定 class");
assert.equal(gripOf(rows[0]).props.draggable, true, "把手可发起拖拽");
assert.equal(gripOf(rows[0]).props["aria-label"], "gripLabel", "把手 aria-label（词典键）");
assert.ok(!("draggable" in rows[0].props), "整条卡片行不可拖拽（spec：拖拽只从把手发起）");

/* 拖起 → 悬停第 3 行上缘：指示线出现，草稿不动（不实时重排） */
dragStart(gripOf(rows[0]));
panel = renderPanel();
rows = rowsOf(panel);
assert.deepEqual(names(), ["A", "B", "C"], "拖起不动草稿");
assert.equal(countDropLines(rows), 0, "拖起后尚未判定落点，无指示线");
dragOverAt(rows[2], 0); /* 行顶 → 上缘 */
panel = renderPanel();
rows = rowsOf(panel);
assert.equal(dropLineOf(rows[2])?.props["data-edge"], "before", "悬停行上缘指示线");
assert.equal(countDropLines(rows), 1, "仅候选落点一条指示线");
assert.deepEqual(names(), ["A", "B", "C"], "dragover 阶段草稿顺序不变");
assert.equal(face.getSnapshot().buttonsDirty, false, "拖拽过程不产生未保存修改标记");

/* 松手落位：from=0 经上缘 of index=2 → 目标 1 → [B, A, C] */
rows[2].props.onDrop({ preventDefault() {} });
assert.deepEqual(names(), ["B", "A", "C"], "松手落下：A 插到 B 之后（remove-then-insert）");
assert.equal(face.getSnapshot().buttonsDirty, true, "落位翻起脏标记（暂存-保存模型）");
panel = renderPanel();
rows = rowsOf(panel);
assert.equal(countDropLines(rows), 0, "drop 后指示线消失");

/* dragleave 清指示线且不换位；dragend（Esc / 区域外松手）清状态不换位 */
face.discard();
panel = renderPanel();
rows = rowsOf(panel);
let grip0 = gripOf(rows[0]);
dragStart(grip0);
panel = renderPanel();
rows = rowsOf(panel);
dragOverAt(rows[1], 999); /* 行底 → 下缘 */
panel = renderPanel();
rows = rowsOf(panel);
assert.equal(dropLineOf(rows[1])?.props["data-edge"], "after", "悬停行下缘指示线");
rows[1].props.onDragLeave();
panel = renderPanel();
rows = rowsOf(panel);
assert.equal(countDropLines(rows), 0, "dragleave 清指示线");
assert.deepEqual(names(), ["A", "B", "C"], "取消路径不换位");
grip0.props.onDragEnd();
panel = renderPanel();
rows = rowsOf(panel);
assert.equal(countDropLines(rows), 0, "dragend（Esc/区域外）后无残留指示线");
assert.deepEqual(names(), ["A", "B", "C"], "dragend 不换位");

/* ↑↓ 按钮：逐位交换 + 边界禁用（spec「上移/下移按钮逐位交换」） */
rows = rowsOf(renderPanel());
assert.equal(movesOf(rows[0])[0].props.disabled, true, "首行上移禁用");
assert.equal(movesOf(rows[0])[0].props.title, "moveUp", "上移按钮 title（词典键）");
assert.equal(movesOf(rows[0])[0].props.type, "button", "原生 button 键盘可达");
assert.equal(movesOf(rows[2])[1].props.disabled, true, "末行下移禁用");
assert.equal(movesOf(rows[2])[1].props.title, "moveDown", "下移按钮 title（词典键）");
assert.equal(movesOf(rows[1])[0].props.disabled, false, "中间行上移可用");
assert.equal(movesOf(rows[1])[1].props.disabled, false, "中间行下移可用");
movesOf(rows[2])[0].props.onClick(); /* C 上移 */
assert.deepEqual(names(), ["A", "C", "B"], "上移逐位交换");
rows = rowsOf(renderPanel());
movesOf(rows[1])[1].props.onClick(); /* 现第 2 行 C 下移 */
assert.deepEqual(names(), ["A", "B", "C"], "下移逐位交换回原位");
assert.equal(face.getSnapshot().buttonsDirty, false, "回到生效顺序即不脏");
face.discard();

/* 禁用口径（spec「不可写或保存中禁用排序控件」+「数量 ≤1 无效果」） */
const mkStubFace = (over) => ({
	getSnapshot: () => ({
		status: "ready", available: true, writable: true, mode: "host",
		dirty: false, invalid: false, invalidReason: "", saving: false, failed: false,
		text: "", overridden: false, effective: [], baseDirs: [], count: 0,
		commandsDraft: [], commandsDirty: false, commandsInvalid: false, commandsInvalidReason: "", commandsOverridden: false, effectiveCommands: [], baseCommandsCount: 0,
		buttonsDraft: [{ name: "A", prompt: "pa", autoSend: false }, { name: "B", prompt: "pb", autoSend: false }, { name: "C", prompt: "pc", autoSend: false }],
		buttonsDirty: false, buttonsInvalid: false, buttonsInvalidReason: "", buttonsOverridden: false, effectiveButtons: [], baseButtonsCount: 0,
		...over,
	}),
	subscribe: () => () => {},
});
for (const [label, over] of [["不可写", { writable: false }], ["保存中", { saving: true }]]) {
	rows = rowsOf(render(() => plugin.QuickPanel({ t: (k) => k, face: mkStubFace(over) })));
	assert.equal(gripOf(rows[0]).props.draggable, false, `${label}时把手不可发起拖拽`);
	assert.equal(gripOf(rows[0]).props["data-disabled"], "true", `${label}时把手标记禁用态`);
	for (const row of rows) for (const m of movesOf(row)) assert.equal(m.props.disabled, true, `${label}时上下移按钮禁用`);
}
rows = rowsOf(render(() => plugin.QuickPanel({ t: (k) => k, face: mkStubFace({ buttonsDraft: [A] }) })));
assert.equal(gripOf(rows[0]).props.draggable, false, "单条按钮把手不可拖");
for (const m of movesOf(rows[0])) assert.equal(m.props.disabled, true, "单条按钮上下移均禁用");

console.log("buttons-reorder-smoke: ok");
