# dsh-v-skill-links · V Skill Links

[简体中文](README.md) | **English**

A **mapped-skills plugin for the `/` menu** of DeepSeek Harness Web: turn `SKILL.md` files in any local directory into skills you can reference right from the `/` menu.

How it works: declare skill directories in the config → each **first-level subdirectory** containing a `SKILL.md` becomes a **mapped skill** → type `/` in the composer and pick one from the "Mapped Skills" group (or type `/name `) → on send, the host reads the skill's `SKILL.md` in full and injects it as a `<skill_content>` block identical in shape to native skills.

Purely additive: never replaces or disables official plugins; mapped skills do **not** enter the model's `<available_skills>` catalog (no system-prompt footprint) — they are only referenced explicitly by the user.

## Features

Three capabilities on a shared base:

| Capability | Entry | Behavior |
|---|---|---|
| **Mapped Skills** | `/` menu "Mapped Skills" group | Picking inserts `/name `; the matching `SKILL.md` is injected in full on send |
| **Custom Commands** | `/` menu "Custom Commands" group | Picking **immediately sends the Prompt** into the current session as a user message |
| **Quick Buttons** | Button grid below the composer | Click **appends** the Prompt to the draft (keep editing); optional **auto-send** (equals Enter); a model + reasoning effort may be bound |

Shared traits:

- **Multiple directories**: `config.directories` accepts any number of directories — absolute paths, `~` (user home), relative paths (dsh startup directory); duplicates removed;
- **Scan rules**: only first-level subdirectories are scanned; a `SKILL.md` (case-insensitive) makes it a skill; hidden directories starting with `.` are skipped; skill name defaults to the subdirectory name, frontmatter `name:` / `description:` win; name clashes resolve by config order;
- **Fuzzy matching**: `/` substring matching (case-insensitive), prefix hits sort first;
- **Visual settings page**: **Settings → Skill Manager**, three tabs (Skill Mapping / Custom Commands / Quick Buttons) with full CRUD; saving writes user settings, effective immediately;
- **Hot & fresh**: edit `SKILL.md` and it takes effect immediately (files are read live at injection); config changes apply on save, no restart;
- **Styleable buttons**: the grid exposes stable CSS hooks `.v-qb-grid` / `.v-qb-btn` / `data-v-button="<name>"`; colors follow official tokens and auto-switch with dark/light themes.

## Install

> **Environment requirement**: Harness (`dsh`) **0.1.2-rc.1 or later**. The snapshot store and UI primitives the client depends on are provided by the web shell's static seed table; earlier versions lack that seed word and the plugin will fail to load.

**Option 1 · Direct install from GitHub (recommended)** (zero build, no install-time scripts):

```sh
dsh plugin --profile web add "github:victor10035445/dsh-v-skill-links"
```

Pin a version (later pushes won't silently change running code):

```sh
dsh plugin --profile web add "github:victor10035445/dsh-v-skill-links#<commit-sha>"
```

**Option 2 · Local clone + link** (for development; changes take effect after restarting `dsh web`):

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
    buttons:                        # quick buttons (optional, settings page can override)
      - name: New
        prompt: Use the xxx skill to do xxx
        autoSend: true              # send immediately after inserting
      - name: Review
        prompt: Please use /code-review to review current changes
        model:                      # optional: bound model (absent = follow the session model)
          provider: deepseek-official
          model: deepseek-v4-pro
          reasoningEffort: max      # optional effort; omit for the provider/model default
```

The patch layer hot-reloads on save; if it doesn't, restart `dsh web`. Nonexistent directories are not fatal — empty menu groups auto-hide, and the `directories` array of `/api/v-skill-links/list` shows the specific errors.

For daily use, prefer the **visual settings page** (sidebar gear → **Settings → Skill Manager**):

- **Skill Mapping**: one directory per line, effective on save;
- **Custom Commands**: maintain name (lowercase `a-z 0-9 _ -`) + Prompt;
- **Quick Buttons**: maintain name (Chinese allowed) + Prompt + auto-send checkbox + **model / effort dropdowns** (candidates come from the same source as the session model menu; the effort dropdown appears only when the picked model carries reasoning levels and defaults to the highest; the first item "follow session model (default)" means unbound); drag the row handle or use "Move up / Move down" to reorder;
- The three tabs share one staged draft; "Save" on any tab writes everything; "Reset" falls back to the patch-file config.

### Model-bound buttons

Every quick button may bind `{ provider, model, reasoningEffort? }`; clicking appends the Prompt **and** switches that session to the bound model:

- **Unbound = follow the session**: the click never touches the model — behavior is byte-for-byte the old version;
- **No switching back after send**: the switch persists inside the session, later manual sends keep using that model; clicking another bound button later wins;
- **autoSend switches before sending**: the submit waits for the switch, so that turn definitely uses the bound model; unbound buttons gain no extra wait;
- **Failures never block**: retired model/effort or an unavailable connection → a toast, the Prompt is still appended; with autoSend the message goes out with the session's current model and the draft is never lost; subagent sessions skip the switch silently (no error);
- **Click guard**: clicks during an in-flight switch (and its submit) are ignored — no "second switch + first submit" mismatch;
- **Catalog degradation**: if the client remote is unavailable or the catalog fails to load, the settings row offers only "follow session model" plus a hint; bindings that vanished from the catalog are echoed as-is with an "unavailable" marker and are never silently rewritten.

Accepted upstream semantics (identical to switching models by hand in a session): the switch also updates the **new-session default model**, and when provider/model changes the system inserts a `[model changed: A → B]` notice before the next request (**effort-only changes insert nothing**).

### SKILL.md example (`~/my-skills/code-review/SKILL.md`)

```markdown
---
name: code-review
description: Review current changes against team conventions and output graded findings
---

# Code Review

1. Run `git diff` first ...
```

Frontmatter is optional: the skill name falls back to the directory name, the description to the first non-empty body line.

## Usage

1. Type `/` in the composer → the menu shows the **Commands / Skills / Mapped Skills** groups;
2. Pick an entry under "Mapped Skills" (or type `/name ` manually);
3. Add a sentence (optional) and send — the model receives your original message plus the skill's `<skill_content>` injection block, and follows its instructions.

**Custom Commands**: pick and it sends — great for one-click fixed routines; `/mapped-skill-name` tokens in the Prompt trigger the corresponding SKILL.md injection.

**Quick Buttons**: click to append (Ctrl/Cmd+Z undoes as a whole), auto-send equals Enter; display order follows the settings order, re-ordering applies on save. Buttons may bind a model and reasoning effort (see "Model-bound buttons") — unbound means following the session model.

### Quick Buttons vs Custom Commands

| | Quick Buttons | Custom Commands |
|---|---|---|
| Entry | Grid below the composer, always visible | `/` menu "Custom Commands" group |
| Name | Display label, Chinese allowed | Token name, lowercase `a-z 0-9 _ -` |
| Click behavior | **Append to draft** (keep editing) | **Send immediately** (bypasses the draft) |
| Auto-send | Optional checkbox | Inherently sends |
| Model binding | Model + effort bindable | Unbound (follows the session) |
| Best for | Drafting templates / referencing a skill then adding words | One-click fixed routines |

## Architecture

Zero npm dependencies, zero build steps — two entries + one manifest:

| File | Responsibility |
|---|---|
| Host `lib/index.js` | Config normalization, settings namespace `v-skill-links` registration (patch config as base, settings.yaml user layer overrides, hot switching), directory scanning + TTL cache, `/api/v-skill-links` routes (list / run / skill), `agent/pre-step` `<skill_content>` injection |
| Client `lib/client.js` | Two `/` trigger sources (Mapped Skills pinned, Custom Commands followup direct-send), quick buttons grid (session-mode composer.dock + new-session hero entry, mutually exclusive; button model binding = optional injection of the official client remote catalog/switch, degraded on failure), settings "Skill Manager" section + three tabs (staged save, override markers, per-section reset) |
| Manifest `package.json` | `dsh.bundle.patch` mounts the loader entry; `dsh.client` compiles the client into the /plugins startup graph |

## Relationship with native skills

| | Native "Skills" | Mapped Skills |
|---|---|---|
| Source | Project/user skill roots scanned by `dsh-skill-filesystem` | First-level subdirectories of configured directories |
| Model catalog | Enters `<available_skills>`, model may load autonomously | **Not in the catalog**, only explicit `/name` references |
| SKILL.md requirements | Stricter frontmatter validation | Any markdown, frontmatter optional |

## Known boundaries

- **Name clash with commands**: the command side wins — avoid command-like skill names;
- **Name clash with native skills**: both injections occur (rare);
- **Custom Commands**: never enter the host command registry; execution requires an **active agent** in the session (not-yet-restored sub-agent sessions get a 404 hint);
- **Injection is not replayed**: injection happens only on the step where the message enters; after session restore, historical tokens are not re-injected (consistent with the native gesture);
- **First-level subdirectories only**: deeper directories are not indexed;
- **Button grid scope**: the grid also appears below sub-agent session composers (the dock is session-scoped, config is global); when the composer is blocked by other plugins, buttons remain clickable and append to a temporarily invisible draft — visible and undoable once the block clears;
- **Style overrides**: the `.v-qb-*` hooks rely on "plugin style tags append at the end of head, same specificity means later wins"; hover hints use native `title`.

## Verify from source

```sh
pnpm check                                   # node --check both entries
pnpm test                                    # all 9 smoke tests in sequence
```

Or run them one by one:

```sh
node test/scan-smoke.mjs                     # config normalization / frontmatter / scan dedup
node test/inject-smoke.mjs                   # token matching / message filtering / render shape
node test/settings-schema-smoke.mjs          # settings schema contract / layered merge
node test/buttons-schema-smoke.mjs           # quick button schema (normalization / dedup / autoSend / model passthrough)
node test/settings-card-smoke.mjs            # settings section/tab contract (staged save / reset / dock registration / model draft)
node test/buttons-reorder-smoke.mjs          # button reorder (moveButton / drag & up-down)
node test/host-apply-smoke.mjs               # apply wiring + API end-to-end + pre-step injection
node test/client-shape-smoke.mjs             # client bundle shape (factory / trigger sources / contracts / model wiring)
node test/quick-buttons-client-smoke.mjs     # quick buttons client (click semantics / projection / disable / model switch & catalog bridge)
```

## License

MIT
