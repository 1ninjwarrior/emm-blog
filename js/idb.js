// Em&m Blog: tiny IndexedDB wrapper for the 'device' backend (a normal website).
// One database, three stores:
//   docs   key [c, id]  value {c, id, d}   every collection's documents (index 'c' = collection name)
//   blobs  key id       value {id, blob, type, size, at}   uploaded photos / videos / renders
//   meta   key k        value {k, v}       small bookkeeping (backup stamps, …)
// New collections need no schema change: they're just new values of `c`.

const NAME = 'emm-blog';
const VERSION = 1;
let dbp = null;

const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const txDone = (tx) => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error || new Error('aborted')); });

/** Open (and create) the database. Rejects when IndexedDB is unavailable. */
export function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    if (!('indexedDB' in self) || !self.indexedDB) { reject(new Error('no indexedDB')); return; }
    let r;
    try { r = indexedDB.open(NAME, VERSION); } catch (e) { reject(e); return; }
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('docs')) db.createObjectStore('docs', { keyPath: ['c', 'id'] }).createIndex('c', 'c');
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'k' });
    };
    r.onsuccess = () => {
      const db = r.result;
      // Another tab upgraded the schema: let go so it can proceed, and reload to pick it up.
      db.onversionchange = () => { db.close(); location.reload(); };
      resolve(db);
    };
    r.onerror = () => reject(r.error);
    r.onblocked = () => { /* another tab holds an old version; onsuccess follows once it closes */ };
    setTimeout(() => reject(new Error('indexedDB open timeout')), 8000);
  });
  return dbp;
}

/** All docs of one collection as plain objects {id, ...data}. */
export async function loadColl(c) {
  const db = await open();
  const rows = await req(db.transaction('docs').objectStore('docs').index('c').getAll(c));
  return rows.map((r) => ({ ...r.d, id: r.id }));
}

/** Write docs. ops: [{c, id, d}] (d = null deletes). One transaction. */
export async function write(ops) {
  if (!ops.length) return;
  const db = await open();
  const tx = db.transaction('docs', 'readwrite');
  const st = tx.objectStore('docs');
  for (const o of ops) {
    if (o.d === null) st.delete([o.c, o.id]);
    else { const d = { ...o.d }; delete d.id; st.put({ c: o.c, id: o.id, d }); }
  }
  return txDone(tx);
}

/** Delete every doc of the listed collections (restore). */
export async function clearColls(colls) {
  const db = await open();
  const tx = db.transaction('docs', 'readwrite');
  const st = tx.objectStore('docs');
  for (const c of colls) st.delete(IDBKeyRange.bound([c, ''], [c, '￿']));
  // ids are strings; bound covers every string id of that collection
  return txDone(tx);
}

/** {id -> {blob, type, size}} for every stored blob. Blob values are lazy handles in modern browsers. */
export async function loadBlobs() {
  const db = await open();
  const rows = await req(db.transaction('blobs').objectStore('blobs').getAll());
  return rows;
}
export async function putBlob(id, blob, type) {
  const db = await open();
  const tx = db.transaction('blobs', 'readwrite');
  tx.objectStore('blobs').put({ id, blob, type: type || blob.type, size: blob.size, at: Date.now() });
  return txDone(tx);
}
export async function getBlob(id) {
  const db = await open();
  const r = await req(db.transaction('blobs').objectStore('blobs').get(id));
  return r ? r.blob : null;
}
export async function delBlob(id) {
  const db = await open();
  const tx = db.transaction('blobs', 'readwrite');
  tx.objectStore('blobs').delete(id);
  return txDone(tx);
}
export async function clearBlobs() {
  const db = await open();
  const tx = db.transaction('blobs', 'readwrite');
  tx.objectStore('blobs').clear();
  return txDone(tx);
}

export async function getMeta(k) {
  const db = await open();
  const r = await req(db.transaction('meta').objectStore('meta').get(k));
  return r ? r.v : null;
}
export async function setMeta(k, v) {
  const db = await open();
  const tx = db.transaction('meta', 'readwrite');
  tx.objectStore('meta').put({ k, v });
  return txDone(tx);
}
