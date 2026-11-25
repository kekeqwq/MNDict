import { findPhrases, type PhraseSource } from "./phrases";

export async function lookupSelection(source: PhraseSource, text: string, pageText: string) {
  const [word, phrase] = await Promise.allSettled([
    source.search(text),
    findPhrases(source, text, pageText),
  ]);
  const matches = word.status === "fulfilled" ? word.value : [];
  const phrases = phrase.status === "fulfilled" ? phrase.value : [];
  const failure = word.status === "rejected" ? word : phrase.status === "rejected" ? phrase : null;
  if (failure && !matches.length && !phrases.length) throw failure.reason;
  return { matches, phrases, miss: matches.length === 0 && phrases.length === 0 };
}
