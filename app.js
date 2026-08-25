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
  'top3-50': [50, 30, 20]
};

const state = {
  view: 'setup',
  config: {
    name: '友谊赛', buyin: 10000, mushrooms: 3, mushroomCutoff: 0,
    prizeMode: 'top3-50', customPrize: [50, 30, 20], totalPoints: 1000, blinds: []
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

// ---- 自定义奖池：动态名次行 ----

function renderCustomPrize() {
  const container = document.getElementById('custom-prize');
  if (!container) return;
  const rows = state.config.customPrize.length ? state.config.customPrize : [50, 30, 20];
  container.innerHTML = rows.map((pct, index) => `
    <div class="custom-prize-row">
      <label>第${index + 1}名</label>
      <input type="number" class="pct" min="0" max="100" value="${pct}">%
      ${rows.length > 2 ? `<button class="btn btn-ghost btn-sm remove-prize" onclick="removeCustomPrizeRow(${index})">删除</button>` : ''}
    </div>`).join('') + `<button class="btn btn-secondary btn-sm add-prize" onclick="addCustomPrizeRow()">＋ 添加名次</button>`;
}
function addCustomPrizeRow() {
  collectCustomPrize(); state.config.customPrize.push(0); renderCustomPrize();
}
function removeCustomPrizeRow(index) {
  collectCustomPrize(); state.config.customPrize.splice(index, 1); renderCustomPrize();
}
function collectCustomPrize() {
  state.config.customPrize = Array.from(document.querySelectorAll('.custom-prize-row input.pct')).map(input => Math.max(0, Number(input.value) || 0));
}

function syncConfigInputs() {
  document.getElementById('cfg-name').value = state.config.name;
  document.getElementById('cfg-buyin').value = state.config.buyin;
  document.getElementById('cfg-mushrooms').value = state.config.mushrooms;
  document.getElementById('cfg-mushroom-cutoff').value = state.config.mushroomCutoff;
  document.getElementById('cfg-total-points').value = state.config.totalPoints;
  const radio = document.querySelector(`input[name="prize-mode"][value="${state.config.prizeMode}"]`);
  if (radio) radio.checked = true;
  document.querySelectorAll('.prize-option').forEach(option => option.classList.toggle('selected', option.querySelector('input').checked));
  document.getElementById('custom-prize')?.classList.toggle('visible', state.config.prizeMode === 'custom');
  renderCustomPrize();
}

function readConfig() {
  state.config.name = document.getElementById('cfg-name').value.trim() || '友谊赛';
  state.config.buyin = Math.max(100, Number(document.getElementById('cfg-buyin').value) || 10000);
  state.config.mushrooms = Math.max(0, Number(document.getElementById('cfg-mushrooms').value) || 0);
  state.config.mushroomCutoff = Math.max(0, Number(document.getElementById('cfg-mushroom-cutoff').value) || 0);
  state.config.prizeMode = document.querySelector('input[name="prize-mode"]:checked')?.value || 'top3-50';
  state.config.totalPoints = Math.max(1, Number(document.getElementById('cfg-total-points').value) || 1000);
  state.config.customPrize = Array.from(document.querySelectorAll('.custom-prize-row input.pct')).map(input => Math.max(0, Number(input.value) || 0));
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
      <div class="player-info"><span class="player-number">${index + 1}</span><span class="player-name">${escapeHTML(player.nickname)}</span><span class="player-phone">(${escapeHTML(player.phoneLastFour)})</span></div>
      <div class="player-item-actions">
        <button class="btn btn-ghost btn-sm" onclick="editSeat(${index})">${player.seat ? `座位 ${escapeHTML(player.seat)}` : '补填座位'}</button>
        <button class="btn btn-ghost btn-sm" onclick="removeSetupPlayer(${index})">删除</button>
      </div>
    </li>`).join('');
  count.textContent = `共 ${state.players.length} 人${state.players.length < 2 ? '，至少需要 2 人' : ''}`;
}

// 补填 / 修改座位号
function editSeat(index) {
  const player = state.players[index];
  if (!player) return;
  document.getElementById('modal-content').innerHTML = `
    <div class="modal-header">补填座位号</div>
    <div class="modal-body">
      <p class="modal-info">${escapeHTML(player.nickname)} (${escapeHTML(player.phoneLastFour)})</p>
      <div class="form-group">
        <label>座位号</label>
        <input type="text" id="edit-seat" value="${escapeHTML(player.seat || '')}" maxlength="3" placeholder="留空表示未分配">
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">取消</button>
      <button class="btn btn-primary" onclick="saveSeat(${index})">保存</button>
    </div>`;
  document.getElementById('modal-overlay').classList.add('visible');
}

function saveSeat(index) {
  const seat = document.getElementById('edit-seat')?.value.trim() || '';
  if (state.players[index]) state.players[index].seat = seat;
  closeModal();
  renderPlayers();
}

// ---- 添加玩家弹层（尾号即时查询 + 勾选多选 + 全新玩家新增） ----

async function showAddPlayersModal() {
  const allPlayers = await getAllPlayers().catch(() => []);
  window.addPlayersData = { allPlayers, selected: new Set() };
  document.getElementById('modal-content').innerHTML = `
    <div class="modal-header">添加玩家</div>
    <div class="modal-body">
      <div class="form-group">
        <label>手机尾号（4位）</label>
        <input type="text" id="add-player-search" maxlength="4" inputmode="numeric" placeholder="输入尾号过滤，留空显示全部历史玩家">
      </div>
      <div id="add-player-list"></div>
      <div id="add-player-new"></div>
      <p id="add-player-count" style="font-size:13px;color:var(--text-secondary);margin-top:8px;"></p>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">取消</button>
      <button class="btn btn-primary" onclick="confirmAddPlayers()">确认添加</button>
    </div>`;
  const search = document.getElementById('add-player-search');
  search?.addEventListener('input', () => renderAddPlayerList(search.value));
  renderAddPlayerList('');
  document.getElementById('modal-overlay').classList.add('visible');
}

function renderAddPlayerList(filter = '') {
  const { allPlayers, selected } = window.addPlayersData || { allPlayers: [], selected: new Set() };
  const filtered = allPlayers.filter(p => (p.phoneLastFour || '').startsWith(filter));
  const isFullPhone = /^\d{4}$/.test(filter);
  const noMatch = isFullPhone && filtered.length === 0;

  const list = document.getElementById('add-player-list');
  if (list) {
    list.innerHTML = filtered.map(p => `
      <label class="add-player-row">
        <input type="checkbox" ${selected.has(p.id) ? 'checked' : ''} onchange="toggleAddPlayer(${p.id}, this.checked)">
        <span class="ap-name">${escapeHTML(p.nickname)}</span>
        <span class="ap-phone">(${escapeHTML(p.phoneLastFour)})</span>
      </label>`).join('') || `<div class="empty-state" style="padding:16px;">${isFullPhone ? '未找到该尾号的历史玩家' : '暂无历史玩家'}</div>`;
  }

  const newArea = document.getElementById('add-player-new');
  if (newArea) {
    newArea.innerHTML = noMatch ? `
      <div class="add-player-new">
        <div class="form-group">
          <label>全新玩家 · 昵称</label>
          <input type="text" id="add-player-nickname" maxlength="20" placeholder="输入昵称">
        </div>
        <button class="btn btn-secondary btn-sm" onclick="createNewPlayer()">新增该玩家</button>
      </div>` : '';
  }

  const count = document.getElementById('add-player-count');
  if (count) count.textContent = `已勾选 ${selected.size} 人，座位号可稍后在登记列表补填。`;
}

function toggleAddPlayer(id, checked) {
  const { selected } = window.addPlayersData || { selected: new Set() };
  if (checked) selected.add(id); else selected.delete(id);
  const count = document.getElementById('add-player-count');
  if (count) count.textContent = `已勾选 ${selected.size} 人，座位号可稍后在登记列表补填。`;
}

async function createNewPlayer() {
  const search = document.getElementById('add-player-search');
  const nicknameInput = document.getElementById('add-player-nickname');
  const phone = search?.value.trim() || '';
  const nickname = nicknameInput?.value.trim() || '';
  if (!/^\d{4}$/.test(phone)) return toast('请输入4位手机尾号');
  if (!nickname) return toast('请输入昵称');
  const { allPlayers, selected } = window.addPlayersData;
  const existing = await getPlayersByPhone(phone).catch(() => []);
  let id;
  if (existing.length) {
    id = existing[0].id;
  } else {
    id = await nextPlayerId();
    await addPlayer({ id, phoneLastFour: phone, nickname, createdAt: Date.now() }).catch(() => {});
  }
  if (!allPlayers.some(p => p.id === id)) {
    allPlayers.push({ id, phoneLastFour: phone, nickname, createdAt: Date.now() });
  }
  selected.add(id);
  // 新增成功后清空搜索框，回到默认全量列表（已勾选的玩家仍可见）
  if (search) search.value = '';
  renderAddPlayerList('');
}

async function confirmAddPlayers() {
  const { allPlayers, selected } = window.addPlayersData || { allPlayers: [], selected: new Set() };
  let added = 0;
  for (const id of selected) {
    const p = allPlayers.find(x => x.id === id);
    if (!p) continue;
    if (state.players.some(player => player.id === id)) continue; // 已登记跳过
    state.players.push({
      id, phoneLastFour: p.phoneLastFour, nickname: p.nickname, seat: '',
      inGame: true, eliminatedAt: null, eliminatedLevel: null, mushroomsUsed: 0, eliminationHistory: [], rebuySnapshot: null
    });
    await addPlayer({ id, phoneLastFour: p.phoneLastFour, nickname: p.nickname, createdAt: p.createdAt || Date.now() }).catch(() => {});
    added++;
  }
  closeModal();
  renderPlayers();
  if (!added) toast('没有新添加的玩家');
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
  const applyTemplate = () => {
    state.config.buyin = template.buyin;
    state.config.blinds = cloneBlinds(template.blinds);
    syncConfigInputs(); renderBlindTable();
    document.querySelectorAll('.template-card').forEach(card => card.classList.toggle('selected', card.querySelector('h3').textContent.includes(labels[name])));
  };
  showConfirm({ title: '加载模板', message: `加载${labels[name]}将覆盖买入筹码和盲注表，确认继续吗？`, confirmText: '继续', onConfirm: applyTemplate });
}

// ---- 屏幕常亮（Wake Lock）：计时期间阻止移动设备息屏 ----

let wakeLock = null;

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch (error) { /* 设备不支持或用户拒绝，静默忽略 */ }
}

async function releaseWakeLock() {
  try {
    if (wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch (error) { /* 忽略 */ }
}

async function startGame() {
  readConfig();
  if (state.config.prizeMode === 'custom' && state.config.customPrize.reduce((sum, ratio) => sum + ratio, 0) !== 100) return toast('自定义奖池比例合计必须为100%');
  if (state.players.length < 2) return toast('至少需要 2 人参赛');
  if (!state.config.blinds.length) return toast('至少需要一个盲注级别');
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
  const ring = document.getElementById('ring-progress');
  if (ring) {
    const circumference = 2 * Math.PI * 54;
    const total = currentLevelDuration();
    ring.style.strokeDasharray = `${circumference}`;
    ring.style.strokeDashoffset = `${circumference * (1 - (total ? remaining / total : 0))}`;
  }
  document.getElementById('game-elapsed').textContent = formatDuration(elapsedSeconds());
  const next = currentLevelAt(state.levelIndex + 1);
  document.getElementById('next-blinds').textContent = `${formatNumber(next.sb)} / ${formatNumber(next.bb)}`;
  const active = inGamePlayers().length;
  document.getElementById('info-players').textContent = active;
  document.getElementById('info-total').textContent = formatNumber(totalChips());
  document.getElementById('info-avg').textContent = formatNumber(active ? Math.floor(totalChips() / active) : 0);
  document.getElementById('info-ante').textContent = level.ante ? formatNumber(level.ante) : '—';
  document.getElementById('info-mushroom').textContent = `${Math.max(0, state.config.mushrooms - state.mushroomsUsed)}/${state.config.mushrooms}`;
  document.getElementById('ctrl-pause').innerHTML = state.running ? '⏸ 暂停 <span class="ctrl-key">空格</span>' : '▶ 开始 <span class="ctrl-key">空格</span>';
  document.getElementById('pause-overlay').classList.toggle('visible', !state.running);
  document.getElementById('ctrl-mushroom').disabled = !canUseMushroom();
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
    releaseWakeLock();
    addEvent('pause', '暂停倒计时');
  } else {
    state.running = true;
    state.levelStartedAt = Date.now();
    state.warningPlayed = false;
    requestWakeLock();
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
  if (state.mushroomsUsed >= state.config.mushrooms) return toast('蘑菇已用完');
  if (state.config.mushroomCutoff && state.levelIndex + 1 > state.config.mushroomCutoff) return toast('已超过蘑菇截止级别');
  openPlayerActionModal('mushroom');
}

function canUseMushroom() {
  return state.mushroomsUsed < state.config.mushrooms && (!state.config.mushroomCutoff || state.levelIndex + 1 <= state.config.mushroomCutoff) && state.players.some(player => !player.inGame);
}

function openPlayerActionModal(action) {
  const candidates = state.players.filter(player => action === 'eliminate' ? player.inGame : !player.inGame);
  if (!candidates.length) return toast(action === 'eliminate' ? '当前没有在场玩家' : '当前没有可复活的已淘汰玩家');
  if (action === 'mushroom' && !canUseMushroom()) return toast('当前无法使用蘑菇');
  modalAction = { type: action, id: candidates[0].id };
  const title = action === 'eliminate' ? '💀 确认淘汰' : '🍄 蘑菇复活';
  const button = action === 'eliminate' ? '确认淘汰' : '确认复活';
  const rows = candidates.map(player => `<li class="modal-player-item ${player.id === modalAction.id ? 'selected' : ''}" data-id="${player.id}" onclick="selectModalPlayer(${player.id})"><span>${action === 'eliminate' ? '🟢' : '⚫'}</span><b>${escapeHTML(player.nickname)}</b><span class="player-phone">(${escapeHTML(player.phoneLastFour)})</span></li>`).join('');
  document.getElementById('modal-content').innerHTML = `<div class="modal-header">${title}</div><div class="modal-body"><ul class="modal-player-list">${rows}</ul><p class="modal-info" id="modal-action-info"></p></div><div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">取消</button><button class="btn ${action === 'eliminate' ? 'btn-danger' : 'btn-primary'}" onclick="confirmPlayerAction()">${button}</button></div>`;
  document.getElementById('modal-overlay').classList.add('visible'); updateModalInfo();
}

function selectModalPlayer(id) {
  if (!modalAction) return;
  modalAction.id = Number(id);
  document.querySelectorAll('.modal-player-item').forEach(item => {
    const selected = Number(item.dataset.id) === modalAction.id;
    item.classList.toggle('selected', selected);
  });
  updateModalInfo();
}
function updateModalInfo() {
  const info = document.getElementById('modal-action-info');
  const player = state.players.find(item => item.id === modalAction?.id);
  if (info && player) info.textContent = modalAction.type === 'eliminate' ? `当前级别：${levelLabel()} · 比赛时间：${formatShortDuration(elapsedSeconds())}` : `复活筹码：${formatNumber(state.config.buyin)} · 剩余蘑菇：${state.config.mushrooms - state.mushroomsUsed}/${state.config.mushrooms}`;
}

function confirmPlayerAction() {
  const player = state.players.find(item => item.id === modalAction?.id);
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
  const row = player => `<div class="drawer-player ${player.inGame ? '' : 'is-eliminated'}"><div class="dp-info"><span class="dp-status ${player.inGame ? '' : 'eliminated'}"></span><div><div class="dp-name">${escapeHTML(player.nickname)}</div><div class="dp-phone">(${escapeHTML(player.phoneLastFour)})${player.seat ? ` · 座位${escapeHTML(player.seat)}` : ''}</div></div></div><div class="dp-actions">${player.inGame ? `${player.rebuySnapshot ? `<button class="btn btn-secondary btn-sm" onclick="undoMushroom(${player.id})">撤销蘑菇</button>` : ''}<button class="btn btn-danger btn-sm" onclick="drawerEliminate(${player.id})">💀</button>` : `<button class="btn btn-secondary btn-sm" onclick="drawerRestore(${player.id})">恢复在场</button>${canUseMushroom() ? `<button class="btn btn-primary btn-sm" onclick="drawerMushroom(${player.id})">🍄</button>` : ''}`}</div></div>`;
  body.innerHTML = `<div class="drawer-section-title">在场（${active.length}）</div>${active.map(row).join('') || '<div class="empty-state">暂无玩家</div>'}<div class="drawer-section-title">已淘汰（${out.length}）</div>${out.map(row).join('') || '<div class="empty-state">暂无玩家</div>'}`;
}
function drawerEliminate(id) { closeDrawer(); openPlayerActionModal('eliminate'); selectModalPlayer(id); }
function drawerMushroom(id) { closeDrawer(); openPlayerActionModal('mushroom'); selectModalPlayer(id); }
function drawerRestore(id) {
  const player = state.players.find(item => item.id === Number(id)); if (!player) return;
  player.inGame = true; player.eliminatedAt = null; player.eliminatedLevel = null; player.eliminationSequence = 0;
  addEvent('restore', `${player.nickname}(${player.phoneLastFour}) 恢复在场`); renderDrawer(); updateGameDisplay(); persistProgress();
}
function undoMushroom(id) {
  const player = state.players.find(item => item.id === Number(id)); const snapshot = player?.rebuySnapshot;
  if (!player || !snapshot) return;
  player.inGame = false; player.eliminatedAt = snapshot.eliminatedAt; player.eliminatedLevel = snapshot.eliminatedLevel; player.eliminationSequence = snapshot.eliminationSequence;
  player.mushroomsUsed = Math.max(0, player.mushroomsUsed - 1); state.mushroomsUsed = Math.max(0, state.mushroomsUsed - 1); player.rebuySnapshot = null;
  addEvent('mushroom-undo', `${player.nickname}(${player.phoneLastFour}) 撤销蘑菇复活 🍄（剩余${state.config.mushrooms - state.mushroomsUsed}/${state.config.mushrooms}）`);
  renderDrawer(); updateGameDisplay(); persistProgress();
}

// 「结束」入口：弹出菜单，可选「协商结束」或「取消比赛」
function showEndMenu() {
  const activeCount = inGamePlayers().length;
  const canChop = activeCount >= 2 && activeCount <= 3;
  const chopDisabled = canChop ? '' : 'disabled';
  document.getElementById('modal-content').innerHTML = `<div class="modal-header">🏁 结束比赛</div><div class="modal-body"><div class="end-menu"><button class="btn btn-secondary" onclick="showChopModal()" ${chopDisabled}>🤝 协商结束<span class="end-hint">${canChop ? '分奖池' : '仅剩 2-3 人可用'}</span></button><button class="btn btn-danger" onclick="showCancelConfirm()">✕ 取消比赛<span class="end-hint">不分配奖池</span></button></div><p class="modal-info">协商结束会按当前排名/比例分配奖池并计入历史；取消比赛则不分配、不计入历史，回到配置页。</p></div><div class="modal-footer"><button class="btn btn-ghost" onclick="closeModal()">返回</button></div>`;
  document.getElementById('modal-overlay').classList.add('visible');
}

// 取消比赛确认
function showCancelConfirm() {
  document.getElementById('modal-content').innerHTML = `<div class="modal-header">取消比赛</div><div class="modal-body"><p>确定要取消这场比赛？</p><p class="modal-info">取消后不分配奖池、不计入历史记录，对玩家数据无影响。比赛将从配置页重新开始。</p></div><div class="modal-footer"><button class="btn btn-secondary" onclick="showEndMenu()">返回</button><button class="btn btn-danger" onclick="cancelGame()">确认取消比赛</button></div>`;
}

// 取消比赛：清空比赛状态，不写历史，回到配置页
function cancelGame() {
  releaseWakeLock();
  clearProgress();
  state.players.forEach(player => { player.inGame = true; player.eliminatedAt = null; player.eliminatedLevel = null; player.eliminationSequence = 0; player.eliminationHistory = []; player.mushroomsUsed = 0; });
  state.levelIndex = 0; state.levelStartedAt = 0; state.levelElapsedBeforeRun = 0; state.elapsedBeforeRun = 0; state.gameStartedAt = 0; state.running = false; state.warningPlayed = false; state.mushroomsUsed = 0; state.eliminationSequence = 0; state.events = []; state.tournamentId = null; state.endReason = null; state.settlement = null; state.view = 'setup';
  closeModal(); renderPlayers(); showView('setup'); updateGameDisplay();
}

function showChopModal() {
  const active = inGamePlayers(); if (active.length < 2 || active.length > 3) return;
  const pool = state.config.totalPoints;
  document.getElementById('modal-content').innerHTML = `<div class="modal-header">🤝 协商结束</div><div class="modal-body"><div class="chop-method"><label><input type="radio" name="chop-method" value="equal" checked onchange="updateChopTable()"> 平分</label><label><input type="radio" name="chop-method" value="ratio" onchange="updateChopTable()"> 按当前筹码比例</label><label><input type="radio" name="chop-method" value="custom" onchange="updateChopTable()"> 自定义</label></div><table class="chop-table"><thead><tr><th>最终名次</th><th>玩家</th><th>当前筹码</th><th>分得积分</th></tr></thead><tbody id="chop-body"></tbody></table><div class="chop-total">积分参考：${formatNumber(pool)}</div></div><div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">取消</button><button class="btn btn-primary" onclick="confirmChop()">确认结束比赛</button></div>`;
  document.getElementById('modal-overlay').classList.add('visible'); updateChopTable();
}
function updateChopTable() {
  const method = document.querySelector('input[name="chop-method"]:checked')?.value || 'equal';
  const players = inGamePlayers(); const pool = state.config.totalPoints; const each = players.length ? Math.floor(pool / players.length) : 0;
  if (method === 'ratio' && document.querySelector('.chop-current:not([readonly])')) {
    const currents = Array.from(document.querySelectorAll('.chop-current')).map(input => Math.max(0, Number(input.value) || 0));
    const currentTotal = currents.reduce((sum, value) => sum + value, 0);
    document.querySelectorAll('.chop-prize').forEach((input, index) => { input.value = currentTotal ? Math.floor(pool * currents[index] / currentTotal) : 0; });
    return;
  }
  const previousRanks = new Map(Array.from(document.querySelectorAll('.chop-rank')).map(input => [input.dataset.id, input.value]));
  const previousCurrent = new Map(Array.from(document.querySelectorAll('.chop-current')).map(input => [input.dataset.id, input.value]));
  const previousPrize = new Map(Array.from(document.querySelectorAll('.chop-prize')).map(input => [input.dataset.id, input.value]));
  const body = document.getElementById('chop-body'); if (!body) return;
  body.innerHTML = players.map((player, index) => `<tr><td><input class="chop-rank" data-id="${player.id}" type="number" min="1" max="${players.length}" value="${previousRanks.get(String(player.id)) ?? index + 1}"></td><td>${escapeHTML(player.nickname)}</td><td><input class="chop-current" data-id="${player.id}" type="number" min="0" value="${previousCurrent.get(String(player.id)) ?? state.config.buyin}" ${method === 'ratio' ? '' : 'readonly'} oninput="updateChopTable()"></td><td><input class="chop-prize" data-id="${player.id}" type="number" min="0" value="${previousPrize.get(String(player.id)) ?? each}" ${method === 'custom' ? '' : 'readonly'}></td></tr>`).join('');
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
  document.querySelectorAll('.chop-prize').forEach(input => { prizes[input.dataset.id] = Math.max(0, Number(input.value) || 0); });
  document.querySelectorAll('.chop-rank').forEach(input => { chopRanks[input.dataset.id] = Number(input.value); });
  const ranks = Object.values(chopRanks); const activeCount = inGamePlayers().length;
  if (ranks.length !== activeCount || new Set(ranks).size !== activeCount || ranks.some(rank => !Number.isInteger(rank) || rank < 1 || rank > activeCount)) return toast(`请为 ${activeCount} 名协商玩家填写不重复的最终名次`);
  const total = Object.values(prizes).reduce((sum, value) => sum + value, 0);
  const requestChop = () => { state.settlement = { prizes, chopRanks }; state.endReason = 'chop'; addEvent('chop', '协商结束比赛'); closeModal(); finishGame('chop'); };
  if (total !== state.config.totalPoints) {
    showConfirm({ title: '结束比赛', message: `分配合计 ${formatNumber(total)} 与积分参考 ${formatNumber(state.config.totalPoints)} 不一致，仍要结束比赛吗？`, confirmText: '结束', danger: true, onConfirm: requestChop });
  } else {
    requestChop();
  }
}

function finishGame(reason) {
  if (state.view === 'settlement') return;
  const finalElapsed = elapsedSeconds();
  const finalLevelElapsed = currentLevelElapsedSeconds();
  state.running = false; state.elapsedBeforeRun = finalElapsed; state.levelElapsedBeforeRun = finalLevelElapsed; state.levelStartedAt = 0; state.endReason = reason;
  releaseWakeLock();
  if (!state.settlement) state.settlement = { prizes: calculateNaturalPrizes() };
  const rankings = buildRankings();
  const tournament = { id: state.tournamentId, name: state.config.name, date: new Date().toISOString(), config: JSON.parse(JSON.stringify(state.config)), totalPrizePool: totalChips(), durationMinutes: state.elapsedBeforeRun / 60, finalLevel: state.levelIndex + 1, mushroomsUsed: state.mushroomsUsed, endReason: reason, events: state.events, rankings };
  addTournament(tournament).then(() => addParticipations(rankings.map(item => ({ tournamentId: state.tournamentId, playerId: item.playerId, finalRank: item.rank, eliminatedAt: item.eliminatedAt, eliminatedAtLevel: item.eliminatedLevel, mushroomsUsed: item.mushroomsUsed, prizePoints: item.prizePoints })))).catch(error => console.error('保存比赛失败:', error));
  clearProgress(); playGameEnd(); renderSettlement(tournament, rankings); showView('settlement'); showExportPrompt(tournament);
}

function buildRankings() {
  const chopRanks = state.settlement?.chopRanks || {};
  const active = state.players.filter(player => player.inGame).sort((a, b) => (chopRanks[a.id] || Infinity) - (chopRanks[b.id] || Infinity));
  const eliminated = state.players.filter(player => !player.inGame).sort((a, b) => (b.eliminationSequence || 0) - (a.eliminationSequence || 0));
  const ordered = [...active, ...eliminated];
  const prizes = state.settlement?.prizes || {};
  return ordered.map((player, index) => ({ ...player, playerId: player.id, rank: index + 1, prizePoints: prizes[player.id] || 0, eliminatedAt: player.inGame ? null : player.eliminatedAt, eliminatedAtLevel: player.inGame ? null : player.eliminatedLevel }));
}
function calculateNaturalPrizes() {
  const rankings = buildRankings();
  const ratios = state.config.prizeMode === 'custom' ? state.config.customPrize : (PRIZE_RATIOS[state.config.prizeMode] || PRIZE_RATIOS['top3-50']);
  const prizes = {};
  ratios.forEach((ratio, index) => { const player = rankings[index]; if (player) prizes[player.id] = Math.floor(state.config.totalPoints * ratio / 100); });
  return prizes;
}
function renderPrizePreview() {
  const container = document.getElementById('prize-preview'); if (!container) return;
  const ratios = state.config.prizeMode === 'custom' ? state.config.customPrize : (PRIZE_RATIOS[state.config.prizeMode] || PRIZE_RATIOS['top3-50']);
  container.innerHTML = `<h4>积分分配</h4>${ratios.map((ratio, index) => `<div class="prize-row"><span class="prize-rank">第 ${index + 1} 名 · ${ratio}%</span><span class="prize-amount">${formatNumber(Math.floor(state.config.totalPoints * ratio / 100))}</span></div>`).join('')}`;
}

function renderSettlement(tournament, rankings) {
  const view = document.getElementById('view-settlement');
  view.innerHTML = `<div class="settlement-header"><div class="trophy">🏆</div><h2>比赛结束</h2><p>${escapeHTML(tournament.name)} · ${new Date(tournament.date).toLocaleDateString('zh-CN')}</p></div><div class="settlement-body"><div class="settlement-left"><div class="stat-card"><table class="rank-table"><thead><tr><th>排名</th><th>玩家</th><th>淘汰时间</th><th>蘑菇</th><th>积分</th></tr></thead><tbody id="rankings-body">${rankings.map(item => settlementRow(item)).join('')}</tbody></table></div><div class="event-log"><h4>事件日志</h4>${state.events.map(event => `<div class="event-entry"><span class="event-time">[${formatShortDuration(event.time)}]</span> ${escapeHTML(event.detail)}</div>`).join('')}</div></div><div class="settlement-right"><div class="stat-card"><div class="stat-label">比赛时长</div><div class="stat-value">${formatDuration(tournament.durationMinutes * 60)}</div></div><div class="stat-card"><div class="stat-label">经过级别</div><div class="stat-value">${tournament.finalLevel}</div></div><div class="stat-card"><div class="stat-label">蘑菇使用</div><div class="stat-value">${tournament.mushroomsUsed}/${state.config.mushrooms}</div></div><div class="stat-card"><div class="stat-label">总筹码池</div><div class="stat-value">${formatNumber(tournament.totalPrizePool)}</div></div><div class="stat-card"><div class="stat-label">总积分</div><div class="stat-value">${formatNumber(state.config.totalPoints)}</div></div><div class="settlement-actions"><button class="btn btn-secondary" onclick="exportCurrentTournament()">导出 JSON</button><button class="btn btn-secondary" onclick="showHistory()">查看排行榜</button><button class="btn btn-primary" onclick="newGame()">开始新比赛</button></div></div></div>`;
}
function settlementRow(item) { const medal = item.rank === 1 ? '🥇' : item.rank === 2 ? '🥈' : item.rank === 3 ? '🥉' : item.rank; return `<tr><td class="rank-medal">${medal}</td><td>${escapeHTML(item.nickname)} <small>(${escapeHTML(item.phoneLastFour)})</small></td><td>${item.eliminatedAt == null ? '冠军/协商' : formatShortDuration(item.eliminatedAt)}</td><td>${item.mushroomsUsed || 0}</td><td class="rank-prize"><input type="number" min="0" value="${item.prizePoints}" onchange="changePrize(${item.id}, this.value)"></td></tr>`; }
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
async function changePrize(id, value) {
  if (!state.settlement) return;
  const key = String(id);
  state.settlement.prizes[key] = Math.max(0, Number(value) || 0);
  if (state.tournamentId) {
    const tournament = await getTournament(state.tournamentId).catch(() => null);
    if (!tournament?.rankings) return;
    const item = tournament.rankings.find(row => row.playerId === Number(id));
    if (item) item.prizePoints = state.settlement.prizes[key];
    await addTournament(tournament).catch(() => {});
    await addParticipations(tournament.rankings.map(row => ({ tournamentId: tournament.id, playerId: row.playerId, finalRank: row.rank, eliminatedAt: row.eliminatedAt, eliminatedAtLevel: row.eliminatedLevel, mushroomsUsed: row.mushroomsUsed, prizePoints: row.prizePoints }))).catch(() => {});
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
async function importFile() { const file = document.getElementById('import-file').files[0]; if (!file) return toast('请选择 JSON 文件'); try { await importAllData(JSON.parse(await file.text())); closeModal(); toast('导入成功'); } catch (error) { toast(`导入失败：${error.message}`, 'error'); } }
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

// ---- 深色 Toast 提示（替代原生 alert） ----
function toast(message, type = 'default') {
  const container = document.getElementById('toast-container');
  if (!container) { console.warn('[toast] missing container', message); return; }
  const el = document.createElement('div');
  el.className = `toast${type === 'error' ? ' error' : ''}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
    el.style.opacity = '0';
    el.style.transform = 'translateY(8px)';
    setTimeout(() => el.remove(), 200);
  }, 2500);
}

// ---- 深色确认模态（替代原生 confirm） ----
function showConfirm({ title = '确认', message, confirmText = '确定', cancelText = '取消', danger = false, onConfirm }) {
  const content = document.getElementById('modal-content');
  content.innerHTML = `<div class="modal-header">${escapeHTML(title)}</div><div class="modal-body"><p>${message}</p></div><div class="modal-footer"><button class="btn btn-ghost" onclick="closeModal()">${escapeHTML(cancelText)}</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="confirm-ok">${escapeHTML(confirmText)}</button></div>`;
  document.getElementById('modal-overlay').classList.add('visible');
  document.getElementById('confirm-ok').onclick = () => { closeModal(); if (typeof onConfirm === 'function') onConfirm(); };
}

function restorePrompt() {
  const progress = loadProgress(); if (!progress) return;
  document.getElementById('modal-content').innerHTML = `<div class="modal-header">发现未完成的比赛</div><div class="modal-body"><p class="recover-info">检测到一场未完成的「${escapeHTML(progress.config?.name || '友谊赛')}」，是否恢复？</p></div><div class="modal-footer"><button class="btn btn-secondary" onclick="discardRecovery()">放弃</button><button class="btn btn-primary" onclick="restoreGame()">恢复比赛</button></div>`;
  document.getElementById('modal-overlay').classList.add('visible'); window.pendingProgress = progress;
}
function discardRecovery() { clearProgress(); closeModal(); }
async function restoreGame() {
  Object.assign(state, window.pendingProgress);
  state.levelElapsedBeforeRun = state.levelElapsedBeforeRun || 0;
  state.eliminationSequence = state.eliminationSequence || 0;
  state.events = state.events || [];
  // 兼容旧进度：为缺 id 的玩家按尾号回填编号（查不到则分配新 id）
  const players = state.players || [];
  for (const player of players) {
    if (player.id != null) continue;
    const matches = await getPlayersByPhone(player.phoneLastFour).catch(() => []);
    player.id = matches.length ? matches[0].id : await nextPlayerId();
  }
  state.players = players.map(player => ({ ...player, inGame: player.inGame !== false, mushroomsUsed: player.mushroomsUsed || 0, eliminationHistory: player.eliminationHistory || [], eliminationSequence: player.eliminationSequence || 0, rebuySnapshot: player.rebuySnapshot || null }));
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

// 页面重新可见时，若比赛仍在计时则重新请求常亮（切后台会自动失效）
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.view === 'game' && state.running) {
    requestWakeLock();
  }
});

document.addEventListener('DOMContentLoaded', async () => {
  try { await initDB(); } catch (error) { console.warn('IndexedDB 不可用，将仅使用当前页面数据:', error); }
  initSetup();
  restorePrompt();
});
