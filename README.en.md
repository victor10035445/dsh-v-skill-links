# dsh-v-skill-links · V Skill Links

[简体中文](README.md) | **English**

A **mapped-skills plugin for the `/` menu** of DeepSeek Harness Web.

Declare any number of skill directories in the plugin config; any **first-level subdirectory** containing a `SKILL.md` (case-insensitive: `Skill.md`/`skill.md` both work) becomes a **mapped skill**: the `/` menu in the chat composer gains a **"Mapped Skills"** group alongside the built-in **"Commands"** and **"Skills"** groups. Picking a candidate inserts `/name ` text just like a native skill; on send, the host reads the skill's `SKILL.md` in full and injects it as a `<skill_content>` block identical in shape to native skills — **"using" a skill IS referencing its SKILL.md**.

Purely additive: the plugin never replaces or disables official plugins; mapped skills do **not** enter the model's `<available_skills>` catalog (no system-prompt footprint) — they are only referenced explicitly by the user.

## Features

- **Multiple directories**: `config.directories` accepts any number of directories; absolute paths are used as-is, `~` expands to the user home, relative paths resolve against the dsh startup directory; duplicate paths are deduplicated.
- **Scan rules**: only first-level subdirectories of configured directories are scanned; a subdirectory containing a `SKILL.md` is included. Hidden directories starting with `.` are skipped. Skill name defaults to the subdirectory name (whitespace/`/` normalized to `-`); `name:` (when free of whitespace) and `description:` in the SKILL.md frontmatter take precedence; without a description, the first non-empty body line (markdown heading stripped of `#`) is used. When two directories produce the same skill name, the first in config order wins.
- **"Mapped Skills" group (pinned on top)**: the client registers an independent `/` trigger source titled "Mapped Skills" with `order: -1`, ahead of all official groups (Commands = default 0, Skills = 2); **substring fuzzy matching** (case-insensitive, `/cd` matches `abcd`, prefix hits sort first); with multiple valid directories configured, candidate descriptions get a ` · <root dir name>` suffix to tell sources apart.
- **"Custom Commands" group (followup style)**: `order: -0.5`, right after Mapped Skills and before Commands. Maintain the command list (name + Prompt) in the settings card; picking a menu item **immediately sends the Prompt into the current session as a user message** (host `ctx.agents.get(sessionId)` → `agent.followup(...)`, message tagged `{ kind: "user" }`, same as the official `/plan`) — the Prompt may contain `/mapped-skill-name` tokens, which trigger the corresponding SKILL.md injection on send; success/failure get toast feedback. **Same substring fuzzy matching**. Not registered in the host command registry, so it **never duplicates the official "Commands" group**.
- **Quick Buttons (grid below the composer)**: renders a button grid via the official `conversation.composer.dock` slot (below the input card, level with the official stats row). The slot contract only provides a width column; "same width as the input area" is **self-constrained** by the grid: `max-width: var(--dsh-chat-content-width)` + centered, left edge aligned with input text (the same width strategy as the official stats row); CSS Grid lays out row-first with columns `auto-fill minmax(96px, max-content)` and per-button `max-width: 220px` — buttons shrink to content and **cluster left** like functional keys (no full-row stretching), height unlimited. **New-session first screen** (blank hero) renders the same grid right under the hero input card via the official `conversation.input.dock` slot (id `v-quick-buttons-hero`) with CSS `order` (non-blank sessions defer to the session-mode composer.dock entry); nothing renders on first screens without a composer. Buttons are maintained in the settings card (**name + Prompt + auto-send**): click = `InputActions.setDraft` **appends** the Prompt to the draft (joined with a newline when non-empty, undoable as one machine transaction); **auto-send** = append then `InputActions.submit()` (**equivalent to pressing Enter**: sends the whole input area, `/` tokens adjudicated as usual, running sessions steer/queue per Enter behavior settings). Overlong names truncate (ellipsis) + hover `title` shows the full Prompt; empty list renders nothing; disabled entirely while submitting (phase ≠ plain). Buttons are built on the **official `primitives.Button` (outline/sm)**, colors entirely from `--dsw-alias-*` tokens (auto dark/light theme), with stable CSS hooks `.v-qb-grid` / `.v-qb-btn` / `data-v-button="<name>"` for user styling.
- **Reference = injection**: picking a candidate inserts `/name `; on send the host's `agent/pre-step` listener (same pattern as official `dsh-time-context`, `prepend` at the outermost chain) looks for whitespace-delimited `/name` tokens in **direct user input**; on hit it reads the `SKILL.md` and renders
  `<skill_content name="…" source="…\SKILL.md">` + `<skill_resources>` (base-dir hint) + `<skill_instructions>` (body), appended into this step as user-role instructions — one injection per skill per step; bodies over 200K characters are truncated with a hint to read the original file.
- **Hot & fresh**: directory lists cached 3s TTL (client 5s); injection **reads files live** — edit SKILL.md and it takes effect immediately; profile patch layer hot-reloads (config changes need no reinstall).
- **Visual settings page**: the host registers settings namespace `v-skill-links` plus a **first-level "Skill Manager" section** in the settings sidebar (official `settings.section` slot, id `v-skills`) with three tabs (tablist isomorphic to official plugin pages): **Skill Mapping** (directories textarea), **Custom Commands** (list CRUD), **Quick Buttons** (button CRUD with auto-send checkbox), staged-save model, override markers, per-section reset; saving writes the user settings document (settings.yaml), layered over patch config (user layer wins), effective immediately; the old "Plugin Config → Mapped Skills" card was removed to avoid duplicate entries.
- **Debug endpoints**: `GET /api/v-skill-links/list` returns `{ skills, directories }` (directories reports ok/error/count per entry); `GET /api/v-skill-links/skill?name=<name>` returns a single skill's raw text and frontmatter. Endpoints accept no arbitrary path input (skills are addressable by name only within configured directories) — no path-traversal surface.

## Install

> **Environment requirement**: Harness (`dsh`) **0.1.2-rc.1 or later**. The snapshot store (`@deepseek-ai/dsh-client-store`), UI primitives and slot tools the client depends on are all provided by the web shell's static seed table; earlier versions lack that seed word (the runtime formerly provided via the `@deepseek-ai/dsh-client-runtime` dynamic package has been removed from the harness), and the plugin will fail to load.

**Option 1 · Direct install from GitHub (recommended)** — this plugin is hand-written with zero build steps and no install-time scripts, so git install needs no build approval:

```sh
dsh plugin --profile web add "github:victor10035445/dsh-v-skill-links"
```

To pin a version (later pushes won't silently change running code):

```sh
dsh plugin --profile web add "github:victor10035445/dsh-v-skill-links#<commit-sha>"
```

**Option 2 · Local clone + link** (no packing; changes take effect after restarting `dsh web`; good for development):

```sh
git clone https://github.com/victor10035445/dsh-v-skill-links.git
dsh plugin --profile web add "link:<clone path>"
```

**Option 3 · tgz package install**:

```sh
npm pack                                # produces dsh-v-skill-links-0.4.1.tgz
dsh plugin --profile web add "<absolute path to tgz>"
```

After installing, **restart `dsh web`** and refresh the page.

## Configuration

Edit `$DSH_HOME\profiles\web\cordis.patch.yml` (your patch layer, append an entry):

```yaml
- id: dsh-v-skill-links
  config:
    directories:
      - D:/skills/my-skills         # absolute path
      - ~/my-skills                 # ~ expands to user home
      - ./skills                    # relative to the dsh startup directory
    buttons:                        # quick buttons (optional; preset in composed layer, user-layer settings card can override)
      - name: New
        prompt: Use the xxx skill to do xxx
        autoSend: true              # submits the whole input area immediately after inserting
      - name: Review
        prompt: Please use /code-review to review current changes
```

The patch layer hot-reloads on save; if it doesn't, restart `dsh web`. A valid config pointing at nonexistent directories is not fatal — empty menu groups auto-hide, and the `directories` array of `/api/v-skill-links/list` shows the specific errors.

### Visual settings page (recommended daily entry)

Open **Settings → Skill Manager** (first-level section in the left column) via the sidebar gear; three tabs:

- **Skill Mapping**: one directory per line in the textarea; "Save" writes the user settings document (`v-skill-links` section of `$DSH_HOME\settings.yaml`), **effective immediately**, no restart;
- **Custom Commands**: click "Add" for a new row; edit the **name** (shown in the `/` menu "Custom Commands" group, lowercase `a-z 0-9 _ -`) and the **Prompt** (sent into the session on pick); ✕ deletes a row; saved entries appear in the `/` menu immediately;
- **Quick Buttons**: click "Add" for a new row; edit the **name** (button label, Chinese allowed, only non-empty + unique required), the **Prompt** (appended to the draft on click) and the **auto-send** checkbox; saved buttons appear in the grid below the composer immediately; **reordering**: drag the row handle (⠿) — an indicator line shows the drop point while dragging, releasing commits the new position; or use each row's "Move up / Move down" buttons (equivalent channel for touch and keyboard); both channels only edit the local draft, applied on "Save";
- The three tabs share one staged draft: edits on any tab count toward the global dirty flag, and **"Save" at the bottom of any tab writes everything at once**; each tab's "reset to composed layer / reset commands / reset buttons" clears only its own user-layer overrides (falling back to patch-file config);
- On non-loopback browsers or read-only settings documents, write actions auto-disable (official settings-domain behavior).

### SKILL.md example (`~/my-skills/code-review/SKILL.md`)

```markdown
---
name: code-review
description: Review current changes against team conventions and output graded findings
---

# Code Review

1. Run `git diff` first ...
```

Frontmatter is optional: the skill name falls back to the directory name `code-review`, the description to the first body line `# Code Review` (stripped of `#`).

## Usage

1. Type `/` in the composer → the menu shows the **Commands / Skills / Mapped Skills (/ sub-agents)** groups;
2. Pick an entry under "Mapped Skills" (or type `/name ` manually);
3. Add a sentence (optional) and send — the model receives your original message plus the skill's `SKILL.md` `<skill_content>` injection block in this step, and follows its instructions.

**Custom Commands**: after maintaining commands in the settings card, pick one from the `/` menu's "Custom Commands" group (below Mapped Skills, above Commands) → **the Prompt is immediately sent into the current session as a user message** (toast confirmation; `/mapped-skill-name` tokens in the Prompt trigger the corresponding SKILL.md injection). Great for "one-click fixed routines".

**Quick Buttons**: after maintaining buttons in the settings card, a button grid appears below the composer. Click a button → the Prompt is **appended** to the draft (joined with a newline when non-empty; Ctrl/Cmd+Z undoes as a whole); buttons with **auto-send** checked **immediately send the whole input area after appending, equivalent to Enter** — you can still tweak the draft before it goes if not auto-sent. Prompts may contain `/mapped-skill-name` or `/native-skill-name` tokens, injected as usual on send. **Display order = the order of the `buttons` array in settings**: after dragging handles or using "Move up / Move down" in the "Quick Buttons" tab and saving, the composer grid and the new-session hero grid **re-order immediately** (the dock only displays and follows; no in-dock dragging; new buttons always append at the end).

### Quick Buttons vs Custom Commands

| | Quick Buttons | Custom Commands |
|---|---|---|
| Entry | Grid below the composer, always visible | `/` menu "Custom Commands" group |
| Name | Display label, Chinese allowed (non-empty + unique) | Token name, lowercase `a-z 0-9 _ -` |
| Click behavior | **Append to draft** (keep editing) | **Send immediately** (bypasses the draft) |
| Auto-send | Optional checkbox (insert then Enter) | Inherently sends |
| Send channel | Client `InputActions` (Enter pipeline, same as typing) | Host followup (requires an active agent in session) |
| Best for | Drafting templates / referencing a skill then adding words | One-click fixed routines |

## Architecture

| Side | Contents |
|---|---|
| Host `lib/index.js` | Config normalization (`~`/relative paths, command-name validation/dedup, button names/dedup/autoSend booleans); settings namespace `v-skill-links` registration (hand-written schema compatible with dsh-settings' callable/toJSON/walker contracts, no schemastery dependency; patch config is the composed base, settings.yaml user layer overrides, `scope.watch` hot switching); directory scanning + TTL cache; `/api/v-skill-links/list` (with commands), `/run` (followup execution), `/skill`; `agent/pre-step` (prepend) injects `<skill_content>`; message construction follows the `dsh-time-context` pattern (deep-freeze). |
| Client `lib/client.js` | ① `/` trigger source "Mapped Skills" (order -1, pinned): `fetch /list` (TTL + stale fallback), `startsWith(query)` filter, `warm/lexicon/subscribeLexicon`, `onPick` inserts `/name ` literal text. ② `/` trigger source "Custom Commands" (order -0.5): candidates from /list commands, **onPick immediately POSTs /run** (host followup into the session) + toast feedback; no lexicon (typed tokens produce no reference semantics). ③ Quick buttons grid dual entry: `conversation.composer.dock` (id `v-quick-buttons`, order -1, flush with the input card) + `conversation.input.dock` hero entry (id `v-quick-buttons-hero`, order 0; blank first screen renders the same grid under the hero card, non-blank returns null and is mutually exclusive with the former): `createButtonsStore` projects the settingsScope buttons section (shared scope, hot-updates on save), `QuickButtonsGrid` renders with official `primitives.Button` (outline/sm + custom class overrides), clicks call `InputActions.setDraft` to append / `submit()` equals Enter, disabled when phase ≠ plain. ④ Settings sidebar first-level "Skill Manager" section (`settings.section`, id `v-skills`) + three tabs (`settings.v-skills.tab`: Skill Mapping / Custom Commands / Quick Buttons), sharing one `settingsScope.bind({namespace, decode})` controller; directories textarea and command/button lists (CRUD, button reorder `moveButton`) staged-save (`set/unset`), override markers and per-section reset. |
| Manifest `package.json` | `dsh.bundle.patch` mounts the loader entry; `dsh.client` lets client-modules compile `lib/client.js` into the /plugins startup graph (zero npm dependencies, no build step). |

## Relationship with native skills

| | Native "Skills" | Mapped Skills |
|---|---|---|
| Source | Project/user skill roots scanned by `dsh-skill-filesystem` | First-level subdirectories of directories configured in this plugin |
| Model catalog | Enters `<available_skills>`, model may load autonomously | **Not in the catalog**, only explicit `/name` references |
| SKILL.md requirements | Stricter frontmatter validation | Any markdown, frontmatter optional |

## Known boundaries

- **Name clash with commands**: when a mapped skill name equals a host command (e.g. `plan`), the command side wins adjudication and that name only triggers the command — name your skills unlike commands.
- **Custom Commands bypass the host command registry**: they never appear in the "Commands" group nor produce `command/run` logs; execution requires an **active agent** in the session (cold / not-yet-restored sub-agent sessions get a 404 hint). Picking sends immediately and does not touch the existing draft.
- **Custom Command Prompts containing skill tokens**: the sent message is tagged `{ kind: "user" }`, same treatment as typing — mapped-skill tokens are injected by the host, native skill tokens by the official gesture boundary.
- **Name clash with native skills**: both injections occur (rare; the mapped side injects again per this plugin's rules).
- **Injection is not replayed**: injection happens on the step where the user message enters; after session restore, `/name` tokens remain in history but the body is not re-injected (consistent with the native gesture).
- **First-level subdirectories only**: deeper directories are not indexed (by design).
- **Quick buttons' official slot reading**: the official comment on `conversation.composer.dock` suggests "clickable controls belong on the tool row" — a style note for environment readouts, not a technical limit; a button grid cannot fit a one-line-high tool row, and this plugin adopts the slot knowingly (geometrically it is exactly "below the composer").
- **"Same width as the input area" is entry self-constraint (alignment anchor C, finalized)**: the dock slot contract provides a width column; the renderer emits list entries as bare Fragments (no DOM wrapper) — the grid self-constrains with `max-width: var(--dsh-chat-content-width)` + `margin: 0 auto`, left edge aligned with input text (the official stats-row width strategy); columns `minmax(96px, max-content)` + per-button `max-width: 220px`, buttons shrink to content and cluster left, long names truncate at the cap.
- **New-session first screen borrows `conversation.input.dock` for the hero grid**: the official layout has no seat "under the hero card", and the `conversation.composer.dock` render point only appears in session mode (`variant === "composer"`, not rendered in hero layout); the `conversation.input.dock` render point only checks the zone (session+input) exists and renders in both hero and session modes — so this plugin registers the hero entry there (id `v-quick-buttons-hero`, order 0) and uses CSS `order` to place the grid right under the hero card; per the owner's share of the `SessionSnapshot` **raw fields** the component self-gates (renders only when `openState === 'open' && blank && !running && !promptAttempted`), mutually exclusive with the session-mode composer.dock entry. **Gating MUST NOT depend on derived phase fields**: 0.1.2-rc.1 removed `composerPhase` from the session snapshot (the phase machine moved into ui-conversation's `conversationPhase()`, derived on the fly from blank/awaitingFirstTurn/running/promptAttempted/openState); historically a gate reading `session.composerPhase` therefore became permanently false and the first-screen button grid disappeared entirely (fixed by fix-hero-gating-snapshot-fields).
- **Quick button hover hints use native `title`**: the official primitives `Tooltip` requires a child ref-forwarding contract (React 18 function components don't satisfy it), so per convention it degrades to native `title` showing the full Prompt.
- **Buttons remain clickable when the composer is blocked by other plugins**: the dock's owner share cannot see block info; appends then target a temporarily invisible, non-submittable draft — visible and undoable once the block clears, non-destructive.
- **The button grid also appears below sub-agent session composers**: the dock is session-scoped while the config is global — accepted behavior.
- **Style overrides rely on document order**: the customizability of `.v-qb-*` comes from "plugin style tags append at the end of head, same specificity means later wins"; if official code ever introduces higher specificity or `@layer`, the hook classes need upgrading to double-class specificity.

## Verify from source

```sh
pnpm check                                   # node --check both entries
node test/scan-smoke.mjs                     # config normalization / frontmatter / scan dedup
node test/inject-smoke.mjs                   # token matching / message filtering / render shape
node test/settings-schema-smoke.mjs          # settings schema contract (callable / toJSON / walker shapes / layered merge)
node test/buttons-schema-smoke.mjs           # quick button schema (normalization / dedup / autoSend / caps / layered merge)
node test/settings-card-smoke.mjs            # settings section/tab contract (v-skills / three tabs / old card removed / staged save / reset / dock registration)
node test/buttons-reorder-smoke.mjs          # quick button reorder (moveButton pure function / controller staging / drag & up-down interaction glue)
node test/host-apply-smoke.mjs               # apply wiring + /list /skill /run end-to-end + pre-step injection + settings hot switch + buttons section
node test/client-shape-smoke.mjs             # client bundle shape (factory / trigger sources / settings card / dock contracts / module declarations)
node test/quick-buttons-client-smoke.mjs     # quick buttons client (appendPrompt / projection / store / click semantics / disable)
```

## License

MIT
