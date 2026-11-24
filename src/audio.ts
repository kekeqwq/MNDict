// 发音：有道 dictvoice（与 Kiki Safari 版一致），失败时退回系统语音合成。
export function isJapanese(text: string): boolean {
  return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(text);
}

export function audioUrl(term: string, reading: string, type: 1 | 2): string {
  const japanese = isJapanese(term + reading);
  const spoken = (japanese ? reading || term : term).trim();
  const suffix = japanese ? "le=jap" : `type=${type}`;
  return `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(spoken)}&${suffix}`;
}

let current: HTMLAudioElement | null = null;

function speak(text: string, japanese: boolean): boolean {
  try {
    if (typeof speechSynthesis === "undefined") return false;
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = japanese ? "ja-JP" : "en-US";
    utterance.rate = 0.92;
    speechSynthesis.speak(utterance);
    return true;
  } catch {
    return false;
  }
}

export async function playAudio(term: string, reading: string, type: 1 | 2 = 2): Promise<boolean> {
  const japanese = isJapanese(term + reading);
  const text = (japanese ? reading || term : term).trim();
  if (!text) return false;
  try {
    if (current) {
      current.pause();
      current = null;
    }
    const audio = new Audio(audioUrl(term, reading, type));
    current = audio;
    await audio.play();
    return true;
  } catch {
    return speak(text, japanese);
  }
}
