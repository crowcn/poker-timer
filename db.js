// ============================================================
// db.js — IndexedDB 数据层 + localStorage 进度保存
//
// v2 数据模型：玩家用独立编号 id 作主键，手机尾号降级为普通属性
//   - players：keyPath 'id'，索引 byPhone(phoneLastFour)
//   - participations：复合主键 [tournamentId, playerId]
//   - tournaments：keyPath 'id'，rankings 快照含 playerId + nickname + phoneLastFour
// ============================================================

const DB_NAME = 'poker-timer';
const DB_VERSION = 2;
let db = null;

// ---- IndexedDB 初始化 ----

function initDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const database = e.target.result;
      if (e.oldVersion === 0) {
        // 全新安装：直接建 v2 结构
        createV2Schema(database);
      } else if (e.oldVersion < 2) {
        // v1 → v2：迁移旧数据（尾号主键 → 独立 id 主键）
        migrateV1toV2(database, e.target.transaction);
      }
    };
    req.onsuccess = (e) => {
      db = e.target.result;
      resolve(db);
    };
    req.onerror = (e) => {
      console.error('IndexedDB 初始化失败:', e.target.error);
      reject(e.target.error);
    };
  });
}

// 建 v2 三张表（全新安装或迁移重建时调用）
function createV2Schema(database) {
  if (!database.objectStoreNames.contains('players')) {
    const playersStore = database.createObjectStore('players', { keyPath: 'id' });
    playersStore.createIndex('byPhone', 'phoneLastFour', { unique: false });
  }
  if (!database.objectStoreNames.contains('participations')) {
    const participationsStore = database.createObjectStore('participations', {
      keyPath: ['tournamentId', 'playerId']
    });
    participationsStore.createIndex('byTournament', 'tournamentId', { unique: false });
    participationsStore.createIndex('byPlayer', 'playerId', { unique: false });
  }
  if (!database.objectStoreNames.contains('tournaments')) {
    database.createObjectStore('tournaments', { keyPath: 'id' });
  }
}

// v1 → v2 迁移：读旧三表 → 建尾号→id 映射 → 删旧建新 → 写回
function migrateV1toV2(database, tx) {
  const playersReq = tx.objectStore('players').getAll();
  const partsReq = tx.objectStore('participations').getAll();
  const tournsReq = tx.objectStore('tournaments').getAll();

  let players = [], parts = [], tourns = [];
  let pending = 3;

  const finish = () => {
    // 尾号 → id 映射（按顺序分配 id = 1,2,3…）
    const idMap = {};
    players.forEach((p, i) => { idMap[p.phoneLastFour] = i + 1; });

    database.deleteObjectStore('players');
    database.deleteObjectStore('participations');
    database.deleteObjectStore('tournaments');
    createV2Schema(database);

    const playersStore = tx.objectStore('players');
    const partsStore = tx.objectStore('participations');
    const tournsStore = tx.objectStore('tournaments');

    players.forEach((p, i) => {
      playersStore.put({ id: i + 1, phoneLastFour: p.phoneLastFour, nickname: p.nickname, createdAt: p.createdAt });
    });

    parts.forEach(part => {
      const playerId = idMap[part.phoneLastFour];
      if (!playerId) return; // 尾号对不上，丢弃这条孤记录
      partsStore.put({
        tournamentId: part.tournamentId,
        playerId,
        finalRank: part.finalRank,
        eliminatedAt: part.eliminatedAt,
        eliminatedAtLevel: part.eliminatedAtLevel,
        mushroomsUsed: part.mushroomsUsed,
        prizeChips: part.prizeChips
      });
    });

    tourns.forEach(t => {
      t.rankings = (t.rankings || []).map(r => ({ ...r, playerId: idMap[r.phoneLastFour] ?? null }));
      tournsStore.put(t);
    });
  };

  playersReq.onsuccess = () => { players = playersReq.result || []; if (--pending === 0) finish(); };
  partsReq.onsuccess = () => { parts = partsReq.result || []; if (--pending === 0) finish(); };
  tournsReq.onsuccess = () => { tourns = tournsReq.result || []; if (--pending === 0) finish(); };
}

// ---- 通用事务辅助 ----

function txStore(storeName, mode) {
  if (!db) throw new Error('IndexedDB 不可用');
  const tx = db.transaction(storeName, mode);
  return tx.objectStore(storeName);
}

function promisifyRequest(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ---- Players CRUD ----

async function addPlayer(player) {
  // player: { id, phoneLastFour, nickname, createdAt }
  const store = txStore('players', 'readwrite');
  return promisifyRequest(store.put(player));
}

async function getPlayerById(id) {
  const store = txStore('players', 'readonly');
  return promisifyRequest(store.get(id));
}

async function getPlayersByPhone(phoneLastFour) {
  // 尾号可能撞号，返回数组
  const store = txStore('players', 'readonly');
  const index = store.index('byPhone');
  return promisifyRequest(index.getAll(phoneLastFour));
}

async function getAllPlayers() {
  const store = txStore('players', 'readonly');
  return promisifyRequest(store.getAll());
}

async function deletePlayer(id) {
  const store = txStore('players', 'readwrite');
  return promisifyRequest(store.delete(id));
}

async function nextPlayerId() {
  const all = await getAllPlayers();
  return all.reduce((max, p) => Math.max(max, p.id || 0), 0) + 1;
}

// ---- Tournaments CRUD ----

async function addTournament(tournament) {
  const store = txStore('tournaments', 'readwrite');
  return promisifyRequest(store.put(tournament));
}

async function getTournament(id) {
  const store = txStore('tournaments', 'readonly');
  return promisifyRequest(store.get(id));
}

async function getAllTournaments() {
  const store = txStore('tournaments', 'readonly');
  return promisifyRequest(store.getAll());
}

// ---- Participations CRUD ----

async function addParticipation(participation) {
  // participation: { tournamentId, playerId, finalRank, eliminatedAt, eliminatedAtLevel, mushroomsUsed, prizeChips }
  const store = txStore('participations', 'readwrite');
  return promisifyRequest(store.put(participation));
}

async function getParticipationsByTournament(tournamentId) {
  const store = txStore('participations', 'readonly');
  const index = store.index('byTournament');
  return promisifyRequest(index.getAll(tournamentId));
}

async function getParticipationsByPlayer(playerId) {
  const store = txStore('participations', 'readonly');
  const index = store.index('byPlayer');
  return promisifyRequest(index.getAll(playerId));
}

// ---- 批量写入参赛记录 ----

async function addParticipations(participations) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('participations', 'readwrite');
    const store = tx.objectStore('participations');
    participations.forEach(p => store.put(p));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---- 生成比赛 ID ----

async function generateTournamentId() {
  const today = new Date();
  const dateStr = today.getFullYear() + '-' +
    String(today.getMonth() + 1).padStart(2, '0') + '-' +
    String(today.getDate()).padStart(2, '0');

  // 查找今天已有的比赛数量
  const all = await getAllTournaments();
  const todayCount = all.filter(t => t.id && t.id.startsWith(dateStr)).length;
  return dateStr + '-' + String(todayCount + 1).padStart(3, '0');
}

// ---- localStorage 进度保存/恢复 ----

const PROGRESS_KEY = 'poker-timer-progress';

function saveProgress(state) {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(state));
  } catch (e) {
    console.error('保存进度失败:', e);
  }
}

function loadProgress() {
  try {
    const data = localStorage.getItem(PROGRESS_KEY);
    return data ? JSON.parse(data) : null;
  } catch (e) {
    console.error('读取进度失败:', e);
    return null;
  }
}

function clearProgress() {
  localStorage.removeItem(PROGRESS_KEY);
}

// ---- JSON 导出/导入 ----

async function exportAllData() {
  const players = await getAllPlayers();
  const tournaments = await getAllTournaments();
  const participations = [];
  for (const t of tournaments) {
    const ps = await getParticipationsByTournament(t.id);
    participations.push(...ps);
  }
  return { players, tournaments, participations, exportedAt: new Date().toISOString() };
}

async function importAllData(data) {
  // 导入时统一重新分配 id，避免与本地已有 id 冲突（兼容旧格式无 id 的备份）
  const existing = await getAllPlayers();
  let nextId = existing.reduce((max, p) => Math.max(max, p.id || 0), 0) + 1;
  const idMap = {};   // 旧 id → 新 id
  const phoneMap = {}; // 尾号 → 新 id（旧格式无 id 时用）

  if (data.players) {
    const playersToAdd = [];
    for (const p of data.players) {
      const newId = nextId++;
      if (p.id != null) idMap[p.id] = newId;
      phoneMap[p.phoneLastFour] = newId;
      playersToAdd.push({ id: newId, phoneLastFour: p.phoneLastFour, nickname: p.nickname, createdAt: p.createdAt || Date.now() });
    }
    for (const p of playersToAdd) await addPlayer(p);
  }

  const resolvePlayerId = (row) => {
    const key = row.playerId ?? row.phoneLastFour;
    return idMap[key] ?? phoneMap[key] ?? key;
  };

  if (data.participations) {
    const parts = data.participations
      .map(part => ({
        tournamentId: part.tournamentId,
        playerId: resolvePlayerId(part),
        finalRank: part.finalRank,
        eliminatedAt: part.eliminatedAt,
        eliminatedAtLevel: part.eliminatedAtLevel,
        mushroomsUsed: part.mushroomsUsed,
        prizeChips: part.prizeChips
      }))
      .filter(part => part.playerId != null);
    await addParticipations(parts);
  }

  if (data.tournaments) {
    for (const t of data.tournaments) {
      t.rankings = (t.rankings || []).map(r => ({ ...r, playerId: resolvePlayerId(r) ?? r.playerId }));
      await addTournament(t);
    }
  }
}

// ---- 下载 JSON 文件 ----

function downloadJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
