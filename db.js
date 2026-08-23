// ============================================================
// db.js — IndexedDB 数据层 + localStorage 进度保存
// ============================================================

const DB_NAME = 'poker-timer';
const DB_VERSION = 1;
let db = null;

// ---- IndexedDB 初始化 ----

function initDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const database = e.target.result;
      // 玩家表
      if (!database.objectStoreNames.contains('players')) {
        database.createObjectStore('players', { keyPath: 'phoneLastFour' });
      }
      // 比赛表
      if (!database.objectStoreNames.contains('tournaments')) {
        database.createObjectStore('tournaments', { keyPath: 'id' });
      }
      // 参赛记录表（复合主键用 [tournamentId, phoneLastFour]）
      if (!database.objectStoreNames.contains('participations')) {
        const store = database.createObjectStore('participations', {
          keyPath: ['tournamentId', 'phoneLastFour']
        });
        store.createIndex('byTournament', 'tournamentId', { unique: false });
        store.createIndex('byPlayer', 'phoneLastFour', { unique: false });
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

// ---- 通用事务辅助 ----

function txStore(storeName, mode) {
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
  // player: { phoneLastFour, nickname, createdAt }
  const store = txStore('players', 'readwrite');
  return promisifyRequest(store.put(player));
}

async function getPlayer(phoneLastFour) {
  const store = txStore('players', 'readonly');
  return promisifyRequest(store.get(phoneLastFour));
}

async function getAllPlayers() {
  const store = txStore('players', 'readonly');
  return promisifyRequest(store.getAll());
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
  // participation: { tournamentId, phoneLastFour, finalRank, eliminatedAt, eliminatedAtLevel, mushroomsUsed, prizeChips }
  const store = txStore('participations', 'readwrite');
  return promisifyRequest(store.put(participation));
}

async function getParticipationsByTournament(tournamentId) {
  const store = txStore('participations', 'readonly');
  const index = store.index('byTournament');
  return promisifyRequest(index.getAll(tournamentId));
}

async function getParticipationsByPlayer(phoneLastFour) {
  const store = txStore('participations', 'readonly');
  const index = store.index('byPlayer');
  return promisifyRequest(index.getAll(phoneLastFour));
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
  // 获取所有参赛记录
  const participations = [];
  for (const t of tournaments) {
    const ps = await getParticipationsByTournament(t.id);
    participations.push(...ps);
  }
  return { players, tournaments, participations, exportedAt: new Date().toISOString() };
}

async function importAllData(data) {
  // 导入玩家
  if (data.players) {
    for (const p of data.players) {
      await addPlayer(p);
    }
  }
  // 导入比赛
  if (data.tournaments) {
    for (const t of data.tournaments) {
      await addTournament(t);
    }
  }
  // 导入参赛记录
  if (data.participations) {
    await addParticipations(data.participations);
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
  URL.revokeObjectURL(url);
}
