/**
 * 注入冒烟：/令牌收集口径（空白边界）、消息来源过滤（只扫直接用户输入）、
 * <skill_content> 渲染形状、注入消息构造（plugin 来源 + instructions 形态 + 冻结）。
 * 运行：node test/inject-smoke.mjs
 */
import assert from "node:assert/strict";
import { collectSkillTokens, collectMatchedNames, renderSkillContent } from "../lib/index.js";

/* ── 1. 令牌收集：空白边界 ── */
assert.deepEqual(collectSkillTokens("/a /b c /d"), ["a", "b", "d"]);
assert.deepEqual(collectSkillTokens("开头/a 不算"), [], "非空白边界不算");
assert.deepEqual(collectSkillTokens("/"), [], "裸斜杠不算");
assert.deepEqual(collectSkillTokens("/a,b"), ["a,b"], "标点跟走（与原生口径一致，精确匹配兜底）");
assert.deepEqual(collectSkillTokens(null), []);

/* ── 2. 命中匹配：只扫直接用户输入，去重 ── */
const skills = new Map([
  ["alpha", { name: "alpha", dir: "D:\\s\\alpha", file: "D:\\s\\alpha\\SKILL.md" }],
  ["beta", { name: "beta", dir: "D:\\s\\beta", file: "D:\\s\\beta\\SKILL.md" }],
]);
const messages = [
  {
    role: "user",
    content: [{ type: "text", text: "用 /alpha 处理 /beta，再 /alpha 一次" }],
    source: { kind: "user" },
  },
  {
    role: "user",
    content: [{ type: "text", text: "插件注入里出现 /beta 不应计入" }],
    source: { kind: "plugin", plugin: "someone", form: "notice", summary: "x" },
  },
  {
    role: "user",
    content: [{ type: "text", text: "浏览器 rpc 消息 /beta 算直接输入" }],
    source: { kind: "user", rpcId: "r1", clientTimeZone: "UTC" },
  },
  { role: "user", content: [{ type: "text", text: "未知 /nope 不算" }], source: { kind: "user" } },
];
assert.deepEqual(collectMatchedNames(messages, skills), ["alpha", "beta"], "用户输入命中 + 去重 + 插件注入排除 + rpc 算用户");

/* ── 3. 渲染形状 ── */
const block = renderSkillContent(skills.get("alpha"), "Alpha 正文\n步骤 2");
assert.ok(block.startsWith('<skill_content name="alpha" source="D:\\s\\alpha\\SKILL.md">'), "name 与 source 属性");
assert.ok(block.includes("<skill_resources>"), "资源提示段");
assert.ok(block.includes(`Base directory for this skill: ${skills.get("alpha").dir}`));
assert.ok(block.includes("<skill_instructions>\nAlpha 正文\n步骤 2\n</skill_instructions>"), "正文逐字内嵌");
assert.ok(block.trimEnd().endsWith("</skill_content>"));
const escaped = renderSkillContent({ name: 'a"b<c', dir: "d", file: "f" }, "x");
assert.ok(escaped.includes('name="a&quot;b&lt;c"'), "属性转义");

/* ── 4. 插件名/导出面 ── */
const mod = await import("../lib/index.js");
assert.equal(mod.name, "dsh-v-skill-links");
assert.equal(typeof mod.apply, "function");
console.log("inject-smoke: ok");
