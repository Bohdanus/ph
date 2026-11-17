#!/usr/bin/env python3
"""
Chat loose-end scanner for Kilo sessions.

Reads the local Kilo SQLite database and identifies top-level chats in the
specified time window that ended with concrete claims but no closing move.

Usage:
    python3 scan.py --hours 4 --root /path/to/repo
    python3 scan.py --start 2026-10-05T08:00:00Z --hours 4 --root /path/to/repo
    python3 scan.py --hours 4 --root /path/to/repo --batches 6 --batch-dir /tmp/batches --out /tmp/bundle.json --emit-markdown .kilo/plans/findings.md
"""

import argparse
import json
import os
import sqlite3
import sys
import textwrap
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


def find_kilo_db() -> str:
    """Find the Kilo SQLite database."""
    candidates = [
        os.environ.get("KILO_DB"),
        os.path.expanduser("~/.local/share/kilo/kilo.db"),
        os.path.expanduser("~/Library/Application Support/kilo/kilo.db"),
    ]
    for c in candidates:
        if c and os.path.exists(c):
            return c
    raise FileNotFoundError("Kilo database not found. Set KILO_DB or run where Kilo runs.")


def get_top_level_chats(db_path: str, window_start_ms: int, window_end_ms: int) -> List[Dict[str, Any]]:
    """Get top-level sessions in the time window."""
    query = """
    SELECT id, title, directory, agent, json_extract(model, '$.id') AS model_id,
           time_created, time_updated
    FROM session
    WHERE parent_id IS NULL OR parent_id = ''
      AND time_updated >= ?
      AND time_updated <= ?
    ORDER BY time_updated DESC;
    """
    with sqlite3.connect(f"file:{db_path}?mode=ro", uri=True) as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.execute(query, (window_start_ms, window_end_ms))
        return [dict(row) for row in cursor.fetchall()]


def get_last_assistant_parts(db_path: str, session_id: str, limit: int = 3) -> List[Dict[str, Any]]:
    """Get the last N assistant message parts for a session."""
    query = """
    SELECT p.id, p.message_id, p.time_created, p.data
    FROM part AS p
    JOIN message AS m ON m.id = p.message_id
    WHERE m.session_id = ?
      AND json_valid(p.data)
      AND json_extract(p.data, '$.type') = 'text'
      AND json_extract(m.data, '$.role') = 'assistant'
      AND coalesce(json_extract(p.data, '$.synthetic'), 0) = 0
      AND coalesce(json_extract(p.data, '$.ignored'), 0) = 0
    ORDER BY p.time_created DESC
    LIMIT ?;
    """
    with sqlite3.connect(f"file:{db_path}?mode=ro", uri=True) as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.execute(query, (session_id, limit))
        parts = []
        for row in cursor.fetchall():
            data = json.loads(row["data"])
            parts.append({
                "id": row["id"],
                "message_id": row["message_id"],
                "time_created": row["time_created"],
                "text": data.get("text", ""),
                "tool_calls": data.get("tool_calls", []),
            })
        return list(reversed(parts))  # chronological order


def get_referencing_chats(db_path: str, session_id: str, session_title: str) -> List[Dict[str, Any]]:
    """Find chats that reference this session by ID or exact title."""
    title_safe = session_title.replace("'", "''")
    query = f"""
    SELECT s.id, s.title, s.time_updated,
           m.id AS msg_id, p.id AS part_id, p.data
    FROM session AS s
    JOIN message AS m ON m.session_id = s.id
    JOIN part AS p ON p.message_id = m.id
    WHERE s.parent_id IS NULL OR s.parent_id = ''
      AND json_valid(p.data)
      AND json_extract(p.data, '$.type') = 'text'
      AND json_extract(p.data, '$.text') LIKE '%{session_id}%'
         OR json_extract(p.data, '$.text') LIKE '%{title_safe}%'
    ORDER BY s.time_updated DESC;
    """
    with sqlite3.connect(f"file:{db_path}?mode=ro", uri=True) as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.execute(query)
        return [dict(row) for row in cursor.fetchall()]


def extract_claims(text: str) -> List[str]:
    """Extract concrete claims from text (heuristic)."""
    claims = []
    lines = text.split("\n")
    for line in lines:
        line = line.strip()
        if not line:
            continue
        # Heuristics for concrete claims
        if any(keyword in line.lower() for keyword in [
            "defect", "bug", "issue", "problem", "error", "fail", "broken",
            "next step", "worth doing", "should", "would be better to",
            "plan", "phase", "step", "will do", "need to",
            "fixed", "resolved", "added", "removed", "changed",
            "file:", "line:", "function", "method", "component",
            "test", "assert", "verify", "check",
        ]):
            claims.append(line[:500])  # truncate long lines
    return claims[:20]  # limit claims per message


def classify_dead_chat(last_parts: List[Dict], grace_seconds: int = 180) -> Tuple[str, Optional[str]]:
    """Classify if a chat appears dead and why."""
    if not last_parts:
        return "empty", "no assistant messages"

    last_part = last_parts[-1]
    text = last_part.get("text", "")
    tool_calls = last_part.get("tool_calls", [])

    # Check for running tool calls
    for tc in tool_calls:
        if isinstance(tc, dict) and tc.get("state", {}).get("status") == "running":
            return "running", "active tool call"

    # Check for error states
    for tc in tool_calls:
        if isinstance(tc, dict) and tc.get("state", {}).get("status") == "error":
            return "error", f"tool error: {tc.get('state', {}).get('error', 'unknown')}"

    # Check for credit/context wall indicators in text
    if any(phrase in text.lower() for phrase in [
        "out of credits", "add credits", "rate limit", "context length",
        "token limit", "maximum length", "truncated",
    ]):
        return "wall", "model credit/context wall"

    # If text ends mid-sentence or with incomplete thought
    if text and not text.rstrip().endswith((".", "!", "?", "```")):
        return "incomplete", "text ends without terminal punctuation"

    return "unknown", None


def main():
    parser = argparse.ArgumentParser(description="Scan Kilo chats for loose ends")
    parser.add_argument("--hours", type=float, default=4, help="Hours back from now (default: 4)")
    parser.add_argument("--start", type=str, help="ISO start time (overrides --hours)")
    parser.add_argument("--root", type=str, required=True, help="Repository root path")
    parser.add_argument("--batches", type=int, default=1, help="Number of output batches")
    parser.add_argument("--batch-dir", type=str, help="Directory for batch files")
    parser.add_argument("--out", type=str, help="Output bundle JSON path")
    parser.add_argument("--emit-markdown", type=str, help="Emit markdown findings doc")
    parser.add_argument("--now-grace", type=int, default=180, help="Grace period in seconds for running chats")
    args = parser.parse_args()

    # Time window
    now = datetime.now(timezone.utc)
    if args.start:
        window_start = datetime.fromisoformat(args.start.replace("Z", "+00:00"))
    else:
        window_start = now - timedelta(hours=args.hours)
    window_end = now

    window_start_ms = int(window_start.timestamp() * 1000)
    window_end_ms = int(window_end.timestamp() * 1000)

    print(f"Window: {window_start.isoformat()} to {window_end.isoformat()} ({args.hours}h)", file=sys.stderr)

    # Find database
    db_path = find_kilo_db()
    print(f"Database: {db_path}", file=sys.stderr)

    # Get top-level chats
    chats = get_top_level_chats(db_path, window_start_ms, window_end_ms)
    print(f"Found {len(chats)} top-level chats in window", file=sys.stderr)

    # Process each chat
    results = []
    for chat in chats:
        session_id = chat["id"]
        last_parts = get_last_assistant_parts(db_path, session_id)
        dead_status, dead_reason = classify_dead_chat(last_parts, args.now_grace)

        # Extract claims
        all_claims = []
        for part in last_parts:
            all_claims.extend(extract_claims(part.get("text", "")))

        # Find referencing chats
        refs = get_referencing_chats(db_path, session_id, chat["title"])
        referenced_by = []
        for ref in refs:
            if ref["id"] != session_id:  # exclude self
                referenced_by.append({
                    "id": ref["id"],
                    "title": ref["title"],
                    "time_updated": ref["time_updated"],
                })

        results.append({
            "session": chat,
            "last_parts": last_parts,
            "dead_status": dead_status,
            "dead_reason": dead_reason,
            "claims": all_claims,
            "referenced_by": referenced_by,
        })

    # Write bundle
    bundle = {
        "window": {"start": window_start.isoformat(), "end": window_end.isoformat()},
        "grace_seconds": args.now_grace,
        "total_chats": len(results),
        "chats": results,
    }

    if args.out:
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        with open(args.out, "w") as f:
            json.dump(bundle, f, indent=2)
        print(f"Bundle written to {args.out}", file=sys.stderr)

    # Write batches
    if args.batches > 1 and args.batch_dir:
        Path(args.batch_dir).mkdir(parents=True, exist_ok=True)
        batch_size = (len(results) + args.batches - 1) // args.batches
        for i in range(args.batches):
            batch = results[i * batch_size:(i + 1) * batch_size]
            batch_file = Path(args.batch_dir) / f"batch-{i:03d}.json"
            with open(batch_file, "w") as f:
                json.dump({
                    "batch": i,
                    "total_batches": args.batches,
                    "chats": batch,
                }, f, indent=2)
            print(f"Batch {i} written to {batch_file}", file=sys.stderr)

    # Emit markdown
    if args.emit_markdown:
        Path(args.emit_markdown).parent.mkdir(parents=True, exist_ok=True)
        with open(args.emit_markdown, "w") as f:
            f.write(f"# Chat Loose Ends Scan\n\n")
            f.write(f"**Window**: {window_start.isoformat()} to {window_end.isoformat()}\n\n")
            f.write(f"**Generated**: {now.isoformat()}\n\n")
            f.write(f"**Total chats in window**: {len(results)}\n\n")
            f.write("---\n\n")
            f.write("## Candidates\n\n")
            for r in results:
                s = r["session"]
                f.write(f"### `{s['id']}` — {s['title']}\n\n")
                f.write(f"- **Directory**: {s['directory']}\n")
                f.write(f"- **Updated**: {datetime.fromtimestamp(s['time_updated']/1000, tz=timezone.utc).isoformat()}\n")
                f.write(f"- **Dead status**: {r['dead_status']} ({r['dead_reason'] or 'N/A'})\n")
                f.write(f"- **Referenced by**: {len(r['referenced_by'])} later chat(s)\n")
                f.write(f"- **Claims**: {len(r['claims'])}\n")
                if r["claims"]:
                    f.write("  - " + "\n  - ".join(r["claims"][:10]) + "\n")
                f.write("\n---\n\n")

        print(f"Markdown written to {args.emit_markdown}", file=sys.stderr)


if __name__ == "__main__":
    main()