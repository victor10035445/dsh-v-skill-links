window.__ModuleLoader__.load({
	id: "dsh-v-skill-links",
	factory: (require) => {
		/* 本文件保持与官方 client bundle 相同的字节形态：window.__ModuleLoader__.load({ id, factory }) 开头。
		 *
		 * dsh-v-skill-links — 客户端。
		 *
		 * 三块功能：
		 *  1. '/' 触发菜单新分组「映射技能」（排在 命令 / 技能 之后）：
		 *     - 候选来自宿主 /api/v-skill-links/list（全局目录，TTL 缓存，失败回退旧数据）；
		 *     - 选中后与原生技能同形：向输入框落 `/name ` 字面文本；
		 *     - 发送后由宿主端的 agent/pre-step 监听器识别该令牌并注入 SKILL.md 全文。
		 *  2. 设置左栏第一层「技能管理」节（settings.section 槽，id v-skills）：三个标签页
		 *     技能映射 / 自定义指令 / 快捷功能，共享同一 settingsScope 控制器读写
		 *     directories / commands / buttons 节（暂存-保存模型、覆盖标记、重置回组合层）。
		 *  3. 快捷按钮网格（conversation.composer.dock 槽，输入卡片下方、输入文本宽度列）：
 *     点击 = InputActions.setDraft 追加 Prompt（一次机器事务）；autoSend = 追加后
 *     submit()（等同默认回车，发送整个输入区）。另注册 conversation.input.dock
 *     hero 条目：新增会话首屏（SessionSnapshot 空白相位原始字段）在 hero 卡片下方
 *     渲染同一网格（design D10；0.1.2-rc.1 已移除 composerPhase 派生字段，
 *     门控读 openState/blank/running/promptAttempted——fix-hero-gating-snapshot-fields）。
 *     配置与卡片共享 settingsScope，保存即热生效。
 *  4. 按钮模型绑定（add-quick-button-model）：按钮可带 `model = { provider, model,
 *     reasoningEffort? }`——设置行内模型/级别下拉（候选与会话模型菜单同源，走可选注入的
 *     官方 client remote `remote.session.modelCatalog`；`remote.<namespace>` 在 cordis
 *     是独立服务键，MUST 声明进 inject 列表才能解析（官方 ui-model-selection 同款）），
 *     点击时经 `remote.session.selectModel`
 *     把该会话切到绑定值（会话内持久、发送后不切回）；autoSend 先切后发；未绑定零动作；
 *     切换失败 toast 不阻断；目录不可用整体降级为「跟随会话模型」。
 */
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const { createElement: h, useCallback, useMemo, useRef, useState, useSyncExternalStore } = require("react");
		/* 快照 store（web shell 静态种子词 @deepseek-ai/dsh-client-store；裸包名 require——
		 * 种子表按原始 specifier 精确匹配，不带 /client 后缀；fix-dsh-012-compat design D1）。
		 * store.set 为深冻结整态替换：凡嵌入状态的数组/对象随即冻结，后续变更走不可变派生。 */
		const { createSnapshotStore } = require("@deepseek-ai/dsh-client-store");
		/* 官方 UI 原语（web shell 静态种子词，无需 dsh.client 声明）。 */
		const primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		/* 官方插槽工具（静态表内）：解析 section/tab 的 label 解析函数。 */
		const { resolveSlotLabel } = require("@deepseek-ai/dsh-client-ui-slots");

		//#region lib/client/const.js
		const API = "/api/v-skill-links";
		/** 列表缓存 TTL；过期后下一次按键重新拉取。 */
		const TTL_MS = 5000;
		/** 设置卡片编辑的命名空间（与宿主 lib/index.js 的 SETTINGS_NS 一致）。 */
		const SETTINGS_NS = "v-skill-links";
		/** 词典命名空间。 */
		const NS = "v-skill-links.settings";
		/** 必需服务：'/' 触发源、设置卡片所需的槽/词典/设置作用域。 */
		const inject = ["inputTriggers", "slots", "locale", "settingsScope"];
		/** 目录条数上限（与卡片提示一致）。 */
		const MAX_DIRS = 32;
		/** 快捷按钮条数上限（与卡片提示一致）。 */
		const MAX_BUTTONS = 32;
		/** conversation.composer.dock 槽位条目 id（与官方 stats 行并肩共存）。 */
		const DOCK_ID = "v-quick-buttons";
		/** conversation.input.dock 槽位条目 id（新增会话首屏 hero 条目，design D10）。 */
		const DOCK_HERO_ID = "v-quick-buttons-hero";
		/** 设置左栏第一层「技能管理」节（settings.section 条目 id）。 */
		const SECTION_ID = "v-skills";
		/** 「技能管理」节的标签页槽（section 的 children 声明，官方 plugins 页同构）。 */
		const SECTION_TAB_SLOT = "settings.v-skills.tab";
		//#endregion

		//#region lib/client/dictionaries.js
		const zh = {
			"title": "映射技能",
			"description": "技能目录 · 「/」菜单映射技能分组的数据源",
			"directoriesLabel": "技能目录（每行一个）",
			"directoriesHint": "支持绝对路径；~ 展开为用户主目录；相对路径按 dsh 启动目录解析。保存后立即生效，无需重启。",
			"effectivePrefix": "当前生效目录：",
			"basePrefix": "组合层 ",
			"overridden": "已自定义",
			"unsaved": "有未保存修改",
			"save": "保存",
			"saving": "保存中…",
			"discard": "放弃修改",
			"reset": "重置为组合层",
			"tooMany": "目录数量超过上限（32）",
			"saveFailed": "保存未生效，请重试",
			"notWritable": "当前连接不支持持久设置修改",
			"loading": "正在加载设置…",
			"commandsLabel": "自定义指令（followup：在「/」菜单选中即发送 Prompt 进会话）",
			"commandsHint": "出现在「/」菜单的「自定义指令」分组；选中即把 Prompt 作为用户消息发送进当前会话，Prompt 里可写 /映射技能 令牌。",
			"addCommand": "新增",
			"removeCommand": "删除",
			"commandNamePh": "名称（小写 a-z 0-9 _ -）",
			"commandPromptPh": "Prompt：选中后发送进会话的内容…",
			"commandNameRequired": "指令名称不能为空",
			"commandNameInvalid": "名称需以小写字母开头，仅含 a-z 0-9 _ -",
			"commandDup": "指令名称重复",
			"commandPromptRequired": "Prompt 不能为空",
			"resetCommands": "重置指令",
			"commandsCountPrefix": "自定义指令：",
			"toastSent": "已发送指令：",
			"toastFailed": "指令发送失败：",
			"buttonsLabel": "快捷按钮（输入框下方网格）",
			"buttonsHint": "点击按钮把 Prompt 追加进输入框（草稿非空时换行拼接）；勾选「自动发送」则在填入后立即按回车语义发送整个输入区。保存后立即生效，无需重启。",
			"addButton": "新增",
			"removeButton": "删除",
			"buttonNamePh": "名称（按钮上显示，可中文）",
			"buttonPromptPh": "Prompt：点击后追加进输入框的内容…",
			"autoSendLabel": "自动发送",
			"buttonNameRequired": "按钮名称不能为空",
			"buttonDup": "按钮名称重复",
			"buttonPromptRequired": "Prompt 不能为空",
			"tooManyButtons": "按钮数量超过上限（32）",
			"resetButtons": "重置按钮",
			"buttonsCountPrefix": "快捷按钮：",
			"buttonModelLabel": "模型",
			"buttonEffortLabel": "级别",
			"buttonModelFollow": "跟随会话模型（默认）",
			"modelCatalogFallback": "模型目录不可用：仅可选择「跟随会话模型」，点击绑定模型的按钮将跳过切换。",
			"modelUnavailable": "不可用",
			"switchFailed": "模型切换失败：",
			"switchUnavailable": "模型切换不可用：当前连接不支持（按钮已按会话当前模型填入）",
			"gripLabel": "拖动调整顺序",
			"moveUp": "上移",
			"moveDown": "下移",
			"dockAriaLabel": "快捷按钮",
			"nav": "技能管理",
			"title": "技能管理",
			"intro": "映射技能 · 自定义指令 · 快捷按钮的统一管理入口；修改后点各页底部的「保存」立即生效。",
			"tabsAria": "技能管理分区",
			"tabMapping": "技能映射",
			"tabCommands": "自定义指令",
			"tabQuick": "快捷功能"
		};
		const en = {
			"title": "Mapped skills",
			"description": "Skill directories · source of the / menu \"Mapped skills\" group",
			"directoriesLabel": "Skill directories (one per line)",
			"directoriesHint": "Absolute paths; ~ expands to your home directory; relative paths resolve against the dsh startup directory. Changes apply immediately, no restart needed.",
			"effectivePrefix": "Effective directories: ",
			"basePrefix": "composition layer ",
			"overridden": "customized",
			"unsaved": "unsaved changes",
			"save": "Save",
			"saving": "Saving…",
			"discard": "Discard",
			"reset": "Reset to composition",
			"tooMany": "Too many directories (limit 32)",
			"saveFailed": "Save did not land, please retry",
			"notWritable": "This connection cannot persist settings",
			"loading": "Loading settings…",
			"commandsLabel": "Custom commands (followup: picking one in the / menu sends its Prompt into the session)",
			"commandsHint": "Shown under the / menu's \"Custom commands\" group; picking one sends the Prompt as a user message into the current session. Prompts may contain /mapped-skill tokens.",
			"addCommand": "Add",
			"removeCommand": "Remove",
			"commandNamePh": "name (lowercase a-z 0-9 _ -)",
			"commandPromptPh": "Prompt sent into the session on pick…",
			"commandNameRequired": "Command name is required",
			"commandNameInvalid": "Name must start with a lowercase letter and contain only a-z 0-9 _ -",
			"commandDup": "Duplicate command name",
			"commandPromptRequired": "Prompt is required",
			"resetCommands": "Reset commands",
			"commandsCountPrefix": "Custom commands: ",
			"toastSent": "Command sent: ",
			"toastFailed": "Failed to send command: ",
			"buttonsLabel": "Quick buttons (grid under the input box)",
			"buttonsHint": "Clicking a button appends its Prompt into the input box (joined with a newline when the draft is not empty); with \"Auto-send\" checked, the whole input box is submitted right after filling (Enter semantics). Changes apply immediately on save, no restart needed.",
			"addButton": "Add",
			"removeButton": "Remove",
			"buttonNamePh": "name (shown on the button; any text)",
			"buttonPromptPh": "Prompt appended into the input box on click…",
			"autoSendLabel": "Auto-send",
			"buttonNameRequired": "Button name is required",
			"buttonDup": "Duplicate button name",
			"buttonPromptRequired": "Prompt is required",
			"tooManyButtons": "Too many buttons (limit 32)",
			"resetButtons": "Reset buttons",
			"buttonsCountPrefix": "Quick buttons: ",
			"buttonModelLabel": "Model",
			"buttonEffortLabel": "Effort",
			"buttonModelFollow": "Follow session model (default)",
			"modelCatalogFallback": "Model catalog unavailable: only \"follow session model\" is offered; clicking a model-bound button skips switching.",
			"modelUnavailable": "unavailable",
			"switchFailed": "Model switch failed: ",
			"switchUnavailable": "Model switching unavailable on this connection (the button filled the session's current model)",
			"gripLabel": "Drag to reorder",
			"moveUp": "Move up",
			"moveDown": "Move down",
			"dockAriaLabel": "Quick buttons",
			"nav": "Skill manager",
			"title": "Skill manager",
			"intro": "One place for mapped skills, custom commands and quick buttons; click \"Save\" at the bottom of a tab to apply immediately.",
			"tabsAria": "Skill manager tabs",
			"tabMapping": "Skill mapping",
			"tabCommands": "Custom commands",
			"tabQuick": "Quick buttons"
		};
		//#endregion

		//#region lib/client/settings-card-css.js
		const CARD_CSS = ".v-sc-card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);border-radius:12px;display:flex;flex-direction:column;overflow:hidden}.v-sc-head{align-items:center;gap:8px;width:100%;text-align:left;background:0 0;border:0;padding:10px 12px;cursor:pointer;color:var(--dsw-alias-label-primary);font:inherit;display:flex}.v-sc-head:hover{background:var(--dsw-alias-interactive-bg-hover)}.v-sc-caret{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .12s;font-size:10px}.v-sc-caret[data-open=true]{transform:rotate(90deg)}.v-sc-titles{flex-direction:column;min-width:0;flex:1;display:flex}.v-sc-title{font-size:14px;line-height:20px;font-weight:500}.v-sc-desc{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.v-sc-badge{flex:none;border-radius:999px;padding:1px 8px;font-size:11px;line-height:16px;background:var(--dsw-alias-interactive-bg-hover-solid);color:var(--dsw-alias-label-secondary)}.v-sc-badgeDim{background:0 0;border:1px solid var(--dsw-alias-border-l2)}.v-sc-body{flex-direction:column;gap:6px;padding:2px 12px 12px;border-top:1px solid var(--dsw-alias-border-l2);display:flex}.v-sc-label{font-size:12px;color:var(--dsw-alias-label-secondary);margin-top:8px}.v-sc-input{resize:vertical;min-height:64px;font:var(--dsw-font-markdown-code-block-small, 12px ui-monospace, SFMono-Regular, Menlo, monospace);color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px 10px;outline:none}.v-sc-input:focus{border-color:var(--dsw-alias-border-inverted)}.v-sc-input:disabled{opacity:.55}.v-sc-hint{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:16px}.v-sc-meta{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:16px}.v-sc-error{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:16px}.v-sc-actions{gap:8px;justify-content:flex-end;margin-top:2px;display:flex}.v-sc-btn{cursor:pointer;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);border-radius:6px;padding:3px 10px;font-size:12px;line-height:18px}.v-sc-btn:hover:not(:disabled){color:var(--dsw-alias-label-primary)}.v-sc-btn:disabled{opacity:.5;cursor:not-allowed}.v-sc-btnPrimary{background:var(--dsw-alias-state-business-primary);border-color:transparent;color:#fff}.v-sc-loading{color:var(--dsw-alias-label-dimmed);padding:10px 12px;font-size:13px}.v-sc-secHead{align-items:center;gap:8px;margin-top:8px;display:flex}.v-sc-secHead .v-sc-label{margin-top:0;flex:1}.v-sc-row{flex-direction:column;gap:4px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:8px;display:flex}.v-sc-rowHead{align-items:center;gap:6px;display:flex}.v-sc-cmdName{flex:1;min-width:0;font:var(--dsw-font-markdown-code-block-small, 12px ui-monospace, SFMono-Regular, Menlo, monospace);color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:3px 8px;outline:none}.v-sc-cmdName:focus{border-color:var(--dsw-alias-border-inverted)}.v-sc-remove{cursor:pointer;border:0;background:0 0;color:var(--dsw-alias-label-tertiary);font-size:14px;line-height:18px;padding:2px 6px;border-radius:6px}.v-sc-remove:hover{color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-interactive-bg-hover)}.v-sc-remove:disabled{opacity:.4;cursor:not-allowed}.v-sc-cmdPrompt{resize:vertical;min-height:44px;font:var(--dsw-font-markdown-code-block-small, 12px ui-monospace, SFMono-Regular, Menlo, monospace);color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 8px;outline:none}.v-sc-cmdPrompt:focus{border-color:var(--dsw-alias-border-inverted)}.v-sc-cmdPrompt:disabled{opacity:.55}.v-sc-addBtn{cursor:pointer;border:1px dashed var(--dsw-alias-border-l2);background:0 0;color:var(--dsw-alias-label-secondary);border-radius:8px;padding:3px 10px;font-size:12px;line-height:18px}.v-sc-addBtn:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-inverted)}.v-sc-addBtn:disabled{opacity:.5;cursor:not-allowed}.v-sc-toast{position:fixed;left:50%;transform:translateX(-50%);bottom:96px;z-index:9999;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);border-radius:10px;padding:8px 14px;font-size:13px;opacity:0;transition:opacity .15s;pointer-events:none;box-shadow:var(--dsw-shadow-lv2)}.v-sc-toast[data-show=true]{opacity:1}.v-sc-toast[data-error=true]{color:var(--dsw-alias-state-error-primary)}.v-sc-row{position:relative}.v-sc-grip{flex:none;align-self:stretch;display:inline-flex;align-items:center;justify-content:center;width:14px;cursor:grab;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:18px;user-select:none;-webkit-user-select:none}.v-sc-grip:hover{color:var(--dsw-alias-label-secondary)}.v-sc-grip[data-disabled=true]{cursor:not-allowed;opacity:.45}.v-sc-move{flex:none;cursor:pointer;width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;padding:0;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);border-radius:6px;font-size:12px;line-height:1}.v-sc-move:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-inverted);background:var(--dsw-alias-interactive-bg-hover)}.v-sc-move:disabled{opacity:.4;cursor:not-allowed}.v-sc-dropLine{position:absolute;left:4px;right:4px;height:2px;border-radius:1px;background:var(--dsw-alias-border-inverted);z-index:1;pointer-events:none}.v-sc-dropLine[data-edge=before]{top:-3px}.v-sc-dropLine[data-edge=after]{bottom:-3px}.v-sc-modelRow{align-items:center;gap:10px;flex-wrap:wrap;display:flex}.v-sc-modelField{align-items:center;gap:6px;display:inline-flex;min-width:0}.v-sc-modelCap{flex:none;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:16px}.v-sc-select{cursor:pointer;min-width:0;max-width:280px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:3px 6px;font:inherit;font-size:12px;line-height:18px;outline:none}.v-sc-select:focus{border-color:var(--dsw-alias-border-inverted)}.v-sc-select:disabled{opacity:.55;cursor:not-allowed}.v-sc-modelHint{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:16px}";
		function installCardCss() {
			if (typeof document === "undefined") return;
			const tagId = "dsh-v-skill-links/settings-card.css";
			if (document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") !== null) return;
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-v-skill-links";
			tag.dataset.pluginCss = tagId;
			tag.textContent = CARD_CSS;
			document.head.appendChild(tag);
		}
		//#endregion

		//#region lib/client/settings-card-controller.js
		const COMMAND_NAME = /^[a-z][a-z0-9_-]*$/;
		const MAX_COMMANDS = 32;
		const commandsOf = (section) => {
			if (!section || typeof section !== "object" || !Array.isArray(section.commands)) return [];
			return section.commands.filter((c) => c && typeof c === "object" && typeof c.name === "string" && typeof c.prompt === "string");
		};
		const deepCopyCommands = (list) => list.map((c) => ({ name: c.name, prompt: c.prompt }));
		const buttonsOf = (section) => {
			if (!section || typeof section !== "object" || !Array.isArray(section.buttons)) return [];
			return section.buttons.filter((b) => b && typeof b === "object" && typeof b.name === "string" && typeof b.prompt === "string");
		};
		/**
		 * 按钮模型绑定归一化（design D1/D8）：非法/缺省 → undefined（未绑定）；键序固定
		 * provider → model → reasoningEffort，无等级 MUST NOT 输出该键（与宿主归一化同口径）。
		 */
		function buttonModelOf(raw) {
			if (!raw || typeof raw !== "object") return undefined;
			const provider = typeof raw.provider === "string" ? raw.provider : "";
			const id = typeof raw.model === "string" ? raw.model : "";
			if (!provider || !id) return undefined;
			return typeof raw.reasoningEffort === "string" && raw.reasoningEffort !== ""
				? { provider, model: id, reasoningEffort: raw.reasoningEffort }
				: { provider, model: id };
		}
		/**
		 * 按钮条目构造：键序固定 name → prompt → autoSend → model（model 对象的唯一构造路径，
		 * buttonsEqual 的 JSON 串比较依赖键序稳定）；未绑定 MUST NOT 输出 model 键。
		 */
		function buttonEntry(source) {
			const entry = { name: source.name, prompt: source.prompt, autoSend: source.autoSend === true };
			const model = buttonModelOf(source.model);
			if (model !== undefined) entry.model = model;
			return entry;
		}
		const deepCopyButtons = (list) => list.map((b) => buttonEntry(b));
		const buttonsEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
		/** 校验一条指令草稿；返回 "" 表示通过，否则返回错误词典键。 */
		function commandIssue(list) {
			const seen = new Set();
			for (const c of list) {
				const name = c.name.trim().toLowerCase();
				if (!name) return "commandNameRequired";
				if (!COMMAND_NAME.test(name)) return "commandNameInvalid";
				if (seen.has(name)) return "commandDup";
				seen.add(name);
				if (!c.prompt.trim()) return "commandPromptRequired";
			}
			if (list.length > MAX_COMMANDS) return "tooManyCommands";
			return "";
		}
		/** 校验一份按钮草稿；返回 "" 表示通过，否则返回错误词典键。name 是显示名：非空即可，不做小写归一。 */
		function buttonIssue(list) {
			const seen = new Set();
			for (const b of list) {
				const name = b.name.trim();
				if (!name) return "buttonNameRequired";
				if (seen.has(name)) return "buttonDup";
				seen.add(name);
				if (!b.prompt.trim()) return "buttonPromptRequired";
			}
			if (list.length > MAX_BUTTONS) return "tooManyButtons";
			return "";
		}
		/**
		 * 按钮排序纯函数（design D5）：把第 from 条移到第 to 位（索引 splice 换位）。
		 * 索引是排序期唯一可靠标识（草稿 name 可空/可改/可重名），不依赖名称内容；
		 * 不 mutate 输入，恒返回新数组；from/to 越界或相等时返回等价原序的新数组（空操作）。
		 */
		function moveButton(list, from, to) {
			const base = Array.isArray(list) ? list : [];
			if (!Number.isInteger(from) || !Number.isInteger(to)) return base.slice();
			if (from === to || from < 0 || from >= base.length || to < 0 || to >= base.length) return base.slice();
			const next = base.slice();
			const [moved] = next.splice(from, 1);
			next.splice(to, 0, moved);
			return next;
		}
		/**
		 * 「映射技能」设置卡片的暂存-保存控制器：桥接 settingsScope 到卡片状态。
		 * 暂存只改本地草稿；保存才写入 directories / commands 节（revision 由 scope 收口）。
		 * @param scope - ctx.settingsScope.bind({ namespace: SETTINGS_NS, decode }) 的作用域。
		 * @returns 卡片 face：快照源（getSnapshot/subscribe）+ 官方 CardActions 同形的动作。
		 */
		function createCardController(scope) {
			const store = createSnapshotStore({
				status: "loading",
				available: false,
				writable: false,
				mode: "host",
				dirty: false,
				invalid: false,
				invalidReason: "",
				saving: false,
				failed: false,
				text: "",
				overridden: false,
				effective: [],
				baseDirs: [],
				count: 0,
				commandsDraft: [],
				commandsDirty: false,
				commandsInvalid: false,
				commandsInvalidReason: "",
				commandsOverridden: false,
				effectiveCommands: [],
				baseCommandsCount: 0,
				buttonsDraft: [],
				buttonsDirty: false,
				buttonsInvalid: false,
				buttonsInvalidReason: "",
				buttonsOverridden: false,
				effectiveButtons: [],
				baseButtonsCount: 0
			});
			let staged = null; // string | null：目录草稿；null = 跟随生效值
			let stagedCommands = null; // Array | null：指令草稿；null = 跟随生效值
			let stagedButtons = null; // Array | null：按钮草稿；null = 跟随生效值
			let saving = false;
			let failed = false;
			const parseLines = (text) => String(text ?? "").split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
			const dirsOf = (section) => section && typeof section === "object" && Array.isArray(section.directories) ? section.directories : [];
			const commandsEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
			const publish = () => {
				const snap = scope.getSnapshot();
				const effective = dirsOf(snap.value);
				const seedText = effective.join("\n");
				const text = staged === null ? seedText : staged;
				const lines = parseLines(text);
				const dirsInvalid = lines.length > MAX_DIRS;
				const effectiveCommands = commandsOf(snap.value);
				const draft = stagedCommands === null ? deepCopyCommands(effectiveCommands) : stagedCommands;
				const commandsInvalidReason = commandIssue(draft);
				const commandsDirty = stagedCommands !== null && !commandsEqual(stagedCommands, effectiveCommands);
				const effectiveButtons = buttonsOf(snap.value);
				const buttonsDraft = stagedButtons === null ? deepCopyButtons(effectiveButtons) : stagedButtons;
				const buttonsInvalidReason = buttonIssue(buttonsDraft);
				const buttonsDirty = stagedButtons !== null && !buttonsEqual(stagedButtons, effectiveButtons);
				store.set({
					status: snap.status,
					available: snap.status !== "unavailable",
					writable: snap.writable === true,
					mode: snap.mode,
					dirty: (staged !== null && staged !== seedText) || commandsDirty || buttonsDirty,
					invalid: dirsInvalid || commandsInvalidReason !== "" || buttonsInvalidReason !== "",
					invalidReason: dirsInvalid ? "tooMany" : "",
					saving,
					failed,
					text,
					overridden: snap.user !== null && typeof snap.user === "object" && Array.isArray(snap.user.directories),
					effective,
					baseDirs: dirsOf(snap.base),
					count: lines.length,
					commandsDraft: draft,
					commandsDirty,
					commandsInvalid: commandsInvalidReason !== "",
					commandsInvalidReason,
					commandsOverridden: snap.user !== null && typeof snap.user === "object" && Array.isArray(snap.user.commands),
					effectiveCommands,
					baseCommandsCount: commandsOf(snap.base).length,
					buttonsDraft,
					buttonsDirty,
					buttonsInvalid: buttonsInvalidReason !== "",
					buttonsInvalidReason,
					buttonsOverridden: snap.user !== null && typeof snap.user === "object" && Array.isArray(snap.user.buttons),
					effectiveButtons,
					baseButtonsCount: buttonsOf(snap.base).length
				});
			};
			/* 作用域一变就重发布；创建时先做一次初始发布，否则卡片永远停在 available:false 而渲染 null。 */
			const unsubscribeScope = scope.subscribe(publish);
			publish();
			return {
				getSnapshot: store.getSnapshot,
				subscribe: store.subscribe,
				hooks: { card: store },
				/** 暂存目录草稿（与官方卡片的 CardActions 同形）。 */
				edit(_field, text) {
					staged = text;
					failed = false;
					publish();
				},
				/** 新增一条空指令草稿。 */
				addCommand() {
					const snap = scope.getSnapshot();
					const base = stagedCommands === null ? deepCopyCommands(commandsOf(snap.value)) : stagedCommands;
					if (base.length >= MAX_COMMANDS) return;
					stagedCommands = [...base, { name: "", prompt: "" }];
					failed = false;
					publish();
				},
				/** 删除第 index 条指令草稿。 */
				removeCommand(index) {
					const snap = scope.getSnapshot();
					const base = stagedCommands === null ? deepCopyCommands(commandsOf(snap.value)) : stagedCommands;
					stagedCommands = base.filter((_c, i) => i !== index);
					failed = false;
					publish();
				},
				/** 编辑第 index 条指令草稿的 name/prompt 字段。 */
				editCommand(index, field, value) {
					const snap = scope.getSnapshot();
					const base = stagedCommands === null ? deepCopyCommands(commandsOf(snap.value)) : stagedCommands;
					stagedCommands = base.map((c, i) => (i === index ? { ...c, [field]: value } : c));
					failed = false;
					publish();
				},
				/** 新增一条空按钮草稿。 */
				addButton() {
					const snap = scope.getSnapshot();
					const base = stagedButtons === null ? deepCopyButtons(buttonsOf(snap.value)) : stagedButtons;
					if (base.length >= MAX_BUTTONS) return;
					stagedButtons = [...base, { name: "", prompt: "", autoSend: false }];
					failed = false;
					publish();
				},
				/** 删除第 index 条按钮草稿。 */
				removeButton(index) {
					const snap = scope.getSnapshot();
					const base = stagedButtons === null ? deepCopyButtons(buttonsOf(snap.value)) : stagedButtons;
					stagedButtons = base.filter((_b, i) => i !== index);
					failed = false;
					publish();
				},
				/** 编辑第 index 条按钮草稿的 name/prompt/autoSend/model 字段。 */
				editButton(index, field, value) {
					const snap = scope.getSnapshot();
					const base = stagedButtons === null ? deepCopyButtons(buttonsOf(snap.value)) : stagedButtons;
					stagedButtons = base.map((b, i) => {
						if (i !== index) return b;
						/* model 字段（design D8）：值 = 模型对象或 undefined，与既有字段同构；
						   设为未绑定时 MUST 删除 model 键（不留 model: undefined）。 */
						if (field === "model") return buttonEntry({ ...b, model: value });
						return { ...b, [field]: value };
					});
					failed = false;
					publish();
				},
				/** 移动第 from 条按钮草稿到第 to 位（排序：与 add/remove/edit 同构，只换位不增删；越界/相等为空操作）。 */
				moveButton(from, to) {
					const snap = scope.getSnapshot();
					const base = stagedButtons === null ? deepCopyButtons(buttonsOf(snap.value)) : stagedButtons;
					stagedButtons = moveButton(base, from, to);
					failed = false;
					publish();
				},
				/** 重置快捷按钮：清掉用户层 buttons，回退组合层配置。 */
				async resetButtons() {
					if (store.getSnapshot().writable !== true) return;
					stagedButtons = null;
					failed = false;
					saving = true;
					publish();
					try {
						await scope.unset("buttons");
					} catch {
						failed = true;
					}
					saving = false;
					publish();
				},
				/** 重置目录：清掉用户层 directories，回退组合层（补丁文件）配置。 */
				async resetField() {
					if (store.getSnapshot().writable !== true) return;
					staged = null;
					failed = false;
					saving = true;
					publish();
					try {
						await scope.unset("directories");
					} catch {
						failed = true;
					}
					saving = false;
					publish();
				},
				/** 重置自定义指令：清掉用户层 commands。 */
				async resetCommands() {
					if (store.getSnapshot().writable !== true) return;
					stagedCommands = null;
					failed = false;
					saving = true;
					publish();
					try {
						await scope.unset("commands");
					} catch {
						failed = true;
					}
					saving = false;
					publish();
				},
				/** 写全部暂存草稿；失败保留草稿供修正（Host 是唯一裁决者）。 */
				async save() {
					const current = store.getSnapshot();
					if (!current.writable || current.invalid || !current.dirty) return;
					saving = true;
					publish();
					try {
						if (staged !== null) await scope.set("directories", parseLines(staged));
						if (stagedCommands !== null) {
							await scope.set("commands", stagedCommands.map((c) => ({ name: c.name.trim().toLowerCase(), prompt: c.prompt.trim() })));
						}
						if (stagedButtons !== null) {
							await scope.set("buttons", stagedButtons.map((b) => {
								const entry = { name: b.name.trim(), prompt: b.prompt.trim(), autoSend: b.autoSend === true };
								const model = buttonModelOf(b.model);
								if (model !== undefined) entry.model = model;
								return entry;
							}));
						}
						staged = null;
						stagedCommands = null;
						stagedButtons = null;
						failed = false;
					} catch {
						failed = true;
					}
					saving = false;
					publish();
				},
				discard() {
					staged = null;
					stagedCommands = null;
					stagedButtons = null;
					failed = false;
					publish();
				},
				dispose() {
					unsubscribeScope();
				}
			};
		}
		//#endregion

		//#region lib/client/model-catalog.js
		/* 模型目录桥（add-quick-button-model，design D2/D3/D5/D10）：目录与切换都走官方 client
		   remote（ctx.remote.session.modelCatalog / selectModel）——与会话模型菜单读同一份宿主
		   导出，不依赖任何 UI 插件；`remote.<namespace>` 是独立服务键（不是 remote 实例的
		   属性），作用域 MUST 声明 "remote.session" 才允许解析，否则读取直接抛
		   "cannot get property … without inject"；注入不可用时整体降级（目录 error、切换
		   unavailable）。本区纯函数同时被面板渲染、点击路径与 smoke 直测使用。 */

		/** 已知推理等级顺序（官方两处适配器实测一致升序：pi-ai / deepseek；design D5）。 */
		const EFFORT_ORDER = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

		/**
		 * 级别默认最高（design D5，纯函数）：在已知等级序里取最大者；出现未知等级 id 时
		 * 退回列表末项（两处适配器实测均升序，未知 id 无法排序）。
		 * @param {Array<{id?: string, name?: string}>|undefined} efforts - 目录条目的等级列表。
		 * @returns {string|undefined} 选中的等级 id；空列表/无等级元数据 → undefined。
		 */
		function highestEffort(efforts) {
			const list = (Array.isArray(efforts) ? efforts : [])
				.filter((effort) => effort && typeof effort === "object" && typeof effort.id === "string" && effort.id !== "");
			if (list.length === 0) return undefined;
			let best;
			let bestRank = -1;
			for (const effort of list) {
				const rank = EFFORT_ORDER.indexOf(effort.id);
				if (rank === -1) return list[list.length - 1].id; /* 未知 id：退回列表末项 */
				if (rank > bestRank) {
					bestRank = rank;
					best = effort.id;
				}
			}
			return best;
		}

		/**
		 * 模型键编解码：`provider/model[/effort]`（与同仓库 dsh-v-hive `modelKeyOf` 同路数，
		 * 作为受控值与 `<option>` value 的唯一出处，避免 JSON-in-DOM）。模型下拉用无等级
		 * 形态（等级由级别下拉单独承载）。
		 * @param {{provider?: string, model?: string, reasoningEffort?: string}|undefined} model
		 * @returns {string} 键；形状不足 → ""。
		 */
		function modelKeyOf(model) {
			if (!model || typeof model !== "object") return "";
			const provider = typeof model.provider === "string" ? model.provider : "";
			const id = typeof model.model === "string" ? model.model : "";
			if (!provider || !id) return "";
			return typeof model.reasoningEffort === "string" && model.reasoningEffort !== ""
				? `${provider}/${id}/${model.reasoningEffort}`
				: `${provider}/${id}`;
		}

		/**
		 * 目录 → 下拉候选项展开（design D2/D10）：候选按目录顺序（即 provider 分组序）排列，
		 * label 形如 `provider.name · model.name`；键 = provider/model，值表同时给出该模型的
		 * 等级列表（级别下拉的查表来源）。
		 * @param {Array|undefined} groups - 目录 groups（modelCatalog 的 value.groups）。
		 * @returns {{items: Array<{key: string, label: string}>, byKey: Map<string, {provider: string, model: string, label: string, efforts: Array}>}}
		 */
		function catalogOptions(groups) {
			const items = [];
			const byKey = new Map();
			for (const group of Array.isArray(groups) ? groups : []) {
				if (!group || typeof group !== "object") continue;
				const provider = typeof group.id === "string" ? group.id : "";
				if (!provider) continue;
				const providerName = typeof group.name === "string" && group.name !== "" ? group.name : provider;
				for (const entry of Array.isArray(group.models) ? group.models : []) {
					if (!entry || typeof entry !== "object" || typeof entry.id !== "string" || entry.id === "") continue;
					const key = modelKeyOf({ provider, model: entry.id });
					if (byKey.has(key)) continue; /* 重键先到先得（与宿主目录口径一致） */
					const modelName = typeof entry.name === "string" && entry.name !== "" ? entry.name : entry.id;
					const efforts = (Array.isArray(entry.reasoning?.efforts) ? entry.reasoning.efforts : [])
						.filter((effort) => effort && typeof effort === "object" && typeof effort.id === "string" && effort.id !== "");
					const label = `${providerName} · ${modelName}`;
					byKey.set(key, { provider, model: entry.id, label, efforts });
					items.push({ key, label });
				}
			}
			return { items, byKey };
		}

		/**
		 * 模型目录桥（可选注入 remote / sessions，design D2/D3/D6）：
		 * - 目录 store（status + groups）：构造即预取（官方模型目录同款）；随官方同款三个 remote
		 *   事件重载、连接重置清旧值；失败/注入不可用 → status: "error"（面板降级）；
		 * - 切换收敛为单处 `remote.session.selectModel`，**显式判结果信封 ok**（失败不抛异常）；
		 * - 无该命名空间/断连 → 切换返回 `{ ok: false, unavailable: true }`，由点击路径统一 toast。
		 * @param {{remote?: any, sessions?: any, on?: (event: string, listener: () => void) => any}} scope - 注入作用域（或同形桩）。
		 * @returns 桥面：目录 face（getSnapshot/subscribe，供面板展开候选项）+ canSwitch + select + dispose。
		 *   scope.remote MUST 携带 session 命名空间（作用域声明 "remote.session" 后方可经
		 *   `scope.remote.session` 解析，见 createModelBridge 区注释）；桩环境直接给同形对象。
		 */
		function createModelBridge(scope) {
			const remote = scope && typeof scope === "object" ? scope.remote : undefined;
			const sessions = scope && typeof scope === "object" ? scope.sessions : undefined;
			const session = remote && typeof remote === "object" ? remote.session : undefined;
			const supportsCatalog = session !== undefined && session !== null && typeof session.modelCatalog === "function";
			const store = createSnapshotStore({ status: "idle", groups: [] });
			/* generation：使在途响应失效（刷新/连接重置后旧目录 MUST NOT 落到新世代）。 */
			let generation = 0;
			let inflight = null;
			const load = () => {
				if (!supportsCatalog) {
					store.set({ status: "error", groups: [] });
					return Promise.resolve();
				}
				if (inflight !== null) return inflight;
				const token = generation;
				store.set({ status: "loading", groups: [] });
				const operation = Promise.resolve()
					.then(() => session.modelCatalog())
					.then((response) => {
						if (token !== generation) return;
						if (!response || response.ok !== true) {
							store.set({ status: "error", groups: [] });
							return;
						}
						const value = response.value;
						store.set({ status: "ready", groups: value && Array.isArray(value.groups) ? value.groups : [] });
					})
					.catch(() => {
						if (token === generation) store.set({ status: "error", groups: [] });
					})
					.finally(() => {
						if (inflight === operation) inflight = null;
					});
				inflight = operation;
				return operation;
			};
			const refresh = () => {
				generation += 1;
				inflight = null;
				load();
			};
			const reset = () => {
				generation += 1;
				inflight = null;
				store.set({ status: "idle", groups: [] }); /* 连接重置：清旧值 */
				load();
			};
			const offs = [];
			if (remote && typeof remote.$on === "function") {
				for (const event of ["llm/adapters-updated", "settings/document-updated", "credentials/reference-updated"]) {
					const off = remote.$on(event, refresh);
					if (typeof off === "function") offs.push(off);
				}
			}
			if (scope && typeof scope.on === "function") {
				const off = scope.on("connection/reset", reset);
				if (typeof off === "function") offs.push(off);
			}
			load();
			return {
				getSnapshot: store.getSnapshot,
				subscribe: store.subscribe,
				/** 会话可切换判据（design D7）：子代理会话与无会话 id 一律 false。 */
				canSwitch(sessionId) {
					if (typeof sessionId !== "string" || sessionId === "") return false;
					if (!sessions || typeof sessions.subagentAddress !== "function") return false;
					return sessions.subagentAddress(sessionId) === undefined;
				},
				/**
				 * 切换（design D3/D6）：显式判结果信封 ok；失败不抛，统一返回给点击路径走降级分支。
				 * @returns {Promise<{ok: boolean, unavailable?: boolean, error: string}>}
				 */
				async select(sessionId, model) {
					if (session === undefined || session === null || typeof session.selectModel !== "function") {
						return { ok: false, unavailable: true, error: "" };
					}
					const request = {
						sessionId,
						provider: model.provider,
						model: model.model,
						...(model.reasoningEffort === undefined ? {} : { reasoningEffort: model.reasoningEffort })
					};
					let response;
					try {
						response = await session.selectModel(request);
					} catch (error) {
						return { ok: false, error: String(error?.message || error) };
					}
					if (!response || response.ok !== true) {
						const failure = response && response.error ? response.error : {};
						return { ok: false, error: String(failure.message || failure.code || "") };
					}
					return { ok: true, error: "" };
				},
				dispose() {
					for (const off of offs) {
						try {
							off();
						} catch {
							/* 单个退订失败不阻塞其余 */
						}
					}
					offs.length = 0;
				}
			};
		}
		//#endregion

		//#region lib/client/settings-section-css.js
		/* 设置节「技能管理」样式：照官方 settings section 的视觉形状（max-width 760 / 18px 标题 /
		   下边框标签行 / data-active 主色下划线），颜色全走 --dsw-alias-* token（design D4）。 */
		const SECTION_CSS = ".v-sm-section{max-width:760px;color:var(--dsw-alias-label-primary);flex-direction:column;gap:12px;display:flex}.v-sm-heading{margin:0;font-size:18px;font-weight:600}.v-sm-intro{color:var(--dsw-alias-label-tertiary);margin:0;font-size:13px}.v-sm-tabs{border-bottom:1px solid var(--dsw-alias-border-l2);align-items:flex-end;gap:22px;margin-top:2px;display:flex}.v-sm-tab{color:var(--dsw-alias-label-tertiary);font:inherit;cursor:pointer;background:0 0;border:0;padding:7px 1px 9px;font-size:13px;line-height:20px;position:relative}.v-sm-tab:hover,.v-sm-tab[data-active=true]{color:var(--dsw-alias-label-primary)}.v-sm-tab[data-active=true]:after{content:\"\";position:absolute;left:0;right:0;bottom:-1px;height:2px;background:var(--dsw-alias-border-inverted);border-radius:2px}.v-sm-panelHost{min-width:0}.v-sm-panel{display:flex;flex-direction:column;gap:6px;padding-top:10px}";
		function installSectionCss() {
			if (typeof document === "undefined") return;
			const tagId = "dsh-v-skill-links/settings-section.css";
			if (document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") !== null) return;
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-v-skill-links";
			tag.dataset.pluginCss = tagId;
			tag.textContent = SECTION_CSS;
			document.head.appendChild(tag);
		}
		//#endregion

		//#region lib/client/settings-section-component.js
		const noopSubscribe = () => () => {};
		const emptyFace = () => ({
			getSnapshot: () => null,
			subscribe: noopSubscribe,
			hooks: { card: null },
			edit() {}, resetField() {}, save() {}, discard() {}
		});
		/** 三个标签页共用的快照读取（face = createCardController 的公开面）。 */
		function useCardFace(face) {
			return useSyncExternalStore(face.subscribe, face.getSnapshot);
		}
		/** 面板底部共享动作：段级重置（可选）+ 全局放弃修改 / 保存（写全部暂存段）。 */
		function panelFooter(t, face, state, disabled, reset) {
			return h("div", { className: "v-sc-actions" },
				reset && h("button", {
					className: "v-sc-btn", type: "button",
					disabled: disabled || state.saving, onClick: reset.onClick
				}, reset.label),
				h("button", {
					className: "v-sc-btn", type: "button",
					disabled: !state.dirty || state.saving, onClick: () => face.discard()
				}, t("discard")),
				h("button", {
					className: "v-sc-btn v-sc-btnPrimary", type: "button",
					disabled: !state.dirty || state.invalid || disabled || state.saving,
					onClick: () => face.save()
				}, state.saving ? t("saving") : t("save")));
		}
		/** 「技能映射」标签页：技能目录 textarea（原卡片第一段）。 */
		function MappingPanel({ t, face }) {
			const state = useCardFace(face);
			if (state === null || state.available === false) return null;
			if (state.status === "loading") return h("div", { className: "v-sc-loading" }, t("loading"));
			const disabled = !state.writable;
			const meta = `${t("effectivePrefix")}${state.effective.length}` + (state.baseDirs.length > 0 ? ` · ${t("basePrefix")}${state.baseDirs.length}` : "");
			return h("div", { className: "v-sm-panel" },
				h("label", { className: "v-sc-label" }, t("directoriesLabel")),
				h("textarea", {
					className: "v-sc-input",
					rows: Math.min(8, Math.max(3, state.text.split("\n").length)),
					value: state.text,
					spellCheck: false,
					disabled: disabled || state.saving,
					onChange: (event) => face.edit("directories", event.target.value)
				}),
				h("div", { className: "v-sc-hint" }, t("directoriesHint")),
				h("div", { className: "v-sc-meta" }, meta),
				state.invalid && state.invalidReason === "tooMany" && h("div", { className: "v-sc-error" }, t("tooMany")),
				!state.writable && h("div", { className: "v-sc-error" }, t("notWritable")),
				state.failed && h("div", { className: "v-sc-error" }, t("saveFailed")),
				panelFooter(t, face, state, disabled, state.overridden ? { label: t("reset"), onClick: () => face.resetField("directories") } : null));
		}
		/** 「自定义指令」标签页：指令 CRUD（原卡片第二段）。 */
		function CommandsPanel({ t, face }) {
			const state = useCardFace(face);
			if (state === null || state.available === false) return null;
			if (state.status === "loading") return h("div", { className: "v-sc-loading" }, t("loading"));
			const disabled = !state.writable;
			const meta = [state.effective.length, state.effectiveButtons.length].join(" · ");
			const rowError = state.commandsInvalid ? t(state.commandsInvalidReason || "commandNameInvalid") : null;
			return h("div", { className: "v-sm-panel" },
				h("div", { className: "v-sc-secHead" },
					h("label", { className: "v-sc-label" }, t("commandsLabel")),
					state.commandsOverridden && h("button", {
						className: "v-sc-btn", type: "button",
						disabled: disabled || state.saving, onClick: () => face.resetCommands()
					}, t("resetCommands")),
					h("button", {
						className: "v-sc-addBtn", type: "button",
						disabled: disabled || state.saving, onClick: () => face.addCommand()
					}, t("addCommand"))),
				h("div", { className: "v-sc-hint" }, t("commandsHint")),
				state.commandsDraft.map((c, index) => h("div", { className: "v-sc-row", key: index },
					h("div", { className: "v-sc-rowHead" },
						h("input", {
							className: "v-sc-cmdName",
							value: c.name,
							placeholder: t("commandNamePh"),
							spellCheck: false,
							disabled: disabled || state.saving,
							onChange: (event) => face.editCommand(index, "name", event.target.value)
						}),
						h("button", {
							className: "v-sc-remove", type: "button", title: t("removeCommand"),
							disabled: disabled || state.saving, onClick: () => face.removeCommand(index)
						}, "✕")),
					h("textarea", {
						className: "v-sc-cmdPrompt",
						rows: Math.min(8, Math.max(2, c.prompt.split("\n").length)),
						value: c.prompt,
						placeholder: t("commandPromptPh"),
						spellCheck: false,
						disabled: disabled || state.saving,
						onChange: (event) => face.editCommand(index, "prompt", event.target.value)
					}))),
				rowError && h("div", { className: "v-sc-error" }, rowError),
				!state.writable && h("div", { className: "v-sc-error" }, t("notWritable")),
				state.failed && h("div", { className: "v-sc-error" }, t("saveFailed")),
				panelFooter(t, face, state, disabled, null));
		}
		/** 「快捷功能」标签页：快捷按钮 CRUD（原卡片第三段）+ 模型/级别下拉（add-quick-button-model）。 */
		function QuickPanel({ t, face, models }) {
			const state = useCardFace(face);
			/* 模型目录（可选桥的稳定快照面；桥未就绪 → null，面板降级为仅「跟随会话模型」+ 提示）。 */
			const catalogState = useSyncExternalStore(
				models ? models.subscribe : noopSubscribe,
				models ? models.getSnapshot : () => null
			);
			/* 拖拽状态（design D3：指示线 + 松手落下）：from = 拖起行；overIndex + edge = 悬停行与上/下缘。
			   放在早退分支之前保持 hook 调用顺序稳定；拖拽过程草稿数组不动，drop 才提交换位。 */
			const [drag, setDrag] = useState(null);
			if (state === null || state.available === false) return null;
			if (state.status === "loading") return h("div", { className: "v-sc-loading" }, t("loading"));
			const disabled = !state.writable;
			const rowError = state.buttonsInvalid ? t(state.buttonsInvalidReason || "buttonNameRequired") : null;
			/* 排序控件口径（design D2）：与行内既有控件同禁用（不可写/保存中），总数 ≤1 无效果。 */
			const reorderDisabled = disabled || state.saving;
			const rowCount = state.buttonsDraft.length;
			const canReorder = rowCount > 1 && !reorderDisabled;
			/* 目录口径（design D2/D5/D9）：ready 才认候选与漂移；error/未注入 → 仅「跟随会话模型」+ 提示。 */
			const catalog = catalogState === null ? null : catalogState.catalog;
			const catalogReady = catalog !== null && catalog.status === "ready";
			const { items: modelItems, byKey: modelByKey } = catalogOptions(catalog === null ? [] : catalog.groups);
			const catalogDegraded = models === null || models === undefined || catalog === null || catalog.status === "error";
			/* 落点换算（remove-then-insert 口径）：from 前方的行，上缘 = index-1、下缘 = index；
			   from 后方的行，上缘 = index、下缘 = index+1；拖拽行自身上下缘 = 原位（空操作）。 */
			const targetOf = (from, index, edge) => {
				if (from < index) return edge === "before" ? index - 1 : index;
				if (from > index) return edge === "before" ? index : index + 1;
				return from;
			};
			/** 行内模型/级别下拉（design D5/D8/D9）：值域 = 跟随（""）+ 目录候选 + 已存漂移值原样回显。 */
			const modelRow = (b, index) => {
				const bound = buttonModelOf(b.model);
				const key = bound === undefined ? "" : modelKeyOf({ provider: bound.provider, model: bound.model });
				const entry = modelByKey.get(key);
				const controlDisabled = disabled || state.saving;
				const modelOptions = [h("option", { key: "@follow", value: "" }, t("buttonModelFollow"))];
				for (const item of modelItems) modelOptions.push(h("option", { key: item.key, value: item.key }, item.label));
				if (bound !== undefined && entry === undefined) {
					/* 模型漂移（design D9）：已存绑定不在目录中 → 原样回显并标「不可用」，保存不改写。 */
					modelOptions.push(h("option", { key: `@drift:${key}`, value: key },
						catalogReady ? `${key} · ${t("modelUnavailable")}` : key));
				}
				const efforts = entry === undefined ? [] : entry.efforts;
				let levelSelect = null;
				if (efforts.length > 0) {
					/* 级别下拉（design D5/D9）：仅当所选模型带等级元数据时渲染；已存等级原样选中
					   （漂移时作为额外一项原样回显标不可用），未存等级按「默认最高」呈现。 */
					const saved = bound.reasoningEffort;
					const known = saved !== undefined && efforts.some((effort) => effort.id === saved);
					const levelOptions = efforts.map((effort) => h("option", { key: effort.id, value: effort.id },
						typeof effort.name === "string" && effort.name !== "" ? effort.name : effort.id));
					if (saved !== undefined && !known && catalogReady) {
						levelOptions.push(h("option", { key: `@drift:${saved}`, value: saved }, `${saved} · ${t("modelUnavailable")}`));
					}
					const value = saved ?? highestEffort(efforts);
					levelSelect = h("label", { className: "v-sc-modelField" },
						h("span", { className: "v-sc-modelCap" }, t("buttonEffortLabel")),
						h("select", {
							className: "v-sc-select",
							value,
							disabled: controlDisabled,
							"aria-label": t("buttonEffortLabel"),
							onChange: (event) => {
								const effort = event.target.value;
								if (effort === value) return; /* 漂移项被重选：空操作 */
								face.editButton(index, "model", { provider: bound.provider, model: bound.model, reasoningEffort: effort });
							}
						}, levelOptions));
				}
				return h("div", { className: "v-sc-modelRow" },
					h("label", { className: "v-sc-modelField" },
						h("span", { className: "v-sc-modelCap" }, t("buttonModelLabel")),
						h("select", {
							className: "v-sc-select",
							value: key,
							disabled: controlDisabled,
							"aria-label": t("buttonModelLabel"),
							onChange: (event) => {
								const next = event.target.value;
								if (next === "") {
									/* 跟随会话模型（默认态）：设为未绑定 → 删除 model 键（design D8）。 */
									face.editButton(index, "model", undefined);
									return;
								}
								const picked = modelByKey.get(next);
								if (picked === undefined) return; /* 漂移项被重选：保持原绑定 */
								/* 换模型即按新模型的等级列表重算并默认最高（design D5）；无等级元数据
								   MUST NOT 携带 reasoningEffort（= provider/模型默认行为）。 */
								const effort = highestEffort(picked.efforts);
								face.editButton(index, "model", effort === undefined
									? { provider: picked.provider, model: picked.model }
									: { provider: picked.provider, model: picked.model, reasoningEffort: effort });
							}
						}, modelOptions)),
					levelSelect);
			};
			return h("div", { className: "v-sm-panel" },
				h("div", { className: "v-sc-secHead" },
					h("label", { className: "v-sc-label" }, t("buttonsLabel")),
					state.buttonsOverridden && h("button", {
						className: "v-sc-btn", type: "button",
						disabled: disabled || state.saving, onClick: () => face.resetButtons()
					}, t("resetButtons")),
					h("button", {
						className: "v-sc-addBtn", type: "button",
						disabled: disabled || state.saving, onClick: () => face.addButton()
					}, t("addButton"))),
				h("div", { className: "v-sc-hint" }, t("buttonsHint")),
				catalogDegraded && h("div", { className: "v-sc-modelHint" }, t("modelCatalogFallback")),
				state.buttonsDraft.map((b, index) => {
				const over = drag !== null && drag.overIndex === index ? drag.edge : null;
				return h("div", {
					className: "v-sc-row", key: index,
					onDragOver: drag === null ? undefined : (event) => {
						/* 指示线判定（design D3）：目标行 + 上/下缘；只消费组件内记录的 fromIndex，
						   不读 dataTransfer 内容。值不变时短路，避免高频 dragover 重渲染。 */
						event.preventDefault();
						const rect = event.currentTarget.getBoundingClientRect();
						const edge = event.clientY - rect.top < rect.height / 2 ? "before" : "after";
						if (drag.overIndex !== index || drag.edge !== edge) setDrag({ from: drag.from, overIndex: index, edge });
					},
					onDrop: drag === null ? undefined : (event) => {
						/* 松手才落位（design D3）；等位是纯函数层的空操作，这里跳过避免无谓草稿。 */
						event.preventDefault();
						const d = drag;
						setDrag(null);
						if (!d) return;
						const to = targetOf(d.from, index, d.edge);
						if (to !== d.from) face.moveButton(d.from, to);
					},
					onDragLeave: drag === null ? undefined : () => {
						setDrag((d) => (d !== null && d.overIndex === index ? { ...d, overIndex: null, edge: null } : d));
					}
				},
					over === "before" && h("div", { className: "v-sc-dropLine", "data-edge": "before" }),
					h("div", { className: "v-sc-rowHead" },
						h("span", {
							className: "v-sc-grip", title: t("gripLabel"), "aria-label": t("gripLabel"),
							draggable: canReorder, /* 拖拽只从把手发起，整卡不可拖（design D2） */
							"data-disabled": canReorder ? undefined : "true",
							onDragStart: canReorder ? (event) => {
								/* 不依赖 dataTransfer 内容：仅设占位满足 API 要求；fromIndex 记在组件状态（design D3）。 */
								try {
									event.dataTransfer.setData("text/plain", "");
								} catch {
									/* 部分环境在非可信事件里禁止访问 dataTransfer，占位失败不阻塞拖起 */
								}
								event.dataTransfer.effectAllowed = "move";
								setDrag({ from: index, overIndex: null, edge: null });
							} : undefined,
							onDragEnd: () => setDrag(null) /* 含 Esc 取消与区域外松手：清指示线、不换位 */
						}, "⠿"),
						h("input", {
							className: "v-sc-cmdName",
							value: b.name,
							placeholder: t("buttonNamePh"),
							spellCheck: false,
							disabled: disabled || state.saving,
							onChange: (event) => face.editButton(index, "name", event.target.value)
						}),
						h("label", { className: "v-sc-auto", title: t("autoSendLabel") },
							h("input", {
								type: "checkbox",
								checked: b.autoSend === true,
								disabled: disabled || state.saving,
								onChange: (event) => face.editButton(index, "autoSend", event.target.checked)
							}),
							t("autoSendLabel")),
						h("button", {
							className: "v-sc-move", type: "button", title: t("moveUp"), "aria-label": t("moveUp"),
							disabled: !canReorder || index === 0, onClick: () => face.moveButton(index, index - 1)
						}, "↑"),
						h("button", {
							className: "v-sc-move", type: "button", title: t("moveDown"), "aria-label": t("moveDown"),
							disabled: !canReorder || index === rowCount - 1, onClick: () => face.moveButton(index, index + 1)
						}, "↓"),
						h("button", {
							className: "v-sc-remove", type: "button", title: t("removeButton"),
							disabled: disabled || state.saving, onClick: () => face.removeButton(index)
						}, "✕")),
					modelRow(b, index),
					h("textarea", {
						className: "v-sc-cmdPrompt",
						rows: Math.min(8, Math.max(2, b.prompt.split("\n").length)),
						value: b.prompt,
						placeholder: t("buttonPromptPh"),
						spellCheck: false,
						disabled: disabled || state.saving,
						onChange: (event) => face.editButton(index, "prompt", event.target.value)
					}),
					over === "after" && h("div", { className: "v-sc-dropLine", "data-edge": "after" }));
			}),
				rowError && h("div", { className: "v-sc-error" }, rowError),
				!state.writable && h("div", { className: "v-sc-error" }, t("notWritable")),
				state.failed && h("div", { className: "v-sc-error" }, t("saveFailed")),
				panelFooter(t, face, state, disabled, null));
		}
		/**
		 * 「技能管理」设置节（settings.section）：heading + intro + 标签行 + 激活面板。
		 * 形状与官方 settings-plugins 的 section 同构：hooks.tabs 目录 + renderSlot only；
		 * 只渲染激活面板——暂存草稿存于控制器（外部 store），切换标签页不丢（design D3）。
		 */
		function SkillManagerSection({ t, renderSlot, useTabs }) {
			const tabRefs = useRef([]);
			const rows = useTabs((value) => value);
			const [activeId, setActiveId] = useState();
			const active = rows.find((row) => row.id === activeId)?.id ?? rows[0]?.id;
			return h("div", { className: "v-sm-section" },
				h("h2", { className: "v-sm-heading" }, t("title")),
				h("p", { className: "v-sm-intro" }, t("intro")),
				rows.length === 0 ? null : h("div", { className: "v-sm-tabs", role: "tablist", "aria-label": t("tabsAria") },
					rows.map((row, index) => h("button", {
						key: row.id,
						ref: (element) => { tabRefs.current[index] = element; },
						type: "button",
						role: "tab",
						className: "v-sm-tab",
						"aria-selected": row.id === active,
						"aria-controls": `v-sm-panel-${row.id}`,
						"data-active": row.id === active ? "true" : undefined,
						tabIndex: row.id === active ? 0 : -1,
						onClick: () => setActiveId(row.id),
						onKeyDown: (event) => {
							let nextIndex;
							if (event.key === "ArrowRight") nextIndex = (index + 1) % rows.length;
							else if (event.key === "ArrowLeft") nextIndex = (index - 1 + rows.length) % rows.length;
							else if (event.key === "Home") nextIndex = 0;
							else if (event.key === "End") nextIndex = rows.length - 1;
							else return;
							event.preventDefault();
							setActiveId(rows[nextIndex].id);
							const nextTab = tabRefs.current[nextIndex];
							if (nextTab) nextTab.focus();
						}
					}, row.label))),
				active === undefined ? null : h("div", { role: "tabpanel", id: `v-sm-panel-${active}`, className: "v-sm-panelHost" },
					renderSlot(SECTION_TAB_SLOT, {}, { only: active })));
		}
		//#endregion

		//#region lib/client/quick-buttons-store.js
		/**
		 * 兼容旧文档投影：无 buttons 节 / 节非对象 → 空列表；残缺条目丢弃；
		 * autoSend 非真值归 false、可选 model 绑定归一化（键序固定；未绑定不输出该键）
		 * ——宿主 schema 保证形状，这里再兜一层（design D1/D8）。
		 * @param {unknown} section - 设置节（scope.getSnapshot().value）。
		 * @returns {Array<{name: string, prompt: string, autoSend: boolean, model?: {provider: string, model: string, reasoningEffort?: string}}>}
		 */
		function buttonsSectionOf(section) {
			if (!section || typeof section !== "object" || !Array.isArray(section.buttons)) return [];
			return section.buttons
				.filter((b) => b && typeof b === "object" && typeof b.name === "string" && b.name !== "" && typeof b.prompt === "string" && b.prompt !== "")
				.map((b) => buttonEntry(b));
		}
		/**
		 * 追加语义（纯函数，spec「点击填入」的验收口径）：空草稿直接填入；
		 * 非空草稿以换行拼接（design D2 定稿分隔符 \n）。
		 */
		function appendPrompt(draft, prompt) {
			const base = typeof draft === "string" ? draft : "";
			return base.length === 0 ? prompt : `${base}\n${prompt}`;
		}
		/**
		 * 按钮列表快照 store：投影 settingsScope 的 buttons 节。
		 * 与设置卡片共享同一作用域实例（bind 在 apply 的 ctx.effect 完成，
		 * 不依赖卡片是否打开，design D3）；scope 变更即发布，卡片保存 → dock 当场更新。
		 */
		function createButtonsStore(scope) {
			const store = createSnapshotStore({ buttons: [] });
			const publish = () => {
				store.set({ buttons: buttonsSectionOf(scope.getSnapshot().value) });
			};
			const unsubscribe = scope.subscribe(publish);
			publish();
			return {
				getSnapshot: store.getSnapshot,
				subscribe: store.subscribe,
				dispose: unsubscribe
			};
		}
		//#endregion

		//#region lib/client/quick-buttons-css.js
		/* dock 网格 + 卡片「快捷按钮」段补充样式。颜色/边框/交互态全部走官方 --dsw-alias-* token；
		   按钮底子是官方 primitives Button（outline/sm），这里只补布局、截断与勾选框。
		   对齐锚点 C（design D1 补充）：网格自我约束为输入文本宽度列（--dsh-chat-content-width）
		   并居中——左缘与输入文本左缘重合（官方 stats 行同款宽度策略）；列 minmax(96px,max-content)
		   + 单钮 max-width:220px——按钮随内容收缩、自左聚拢（功能按键观感），长名 220px 封顶截断。
		   覆盖机制依赖「本 style 标签追加在 head 末尾、同特异性后到者胜」（design D5 / 风险表）。 */
		const DOCK_CSS = ".v-qb-grid{display:grid;grid-auto-flow:row;grid-template-columns:repeat(auto-fill,minmax(96px,max-content));gap:6px;width:100%;max-width:var(--dsh-chat-content-width);margin:0 auto;padding:2px 0 6px}.v-qb-grid--hero{order:1;align-self:center;width:100%;max-width:var(--dsh-chat-content-width)}.v-qb-btn{border-radius:8px;width:100%;max-width:220px;min-width:0}.v-qb-label{display:block;min-width:0;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.v-sc-auto{flex:none;display:inline-flex;align-items:center;gap:5px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:16px;cursor:pointer;user-select:none}.v-sc-auto input{accent-color:var(--dsw-alias-border-inverted);margin:0;cursor:pointer}";
		function installDockCss() {
			if (typeof document === "undefined") return;
			const tagId = "dsh-v-skill-links/quick-buttons.css";
			if (document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") !== null) return;
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-v-skill-links";
			tag.dataset.pluginCss = tagId;
			tag.textContent = DOCK_CSS;
			document.head.appendChild(tag);
		}
		//#endregion

		//#region lib/client/quick-buttons-component.js
		/**
		 * 快捷按钮网格：同一组件注册在 conversation.composer.dock（输入卡片下方、输入文本
		 * 宽度列）与 conversation.input.dock（hero 条目，新增会话首屏，design D10）两处。
		 * 点击 = 追加填入（InputActions.setDraft，一次机器事务可撤销）；autoSend = 追加后
		 * submit()（等同默认回车：裁决 → 提交事务 → 默认发送，发送的是整个输入区）。
		 * phase 非 plain（adjudicating/claimed/submitting）时整体禁用（防双击双发）。
		 *
		 * 模型绑定（add-quick-button-model，design D4/D6/D7）：按钮带 model 且会话可切换时，
		 * 填入后 await 切换（显式判信封 ok）——autoSend MUST 等切换完成再提交（先切后发）；
		 * 未绑定零额外调用；子代理/无会话静默跳过；失败 toast 且不阻断（仍以会话当前模型提交）。
		 *
		 * props：标准工具 useInput（InputState 快照 hook，草稿来源优先）+ 标准工具包
		 * inputActions + owner 份额 session/input（InputZone，仅 hero 所在的 input.dock
		 * 提供，作回退）+ inject face buttons（快照 store）/ hero（hero 条目标记）/
		 * sessionId + canSwitch（会话维度可切换判据）+ switchModel（切换函数）+
		 * notify（toast 通道）+ 标准词典座位 t。
		 * 官方 primitives 缺失或 face 未就绪 → 渲染 null（可选 chrome 不拖垮会话视图）。
		 */
		function QuickButtonsGrid(props) {
			const t = props.t ?? ((key) => zh[key] ?? key);
			const inputActions = props.inputActions ?? null;
			const useInput = props.useInput ?? null;
			/* 最新草稿快照存 ref：点击时取当帧草稿（design 风险表「点击闭草稿陈旧」对策）。
			 * 草稿来源（fix-dsh-012-compat design D5）：标准工具 useInput 优先——新版
			 * composer.dock 槽位不再提供 owner 份额（props.input 仅 hero 所在的
			 * input.dock、owner InputZone 才有）；useInput 缺席时回退 owner 份额
			 * props.input（InputState 同形）。选择器取整态（引用稳定），防
			 * useSyncExternalStore 逐帧新对象导致重渲染风暴。useInput 的有无由槽位
			 * 投影决定、按挂载周期稳定，条件调用不破坏 hook 顺序。 */
			const liveInput = useInput ? useInput((s) => s) : null;
			const inputRef = useRef(null);
			inputRef.current = liveInput ?? props.input ?? null;
			/* in-flight 保护（design D6）：切换/提交序列进行中忽略后续点击——切换期间输入机
			 * phase 仍为 plain，槽位门控挡不住连点（autoSend 下会出现「第二次点击的切换 +
			 * 第一次点击的提交」错配）。只作本地忽略，不改视觉态（保持最小改动）。 */
			const busyRef = useRef(false);
			const buttonsFace = props.buttons ?? null;
			const state = useSyncExternalStore(
				buttonsFace ? buttonsFace.subscribe : noopSubscribe,
				buttonsFace ? buttonsFace.getSnapshot : () => null
			);
			const list = state === null ? [] : state.buttons;
			const zone = inputRef.current;
			const phase = zone !== null && typeof zone.phase === "string" ? zone.phase : "plain";
			const disabled = inputActions === null || phase !== "plain";
			/* 切换通道（design D6/D7）：canSwitch 是会话维度判据（子代理/无会话 → false，静默跳过）；
			   switchModel 缺失（槽位未接线）按不可切换处理；桥缺失时由 switchModel 返回
			   unavailable，统一走 toast 降级。 */
			const canSwitch = props.canSwitch !== false;
			const switchModel = typeof props.switchModel === "function" ? props.switchModel : null;
			const sessionId = props.sessionId;
			const notify = typeof props.notify === "function" ? props.notify : null;
			const items = useMemo(() => {
				if (inputActions === null) return [];
				/** 切换失败降级（design D6）：toast 提示、不阻断（autoSend 仍以会话当前模型提交）。 */
				const reportFailure = (outcome) => {
					if (notify === null) return;
					const detail = outcome && typeof outcome.error === "string" ? outcome.error : "";
					notify(outcome && outcome.unavailable === true ? t("switchUnavailable") : `${t("switchFailed")}${detail}`, true);
				};
				/** 点击序列（design D6）：setDraft →（有绑定且可切）await 切换 → autoSend 提交。 */
				const activate = (button) => {
					if (busyRef.current === true) return; /* in-flight：忽略重复点击 */
					const current = inputRef.current;
					const draft = current !== null && typeof current.draft === "string" ? current.draft : "";
					inputActions.setDraft(appendPrompt(draft, button.prompt));
					const model = buttonModelOf(button.model);
					if (model === undefined || canSwitch !== true || switchModel === null) {
						/* 未绑定零动作（design D4）；子代理/无会话静默跳过（D7）；槽位未接线按不可切换。 */
						if (button.autoSend === true) inputActions.submit();
						return;
					}
					busyRef.current = true;
					switchModel(sessionId, model)
						.then((outcome) => {
							if (!outcome || outcome.ok !== true) reportFailure(outcome);
							if (button.autoSend === true) inputActions.submit();
						})
						.catch((error) => {
							reportFailure({ error: String(error?.message || error) });
							if (button.autoSend === true) inputActions.submit();
						})
						.finally(() => {
							busyRef.current = false;
						});
				};
				return list.map((button, index) => h(primitives.Button, {
					key: `${button.name}-${index}`,
					variant: "outline",
					size: "sm",
					className: "v-qb-btn",
					"data-v-button": button.name,
					/* 官方 Tooltip 需要子元素 ref 转发契约（React 18 函数组件不满足），
					   按任务约定退化为原生 title（4.3 兜底路径）。 */
					title: button.prompt,
					disabled,
					onClick: () => activate(button)
				}, h("span", { className: "v-qb-label" }, button.name)));
			}, [list, disabled, inputActions, canSwitch, sessionId, switchModel, notify, t]);
			/* hero 门控（design D10；fix-hero-gating-snapshot-fields D1）：仅空白会话首屏渲染，
			   翻转回会话态时本条目返回 null、composer.dock 条目接管（两条目互斥）。
			   0.1.2-rc.1 起 SessionSnapshot 不再携带 composerPhase 派生字段（phase 机器移入
			   ui-conversation 的 conversationPhase()，由原始字段推导），门控改用现存原始字段
			   等价复刻官方 blank 相位：openState==='open' && blank && !running && !promptAttempted
			   （promptAttempted 是粘性发送标记，发出首条消息即翻 engaging、hero 让位；activeTargets
			   对 dock 不可见，blank 且未尝试发送的会话恒无活跃回合目标，故可省）。
			   缺 session / 字段缺失（含仍带旧 composerPhase 的宿主）一律按非 blank 处理：
			   保守不渲染，绝不在未知快照形状下误渲染。 */
			if (props.hero === true) {
				const session = props.session ?? null;
				const isBlankHero = session !== null
					&& session.openState === "open"
					&& session.blank === true
					&& session.running !== true
					&& session.promptAttempted !== true;
				if (!isBlankHero) return null;
			}
			if (inputActions === null || list.length === 0) return null;
			return h("div", {
				className: props.hero === true ? "v-qb-grid v-qb-grid--hero" : "v-qb-grid",
				role: "group",
				"aria-label": t("dockAriaLabel")
			}, items);
		}
		//#endregion

		//#region lib/client/apply.js
		function apply(ctx) {
			/* ── 设置节「技能管理」+ 快捷按钮：词典 + CSS + settingsScope 桥接（共享作用域） + 槽位注册 ── */
			installCardCss();
			installDockCss();
			installSectionCss();
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "v-skill-links: settings dictionaries");
			let cardController = null;
			let buttonsStore = null;
			ctx.effect(() => {
				const scope = ctx.get("settingsScope").bind({
					namespace: SETTINGS_NS,
					decode: (section) => section !== null && typeof section === "object" ? section : undefined
				});
				/* bind 一次，卡片与 dock 共享同一作用域实例（design D3：不依赖卡片是否打开）。 */
				cardController = createCardController(scope);
				buttonsStore = createButtonsStore(scope);
				return () => {
					cardController?.dispose();
					buttonsStore?.dispose();
					cardController = null;
					buttonsStore = null;
				};
			}, "v-skill-links: settings scope");
			/* ── 模型目录桥（可选注入 remote / remote.session / sessions；静态 inject 列表保持不动） ──
			   `remote.<namespace>` 在 cordis 是独立服务键（gateway 以 remoteServiceKey(name)
			   提供为独立 Service，不挂在 remote 实例上），作用域不声明就读不到——
			   `scope.remote.session` 会抛 "cannot get property … without inject"，本回调纤维
			   随之失败、目录桥永不就绪（0.1.5-rc.2 实测，面板只剩「跟随会话模型」）。
			   声明 "remote.session" 后 `scope.remote.session` 经 traceable 代理正常解析
			   （官方 ui-model-selection / ui-chat / settings-plugins 同款三连声明）；
			   命名空间缺失时回调不执行 → 桥保持 null，面板与点击路径整体降级。 */
			let modelBridge = null;
			let offBridge = null;
			const modelsStore = createSnapshotStore({ catalog: null });
			ctx.inject(["remote", "remote.session", "sessions"], (scope) => {
				modelBridge = createModelBridge(scope);
				const publishCatalog = () => modelsStore.set({ catalog: modelBridge === null ? null : modelBridge.getSnapshot() });
				offBridge = modelBridge.subscribe(publishCatalog);
				publishCatalog();
				return () => {
					offBridge?.();
					offBridge = null;
					modelBridge?.dispose();
					modelBridge = null;
					modelsStore.set({ catalog: null });
				};
			});
			const modelsFace = { getSnapshot: modelsStore.getSnapshot, subscribe: modelsStore.subscribe };
			/** 切换收敛为单处（design D3/D6）：桥缺失 → unavailable（点击路径统一 toast 降级）。 */
			const switchSessionModel = (sessionId, model) => modelBridge === null
				? Promise.resolve({ ok: false, unavailable: true, error: "" })
				: modelBridge.select(sessionId, model);
			/** 会话维度可切换判据（design D7）：无 sessionId / 子代理会话 → false（点击路径静默跳过）；
			   桥尚未就绪 → true（交由 switchSessionModel 返回 unavailable 走 toast 降级，design D2）。 */
			const canSwitchSession = (sessionId) => typeof sessionId === "string" && sessionId !== ""
				&& (modelBridge === null || modelBridge.canSwitch(sessionId));
			/* ── 设置左栏第一层「技能管理」节 + 三个标签页（官方 plugins 页同构，design D1/D2） ──
			   节组件的 label 闭包用 ctx.locale.bind(NS)；标签目录（hooks.tabs）照抄
			   settings-plugins 的 sectionInjected：slots.entries + slots/locale 复合订阅。 */
			const sectionT = ctx.locale.bind(NS);
			let tabsVersion = -1;
			let tabsRevision = -1;
			let tabsRows = [];
			const tabsFace = {
				getSnapshot: () => {
					const version = ctx.slots.getVersion(SECTION_TAB_SLOT);
					const revision = ctx.locale.getSnapshot().revision;
					if (version !== tabsVersion || revision !== tabsRevision) {
						tabsVersion = version;
						tabsRevision = revision;
						tabsRows = ctx.slots.entries(SECTION_TAB_SLOT).map((entry) => ({
							id: entry.options.id ?? "",
							order: entry.options.order ?? 0,
							label: resolveSlotLabel(entry.options.label) ?? ""
						})).sort((a, b) => a.order - b.order);
					}
					return tabsRows;
				},
				subscribe: (listener) => {
					const offLedger = ctx.slots.subscribe(SECTION_TAB_SLOT, listener);
					const offLocale = ctx.locale.subscribe(listener);
					return () => {
						offLedger();
						offLocale();
					};
				}
			};
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: SECTION_ID,
				order: 5, /* 通用(0) 之后、模型(10) 之前；「第一层」= 顶层导航项 */
				label: () => sectionT("nav"),
				locale: NS,
				inject: () => ({ hooks: { tabs: tabsFace } }),
				children: { [SECTION_TAB_SLOT]: { kind: "list", scope: "root" } }
			}, SkillManagerSection));
			/* 三个标签页：共享同一控制器 face（暂存-保存/校验/覆盖逻辑零改动）。 */
			ctx.slots.inject(SECTION_TAB_SLOT, () => ctx.slots.register({
				name: SECTION_TAB_SLOT,
				id: "mapping",
				order: 0,
				label: () => sectionT("tabMapping"),
				locale: NS,
				inject: () => ({ face: cardController ?? emptyFace() })
			}, MappingPanel));
			ctx.slots.inject(SECTION_TAB_SLOT, () => ctx.slots.register({
				name: SECTION_TAB_SLOT,
				id: "commands",
				order: 1,
				label: () => sectionT("tabCommands"),
				locale: NS,
				inject: () => ({ face: cardController ?? emptyFace() })
			}, CommandsPanel));
			ctx.slots.inject(SECTION_TAB_SLOT, () => ctx.slots.register({
				name: SECTION_TAB_SLOT,
				id: "quick",
				order: 2,
				label: () => sectionT("tabQuick"),
				locale: NS,
				inject: () => ({ face: cardController ?? emptyFace(), models: modelsFace })
			}, QuickPanel));
			/* ── 快捷按钮网格：会话输入卡片下方的 composer.dock 槽（design D8 定稿） ──
			   裸调用 slots.inject（该 API 自身经调用者 ctx.effect 接线，卸载级联自动收集）；
			   声明等待语义使本插件与 ui-conversation 的加载顺序无关。 */
			ctx.slots.inject("conversation.composer.dock", () => ctx.slots.register({
				name: "conversation.composer.dock",
				id: DOCK_ID,
				order: -1, /* 紧贴输入卡片（官方 stats 行 = 0，在其下）；升序渲染 */
				locale: NS,
				/* inject 收 sessionId（官方会话作用域槽位先例）；MUST 容忍 undefined
				   （无会话/取用失败 → 可渲染 face 且 canSwitch: false，design D7）。 */
				inject: (sessionId) => ({
					buttons: buttonsStore,
					sessionId,
					canSwitch: canSwitchSession(sessionId),
					switchModel: switchSessionModel,
					notify: (text, isError) => showToast(text, isError)
				})
			}, QuickButtonsGrid));
			/* ── 快捷按钮网格（hero）：新增会话首屏同样显示按钮（design D10） ──
			   0.1.2-rc.1 渲染点现状：composer.dock 只在会话态出现（variant === "composer"，
			   hero 布局不渲染）；input.dock 只看 zone（session+input）存在、hero 与会话态
			   都渲染——本条目以 owner 份额 SessionSnapshot 原始字段自门控（组件 hero 分支，
			   非 blank 首屏返回 null），与会话态的 composer.dock 条目互斥；上游已无
			   composerPhase 派生字段（fix-hero-gating-snapshot-fields D1），门控 MUST NOT
			   依赖已被移除的快照字段。 */
			ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({
				name: "conversation.input.dock",
				id: DOCK_HERO_ID,
				order: 0, /* 与官方 queue/todo 条目并肩；blank 态二者本就为空、互不干扰 */
				locale: NS,
				inject: (sessionId) => ({
					buttons: buttonsStore,
					hero: true,
					sessionId,
					canSwitch: canSwitchSession(sessionId),
					switchModel: switchSessionModel,
					notify: (text, isError) => showToast(text, isError)
				})
			}, QuickButtonsGrid));

			/* ── 「映射技能」触发分组 ── */
			const inputTriggers = ctx.get("inputTriggers");

			let cached = null; // { skills, directories }
			let fetchedAt = 0;
			let inflight = null;
			const listeners = new Set();
			const notify = () => {
				for (const listener of [...listeners]) try {
					listener();
				} catch (error) {
					console.error("[v-skill-links] lexicon listener failed:", error);
				}
			};
			async function fetchList(signal) {
				const res = await fetch(API + "/list", { signal });
				if (!res.ok) throw new Error(`v-skill-links list failed: HTTP ${res.status}`);
				const data = await res.json();
				return data && Array.isArray(data.skills) ? data : { skills: [], directories: [] };
			}
			function getList() {
				if (cached && Date.now() - fetchedAt < TTL_MS) return Promise.resolve(cached);
				if (!inflight) {
					const abort = new AbortController();
					inflight = {
						abort,
						promise: fetchList(abort.signal).then((data) => {
							cached = data;
							fetchedAt = Date.now();
							notify();
							return data;
						}).finally(() => {
							inflight = null;
						})
					};
				}
				return inflight.promise;
			}
			/** 菜单描述：多目录时追加来源根目录名，便于区分同名风格的技能。 */
			function describe(skill, data) {
				const base = skill.description || "映射技能";
				const okDirs = (data.directories ?? []).filter((d) => d.ok).length;
				return okDirs > 1 && skill.root ? `${base} · ${skill.root}` : base;
			}

			/* ── 自定义指令执行：POST /run，宿主把 Prompt followup 进该会话 ── */
			async function runCommand(sessionId, name) {
				try {
					const res = await fetch(API + "/run", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ sessionId, name })
					});
					const data = await res.json().catch(() => ({}));
					if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
					showToast(`${t0("toastSent")}${name}`, false);
				} catch (error) {
					console.error("[v-skill-links] run command failed:", error);
					showToast(`${t0("toastFailed")}${String(error?.message || error)}`, true);
				}
			}
			let toastTimer = null;
			function showToast(text, isError) {
				if (typeof document === "undefined") return;
				let host = document.getElementById("v-sc-toast");
				if (!host) {
					host = document.createElement("div");
					host.id = "v-sc-toast";
					host.className = "v-sc-toast";
					document.body.appendChild(host);
				}
				host.textContent = text;
				host.dataset.error = isError ? "true" : "false";
				host.dataset.show = "true";
				clearTimeout(toastTimer);
				toastTimer = setTimeout(() => {
					host.dataset.show = "false";
				}, isError ? 4000 : 1800);
			}
			/** 卡片未就绪时兜底取词典（toast 用）。 */
			function t0(key) {
				return zh[key] ?? key;
			}

			/**
			 * 子串匹配 + 前缀优先排序：/cd 也能命中 abcd（大小写不敏感）。
			 * 空查询原样返回（保持服务端排序）；命中集内前缀命中排前面，其余按名称序。
			 */
			function matchByName(list, query) {
				const q = String(query ?? "").trim().toLowerCase();
				if (!q) return list;
				return list
					.filter((item) => item.name.toLowerCase().includes(q))
					.sort((a, b) => {
						const ap = a.name.toLowerCase().startsWith(q) ? 0 : 1;
						const bp = b.name.toLowerCase().startsWith(q) ? 0 : 1;
						return ap !== bp ? ap - bp : a.name.localeCompare(b.name);
					});
			}

			const source = {
				trigger: "/",
				/** 分组标题：词典未登记的键原样展示，故直接用中文标题。 */
				name: "映射技能",
				/** 置顶：排在全部官方分组（命令=默认 0、技能=2）之前。 */
				order: -1,
				async candidates(_session, { query, signal }) {
					let data = cached;
					try {
						data = await getList();
					} catch (error) {
						/* 拉取失败时用旧数据兜底；完全没数据才让菜单静默丢组 */
						if (!data) throw error;
					}
					if (signal.aborted) return [];
					return matchByName(data.skills, query).map((skill) => ({
						name: skill.name,
						description: describe(skill, data)
					}));
				},
				warm(_session) {
					getList().catch(() => {});
				},
				lexicon(_session) {
					return cached?.skills.map((skill) => skill.name);
				},
				subscribeLexicon(_session, listener) {
					listeners.add(listener);
					return () => {
						listeners.delete(listener);
					};
				},
				onPick({ candidate }) {
					return { text: `/${candidate.name} ` };
				}
			};

			/* ── 「自定义指令」触发分组：紧跟映射技能，命令分组之前 ── */
			const commandSource = {
				trigger: "/",
				name: "自定义指令",
				order: -0.5,
				async candidates(_session, { query, signal }) {
					let data = cached;
					try {
						data = await getList();
					} catch (error) {
						if (!data) throw error;
					}
					if (signal.aborted) return [];
					return matchByName(data.commands ?? [], query).map((c) => ({
						name: c.name,
						description: c.description || "自定义指令"
					}));
				},
				warm(_session) {
					getList().catch(() => {});
				},
				/* 不提供 lexicon：选中即发送、不落文本，手打的 /名称 不应被装饰成可提交引用 */
				onPick({ candidate, session }) {
					void runCommand(session.sessionId, candidate.name);
					return "handled";
				}
			};

			ctx.effect(() => {
				const unregisterSkill = inputTriggers.registerSource(source);
				const unregisterCommands = inputTriggers.registerSource(commandSource);
				return () => {
					unregisterSkill();
					unregisterCommands();
				};
			}, "v-skill-links: sources");
		}
		//#endregion

		//#region lib/client/exports.js
		exports.apply = apply;
		exports.inject = inject;
		/* 快捷按钮内部面（冒烟测试用）：追加语义纯函数 / 设置节投影 / 快照 store / dock 组件。 */
		exports.appendPrompt = appendPrompt;
		exports.buttonsSectionOf = buttonsSectionOf;
		exports.createButtonsStore = createButtonsStore;
		exports.QuickButtonsGrid = QuickButtonsGrid;
		/* 设置节内部面（冒烟测试用）。 */
		exports.SkillManagerSection = SkillManagerSection;
		exports.MappingPanel = MappingPanel;
		exports.CommandsPanel = CommandsPanel;
		exports.QuickPanel = QuickPanel;
		/* 排序纯函数（冒烟测试用）。 */
		exports.moveButton = moveButton;
		/* 模型绑定内部面（冒烟测试用）：绑定归一化 / 等级默认最高 / 模型键 / 目录展开 / 目录桥。 */
		exports.buttonModelOf = buttonModelOf;
		exports.highestEffort = highestEffort;
		exports.modelKeyOf = modelKeyOf;
		exports.catalogOptions = catalogOptions;
		exports.createModelBridge = createModelBridge;
		return module.exports;
		//#endregion
	}
});
