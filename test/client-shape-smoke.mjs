/**
 * 客户端形状冒烟：lib/client.js 必须是 window.__ModuleLoader__.load factory 形态，
 * 并满足输入触发源契约（分组名 / order / onPick 文本）与设置卡片槽位契约。
 * 运行：node test/client-shape-smoke.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const here = fileURLToPath(new URL(".", import.meta.url));
const code = readFileSync(join(here, "..", "lib", "client.js"), "utf8");

assert.ok(code.startsWith("window.__ModuleLoader__.load("), "ModuleLoader factory 形态");
assert.ok(code.includes('id: "dsh-v-skill-links"'), "插件 id");
assert.ok(code.includes('name: "映射技能"'), "分组标题（词典未登记键原样展示）");
assert.ok(code.includes("trigger: \"/\""), "绑定 / 触发");
assert.ok(code.includes("order: -1"), "映射技能分组置顶（命令=默认 0 之前）");
assert.ok(code.includes('name: "自定义指令"') && code.includes("order: -0.5"), "自定义指令分组紧跟其后");
assert.ok(code.includes("registerSource(source)") && code.includes("registerSource(commandSource)"), "注册两个触发源");
assert.ok(code.includes("exports.inject = inject") && code.includes('const inject = ["inputTriggers", "slots", "locale", "settingsScope"]'), "声明服务依赖");
assert.ok(code.includes('fetch(API + "/list"'), "候选来自宿主 API");
assert.ok(code.includes("matchByName(data.skills, query)") && code.includes("matchByName(data.commands ?? [], query)"), "两个分组都用子串匹配");
assert.ok(code.includes("includes(q)") && code.includes("startsWith(q) ? 0 : 1"), "子串命中 + 前缀优先排序");
assert.ok(code.includes("return { text: `/${candidate.name} ` }"), "技能选中落 /name 字面文本");
assert.ok(code.includes('return "handled"') && code.includes("runCommand(session.sessionId, candidate.name)"), "自定义指令选中即执行");
assert.ok(code.includes('fetch(API + "/run"'), "执行走宿主 /run（followup）");
/* 设置节「技能管理」（settings.section + 节内标签页；旧插件配置卡片已移除） */
assert.ok(code.includes('"settings.section"'), "注册设置左栏第一层节");
assert.ok(code.includes('const SECTION_ID = "v-skills"') && code.includes("id: SECTION_ID"), "节 id v-skills");
assert.ok(code.includes('const SECTION_TAB_SLOT = "settings.v-skills.tab"') && code.includes("renderSlot(SECTION_TAB_SLOT, {}, { only: active })"), "节内标签页槽 + only 渲染");
assert.ok(code.includes("resolveSlotLabel"), "标签经官方 resolveSlotLabel 解析");
assert.ok(code.includes("SkillManagerSection") && code.includes("MappingPanel") && code.includes("CommandsPanel") && code.includes("QuickPanel"), "节组件 + 三个面板组件");
assert.ok(code.includes("installSectionCss") && code.includes("v-sm-section") && code.includes("v-sm-tab"), "节自有稳定 class（v-sm-*）");
assert.ok(!code.includes('"settings.plugin.item"'), "settings.plugin.item 旧卡片已移除");
assert.ok(code.includes('bind({'), "绑定设置作用域");
assert.ok(code.includes('scope.set("directories"') && code.includes('scope.set("commands"') && code.includes('scope.set("buttons"'), "保存写 directories / commands / buttons 节");
assert.ok(code.includes('scope.unset("directories"') && code.includes('scope.unset("commands"') && code.includes('scope.unset("buttons"'), "重置清对应覆盖");
assert.ok(code.includes("createSnapshotStore"), "快照存储驱动节状态");
/* 快捷按钮网格（conversation.composer.dock） */
assert.ok(code.includes('"conversation.composer.dock"'), "注册输入卡片下方 dock 槽");
assert.ok(code.includes('const DOCK_ID = "v-quick-buttons"') && code.includes("id: DOCK_ID"), "dock 条目 id（与官方 stats 行并肩）");
assert.ok(code.includes("order: -1"), "dock 紧贴输入卡片（stats=0 在其下）");
assert.ok(code.includes("QuickButtonsGrid") && code.includes("createButtonsStore") && code.includes("appendPrompt"), "dock 组件 / 快照 store / 追加语义齐备");
assert.ok(code.includes("inputActions.setDraft(") && code.includes("inputActions.submit()"), "点击走 InputActions 正门（追加 / 等同回车）");
assert.ok(code.includes("installDockCss") && code.includes("v-qb-grid") && code.includes("v-qb-btn") && code.includes("v-qb-label"), "dock 自有稳定 class（用户美化钩子）");
assert.ok(code.includes('"data-v-button"'), "按钮带 data-v-button 属性");
assert.ok(code.includes('require("@deepseek-ai/dsh-client-ui-primitives")'), "按钮底子 require 官方 primitives（design D6）");
/* hero 条目（conversation.input.dock：新增会话首屏，design D10；0.1.2-rc.1 起
   composer.dock 渲染点只在会话态（variant === "composer"）、input.dock 只看 zone 存在） */
assert.ok(code.includes('const DOCK_HERO_ID = "v-quick-buttons-hero"') && code.includes("id: DOCK_HERO_ID"), "hero 条目 id");
assert.ok(code.includes('"conversation.input.dock"'), "hero 条目注册输入区 dock 槽");
assert.ok(code.includes('session.openState === "open"') && code.includes("session.blank === true")
	&& code.includes("session.running !== true") && code.includes("session.promptAttempted !== true")
	&& code.includes("hero: true"), "hero 门控读 SessionSnapshot 原始字段（非 blank 首屏返回 null）");
assert.ok(code.includes("v-qb-grid--hero"), "hero 修饰类（CSS order 置于 hero 卡片下方）");
/* 对齐锚点 C（design D1 补充）：网格自我约束文本宽度列 + 按钮左聚拢 */
assert.ok(code.includes("minmax(96px,max-content)"), "网格列 max-content（按钮随内容收缩、自左聚拢）");
assert.ok(code.includes("max-width:var(--dsh-chat-content-width)"), "网格自我约束为输入文本宽度列（左缘=文本左缘）");
assert.ok(code.includes("max-width:220px"), "单钮 220px 封顶截断");
/* 快捷按钮排序（add-quick-buttons-reorder）：把手 / 指示线 / 上移下移 / 纯函数与动作 */
assert.ok(code.includes("v-sc-grip") && code.includes("v-sc-dropLine") && code.includes("v-sc-move"), "排序控件自有稳定 class（把手 / 指示线 / 上下移）");
assert.ok(code.includes("draggable: canReorder"), "draggable 仅置于把手（整行不可拖）");
assert.ok(code.includes("onDragStart") && code.includes("onDragOver") && code.includes("onDrop") && code.includes("onDragEnd"), "HTML5 DnD 事件胶水齐备（指示线 + 松手落下）");
assert.ok(code.includes("exports.moveButton = moveButton"), "排序纯函数导出（smoke 直测）");
assert.ok(code.includes("face.moveButton("), "面板经 face.moveButton 提交换位（暂存-保存模型）");
assert.ok(code.includes('"gripLabel"') && code.includes('"moveUp"') && code.includes('"moveDown"'), "词典含排序键（把手 aria-label / 上下移 title）");
assert.ok(code.includes("--dsw-alias-border-inverted)"), "排序控件配色走官方 token（明暗主题跟随）");
assert.ok(!/require\("(?!react"|@deepseek-ai\/dsh-client-store"|@deepseek-ai\/dsh-client-ui-primitives"|@deepseek-ai\/dsh-client-ui-slots")/.test(code), "require 仅限 react / client-store / primitives / slots（均静态种子词）");
/* 模块声明：store / primitives / slots 均为 shell 静态种子词，dsh.client 只留 platform（fix-dsh-012-compat design D2） */
const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8"));
assert.ok(!("inject" in pkg.dsh.client), "无 inject 声明（种子词无需动态 graph 行）");
assert.ok(!("external" in pkg.dsh.client), "无 external 声明（种子词无需 external）");
assert.equal(pkg.dsh.client.platform, "web", "platform 为 web");

/* 语法整体可解析（node --check 的兜底等价） */
new Function(code);
console.log("client-shape-smoke: ok");
