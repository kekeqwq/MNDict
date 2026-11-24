// 发音三级降级：有道 dictvoice（点击手势下可用）→ 原生 SpeechManager（不受自动播放策略限制）→ 系统语音合成。
const host = typeof mn === "undefined" ? undefined : mn;

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

async function playRemote(term: string, reading: string, type: 1 | 2): Promise<boolean> {
  if (current) {
    current.pause();
    current = null;
  }
  const audio = new Audio(audioUrl(term, reading, type));
  current = audio;
  await audio.play();
  return true;
}

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

async function speakNative(text: string, japanese: boolean): Promise<boolean> {
  if (!host || !__MN_NATIVE_BRIDGE__) return false;
  try {
    const result = await host.call<{ ok: boolean }>(`speak:${japanese ? "ja-JP" : "en-US"}:${text}`);
    return Boolean(result?.ok);
  } catch {
    return false;
  }
}

export async function playAudio(term: string, reading: string, type: 1 | 2 = 2): Promise<boolean> {
  const japanese = isJapanese(term + reading);
  const text = (japanese ? reading || term : term).trim();
  if (!text) return false;
  try {
    await playRemote(term, reading, type);
    return true;
  } catch {
    // 自动播放策略会在无手势时拒绝，继续降级
  }
  if (await speakNative(text, japanese)) return true;
  return speak(text, japanese);
}
