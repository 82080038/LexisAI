// IndexedDB minimal wrapper — cache korpus di komputer user.
// Store 'docs': key -> {sha256, payload} | Store 'meta': k -> v

const DB_NAME = 'lexisai-corpus'
const DB_VERSION = 1

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('docs')) db.createObjectStore('docs')
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta')
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function tx(db, store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode)
    const s = t.objectStore(store)
    const out = fn(s)
    t.oncomplete = () => resolve(out?.result !== undefined ? out.result : out)
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error)
  })
}

function asReq(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function idbGet(store, key) {
  const db = await openDB()
  return asReq(db.transaction(store, 'readonly').objectStore(store).get(key))
}

export async function idbSet(store, key, value) {
  const db = await openDB()
  return tx(db, store, 'readwrite', (s) => s.put(value, key))
}

export async function idbGetAll(store) {
  const db = await openDB()
  return asReq(db.transaction(store, 'readonly').objectStore(store).getAll())
}

export async function idbGetAllKeys(store) {
  const db = await openDB()
  return asReq(db.transaction(store, 'readonly').objectStore(store).getAllKeys())
}

export async function idbDelete(store, key) {
  const db = await openDB()
  return tx(db, store, 'readwrite', (s) => s.delete(key))
}
