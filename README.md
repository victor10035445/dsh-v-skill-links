# dsh-v-skill-links · V 技能映射

**简体中文** | [English](README.en.md)

DeepSeek Harness Web 的 **「/」菜单映射技能** 插件：把任意本地目录里的 `SKILL.md` 变成 `/` 菜单里可直接引用的技能。

工作方式：在配置里声明若干技能目录 → 每个目录的**一级子目录**（含 `SKILL.md`）成为一条**映射技能** → 会话输入框按 `/`，在「映射技能」分组选中（或手打 `/名字 `）→ 发送时宿主读取该技能的 `SKILL.md` 全文，以与原生技能一致的 `<skill_content>` 块注入本步。

纯增量插件：不替换、不禁用任何官方插件；映射技能**不进**模型的 `<available_skills>` 目录（不占系统提示词），仅由用户显式引用。

## 功能

三大能力 + 共性底座：

| 能力 | 入口 | 行为 |
|---|---|---|
| **映射技能** | `/` 菜单「映射技能」分组 | 选中落入 `/名字 `，发送时注入对应 `SKILL.md` 全文 |
| **自定义指令** | `/` 菜单「自定义指令」分组 | 选中**立即把 Prompt 作为用户消息发送**进当前会话 |
| **快捷按钮** | 输入框下方按钮网格 | 点击把 Prompt **追加**进输入框（可继续编辑）；可选**自动发送**（等同回车）；可绑定模型与推理等级 |

共性：

- **多目录**：`config.directories` 接受任意多个目录，支持绝对路径、`~`（用户主目录）、相对路径（dsh 启动目录），自动去重；
- **扫描规则**：只扫配置目录的一级子目录，含 `SKILL.md`（大小写不敏感）即收录，`.` 开头的隐藏目录跳过；技能名默认取子目录名，frontmatter 的 `name:` / `description:` 优先；重名技能按配置顺序先到先得；
- **模糊匹配**：`/` 子串匹配（大小写不敏感），前缀命中优先排序；
- **可视化设置页**：**设置 → 技能管理**，三个标签页（技能映射 / 自定义指令 / 快捷功能）可视化增删改，保存写入用户设置、立即热生效；
- **热与新鲜**：改完 `SKILL.md` 立刻生效（注入时实时读文件）；配置保存即热生效，无需重启；
- **按钮可美化**：按钮网格暴露 `.v-qb-grid` / `.v-qb-btn` / `data-v-button="<名称>"` 稳定 CSS 钩子，配色走官方 token、明暗主题自动跟随。

## 安装

> **环境要求**：Harness（`dsh`）**0.1.2-rc.1 及以上**。客户端依赖的快照 store 与 UI 原语由 web shell 静态种子表提供，更早版本没有该种子词，插件将无法加载。

**方式一 · GitHub 地址直装（推荐）**（零构建、无安装期脚本）：

```sh
dsh plugin --profile web add "github:victor10035445/dsh-v-skill-links"
```

锁定版本（后续推送不会悄悄改变实际运行的代码）：

```sh
dsh plugin --profile web add "github:victor10035445/dsh-v-skill-links#<commit-sha>"
```

**方式二 · 本地 clone + link 直连**（适合开发调试，改动后重启 `dsh web` 生效）：

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

编辑 `$DSH_HOME\profiles\web\cordis.patch.yml`（用户补丁层，追加条目）：

```yaml
- id: dsh-v-skill-links
  config:
    directories:
      - D:/skills/my-skills         # 绝对路径
      - ~/my-skills                 # ~ 展开为用户主目录
      - ./skills                    # 相对 dsh 启动目录
    buttons:                        # 快捷按钮（可选，设置页可覆盖）
      - name: 新建
        prompt: 使用 xxx 技能做 xxx 事
        autoSend: true              # 填入后立即发送
      - name: 审查
        prompt: 请使用 /code-review 审查当前改动
        model:                      # 可选：绑定模型（缺省 = 跟随会话当前模型）
          provider: deepseek-official
          model: deepseek-v4-pro
          reasoningEffort: max      # 可选推理等级；不写 = provider/模型默认
```

保存后补丁层热重载；若未生效则重启 `dsh web`。目录不存在不算致命——菜单空组自动隐藏，具体错误见 `/api/v-skill-links/list` 的 `directories`。

日常推荐用**可视化设置页**（侧边栏齿轮 → **设置 → 技能管理**）：

- **技能映射**：textarea 每行一个目录，保存立即生效；
- **自定义指令**：维护名称（小写 `a-z 0-9 _ -`）+ Prompt；
- **快捷功能**：维护名称（可中文）+ Prompt + 自动发送勾选 + **模型/级别下拉**（模型候选与会话模型菜单同源；所选模型带推理等级时才出现级别下拉，默认最高；首项「跟随会话模型（默认）」= 不绑定），行首把手拖拽或「上移 / 下移」调整顺序；
- 三个标签页共享一份暂存草稿，任一页「保存」一次写全；「重置」回退到补丁文件配置。

### 按钮绑定模型

每条快捷按钮可绑定 `{ provider, model, reasoningEffort? }`，点击时在追加 Prompt 的**同时**把该会话模型切到绑定值：

- **未绑定 = 跟随会话**：点击完全不碰模型，行为与旧版本逐字一致；
- **发送后不切回**：切换在会话内持久生效，后续手动发送继续用该模型；同一会话先后点两条绑定按钮，后点者生效；
- **autoSend 先切后发**：切换完成后才提交，该回合一定用绑定模型；未绑定的按钮不增加任何等待；
- **失败不阻断**：模型/等级已下线、连接不可用 → toast 提示，Prompt 照常追加；autoSend 时以会话当前模型提交，草稿不丢；子代理会话静默跳过切换（不报错）；
- **连点保护**：切换与随后的提交进行中忽略后续点击（防「第二次切换 + 第一次提交」错配）；
- **目录降级**：客户端 remote 不可用或目录加载失败 → 设置页只留「跟随会话模型」+ 提示；已存绑定即便不在目录中也原样回显并标「不可用」，保存不改写你的配置。

官方口径副作用（与在会话里手动切模型完全一致，已确认接受）：切换会一并更新**新会话默认模型**；provider/model 发生变化时，系统会在下一次请求前插入一条 `[model changed: A → B]` 提示消息（**仅推理等级变化不插入**）。

### SKILL.md 示例（`~/my-skills/code-review/SKILL.md`）

```markdown
---
name: code-review
description: 按团队规范审查当前改动并输出分级意见
---

# Code Review

1. 先 `git diff` 看改动……
```

frontmatter 可省：技能名取目录名，描述取正文第一个非空行。

## 使用

1. 输入框输入 `/` → 菜单出现 **命令 / 技能 / 映射技能** 分组；
2. 在「映射技能」选中一条（或手打 `/名字 `）；
3. 补一句话（可选）后发送——模型在本步收到你的消息原文 + 该技能的 `<skill_content>` 注入块，并按其指示行动。

**自定义指令**：`/` 菜单选中即发送，适合「固定套路一键触发」；Prompt 里写 `/映射技能名` 令牌会连带注入对应 SKILL.md 全文。

**快捷按钮**：点击追加进输入框（Ctrl/Cmd+Z 可整体撤销），自动发送则等同回车；展示顺序即设置里的按钮顺序，改完保存即时重排。按钮可绑定模型与推理等级（见「按钮绑定模型」）——未绑定即跟随会话模型。

### 快捷按钮 vs 自定义指令

| | 快捷按钮 | 自定义指令 |
|---|---|---|
| 入口 | 输入框下方网格，常驻可见 | `/` 菜单「自定义指令」分组 |
| 名称 | 显示名，可中文 | 令牌名，小写 `a-z 0-9 _ -` |
| 点击行为 | **追加进输入框**（可继续编辑） | **立即发送**（不经输入框） |
| 自动发送 | 可选勾选 | 天然即发送 |
| 模型绑定 | 可绑定模型 + 推理等级 | 不绑定（跟随会话） |
| 适合 | 起草模板 / 引用技能后再补话 | 固定套路一键直发 |

## 架构

零 npm 依赖、零构建步骤，两个入口 + 一份声明：

| 文件 | 职责 |
|---|---|
| 宿主 `lib/index.js` | 配置归一化、设置命名空间 `v-skill-links` 注册（补丁层为 base、settings.yaml 用户层覆盖、热切换）、目录扫描 + TTL 缓存、`/api/v-skill-links` 路由（list / run / skill）、`agent/pre-step` 注入 `<skill_content>` |
| 客户端 `lib/client.js` | `/` 触发源 ×2（映射技能置顶、自定义指令 followup 直发）、快捷按钮网格（会话态 composer.dock + 新增会话首屏 hero 条目互斥渲染；按钮模型绑定 = 可选注入的官方 client remote 目录/切换，失败降级）、设置页「技能管理」节 + 三标签页（暂存-保存、覆盖标记、段级重置） |
| 声明 `package.json` | `dsh.bundle.patch` 挂 loader 条目；`dsh.client` 声明把客户端编入 /plugins 启动图 |

## 与原生技能的关系

| | 原生「技能」 | 映射技能 |
|---|---|---|
| 来源 | `dsh-skill-filesystem` 扫描的项目/用户技能根 | 本插件配置目录的一级子目录 |
| 模型目录 | 进 `<available_skills>`，模型可自主加载 | **不进**目录，仅用户显式 `/名字` 引用 |
| SKILL.md 要求 | frontmatter 校验较严 | 任意 markdown，frontmatter 可省 |

## 已知边界

- **与命令重名**：命令侧裁决优先，该名字只会触发命令——技能名避开命令名即可；
- **与原生技能重名**：两路注入都会发生（罕见）；
- **自定义指令**：不进宿主命令注册表；执行要求会话有**活跃代理**（未恢复的子代理会话返回 404 提示）；
- **注入不回放**：注入只发生在消息进入的那一步，会话恢复后历史令牌不再重复注入（与原生手势一致）；
- **只扫一级子目录**：更深的目录不索引；
- **按钮网格的作用域**：子代理会话的输入框下方同样出现（dock 是 session 作用域，配置全局）；composer 被其他插件 block 时按钮仍可点击，追加作用于暂时不可见的草稿，block 清除后可见可撤销；
- **样式覆盖**：`.v-qb-*` 钩子依赖「插件 style 标签追加在 head 末尾、同特异性后到者胜」，悬停提示用原生 `title`。

## 从源码验证

```sh
pnpm check                                   # node --check 两个入口
pnpm test                                    # 依次跑全部 9 个 smoke 测试
```

或逐个运行：

```sh
node test/scan-smoke.mjs                     # 配置归一化 / frontmatter / 扫描去重
node test/inject-smoke.mjs                   # 令牌匹配 / 消息过滤 / 渲染形状
node test/settings-schema-smoke.mjs          # 设置 schema 契约 / 分层合并
node test/buttons-schema-smoke.mjs           # 快捷按钮 schema（归一化 / 去重 / autoSend / 模型绑定透传）
node test/settings-card-smoke.mjs            # 设置节/标签页契约（暂存-保存 / 重置 / dock 注册 / 模型草稿）
node test/buttons-reorder-smoke.mjs          # 按钮排序（moveButton / 拖拽与上下移）
node test/host-apply-smoke.mjs               # apply 接线 + API 端到端 + pre-step 注入
node test/client-shape-smoke.mjs             # 客户端 bundle 形状（factory / 触发源 / 契约 / 模型绑定接线）
node test/quick-buttons-client-smoke.mjs     # 快捷按钮客户端（点击语义 / 投影 / 禁用 / 模型切换与目录桥）
```

## License

MIT
