#!/usr/bin/env python3
"""
scan.py — collect loose-end candidates from recent top-level Kilo chats.

READ-ONLY. Opens the session database with mode=ro and PRAGMA query_only. It never
writes to the repository and never mutates the database. The only files it creates
are the ones you name with --out / --batches, which should live outside the repo
unless you deliberately want a findings doc in .kilo/plans.

Pass A material (tail text + dead-chat signals) and Pass B edges (forward
references) come from here. Pass C — is the issue closed on current main — is
judgment and belongs to you or to a subagent, not to this script.

Usage:
  scan.py --hours 4                      # default window: now -> 4h back
  scan.py --hours 6 --root /Users/x/ph
  scan.py --hours 4 --batches 6 --batch-dir /tmp/loose/b   # fan-out files
  scan.py --hours 4 --out /tmp/loose/bundle.json
  scan.py --hours 4 --emit-markdown -     # findings skeleton on stdout
"""

import argparse
import datetime as dt
import json
import os
import re
import sqlite3
import subprocess
import sys

# Abort / exhaustion phrasing. These are WEAK signals on their own: a chat can
# legitimately discuss the words. They only matter next to a dead-chat signal.
MARKERS = [
    "insufficient",
    "rate limit",
    "context length",
    "out of credit",
    "quota",
    "exceeded",
    "aborted",
    "aborting",
    "connection lost",
    "network error",
    "timed out",
    "timeout",
    "usage limit",
]

TERMINAL = tuple(".!?:`)]}\"'’”")


def epoch_ms(iso_utc):
    return int(dt.datetime.fromisoformat(iso_utc.replace("Z", "+00:00")).timestamp() * 1000)


def git_head(cwd):
    try:
        return subprocess.run(
            ["git", "-C", cwd, "rev-parse", "--short=12", "HEAD"],
            capture_output=True, text=True, timeout=10,
        ).stdout.strip() or None
    except Exception:
        return None


def connect(db_path):
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=15)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA query_only=ON")
    return con


def window_sessions(con, root, lo, hi):
    """Top-level sessions touched inside the window. parent_id IS NULL keeps
    subagent chatter out; the caller is asking about chats a human drove."""
    return con.execute(
        """
        SELECT id, title, directory, parent_id, revert, time_created, time_updated,
               datetime(time_updated/1000,'unixepoch') AS updated
        FROM session
        WHERE parent_id IS NULL
          AND (directory = :root OR directory LIKE :rootlike)
          AND time_updated >= :lo AND time_updated < :hi
        ORDER BY time_updated DESC
        """,
        {
            "root": root.rstrip("/"),
            "rootlike": root.rstrip("/") + "/%",
            "lo": lo,
            "hi": hi,
        },
    ).fetchall()


def parts_for(con, ids):
    """One query for the whole set. Do NOT scan `part` unbounded — an
    instr() over every part in the database takes minutes. Filtering by
    session_id first is what makes this ~0.04s for a 4h window."""
    if not ids:
        return []
    ph = ",".join("?" * len(ids))
    return con.execute(
        f"""
        SELECT p.session_id, p.time_created,
               json_extract(m.data,'$.role')            AS role,
               json_extract(p.data,'$.type')            AS ptype,
               json_extract(p.data,'$.state.status')    AS tstatus,
               json_extract(p.data,'$.state.error')     AS terr,
               trim(coalesce(json_extract(p.data,'$.text'),'')) AS text
        FROM part p JOIN message m ON m.id = p.message_id
        WHERE p.session_id IN ({ph}) AND json_valid(p.data)
           AND json_extract(p.data,'$.type') IN ('text','tool','step-start','step-finish','compaction')
        ORDER BY p.session_id, p.time_created, p.id
        """,
        ids,
    ).fetchall()


def forward_refs(con, ids, index):
    """Pass B edges. A later chat naming an earlier chat by session id, by its
    exact title, or by a distinctive title prefix continues that thread."""
    edges = {sid: [] for sid in ids}
    if not ids:
        return edges
    ph = ",".join("?" * len(ids))
    for meta in index.values():
        nid, ntitle = meta["id"], meta["title"]
        needles = [(nid, "session-id")]
        if ntitle and len(ntitle) >= 8:
            needles.append((ntitle, "exact-title"))
        for needle, kind in needles:
            rows = con.execute(
                f"""
                SELECT DISTINCT p.session_id AS src,
                       substr(json_extract(p.data,'$.text'),1,220) AS snip
                FROM part p JOIN message m ON m.id = p.message_id
                WHERE p.session_id IN ({ph}) AND json_valid(p.data)
                  AND json_extract(p.data,'$.type') = 'text'
                  AND p.session_id <> ?
                  AND instr(json_extract(p.data,'$.text'), ?) > 0
                LIMIT 8
                """,
                ids + [nid, needle],
            ).fetchall()
            for r in rows:
                edges[nid].append({
                    "by": r["src"],
                    "kind": kind,
                    "needle": needle,
                    "snippet": (r["snip"] or "").replace("\n", " ")[:200],
                })
    for sid in edges:
        seen, uniq = set(), []
        for e in edges[sid]:
            k = (e["by"], e["kind"])
            if k not in seen:
                seen.add(k)
                uniq.append(e)
        edges[sid] = uniq
    return edges


def dead_signals(parts, revert, updated_ms, now_ms, grace_ms):
    """Strong signals mean the transcript itself stops mid-action. Weak signals
    are phrasing that only corroborates. Return (strong, weak, facts).

    A chat that is STILL RUNNING also ends on a running tool part, so a session
    updated inside the grace window is reported as active and never as dead.
    Without this the scan always flags the session doing the scan."""
    strong, weak, facts = [], [], {}
    live = (now_ms - updated_ms) <= grace_ms
    facts["live"] = live
    if not parts:
        return ([] if live else ["no-parts-at-all"]), ([] if live else ["just-started"]), facts

    last = parts[-1]
    facts["last_part"] = {"type": last["ptype"], "role": last["role"], "status": last["tstatus"]}

    if live:
        pass  # an in-flight chat is not a loose end
    elif last["ptype"] == "tool" and last["tstatus"] in ("running", "pending"):
        strong.append(f"last-part-tool-{last['tstatus']}")
    elif last["ptype"] == "step-start":
        strong.append("last-part-step-start-never-finished")

    asst_text = [p for p in parts if p["role"] == "assistant" and p["ptype"] == "text" and p["text"]]
    facts["assistant_text_parts"] = len(asst_text)
    facts["parts"] = len(parts)
    if not asst_text:
        strong.append("no-assistant-text")

    tool_errors = [p for p in parts if p["ptype"] == "tool" and p["tstatus"] == "error"]
    facts["tool_errors"] = len(tool_errors)
    tail_tools = [p for p in parts[-6:] if p["ptype"] == "tool"]
    if tool_errors and tail_tools and tail_tools[-1]["tstatus"] == "error":
        strong.append("dies-on-tool-error")
    facts["last_tool_error"] = (tool_errors[-1]["terr"] or "")[:200] if tool_errors else None

    if any(p["ptype"] == "compaction" for p in parts[-5:]):
        strong.append("compacted-then-stopped")

    if revert:
        weak.append("session-revert-recorded")

    if asst_text:
        final = asst_text[-1]["text"]
        facts["final_text_chars"] = len(final)
        if len(final) < 400 and final[-1:] not in TERMINAL:
            weak.append("final-text-short-unterminated")
        low = final.lower()
        hits = sorted({m for m in MARKERS if m in low})
        if hits:
            weak.append("markers:" + ",".join(hits[:4]))

    return strong, weak, facts


def slice_tail(parts, n_messages=3, cap=9000):
    asst = [p for p in parts if p["role"] == "assistant" and p["ptype"] == "text" and p["text"]]
    tail = "\n\n---\n\n".join(p["text"] for p in asst[-n_messages:])
    if len(tail) > cap:
        tail = "...[HEAD TRUNCATED]...\n" + tail[-cap:]
    return tail


def last_user(parts):
    u = [p for p in parts if p["role"] == "user" and p["ptype"] == "text" and p["text"]]
    return u[-1]["text"][:700] if u else ""


def split_batches(sessions, n):
    buckets = [[] for _ in range(n)]
    sizes = [0] * n
    for s in sorted(sessions, key=lambda x: -len(x["tail"])):
        i = sizes.index(min(sizes))
        buckets[i].append(s)
        sizes[i] += len(s["tail"]) + 1200
    return buckets


MARKDOWN_SKELETON = """# Chat loose ends — {start} to {end}

Window {hours}h back from {now}. Top-level chats under `{root}`.
main at `{head}` when this scan ran. Generated by
`.skills/chat-loose-end-scan/scan.py`; Pass C judgement is not machine-made.

Read the rest of this file as prose with one loose end per `##` block. A block is
a thread that started, named something concrete, and has no closing move — either
because the chat died, or because a reviewer reported a finding nobody answered.

Each block carries: the chat it came from and whether that chat died, the verbatim
claim, whether a LATER chat picked the thread up by naming this chat (that is the
continuation case, and it usually means the issue got handled), and what current
main actually shows. The last line is the verdict: OPEN, CLOSED-BY-MAIN,
CLOSED-BY-LATER-CHAT, or UNVERIFIED. UNVERIFIED means nobody read the code; do not
let it read like OPEN without saying so.

Order the blocks worst-first: silent data loss and wrong pixels before a missing
test before a doc line.
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=os.path.expanduser("~/.local/share/kilo/kilo.db"))
    ap.add_argument("--root", default=os.getcwd())
    ap.add_argument("--hours", type=float, default=4.0)
    ap.add_argument("--now-grace", type=int, default=180,
                    help="seconds; a chat updated this recently is live, not dead")
    ap.add_argument("--start", help="ISO-8601 UTC, overrides --hours")
    ap.add_argument("--out")
    ap.add_argument("--batches", type=int, default=0)
    ap.add_argument("--batch-dir")
    ap.add_argument("--emit-markdown", metavar="PATH", help="'-' for stdout")
    args = ap.parse_args()

    now = dt.datetime.now(dt.timezone.utc)
    now_ms = int(now.timestamp() * 1000)
    hi = now_ms
    lo = epoch_ms(args.start) if args.start else hi - int(args.hours * 3600 * 1000)

    con = connect(args.db)
    rows = window_sessions(con, args.root, lo, hi)
    ids = [r["id"] for r in rows]
    parts = parts_for(con, ids)
    by = {}
    for p in parts:
        by.setdefault(p["session_id"], []).append(p)
    index = {r["id"]: dict(r) for r in rows}
    edges = forward_refs(con, ids, index)

    sessions = []
    for r in rows:
        ps = by.get(r["id"], [])
        strong, weak, facts = dead_signals(
            ps, r["revert"], r["time_updated"], now_ms, args.now_grace * 1000
        )
        sessions.append({
            "id": r["id"],
            "title": r["title"],
            "directory": r["directory"],
            "created": r["time_created"],
            "updated": r["updated"],
            "updated_iso": r["updated"],
            "revert": r["revert"],
            "facts": facts,
            "dead_signals_strong": strong,
            "dead_signals_weak": weak,
            "referenced_by": edges.get(r["id"], []),
            "last_user": last_user(ps),
            "tail": slice_tail(ps),
        })

    bundle = {
        "window": {
            "start_iso": dt.datetime.fromtimestamp(lo / 1000, dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "end_iso": dt.datetime.fromtimestamp(hi / 1000, dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "hours": args.hours,
        },
        "root": args.root,
        "head": git_head(args.root),
        "db": args.db,
        "sessions": sessions,
    }

    if args.out:
        os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
        with open(args.out, "w") as fh:
            json.dump(bundle, fh, indent=1)
        print(f"wrote {args.out}", file=sys.stderr)

    if args.batches and args.batch_dir:
        os.makedirs(args.batch_dir, exist_ok=True)
        for i, chunk in enumerate(split_batches(sessions, args.batches)):
            path = os.path.join(args.batch_dir, f"b{i:02d}.json")
            with open(path, "w") as fh:
                json.dump(chunk, fh, indent=1)
            print(f"wrote {path} ({len(chunk)} sessions, "
                  f"{sum(len(c['tail']) for c in chunk)} chars)", file=sys.stderr)

    if args.emit_markdown:
        w = bundle["window"]
        doc = MARKDOWN_SKELETON.format(
            start=w["start_iso"], end=w["end_iso"], hours=w["hours"],
            now=w["end_iso"], root=args.root, head=bundle["head"] or "unknown",
        )
        ranked = sorted(
            sessions,
            key=lambda s: (-len(s["dead_signals_strong"]),
                           -len(s["referenced_by"]),
                           -(s["facts"].get("tool_errors") or 0),
                           s["updated"]),
        )
        doc += "\n## Candidates, unjudged\n\n"
        for s in ranked:
            tag = "DEAD" if s["dead_signals_strong"] else "live"
            doc += (f"- `{s['id']}` [{tag}] {s['title']!r} — "
                    f"{s['facts'].get('tool_errors', 0)} tool errors, "
                    f"{len(s['referenced_by'])} forward ref(s), "
                    f"updated {s['updated_iso']}\n")
        if args.emit_markdown == "-":
            print(doc)
        else:
            os.makedirs(os.path.dirname(args.emit_markdown) or ".", exist_ok=True)
            with open(args.emit_markdown, "w") as fh:
                fh.write(doc)
            print(f"wrote {args.emit_markdown}", file=sys.stderr)

    strong_n = sum(1 for s in sessions if s["dead_signals_strong"])
    print(f"window {bundle['window']['start_iso']} -> {bundle['window']['end_iso']}: "
          f"{len(sessions)} top-level chats, {strong_n} with a strong dead-chat signal, "
          f"{sum(len(s['referenced_by']) for s in sessions)} forward-reference edges",
          file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
