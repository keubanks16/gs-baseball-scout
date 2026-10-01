// On-device document store for running outside Claude (e.g. GitHub Pages).
// Same shape as the subset of the Claude `db` API the app uses:
//   db.doc(path).get/set/update/delete/onSnapshot
//   db.collection(path).doc(id?).orderBy(f, dir).limit(n).get/onSnapshot
// Everything lives in this browser's IndexedDB (one record per document path).

const DB_NAME = 'gs-baseball-scout', STORE = 'docs';

function openIDB() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) { reject(new Error('no indexedDB')); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'path' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function createLocalDB() {
  let idb = null;
  try { idb = await openIDB(); } catch { idb = null; }
  const docs = new Map();
  if (idb) {
    await new Promise((resolve) => {
      const tx = idb.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => { for (const r of req.result || []) docs.set(r.path, r.data); resolve(); };
      req.onerror = () => resolve();
    });
  }
  const persist = (path, data) => {
    if (!idb) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const tx = idb.transaction(STORE, 'readwrite');
      const st = tx.objectStore(STORE);
      if (data === undefined) st.delete(path); else st.put({ path, data });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('write failed'));
    });
  };
  const listeners = new Set();
  let pending = false;
  const notify = () => { if (pending) return; pending = true; setTimeout(() => { pending = false; for (const l of [...listeners]) { try { l(); } catch (e) { console.error(e); } } }, 0); };
  const seg = (p) => p.split('/');
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const meta = { fromCache: false, hasPendingWrites: false };
  const snapDoc = (path) => { const d = docs.get(path); return { id: seg(path).pop(), exists: !!d, data: () => (d ? clone(d) : undefined), metadata: meta }; };
  let n = 0;
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8) + (n++).toString(36);

  function docRef(path) {
    return {
      id: seg(path).pop(), path,
      async get() { return snapDoc(path); },
      async set(d) { const c = clone(d); docs.set(path, c); notify(); await persist(path, c); },
      async update(d) {
        if (!docs.has(path)) throw { code: 'invalid_argument', message: 'document does not exist' };
        const merge = (a, b) => { const o = { ...a }; for (const [k, v] of Object.entries(b)) o[k] = v && typeof v === 'object' && !Array.isArray(v) && a && typeof a[k] === 'object' && !Array.isArray(a[k]) ? merge(a[k] || {}, v) : v; return o; };
        const c = merge(docs.get(path), clone(d)); docs.set(path, c); notify(); await persist(path, c);
      },
      async delete() { docs.delete(path); notify(); await persist(path, undefined); },
      onSnapshot(next) { const l = () => next(snapDoc(path)); listeners.add(l); setTimeout(l, 0); return () => listeners.delete(l); },
      collection(p) { return colRef(path + '/' + p); },
    };
  }
  function query(path, order = null, lim = 1000) {
    const run = () => {
      const depth = seg(path).length + 1;
      let out = [...docs.keys()].filter((k) => k.startsWith(path + '/') && seg(k).length === depth).map(snapDoc);
      if (order) out.sort((a, b) => { const x = a.data()[order[0]], y = b.data()[order[0]]; return (x < y ? -1 : x > y ? 1 : 0) * (order[1] === 'desc' ? -1 : 1); });
      else out.sort((a, b) => (a.id < b.id ? -1 : 1));
      out = out.slice(0, lim);
      return { docs: out, size: out.length, empty: !out.length, docChanges: () => [], metadata: meta };
    };
    return {
      orderBy(f, dir = 'asc') { return query(path, [f, dir], lim); },
      limit(k) { return query(path, order, k); },
      where() { throw new Error('where() is not supported by the on-device store'); },
      async get() { return run(); },
      onSnapshot(next) { const l = () => next(run()); listeners.add(l); setTimeout(l, 0); return () => listeners.delete(l); },
    };
  }
  function colRef(path) {
    return Object.assign(query(path), { path, doc(id) { return docRef(path + '/' + (id || newId())); }, async add(d) { const r = this.doc(); await r.set(d); return r; } });
  }
  return {
    doc: docRef, collection: colRef,
    persistent: !!idb,
    size: () => docs.size,
    exportAll: () => ({ app: 'gs-baseball-scout', version: 1, exportedAt: new Date().toISOString(), docs: Object.fromEntries(docs) }),
    async importAll(obj, { replace = false } = {}) {
      if (!obj || typeof obj.docs !== 'object') throw new Error('Not a GS Baseball Scout backup file');
      if (replace) { for (const k of [...docs.keys()]) { docs.delete(k); await persist(k, undefined); } }
      let count = 0;
      for (const [k, v] of Object.entries(obj.docs)) { if (typeof k !== 'string' || !v || typeof v !== 'object') continue; docs.set(k, v); await persist(k, v); count++; }
      notify();
      return count;
    },
  };
}
