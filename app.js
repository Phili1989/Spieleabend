/* UNO Punkte & Kasse - V13
   Neu: Gruppen löschen/verlassen, keine doppelten Gruppen,
   automatische neue Runde ohne Enter (iPhone). */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

  var QUICK_KEY = 'unoQuickGame_v12';
  var PRESET = ['Marcel', 'Marvin', 'Alex', 'Philipp'];
  var AUTO_DELAY = 1500; // ms Pause nach der letzten Ziffer, dann wird automatisch übernommen

  var sb = null;
  var session = null;
  var loadedForUser = null;
  var groups = [];
  var activeGroup = null;
  var activeGame = null;
  var gamePlayers = [];
  var rounds = [];
  var scores = [];
  var channel = null;
  var reloadTimer = null;
  var appendingRound = false;
  var historyDays = {};
  var detail = null;

  /* =========================================================
     HILFSFUNKTIONEN
  ========================================================= */

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function eur(n) {
    return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(Number(n) || 0);
  }
  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function dateDe(d) {
    if (!d) return '';
    var p = String(d).slice(0, 10).split('-');
    return p.length === 3 ? p[2] + '.' + p[1] + '.' + p[0] : d;
  }
  function show(sel, on) { var el = $(sel); if (el) el.classList.toggle('hidden', on === false); }
  function banner(html, isError) {
    var b = $('#banner');
    if (!html) { b.classList.add('hidden'); return; }
    b.innerHTML = html; b.classList.remove('hidden'); b.classList.toggle('error', !!isError);
  }
  function toast(text) {
    var t = $('#toast');
    t.textContent = text; t.classList.add('on');
    clearTimeout(t._timer);
    t._timer = setTimeout(function () { t.classList.remove('on'); }, 3000);
  }
  function germanError(err) {
    var m = (err && (err.message || err.error_description)) || String(err || 'Unbekannter Fehler');
    if (/Invalid login credentials/i.test(m)) return 'E-Mail oder Passwort ist falsch.';
    if (/Email not confirmed/i.test(m)) return 'E-Mail noch nicht bestätigt. Bitte den Link in der Bestätigungsmail anklicken.';
    if (/User already registered/i.test(m)) return 'Für diese E-Mail existiert bereits ein Konto. Bitte einloggen.';
    if (/Password should be at least/i.test(m)) return 'Das Passwort ist zu kurz.';
    if (/rate limit/i.test(m)) return 'Zu viele Versuche. Bitte einige Minuten warten.';
    if (/one_active_game_per_group/i.test(m)) return 'In dieser Gruppe läuft bereits ein Spielabend.';
    if (/Could not find the function|function .* does not exist/i.test(m)) return 'Datenbank-Update fehlt: Bitte supabase-update-v13.sql in Supabase ausführen.';
    if (/Failed to fetch|NetworkError/i.test(m)) return 'Keine Verbindung zu Supabase. Bitte Internet prüfen.';
    return m;
  }
  function setBusy(btn, busy, label) {
    if (!btn) return;
    if (busy) { btn._label = btn.textContent; btn.textContent = label || 'Bitte warten …'; btn.disabled = true; }
    else { btn.textContent = btn._label || btn.textContent; btn.disabled = false; }
  }
  function openModal(html) { $('#modal').innerHTML = html; $('#modalbg').classList.add('on'); }
  function closeModal() { $('#modalbg').classList.remove('on'); $('#modal').innerHTML = ''; detail = null; }

  function barsHtml(names, values, label) {
    var sum = values.reduce(function (a, b) { return a + b; }, 0);
    var max = Math.max.apply(null, [1].concat(values));
    return names.map(function (n, i) {
      var pct = sum ? values[i] / sum * 100 : 0;
      return '<div class="bar"><b>' + esc(n) + '<br><small class="muted">' + pct.toFixed(1).replace('.', ',') +
        ' %</small></b><div class="track"><div class="fill" style="width:' + (values[i] / max * 100) +
        '%"></div></div><b>' + label(values[i]) + '</b></div>';
    }).join('');
  }

  var currentScreen = null, screenBeforeQuick = 'auth';
  function screen(name) {
    currentScreen = name;
    show('#auth', name === 'auth');
    show('#groupArea', name === 'groups');
    show('#quickArea', name === 'quick');
    show('#main', name === 'main');
  }

  window.addEventListener('error', function (e) { banner('<b>Technischer Fehler:</b> ' + esc(e.message), true); });
  window.addEventListener('unhandledrejection', function (e) { banner('<b>Technischer Fehler:</b> ' + esc(germanError(e.reason)), true); });

  /* =========================================================
     NEUES SPIEL OHNE GRUPPE (nur lokal)
  ========================================================= */

  var quick = loadQuick();

  function loadQuick() {
    try {
      var q = JSON.parse(localStorage.getItem(QUICK_KEY));
      if (q && Array.isArray(q.players) && Array.isArray(q.rounds)) return q;
    } catch (e) {}
    return { players: [], rounds: [], started: false };
  }
  function saveQuick() { localStorage.setItem(QUICK_KEY, JSON.stringify(quick)); }
  function resetQuick() { quick = { players: [], rounds: [], started: false }; localStorage.removeItem(QUICK_KEY); }

  function quickTotals() {
    return quick.players.map(function (_, i) {
      return quick.rounds.reduce(function (s, r) { return s + (r[i] === '' || r[i] == null ? 0 : Number(r[i])); }, 0);
    });
  }

  function openQuick() {
    if (currentScreen !== 'quick') screenBeforeQuick = currentScreen || 'auth';
    screen('quick');
    renderQuick();
  }

  function renderQuick() {
    show('#quickSetup', !quick.started);
    show('#quickPlay', quick.started);
    $('#quickChips').innerHTML = quick.players.length
      ? quick.players.map(function (p, i) {
          return '<span class="pill">' + esc(p) + '<button type="button" data-qx="' + i + '" aria-label="entfernen">×</button></span>';
        }).join('')
      : '<span class="muted">Noch keine Spieler.</span>';
    $('#quickStart').disabled = quick.players.length < 2;
    if (!quick.started) return;

    var t = quickTotals();
    var h = '<div class="tablewrap"><table><tr><th>Runde</th>' +
      quick.players.map(function (p) { return '<th>' + esc(p) + '</th>'; }).join('') + '</tr>';
    quick.rounds.forEach(function (r, ri) {
      h += '<tr><td>' + (ri + 1) + '</td>' + quick.players.map(function (_, pi) {
        var v = r[pi] == null ? '' : r[pi];
        return '<td><input class="qscore' + (v === '' ? ' open' : '') + '" type="text" inputmode="numeric" pattern="[0-9]*" enterkeyhint="next" value="' +
          v + '" data-r="' + ri + '" data-p="' + pi + '"></td>';
      }).join('') + '</tr>';
    });
    h += '<tr class="total"><td>Gesamt</td>' + t.map(function (x) { return '<td>' + x + '</td>'; }).join('') + '</tr>';
    h += '<tr class="cash"><td>Kasse</td>' + t.map(function (x) { return '<td>' + eur(x / 30) + '</td>'; }).join('') + '</tr></table></div>';
    $('#quickTable').innerHTML = h;
    renderQuickSummary();
  }

  function renderQuickSummary() {
    var t = quickTotals(), sum = t.reduce(function (a, b) { return a + b; }, 0);
    $('#quickSummary').innerHTML = barsHtml(quick.players, t, function (v) { return v + ' · ' + eur(v / 30); }) +
      '<div class="item row between"><b>Gesamtkasse</b><b class="green">' + eur(sum / 30) + '</b></div>';
    $$('#quickTable .total td').slice(1).forEach(function (td, i) { td.textContent = t[i]; });
    $$('#quickTable .cash td').slice(1).forEach(function (td, i) { td.textContent = eur(t[i] / 30); });
  }

  function quickAdd(name) {
    name = (name || '').trim();
    if (!name) return;
    if (quick.players.some(function (p) { return p.toLowerCase() === name.toLowerCase(); })) { toast('Spieler ist bereits vorhanden.'); return; }
    quick.players.push(name); saveQuick(); renderQuick();
  }

  function quickFocus(r, p) {
    var el = document.querySelector('.qscore[data-r="' + r + '"][data-p="' + p + '"]');
    if (el) { el.focus(); el.select(); el.scrollIntoView({ block: 'center' }); }
  }

  function quickCommit(el) {
    var r = +el.dataset.r, p = +el.dataset.p, raw = el.value.trim();
    if (!quick.rounds[r]) return false;
    if (raw !== '' && !/^\d+$/.test(raw)) { toast('Bitte nur ganze Zahlen ab 0 eingeben.'); el.value = quick.rounds[r][p]; return false; }
    var v = raw === '' ? '' : parseInt(raw, 10);
    quick.rounds[r][p] = v; el.value = v;
    el.classList.toggle('open', v === '');
    saveQuick(); renderQuickSummary();
    return true;
  }

  /* Automatische neue Runde, wenn die letzte Runde komplett ist */
  function quickAutoRound(r) {
    var last = quick.rounds.length - 1;
    if (r !== last) return false;
    if (quick.rounds[last].some(function (v) { return v === '' || v == null; })) return false;
    quick.rounds.push(quick.players.map(function () { return ''; }));
    saveQuick(); renderQuick(); quickFocus(last + 1, 0);
    toast('Neue Runde gestartet.');
    return true;
  }

  function bindQuick() {
    $$('.openQuick').forEach(function (b) { b.addEventListener('click', openQuick); });
    $('#quickBack').addEventListener('click', function () { screen(screenBeforeQuick === 'quick' ? 'auth' : screenBeforeQuick); });
    $('#quickAdd').addEventListener('click', function () { quickAdd($('#quickName').value); $('#quickName').value = ''; $('#quickName').focus(); });
    $('#quickName').addEventListener('keydown', function (e) { if (e.key === 'Enter') { quickAdd(this.value); this.value = ''; } });
    $('#quickPreset').addEventListener('click', function () { PRESET.forEach(quickAdd); });
    $('#quickChips').addEventListener('click', function (e) {
      var b = e.target.closest('[data-qx]'); if (!b) return;
      quick.players.splice(+b.dataset.qx, 1); saveQuick(); renderQuick();
    });
    $('#quickStart').addEventListener('click', function () {
      if (quick.players.length < 2) return;
      quick.started = true; quick.rounds = [quick.players.map(function () { return ''; })];
      saveQuick(); renderQuick(); quickFocus(0, 0);
    });

    // iPhone: nach kurzer Tipp-Pause automatisch übernehmen
    $('#quickTable').addEventListener('input', function (e) {
      var el = e.target; if (!el.classList.contains('qscore')) return;
      clearTimeout(el._t);
      el._t = setTimeout(function () { if (quickCommit(el)) quickAutoRound(+el.dataset.r); }, AUTO_DELAY);
    });
    // Feld verlassen (Tippen auf anderes Feld / "Fertig")
    $('#quickTable').addEventListener('change', function (e) {
      var el = e.target; if (!el.classList.contains('qscore')) return;
      clearTimeout(el._t);
      if (quickCommit(el)) quickAutoRound(+el.dataset.r);
    });
    // PC: Enter
    $('#quickTable').addEventListener('keydown', function (e) {
      if (!e.target.classList.contains('qscore') || e.key !== 'Enter') return;
      e.preventDefault();
      var el = e.target; clearTimeout(el._t);
      if (!quickCommit(el)) return;
      var r = +el.dataset.r, p = +el.dataset.p;
      if (p < quick.players.length - 1) { quickFocus(r, p + 1); return; }
      var open = quick.rounds[r].indexOf('');
      if (open > -1) { quickFocus(r, open); toast('Bitte offene Eingabe ergänzen.'); return; }
      if (!quickAutoRound(r)) quickFocus(r + 1, 0);
    });

    $('#quickDelRound').addEventListener('click', function () {
      if (!quick.rounds.length || !confirm('Letzte Runde löschen?')) return;
      quick.rounds.pop();
      if (!quick.rounds.length) quick.rounds.push(quick.players.map(function () { return ''; }));
      saveQuick(); renderQuick();
    });
    $('#quickFinish').addEventListener('click', function () {
      var t = quickTotals();
      var lo = Math.min.apply(null, t), hi = Math.max.apply(null, t), sum = t.reduce(function (a, b) { return a + b; }, 0);
      openModal('<h2>Spiel beendet</h2><div class="muted">Dieses Spiel wird nicht in einer Historie gespeichert.</div>' +
        quick.players.map(function (p, i) {
          return '<div class="item row between"><span>' + (t[i] === lo ? '🏆 ' : '') + (t[i] === hi && hi !== lo ? '📉 ' : '') + esc(p) +
            '</span><span>' + t[i] + ' Pkt · ' + eur(t[i] / 30) + '</span></div>';
        }).join('') +
        '<div class="item row between"><b>Gesamtkasse</b><b class="green">' + eur(sum / 30) + '</b></div>' +
        '<div class="row wrap" style="margin-top:12px"><button type="button" class="primary" id="quickDone">Spiel schließen</button>' +
        '<button type="button" id="quickContinue">Weiterspielen</button></div>');
      $('#quickDone').addEventListener('click', function () {
        var keep = quick.players.slice();
        resetQuick(); quick.players = keep; saveQuick();
        closeModal(); renderQuick();
      });
      $('#quickContinue').addEventListener('click', closeModal);
    });
  }

  /* =========================================================
     START
  ========================================================= */

  async function main() {
    bindQuick();
    $('#modalbg').addEventListener('click', function (e) { if (e.target.id === 'modalbg') closeModal(); });
    $('#modal').addEventListener('click', function (e) {
      var b = e.target.closest('[data-delround]'); if (!b || !detail || !detail.edit) return;
      var left = detail.rounds.filter(function (r) { return !detail.deleted[r.id]; }).length;
      if (left <= 1) { toast('Die letzte Runde kann nicht gelöscht werden. Lösche stattdessen den Spielabend.'); return; }
      $$('.hscore').forEach(function (inp) { applyLocal(inp); });
      detail.deleted[b.dataset.delround] = true;
      renderDetail();
    });

    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
      banner('<b>Keine Verbindung zur Online-Funktion.</b> Bitte Internet prüfen und neu laden. ' +
        '<button type="button" class="link" id="bannerQuick">Trotzdem neues Spiel ohne Gruppe starten</button>', true);
      $('#bannerQuick').addEventListener('click', openQuick);
      return;
    }

    var cfg;
    try { cfg = await import('./config.js?v=' + Date.now()); }
    catch (err) { banner('<b>config.js konnte nicht geladen werden.</b> (' + esc(err.message) + ')', true); return; }

    var url = cfg.SUPABASE_URL, key = cfg.SUPABASE_ANON_KEY || cfg.SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key || /^DEIN/.test(url) || /^DEIN/.test(key)) { banner('<b>config.js ist noch nicht ausgefüllt.</b>', true); return; }
    if (/^sb_secret_/.test(key)) { banner('<b>Falscher Schlüssel:</b> Bitte den Publishable Key (sb_publishable_…) verwenden.', true); return; }

    sb = window.supabase.createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    bindUI();

    var res = await sb.auth.getSession();
    session = res.data ? res.data.session : null;
    banner('');
    applySession();

    sb.auth.onAuthStateChange(function (_e, s) { session = s; setTimeout(applySession, 0); });

    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./service-worker.js', { updateViaCache: 'none' }).catch(function () {});
  }

  function applySession() {
    show('#userBox', !!session);
    $('#userEmail').textContent = session && session.user ? session.user.email : '';
    if (!session) {
      loadedForUser = null; activeGroup = null;
      if (currentScreen !== 'quick') screen('auth');
      return;
    }
    if (loadedForUser !== session.user.id) {
      loadedForUser = session.user.id;
      loadGroups(currentScreen === 'quick');
    }
  }

  function bindUI() {
    $('#signup').addEventListener('click', signup);
    $('#login').addEventListener('click', login);
    $('#loginPassword').addEventListener('keydown', function (e) { if (e.key === 'Enter') login(); });
    $('#signupPassword').addEventListener('keydown', function (e) { if (e.key === 'Enter') signup(); });
    $('#logout').addEventListener('click', logout);
    $('#createGroup').addEventListener('click', createGroup);
    $('#joinGroup').addEventListener('click', joinGroup);
    $('#changeGroup').addEventListener('click', changeGroup);
    $('#newGame').addEventListener('click', askStartGame);
    $('#finish').addEventListener('click', finishGame);

    $('#groups').addEventListener('click', function (e) {
      var open = e.target.closest('[data-g]');
      var del = e.target.closest('[data-delg]');
      var leave = e.target.closest('[data-leaveg]');
      if (open) { var g = groups.filter(function (x) { return x.id === open.dataset.g; })[0]; if (g) selectGroup(g); }
      if (del) deleteGroup(del.dataset.delg, del);
      if (leave) leaveGroup(leave.dataset.leaveg, leave);
    });

    // iPhone: nach kurzer Tipp-Pause automatisch speichern + ggf. neue Runde
    $('#scoreArea').addEventListener('input', function (e) {
      var el = e.target; if (!el.classList.contains('score')) return;
      clearTimeout(el._t);
      el._t = setTimeout(function () { saveScore(el, 'auto'); }, AUTO_DELAY);
    });
    // Feld verlassen ("Fertig" oder anderes Feld antippen)
    $('#scoreArea').addEventListener('change', function (e) {
      var el = e.target; if (!el.classList.contains('score')) return;
      clearTimeout(el._t);
      saveScore(el, 'auto');
    });
    // PC: Enter
    $('#scoreArea').addEventListener('keydown', function (e) {
      if (!e.target.classList.contains('score') || e.key !== 'Enter') return;
      e.preventDefault(); clearTimeout(e.target._t);
      saveScore(e.target, 'enter');
    });

    $('#historyList').addEventListener('click', function (e) {
      var it = e.target.closest('[data-day]'); if (it) openDetail(it.dataset.day);
    });

    $$('nav button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        $$('nav button').forEach(function (b) { b.classList.toggle('on', b === btn); });
        $$('.view').forEach(function (v) { v.classList.toggle('on', v.id === btn.dataset.v); });
      });
    });
  }

  /* =========================================================
     KONTO
  ========================================================= */

  async function signup() {
    var btn = $('#signup'), st = $('#signupStatus');
    var name = $('#signupName').value.trim(), email = $('#signupEmail').value.trim(), password = $('#signupPassword').value;
    if (!name) { st.textContent = 'Bitte Anzeigename eingeben.'; return; }
    if (!email) { st.textContent = 'Bitte E-Mail eingeben.'; return; }
    if (password.length < 8) { st.textContent = 'Passwort muss mindestens 8 Zeichen haben.'; return; }
    setBusy(btn, true, 'Wird registriert …'); st.textContent = '';
    try {
      var res = await sb.auth.signUp({ email: email, password: password,
        options: { data: { display_name: name }, emailRedirectTo: location.origin + location.pathname } });
      if (res.error) throw res.error;
      st.textContent = res.data && res.data.session ? 'Konto erstellt. Du bist angemeldet.'
        : 'Konto erstellt. Bitte die Bestätigungsmail öffnen, den Link anklicken und danach einloggen.';
    } catch (err) { st.textContent = germanError(err); }
    finally { setBusy(btn, false); }
  }

  async function login() {
    var btn = $('#login'), st = $('#loginStatus');
    var email = $('#loginEmail').value.trim(), password = $('#loginPassword').value;
    if (!email || !password) { st.textContent = 'Bitte E-Mail und Passwort eingeben.'; return; }
    setBusy(btn, true, 'Anmeldung …'); st.textContent = '';
    try {
      var res = await sb.auth.signInWithPassword({ email: email, password: password });
      if (res.error) throw res.error;
    } catch (err) { st.textContent = germanError(err); }
    finally { setBusy(btn, false); }
  }

  async function logout() {
    if (channel) { await sb.removeChannel(channel); channel = null; }
    activeGroup = null;
    await sb.auth.signOut();
  }

  /* =========================================================
     GRUPPEN: anzeigen, anlegen, beitreten, löschen, verlassen
  ========================================================= */

  async function loadGroups(silent) {
    var res = await sb.from('group_members').select('group_id, role, groups(id, name, invite_code)').order('joined_at');
    if (res.error) { toast(germanError(res.error)); return; }
    groups = (res.data || []).filter(function (r) { return r.groups; }).map(function (r) {
      return { id: r.groups.id, name: r.groups.name, invite_code: r.groups.invite_code, role: r.role, games: 0 };
    });

    // Anzahl Spielabende je Gruppe ermitteln (hilft bei doppelten Gruppen)
    if (groups.length) {
      var gd = await sb.from('game_days').select('id, group_id').in('group_id', groups.map(function (g) { return g.id; }));
      (gd.data || []).forEach(function (row) {
        groups.forEach(function (g) { if (g.id === row.group_id) g.games++; });
      });
    }

    var names = {}, hasDuplicates = false;
    groups.forEach(function (g) {
      var k = g.name.trim().toLowerCase();
      if (names[k]) hasDuplicates = true;
      names[k] = true;
    });

    $('#groups').innerHTML = (hasDuplicates
      ? '<div class="notice">Du hast mehrere Gruppen mit gleichem Namen. Behalte die Gruppe mit deinen Spielabenden und lösche die überflüssige.</div>'
      : '') +
      (groups.length ? groups.map(function (g) {
        var owner = g.role === 'owner';
        return '<div class="groupRow"><div class="grow"><b>' + esc(g.name) + '</b><div class="muted">Code ' + esc(g.invite_code) +
          ' · ' + g.games + ' Spielabend' + (g.games === 1 ? '' : 'e') + ' · ' + (owner ? 'Ersteller' : 'Mitglied') + '</div></div>' +
          '<button type="button" class="primary" data-g="' + g.id + '">Öffnen</button>' +
          (owner
            ? '<button type="button" class="danger" data-delg="' + g.id + '">Löschen</button>'
            : '<button type="button" class="danger" data-leaveg="' + g.id + '">Verlassen</button>') +
          '</div>';
      }).join('') : '<div class="muted">Noch keine Gruppe.</div>');

    if (!silent) screen('groups');
  }

  async function createGroup() {
    var name = $('#groupName').value.trim();
    if (!name) { toast('Bitte Gruppennamen eingeben.'); return; }
    var exists = groups.some(function (g) { return g.name.trim().toLowerCase() === name.toLowerCase(); });
    if (exists) { toast('Eine Gruppe mit diesem Namen hast du bereits.'); return; }
    var btn = $('#createGroup');
    if (btn.disabled) return;
    setBusy(btn, true);
    var res = await sb.rpc('create_group', { p_name: name });
    setBusy(btn, false);
    if (res.error) { toast(germanError(res.error)); return; }
    $('#groupName').value = '';
    await loadGroups(true);
    var g = groups.filter(function (x) { return x.id === res.data; })[0]; if (g) selectGroup(g);
  }

  async function joinGroup() {
    var code = $('#joinCode').value.trim().toUpperCase(); if (!code) { toast('Bitte Einladungscode eingeben.'); return; }
    var btn = $('#joinGroup'); if (btn.disabled) return;
    setBusy(btn, true);
    var res = await sb.rpc('join_group', { p_invite_code: code }); setBusy(btn, false);
    if (res.error) { toast(germanError(res.error)); return; }
    $('#joinCode').value = '';
    await loadGroups(true);
    var g = groups.filter(function (x) { return x.id === res.data; })[0]; if (g) selectGroup(g);
  }

  async function deleteGroup(id, btn) {
    var g = groups.filter(function (x) { return x.id === id; })[0]; if (!g) return;
    var msg = 'Gruppe „' + g.name + '“ (Code ' + g.invite_code + ') endgültig löschen?\n\n' +
      'Dabei werden auch ' + g.games + ' Spielabend' + (g.games === 1 ? '' : 'e') + ' samt Historie und Kasse für alle Mitglieder gelöscht.';
    if (!confirm(msg)) return;
    setBusy(btn, true);
    var res = await sb.rpc('delete_group', { p_group_id: id });
    setBusy(btn, false);
    if (res.error) { toast(germanError(res.error)); return; }
    toast('Gruppe gelöscht.');
    await loadGroups();
  }

  async function leaveGroup(id, btn) {
    var g = groups.filter(function (x) { return x.id === id; })[0]; if (!g) return;
    if (!confirm('Gruppe „' + g.name + '“ verlassen?')) return;
    setBusy(btn, true);
    var res = await sb.rpc('leave_group', { p_group_id: id });
    setBusy(btn, false);
    if (res.error) { toast(germanError(res.error)); return; }
    toast('Gruppe verlassen.');
    await loadGroups();
  }

  async function selectGroup(g) {
    activeGroup = g;
    screen('main');
    $('#activeGroupName').textContent = g.name;
    $('#activeCode').textContent = g.invite_code;
    await Promise.all([loadMembers(), loadGame(), loadHistory()]);
    subscribe();
  }

  async function changeGroup() {
    if (channel) { await sb.removeChannel(channel); channel = null; }
    activeGroup = null;
    await loadGroups();
  }

  async function loadMembers() {
    if (!activeGroup) return;
    var res = await sb.from('group_members').select('user_id, role').eq('group_id', activeGroup.id).order('joined_at');
    if (res.error) { toast(germanError(res.error)); return; }
    var rows = res.data || [], ids = rows.map(function (r) { return r.user_id; }), names = {};
    if (ids.length) {
      var pr = await sb.from('profiles').select('id, display_name').in('id', ids);
      (pr.data || []).forEach(function (p) { names[p.id] = p.display_name; });
    }
    $('#memberList').innerHTML = rows.length ? rows.map(function (r) {
      return '<div class="item row between"><b>' + esc(names[r.user_id] || 'Mitglied') + '</b><span class="pill">' +
        (r.role === 'owner' ? 'Ersteller' : 'Mitglied') + '</span></div>';
    }).join('') : '<div class="muted">Noch keine Mitglieder.</div>';
  }

  /* =========================================================
     SPIELDATEN LADEN
  ========================================================= */

  async function fetchGameData(gameId) {
    var both = await Promise.all([
      sb.from('game_players').select('player_id, position, players(id, name)').eq('game_day_id', gameId).order('position'),
      sb.from('rounds').select('*').eq('game_day_id', gameId).order('round_number')
    ]);
    if (both[0].error) throw both[0].error;
    if (both[1].error) throw both[1].error;
    var r = both[1].data || [], s = [];
    if (r.length) {
      var sr = await sb.from('round_scores').select('*').in('round_id', r.map(function (x) { return x.id; }));
      if (sr.error) throw sr.error;
      s = sr.data || [];
    }
    return { players: both[0].data || [], rounds: r, scores: s };
  }

  function findScore(list, roundId, playerId) {
    for (var i = 0; i < list.length; i++) if (list[i].round_id === roundId && list[i].player_id === playerId) return list[i];
    return null;
  }
  function totalsOf(players, list) {
    return players.map(function (gp) {
      return list.filter(function (s) { return s.player_id === gp.player_id; })
        .reduce(function (a, s) { return a + (s.points == null ? 0 : Number(s.points)); }, 0);
    });
  }
  function nameOf(gp) { return gp.players ? gp.players.name : '?'; }

  /* =========================================================
     AKTUELLER SPIELABEND
  ========================================================= */

  async function loadGame() {
    if (!activeGroup) return;
    var res = await sb.from('game_days').select('*').eq('group_id', activeGroup.id).eq('status', 'active')
      .order('started_at', { ascending: false }).limit(1);
    if (res.error) { toast(germanError(res.error)); return; }
    activeGame = res.data && res.data.length ? res.data[0] : null;
    if (!activeGame) { gamePlayers = []; rounds = []; scores = []; renderGame(); return; }
    try {
      var d = await fetchGameData(activeGame.id);
      gamePlayers = d.players; rounds = d.rounds; scores = d.scores;
    } catch (err) { toast(germanError(err)); return; }
    renderGame();
  }

  function renderGame() {
    // Feld, in dem gerade getippt wird, inkl. noch nicht gespeichertem Wert merken
    var a = document.activeElement, focused = null;
    if (a && a.classList && a.classList.contains('score')) {
      focused = { r: a.dataset.round, p: a.dataset.player, v: a.value };
    }

    $('#newGame').classList.toggle('hidden', !!activeGame);
    $('#finish').classList.toggle('hidden', !activeGame);

    if (!activeGame) {
      $('#gameMeta').innerHTML = '<div class="notice">Kein aktiver Spielabend. Tippe auf „Neuen Abend starten“.</div>';
      $('#scoreArea').innerHTML = '';
      $('#summary').innerHTML = '<span class="muted">Kein aktiver Spielabend.</span>';
      return;
    }

    $('#gameMeta').innerHTML = '<div class="row wrap between"><span class="muted">Spielabend vom <b>' + dateDe(activeGame.game_date) +
      '</b> · Sobald alle Spieler eine Zahl haben, startet automatisch die nächste Runde.</span>' +
      '<button type="button" class="link" id="changeDate">Datum ändern</button></div>';
    $('#changeDate').addEventListener('click', changeActiveDate);

    var h = '<div class="tablewrap"><table><tr><th>Runde</th>' +
      gamePlayers.map(function (gp) { return '<th>' + esc(nameOf(gp)) + '</th>'; }).join('') + '</tr>';
    rounds.forEach(function (r) {
      h += '<tr><td>' + r.round_number + '</td>';
      gamePlayers.forEach(function (gp) {
        var s = findScore(scores, r.id, gp.player_id), v = s && s.points != null ? s.points : '';
        h += '<td><input class="score' + (v === '' ? ' open' : '') + '" type="text" inputmode="numeric" pattern="[0-9]*" enterkeyhint="next" value="' +
          v + '" data-round="' + r.id + '" data-player="' + gp.player_id + '"></td>';
      });
      h += '</tr>';
    });
    var t = totalsOf(gamePlayers, scores);
    h += '<tr class="total"><td>Gesamt</td>' + t.map(function (x) { return '<td>' + x + '</td>'; }).join('') + '</tr>';
    h += '<tr class="cash"><td>Kasse</td>' + t.map(function (x) { return '<td>' + eur(x / 30) + '</td>'; }).join('') + '</tr></table></div>';
    $('#scoreArea').innerHTML = h;
    renderSummary();

    if (focused) {
      var el = document.querySelector('.score[data-round="' + focused.r + '"][data-player="' + focused.p + '"]');
      if (el) { el.value = focused.v; el.focus(); }
    }
  }

  function renderSummary() {
    var t = totalsOf(gamePlayers, scores), sum = t.reduce(function (a, b) { return a + b; }, 0);
    $('#summary').innerHTML = barsHtml(gamePlayers.map(nameOf), t, function (v) { return v + ' · ' + eur(v / 30); }) +
      '<div class="item row between"><b>Gesamtkasse heute</b><b class="green">' + eur(sum / 30) + '</b></div>';
    $$('#scoreArea .total td').slice(1).forEach(function (td, i) { td.textContent = t[i]; });
    $$('#scoreArea .cash td').slice(1).forEach(function (td, i) { td.textContent = eur(t[i] / 30); });
  }

  function askStartGame() {
    if (!activeGroup || activeGame) return;
    openModal('<h2>Neuen Spielabend starten</h2>' +
      '<div class="field"><label for="startDate"><b>Datum des Spielabends</b></label>' +
      '<input id="startDate" type="date" value="' + today() + '">' +
      '<div class="muted">Alle Gruppenmitglieder werden als Spieler übernommen.</div></div>' +
      '<div class="row wrap" style="margin-top:14px"><button type="button" class="primary" id="confirmStart">Starten</button>' +
      '<button type="button" id="cancelStart">Abbrechen</button></div>');
    $('#cancelStart').addEventListener('click', closeModal);
    $('#confirmStart').addEventListener('click', startGame);
  }

  async function startGame() {
    var date = $('#startDate').value;
    if (!date) { toast('Bitte ein Datum wählen.'); return; }
    var btn = $('#confirmStart'); if (btn.disabled) return;
    setBusy(btn, true);
    var res = await sb.rpc('start_game_day', { p_group_id: activeGroup.id, p_game_date: date });
    setBusy(btn, false);
    if (res.error) { toast(germanError(res.error)); return; }
    closeModal();
    await loadGame();
    var first = document.querySelector('.score'); if (first) first.focus();
    toast('Spielabend vom ' + dateDe(date) + ' gestartet.');
  }

  function changeActiveDate() {
    if (!activeGame) return;
    openModal('<h2>Datum ändern</h2><input id="newDate" type="date" value="' + String(activeGame.game_date).slice(0, 10) + '">' +
      '<div class="row wrap" style="margin-top:14px"><button type="button" class="primary" id="saveDate">Speichern</button>' +
      '<button type="button" id="cancelDate">Abbrechen</button></div>');
    $('#cancelDate').addEventListener('click', closeModal);
    $('#saveDate').addEventListener('click', async function () {
      var d = $('#newDate').value; if (!d) return;
      var res = await sb.from('game_days').update({ game_date: d }).eq('id', activeGame.id);
      if (res.error) { toast(germanError(res.error)); return; }
      closeModal(); await loadGame(); toast('Datum geändert.');
    });
  }

  /* mode: 'enter' (PC-Taste) oder 'auto' (Tipp-Pause / Feld verlassen) */
  async function saveScore(el, mode) {
    if (!session || !activeGame || !el.isConnected) return;
    var raw = el.value.trim(), points = null;
    if (raw !== '') {
      if (!/^\d+$/.test(raw)) { toast('Bitte nur ganze Zahlen ab 0 eingeben.'); return; }
      points = parseInt(raw, 10); el.value = String(points);
    }
    var roundId = el.dataset.round, playerId = el.dataset.player;
    var s = findScore(scores, roundId, playerId);
    var unchanged = s && s.points === points;
    if (s) s.points = points; else scores.push({ round_id: roundId, player_id: playerId, points: points });
    el.classList.toggle('open', points == null);
    renderSummary();

    if (!unchanged) {
      var res = await sb.from('round_scores').upsert(
        { round_id: roundId, player_id: playerId, points: points, updated_by: session.user.id, updated_at: new Date().toISOString() },
        { onConflict: 'round_id,player_id' });
      if (res.error) { toast(germanError(res.error)); return; }
    }

    if (mode === 'auto') { await maybeAutoRound(roundId); return; }

    // PC / Enter: zum nächsten Feld springen
    var row = el.closest('tr');
    var inputs = row ? Array.prototype.slice.call(row.querySelectorAll('.score')) : [];
    var idx = inputs.indexOf(el);
    if (idx > -1 && idx < inputs.length - 1) { inputs[idx + 1].focus(); inputs[idx + 1].select(); return; }
    var firstOpen = inputs.filter(function (i) { return i.value.trim() === ''; })[0];
    if (firstOpen) { firstOpen.focus(); toast('Bitte offene Eingabe ergänzen.'); return; }
    if (!(await maybeAutoRound(roundId))) {
      var all = $$('.score'), pos = all.indexOf(el); if (all[pos + 1]) all[pos + 1].focus();
    }
  }

  /* Neue Runde, sobald in der letzten Runde alle Spieler eine Zahl haben */
  async function maybeAutoRound(roundId) {
    var last = rounds[rounds.length - 1];
    if (!last || last.id !== roundId) return false;
    var complete = gamePlayers.every(function (gp) {
      var s = findScore(scores, last.id, gp.player_id);
      return s && s.points != null;
    });
    if (!complete) return false;
    await appendRound();
    return true;
  }

  async function appendRound() {
    if (appendingRound || !activeGame) return;
    appendingRound = true;
    var res = await sb.rpc('append_round', { p_game_day_id: activeGame.id });
    if (res.error) { appendingRound = false; toast(germanError(res.error)); return; }
    await loadGame();
    appendingRound = false;
    var last = rounds[rounds.length - 1];
    if (last) {
      var el = document.querySelector('.score[data-round="' + last.id + '"]');
      if (el) { el.focus(); el.scrollIntoView({ block: 'center' }); }
    }
    toast('Neue Runde gestartet.');
  }

  async function finishGame() {
    if (!activeGame || !confirm('Spielabend jetzt beenden und in die Historie übernehmen?')) return;
    var btn = $('#finish'); setBusy(btn, true);
    var last = rounds[rounds.length - 1];
    if (last && rounds.length > 1) {
      var empty = gamePlayers.every(function (gp) { var s = findScore(scores, last.id, gp.player_id); return !s || s.points == null; });
      if (empty) await sb.from('rounds').delete().eq('id', last.id);
    }
    var res = await sb.rpc('finish_game_day', { p_game_day_id: activeGame.id });
    setBusy(btn, false);
    if (res.error) { toast(germanError(res.error)); return; }
    await Promise.all([loadGame(), loadHistory()]);
    toast('Spielabend gespeichert.');
  }

  /* =========================================================
     HISTORIE
  ========================================================= */

  async function loadHistory() {
    if (!activeGroup) return;
    var res = await sb.from('game_day_results').select('*').eq('group_id', activeGroup.id).order('game_date', { ascending: false });
    if (res.error) { toast(germanError(res.error)); return; }
    var rows = res.data || [];

    historyDays = {}; var order = [];
    rows.forEach(function (r) {
      if (!historyDays[r.game_day_id]) { historyDays[r.game_day_id] = { id: r.game_day_id, date: r.game_date, list: [] }; order.push(r.game_day_id); }
      historyDays[r.game_day_id].list.push(r);
    });

    $('#historyList').innerHTML = order.length ? order.map(function (id) {
      var d = historyDays[id], sum = d.list.reduce(function (a, r) { return a + Number(r.cash_amount || 0); }, 0);
      return '<div class="item clickable" data-day="' + id + '" role="button" tabindex="0">' +
        '<div class="row between"><b>' + dateDe(d.date) + '</b><span><b class="green">' + eur(sum) + '</b> ›</span></div>' +
        d.list.map(function (r) {
          return '<div class="row between muted"><span>' + (r.is_winner ? '🏆 ' : '') + (r.is_loser ? '📉 ' : '') + esc(r.player_name) +
            '</span><span>' + r.total_points + ' Pkt · ' + eur(r.cash_amount) + '</span></div>';
        }).join('') + '</div>';
    }).join('') : '<div class="muted">Noch keine abgeschlossenen Spielabende.</div>';

    var agg = {};
    rows.forEach(function (r) {
      if (!agg[r.player_name]) agg[r.player_name] = { win: 0, loss: 0, cash: 0 };
      agg[r.player_name].cash += Number(r.cash_amount) || 0;
      if (r.is_winner) agg[r.player_name].win++;
      if (r.is_loser) agg[r.player_name].loss++;
    });
    var e = Object.keys(agg).map(function (k) { return [k, agg[k]]; });
    function list(key) {
      var s = e.slice().sort(function (a, b) { return b[1][key] - a[1][key]; });
      return s.length ? s.map(function (x) { return '<div class="row between item"><span>' + esc(x[0]) + '</span><b>' + x[1][key] + '×</b></div>'; }).join('')
        : '<div class="muted">Noch keine Daten.</div>';
    }
    $('#historyStats').innerHTML = '<div class="card"><h3>🏆 Siege (wenigste Punkte)</h3>' + list('win') + '</div>' +
      '<div class="card"><h3>📉 Niederlagen (meiste Punkte)</h3>' + list('loss') + '</div>';

    var total = e.reduce(function (a, x) { return a + x[1].cash; }, 0);
    var max = Math.max.apply(null, [1].concat(e.map(function (x) { return x[1].cash; })));
    $('#bankStats').innerHTML = '<div class="stat">Gesamtkasse<b class="green">' + eur(total) + '</b></div>' +
      '<div class="stat">Spielabende<b>' + order.length + '</b></div><div class="stat">Spieler<b>' + e.length + '</b></div>';
    $('#bankBars').innerHTML = e.length ? e.sort(function (a, b) { return b[1].cash - a[1].cash; }).map(function (x) {
      return '<div class="bar"><b>' + esc(x[0]) + '</b><div class="track"><div class="fill" style="width:' + (x[1].cash / max * 100) +
        '%"></div></div><b>' + eur(x[1].cash) + '</b></div>';
    }).join('') : '<div class="muted">Noch keine Einzahlungen.</div>';
  }

  async function openDetail(gameId) {
    var day = historyDays[gameId];
    openModal('<h2>Spielabend wird geladen …</h2>');
    try {
      var d = await fetchGameData(gameId);
      detail = { id: gameId, date: String(day ? day.date : '').slice(0, 10), players: d.players, rounds: d.rounds, scores: d.scores, edit: false, deleted: {} };
      renderDetail();
    } catch (err) { closeModal(); toast(germanError(err)); }
  }

  function renderDetail() {
    if (!detail) return;
    var d = detail, edit = d.edit;
    var visibleRounds = d.rounds.filter(function (r) { return !d.deleted[r.id]; });
    var t = totalsOf(d.players, d.scores.filter(function (s) { return !d.deleted[s.round_id]; }));
    var lo = Math.min.apply(null, t), hi = Math.max.apply(null, t);

    var h = '<div class="row between wrap"><h2>Spielabend vom ' + dateDe(d.date) + '</h2>' +
      '<button type="button" id="detClose">Schließen</button></div>';
    if (edit) {
      h += '<div class="field" style="max-width:260px"><label for="detDate"><b>Datum</b></label><input id="detDate" type="date" value="' + d.date + '"></div>' +
        '<div class="muted" style="margin-top:8px">Werte ändern und unten auf „Änderungen speichern“ tippen. Mit ✕ wird eine Runde gelöscht.</div>';
    }
    h += '<div class="tablewrap"><table><tr><th>Runde</th>' +
      d.players.map(function (gp) { return '<th>' + esc(nameOf(gp)) + '</th>'; }).join('') + (edit ? '<th></th>' : '') + '</tr>';
    visibleRounds.forEach(function (r, i) {
      h += '<tr><td>' + (i + 1) + '</td>';
      d.players.forEach(function (gp) {
        var s = findScore(d.scores, r.id, gp.player_id), v = s && s.points != null ? s.points : '';
        h += edit
          ? '<td><input class="hscore' + (v === '' ? ' open' : '') + '" type="text" inputmode="numeric" pattern="[0-9]*" value="' + v +
            '" data-round="' + r.id + '" data-player="' + gp.player_id + '"></td>'
          : '<td>' + (v === '' ? '–' : v) + '</td>';
      });
      if (edit) h += '<td><button type="button" class="danger delround" data-delround="' + r.id + '" aria-label="Runde löschen">✕</button></td>';
      h += '</tr>';
    });
    h += '<tr class="total"><td>Gesamt</td>' + t.map(function (x) { return '<td>' + x + '</td>'; }).join('') + (edit ? '<td></td>' : '') + '</tr>';
    h += '<tr class="cash"><td>Kasse</td>' + t.map(function (x) { return '<td>' + eur(x / 30) + '</td>'; }).join('') + (edit ? '<td></td>' : '') + '</tr></table></div>';

    if (!edit) {
      h += '<div style="margin-top:12px">' + d.players.map(function (gp, i) {
        return '<div class="row between item"><span>' + (t[i] === lo ? '🏆 ' : '') + (t[i] === hi && hi !== lo ? '📉 ' : '') + esc(nameOf(gp)) +
          '</span><span>' + t[i] + ' Pkt · ' + eur(t[i] / 30) + '</span></div>';
      }).join('') + '</div>';
      h += '<div class="row wrap" style="margin-top:14px"><button type="button" class="primary" id="detEdit">Bearbeiten</button>' +
        '<button type="button" class="danger" id="detDelete">Spielabend löschen</button></div>';
    } else {
      h += '<div class="row wrap" style="margin-top:14px"><button type="button" class="primary" id="detSave">Änderungen speichern</button>' +
        '<button type="button" id="detCancel">Abbrechen</button></div>';
    }

    $('#modal').innerHTML = h;
    $('#detClose').addEventListener('click', closeModal);
    if (!edit) {
      $('#detEdit').addEventListener('click', function () { detail.edit = true; detail.deleted = {}; renderDetail(); });
      $('#detDelete').addEventListener('click', deleteDetail);
    } else {
      $('#detCancel').addEventListener('click', function () { detail.edit = false; detail.deleted = {}; renderDetail(); });
      $('#detSave').addEventListener('click', saveDetail);
    }
  }

  function applyLocal(inp) {
    var raw = inp.value.trim();
    if (raw !== '' && !/^\d+$/.test(raw)) return;
    var v = raw === '' ? null : parseInt(raw, 10);
    var s = findScore(detail.scores, inp.dataset.round, inp.dataset.player);
    if (s) s.points = v; else detail.scores.push({ round_id: inp.dataset.round, player_id: inp.dataset.player, points: v });
  }

  async function saveDetail() {
    var d = detail; if (!d) return;
    var btn = $('#detSave'); setBusy(btn, true, 'Wird gespeichert …');
    try {
      var upserts = [];
      $$('.hscore').forEach(function (inp) {
        var raw = inp.value.trim();
        if (raw !== '' && !/^\d+$/.test(raw)) throw new Error('Ungültige Punktzahl: ' + raw);
        upserts.push({ round_id: inp.dataset.round, player_id: inp.dataset.player,
          points: raw === '' ? null : parseInt(raw, 10), updated_by: session.user.id, updated_at: new Date().toISOString() });
      });
      if (upserts.length) {
        var u = await sb.from('round_scores').upsert(upserts, { onConflict: 'round_id,player_id' });
        if (u.error) throw u.error;
      }
      var del = Object.keys(d.deleted);
      if (del.length) {
        var x = await sb.from('rounds').delete().in('id', del);
        if (x.error) throw x.error;
      }
      var newDate = $('#detDate').value;
      if (newDate && newDate !== d.date) {
        var g = await sb.from('game_days').update({ game_date: newDate }).eq('id', d.id);
        if (g.error) throw g.error;
      }
      await loadHistory();
      toast('Änderungen gespeichert.');
      await openDetail(d.id);
    } catch (err) {
      setBusy(btn, false);
      toast(germanError(err));
    }
  }

  async function deleteDetail() {
    if (!detail) return;
    if (!confirm('Spielabend vom ' + dateDe(detail.date) + ' wirklich endgültig löschen? Er wird für alle Gruppenmitglieder entfernt.')) return;
    var btn = $('#detDelete'); setBusy(btn, true);
    var res = await sb.from('game_days').delete().eq('id', detail.id);
    if (res.error) { setBusy(btn, false); toast(germanError(res.error)); return; }
    closeModal();
    await loadHistory();
    toast('Spielabend gelöscht.');
  }

  /* =========================================================
     LIVE-SYNCHRONISIERUNG
  ========================================================= */

  function scheduleReload(withHistory) {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(function () {
      if (appendingRound) return;
      loadGame();
      if (withHistory && !(detail && detail.edit)) loadHistory();
    }, 400);
  }

  function subscribe() {
    if (!activeGroup) return;
    if (channel) sb.removeChannel(channel);
    channel = sb.channel('uno-' + activeGroup.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'round_scores' }, function () { scheduleReload(true); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rounds' }, function () { scheduleReload(true); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_days', filter: 'group_id=eq.' + activeGroup.id }, function () { scheduleReload(true); })
      .subscribe();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', main);
  else main();
})();
