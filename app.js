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
  eliminationSequence: 0,
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
  if (!state.gameStartedAt) return state.elapsedBeforeRun || 0;
  const activeSegment = state.running ? (Date.now() - state.levelStartedAt) / 1000 : 0;
  return (state.elapsedBeforeRun || 0) + activeSegment;
}

function commitCurrentSegment() {
  if (!state.running || !state.levelStartedAt) return;
  const segment = (Date.now() - state.levelStartedAt) / 1000;
  state.elapsedBeforeRun = (state.elapsedBeforeRun || 0) + segment;
  state.levelElapsedBeforeRun = (state.levelElapsedBeforeRun || 0) + segment;
  state.levelStartedAt = Date.now();
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
  const phoneInput = document.getElementById('input-phone');
  phoneInput?.addEventListener('input', updatePlayerHint);
}

async function updatePlayerHint() {
  const phoneInput = document.getElementById('input-phone');
  const nicknameInput = document.getElementById('input-nickname');
  const hint = document.getElementById('player-hint');
  const phone = phoneInput?.value.trim() || '';
  if (!hint || !nicknameInput) return;
  hint.style.display = 'none';
  hint.textContent = '';
  if (!/^\d{4}$/.test(phone) || state.players.some(player => player.phoneLastFour === phone)) return;
  const old = await getPlayer(phone).catch(() => null);
  if (phoneInput.value.trim() !== phone) return;
  if (old) {
    nicknameInput.value = old.nickname;
    hint.textContent = `历史玩家：${old.nickname}，已自动填充昵称`;
    hint.style.display = 'block';
  } else {
    hint.textContent = '未找到历史记录，请输入昵称';
    hint.style.display = 'block';
  }
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
      <td><button class="btn btn-ghost btn-sm" onclick="insertBlindLevel(${index})" aria-label="在第${index + 1}级前插入">插入</button><button class="btn btn-ghost btn-sm" onclick="deleteBlindLevel(${index})" aria-label="删除第${index + 1}级">✕</button></td>
    </tr>`).join('');
}

function addBlindLevel() {
  readConfig();
  const last = state.config.blinds[state.config.blinds.length - 1] || { sb: 100, bb: 200, ante: 0, minutes: 8 };
  state.config.blinds.push({ sb: last.sb * 2, bb: last.bb * 2, ante: last.ante * 2, minutes: last.minutes });
  renderBlindTable();
}

function insertBlindLevel(index) {
  readConfig();
  const source = state.config.blinds[index] || { sb: 100, bb: 200, ante: 0, minutes: 8 };
  state.config.blinds.splice(index, 0, { ...source });
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
  const player = { phoneLastFour: phone, nickname, seat: seatInput.value.trim(), inGame: true, eliminatedAt: null, eliminatedLevel: null, mushroomsUsed: 0, eliminationHistory: [], rebuySnapshot: null };
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
  const labels = { fast: '快速赛', standard: '标准赛', deep: '深筹赛' };
  if (!confirm(`加载${labels[name]}将覆盖买入筹码和盲注表，确认继续吗？`)) return;
  state.config.buyin = template.buyin;
  state.config.blinds = cloneBlinds(template.blinds);
  syncConfigInputs(); renderBlindTable();
  document.querySelectorAll('.template-card').forEach(card => card.classList.toggle('selected', card.querySelector('h3').textContent.includes(labels[name])));
}

async function startGame() {
  readConfig();
  if (state.config.prizeMode === 'custom' && state.config.customPrize.reduce((sum, ratio) => sum + ratio, 0) !== 100) return alert('自定义奖池比例合计必须为100%');
  if (state.players.length < 2) return alert('至少需要 2 人参赛');
  if (!state.config.blinds.length) return alert('至少需要一个盲注级别');
  state.players.forEach(player => { player.inGame = true; player.eliminatedAt = null; player.eliminatedLevel = null; player.mushroomsUsed = 0; player.eliminationHistory = []; player.rebuySnapshot = null; });
  state.levelIndex = 0; state.elapsedBeforeRun = 0; state.levelElapsedBeforeRun = 0; state.gameStartedAt = Date.now(); state.levelStartedAt = Date.now(); state.running = false; state.warningPlayed = false; state.mushroomsUsed = 0; state.eliminationSequence = 0; state.events = [];
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
  if (state.running) commitCurrentSegment();
  if (state.levelIndex < 1000000) state.levelIndex += 1;
  state.levelElapsedBeforeRun = 0;
  state.levelStartedAt = state.running ? Date.now() : 0;
  state.warningPlayed = false;
  if (automatic) { addEvent('level-up', `升级至 ${levelLabel()}`); playLevelUp(); }
  const flash = document.getElementById('level-up-flash');
  flash.classList.remove('visible'); void flash.offsetWidth; flash.classList.add('visible');
  updateGameDisplay(); persistProgress();
}

function nextLevel() { if (state.view === 'game') advanceLevel(false); }
function prevLevel() {
  if (state.levelIndex <= 0) return;
  if (state.running) commitCurrentSegment();
  state.levelIndex -= 1;
  state.levelElapsedBeforeRun = 0;
  state.levelStartedAt = state.running ? Date.now() : 0;
  state.warningPlayed = false;
  addEvent('level-down', `返回 ${levelLabel()}`); updateGameDisplay(); persistProgress();
}

function showEliminateModal() { openPlayerActionModal('eliminate'); }
function showMushroomModal() {
  if (state.mushroomsUsed >= state.config.mushrooms) return alert('蘑菇已用完');
  if (state.config.mushroomCutoff && state.levelIndex + 1 > state.config.mushroomCutoff) return alert('已超过蘑菇截止级别');
  openPlayerActionModal('mushroom');
}

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
  const rows = candidates.map(player => `<li class="modal-player-item ${player.phoneLastFour === modalAction.phone ? 'selected' : ''}" data-phone="${escapeHTML(player.phoneLastFour)}" onclick="selectModalPlayer('${player.phoneLastFour}')"><span>${action === 'eliminate' ? '🟢' : '⚫'}</span><b>${escapeHTML(player.nickname)}</b><span class="player-phone">(${escapeHTML(player.phoneLastFour)})</span></li>`).join('');
  document.getElementById('modal-content').innerHTML = `<div class="modal-header">${title}</div><div class="modal-body"><ul class="modal-player-list">${rows}</ul><p class="modal-info" id="modal-action-info"></p></div><div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">取消</button><button class="btn ${action === 'eliminate' ? 'btn-danger' : 'btn-primary'}" onclick="confirmPlayerAction()">${button}</button></div>`;
  document.getElementById('modal-overlay').classList.add('visible'); updateModalInfo();
}

function selectModalPlayer(phone) {
  if (!modalAction) return;
  modalAction.phone = phone;
  document.querySelectorAll('.modal-player-item').forEach(item => {
    const selected = item.dataset.phone === phone;
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
    player.eliminationHistory = player.eliminationHistory || [];
    player.inGame = false; player.eliminatedAt = Math.floor(elapsedSeconds()); player.eliminatedLevel = state.levelIndex + 1; player.eliminationSequence = ++state.eliminationSequence; player.eliminationHistory.push({ time: player.eliminatedAt, level: state.levelIndex + 1, sequence: player.eliminationSequence });
    player.rebuySnapshot = null;
    addEvent('eliminate', `${player.nickname}(${player.phoneLastFour}) 淘汰`);
    closeModal(); renderDrawer(); updateGameDisplay();
    if (inGamePlayers().length === 1) finishGame('natural');
  } else {
    player.rebuySnapshot = { eliminatedAt: player.eliminatedAt, eliminatedLevel: player.eliminatedLevel, eliminationSequence: player.eliminationSequence };
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
  const row = player => `<div class="drawer-player ${player.inGame ? '' : 'is-eliminated'}"><div class="dp-info"><span class="dp-status ${player.inGame ? '' : 'eliminated'}"></span><div><div class="dp-name">${escapeHTML(player.nickname)}</div><div class="dp-phone">(${escapeHTML(player.phoneLastFour)})${player.seat ? ` · 座位${escapeHTML(player.seat)}` : ''}</div></div></div><div class="dp-actions">${player.inGame ? `${player.rebuySnapshot ? `<button class="btn btn-secondary btn-sm" onclick="undoMushroom('${player.phoneLastFour}')">撤销蘑菇</button>` : ''}<button class="btn btn-danger btn-sm" onclick="drawerEliminate('${player.phoneLastFour}')">💀</button>` : `<button class="btn btn-secondary btn-sm" onclick="drawerRestore('${player.phoneLastFour}')">恢复在场</button>${canUseMushroom() ? `<button class="btn btn-primary btn-sm" onclick="drawerMushroom('${player.phoneLastFour}')">🍄</button>` : ''}`}</div></div>`;
  body.innerHTML = `<div class="drawer-section-title">在场（${active.length}）</div>${active.map(row).join('') || '<div class="empty-state">暂无玩家</div>'}<div class="drawer-section-title">已淘汰（${out.length}）</div>${out.map(row).join('') || '<div class="empty-state">暂无玩家</div>'}`;
}
function drawerEliminate(phone) { closeDrawer(); openPlayerActionModal('eliminate'); selectModalPlayer(phone); }
function drawerMushroom(phone) { closeDrawer(); openPlayerActionModal('mushroom'); selectModalPlayer(phone); }
function drawerRestore(phone) {
  const player = state.players.find(item => item.phoneLastFour === phone); if (!player) return;
  player.inGame = true; player.eliminatedAt = null; player.eliminatedLevel = null; player.eliminationSequence = 0;
  addEvent('restore', `${player.nickname}(${phone}) 恢复在场`); renderDrawer(); updateGameDisplay(); persistProgress();
}
function undoMushroom(phone) {
  const player = state.players.find(item => item.phoneLastFour === phone); const snapshot = player?.rebuySnapshot;
  if (!player || !snapshot) return;
  player.inGame = false; player.eliminatedAt = snapshot.eliminatedAt; player.eliminatedLevel = snapshot.eliminatedLevel; player.eliminationSequence = snapshot.eliminationSequence;
  player.mushroomsUsed = Math.max(0, player.mushroomsUsed - 1); state.mushroomsUsed = Math.max(0, state.mushroomsUsed - 1); player.rebuySnapshot = null;
  addEvent('mushroom-undo', `${player.nickname}(${phone}) 撤销蘑菇复活 🍄（剩余${state.config.mushrooms - state.mushroomsUsed}/${state.config.mushrooms}）`);
  renderDrawer(); updateGameDisplay(); persistProgress();
}

function showChopModal() {
  const active = inGamePlayers(); if (active.length < 2 || active.length > 3) return;
  const pool = totalChips();
  document.getElementById('modal-content').innerHTML = `<div class="modal-header">🤝 协商结束</div><div class="modal-body"><div class="chop-method"><label><input type="radio" name="chop-method" value="equal" checked onchange="updateChopTable()"> 平分</label><label><input type="radio" name="chop-method" value="ratio" onchange="updateChopTable()"> 按当前筹码比例</label><label><input type="radio" name="chop-method" value="custom" onchange="updateChopTable()"> 自定义</label></div><table class="chop-table"><thead><tr><th>最终名次</th><th>玩家</th><th>当前筹码</th><th>分得筹码</th></tr></thead><tbody id="chop-body"></tbody></table><div class="chop-total">奖池参考：${formatNumber(pool)}</div></div><div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">取消</button><button class="btn btn-primary" onclick="confirmChop()">确认结束比赛</button></div>`;
  document.getElementById('modal-overlay').classList.add('visible'); updateChopTable();
}
function updateChopTable() {
  const method = document.querySelector('input[name="chop-method"]:checked')?.value || 'equal';
  const players = inGamePlayers(); const pool = totalChips(); const each = players.length ? Math.floor(pool / players.length) : 0;
  if (method === 'ratio' && document.querySelector('.chop-current:not([readonly])')) {
    const currents = Array.from(document.querySelectorAll('.chop-current')).map(input => Math.max(0, Number(input.value) || 0));
    const currentTotal = currents.reduce((sum, value) => sum + value, 0);
    document.querySelectorAll('.chop-prize').forEach((input, index) => { input.value = currentTotal ? Math.floor(pool * currents[index] / currentTotal) : 0; });
    return;
  }
  const previousRanks = new Map(Array.from(document.querySelectorAll('.chop-rank')).map(input => [input.dataset.phone, input.value]));
  const previousCurrent = new Map(Array.from(document.querySelectorAll('.chop-current')).map(input => [input.dataset.phone, input.value]));
  const previousPrize = new Map(Array.from(document.querySelectorAll('.chop-prize')).map(input => [input.dataset.phone, input.value]));
  const body = document.getElementById('chop-body'); if (!body) return;
  body.innerHTML = players.map((player, index) => `<tr><td><input class="chop-rank" data-phone="${player.phoneLastFour}" type="number" min="1" max="${players.length}" value="${previousRanks.get(player.phoneLastFour) ?? index + 1}"></td><td>${escapeHTML(player.nickname)}</td><td><input class="chop-current" data-phone="${player.phoneLastFour}" type="number" min="0" value="${previousCurrent.get(player.phoneLastFour) ?? state.config.buyin}" ${method === 'ratio' ? '' : 'readonly'} oninput="updateChopTable()"></td><td><input class="chop-prize" data-phone="${player.phoneLastFour}" type="number" min="0" value="${previousPrize.get(player.phoneLastFour) ?? each}" ${method === 'custom' ? '' : 'readonly'}></td></tr>`).join('');
  if (method === 'ratio') {
    const currents = Array.from(document.querySelectorAll('.chop-current')).map(input => Math.max(0, Number(input.value) || 0));
    const currentTotal = currents.reduce((sum, value) => sum + value, 0);
    document.querySelectorAll('.chop-prize').forEach((input, index) => { input.value = currentTotal ? Math.floor(pool * currents[index] / currentTotal) : 0; });
  } else if (method === 'equal') {
    document.querySelectorAll('.chop-prize').forEach(input => { input.value = each; });
  }
}
function confirmChop() {
  const prizes = {}; const chopRanks = {};
  document.querySelectorAll('.chop-prize').forEach(input => { prizes[input.dataset.phone] = Math.max(0, Number(input.value) || 0); });
  document.querySelectorAll('.chop-rank').forEach(input => { chopRanks[input.dataset.phone] = Number(input.value); });
  const ranks = Object.values(chopRanks); const activeCount = inGamePlayers().length;
  if (ranks.length !== activeCount || new Set(ranks).size !== activeCount || ranks.some(rank => !Number.isInteger(rank) || rank < 1 || rank > activeCount)) return alert(`请为 ${activeCount} 名协商玩家填写不重复的最终名次`);
  const total = Object.values(prizes).reduce((sum, value) => sum + value, 0);
  if (total !== totalChips() && !confirm(`分配合计 ${formatNumber(total)} 与奖池参考 ${formatNumber(totalChips())} 不一致，仍要结束比赛吗？`)) return;
  state.settlement = { prizes, chopRanks }; state.endReason = 'chop'; addEvent('chop', '协商结束比赛'); closeModal(); finishGame('chop');
}

function finishGame(reason) {
  if (state.view === 'settlement') return;
  const finalElapsed = elapsedSeconds();
  const finalLevelElapsed = currentLevelElapsedSeconds();
  state.running = false; state.elapsedBeforeRun = finalElapsed; state.levelElapsedBeforeRun = finalLevelElapsed; state.levelStartedAt = 0; state.endReason = reason;
  if (!state.settlement) state.settlement = { prizes: calculateNaturalPrizes() };
  const rankings = buildRankings();
  const tournament = { id: state.tournamentId, name: state.config.name, date: new Date().toISOString(), config: JSON.parse(JSON.stringify(state.config)), totalPrizePool: totalChips(), durationMinutes: state.elapsedBeforeRun / 60, finalLevel: state.levelIndex + 1, mushroomsUsed: state.mushroomsUsed, endReason: reason, events: state.events, rankings };
  addTournament(tournament).then(() => addParticipations(rankings.map(item => ({ tournamentId: state.tournamentId, phoneLastFour: item.phoneLastFour, finalRank: item.rank, eliminatedAt: item.eliminatedAt, eliminatedAtLevel: item.eliminatedLevel, mushroomsUsed: item.mushroomsUsed, prizeChips: item.prizeChips })))).catch(error => console.error('保存比赛失败:', error));
  clearProgress(); playGameEnd(); renderSettlement(tournament, rankings); showView('settlement'); showExportPrompt(tournament);
}

function buildRankings() {
  const chopRanks = state.settlement?.chopRanks || {};
  const active = state.players.filter(player => player.inGame).sort((a, b) => (chopRanks[a.phoneLastFour] || Infinity) - (chopRanks[b.phoneLastFour] || Infinity));
  const eliminated = state.players.filter(player => !player.inGame).sort((a, b) => (b.eliminationSequence || 0) - (a.eliminationSequence || 0));
  const ordered = [...active, ...eliminated];
  const prizes = state.settlement?.prizes || {};
  return ordered.map((player, index) => ({ ...player, rank: index + 1, prizeChips: prizes[player.phoneLastFour] || 0, eliminatedAt: player.inGame ? null : player.eliminatedAt, eliminatedAtLevel: player.inGame ? null : player.eliminatedLevel }));
}
function calculateNaturalPrizes() {
  const rankings = buildRankings();
  const ratios = state.config.prizeMode === 'custom' ? state.config.customPrize : (PRIZE_RATIOS[state.config.prizeMode] || PRIZE_RATIOS['top3-50']);
  const prizes = {};
  ratios.forEach((ratio, index) => { const player = rankings[index]; if (player) prizes[player.phoneLastFour] = Math.floor(totalChips() * ratio / 100); });
  return prizes;
}
function renderPrizePreview() {
  const container = document.getElementById('prize-preview'); if (!container) return;
  const ratios = state.config.prizeMode === 'custom' ? state.config.customPrize : (PRIZE_RATIOS[state.config.prizeMode] || PRIZE_RATIOS['top3-50']);
  container.innerHTML = `<h4>奖池分配</h4>${ratios.map((ratio, index) => `<div class="prize-row"><span class="prize-rank">第 ${index + 1} 名 · ${ratio}%</span><span class="prize-amount">${formatNumber(Math.floor(totalChips() * ratio / 100))}</span></div>`).join('')}`;
}

function renderSettlement(tournament, rankings) {
  const view = document.getElementById('view-settlement');
  view.innerHTML = `<div class="settlement-header"><div class="trophy">🏆</div><h2>比赛结束</h2><p>${escapeHTML(tournament.name)} · ${new Date(tournament.date).toLocaleDateString('zh-CN')}</p></div><div class="settlement-body"><div class="settlement-left"><div class="stat-card"><table class="rank-table"><thead><tr><th>排名</th><th>玩家</th><th>淘汰时间</th><th>蘑菇</th><th>奖励筹码</th></tr></thead><tbody id="rankings-body">${rankings.map(item => settlementRow(item)).join('')}</tbody></table></div><div class="event-log"><h4>事件日志</h4>${state.events.map(event => `<div class="event-entry"><span class="event-time">[${formatShortDuration(event.time)}]</span> ${escapeHTML(event.detail)}</div>`).join('')}</div></div><div class="settlement-right"><div class="stat-card"><div class="stat-label">比赛时长</div><div class="stat-value">${formatDuration(tournament.durationMinutes * 60)}</div></div><div class="stat-card"><div class="stat-label">经过级别</div><div class="stat-value">${tournament.finalLevel}</div></div><div class="stat-card"><div class="stat-label">蘑菇使用</div><div class="stat-value">${tournament.mushroomsUsed}/${state.config.mushrooms}</div></div><div class="stat-card"><div class="stat-label">总筹码池</div><div class="stat-value">${formatNumber(tournament.totalPrizePool)}</div></div><div class="settlement-actions"><button class="btn btn-secondary" onclick="exportCurrentTournament()">导出 JSON</button><button class="btn btn-secondary" onclick="showHistory()">查看排行榜</button><button class="btn btn-primary" onclick="newGame()">开始新比赛</button></div></div></div>`;
}
function settlementRow(item) { const medal = item.rank === 1 ? '🥇' : item.rank === 2 ? '🥈' : item.rank === 3 ? '🥉' : item.rank; return `<tr><td class="rank-medal">${medal}</td><td>${escapeHTML(item.nickname)} <small>(${escapeHTML(item.phoneLastFour)})</small></td><td>${item.eliminatedAt == null ? '冠军/协商' : formatShortDuration(item.eliminatedAt)}</td><td>${item.mushroomsUsed || 0}</td><td class="rank-prize"><input type="number" min="0" value="${item.prizeChips}" onchange="changePrize('${item.phoneLastFour}', this.value)"></td></tr>`; }
function showExportPrompt(tournament) {
  document.getElementById('modal-content').innerHTML = `<div class="modal-header">备份比赛数据</div><div class="modal-body"><p class="modal-info">比赛已保存，是否立即导出本场 JSON 备份？</p></div><div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">暂不导出</button><button class="btn btn-primary" onclick="exportTournamentData(window.finishedTournament)">导出 JSON</button></div>`;
  window.finishedTournament = tournament;
  document.getElementById('modal-overlay').classList.add('visible');
}
function exportTournamentData(tournament) {
  if (!tournament) return;
  downloadJSON(tournament, `poker-timer-${tournament.id || 'backup'}.json`);
  closeModal();
}
async function changePrize(phone, value) {
  if (!state.settlement) return;
  state.settlement.prizes[phone] = Math.max(0, Number(value) || 0);
  if (state.tournamentId) {
    const tournament = await getTournament(state.tournamentId).catch(() => null);
    if (!tournament?.rankings) return;
    const item = tournament.rankings.find(row => row.phoneLastFour === phone);
    if (item) item.prizeChips = state.settlement.prizes[phone];
    await addTournament(tournament).catch(() => {});
    await addParticipations(tournament.rankings.map(row => ({ tournamentId: tournament.id, phoneLastFour: row.phoneLastFour, finalRank: row.rank, eliminatedAt: row.eliminatedAt, eliminatedAtLevel: row.eliminatedLevel, mushroomsUsed: row.mushroomsUsed, prizeChips: row.prizeChips }))).catch(() => {});
  }
}
function newGame() {
  clearProgress();
  state.players.forEach(player => { player.inGame = true; player.eliminatedAt = null; player.eliminatedLevel = null; player.eliminationSequence = 0; player.eliminationHistory = []; player.mushroomsUsed = 0; });
  state.levelIndex = 0; state.levelStartedAt = 0; state.levelElapsedBeforeRun = 0; state.elapsedBeforeRun = 0; state.gameStartedAt = 0; state.running = false; state.warningPlayed = false; state.mushroomsUsed = 0; state.eliminationSequence = 0; state.events = []; state.tournamentId = null; state.endReason = null; state.settlement = null;
  state.view = 'setup'; renderPlayers(); showView('setup'); updateGameDisplay();
}
async function exportCurrentTournament() { const data = await getTournament(state.tournamentId).catch(() => null); downloadJSON(data || state, `poker-timer-${state.tournamentId || 'backup'}.json`); }

function showImportExport() { document.getElementById('modal-content').innerHTML = `<div class="modal-header">导入 / 导出数据</div><div class="modal-body"><p class="modal-info">导出全部玩家、比赛和参赛记录，或从 JSON 备份恢复。</p><input type="file" id="import-file" accept="application/json"></div><div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">取消</button><button class="btn btn-secondary" onclick="exportAll()">导出全部数据</button><button class="btn btn-primary" onclick="importFile()">导入</button></div>`; document.getElementById('modal-overlay').classList.add('visible'); }
async function exportAll() { const data = await exportAllData(); downloadJSON(data, `poker-timer-backup-${new Date().toISOString().slice(0, 10)}.json`); closeModal(); }
async function importFile() { const file = document.getElementById('import-file').files[0]; if (!file) return alert('请选择 JSON 文件'); try { await importAllData(JSON.parse(await file.text())); closeModal(); alert('导入成功'); } catch (error) { alert(`导入失败：${error.message}`); } }
function openSettingsFromGame() {
  if (state.running) {
    state.elapsedBeforeRun = elapsedSeconds();
    state.levelElapsedBeforeRun = currentLevelElapsedSeconds();
    state.running = false;
    state.levelStartedAt = 0;
    addEvent('pause', '打开设置，自动暂停倒计时');
  }
  persistProgress();
  document.getElementById('modal-content').innerHTML = `<div class="modal-header">比赛设置</div><div class="modal-body"><p class="modal-info">比赛开始后配置已锁定。当前配置仅供查看。</p><div class="settings-summary"><p>赛事名称：${escapeHTML(state.config.name)}</p><p>买入筹码：${formatNumber(state.config.buyin)}</p><p>盲注级别：${state.config.blinds.length} 级</p><p>蘑菇：${state.config.mushrooms} 个，截止级别：${state.config.mushroomCutoff || '不限'}</p></div><div class="event-log settings-events"><h4>事件日志</h4>${state.events.map(event => `<div class="event-entry">[${formatShortDuration(event.time)}] ${escapeHTML(event.detail)}</div>`).join('')}</div></div><div class="modal-footer"><button class="btn btn-primary" onclick="closeModal(); updateGameDisplay()">关闭</button></div>`;
  document.getElementById('modal-overlay').classList.add('visible');
}
function escapeHTML(value) { return String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character])); }

function restorePrompt() {
  const progress = loadProgress(); if (!progress) return;
  document.getElementById('modal-content').innerHTML = `<div class="modal-header">发现未完成的比赛</div><div class="modal-body"><p class="recover-info">检测到一场未完成的「${escapeHTML(progress.config?.name || '友谊赛')}」，是否恢复？</p></div><div class="modal-footer"><button class="btn btn-secondary" onclick="discardRecovery()">放弃</button><button class="btn btn-primary" onclick="restoreGame()">恢复比赛</button></div>`;
  document.getElementById('modal-overlay').classList.add('visible'); window.pendingProgress = progress;
}
function discardRecovery() { clearProgress(); closeModal(); }
function restoreGame() {
  Object.assign(state, window.pendingProgress);
  state.levelElapsedBeforeRun = state.levelElapsedBeforeRun || 0;
  state.eliminationSequence = state.eliminationSequence || 0;
  state.events = state.events || [];
  state.players = (state.players || []).map(player => ({ ...player, inGame: player.inGame !== false, mushroomsUsed: player.mushroomsUsed || 0, eliminationHistory: player.eliminationHistory || [], eliminationSequence: player.eliminationSequence || 0, rebuySnapshot: player.rebuySnapshot || null }));
  state.running = false; state.levelStartedAt = 0; closeModal(); showView('game'); startTicker(); updateGameDisplay();
}

window.addEventListener('keydown', event => {
  if (event.target.matches('input, textarea, select')) return;
  if (state.view !== 'game') return;
  if (event.code === 'Space') { event.preventDefault(); togglePause(); }
  if (event.key === 'ArrowRight') nextLevel();
  if (event.key === 'ArrowLeft') prevLevel();
  if (event.key.toLowerCase() === 'd') showEliminateModal();
  if (event.key.toLowerCase() === 'r') showMushroomModal();
  if (event.key.toLowerCase() === 's') openSettingsFromGame();
});

window.addEventListener('beforeunload', persistProgress);

document.addEventListener('DOMContentLoaded', async () => {
  try { await initDB(); } catch (error) { console.warn('IndexedDB 不可用，将仅使用当前页面数据:', error); }
  initSetup();
  restorePrompt();
});
