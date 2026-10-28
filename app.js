/* UNO Punkte & Kasse - V11
   Klassisches Skript (kein ES-Modul). Die vorhandene config.js wird dynamisch geladen. */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

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

  /* ---------- Hilfsfunktionen ---------- */

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function eur(n) {
    return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(Number(n) || 0);
  }

  function today() { return new Date().toISOString().slice(0, 10); }

  function dateDe(d) {
    if (!d) return '';
    var p = String(d).slice(0, 10).split('-');
    return p.length === 3 ? p[2] + '.' + p[1] + '.' + p[0] : d;
  }

  function show(sel, on) {
    var el = $(sel);
    if (el) el.classList.toggle('hidden', on === false);
  }

  function banner(html, isError) {
    var b = $('#banner');
    if (!b) return;
    if (!html) { b.classList.add('hidden'); return; }
    b.innerHTML = html;
    b.classList.remove('hidden');
    b.classList.toggle('error', !!isError);
  }

  function toast(text) {
    var t = $('#toast');
    if (!t) return;
    t.textContent = text;
    t.classList.add('on');
    clearTimeout(t._timer);
    t._timer = setTimeout(function () { t.classList.remove('on'); }, 2600);
  }

  function germanError(err) {
    var m = (err && (err.message || err.error_description)) || String(err || 'Unbekannter Fehler');
    if (/Invalid login credentials/i.test(m)) return 'E-Mail oder Passwort ist falsch.';
    if (/Email not confirmed/i.test(m)) return 'E-Mail noch nicht bestätigt. Bitte den Link in der Bestätigungsmail anklicken.';
    if (/User already registered/i.test(m)) return 'Für diese E-Mail existiert bereits ein Konto. Bitte einloggen.';
    if (/Password should be at least/i.test(m)) return 'Das Passwort ist zu kurz.';
    if (/rate limit/i.test(m)) return 'Zu viele Versuche. Bitte einige Minuten warten.';
    if (/Failed to fetch|NetworkError/i.test(m)) return 'Keine Verbindung zu Supabase. Internet bzw. Project URL prüfen.';
    return m;
  }

  function setBusy(btn, busy, label) {
    if (!btn) return;
    if (busy) { btn._label = btn.textContent; btn.textContent = label || 'Bitte warten …'; btn.disabled = true; }
    else { btn.textContent = btn._label || btn.textContent; btn.disabled = false; }
  }

  function totals() {
    return gamePlayers.map(function (gp) {
      return scores
        .filter(function (s) { return s.player_id === gp.player_id; })
        .reduce(function (sum, s) { return sum + (s.points == null ? 0 : Number(s.points)); }, 0);
    });
  }

  function scoreOf(roundId, playerId) {
    for (var i = 0; i < scores.length; i++) {
      if (scores[i].round_id === roundId && scores[i].player_id === playerId) return scores[i];
    }
    return null;
  }

  /* Globale Fehleranzeige, damit nie wieder "nichts passiert" */
  window.addEventListener('error', function (e) {
    banner('<b>Technischer Fehler:</b> ' + esc(e.message), true);
  });
  window.addEventListener('unhandledrejection', function (e) {
    banner('<b>Technischer Fehler:</b> ' + esc(germanError(e.reason)), true);
  });

  /* ---------- Start ---------- */

  async function main() {
    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
      banner('<b>Die Supabase-Bibliothek konnte nicht geladen werden.</b> Bitte Internetverbindung prüfen und die Seite neu laden.', true);
      return;
    }

    var cfg;
    try {
      cfg = await import('./config.js?v=' + Date.now());
    } catch (err) {
      banner('<b>config.js konnte nicht geladen werden.</b> Prüfe, ob config.js im Repository liegt. (' + esc(err.message) + ')', true);
      return;
    }

    var url = cfg.SUPABASE_URL;
    var key = cfg.SUPABASE_ANON_KEY || cfg.SUPABASE_PUBLISHABLE_KEY;

    if (!url || !key || /^DEIN/.test(url) || /^DEIN/.test(key)) {
      banner('<b>config.js ist noch nicht ausgefüllt.</b> Project URL und Publishable Key eintragen.', true);
      return;
    }
    if (/^sb_secret_/.test(key)) {
      banner('<b>Falscher Schlüssel:</b> In config.js steht ein Secret Key. Bitte den Publishable Key (sb_publishable_…) verwenden.', true);
      return;
    }

    sb = window.supabase.createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });

    bindUI();

    var res = await sb.auth.getSession();
    session = res.data ? res.data.session : null;
    banner('');
    applySession();

    sb.auth.onAuthStateChange(function (_event, newSession) {
      session = newSession;
      setTimeout(applySession, 0);
    });

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./service-worker.js', { updateViaCache: 'none' }).catch(function () {});
    }
  }

  function applySession() {
    show('#auth', !session);
    show('#userBox', !!session);
    $('#userEmail').textContent = session && session.user ? session.user.email : '';

    if (!session) {
      loadedForUser = null;
      activeGroup = null;
      show('#groupArea', false);
      show('#main', false);
      return;
    }

    if (loadedForUser !== session.user.id) {
      loadedForUser = session.user.id;
      show('#main', false);
      loadGroups();
    }
  }

  /* ---------- Oberfläche verbinden ---------- */

  function bindUI() {
    $('#signup').addEventListener('click', signup);
    $('#login').addEventListener('click', login);
    $('#loginPassword').addEventListener('keydown', function (e) { if (e.key === 'Enter') login(); });
    $('#signupPassword').addEventListener('keydown', function (e) { if (e.key === 'Enter') signup(); });
    $('#logout').addEventListener('click', logout);
    $('#createGroup').addEventListener('click', createGroup);
    $('#joinGroup').addEventListener('click', joinGroup);
    $('#changeGroup').addEventListener('click', changeGroup);
    $('#newGame').addEventListener('click', startGame);
    $('#finish').addEventListener('click', finishGame);

    $('#groups').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-g]');
      if (!btn) return;
      var g = groups.filter(function (x) { return x.id === btn.dataset.g; })[0];
      if (g) selectGroup(g);
    });

    $('#scoreArea').addEventListener('keydown', function (e) {
      if (!e.target.classList.contains('score') || e.key !== 'Enter') return;
      e.preventDefault();
      saveScore(e.target, true);
    });
    $('#scoreArea').addEventListener('change', function (e) {
      if (e.target.classList.contains('score')) saveScore(e.target, false);
    });

    $$('nav button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        $$('nav button').forEach(function (b) { b.classList.toggle('on', b === btn); });
        $$('.view').forEach(function (v) { v.classList.toggle('on', v.id === btn.dataset.v); });
      });
    });
  }

  /* ---------- Konto ---------- */

  async function signup() {
    var btn = $('#signup'), st = $('#signupStatus');
    var name = $('#signupName').value.trim();
    var email = $('#signupEmail').value.trim();
    var password = $('#signupPassword').value;

    if (!name) { st.textContent = 'Bitte Anzeigename eingeben.'; return; }
    if (!email) { st.textContent = 'Bitte E-Mail eingeben.'; return; }
    if (password.length < 8) { st.textContent = 'Passwort muss mindestens 8 Zeichen haben.'; return; }

    setBusy(btn, true, 'Wird registriert …');
    st.textContent = '';
    try {
      var res = await sb.auth.signUp({
        email: email,
        password: password,
        options: {
          data: { display_name: name },
          emailRedirectTo: location.origin + location.pathname
        }
      });
      if (res.error) throw res.error;
      if (res.data && res.data.session) {
        st.textContent = 'Konto erstellt. Du bist angemeldet.';
      } else {
        st.textContent = 'Konto erstellt. Bitte jetzt die Bestätigungsmail öffnen und den Link anklicken. Danach links einloggen.';
      }
    } catch (err) {
      st.textContent = germanError(err);
    } finally {
      setBusy(btn, false);
    }
  }

  async function login() {
    var btn = $('#login'), st = $('#loginStatus');
    var email = $('#loginEmail').value.trim();
    var password = $('#loginPassword').value;
    if (!email || !password) { st.textContent = 'Bitte E-Mail und Passwort eingeben.'; return; }

    setBusy(btn, true, 'Anmeldung …');
    st.textContent = '';
    try {
      var res = await sb.auth.signInWithPassword({ email: email, password: password });
      if (res.error) throw res.error;
      st.textContent = '';
    } catch (err) {
      st.textContent = germanError(err);
    } finally {
      setBusy(btn, false);
    }
  }

  async function logout() {
    if (channel) { await sb.removeChannel(channel); channel = null; }
    activeGroup = null;
    await sb.auth.signOut();
  }

  /* ---------- Gruppen ---------- */

  async function loadGroups() {
    var res = await sb.from('group_members')
      .select('group_id, role, groups(id, name, invite_code)')
      .order('joined_at');
    if (res.error) { toast(germanError(res.error)); return; }

    groups = (res.data || []).filter(function (r) { return r.groups; }).map(function (r) {
      return { id: r.groups.id, name: r.groups.name, invite_code: r.groups.invite_code, role: r.role };
    });

    $('#groups').innerHTML = groups.length
      ? groups.map(function (g) {
          return '<button type="button" class="primary" data-g="' + g.id + '">' + esc(g.name) + '</button>';
        }).join('')
      : '<span class="muted">Noch keine Gruppe. Lege eine an oder tritt mit Einladungscode bei.</span>';

    if (groups.length === 1) { selectGroup(groups[0]); return; }
    show('#groupArea', true);
  }

  async function createGroup() {
    var name = $('#groupName').value.trim();
    if (!name) { toast('Bitte Gruppennamen eingeben.'); return; }
    var btn = $('#createGroup');
    setBusy(btn, true);
    var res = await sb.rpc('create_group', { p_name: name });
    setBusy(btn, false);
    if (res.error) { toast(germanError(res.error)); return; }
    $('#groupName').value = '';
    await loadGroups();
    var g = groups.filter(function (x) { return x.id === res.data; })[0];
    if (g) selectGroup(g);
  }

  async function joinGroup() {
    var code = $('#joinCode').value.trim().toUpperCase();
    if (!code) { toast('Bitte Einladungscode eingeben.'); return; }
    var btn = $('#joinGroup');
    setBusy(btn, true);
    var res = await sb.rpc('join_group', { p_invite_code: code });
    setBusy(btn, false);
    if (res.error) { toast(germanError(res.error)); return; }
    $('#joinCode').value = '';
    await loadGroups();
    var g = groups.filter(function (x) { return x.id === res.data; })[0];
    if (g) selectGroup(g);
  }

  async function selectGroup(g) {
    activeGroup = g;
    show('#groupArea', false);
    show('#main', true);
    $('#activeGroupName').textContent = g.name;
    $('#activeCode').textContent = g.invite_code;
    await Promise.all([loadMembers(), loadGame(), loadHistory()]);
    subscribe();
  }

  async function changeGroup() {
    if (channel) { await sb.removeChannel(channel); channel = null; }
    activeGroup = null;
    show('#main', false);
    show('#groupArea', true);
  }

  async function loadMembers() {
    if (!activeGroup) return;
    var res = await sb.from('group_members').select('user_id, role').eq('group_id', activeGroup.id).order('joined_at');
    if (res.error) { toast(germanError(res.error)); return; }
    var rows = res.data || [];
    var ids = rows.map(function (r) { return r.user_id; });
    var names = {};
    if (ids.length) {
      var pr = await sb.from('profiles').select('id, display_name').in('id', ids);
      (pr.data || []).forEach(function (p) { names[p.id] = p.display_name; });
    }
    $('#memberList').innerHTML = rows.length
      ? rows.map(function (r) {
          return '<div class="item row between"><b>' + esc(names[r.user_id] || 'Mitglied') +
            '</b><span class="pill">' + (r.role === 'owner' ? 'Ersteller' : 'Mitglied') + '</span></div>';
        }).join('')
      : '<div class="muted">Noch keine Mitglieder.</div>';
  }

  /* ---------- Spielabend ---------- */

  async function loadGame() {
    if (!activeGroup) return;
    var res = await sb.from('game_days').select('*')
      .eq('group_id', activeGroup.id).eq('status', 'active')
      .order('started_at', { ascending: false }).limit(1);
    if (res.error) { toast(germanError(res.error)); return; }

    activeGame = res.data && res.data.length ? res.data[0] : null;

    if (!activeGame) { gamePlayers = []; rounds = []; scores = []; renderGame(); return; }

    var both = await Promise.all([
      sb.from('game_players').select('player_id, position, players(id, name)').eq('game_day_id', activeGame.id).order('position'),
      sb.from('rounds').select('*').eq('game_day_id', activeGame.id).order('round_number')
    ]);
    if (both[0].error) { toast(germanError(both[0].error)); return; }
    if (both[1].error) { toast(germanError(both[1].error)); return; }

    gamePlayers = both[0].data || [];
    rounds = both[1].data || [];

    var ids = rounds.map(function (r) { return r.id; });
    if (ids.length) {
      var sr = await sb.from('round_scores').select('*').in('round_id', ids);
      if (sr.error) { toast(germanError(sr.error)); return; }
      scores = sr.data || [];
    } else {
      scores = [];
    }
    renderGame();
  }

  function renderGame() {
    var focused = document.activeElement && document.activeElement.classList && document.activeElement.classList.contains('score')
      ? { r: document.activeElement.dataset.round, p: document.activeElement.dataset.player }
      : null;

    $('#newGame').classList.toggle('hidden', !!activeGame);
    $('#finish').classList.toggle('hidden', !activeGame);

    if (!activeGame) {
      $('#gameMeta').innerHTML = '<div class="notice">Kein aktiver Spielabend. Tippe auf „Neuen Abend starten“.</div>';
      $('#scoreArea').innerHTML = '';
      $('#summary').innerHTML = '<span class="muted">Kein aktiver Spielabend.</span>';
      return;
    }

    $('#gameMeta').innerHTML = '<div class="muted">Spielabend vom ' + dateDe(activeGame.game_date) +
      ' · Zahl eingeben und mit Enter bestätigen</div>';

    var h = '<div class="tablewrap"><table><tr><th>Runde</th>' +
      gamePlayers.map(function (gp) { return '<th>' + esc(gp.players ? gp.players.name : '?') + '</th>'; }).join('') + '</tr>';

    rounds.forEach(function (r) {
      h += '<tr><td>' + r.round_number + '</td>';
      gamePlayers.forEach(function (gp) {
        var s = scoreOf(r.id, gp.player_id);
        var v = s && s.points != null ? s.points : '';
        h += '<td><input class="score' + (v === '' ? ' open' : '') + '" type="number" inputmode="numeric" enterkeyhint="next" min="0" step="1" value="' +
          v + '" data-round="' + r.id + '" data-player="' + gp.player_id + '"></td>';
      });
      h += '</tr>';
    });

    var t = totals();
    h += '<tr class="total"><td>Gesamt</td>' + t.map(function (x) { return '<td>' + x + '</td>'; }).join('') + '</tr>';
    h += '<tr class="cash"><td>Kasse</td>' + t.map(function (x) { return '<td>' + eur(x / 30) + '</td>'; }).join('') + '</tr>';
    h += '</table></div>';
    $('#scoreArea').innerHTML = h;

    renderSummary();

    if (focused) {
      var el = document.querySelector('.score[data-round="' + focused.r + '"][data-player="' + focused.p + '"]');
      if (el) el.focus();
    }
  }

  function renderSummary() {
    var t = totals();
    var sum = t.reduce(function (a, b) { return a + b; }, 0);
    var max = Math.max.apply(null, [1].concat(t));
    $('#summary').innerHTML = gamePlayers.map(function (gp, i) {
      var pct = sum ? (t[i] / sum * 100) : 0;
      return '<div class="bar"><b>' + esc(gp.players ? gp.players.name : '?') + '<br><small class="muted">' +
        pct.toFixed(1).replace('.', ',') + ' %</small></b><div class="track"><div class="fill" style="width:' +
        (t[i] / max * 100) + '%"></div></div><b>' + t[i] + ' · ' + eur(t[i] / 30) + '</b></div>';
    }).join('') +
      '<div class="item row between"><b>Gesamtkasse heute</b><b class="green">' + eur(sum / 30) + '</b></div>';
  }

  async function startGame() {
    if (!activeGroup || activeGame) return;
    if (!confirm('Neuen UNO-Abend mit allen Gruppenmitgliedern starten?')) return;
    var btn = $('#newGame');
    setBusy(btn, true);
    var res = await sb.rpc('start_game_day', { p_group_id: activeGroup.id, p_game_date: today() });
    setBusy(btn, false);
    if (res.error) { toast(germanError(res.error)); return; }
    await loadGame();
    var first = document.querySelector('.score');
    if (first) first.focus();
    toast('Spielabend gestartet.');
  }

  async function saveScore(el, advance) {
    if (!session || !activeGame) return;
    var raw = el.value.trim();
    var points = null;
    if (raw !== '') {
      var n = Number(raw);
      if (!isFinite(n) || n < 0) { toast('Bitte eine Zahl ab 0 eingeben.'); return; }
      points = Math.round(n);
      el.value = String(points);
    }
    var roundId = el.dataset.round, playerId = el.dataset.player;

    // Lokalen Stand sofort aktualisieren
    var s = scoreOf(roundId, playerId);
    if (s) s.points = points; else scores.push({ round_id: roundId, player_id: playerId, points: points });
    el.classList.toggle('open', points == null);
    renderSummaryAndTotals();

    var res = await sb.from('round_scores').upsert(
      { round_id: roundId, player_id: playerId, points: points, updated_by: session.user.id, updated_at: new Date().toISOString() },
      { onConflict: 'round_id,player_id' }
    );
    if (res.error) { toast(germanError(res.error)); return; }

    if (!advance) return;

    var row = el.closest('tr');
    var rowInputs = row ? Array.prototype.slice.call(row.querySelectorAll('.score')) : [];
    var idx = rowInputs.indexOf(el);

    if (idx > -1 && idx < rowInputs.length - 1) { rowInputs[idx + 1].focus(); rowInputs[idx + 1].select(); return; }

    var firstOpen = rowInputs.filter(function (i) { return i.value.trim() === ''; })[0];
    if (firstOpen) { firstOpen.focus(); toast('Bitte offene Eingabe ergänzen.'); return; }

    var lastRound = rounds[rounds.length - 1];
    if (lastRound && lastRound.id === roundId) {
      await appendRound();
    } else {
      var all = $$('.score');
      var pos = all.indexOf(el);
      if (all[pos + 1]) all[pos + 1].focus();
    }
  }

  function renderSummaryAndTotals() {
    var t = totals();
    $$('.total td').slice(1).forEach(function (td, i) { td.textContent = t[i]; });
    $$('.cash td').slice(1).forEach(function (td, i) { td.textContent = eur(t[i] / 30); });
    renderSummary();
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
    if (!activeGame) return;
    if (!confirm('Spielabend jetzt beenden und in die Historie übernehmen?')) return;
    var btn = $('#finish');
    setBusy(btn, true);
    var res = await sb.rpc('finish_game_day', { p_game_day_id: activeGame.id });
    setBusy(btn, false);
    if (res.error) { toast(germanError(res.error)); return; }
    await Promise.all([loadGame(), loadHistory()]);
    toast('Spielabend gespeichert.');
  }

  /* ---------- Historie & Kasse ---------- */

  async function loadHistory() {
    if (!activeGroup) return;
    var res = await sb.from('game_day_results').select('*').eq('group_id', activeGroup.id).order('game_date', { ascending: false });
    if (res.error) { toast(germanError(res.error)); return; }
    var rows = res.data || [];

    var byDay = {}, order = [];
    rows.forEach(function (r) {
      if (!byDay[r.game_day_id]) { byDay[r.game_day_id] = { date: r.game_date, list: [] }; order.push(r.game_day_id); }
      byDay[r.game_day_id].list.push(r);
    });

    $('#historyList').innerHTML = order.length
      ? order.map(function (id) {
          var d = byDay[id];
          var sum = d.list.reduce(function (a, r) { return a + Number(r.cash_amount || 0); }, 0);
          return '<div class="item"><div class="row between"><b>' + dateDe(d.date) + '</b><b class="green">' + eur(sum) + '</b></div>' +
            d.list.map(function (r) {
              return '<div class="row between muted"><span>' + (r.is_winner ? '🏆 ' : '') + (r.is_loser ? '📉 ' : '') + esc(r.player_name) +
                '</span><span>' + r.total_points + ' Pkt · ' + eur(r.cash_amount) + '</span></div>';
            }).join('') + '</div>';
        }).join('')
      : '<div class="muted">Noch keine abgeschlossenen Spielabende.</div>';

    var agg = {};
    rows.forEach(function (r) {
      if (!agg[r.player_name]) agg[r.player_name] = { win: 0, loss: 0, cash: 0 };
      agg[r.player_name].cash += Number(r.cash_amount) || 0;
      if (r.is_winner) agg[r.player_name].win++;
      if (r.is_loser) agg[r.player_name].loss++;
    });
    var e = Object.keys(agg).map(function (k) { return [k, agg[k]]; });

    function list(key) {
      var sorted = e.slice().sort(function (a, b) { return b[1][key] - a[1][key]; });
      return sorted.length
        ? sorted.map(function (x) { return '<div class="row between item"><span>' + esc(x[0]) + '</span><b>' + x[1][key] + '×</b></div>'; }).join('')
        : '<div class="muted">Noch keine Daten.</div>';
    }

    $('#historyStats').innerHTML =
      '<div class="card"><h3>🏆 Siege (wenigste Punkte)</h3>' + list('win') + '</div>' +
      '<div class="card"><h3>📉 Niederlagen (meiste Punkte)</h3>' + list('loss') + '</div>';

    var total = e.reduce(function (a, x) { return a + x[1].cash; }, 0);
    var max = Math.max.apply(null, [1].concat(e.map(function (x) { return x[1].cash; })));
    $('#bankStats').innerHTML =
      '<div class="stat">Gesamtkasse<b class="green">' + eur(total) + '</b></div>' +
      '<div class="stat">Spielabende<b>' + order.length + '</b></div>' +
      '<div class="stat">Spieler<b>' + e.length + '</b></div>';
    $('#bankBars').innerHTML = e.length
      ? e.sort(function (a, b) { return b[1].cash - a[1].cash; }).map(function (x) {
          return '<div class="bar"><b>' + esc(x[0]) + '</b><div class="track"><div class="fill" style="width:' +
            (x[1].cash / max * 100) + '%"></div></div><b>' + eur(x[1].cash) + '</b></div>';
        }).join('')
      : '<div class="muted">Noch keine Einzahlungen.</div>';
  }

  /* ---------- Live-Synchronisierung ---------- */

  function scheduleReload(withHistory) {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(function () {
      if (appendingRound) return;
      loadGame();
      if (withHistory) loadHistory();
    }, 400);
  }

  function subscribe() {
    if (!activeGroup) return;
    if (channel) sb.removeChannel(channel);
    channel = sb.channel('uno-' + activeGroup.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'round_scores' }, function () { scheduleReload(false); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rounds' }, function () { scheduleReload(false); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_days', filter: 'group_id=eq.' + activeGroup.id }, function () { scheduleReload(true); })
      .subscribe();
  }

  /* ---------- Los geht's ---------- */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main);
  } else {
    main();
  }
})();
