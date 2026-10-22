import json
import math
import os
import secrets
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from functools import wraps
from urllib.parse import quote
from urllib import request as urllib_request

from flask import Flask, abort, flash, jsonify, redirect, render_template, request, session, url_for
from werkzeug.security import check_password_hash, generate_password_hash

app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET_KEY") or secrets.token_hex(32)
app.config["ADMIN_DATABASE_PATH"] = os.environ.get(
    "FK_ADMIN_DATABASE_PATH",
    os.path.join(app.instance_path, "admin.sqlite3"),
)
app.config["ADMIN_USERNAME"] = os.environ.get("ADMIN_USERNAME", "admin")
app.config["ADMIN_INITIAL_PASSWORD"] = os.environ.get("ADMIN_PASSWORD", "admin 1")


@contextmanager
def get_admin_db():
    os.makedirs(os.path.dirname(app.config["ADMIN_DATABASE_PATH"]), exist_ok=True)
    connection = sqlite3.connect(app.config["ADMIN_DATABASE_PATH"])
    connection.row_factory = sqlite3.Row
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def init_admin_db():
    with get_admin_db() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS admin_users (
                username TEXT PRIMARY KEY,
                password_hash TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS orders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                customer_name TEXT NOT NULL,
                email TEXT NOT NULL,
                product TEXT NOT NULL,
                quantity REAL NOT NULL,
                status TEXT NOT NULL DEFAULT 'Pending',
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS notifications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                message TEXT NOT NULL,
                created_at TEXT NOT NULL,
                is_read INTEGER NOT NULL DEFAULT 0
            );
            """
        )
        connection.execute(
            """
            INSERT OR IGNORE INTO admin_users (username, password_hash)
            VALUES (?, ?)
            """,
            (
                app.config["ADMIN_USERNAME"],
                generate_password_hash(app.config["ADMIN_INITIAL_PASSWORD"]),
            ),
        )


init_admin_db()


@app.template_filter("format_quantity")
def format_quantity(value):
    quantity = float(value)
    return f"{quantity:g}"


def admin_required(view):
    @wraps(view)
    def wrapped_view(*args, **kwargs):
        if not session.get("admin_username"):
            return redirect(url_for("admin_login"))
        return view(*args, **kwargs)

    return wrapped_view


def valid_csrf_token():
    return secrets.compare_digest(
        session.get("admin_csrf_token", ""),
        request.form.get("csrf_token", ""),
    )


@app.before_request
def prepare_admin_csrf_token():
    if request.path.startswith("/admin/") or request.path == "/admin":
        session.setdefault("admin_csrf_token", secrets.token_urlsafe(32))


@app.context_processor
def expose_admin_template_values():
    unread_notifications = 0
    if session.get("admin_username"):
        with get_admin_db() as connection:
            unread_notifications = connection.execute(
                "SELECT COUNT(*) FROM notifications WHERE is_read = 0"
            ).fetchone()[0]
    return {
        "admin_csrf_token": session.get("admin_csrf_token", ""),
        "admin_username": session.get("admin_username", ""),
        "unread_notifications": unread_notifications,
    }


@app.route("/admin/login", methods=["GET", "POST"])
def admin_login():
    if session.get("admin_username"):
        return redirect(url_for("admin_dashboard"))

    if request.method == "POST":
        if not valid_csrf_token():
            abort(400)

        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        with get_admin_db() as connection:
            user = connection.execute(
                "SELECT username, password_hash FROM admin_users WHERE username = ?",
                (username,),
            ).fetchone()

        if user is None or not check_password_hash(user["password_hash"], password):
            flash("The username or password is incorrect.", "error")
        else:
            session.clear()
            session["admin_username"] = user["username"]
            session["admin_csrf_token"] = secrets.token_urlsafe(32)
            return redirect(url_for("admin_dashboard"))

    return render_template("admin_login.html")


@app.post("/admin/logout")
@admin_required
def admin_logout():
    if not valid_csrf_token():
        abort(400)
    session.clear()
    return redirect(url_for("admin_login"))


@app.route("/admin")
@admin_required
def admin_dashboard():
    with get_admin_db() as connection:
        order_count = connection.execute("SELECT COUNT(*) FROM orders").fetchone()[0]
        pending_count = connection.execute(
            "SELECT COUNT(*) FROM orders WHERE status = 'Pending'"
        ).fetchone()[0]
        unread_count = connection.execute(
            "SELECT COUNT(*) FROM notifications WHERE is_read = 0"
        ).fetchone()[0]
        admin_user = connection.execute(
            "SELECT password_hash FROM admin_users WHERE username = ?",
            (session["admin_username"],),
        ).fetchone()
        recent_orders = connection.execute(
            "SELECT * FROM orders ORDER BY id DESC LIMIT 5"
        ).fetchall()
    return render_template(
        "admin_dashboard.html",
        order_count=order_count,
        pending_count=pending_count,
        unread_count=unread_count,
        using_initial_password=check_password_hash(
            admin_user["password_hash"],
            app.config["ADMIN_INITIAL_PASSWORD"],
        ) if admin_user else False,
        recent_orders=recent_orders,
    )


@app.route("/admin/orders", methods=["GET", "POST"])
@admin_required
def admin_orders():
    if request.method == "POST":
        if not valid_csrf_token():
            abort(400)

        action = request.form.get("action", "create")
        if action == "update_status":
            order_id = request.form.get("order_id", type=int)
            status = request.form.get("status", "")
            if order_id is None or status not in {"Pending", "Processing", "Completed", "Cancelled"}:
                abort(400)
            with get_admin_db() as connection:
                result = connection.execute(
                    "UPDATE orders SET status = ? WHERE id = ?",
                    (status, order_id),
                )
                if result.rowcount != 1:
                    abort(404)
            flash("Order status updated.", "success")
            return redirect(url_for("admin_orders"))

        customer_name = request.form.get("customer_name", "").strip()
        email = request.form.get("email", "").strip()
        product = request.form.get("product", "").strip()
        quantity = request.form.get("quantity", type=float)
        if (
            not customer_name
            or "@" not in email
            or product not in {"Gold bars", "Gold coins", "Silver bars", "Silver coins"}
            or quantity is None
            or quantity <= 0
        ):
            flash("Enter a customer, valid email, product, and quantity greater than zero.", "error")
            return redirect(url_for("admin_orders"))

        created_at = datetime.now(timezone.utc).isoformat(timespec="minutes")
        with get_admin_db() as connection:
            connection.execute(
                """
                INSERT INTO orders (customer_name, email, product, quantity, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (customer_name, email, product, quantity, created_at),
            )
            connection.execute(
                """
                INSERT INTO notifications (title, message, created_at)
                VALUES (?, ?, ?)
                """,
                ("New order created", f"{customer_name} — {product}", created_at),
            )
        flash("Order created and notification added.", "success")
        return redirect(url_for("admin_orders"))

    with get_admin_db() as connection:
        orders = connection.execute("SELECT * FROM orders ORDER BY id DESC").fetchall()
    return render_template("admin_orders.html", orders=orders)


@app.route("/admin/notifications")
@admin_required
def admin_notifications():
    with get_admin_db() as connection:
        notifications = connection.execute(
            "SELECT * FROM notifications ORDER BY id DESC"
        ).fetchall()
        unread_count = connection.execute(
            "SELECT COUNT(*) FROM notifications WHERE is_read = 0"
        ).fetchone()[0]
    return render_template(
        "admin_notifications.html",
        notifications=notifications,
        unread_count=unread_count,
    )


@app.post("/admin/notifications/<int:notification_id>/read")
@admin_required
def mark_notification_read(notification_id):
    if not valid_csrf_token():
        abort(400)
    with get_admin_db() as connection:
        result = connection.execute(
            "UPDATE notifications SET is_read = 1 WHERE id = ?",
            (notification_id,),
        )
        if result.rowcount != 1:
            abort(404)
    flash("Notification marked as read.", "success")
    return redirect(url_for("admin_notifications"))


@app.route("/admin/settings", methods=["GET", "POST"])
@admin_required
def admin_settings():
    if request.method == "POST":
        if not valid_csrf_token():
            abort(400)

        current_password = request.form.get("current_password", "")
        new_password = request.form.get("new_password", "")
        confirmation = request.form.get("confirm_password", "")
        with get_admin_db() as connection:
            user = connection.execute(
                "SELECT password_hash FROM admin_users WHERE username = ?",
                (session["admin_username"],),
            ).fetchone()

            if user is None or not check_password_hash(user["password_hash"], current_password):
                flash("Your current password is incorrect.", "error")
            elif len(new_password) < 8:
                flash("Your new password must be at least 8 characters.", "error")
            elif new_password != confirmation:
                flash("The new password and confirmation do not match.", "error")
            else:
                connection.execute(
                    "UPDATE admin_users SET password_hash = ? WHERE username = ?",
                    (generate_password_hash(new_password), session["admin_username"]),
                )
                flash("Password updated successfully.", "success")
                return redirect(url_for("admin_settings"))

    return render_template("admin_settings.html")


def fetch_live_metal(symbol):
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?range=1d&interval=1m"
    req = urllib_request.Request(url, headers={"User-Agent": "Mozilla/5.0"})

    with urllib_request.urlopen(req, timeout=20) as response:
        payload = json.loads(response.read().decode("utf-8"))

    chart = payload.get("chart", {}).get("result", [{}])[0]
    meta = chart.get("meta", {})
    quote = chart.get("indicators", {}).get("quote", [{}])[0]
    closes = quote.get("close") or []

    price = meta.get("regularMarketPrice")
    if price is None and closes:
        price = closes[-1]

    previous_close = meta.get("chartPreviousClose")
    if previous_close is None and len(closes) > 1:
        previous_close = closes[-2]
    if previous_close in (None, 0):
        previous_close = price

    change_pct = 0.0
    if previous_close not in (None, 0) and price is not None:
        change_pct = ((price - previous_close) / previous_close) * 100

    return {
        "price": round(float(price or 0), 2),
        "change_percent": round(float(change_pct), 2),
        "currency": meta.get("currency", "USD"),
    }


def fetch_historical_metal(symbol, period, interval):
    url = (
        f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
        f"?range={period}&interval={interval}"
    )
    req = urllib_request.Request(url, headers={"User-Agent": "Mozilla/5.0"})

    with urllib_request.urlopen(req, timeout=12) as response:
        payload = json.loads(response.read().decode("utf-8"))

    if not isinstance(payload, dict):
        raise ValueError("Historical price data is malformed.")

    chart = payload.get("chart")
    results = chart.get("result") if isinstance(chart, dict) else None
    if not results or not isinstance(results[0], dict):
        raise ValueError("Historical price data is unavailable.")

    result = results[0]
    indicators = result.get("indicators")
    quotes = indicators.get("quote") if isinstance(indicators, dict) else None
    quote = quotes[0] if quotes and isinstance(quotes[0], dict) else {}
    timestamps = result.get("timestamp") or []
    closes = quote.get("close") or []
    if not isinstance(timestamps, list) or not isinstance(closes, list):
        raise ValueError("Historical price data is malformed.")

    points = []
    for timestamp, close in zip(timestamps, closes):
        if (
            isinstance(timestamp, int)
            and not isinstance(timestamp, bool)
            and isinstance(close, (int, float))
            and math.isfinite(close)
            and close > 0
        ):
            points.append({"timestamp": timestamp, "price": round(close, 4)})

    if len(points) < 2:
        raise ValueError("Historical price data is incomplete.")

    return points


@app.route("/")
def home():
    return render_template("index.html")


@app.route("/api/metals")
def live_metals():
    fallback = {
        "gold": {"price": 0.0, "change_percent": 0.0, "currency": "USD"},
        "silver": {"price": 0.0, "change_percent": 0.0, "currency": "USD"},
    }

    try:
        data = {
            "gold": fetch_live_metal("GC=F"),
            "silver": fetch_live_metal("SI=F"),
        }
    except Exception:
        data = fallback

    data["updated_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return jsonify(data)


@app.route("/api/metals/performance")
def metal_performance():
    ranges = {
        "1m": ("1mo", "1d"),
        "6m": ("6mo", "1d"),
        "1y": ("1y", "1wk"),
        "5y": ("5y", "1wk"),
    }
    range_key = request.args.get("range", "1y")
    if range_key not in ranges:
        return jsonify({"error": "Choose a supported period: 1m, 6m, 1y, or 5y."}), 400

    period, interval = ranges[range_key]
    try:
        data = {
            "range": range_key,
            "gold": fetch_historical_metal("GC=F", period, interval),
            "silver": fetch_historical_metal("SI=F", period, interval),
            "source": "Yahoo Finance futures references (GC=F and SI=F)",
        }
    except (OSError, ValueError) as error:
        app.logger.warning("Historical metal performance unavailable: %s", error)
        return jsonify({
            "error": "Historical market data is temporarily unavailable. Please try again shortly."
        }), 502

    response = jsonify(data)
    response.headers["Cache-Control"] = "public, max-age=900"
    return response


@app.route("/gold-and-silver")
def metals():
    return render_template("metals.html")


@app.route("/services/<service_slug>")
def service_detail(service_slug):
    services = {
        "physical-gold": {
            "title": "Physical Gold",
            "highlight": "direct ownership.",
            "summary": "Purchase physical gold through FK Physical LLC's United States operations with personal guidance and clear transaction terms.",
            "image": "Create_a_refined_editorial-style_vault_background_.png",
            "topic": "gold",
            "paragraphs": [
                "We help qualifying clients access physical gold, including available bars and recognized bullion coins. Product availability, quantities, and pricing are confirmed directly with our team.",
                "Every purchase follows a clear process, from your initial enquiry and client onboarding through payment and completion. Our team will explain the relevant details before you decide how to proceed.",
            ],
            "details": [
                ("Product options", "Ask about current gold bar and bullion coin availability, weights, and specifications."),
                ("Clear pricing", "Transaction pricing and quantities are discussed with you before a purchase is confirmed."),
                ("Supported process", "Our team guides you through onboarding and the steps required to complete a purchase."),
            ],
        },
        "physical-silver": {
            "title": "Physical Silver",
            "highlight": "a clear process.",
            "summary": "Acquire physical silver through a straightforward, professionally supported transaction process.",
            "image": "Create_a_dramatic_secure_bullion_vault_showing_row.png",
            "topic": "silver",
            "paragraphs": [
                "FK Physical LLC provides qualifying clients with access to physical silver through its United States operations. Our team can discuss available products, quantities, and transaction pricing with you.",
                "From your first enquiry through onboarding, payment, and completion, we explain the next steps so you can make informed decisions about your purchase.",
            ],
            "details": [
                ("Product options", "Enquire about current silver bar and recognized bullion coin availability."),
                ("Purchase guidance", "Discuss quantities, specifications, and transaction pricing directly with our team."),
                ("Clear next steps", "Understand the onboarding, payment, and completion process before proceeding."),
            ],
        },
        "secure-storage": {
            "title": "Secure Storage",
            "highlight": "separate from your purchase.",
            "summary": "FK Physical LLC sells physical precious metals and does not operate a storage facility. If needed, we can discuss introductions to a separate provider.",
            "image": "Unlock Strategic Funding & Smart Financing.jfif",
            "topic": "storage",
            "paragraphs": [
                "Your purchase and storage do not have to be provided by the same company. FK Physical LLC does not hold or store client metals, and any storage arrangement is made independently with a separate provider.",
                "For clients interested in secure storage in Panama, our team may be able to introduce you to Fort Kobbe Management Corp., a separate Panama-based company. Ask us about the available introduction process.",
            ],
            "details": [
                ("Separate providers", "Storage is not part of a precious metals sale by FK Physical LLC."),
                ("Optional introduction", "Ask our team whether an introduction to a separate provider may be appropriate."),
                ("Your arrangement", "Any storage terms and decisions are handled directly with the independent provider."),
            ],
        },
        "personal-support": {
            "title": "Personal Support",
            "highlight": "from enquiry to completion.",
            "summary": "Work directly with our team to understand product availability, pricing, onboarding, and the steps involved in a transaction.",
            "image": "Create_a_polished_vault_table_scene_in_front_of_cl.png",
            "topic": "general",
            "paragraphs": [
                "Our team provides one-to-one assistance throughout the acquisition process. We will listen to your requirements and explain relevant product options and transaction details.",
                "Support includes guidance through client onboarding and coordination of the steps required to complete a purchase through FK Physical LLC's United States operations.",
            ],
            "details": [
                ("Understand your needs", "Share the products, quantities, and timing you have in mind."),
                ("Get clear information", "Discuss availability, transaction pricing, and required onboarding."),
                ("Know what comes next", "Our team will explain the next steps as your transaction progresses."),
            ],
        },
        "clear-process": {
            "title": "Clear Process",
            "highlight": "step by step.",
            "summary": "A straightforward process takes you from initial enquiry and onboarding through pricing, payment, and transaction completion.",
            "image": "h77.jfif",
            "topic": "general",
            "paragraphs": [
                "Start by telling us what you are looking to purchase. We will discuss your requirements and current product availability, then explain the onboarding and compliance steps required before any transaction.",
                "Once onboarding is complete, available products, quantities, and pricing are confirmed with you. Payment and completion follow FK Physical LLC's United States operating procedures.",
            ],
            "details": [
                ("01. Enquire", "Tell us about your product and quantity requirements."),
                ("02. Onboard", "Complete the required client onboarding and compliance checks."),
                ("03. Confirm and complete", "Review availability and pricing, then proceed through payment and completion."),
            ],
        },
        "focused-expertise": {
            "title": "Focused Expertise",
            "highlight": "our sole focus.",
            "summary": "FK Physical LLC specializes in the sale of physical gold and silver, not securities, investment management, or paper precious metals products.",
            "image": "WhatsApp Image 2026-06-25 at 5.09.11 PM.jpg",
            "topic": "general",
            "paragraphs": [
                "Our business is focused on physical precious metals. We help qualifying clients purchase physical gold and silver through FK Physical LLC's United States operations.",
                "We do not provide investment management services or sell securities or paper precious metals products. Our team is available to explain the products and transaction process we do offer.",
            ],
            "details": [
                ("Physical products", "Our focus is physical gold and silver purchases."),
                ("Clear scope", "We do not offer investment management or securities products."),
                ("Direct information", "Contact our team to discuss the products and process relevant to your requirements."),
            ],
        },
    }
    service = services.get(service_slug)
    if service is None:
        abort(404)

    return render_template("service_detail.html", service=service)


@app.route("/how-it-works")
def how_it_works():
    return render_template("how_it_works.html")


@app.route("/about")
def about():
    return render_template("about.html")


@app.route("/faqs")
def faqs():
    return render_template("faqs.html")


@app.route("/contact", methods=["GET", "POST"])
def contact():
    topics = {"gold", "silver", "both", "storage", "general"}
    topic_labels = {
        "gold": "Physical Gold Acquisition",
        "silver": "Physical Silver Acquisition",
        "both": "Both Gold & Silver",
        "storage": "Storage Introductions",
        "general": "General Enquiry",
    }

    if request.method == "POST":
        form_values = {
            field: request.form.get(field, "").strip()
            for field in ("first_name", "last_name", "email", "phone", "interest", "message")
        }
        errors = []
        if not form_values["first_name"] or not form_values["last_name"]:
            errors.append("Enter your first and last name.")
        if "@" not in form_values["email"]:
            errors.append("Enter a valid email address.")
        if form_values["interest"] not in topics:
            errors.append("Select an area of interest.")
        if not form_values["message"]:
            errors.append("Enter a message.")

        if errors:
            return render_template(
                "contact.html",
                selected_topic=form_values["interest"] if form_values["interest"] in topics else "",
                initial_message="",
                form_values=form_values,
                form_error=" ".join(errors),
            ), 400

        email_body = "\n".join((
            f"Name: {form_values['first_name']} {form_values['last_name']}",
            f"Email: {form_values['email']}",
            f"Phone: {form_values['phone'] or 'Not provided'}",
            f"Area of interest: {topic_labels[form_values['interest']]}",
            "",
            form_values["message"],
        ))
        email_subject = quote("FK Physical enquiry", safe="")
        encoded_body = quote(email_body, safe="")
        return render_template(
            "contact.html",
            selected_topic=form_values["interest"],
            initial_message="",
            submission_email=f"mailto:info@fkphysical.com?subject={email_subject}&body={encoded_body}",
        )

    topic = request.args.get("topic", "")
    selected_topic = topic if topic in topics else ""
    product_names = {"bars": "gold bars", "coins": "gold coins"}
    product = request.args.get("product", "")
    product_name = product_names.get(product) if selected_topic == "gold" else None

    return render_template(
        "contact.html",
        selected_topic=selected_topic,
        initial_message=f"I'm interested in {product_name}." if product_name else "",
        form_values={},
    )


if __name__ == "__main__":
    app.run(debug=True)
