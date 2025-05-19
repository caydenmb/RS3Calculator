# app.py
# RS3 XP Calculator v4.4 – Back‐end (Flask)

import io
import time
import threading
import logging
from logging.handlers import RotatingFileHandler

import requests
from flask import (
    Flask, request, jsonify, send_file,
    render_template, abort
)
# if you still need CORS, ensure flask-cors is in requirements.txt
from flask_cors import CORS  

# --------------------
# App & Logger Setup
# --------------------
app = Flask(__name__)
CORS(app)  # remove this line if not using cross‐origin requests

file_handler = RotatingFileHandler('rs3calc.log', maxBytes=1_000_000, backupCount=3)
file_formatter = logging.Formatter('[%(asctime)s] %(message)s')
file_handler.setFormatter(file_formatter)
app.logger.setLevel(logging.INFO)
app.logger.addHandler(file_handler)

# In‐memory cache for live log endpoint
log_cache = []
class CacheHandler(logging.Handler):
    def emit(self, record):
        msg = self.format(record)
        log_cache.append(msg)
        if len(log_cache) > 500:
            log_cache.pop(0)

cache_handler = CacheHandler()
cache_handler.setFormatter(file_formatter)
app.logger.addHandler(cache_handler)


# -----------------------
# Constants & Shared Data
# -----------------------
SKILLS = [
    "Overall","Attack","Defence","Strength","Constitution","Ranged","Prayer","Magic",
    "Cooking","Woodcutting","Fletching","Fishing","Firemaking","Crafting","Smithing",
    "Mining","Herblore","Agility","Thieving","Slayer","Farming","Runecrafting","Hunter",
    "Construction","Summoning","Dungeoneering","Divination","Invention","Archaeology"
]

ge_data = {
    'loaded': False,
    'items': [],
    'timestamp': 0
}


# ------------------------
# Grand Exchange Preloader
# ------------------------
def ge_preload():
    """Background thread: fetch all GE items via secure.runescape.com API."""
    app.logger.info("GE preload starting…")
    items = []
    for cat in range(5):
        for letter in 'abcdefghijklmnopqrstuvwxyz':
            page = 1
            while True:
                url = (
                    "https://secure.runescape.com/"
                    f"m=itemdb_rs/api/catalogue/items.json"
                    f"?category={cat}&alpha={letter}&page={page}"
                )
                try:
                    r = requests.get(url, timeout=5)
                    r.raise_for_status()
                    data = r.json()
                except Exception as e:
                    app.logger.info(f"GE load cat {cat} letter {letter} page {page} failed: {e}")
                    break
                batch = data.get('items', [])
                if not batch:
                    break
                for it in batch:
                    items.append({'id': it['id'], 'name': it['name']})
                page += 1
    ge_data['items'] = items
    ge_data['loaded'] = True
    ge_data['timestamp'] = time.time()
    app.logger.info(f"GE preload complete: {len(items)} items")


@app.before_first_request
def kick_off_ge_preload():
    """Under Gunicorn or flask run, start GE-preload on first request."""
    t = threading.Thread(target=ge_preload, daemon=True)
    t.start()


# -------------------
# Web Page Rendering
# -------------------
@app.route('/')
def index():
    return render_template('index.html')


# -------------------
# Live Logs Endpoint
# -------------------
@app.route('/api/logs')
def api_logs():
    return jsonify(log_cache)


# -------------------
# Hiscores Endpoint
# -------------------
@app.route('/api/hiscore')
def api_hiscore():
    user = request.args.get('username', '')
    skill = request.args.get('skill', 'Overall')
    if not user:
        abort(400, "Missing username")
    try:
        url = f"https://secure.runescape.com/m=hiscore/index_lite.ws?player={user}"
        r = requests.get(url, timeout=5)
        r.raise_for_status()
        lines = r.text.splitlines()
        idx = SKILLS.index(skill)
        rank, level, xp = lines[idx].split(',')
        return jsonify({'rank': int(rank), 'level': int(level), 'xp': int(xp)})
    except Exception as e:
        app.logger.error(f"Hiscore fetch error for {user}/{skill}: {e}")
        abort(502, str(e))


# ----------------------
# XP Calculation Endpoint
# ----------------------
@app.route('/api/calculate', methods=['POST'])
def api_calculate():
    data = request.get_json() or {}
    base = float(data.get('base_xp', 0))
    add_xp = float(data.get('add_xp', 0))
    clan_pct = float(data.get('clan_avatar', 0))
    vars_pct = data.get('vars_pct', {})
    dxpw = bool(data.get('dxpw', False))
    bonusexp = bool(data.get('bonusexp', False))

    steps = []
    xp = base
    steps.append(f"Base XP: {xp:.2f}")

    if add_xp:
        xp += add_xp
        steps.append(f"Additional XP: {add_xp:.2f}")

    clan_boost = xp * (clan_pct / 100)
    xp += clan_boost
    steps.append(f"Clan Avatar ({clan_pct:.1f}%): {clan_boost:.2f}")

    boost_map = {
        'Relic Powers':2, 'Incense Sticks':2, 'Wisdom Aura':2,
        'Desert Pantheon':3, 'Pulse Core':1, 'Cinder Core':1.5,
        'Coin of Enchantment':3.5, 'Sceptre of Enchantment':2.5,
        'Premier Artifact':1.5
    }
    for name, enabled in vars_pct.items():
        if enabled and name in boost_map:
            pct = boost_map[name]
            boost_amt = xp * (pct/100)
            xp += boost_amt
            steps.append(f"{name} ({pct}%): {boost_amt:.2f}")

    if dxpw:
        boost_amt = xp
        xp *= 2
        steps.append(f"Double XP: +{boost_amt:.2f}")

    if bonusexp:
        pct = 5
        boost_amt = xp * (pct/100)
        xp += boost_amt
        steps.append(f"Bonus XP ({pct}%): {boost_amt:.2f}")

    total = xp
    return jsonify({'total': total, 'steps': steps})


# -----------------------
# Download Report Endpoint
# -----------------------
@app.route('/api/download/report.txt', methods=['POST'])
def download_report():
    data = request.get_json() or {}
    user = data.get('username', 'Unknown')
    skill = data.get('skill', 'Overall')
    steps = data.get('steps', [])

    report = io.StringIO()
    report.write("RS3 XP Calculator Report\n")
    report.write("========================\n")
    report.write(f"Username: {user}\nSkill: {skill}\n\nMath Steps:\n")
    for line in steps:
        report.write(" • " + line + "\n")

    buf = io.BytesIO(report.getvalue().encode('utf-8'))
    buf.seek(0)
    return send_file(
        buf,
        as_attachment=True,
        download_name='rs3_xp_report.txt',
        mimetype='text/plain'
    )


# --------------------------
# GitHub Update Checker
# --------------------------
@app.route('/api/updates')
def api_updates():
    current_version = "v4.4"
    try:
        r = requests.get(
            "https://api.github.com/repos/caydenmb/RS3Calculator/commits/main",
            timeout=5
        )
        r.raise_for_status()
        latest_sha = r.json().get('sha', '')[:7]
    except Exception as e:
        app.logger.error("Update check failed: %s", e)
        latest_sha = current_version

    return jsonify({
        'current': current_version,
        'latest': latest_sha,
        'update_available': latest_sha != current_version
    })


# ----------------
# Wiki Search API
# ----------------
@app.route('/api/wiki/search')
def wiki_search():
    term = request.args.get('term', '')
    params = {
        'action': 'opensearch',
        'search': term,
        'limit': 5,
        'namespace': 0,
        'format': 'json'
    }
    r = requests.get("https://runescape.wiki/api.php", params=params, timeout=5)
    r.raise_for_status()
    suggestions = r.json()[1]
    return jsonify(suggestions)


@app.route('/api/wiki/extract')
def wiki_extract():
    title = request.args.get('title', '')
    params = {
        'action': 'query',
        'prop': 'extracts',
        'exintro': '',
        'explaintext': '',
        'titles': title,
        'format': 'json'
    }
    r = requests.get("https://runescape.wiki/api.php", params=params, timeout=5)
    r.raise_for_status()
    pages = r.json().get('query', {}).get('pages', {})
    extract = next(iter(pages.values())).get('extract', '')
    return jsonify({'extract': extract})


# ------------------------
# Grand Exchange Endpoints
# ------------------------
@app.route('/api/ge/status')
def ge_status():
    return jsonify({
        'loaded': ge_data['loaded'],
        'count': len(ge_data['items'])
    })


@app.route('/api/ge/suggest')
def ge_suggest():
    term = request.args.get('term', '').lower()
    if not ge_data['loaded']:
        return ('', 503)
    matches = [
        it['name'] for it in ge_data['items']
        if term in it['name'].lower()
    ][:50]
    return jsonify(matches)


@app.route('/api/ge/detail')
def ge_detail():
    name = request.args.get('name', '')
    if not ge_data['loaded']:
        abort(503)
    found = next((it for it in ge_data['items'] if it['name'] == name), None)
    if not found:
        abort(404, "Item not found")
    item_id = found['id']
    url = f"https://secure.runescape.com/m=itemdb_rs/api/catalogue/detail.json?item={item_id}"
    r = requests.get(url, timeout=5)
    r.raise_for_status()
    price = r.json()['item']['current']['price']
    return jsonify({'unit': price})


# -------------
# Launch Server
# -------------
if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
