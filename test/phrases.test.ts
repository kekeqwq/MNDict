import type { Match } from "../src/dictionary";
import { findPhrases, phraseCandidates } from "../src/phrases";

function ok(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`断言失败：${message}`);
}

function has(list: string[], phrase: string, message: string) {
  ok(list.includes(phrase), `${message}（候选：${list.slice(0, 8).join(" / ")}）`);
}

const sentence = "It was near a small park in Carboneras, so she told me to leave.";

// 单词选区：生成含该词的 2–5 词候选，前向优先
const was = phraseCandidates("was", sentence);
has(was, "was near", "前向两词候选");
has(was, "it was", "向前扩展候选");
has(was, "it was near", "前后扩展候选");
ok(!was.includes("was"), "候选不得是单词本身");
ok(was.every((phrase) => phrase.split(" ").length >= 2), "候选都是多词");
ok(was.indexOf("was near") < was.indexOf("it was"), "前向短语优先于向前扩展");

// 多词选区：扩展窗口要完整包含选区
const park = phraseCandidates("small park", sentence);
has(park, "a small park", "含多词选区的扩展");
has(park, "small park in", "多词选区的前向扩展");

// 同词多次出现时候选去重
const twice = phraseCandidates("was", "It was near. It was far.");
ok(twice.indexOf("it was") === twice.lastIndexOf("it was"), "重复出现的候选去重");

// 连字符复合词吸收
has(phraseCandidates("risk", "A high-risk patient left."), "high-risk", "连字符复合词");
has(phraseCandidates("risk", "A high-risk patient left."), "high risk", "去连字符变体");

// 非拉丁选区不做词组识别（日文等分词另行处理）
ok(phraseCandidates("それは", "それは猫です。").length === 0, "非拉丁选区跳过");

// 词典验证：只有命中的候选算识别到的词组
const mock = {
  async search(text: string): Promise<Match[]> {
    return text === "it was" ? [{ term: "it was", reading: "", tags: "", score: 0, definitions: [], dictionary: "OALD" }] : [];
  }
};
const hits = await findPhrases(mock, "was", sentence);
const top = hits[0];
ok(hits.length === 1 && top?.phrase === "it was", "只保留词典命中的词组");
ok(top?.matches.length === 1, "带上词组释义");

console.log("词组识别测试通过");
