/**
 * 共享配置存储冒烟（change shared-config-store，task 4.1）：纯函数存储段直测（临时目录 + 假时钟）——
 *  1. 路径解析（DSH_HOME 非空 / 空白 / ~ 展开 → 两端同址）；
 *  2. 归一层：normalizeView / mergeView / storeSectionsOf / sanitizeStoreDocument；
 *  3. 播种（独占创建 + migratedFrom）与装载归一；
 *  4. 损坏恢复链（坏 JSON → .bak.1/2/3 依次恢复 → 全损回落 + 恰告警一次）；
 *  5. 锁语义（O_EXCL 独占创建、陈旧锁接管、等待超时 busy、锁内 CAS 拒后写——时间依赖注入）；
 *  6. 备份轮转（5 次写留 3 份；替换前一刻正式文件恒存在）；
 *  7. 独占播种并发（双创建一胜一 EEXIST，无交叉覆盖）/ 空存储升级 / 非空不覆盖；
 *  8. 快照形状与 409/400 语义（baseRevision 不匹配 / 非法负载 / unknown section / unset）。
 * 运行：node test/shared-store-smoke.mjs
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  ConfigStoreError,
  createConfigStore,
  mergeView,
  normalizeView,
  resolveConfigStorePath,
  resolveDshHome,
  sanitizeStoreDocument,
  storeSectionsOf,
} from "../lib/index.js";

/* ── 1. 路径解析（task 1.1 定案） ── */
const HOME = "C:\\Users\\tester";
assert.equal(resolveDshHome({}, HOME), join(HOME, ".dsh"), "DSH_HOME 缺席 → ~/.dsh");
assert.equal(resolveDshHome({ DSH_HOME: "   " }, HOME), join(HOME, ".dsh"), "空白 DSH_HOME 视同未设");
assert.equal(resolveDshHome({ DSH_HOME: "D:\\harness" }, HOME), "D:\\harness", "非空 DSH_HOME 优先");
assert.equal(resolveDshHome({ DSH_HOME: "~/shared" }, HOME), join(HOME, "shared"), "DSH_HOME 的 ~ 前缀按 homedir 展开");
assert.equal(resolveConfigStorePath({ env: {}, home: HOME }), join(HOME, ".dsh", "v-skill-links.config.json"), "存储路径 = <home>/.dsh/v-skill-links.config.json");
/* 两端同址：同一 env + 同一 home（两个宿主进程读同一环境变量与主目录） ⇒ 同一路径 */
assert.equal(resolveConfigStorePath({ env: { DSH_HOME: "D:\\harness" }, home: HOME }), resolveConfigStorePath({ env: { DSH_HOME: "D:\\harness" }, home: HOME }));

/* ── 2. 归一层 ── */
const view = normalizeView({ directories: ["F:/x", "F:/x", "  "], commands: [{ name: "Greet", prompt: " 你好 " }], buttons: [{ name: " 新建 ", prompt: "p", autoSend: true }] }, { baseDir: "C:\\work", home: HOME });
assert.deepEqual(view.directories, ["F:\\x"], "组合层视图归一（绝对化 + 去重）");
assert.deepEqual(view.commands, [{ name: "greet", prompt: "你好" }], "指令小写归一");
assert.deepEqual(view.buttons, [{ name: "新建", prompt: "p", autoSend: true }], "按钮 trim 归一");
assert.deepEqual(normalizeView(undefined).directories, [], "空来源 → 空视图（不抛错）");
assert.deepEqual(normalizeView({ directories: [1, 2] }).directories, [], "节级非法 → 该节按空处理");
assert.deepEqual(Object.keys(mergeView(view, null)), ["directories", "commands", "buttons"], "mergeView(base, null) = base");
assert.deepEqual(mergeView(view, { commands: [] }), { directories: ["F:\\x"], commands: [], buttons: view.buttons }, "节存在（含空数组）= 显式覆盖");
assert.equal(storeSectionsOf({ revision: 2 }), null, "无节 → user: null");
assert.deepEqual(storeSectionsOf({ revision: 2, buttons: [] }), { buttons: [] }, "空数组节仍算覆盖");
assert.equal(sanitizeStoreDocument({ revision: 0 }), null, "revision 非正整数 → 判损（走恢复链）");
assert.equal(sanitizeStoreDocument([]), null, "非对象 → 判损");
assert.deepEqual(sanitizeStoreDocument({ revision: 3, buttons: "oops", directories: ["~/a"] }, { home: HOME }).directories, [join(HOME, "a")], "装载归一：节级非法丢弃、~ 展开");

/* ── 夹具 ── */
const base = mkdtempSync(join(tmpdir(), "jsl-store-"));
const storePath = join(base, "v-skill-links.config.json");
const bak = (i) => `${storePath}.bak.${i}`;
const lockPath = `${storePath}.lock`;
/** 假时钟 + 注入睡眠：时间依赖的锁语义无需真实等待。 */
const makeClock = () => {
  const clock = { at: 1_000_000 };
  return {
    clock,
    now: () => clock.at,
    sleep: async (ms) => { clock.at += ms; },
    advance: (ms) => { clock.at += ms; },
  };
};
const warns = [];
const logger = { warn: (message) => warns.push(String(message)) };
const makeStore = (extra = {}) => createConfigStore({ filePath: storePath, baseDir: "C:\\work", home: HOME, logger, lockWaitMs: 50, lockStepMs: 10, ...extra });
const readDoc = (path = storePath) => JSON.parse(readFileSync(path, "utf8"));

try {
  /* ── 3. 播种（独占创建 + migratedFrom） ── */
  const { now, sleep, clock, advance } = makeClock();
  const store = makeStore({ now, sleep });
  assert.equal(store.refresh(), null, "未播种：存储缺席（revision 0 语义）");
  assert.deepEqual(store.snapshot(view), { status: "ready", revision: 0, value: view, base: view, user: null, writable: true }, "缺席时快照按 revision 0 空存储呈现");
  const seeded = store.seed(view, { source: "web-user-layer" });
  assert.deepEqual(seeded, { seeded: true, reason: "created" }, "首次播种：独占创建成功");
  const seededDoc = readDoc();
  assert.equal(seededDoc.revision, 1, "播种 revision 从 1 起");
  assert.equal(seededDoc.migratedFrom, "web-user-layer", "播种写 migratedFrom 标记");
  assert.deepEqual(seededDoc.directories, ["F:\\x"], "播种内容 = 本机组合层视图");

  /* 空视图播种：无节存储（另一端的「一次性升级」入口） */
  const emptyPath = join(base, "empty.config.json");
  const emptyStore = makeStore({ filePath: emptyPath, now, sleep });
  assert.deepEqual(emptyStore.seed(normalizeView(undefined), { source: "entry-config" }), { seeded: true, reason: "created" }, "空视图也播种（无节）");
  assert.deepEqual(readDoc(emptyPath), { revision: 1, migratedFrom: "entry-config" }, "空视图 ⇒ 无节存储");

  /* ── 4. 写入 CAS / revision 递增 / unset / 备份轮转 ── */
  const first = await store.writeSections({ baseRevision: 1, sections: { commands: [{ name: "Ship", prompt: "发布" }] } });
  assert.equal(first.revision, 2, "合法写入 revision 递增");
  assert.deepEqual(readDoc().commands, [{ name: "ship", prompt: "发布" }], "落盘 normalize 输出（指令小写）");
  assert.deepEqual(readDoc().directories, ["F:\\x"], "未涉及的节原样保留");
  const conflict = await store.writeSections({ baseRevision: 1, sections: { buttons: [] } }).then(() => null, (error) => error);
  assert.ok(conflict instanceof ConfigStoreError && conflict.code === "conflict", "baseRevision 不匹配 → conflict（后写者被拒）");
  assert.equal(conflict.revision, 2, "conflict 携带服务端当前 revision");
  assert.equal(readDoc().revision, 2, "被拒写入不改动文件");
  const unset = await store.writeSections({ baseRevision: 2, sections: { commands: null } });
  assert.equal(unset.revision, 3, "unset 亦为一次写入");
  assert.equal(readDoc().commands, undefined, "unset 删除该节（回落组合层）");
  await store.writeSections({ baseRevision: 3, sections: { directories: null, buttons: null } });
  assert.equal(storeSectionsOf(readDoc()), null, "全部节清空 ⇒ user: null");
  assert.equal(readDoc().migratedFrom, "web-user-layer", "重写保留 migratedFrom 标记");
  const rev = store.revision();
  assert.equal(rev, 4, "清空全部节的写入同样递增 revision");

  /* 校验拒绝（400 语义）：未知节 / 非数组 / 超上限 / baseRevision 缺失 */
  const bad = [
    [{ baseRevision: rev, sections: { nope: [] } }, /unknown section/],
    [{ baseRevision: rev, sections: { buttons: "oops" } }, /must be an array or null/],
    [{ baseRevision: rev, sections: {} }, /at least one section/],
    [{ sections: { buttons: [] } }, /baseRevision/],
    [{ baseRevision: rev, sections: { buttons: Array.from({ length: 33 }, (_v, i) => ({ name: `b${i}`, prompt: "p" })) } }, /exceeds 32/],
  ];
  for (const [request, pattern] of bad) {
    const error = await store.writeSections(request).then(() => null, (caught) => caught);
    assert.ok(error instanceof ConfigStoreError && error.code === "invalid", `非法负载 → invalid（${pattern}）`);
    assert.match(String(error.message), pattern);
  }
  assert.equal(readDoc().revision, rev, "非法负载不改动文件");

  /* 备份轮转：复制式，5 次写留 3 份，正式文件在替换前一刻恒存在（测试钩子断言） */
  const observed = [];
  const rotating = makeStore({
    now,
    sleep,
    onBeforeReplace: ({ filePath }) => {
      assert.ok(existsSync(filePath), "替换前一刻正式文件仍存在（无缺席窗口）");
      observed.push(readDoc().revision);
    },
  });
  rotating.refresh();
  const startRev = rotating.revision();
  for (let i = 0; i < 5; i += 1) {
    await rotating.writeSections({ baseRevision: startRev + i, sections: { buttons: [{ name: `b${i}`, prompt: "p", autoSend: false }] } });
    assert.ok(existsSync(storePath), "每次写入后正式文件存在");
  }
  assert.equal(readDoc().revision, startRev + 5, "连续 5 次写入 revision 依次递增");
  assert.deepEqual(observed, [startRev, startRev + 1, startRev + 2, startRev + 3, startRev + 4], "替换前读到的恒为完整旧内容（复制式轮转 + 原子替换）");
  assert.ok(existsSync(bak(1)) && existsSync(bak(2)) && existsSync(bak(3)), "保留 3 份备份");
  assert.ok(!existsSync(bak(4)), "更早的备份被轮转淘汰（最多 3 份）");
  assert.equal(readDoc(bak(1)).revision, startRev + 4, ".bak.1 = 上一次写入前内容");
  assert.equal(readDoc(bak(2)).revision, startRev + 3, ".bak.2 = 再上一次");
  assert.equal(readDoc(bak(3)).revision, startRev + 2, ".bak.3 = 上三次");

  /* ── 5. 损坏恢复链 ── */
  writeFileSync(storePath, "{ 这不是 JSON");
  const recovered1 = store.refresh();
  assert.equal(recovered1.revision, startRev + 4, "坏 JSON → 以 .bak.1 内容恢复为生效配置");
  assert.ok(warns.some((m) => m.includes("recovered from")), "恢复恰告警一次");
  const before = warns.length;
  store.refresh();
  assert.equal(warns.length, before, "同一进程内恢复告警只报一次（一次性闩）");
  writeFileSync(bak(1), "still broken");
  assert.equal(store.refresh().revision, startRev + 3, "主文件 + .bak.1 皆坏 → 继续沿 .bak.2 恢复");
  for (const i of [1, 2, 3]) writeFileSync(bak(i), "broken");
  const degradedWarns = warns.length;
  assert.equal(store.refresh(), null, "全损 → 按「存储缺席」处理（回落组合层）");
  assert.equal(warns.length, degradedWarns + 1, "全损恰告警一次");
  assert.deepEqual(store.snapshot(view), { status: "ready", revision: 0, value: view, base: view, user: null, writable: true }, "全损后快照按空存储呈现，不崩");
  /* 全损后仍可写入（baseRevision 0 创建） */
  const recreated = await store.writeSections({ baseRevision: 0, sections: { buttons: [{ name: "fresh", prompt: "p" }] } });
  assert.equal(recreated.revision, 1, "全损后 baseRevision: 0 重新创建存储");

  /* ── 6. 锁语义：独占创建 / 陈旧接管 / 等待超时 busy / 锁内 CAS ── */
  /* 6a. 独占创建：他人持锁（时间戳新鲜）→ 有界等待后 busy，文件不变 */
  const locked = makeStore({ now, sleep, lockWaitMs: 50, lockStepMs: 10 });
  locked.refresh();
  const revisionBefore = readDoc().revision;
  writeFileSync(lockPath, JSON.stringify({ pid: 999_999, at: now() }));
  const busy = await locked.writeSections({ baseRevision: revisionBefore, sections: { buttons: [] } }).then(() => null, (error) => error);
  assert.ok(busy instanceof ConfigStoreError && busy.code === "busy", "锁等待超时 → busy（503）");
  assert.equal(readDoc().revision, revisionBefore, "busy 不改动存储");
  assert.ok(existsSync(lockPath), "他人锁不被误删");

  /* 6b. 陈旧锁接管：时间戳超过阈值 → 接管重建并写入成功 */
  clock.at += 10_000;
  utimesSync(lockPath, new Date(), new Date(Date.now() - 60_000));
  const takenOver = await locked.writeSections({ baseRevision: revisionBefore, sections: { buttons: [{ name: "after-stale", prompt: "p" }] } });
  assert.equal(takenOver.revision, revisionBefore + 1, "陈旧锁被接管：写入成功（残留锁不永久拒写）");
  assert.ok(!existsSync(lockPath), "临界区结束释放锁");
  assert.deepEqual(readDoc().buttons, [{ name: "after-stale", prompt: "p", autoSend: false }], "接管后的写入落盘（按钮 autoSend 归一）");

  /* 6c. 锁内 CAS：两端基于同一 baseRevision 先后提交（假时钟推进，第二次在锁内被拒） */
  const casRev = readDoc().revision;
  const [w1, w2] = await Promise.all([
    locked.writeSections({ baseRevision: casRev, sections: { commands: [{ name: "one", prompt: "1" }] } }).then((r) => ({ ok: true, r }), (e) => ({ ok: false, e })),
    locked.writeSections({ baseRevision: casRev, sections: { commands: [{ name: "two", prompt: "2" }] } }).then((r) => ({ ok: true, r }), (e) => ({ ok: false, e })),
  ]);
  assert.equal([w1.ok, w2.ok].filter(Boolean).length, 1, "同时保存：恰一方成功（先写者不丢）");
  const loser = w1.ok ? w2 : w1;
  assert.ok(loser.e instanceof ConfigStoreError && loser.e.code === "conflict", "后写者拿到 conflict（409）");
  assert.deepEqual(readDoc().commands, [{ name: w1.ok ? "one" : "two", prompt: w1.ok ? "1" : "2" }], "文件保持胜者内容（无静默丢数据）");

  /* ── 7. 独占播种并发 / 空存储升级 / 非空不覆盖 ── */
  const racePath = join(base, "race.config.json");
  const viewA = normalizeView({ directories: ["F:/a"] });
  const viewB = normalizeView({ directories: ["F:/b"] });
  const [sa, sb] = await Promise.all([
    makeStore({ filePath: racePath, now, sleep }).ensureSeeded(viewA, { source: "entry-config" }),
    makeStore({ filePath: racePath, now, sleep }).ensureSeeded(viewB, { source: "entry-config" }),
  ]);
  const actions = [sa.action, sb.action].sort();
  assert.deepEqual(actions, ["kept", "seeded"], "双宿主并发播种：恰一方创建成功，败者重读按存在规则走");
  const raceDoc = readDoc(racePath);
  assert.ok(
    JSON.stringify(raceDoc.directories) === JSON.stringify(["F:\\a"]) || JSON.stringify(raceDoc.directories) === JSON.stringify(["F:\\b"]),
    "存储内容始终是某一方的完整视图（无交叉覆盖）",
  );
  assert.equal(raceDoc.revision, 1, "并发播种后 revision 仍为 1");

  /* 空存储升级：一端播种出无节存储 → 有配置的一端一次性覆盖升级（revision 保持 1） */
  const upPath = join(base, "upgrade.config.json");
  const upStore = makeStore({ filePath: upPath, now, sleep });
  upStore.seed(normalizeView(undefined), { source: "entry-config" });
  const upgraded = await upStore.ensureSeeded(normalizeView({ directories: ["F:/web"], buttons: [{ name: "b", prompt: "p" }] }), { source: "web-user-layer" });
  assert.equal(upgraded.action, "upgraded", "空存储 + 本机视图非空 → 一次性升级");
  assert.equal(readDoc(upPath).revision, 1, "升级保持 revision: 1");
  assert.deepEqual(readDoc(upPath).directories, ["F:\\web"], "升级写入本机完整视图");
  assert.equal(readDoc(upPath).migratedFrom, "entry-config", "升级保留原 migratedFrom");

  /* 非空不覆盖：已含任意节 → 任何后续激活都不自动改写 */
  const kept = await upStore.ensureSeeded(normalizeView({ directories: ["F:/other"] }), { source: "entry-config" });
  assert.equal(kept.action, "kept", "含节存储不被自动覆盖");
  assert.deepEqual(readDoc(upPath).directories, ["F:\\web"], "用户保存的值原样保留");
  /* forceUpgrade（本进程抢播的临时视图）才允许覆盖 */
  const forced = await upStore.ensureSeeded(normalizeView({ directories: ["F:/full"] }), { source: "web-user-layer", forceUpgrade: true });
  assert.equal(forced.action, "upgraded", "forceUpgrade：本进程抢播视图被完整组合层视图修正");
  assert.deepEqual(readDoc(upPath).directories, ["F:\\full"], "修正后的内容 = 完整组合层视图");

  /* ── 8. 热重载：外部写入（他端进程语义）触发去抖回调 ── */
  const reload = makeStore({ now, sleep, watchDebounceMs: 10, watchPollMs: 50 });
  reload.refresh();
  let fired = 0;
  const stopWatch = reload.watch(() => { fired += 1; });
  await new Promise((r) => setTimeout(r, 60));
  writeFileSync(storePath, `${JSON.stringify({ revision: 99, buttons: [{ name: "ext", prompt: "p" }] }, null, 2)}\n`);
  await new Promise((r) => setTimeout(r, 400));
  stopWatch();
  assert.ok(fired >= 1, "外部写入触发监视回调（他端保存本端跟随）");
  assert.deepEqual(reload.refresh().buttons, [{ name: "ext", prompt: "p", autoSend: false }], "重读拿到他端内容（无需重启）");

  /* 8b. 监视起于文件缺席（首次播种前，父目录已存在 = 真实 $DSH_HOME 形态）：
     改监视父目录并按文件名过滤 ⇒ 仍走事件快路径（不等 2s 轮询） */
  const latePath = join(base, "late", "v-skill-links.config.json");
  mkdirSync(dirname(latePath), { recursive: true });
  const lateStore = makeStore({ filePath: latePath, now, sleep, watchDebounceMs: 10 });
  let lateFired = 0;
  const stopLate = lateStore.watch(() => { lateFired += 1; });
  lateStore.seed(normalizeView({ directories: ["F:/late"] }), { source: "entry-config" });
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(lateFired >= 1, "文件缺席时监视父目录：播种后即收到事件（快路径，不必等 2s 轮询）");
  const lateBefore = lateFired;
  writeFileSync(latePath, `${JSON.stringify({ revision: 2, buttons: [{ name: "late", prompt: "p" }] }, null, 2)}\n`);
  await new Promise((r) => setTimeout(r, 200));
  stopLate();
  assert.ok(lateFired > lateBefore, "他端写入同样走事件快路径");
  assert.equal(lateStore.refresh().revision, 2, "缺席起监视的存储仍能读到新内容");

  assert.deepEqual(createConfigStore({ filePath: storePath }).refresh().revision, 99, "默认构造（无注入）读取同一文件");
  console.log("shared-store-smoke: ok");
} finally {
  rmSync(base, { recursive: true, force: true });
}
