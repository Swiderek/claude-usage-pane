"""Tests for scripts/usage.py. Run: python3 -I tests/test_usage.py

Each test lays out a made-up ~/.claude/projects in a temporary folder, points
CLAUDE_CONFIG_DIR at it and reads the script's JSON.
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest

SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts", "usage.py")
SESSION = "11111111-2222-3333-4444-555555555555"


def assistant(msg_id, cwd, *, output=10, sidechain=False, agent=None):
    row = {
        "type": "assistant",
        "timestamp": "2026-10-30T12:00:00Z",
        "sessionId": SESSION,
        "requestId": f"req_{msg_id}",
        "cwd": cwd,
        "isSidechain": sidechain,
        "message": {
            "id": msg_id,
            "model": "claude-opus-5-5",
            "usage": {"input_tokens": 100, "cache_read_input_tokens": 0,
                      "cache_creation_input_tokens": 0, "output_tokens": output},
        },
    }
    if agent:
        row["agentId"] = agent
    return json.dumps(row, ensure_ascii=False)


def write(path, lines):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")


class UsageTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.project = os.path.join(self.tmp.name, "projects", "-code-shop")

    def tearDown(self):
        self.tmp.cleanup()

    def run_script(self):
        env = {**os.environ, "CLAUDE_CONFIG_DIR": self.tmp.name}
        out = subprocess.run([sys.executable, "-I", SCRIPT, "2000-01-01T00:00:00Z"],
                             env=env, capture_output=True, check=True)
        text = out.stdout.decode("ascii")  # fails on any non-ASCII byte
        return json.loads(text)

    def test_windows_paths_agents_and_a_polish_title(self):
        cwd = r"C:\Users\ann\code\shop\.claude\worktrees\fix-login"
        write(os.path.join(self.project, f"{SESSION}.jsonl"), [
            json.dumps({"type": "ai-title", "aiTitle": "Zażółć gęślą jaźń"}, ensure_ascii=False),
            assistant("m1", cwd),
            assistant("m1", cwd),  # one response written twice counts once
        ])
        write(os.path.join(self.project, SESSION, "subagents", "agent-a1.jsonl"), [
            assistant("m2", cwd, output=30, sidechain=True, agent="a1"),
        ])

        report = self.run_script()

        self.assertEqual(report["sessions"], 1)
        self.assertEqual(report["agents"], 1)
        self.assertEqual(report["projects"][0]["label"], "shop")
        self.assertEqual(report["topSessions"][0]["title"], "Zażółć gęślą jaźń")
        # 100 input + 5x output: 150 for you, 250 for the agent.
        self.assertEqual(report["total"], 400)
        self.assertEqual(report["subTotal"], 250)

    def test_agent_rows_kept_in_the_session_file_count_as_agents(self):
        write(os.path.join(self.project, f"{SESSION}.jsonl"), [
            assistant("m1", "/home/ann/code/shop"),
            assistant("m2", "/home/ann/code/shop", sidechain=True, agent="a9"),
        ])

        report = self.run_script()

        self.assertEqual(report["agents"], 1)
        self.assertEqual(report["subTotal"], 150)
        self.assertEqual(report["sessionsWithAgents"], 1)


    def test_home_folder_is_named_and_synthetic_rows_are_not_a_model(self):
        home = os.path.expanduser("~")
        synthetic = json.loads(assistant("m2", home, output=0))
        synthetic["message"]["model"] = "<synthetic>"
        synthetic["message"]["usage"] = {"input_tokens": 0, "output_tokens": 0}
        write(os.path.join(self.project, f"{SESSION}.jsonl"), [
            assistant("m1", home),
            json.dumps(synthetic),
        ])

        report = self.run_script()

        self.assertEqual(report["projects"][0]["label"], "(home folder)")
        self.assertEqual(report["topSessions"][0]["project"], "(home folder)")
        self.assertEqual([m["model"] for m in report["models"]], ["opus-5-5"])


if __name__ == "__main__":
    unittest.main()
