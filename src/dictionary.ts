import { openDB, type DBSchema } from "idb";
import lemmatizer from "wink-lemmatizer";
import { readDictionary, redirectTarget, type DictionaryInfo, type Entry, type GlossaryItem } from "./yomitan";

export interface Dictionary extends DictionaryInfo {
  id: string;
  enabled: boolean;
  ready: boolean;
  order: number;
  count: number;
  parser: number;
  archiveId?: string;
}

interface Term extends Entry { dictionaryId: string; key: string }
export interface Match extends Entry { dictionary: string }

// 解析器版本：旧索引在打开面板时从备份自动重建
export const PARSER_VERSION = 2;

interface Data extends DBSchema {
  dictionaries: { key: string; value: Dictionary };
  terms: { key: number; value: Term; indexes: { lookup: [string, string]; dictionary: string } };
}

// String normalization; this does not touch the DOM.
// eslint-disable-next-line no-restricted-syntax
const normalize = (text: string) => text.normalize("NFKC").trim().toLowerCase().replaceAll("’", "'");

export function searchKeys(text: string): string[] {
  const query = normalize(text);
  if (!query) return [];
  const keys = [query];
  if (/^[a-z][a-z' -]*$/.test(query)) {
    const words = query.match(/[a-z]+(?:'[a-z]+)*/g);
    if (words?.length === 1) {
      const word = words[0].replace(/'s$/, "");
      keys.push(word, lemmatizer.noun(word), lemmatizer.verb(word), lemmatizer.adjective(word));
    }
  }
  return [...new Set(keys)];
}

export function createDictionaryStore(name = "io.github.kekeqwq.mndict.library") {
  let connection: ReturnType<typeof openDB<Data>> | undefined;
  const db = () => connection ??= openDB<Data>(name, 1, {
    upgrade(database) {
      database.createObjectStore("dictionaries", { keyPath: "id" });
      const terms = database.createObjectStore("terms", { autoIncrement: true });
      terms.createIndex("lookup", ["dictionaryId", "key"]);
      terms.createIndex("dictionary", "dictionaryId");
    },
    terminated() { connection = undefined; },
  }).catch((error: unknown) => { connection = undefined; throw error; });

  async function list() {
    return (await (await db()).getAll("dictionaries")).filter((dict) => dict.ready)
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  }

  async function remove(id: string) {
    const database = await db();
    const tx = database.transaction(["terms", "dictionaries"], "readwrite");
    let cursor = await tx.objectStore("terms").index("dictionary").openKeyCursor(id);
    while (cursor) {
      await tx.objectStore("terms").delete(cursor.primaryKey);
      cursor = await cursor.continue();
    }
    await tx.objectStore("dictionaries").delete(id);
    await tx.done;
  }

  return {
    list, deleteDictionary: remove,
    async clearAll() {
      const tx = (await db()).transaction(["terms", "dictionaries"], "readwrite");
      await Promise.all([tx.objectStore("terms").clear(), tx.objectStore("dictionaries").clear(), tx.done]);
    },
    async importZip(blob: Blob, onLog: (message: string) => void = () => {},
      onProgress: (done: number, total: number) => void = () => {}, archiveId?: string) {
      return readDictionary(blob, async (info, banks, total) => {
        const database = await db();
        const dictionaries = await list();
        if (dictionaries.some((item) => item.title === info.title && item.revision === info.revision)) {
          throw new Error("已导入同名同版本词典");
        }
        const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
        const dict: Dictionary = { ...info, id, enabled: true, ready: false,
          order: (dictionaries.at(-1)?.order ?? 0) + 1, count: 0, parser: PARSER_VERSION,
          ...(archiveId ? { archiveId } : {}) };
        await database.put("dictionaries", dict);
        let done = 0;
        try {
          onProgress(done, total);
          for await (const bank of banks) {
            for (let i = 0; i < bank.length; i += 500) {
              const tx = database.transaction("terms", "readwrite");
              await Promise.all([...bank.slice(i, i + 500).map((entry) => tx.store.add({
                ...entry, dictionaryId: id, key: normalize(entry.term),
              })), tx.done]);
            }
            dict.count += bank.length;
            onLog(`已写入 ${dict.count.toLocaleString()} 条`);
            onProgress(++done, total);
          }
          if (!dict.count) throw new Error("词典没有词条");
          dict.ready = true;
          await database.put("dictionaries", dict);
          onLog(`导入完成：${dict.count.toLocaleString()} 条`);
          return dict;
        } catch (error) {
          await remove(id).catch(() => {});
          onLog("导入失败，已清理未完成的数据");
          throw error;
        }
      }, onLog);
    },
    async setEnabled(id: string, enabled: boolean) {
      const tx = (await db()).transaction("dictionaries", "readwrite");
      const item = await tx.store.get(id);
      if (item?.ready) await tx.store.put({ ...item, enabled });
      await tx.done;
    },
    async move(id: string, direction: -1 | 1) {
      const tx = (await db()).transaction("dictionaries", "readwrite");
      const sorted = (await tx.store.getAll()).filter((item) => item.ready)
        .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
      const index = sorted.findIndex((item) => item.id === id);
      const neighbor = index + direction;
      const current = sorted[index];
      const next = sorted[neighbor];
      if (current && next) {
        [sorted[index], sorted[neighbor]] = [next, current];
        await Promise.all(sorted.map((item, position) => tx.store.put({ ...item, order: position + 1 })));
      }
      await tx.done;
    },
    async search(text: string): Promise<Match[]> {
      const keys = searchKeys(text);
      const dictionaries = (await list()).filter((item) => item.enabled);
      const index = (await db()).transaction("terms").store.index("lookup");
      const matches = await Promise.all(keys.map((key) => Promise.all(dictionaries.map(async (dict) => {
        const entries = await index.getAll([dict.id, key], 50);
        return Promise.all(entries.sort((a, b) => b.score - a.score).slice(0, 12).map(async (entry) => {
          let definitions: GlossaryItem[] = entry.definitions;
          const target = definitions.length === 1 ? redirectTarget(definitions[0] as GlossaryItem) : undefined;
          if (target) {
            const resolved = await index.getAll([dict.id, normalize(target)], 3);
            if (resolved[0]) definitions = resolved[0].definitions;
          }
          return { ...entry, definitions, dictionary: dict.title };
        }));
      }))));
      return matches.flat(2).slice(0, 80);
    },
  };
}
