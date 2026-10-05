/**
 * 宿主 apply 冒烟：用最小 mock ctx 跑 apply()，验证 effect/webServer/on 三条接线，
 * 并真实调用注册出来的 /list、/skill、/run 路由处理器（端到端 JSON）+ pre-step 注入
 * + 设置装配（命名空间注册 / 热切换 / 自定义指令 followup）
 * + 共享配置存储（change shared-config-store）：GET/PUT /config 端到端
 * （200 / 409 / 400 / 503 + 备份文件存在）、播种与升级幂等、宿主自有文件不被写入、
 * 既有路由不回归。
 * 运行：node test/host-apply-smoke.mjs
 *
 * 注意：共享存储路径随 `$DSH_HOME` 解析，本测试逐场景改写该环境变量指向临时目录，
 * 绝不触碰真实 `~/.dsh`。
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply, resolveConfigStorePath } from "../lib/index.js";

const base = mkdtempSync(join(tmpdir(), "jsl-apply-"));
const originalDshHome = process.env.DSH_HOME;
/** 场景级 DSH_HOME：共享存储落进临时目录（逐场景隔离，互不串味）。 */
const useDshHome = (name) => {
  const dir = join(base, `home-${name}`);
  mkdirSync(dir, { recursive: true });
  process.env.DSH_HOME = dir;
  return { dir, storePath: join(dir, "v-skill-links.config.json") };
};
const readDoc = (path) => JSON.parse(readFileSync(path, "utf8"));
/** 让 apply 尾部的播种定时器（setTimeout 0，unref）先跑完：等一个真实定时器而非 setImmediate。 */
const tick = () => new Promise((r) => setTimeout(r, 10));

try {
  const root = join(base, "skills");
  mkdirSync(join(root, "alpha"), { recursive: true });
  writeFileSync(join(root, "alpha", "SKILL.md"), "---\nname: alpha\ndescription: Alpha 描述\n---\nAlpha 正文");

  /* ══════════════ 0. 无 settings 服务的宿主：接线 + 既有路由 + 尾部播种 ══════════════ */
  const home0 = useDshHome("no-settings");
  let registered = null;
  const effects = [];
  const listeners = [];
  const disposers = [];
  const ctx = {
    webServer: { register: (opts) => { registered = opts; return () => {}; } },
    effect: (fn, label) => {
      effects.push(label);
      const dispose = fn();
      if (typeof dispose === "function") disposers.push(dispose);
      return dispose;
    },
    on: (event, handler, opts) => { listeners.push({ event, handler, opts }); },
    inject: (_services, _fn) => {}, // 无 settings 服务的部署：设置装配静默跳过
  };
  apply(ctx, { directories: [root, join(base, "nope")] });

  assert.deepEqual(effects, [
    "v-skill-links: config store watch",
    "v-skill-links: api routes",
    "v-skill-links: config store seed timer",
  ], "effect 接线（存储监视 + 路由 + 无 settings 宿主播种定时器）");
  assert.equal(registered.kind, "prefix");
  assert.equal(registered.path, "/api/v-skill-links");
  assert.equal(listeners.length, 1);
  assert.equal(listeners[0].event, "agent/pre-step");
  assert.deepEqual(listeners[0].opts, { prepend: true });

  /* 存储路径 = <DSH_HOME>/v-skill-links.config.json（与宿主 home 解析同址） */
  assert.equal(resolveConfigStorePath(), home0.storePath, "存储路径随 DSH_HOME 解析");

  /* ── 尾部播种：无 settings 服务的宿主用 entry config 播种（迁移标记 entry-config） ── */
  await tick();
  assert.ok(existsSync(home0.storePath), "apply 尾部播种：存储文件已创建");
  const seededNoSettings = readDoc(home0.storePath);
  assert.equal(seededNoSettings.revision, 1, "播种 revision: 1");
  assert.equal(seededNoSettings.migratedFrom, "entry-config", "无 settings 宿主：migratedFrom = entry-config");
  assert.deepEqual(seededNoSettings.directories, [root, join(base, "nope")], "播种内容 = entry config 视图");

  /* ── /list 端到端 ── */
  const respond = async (route) => {
    let status = null;
    let body = null;
    await registered.handler(
      { method: "GET", url: `/api/v-skill-links${route}` },
      { writeHead: (s) => { status = s; }, end: (b) => { body = JSON.parse(b); } },
    );
    return { status, body };
  };
  const list = await respond("/list");
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.skills.map((s) => s.name), ["alpha"]);
  assert.deepEqual(list.body.commands, [], "无自定义指令时 /list.commands 为空数组");
  assert.equal(list.body.directories[0].ok, true);
  assert.equal(list.body.directories[1].ok, false);

  const one = await respond("/skill?name=alpha");
  assert.equal(one.status, 200);
  assert.equal(one.body.body, "Alpha 正文");
  assert.equal(one.body.frontmatter.name, "alpha");

  const missing = await respond("/skill?name=ghost");
  assert.equal(missing.status, 404);
  const unknown = await respond("/whatever");
  assert.equal(unknown.status, 404);

  /* ── pre-step 处理器：命中即追加注入消息 ── */
  const stepListener = listeners[0].handler;
  const entered = await stepListener(
    { signal: { aborted: false } },
    async () => ({
      kind: "enter",
      messages: [{ role: "user", content: [{ type: "text", text: "请按 /alpha 执行" }], source: { kind: "user" } }],
    }),
  );
  assert.equal(entered.kind, "enter");
  assert.equal(entered.messages.length, 2, "原消息 + 注入消息");
  const injected = entered.messages[1];
  assert.equal(injected.role, "user");
  assert.equal(injected.source.kind, "plugin");
  assert.equal(injected.source.plugin, "dsh-v-skill-links");
  assert.equal(injected.source.form, "instructions");
  assert.ok(injected.content[0].text.includes("<skill_content name=\"alpha\""), "注入 <skill_content>");
  assert.ok(injected.content[0].text.includes("Alpha 正文"), "正文内嵌");
  assert.ok(Object.isFrozen(injected), "注入消息冻结");

  /* 同一步重复令牌只注入一次；无令牌原样返回 */
  const dedup = await stepListener(
    { signal: { aborted: false } },
    async () => ({
      kind: "enter",
      messages: [{ role: "user", content: [{ type: "text", text: "/alpha /alpha" }], source: { kind: "user" } }],
    }),
  );
  assert.equal(dedup.messages.length, 2);
  assert.ok(dedup.messages[1].content[0].text.split("<skill_content").length - 1 === 1, "同一技能只注入一次");

  const passthrough = await stepListener(
    { signal: { aborted: false } },
    async () => ({ kind: "enter", messages: [{ role: "user", content: [{ type: "text", text: "普通消息" }], source: { kind: "user" } }] }),
  );
  assert.equal(passthrough.messages.length, 1, "未命中不注入");

  const rejected = await stepListener({ signal: { aborted: false } }, async () => ({ kind: "reject" }));
  assert.equal(rejected.kind, "reject", "reject 直通");

  /* ── 新路由 GET /config：同形就绪快照（播种后 revision 1） ── */
  const config0 = await respond("/config");
  assert.equal(config0.status, 200);
  assert.equal(config0.body.status, "ready", "就绪快照");
  assert.equal(config0.body.writable, true, "共享存储可写");
  assert.equal(config0.body.revision, 1);
  assert.deepEqual(config0.body.value.directories, [root, join(base, "nope")], "value = 生效值");
  assert.deepEqual(config0.body.base.directories, [root, join(base, "nope")], "base = 组合层（entry config）");
  assert.deepEqual(config0.body.user.directories, [root, join(base, "nope")], "user = 存储节");
  for (const d of disposers) d();
  disposers.length = 0;

  /* ══════════════ 1. settings 宿主（0.1.5 web CLI）：注册 + 热切换 + 存储播种 ══════════════ */
  const home1 = useDshHome("settings");
  /* 宿主自有文件（灾备副本语义）：全程不得被本插件改写 */
  const hostOwned = {
    settingsYaml: join(home1.dir, "settings.yaml"),
    patchYml: join(home1.dir, "profiles", "web", "cordis.patch.yml"),
  };
  mkdirSync(join(home1.dir, "profiles", "web"), { recursive: true });
  writeFileSync(hostOwned.settingsYaml, "v-skill-links:\n  directories:\n    - F:/from-user-doc\n");
  writeFileSync(hostOwned.patchYml, "- id: dsh-v-skill-links\n  config:\n    directories:\n      - F:/from-patch\n");
  const ownedStamp = () => Object.fromEntries(Object.entries(hostOwned).map(([k, p]) => [k, `${statSync(p).mtimeMs}:${readFileSync(p, "utf8")}`]));

  const settingsDir = join(base, "settings-skills");
  mkdirSync(join(settingsDir, "beta"), { recursive: true });
  writeFileSync(join(settingsDir, "beta", "SKILL.md"), "Beta 正文");

  let regArgs = null;
  let currentValue = null;
  const watchers = [];
  const followups = [];
  const settingsDisposers = [];
  const ownedBefore = ownedStamp();
  const settingsCtx = {
    webServer: { register: (opts) => { registered = opts; return () => {}; } },
    effect(fn, label) {
      effects.push(label);
      const dispose = fn();
      if (typeof dispose === "function") settingsDisposers.push(dispose);
      return dispose;
    },
    on: (event, handler, opts) => { listeners.push({ event, handler, opts }); },
    agents: {
      get: (id) => (id === "session-abc" ? { followup: (m) => followups.push({ id, m }) } : undefined),
    },
    inject(services, fn) {
      if (services.includes("settings")) fn({ settings: mockSettings, effect: (f) => { const d = f(); if (typeof d === "function") settingsDisposers.push(d); } });
    },
  };
  const mockSettings = {
    register(ns, schema, options) {
      regArgs = { ns, schema, base: options?.base };
      currentValue = schema(options?.base); // 用户节为空时 schema(base) 即解析值
      return {
        get: () => currentValue,
        watch: (cb) => { watchers.push(cb); return () => {}; },
      };
    },
  };
  registered = null;
  apply(settingsCtx, { directories: [root] });
  await tick();
  assert.equal(regArgs.ns, "v-skill-links", "设置命名空间注册");
  assert.equal(typeof regArgs.schema, "function", "schema 可调用");
  assert.deepEqual(regArgs.base, { directories: [root] }, "补丁层配置成为组合 base");
  assert.ok(settingsDisposers.length >= 1, "settings watch 经子注入 effect 接线");

  /* 播种：web 宿主在组合层视图（含既有用户文档）就绪后播种，migratedFrom = web-user-layer */
  assert.ok(existsSync(home1.storePath), "settings 宿主：组合层视图就绪后播种");
  const seededWeb = readDoc(home1.storePath);
  assert.equal(seededWeb.migratedFrom, "web-user-layer");
  assert.deepEqual(seededWeb.directories, [root], "播种内容 = scope 解析出的组合层视图");

  /* base 生效：/list 来自补丁层目录 */
  const listBase = await (async () => {
    let body = null;
    await registered.handler({ method: "GET", url: "/api/v-skill-links/list" }, { writeHead: () => {}, end: (b) => { body = JSON.parse(b); } });
    return body;
  })();
  assert.deepEqual(listBase.skills.map((s) => s.name), ["alpha"], "设置未覆盖时用 base");

  /* 共享存储路由夹具（本段与第 2 段共用） */
  const getConfig = async () => {
    let status = null;
    let body = null;
    await registered.handler({ method: "GET", url: "/api/v-skill-links/config" }, { writeHead: (s) => { status = s; }, end: (b) => { body = JSON.parse(b); } });
    return { status, body };
  };
  const putConfig = async (bodyObj) => {
    let status = null;
    let body = null;
    const payload = JSON.stringify(bodyObj);
    const req = { method: "PUT", url: "/api/v-skill-links/config", [Symbol.asyncIterator]: function* () { yield payload; } };
    await registered.handler(req, { writeHead: (s) => { status = s; }, end: (b) => { body = JSON.parse(b); } });
    return { status, body };
  };
  const listDirs = async () => {
    let body = null;
    await registered.handler({ method: "GET", url: "/api/v-skill-links/list" }, { writeHead: () => {}, end: (b) => { body = JSON.parse(b); } });
    return body;
  };

  /* 播种后存储节 = 组合层视图 ⇒ 生效值不变（迁移无感） */
  const seededView = await getConfig();
  assert.equal(seededView.body.revision, 1, "播种后 revision 1");
  assert.deepEqual(seededView.body.value.directories, [root], "播种后生效值 = 组合层");
  assert.deepEqual(seededView.body.user.directories, [root], "user = 播种写入的节");

  /* 模拟用户直接改 settings.yaml（只读兼容层）：存储已有同名节 ⇒ 依设计被遮蔽（GUI 层优先） */
  currentValue = regArgs.schema({ directories: [settingsDir] });
  for (const cb of watchers) cb();
  assert.deepEqual((await listDirs()).skills.map((s) => s.name), ["alpha"], "存储同名节遮蔽既有用户文档（GUI 读写层优先）");
  const masked = await getConfig();
  assert.deepEqual(masked.body.base.directories, [settingsDir], "base = 组合层（补丁层 ← 用户文档）");
  assert.deepEqual(masked.body.value.directories, [root], "value 仍取存储节（同名节被遮蔽；用户文档值不丢）");

  /* 「重置为组合层」（unset 存储节）⇒ 既有用户文档值立即生效（设置 watch 与合并链协同） */
  const unseed = await putConfig({ baseRevision: masked.body.revision, sections: { directories: null } });
  assert.equal(unseed.status, 200, "unset 经 CAS 写入");
  const listUser = await (async () => {
    let body = null;
    await registered.handler({ method: "GET", url: "/api/v-skill-links/list" }, { writeHead: () => {}, end: (b) => { body = JSON.parse(b); } });
    return body;
  })();
  assert.deepEqual(listUser.skills.map((s) => s.name), ["beta"], "存储无该节时回落组合层：用户文档目录热生效（免重启）");

  /* ══ 自定义指令（followup 型）：/list 携带 commands；/run 触发 agent.followup ══ */
  assert.deepEqual(listUser.commands, [], "无指令时 /list.commands 为空数组");
  currentValue = regArgs.schema({
    directories: [settingsDir],
    commands: [
      { name: "Daily-Review", prompt: "请使用 /beta 审查今天的改动" },
      { name: "ship", prompt: "发布前跑一遍检查" },
    ],
  });
  for (const cb of watchers) cb();
  const listed = await (async () => {
    let body = null;
    await registered.handler({ method: "GET", url: "/api/v-skill-links/list" }, { writeHead: () => {}, end: (b) => { body = JSON.parse(b); } });
    return body;
  })();
  assert.deepEqual(listed.commands.map((c) => c.name), ["daily-review", "ship"], "自定义指令进 /list（小写归一）");
  assert.equal(listed.commands[0].description, "请使用 /beta 审查今天的改动", "Prompt 首行作描述");

  const post = async (route, bodyObj) => {
    let status = null;
    let body = null;
    const payload = JSON.stringify(bodyObj);
    const req = {
      method: "POST",
      url: `/api/v-skill-links${route}`,
      [Symbol.asyncIterator]: function* () { yield payload; },
    };
    await registered.handler(req, { writeHead: (s) => { status = s; }, end: (b) => { body = JSON.parse(b); } });
    return { status, body };
  };

  const run = await post("/run", { sessionId: "session-abc", name: "daily-review" });
  assert.equal(run.status, 200);
  assert.equal(run.body.ok, true);
  assert.equal(followups.length, 1, "followup 已入队");
  assert.equal(followups[0].m.role, "user");
  assert.equal(followups[0].m.source.kind, "user", "消息打 user 源（与 /plan 同口径）");
  assert.equal(followups[0].m.content[0].text, "请使用 /beta 审查今天的改动");
  assert.ok(Object.isFrozen(followups[0].m), "followup 消息冻结");

  const unknownName = await post("/run", { sessionId: "session-abc", name: "ghost" });
  assert.equal(unknownName.status, 404, "未知指令 404");
  const noAgent = await post("/run", { sessionId: "session-cold", name: "ship" });
  assert.equal(noAgent.status, 404, "无活跃代理 404");

  /* ══ 快捷按钮（buttons 节）：用户层写入 → watch 热切换 → 归一化生效 ══ */
  currentValue = regArgs.schema({
    directories: [settingsDir],
    commands: [
      { name: "Daily-Review", prompt: "请使用 /beta 审查今天的改动" },
      { name: "ship", prompt: "发布前跑一遍检查" },
    ],
    buttons: [
      { name: " 新建 ", prompt: "使用 /beta 做一件事", autoSend: true },
      { name: "新建", prompt: "重复项被丢弃" },
    ],
  });
  for (const cb of watchers) cb();
  assert.deepEqual(currentValue.buttons, [
    { name: "新建", prompt: "使用 /beta 做一件事", autoSend: true },
  ], "用户层 buttons 归一化生效（trim / 去重先到先得）");
  assert.deepEqual(listed.commands.map((c) => c.name), ["daily-review", "ship"], "buttons 节不影响既有 commands 管线");

  /* ══════════════ 2. 共享存储路由端到端：GET / PUT(200/409/400/503) + 备份 + 热生效 ══════════════ */
  const before = await getConfig();
  assert.deepEqual(before.body.base.directories, [settingsDir], "base = 补丁层 entry config ← 用户文档");
  assert.equal(before.body.user, null, "此时存储无任何节（上一段已 unset）");

  /* PUT 200：合法保存 → revision 递增 + 备份存在 + 落盘 normalize 输出 + 本端立即生效 */
  const rev0 = before.body.revision;
  const write1 = await putConfig({ baseRevision: rev0, sections: { directories: [settingsDir] } });
  assert.deepEqual(write1, { status: 200, body: { revision: rev0 + 1 } }, "合法保存 200 + 新 revision");
  assert.deepEqual(readDoc(home1.storePath).directories, [settingsDir], "落盘 normalize 输出（绝对路径）");
  assert.ok(existsSync(`${home1.storePath}.bak.1`), "写入前生成 .bak.1 备份");
  assert.deepEqual((await listDirs()).skills.map((s) => s.name), ["beta"], "共享存储写入即热生效（扫描重算）");

  /* GET 同形快照：user 覆盖 / value 生效 / base 组合层 */
  const afterWrite = await getConfig();
  assert.deepEqual(afterWrite.body.user.directories, [settingsDir], "user = 存储节");
  assert.deepEqual(afterWrite.body.value.directories, [settingsDir], "value = base ← user");
  assert.equal(afterWrite.body.revision, rev0 + 1);

  /* PUT 409：baseRevision 过期（同时保存的后写者被拒） */
  const stale = await putConfig({ baseRevision: rev0, sections: { directories: [settingsDir] } });
  assert.deepEqual(stale, { status: 409, body: { error: "conflict", revision: rev0 + 1 } }, "CAS 冲突 409 + 当前 revision");
  assert.equal(readDoc(home1.storePath).revision, rev0 + 1, "409 不改动存储");

  /* PUT 400：非法负载（超上限 / 名称非法 / 未知节） */
  const tooMany = await putConfig({ baseRevision: rev0 + 1, sections: { buttons: Array.from({ length: 33 }, (_v, i) => ({ name: `b${i}`, prompt: "p" })) } });
  assert.equal(tooMany.status, 400, "33 条按钮 → 400");
  assert.match(tooMany.body.reason, /exceeds 32/);
  const badName = await putConfig({ baseRevision: rev0 + 1, sections: { commands: [{ name: "Bad Name", prompt: "p" }] } });
  assert.equal(badName.status, 400, "名称非法 → 400");
  const badSection = await putConfig({ baseRevision: rev0 + 1, sections: { nope: [] } });
  assert.equal(badSection.status, 400, "未知节 → 400");
  assert.equal(readDoc(home1.storePath).revision, rev0 + 1, "400 不改动存储");

  /* PUT 503：另一端持锁超过有界等待（新鲜锁文件 + 真实时钟） */
  writeFileSync(`${home1.storePath}.lock`, JSON.stringify({ pid: 4242, at: Date.now() }));
  const busy = await putConfig({ baseRevision: rev0 + 1, sections: { directories: [settingsDir] } });
  assert.deepEqual(busy, { status: 503, body: { error: "busy" } }, "锁等待超时 → 503 busy");
  assert.equal(readDoc(home1.storePath).revision, rev0 + 1, "503 不改动存储");
  rmSync(`${home1.storePath}.lock`, { force: true });

  /* PUT unset：重置为组合层（节删除 → value 回落 base） */
  const reset = await putConfig({ baseRevision: rev0 + 1, sections: { directories: null } });
  assert.deepEqual(reset, { status: 200, body: { revision: rev0 + 2 } }, "unset 亦是一次 CAS 写入");
  const afterReset = await getConfig();
  assert.equal(afterReset.body.user, null, "全部节清空 → user: null");
  assert.deepEqual(afterReset.body.value.directories, [settingsDir], "重置后 value 回落组合层 base（含用户文档）");
  assert.deepEqual((await listDirs()).skills.map((s) => s.name), ["beta"], "重置即热生效（回组合层目录）");

  /* 宿主自有文件全程未被写入（灾备副本原样保留） */
  assert.deepEqual(ownedStamp(), ownedBefore, "settings.yaml 与 profile 补丁层的 mtime / 内容均不变");

  /* ══════════════ 3. 播种与升级幂等：再次 apply 不改写非空存储 ══════════════ */
  const reregistered = [];
  const secondCtx = {
    webServer: { register: (opts) => { reregistered.push(opts); return () => {}; } },
    effect(fn) { const d = fn(); if (typeof d === "function") settingsDisposers.push(d); return d; },
    on: () => {},
    agents: { get: () => undefined },
    inject(services, fn) {
      if (services.includes("settings")) fn({ settings: mockSettings2, effect: (f) => { const d = f(); if (typeof d === "function") settingsDisposers.push(d); } });
    },
  };
  const mockSettings2 = {
    register(_ns, schema, options) {
      return { get: () => schema(options?.base), watch: () => () => {} };
    },
  };
  await putConfig({ baseRevision: afterReset.body.revision, sections: { buttons: [{ name: "keep", prompt: "p" }] } });
  assert.deepEqual(readDoc(home1.storePath).buttons, [{ name: "keep", prompt: "p", autoSend: false }], "写入 buttons 节（构成非空存储）");
  const beforeSecond = readFileSync(home1.storePath, "utf8");
  apply(secondCtx, { directories: [root] });
  await tick();
  assert.equal(readFileSync(home1.storePath, "utf8"), beforeSecond, "含节存储：重新激活（重启宿主）不改写存储");
  assert.deepEqual(readDoc(home1.storePath).buttons, [{ name: "keep", prompt: "p", autoSend: false }], "用户保存的节原样保留");

  /* 空存储升级：桌面端先启动播种出无节存储 → web 端启动一次性升级 */
  const home2 = useDshHome("upgrade");
  writeFileSync(home2.storePath, `${JSON.stringify({ revision: 1, migratedFrom: "entry-config" }, null, 2)}\n`);
  const upgradeCtx = {
    webServer: { register: () => () => {} },
    effect(fn) { const d = fn(); if (typeof d === "function") settingsDisposers.push(d); return d; },
    on: () => {},
    agents: { get: () => undefined },
    inject(services, fn) {
      if (services.includes("settings")) fn({ settings: mockSettings2, effect: () => {} });
    },
  };
  apply(upgradeCtx, { directories: [root] });
  await tick();
  await tick();
  const upgradedDoc = readDoc(home2.storePath);
  assert.equal(upgradedDoc.revision, 1, "空存储被有配置的一端升级：revision 保持 1");
  assert.deepEqual(upgradedDoc.directories, [root], "升级写入本机组合层视图");
  assert.equal(upgradedDoc.migratedFrom, "entry-config", "升级保留原 migratedFrom 标记");

  /* 补丁层 config 预置 buttons → 组合 base 归一化进入命名空间初始值 */
  useDshHome("base-buttons");
  let baseButtons = null;
  const baseCtx = {
    webServer: { register: () => () => {} },
    effect: (fn) => { const d = fn(); if (typeof d === "function") settingsDisposers.push(d); return () => {}; },
    on: () => {},
    agents: { get: () => undefined },
    inject(services, fn) {
      if (services.includes("settings")) {
        fn({
          settings: {
            register(_ns, schema, options) {
              baseButtons = { base: options?.base, initial: schema(options?.base) };
              return { get: () => baseButtons.initial, watch: () => () => {} };
            },
          },
          effect: () => {},
        });
      }
    },
  };
  apply(baseCtx, { directories: [root], buttons: [{ name: " 补丁按钮 ", prompt: " p " }] });
  await tick();
  assert.deepEqual(baseButtons.base.buttons, [{ name: " 补丁按钮 ", prompt: " p " }], "补丁层原样成为组合 base");
  assert.deepEqual(baseButtons.initial.buttons, [{ name: "补丁按钮", prompt: "p", autoSend: false }], "初始值归一化 buttons（autoSend 缺省 false）");

  /* ══════════════ 3.5 跨进程热重载：他端宿主写入存储 → 本端 watch 去抖后重算（无需重启） ══════════════ */
  assert.deepEqual((await listDirs()).skills.map((s) => s.name), ["beta"], "热重载前：生效目录来自组合层（用户文档）");
  const externalRevision = readDoc(home1.storePath).revision + 1;
  writeFileSync(home1.storePath, `${JSON.stringify({ revision: externalRevision, directories: [root], buttons: [{ name: "keep", prompt: "p", autoSend: false }] }, null, 2)}\n`);
  await new Promise((r) => setTimeout(r, 250)); /* fs.watch 去抖 100ms + 重算 */
  assert.deepEqual((await listDirs()).skills.map((s) => s.name), ["alpha"], "他端进程写入后本端 /list 即返回新目录（扫描缓存已失效重算）");
  assert.equal((await getConfig()).body.revision, externalRevision, "本端读到的是他端写入的 revision");

  /* ══════════════ 4. 宿主半区第三态（change add-dual-host-seam-compat）：settings 服务在、但没有 register
     （0.2.0 桌面端 SettingsForms）——显式能力检测静默跳过，不以异常作控制流、不发误报 warn；
     共享存储按 entry config 播种（桌面端组合层即 entry config）══════════════ */
  const home3 = useDshHome("desktop-forms");
  const warns = [];
  const noRegisterCtx = {
    webServer: { register: (opts) => { registered = opts; return () => {}; } },
    effect: (fn, label) => {
      effects.push(label);
      const d = fn();
      if (typeof d === "function") settingsDisposers.push(d);
      return d;
    },
    on: (event, handler, opts) => { listeners.push({ event, handler, opts }); },
    logger: { warn: (...args) => { warns.push(args); } },
    inject(services, fn) {
      if (!services.includes("settings")) return;
      fn({
        /* SettingsForms：settings 服务存在，但形状里**没有 register**（0.2.0 桌面端） */
        settings: { describe: () => [] },
        /* 跳过注册时 MUST NOT 再注册 watch effect（注册后才接的 watch 走这里） */
        effect() { throw new Error("MUST NOT 注册 settings watch（已跳过注册）"); },
      });
    },
  };
  registered = null;
  apply(noRegisterCtx, { directories: [root] });
  await tick();
  assert.equal(warns.length, 0, "静默跳过：无告警日志（取代异常控制流）");
  assert.equal(typeof registered?.handler, "function", "宿主路由照常注册（/api/v-skill-links/*）");
  const listNoRegister = await (async () => {
    let status = null;
    let body = null;
    await registered.handler({ method: "GET", url: "/api/v-skill-links/list" }, { writeHead: (s) => { status = s; }, end: (b) => { body = JSON.parse(b); } });
    return { status, body };
  })();
  assert.equal(listNoRegister.status, 200, "跳过设置注册后 /list 照常 200");
  assert.deepEqual(listNoRegister.body.skills.map((s) => s.name), ["alpha"], "/list 走 entryDirs fallback（补丁层 entry config 仍是权威来源）");
  assert.deepEqual(listNoRegister.body.commands, [], "无设置命名空间时自定义指令为空数组（现状路径）");
  assert.ok(existsSync(home3.storePath), "桌面端形态：settings 服务存在但无 register → 仍按组合层播种");
  assert.equal(readDoc(home3.storePath).migratedFrom, "entry-config", "桌面端播种标记 entry-config");
  assert.equal(readDoc(home3.storePath).revision, 1);

  for (const d of settingsDisposers) d();
  console.log("host-apply-smoke: ok");
} finally {
  if (originalDshHome === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = originalDshHome;
  rmSync(base, { recursive: true, force: true });
}
