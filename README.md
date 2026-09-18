# dsh-v-skill-links · V 技能映射

**简体中文** | [English](README.en.md)

DeepSeek Harness Web 的 **「/」菜单映射技能** 插件。

在插件配置里声明任意多个技能目录后，每个目录下的**一级子目录**只要含 `SKILL.md`（大小写不敏感，`Skill.md`/`skill.md` 均可），该目录就成为一条**映射技能**：在会话输入框按 `/` 唤出的菜单里，**「命令」「技能」之下**新增一个 **「映射技能」** 分组列出它们；选中后与原生技能同形地落入 `/名字 ` 文本，发送时宿主端读取该技能的 `SKILL.md` 全文，以与原生技能一致的 `<skill_content>` 块注入本步 —— **「使用」即「引用该 skill.md」**。

纯增量插件：不替换、不禁用任何官方插件；映射技能**不进**模型的 `<available_skills>` 目录（不占系统提示词），仅由用户显式引用。

## 功能

- **多目录**：`config.directories` 接受任意多个目录；绝对路径原样使用，`~` 展开为用户主目录，相对路径按 dsh 启动目录解析；重复路径去重。
- **扫描规则**：只看配置目录的一级子目录；子目录内存在 `SKILL.md` 即收录。`.` 开头的隐藏目录跳过。技能名默认取子目录名（空白/`/` 归一为 `-`）；`SKILL.md` frontmatter 里的 `name:`（不含空白时）与 `description:` 优先；缺描述时取正文第一个非空行（markdown 标题去 `#`）。两个目录出现重名技能时按配置顺序先到先得。
- **「映射技能」分组（置顶）**：客户端注册独立的 `/` 触发源，分组标题即「映射技能」，`order: -1` 排在全部官方分组（命令=默认 0、技能=2）之前；**子串模糊匹配**（大小写不敏感，`/cd` 命中 `abcd`，前缀命中优先排序）；配置了多个有效目录时，候选描述会追加 ` · 根目录名` 便于区分来源。
- **「自定义指令」分组（followup 型）**：`order: -0.5` 紧跟映射技能、命令之前。在设置卡片里维护指令列表（名称 + Prompt），选中菜单项**立即把 Prompt 作为用户消息发送进当前会话**（宿主 `ctx.agents.get(sessionId)` → `agent.followup(...)`，消息打 `{ kind: "user" }` 源，与官方 `/plan` 同口径）——Prompt 里可写 `/映射技能名` 令牌，发送时会连带注入对应 SKILL.md 全文；成功/失败有 toast 反馈。**同样子串模糊匹配**。不注册进宿主命令注册表，因此**不与官方「命令」分组重复**。
- **快捷按钮（输入框下方网格）**：官方 `conversation.composer.dock` 槽位（输入卡片下方，与官方 stats 行并肩、紧贴卡片）渲染按钮网格。槽位契约只给宽度列，「与输入区同宽」由网格**自我约束**：`max-width: var(--dsh-chat-content-width)` + 居中，左缘与输入文本左缘重合（官方 stats 行同款宽度策略）；CSS Grid 行优先先横排，列 `auto-fill minmax(96px, max-content)`、单钮 `max-width: 220px`——按钮随内容收缩、**自左聚拢**成功能按键观感（不拉伸填满整行），高度无上限。**新增会话首屏**（空白会话 hero）经官方 `conversation.input.dock` 槽位（id `v-quick-buttons-hero`）以 CSS `order` 渲染同一网格于 hero 输入卡片正下方（非 blank 自动让位给会话态的 composer.dock 条目）；无会话首屏不渲染。按钮由设置卡片维护（**名称 + Prompt + 自动发送**）：点击 = `InputActions.setDraft` 把 Prompt **追加**进输入框（草稿非空时换行拼接，一次机器事务可撤销）；勾选**自动发送** = 追加后 `InputActions.submit()`（**等同按下回车**：发送整个输入区、`/` 令牌照常裁决、运行中会话按回车行为设置 steer/排队）。名字超宽截断（ellipsis）+ 悬停 `title` 显示完整 Prompt；空列表零布局；提交期间（phase 非 plain）整体禁用。按钮底子是**官方 `primitives.Button`（outline/sm）**，颜色全部走 `--dsw-alias-*` token（明暗主题自动跟随），并暴露 `.v-qb-grid` / `.v-qb-btn` / `data-v-button="<名称>"` 稳定 CSS 钩子供用户美化。
- **引用即注入**：选中候选落入 `/名字 `，发送后宿主 `agent/pre-step` 监听器（与官方 `dsh-time-context` 同一模式，`prepend` 跑在链最外层）在**直接用户输入**里寻找空白边界的 `/名字` 令牌，命中即读取 `SKILL.md`，渲染为
  `<skill_content name="…" source="…\SKILL.md">` + `<skill_resources>`（基目录提示）+ `<skill_instructions>`（正文），作为 user 角色的 instructions 注入追加进本步 —— 一次步内同一技能只注入一次；正文超 20 万字符截断并提示读取原文件。
- **热与新鲜**：目录列表 3 秒 TTL 缓存（客户端 5 秒），注入时**实时读文件**——改完 SKILL.md 立刻生效；profile 补丁层热重载（改配置不用重装）。
- **可视化设置页**：宿主注册设置命名空间 `v-skill-links`，并在设置页左栏注册**第一层「技能管理」节**（官方 `settings.section` 槽，id `v-skills`），节内三个标签页（官方插件页同构的 tablist）：**技能映射**（技能目录 textarea）、**自定义指令**（列表 CRUD）、**快捷功能**（快捷按钮 CRUD，含自动发送勾选），暂存-保存模型、覆盖标记、段级重置；保存写入用户设置文档（settings.yaml），与补丁层配置叠加（用户层优先），保存即热生效；旧「插件配置 → 映射技能」卡片已移除，避免重复入口。
- **调试接口**：`GET /api/v-skill-links/list` 返回 `{ skills, directories }`（directories 逐条报告 ok/error/count）；`GET /api/v-skill-links/skill?name=名字` 返回单条技能的原文与 frontmatter。接口不接受任意路径输入（只能按名字查当前目录里的技能），无路径穿越面。

## 安装

> **环境要求**：Harness（`dsh`）**0.1.2-rc.1 及以上**。客户端依赖的快照 store（`@deepseek-ai/dsh-client-store`）与 UI 原语 / 插槽工具均由 web shell 静态种子表提供；更早版本没有该种子词（旧版经 `@deepseek-ai/dsh-client-runtime` 动态包提供的运行时已被 harness 移除），插件将无法加载。

**方式一 · GitHub 地址直装（推荐）**——本插件手写零构建、无任何安装期脚本，git 安装无需构建授权：

```sh
dsh plugin --profile web add "github:victor10035445/dsh-v-skill-links"
```

如需锁定版本（后续推送不会悄悄改变实际运行的代码）：

```sh
dsh plugin --profile web add "github:victor10035445/dsh-v-skill-links#<commit-sha>"
```

**方式二 · 本地 clone + link 直连**（免打包，改动后重启 `dsh web` 生效，适合开发调试）：

```sh
git clone https://github.com/victor10035445/dsh-v-skill-links.git
dsh plugin --profile web add "link:<克隆路径>"
```

**方式三 · tgz 打包安装**：

```sh
npm pack                                # 产出 dsh-v-skill-links-0.4.1.tgz
dsh plugin --profile web add "<tgz 的绝对路径>"
```

装完**重启 `dsh web`**，刷新页面生效。

## 配置

编辑 `$DSH_HOME\profiles\web\cordis.patch.yml`（用户的补丁层，追加条目）：

```yaml
- id: dsh-v-skill-links
  config:
    directories:
      - D:/skills/my-skills         # 绝对路径
      - ~/my-skills                 # ~ 展开为用户主目录
      - ./skills                    # 相对 dsh 启动目录
    buttons:                        # 快捷按钮（可选；组合层预置，用户层设置卡片可覆盖）
      - name: 新建
        prompt: 使用 xxx 技能做 xxx 事
        autoSend: true              # 填入后立即按回车语义发送整个输入区
      - name: 审查
        prompt: 请使用 /code-review 审查当前改动
```

保存后补丁层热重载；若未生效则重启 `dsh web`。配置合法但目录不存在不算致命——菜单空组自动隐藏，`/api/v-skill-links/list` 的 `directories` 里可见具体错误。

### 可视化设置页（推荐日常入口）

侧边栏齿轮打开 **设置 → 技能管理**（左栏第一层），页内三个标签页：

- **技能映射**：技能目录 textarea 每行一个目录；「保存」写入用户设置文档（`$DSH_HOME\settings.yaml` 的 `v-skill-links` 节），**立即热生效**，无需重启；
- **自定义指令**：点「新增」添加一行指令，编辑**名称**（显示在 `/` 菜单「自定义指令」分组，小写 `a-z 0-9 _ -`）与 **Prompt**（选中后发送进会话的内容）；行上 ✕ 删除；保存后立即出现在 `/` 菜单；
- **快捷功能**：点「新增」添加一行按钮，编辑**名称**（按钮上显示，可中文，仅要求非空且不重名）、**Prompt**（点击后追加进输入框的内容）与**自动发送**勾选框；保存后立即出现在会话输入框下方网格；**顺序调整**：行首把手（⠿）拖拽——拖拽过程在候选落点显示指示线、**松手落下**确定新位置，或用每行的「上移 / 下移」按钮逐位交换（触屏与键盘的平级通道）；两种通道都只改本地草稿，随「保存」生效；
- 三个标签页共享同一份暂存草稿：任一页的修改计入整体脏标记，**任一页底部「保存」一次写全**；各页的「重置为组合层 / 重置指令 / 重置按钮」仅清除自己段的用户层覆盖（回退到补丁文件配置）；
- 非 loopback 浏览器或设置文档只读时各页自动禁用写入（官方设置域的行为）。

### SKILL.md 示例（`~/my-skills/code-review/SKILL.md`）

```markdown
---
name: code-review
description: 按团队规范审查当前改动并输出分级意见
---

# Code Review

1. 先 `git diff` 看改动……
```

不写 frontmatter 也能用：技能名取目录名 `code-review`，描述取正文第一行 `# Code Review`（去 `#`）。

## 使用

1. 会话输入框输入 `/` → 菜单出现 **命令 / 技能 / 映射技能（/ 子智能体）** 分组；
2. 在「映射技能」里选中一条（或手打 `/名字 `）；
3. 补一句话（可选）后发送 —— 模型在本步收到你的消息原文 + 该技能 `SKILL.md` 的 `<skill_content>` 注入块，并按其指示行动。

**自定义指令**：在设置卡片里维护指令后，`/` 菜单的「自定义指令」分组（映射技能之下、命令之前）选中一条 → **立即把该指令的 Prompt 作为用户消息发送进当前会话**（toast 确认；Prompt 里写 `/映射技能名` 令牌会连带注入对应 SKILL.md 全文）。适合"固定套路一键触发"。

**快捷按钮**：在设置卡片里维护按钮后，会话输入框下方出现按钮网格。点击按钮 → Prompt **追加**进输入框（草稿非空时换行拼接，Ctrl/Cmd+Z 可整体撤销）；勾选了**自动发送**的按钮在追加后**立即等同回车发送整个输入区**——发送前你仍可以补改草稿。Prompt 里写 `/映射技能名` 或 `/原生技能名` 令牌，发送时照常注入。按钮的**展示顺序 = 设置里 `buttons` 数组的顺序**：在设置「快捷功能」标签页用行首把手拖拽或「上移 / 下移」按钮调整并保存后，输入框下方网格与新增会话首屏 hero 网格**即时按新顺序重排**（dock 只显示、纯跟随，不支持在 dock 内拖拽；新增按钮一律排在末尾）。

### 快捷按钮 vs 自定义指令

| | 快捷按钮 | 自定义指令 |
|---|---|---|
| 入口 | 输入框下方网格，常驻可见 | `/` 菜单「自定义指令」分组 |
| 名称 | 显示名，可中文（仅非空+不重名） | 令牌名，小写 `a-z 0-9 _ -` |
| 点击行为 | **追加进输入框**（可继续编辑草稿） | **立即发送**（不经输入框） |
| 自动发送 | 可选勾选（填入后等同回车） | 天然即发送 |
| 发送通道 | 客户端 `InputActions`（回车管线，与手打同口径） | 宿主 followup（要求会话有活跃代理） |
| 适合 | 起草模板 / 引用技能后再补话 | 固定套路一键直发 |

## 架构

| 端 | 内容 |
|---|---|
| 宿主 `lib/index.js` | 配置归一化（`~`/相对路径、指令名称校验/去重、按钮名称/去重/autoSend 布尔）；设置命名空间 `v-skill-links` 注册（手写 schema 兼容 dsh-settings 的可调用/toJSON/walker 契约，免 schemastery 依赖；补丁层配置为组合 base，settings.yaml 用户层覆盖，`scope.watch` 热切换）；目录扫描 + TTL 缓存；`/api/v-skill-links/list`（含 commands）、`/run`（followup 执行）、`/skill`；`agent/pre-step`（prepend）注入 `<skill_content>`；消息构造与 `dsh-time-context` 同模式（deep-freeze）。 |
| 客户端 `lib/client.js` | ① `/` 触发源「映射技能」（order -1 置顶）：`fetch /list`（TTL + 旧数据兜底）、`startsWith(query)` 过滤、`warm/lexicon/subscribeLexicon`、`onPick` 落 `/name ` 字面文本。② `/` 触发源「自定义指令」（order -0.5）：候选来自 /list 的 commands，**onPick 立即 POST /run**（宿主 followup 进会话）+ toast 反馈；不提供 lexicon（手打令牌不产生引用语义）。③ 快捷按钮网格双条目：`conversation.composer.dock`（id `v-quick-buttons`、order -1 紧贴输入卡片）+ `conversation.input.dock` hero 条目（id `v-quick-buttons-hero`、order 0；新增会话首屏 blank 态渲染同一网格于 hero 卡片下方，非 blank 返回 null 与前者互斥）：`createButtonsStore` 投影 settingsScope 的 buttons 节（共享作用域，保存即热更新），`QuickButtonsGrid` 用官方 `primitives.Button`（outline/sm + 自有 class 覆盖方形）渲染网格，点击 `InputActions.setDraft` 追加 / `submit()` 等同回车，phase 非 plain 禁用。④ 设置左栏第一层「技能管理」节（`settings.section`，id `v-skills`）+ 三个标签页（`settings.v-skills.tab`：技能映射/自定义指令/快捷功能），共享同一 `settingsScope.bind({namespace, decode})` 控制器，目录 textarea 与指令/按钮列表（增删改、按钮排序 `moveButton`）暂存-保存（`set/unset`），覆盖标记与段级重置。 |
| 声明 `package.json` | `dsh.bundle.patch` 挂 loader 条目；`dsh.client` 让 client-modules 把 `lib/client.js` 编入 /plugins 启动图（零 npm 依赖，无需构建步骤）。 |

## 与原生技能的关系

| | 原生「技能」 | 映射技能 |
|---|---|---|
| 来源 | `dsh-skill-filesystem` 扫描的项目/用户技能根 | 本插件配置目录的一级子目录 |
| 模型目录 | 进 `<available_skills>`，模型可自主加载 | **不进**目录，仅用户显式 `/名字` 引用 |
| SKILL.md 要求 | frontmatter 校验较严 | 任意 markdown，frontmatter 可省 |

## 已知边界

- **与命令重名**：映射技能名与宿主命令同名（如 `plan`）时，命令侧裁决优先，该名字只会触发命令——给技能起个不像命令的名字即可。
- **自定义指令不走宿主命令注册表**：因此不出现在「命令」分组、也不产生 `command/run` 日志；执行要求该会话有**活跃代理**（冷/持久化未恢复的子代理会话返回 404 提示）。选中即发送，不影响输入框里已有的草稿。
- **自定义指令 Prompt 含技能令牌**：发送的消息打 `{ kind: "user" }` 源，与手打同待遇——映射技能令牌会由宿主注入全文，原生技能令牌由官方手势边界注入。
- **与原生技能重名**：两路注入都会发生（罕见；映射侧按本插件口径再注入一次）。
- **注入不回放**：注入发生在用户消息进入的那一步；会话恢复后历史里的 `/名字` 令牌保留但正文不重复注入（与原生手势一致）。
- **只扫一级子目录**：更深的目录不索引（与需求一致）。
- **快捷按钮的官方槽位口径**：`conversation.composer.dock` 官方注释建议「可点击控件放工具行」——那是针对环境读数的风格建议，非技术限制；按钮网格装不进一行高的工具行，本插件知情采纳该槽位（几何上正是「输入框下方」）。
- **「与输入区同宽」是条目自我约束（对齐锚点 C 定稿）**：dock 槽契约给的是宽度列，渲染器对 list 条目 Fragment 直出（无 DOM 包裹层）——网格以 `max-width: var(--dsh-chat-content-width)` + `margin: 0 auto` 自我约束，左缘与输入文本左缘重合（官方 stats 行同款宽度策略）；列 `minmax(96px, max-content)` + 单钮 `max-width: 220px`，按钮随内容收缩、自左聚拢，长名封顶截断。
- **新增会话首屏借用 `conversation.input.dock` 渲染 hero 网格**：官方没有「hero 卡片下方」的座位，且 `conversation.composer.dock` 渲染点只在会话态出现（`variant === "composer"`，hero 布局不渲染）；`conversation.input.dock` 渲染点只看 zone（session+input）存在、hero 与会话态都渲染——本插件以它注册 hero 条目（id `v-quick-buttons-hero`、order 0），用 CSS `order` 把网格排到 hero 卡片正下方，组件按 owner 份额 SessionSnapshot 的**原始字段**自门控（`openState === 'open' && blank && !running && !promptAttempted` 才渲染）、与会话态的 composer.dock 条目互斥。**门控不得依赖派生相位字段**：0.1.2-rc.1 已把 `composerPhase` 从会话快照移除（phase 机器移入 ui-conversation 的 `conversationPhase()`，由 blank/awaitingFirstTurn/running/promptAttempted/openState 现场推导），历史上读 `session.composerPhase` 的门控因此恒不成立、新会话首屏按钮整体消失（fix-hero-gating-snapshot-fields 修复）。
- **快捷按钮的悬停提示用原生 `title`**：官方 primitives 的 `Tooltip` 需要子元素 ref 转发契约（React 18 函数组件不满足），按约定退化为原生 `title` 展示完整 Prompt。
- **composer 被其他插件 block 时按钮仍可点击**：dock 的 owner 份额拿不到 block 信息；此时追加作用在暂时不可见、不可提交的草稿上，block 清除后可见、可撤销，无破坏性。
- **子代理会话的输入框下方同样出现按钮网格**：dock 是 session 作用域，配置是全局的——接受此行为。
- **样式覆盖依赖文档序**：`.v-qb-*` 的自定义能力来自「插件 style 标签追加在 head 末尾、同特异性后到者胜」；若官方未来引入更高特异性或 `@layer`，需把钩子类升级为双类特异性。

## 从源码验证

```sh
pnpm check                                   # node --check 两个入口
node test/scan-smoke.mjs                     # 配置归一化 / frontmatter / 扫描去重
node test/inject-smoke.mjs                   # 令牌匹配口径 / 消息过滤 / 渲染形状
node test/settings-schema-smoke.mjs          # 设置 schema 契约（可调用 / toJSON / walker 形状 / 分层合并）
node test/buttons-schema-smoke.mjs           # 快捷按钮 schema（归一化 / 去重 / autoSend / 上限 / 分层合并）
node test/settings-card-smoke.mjs            # 设置节/标签页契约（v-skills / 三 tab / 旧卡片移除 / 暂存-保存 / 重置 / dock 注册）
node test/buttons-reorder-smoke.mjs          # 快捷按钮排序（moveButton 纯函数 / 控制器暂存口径 / 拖拽与上下移交互胶水）
node test/host-apply-smoke.mjs               # apply 接线 + /list /skill /run 端到端 + pre-step 注入 + 设置热切换 + buttons 节
node test/client-shape-smoke.mjs             # 客户端 bundle 形状（factory / 触发源 / 设置卡片 / dock 契约 / 模块声明）
node test/quick-buttons-client-smoke.mjs     # 快捷按钮客户端（appendPrompt / 投影 / store / 点击语义 / 禁用）
```

## License

MIT
