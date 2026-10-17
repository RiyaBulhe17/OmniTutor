const DATABASE_NAME = "folio-source-files-v1";
const STORE_NAME = "originals";

export function sourceTimestampSeconds(location) {
  const match = location?.match(/(?:^|[^\d])(\d{1,2}):([0-5]\d)(?::([0-5]\d))?(?:\b|$)/);
  if (!match) return null;
  return match[3] === undefined
    ? Number(match[1]) * 60 + Number(match[2])
    : Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

function openSourceDatabase() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error("This browser does not provide IndexedDB for keeping the original file locally."));
      return;
    }
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onerror = () => reject(request.error || new Error("The local original-file store could not be opened."));
    request.onsuccess = () => resolve(request.result);
  });
}

export async function storeOriginalFile(file) {
  const id = crypto.randomUUID();
  const database = await openSourceDatabase();
  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put({
        file: file.slice(0, file.size, file.type),
        name: file.name,
        type: file.type,
      }, id);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error("The original file could not be saved locally."));
      transaction.onabort = () => reject(transaction.error || new Error("Saving the original file was cancelled by the browser."));
    });
    return id;
  } finally {
    database.close();
  }
}

export async function getOriginalFile(id) {
  const database = await openSourceDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error("The locally saved original file could not be opened."));
    });
  } finally {
    database.close();
  }
}

export async function deleteOriginalFile(id) {
  if (!id) return;
  const database = await openSourceDatabase();
  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).delete(id);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error("The local original file could not be removed."));
      transaction.onabort = () => reject(transaction.error || new Error("Removing the local original file was cancelled by the browser."));
    });
  } finally {
    database.close();
  }
}
