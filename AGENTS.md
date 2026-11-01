# claude-usage-pane

A Claude Code mod (function-hook plugin): a pane with plan limits, weekly pace, and token usage per project, session and agent.

## Layout

- `hooks/register.tsx`: the hooks module. Opens the pane, refreshes every 5 minutes, draws it.
- `hooks/register.test.tsx`: tests, run with `claude plugin test .`.
- `scripts/usage.py`: reads `~/.claude/projects/**/*.jsonl` and prints a `UsageReport` as JSON. Standard library only.
- `types/index.d.ts`: the report's shape and the plugin's `$.state` contract.
- `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`: manifest and one-plugin marketplace.

## Rules

- This repository is public. No real project names, session titles, paths, accounts or client data in code, tests, docs or commits: test fixtures use made-up names (`example-app`).
- No network access and no shell: the only command is `python3 -I scripts/usage.py [since]` through `$.process.run`.
- When a `UsageReport` field changes, update `types/index.d.ts`, the script and the atom's `shape` tag together.
- Before a commit: `claude plugin validate .` and `claude plugin test .` pass.
