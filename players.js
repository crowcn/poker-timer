// ============================================================
// players.js — 玩家管理页（列表 / 详情 / 编辑 / 删除）
// ============================================================

let playersBoard = 'chips';

// 加载玩家、比赛、参赛记录到 window.playersData
async function loadPlayersData() {
  const players = await getAllPlayers().catch(() => []);
  const tournaments = await getAllTournaments().catch(() => []);
  const records = [];
  for (const t of tournaments) {
    records.push(...(await getParticipationsByTournament(t.id).catch(() => [])));
  }
  window.playersData = { players, tournaments, records };
}

// 入口：打开玩家管理页
async function showPlayers() {
  await loadPlayersData();
  showView('players');
  renderPlayersList(playersBoard);
}

// 聚合单个玩家的战绩
function buildPlayerStats(records) {
  return (player) => {
    const rows = records.filter(r => r.playerId === player.id);
    return {
      player,
      games: rows.length,
      wins: rows.filter(r => r.finalRank === 1).length,
      top3: rows.filter(r => r.finalRank <= 3).length,
      chips: rows.reduce((sum, r) => sum + (r.prizeChips || 0), 0)
    };
  };
}

// 排序：有战绩的按指标排，没战绩的排最后
function sortPlayersData(data, board) {
  return data.sort((a, b) => {
    if ((a.games === 0) !== (b.games === 0)) return a.games === 0 ? 1 : -1;
    if (board === 'chips') return b.chips - a.chips;
    if (board === 'games') return b.games - a.games;
    if (board === 'wins') return (b.wins / b.games) - (a.wins / a.games);
    if (board === 'top3') return (b.top3 / b.games) - (a.top3 / a.games);
    return b.chips - a.chips;
  });
}

// 渲染玩家列表
function renderPlayersList(board = 'chips') {
  playersBoard = board;
  const view = document.getElementById('view-players');
  if (!view) return;
  const { players, records } = window.playersData || { players: [], records: [] };
  const data = sortPlayersData(players.map(buildPlayerStats(records)), board);

  const boards = [
    ['chips', '总筹码榜'],
    ['games', '常客榜'],
    ['wins', '胜率榜'],
    ['top3', '前三率榜']
  ];

  view.innerHTML = `
    <div class="history-header">
      <button class="btn btn-ghost" onclick="showView('setup')">← 返回</button>
      <h2>玩家管理</h2>
    </div>
    <div class="leaderboard-tabs">
      ${boards.map(([key, label]) => `<button class="lb-tab ${board === key ? 'active' : ''}" onclick="renderPlayersList('${key}')">${label}</button>`).join('')}
    </div>
    <ul class="leaderboard-list">
      ${data.map((item, index) => {
        const p = item.player;
        const winRate = item.games ? Math.round(item.wins / item.games * 100) : 0;
        const value = board === 'chips' ? formatNumber(item.chips)
          : board === 'games' ? `${item.games}场`
          : board === 'wins' ? `${winRate}%`
          : `${item.top3}次`;
        return `<li class="lb-item" onclick="showPlayerDetail(${p.id})" style="cursor:pointer;">
          <span class="lb-rank rank-${index + 1}">${index + 1}</span>
          <div class="lb-info">
            <div class="lb-name">${escapeHTML(p.nickname)} (${escapeHTML(p.phoneLastFour)})</div>
            <div class="lb-stats">${item.games}场 · ${item.wins}冠 · 前三${item.top3}次 · 胜率${winRate}%</div>
          </div>
          <span class="lb-value">${value}</span>
        </li>`;
      }).join('') || '<li class="empty-state">暂无玩家，请先在比赛中登记或导入备份</li>'}
    </ul>`;
}

// 渲染玩家详情
function showPlayerDetail(id) {
  const view = document.getElementById('view-players');
  if (!view) return;
  const { players, records, tournaments } = window.playersData || { players: [], records: [], tournaments: [] };
  const player = players.find(p => p.id === id);
  if (!player) return;

  const rows = records.filter(r => r.playerId === id);
  const wins = rows.filter(r => r.finalRank === 1).length;
  const top3 = rows.filter(r => r.finalRank <= 3).length;
  const chips = rows.reduce((sum, r) => sum + (r.prizeChips || 0), 0);
  const mushrooms = rows.reduce((sum, r) => sum + (r.mushroomsUsed || 0), 0);
  const avgRank = rows.length ? (rows.reduce((sum, r) => sum + r.finalRank, 0) / rows.length).toFixed(1) : '—';
  const tMap = new Map(tournaments.map(t => [t.id, t]));

  view.innerHTML = `
    <div class="history-header">
      <button class="btn btn-ghost" onclick="renderPlayersList()">← 返回</button>
      <h2>玩家详情</h2>
    </div>
    <div class="player-stats-card">
      <div class="player-card-head">
        <h3>${escapeHTML(player.nickname)} <small>(${escapeHTML(player.phoneLastFour)})</small></h3>
        <div class="player-card-actions">
          <button class="btn btn-secondary btn-sm" onclick="showPlayerEdit(${player.id})">编辑</button>
          <button class="btn btn-danger btn-sm" onclick="showPlayerDelete(${player.id})">删除</button>
        </div>
      </div>
      <div class="ps-grid">
        <div class="ps-item"><div class="ps-value">${rows.length}</div><div class="ps-label">参赛次数</div></div>
        <div class="ps-item"><div class="ps-value">${wins}/${top3}</div><div class="ps-label">冠军 / 前三</div></div>
        <div class="ps-item"><div class="ps-value">${formatNumber(chips)}</div><div class="ps-label">总奖励筹码</div></div>
        <div class="ps-item"><div class="ps-value">${avgRank}</div><div class="ps-label">平均排名</div></div>
        <div class="ps-item"><div class="ps-value">${mushrooms}</div><div class="ps-label">蘑菇使用</div></div>
      </div>
      <h4 class="recent-games-title">最近比赛</h4>
      <ul class="tournament-list">
        ${rows.sort((a, b) => String(tMap.get(b.tournamentId)?.date || '').localeCompare(String(tMap.get(a.tournamentId)?.date || ''))).map(item => {
          const t = tMap.get(item.tournamentId);
          return `<li class="tournament-item" onclick="showTournamentDetail('${item.tournamentId}')">
            <div class="t-header"><span class="t-name">${escapeHTML(t?.name || item.tournamentId)}</span><span class="t-date">${t?.date ? new Date(t.date).toLocaleDateString('zh-CN') : '—'}</span></div>
            <div class="t-stats">第 ${item.finalRank} 名 · 奖励 ${formatNumber(item.prizeChips)} · 蘑菇 ${item.mushroomsUsed || 0}</div>
          </li>`;
        }).join('') || '<li class="empty-state">暂无参赛记录</li>'}
      </ul>
    </div>`;
}

// 编辑玩家弹窗
function showPlayerEdit(id) {
  const { players } = window.playersData || { players: [] };
  const player = players.find(p => p.id === id);
  if (!player) return;
  document.getElementById('modal-content').innerHTML = `
    <div class="modal-header">编辑玩家</div>
    <div class="modal-body">
      <div class="form-group">
        <label>昵称</label>
        <input type="text" id="edit-nickname" value="${escapeHTML(player.nickname)}" maxlength="20">
      </div>
      <div class="form-group">
        <label>手机尾号（4位）</label>
        <input type="text" id="edit-phone" value="${escapeHTML(player.phoneLastFour)}" maxlength="4" inputmode="numeric">
      </div>
      <p style="font-size:13px;color:var(--text-secondary);">修改尾号不影响该玩家的历史战绩。</p>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">取消</button>
      <button class="btn btn-primary" onclick="savePlayerEdit(${player.id})">保存</button>
    </div>`;
  document.getElementById('modal-overlay').classList.add('visible');
}

// 保存编辑
async function savePlayerEdit(id) {
  const nickname = document.getElementById('edit-nickname')?.value.trim() || '';
  const phone = document.getElementById('edit-phone')?.value.trim() || '';
  if (!nickname) { toast('请输入昵称'); return; }
  if (!/^\d{4}$/.test(phone)) { toast('请输入 4 位手机尾号'); return; }
  const { players } = window.playersData || { players: [] };
  const player = players.find(p => p.id === id);
  if (!player) return;
  await addPlayer({ id, phoneLastFour: phone, nickname, createdAt: player.createdAt }).catch(() => {});
  closeModal();
  await loadPlayersData();
  showPlayerDetail(id);
}

// 删除确认弹窗
function showPlayerDelete(id) {
  const { players } = window.playersData || { players: [] };
  const player = players.find(p => p.id === id);
  if (!player) return;
  document.getElementById('modal-content').innerHTML = `
    <div class="modal-header">删除玩家</div>
    <div class="modal-body">
      <p class="modal-info">确认删除玩家「${escapeHTML(player.nickname)} (${escapeHTML(player.phoneLastFour)})」？</p>
      <p class="modal-info" style="color:var(--text-secondary);font-size:13px;">删除仅移除玩家档案（不再出现在玩家列表、排行榜、玩家查询中）。该玩家已参加的历史比赛，其名次与当时的昵称快照仍会保留。</p>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">取消</button>
      <button class="btn btn-danger" onclick="confirmPlayerDelete(${player.id})">确认删除</button>
    </div>`;
  document.getElementById('modal-overlay').classList.add('visible');
}

// 执行删除
async function confirmPlayerDelete(id) {
  await deletePlayer(id).catch(() => {});
  closeModal();
  await loadPlayersData();
  renderPlayersList(playersBoard);
}
