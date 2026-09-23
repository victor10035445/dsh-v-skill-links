/**
 * 快捷按钮 schema 冒烟：normalizeButtons 归一化语义（trim / 空条目剔除 / name 去重 /
 * autoSend 布尔归一 / 上限 32 / 校验抛错；显示名不套用 commands 小写正则）+
 * settingsSchema 的 buttons 字段契约 + 分层合并（base 用户层覆盖 / scope 语义）。
 * 运行：node test/buttons-schema-smoke.mjs
 */
import assert from "node:assert/strict";
import { normalizeButtons, settingsSchema } from "../lib/index.js";

/* ── 1. 归一化：trim / 剔除完全空条目 / 去重先到先得 ── */
const buttons = normalizeButtons({
  buttons: [
    { name: " 新建 ", prompt: "  使用 xxx 技能做 xxx 事  ", autoSend: true },
    { name: "新建", prompt: "重复项被丢弃" },
    { name: "  ", prompt: "   " },
    { name: "审查", prompt: "请使用 /code-review 审查" },
  ],
});
assert.deepEqual(buttons, [
  { name: "新建", prompt: "使用 xxx 技能做 xxx 事", autoSend: true },
  { name: "审查", prompt: "请使用 /code-review 审查", autoSend: false },
], "trim + 空条目剔除 + 去重先到先得");

/* ── 2. 显示名允许中文 / 大写 / 空格（不套用 commands 小写正则） ── */
assert.deepEqual(
  normalizeButtons([{ name: "Daily Review 每日", prompt: "p" }]).map((b) => b.name),
  ["Daily Review 每日"],
  "显示名不做小写归一",
);

/* ── 3. autoSend 布尔归一：缺省 false；非布尔抛错 ── */
assert.equal(normalizeButtons([{ name: "a", prompt: "p" }])[0].autoSend, false, "缺省 false");
assert.equal(normalizeButtons([{ name: "a", prompt: "p", autoSend: undefined }])[0].autoSend, false);
assert.equal(normalizeButtons([{ name: "a", prompt: "p", autoSend: null }])[0].autoSend, false);
assert.throws(() => normalizeButtons([{ name: "a", prompt: "p", autoSend: "yes" }]), /autoSend must be a boolean/);
assert.throws(() => normalizeButtons([{ name: "a", prompt: "p", autoSend: 1 }]), /autoSend must be a boolean/);

/* ── 4. 校验抛错（注册与写入路径） ── */
assert.deepEqual(normalizeButtons("oops"), [], "字符串入参 → 空列表（与 commands 同口径：非数组非节视为空）");
assert.throws(() => normalizeButtons([null]), /non-object entry/);
assert.throws(() => normalizeButtons([{ name: 1, prompt: "p" }]), /name must be a string/);
assert.throws(() => normalizeButtons([{ name: "a", prompt: 2 }]), /prompt must be a string/);
assert.throws(() => normalizeButtons([{ name: "", prompt: "有 prompt 但没名字" }]), /name must not be empty/, "半空条目（无名有 prompt）抛错");
assert.throws(() => normalizeButtons([{ name: "a", prompt: "  " }]), /prompt must not be empty/, "半空条目（有名无 prompt）抛错");

/* ── 5. 上限 32 ── */
const many = Array.from({ length: 33 }, (_v, i) => ({ name: `b${i}`, prompt: "p" }));
assert.throws(() => normalizeButtons(many), /exceeds 32 entries/);
assert.equal(normalizeButtons(many.slice(0, 32)).length, 32, "恰好 32 条放行");

/* ── 6. settingsSchema 的 buttons 字段：归一化 + 校验 + 信封 ── */
const schema = settingsSchema();
const resolved = schema({ buttons: [{ name: "新建", prompt: "p" }] });
assert.deepEqual(resolved.buttons, [{ name: "新建", prompt: "p", autoSend: false }], "schema 归一化 buttons");
assert.deepEqual(schema({}).buttons, [], "空节 → 空 buttons");
assert.throws(() => schema({ buttons: "oops" }), /buttons must be an array/);
assert.throws(() => schema({ buttons: [{ name: "", prompt: "p" }] }), /name must not be empty/);
assert.equal(schema.dict.buttons.type, "array", "walker 容器形状");
assert.equal(schema.toJSON().dict.buttons.inner.type, "object", "toJSON 信封含 buttons");

/* ── 6.5 可选 model 绑定（add-quick-button-model）：透传 / 校验 / 零迁移 ── */
assert.deepEqual(
	normalizeButtons([{ name: "a", prompt: "p", model: { provider: " p ", model: " m ", reasoningEffort: " max " } }]),
	[{ name: "a", prompt: "p", autoSend: false, model: { provider: "p", model: "m", reasoningEffort: "max" } }],
	"模型三元组原样透传（trim + 键序 provider→model→reasoningEffort）",
);
const noEffort = normalizeButtons([{ name: "a", prompt: "p", model: { provider: "p", model: "m" } }])[0];
assert.deepEqual(noEffort.model, { provider: "p", model: "m" }, "无等级只保留 provider/model");
assert.deepEqual(Object.keys(noEffort.model), ["provider", "model"], "缺省 reasoningEffort 时 MUST NOT 输出该键");
const unbound = normalizeButtons([{ name: "a", prompt: "p" }])[0];
assert.deepEqual(Object.keys(unbound), ["name", "prompt", "autoSend"], "未提供 model 时归一化结果 MUST NOT 输出该字段");
assert.ok(!("model" in unbound), "旧条目零迁移：不补 model 键");
const oldData = normalizeButtons([{ name: "旧", prompt: "p", autoSend: true }]);
assert.deepEqual(oldData, [{ name: "旧", prompt: "p", autoSend: true }], "旧数据（无 model）逐字不变");
assert.deepEqual(
	normalizeButtons({ buttons: [{ name: "a", prompt: "p", model: { provider: "p", model: "m", reasoningEffort: "max" } }] }).map((b) => b.model),
	[{ provider: "p", model: "m", reasoningEffort: "max" }],
	"节形式入参同样透传",
);
/* 非法形状（宿主归一化即拒绝，用户设置层不会被写入） */
assert.throws(() => normalizeButtons([{ name: "a", prompt: "p", model: { provider: "", model: "m" } }]), /model\.provider must be a non-empty string/);
assert.throws(() => normalizeButtons([{ name: "a", prompt: "p", model: { provider: "p" } }]), /model\.model must be a non-empty string/);
assert.throws(() => normalizeButtons([{ name: "a", prompt: "p", model: { provider: "p", model: 1 } }]), /model\.model must be a non-empty string/);
assert.throws(() => normalizeButtons([{ name: "a", prompt: "p", model: { provider: "p", model: "m", reasoningEffort: 1 } }]), /reasoningEffort must be a string/);
assert.throws(() => normalizeButtons([{ name: "a", prompt: "p", model: { provider: "p", model: "m", reasoningEffort: "  " } }]), /reasoningEffort must not be empty/);
assert.throws(() => normalizeButtons([{ name: "a", prompt: "p", model: "p/m" }]), /model must be an object/);
assert.throws(() => normalizeButtons([{ name: "a", prompt: "p", model: ["p", "m"] }]), /model must be an object/);
assert.throws(() => schema({ buttons: [{ name: "a", prompt: "p", model: { provider: "p", model: "" } }] }), /model\.model must be a non-empty string/, "schema 写入路径同样拒绝");
assert.deepEqual(schema({ buttons: [{ name: "a", prompt: "p", model: { provider: "p1", model: "m1", reasoningEffort: "max" } }] }).buttons,
	[{ name: "a", prompt: "p", autoSend: false, model: { provider: "p1", model: "m1", reasoningEffort: "max" } }],
	"schema 归一化保留 model（宿主 MUST 显式透传，否则存储留不住）");

/* ── 7. 分层合并：base(组合层) 与用户层 buttons 覆盖语义（dsh-settings resolve 管线） ── */
function mergeLayers(base, section) {
  if (section === undefined) return base;
  if (base === undefined) return section;
  return { ...base, ...section };
}
const base = { buttons: [{ name: "补丁层按钮", prompt: "from patch" }] };
assert.deepEqual(schema(mergeLayers(base, undefined)).buttons, [{ name: "补丁层按钮", prompt: "from patch", autoSend: false }], "无用户层时 base 生效");
assert.deepEqual(
  schema(mergeLayers(base, { buttons: [{ name: "用户按钮", prompt: "from user", autoSend: true }] })).buttons,
  [{ name: "用户按钮", prompt: "from user", autoSend: true }],
  "用户层 buttons 整节覆盖 base",
);
console.log("buttons-schema-smoke: ok");
