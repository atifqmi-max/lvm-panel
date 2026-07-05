import sqlite3
import os
import datetime
import secrets
import string

DB_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "lvm_panel.db")


def get_conn():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    conn = get_conn()
    c = conn.cursor()

    c.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            is_admin INTEGER DEFAULT 0,
            theme TEXT DEFAULT 'pro-dark',
            created_at TEXT NOT NULL
        )
    """)

    c.execute("""
        CREATE TABLE IF NOT EXISTS vps (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            vps_id TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            owner_id INTEGER NOT NULL,
            container_id TEXT,
            container_name TEXT,
            ram INTEGER NOT NULL,
            cpu INTEGER NOT NULL,
            disk INTEGER NOT NULL,
            os_image TEXT NOT NULL,
            root_password TEXT,
            private_ip TEXT,
            tmate_session TEXT,
            status TEXT DEFAULT 'creating',
            created_at TEXT NOT NULL,
            expires_at TEXT,
            FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE CASCADE
        )
    """)

    c.execute("""
        CREATE TABLE IF NOT EXISTS redeem_codes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT UNIQUE NOT NULL,
            ram INTEGER NOT NULL,
            cpu INTEGER NOT NULL,
            disk INTEGER NOT NULL,
            days INTEGER NOT NULL,
            os_image TEXT DEFAULT 'ubuntu:22.04',
            used INTEGER DEFAULT 0,
            used_by INTEGER,
            created_at TEXT NOT NULL,
            used_at TEXT
        )
    """)

    c.execute("""
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )
    """)

    conn.commit()
    conn.close()


# ---------------- Settings ----------------

def get_setting(key, default=None):
    conn = get_conn()
    row = conn.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    conn.close()
    return row["value"] if row else default


def set_setting(key, value):
    conn = get_conn()
    conn.execute("INSERT INTO settings (key, value) VALUES (?, ?) "
                 "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, value))
    conn.commit()
    conn.close()


# ---------------- Users ----------------

def create_user(username, password_hash, is_admin=0):
    conn = get_conn()
    try:
        conn.execute(
            "INSERT INTO users (username, password_hash, is_admin, created_at) VALUES (?, ?, ?, ?)",
            (username, password_hash, is_admin, datetime.datetime.utcnow().isoformat())
        )
        conn.commit()
        return True
    except sqlite3.IntegrityError:
        return False
    finally:
        conn.close()


def get_user_by_username(username):
    conn = get_conn()
    row = conn.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
    conn.close()
    return row


def get_user_by_id(user_id):
    conn = get_conn()
    row = conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
    conn.close()
    return row


def get_all_users():
    conn = get_conn()
    rows = conn.execute("SELECT * FROM users ORDER BY id DESC").fetchall()
    conn.close()
    return rows


def delete_user(user_id):
    conn = get_conn()
    conn.execute("DELETE FROM users WHERE id=?", (user_id,))
    conn.commit()
    conn.close()


def set_user_admin(user_id, is_admin):
    conn = get_conn()
    conn.execute("UPDATE users SET is_admin=? WHERE id=?", (is_admin, user_id))
    conn.commit()
    conn.close()


def set_user_theme(user_id, theme):
    conn = get_conn()
    conn.execute("UPDATE users SET theme=? WHERE id=?", (theme, user_id))
    conn.commit()
    conn.close()


# ---------------- VPS ----------------

def generate_vps_id():
    return "vps-" + "".join(secrets.choice(string.ascii_lowercase + string.digits) for _ in range(8))


def create_vps(name, owner_id, ram, cpu, disk, os_image, days):
    vps_id = generate_vps_id()
    expires_at = None
    if days and int(days) > 0:
        expires_at = (datetime.datetime.utcnow() + datetime.timedelta(days=int(days))).isoformat()
    conn = get_conn()
    conn.execute("""
        INSERT INTO vps (vps_id, name, owner_id, ram, cpu, disk, os_image, status, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'creating', ?, ?)
    """, (vps_id, name, owner_id, ram, cpu, disk, os_image,
          datetime.datetime.utcnow().isoformat(), expires_at))
    conn.commit()
    conn.close()
    return vps_id


def update_vps(vps_id, **fields):
    if not fields:
        return
    conn = get_conn()
    cols = ", ".join(f"{k}=?" for k in fields)
    values = list(fields.values()) + [vps_id]
    conn.execute(f"UPDATE vps SET {cols} WHERE vps_id=?", values)
    conn.commit()
    conn.close()


def get_vps(vps_id):
    conn = get_conn()
    row = conn.execute("SELECT * FROM vps WHERE vps_id=?", (vps_id,)).fetchone()
    conn.close()
    return row


def get_all_vps():
    conn = get_conn()
    rows = conn.execute("SELECT * FROM vps ORDER BY id DESC").fetchall()
    conn.close()
    return rows


def get_user_vps(owner_id):
    conn = get_conn()
    rows = conn.execute("SELECT * FROM vps WHERE owner_id=? ORDER BY id DESC", (owner_id,)).fetchall()
    conn.close()
    return rows


def delete_vps(vps_id):
    conn = get_conn()
    conn.execute("DELETE FROM vps WHERE vps_id=?", (vps_id,))
    conn.commit()
    conn.close()


def count_all_vps():
    conn = get_conn()
    n = conn.execute("SELECT COUNT(*) c FROM vps").fetchone()["c"]
    conn.close()
    return n


# ---------------- Redeem Codes ----------------

def generate_code():
    return "-".join("".join(secrets.choice(string.ascii_uppercase + string.digits) for _ in range(4)) for _ in range(3))


def create_redeem_code(ram, cpu, disk, days, os_image="ubuntu:22.04"):
    code = generate_code()
    conn = get_conn()
    conn.execute("""
        INSERT INTO redeem_codes (code, ram, cpu, disk, days, os_image, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (code, ram, cpu, disk, days, os_image, datetime.datetime.utcnow().isoformat()))
    conn.commit()
    conn.close()
    return code


def get_redeem_code(code):
    conn = get_conn()
    row = conn.execute("SELECT * FROM redeem_codes WHERE code=?", (code,)).fetchone()
    conn.close()
    return row


def mark_code_used(code, used_by):
    conn = get_conn()
    conn.execute("UPDATE redeem_codes SET used=1, used_by=?, used_at=? WHERE code=?",
                 (used_by, datetime.datetime.utcnow().isoformat(), code))
    conn.commit()
    conn.close()


def get_all_redeem_codes():
    conn = get_conn()
    rows = conn.execute("SELECT * FROM redeem_codes ORDER BY id DESC").fetchall()
    conn.close()
    return rows


def delete_redeem_code(code):
    conn = get_conn()
    conn.execute("DELETE FROM redeem_codes WHERE code=?", (code,))
    conn.commit()
    conn.close()
