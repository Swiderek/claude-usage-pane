#!/usr/bin/env python3
"""Claude Code token usage per project and session since a given moment (ISO 8601).

Reads the local transcripts under ~/.claude/projects/**/*.jsonl and prints JSON
(UsageReport in types/index.d.ts). Tokens are weighted by what they cost relative
to a plain input token: input 1x, cache read 0.1x, cache write (5 min) 1.25x,
cache write (1 h) 2x, output 5x.
"""
import collections
import datetime as dt
import glob
import json
import os
import re
import sys
import time

ROOT = os.path.expanduser("~/.claude/projects")
HOME = os.path.expanduser("~")
TOP = 8


def project_of(cwd):
    if not cwd:
        return "?"
    cwd = re.sub(r"/\.(claude/)?worktrees/.*$", "", cwd)
    if "scratch-workspaces" in cwd:
        return "(no folder)"
    return cwd.replace(HOME, "~")


def short(project):
    return project.rstrip("/").rsplit("/", 1)[-1] or project


def effective(u):
    cc = u.get("cache_creation") or {}
    w5, w1 = cc.get("ephemeral_5m_input_tokens"), cc.get("ephemeral_1h_input_tokens")
    if w5 is None and w1 is None:
        w5, w1 = 0, u.get("cache_creation_input_tokens", 0)
    return (u.get("input_tokens", 0) + 0.1 * u.get("cache_read_input_tokens", 0)
            + 1.25 * (w5 or 0) + 2 * (w1 or 0) + 5 * u.get("output_tokens", 0))


def first_prompt(line):
    try:
        c = json.loads(line)["message"]["content"]
        txt = c if isinstance(c, str) else next((x.get("text") for x in c if x.get("type") == "text"), None)
        if txt and not txt.startswith("<"):
            return txt.strip().splitlines()[0][:70]
    except Exception:
        pass
    return None


def main():
    since_arg = sys.argv[1] if len(sys.argv) > 1 else None
    if since_arg:
        since = dt.datetime.fromisoformat(since_arg.replace("Z", "+00:00"))
    else:
        since = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=7)
    cutoff = since.timestamp()

    seen = set()
    sess = {}
    models = collections.Counter()

    for path in glob.glob(f"{ROOT}/**/*.jsonl", recursive=True):
        try:
            if os.path.getmtime(path) < cutoff:
                continue
        except OSError:
            continue
        # Subagents (Agent tool, workflows) write beside their session:
        # <session id>/subagents/**/agent-*.jsonl
        is_sub = "/subagents/" in path
        parent = path.split("/subagents/")[0].rsplit("/", 1)[-1] if is_sub else None
        title = prompt = None
        with open(path, errors="ignore") as fh:
            for line in fh:
                if not is_sub and '"ai-title"' in line:
                    try:
                        title = json.loads(line).get("aiTitle") or title
                    except Exception:
                        pass
                    continue
                if not is_sub and prompt is None and '"type":"user"' in line:
                    prompt = first_prompt(line)
                if '"usage"' not in line or '"assistant"' not in line:
                    continue
                try:
                    d = json.loads(line)
                except Exception:
                    continue
                ts = d.get("timestamp")
                if d.get("type") != "assistant" or not ts:
                    continue
                if dt.datetime.fromisoformat(ts.replace("Z", "+00:00")) < since:
                    continue
                m = d.get("message", {})
                # One response is written as several lines that repeat its usage.
                key = (m.get("id"), d.get("requestId"))
                if key in seen:
                    continue
                seen.add(key)
                e = effective(m.get("usage") or {})
                sid = parent or d.get("sessionId")
                s = sess.setdefault(sid, {"eff": 0.0, "sub": 0.0, "agents": set(), "proj": None,
                                         "title": None, "prompt": None})
                s["eff"] += e
                if is_sub:
                    s["sub"] += e
                    s["agents"].add(path)
                elif not s["proj"]:
                    s["proj"] = project_of(d.get("cwd"))
                if not s["proj"] and d.get("cwd"):
                    s["proj"] = project_of(d.get("cwd"))
                models[m.get("model", "?")] += e
        if not is_sub:
            sid = os.path.basename(path)[:-6]
            if sid in sess:
                try:
                    with open(path[:-6] + "/custom-title.json") as fh:
                        title = json.load(fh).get("customTitle") or title
                except Exception:
                    pass
                sess[sid]["title"] = title or sess[sid]["title"]
                sess[sid]["prompt"] = prompt or sess[sid]["prompt"]

    projects = collections.Counter()
    project_sub = collections.Counter()
    for s in sess.values():
        projects[s["proj"] or "?"] += s["eff"]
        project_sub[s["proj"] or "?"] += s["sub"]
    ranked = sorted(sess.values(), key=lambda s: -s["eff"])

    report = {
        "since": since.astimezone(dt.timezone.utc).isoformat().replace("+00:00", "Z"),
        "isRolling": since_arg is None,
        "generatedAt": int(time.time() * 1000),
        "total": round(sum(projects.values())),
        "subTotal": round(sum(s["sub"] for s in sess.values())),
        "sessions": len(sess),
        "agents": sum(len(s["agents"]) for s in sess.values()),
        "sessionsWithAgents": sum(1 for s in sess.values() if s["agents"]),
        "projects": [{"label": short(p), "path": p, "eff": round(v), "subEff": round(project_sub[p])}
                     for p, v in projects.most_common(TOP)],
        "topSessions": [
            {"title": s["title"] or s["prompt"] or "(untitled)", "project": short(s["proj"] or "?"),
             "eff": round(s["eff"]), "subEff": round(s["sub"]), "agents": len(s["agents"])}
            for s in ranked[:TOP]
        ],
        "models": [{"model": k.replace("claude-", ""), "eff": round(v)} for k, v in models.most_common(4)],
    }
    json.dump(report, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
