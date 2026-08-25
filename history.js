// ============================================================
// history.js — 历史数据、排行榜与玩家战绩查询
// ============================================================

async function showHistory() {
  const tournaments = await getAllTournaments().catch(() => []);
  const players = await getAllPlayers().catch(() => []);
  window.historyTournaments = tournaments.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  window.historyPlayers = players;
  window.historyParticipations = [];
  for (const tournament of tournaments) {
    window.historyParticipations.push(...(await getParticipationsByTournament(tournament.id).catch(() => [])));
  }
  const view = document.getElementById('view-history');
  view.innerHTML = `<div class="history-header"><button class="btn btn-ghost" onclick="showView('setup')">← 返回</button><h2>历史数据</h2></div><div class="history-tabs"><button class="history-tab active" data-history-tab="leaderboard">排行榜</button><button class="history-tab" data-history-tab="tournaments">比赛历史</button><button class="history-tab" data-history-tab="player">玩家查询</button></div><div id="history-content"></div>`;
  document.querySelectorAll('.history-tab').forEach(tab => tab.addEventListener('click', () => {
    document.querySelectorAll('.history-tab').forEach(item => item.classList.toggle('active', item === tab));
    renderHistoryTab(tab.dataset.historyTab);
  }));
  renderHistoryTab('leaderboard');
  showView('history');
}

function renderHistoryTab(tab) {
  const content = document.getElementById('history-content');
  if (!content) return;
  if (tab === 'leaderboard') {
    content.innerHTML = `<div class="leaderboard-tabs"><button class="lb-tab active" data-board="chips">总筹码榜</button><button class="lb-tab" data-board="wins">胜率榜</button><button class="lb-tab" data-board="games">常客榜</button><button class="lb-tab" data-board="top3">前三率榜</button></div><div id="leaderboard-content"></div>`;
    document.querySelectorAll('.lb-tab').forEach(button => button.addEventListener('click', () => {
      document.querySelectorAll('.lb-tab').forEach(item => item.classList.toggle('active', item === button));
      renderLeaderboard(button.dataset.board);
    }));
    renderLeaderboard('chips');
  } else if (tab === 'tournaments') {
    const tournaments = window.historyTournaments || [];
    content.innerHTML = `<ul class="tournament-list">${tournaments.map(t => `<li class="tournament-item" onclick="showTournamentDetail('${t.id}')"><div class="t-header"><span class="t-name">${escapeHTML(t.name)}</span><span class="t-date">${new Date(t.date).toLocaleDateString('zh-CN')}</span></div><div class="t-stats">${t.rankings?.length || 0}人 · ${formatNumber(t.totalPrizePool)} 筹码 · ${t.endReason === 'chop' ? '协商结束' : '自然结束'}</div></li>`).join('') || '<li class="empty-state">暂无历史比赛</li>'}</ul>`;
  } else {
    content.innerHTML = `<form class="player-search-form" onsubmit="searchPlayerHistory(event)"><input id="history-player-phone" type="text" inputmode="numeric" maxlength="4" placeholder="输入手机尾号（4位）"><button class="btn btn-primary" type="submit">查询</button></form><div id="player-search-result" class="empty-state">输入手机尾号查询玩家战绩</div>`;
  }
}

function renderLeaderboard(board) {
  const players = window.historyPlayers || [];
  const records = window.historyParticipations || [];
  const data = players.map(player => {
    const rows = records.filter(row => row.playerId === player.id);
    const wins = rows.filter(row => row.finalRank === 1).length;
    const top3 = rows.filter(row => row.finalRank <= 3).length;
    return { player, games: rows.length, wins, top3, chips: rows.reduce((sum, row) => sum + (row.prizeChips || 0), 0) };
  }).filter(item => item.games).sort((a, b) => board === 'chips' ? b.chips - a.chips : board === 'wins' ? (b.wins / b.games) - (a.wins / a.games) : board === 'games' ? b.games - a.games : (b.top3 / b.games) - (a.top3 / a.games));
  const content = document.getElementById('leaderboard-content');
  if (!content) return;
  content.innerHTML = `<ul class="leaderboard-list">${data.map((item, index) => `<li class="lb-item"><span class="lb-rank rank-${index + 1}">${index + 1}</span><div class="lb-info"><div class="lb-name">${escapeHTML(item.player.nickname)} (${escapeHTML(item.player.phoneLastFour)})</div><div class="lb-stats">${item.games}场 · ${item.wins}冠 · 前三${item.top3}次</div></div><span class="lb-value">${board === 'chips' ? formatNumber(item.chips) : board === 'wins' ? `${Math.round(item.wins / item.games * 100)}%` : board === 'games' ? item.games : `${Math.round(item.top3 / item.games * 100)}%`}</span></li>`).join('') || '<li class="empty-state">暂无数据</li>'}</ul>`;
}

async function searchPlayerHistory(event) {
  event.preventDefault();
  const phone = document.getElementById('history-player-phone')?.value.trim() || '';
  const result = document.getElementById('player-search-result');
  if (!/^\d{4}$/.test(phone)) { result.textContent = '请输入 4 位手机尾号'; return; }
  // 按尾号查玩家档案（撞号时可能多个）
  const matches = await getPlayersByPhone(phone).catch(() => []);
  if (!matches.length) { result.textContent = '未找到该尾号的历史玩家'; return; }
  const tournaments = new Map((window.historyTournaments || []).map(item => [item.id, item]));
  const records = window.historyParticipations || [];
  result.className = '';
  result.innerHTML = matches.map(player => {
    const rows = records.filter(item => item.playerId === player.id);
    if (!rows.length) return `<div class="player-stats-card"><h3>${escapeHTML(player.nickname)} (${escapeHTML(player.phoneLastFour)})</h3><div class="empty-state">暂无参赛记录</div></div>`;
    const wins = rows.filter(item => item.finalRank === 1).length;
    const top3 = rows.filter(item => item.finalRank <= 3).length;
    const chips = rows.reduce((sum, item) => sum + (item.prizeChips || 0), 0);
    const mushrooms = rows.reduce((sum, item) => sum + (item.mushroomsUsed || 0), 0);
    const averageRank = rows.reduce((sum, item) => sum + item.finalRank, 0) / rows.length;
    return `<div class="player-stats-card"><h3>${escapeHTML(player.nickname)} (${escapeHTML(player.phoneLastFour)})</h3><div class="ps-grid"><div class="ps-item"><div class="ps-value">${rows.length}</div><div class="ps-label">参赛次数</div></div><div class="ps-item"><div class="ps-value">${wins}/${top3}</div><div class="ps-label">冠军 / 前三</div></div><div class="ps-item"><div class="ps-value">${formatNumber(chips)}</div><div class="ps-label">总奖励筹码</div></div><div class="ps-item"><div class="ps-value">${averageRank.toFixed(1)}</div><div class="ps-label">平均排名</div></div><div class="ps-item"><div class="ps-value">${mushrooms}</div><div class="ps-label">蘑菇使用</div></div></div><h4 class="recent-games-title">最近比赛</h4><ul class="tournament-list">${rows.sort((a, b) => String(tournaments.get(b.tournamentId)?.date || '').localeCompare(String(tournaments.get(a.tournamentId)?.date || ''))).map(item => { const tournament = tournaments.get(item.tournamentId); return `<li class="tournament-item" onclick="showTournamentDetail('${item.tournamentId}')"><div class="t-header"><span class="t-name">${escapeHTML(tournament?.name || item.tournamentId)}</span><span class="t-date">${tournament?.date ? new Date(tournament.date).toLocaleDateString('zh-CN') : '—'}</span></div><div class="t-stats">第 ${item.finalRank} 名 · 奖励 ${formatNumber(item.prizeChips)} · 蘑菇 ${item.mushroomsUsed || 0}</div></li>`; }).join('')}</ul></div>`;
  }).join('');
}

async function showTournamentDetail(id) {
  const tournament = await getTournament(id);
  if (!tournament) return;
  const view = document.getElementById('view-history');
  const rankings = tournament.rankings || [];
  view.innerHTML = `<div class="history-header"><button class="btn btn-ghost" onclick="showHistory()">← 返回</button><h2>比赛详情</h2></div><div class="tournament-detail"><h3>${escapeHTML(tournament.name)} · ${new Date(tournament.date).toLocaleDateString('zh-CN')}</h3><p>总筹码：${formatNumber(tournament.totalPrizePool)} · 时长：${formatDuration(tournament.durationMinutes * 60)} · 蘑菇：${tournament.mushroomsUsed}</p><table class="rank-table"><thead><tr><th>排名</th><th>玩家</th><th>淘汰时间</th><th>淘汰级别</th><th>蘑菇</th><th>奖励筹码</th></tr></thead><tbody>${rankings.map(item => `<tr><td>${item.rank}</td><td>${escapeHTML(item.nickname)} (${escapeHTML(item.phoneLastFour)})</td><td>${item.eliminatedAt == null ? '冠军/协商' : formatShortDuration(item.eliminatedAt)}</td><td>${item.eliminatedAtLevel || '—'}</td><td>${item.mushroomsUsed || 0}</td><td class="rank-prize">${formatNumber(item.prizeChips)}</td></tr>`).join('')}</tbody></table><div class="event-log"><h4>事件日志</h4>${(tournament.events || []).map(event => `<div class="event-entry">[${formatShortDuration(event.time)}] ${escapeHTML(event.detail)}</div>`).join('')}</div></div>`;
  showView('history');
}
