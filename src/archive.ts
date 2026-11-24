export interface ArchiveInfo { id: string; size: number }

// 词典 ZIP 备份在 MarginNote 文稿目录（native/PanelBridge.js 落盘），IndexedDB 只作可重建的缓存。
export async function saveArchive(host: Mn, file: Blob, log: (message: string) => void): Promise<string> {
  const id = `arc${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const begin = await host.call<{ ok: boolean }>(`archivePutBegin:${id}`);
  if (!begin?.ok) throw new Error("无法创建词典备份");
  const chunkSize = 96 * 1024;
  for (let offset = 0; offset < file.size; offset += chunkSize) {
    const bytes = new Uint8Array(await file.slice(offset, offset + chunkSize).arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i] as number);
    const written = await host.call<{ ok: boolean }>(`archivePutChunk:${id}:${btoa(binary)}`);
    if (!written?.ok) throw new Error("词典备份写入失败");
    log(`备份 ${Math.min(offset + chunkSize, file.size).toLocaleString()} / ${file.size.toLocaleString()} 字节`);
  }
  return id;
}

export async function listArchives(host: Mn): Promise<ArchiveInfo[]> {
  const result = await host.call<{ ok: boolean; archives?: ArchiveInfo[] }>("archiveList");
  return result?.ok && Array.isArray(result.archives) ? result.archives : [];
}

export async function loadArchive(host: Mn, info: ArchiveInfo, log: (message: string) => void): Promise<Blob> {
  const chunkSize = 128 * 1024;
  const parts: BlobPart[] = [];
  for (let offset = 0; offset < info.size; offset += chunkSize) {
    const result = await host.call<{ ok: boolean; data?: string }>(`archiveRead:${info.id}:${offset}:${chunkSize}`);
    if (!result?.ok || typeof result.data !== "string") throw new Error("读取词典备份失败");
    const binary = atob(result.data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    parts.push(bytes);
    log(`读取备份 ${Math.min(offset + chunkSize, info.size).toLocaleString()} / ${info.size.toLocaleString()} 字节`);
  }
  return new Blob(parts, { type: "application/zip" });
}

export async function dropArchive(host: Mn, id: string): Promise<void> {
  await host.call(`archiveDrop:${id}`);
}
