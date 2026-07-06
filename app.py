import os
import threading
import urllib.request
from flask import Flask, render_template, request, redirect, url_for, flash, jsonify, session, make_response
from flask_login import LoginManager, UserMixin, login_user, logout_user, login_required, current_user
from werkzeug.security import generate_password_hash, check_password_hash

import database as db

try:
    import docker_manager
    DOCKER_AVAILABLE = True
except Exception:
    DOCKER_AVAILABLE = False

app = Flask(__name__)
app.secret_key = os.environ.get("LVM_SECRET_KEY", "change-this-secret-key")

login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = "login"

OS_IMAGES = ["ubuntu:22.04", "ubuntu:20.04", "debian:12", "debian:11", "alpine:3.19"]
THEMES = ["pro-dark", "midnight-purple", "ocean-blue", "light"]


class User(UserMixin):
    def __init__(self, row):
        self.id = row["id"]
        self.username = row["username"]
        self.is_admin = bool(row["is_admin"])
        self.theme = row["theme"] or "pro-dark"


@login_manager.user_loader
def load_user(user_id):
    row = db.get_user_by_id(user_id)
    return User(row) if row else None


def admin_required(f):
    from functools import wraps

    @wraps(f)
    def wrapper(*args, **kwargs):
        if not current_user.is_authenticated or not current_user.is_admin:
            flash("Admin access required.", "error")
            return redirect(url_for("dashboard"))
        return f(*args, **kwargs)
    return wrapper


@app.context_processor
def inject_theme():
    theme = "pro-dark"
    if current_user.is_authenticated:
        theme = current_user.theme
    panel_name = db.get_setting("panel_name", "LVM Panel")
    return {"active_theme": theme, "themes": THEMES, "panel_name": panel_name}


def get_public_ip():
    """Returns the host's public IPv4 (used so members know what to put in Termius)."""
    saved = db.get_setting("public_ip")
    if saved:
        return saved
    try:
        with urllib.request.urlopen("https://api.ipify.org", timeout=3) as resp:
            ip = resp.read().decode().strip()
            if ip:
                db.set_setting("public_ip", ip)
                return ip
    except Exception:
        pass
    return "YOUR-SERVER-IP"


# ---------------- Auth ----------------

@app.route("/register", methods=["GET", "POST"])
def register():
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        confirm = request.form.get("confirm", "")

        if not username or not password:
            flash("Username and password are required.", "error")
            return redirect(url_for("register"))
        if password != confirm:
            flash("Passwords do not match.", "error")
            return redirect(url_for("register"))

        is_first_user = len(db.get_all_users()) == 0
        ok = db.create_user(username, generate_password_hash(password), is_admin=1 if is_first_user else 0)
        if not ok:
            flash("Username already taken.", "error")
            return redirect(url_for("register"))

        flash("Account created! You can now log in.", "success")
        return redirect(url_for("login"))

    return render_template("register.html")


@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        row = db.get_user_by_username(username)
        if row and check_password_hash(row["password_hash"], password):
            login_user(User(row))
            return redirect(url_for("admin_dashboard") if row["is_admin"] else url_for("dashboard"))
        flash("Invalid username or password.", "error")
        return redirect(url_for("login"))

    return render_template("login.html")


@app.route("/logout")
@login_required
def logout():
    logout_user()
    return redirect(url_for("login"))


# ---------------- Theme ----------------

@app.route("/settings/theme", methods=["POST"])
@login_required
def set_theme():
    theme = request.form.get("theme", "pro-dark")
    if theme not in THEMES:
        theme = "pro-dark"
    db.set_user_theme(current_user.id, theme)
    return redirect(request.referrer or url_for("dashboard"))


# ---------------- User dashboard ----------------

@app.route("/")
@login_required
def dashboard():
    vps_list = db.get_user_vps(current_user.id)
    return render_template("dashboard.html", vps_list=vps_list)


@app.route("/vps/<vps_id>")
@login_required
def manage_vps(vps_id):
    vps = db.get_vps(vps_id)
    if not vps or (vps["owner_id"] != current_user.id and not current_user.is_admin):
        flash("VPS not found or access denied.", "error")
        return redirect(url_for("dashboard"))
    live_status = vps["status"]
    if DOCKER_AVAILABLE and vps["container_id"]:
        try:
            live_status = docker_manager.get_status(vps["container_id"])
        except Exception:
            pass
    host_ip = get_public_ip()
    has_public_ip = db.get_setting("has_public_ip", "yes") == "yes"
    return render_template("vps_manage.html", vps=vps, live_status=live_status, host_ip=host_ip,
                            has_public_ip=has_public_ip)


@app.route("/vps/<vps_id>/action/<action>", methods=["POST"])
@login_required
def vps_action(vps_id, action):
    vps = db.get_vps(vps_id)
    if not vps or (vps["owner_id"] != current_user.id and not current_user.is_admin):
        return jsonify({"ok": False, "error": "Access denied"}), 403

    if not DOCKER_AVAILABLE:
        return jsonify({"ok": False, "error": "Docker engine not available on this host."}), 500

    try:
        if action == "start":
            docker_manager.start_vps(vps["container_id"])
            db.update_vps(vps_id, status="running")
        elif action == "stop":
            docker_manager.stop_vps(vps["container_id"])
            db.update_vps(vps_id, status="stopped")
        elif action == "restart":
            docker_manager.restart_vps(vps["container_id"])
            db.update_vps(vps_id, status="running")
        elif action == "reinstall":
            result = docker_manager.reinstall_vps(
                vps["vps_id"], vps["container_id"], vps["ram"], vps["cpu"], vps["disk"], vps["os_image"]
            )
            db.update_vps(vps_id, container_id=result["container_id"], container_name=result["container_name"],
                           private_ip=result["private_ip"], ssh_port=result["ssh_port"],
                           root_password=result["root_password"],
                           status="running", tmate_session=None, error_message=None)
        elif action == "tmate":
            session_str = docker_manager.generate_tmate_session(vps["container_id"])
            db.update_vps(vps_id, tmate_session=session_str)
        else:
            return jsonify({"ok": False, "error": "Unknown action"}), 400
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

    updated = db.get_vps(vps_id)
    return jsonify({"ok": True, "vps": dict(updated)})


# ---------------- Redeem ----------------

@app.route("/redeem", methods=["GET", "POST"])
@login_required
def redeem():
    if request.method == "POST":
        code = request.form.get("code", "").strip().upper()
        row = db.get_redeem_code(code)
        if not row:
            flash("Invalid redeem code.", "error")
        elif row["used"]:
            flash("This code has already been used.", "error")
        else:
            db.mark_code_used(code, current_user.id)
            new_vps_id = db.create_vps(
                name=f"Redeemed VPS", owner_id=current_user.id, ram=row["ram"], cpu=row["cpu"],
                disk=row["disk"], os_image=row["os_image"], days=row["days"]
            )
            _provision_vps_async(new_vps_id, row["ram"], row["cpu"], row["disk"], row["os_image"])
            flash("Code redeemed! Your VPS is being created.", "success")
            return redirect(url_for("dashboard"))
        return redirect(url_for("redeem"))

    return render_template("redeem.html")


# ---------------- Admin ----------------

@app.route("/admin")
@admin_required
def admin_dashboard():
    users = db.get_all_users()
    vps_list = db.get_all_vps()
    stats = {
        "total_users": len(users),
        "total_vps": len(vps_list),
        "running_vps": len([v for v in vps_list if v["status"] == "running"]),
    }
    return render_template("admin/dashboard.html", stats=stats, vps_list=vps_list)


@app.route("/admin/users")
@admin_required
def admin_users():
    users = db.get_all_users()
    return render_template("admin/users.html", users=users)


@app.route("/admin/users/create", methods=["POST"])
@admin_required
def admin_create_user():
    username = request.form.get("username", "").strip()
    password = request.form.get("password", "")
    make_admin = 1 if request.form.get("is_admin") == "on" else 0
    if not username or not password:
        flash("Username and password required.", "error")
    elif not db.create_user(username, generate_password_hash(password), is_admin=make_admin):
        flash("Username already exists.", "error")
    else:
        flash(f"User '{username}' created.", "success")
    return redirect(url_for("admin_users"))


@app.route("/admin/users/<int:user_id>/delete", methods=["POST"])
@admin_required
def admin_delete_user(user_id):
    if user_id == current_user.id:
        flash("You cannot delete your own account.", "error")
        return redirect(url_for("admin_users"))
    db.delete_user(user_id)
    flash("User deleted.", "success")
    return redirect(url_for("admin_users"))


@app.route("/admin/users/<int:user_id>/toggle-admin", methods=["POST"])
@admin_required
def admin_toggle_admin(user_id):
    row = db.get_user_by_id(user_id)
    if row:
        db.set_user_admin(user_id, 0 if row["is_admin"] else 1)
    return redirect(url_for("admin_users"))


@app.route("/admin/vps/create", methods=["GET", "POST"])
@admin_required
def admin_create_vps():
    users = db.get_all_users()
    if request.method == "POST":
        owner_id = int(request.form.get("owner_id"))
        name = request.form.get("name", "My VPS").strip()
        ram = int(request.form.get("ram"))
        cpu = int(request.form.get("cpu"))
        disk = int(request.form.get("disk"))
        days = int(request.form.get("days", 30))
        os_image = request.form.get("os_image", OS_IMAGES[0])

        vps_id = db.create_vps(name, owner_id, ram, cpu, disk, os_image, days)
        _provision_vps_async(vps_id, ram, cpu, disk, os_image)

        flash(f"VPS '{vps_id}' is being created.", "success")
        return redirect(url_for("admin_dashboard"))

    return render_template("admin/create_vps.html", users=users, os_images=OS_IMAGES)


@app.route("/admin/vps/<vps_id>/delete", methods=["POST"])
@admin_required
def admin_delete_vps(vps_id):
    vps = db.get_vps(vps_id)
    if vps and DOCKER_AVAILABLE and vps["container_id"]:
        try:
            docker_manager.remove_vps(vps["container_id"])
        except Exception:
            pass
    db.delete_vps(vps_id)
    flash("VPS removed.", "success")
    return redirect(url_for("admin_dashboard"))


@app.route("/admin/settings", methods=["GET", "POST"])
@admin_required
def admin_settings():
    if request.method == "POST":
        panel_name = request.form.get("panel_name", "").strip() or "LVM Panel"
        public_ip = request.form.get("public_ip", "").strip()
        has_public_ip = "yes" if request.form.get("has_public_ip") == "on" else "no"
        db.set_setting("panel_name", panel_name)
        db.set_setting("has_public_ip", has_public_ip)
        if public_ip:
            db.set_setting("public_ip", public_ip)
        flash("Settings saved.", "success")
        return redirect(url_for("admin_settings"))

    current_name = db.get_setting("panel_name", "LVM Panel")
    current_ip = db.get_setting("public_ip", "") or get_public_ip()
    current_has_ip = db.get_setting("has_public_ip", "yes")
    return render_template("admin/settings.html", current_name=current_name, current_ip=current_ip,
                            current_has_ip=current_has_ip)


@app.route("/admin/redeem")
@admin_required
def admin_redeem():
    codes = db.get_all_redeem_codes()
    return render_template("admin/redeem.html", codes=codes, os_images=OS_IMAGES)


@app.route("/admin/redeem/create", methods=["POST"])
@admin_required
def admin_create_redeem():
    ram = int(request.form.get("ram"))
    cpu = int(request.form.get("cpu"))
    disk = int(request.form.get("disk"))
    days = int(request.form.get("days"))
    os_image = request.form.get("os_image", OS_IMAGES[0])
    code = db.create_redeem_code(ram, cpu, disk, days, os_image)
    flash(f"Redeem code created: {code}", "success")
    return redirect(url_for("admin_redeem"))


@app.route("/admin/redeem/<code>/delete", methods=["POST"])
@admin_required
def admin_delete_redeem(code):
    db.delete_redeem_code(code)
    return redirect(url_for("admin_redeem"))


# ---------------- Helpers ----------------

def _provision_vps_async(vps_id, ram, cpu, disk, os_image):
    def _run():
        if not DOCKER_AVAILABLE:
            db.update_vps(vps_id, status="error",
                           error_message="Docker engine/SDK not available on this host. "
                                         "Make sure Docker is installed and the 'docker' Python package is in the panel's venv.")
            return
        try:
            result = docker_manager.create_container(vps_id, ram, cpu, disk, os_image)
            db.update_vps(
                vps_id,
                container_id=result["container_id"],
                container_name=result["container_name"],
                private_ip=result["private_ip"],
                ssh_port=result["ssh_port"],
                root_password=result["root_password"],
                status="running",
                error_message=None,
            )
        except Exception as e:
            db.update_vps(vps_id, status="error", error_message=str(e)[:500])
            print(f"[LVM Panel] Failed to provision {vps_id}: {e}")

    threading.Thread(target=_run, daemon=True).start()


if __name__ == "__main__":
    db.init_db()
    port = int(os.environ.get("LVM_PORT", 5000))
    app.run(host="0.0.0.0", port=port)
