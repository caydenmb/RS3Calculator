// List of all skills for the hiscores dropdown
const SKILLS = [
  "Overall","Attack","Defence","Strength","Constitution","Ranged","Prayer","Magic",
  "Cooking","Woodcutting","Fletching","Fishing","Firemaking","Crafting","Smithing",
  "Mining","Herblore","Agility","Thieving","Slayer","Farming","Runecrafting","Hunter",
  "Construction","Summoning","Dungeoneering","Divination","Invention","Archaeology"
];

let lastCalc = null;   // Holds last XP calculation result for report saving
let cart = [];         // Shopping cart for Grand Exchange
let logWin, logInterval;  // Window & interval for live logging

document.addEventListener("DOMContentLoaded", () => {
  // Populate hiscores skill dropdown
  const selSkill = document.getElementById("selSkill");
  SKILLS.forEach(skill => selSkill.add(new Option(skill, skill)));

  // Live‐update clan avatar slider value
  const clanSlider = document.getElementById("clanAvatar");
  const clanVal    = document.getElementById("clanAvatarVal");
  clanVal.textContent = clanSlider.value + "%";
  clanSlider.addEventListener("input", e => {
    clanVal.textContent = e.target.value + "%";
  });

  // Live‐update additional XP percentage slider value
  const addSlider = document.getElementById("addPct");
  const addVal    = document.getElementById("addPctVal");
  addVal.textContent = addSlider.value + "%";
  addSlider.addEventListener("input", e => {
    addVal.textContent = e.target.value + "%";
  });

  // Button event bindings
  document.getElementById("btnViewLogs").onclick     = openLogWindow;
  document.getElementById("btnCheckUpdates").onclick = checkUpdates;
  document.getElementById("btnFetchWiki").onclick    = fetchWiki;
  document.getElementById("btnFetchHiscore").onclick = fetchHiscore;
  document.getElementById("btnCalcXP").onclick       = calculateXP;
  document.getElementById("btnSaveReport").onclick   = saveReport;
  document.getElementById("btnGetGESugg").onclick    = getGESuggestions;
  document.getElementById("btnAddToCart").onclick    = addToCart;
  document.getElementById("btnShowReceipt").onclick  = showReceipt;

  // Start polling Grand Exchange preload status
  updateGEStatus();
  setInterval(updateGEStatus, 2000);
});


// ---------------- Live Logs Pop-Out ----------------
function openLogWindow() {
  // Open or focus the logs window
  if (!logWin || logWin.closed) {
    logWin = window.open("", "rs3logs", "width=600,height=400");
    logWin.document.write(`
      <html><head><title>RS3 Logs</title>
      <style>
        body { background:#121212; color:#e0e0e0; font-family:monospace; padding:1rem; }
        #logArea { white-space: pre-wrap; }
      </style>
      </head><body>
        <h3>Live Console Logs</h3>
        <pre id="logArea">Loading…</pre>
      </body></html>`);
  }
  // Clear any existing interval
  if (logInterval) clearInterval(logInterval);
  // Fetch logs every 2 seconds
  const update = () => {
    fetch("/api/logs")
      .then(resp => resp.json())
      .then(lines => {
        if (!logWin || logWin.closed) return clearInterval(logInterval);
        logWin.document.getElementById("logArea").innerText = lines.join("\n");
      })
      .catch(err => console.error("Log fetch error:", err));
  };
  update();
  logInterval = setInterval(update, 2000);
}


// ---------------- Hiscores Lookup ----------------
async function fetchHiscore() {
  const user  = document.getElementById("inpUser").value.trim();
  const skill = document.getElementById("selSkill").value;
  if (!user) {
    alert("Please enter a username.");
    return;
  }
  try {
    const resp = await fetch(`/api/hiscore?username=${encodeURIComponent(user)}&skill=${encodeURIComponent(skill)}`);
    if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
    const data = await resp.json();
    // Display fetched data
    document.getElementById("hiscoreRank").textContent  = data.rank;
    document.getElementById("hiscoreLevel").textContent = data.level;
    document.getElementById("hiscoreXP").textContent    = data.xp;
  } catch (err) {
    console.error("Hiscore error:", err);
    alert("Failed to fetch hiscores: " + err.message);
  }
}


// ---------------- XP Calculation ----------------
async function calculateXP() {
  // Gather inputs
  const baseXP    = parseFloat(document.getElementById("baseXP").value) || 0;
  const addPct    = parseFloat(document.getElementById("addPct").value) / 100;
  const addXP     = addPct * baseXP;
  const clanPct   = parseFloat(document.getElementById("clanAvatar").value) / 100;
  const vars_pct  = {
    "Relic Powers":        document.getElementById("bRelic").checked,
    "Incense Sticks":      document.getElementById("bIncense").checked,
    "Wisdom Aura":         document.getElementById("bWisdom").checked,
    "Desert Pantheon":     document.getElementById("bPantheon").checked,
    "Pulse Core":          document.getElementById("bPulse").checked,
    "Cinder Core":         document.getElementById("bCinder").checked,
    "Coin of Enchantment": document.getElementById("bCoin").checked,
    "Sceptre of Enchantment": document.getElementById("bSceptre").checked,
    "Premier Artifact":    document.getElementById("bArtifact").checked
  };
  const dxpw     = document.getElementById("bDXP").checked;
  const bonusexp = document.getElementById("bBonus").checked;

  try {
    // Call back-end calculation
    const resp = await fetch("/api/calculate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        base_xp: baseXP,
        add_xp: addXP,
        clan_avatar: clanPct * 100,
        vars_pct: vars_pct,
        dxpw: dxpw,
        bonusexp: bonusexp,
        port_vars: {},
        urn: false,
        urn_enh: false
      })
    });
    if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
    const result = await resp.json();
    lastCalc = result;

    // Summary display
    const totalXP = result.total;
    const boostPct = baseXP > 0
      ? ((totalXP - baseXP - addXP) / baseXP) * 100
      : 0;
    document.getElementById("pctBoost").textContent = boostPct.toFixed(2) + "%";
    document.getElementById("totalXP").textContent = totalXP.toFixed(2);

    // Show detailed steps
    document.getElementById("xpSteps").textContent = result.steps.join("\n");
  } catch (err) {
    console.error("Calculation error:", err);
    alert("Failed to calculate XP: " + err.message);
  }
}


// ---------------- Save Detailed Report ----------------
async function saveReport() {
  if (!lastCalc) {
    alert("Please calculate XP before saving a report.");
    return;
  }
  try {
    const resp = await fetch("/api/download/report.txt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: document.getElementById("inpUser").value.trim(),
        skill: document.getElementById("selSkill").value,
        steps: lastCalc.steps
      })
    });
    if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
    const blob = await resp.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = "rs3_report.txt";
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error("Save report error:", err);
    alert("Failed to save report: " + err.message);
  }
}


// ---------------- GitHub Update Checker ----------------
async function checkUpdates() {
  try {
    const resp = await fetch("/api/updates");
    const data = await resp.json();
    if (data.update_available) {
      alert(`New version available: ${data.latest}`);
    } else {
      alert(`You are up to date (v${data.current})`);
    }
  } catch (err) {
    console.error("Update check error:", err);
    alert("Failed to check for updates.");
  }
}


// ---------------- Wiki Lookup ----------------
async function fetchWiki() {
  const term = prompt("Wiki search term:");
  if (!term) return;
  try {
    // Get suggestions
    const sresp = await fetch(`/api/wiki/search?term=${encodeURIComponent(term)}`);
    const suggestions = await sresp.json();
    if (suggestions.length === 0) {
      alert("No pages found.");
      return;
    }
    // Let user pick one
    const choice = prompt(
      suggestions.map((t,i)=>`${i+1}. ${t}`).join("\n")
    );
    const idx = parseInt(choice) - 1;
    if (isNaN(idx) || idx < 0 || idx >= suggestions.length) return;
    const title = suggestions[idx];

    // Fetch extract
    const eres = await fetch(`/api/wiki/extract?title=${encodeURIComponent(title)}`);
    const { extract } = await eres.json();
    // Show in pop-up
    const win = window.open("", "wiki", "width=600,height=400");
    win.document.write(`<h2>${title}</h2><pre>${extract}</pre>`);
  } catch (err) {
    console.error("Wiki error:", err);
    alert("Wiki lookup failed.");
  }
}


// ---------------- Grand Exchange Status ----------------
async function updateGEStatus() {
  try {
    const resp = await fetch("/api/ge/status");
    const { loaded, count } = await resp.json();
    document.getElementById("geStatus").textContent =
      loaded ? `Loaded (${count} items)` : "Loading…";
  } catch (err) {
    console.error("GE status error:", err);
  }
}


// ---------------- GE Suggestions ----------------
async function getGESuggestions() {
  const term = document.getElementById("geSearch").value.trim();
  if (term.length < 3) {
    alert("Enter at least 3 characters.");
    return;
  }
  try {
    const resp = await fetch(`/api/ge/suggest?term=${encodeURIComponent(term)}`);
    if (resp.status === 503) {
      alert("GE data still loading; please wait.");
      return;
    }
    const names = await resp.json();
    const sel   = document.getElementById("geSelect");
    sel.innerHTML = "";
    names.forEach(name => {
      const opt = new Option(name, name);
      sel.append(opt);
    });
  } catch (err) {
    console.error("GE suggest error:", err);
    alert("Failed to get suggestions.");
  }
}


// ---------------- Add Item to Cart ----------------
async function addToCart() {
  const name = document.getElementById("geSelect").value;
  const qty  = parseInt(document.getElementById("geQty").value) || 1;
  if (!name) {
    alert("Select an item first.");
    return;
  }
  try {
    const resp = await fetch(`/api/ge/detail?name=${encodeURIComponent(name)}`);
    if (!resp.ok) throw new Error(`${resp.status}`);
    const { unit } = await resp.json();
    const total = unit * qty;
    cart.push({ name, qty, unit, total });
    renderCart();
  } catch (err) {
    console.error("GE detail error:", err);
    alert("Failed to fetch item price.");
  }
}


// ---------------- Render Cart Table ----------------
function renderCart() {
  const tbody = document.querySelector(".ge-table tbody");
  tbody.innerHTML = "";
  let grand = 0;
  cart.forEach(item => {
    const tr = document.createElement("tr");
    ["qty","unit","total"].forEach(key => {
      const td = document.createElement("td");
      td.textContent = item[key];
      tr.append(td);
    });
    tbody.append(tr);
    grand += item.total;
  });
  document.getElementById("geGrandTotal").textContent = grand;
}


// ---------------- Show Receipt ----------------
function showReceipt() {
  if (cart.length === 0) {
    alert("Cart is empty.");
    return;
  }
  const win = window.open("", "receipt", "width=600,height=400");
  let html = `<h2>Grand Exchange Receipt</h2>
    <table border="1" cellpadding="5" cellspacing="0">
      <thead><tr><th>Item</th><th>Qty</th><th>Unit</th><th>Total</th></tr></thead><tbody>`;
  cart.forEach(it => {
    html += `<tr>
      <td>${it.name}</td>
      <td>${it.qty}</td>
      <td>${it.unit}</td>
      <td>${it.total}</td>
    </tr>`;
  });
  html += `</tbody></table>
    <h3>Grand Total: ${document.getElementById("geGrandTotal").textContent}</h3>`;
  win.document.write(html);
}
