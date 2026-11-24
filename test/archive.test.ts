import { dropArchive, loadArchive, saveArchive } from "../src/archive";

function ok(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`断言失败：${message}`);
}

// 模拟 native/PanelBridge.js 的 archive 命令语义，可注入两类损坏。
function mockHost(options: { dropTransport?: boolean; dropDisk?: boolean } = {}) {
  const files = new Map<string, string>();
  let transportDropped = false;
  const host = {
    files,
    async call(name: string): Promise<unknown> {
      const parts = String(name).split(":");
      const command = parts[0];
      if (command === "archivePutBegin") {
        files.set(parts[1] as string, "");
        return { ok: true };
      }
      if (command === "archivePutChunk") {
        const id = parts[1] as string;
        const expected = Number(parts[2]);
        const marker = `archivePutChunk:${id}:${expected}:`;
        let binary = atob(String(name).substring(marker.length));
        if (options.dropTransport && !transportDropped) {
          binary = binary.slice(0, -1); // 传输层丢字节：长度不符、未落盘
          transportDropped = true;
        }
        if (binary.length !== expected) {
          return { ok: false, wrote: 0, decoded: binary.length, detail: "传输丢字节" };
        }
        if (options.dropDisk) binary = binary.slice(0, -1); // 落盘丢字节：已写入但短一截
        files.set(id, (files.get(id) ?? "") + binary);
        return { ok: true, wrote: binary.length };
      }
      if (command === "archiveRead") {
        const id = parts[1] as string;
        const offset = Number(parts[2]);
        const length = Number(parts[3]);
        const content = files.get(id) ?? "";
        return { ok: true, data: btoa(content.substring(offset, offset + length)) };
      }
      if (command === "archiveDrop") {
        files.delete(parts[1] as string);
        return { ok: true };
      }
      return { ok: false };
    },
  };
  return host as unknown as Mn & { files: Map<string, string> };
}

function payload(size: number): Blob {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) bytes[i] = (i * 131 + 7) & 255;
  return new Blob([bytes]);
}

async function main() {
  const logs: string[] = [];
  const file = payload(100 * 1024 + 5);

  // 正常往返
  const host = mockHost();
  const id = await saveArchive(host, file, (message) => logs.push(message));
  const restored = new Uint8Array(await loadArchive(host, { id, size: file.size }, (message) => logs.push(message)).then((b) => b.arrayBuffer()) as ArrayBuffer);
  const original = new Uint8Array(await file.arrayBuffer() as ArrayBuffer);
  ok(restored.length === original.length, "往返长度一致");
  ok(restored.every((byte, index) => byte === original[index]), "往返逐字节一致");
  ok(logs.some((line) => line.includes("备份")), "写入日志");

  // 传输层丢一次字节：应重试后成功
  const flaky = mockHost({ dropTransport: true });
  const id2 = await saveArchive(flaky, payload(40 * 1024), () => {});
  ok((flaky.files.get(id2) ?? "").length === 40 * 1024, "传输丢字节自动重试后完整");

  // 落盘丢字节：必须中止且不得留下备份
  const broken = mockHost({ dropDisk: true });
  await saveArchive(broken, payload(40 * 1024), () => {}).then(
    () => { throw new Error("落盘损坏应失败"); },
    (error: unknown) => ok(error instanceof Error && error.message.includes("写入失败"), "落盘损坏报错"),
  );
  ok(broken.files.size === 0, "失败后无残留备份");

  // 读取长度不符：必须报错
  const mismatch = mockHost();
  const id3 = await saveArchive(mismatch, payload(70 * 1024), () => {});
  await loadArchive(mismatch, { id: id3, size: 80 * 1024 }, () => {}).then(
    () => { throw new Error("长度不符应失败"); },
    (error: unknown) => ok(error instanceof Error && error.message.includes("长度不符"), "读取长度校验"),
  );

  await dropArchive(mismatch, id3);
  ok(mismatch.files.size === 0, "删除备份");
}

void main().then(() => console.log("备份传输测试通过"), (error: unknown) => {
  console.error(error);
  throw error;
});
