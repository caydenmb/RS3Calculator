// static/js/app.js
// RS3 XP Calculator v4.4 – Web Edition

let logs = [], currentCalcLog = [], geLoaded = false;

// Helper: log to console + in-memory array
function log(msg) {
  const ts = new Date().toISOString().replace("T"," ").split(".")[0];
  const line = `[${ts}] ${msg}`;
  console.log(line);
  logs.push(line);
}

// Download helper
function downloadFile(filename, blobOrText, mime="text/plain") {
  const blob = blobOrText instanceof Blob
    ? blobOrText
    : new Blob([blobOrText], { type: mime });
  const url = URL.createObjectURL(blob);
  const a   = document.createElement("a");
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Populate skill dropdown
const SKILLS = [
  "Overall","Attack","Defence","Strength","Constitution","Ranged","Prayer","Magic",
  "Cooking","Woodcutting","Fletching","Fishing","Firemaking","Crafting","Smithing",
  "Mining","Herblore","Agility","Thieving","Slayer","Farming","Runecrafting","Hunter",
  "Construction","Summoning","Dungeoneering","Divination","Invention","Archaeology"
];
const selSkill = document.getElementById("selSkill");
SKILLS.forEach(s => selSkill.add(new Option(s, s)));

// Poll GE preload status until loaded
function pollGEStatus(){
  fetch("/api/ge/status")
    .then(r => r.json())
    .then(js => {
      const el = document.getElementById("geStatus");
      if (js.loaded) {
        el.innerText = `Items loaded: ${js.count}`;
        log(`GE items loaded: ${js.count}`);
      } else {
        el.innerText = "Loading items...";
        log("GE still loading…");
        setTimeout(pollGEStatus, 2000);
      }
    })
    .catch(e => log("Error polling GE status: " + e));
}
window.addEventListener("load", pollGEStatus);

// 1) Hiscores fetch
document.getElementById("btnFetchHiscore").onclick = () => {
  const user  = document.getElementById("inpUser").value.trim();
  const skill = selSkill.value;
  if (!user) {
    alert("Enter username");
    return;
  }
  log(`Fetching hiscores for '${user}', skill '${skill}'`);
  fetch(`/api/hiscore?username=${encodeURIComponent(user)}&skill=${encodeURIComponent(skill)}`)
    .then(r => {
      if (!r.ok) throw new Error(r.statusText);
      return r.json();
    })
    .then(js => {
      document.getElementById("hiscoreRank" ).innerText = js.rank;
      document.getElementById("hiscoreLevel").innerText = js.level;
      document.getElementById("hiscoreXP"   ).innerText = js.xp.toLocaleString();
      document.getElementById("baseXP").value = js.xp.toFixed(2);
      log(`Hiscores fetched: rank=${js.rank}, lvl=${js.level}, xp=${js.xp}`);
    })
    .catch(e => {
      log("Hiscore fetch error: " + e);
      alert("Error fetching hiscores: " + e);
    });
};

// 2) XP Calculation
document.getElementById("clanAvatar").oninput = e => {
  document.getElementById("clanAvatarVal").innerText = e.target.value + "%";
};
document.getElementById("btnCalcXP").onclick = () => {
  const payload = {
    base_xp:     parseFloat(document.getElementById("baseXP").value) || 0,
    add_xp:      parseFloat(document.getElementById("addPct").value) || 0,
    clan_avatar: parseFloat(document.getElementById("clanAvatar").value) || 0,
    dxpw:        document.getElementById("bDXP").checked,
    bonusexp:    document.getElementById("bBonus").checked,
    vars_pct: {
      "Relic Powers":        document.getElementById("bRelic").checked,
      "Incense Sticks":       document.getElementById("bIncense").checked,
      "Wisdom Aura":          document.getElementById("bWisdom").checked,
      "Desert Pantheon":      document.getElementById("bPantheon").checked,
      "Pulse Core":           document.getElementById("bPulse").checked,
      "Cinder Core":          document.getElementById("bCinder").checked,
      "Coin of Enchantment":  document.getElementById("bCoin").checked,
      "Sceptre of Enchantment": document.getElementById("bSceptre").checked,
      "Premier Artifact":     document.getElementById("bArtifact").checked
    },
    port_vars: {
      "Brazier":   document.getElementById("cbBrazier").checked,
      "Crafter":   document.getElementById("cbCrafter").checked,
      "Fletcher":  document.getElementById("cbFletcher").checked,
      "Range":     document.getElementById("cbRange").checked,
      "Well":      document.getElementById("cbWell").checked,
      "Workbench": document.getElementById("cbWorkbench").checked
    },
    urn:      document.getElementById("cbUrns").checked,
    urn_enh:  document.getElementById("cbUrnEnh").checked
  };

  log("Sending XP calculation payload");
  fetch("/api/calculate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  })
    .then(r => {
      if (!r.ok) throw new Error(r.statusText);
      return r.json();
    })
    .then(js => {
      const pct   = ((js.total - payload.base_xp - payload.add_xp) / payload.base_xp) * 100;
      document.getElementById("pctBoost").innerText   = pct.toFixed(2) + "%";
      document.getElementById("totalXP").innerText    = js.total.toLocaleString("en") + " XP";
      currentCalcLog = js.steps;
      log(`XP calc complete: total=${js.total.toFixed(2)}`);
    })
    .catch(e => {
      log("Calc error: " + e);
      alert("Error calculating XP: " + e);
    });
};

// 3) Check for Updates
document.getElementById("btnCheckUpdates").onclick = () => {
  fetch("/api/updates")
    .then(r => r.json())
    .then(js => {
      if (js.update_available) {
        alert(`New version ${js.latest} available!`);
        log(`Update available: ${js.latest}`);
      } else {
        alert("You are on the latest version.");
        log("No updates found.");
      }
    })
    .catch(e => {
      log("Update check error: " + e);
      alert("Error checking updates: " + e);
    });
};

// 4) View / Save Logs & Reports
document.getElementById("btnViewLogs").onclick = () => {
  document.getElementById("logContent").innerText = logs.join("\n");
  document.getElementById("modalLogs").style.display = "flex";
};
document.getElementById("btnSaveLogs").onclick = () => {
  fetch("/api/download/logs.txt")
    .then(r => r.blob())
    .then(b => downloadFile("rs3_logs.txt", b));
};
document.getElementById("btnSaveReport").onclick = () => {
  const payload = {
    username: document.getElementById("inpUser").value.trim(),
    skill:    selSkill.value,
    steps:    currentCalcLog
  };
  fetch("/api/download/report.txt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  })
    .then(r => r.blob())
    .then(b => downloadFile("rs3_report.txt", b));
};
function closeModal(id) {
  document.getElementById(id).style.display = "none";
}

// 5) Fetch Wiki Page
document.getElementById("btnFetchWiki").onclick = async () => {
  const term = prompt("Enter search term for Wiki:");
  if (!term) return;
  log(`Wiki search for '${term}'`);
  let sugg = [];
  try {
    sugg = await (await fetch(`/api/wiki/search?term=${encodeURIComponent(term)}`)).json();
  } catch {}
  if (!sugg.length) return alert("No wiki pages found.");
  let title = sugg.length === 1
    ? sugg[0]
    : sugg[prompt(
        "Matches:\n" +
        sugg.map((t,i) => `${i+1}. ${t}`).join("\n") +
        "\nEnter #:"
      ) - 1];
  log(`Fetching extract for '${title}'`);
  const ex = (await (await fetch(`/api/wiki/extract?title=${encodeURIComponent(title)}`)).json()).extract;
  document.getElementById("wikiTitle").innerText   = title;
  document.getElementById("wikiContent").innerText = ex;
  document.getElementById("modalWiki").style.display = "flex";
};

// 6) Grand Exchange Suggest & Cart
document.getElementById("btnGetGESugg").onclick = () => {
  const term = document.getElementById("geSearch").value.trim().toLowerCase();
  if (term.length < 3) return alert("Type at least 3 chars");
  fetch(`/api/ge/suggest?term=${encodeURIComponent(term)}`)
    .then(r => {
      if (r.status === 503) throw new Error("GE still loading…");
      return r.json();
    })
    .then(js => {
      const sel = document.getElementById("geSelect");
      sel.innerHTML = "";
      js.forEach(name => sel.add(new Option(name, name)));
    })
    .catch(e => {
      log("GE suggest error: " + e);
      alert(e.message || e);
    });
};

document.getElementById("btnAddToCart").onclick = () => {
  const name = document.getElementById("geSelect").value;
  const qty  = parseInt(document.getElementById("geQty").value) || 1;
  if (!name) return alert("Select an item");
  fetch(`/api/ge/detail?name=${encodeURIComponent(name)}`)
    .then(r => {
      if (!r.ok) throw new Error(r.statusText);
      return r.json();
    })
    .then(js => {
      const unit  = js.unit;
      const total = unit * qty;
      const tbody = document.querySelector("#geCartTable tbody");
      const tr    = tbody.insertRow();
      tr.insertCell().innerText = qty;
      tr.insertCell().innerText = js.price_str;
      tr.insertCell().innerText = total.toLocaleString();
      let grand = Array.from(tbody.rows).reduce(
        (sum, r) => sum + parseFloat(r.cells[2].innerText.replace(/,/g,"")), 0
      );
      document.getElementById("geGrandTotal").innerText =
        grand >= 1e6 ? (grand/1e6).toFixed(2)+"m" :
        grand >= 1e3 ? (grand/1e3).toFixed(2)+"k" :
        grand.toFixed(2);
      log(`Added to cart: ${name} x${qty} @ ${js.price_str}`);
    })
    .catch(e => {
      log("GE detail error: " + e);
      alert("Error fetching item detail: " + e);
    });
};

document.getElementById("btnShowReceipt").onclick = () => {
  const tbody = document.querySelector("#geCartTable tbody");
  const lines = Array.from(tbody.rows).map(r =>
    `${r.cells[0].innerText} x ${r.cells[1].innerText} = ${r.cells[2].innerText}`
  );
  lines.push(`Grand Total = ${document.getElementById("geGrandTotal").innerText}`);
  document.getElementById("receiptContent").innerText = lines.join("\n");
  document.getElementById("modalReceipt").style.display = "flex";
};
