/**
 * 设置 schema 冒烟：手写 schema（免 schemastery 依赖）满足 dsh-settings 的最小契约——
 * 可调用（归一化 + 校验抛错）、toJSON 信封、redactSecrets walker 的容器形状。
 * 覆盖 directories 与 commands（自定义指令）两个字段。
 * 运行：node test/settings-schema-smoke.mjs
 */
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { resolve as pathResolve } from "node:path";
import { settingsSchema, normalizeCommands, commandDescription } from "../lib/index.js";

const schema = settingsSchema();
const home = homedir();
const cwd = process.cwd();

/* ── 1. 可调用：directories 归一化语义（去重 / 空串剔除 / ~ 展开 / 相对基准 / 绝对保留） ── */
assert.deepEqual(schema({}), { directories: [], commands: [], buttons: [] }, "空节 → 默认空数组");
assert.deepEqual(schema(undefined), { directories: [], commands: [], buttons: [] });
const resolved = schema({ directories: ["F:/a", "~/b", "F:/a", " ./c ", ""] });
assert.equal(resolved.directories.length, 3, "去重 + 空串剔除");
assert.equal(resolved.directories[0], pathResolve("F:/a"));
assert.equal(resolved.directories[1], pathResolve(home + "/b"), "~/b → 主目录");
assert.equal(resolved.directories[2], pathResolve(cwd + "/c"), "./c → 启动目录");

/* ── 2. commands 归一化：小写 / 去重 / 空白剔除 ── */
const cmds = schema({ commands: [{ name: " Daily-Review ", prompt: "  用 /daily-review 审查今天的改动  " }, { name: "daily-review", prompt: "重复项被丢弃" }, { name: "ship", prompt: "\n多行\nPrompt\n" }] });
assert.deepEqual(cmds.commands.map((c) => c.name), ["daily-review", "ship"], "小写归一 + 重名先到先得");
assert.equal(cmds.commands[0].prompt, "用 /daily-review 审查今天的改动", "prompt 首尾空白剔除");
assert.deepEqual(normalizeCommands(undefined), []);

/* ── 3. commands 校验抛错（注册与写入路径） ── */
assert.throws(() => schema({ commands: "oops" }), /commands must be an array/);
assert.throws(() => schema({ commands: [{ name: "Bad Name", prompt: "x" }] }), /must match/);
assert.throws(() => schema({ commands: [{ name: "ok", prompt: "  " }] }), /prompt must not be empty/);
assert.throws(() => schema({ commands: [{ name: "ok", prompt: 1 }] }), /prompt must be a string/);
assert.doesNotThrow(() => normalizeCommands([{ name: "ok", prompt: "a" }, { name: "ok", prompt: "b" }]), "重名去重不抛错");

/* ── 4. commandDescription：Prompt 首行做菜单描述 ── */
assert.equal(commandDescription("第一行\n第二行"), "第一行");
assert.equal(commandDescription("\n\n  缩进行  "), "缩进行");
assert.equal(commandDescription("x".repeat(200)).length, 120, "超长截断到 120");
assert.equal(commandDescription(""), "");

/* ── 5. 类型错误抛错（directories） ── */
assert.throws(() => schema({ directories: "oops" }), /array of strings/);
assert.throws(() => schema({ directories: [1] }), /non-string entry/);

/* ── 6. toJSON 信封 + walker 容器形状（describe / redactSecrets 兼容） ── */
const envelope = schema.toJSON();
assert.equal(envelope.type, "object");
assert.equal(envelope.dict.directories.type, "array");
assert.equal(envelope.dict.directories.inner.type, "string");
assert.equal(envelope.dict.commands.type, "array");
assert.equal(schema.type, "object");
assert.equal(schema.dict.commands.type, "array");

/* ── 7. 模拟 dsh-settings 的 resolve 管线：schema(mergeLayers(base, user)) ── */
function mergeLayers(base, section) {
  if (section === undefined) return base;
  if (base === undefined) return section;
  return { ...base, ...section };
}
const base = { directories: ["F:/patch-skills"] };
assert.equal(schema(mergeLayers(base, undefined)).directories.length, 1, "base 层生效");
assert.deepEqual(schema(mergeLayers(base, { directories: ["F:/user-skills"] })).directories, [pathResolve("F:/user-skills")], "用户层覆盖 base");
console.log("settings-schema-smoke: ok");
