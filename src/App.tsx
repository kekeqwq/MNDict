import { useEffect, useMemo, useRef, useState } from "react";
import { isJapanese, playAudio } from "./audio";
import { dropArchive, listArchives, loadArchive, saveArchive } from "./archive";
import { createDictionaryStore, PARSER_VERSION, type Dictionary, type Match } from "./dictionary";
import { Glossary } from "./glossary";
import type { PhraseLookup } from "./phrases";
import { lookupSelection } from "./selectionLookup";
import { resolvePalette } from "./theme";
import { scopeDictionaryCss } from "./yomitan";

const host = typeof mn === "undefined" ? undefined : mn;
const library = createDictionaryStore(host);
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const settingsEvent = "mn:mndict-open";

interface SettingsResponse { ok: boolean; autoLookup?: boolean; autoPlay?: boolean; got?: string; keys?: string }

interface QueryResult { query: string; matches: Match[]; error?: string }

function AudioButtons({ match }: { match: Match }) {
  const japanese = isJapanese(match.term + match.reading);
  return <span className="audio">
    <button type="button" className="ask-ai" onClick={() => void askNativeAI()}>✦ Ask AI</button>
    <button type="button" aria-label="播放发音" onClick={() => void playAudio(match.term, match.reading, 2)}>🔊</button>
    {japanese ? null : <button type="button" aria-label="英式发音" onClick={() => void playAudio(match.term, match.reading, 1)}>英</button>}
  </span>;
}

// 呼出 MarginNote 原生 Ask AI（自动带上当前选区语境），成功后原生侧关闭本卡片
async function askNativeAI() {
  if (!host || !__MN_NATIVE_BRIDGE__) return;
  try {
    await host.call<{ ok: boolean }>("askAI");
  } catch {
    // 原生日志已记录失败原因
  }
}

function EntryList({ matches }: { matches: Match[] }) {
  return <>{matches.map((match, index) => <article key={index}>
    <header><strong>{match.term}</strong>
      {match.reading && match.reading !== match.term ? <span>{match.reading}</span> : null}
    </header>
    <small className="meta">{match.dictionary}{match.tags ? ` · ${match.tags}` : ""}<AudioButtons match={match} /></small>
    {match.definitions.length ? <Glossary items={match.definitions} /> : <p>这条释义没有可显示的文本。</p>}
  </article>)}</>;
}

function Results({ state, css, phrases }: { state: QueryResult | null; css: string; phrases: PhraseLookup[] | null }) {
  if (!state) return null;
  const phraseTotal = (phrases ?? []).reduce((sum, hit) => sum + hit.matches.length, 0);
  return <section aria-label="释义" aria-live="polite" className="results">
    {css ? <style>{css}</style> : null}
    {phrases?.length ? <>
      <details className="result-group" open>
        <summary><span className="marker" aria-hidden="true">▶</span>
          <span className="group-title">单词 · {state.query}</span><span className="count">{state.matches.length}</span></summary>
        <div className="group-body">
          {state.error ? <p role="alert">{state.error}</p> : !state.matches.length ? <p>启用的词典里没有找到这个词。</p> : <EntryList matches={state.matches} />}
        </div>
      </details>
      <details className="result-group" open>
        <summary><span className="marker" aria-hidden="true">▶</span>
          <span className="group-title">短语 · {phrases.map((hit) => hit.phrase).join(" / ")}</span><span className="count">{phraseTotal}</span></summary>
        <div className="group-body">
          {phrases.map((hit) => <div className="phrase-block" key={hit.phrase}>
            <h3>{hit.phrase}</h3>
            <EntryList matches={hit.matches} />
          </div>)}
        </div>
      </details>
    </> : <>
      <h2 hidden={state.matches[0]?.term.toLowerCase() === state.query.toLowerCase() && !state.error}>{state.query}</h2>
      {state.error ? <p role="alert">{state.error}</p> : !state.matches.length ? <p>启用的词典里没有找到这个词。</p> : null}
      <EntryList matches={state.matches} />
    </>}
  </section>;
}

export function App() {
  const [mode, setMode] = useState<"workspace" | "mini" | null>(
    () => (host && __MN_NATIVE_BRIDGE__) ? null : "workspace");
  const [palette, setPalette] = useState(() => resolvePalette(undefined, host?.theme));
  const [dictionaries, setDictionaries] = useState<Dictionary[]>([]);
  const [autoLookup, setAutoLookup] = useState<boolean | null>(null);
  const [autoPlay, setAutoPlay] = useState<boolean | null>(null);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [phrases, setPhrases] = useState<PhraseLookup[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [storageError, setStorageError] = useState("");
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [pendingClear, setPendingClear] = useState<"cache" | "all" | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const dictCss = useMemo(() => dictionaries.filter((dict) => dict.enabled && dict.css)
    .map((dict) => scopeDictionaryCss(dict.css ?? "")).join("\n"), [dictionaries]);

  useEffect(() => {
    let active = true;
    let opened = false;
    let maintenance: Promise<void> | undefined;
    async function lookup(text: string, pageText: string) {
      let miss = false;
      try {
        await maintenance;
        if (!active) return;
        const outcome = await lookupSelection(library, text, pageText);
        if (!active) return;
        miss = outcome.miss;
        if (!miss) {
          setPhrases(outcome.phrases);
          setResult({ query: text, matches: outcome.matches });
        }
      } catch (error) {
        if (!active) return;
        setResult({ query: text, matches: [], error: errorText(error) });
      }
      await host?.call(miss ? "lookupMiss" : "lookupHit");
    }
    function applyOpen(data: unknown) {
      const open = data as { mode?: unknown; text?: unknown; theme?: unknown; pageText?: unknown } | null;
      if (opened || (open?.mode !== "mini" && open?.mode !== "workspace")) return;
      opened = true;
      setPalette(resolvePalette(open.theme, host?.theme));
      setMode(open.mode);
      if (open.mode === "workspace") host?.size(480, 640); // 迷你查词卡尺寸由原生固定定位决定，不覆盖
      if (open.mode === "mini" && typeof open.text === "string") {
        void lookup(open.text, typeof open.pageText === "string" ? open.pageText : "").catch(() => {});
      }
    }
    function onOpen(event: Event) {
      if (event instanceof CustomEvent) applyOpen(event.detail);
    }
    addEventListener(settingsEvent, onOpen);
    library.list().then((items) => { if (active) setDictionaries(items); })
      .catch((error: unknown) => { if (active) setStorageError(`无法打开插件词典存储：${errorText(error)}`); });
    if (host && __MN_NATIVE_BRIDGE__) {
      host.call<SettingsResponse>("getSettings").then((response) => {
        if (!active || !response?.ok) return;
        if (typeof response.autoLookup === "boolean") setAutoLookup(response.autoLookup);
        if (typeof response.autoPlay === "boolean") setAutoPlay(response.autoPlay);
      }).catch(() => {});
      host.call<unknown>("getOpenState").then((state) => { if (active) applyOpen(state); }).catch(() => {});
      maintenance = update(async () => {
        if (!host || !__MN_NATIVE_BRIDGE__) return;
        for (const dict of await library.list()) {
          if (dict.parser === PARSER_VERSION || !dict.archiveId) continue;
          appendLog(`《${dict.title}》索引格式过旧，从备份重建…`);
          await library.deleteDictionary(dict.id);
        }
        const archives = await listArchives(host);
        const items = await library.list();
        appendLog(`启动核对：索引 ${items.length} 部，备份 ${archives.length} 份`);
        const known = new Set(items.map((dict) => dict.archiveId).filter(Boolean));
        for (const archive of archives) {
          if (known.has(archive.id)) continue;
          appendLog(`发现备份词典 ${archive.id}（${(archive.size / 1048576).toFixed(1)} MiB），重建索引…`);
          try {
            const blob = await loadArchive(host, archive, appendLog);
            try {
              const item = await library.importZip(blob, appendLog,
                (done, total) => setProgress({ done, total }), archive.id);
              appendLog(`重建完成：${item.title}（${item.count.toLocaleString()} 条）`);
            } catch (error) {
              const detail = errorText(error);
              appendLog(`重建失败：${detail}`);
              if (/JSON|格式|index\.json|Yomitan|词条|Local file header|header/i.test(detail)) {
                await dropArchive(host, archive.id).catch(() => {});
                appendLog("备份已损坏，移入回收目录");
              }
            }
          } catch (error) {
            appendLog(`读取备份失败：${errorText(error)}`);
          }
        }
      });
    }
    return () => {
      active = false;
      removeEventListener(settingsEvent, onOpen);
    };
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  useEffect(() => {
    if (mode !== "mini" || !host) return;
    // 兑底：面板失焦/隐藏时关闭（部分环境不发 blur，原生手势为主）
    let last = Date.now(); // 面板刚打开的 800ms 免疫初始失焦
    function close() {
      const now = Date.now();
      if (now - last < 800) return;
      last = now;
      host?.close();
    }
    function onBlur() { close(); }
    function onVisibility() { close(); }
    addEventListener("blur", onBlur);
    addEventListener("visibilitychange", onVisibility);
    return () => {
      removeEventListener("blur", onBlur);
      removeEventListener("visibilitychange", onVisibility);
    };
  }, [mode]);

  useEffect(() => {
    if (!host || !mode) return;
    // 迷你查词卡尺寸由原生固定定位决定，页面不覆盖
    if (mode === "mini") return;
    host.size(480, 640);
  }, [mode]);

  useEffect(() => {
    if (mode !== "mini" || !autoPlay || !result?.matches.length) return;
    const first = result.matches[0] as Match;
    void playAudio(first.term, first.reading, 2);
  }, [result, autoPlay, mode]);

  useEffect(() => {
    if (mode !== "mini") host?.fit(); // 迷你查词卡为固定整列尺寸，内容内部滚动
  }, [mode, dictionaries, progress, result, message, pendingDelete, storageError, log]);

  function appendLog(line: string) {
    setLog((lines) => [...lines.slice(-199), line]);
  }

  async function update(action: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await action();
      setDictionaries(await library.list());
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  async function changeAutoLookup(enabled: boolean) {
    if (!host) return;
    await update(async () => {
      const response = await host.call<SettingsResponse>(enabled ? "enableAutoLookup" : "disableAutoLookup");
      if (!response?.ok || response.autoLookup !== enabled) {
        throw new Error(`无法保存划词设置：${JSON.stringify(response)}`);
      }
      setAutoLookup(enabled);
    });
  }

  async function changeAutoPlay(enabled: boolean) {
    if (!host) return;
    await update(async () => {
      const response = await host.call<SettingsResponse>(enabled ? "enableAutoPlay" : "disableAutoPlay");
      if (!response?.ok || response.autoPlay !== enabled) {
        throw new Error(`无法保存发音设置：${JSON.stringify(response)}`);
      }
      setAutoPlay(enabled);
    });
  }

  async function clearData(kind: "cache" | "all") {
    await update(async () => {
      await library.clearAll();
      if (kind === "all" && host && __MN_NATIVE_BRIDGE__) {
        for (const archive of await listArchives(host)) await dropArchive(host, archive.id);
      }
      setMessage(kind === "cache" ? "已清空查询缓存，打开面板时会从备份自动重建" : "已清空全部词典数据");
      setPendingClear(null);
    });
  }

  // 模式未定时渲染空白，避免设置界面在查词时闪现
  if (mode === null) return <main className="popup" data-palette={palette} aria-busy="true" />;

  if (mode === "mini") return <main className="popup" data-palette={palette}>
    <div className="drag-title" aria-hidden="true">MNDict</div>
    {result ? <Results state={result} css={dictCss} phrases={phrases} /> : <p role="status">正在查词…</p>}
  </main>;

  return <main className="settings" data-palette={palette}>
    <header className="top"><div><h1>MNDict 设置</h1><p>MarginNote PDF · 本地离线词典</p></div>
      {host ? <button type="button" onClick={() => host.close()}>关闭</button> : null}</header>
    <section className="group">
      <h2>阅读</h2>
      <label className="switch"><input type="checkbox" checked={autoLookup ?? false} disabled={busy || autoLookup === null}
        onChange={(event) => void changeAutoLookup(event.currentTarget.checked)} /> PDF 划词后自动显示释义</label>
      {autoLookup === null ? <small>需要在 MarginNote 中打开此设置。</small> : <small>不创建摘录，不修改原文档。</small>}
      <label className="switch"><input type="checkbox" checked={autoPlay ?? false} disabled={busy || autoPlay === null}
        onChange={(event) => void changeAutoPlay(event.currentTarget.checked)} /> 查词后自动发音</label>
    </section>
    <section className="group" aria-labelledby="dict-label">
      <div className="top"><h2 id="dict-label">词典</h2>
        <label className="file-label">导入 Yomitan ZIP<input type="file" accept=".zip,application/zip" disabled={busy || !!storageError}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) void update(async () => {
              setLog([]);
              let archiveId: string | undefined;
              if (host && __MN_NATIVE_BRIDGE__) {
                appendLog("备份词典到 MarginNote 文稿目录（可自动恢复）…");
                archiveId = await saveArchive(host, file, appendLog);
              }
              try {
                const item = await library.importZip(file, appendLog, (done, total) => setProgress({ done, total }), archiveId);
                setMessage(`已导入 ${item.title}（${item.count.toLocaleString()} 条）`);
              } catch (error) {
                if (archiveId && host) await dropArchive(host, archiveId).catch(() => {});
                throw error;
              }
            });
          }} /></label>
      </div>
      {progress ? <p role="status">正在索引 {progress.done} / {progress.total} <progress value={progress.done} max={progress.total} /></p> : null}
      {log.length ? <div className="log" role="log" ref={logRef}>{log.map((line, index) => <div key={index}>{line}</div>)}</div> : null}
      {storageError ? <p role="alert">{storageError}</p> : !dictionaries.length && !progress ? <p>还没有导入词典。</p> : null}
      <ul className="library">{dictionaries.map((dict, index) => <li key={dict.id}>
        <label className="dict-name"><input type="checkbox" checked={dict.enabled} disabled={busy}
          onChange={(event) => { const enabled = event.currentTarget.checked; void update(() => library.setEnabled(dict.id, enabled)); }} />
          <span><strong>{dict.title}</strong><small>{dict.revision} · {dict.count.toLocaleString()} 条</small></span></label>
        <div className="actions">
          <button type="button" aria-label={`上移 ${dict.title}`} disabled={busy || index === 0} onClick={() => void update(() => library.move(dict.id, -1))}>↑</button>
          <button type="button" aria-label={`下移 ${dict.title}`} disabled={busy || index === dictionaries.length - 1} onClick={() => void update(() => library.move(dict.id, 1))}>↓</button>
          <button type="button" disabled={busy} onClick={() => setPendingDelete(dict.id)}>删除</button>
        </div>
        {pendingDelete === dict.id ? <div className="confirm">删除「{dict.title}」？
          <button type="button" disabled={busy} onClick={() => void update(async () => { await library.deleteDictionary(dict.id); setPendingDelete(null); })}>确认删除</button>
          <button type="button" onClick={() => setPendingDelete(null)}>取消</button>
        </div> : null}
      </li>)}</ul>
      {message ? <p role="status">{message}</p> : null}
      <div className="actions">
        <button type="button" disabled={busy || !!storageError} onClick={() => setPendingClear("cache")}>清空缓存</button>
        <button type="button" disabled={busy || !!storageError} onClick={() => setPendingClear("all")}>清空全部存储</button>
      </div>
      {pendingClear ? <div className="confirm">{pendingClear === "cache" ? "清空查询缓存？词典会从备份自动重建。" : "删除全部词典与备份？不可恢复。"}
        <button type="button" disabled={busy} onClick={() => void clearData(pendingClear)}>确认</button>
        <button type="button" onClick={() => setPendingClear(null)}>取消</button>
      </div> : null}
    </section>
  </main>;
}
