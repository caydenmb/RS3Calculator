# app.py
#!/usr/bin/env python3

import os
import io
import time
import json
import threading
import traceback
from flask import Flask, jsonify, request, render_template, send_file, abort
from jinja2 import TemplateNotFound
import requests

app = Flask(__name__, template_folder="templates", static_folder="static")

# -------------------------------------
# Global state for GE preload + logs
# -------------------------------------
ge_all_items = {}
ge_loaded = False
logs = []

def log(msg: str):
    """Append a timestamped message to the in-memory log."""
    ts = time.strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line)
    logs.append(line)

# -------------------------------------
# Preload GE catalogue in background
# -------------------------------------
def ge_preload():
    """Fetch the entire GE catalogue, skipping invalid buckets, logging every failure."""
    global ge_all_items, ge_loaded
    log("Starting full GE item preload…")
    ITEMS_PER_PAGE = 12
    MAX_CATEGORY = 37

    temp = {}
    for cat in range(MAX_CATEGORY + 1):
        url_cat = f"https://secure.runescape.com/m=itemdb_rs/api/catalogue/category.json?category={cat}"
        try:
            r = requests.get(url_cat, timeout=10)
            r.raise_for_status()
            data = r.json()
        except (requests.HTTPError, ValueError, json.JSONDecodeError) as e:
            log(f"Category {cat} fetch failed: {e}")
            continue

        for bucket in data.get("alpha", []):
            letter = bucket.get("letter", "")
            count  = bucket.get("items", 0)
            if not (letter.isalpha() and len(letter) == 1):
                log(f"Skipping non-alphabetic bucket '{letter}'")
                continue
            pages = (count + ITEMS_PER_PAGE - 1) // ITEMS_PER_PAGE
            for p in range(1, pages + 1):
                url_page = (
                    "https://secure.runescape.com/m=itemdb_rs/api/catalogue/items.json"
                    f"?category={cat}&alpha={letter}&page={p}"
                )
                try:
                    r2 = requests.get(url_page, timeout=10)
                    r2.raise_for_status()
                    page_data = r2.json()
                except (requests.HTTPError, ValueError, json.JSONDecodeError) as e:
                    log(f"Cat {cat} letter {letter} page {p} JSON error: {e}")
                    continue

                for it in page_data.get("items", []):
                    name = it.get("name")
                    if name:
                        temp[name] = it.get("id")

    ge_all_items = temp
    ge_loaded = True
    log(f"Completed preload: {len(ge_all_items)} items cached")

# Start initial preload
threading.Thread(target=ge_preload, daemon=True).start()

# -------------------------------------
# Periodic reload every 12 hours
# -------------------------------------
def schedule_periodic_ge_preload():
    log("Scheduling periodic GE preload every 12 hours")
    while True:
        time.sleep(12 * 3600)
        log("Running periodic GE preload")
        ge_preload()

threading.Thread(target=schedule_periodic_ge_preload, daemon=True).start()

# -------------------------------------
# Hiscores fetch
# -------------------------------------
SKILLS = [
    "Overall","Attack","Defence","Strength","Constitution","Ranged","Prayer","Magic",
    "Cooking","Woodcutting","Fletching","Fishing","Firemaking","Crafting","Smithing",
    "Mining","Herblore","Agility","Thieving","Slayer","Farming","Runecrafting","Hunter",
    "Construction","Summoning","Dungeoneering","Divination","Invention","Archaeology"
]
SKILL_INDEX = {name: idx for idx, name in enumerate(SKILLS)}

def fetch_hiscore_xp(username: str, skill: str):
    url = "https://secure.runescape.com/m=hiscore/index_lite.ws"
    resp = requests.get(url, params={"player": username.replace(" ", "+")}, timeout=10)
    resp.raise_for_status()
    lines = resp.text.splitlines()
    idx = SKILL_INDEX.get(skill, 0)
    if len(lines) <= idx:
        raise ValueError(f"No hiscore data for skill '{skill}'")
    parts = lines[idx].split(",")
    xp = float(parts[2])
    return {"rank": parts[0], "level": parts[1], "xp": xp}

# -------------------------------------
# XP Calculation
# -------------------------------------
def calculate_xp(data):
    b = float(data.get("base_xp", 0))
    extra = float(data.get("add_xp", 0))
    steps = []

    def rec(s):
        steps.append(s)
        log(s)

    rec(f"Base XP: {b:.2f}")
    rec(f"Flat add XP: {extra:.2f}")
    bonus = 0.0

    pct = data.get("clan_avatar", 0.0) / 100.0
    inc = pct * b; bonus += inc
    rec(f"Clan Avatar: {pct:.3f} * {b:.2f} = {inc:.2f}")

    boost_map = {
        "Relic Powers":0.02,"Incense Sticks":0.02,"Wisdom Aura":0.025,
        "Desert Pantheon":0.10,"Pulse Core":0.10,"Cinder Core":0.10,
        "Coin of Enchantment":0.02,"Sceptre of Enchantment":0.04,"Premier Artifact":0.10
    }
    for name, p in boost_map.items():
        if data.get("vars_pct", {}).get(name):
            inc = p * b; bonus += inc
            rec(f"{name}: {p:.3f} * {b:.2f} = {inc:.2f}")

    if data.get("dxpw"):
        inc = b; bonus += inc
        rec(f"Double XP Weekend: 1.000 * {b:.2f} = {inc:.2f}")
    if data.get("bonusexp"):
        inc = b; bonus += inc
        rec(f"Bonus Experience: 1.000 * {b:.2f} = {inc:.2f}")

    port_map = {
        "Brazier":0.10,"Crafter":0.10,"Fletcher":0.10,
        "Range":0.21,"Well":0.10,"Workbench":0.10
    }
    for name, p in port_map.items():
        if data.get("port_vars", {}).get(name):
            mult = 2.0 if data.get("dxpw") else 1.0
            inc = p * mult * b; bonus += inc
            rec(f"{name}: {(p*mult):.3f} * {b:.2f} = {inc:.2f}")

    if data.get("urn"):
        pct_u = 0.25 if data.get("urn_enh") else 0.20
        inc = pct_u * b; bonus += inc
        label = "Urn + Enhancer" if data.get("urn_enh") else "Urn"
        rec(f"{label}: {pct_u:.3f} * {b:.2f} = {inc:.2f}")

    total = b + extra + bonus
    rec(f"Total = {b:.2f} + {extra:.2f} + {bonus:.2f} = {total:.2f}")
    return {"total": total, "steps": steps}

# -------------------------------------
# Wiki Helper
# -------------------------------------
class Wiki:
    BASE = "https://runescape.wiki/api.php"
    @staticmethod
    def search(term, limit=5):
        r = requests.get(Wiki.BASE, params={
            "action":"opensearch","format":"json","search":term,"limit":limit
        }, timeout=10)
        r.raise_for_status()
        return r.json()[1]
    @staticmethod
    def extract(title, chars=2000):
        r = requests.get(Wiki.BASE, params={
            "action":"query","format":"json","prop":"extracts",
            "exintro":"","explaintext":"","exchars":chars,"titles":title
        }, timeout=10)
        r.raise_for_status()
        pages = r.json()["query"]["pages"]
        return next(iter(pages.values())).get("extract","")

# -------------------------------------
# Routes
# -------------------------------------
@app.route("/")
def index():
    try:
        return render_template("index.html")
    except TemplateNotFound:
        log("index.html not found")
        return "<h1>Template missing!</h1>", 200

@app.route("/api/logs")
def get_logs():
    return jsonify(logs)

@app.route("/api/hiscore")
def api_hiscore():
    user = request.args.get("username","").strip()
    skill = request.args.get("skill","Overall")
    if not user:
        abort(400, "username required")
    try:
        return jsonify(fetch_hiscore_xp(user, skill))
    except Exception as e:
        abort(500, str(e))

@app.route("/api/calculate", methods=["POST"])
def api_calculate():
    try:
        return jsonify(calculate_xp(request.json or {}))
    except Exception as e:
        abort(500, str(e))

@app.route("/api/wiki/search")
def api_wiki_search():
    term = request.args.get("term","").strip()
    if not term:
        return jsonify([])
    try:
        return jsonify(Wiki.search(term, limit=5))
    except:
        return jsonify([])

@app.route("/api/wiki/extract")
def api_wiki_extract():
    title = request.args.get("title","")
    try:
        return jsonify({"extract": Wiki.extract(title, chars=5000)})
    except:
        return jsonify({"extract": ""})

GITHUB_REPO_TAGS = "https://api.github.com/repos/caydenmb/RS3Calculator/tags"
CURRENT_VERSION = "v4.4"

@app.route("/api/updates")
def api_updates():
    try:
        r = requests.get(GITHUB_REPO_TAGS, timeout=5)
        r.raise_for_status()
        tags = r.json()
        latest = tags[0]["name"] if tags else CURRENT_VERSION
        return jsonify({
            "current": CURRENT_VERSION,
            "latest": latest,
            "update_available": latest != CURRENT_VERSION
        })
    except:
        return jsonify({
            "current": CURRENT_VERSION,
            "latest": CURRENT_VERSION,
            "update_available": False
        })

@app.route("/api/ge/status")
def api_ge_status():
    return jsonify({"loaded": ge_loaded, "count": len(ge_all_items)})

@app.route("/api/ge/suggest")
def api_ge_suggest():
    term = request.args.get("term","").strip().lower()
    if not ge_loaded:
        return jsonify([]), 503
    if len(term) < 3:
        return jsonify([])
    matches = [n for n in ge_all_items if term in n.lower()]
    matches.sort()
    return jsonify(matches[:50])

@app.route("/api/ge/detail")
def api_ge_detail():
    name = request.args.get("name","")
    iid = ge_all_items.get(name)
    if not iid:
        return jsonify({"price_str":"0","unit":0}), 404
    try:
        r = requests.get(
            f"https://secure.runescape.com/m=itemdb_rs/api/catalogue/detail.json?item={iid}",
            timeout=10
        )
        r.raise_for_status()
        item = r.json().get("item", {})
        price_str = item.get("current", {}).get("price", "0")
        s = price_str.strip().lower().replace(",", "")
        if s.endswith("m"):
            unit = float(s[:-1]) * 1e6
        elif s.endswith("k"):
            unit = float(s[:-1]) * 1e3
        else:
            unit = float(s)
        return jsonify({"price_str": price_str, "unit": unit})
    except:
        return jsonify({"price_str":"0","unit":0}), 500

@app.route("/api/download/logs.txt")
def download_logs():
    buf = io.StringIO()
    buf.write("RS3 XP Calculator v4.4 – Logs\n")
    buf.write(f"Generated: {time.strftime('%Y-%m-%d %H:%M:%S')}\n\n")
    buf.write("\n".join(logs))
    buf.seek(0)
    return send_file(
        io.BytesIO(buf.read().encode("utf-8")),
        mimetype="text/plain",
        as_attachment=True,
        download_name="rs3_logs.txt"
    )

@app.route("/api/download/report.txt", methods=["POST"])
def download_report():
    data = request.json or {}
    buf = io.StringIO()
    buf.write("RS3 XP Calculator v4.4 – Detailed Report\n")
    buf.write(f"Generated: {time.strftime('%Y-%m-%d %H:%M:%S')}\n\n")
    buf.write(f"Username: {data.get('username','')}\n")
    buf.write(f"Skill: {data.get('skill','')}\n\n")
    buf.write("Math Steps:\n")
    for line in data.get("steps", []):
        buf.write(line + "\n")
    buf.seek(0)
    return send_file(
        io.BytesIO(buf.read().encode("utf-8")),
        mimetype="text/plain",
        as_attachment=True,
        download_name="rs3_report.txt"
    )

if __name__ == "__main__":
    app.run(port=int(os.environ.get("PORT", 5000)), debug=True)
