# claude-usage-pane

A Claude Code mod (function-hook plugin): a pane with plan limits, weekly pace, and token usage per project, session and agent.

## Layout

- `hooks/register.tsx`: the hooks module. Opens the pane, refreshes every 5 minutes, draws it.
- `hooks/register.test.tsx`: tests, run with `claude plugin test .`.
- `tests/test_usage.py`: the script's tests on made-up transcripts, run with `python3 -I tests/test_usage.py`.
- `scripts/usage.py`: reads `~/.claude/projects/**/*.jsonl` and prints a `UsageReport` as JSON. Standard library only.
- `types/index.d.ts`: the report's shape and the plugin's `$.state` contract.
- `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`: manifest and one-plugin marketplace.

## Rules

- This repository is public. No real project names, session titles, paths, accounts or client data in code, tests, docs or commits: test fixtures use made-up names (`example-app`).
- No network access and no shell: the only command is `python3 -I scripts/usage.py [since]` through `$.process.run`.
- When a `UsageReport` field changes, update `types/index.d.ts`, the script and the atom's `shape` tag together.
- Paths are compared with `/` (Windows too); the script reads and writes UTF-8 and prints ASCII-escaped JSON.
- Before a commit: `claude plugin validate .`, `claude plugin test .` and `python3 -I tests/test_usage.py` pass.
