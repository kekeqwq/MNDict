import "fake-indexeddb/auto";
import { BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js";
import { createDictionaryStore, searchKeys } from "../src/dictionary";
import { definitionText } from "../src/yomitan";

function ok(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`断言失败：${message}`);
}

async function zip(files: Record<string, string>): Promise<Blob> {
  const writer = new ZipWriter(new BlobWriter());
  for (const [name, content] of Object.entries(files)) {
    await writer.add(name, new TextReader(content));
  }
  return writer.close();
}

const bank = [
  ["continuation", "continuation", "noun", "", 5, ["延续；继续"], 1, "common"],
  ["run", "run", "verb", "", 20, ["跑步", [{ tag: "div", content: "移动" }]], 2, "common"],
];
const secondBank = [["hello", "hello", "interj", "", 10, ["你好"], 3, "common"]];

async function main() {
  // 格式解析
  ok(definitionText([{ tag: "div", content: ["a", { tag: "br" }, "b"] }]) === "a\nb\n", "结构化释义渲染");
  ok(definitionText({ type: "image", alt: "图" }) === "图", "图片回退到 alt");
  ok(new Set(searchKeys("Continuations")).has("continuation"), "英文复数词形还原");

  const dbName = `test-${Date.now()}`;
  const library = createDictionaryStore(dbName);
  const progress: [number, number][] = [];
  const logs: string[] = [];
  const dict = await library.importZip(await zip({
    "index.json": JSON.stringify({ title: "Test Dict", revision: "r1", format: 3, sourceLanguage: "en" }),
    "term_bank_1.json": JSON.stringify(bank),
    "term_bank_2.json": JSON.stringify(secondBank),
  }), (message) => logs.push(message), (done, total) => progress.push([done, total]), "arc-test");
  ok(dict.ready && dict.count === 3, "导入词条数");
  ok(dict.archiveId === "arc-test", "备份 id 透传");
  ok(progress.length === 3 && progress.at(-1)?.[0] === 2, "导入进度回调");
  ok(logs.some((line) => line.includes("导入完成")) && logs.some((line) => line.includes("解析")), "导入日志");
  ok((await library.list()).length === 1, "词典列表");

  const matches = await library.search("Continuations");
  ok(matches.some((entry) => entry.term === "continuation" && entry.dictionary === "Test Dict"), "按词形查到词条");
  ok((await library.search("run"))[0]?.definitions[0] === "跑步", "结构化释义转文本");

  await library.setEnabled(dict.id, false);
  ok((await library.search("run")).length === 0, "停用后查不到");
  await library.setEnabled(dict.id, true);
  ok((await library.search("run")).length === 1, "启用后恢复");

  // 同名同版本拒绝重复导入
  const duplicate = await zip({ "index.json": JSON.stringify({ title: "Test Dict", revision: "r1", format: 3 }), "term_bank_1.json": JSON.stringify(bank) });
  await library.importZip(duplicate).then(() => { throw new Error("重复导入应失败"); }, (error: unknown) => {
    ok(error instanceof Error && error.message.includes("已导入"), "重复导入报错");
  });

  // 第二部词典与排序
  const other = await library.importZip(await zip({
    "index.json": JSON.stringify({ title: "Other", revision: "r1", format: 3 }),
    "term_bank_1.json": JSON.stringify(secondBank),
  }));
  let titles = (await library.list()).map((item) => item.title);
  ok(titles.join(",") === "Test Dict,Other", "默认排序");
  await library.move(other.id, -1);
  titles = (await library.list()).map((item) => item.title);
  ok(titles.join(",") === "Other,Test Dict", "上移排序");

  // 损坏的词条文件不得留下半部词典
  await library.importZip(await zip({
    "index.json": JSON.stringify({ title: "Broken", revision: "r1", format: 3 }),
    "term_bank_1.json": JSON.stringify([["oops"]]),
  })).then(() => { throw new Error("坏词条应失败"); }, () => {});
  ok((await library.list()).length === 2, "失败导入无残留");

  await library.deleteDictionary(dict.id);
  ok((await library.list()).map((item) => item.title).join(",") === "Other", "删除词典");
  ok((await library.search("run")).length === 0, "词条级联删除");

  // IndexedDB 重新打开后仍在（模拟面板关闭/重启）
  const reopened = createDictionaryStore(dbName);
  ok((await reopened.list()).map((item) => item.title).join(",") === "Other", "重新打开后词条仍在");
  ok((await reopened.search("hello"))[0]?.term === "hello", "重新打开后可查询");
}

void main().then(() => console.log("全部测试通过"), (error: unknown) => {
  console.error(error);
  throw error;
});
