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
