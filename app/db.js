// 本地数据层：优先 IndexedDB，不可用时自动回退到 localStorage。
// 无后端、无遥测，数据只存在浏览器里。

const DB_NAME = "writer_studio";
const DB_VERSION = 2;
const STORES = ["books", "chapters", "cards", "snapshots", "kv", "corpus", "chunks"];
const KEY_FIELD = { books: "id", chapters: "id", cards: "id", snapshots: "id", kv: "k", corpus: "id", chunks: "id" };
const LS_PREFIX = "writerstudio:";

let _db = null;
let _mode = null; // 'idb' | 'ls'

/* ---------------- 存储模式探测 ---------------- */

export function storageMode() {
  return _mode || "unknown";
}

function idbAvailable() {
  try {
    return typeof indexedDB !== "undefined" && indexedDB !== null;
  } catch {
    return false;
  }
}

function openIDB() {
  return new Promise((resolve, reject) => {
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (e) {
      reject(e);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("books")) db.createObjectStore("books", { keyPath: "id" });
      if (!db.objectStoreNames.contains("chapters")) {
        const s = db.createObjectStore("chapters", { keyPath: "id" });
        s.createIndex("bookId", "bookId", { unique: false });
      }
      if (!db.objectStoreNames.contains("cards")) {
        const s = db.createObjectStore("cards", { keyPath: "id" });
        s.createIndex("bookId", "bookId", { unique: false });
      }
      if (!db.objectStoreNames.contains("snapshots")) {
        const s = db.createObjectStore("snapshots", { keyPath: "id" });
        s.createIndex("chapterId", "chapterId", { unique: false });
      }
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv", { keyPath: "k" });
      if (!db.objectStoreNames.contains("corpus")) {
        const s = db.createObjectStore("corpus", { keyPath: "id" });
        s.createIndex("source", "source", { unique: false });
      }
      if (!db.objectStoreNames.contains("chunks")) {
        const s = db.createObjectStore("chunks", { keyPath: "id" });
        s.createIndex("docId", "docId", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IndexedDB open failed"));
    req.onblocked = () => reject(new Error("IndexedDB blocked"));
  });
}

export async function openDB() {
  if (_mode === "idb") return _db;
  if (_mode === "ls") return null;
  if (idbAvailable()) {
    try {
      _db = await Promise.race([
        openIDB(),
        new Promise((_, rej) => setTimeout(() => rej(new Error("IndexedDB timeout")), 4000)),
      ]);
      _mode = "idb";
      return _db;
    } catch (e) {
      console.warn("[writer-studio] IndexedDB 不可用，回退到 localStorage：", e && e.message);
    }
  }
  _mode = "ls";
  return null;
}

const req2p = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

/* ---------------- localStorage 回退实现 ---------------- */

const lsKey = (store) => LS_PREFIX + store;
function lsRead(store) {
  try {
    const raw = localStorage.getItem(lsKey(store));
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
function lsWrite(store, arr) {
  try {
    localStorage.setItem(lsKey(store), JSON.stringify(arr));
    return true;
  } catch (e) {
    console.error("[writer-studio] localStorage 写入失败（可能已满）：", e);
    throw new Error("本地存储写入失败，可能是浏览器存储空间已满或禁用了本地存储。");
  }
}

/* ---------------- 统一 API ---------------- */

export const id = (p = "") => p + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export async function put(store, obj) {
  if ((await openDB()) === null) {
    const arr = lsRead(store);
    const kf = KEY_FIELD[store] || "id";
    const i = arr.findIndex((x) => x && x[kf] === obj[kf]);
    if (i >= 0) arr[i] = obj; else arr.push(obj);
    lsWrite(store, arr);
    return obj;
  }
  return new Promise((resolve, reject) => {
    const t = _db.transaction(store, "readwrite");
    t.objectStore(store).put(obj);
    t.oncomplete = () => resolve(obj);
    t.onerror = () => reject(t.error);
  });
}

export async function get(store, key) {
  if ((await openDB()) === null) {
    const kf = KEY_FIELD[store] || "id";
    return lsRead(store).find((x) => x && x[kf] === key);
  }
  return req2p(_db.transaction(store, "readonly").objectStore(store).get(key));
}

export async function del(store, key) {
  if ((await openDB()) === null) {
    const kf = KEY_FIELD[store] || "id";
    lsWrite(store, lsRead(store).filter((x) => !(x && x[kf] === key)));
    return true;
  }
  return new Promise((resolve, reject) => {
    const t = _db.transaction(store, "readwrite");
    t.objectStore(store).delete(key);
    t.oncomplete = () => resolve(true);
    t.onerror = () => reject(t.error);
  });
}

export async function all(store) {
  if ((await openDB()) === null) return lsRead(store);
  return req2p(_db.transaction(store, "readonly").objectStore(store).getAll());
}

export async function byIndex(store, indexName, value) {
  if ((await openDB()) === null) return lsRead(store).filter((x) => x && x[indexName] === value);
  return req2p(_db.transaction(store, "readonly").objectStore(store).index(indexName).getAll(value));
}

/* ---------- 领域封装 ---------- */

export const books = {
  all: () => all("books"),
  get: (bid) => get("books", bid),
  save: (b) => put("books", b),
  remove: (bid) => del("books", bid),
};

export const chapters = {
  of: (bid) => byIndex("chapters", "bookId", bid),
  get: (cid) => get("chapters", cid),
  save: (c) => put("chapters", c),
  remove: (cid) => del("chapters", cid),
};

export const cards = {
  of: (bid, type) => byIndex("cards", "bookId", bid).then((l) => (type ? l.filter((c) => c.type === type) : l)),
  get: (cid) => get("cards", cid),
  save: (c) => put("cards", c),
  remove: (cid) => del("cards", cid),
};

export const snapshots = {
  of: (chapterId) => byIndex("snapshots", "chapterId", chapterId),
  save: (s) => put("snapshots", s),
  remove: (sid) => del("snapshots", sid),
};

export const corpus = {
  all: () => all("corpus"),
  get: (did) => get("corpus", did),
  save: (d) => put("corpus", d),
  remove: (did) => del("corpus", did),
};

export const chunks = {
  of: (docId) => byIndex("chunks", "docId", docId),
  all: () => all("chunks"),
  save: (c) => put("chunks", c),
  remove: (cid) => del("chunks", cid),
  removeByDoc: async (docId) => {
    const list = await byIndex("chunks", "docId", docId);
    for (const c of list) await del("chunks", c.id);
    return list.length;
  },
};

export const kv = {
  get: async (k, dflt = null) => {
    const row = await get("kv", k);
    return row ? row.v : dflt;
  },
  set: (k, v) => put("kv", { k, v }),
};

/* ---------- 备份 ---------- */

export async function exportAll() {
  const out = { app: "writer-studio", version: 1, exportedAt: new Date().toISOString(), data: {} };
  for (const s of STORES) out.data[s] = await all(s);
  return out;
}

export async function importAll(dump, { merge = false } = {}) {
  if (!dump || dump.app !== "writer-studio" || !dump.data) throw new Error("不是有效的码字工坊备份文件");
  if (!merge) {
    for (const s of STORES) {
      for (const r of await all(s)) await del(s, s === "kv" ? r.k : r.id);
    }
  }
  let n = 0;
  for (const s of STORES) {
    for (const row of dump.data[s] || []) { await put(s, row); n++; }
  }
  return n;
}

