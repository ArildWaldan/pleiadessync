// ==UserScript==
// @name         Pléiades → iCal sync
// @namespace    pleiades-sync
// @version      1.7
// @description  Parse Castorama Pléiades schedule and publish an .ics to GitHub for iPhone Calendar subscription. Multi-user version with copyable URL modal.
// @match        https://pleiades.gha.kfplc.com/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @connect      api.github.com
// ==/UserScript==

(function () {
  'use strict';

  // ─── CONFIG ─────────────────────────────────────────────────────────────────
  const CONFIG = {
    GITHUB_OWNER:  'ArildWaldan',
    GITHUB_REPO:   'pleiadessync',
    GITHUB_BRANCH: 'main',           // change to 'master' if that's your default
    GITHUB_TOKEN:  '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',
    MONTHS_TOTAL:  3,                 // current month + 2 ahead = 3
    TIMEZONE:      'Europe/Paris',
    AUTO_RELOAD_MINUTES: 30,
    CAL_NAME:      'Work shifts',
  };
  // ────────────────────────────────────────────────────────────────────────────

  // Run only inside the "principal" frame, on the planning page.
  if (window.name !== 'principal') return;
  if (!/PTAPlanningIndividuel\.jsp/i.test(location.pathname)) return;

  const SS_KEY = 'pleiadesSyncState_v1';
  const LS_NAME_KEY = 'pleiadesSyncUserName_v1';
  const log = (...a) => console.log('[pleiades-sync]', ...a);

  // ── User-name management (per-browser, persistent) ─────────────────────────
  function sanitizeName(raw) {
    return (raw || '')
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip accents
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30);
  }
  function getUserName() {
    return localStorage.getItem(LS_NAME_KEY) || '';
  }
  function setUserName(raw) {
    const s = sanitizeName(raw);
    if (s) localStorage.setItem(LS_NAME_KEY, s);
    return s;
  }
  function getIcsPath() {
    const n = getUserName();
    return n ? `shifts-${n}.ics` : null;
  }

  // ── Status badge ────────────────────────────────────────────────────────────
  const badge = document.createElement('div');
  badge.style.cssText = `
    position: fixed; top: 8px; right: 8px; z-index: 99999;
    background: #222; color: #fff; font: 12px/1.4 sans-serif;
    padding: 6px 10px; border-radius: 6px; box-shadow: 0 2px 8px rgba(0,0,0,.3);
    max-width: 360px;
  `;
  badge.textContent = 'Pléiades sync v1.7: starting…';
  document.body.appendChild(badge);
  const setStatus = (txt, color) => {
    badge.textContent = `Pléiades sync v1.7: ${txt}`;
    badge.style.background = color || '#222';
  };

  // ── Name button ────────────────────────────────────────────────────────────
  const nameBtn = document.createElement('button');
  nameBtn.style.cssText = `
    position: fixed; top: 8px; right: 380px; z-index: 99999;
    background: #444; color: #fff; font: 12px/1.4 sans-serif;
    padding: 6px 10px; border-radius: 6px; border: none; cursor: pointer;
    box-shadow: 0 2px 8px rgba(0,0,0,.3);
  `;
  function refreshNameBtn() {
    const n = getUserName();
    nameBtn.textContent = n ? `👤 ${n}` : '👤 Définir prénom';
  }
  // Custom modal with a copy-to-clipboard button. Returns a promise that resolves
  // to true if the user clicked "Lancer la synchro", or false if they closed the modal.
  function showUrlModal({ name, icsPath, url }) {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.style.cssText = `
        position: fixed; inset: 0; z-index: 100000;
        background: rgba(0,0,0,.55); backdrop-filter: blur(4px);
        display: flex; align-items: center; justify-content: center;
        font: 14px/1.5 -apple-system, system-ui, 'Segoe UI', sans-serif;
      `;

      const card = document.createElement('div');
      card.style.cssText = `
        background: #fff; color: #222; border-radius: 12px;
        width: min(560px, 92vw); padding: 24px 24px 20px;
        box-shadow: 0 20px 60px rgba(0,0,0,.4); position: relative;
      `;
      card.innerHTML = `
        <button id="psm-x" title="Fermer" style="
          position: absolute; top: 10px; right: 12px;
          background: none; border: none; font-size: 22px; line-height: 1;
          color: #888; cursor: pointer; padding: 4px 8px;
        ">×</button>
        <div style="font-size: 18px; font-weight: 600; margin-bottom: 6px;">
          Prénom enregistré : ${name}
        </div>
        <div style="color: #555; margin-bottom: 18px;">
          Ton agenda sera publié dans
          <code style="background:#f3f3f3;padding:2px 6px;border-radius:4px;font-size:13px;">${icsPath}</code>
        </div>
        <div style="font-weight: 600; margin-bottom: 6px;">
          URL pour t'abonner sur ton iPhone :
        </div>
        <div style="display: flex; gap: 8px; margin-bottom: 18px;">
          <input id="psm-url" type="text" readonly value="${url}" style="
            flex: 1; padding: 9px 10px; border: 1px solid #ccc; border-radius: 6px;
            font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px;
            background: #fafafa; color: #222;
          ">
          <button id="psm-copy" style="
            padding: 9px 16px; border: none; background: #1f7a1f; color: #fff;
            border-radius: 6px; cursor: pointer; font-weight: 600; min-width: 90px;
          ">Copier</button>
        </div>
        <div style="color: #666; font-size: 13px; margin-bottom: 18px;">
          Sur l'iPhone : Réglages → Calendrier → Comptes → Ajouter un compte → Autre →
          Ajouter un calendrier avec abonnement, et colle l'URL.
        </div>
        <div style="display: flex; justify-content: flex-end; gap: 8px;">
          <button id="psm-go" style="
            padding: 10px 18px; border: none; background: #222; color: #fff;
            border-radius: 6px; cursor: pointer; font-weight: 600;
          ">Lancer la synchro</button>
        </div>
      `;

      overlay.appendChild(card);
      document.body.appendChild(overlay);

      const urlInput = card.querySelector('#psm-url');
      const copyBtn  = card.querySelector('#psm-copy');
      const goBtn    = card.querySelector('#psm-go');
      const xBtn     = card.querySelector('#psm-x');

      // Pre-select the URL so Cmd/Ctrl+C works immediately, no clicks needed.
      setTimeout(() => { urlInput.focus(); urlInput.select(); }, 50);

      const flashCopied = () => {
        copyBtn.textContent = '✓ Copié';
        copyBtn.style.background = '#0d6e0d';
        setTimeout(() => {
          copyBtn.textContent = 'Copier';
          copyBtn.style.background = '#1f7a1f';
        }, 1500);
      };

      copyBtn.addEventListener('click', async () => {
        // Modern API first; fall back to the legacy command if the browser blocks it.
        try {
          await navigator.clipboard.writeText(url);
          flashCopied();
        } catch {
          urlInput.select();
          try {
            document.execCommand('copy');
            flashCopied();
          } catch {
            copyBtn.textContent = '✗ Échec';
            setTimeout(() => { copyBtn.textContent = 'Copier'; }, 1500);
          }
        }
      });

      const close = (launchSync) => {
        document.removeEventListener('keydown', onKey);
        overlay.remove();
        resolve(launchSync);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') close(false);
      };

      goBtn.addEventListener('click', () => close(true));
      xBtn.addEventListener('click', () => close(false));
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close(false);
      });
      document.addEventListener('keydown', onKey);
    });
  }

  nameBtn.addEventListener('click', async () => {
    const current = getUserName();
    const input = prompt(
      'Entre ton prénom (lettres uniquement, ex: "pierre" ou "jean-marc").\n' +
      'Il sera utilisé pour nommer ton fichier .ics sur GitHub.',
      current
    );
    if (input === null) return; // user cancelled
    const saved = setUserName(input);
    if (!saved) {
      alert('Prénom vide ou invalide. Utilise des lettres et chiffres.');
      return;
    }
    refreshNameBtn();
    const icsPath = `shifts-${saved}.ics`;
    const url = `https://raw.githubusercontent.com/${CONFIG.GITHUB_OWNER}/${CONFIG.GITHUB_REPO}/${CONFIG.GITHUB_BRANCH}/${icsPath}`;
    const launchSync = await showUrlModal({ name: saved, icsPath, url });
    if (launchSync) location.reload();
  });
  refreshNameBtn();
  document.body.appendChild(nameBtn);

  // ── State (persists across in-frame navigations) ───────────────────────────
  function loadState() {
    try { return JSON.parse(sessionStorage.getItem(SS_KEY) || 'null'); } catch { return null; }
  }
  function saveState(s) { sessionStorage.setItem(SS_KEY, JSON.stringify(s)); }
  function clearState() { sessionStorage.removeItem(SS_KEY); }

  function nextMonths(count) {
    const out = [];
    const now = new Date();
    let y = now.getFullYear(), m = now.getMonth() + 1;
    for (let i = 0; i < count; i++) {
      out.push(`${y}${String(m).padStart(2, '0')}01`);
      m++; if (m > 12) { m = 1; y++; }
    }
    return out;
  }

  // ── DOM helpers ────────────────────────────────────────────────────────────
  function findScheduleTable(doc) {
    const tables = Array.from(doc.querySelectorAll('table'));
    return tables.filter(t =>
      /Lun\./.test(t.innerText) && /Mar\./.test(t.innerText) &&
      t.querySelector('td[class*="numeroJour"]')
    ).reduce((a, b) => (b.rows.length > (a ? a.rows.length : 0)) ? b : a, null);
  }

  // Try several places where a tooltip/full description might live in the DOM.
  function readCellTitle(cell) {
    if (!cell) return '';
    const candidates = [
      cell.getAttribute('title'),
      cell.getAttribute('aria-label'),
      cell.getAttribute('data-tooltip'),
      cell.getAttribute('data-original-title'), // common with Bootstrap-style tooltips
    ];
    // Also scan any descendant element that exposes one of those attributes.
    cell.querySelectorAll('[title], [aria-label], [data-tooltip], [data-original-title]').forEach(el => {
      candidates.push(
        el.getAttribute('title'),
        el.getAttribute('aria-label'),
        el.getAttribute('data-tooltip'),
        el.getAttribute('data-original-title'),
      );
    });
    // Pléiades-specific: tooltip injected via onmouseover="Affiche_Bulle(event, '...')"
    const onmo = cell.getAttribute('onmouseover');
    if (onmo) {
      const m = onmo.match(/Affiche_Bulle\s*\(\s*event\s*,\s*['"]([\s\S]*?)['"]\s*\)/);
      if (m && m[1]) {
        const decoded = m[1]
          .replace(/\\\//g, '/')
          .replace(/&lt;/gi, '<')
          .replace(/&gt;/gi, '>')
          .replace(/&amp;/gi, '&')
          .replace(/&quot;/gi, '"')
          .replace(/&#39;/gi, "'")
          .replace(/<br\s*\/?>/gi, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        candidates.push(decoded);
      }
    }
    const found = candidates.find(v => v && v.trim().length > 0);
    return found ? found.trim() : '';
  }

  // Strip a leading "DD/MM/YYYY " from Pléiades tooltips so descriptions stay tidy.
  function cleanTitle(t) {
    if (!t) return '';
    return t.replace(/^\d{1,2}\/\d{1,2}\/\d{2,4}\s+/, '').trim();
  }

  function parseCurrentMonth(doc) {
    const sel = doc.getElementById('ListePeriode');
    if (!sel) throw new Error('Period dropdown not found');
    const v = sel.options[sel.selectedIndex].value;
    const year = +v.slice(0, 4), month = +v.slice(4, 6);
    const tbl = findScheduleTable(doc);
    if (!tbl) throw new Error('Schedule table not found');
    const rows = Array.from(tbl.rows);
    const shifts = [];
    for (let i = 0; i < rows.length - 1; i++) {
      const dayCells = Array.from(rows[i].cells);
      const hasDayNum = dayCells.some(c =>
        /numeroJour\b/.test(c.className) && /^\d{1,2}$/.test(c.innerText.trim())
      );
      if (!hasDayNum) continue;
      const dayNums = dayCells.map(c =>
        /numeroJour\b/.test(c.className) && /^\d{1,2}$/.test(c.innerText.trim())
          ? parseInt(c.innerText.trim(), 10) : null
      );
      const shiftCells = Array.from(rows[i + 1].cells);
      for (let col = 0; col < dayCells.length; col++) {
        const day = dayNums[col];
        if (!day) continue;
        const cell = shiftCells[col];
        if (!cell) continue;
        const txt = cell.innerText.replace(/\s+/g, ' ').trim();
        const cls = cell.className;
        const title = readCellTitle(cell);
        const times = txt.match(/\b\d{1,2}:\d{2}\b/g) || [];
        let kind = 'OTHER';
        // REUMI is checked first — its class is "abs cellulePlanning", which would otherwise
        // be misclassified as ABS by the rules below.
        // Cell text varies by day: "REUN [Permanence Matin]" on some days, just "REUMI" on others.
        // Tooltip varies too: "REUNION BADGEE [...]" or "REUNION/MISSION [...]".
        const haystackParse = `${txt} ${title}`;
        const isReumi =
          /\bREU[NM]/i.test(txt) ||                          // REUN, REUM, REUMI at word start in cell
          /R[ÉE]UNION/i.test(title) ||                       // any REUNION in tooltip
          /\[Permanence\s+(Matin|Apr[èe]s)/i.test(haystackParse); // [Permanence Matin/Après in either
        if (isReumi)                                                     kind = 'REUMI';
        else if (/celluleDivisee/.test(cls) && times.length >= 2)        kind = 'WORK';
        else if (/\bREPO\b/.test(cls))                                   kind = 'REPOS';
        else if (/\bJF\b/.test(cls))                                     kind = 'JF';
        else if (/\bCONG\b/.test(cls))                                   kind = 'ARTT';
        else if (/\babs\b/.test(cls))                                    kind = 'ABS';
        else if (times.length >= 2)                                      kind = 'WORK';
        if (kind === 'REUMI') {
          log('REUMI parsed:', { date: `${year}-${pad(month)}-${pad(day)}`, label: txt, title, class: cls });
        }
        shifts.push({ year, month, day, kind, label: txt, times, title });
      }
    }
    return { year, month, shifts };
  }

  function selectedYyyymm(doc) {
    const sel = doc.getElementById('ListePeriode');
    if (!sel) return null;
    return sel.options[sel.selectedIndex].value;
  }

  function dispatchMonthChange(yyyymmdd) {
    const sel = document.getElementById('ListePeriode');
    const idx = Array.from(sel.options).findIndex(o => o.value === yyyymmdd);
    if (idx < 0) throw new Error('Month not in dropdown: ' + yyyymmdd);
    sel.selectedIndex = idx;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    // The page will navigate; this function does not return meaningfully.
  }

  // ── ICS builder ────────────────────────────────────────────────────────────
  const pad = n => String(n).padStart(2, '0');
  const localStamp = (y, mo, d, h, mi) => `${y}${pad(mo)}${pad(d)}T${pad(h)}${pad(mi)}00`;
  const dateOnly   = (y, mo, d) => `${y}${pad(mo)}${pad(d)}`;
  function nowUtcStamp() {
    const d = new Date();
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth()+1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
  }
  const escIcs = s => s.replace(/[\\;,]/g, '\\$&').replace(/\n/g, '\\n');

  // Compact French-style time labels: 8:00 → "8h", 8:30 → "8h30".
  const fmtTime  = (h, m) => m === 0 ? `${h}h` : `${h}h${pad(m)}`;
  const fmtRange = (sh, sm, eh, em) => `${fmtTime(sh, sm)} - ${fmtTime(eh, em)}`;

  function buildIcs(allShifts) {
    const TZ = CONFIG.TIMEZONE;
    const dtstamp = nowUtcStamp();
    // Make the calendar name include the user, so multiple subscriptions on one phone don't collide.
    const calName = `${CONFIG.CAL_NAME} (${getUserName()})`;
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//pleiades-sync//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      `X-WR-CALNAME:${escIcs(calName)}`,
      `X-WR-TIMEZONE:${TZ}`,
      'BEGIN:VTIMEZONE',
      'TZID:Europe/Paris',
      'BEGIN:STANDARD',
      'DTSTART:19701025T030000',
      'TZOFFSETFROM:+0200',
      'TZOFFSETTO:+0100',
      'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
      'TZNAME:CET',
      'END:STANDARD',
      'BEGIN:DAYLIGHT',
      'DTSTART:19700329T020000',
      'TZOFFSETFROM:+0100',
      'TZOFFSETTO:+0200',
      'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
      'TZNAME:CEST',
      'END:DAYLIGHT',
      'END:VTIMEZONE',
    ];

    const now = new Date();
    const todayKey = now.getFullYear()*10000 + (now.getMonth()+1)*100 + now.getDate();

    for (const s of allShifts) {
      const key = s.year*10000 + s.month*100 + s.day;
      if (key < todayKey) continue;

      // REPOS and OTHER produce no event at all.
      if (s.kind === 'REPOS' || s.kind === 'OTHER') continue;

      // Namespace the UID with the username so subscriptions don't collide on a shared phone.
      const uidBase = `${s.year}${pad(s.month)}${pad(s.day)}-${s.kind}-${getUserName()}@pleiades-sync`;

      // Build a list of timed blocks. If null/empty, fall back to an all-day event.
      let blocks = null;

      if (s.kind === 'WORK' && s.times.length >= 2) {
        const t = s.times.map(x => x.split(':').map(Number));
        blocks = [];
        if (t.length === 4) {
          blocks.push({ sh: t[0][0], sm: t[0][1], eh: t[1][0], em: t[1][1] });
          blocks.push({ sh: t[2][0], sm: t[2][1], eh: t[3][0], em: t[3][1] });
        } else if (t.length === 2) {
          blocks.push({ sh: t[0][0], sm: t[0][1], eh: t[1][0], em: t[1][1] });
        } else {
          for (let k = 0; k + 1 < t.length; k += 2) {
            blocks.push({ sh: t[k][0], sm: t[k][1], eh: t[k+1][0], em: t[k+1][1] });
          }
        }
        // Label each block with its own time range.
        blocks.forEach(b => { b.label = fmtRange(b.sh, b.sm, b.eh, b.em); });
      } else if (s.kind === 'REUMI') {
        // Either the cell text or the tooltip can carry the permanence info.
        const haystack = `${s.title || ''} ${s.label || ''}`;
        if (/permanence\s+matin/i.test(haystack)) {
          blocks = [{ sh: 6, sm: 0, eh: 14, em: 0, label: 'Permanence Matin' }];
        } else if (/permanence\s+apr[èe]s[\s\-]?midi/i.test(haystack)) {
          blocks = [{ sh: 12, sm: 0, eh: 20, em: 0, label: 'Permanence Après-midi' }];
        }
        log('REUMI build:', { date: `${s.year}-${pad(s.month)}-${pad(s.day)}`, haystack, blocks });
        // else: leave blocks = null and fall through to all-day fallback so we don't lose info.
      }

      if (blocks && blocks.length > 0) {
        // Drop blocks that already ended today (no point notifying about them).
        if (key === todayKey) {
          const nowMin = now.getHours()*60 + now.getMinutes();
          for (let i = blocks.length - 1; i >= 0; i--) {
            if (blocks[i].eh*60 + blocks[i].em <= nowMin) blocks.splice(i, 1);
          }
        }
        blocks.forEach((b, idx) => {
          const cleanedTitle = cleanTitle(s.title);
          const desc = cleanedTitle ? `${s.label} — ${cleanedTitle}` : s.label;
          lines.push(
            'BEGIN:VEVENT',
            `UID:${uidBase}-${idx}`,
            `DTSTAMP:${dtstamp}`,
            `SUMMARY:${escIcs(b.label)}`,
            `DTSTART;TZID=${TZ}:${localStamp(s.year, s.month, s.day, b.sh, b.sm)}`,
            `DTEND;TZID=${TZ}:${localStamp(s.year, s.month, s.day, b.eh, b.em)}`,
            `DESCRIPTION:${escIcs(desc)}`,
            'END:VEVENT'
          );
        });
      } else {
        // All-day fallback: ARTT, JF, ABS, or REUMI with an unrecognized title.
        const next = new Date(Date.UTC(s.year, s.month - 1, s.day + 1));
        const cleanedTitle = cleanTitle(s.title);
        const summary = cleanedTitle ? `${s.label || s.kind} — ${cleanedTitle}` : (s.label || s.kind);
        lines.push(
          'BEGIN:VEVENT',
          `UID:${uidBase}`,
          `DTSTAMP:${dtstamp}`,
          `SUMMARY:${escIcs(summary)}`,
          `DTSTART;VALUE=DATE:${dateOnly(s.year, s.month, s.day)}`,
          `DTEND;VALUE=DATE:${dateOnly(next.getUTCFullYear(), next.getUTCMonth()+1, next.getUTCDate())}`,
          'TRANSP:TRANSPARENT',
          'END:VEVENT'
        );
      }
    }
    lines.push('END:VCALENDAR');
    return lines.join('\r\n') + '\r\n';
  }

  // ── GitHub upload ──────────────────────────────────────────────────────────
  function b64(str) { return btoa(unescape(encodeURIComponent(str))); }

  function gh(method, url, body) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method, url,
        headers: {
          'Authorization': `Bearer ${CONFIG.GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
        },
        data: body ? JSON.stringify(body) : undefined,
        onload: r => {
          if (r.status >= 200 && r.status < 300) resolve(JSON.parse(r.responseText || '{}'));
          else if (r.status === 404) resolve(null);
          else reject(new Error(`GitHub ${method} ${r.status}: ${r.responseText.slice(0,200)}`));
        },
        onerror: e => reject(new Error('Network error: ' + (e && e.error || 'unknown'))),
      });
    });
  }

  async function publishIcs(ics) {
    const path = getIcsPath();
    if (!path) throw new Error('Prénom non défini — clique le bouton 👤');
    const base = `https://api.github.com/repos/${CONFIG.GITHUB_OWNER}/${CONFIG.GITHUB_REPO}/contents/${encodeURIComponent(path)}`;
    const existing = await gh('GET', `${base}?ref=${CONFIG.GITHUB_BRANCH}`);
    const body = {
      message: `sync ${path} ${new Date().toISOString()}`,
      content: b64(ics),
      branch: CONFIG.GITHUB_BRANCH,
    };
    if (existing && existing.sha) body.sha = existing.sha;
    await gh('PUT', base, body);
    return path;
  }

  // ── Main flow (state-machine across page navigations) ──────────────────────
  async function run() {
    // Block everything until a name is set. The user clicks the 👤 button to set one.
    if (!getUserName()) {
      setStatus('⚠ prénom non défini — clique le bouton 👤', '#a08020');
      return;
    }

    let state = loadState();
    const targets = nextMonths(CONFIG.MONTHS_TOTAL);

    // First run, or stale state: initialize.
    if (!state || !Array.isArray(state.queue) || !state.startedAt
        || (Date.now() - state.startedAt) > 5 * 60 * 1000) {
      state = { queue: targets.slice(), parsed: [], startedAt: Date.now() };
      saveState(state);
      // Make sure we're on the first target month before parsing.
      const here = selectedYyyymm(document);
      if (here !== state.queue[0]) {
        setStatus(`going to ${state.queue[0].slice(0,4)}-${state.queue[0].slice(4,6)}…`);
        dispatchMonthChange(state.queue[0]);
        return; // navigation will re-trigger the script
      }
    }

    const want = state.queue[0];
    const here = selectedYyyymm(document);

    if (here !== want) {
      // We were navigated to the wrong month somehow — re-request.
      setStatus(`going to ${want.slice(0,4)}-${want.slice(4,6)}…`);
      dispatchMonthChange(want);
      return;
    }

    // Parse the month we're on.
    try {
      setStatus(`parsing ${want.slice(0,4)}-${want.slice(4,6)}…`);
      const parsed = parseCurrentMonth(document);
      state.parsed.push(...parsed.shifts);
      state.queue.shift();
      saveState(state);
    } catch (err) {
      console.error('[pleiades-sync] parse failed', err);
      setStatus(`✗ parse: ${err.message}`, '#a02020');
      clearState();
      return;
    }

    // More months left? Navigate to the next; the script will resume after reload.
    if (state.queue.length > 0) {
      const nxt = state.queue[0];
      setStatus(`going to ${nxt.slice(0,4)}-${nxt.slice(4,6)}…`);
      // Small delay to let the badge render before navigation discards it.
      setTimeout(() => dispatchMonthChange(nxt), 250);
      return;
    }

    // All months parsed — build & upload.
    try {
      setStatus(`building .ics (${state.parsed.length} days)…`);
      const ics = buildIcs(state.parsed);
      setStatus('uploading to GitHub…');
      const path = await publishIcs(ics);
      const stamp = new Date().toLocaleTimeString('fr-FR');
      setStatus(`✓ ${path} : ${state.parsed.length} jours à ${stamp}`, '#1f7a1f');
      log('OK', { path, days: state.parsed.length, bytes: ics.length });
    } catch (err) {
      console.error('[pleiades-sync] upload failed', err);
      setStatus(`✗ ${err.message}`, '#a02020');
    } finally {
      clearState();
      // Schedule the next full refresh cycle.
      setTimeout(() => location.reload(), CONFIG.AUTO_RELOAD_MINUTES * 60 * 1000);
    }
  }

  setTimeout(run, 800);
})();
