import { BlobReader, ZipReader, type FileEntry } from "@zip.js/zip.js";

export interface DictionaryInfo {
  title: string;
  revision: string;
  sourceLanguage?: string;
}

export interface Entry {
  term: string;
  reading: string;
  tags: string;
  score: number;
  definitions: string[];
}

// 上限仅防 zip 炸弹，真实词典远在限内
const maxArchiveBytes = 4 * 1024 * 1024 * 1024;
const maxBankBytes = 2 * 1024 * 1024 * 1024;
const bankPattern = /^term_bank_([1-9]\d*)\.json$/;

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

// Render dictionary content as plain text. Never interpret dictionary HTML, CSS, or URLs.
export function definitionText(value: unknown, depth = 0): string {
  if (depth > 40) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((part) => definitionText(part, depth + 1)).join("");
  const node = record(value);
  if (!node) return "";
  if (node.tag === "br") return "\n";
  if (node.type === "image" || node.tag === "img") return typeof node.alt === "string" ? node.alt : "";
  if (node.type === "text" && typeof node.text === "string") return node.text;
  const text = definitionText(node.content, depth + 1);
  return typeof node.tag === "string" && ["div", "li", "ol", "ul", "tr", "p"].includes(node.tag)
    ? `${text}\n` : node.tag === "td" || node.tag === "th" ? `${text}\t` : text;
}

function parseEntry(row: unknown): Entry {
  if (!Array.isArray(row) || row.length !== 8 || typeof row[0] !== "string" || !row[0].trim() ||
    typeof row[1] !== "string" || (row[2] !== null && typeof row[2] !== "string") ||
    typeof row[3] !== "string" || typeof row[4] !== "number" || !Number.isFinite(row[4]) ||
    !Array.isArray(row[5]) || !Number.isInteger(row[6]) || typeof row[7] !== "string") {
    throw new Error("存在不符合 Yomitan v3 格式的词条");
  }
  return {
    term: row[0], reading: row[1], tags: [row[2], row[7]].filter(Boolean).join(" "), score: row[4],
    definitions: row[5].map((part) => definitionText(part).trim()).filter(Boolean),
  };
}

async function readJson(entry: FileEntry, limit: number, onLog: (message: string) => void): Promise<unknown> {
  if (entry.encrypted) throw new Error(`不支持加密的词典文件：${entry.filename}`);
  let length = 0;
  let sinceLog = 0;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const chunks: string[] = [];
  await entry.getData(new WritableStream<Uint8Array>({
    async write(chunk) {
      length += chunk.byteLength;
      if (length > limit) throw new Error(`解压后文件过大：${entry.filename}`);
      sinceLog += chunk.byteLength;
      if (sinceLog >= 8 * 1024 * 1024) {
        sinceLog = 0;
        onLog(`解压 ${entry.filename}：${(length / 1048576).toFixed(0)} MiB`);
        // 让出事件循环，界面才能刷新日志
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      chunks.push(decoder.decode(chunk, { stream: true }));
    },
  }), { checkSignature: true, useWebWorkers: false });
  return JSON.parse(chunks.join("") + decoder.decode()) as unknown;
}

export async function readDictionary<T>(
  file: Blob,
  consume: (info: DictionaryInfo, banks: AsyncIterable<Entry[]>, total: number) => Promise<T>,
  onLog: (message: string) => void = () => {},
): Promise<T> {
  if (file.size > maxArchiveBytes) throw new Error("词典 ZIP 超过 4 GiB");
  const archive = new ZipReader(new BlobReader(file));
  try {
    let index: FileEntry | undefined;
    const banks: FileEntry[] = [];
    const seen = new Set<string>();
    let size = 0;
    for await (const member of archive.getEntriesGenerator()) {
      if (member.directory) continue;
      if (member.filename !== "index.json" && !bankPattern.test(member.filename)) continue;
      if (seen.has(member.filename)) throw new Error(`词典包含重复文件：${member.filename}`);
      seen.add(member.filename);
      size += member.uncompressedSize;
      if (size > 4 * 1024 * 1024 * 1024) throw new Error("词典解压数据超过 4 GiB");
      if (member.filename === "index.json") index = member;
      else banks.push(member);
    }
    if (!index || !banks.length) throw new Error("ZIP 根目录须有 index.json 和 term_bank_*.json");
    const info = record(await readJson(index, 1024 * 1024, onLog));
    if (!info || (info.format ?? info.version) !== 3 || typeof info.title !== "string" ||
      !info.title.trim() || typeof info.revision !== "string") throw new Error("仅支持 Yomitan v3 词条词典");
    banks.sort((a, b) => a.filename.localeCompare(b.filename, undefined, { numeric: true }));
    onLog(`识别到《${String(info.title).trim()}》rev ${String(info.revision)}，${banks.length} 个词条文件`);
    async function* entries() {
      for (const bank of banks) {
        const value = await readJson(bank, maxBankBytes, onLog);
        if (!Array.isArray(value)) throw new Error(`词条文件格式错误：${bank.filename}`);
        onLog(`解析 ${bank.filename}：${value.length.toLocaleString()} 条`);
        yield value.map(parseEntry);
      }
    }
    return await consume({ title: info.title.trim(), revision: info.revision,
      ...(typeof info.sourceLanguage === "string" ? { sourceLanguage: info.sourceLanguage } : {}) }, entries(), banks.length);
  } finally {
    await archive.close();
  }
}
