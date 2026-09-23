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

import { readFile, readdir, realpath } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { basename, isAbsolute, join, resolve as pathResolve } from "node:path";

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

/* ══════════════════════════ 插件主体 ══════════════════════════ */

/**
 * 插件主体：注册 /api/v-skill-links 路由 + agent/pre-step 注入监听 +
 * 设置命名空间（设置 → 插件 → 插件配置 的可视化卡片数据源）。
 * @param {Context} ctx - 宿主 cordis 上下文。
 * @param {{directories?: string[]}|undefined} config - 来自补丁层的 config（成为设置的组合 base 层）。
 */
export function apply(ctx, config) {
  /* 补丁层配置 = 组合 base 层；设置文档（settings.yaml）的用户层可覆盖它。 */
  const entryDirs = normalizeDirectories(config);
  let liveDirs = entryDirs;

  /* ── 目录缓存（TTL；设置变更时主动失效） ── */
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

  /* ── 设置命名空间：无 settings 服务的部署自动跳过（继续用补丁层配置） ── */
  let liveCommands = [];
  let settingsScope = null;
  ctx.inject(["settings"], (sctx) => {
    try {
      settingsScope = sctx.settings.register(SETTINGS_NS, settingsSchema(), {
        base: config && typeof config === "object" ? config : undefined,
      });
    } catch (error) {
      /* 用户文档里存了 schema 拒绝的节等情况：不拖垮插件，退回补丁层配置 */
      settingsScope = null;
      ctx.logger?.warn?.(`v-skill-links: settings namespace registration failed: ${String(error?.message || error)}`);
      return;
    }
    const recompute = () => {
      const value = settingsScope.get();
      const dirs = Array.isArray(value?.directories) ? value.directories : entryDirs;
      const commands = Array.isArray(value?.commands) ? value.commands : [];
      let changed = false;
      if (JSON.stringify(dirs) !== JSON.stringify(liveDirs)) {
        liveDirs = dirs;
        changed = true;
      }
      if (JSON.stringify(commands) !== JSON.stringify(liveCommands)) {
        liveCommands = commands;
        changed = true;
      }
      if (changed) invalidateCache();
    };
    recompute();
    sctx.effect(() => settingsScope.watch(recompute), "v-skill-links: settings watch");
  });

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
