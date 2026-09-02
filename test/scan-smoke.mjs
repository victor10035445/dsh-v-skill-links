/**
 * 扫描冒烟：配置归一化（~ / 相对路径 / 去重）、frontmatter 解析、
 * 描述推导、目录扫描（一级子目录 / 大小写不敏感 SKILL.md / 隐藏目录跳过 / 重名先到先得）。
 * 运行：node test/scan-smoke.mjs
 */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeDirectories, parseSkillMarkdown, deriveSummary, scanCatalog } from "../lib/index.js";

const home = mkdtempSync(join(tmpdir(), "jsl-home-"));
const base = mkdtempSync(join(tmpdir(), "jsl-base-"));
try {
  /* ── 1. 配置归一化 ── */
  const dirs = normalizeDirectories(
    { directories: [join(home, "a"), "~/b", "./c", join(home, "a"), "", 42, "~/b"] },
    base,
    home,
  );
  assert.deepEqual(dirs, [join(home, "a"), join(home, "b"), join(base, "c")], "~ 展开 / 相对基准 / 去重 / 非法项过滤");
  assert.deepEqual(normalizeDirectories(undefined), [], "undefined 配置 → 空数组");
  assert.deepEqual(normalizeDirectories(["x"]), [join(process.cwd(), "x")], "裸数组配置也接受");

  /* ── 2. frontmatter 解析 ── */
  const withFm = parseSkillMarkdown("---\r\nname: alpha-skill\r\ndescription: \"带引号 描述\"\r\nextra: 1\r\n---\r\n\r\n# Alpha\r\n正文");
  assert.equal(withFm.data.name, "alpha-skill");
  assert.equal(withFm.data.description, "带引号 描述");
  assert.ok(withFm.body.startsWith("# Alpha"), "正文剥掉 frontmatter");
  const noFm = parseSkillMarkdown("\uFEFF# 无 frontmatter\n\nbody");
  assert.deepEqual(noFm.data, {});
  assert.ok(noFm.body.startsWith("# 无 frontmatter"), "BOM 剥掉、无 frontmatter 全文即正文");
  const unclosed = parseSkillMarkdown("---\nname: x\nno closing");
  assert.deepEqual(unclosed.data, {}, "没有闭合 --- 时不认 frontmatter");

  /* ── 3. 名字与描述推导 ── */
  assert.equal(deriveSummary("code review", {}, "# 标题").name, "code-review", "目录名空白归一");
  assert.equal(deriveSummary("d", { name: "has space" }, "").name, "d", "frontmatter 名含空白时弃用");
  assert.equal(deriveSummary("d", { description: "直接描述" }, "# 标题").description, "直接描述");
  assert.equal(deriveSummary("d", {}, "- 列表行首行").description, "- 列表行首行", "无 frontmatter 时取正文首行");
  assert.equal(deriveSummary("d", {}, "<!-- 注释 -->\n## 二级标题").description, "二级标题", "跳过 HTML 注释、标题去 #");
  assert.equal(deriveSummary("d", {}, `${"长".repeat(300)}\n第二行`).description.length, 200, "描述截断到 200");

  /* ── 4. 目录扫描 ── */
  const root = join(base, "skills");
  mkdirSync(join(root, "alpha"), { recursive: true });
  writeFileSync(join(root, "alpha", "SKILL.md"), "---\nname: alpha-skill\ndescription: Alpha 描述\n---\nAlpha 正文");
  mkdirSync(join(root, "beta tool"), { recursive: true });
  writeFileSync(join(root, "beta tool", "skill.md"), "# Beta 工具\n正文");
  mkdirSync(join(root, "empty"), { recursive: true }); // 无 SKILL.md
  mkdirSync(join(root, ".hidden", "x"), { recursive: true }); // 隐藏目录
  writeFileSync(join(root, ".hidden", "x", "SKILL.md"), "不应被收录");
  mkdirSync(join(root, ".hiddendir"), { recursive: true });
  writeFileSync(join(root, ".hiddendir", "SKILL.md"), "不应被收录");
  const other = join(base, "other-skills");
  mkdirSync(join(other, "alpha"), { recursive: true }); // 与第一目录重名
  writeFileSync(join(other, "alpha", "SKILL.md"), "---\nname: alpha-skill\n---\n第二个 alpha，应被先到先得挡掉");
  mkdirSync(join(other, "gamma"), { recursive: true });
  writeFileSync(join(other, "gamma", "Skill.md"), "# Gamma");

  const catalog = await scanCatalog([root, other, join(base, "missing-dir")]);
  assert.deepEqual(catalog.skills.map((s) => s.name), ["alpha-skill", "beta-tool", "gamma"], "重名先到先得 + 排序；缺目录不影响其余");
  const alpha = catalog.skills[0];
  assert.equal(alpha.description, "Alpha 描述");
  assert.ok(alpha.file.toLowerCase().endsWith("skill.md") && alpha.dir.endsWith("alpha"));
  assert.equal(catalog.directories[0].ok, true, "有效目录 ok");
  assert.equal(catalog.directories[0].count, 2, "目录内收录计数");
  assert.equal(catalog.directories[1].count, 1, "被先到先得挡掉的技能不计入目录计数");
  assert.equal(catalog.directories[1].ok, true, "第二个有效目录 ok");
  assert.equal(catalog.directories[2].ok, false, "缺失目录 ok=false");
  assert.ok(catalog.directories[2].error, "缺失目录带错误信息");
  assert.ok(!catalog.skills.some((s) => s.name.includes("hidden")), "隐藏目录不收录");
  console.log("scan-smoke: ok");
} finally {
  rmSync(home, { recursive: true, force: true });
  rmSync(base, { recursive: true, force: true });
}
