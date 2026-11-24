import { utf8ToBase64 } from "./codec";
import { readDictionary, redirectTarget, type DictionaryInfo, type Entry, type GlossaryItem } from "./yomitan";
import lemmatizer from "wink-lemmatizer";

export interface Dictionary extends DictionaryInfo {
  id: string;
  enabled: boolean;
  order: number;
  count: number;
  parser: number;
  archiveId?: string;
}

export interface Match extends Entry { dictionary: string }

// 解析器版本：旧索引在打开面板时从备份自动重建
export const PARSER_VERSION = 2;

interface DbDict {
  id: string; title: string; revision: string; sourceLanguage: string; css: string;
  enabled: boolean; ord: number; count: number; archiveId: string; parser: number;
}

interface DbRow {
  dictId: string; key: string; term: string; reading: string; tags: string; score: number; defs: string;
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
      keys.push(word, lemmatize(word, "noun"), lemmatize(word, "verb"), lemmatize(word, "adjective"));
    }
  }
  return [...new Set(keys)];
}

function lemmatize(word: string, part: "noun" | "verb" | "adjective"): string {
  try {
    return lemmatizer[part](word);
  } catch {
    return word;
  }
}

const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)),
  (byte) => byte.toString(16).padStart(2, "0")).join("");

// 词典库经 mn.call 命令走原生 SQLite（native/NativeDb.js）；参数一律 base64 编码进命令名。
export function createDictionaryStore(host?: Mn) {
  function call<T>(name: string): Promise<T> {
    if (!host) return Promise.reject(new Error("原生存储不可用（缺少原生桥接）"));
    return host.call<T>(name);
  }

  async function list(): Promise<Dictionary[]> {
    const result = await call<{ ok: boolean; dictionaries?: DbDict[] }>("db:list");
    if (!result?.ok) throw new Error("读取词典列表失败");
    return (result.dictionaries ?? []).map((row) => ({
      id: row.id, title: row.title, revision: row.revision,
      ...(row.sourceLanguage ? { sourceLanguage: row.sourceLanguage } : {}),
      ...(row.css ? { css: row.css } : {}),
      enabled: row.enabled, order: row.ord, count: row.count, parser: row.parser,
      ...(row.archiveId ? { archiveId: row.archiveId } : {}),
    }));
  }

  async function putDict(dict: Dictionary): Promise<void> {
    const row: DbDict = {
      id: dict.id, title: dict.title, revision: dict.revision,
      sourceLanguage: dict.sourceLanguage ?? "", css: dict.css ?? "",
      enabled: dict.enabled, ord: dict.order, count: dict.count,
      archiveId: dict.archiveId ?? "", parser: dict.parser,
    };
    const result = await call<{ ok: boolean }>(`db:putDict:${utf8ToBase64(JSON.stringify(row))}`);
    if (!result?.ok) throw new Error("写入词典记录失败");
  }

  async function lookup(keys: string[]): Promise<DbRow[]> {
    const result = await call<{ ok: boolean; rows?: DbRow[] }>(`db:lookup:${utf8ToBase64(JSON.stringify(keys))}`);
    if (!result?.ok) throw new Error("查询失败");
    return result.rows ?? [];
  }

  // 分块写入暂存文件（与备份同一套强校验传输）
  async function stageText(file: string, text: string): Promise<void> {
    await call(`db:stageBegin:${file}`);
    const bytes = new TextEncoder().encode(text);
    const chunkSize = 24 * 1024;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      const part = bytes.subarray(offset, offset + chunkSize);
      let binary = "";
      for (let i = 0; i < part.length; i += 1) binary += String.fromCharCode(part[i] as number);
      const marker = `db:stageChunk:${file}:${part.length}:`;
      let detail = "无响应";
      let done = false;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const result = await call<{ ok: boolean; wrote?: number; detail?: string }>(`${marker}${btoa(binary)}`);
        if (result?.ok && result.wrote === part.length) { done = true; break; }
        detail = `第 ${attempt} 次 ${JSON.stringify(result)}`;
        if (result?.wrote) break;
      }
      if (!done) throw new Error(`词条数据写入失败：${detail}`);
    }
  }

  return {
    list,

    async importZip(blob: Blob, onLog: (message: string) => void = () => {},
      onProgress: (done: number, total: number) => void = () => {}, archiveId?: string): Promise<Dictionary> {
      return readDictionary(blob, async (info, banks, total) => {
        const existing = await list();
        if (existing.some((item) => item.title === info.title && item.revision === info.revision)) {
          throw new Error("已导入同名同版本词典");
        }
        const id = randomId();
        const dict: Dictionary = {
          ...info, id, enabled: true, order: (existing.at(-1)?.order ?? 0) + 1,
          count: 0, parser: PARSER_VERSION, ...(archiveId ? { archiveId } : {}),
        };
        await putDict(dict);
        let done = 0;
        try {
          for await (const bank of banks) {
            const lines = bank.map((entry) => JSON.stringify([
              normalize(entry.term), entry.term, entry.reading, entry.tags, entry.score,
              JSON.stringify(entry.definitions),
            ])).join("\n");
            await stageText(`${id}.${done}.jsonl`, lines);
            const result = await call<{ ok: boolean; count?: number }>(`db:importTerms:${id}:${id}.${done}.jsonl`);
            if (!result?.ok) throw new Error("词条入库失败");
            dict.count += result.count ?? 0;
            onLog(`已写入 ${dict.count.toLocaleString()} 条`);
            onProgress(++done, total);
          }
          if (!dict.count) throw new Error("词典没有词条");
          await putDict(dict);
          onLog(`导入完成：${dict.count.toLocaleString()} 条`);
          return dict;
        } catch (error) {
          await call(`db:delDict:${id}`).catch(() => {});
          onLog("导入失败，已清理未完成的数据");
          throw error;
        }
      }, onLog);
    },

    async search(text: string): Promise<Match[]> {
      const keys = searchKeys(text);
      const dicts = (await list()).filter((item) => item.enabled)
        .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
      const rank = new Map(dicts.map((item, index) => [item.id, index]));
      const titles = new Map(dicts.map((item) => [item.id, item.title]));
      const rows = (await lookup(keys)).filter((row) => rank.has(row.dictId));
      const resolved: DbRow[] = [];
      for (const row of rows) {
        let definitions = JSON.parse(row.defs) as GlossaryItem[];
        const target = definitions.length === 1 ? redirectTarget(definitions[0] as GlossaryItem) : undefined;
        if (target) {
          const hits = await lookup([normalize(target)]);
          const hit = hits.find((item) => item.dictId === row.dictId && item.term === target)
            ?? hits.find((item) => item.dictId === row.dictId);
          if (hit) definitions = JSON.parse(hit.defs) as GlossaryItem[];
        }
        resolved.push({ ...row, defs: JSON.stringify(definitions) });
      }
      resolved.sort((a, b) => (rank.get(a.dictId) ?? 0) - (rank.get(b.dictId) ?? 0) || b.score - a.score);
      return resolved.slice(0, 80).map((row) => ({
        term: row.term, reading: row.reading, tags: row.tags, score: row.score,
        definitions: JSON.parse(row.defs) as GlossaryItem[],
        dictionary: titles.get(row.dictId) ?? "",
      }));
    },

    async setEnabled(id: string, enabled: boolean): Promise<void> {
      const dict = (await list()).find((item) => item.id === id);
      if (dict?.parser) await putDict({ ...dict, enabled });
    },

    async move(id: string, direction: -1 | 1): Promise<void> {
      const sorted = (await list()).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
      const current = sorted.find((item) => item.id === id);
      const index = sorted.findIndex((item) => item.id === id);
      const neighbor = sorted[index + direction];
      if (current && neighbor) {
        await putDict({ ...current, order: neighbor.order });
        await putDict({ ...neighbor, order: current.order });
      }
    },

    async deleteDictionary(id: string): Promise<void> {
      await call(`db:delDict:${id}`);
    },

    async clearAll(): Promise<void> {
      await call("db:clearAll");
    },
  };
}
