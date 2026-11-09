import json
import sqlite3
import unittest

from scan import dead_signals, parts_for


class PartsForTests(unittest.TestCase):
    def test_includes_unfinished_step_start_parts(self):
        con = sqlite3.connect(":memory:")
        con.row_factory = sqlite3.Row
        con.executescript(
            """
            CREATE TABLE message (id TEXT PRIMARY KEY, data TEXT NOT NULL);
            CREATE TABLE part (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                message_id TEXT NOT NULL,
                time_created INTEGER NOT NULL,
                data TEXT NOT NULL
            );
            """
        )
        con.execute("INSERT INTO message VALUES (?, ?)", ("m1", json.dumps({"role": "assistant"})))
        con.execute(
            "INSERT INTO part VALUES (?, ?, ?, ?, ?)",
            ("p1", "s1", "m1", 10, json.dumps({"type": "step-start"})),
        )

        parts = parts_for(con, ["s1"])
        strong, _weak, _facts = dead_signals(parts, False, 0, 1000, 100)

        self.assertEqual([part["ptype"] for part in parts], ["step-start"])
        self.assertIn("last-part-step-start-never-finished", strong)


if __name__ == "__main__":
    unittest.main()
