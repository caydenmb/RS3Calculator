// List of skills for the Hiscores dropdown
const SKILLS = [
  "Overall","Attack","Defence","Strength","Constitution","Ranged","Prayer","Magic",
  "Cooking","Woodcutting","Fletching","Fishing","Firemaking","Crafting","Smithing",
  "Mining","Herblore","Agility","Thieving","Slayer","Farming","Runecrafting","Hunter",
  "Construction","Summoning","Dungeoneering","Divination","Invention","Archaeology"
];

let cart = [];         // Grand Exchange shopping cart
let lastCalc = null;   // Store last XP‐calc result for report download
let logWin, logInterval;

document.addEventListener("DOMContentLoaded", () => {
  // Populate skills dropdown
  const selSkill = document.getElementById("selSkill");
  SKILLS.forEach(s => selSkill.add(new Option(s, s)));

  // Clan Avatar slider live value
  const clanSlider = document.getElementById("clanAvatar");
  const clanVal    = document.getElementById("clanAvatarVal");
  clanVal.innerText = clanSlider.value + "%";
  clanSlider.addEventListener("input", e => {
    clanVal.innerText = e.target.value + "%";
  });

  // Button event bindings
  document.getElementById("btnFetchHiscore").addEventListener("click", fetchHiscore);
  document.getElementById("btnCalcXP").addEventListener("click", calculateXP);
  document.getElementById("btnSaveReport").addEventListener("click", saveReport);
  document.getElementById("btnCheckUpdates").addEventListener("click", checkUpdates);
  document.getElementById("btnFetchWiki").addEventListener("click", fetchWiki);
  document.getElementById("btnGetGESugg").addEventListener("click", getGESuggestions);
  document.getElementById("btnAddToCart").addEventListener("click", addToCart);
  document.getElementById("btnShowReceipt").addEventListener("click", showReceipt);

  // Start polling GE status
  updateGEStatus();
  setInterval(updateGEStatus, 2000);
});

// ----- Live Logs Pop-Out -----
document.getElementById("btnViewLogs").onclick = () => {
  if (!logWin || logWin.closed) {
    logWin = window.open("", "rs3logs", "width=600,height=400");
    logWin.document.write(`
      <html><head><title>RS3 Logs</title>
      <style>body{background:#121212;color:#e0e0e0;font-family:monospace;padding:1rem}#logArea{white-space:pre-wrap}</style>
      </head><body>
        <h3>Live Console Logs</h3>
        <pre id="logArea">Loading…</pre>
      </body></html>`);
  }
  if (logInterval) clearInterval(logInterval);
  const update = () => {
    fetch("/api/logs")
      .then(r => r.json())
      .then(arr => {
        if (!logWin || logWin.closed) return clearInterval(logInterval);
        logWin.document.getElementById("logArea").innerText = arr.join("\n");
      })
      .catch(err => console.error("Log fetch error:", err));
  };
  update();
  logInterval = setInterval(update, 2000);
};

// ----- Hiscores Fetch -----
async function fetchHiscore() {
  const user  = document.getElementById("inpUser").value.trim();
  const skill = document.getElementById("selSkill").value;
  if (!user) return alert("Please enter a username.");
  console.log(`Fetching hiscores for ${user} (${skill})…`);
  try {
    const res  = await fetch(`/api/hiscore?username=${encodeURIComponent(user)}&skill=${encodeURIComponent(skill)}`);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const data = await res.json();
    document.getElementById("hiscoreRank").innerText  = data.rank;
    document.getElementById("hiscoreLevel").innerText = data.level;
    document.getElementById("hiscoreXP").innerText    = data.xp;
    console.log("Hiscore result:", data);
  } catch (err) {
    console.error("Hiscore error:", err);
    alert("Failed to fetch hiscores: " + err.message);
  }
}

// ----- XP Calculation -----
async function calculateXP() {
  const b    = parseFloat(document.getElementById("baseXP").value) || 0;
  const extra= parseFloat(document.getElementById("addPct").value) || 0;
  const clan = parseFloat(document.getElementById("clanAvatar").value);
  // Collect percentage boosts
  const vars_pct = {
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

  console.log("Calculating XP…", { base: b, extra, clan, vars_pct, dxpw, bonusexp });
  try {
    const res    = await fetch("/api/calculate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        base_xp: b,
        add_xp: extra,
        clan_avatar: clan,
        vars_pct: vars_pct,
        dxpw: dxpw,
        bonusexp: bonusexp,
        port_vars: {},
        urn: false,
        urn_enh: false
      })
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const result = await res.json();
    lastCalc = result;
    // Compute boost%
    const boost = b > 0
      ? ((result.total - b - extra) / b) * 100
      : 0;
    document.getElementById("pctBoost").innerText = boost.toFixed(2) + "%";
    document.getElementById("totalXP").innerText = result.total.toFixed(2);
    console.log("XP calc result:", result);
  } catch (err) {
    console.error("XP calc error:", err);
    alert("Failed to calculate XP: " + err.message);
  }
}

// ----- Save Report -----
async function saveReport() {
  if (!lastCalc) return alert("Please calculate XP first!");
  const user  = document.getElementById("inpUser").value.trim();
  const skill = document.getElementById("selSkill").value;
  console.log("Saving report for", user, skill);
  try {
    const res = await fetch("/api/download/report.txt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: user, skill: skill, steps: lastCalc.steps })
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = "rs3_report.txt";
    a.click();
    URL.revokeObjectURL(url);
    console.log("Report downloaded");
  } catch (err) {
    console.error("Save report error:", err);
    alert("Failed to save report: " + err.message);
  }
}

// ----- Check for Updates -----
async function checkUpdates() {
  console.log("Checking for updates…");
  try {
    const res  = await fetch("/api/updates");
    const data = await res.json();
    if (data.update_available) {
      alert(`Update available: ${data.latest}`);
    } else {
      alert(`Up to date: ${data.current}`);
    }
    console.log("Update check result:", data);
  } catch (err) {
    console.error("Update check error:", err);
    alert("Failed to check updates");
  }
}

// ----- Wiki Lookup -----
async function fetchWiki() {
  const term = prompt("Enter Wiki search term:");
  if (!term) return;
  console.log("Wiki search for", term);
  try {
    const r1 = await fetch("/api/wiki/search?term=" + encodeURIComponent(term));
    const suggestions = await r1.json();
    if (suggestions.length === 0) { alert("No results found"); return; }
    const choice = prompt(
      "Select a page:\n" +
      suggestions.map((t,i) => `${i+1}. ${t}`).join("\n")
    );
    const idx = parseInt(choice) - 1;
    if (isNaN(idx) || idx < 0 || idx >= suggestions.length) return;
    const title = suggestions[idx];
    console.log("Fetching extract for", title);
    const r2 = await fetch("/api/wiki/extract?title=" + encodeURIComponent(title));
    const { extract } = await r2.json();
    const win = window.open("", "wiki", "width=600,height=400");
    win.document.write(`<html><head><title>${title}</title></head><body><pre>${extract}</pre></body></html>`);
  } catch (err) {
    console.error("Wiki error:", err);
    alert("Wiki lookup failed");
  }
}

// ----- Grand Exchange Status -----
async function updateGEStatus() {
  try {
    const res = await fetch("/api/ge/status");
    const s   = await res.json();
    document.getElementById("geStatus").innerText =
      s.loaded ? `Loaded (${s.count})` : "Loading…";
    console.log("GE status:", s);
  } catch (err) {
    console.error("GE status error:", err);
  }
}

// ----- Get GE Suggestions -----
async function getGESuggestions() {
  const term = document.getElementById("geSearch").value.trim().toLowerCase();
  if (term.length < 3) return alert("Enter at least 3 characters");
  console.log("GE suggest for", term);
  try {
    const res = await fetch("/api/ge/suggest?term=" + encodeURIComponent(term));
    if (res.status === 503) return alert("GE still loading, please wait");
    const list = await res.json();
    const sel  = document.getElementById("geSelect");
    sel.innerHTML = "";
    list.forEach(name => {
      const opt = document.createElement("option");
      opt.value = name;
      opt.text  = name;
      sel.append(opt);
    });
    console.log("GE suggestions:", list);
  } catch (err) {
    console.error("GE suggest error:", err);
    alert("Failed to get suggestions");
  }
}

// ----- Add Item to Cart -----
async function addToCart() {
  const sel  = document.getElementById("geSelect");
  const name = sel.value;
  const qty  = parseInt(document.getElementById("geQty").value) || 1;
  console.log("Adding to cart:", name, qty);
  try {
    const res = await fetch("/api/ge/detail?name=" + encodeURIComponent(name));
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const { unit } = await res.json();
    const total = unit * qty;
    cart.push({ name, qty, unit, total });
    renderCart();
  } catch (err) {
    console.error("GE detail error:", err);
    alert("Failed to fetch item price");
  }
}

// ----- Render Cart Table -----
function renderCart() {
  const tbody = document.querySelector(".ge-table tbody");
  tbody.innerHTML = "";
  let grand = 0;
  cart.forEach(item => {
    const tr = document.createElement("tr");
    ["qty","unit","total"].forEach(key => {
      const td = document.createElement("td");
      td.innerText = item[key];
      tr.append(td);
    });
    tbody.append(tr);
    grand += item.total;
  });
  document.getElementById("geGrandTotal").innerText = grand;
}

// ----- Show Receipt -----
function showReceipt() {
  console.log("Displaying receipt…");
  const win = window.open("", "receipt", "width=600,height=400");
  let html = `
    <html><head><title>Receipt</title></head><body>
      <h3>Grand Exchange Receipt</h3>
      <table border="1" cellpadding="5" cellspacing="0">
        <thead><tr><th>Item</th><th>Qty</th><th>Unit Price</th><th>Total</th></tr></thead>
        <tbody>
  `;
  cart.forEach(it => {
    html += `<tr>
      <td>${it.name}</td>
      <td>${it.qty}</td>
      <td>${it.unit}</td>
      <td>${it.total}</td>
    </tr>`;
  });
  html += `</tbody></table>
      <p><strong>Grand Total:</strong> ${document.getElementById("geGrandTotal").innerText}</p>
    </body></html>`;
  win.document.write(html);
}
