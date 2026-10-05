/**
 * dsh-v-skill-links — 宿主端。
 *
 * 两个职责：
 *  1. HTTP API（/api/v-skill-links/*）：扫描配置目录，把「一级子目录含 SKILL.md」的
 *     目录作为映射技能列出来，供 Web 客户端 '/' 菜单的「映射技能」分组展示。
 *  2. agent/pre-step 注入：用户消息里出现空白边界的 /name 令牌且命中映射技能时，读取该
 *     技能目录下的 SKILL.md 全文，渲染成与原生技能同形的 <skill_content> 块，追加进本步
 *     （对模型而言就是「引用了该 skill.md」）。
 *  3. 设置命名空间 v-skill-links：目录列表进 设置→插件→插件配置 的可视化卡片；
 *     补丁层 config 是组合 base，用户设置文档（settings.yaml）覆盖它，变更热生效。
 *  4. 插件私有共享配置存储（change shared-config-store）：`<DSH_HOME>/v-skill-links.config.json`
 *     ——代际无关的 GUI 读写层，两代宿主（web CLI / 桌面端）共用同一文件；重载链 =
 *     补丁层 entry config ← 既有用户文档（只读兼容）← 共享存储节；`GET/PUT
 *     /api/v-skill-links/config` 提供同形快照与 CAS 写入；文件被监视，他端保存秒级生效。
 *     MUST NOT 写宿主自有文件（settings.yaml / 任何 profile 的 cordis.patch.yml）。
 *
 * 配置（$DSH_HOME/profiles/web/cordis.patch.yml）：
 *   - id: dsh-v-skill-links
 *     config:
 *       directories:
 *         - F:/xxx/skills
 *         - ~/more-skills
 *
 * 路径规则：绝对路径原样使用；`~` 展开为用户主目录；相对路径按 dsh 启动目录
 * （进程 cwd）解析。目录不存在/读不了不算致命，会在 /list 的 directories 里报告。
 *
 * 设计为自包含插件：不注册 ctx.skills 提供器（映射技能不进模型目录、不进原生
 * 「技能」分组），注入走自己的 agent/pre-step 监听器，与 dsh-time-context 同一模式。
 */

import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  watch as fsWatch,
  writeFileSync,
  writeSync,
} from "node:fs";
import { readFile, readdir, realpath } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve as pathResolve } from "node:path";

/** Cordis 插件名（loader 诊断用）。 */
export const name = "dsh-v-skill-links";

/** 依赖服务：webServer 注册 API 路由；agents 保证 pre-step 监听注册时序。 */
export const inject = ["webServer", "agents"];

const API_PREFIX = "/api/v-skill-links";
/** 目录扫描缓存 TTL：菜单每次按键都来问，3 秒内直接吃缓存。 */
const SCAN_TTL_MS = 3000;
/** 菜单描述上限（超出截断）。 */
const MAX_DESCRIPTION_CHARS = 200;
/** 单个技能注入正文上限（字符）；超出截断并提示读取原文件。 */
const MAX_BODY_CHARS = 200_000;

/* ══════════════════════════ 配置归一化 ══════════════════════════ */

/**
 * 把配置里的目录列表归一化为绝对路径数组。
 * @param {unknown} raw - 插件 config（支持 { directories: [...] } 或直接数组）。
 * @param {string} baseDir - 相对路径的解析基准（dsh 启动目录）。
 * @param {string} home - 用户主目录（~ 展开）。
 * @returns {string[]} 去重后的绝对路径。
 */
export function normalizeDirectories(raw, baseDir = process.cwd(), home = homedir()) {
  let list = [];
  if (Array.isArray(raw)) list = raw;
  else if (raw && typeof raw === "object" && Array.isArray(raw.directories)) list = raw.directories;
  const out = [];
  for (const item of list) {
    if (typeof item !== "string") continue;
    let p = item.trim();
    if (!p) continue;
    if (p === "~" || p.startsWith("~/") || p.startsWith("~\\")) p = join(home, p.slice(1));
    const abs = isAbsolute(p) ? pathResolve(p) : pathResolve(baseDir, p);
    if (!out.includes(abs)) out.push(abs);
  }
  return out;
}

/* ══════════════════════════ 自定义指令（followup 型） ══════════════════════════ */

/** 命令名规则（与宿主命令注册表同口径：小写开头 [a-z0-9_-]）。 */
const COMMAND_NAME = /^[a-z][a-z0-9_-]*$/;
/** 自定义指令条数上限。 */
const MAX_COMMANDS = 32;
/** 单条 Prompt 字符上限。 */
const MAX_PROMPT_CHARS = 20_000;

/**
 * 归一化自定义指令列表：name 转小写并校验、prompt 非空、按 name 去重（先到先得）。
 * @param {unknown} raw - { commands?: [...] } 或直接数组。
 * @returns {Array<{name: string, prompt: string}>}
 */
export function normalizeCommands(raw) {
  let list = [];
  if (Array.isArray(raw)) list = raw;
  else if (raw && typeof raw === "object" && Array.isArray(raw.commands)) list = raw.commands;
  const out = [];
  const seen = new Set();
  for (const item of list) {
    if (!item || typeof item !== "object") throw new TypeError("commands contains a non-object entry");
    if (typeof item.name !== "string") throw new TypeError("command name must be a string");
    if (typeof item.prompt !== "string") throw new TypeError(`command "${item.name}" prompt must be a string`);
    const name = item.name.trim().toLowerCase();
    if (!COMMAND_NAME.test(name)) throw new TypeError(`command name "${item.name}" must match ${String(COMMAND_NAME)}`);
    const prompt = item.prompt.trim();
    if (!prompt) throw new TypeError(`command "${name}" prompt must not be empty`);
    if (prompt.length > MAX_PROMPT_CHARS) throw new TypeError(`command "${name}" prompt exceeds ${MAX_PROMPT_CHARS} chars`);
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({ name, prompt });
    if (out.length > MAX_COMMANDS) throw new TypeError(`commands exceeds ${MAX_COMMANDS} entries`);
  }
  return out;
}

/** 取 Prompt 的第一行作为菜单描述（截断 120 字符）。 */
export function commandDescription(prompt) {
  for (const line of String(prompt ?? "").split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    return t.length > 120 ? t.slice(0, 119) + "…" : t;
  }
  return "";
}

/* ══════════════════════════ 快捷按钮（输入框下方网格的数据源） ══════════════════════════ */

/** 快捷按钮条数上限（与卡片提示一致）。 */
const MAX_BUTTONS = 32;

/**
 * 校验并归一化按钮上的可选模型绑定（design D1）：provider/model trim 后非空，
 * reasoningEffort 缺省或非空字符串；输出键序固定 provider → model → reasoningEffort，
 * 无 reasoningEffort 时 MUST NOT 输出该键（存储形状最小）。形状非法直接抛错
 * （注册与写入校验同走这条路径）。
 * @param {unknown} raw - 按钮条目上的 model 字段。
 * @param {string} name - 按钮显示名（错误信息用）。
 * @returns {{provider: string, model: string, reasoningEffort?: string}|undefined} undefined = 未绑定（跟随会话）。
 */
export function normalizeButtonModel(raw, name) {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new TypeError(`button "${name}" model must be an object`);
  const provider = typeof raw.provider === "string" ? raw.provider.trim() : "";
  const model = typeof raw.model === "string" ? raw.model.trim() : "";
  if (!provider) throw new TypeError(`button "${name}" model.provider must be a non-empty string`);
  if (!model) throw new TypeError(`button "${name}" model.model must be a non-empty string`);
  if (raw.reasoningEffort === undefined) return { provider, model };
  if (typeof raw.reasoningEffort !== "string") throw new TypeError(`button "${name}" model.reasoningEffort must be a string`);
  const reasoningEffort = raw.reasoningEffort.trim();
  if (!reasoningEffort) throw new TypeError(`button "${name}" model.reasoningEffort must not be empty`);
  return { provider, model, reasoningEffort };
}

/**
 * 归一化快捷按钮列表：name/prompt trim、完全空条目剔除、按 name 去重（先到先得）、
 * prompt 非空、autoSend 布尔归一（缺省 false，非布尔抛错）、可选 model 绑定透传
 * （校验形状，未提供时不输出该字段）。
 * 注意：按钮 name 是显示名（允许中文），不套用 commands 的小写正则。
 * @param {unknown} raw - { buttons?: [...] } 或直接数组。
 * @returns {Array<{name: string, prompt: string, autoSend: boolean, model?: {provider: string, model: string, reasoningEffort?: string}}>}
 */
export function normalizeButtons(raw) {
  let list = [];
  if (Array.isArray(raw)) list = raw;
  else if (raw && typeof raw === "object" && Array.isArray(raw.buttons)) list = raw.buttons;
  const out = [];
  const seen = new Set();
  for (const item of list) {
    if (!item || typeof item !== "object") throw new TypeError("buttons contains a non-object entry");
    if (typeof item.name !== "string") throw new TypeError("button name must be a string");
    if (typeof item.prompt !== "string") throw new TypeError(`button "${item.name}" prompt must be a string`);
    const name = item.name.trim();
    const prompt = item.prompt.trim();
    if (!name && !prompt) continue; // 完全空条目剔除（半空条目仍校验）
    if (!name) throw new TypeError("button name must not be empty");
    if (!prompt) throw new TypeError(`button "${name}" prompt must not be empty`);
    if (prompt.length > MAX_PROMPT_CHARS) throw new TypeError(`button "${name}" prompt exceeds ${MAX_PROMPT_CHARS} chars`);
    if (item.autoSend !== undefined && item.autoSend !== null && typeof item.autoSend !== "boolean") {
      throw new TypeError(`button "${name}" autoSend must be a boolean`);
    }
    const model = normalizeButtonModel(item.model, name);
    if (seen.has(name)) continue;
    seen.add(name);
    const entry = { name, prompt, autoSend: item.autoSend === true };
    if (model !== undefined) entry.model = model;
    out.push(entry);
    if (out.length > MAX_BUTTONS) throw new TypeError(`buttons exceeds ${MAX_BUTTONS} entries`);
  }
  return out;
}

/* ══════════════════════════ 设置命名空间 schema（免依赖手写，兼容 schemastery 形状） ══════════════════════════ */

/**
 * 「映射技能」设置节的 schema。dsh-settings 的 resolve 只把 schema 当函数调用
 * （schema(mergeLayers(base, section))），describe 用 toJSON()，redactSecrets
 * walker 读 type/dict/inner/meta —— 本对象按这三件事的最小契约实现，
 * 避免为插件引入 schemastery 依赖。
 *
 * 调用语义：收合并后的节对象，归一化 directories（trim / ~ 展开 / 相对启动目录 /
 * 去重）、commands（名称校验 / 去重）与 buttons（显示名非空 / 去重 / autoSend 布尔 /
 * 可选 model 绑定透传），类型不对直接抛错（注册与写入校验都走这条路径）。
 * 契约不变（本次变更）：dict.buttons.inner 仍为 object（条目内部形状由归一化保证），
 * toJSON 同形，redactSecrets walker 不受影响。
 * @returns {(value: unknown) => { directories: string[], commands: Array<{name,prompt}>, buttons: Array<{name,prompt,autoSend,model?}> }} schema 函数。
 */
export function settingsSchema() {
  const schema = (value) => {
    const source = value !== null && typeof value === "object" ? value : {};
    const rawDirs = source.directories;
    if (rawDirs !== undefined && !Array.isArray(rawDirs)) throw new TypeError("directories must be an array of strings");
    if (rawDirs !== undefined) {
      for (const item of rawDirs) {
        if (typeof item !== "string") throw new TypeError(`directories contains a non-string entry: ${String(item)}`);
      }
    }
    const rawCommands = source.commands;
    if (rawCommands !== undefined && !Array.isArray(rawCommands)) throw new TypeError("commands must be an array");
    const rawButtons = source.buttons;
    if (rawButtons !== undefined && !Array.isArray(rawButtons)) throw new TypeError("buttons must be an array");
    return { directories: normalizeDirectories(rawDirs), commands: normalizeCommands(rawCommands), buttons: normalizeButtons(rawButtons) };
  };
  /** redactSecrets walker 读取的容器形状（无 secret 字段，值原样通过）。 */
  schema.type = "object";
  schema.dict = {
    directories: { type: "array", inner: { type: "string" } },
    commands: { type: "array", inner: { type: "object" } },
    buttons: { type: "array", inner: { type: "object" } },
  };
  /** describe 线上信封（客户端卡片用 decode 直读，形状仅作描述）。 */
  schema.toJSON = () => ({
    type: "object",
    dict: {
      directories: { type: "array", inner: { type: "string" } },
      commands: { type: "array", inner: { type: "object" } },
      buttons: { type: "array", inner: { type: "object" } },
    },
  });
  return schema;
}

/** 设置命名空间（dsh-settings 要求小写 kebab-case）。 */
const SETTINGS_NS = "v-skill-links";

/* ══════════════════════════ SKILL.md 解析 ══════════════════════════ */

/** 名字清理：空白与 / 换成 -，去掉首尾的 - 和 .，保证能作为空白边界的 /令牌 使用。 */
function sanitizeToken(name) {
  return String(name).replace(/\s+/g, "-").replace(/\//g, "-").replace(/^[-.]+|[-.]+$/g, "");
}

/**
 * 解析 SKILL.md：剥掉 YAML frontmatter（只认 `key: value` 简单行）。
 * @param {string} raw - 文件原文（UTF-8）。
 * @returns {{ data: Record<string,string>, body: string }}
 */
export function parseSkillMarkdown(raw) {
  const text = String(raw).replace(/^\uFEFF/, "");
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m) return { data: {}, body: text };
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line.trim());
    if (!kv) continue;
    let v = kv[2].trim();
    if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) v = v.slice(1, -1);
    data[kv[1].toLowerCase()] = v;
  }
  return { data, body: text.slice(m[0].length).replace(/^\s*\n/, "") };
}

/** 从正文取描述：第一个非空行（跳过 HTML 注释与表格分隔行），markdown 标题去掉 # 号。 */
function deriveBodyDescription(body) {
  for (const line of String(body).split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("<!--") || /^\|[\s:|-]*\|?$/.test(t)) continue;
    const heading = /^#{1,6}\s+(.*)$/.exec(t);
    return heading ? heading[1].trim() : t;
  }
  return "";
}

/**
 * 从目录名 + frontmatter + 正文推出技能的展示名与描述。
 * @returns {{ name: string, description: string }}
 */
export function deriveSummary(dirName, data, body) {
  const fmName = typeof data.name === "string" ? data.name.trim() : "";
  let name = fmName && !/\s/.test(fmName) ? fmName : sanitizeToken(dirName);
  if (!name) name = dirName;
  let description = typeof data.description === "string" ? data.description.trim() : "";
  if (!description) description = deriveBodyDescription(body);
  if (description.length > MAX_DESCRIPTION_CHARS) description = description.slice(0, MAX_DESCRIPTION_CHARS - 1) + "…";
  return { name, description };
}

/* ══════════════════════════ 目录扫描 ══════════════════════════ */

/** 在一个技能目录里找 SKILL.md（大小写不敏感，兼容 Skill.md / skill.md）。 */
async function findSkillFile(dir) {
  let entries;
  try {
    entries = await readdir(dir);
  } catch {
    return null;
  }
  const hit = entries.find((n) => /^skill\.md$/i.test(n));
  return hit ? join(dir, hit) : null;
}

/**
 * 扫描一个配置目录的一级子目录。
 * @param {string} dir - 配置的绝对路径。
 * @returns {{ path: string, ok: boolean, error: string|null, hits: Array<{dirName:string, dir:string, file:string}> }}
 */
export async function scanOneDirectory(dir) {
  const result = { path: dir, ok: false, error: null, hits: [] };
  try {
    const real = await realpath(dir);
    const dirents = await readdir(real, { withFileTypes: true });
    for (const d of dirents) {
      if (!d.isDirectory() || d.name.startsWith(".")) continue;
      const sub = join(real, d.name);
      const file = await findSkillFile(sub);
      if (file) result.hits.push({ dirName: d.name, dir: sub, file });
    }
    result.ok = true;
  } catch (error) {
    result.error = String(error?.message || error);
  }
  return result;
}

/**
 * 扫描全部配置目录，产出完整映射技能目录。
 * 重名技能按配置顺序先到先得；隐藏目录（.开头）跳过。
 * @param {string[]} dirs - 归一化后的绝对路径列表。
 * @returns {Promise<{skills: Array<{name,description,dir,file,root}>, directories: Array<{path,ok,error,count}>}>}
 */
export async function scanCatalog(dirs) {
  const skills = [];
  const directories = [];
  const seen = new Set();
  for (const dir of dirs) {
    const one = await scanOneDirectory(dir);
    const bucket = { path: dir, ok: one.ok, error: one.error, count: 0 };
    directories.push(bucket);
    if (!one.ok) continue;
    for (const hit of one.hits) {
      let raw;
      try {
        raw = await readFile(hit.file, "utf8");
      } catch {
        continue;
      }
      const { data, body } = parseSkillMarkdown(raw);
      const summary = deriveSummary(hit.dirName, data, body);
      if (seen.has(summary.name)) continue;
      seen.add(summary.name);
      skills.push({ name: summary.name, description: summary.description, dir: hit.dir, file: hit.file, root: basename(dir) });
      bucket.count += 1;
    }
  }
  skills.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  return { skills, directories };
}

/* ══════════════════════════ 令牌匹配与注入渲染 ══════════════════════════ */

/**
 * 从一段文本收集空白边界的 /令牌（与原生技能手势边界同一口径：只认空白分隔）。
 * @param {string} text
 * @returns {string[]} 去掉前导 / 的令牌（可能重复）。
 */
export function collectSkillTokens(text) {
  const out = [];
  for (const token of String(text ?? "").split(/\s+/)) {
    if (token.length > 1 && token.startsWith("/")) out.push(token.slice(1));
  }
  return out;
}

/**
 * 在本步将进入的用户消息里找出命中的映射技能名。
 * 只扫直接用户输入（source.kind === 'user'），插件注入/steering 不参与。
 * @param {Array<{role:string, content:Array, source:{kind:string}}>} messages
 * @param {Map<string, object>} skillsByName - 技能名 -> 技能条目。
 * @returns {string[]} 去重后的命中名（按出现顺序）。
 */
export function collectMatchedNames(messages, skillsByName) {
  const wanted = [];
  for (const message of messages ?? []) {
    if (message?.source?.kind !== "user") continue;
    for (const block of message.content ?? []) {
      if (block?.type !== "text" || typeof block.text !== "string") continue;
      for (const token of collectSkillTokens(block.text)) {
        if (skillsByName.has(token) && !wanted.includes(token)) wanted.push(token);
      }
    }
  }
  return wanted;
}

function escapeAttr(v) {
  return String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function capBody(body, file) {
  if (body.length <= MAX_BODY_CHARS) return body;
  return body.slice(0, MAX_BODY_CHARS) + `\n…（内容过长已截断，完整内容请读取 ${file}）`;
}

/**
 * 把一个映射技能渲染成与原生技能同形的 <skill_content> 块（含资源基目录提示）。
 * @param {{name:string, dir:string, file:string}} skill
 * @param {string} body - 剥掉 frontmatter 后的正文。
 */
export function renderSkillContent(skill, body) {
  return [
    `<skill_content name="${escapeAttr(skill.name)}" source="${escapeAttr(skill.file)}">`,
    "<skill_resources>",
    `Base directory for this skill: ${escapeAttr(skill.dir)}`,
    "Resolve relative paths mentioned by this skill against the base directory before using them. Load referenced resources only as needed.",
    "</skill_resources>",
    "",
    "<skill_instructions>",
    capBody(body, skill.file),
    "</skill_instructions>",
    "</skill_content>",
  ].join("\n");
}

/* ══════════════════════════ 消息构造（与 dsh-time-context 同一模式） ══════════════════════════ */

function deepFreeze(value) {
  if (value === null || typeof value !== "object") return value;
  for (const key of Object.keys(value)) deepFreeze(value[key]);
  Object.freeze(value);
  return value;
}

function createUserMessage(content) {
  return deepFreeze(
    structuredClone({
      id: randomUUID(),
      role: "user",
      content,
      source: { kind: "plugin", plugin: name, form: "instructions" },
    }),
  );
}

/* ══════════════════════════ 插件私有共享配置存储（change shared-config-store） ══════════════════════════
 *
 * 两代宿主（web CLI 0.1.5 / 桌面端 0.2.0）共用 `$DSH_HOME`，但设置存储代际绑定：0.1.5 写用户文档
 * `~/.dsh/settings.yaml`（桌面端启动会把它当旧版遗留文件吞掉），0.2.0 的 `configForms` 只服务带
 * `.volatile()` 的条目 ⇒ 桌面端设置页恒只读。故本插件自营一份**代际无关的插件私有文件**
 * `<DSH_HOME>/v-skill-links.config.json`：任何宿主的 import 逻辑都不认识它，两端跑同一份 lib/
 * 即读写同一文件，一边保存另一边秒级可见。MUST NOT 写任何宿主自有文件（settings.yaml / 补丁层）。
 *
 * 文件形状：`{ revision: <从 1 起单调递增>, directories?, commands?, buttons?, migratedFrom? }`；
 * 节**缺席** = 未自定义（回落组合层 base），节**存在**（含空数组）= 显式覆盖。
 *
 * 写路径 = 跨进程锁内 CAS + 复制式备份轮转 + 临时文件原子替换；读路径 = 正式文件 → .bak.1/2/3
 * 依次恢复 → 按「存储缺席」回落组合层。全部参数经 task 1.2 的 Windows 实测定案
 * （openspec/changes/shared-config-store/explorer.md §7）。
 */

/** 共享存储文件名（`<DSH_HOME>/` 之下）。 */
export const CONFIG_STORE_BASENAME = "v-skill-links.config.json";
/** 共享存储的节名（顺序即快照字段顺序）。 */
export const CONFIG_STORE_SECTIONS = ["directories", "commands", "buttons"];
/** 保留的备份份数（.bak.1 = 上一次写入前内容）。 */
const STORE_BACKUP_COUNT = 3;
/** 锁文件判陈旧阈值：超过即接管重建（进程中途被杀的残留锁自愈）。 */
const STORE_LOCK_STALE_MS = 5_000;
/** 锁等待上限与步进：超时以 503 busy 拒绝，存储保持不变。 */
const STORE_LOCK_WAIT_MS = 1_000;
const STORE_LOCK_STEP_MS = 10;
/** rename 覆盖的退避表（task 1.2：另一进程持读句柄时 EPERM 可持续数百毫秒）。 */
const STORE_RENAME_BACKOFF_MS = [20, 40, 80, 120, 150];
/** 单文件监视去抖（Windows 上一次 rename 会连发 2-3 个事件）。 */
const STORE_WATCH_DEBOUNCE_MS = 100;
/** watch 不可用时的轮询间隔（mtime+size 变化即视为变更）。 */
const STORE_WATCH_POLL_MS = 2_000;

/**
 * 解析宿主 home（与宿主 `@deepseek-ai/dsh-home-paths` 的 `resolveDshHome` 同优先级语义）：
 * `env.DSH_HOME` 去空白后非空 → 用之（`~` 前缀按 homedir 展开、再归一为绝对路径），否则 `~/.dsh`。
 * 两端（web / 桌面）读同一环境变量、同一主目录 ⇒ 必然同址（explorer §7.1）。
 * @param {Record<string, string|undefined>} [env]
 * @param {string} [home]
 * @returns {string} 绝对路径。
 */
export function resolveDshHome(env = process.env, home = homedir()) {
  const raw = typeof env?.DSH_HOME === "string" ? env.DSH_HOME.trim() : "";
  if (!raw) return pathResolve(join(home, ".dsh"));
  if (raw === "~") return pathResolve(home);
  if (raw.startsWith("~/") || raw.startsWith("~\\")) return pathResolve(join(home, raw.slice(2)));
  return pathResolve(raw);
}

/**
 * 共享存储的绝对路径（`<DSH_HOME>/v-skill-links.config.json`）。
 * @param {{env?: Record<string, string|undefined>, home?: string}} [options]
 * @returns {string}
 */
export function resolveConfigStorePath(options = {}) {
  const home = resolveDshHome(options.env ?? process.env, options.home ?? homedir());
  return join(home, CONFIG_STORE_BASENAME);
}

/** 共享存储语义错误：code ∈ conflict（409）/ invalid（400）/ busy（503）/ io（500）。 */
export class ConfigStoreError extends Error {
  /**
   * @param {"conflict"|"invalid"|"busy"|"io"} code
   * @param {string} message
   * @param {{revision?: number}} [extra] - conflict 时携带服务端当前 revision。
   */
  constructor(code, message, extra = {}) {
    super(message);
    this.name = "ConfigStoreError";
    this.code = code;
    if (typeof extra.revision === "number") this.revision = extra.revision;
  }
}

/** 节归一化器表（与设置 schema 同口径：目录就地绝对化 / 指令小写去重 / 按钮形状校验）。 */
const SECTION_NORMALIZERS = {
  directories: (raw, ctx) => normalizeDirectories(raw, ctx.baseDir, ctx.home),
  commands: (raw) => normalizeCommands(raw),
  buttons: (raw) => normalizeButtons(raw),
};

/** 归一化失败的兜底（组合层来源非法时不让插件激活失败）。 */
function safeNormalize(fn, fallback) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/**
 * 把一节任意来源的输入归一化为**完整组合层视图**（三节齐备）。
 * 缺节 → 空数组；节级非法 → 该节按空处理（schema/写入校验另有拦截）。
 * @param {unknown} raw - 补丁层 entry config 或 settingsScope 解析值。
 * @param {{baseDir?: string, home?: string}} [options]
 * @returns {{directories: string[], commands: Array<object>, buttons: Array<object>}}
 */
export function normalizeView(raw, options = {}) {
  const ctx = { baseDir: options.baseDir ?? process.cwd(), home: options.home ?? homedir() };
  const source = raw !== null && typeof raw === "object" ? raw : {};
  return {
    directories: safeNormalize(() => SECTION_NORMALIZERS.directories(source.directories, ctx), []),
    commands: safeNormalize(() => SECTION_NORMALIZERS.commands(source.commands), []),
    buttons: safeNormalize(() => SECTION_NORMALIZERS.buttons(source.buttons), []),
  };
}

/**
 * 生效值 = 组合层 base ← 存储节逐节覆盖（节缺席回落 base）。
 * @param {{directories: string[], commands: Array<object>, buttons: Array<object>}} base - 已归一化视图。
 * @param {object|null} sections - 存储节（storeSectionsOf 的输出）。
 * @returns {{directories: string[], commands: Array<object>, buttons: Array<object>}}
 */
export function mergeView(base, sections) {
  const out = { ...base };
  if (sections !== null && typeof sections === "object") {
    for (const key of CONFIG_STORE_SECTIONS) {
      if (Array.isArray(sections[key])) out[key] = sections[key];
    }
  }
  return out;
}

/**
 * 提取存储文件里的「用户层节」：无任何节 → null（快照 `user: null`，UI 不显示覆盖标记）。
 * @param {object|null} doc
 * @returns {object|null}
 */
export function storeSectionsOf(doc) {
  if (doc === null || typeof doc !== "object") return null;
  const out = {};
  let any = false;
  for (const key of CONFIG_STORE_SECTIONS) {
    if (Array.isArray(doc[key])) {
      out[key] = doc[key];
      any = true;
    }
  }
  return any ? out : null;
}

/**
 * 装载期校验：结构非法（非对象 / revision 非正整数）→ null（按损坏处理，走恢复链）；
 * 节级非法 → 丢弃该节（回落 base，不整体判损）。
 * @param {unknown} raw
 * @param {{baseDir?: string, home?: string}} [options]
 * @returns {{revision: number, directories?: Array, commands?: Array, buttons?: Array, migratedFrom?: string}|null}
 */
export function sanitizeStoreDocument(raw, options = {}) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const revision = Number.isInteger(raw.revision) && raw.revision > 0 ? raw.revision : null;
  if (revision === null) return null;
  const ctx = { baseDir: options.baseDir ?? process.cwd(), home: options.home ?? homedir() };
  const doc = { revision };
  for (const key of CONFIG_STORE_SECTIONS) {
    if (raw[key] === undefined) continue;
    try {
      doc[key] = SECTION_NORMALIZERS[key](raw[key], ctx);
    } catch {
      /* 节级非法：丢弃该节（该节回落组合层），不把整份文件判损 */
    }
  }
  if (typeof raw.migratedFrom === "string" && raw.migratedFrom) doc.migratedFrom = raw.migratedFrom;
  return doc;
}

/**
 * 宿主是否已提供服务：cordis 里读取未声明的服务键会抛错，据此把「不可解析」与「已提供」分开。
 * @param {Context} ctx
 * @param {string} name
 * @returns {boolean}
 */
function hasService(ctx, name) {
  try {
    return ctx?.get?.(name) !== undefined && ctx?.get?.(name) !== null;
  } catch {
    return false;
  }
}

/** 告警一次性闩：同一 key 只告警一次（装载恢复 / 播种失败等），成功路径可清除。 */function createWarnOnce(logger) {
  const seen = new Set();
  return {
    warn(key, message) {
      if (seen.has(key)) return;
      seen.add(key);
      logger?.warn?.(message);
    },
    clear(key) {
      seen.delete(key);
    },
  };
}

/**
 * 共享配置存储（宿主半区）。
 *
 * 全部外部依赖（fs / 时钟 / 睡眠 / 日志）可注入，冒烟测试用临时目录 + 假时钟直测锁语义、
 * CAS、复制式轮转与独占播种（test/shared-store-smoke.mjs）。
 * @param {object} [options]
 * @param {string} [options.filePath] - 存储文件绝对路径（缺省 `<DSH_HOME>/v-skill-links.config.json`）。
 * @param {string} [options.baseDir] - 目录节相对路径的解析基准（保存端 cwd，落盘即绝对化）。
 * @param {string} [options.home] - `~` 展开基准。
 * @param {() => number} [options.now] - 时钟（测试注入）。
 * @param {(ms: number) => Promise<void>} [options.sleep] - 等待原语（测试注入）。
 * @param {number} [options.lockWaitMs] / [options.lockStepMs] / [options.lockStaleMs]
 * @param {number[]} [options.renameBackoffMs]
 * @param {number} [options.backupCount]
 * @param {number} [options.watchDebounceMs] / [options.watchPollMs]
 * @param {{warn?: Function}} [options.logger]
 * @param {(info: {filePath: string, tmpPath: string, doc: object}) => void} [options.onBeforeReplace] - 测试钩子。
 * @returns {object} 存储面（load / snapshot / writeSections / seed / upgrade / ensureSeeded / watch ...）。
 */
export function createConfigStore(options = {}) {
  const filePath = options.filePath ?? resolveConfigStorePath();
  const baseDir = options.baseDir ?? process.cwd();
  const home = options.home ?? homedir();
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  const sleep = typeof options.sleep === "function" ? options.sleep : (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const lockWaitMs = Number.isFinite(options.lockWaitMs) ? options.lockWaitMs : STORE_LOCK_WAIT_MS;
  const lockStepMs = Number.isFinite(options.lockStepMs) ? options.lockStepMs : STORE_LOCK_STEP_MS;
  const lockStaleMs = Number.isFinite(options.lockStaleMs) ? options.lockStaleMs : STORE_LOCK_STALE_MS;
  const renameBackoffMs = Array.isArray(options.renameBackoffMs) && options.renameBackoffMs.length > 0
    ? [...options.renameBackoffMs] : [...STORE_RENAME_BACKOFF_MS];
  const backupCount = Number.isInteger(options.backupCount) && options.backupCount > 0 ? options.backupCount : STORE_BACKUP_COUNT;
  const watchDebounceMs = Number.isFinite(options.watchDebounceMs) ? options.watchDebounceMs : STORE_WATCH_DEBOUNCE_MS;
  const watchPollMs = Number.isFinite(options.watchPollMs) ? options.watchPollMs : STORE_WATCH_POLL_MS;
  const warnOnce = createWarnOnce(options.logger ?? null);
  /** 测试钩子：原子替换前一刻调用（断言「正式文件不存在缺席窗口」）。 */
  const onBeforeReplace = typeof options.onBeforeReplace === "function" ? options.onBeforeReplace : null;

  const lockPath = `${filePath}.lock`;
  const tmpPath = `${filePath}.tmp`;
  /** 当前装载到的文档（null = 存储缺席：播种前 / 全损回落）。 */
  let state = null;

  const backupPath = (index) => `${filePath}.bak.${index}`;

  /**
   * 读一个候选文件。正式文件被 rename 原子替换后不该出现缺席窗口（task 1.2 实测 118k 次并发读
   * 0 次 ENOENT），此处仍按 spec 对瞬时 ENOENT 重试一次作兜底。
   * @returns {string|null} 文本；不存在或不可读 → null。
   */
  function readStoreText(path) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return readFileSync(path, "utf8");
      } catch (error) {
        if (error?.code !== "ENOENT" || attempt === 1) return null;
      }
    }
    return null;
  }

  /**
   * 装载：正式文件 → .bak.1/2/3 依次恢复；全败按「存储缺席」处理（恰告警一次）。
   * @returns {object|null} 归一化文档。
   */
  function loadDocument() {
    let damaged = false;
    const candidates = [filePath];
    for (let index = 1; index <= backupCount; index += 1) candidates.push(backupPath(index));
    for (let index = 0; index < candidates.length; index += 1) {
      const text = readStoreText(candidates[index]);
      if (text === null) continue;
      let parsed = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
      const doc = parsed === null ? null : sanitizeStoreDocument(parsed, { baseDir, home });
      if (doc === null) {
        damaged = true;
        continue;
      }
      if (index > 0) {
        warnOnce.warn("recovered", `v-skill-links: config store recovered from ${basename(candidates[index])} (primary file unusable)`);
      } else {
        warnOnce.clear("recovered");
      }
      return doc;
    }
    if (damaged) {
      warnOnce.warn("degraded", "v-skill-links: config store unusable (file and backups); falling back to layer config");
    }
    return null;
  }

  /** 重新从磁盘装载（watch 触发 / 路由读取前调用）。 */
  function refresh() {
    state = loadDocument();
    return state;
  }

  const currentRevision = () => (state !== null && Number.isInteger(state.revision) ? state.revision : 0);
  const currentSections = () => storeSectionsOf(state);

  /**
   * 同形就绪快照（与 seam 作用域一致）：`base` 组合层、`user` 存储节、`value` 生效值。
   * 存储缺席按 `revision: 0` 的空存储呈现（`user: null`、`value: base`）。
   * @param {unknown} baseView - 组合层视图（entry config ← 既有用户文档）。
   * @returns {{status: string, revision: number, value: object, base: object, user: object|null, writable: boolean}}
   */
  function snapshot(baseView) {
    const base = normalizeView(baseView, { baseDir, home });
    const user = currentSections();
    return { status: "ready", revision: currentRevision(), value: mergeView(base, user), base, user, writable: true };
  }

  /** 备份轮转（**复制**式：正式文件自存在起直到被原子替换不存在缺席窗口）。 */
  function rotateBackups() {
    if (!existsSync(filePath)) return;
    for (let index = backupCount - 1; index >= 1; index -= 1) {
      const from = backupPath(index);
      if (existsSync(from)) copyFileSync(from, backupPath(index + 1));
      else {
        try {
          unlinkSync(backupPath(index + 1));
        } catch {
          /* .bak 不存在即无事可做 */
        }
      }
    }
    copyFileSync(filePath, backupPath(1));
  }

  /**
   * rename 覆盖的原子替换，Windows 上有界重试（另一进程持读句柄时 EPERM）。
   * @throws {ConfigStoreError} io（重试耗尽；正式文件保持原状）。
   */
  async function renameWithRetry(from, to) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        renameSync(from, to);
        return;
      } catch (error) {
        const retryable = error?.code === "EPERM" || error?.code === "EACCES" || error?.code === "EBUSY";
        if (!retryable || attempt >= renameBackoffMs.length) {
          try {
            unlinkSync(from);
          } catch {
            /* 临时文件清理失败不掩盖原始错误 */
          }
          throw new ConfigStoreError("io", `atomic replace failed: ${String(error?.code ?? error)}`);
        }
        await sleep(renameBackoffMs[attempt]);
      }
    }
  }

  /** 临时文件 + rename 原子写（调用方须持锁）。 */
  async function writeDocumentAtomic(doc) {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(tmpPath, `${JSON.stringify(doc, null, 2)}\n`);
    onBeforeReplace?.({ filePath, tmpPath, doc });
    await renameWithRetry(tmpPath, filePath);
  }

  /** 锁文件是否陈旧（时间戳超阈值；内容不可读则退回 mtime 判定）。 */
  function lockIsStale() {
    try {
      const stamp = JSON.parse(readFileSync(lockPath, "utf8"))?.at;
      if (typeof stamp === "number" && Number.isFinite(stamp)) return now() - stamp > lockStaleMs;
    } catch {
      /* 坏 JSON / 读不到：退回 mtime */
    }
    try {
      return now() - statSync(lockPath).mtimeMs > lockStaleMs;
    } catch {
      return false;
    }
  }

  /**
   * 跨进程写临界区：锁文件 `O_EXCL` 独占创建（内容 pid + 时间戳）→ 执行 fn → 释放。
   * 陈旧锁接管重建；有界等待，超时 `busy`。
   * @param {() => Promise<any>} fn
   * @throws {ConfigStoreError} busy | io
   */
  async function withLock(fn) {
    mkdirSync(dirname(filePath), { recursive: true });
    const deadline = now() + lockWaitMs;
    for (;;) {
      let fd = null;
      try {
        fd = openSync(lockPath, "wx");
      } catch (error) {
        if (error?.code !== "EEXIST") throw new ConfigStoreError("io", `lock create failed: ${String(error?.code ?? error)}`);
        if (lockIsStale()) {
          try {
            unlinkSync(lockPath);
          } catch {
            /* 他人先一步接管：下一轮重试 */
          }
          continue;
        }
        if (now() >= deadline) throw new ConfigStoreError("busy", "config store is locked by another writer");
        await sleep(lockStepMs);
        continue;
      }
      try {
        try {
          writeSync(fd, JSON.stringify({ pid: process.pid, at: now() }));
        } catch {
          /* 锁内容仅用于陈旧判定，写失败仍以 mtime 兜底 */
        }
        return await fn();
      } finally {
        try {
          closeSync(fd);
        } catch {
          /* 已关闭 */
        }
        try {
          unlinkSync(lockPath);
        } catch {
          /* 已被接管删除 */
        }
      }
    }
  }

  /**
   * 幂等播种（**独占创建**，抗双宿主并发）：存储不存在 → 以本机组合层视图写 `revision: 1`。
   * 视图为空的节不写入（空视图 ⇒ 无节存储，待有配置的一端一次性升级）。
   * @param {unknown} baseView
   * @param {{source?: string}} [seedOptions] - source 落进 `migratedFrom`。
   * @returns {{seeded: boolean, reason: "created"|"exists"|"error"}}
   */
  function seed(baseView, seedOptions = {}) {
    const source = typeof seedOptions.source === "string" && seedOptions.source ? seedOptions.source : "entry-config";
    const view = normalizeView(baseView, { baseDir, home });
    const doc = { revision: 1 };
    for (const key of CONFIG_STORE_SECTIONS) {
      if (Array.isArray(view[key]) && view[key].length > 0) doc[key] = view[key];
    }
    doc.migratedFrom = source;
    try {
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, `${JSON.stringify(doc, null, 2)}\n`, { flag: "wx" });
    } catch (error) {
      if (error?.code === "EEXIST") {
        /* 双宿主并发播种：败者重读文件，按「存在」规则走（升级 / 不动） */
        state = loadDocument();
        return { seeded: false, reason: "exists" };
      }
      warnOnce.warn("seed-failed", `v-skill-links: config store seed failed: ${String(error?.message || error)}`);
      return { seeded: false, reason: "error" };
    }
    state = doc;
    warnOnce.clear("seed-failed");
    return { seeded: true, reason: "created" };
  }

  /**
   * 一次性覆盖升级（走同一写临界区）：用本机组合层视图覆盖空存储，`revision` 保持 1。
   * @param {unknown} baseView
   * @param {{source?: string}} [upgradeOptions]
   * @returns {Promise<{upgraded: boolean, reason: string}>}
   */
  async function upgrade(baseView, upgradeOptions = {}) {
    const view = normalizeView(baseView, { baseDir, home });
    const sections = {};
    for (const key of CONFIG_STORE_SECTIONS) {
      if (Array.isArray(view[key]) && view[key].length > 0) sections[key] = view[key];
    }
    if (Object.keys(sections).length === 0) return { upgraded: false, reason: "empty-view" };
    return withLock(async () => {
      const current = loadDocument();
      const doc = { revision: 1, ...sections };
      const migrated = current?.migratedFrom ?? upgradeOptions.source;
      if (typeof migrated === "string" && migrated) doc.migratedFrom = migrated;
      rotateBackups();
      await writeDocumentAtomic(doc);
      state = doc;
      return { upgraded: true, reason: "upgraded" };
    });
  }

  /**
   * 播种 + 一次性升级（宿主激活时的幂等收口）：
   *  - 存储不存在 → 播种（独占创建）；
   *  - 存在但**不含任何节**且本机视图非空 → 覆盖升级（revision 保持 1）；
   *  - 含任意节 → 不动（除非调用方声明本进程抢播的临时视图 `forceUpgrade`）。
   * @param {unknown} baseView
   * @param {{source?: string, forceUpgrade?: boolean}} [seedOptions]
   * @returns {Promise<{action: "seeded"|"upgraded"|"kept"|"error"}>}
   */
  async function ensureSeeded(baseView, seedOptions = {}) {
    const outcome = seed(baseView, seedOptions);
    if (outcome.seeded) return { action: "seeded" };
    if (outcome.reason === "error") return { action: "error" };
    state = loadDocument();
    const forced = seedOptions.forceUpgrade === true;
    if (currentSections() !== null && !forced) return { action: "kept" };
    const view = normalizeView(baseView, { baseDir, home });
    const nonEmpty = CONFIG_STORE_SECTIONS.some((key) => Array.isArray(view[key]) && view[key].length > 0);
    if (!nonEmpty) return { action: "kept" };
    const result = await upgrade(baseView, seedOptions);
    return { action: result.upgraded ? "upgraded" : "kept" };
  }

  /**
   * CAS 写入：校验（复用 normalize* 语义，落盘 normalize 输出）→ 锁内 CAS 判定 →
   * 复制式备份轮转 → 原子替换。
   * @param {{baseRevision: number, sections: Record<string, Array|null>}} request - `null` = unset 该节。
   * @returns {Promise<{revision: number}>}
   * @throws {ConfigStoreError} invalid | conflict | busy | io
   */
  async function writeSections(request) {
    const body = request !== null && typeof request === "object" && !Array.isArray(request) ? request : {};
    if (!Number.isInteger(body.baseRevision) || body.baseRevision < 0) {
      throw new ConfigStoreError("invalid", "baseRevision must be a non-negative integer");
    }
    const patch = body.sections;
    if (patch === null || typeof patch !== "object" || Array.isArray(patch)) {
      throw new ConfigStoreError("invalid", "sections must be an object");
    }
    const keys = Object.keys(patch);
    if (keys.length === 0) throw new ConfigStoreError("invalid", "sections must contain at least one section");
    const normalized = {};
    for (const key of keys) {
      if (!CONFIG_STORE_SECTIONS.includes(key)) throw new ConfigStoreError("invalid", `unknown section: ${key}`);
      const value = patch[key];
      if (value === null) {
        normalized[key] = null;
        continue;
      }
      if (!Array.isArray(value)) throw new ConfigStoreError("invalid", `section ${key} must be an array or null`);
      try {
        normalized[key] = SECTION_NORMALIZERS[key](value, { baseDir, home });
      } catch (error) {
        throw new ConfigStoreError("invalid", `section ${key}: ${String(error?.message || error)}`);
      }
    }
    return withLock(async () => {
      const current = loadDocument();
      const revision = current !== null && Number.isInteger(current.revision) ? current.revision : 0;
      if (body.baseRevision !== revision) {
        throw new ConfigStoreError("conflict", `revision mismatch (current ${revision})`, { revision });
      }
      const doc = { revision: revision + 1 };
      for (const key of CONFIG_STORE_SECTIONS) {
        if (current !== null && Array.isArray(current[key])) doc[key] = current[key];
      }
      for (const key of keys) {
        if (normalized[key] === null) delete doc[key];
        else doc[key] = normalized[key];
      }
      if (typeof current?.migratedFrom === "string" && current.migratedFrom) doc.migratedFrom = current.migratedFrom;
      rotateBackups();
      await writeDocumentAtomic(doc);
      state = doc;
      return { revision: doc.revision };
    });
  }

  /**
   * 热重载监视：`fs.watch` + 去抖 → 失败/不可用回退 mtime+size 轮询。
   * 存储文件尚不存在时（首次播种前）改监视其父目录并按文件名过滤——Windows 上单文件监视本就是
   * 「父目录监视 + 文件名过滤」语义（explorer §7.2），这样播种后立刻回到事件快路径，不必等轮询。
   * 监视句柄与轮询定时器都 unref，绝不把宿主进程钉在事件循环上。
   * @param {() => void} onChange - 去抖后的变更回调。
   * @returns {() => void} 停止函数。
   */
  function watchStore(onChange) {
    let stopped = false;
    let debounceTimer = null;
    let pollTimer = null;
    let watcher = null;
    const fire = () => {
      if (stopped) return;
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        if (!stopped) onChange();
      }, watchDebounceMs);
      debounceTimer.unref?.();
    };
    const stamp = () => {
      try {
        const info = statSync(filePath);
        return `${info.mtimeMs}:${info.size}`;
      } catch {
        return "absent";
      }
    };
    const startPolling = () => {
      if (pollTimer !== null || stopped) return;
      let last = stamp();
      pollTimer = setInterval(() => {
        const next = stamp();
        if (next === last) return;
        last = next;
        fire();
      }, watchPollMs);
      pollTimer.unref?.();
    };
    const attach = (target, filter) => {
      const handle = fsWatch(target, (eventType, filename) => {
        if (filter !== null && filename !== null && filename !== undefined && filename !== filter) return;
        fire();
      });
      handle.on("error", () => {
        try {
          handle.close();
        } catch {
          /* 已关闭 */
        }
        if (watcher === handle) watcher = null;
        startPolling();
      });
      handle.unref?.();
      return handle;
    };
    try {
      watcher = attach(filePath, null);
    } catch {
      try {
        /* 存储尚不存在（apply 先起监视、播种在组合层视图就绪后）：监视父目录并按名字过滤 */
        watcher = attach(dirname(filePath), basename(filePath));
      } catch {
        startPolling();
      }
    }
    return () => {
      stopped = true;
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      if (pollTimer !== null) clearInterval(pollTimer);
      try {
        watcher?.close();
      } catch {
        /* 已关闭 */
      }
      watcher = null;
    };
  }

  return {
    filePath,
    lockPath,
    backupPath,
    /** 重新装载并返回文档（null = 存储缺席）。 */
    refresh,
    /** 当前内存文档（不触盘）。 */
    peek: () => state,
    revision: currentRevision,
    sections: currentSections,
    snapshot,
    seed,
    upgrade,
    ensureSeeded,
    writeSections,
    watch: watchStore,
  };
}

/* ══════════════════════════ 插件主体 ══════════════════════════ */

/**
 * 插件主体：注册 /api/v-skill-links 路由（映射技能 / 自定义指令 / 快捷按钮 / **共享配置存储**）+
 * agent/pre-step 注入监听 + 设置命名空间（设置 → 插件 → 插件配置 的可视化卡片数据源）。
 *
 * 配置来源合并链（change shared-config-store）：**补丁层 entry config ← 既有用户文档
 * （settingsScope.get() 只读兼容层）← 共享存储节**——前两层是组合层 `base`，共享存储是 GUI
 * 读写层 `user`；两端宿主读写同一份 `<DSH_HOME>/v-skill-links.config.json`。
 * @param {Context} ctx - 宿主 cordis 上下文。
 * @param {{directories?: string[]}|undefined} config - 来自补丁层的 config（组合层的底）。
 */
export function apply(ctx, config) {
  /* 补丁层配置 = 组合层的底；共享存储的节覆盖它。 */
  const entryView = normalizeView(config);
  const store = createConfigStore({ logger: ctx.logger ?? null });
  /** 设置作用域（0.1.5 web CLI 的 settingsScope 通道；无 register 的桌面端恒为 null）。 */
  let settingsScope = null;
  let baseView = entryView;
  let liveDirs = baseView.directories;
  let liveCommands = baseView.commands;

  /* ── 目录缓存（TTL；设置 / 存储变更时主动失效） ── */
  let cachedCatalog = null;
  let cachedAt = 0;
  let inflight = null;
  const invalidateCache = () => {
    cachedCatalog = null;
    cachedAt = 0;
  };
  const getCatalog = () => {
    if (cachedCatalog && Date.now() - cachedAt < SCAN_TTL_MS) return Promise.resolve(cachedCatalog);
    if (!inflight) {
      inflight = scanCatalog(liveDirs)
        .then((catalog) => {
          cachedCatalog = catalog;
          cachedAt = Date.now();
          return catalog;
        })
        .finally(() => {
          inflight = null;
        });
    }
    return inflight;
  };

  /**
   * 组合层视图 = 补丁层 entry config ← 既有用户文档（settingsScope.get() 即这两层的合并解析值；
   * settings.yaml 自此只作只读兼容来源，MUST NOT 再接收 GUI 写入）。无 settings 服务 ⇒ entry config。
   * @returns {{directories: Array, commands: Array, buttons: Array}}
   */
  const settingsBaseView = () => {
    if (settingsScope === null) return entryView;
    try {
      const scoped = settingsScope.get();
      const view = normalizeView(scoped);
      /* 防御：scope 未给出某节时回落 entry 层（与既有 fallback 语义一致） */
      if (!Array.isArray(scoped?.directories)) view.directories = entryView.directories;
      if (!Array.isArray(scoped?.commands)) view.commands = entryView.commands;
      if (!Array.isArray(scoped?.buttons)) view.buttons = entryView.buttons;
      return view;
    } catch (error) {
      ctx.logger?.warn?.(`v-skill-links: settings scope read failed: ${String(error?.message || error)}`);
      return baseView;
    }
  };

  /**
   * 生效配置 = 组合层 ← 共享存储节逐节覆盖（合并链的唯一收口，设置变更与存储变更都走这里）。
   */
  const recompute = () => {
    baseView = settingsBaseView();
    const merged = mergeView(baseView, store.sections());
    let changed = false;
    if (JSON.stringify(merged.directories) !== JSON.stringify(liveDirs)) {
      liveDirs = merged.directories;
      changed = true;
    }
    if (JSON.stringify(merged.commands) !== JSON.stringify(liveCommands)) {
      liveCommands = merged.commands;
      changed = true;
    }
    if (changed) invalidateCache();
  };

  /* 启动装载：存储缺席（播种前 / 全损回落）⇒ 生效值即组合层。 */
  store.refresh();
  recompute();

  /** 播种收口：组合层视图就绪后调用（幂等）。`provisionalSeed` = 本进程先用不完整视图抢播过。 */
  let provisionalSeed = false;
  let settingsHost = false;
  const settleSeed = async (source) => {
    try {
      const outcome = await store.ensureSeeded(baseView, { source, forceUpgrade: provisionalSeed });
      provisionalSeed = false;
      if (outcome.action === "seeded" || outcome.action === "upgraded") recompute();
    } catch (error) {
      ctx.logger?.warn?.(`v-skill-links: config store seed failed: ${String(error?.message || error)}`);
    }
  };

  /* ── 设置命名空间：无 settings 服务的部署自动跳过（继续用补丁层配置 + 共享存储） ──
   * 显式能力检测（change add-dual-host-seam-compat）：0.2.0 桌面端的 settings 服务是
   * SettingsForms（仍在，但**没有 register**）——此处静默跳过，不以 try/catch 捕获
   * TypeError 作控制流，也不产生误报 warn。entry config 始终是权威 fallback。 */
  ctx.inject(["settings"], (sctx) => {
    settingsHost = true;
    if (typeof sctx.settings?.register !== "function") {
      /* 桌面端形态：用户文档已由宿主迁进补丁层 ⇒ 组合层即 entry config，如实播种。 */
      void settleSeed("entry-config");
      return;
    }
    try {
      settingsScope = sctx.settings.register(SETTINGS_NS, settingsSchema(), {
        base: config && typeof config === "object" ? config : undefined,
      });
    } catch (error) {
      /* 用户文档里存了 schema 拒绝的节等情况：不拖垮插件，退回补丁层配置 */
      settingsScope = null;
      ctx.logger?.warn?.(`v-skill-links: settings namespace registration failed: ${String(error?.message || error)}`);
      void settleSeed("entry-config");
      return;
    }
    /* 组合层 = 补丁层 base ← 既有用户文档（recompute 内每次重读 scope，用户文档变更即刻跟随） */
    recompute();
    sctx.effect(() => settingsScope.watch(recompute), "v-skill-links: settings watch");
    /* 播种时机：组合层视图（含用户文档）就绪之后 */
    void settleSeed("web-user-layer");
  });

  /* ── 共享存储热重载：他端进程写入 → 重读 → 重算生效值 + 失效扫描缓存（无需重启） ── */
  ctx.effect(() => store.watch(() => {
    store.refresh();
    recompute();
  }), "v-skill-links: config store watch");

  /* ── HTTP API ── */
  ctx.effect(() => {
    const json = (res, status, body) => {
      res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify(body));
    };
    const readJsonBody = async (req) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text) return {};
      try {
        return JSON.parse(text);
      } catch {
        return {};
      }
    };
    const dispose = ctx.webServer.register({
      kind: "prefix",
      path: API_PREFIX,
      handler: async (req, res) => {
        const url = new URL(req.url, "http://localhost");
        const route = url.pathname.slice(API_PREFIX.length) || "/";
        try {
          /* 列映射技能 + 自定义指令（菜单数据源） */
          if (route === "/list" && req.method === "GET") {
            const catalog = await getCatalog();
            json(res, 200, {
              ...catalog,
              commands: liveCommands.map((c) => ({ name: c.name, description: commandDescription(c.prompt) })),
            });
            return;
          }
          /* 共享配置快照（与客户端 seam 作用域同形；存储缺席按 revision 0 空存储呈现） */
          if (route === "/config" && req.method === "GET") {
            store.refresh();
            json(res, 200, store.snapshot(baseView));
            return;
          }
          /* CAS 写入：{ baseRevision, sections }（null = unset 该节） */
          if (route === "/config" && req.method === "PUT") {
            const body = await readJsonBody(req);
            let outcome;
            try {
              outcome = await store.writeSections(body);
            } catch (error) {
              if (error?.code === "conflict") {
                json(res, 409, { error: "conflict", revision: typeof error.revision === "number" ? error.revision : store.revision() });
                return;
              }
              if (error?.code === "invalid") {
                json(res, 400, { error: "invalid", reason: String(error?.message || error) });
                return;
              }
              if (error?.code === "busy") {
                json(res, 503, { error: "busy" });
                return;
              }
              json(res, 500, { error: "io", reason: String(error?.message || error) });
              return;
            }
            /* 落盘成功：本端立即生效（他端由各自 watch 跟随） */
            recompute();
            json(res, 200, { revision: outcome.revision });
            return;
          }
          /* 执行一条自定义指令：把 Prompt 作为用户消息 followup 进该会话 */
          if (route === "/run" && req.method === "POST") {
            const body = await readJsonBody(req);
            const name = typeof body.name === "string" ? body.name.trim().toLowerCase() : "";
            const command = liveCommands.find((c) => c.name === name);
            if (!command) {
              json(res, 404, { error: `unknown custom command: ${name || "(empty)"}` });
              return;
            }
            const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
            const agent = sessionId ? ctx.agents?.get?.(sessionId) : undefined;
            if (!agent) {
              json(res, 404, { error: "session has no live agent" });
              return;
            }
            agent.followup(
              deepFreeze(
                structuredClone({
                  id: randomUUID(),
                  role: "user",
                  content: [{ type: "text", text: command.prompt }],
                  source: { kind: "user" },
                }),
              ),
            );
            json(res, 200, { ok: true, name: command.name });
            return;
          }
          /* 按名字读一个映射技能的原文（调试/预览用；不接受任意路径输入） */
          if (route === "/skill" && req.method === "GET") {
            const wanted = url.searchParams.get("name") ?? "";
            const catalog = await getCatalog();
            const skill = catalog.skills.find((s) => s.name === wanted);
            if (!skill) {
              json(res, 404, { error: "unknown mapped skill" });
              return;
            }
            let raw;
            try {
              raw = await readFile(skill.file, "utf8");
            } catch {
              json(res, 404, { error: "skill file unreadable" });
              return;
            }
            const { data, body } = parseSkillMarkdown(raw);
            json(res, 200, { ...skill, frontmatter: data, body });
            return;
          }
          json(res, 404, { error: "unknown route" });
        } catch (error) {
          json(res, 500, { error: String(error?.message || error) });
        }
      },
    });
    return dispose;
  }, "v-skill-links: api routes");

  /* ── 无 settings 服务的宿主（如桌面端 `ui-settings enabled: false` 形态）：apply 尾部播种 ──
   * 判定延后一个宏任务：cordis 的运行时子注入回调先于定时器执行。届时设置服务仍不可解析 ⇒
   * 认作「无 settings 宿主」，用 entry config（= 该宿主的完整组合层）播种；抢播内容由晚到的
   * 设置回调经 forceUpgrade 以完整组合层视图修正；另一端有配置时由一次性升级规则接管。 */
  const seedTimer = setTimeout(() => {
    if (settingsHost) return;
    if (hasService(ctx, "settings")) return;
    const outcome = store.seed(baseView, { source: "entry-config" });
    if (outcome.seeded) {
      provisionalSeed = true;
      recompute();
    }
  }, 0);
  seedTimer.unref?.();
  ctx.effect(() => () => clearTimeout(seedTimer), "v-skill-links: config store seed timer");

  /* ── agent/pre-step 注入（prepend：跑在链最外层，注入落在其它注入之后，最贴近模型） ── */
  ctx.on(
    "agent/pre-step",
    async ({ signal }, next) => {
      const decision = await next();
      if (decision.kind === "reject" || signal.aborted) return decision;
      const catalog = await getCatalog();
      if (catalog.skills.length === 0) return decision;
      const skillsByName = new Map(catalog.skills.map((s) => [s.name, s]));
      const wanted = collectMatchedNames(decision.messages, skillsByName);
      if (wanted.length === 0) return decision;
      const blocks = [];
      for (const skillName of wanted) {
        const skill = skillsByName.get(skillName);
        let raw;
        try {
          raw = await readFile(skill.file, "utf8");
        } catch {
          continue;
        }
        blocks.push(renderSkillContent(skill, parseSkillMarkdown(raw).body));
      }
      if (blocks.length === 0) return decision;
      return {
        kind: "enter",
        messages: [...decision.messages, createUserMessage([{ type: "text", text: blocks.join("\n\n") }])],
      };
    },
    { prepend: true },
  );
}
