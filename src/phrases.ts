import type { Match } from "./dictionary";

// 词组识别（行为参考 Kiki/Yomitan 的词组扫描）：从 PDF 文字层上下文生成 2–5 词候选，
// 只有词典里真实存在的多词条目才算识别到的词组；不做语法分析。
export interface PhraseLookup {
  phrase: string;
  matches: Match[];
}

export interface PhraseSource {
  search(text: string): Promise<Match[]>;
}

const tokenPattern = /[a-zA-Z0-9_\u00C0-\u024F]+(?:['’][a-zA-Z0-9_\u00C0-\u024F]+)?/g;
const hyphenPattern = /[a-zA-Z0-9_\u00C0-\u024F]+(?:-[a-zA-Z0-9_\u00C0-\u024F]+)+/g;
// eslint-disable-next-line no-restricted-syntax -- 字符串归一化，不操作 DOM
const normalize = (text: string) => text.normalize("NFKC").toLowerCase().replaceAll("’", "'");

function tokenize(text: string): string[] {
  return [...text.matchAll(tokenPattern)].map((match) => normalize(match[0]));
}

// 选区可能跨多个词（如选中 small park），在页面 token 流里找全部出现位置
function selectionSpans(tokens: string[], picked: string[]): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  for (let start = 0; start + picked.length <= tokens.length; start += 1) {
    let equal = true;
    for (let i = 0; i < picked.length; i += 1) {
      if (tokens[start + i] !== picked[i]) { equal = false; break; }
    }
    if (equal) spans.push([start, start + picked.length - 1]);
    if (spans.length >= 10) break;
  }
  return spans;
}

// 以选区为中心的多词候选：前向短语优先（长在前），其次包含选区的前后扩展窗口
export function phraseCandidates(selection: string, pageText: string, max = 28): string[] {
  const picked = tokenize(selection);
  if (!picked.length || !/[a-zA-Z]/.test(selection)) return [];
  const tokens = tokenize(pageText);
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (phrase: string) => {
    const key = normalize(phrase);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(phrase);
    }
  };
  for (const match of pageText.matchAll(hyphenPattern)) {
    const compound = match[0];
    const parts = normalize(compound).split("-");
    if (parts.some((part) => picked.includes(part)) || normalize(compound) === normalize(selection)) {
      push(compound);
      push(compound.replaceAll("-", " "));
      push(compound.replaceAll("-", ""));
    }
  }
  for (const [start, end] of selectionSpans(tokens, picked)) {
    for (let extra = 5 - picked.length; extra >= 1; extra -= 1) {
      const to = end + extra;
      if (to >= tokens.length) break;
      push(tokens.slice(start, to + 1).join(" "));
    }
    for (let spanLen = 5; spanLen >= 2; spanLen -= 1) {
      for (let from = Math.max(0, start - spanLen + 1); from <= start; from += 1) {
        const to = from + spanLen - 1;
        if (to < end || to >= tokens.length) continue;
        push(tokens.slice(from, to + 1).join(" "));
      }
    }
  }
  return out.slice(0, max);
}

// 逐个查词典，命中即为识别到的词组；长候选优先，凑满 limit 即停
export async function findPhrases(source: PhraseSource, selection: string, pageText: string, limit = 3): Promise<PhraseLookup[]> {
  const hits: PhraseLookup[] = [];
  for (const phrase of phraseCandidates(selection, pageText)) {
    let matches: Match[];
    try {
      matches = await source.search(phrase);
    } catch {
      continue;
    }
    if (matches.length) hits.push({ phrase, matches });
    if (hits.length >= limit) break;
  }
  return hits;
}
