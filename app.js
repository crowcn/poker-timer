// ============================================================
// app.js — Poker Timer 主逻辑
// ============================================================

const DEFAULT_BLINDS = [
  [100, 200, 0, 8], [200, 400, 0, 8], [300, 600, 0, 8],
  [400, 800, 0, 8], [500, 1000, 100, 8], [700, 1400, 200, 8],
  [1000, 2000, 300, 8], [1500, 3000, 400, 8], [2000, 4000, 500, 8],
  [3000, 6000, 1000, 8], [5000, 10000, 1000, 8], [10000, 20000, 2000, 8]
];

const PRIZE_RATIOS = {
  'winner-takes-all': [100],
  top2: [70, 30],
  'top3-50': [50, 30, 20],
  'top3-60': [60, 25, 15]
};

const state = {
  view: 'setup',
  config: {
    name: '友谊赛', buyin: 10000, mushrooms: 3, mushroomCutoff: 0,
    prizeMode: 'top3-50', customPrize: [50, 30, 20], blinds: []
  },
  players: [],
  levelIndex: 0,
  levelStartedAt: 0,
  levelElapsedBeforeRun: 0,
  elapsedBeforeRun: 0,
  gameStartedAt: 0,
  lastTick: 0,
  running: false,
  warningPlayed: false,
  mushroomsUsed: 0,
  events: [],
  tournamentId: null,
  endReason: null,
  settlement: null
};

let animationFrame = null;
let modalAction = null;

function cloneBlinds(rows = DEFAULT_BLINDS) {
  return rows.map(row => ({ sb: Number(row[0] ?? row.sb), bb: Number(row[1] ?? row.bb), ante: Number(row[2] ?? row.ante), minutes: Number(row[3] ?? row.minutes) }));
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('zh-CN');
}

function formatDuration(seconds) {
  seconds = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatShortDuration(seconds) {
  seconds = Math.max(0, Math.floor(seconds || 0));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function elapsedSeconds() {
  if (!state.gameStartedAt) return state.elapsedBeforeRun;
  return state.elapsedBeforeRun + (state.running ? (Date.now() - state.levelStartedAt) / 1000 : 0);
}

function currentLevelElapsedSeconds() {
  if (!state.levelStartedAt) return state.levelElapsedBeforeRun || 0;
  return (state.levelElapsedBeforeRun || 0) + (state.running ? (Date.now() - state.levelStartedAt) / 1000 : 0);
}

function levelRows() {
  return state.config.blinds;
}

function currentLevel() {
  const rows = levelRows();
  if (state.levelIndex < rows.length) return rows[state.levelIndex];
  const last = rows[rows.length - 1] || { sb: 100, bb: 200, ante: 0, minutes: 8 };
  const extra = state.levelIndex - rows.length + 1;
  const multiplier = 2 ** extra;
  const anteRatio = last.sb ? last.ante / last.sb : 0;
  return { sb: last.sb * multiplier, bb: last.bb * multiplier, ante: Math.round(last.sb * multiplier * anteRatio), minutes: last.minutes, generated: true };
}

function levelLabel() {
  return state.levelIndex < levelRows().length ? `LEVEL ${state.levelIndex + 1}` : `LEVEL ${state.levelIndex + 1}+`;
}

function currentLevelDuration() {
  return currentLevel().minutes * 60;
}

function remainingLevelSeconds() {
  return Math.max(0, currentLevelDuration() - currentLevelElapsedSeconds());
}

function inGamePlayers() {
  return state.players.filter(player => player.inGame);
}

function totalChips() {
  return state.config.buyin * (state.players.length + state.mushroomsUsed);
}

function addEvent(type, detail) {
  state.events.push({ time: Math.floor(elapsedSeconds()), level: state.levelIndex + 1, type, detail });
  persistProgress();
}

function persistProgress() {
  if (state.view === 'game') {
    const snapshot = JSON.parse(JSON.stringify(state));
    snapshot.running = false;
    snapshot.elapsedBeforeRun = elapsedSeconds();
    snapshot.levelElapsedBeforeRun = currentLevelElapsedSeconds();
    snapshot.levelStartedAt = 0;
    saveProgress(snapshot);
  }
}

function showView(name) {
  document.querySelectorAll('.view').forEach(view => view.classList.remove('active'));
  const target = document.getElementById(`view-${name}`);
  if (target) target.classList.add('active');
  state.view = name;
}

function initSetup() {
  state.config.blinds = cloneBlinds();
  renderBlindTable();
  renderPlayers();
  syncConfigInputs();
  bindTabs();
  bindPrizeOptions();
  showView('setup');
}

function bindTabs() {
  document.querySelectorAll('.tab-btn').forEach(button => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(item => item.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(item => item.classList.remove('active'));
      button.classList.add('active');
      document.getElementById(button.dataset.tab)?.classList.add('active');
    });
  });
}

function bindPrizeOptions() {
  document.querySelectorAll('input[name="prize-mode"]').forEach(input => {
    input.addEventListener('change', () => {
      state.config.prizeMode = input.value;
      document.querySelectorAll('.prize-option').forEach(option => option.classList.toggle('selected', option.querySelector('input').checked));
      document.getElementById('custom-prize')?.classList.toggle('visible', input.value === 'custom');
    });
  });
}

function syncConfigInputs() {
  document.getElementById('cfg-name').value = state.config.name;
  document.getElementById('cfg-buyin').value = state.config.buyin;
  document.getElementById('cfg-mushrooms').value = state.config.mushrooms;
  document.getElementById('cfg-mushroom-cutoff').value = state.config.mushroomCutoff;
  const radio = document.querySelector(`input[name="prize-mode"][value="${state.config.prizeMode}"]`);
  if (radio) radio.checked = true;
  document.querySelectorAll('.prize-option').forEach(option => option.classList.toggle('selected', option.querySelector('input').checked));
  document.getElementById('custom-prize')?.classList.toggle('visible', state.config.prizeMode === 'custom');
}

function readConfig() {
  state.config.name = document.getElementById('cfg-name').value.trim() || '友谊赛';
  state.config.buyin = Math.max(100, Number(document.getElementById('cfg-buyin').value) || 10000);
  state.config.mushrooms = Math.max(0, Number(document.getElementById('cfg-mushrooms').value) || 0);
  state.config.mushroomCutoff = Math.max(0, Number(document.getElementById('cfg-mushroom-cutoff').value) || 0);
  state.config.prizeMode = document.querySelector('input[name="prize-mode"]:checked')?.value || 'top3-50';
  state.config.customPrize = [1, 2, 3].map(i => Math.max(0, Number(document.getElementById(`custom-p${i}`).value) || 0));
  state.config.blinds = Array.from(document.querySelectorAll('#blind-table-body tr')).map(row => {
    const values = Array.from(row.querySelectorAll('input')).map(input => Math.max(0, Number(input.value) || 0));
    return { sb: values[0] || 100, bb: values[1] || 200, ante: values[2] || 0, minutes: values[3] || 8 };
  });
}

function renderBlindTable() {
  const body = document.getElementById('blind-table-body');
  if (!body) return;
  body.innerHTML = state.config.blinds.map((level, index) => `
    <tr>
      <td class="level-num">${index + 1}</td>
      <td><input type="number" min="0" step="100" value="${level.sb}" aria-label="第${index + 1}级小盲"></td>
      <td><input type="number" min="0" step="100" value="${level.bb}" aria-label="第${index + 1}级大盲"></td>
      <td><input type="number" min="0" step="100" value="${level.ante}" aria-label="第${index + 1}级Ante"></td>
      <td><input type="number" min="1" step="1" value="${level.minutes}" aria-label="第${index + 1}级时长"></td>
      <td><button class="btn btn-ghost btn-sm" onclick="deleteBlindLevel(${index})" aria-label="删除第${index + 1}级">✕</button></td>
    </tr>`).join('');
}

function addBlindLevel() {
  readConfig();
  const last = state.config.blinds[state.config.blinds.length - 1] || { sb: 100, bb: 200, ante: 0, minutes: 8 };
  state.config.blinds.push({ sb: last.sb * 2, bb: last.bb * 2, ante: last.ante * 2, minutes: last.minutes });
  renderBlindTable();
}

function deleteBlindLevel(index) {
  readConfig();
  if (state.config.blinds.length <= 1) return;
  state.config.blinds.splice(index, 1);
  renderBlindTable();
}

function resetBlinds() {
  state.config.blinds = cloneBlinds();
  renderBlindTable();
}

function renderPlayers() {
  const list = document.getElementById('player-list');
  const count = document.getElementById('player-count');
  if (!list) return;
  list.innerHTML = state.players.map((player, index) => `
    <li class="player-item">
      <div class="player-info"><span class="player-number">${index + 1}</span><span class="player-name">${escapeHTML(player.nickname)}</span><span class="player-phone">(${escapeHTML(player.phoneLastFour)})</span>${player.seat ? `<span class="player-seat">座位 ${escapeHTML(player.seat)}</span>` : ''}</div>
      <button class="btn btn-ghost btn-sm" onclick="removeSetupPlayer(${index})">删除</button>
    </li>`).join('');
  count.textContent = `共 ${state.players.length} 人${state.players.length < 2 ? '，至少需要 2 人' : ''}`;
}

async function addPlayerFromForm() {
  const phoneInput = document.getElementById('input-phone');
  const nicknameInput = document.getElementById('input-nickname');
  const seatInput = document.getElementById('input-seat');
  const phone = phoneInput.value.trim();
  if (!/^\d{4}$/.test(phone)) return alert('请输入4位手机尾号');
  if (state.players.some(player => player.phoneLastFour === phone)) return alert('该手机尾号已登记');
  let nickname = nicknameInput.value.trim();
  if (!nickname) {
    const old = await getPlayer(phone).catch(() => null);
    nickname = old?.nickname || '';
  }
  if (!nickname) return alert('请输入昵称');
  const player = { phoneLastFour: phone, nickname, seat: seatInput.value.trim(), inGame: true, eliminatedAt: null, eliminatedLevel: null, mushroomsUsed: 0, eliminationHistory: [] };
  state.players.push(player);
  await addPlayer({ phoneLastFour: phone, nickname, createdAt: Date.now() }).catch(() => {});
  phoneInput.value = ''; nicknameInput.value = ''; seatInput.value = '';
  document.getElementById('player-hint').style.display = 'none';
  renderPlayers();
}

function removeSetupPlayer(index) {
  state.players.splice(index, 1);
  renderPlayers();
}

function loadTemplate(name) {
  const templates = {
    fast: { buyin: 10000, blinds: DEFAULT_BLINDS.slice(0, 8).map(row => [row[0], row[1], row[2], 6]) },
    standard: { buyin: 10000, blinds: DEFAULT_BLINDS },
    deep: { buyin: 20000, blinds: DEFAULT_BLINDS.concat([[15000, 30000, 3000, 10], [20000, 40000, 4000, 10], [30000, 60000, 6000, 10]]).map(row => [row[0], row[1], row[2], 10]) }
  };
  const template = templates[name];
  if (!template) return;
  state.config.buyin = template.buyin;
  state.config.blinds = cloneBlinds(template.blinds);
  syncConfigInputs(); renderBlindTable();
  document.querySelectorAll('.template-card').forEach(card => card.classList.toggle('selected', card.querySelector('h3').textContent.includes(name === 'fast' ? '快速' : name === 'deep' ? '深筹' : '标准')));
}

async function startGame() {
  readConfig();
  if (state.players.length < 2) return alert('至少需要 2 人参赛');
  if (!state.config.blinds.length) return alert('至少需要一个盲注级别');
  state.players.forEach(player => { player.inGame = true; player.eliminatedAt = null; player.eliminatedLevel = null; player.mushroomsUsed = 0; player.eliminationHistory = []; });
  state.levelIndex = 0; state.elapsedBeforeRun = 0; state.levelElapsedBeforeRun = 0; state.gameStartedAt = Date.now(); state.levelStartedAt = Date.now(); state.running = false; state.warningPlayed = false; state.mushroomsUsed = 0; state.events = [];
  state.tournamentId = await generateTournamentId().catch(() => `local-${Date.now()}`);
  state.view = 'game';
  addEvent('start', `比赛开始，${state.players.length}人参赛`);
  showView('game'); updateGameDisplay(); startTicker();
}

function startTicker() {
  if (animationFrame) cancelAnimationFrame(animationFrame);
  const tick = () => { updateGameDisplay(); animationFrame = requestAnimationFrame(tick); };
  animationFrame = requestAnimationFrame(tick);
}

function updateGameDisplay() {
  if (state.view !== 'game') return;
  const level = currentLevel();
  const remaining = remainingLevelSeconds();
  document.getElementById('game-title').textContent = state.config.name;
  document.getElementById('game-level').textContent = levelLabel();
  document.getElementById('game-sb').textContent = formatNumber(level.sb);
  document.getElementById('game-bb').textContent = formatNumber(level.bb);
  document.getElementById('game-countdown').textContent = formatShortDuration(remaining);
  document.getElementById('game-countdown').classList.toggle('warning', remaining <= 30 && state.running);
  document.getElementById('game-elapsed').textContent = formatDuration(elapsedSeconds());
  const next = currentLevelAt(state.levelIndex + 1);
  document.querySelector('#game-next-level span').textContent = `${formatNumber(next.sb)} / ${formatNumber(next.bb)}`;
  const active = inGamePlayers().length;
  document.getElementById('info-players').textContent = active;
  document.getElementById('info-total').textContent = formatNumber(totalChips());
  document.getElementById('info-avg').textContent = formatNumber(active ? Math.floor(totalChips() / active) : 0);
  document.getElementById('info-ante').textContent = level.ante ? formatNumber(level.ante) : '—';
  document.getElementById('info-mushroom').textContent = `${Math.max(0, state.config.mushrooms - state.mushroomsUsed)}/${state.config.mushrooms}`;
  document.getElementById('ctrl-pause').innerHTML = state.running ? '⏸ 暂停 <span class="ctrl-key">空格</span>' : '▶ 开始 <span class="ctrl-key">空格</span>';
  document.getElementById('pause-overlay').classList.toggle('visible', !state.running);
  document.getElementById('ctrl-mushroom').disabled = !canUseMushroom();
  document.getElementById('ctrl-chop').disabled = active > 3;
  renderPrizePreview();
  if (state.running && remaining <= 30 && remaining > 0 && !state.warningPlayed) { playWarning(); state.warningPlayed = true; }
  if (state.running && remaining <= 0) advanceLevel(true);
}

function currentLevelAt(index) {
  const rows = levelRows();
  if (index < rows.length) return rows[index];
  const last = rows[rows.length - 1] || { sb: 100, bb: 200, ante: 0, minutes: 8 };
  const multiplier = 2 ** (index - rows.length + 1);
  return { sb: last.sb * multiplier, bb: last.bb * multiplier, ante: Math.round(last.ante * multiplier), minutes: last.minutes, generated: true };
}

function togglePause() {
  if (state.running) {
    const total = elapsedSeconds();
    const level = currentLevelElapsedSeconds();
    state.elapsedBeforeRun = total;
    state.levelElapsedBeforeRun = level;
    state.running = false;
    state.levelStartedAt = 0;
    addEvent('pause', '暂停倒计时');
  } else {
    state.running = true;
    state.levelStartedAt = Date.now();
    state.warningPlayed = false;
    addEvent('resume', '恢复倒计时');
  }
  updateGameDisplay(); persistProgress();
}

function advanceLevel(automatic = false) {
  if (state.levelIndex < 1000000) state.levelIndex += 1;
  state.levelElapsedBeforeRun = 0; state.levelStartedAt = Date.now(); state.warningPlayed = false;
  if (automatic) { addEvent('level-up', `升级至 ${levelLabel()}`); playLevelUp(); }
  const flash = document.getElementById('level-up-flash');
  flash.classList.remove('visible'); void flash.offsetWidth; flash.classList.add('visible');
  updateGameDisplay(); persistProgress();
}

function nextLevel() { if (state.view === 'game') advanceLevel(false); }
function prevLevel() {
  if (state.levelIndex <= 0) return;
  state.levelIndex -= 1; state.levelElapsedBeforeRun = 0; state.levelStartedAt = Date.now(); state.warningPlayed = false; addEvent('level-down', `返回 ${levelLabel()}`); updateGameDisplay(); persistProgress();
}

function showEliminateModal() { openPlayerActionModal('eliminate'); }
function showMushroomModal() { openPlayerActionModal('mushroom'); }

function canUseMushroom() {
  return state.mushroomsUsed < state.config.mushrooms && (!state.config.mushroomCutoff || state.levelIndex + 1 <= state.config.mushroomCutoff) && state.players.some(player => !player.inGame);
}

function openPlayerActionModal(action) {
  const candidates = state.players.filter(player => action === 'eliminate' ? player.inGame : !player.inGame);
  if (!candidates.length) return alert(action === 'eliminate' ? '当前没有在场玩家' : '当前没有可复活的已淘汰玩家');
  if (action === 'mushroom' && !canUseMushroom()) return alert('当前无法使用蘑菇');
  modalAction = { type: action, phone: candidates[0].phoneLastFour };
  const title = action === 'eliminate' ? '💀 确认淘汰' : '🍄 蘑菇复活';
  const button = action === 'eliminate' ? '确认淘汰' : '确认复活';
  const rows = candidates.map(player => `<li class="modal-player-item ${player.phoneLastFour === modalAction.phone ? 'selected' : ''}" onclick="selectModalPlayer('${player.phoneLastFour}')"><span>${action === 'eliminate' ? '🟢' : '⚫'}</span><b>${escapeHTML(player.nickname)}</b><span class="player-phone">(${escapeHTML(player.phoneLastFour)})</span></li>`).join('');
  document.getElementById('modal-content').innerHTML = `<div class="modal-header">${title}</div><div class="modal-body"><ul class="modal-player-list">${rows}</ul><p class="modal-info" id="modal-action-info"></p></div><div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">取消</button><button class="btn ${action === 'eliminate' ? 'btn-danger' : 'btn-primary'}" onclick="confirmPlayerAction()">${button}</button></div>`;
  document.getElementById('modal-overlay').classList.add('visible'); updateModalInfo();
}

function selectModalPlayer(phone) {
  if (!modalAction) return;
  modalAction.phone = phone;
  document.querySelectorAll('.modal-player-item').forEach(item => {
    const selected = item.querySelector('.player-phone')?.textContent.includes(`(${phone})`);
    item.classList.toggle('selected', selected);
  });
  updateModalInfo();
}
function updateModalInfo() {
  const info = document.getElementById('modal-action-info');
  const player = state.players.find(item => item.phoneLastFour === modalAction?.phone);
  if (info && player) info.textContent = modalAction.type === 'eliminate' ? `当前级别：${levelLabel()} · 比赛时间：${formatShortDuration(elapsedSeconds())}` : `复活筹码：${formatNumber(state.config.buyin)} · 剩余蘑菇：${state.config.mushrooms - state.mushroomsUsed}/${state.config.mushrooms}`;
}

function confirmPlayerAction() {
  const player = state.players.find(item => item.phoneLastFour === modalAction?.phone);
  if (!player) return;
  if (modalAction.type === 'eliminate') {
    player.inGame = false; player.eliminatedAt = Math.floor(elapsedSeconds()); player.eliminatedLevel = state.levelIndex + 1; player.eliminationHistory.push({ time: player.eliminatedAt, level: state.levelIndex + 1 });
    addEvent('eliminate', `${player.nickname}(${player.phoneLastFour}) 淘汰`);
    closeModal(); renderDrawer(); updateGameDisplay();
    if (inGamePlayers().length === 1) finishGame('natural');
  } else {
    player.inGame = true; player.mushroomsUsed += 1; state.mushroomsUsed += 1;
    addEvent('mushroom', `${player.nickname}(${player.phoneLastFour}) 使用蘑菇复活 🍄（剩余${state.config.mushrooms - state.mushroomsUsed}/${state.config.mushrooms}）`);
    closeModal(); renderDrawer(); updateGameDisplay();
  }
  persistProgress();
}

function closeModal() { document.getElementById('modal-overlay').classList.remove('visible'); modalAction = null; }

function openDrawer() { renderDrawer(); document.getElementById('drawer-overlay').classList.add('visible'); document.getElementById('drawer').classList.add('open'); }
function closeDrawer() { document.getElementById('drawer-overlay').classList.remove('visible'); document.getElementById('drawer').classList.remove('open'); }
function renderDrawer() {
  const body = document.getElementById('drawer-body');
  if (!body) return;
  const active = state.players.filter(player => player.inGame);
  const out = state.players.filter(player => !player.inGame);
  const row = player => `<div class="drawer-player ${player.inGame ? '' : 'is-eliminated'}"><div class="dp-info"><span class="dp-status ${player.inGame ? '' : 'eliminated'}"></span><div><div class="dp-name">${escapeHTML(player.nickname)}</div><div class="dp-phone">(${escapeHTML(player.phoneLastFour)})${player.seat ? ` · 座位${escapeHTML(player.seat)}` : ''}</div></div></div><div class="dp-actions">${player.inGame ? `<button class="btn btn-danger btn-sm" onclick="drawerEliminate('${player.phoneLastFour}')">💀</button>` : `<button class="btn btn-secondary btn-sm" onclick="drawerRestore('${player.phoneLastFour}')">恢复在场</button>${canUseMushroom() ? `<button class="btn btn-primary btn-sm" onclick="drawerMushroom('${player.phoneLastFour}')">🍄</button>` : ''}`}</div></div>`;
  body.innerHTML = `<div class="drawer-section-title">在场（${active.length}）</div>${active.map(row).join('') || '<div class="empty-state">暂无玩家</div>'}<div class="drawer-section-title">已淘汰（${out.length}）</div>${out.map(row).join('') || '<div class="empty-state">暂无玩家</div>'}`;
}
function drawerEliminate(phone) { closeDrawer(); openPlayerActionModal('eliminate'); selectModalPlayer(phone); }
function drawerMushroom(phone) { closeDrawer(); openPlayerActionModal('mushroom'); selectModalPlayer(phone); }
function drawerRestore(phone) {
  const player = state.players.find(item => item.phoneLastFour === phone); if (!player) return;
  player.inGame = true; addEvent('restore', `${player.nickname}(${phone}) 恢复在场`); renderDrawer(); updateGameDisplay(); persistProgress();
}

function showChopModal() {
  const active = inGamePlayers(); if (active.length > 3) return;
  const pool = totalChips();
  document.getElementById('modal-content').innerHTML = `<div class="modal-header">🤝 协商结束</div><div class="modal-body"><div class="chop-method"><label><input type="radio" name="chop-method" value="equal" checked onchange="updateChopTable()"> 平分</label><label><input type="radio" name="chop-method" value="ratio" onchange="updateChopTable()"> 按当前筹码比例</label><label><input type="radio" name="chop-method" value="custom" onchange="updateChopTable()"> 自定义</label></div><table class="chop-table"><thead><tr><th>玩家</th><th>当前筹码</th><th>分得筹码</th></tr></thead><tbody id="chop-body"></tbody></table><div class="chop-total">奖池：${formatNumber(pool)}</div></div><div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">取消</button><button class="btn btn-primary" onclick="confirmChop()">确认结束比赛</button></div>`;
  document.getElementById('modal-overlay').classList.add('visible'); updateChopTable();
}
function updateChopTable() {
  const method = document.querySelector('input[name="chop-method"]:checked')?.value || 'equal';
  const players = inGamePlayers(); const pool = totalChips(); const each = players.length ? Math.floor(pool / players.length) : 0;
  const body = document.getElementById('chop-body'); if (!body) return;
  body.innerHTML = players.map((player, i) => `<tr><td>${escapeHTML(player.nickname)}</td><td>${formatNumber(state.config.buyin)}</td><td><input class="chop-prize" data-phone="${player.phoneLastFour}" type="number" min="0" value="${method === 'equal' ? each : method === 'ratio' ? Math.floor(pool / players.length) : each}" ${method === 'custom' ? '' : 'readonly'}></td></tr>`).join('');
}
function confirmChop() {
  const prizes = {}; document.querySelectorAll('.chop-prize').forEach(input => { prizes[input.dataset.phone] = Math.max(0, Number(input.value) || 0); });
  state.settlement = { prizes }; state.endReason = 'chop'; addEvent('chop', '协商结束比赛'); closeModal(); finishGame('chop');
}

function finishGame(reason) {
  if (state.view === 'settlement') return;
  state.running = false; state.elapsedBeforeRun = elapsedSeconds(); state.levelElapsedBeforeRun = currentLevelElapsedSeconds(); state.levelStartedAt = 0; state.endReason = reason;
  if (!state.settlement) state.settlement = { prizes: calculateNaturalPrizes() };
  const rankings = buildRankings();
  const tournament = { id: state.tournamentId, name: state.config.name, date: new Date().toISOString(), config: JSON.parse(JSON.stringify(state.config)), totalPrizePool: totalChips(), durationMinutes: state.elapsedBeforeRun / 60, finalLevel: state.levelIndex + 1, mushroomsUsed: state.mushroomsUsed, endReason: reason, events: state.events, rankings };
  addTournament(tournament).then(() => addParticipations(rankings.map(item => ({ tournamentId: state.tournamentId, phoneLastFour: item.phoneLastFour, finalRank: item.rank, eliminatedAt: item.eliminatedAt, eliminatedAtLevel: item.eliminatedLevel, mushroomsUsed: item.mushroomsUsed, prizeChips: item.prizeChips })))).catch(error => console.error('保存比赛失败:', error));
  clearProgress(); playGameEnd(); renderSettlement(tournament, rankings); showView('settlement');
}

function buildRankings() {
  const active = state.players.filter(player => player.inGame);
  const eliminated = state.players.filter(player => !player.inGame).sort((a, b) => (b.eliminatedAt ?? 0) - (a.eliminatedAt ?? 0));
  const ordered = state.endReason === 'chop' ? [...active, ...eliminated] : [...active, ...eliminated];
  const prizes = state.settlement?.prizes || {};
  return ordered.map((player, index) => ({ ...player, rank: index + 1, prizeChips: prizes[player.phoneLastFour] || 0, eliminatedAt: player.inGame ? null : player.eliminatedAt, eliminatedLevel: player.inGame ? null : player.eliminatedLevel }));
}
function calculateNaturalPrizes() {
  const ratios = state.config.prizeMode === 'custom' ? state.config.customPrize : (PRIZE_RATIOS[state.config.prizeMode] || PRIZE_RATIOS['top3-50']);
  const prizes = {}; ratios.forEach((ratio, index) => { const player = state.players.filter(item => item.inGame).sort((a, b) => a.nickname.localeCompare(b.nickname))[index]; if (player) prizes[player.phoneLastFour] = Math.floor(totalChips() * ratio / 100); });
  return prizes;
}
function renderPrizePreview() {
  const container = document.getElementById('prize-preview'); if (!container) return;
  const ratios = state.config.prizeMode === 'custom' ? state.config.customPrize : (PRIZE_RATIOS[state.config.prizeMode] || PRIZE_RATIOS['top3-50']);
  container.innerHTML = `<h4>奖池分配</h4>${ratios.map((ratio, index) => `<div class="prize-row"><span class="prize-rank">${index + 1}th · ${ratio}%</span><span class="prize-amount">${formatNumber(Math.floor(totalChips() * ratio / 100))}</span></div>`).join('')}`;
}

function renderSettlement(tournament, rankings) {
  const view = document.getElementById('view-settlement');
  view.innerHTML = `<div class="settlement-header"><div class="trophy">🏆</div><h2>比赛结束</h2><p>${escapeHTML(tournament.name)} · ${new Date(tournament.date).toLocaleDateString('zh-CN')}</p></div><div class="settlement-body"><div class="settlement-left"><div class="stat-card"><table class="rank-table"><thead><tr><th>排名</th><th>玩家</th><th>淘汰时间</th><th>奖励筹码</th></tr></thead><tbody id="rankings-body">${rankings.map(item => settlementRow(item)).join('')}</tbody></table></div><div class="event-log"><h4>事件日志</h4>${state.events.map(event => `<div class="event-entry"><span class="event-time">[${formatShortDuration(event.time)}]</span> ${escapeHTML(event.detail)}</div>`).join('')}</div></div><div class="settlement-right"><div class="stat-card"><div class="stat-label">比赛时长</div><div class="stat-value">${formatDuration(tournament.durationMinutes * 60)}</div></div><div class="stat-card"><div class="stat-label">经过级别</div><div class="stat-value">${tournament.finalLevel}</div></div><div class="stat-card"><div class="stat-label">蘑菇使用</div><div class="stat-value">${tournament.mushroomsUsed}/${state.config.mushrooms}</div></div><div class="stat-card"><div class="stat-label">总筹码池</div><div class="stat-value">${formatNumber(tournament.totalPrizePool)}</div></div><div class="settlement-actions"><button class="btn btn-secondary" onclick="exportCurrentTournament()">导出 JSON</button><button class="btn btn-secondary" onclick="showHistory()">查看排行榜</button><button class="btn btn-primary" onclick="newGame()">开始新比赛</button></div></div></div>`;
}
function settlementRow(item) { const medal = item.rank === 1 ? '🥇' : item.rank === 2 ? '🥈' : item.rank === 3 ? '🥉' : item.rank; return `<tr><td class="rank-medal">${medal}</td><td>${escapeHTML(item.nickname)} <small>(${escapeHTML(item.phoneLastFour)})</small></td><td>${item.eliminatedAt == null ? '冠军/协商' : formatShortDuration(item.eliminatedAt)}</td><td class="rank-prize"><input type="number" min="0" value="${item.prizeChips}" onchange="changePrize('${item.phoneLastFour}', this.value)"></td></tr>`; }
function changePrize(phone, value) { if (state.settlement) state.settlement.prizes[phone] = Math.max(0, Number(value) || 0); }
function newGame() { clearProgress(); state.players.forEach(player => { player.inGame = true; }); state.view = 'setup'; renderPlayers(); showView('setup'); }
async function exportCurrentTournament() { const data = await getTournament(state.tournamentId).catch(() => null); downloadJSON(data || state, `poker-timer-${state.tournamentId || 'backup'}.json`); }

async function showHistory() {
  const tournaments = await getAllTournaments().catch(() => []); const players = await getAllPlayers().catch(() => []);
  const view = document.getElementById('view-history');
  view.innerHTML = `<div class="history-header"><button class="btn btn-ghost" onclick="showView('setup')">← 返回</button><h2>历史数据</h2></div><div class="leaderboard-tabs"><button class="lb-tab active" data-board="chips">总筹码榜</button><button class="lb-tab" data-board="wins">胜率榜</button><button class="lb-tab" data-board="games">常客榜</button><button class="lb-tab" data-board="top3">前三率榜</button></div><div id="history-content"></div><h3 style="margin:24px 0 12px">比赛历史</h3><ul class="tournament-list">${tournaments.sort((a, b) => String(b.date).localeCompare(String(a.date))).map(t => `<li class="tournament-item" onclick="showTournamentDetail('${t.id}')"><div class="t-header"><span class="t-name">${escapeHTML(t.name)}</span><span class="t-date">${new Date(t.date).toLocaleDateString('zh-CN')}</span></div><div class="t-stats">${t.rankings?.length || 0}人 · ${formatNumber(t.totalPrizePool)} 筹码 · ${t.endReason === 'chop' ? '协商结束' : '自然结束'}</div></li>`).join('') || '<li class="empty-state">暂无历史比赛</li>'}</ul>`;
  window.historyPlayers = players; window.historyParticipations = [];
  for (const tournament of tournaments) window.historyParticipations.push(...(await getParticipationsByTournament(tournament.id).catch(() => [])));
  document.querySelectorAll('.lb-tab').forEach(tab => tab.addEventListener('click', () => { document.querySelectorAll('.lb-tab').forEach(item => item.classList.remove('active')); tab.classList.add('active'); renderLeaderboard(tab.dataset.board); }));
  renderLeaderboard('chips'); showView('history');
}
function renderLeaderboard(board) {
  const players = window.historyPlayers || []; const records = window.historyParticipations || [];
  const data = players.map(player => { const rows = records.filter(row => row.phoneLastFour === player.phoneLastFour); const wins = rows.filter(row => row.finalRank === 1).length; const top3 = rows.filter(row => row.finalRank <= 3).length; return { player, games: rows.length, wins, top3, chips: rows.reduce((sum, row) => sum + (row.prizeChips || 0), 0) }; }).filter(item => item.games).sort((a, b) => board === 'chips' ? b.chips - a.chips : board === 'wins' ? (b.wins / b.games) - (a.wins / a.games) : board === 'games' ? b.games - a.games : (b.top3 / b.games) - (a.top3 / a.games));
  const content = document.getElementById('history-content'); if (!content) return;
  content.innerHTML = `<ul class="leaderboard-list">${data.map((item, index) => `<li class="lb-item"><span class="lb-rank rank-${index + 1}">${index + 1}</span><div class="lb-info"><div class="lb-name">${escapeHTML(item.player.nickname)} (${escapeHTML(item.player.phoneLastFour)})</div><div class="lb-stats">${item.games}场 · ${item.wins}冠 · 前三${item.top3}次</div></div><span class="lb-value">${board === 'chips' ? formatNumber(item.chips) : board === 'wins' ? `${Math.round(item.wins / item.games * 100)}%` : board === 'games' ? item.games : `${Math.round(item.top3 / item.games * 100)}%`}</span></li>`).join('') || '<li class="empty-state">暂无数据</li>'}</ul>`;
}
async function showTournamentDetail(id) { const tournament = await getTournament(id); if (!tournament) return; const view = document.getElementById('view-history'); const rankings = tournament.rankings || []; view.innerHTML = `<div class="history-header"><button class="btn btn-ghost" onclick="showHistory()">← 返回</button><h2>比赛详情</h2></div><div class="tournament-detail"><h3>${escapeHTML(tournament.name)} · ${new Date(tournament.date).toLocaleDateString('zh-CN')}</h3><p>总筹码：${formatNumber(tournament.totalPrizePool)} · 时长：${formatDuration(tournament.durationMinutes * 60)} · 蘑菇：${tournament.mushroomsUsed}</p><table class="rank-table"><thead><tr><th>排名</th><th>玩家</th><th>奖励筹码</th></tr></thead><tbody>${rankings.map(item => `<tr><td>${item.rank}</td><td>${escapeHTML(item.nickname)} (${escapeHTML(item.phoneLastFour)})</td><td class="rank-prize">${formatNumber(item.prizeChips)}</td></tr>`).join('')}</tbody></table><div class="event-log"><h4>事件日志</h4>${(tournament.events || []).map(event => `<div class="event-entry">[${formatShortDuration(event.time)}] ${escapeHTML(event.detail)}</div>`).join('')}</div></div>`; showView('history'); }

function showImportExport() { document.getElementById('modal-content').innerHTML = `<div class="modal-header">导入 / 导出数据</div><div class="modal-body"><p class="modal-info">导出全部玩家、比赛和参赛记录，或从 JSON 备份恢复。</p><input type="file" id="import-file" accept="application/json"></div><div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">取消</button><button class="btn btn-secondary" onclick="exportAll()">导出全部数据</button><button class="btn btn-primary" onclick="importFile()">导入</button></div>`; document.getElementById('modal-overlay').classList.add('visible'); }
async function exportAll() { const data = await exportAllData(); downloadJSON(data, `poker-timer-backup-${new Date().toISOString().slice(0, 10)}.json`); closeModal(); }
async function importFile() { const file = document.getElementById('import-file').files[0]; if (!file) return alert('请选择 JSON 文件'); try { await importAllData(JSON.parse(await file.text())); closeModal(); alert('导入成功'); } catch (error) { alert(`导入失败：${error.message}`); } }
function openSettingsFromGame() { state.running = false; state.elapsedBeforeRun = elapsedSeconds(); state.levelStartedAt = 0; persistProgress(); alert('比赛进行中不可修改配置。请通过玩家抽屉管理玩家状态。'); }
function escapeHTML(value) { return String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character])); }

function restorePrompt() {
  const progress = loadProgress(); if (!progress) return;
  document.getElementById('modal-content').innerHTML = `<div class="modal-header">发现未完成的比赛</div><div class="modal-body"><p class="recover-info">检测到一场未完成的「${escapeHTML(progress.config?.name || '友谊赛')}」，是否恢复？</p></div><div class="modal-footer"><button class="btn btn-secondary" onclick="discardRecovery()">放弃</button><button class="btn btn-primary" onclick="restoreGame()">恢复比赛</button></div>`;
  document.getElementById('modal-overlay').classList.add('visible'); window.pendingProgress = progress;
}
function discardRecovery() { clearProgress(); closeModal(); }
function restoreGame() { Object.assign(state, window.pendingProgress); state.running = false; state.levelStartedAt = 0; state.levelElapsedBeforeRun = state.levelElapsedBeforeRun || 0; closeModal(); showView('game'); startTicker(); updateGameDisplay(); }

window.addEventListener('keydown', event => {
  if (event.target.matches('input, textarea, select')) return;
  if (state.view !== 'game') return;
  if (event.code === 'Space') { event.preventDefault(); togglePause(); }
  if (event.key === 'ArrowRight') nextLevel();
  if (event.key === 'ArrowLeft') prevLevel();
  if (event.key.toLowerCase() === 'd') showEliminateModal();
  if (event.key.toLowerCase() === 'r') showMushroomModal();
});

window.addEventListener('beforeunload', persistProgress);

document.addEventListener('DOMContentLoaded', async () => {
  try { await initDB(); } catch (error) { console.warn('IndexedDB 不可用，将仅使用当前页面数据:', error); }
  initSetup();
  restorePrompt();
});
