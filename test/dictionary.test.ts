import "fake-indexeddb/auto";
import { BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js";
import { createDictionaryStore, PARSER_VERSION, searchKeys } from "../src/dictionary";
import { definitionText, scopeDictionaryCss } from "../src/yomitan";

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
const bankWithRedirect = [
  ["redirectme", "redirectme", "", "", 0, [["targetx", ["redirect"]]], 5, ""],
  ["targetx", "targetx", "", "", 0, ["目标释义"], 6, ""],
];

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
    "styles.css": ".headword{color:#333;background:url(https://evil.example/x.png)}@import url(https://evil.example/y.css);",
    "term_bank_1.json": JSON.stringify([...bank, ...bankWithRedirect] as unknown[]),
    "term_bank_2.json": JSON.stringify(secondBank),
  }), (message) => logs.push(message), (done, total) => progress.push([done, total]), "arc-test");
  ok(dict.ready && dict.count === 5, "导入词条数");
  ok(dict.archiveId === "arc-test", "备份 id 透传");
  ok((dict.css ?? "").includes(".headword") && !(dict.css ?? "").includes("url("), "词典 CSS 提取并清洗");
  ok(progress.length === 3 && progress.at(-1)?.[0] === 2, "导入进度回调");
  ok(logs.some((line) => line.includes("导入完成")) && logs.some((line) => line.includes("解析")), "导入日志");
  ok((await library.list()).length === 1, "词典列表");

  const matches = await library.search("Continuations");
  ok(matches.some((entry) => entry.term === "continuation" && entry.dictionary === "Test Dict"), "按词形查到词条");
  ok((await library.search("run"))[0]?.definitions[0] === "跑步", "结构化释义保留原始结构");
  ok(typeof (await library.search("run"))[0]?.definitions[1] === "object", "结构化内容不摊平");
  ok((await library.search("redirectme"))[0]?.definitions[0] === "目标释义", "跳转词条解析");
  const scoped = scopeDictionaryCss("/* c */ :root{--x:red}.a{color:red}@media print{.b{color:blue}}");
  ok(scoped.includes(".glossary{--x:red}") && scoped.includes(".glossary .a{color:red}"), "词典 CSS 作用域化");
  ok(scoped.includes("@media print{.glossary .b"), "媒体查询内作用域化");
  ok(dict.parser === PARSER_VERSION, "解析器版本标记");

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
  await reopened.clearAll();
  ok((await reopened.list()).length === 0, "清空全部词典数据");
}

void main().then(() => console.log("全部测试通过"), (error: unknown) => {
  console.error(error);
  throw error;
});
