import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const configured =
  !SUPABASE_URL.startsWith('DEINE_') &&
  !SUPABASE_ANON_KEY.startsWith('DEIN_');

const supabase = configured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

const eur = n =>
  new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR'
  }).format(Number(n) || 0);

const today = () => new Date().toISOString().slice(0, 10);

let session = null;
let groups = [];
let activeGroup = null;
let members = [];
let activeGame = null;
let gamePlayers = [];
let rounds = [];
let scores = [];
let channel = null;
let busy = false;

const toast = text => {
  const element = $('#toast');

  if (!element) return;

  element.textContent = text;
  element.classList.add('on');

  clearTimeout(element.toastTimer);

  element.toastTimer = setTimeout(() => {
    element.classList.remove('on');
  }, 1800);
};

const show = (selector, visible = true) => {
  const element = $(selector);

  if (element) {
    element.classList.toggle('hidden', !visible);
  }
};

const totals = () =>
  gamePlayers.map(gamePlayer =>
    scores
      .filter(score => score.player_id === gamePlayer.player_id)
      .reduce((sum, score) => sum + (score.points ?? 0), 0)
  );

if (!configured) {
  show('#setupNotice');

  $('#setupNotice').innerHTML =
    '<b>Einrichtung erforderlich:</b> Trage in <code>config.js</code> die Supabase Project URL und den Publishable Key ein.';
}

async function boot() {
  if (!configured) return;

  const { data, error } = await supabase.auth.getSession();

  if (error) {
    toast(error.message);
    return;
  }

  session = data.session;

  applySession();

  supabase.auth.onAuthStateChange((_event, newSession) => {
    session = newSession;
    applySession();
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('./service-worker.js')
        .catch(error => console.error('Service Worker:', error));
    });
  }
}

function applySession() {
  show('#auth', !session);
  show('#userBox', !!session);

  if ($('#userEmail')) {
    $('#userEmail').textContent = session?.user?.email || '';
  }

  if (session) {
    loadGroups();
  } else {
    show('#groupArea', false);
    show('#main', false);
  }
}

/* =========================================================
   REGISTRIERUNG / LOGIN
========================================================= */

$('#signup').onclick = async () => {
  const name = $('#signupName').value.trim();
  const email = $('#signupEmail').value.trim();
  const password = $('#signupPassword').value;

  if (!name || !email || password.length < 8) {
    toast('Name, E-Mail und mindestens 8 Zeichen Passwort eingeben.');
    return;
  }

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        display_name: name
      }
    }
  });

  if (error) {
    toast(error.message);
  } else {
    toast('Registrierung angelegt. Bitte E-Mail-Bestätigung prüfen.');
  }
};

$('#login').onclick = async () => {
  const email = $('#loginEmail').value.trim();
  const password = $('#loginPassword').value;

  if (!email || !password) {
    toast('Bitte E-Mail und Passwort eingeben.');
    return;
  }

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    toast(error.message);
  }
};

$('#logout').onclick = async () => {
  if (channel) {
    await supabase.removeChannel(channel);
    channel = null;
  }

  activeGroup = null;
  await supabase.auth.signOut();
};

/* =========================================================
   GRUPPEN
========================================================= */

async function loadGroups() {
  const { data, error } = await supabase
    .from('group_members')
    .select('group_id,role,groups(id,name,invite_code)')
    .order('joined_at');

  if (error) {
    toast(error.message);
    return;
  }

  groups = (data || [])
    .filter(item => item.groups)
    .map(item => ({
      ...item.groups,
      role: item.role
    }));

  show('#groupArea', true);

  $('#groups').innerHTML = groups.length
    ? groups
        .map(
          group =>
            `<button class="ghost" data-g="${group.id}">
              ${group.name} · ${group.role}
            </button>`
        )
        .join(' ')
    : '<span class="muted">Noch keine Gruppe vorhanden.</span>';

  $('#groups').onclick = event => {
    const id = event.target.dataset.g;

    if (!id) return;

    const group = groups.find(item => item.id === id);

    if (group) {
      selectGroup(group);
    }
  };
}

$('#createGroup').onclick = async () => {
  const name = $('#groupName').value.trim();

  if (!name) {
    toast('Bitte einen Gruppennamen eingeben.');
    return;
  }

  const { data, error } = await supabase.rpc('create_group', {
    p_name: name
  });

  if (error) {
    toast(error.message);
    return;
  }

  $('#groupName').value = '';

  await loadGroups();

  const group = groups.find(item => item.id === data);

  if (group) {
    selectGroup(group);
  }
};

$('#joinGroup').onclick = async () => {
  const code = $('#joinCode').value.trim().toUpperCase();

  if (!code) {
    toast('Bitte Einladungscode eingeben.');
    return;
  }

  const { data, error } = await supabase.rpc('join_group', {
    p_invite_code: code
  });

  if (error) {
    toast(error.message);
    return;
  }

  $('#joinCode').value = '';

  await loadGroups();

  const group = groups.find(item => item.id === data);

  if (group) {
    selectGroup(group);
  }
};

async function selectGroup(group) {
  activeGroup = group;

  show('#groupArea', false);
  show('#main', true);

  $('#activeGroupName').textContent = group.name;
  $('#activeCode').textContent = group.invite_code;

  await Promise.all([
    loadMembers(),
    loadGame(),
    loadHistory()
  ]);

  subscribe();
}

$('#changeGroup').onclick = async () => {
  show('#main', false);
  show('#groupArea', true);

  activeGroup = null;

  if (channel) {
    await supabase.removeChannel(channel);
    channel = null;
  }
};

/* =========================================================
   MITGLIEDER
========================================================= */

async function loadMembers() {
  if (!activeGroup) return;

  const { data, error } = await supabase
    .from('group_members')
    .select('user_id,role,profiles(display_name)')
    .eq('group_id', activeGroup.id)
    .order('joined_at');

  if (error) {
    toast(error.message);
    return;
  }

  members = data || [];

  $('#memberList').innerHTML = members.length
    ? members
        .map(
          member =>
            `<div class="item row between">
              <b>${member.profiles?.display_name || 'Mitglied'}</b>
              <span class="pill">${member.role}</span>
            </div>`
        )
        .join('')
    : '<div class="muted">Noch keine Mitglieder.</div>';
}

/* =========================================================
   AKTUELLER SPIELABEND
========================================================= */

async function loadGame() {
  if (!activeGroup) return;

  const { data, error } = await supabase
    .from('game_days')
    .select('*')
    .eq('group_id', activeGroup.id)
    .eq('status', 'active')
    .maybeSingle();

  if (error) {
    toast(error.message);
    return;
  }

  activeGame = data || null;

  if (!activeGame) {
    gamePlayers = [];
    rounds = [];
    scores = [];

    renderGame();
    return;
  }

  const [gamePlayersResult, roundsResult] = await Promise.all([
    supabase
      .from('game_players')
      .select('*,players(id,name)')
      .eq('game_day_id', activeGame.id)
      .order('position'),

    supabase
      .from('rounds')
      .select('*')
      .eq('game_day_id', activeGame.id)
      .order('round_number')
  ]);

  if (gamePlayersResult.error) {
    toast(gamePlayersResult.error.message);
    return;
  }

  if (roundsResult.error) {
    toast(roundsResult.error.message);
    return;
  }

  gamePlayers = gamePlayersResult.data || [];
  rounds = roundsResult.data || [];

  const roundIds = rounds.map(round => round.id);

  if (roundIds.length) {
    const { data: scoreData, error: scoreError } = await supabase
      .from('round_scores')
      .select('*')
      .in('round_id', roundIds);

    if (scoreError) {
      toast(scoreError.message);
      return;
    }

    scores = scoreData || [];
  } else {
    scores = [];
  }

  renderGame();
}

function renderGame() {
  if (!activeGame) {
    $('#gameMeta').innerHTML =
      '<div class="notice">Kein aktiver Spielabend.</div>';

    $('#gamePlayers').innerHTML = '';
    $('#scoreArea').innerHTML = '';
    $('#summary').innerHTML = '';

    return;
  }

  $('#gameMeta').innerHTML =
    `<div class="muted">
      ${activeGame.game_date} · Status: ${activeGame.status}
    </div>`;

  $('#gamePlayers').innerHTML = gamePlayers
    .map(
      gamePlayer =>
        `<span class="pill">${gamePlayer.players.name}</span>`
    )
    .join('');

  let html =
    '<div class="table"><table>' +
    '<tr><th>Runde</th>' +
    gamePlayers
      .map(gamePlayer => `<th>${gamePlayer.players.name}</th>`)
      .join('') +
    '</tr>';

  rounds.forEach(round => {
    html += `<tr><td>${round.round_number}</td>`;

    gamePlayers.forEach(gamePlayer => {
      const score = scores.find(
        item =>
          item.round_id === round.id &&
          item.player_id === gamePlayer.player_id
      );

      html += `
        <td>
          <input
            class="score${score?.points == null ? ' open' : ''}"
            inputmode="numeric"
            enterkeyhint="next"
            type="number"
            min="0"
            value="${score?.points ?? ''}"
            data-round="${round.id}"
            data-player="${gamePlayer.player_id}"
          >
        </td>
      `;
    });

    html += '</tr>';
  });

  const playerTotals = totals();

  html +=
    `<tr class="total">
      <td>Gesamt</td>
      ${playerTotals.map(value => `<td>${value}</td>`).join('')}
    </tr>`;

  html +=
    `<tr class="cash">
      <td>Kasse</td>
      ${playerTotals.map(value => `<td>${eur(value / 30)}</td>`).join('')}
    </tr>`;

  html += '</table></div>';

  $('#scoreArea').innerHTML = html;

  renderSummary();
}

function renderSummary() {
  const playerTotals = totals();
  const totalPoints = playerTotals.reduce((sum, value) => sum + value, 0);
  const maxPoints = Math.max(1, ...playerTotals);

  $('#summary').innerHTML =
    gamePlayers
      .map((gamePlayer, index) => {
        const percentage = totalPoints
          ? (playerTotals[index] / totalPoints) * 100
          : 0;

        return `
          <div class="bar">
            <b>
              ${gamePlayer.players.name}
              <br>
              <small>${percentage.toFixed(1)}%</small>
            </b>

            <div class="track">
              <div
                class="fill"
                style="width:${(playerTotals[index] / maxPoints) * 100}%">
              </div>
            </div>

            <b>
              ${playerTotals[index]} ·
              ${eur(playerTotals[index] / 30)}
            </b>
          </div>
        `;
      })
      .join('') +
    `
      <div class="item row between">
        <b>Gesamtkasse</b>
        <b class="green">${eur(totalPoints / 30)}</b>
      </div>
    `;
}

/* =========================================================
   SPIELABEND STARTEN
========================================================= */

$('#newGame').onclick = () => {
  if (activeGame) {
    toast('Es gibt bereits einen aktiven Spielabend.');
    return;
  }

  $('#modal').innerHTML = `
    <h2>Neuen UNO-Abend starten</h2>
    <p>Mit allen aktuellen Gruppenmitgliedern starten?</p>

    <div class="row">
      <button id="confirmNew" class="primary">Starten</button>
      <button id="close">Abbrechen</button>
    </div>
  `;

  $('#modalbg').classList.add('on');

  $('#close').onclick = () =>
    $('#modalbg').classList.remove('on');

  $('#confirmNew').onclick = startGame;
};

async function startGame() {
  if (busy || !activeGroup) return;

  busy = true;

  const { error } = await supabase.rpc('start_game_day', {
    p_group_id: activeGroup.id,
    p_game_date: today()
  });

  busy = false;

  $('#modalbg').classList.remove('on');

  if (error) {
    toast(error.message);
    return;
  }

  await loadGame();

  toast('Spielabend gestartet.');
}

/* =========================================================
   PUNKTEEINGABE
========================================================= */

$('#scoreArea').addEventListener('keydown', async event => {
  if (!event.target.classList.contains('score')) return;
  if (event.key !== 'Enter' && event.key !== 'Tab') return;

  event.preventDefault();

  await saveScore(event.target, true);
});

$('#scoreArea').addEventListener(
  'blur',
  event => {
    if (event.target.classList.contains('score')) {
      saveScore(event.target, false);
    }
  },
  true
);

async function saveScore(element, advance) {
  if (!session || !activeGame) return;

  const rawValue = element.value.trim();

  let points = null;

  if (rawValue !== '') {
    const numericValue = Number(rawValue);

    if (!Number.isFinite(numericValue) || numericValue < 0) {
      toast('Bitte eine gültige Punktzahl ab 0 eingeben.');
      return;
    }

    points = Math.round(numericValue);
    element.value = String(points);
  }

  const { error } = await supabase
    .from('round_scores')
    .upsert(
      {
        round_id: element.dataset.round,
        player_id: element.dataset.player,
        points,
        updated_by: session.user.id
      },
      {
        onConflict: 'round_id,player_id'
      }
    );

  if (error) {
    toast(error.message);
    return;
  }

  if (!advance) {
    return;
  }

  const inputs = $$('.score');
  const currentIndex = inputs.indexOf(element);

  if (currentIndex < 0) return;

  const row = element.closest('tr');
  const rowInputs = row
    ? [...row.querySelectorAll('.score')]
    : [];

  const currentRowComplete = rowInputs.every(
    input => input.value.trim() !== ''
  );

  const isLastInputInRow =
    rowInputs.length &&
    element === rowInputs[rowInputs.length - 1];

  const isLastInputOverall =
    currentIndex === inputs.length - 1;

  if (isLastInputInRow && currentRowComplete && isLastInputOverall) {
    const { error: appendError } = await supabase.rpc('append_round', {
      p_game_day_id: activeGame.id
    });

    if (appendError) {
      toast(appendError.message);
      return;
    }

    await loadGame();

    const newInputs = $$('.score');

    if (newInputs.length) {
      newInputs[newInputs.length - gamePlayers.length]?.focus();
    }

    return;
  }

  if (currentIndex < inputs.length - 1) {
    inputs[currentIndex + 1].focus();
  }
}

/* =========================================================
   SPIELABEND BEENDEN
========================================================= */

$('#finish').onclick = async () => {
  if (!activeGame) {
    toast('Kein aktiver Spielabend.');
    return;
  }

  const { error } = await supabase.rpc('finish_game_day', {
    p_game_day_id: activeGame.id
  });

  if (error) {
    toast(error.message);
    return;
  }

  await Promise.all([
    loadGame(),
    loadHistory()
  ]);

  toast('Spielabend abgeschlossen.');
};

/* =========================================================
   HISTORIE / RANGLISTE / KASSE
========================================================= */

async function loadHistory() {
  if (!activeGroup) return;

  const { data, error } = await supabase
    .from('game_day_results')
    .select('*')
    .eq('group_id', activeGroup.id)
    .order('game_date', {
      ascending: false
    });

  if (error) {
    toast(error.message);
    return;
  }

  const rows = data || [];

  $('#historyList').innerHTML = rows.length
    ? rows
        .map(
          result =>
            `<div class="item">
              <b>${result.game_date}</b> ·
              ${result.player_name}:
              ${result.total_points} Punkte ·
              ${eur(result.cash_amount)}
            </div>`
        )
        .join('')
    : '<div class="muted">Noch keine Einträge.</div>';

  const aggregate = {};

  rows.forEach(result => {
    if (!aggregate[result.player_name]) {
      aggregate[result.player_name] = {
        win: 0,
        loss: 0,
        cash: 0
      };
    }

    aggregate[result.player_name].cash +=
      Number(result.cash_amount) || 0;

    if (result.is_winner) {
      aggregate[result.player_name].win++;
    }

    if (result.is_loser) {
      aggregate[result.player_name].loss++;
    }
  });

  const entries = Object.entries(aggregate);

  const wins = [...entries].sort(
    (a, b) => b[1].win - a[1].win
  );

  const losses = [...entries].sort(
    (a, b) => b[1].loss - a[1].loss
  );

  $('#historyStats').innerHTML = `
    <div class="card">
      <h3>🏆 Siege</h3>

      ${wins
        .map(
          ([name, value]) =>
            `<div class="row between">
              <span>${name}</span>
              <b>${value.win}×</b>
            </div>`
        )
        .join('')}
    </div>

    <div class="card">
      <h3>📉 Niederlagen</h3>

      ${losses
        .map(
          ([name, value]) =>
            `<div class="row between">
              <span>${name}</span>
              <b>${value.loss}×</b>
            </div>`
        )
        .join('')}
    </div>
  `;

  const totalCash = entries.reduce(
    (sum, entry) => sum + entry[1].cash,
    0
  );

  const maxCash = Math.max(
    1,
    ...entries.map(entry => entry[1].cash)
  );

  $('#bankStats').innerHTML = `
    <div class="stat">
      Gesamtkasse
      <b class="green">${eur(totalCash)}</b>
    </div>

    <div class="stat">
      Spieler
      <b>${entries.length}</b>
    </div>

    <div class="stat">
      Ergebnisse
      <b>${rows.length}</b>
    </div>
  `;

  $('#bankBars').innerHTML = entries
    .map(
      ([name, value]) =>
        `<div class="bar">
          <b>${name}</b>

          <div class="track">
            <div
              class="fill"
              style="width:${(value.cash / maxCash) * 100}%">
            </div>
          </div>

          <b>${eur(value.cash)}</b>
        </div>`
    )
    .join('');
}

/* =========================================================
   REALTIME
========================================================= */

function subscribe() {
  if (!activeGroup) return;

  if (channel) {
    supabase.removeChannel(channel);
  }

  channel = supabase
    .channel(`group-${activeGroup.id}`)

    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'round_scores'
      },
      () => loadGame()
    )

    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'rounds'
      },
      () => loadGame()
    )

    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'game_days',
        filter: `group_id=eq.${activeGroup.id}`
      },
      () =>
        Promise.all([
          loadGame(),
          loadHistory()
        ])
    )

    .subscribe();
}

/* =========================================================
   NAVIGATION
========================================================= */

$$('nav button').forEach(button => {
  button.onclick = () => {
    
    $$('nav button').forEach(item => {
item.classList.toggle('on', item === button);
    });

    $$('.view').forEach(view => {
      view.classList.toggle(
        'on',
        view.id === button.dataset.v
      );
    });
  };
});

/* =========================================================
   APP STARTEN
========================================================= */

boot();

})();
