/**
 * 宿主 apply 冒烟：用最小 mock ctx 跑 apply()，验证 effect/webServer/on 三条接线，
 * 并真实调用注册出来的 /list、/skill、/run 路由处理器（端到端 JSON）+ pre-step 注入
 * + 设置装配（命名空间注册 / 热切换 / 自定义指令 followup）。
 * 运行：node test/host-apply-smoke.mjs
 */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply } from "../lib/index.js";

const base = mkdtempSync(join(tmpdir(), "jsl-apply-"));
try {
  const root = join(base, "skills");
  mkdirSync(join(root, "alpha"), { recursive: true });
  writeFileSync(join(root, "alpha", "SKILL.md"), "---\nname: alpha\ndescription: Alpha 描述\n---\nAlpha 正文");

  let registered = null;
  const effects = [];
  const listeners = [];
  const ctx = {
    webServer: { register: (opts) => { registered = opts; return () => {}; } },
    effect: (fn, label) => { effects.push(label); fn(); },
    on: (event, handler, opts) => { listeners.push({ event, handler, opts }); },
    inject: (_services, _fn) => {}, // 无 settings 服务的部署：设置装配静默跳过
  };
  apply(ctx, { directories: [root, join(base, "nope")] });

  assert.deepEqual(effects, ["v-skill-links: api routes"], "effect 接线");
  assert.equal(registered.kind, "prefix");
  assert.equal(registered.path, "/api/v-skill-links");
  assert.equal(listeners.length, 1);
  assert.equal(listeners[0].event, "agent/pre-step");
  assert.deepEqual(listeners[0].opts, { prepend: true });

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

  /* ══ 设置装配（settings 服务存在）：命名空间注册 + 用户层变更热生效 ══ */
  const settingsDir = join(base, "settings-skills");
  mkdirSync(join(settingsDir, "beta"), { recursive: true });
  writeFileSync(join(settingsDir, "beta", "SKILL.md"), "Beta 正文");

  let regArgs = null;
  let currentValue = null;
  const watchers = [];
  const settingsScopeDisposers = [];
  const followups = [];
  const settingsCtx = {
    webServer: { register: (opts) => { registered = opts; return () => {}; } },
    effect(fn, label) {
      effects.push(label);
      const dispose = fn();
      if (typeof dispose === "function") settingsScopeDisposers.push(dispose);
      return dispose;
    },
    on: (event, handler, opts) => { listeners.push({ event, handler, opts }); },
    agents: {
      get: (id) => (id === "session-abc" ? { followup: (m) => followups.push({ id, m }) } : undefined),
    },
    inject(services, fn) {
      if (services.includes("settings")) fn({ settings: mockSettings, effect: (f) => { const d = f(); if (typeof d === "function") settingsScopeDisposers.push(d); } });
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
  assert.equal(regArgs.ns, "v-skill-links", "设置命名空间注册");
  assert.equal(typeof regArgs.schema, "function", "schema 可调用");
  assert.deepEqual(regArgs.base, { directories: [root] }, "补丁层配置成为组合 base");

  /* base 生效：/list 来自补丁层目录 */
  const listBase = await (async () => {
    let body = null;
    await registered.handler({ method: "GET", url: "/api/v-skill-links/list" }, { writeHead: () => {}, end: (b) => { body = JSON.parse(b); } });
    return body;
  })();
  assert.deepEqual(listBase.skills.map((s) => s.name), ["alpha"], "设置未覆盖时用 base");

  /* 模拟用户在设置卡片保存：用户层变更 → watch 回调 → liveDirs 热切换 */
  currentValue = regArgs.schema({ directories: [settingsDir] });
  for (const cb of watchers) cb();
  const listUser = await (async () => {
    let body = null;
    await registered.handler({ method: "GET", url: "/api/v-skill-links/list" }, { writeHead: () => {}, end: (b) => { body = JSON.parse(b); } });
    return body;
  })();
  assert.deepEqual(listUser.skills.map((s) => s.name), ["beta"], "设置覆盖后扫描目录热切换（免重启）");

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

  /* 补丁层 config 预置 buttons → 组合 base 归一化进入命名空间初始值 */
  let baseButtons = null;
  const baseCtx = {
    webServer: { register: () => () => {} },
    effect: (fn) => { fn(); return () => {}; },
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
  assert.deepEqual(baseButtons.base.buttons, [{ name: " 补丁按钮 ", prompt: " p " }], "补丁层原样成为组合 base");
  assert.deepEqual(baseButtons.initial.buttons, [{ name: "补丁按钮", prompt: "p", autoSend: false }], "初始值归一化 buttons（autoSend 缺省 false）");
  console.log("host-apply-smoke: ok");
} finally {
  rmSync(base, { recursive: true, force: true });
}
