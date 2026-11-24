export interface ArchiveInfo { id: string; size: number }

const chunkBytes = 32 * 1024;
const attempts = 3;

// 词典 ZIP 备份在 MarginNote 文稿目录（native/PanelBridge.js 落盘），IndexedDB 只作可重建的缓存。
// 每块都做长度强校验：传输丢字节会重试，落盘丢字节会中止并回收，绝不留下静默损坏的备份。
export async function saveArchive(host: Mn, file: Blob, log: (message: string) => void): Promise<string> {
  const id = `arc${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const begin = await host.call<{ ok: boolean }>(`archivePutBegin:${id}`);
  if (!begin?.ok) throw new Error("无法创建词典备份");
  for (let offset = 0; offset < file.size; offset += chunkBytes) {
    const bytes = new Uint8Array(await file.slice(offset, offset + chunkBytes).arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i] as number);
    const expected = bytes.length;
    const detail = await putChunk(host, id, expected, btoa(binary));
    if (detail) {
      await dropArchive(host, id).catch(() => {});
      throw new Error(`词典备份写入失败（偏移 ${offset.toLocaleString()}）：${detail}`);
    }
    log(`备份 ${Math.min(offset + chunkBytes, file.size).toLocaleString()} / ${file.size.toLocaleString()} 字节`);
  }
  return id;
}

async function putChunk(host: Mn, id: string, expected: number, payload: string): Promise<string> {
  let detail = "无响应";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = await host.call<{ ok: boolean; wrote?: number; detail?: string }>(
      `archivePutChunk:${id}:${expected}:${payload}`);
    if (result?.ok && result.wrote === expected) return "";
    detail = `第 ${attempt} 次 ${result?.detail ?? "失败"}（落盘 ${result?.wrote ?? 0}/${expected} 字节）`;
    if (result?.wrote) return detail + "，已写入数据不可信，中止";
  }
  return detail;
}

export async function listArchives(host: Mn): Promise<ArchiveInfo[]> {
  const result = await host.call<{ ok: boolean; archives?: ArchiveInfo[] }>("archiveList");
  return result?.ok && Array.isArray(result.archives) ? result.archives : [];
}

export async function loadArchive(host: Mn, info: ArchiveInfo, log: (message: string) => void): Promise<Blob> {
  const parts: BlobPart[] = [];
  for (let offset = 0; offset < info.size; offset += chunkBytes) {
    const expected = Math.min(chunkBytes, info.size - offset);
    const result = await host.call<{ ok: boolean; data?: string }>(`archiveRead:${info.id}:${offset}:${chunkBytes}`);
    if (!result?.ok || typeof result.data !== "string") throw new Error(`读取备份失败（偏移 ${offset.toLocaleString()}）`);
    const binary = atob(result.data);
    if (binary.length !== expected) {
      throw new Error(`读取备份长度不符（偏移 ${offset.toLocaleString()}：${binary.length}/${expected} 字节）`);
    }
    const bytes = new Uint8Array(expected);
    for (let i = 0; i < expected; i += 1) bytes[i] = binary.charCodeAt(i);
    parts.push(bytes);
    log(`读取备份 ${Math.min(offset + chunkBytes, info.size).toLocaleString()} / ${info.size.toLocaleString()} 字节`);
  }
  return new Blob(parts, { type: "application/zip" });
}

export async function dropArchive(host: Mn, id: string): Promise<void> {
  await host.call(`archiveDrop:${id}`);
}
