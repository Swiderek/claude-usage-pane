# claude-usage-pane

A pane beside the Claude Code chat that answers "where did my tokens go this week?" It shows your plan limits live, whether you are using the weekly limit faster than the week is passing, and which projects, sessions and agents used the most.

**Everything is computed locally, on your computer. The plugin sends no data anywhere:** no network requests, no telemetry, and nothing it counts is added to your conversation with Claude. See [Privacy](#privacy).

![The usage pane with made-up projects; numbered notes explain each part](docs/pane-annotated.svg)

## What it shows

- **Plan limits**: the weekly and 5-hour windows as Claude Code reports them, with time to reset. Green below 75%, yellow from 75%, red from 90%.
- **Pace**: the share of the weekly limit used against the share of the week gone. If the current pace would use up the limit before it resets, the row says when. It stays hidden for the first 12 hours of a week.
- **Who used it**: your own conversations against the subagents and workflow agents they started. Agents usually dominate: each one starts by reading the full system prompt and tool list.
- **Projects and sessions**: the eight biggest of each this week, split the same way.

### The line above the prompt

The three numbers that matter most stay in view above the prompt, even with the pane closed:

```
Week 68% · fast, runs out in 1d 22h · agents 62%   [Usage]
```

**Usage** opens the pane. The line appears once there is something to show, makes way while Claude asks you a multiple-choice question, and is not drawn on a phone. Turn it off with the `band` setting.

## Install

Requires Claude Code with function-hook plugins (mods), 2.1.309 or newer, and Python 3. Nothing else needs installing: the script uses only Python's standard library.

- **macOS and Linux:** the system or Homebrew Python is enough.
- **Windows:** install Python for your user, no administrator rights needed: `winget install Python.Python.3.13`, or the installer from python.org. The plugin tries `python3`, then the `py` launcher, then `python`, and skips the Microsoft Store shortcut that only says Python is missing.

At the prompt of a terminal session:

```
/plugin install usage-pane --marketplace Swiderek/claude-usage-pane
```

From a shell:

```
claude plugin install usage-pane --marketplace Swiderek/claude-usage-pane
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `Swiderek/claude-usage-pane`, then Add plugin.

The plugin loads when a session starts, so open a new session after installing.

## Open the pane

### In the terminal

1. Start a new session with `claude`. The pane opens by itself.
   - In a terminal at least 110 columns wide, in fullscreen, it sits beside the conversation.
   - In a narrower one it sits above the prompt.
2. Closed it? Type `/usage-pane` and press Enter.
3. To refresh right away, press ctrl+x then Tab to move into the pane, then `r`. Otherwise it refreshes every 5 minutes.

### In the desktop app

1. Open a new session in the Code tab. The pane opens by itself on the right.
2. Closed it? Type `/usage-pane` in the prompt box and send it. The box may say "/usage-pane isn't a command here": send it anyway, and the reply "Usage pane opened." confirms it.
3. Click **Refresh** to count again right away. Otherwise it refreshes every 5 minutes.

The plan limits appear after the model's first reply in the session, because Claude Code reads them from that reply.

### On a phone

The pane shows no usage on a phone, so your project names and session titles stay off a screen others can easily see. If the mobile app draws plugin panes, it shows only "Usage is hidden on the phone."

## Update

1. From a shell (Terminal on macOS and Linux, PowerShell on Windows):

   ```
   claude plugin update usage-pane
   ```

   If it says the plugin is already at the latest version while GitHub has a newer one, refresh the marketplace first, then run the update again:

   ```
   claude plugin marketplace update usage-pane
   ```

2. Apply it:
   - **Terminal:** type `/reload-plugins` in the open session, or start a new one.
   - **Desktop app:** open a new session. Sessions that were already open keep the old version.

The version you run is in `/plugin` (terminal), or from a shell: `claude plugin list`.

## Settings

| Option | Values | Default |
| --- | --- | --- |
| `panel` | `auto` opens the pane at session start; `command` opens it only with `/usage-pane` | `auto` |
| `band` | `on` shows the line above the prompt; `off` hides it | `on` |

Change them in `/config` in a terminal session, under the plugin's rows, or from a shell. For example, to hide the line above the prompt:

```
echo '{"band":"off"}' | claude plugin configure usage-pane@usage-pane --values-stdin
```

The change applies to sessions started after it.

## How the numbers are counted

The plugin reads the transcripts Claude Code keeps on your machine (`~/.claude/projects/**/*.jsonl`, or under `CLAUDE_CONFIG_DIR` when you set it) with `scripts/usage.py`. It counts every model response since the weekly limit last reset, once, and weights each kind of token by its cost against a plain input token:

| Token kind | Weight |
| --- | --- |
| input | 1× |
| cache read | 0.1× |
| cache write, 5 minutes | 1.25× |
| cache write, 1 hour | 2× |
| output | 5× |

The result is "effective tokens": a share of your usage, not a bill. Percentages in the pane are shares of that total. The plan-limit percentages come from Claude Code itself.

The count refreshes every 5 minutes. Sessions open at the same time share one count for 4 minutes, so several open sessions do not each re-read your transcripts. **Refresh** (or `r` while the pane has focus) counts again right away.

## Privacy

- **All computation is local.** `scripts/usage.py` reads your transcripts on your computer and the pane draws the result there.
- **No data leaves your computer.** The plugin makes no network requests and has no telemetry. The script imports only Python's standard library and opens no network connection.
- **Nothing reaches the model.** What the pane counts and shows is not added to your conversation, so it is not sent to Claude with your messages.
- **What it reads:** only `~/.claude/projects` (or `CLAUDE_CONFIG_DIR/projects`). It shows project folder names and session titles in the pane.
- **What it stores:** the last count, in Claude Code's local plugin storage, so sessions open at the same time can share it.
- **What it runs:** one local command, `python3 -I scripts/usage.py` (or `py -3`, `python`), without a shell, from the plugin's own folder.
- **Check it yourself:** `claude plugin validate .` lists every call the plugin makes to Claude Code. None of them is a network call (`$.http`).
- **Not on the phone.** The pane draws no usage for the mobile app: it reads nothing for that screen and shows only a short note.
- If you open a session in another app through Claude Code's remote access (a second computer, VS Code), Claude Code shows the pane there the same way it shows the conversation. The plugin itself still sends nothing.

## Limitations

- The transcript format is internal to Claude Code and not a stable interface. An update can change it and break the count.
- Conversations on claude.ai (web, desktop or mobile chat) are not stored locally, so they are not counted here, although they count toward the same plan limits.
- A `-p` run that no app connects to does not open the pane or count in the background.
- Transcripts larger than 4 MB are common, and plugins cannot read files that large themselves, so the count needs Python.

## Development

```
claude plugin validate .
claude plugin test .
python3 -I tests/test_usage.py
```

## License

MIT, see [LICENSE](LICENSE).
