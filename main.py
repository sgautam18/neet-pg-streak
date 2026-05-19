#!/usr/bin/env python3
import json
import mimetypes
import os
import secrets
import sqlite3
import time
import urllib.parse
from http import HTTPStatus
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path


ROOT = Path(__file__).resolve().parent
FRONTEND = ROOT / "neet-pg-streak"
PUBLIC = FRONTEND / "public"
DIST = FRONTEND / "dist"
DATA_DIR = ROOT / "data"
DB_PATH = DATA_DIR / "practice.sqlite3"
PORT = int(os.environ.get("PORT", "8787"))

EXAMS = {
    "neet-pg": {"id": "neet-pg", "label": "NEET PG", "file": "questions.json"},
    "inicet": {"id": "inicet", "label": "INI-CET", "file": "inicet_questions.json"},
}

ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN") or secrets.token_urlsafe(16)
QUESTION_CACHE = {}


def now():
    return int(time.time())


def connect():
    DATA_DIR.mkdir(exist_ok=True)
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def init_db():
    with connect() as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
              device_id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              created_at INTEGER NOT NULL,
              last_seen INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS stats (
              device_id TEXT NOT NULL,
              exam TEXT NOT NULL,
              total_solved INTEGER NOT NULL DEFAULT 0,
              correct_solved INTEGER NOT NULL DEFAULT 0,
              current_streak INTEGER NOT NULL DEFAULT 0,
              best_score INTEGER NOT NULL DEFAULT 0,
              updated_at INTEGER NOT NULL,
              PRIMARY KEY (device_id, exam)
            );

            CREATE TABLE IF NOT EXISTS wrong_questions (
              device_id TEXT NOT NULL,
              exam TEXT NOT NULL,
              question_id TEXT NOT NULL,
              question_json TEXT NOT NULL,
              selected_option TEXT,
              misses INTEGER NOT NULL DEFAULT 1,
              last_wrong_at INTEGER NOT NULL,
              PRIMARY KEY (device_id, exam, question_id)
            );

            CREATE TABLE IF NOT EXISTS events (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              device_id TEXT,
              exam TEXT,
              event TEXT NOT NULL,
              payload TEXT,
              created_at INTEGER NOT NULL
            );
            """
        )


def load_questions(exam):
    if exam["id"] in QUESTION_CACHE:
        return QUESTION_CACHE[exam["id"]]

    path = PUBLIC / exam["file"]
    if not path.exists():
        QUESTION_CACHE[exam["id"]] = []
        return []

    questions = json.loads(path.read_text(encoding="utf-8"))
    for index, question in enumerate(questions):
        question.setdefault("exam", exam["id"])
        question.setdefault("id", make_question_id(exam["id"], question, index))

    QUESTION_CACHE[exam["id"]] = questions
    return questions


def make_question_id(exam_id, question, index):
    source = question.get("source_pdf", "source")
    number = question.get("question_no", index + 1)
    page = question.get("page_number", "")
    return f"{exam_id}:{source}:{number}:{page}"


def ensure_stats(db, device_id, exam_id):
    db.execute(
        """
        INSERT OR IGNORE INTO stats
          (device_id, exam, total_solved, correct_solved, current_streak, best_score, updated_at)
        VALUES (?, ?, 0, 0, 0, 0, ?)
        """,
        (device_id, exam_id, now()),
    )


def stats_for(db, device_id, exam_id):
    ensure_stats(db, device_id, exam_id)
    row = db.execute(
        "SELECT * FROM stats WHERE device_id = ? AND exam = ?",
        (device_id, exam_id),
    ).fetchone()
    return {
        "totalSolved": row["total_solved"],
        "correctSolved": row["correct_solved"],
        "streak": row["current_streak"],
        "bestScore": row["best_score"],
        "maxStreak": row["best_score"],
    }


def user_profile(db, device_id, exam_id):
    user = db.execute("SELECT * FROM users WHERE device_id = ?", (device_id,)).fetchone()
    if not user:
        return None

    db.execute("UPDATE users SET last_seen = ? WHERE device_id = ?", (now(), device_id))
    return {
        "deviceId": user["device_id"],
        "name": user["name"],
        "stats": stats_for(db, device_id, exam_id),
    }


def log_event(db, device_id, event, payload=None, exam_id=None):
    db.execute(
        "INSERT INTO events (device_id, exam, event, payload, created_at) VALUES (?, ?, ?, ?, ?)",
        (
            device_id,
            exam_id or "neet-pg",
            event,
            json.dumps(payload or {}, ensure_ascii=False),
            now(),
        ),
    )


def exam_from_query(query):
    exam_id = query.get("exam", ["neet-pg"])[0]
    return EXAMS.get(exam_id, EXAMS["neet-pg"])


def exam_from_payload(data):
    exam_id = data.get("exam", "neet-pg")
    return EXAMS.get(exam_id, EXAMS["neet-pg"])


class Handler(BaseHTTPRequestHandler):
    server_version = "NEETPGStreak/1.0"

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(HTTPStatus.NO_CONTENT)
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self.handle_api_get(parsed)
            return
        self.serve_static(parsed.path)

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if not parsed.path.startswith("/api/"):
            self.send_json({"error": "Not found"}, HTTPStatus.NOT_FOUND)
            return
        self.handle_api_post(parsed)

    def read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        if not length:
            return {}
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def send_json(self, payload, status=HTTPStatus.OK):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def handle_api_get(self, parsed):
        query = urllib.parse.parse_qs(parsed.query)
        device_id = query.get("deviceId", [""])[0]
        exam = exam_from_query(query)
        exam_id = exam["id"]

        if parsed.path == "/api/config":
            self.send_json(
                {
                    "exam": exam_id,
                    "label": exam["label"],
                    "exams": [
                        {"id": item["id"], "label": item["label"]}
                        for item in EXAMS.values()
                    ],
                }
            )
            return

        if parsed.path == "/api/questions":
            self.send_json({"questions": load_questions(exam)})
            return

        if parsed.path == "/api/profile":
            if not device_id:
                self.send_json({"error": "deviceId is required"}, HTTPStatus.BAD_REQUEST)
                return
            with connect() as db:
                profile = user_profile(db, device_id, exam_id)
                if not profile:
                    self.send_json({"registered": False}, HTTPStatus.NOT_FOUND)
                    return
                self.send_json({"registered": True, "profile": profile})
            return

        if parsed.path == "/api/leaderboard":
            self.send_json({"leaderboard": self.leaderboard(exam_id)})
            return

        if parsed.path == "/api/wrong":
            if not device_id:
                self.send_json({"error": "deviceId is required"}, HTTPStatus.BAD_REQUEST)
                return
            with connect() as db:
                rows = db.execute(
                    """
                    SELECT question_id, question_json, selected_option, misses, last_wrong_at
                    FROM wrong_questions
                    WHERE device_id = ? AND exam = ?
                    ORDER BY last_wrong_at DESC
                    """,
                    (device_id, exam_id),
                ).fetchall()
                wrong = [
                    {
                        "questionId": row["question_id"],
                        "question": json.loads(row["question_json"]),
                        "selectedOption": row["selected_option"],
                        "misses": row["misses"],
                        "lastWrongAt": row["last_wrong_at"],
                    }
                    for row in rows
                ]
                self.send_json({"wrongQuestions": wrong})
            return

        if parsed.path == "/api/admin/engagement":
            token = query.get("token", [""])[0]
            if token != ADMIN_TOKEN:
                self.send_json({"error": "Unauthorized"}, HTTPStatus.UNAUTHORIZED)
                return
            self.send_json(self.engagement())
            return

        self.send_json({"error": "Not found"}, HTTPStatus.NOT_FOUND)

    def handle_api_post(self, parsed):
        data = self.read_json()
        device_id = data.get("deviceId", "").strip()
        exam = exam_from_payload(data)
        exam_id = exam["id"]

        if parsed.path == "/api/device/register":
            name = data.get("name", "").strip()
            if not device_id or not name:
                self.send_json({"error": "deviceId and name are required"}, HTTPStatus.BAD_REQUEST)
                return
            with connect() as db:
                timestamp = now()
                db.execute(
                    """
                    INSERT INTO users (device_id, name, created_at, last_seen)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(device_id) DO UPDATE SET
                      name = excluded.name,
                      last_seen = excluded.last_seen
                    """,
                    (device_id, name, timestamp, timestamp),
                )
                ensure_stats(db, device_id, exam_id)
                log_event(db, device_id, "registered", {"name": name}, exam_id)
                profile = user_profile(db, device_id, exam_id)
                self.send_json({"profile": profile})
            return

        if parsed.path == "/api/attempt":
            question = data.get("question") or {}
            question_id = data.get("questionId") or question.get("id")
            selected_option = data.get("selectedOption", "")
            correct = bool(data.get("correct"))
            if not device_id or not question_id:
                self.send_json({"error": "deviceId and questionId are required"}, HTTPStatus.BAD_REQUEST)
                return

            with connect() as db:
                ensure_stats(db, device_id, exam_id)
                row = db.execute(
                    "SELECT * FROM stats WHERE device_id = ? AND exam = ?",
                    (device_id, exam_id),
                ).fetchone()
                next_streak = row["current_streak"] + 1 if correct else 0
                best_score = max(row["best_score"], next_streak)
                db.execute(
                    """
                    UPDATE stats
                    SET total_solved = total_solved + 1,
                        correct_solved = correct_solved + ?,
                        current_streak = ?,
                        best_score = ?,
                        updated_at = ?
                    WHERE device_id = ? AND exam = ?
                    """,
                    (1 if correct else 0, next_streak, best_score, now(), device_id, exam_id),
                )
                if not correct:
                    db.execute(
                        """
                        INSERT INTO wrong_questions
                          (device_id, exam, question_id, question_json, selected_option, misses, last_wrong_at)
                        VALUES (?, ?, ?, ?, ?, 1, ?)
                        ON CONFLICT(device_id, exam, question_id) DO UPDATE SET
                          question_json = excluded.question_json,
                          selected_option = excluded.selected_option,
                          misses = misses + 1,
                          last_wrong_at = excluded.last_wrong_at
                        """,
                        (
                            device_id,
                            exam_id,
                            question_id,
                            json.dumps(question, ensure_ascii=False),
                            selected_option,
                            now(),
                        ),
                    )
                log_event(
                    db,
                    device_id,
                    "attempt",
                    {"questionId": question_id, "correct": correct, "selectedOption": selected_option},
                    exam_id,
                )
                self.send_json(
                    {
                        "profile": user_profile(db, device_id, exam_id),
                        "leaderboard": self.leaderboard(exam_id, db),
                    }
                )
            return

        if parsed.path == "/api/wrong/remove":
            question_id = data.get("questionId", "")
            if not device_id or not question_id:
                self.send_json({"error": "deviceId and questionId are required"}, HTTPStatus.BAD_REQUEST)
                return
            with connect() as db:
                db.execute(
                    "DELETE FROM wrong_questions WHERE device_id = ? AND exam = ? AND question_id = ?",
                    (device_id, exam_id, question_id),
                )
                log_event(db, device_id, "wrong_question_removed", {"questionId": question_id}, exam_id)
                self.send_json({"ok": True})
            return

        if parsed.path == "/api/event":
            event = data.get("event", "event")
            with connect() as db:
                log_event(db, device_id, event, data.get("payload") or {}, exam_id)
                self.send_json({"ok": True})
            return

        self.send_json({"error": "Not found"}, HTTPStatus.NOT_FOUND)

    def leaderboard(self, exam_id, db=None):
        close_db = False
        if db is None:
            db = connect()
            close_db = True
        try:
            rows = db.execute(
                """
                SELECT users.name, stats.best_score, stats.correct_solved, stats.total_solved, stats.updated_at
                FROM stats
                JOIN users ON users.device_id = stats.device_id
                WHERE stats.exam = ?
                ORDER BY stats.best_score DESC, stats.correct_solved DESC, stats.updated_at ASC
                LIMIT 10
                """,
                (exam_id,),
            ).fetchall()
            return [
                {
                    "name": row["name"],
                    "bestScore": row["best_score"],
                    "correctSolved": row["correct_solved"],
                    "totalSolved": row["total_solved"],
                    "updatedAt": row["updated_at"],
                }
                for row in rows
            ]
        finally:
            if close_db:
                db.close()

    def engagement(self):
        with connect() as db:
            users = db.execute(
                """
                SELECT users.device_id, users.name, users.created_at, users.last_seen,
                       stats.exam, stats.total_solved, stats.correct_solved, stats.best_score
                FROM users
                LEFT JOIN stats ON stats.device_id = users.device_id
                ORDER BY users.last_seen DESC
                """
            ).fetchall()
            events = db.execute(
                """
                SELECT event, exam, COUNT(*) AS count, MAX(created_at) AS last_seen
                FROM events
                GROUP BY event, exam
                ORDER BY last_seen DESC
                """
            ).fetchall()
            wrong = db.execute(
                """
                SELECT exam, COUNT(*) AS count
                FROM wrong_questions
                GROUP BY exam
                """
            ).fetchall()
            return {
                "exams": [
                    {**item, "questions": len(load_questions(item))}
                    for item in EXAMS.values()
                ],
                "users": [dict(row) for row in users],
                "events": [dict(row) for row in events],
                "wrongQuestionCounts": [dict(row) for row in wrong],
            }

    def serve_static(self, request_path):
        if not DIST.exists():
            body = (
                "Frontend build not found. Run:\n"
                "  cd neet-pg-streak && npm install && npm run build\n"
            ).encode("utf-8")
            self.send_response(HTTPStatus.SERVICE_UNAVAILABLE)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        clean_path = urllib.parse.unquote(request_path).lstrip("/")
        target = DIST / clean_path if clean_path else DIST / "index.html"
        if not target.exists() or target.is_dir():
            target = DIST / "index.html"

        try:
            body = target.read_bytes()
        except OSError:
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", mimetypes.guess_type(target.name)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        print(f"{self.address_string()} - {fmt % args}")


def main():
    init_db()
    question_counts = {
        exam["label"]: len(load_questions(exam))
        for exam in EXAMS.values()
    }

    print("\nLoaded question banks:")
    for label, count in question_counts.items():
        print(f"  {label}: {count} questions")
    print(f"App URL: http://localhost:{PORT}")
    print(f"Admin engagement URL: http://localhost:{PORT}/api/admin/engagement?token={ADMIN_TOKEN}")
    print("Keep this terminal open while users practice.\n")

    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
