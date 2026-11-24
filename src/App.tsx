import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { isJapanese, playAudio } from "./audio";
import { dropArchive, listArchives, loadArchive, saveArchive } from "./archive";
import { createDictionaryStore, type Dictionary, type Match } from "./dictionary";
import { Glossary } from "./glossary";
import { scopeDictionaryCss } from "./yomitan";

const library = createDictionaryStore();
const host = typeof mn === "undefined" ? undefined : mn;
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const settingsEvent = "mn:mndict-open";

interface SettingsResponse { ok: boolean; autoLookup?: boolean; autoPlay?: boolean; got?: string; keys?: string }

interface QueryResult { query: string; matches: Match[]; error?: string }

function AudioButtons({ match }: { match: Match }) {
  const japanese = isJapanese(match.term + match.reading);
  return <span className="audio">
    <button type="button" aria-label="播放发音" onClick={() => void playAudio(match.term, match.reading, 2)}>🔊</button>
    {japanese ? null : <button type="button" aria-label="英式发音" onClick={() => void playAudio(match.term, match.reading, 1)}>英</button>}
  </span>;
}

function Results({ state, css }: { state: QueryResult | null; css: string }) {
  if (!state) return null;
  return <section aria-label="释义" aria-live="polite" className="results">
    {css ? <style>{css}</style> : null}
    <h2>{state.query}</h2>
    {state.error ? <p role="alert">{state.error}</p> : !state.matches.length ? <p>启用的词典里没有找到这个词。</p> : null}
    {state.matches.map((match, index) => <article key={index}>
      <header><strong>{match.term}</strong>
        {match.reading && match.reading !== match.term ? <span>{match.reading}</span> : null}
        <AudioButtons match={match} />
      </header>
      <small>{match.dictionary}{match.tags ? ` · ${match.tags}` : ""}</small>
      {match.definitions.length ? <Glossary items={match.definitions} /> : <p>这条释义没有可显示的文本。</p>}
    </article>)}
  </section>;
}

export function App() {
  const [mode, setMode] = useState(() => host?.currentMode ?? "workspace");
  const [dictionaries, setDictionaries] = useState<Dictionary[]>([]);
  const [autoLookup, setAutoLookup] = useState<boolean | null>(null);
  const [autoPlay, setAutoPlay] = useState<boolean | null>(null);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<QueryResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [storageError, setStorageError] = useState("");
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const lookupVersion = useRef(0);
  const logRef = useRef<HTMLDivElement>(null);
  const dictCss = useMemo(() => dictionaries.filter((dict) => dict.enabled && dict.css)
    .map((dict) => scopeDictionaryCss(dict.css ?? "")).join("\n"), [dictionaries]);

  async function search(text: string) {
    const normalized = text.trim();
    const version = ++lookupVersion.current;
    setResult(null);
    if (!normalized) return;
    try {
      const matches = await library.search(normalized);
      if (version === lookupVersion.current) setResult({ query: normalized, matches });
    } catch (error) {
      if (version === lookupVersion.current) setResult({ query: normalized, matches: [], error: errorText(error) });
    }
  }

  useEffect(() => {
    let active = true;
    function applyOpen(data: unknown) {
      const open = data as { mode?: unknown; text?: unknown } | null;
      if (open?.mode !== "mini" && open?.mode !== "workspace") return;
      setMode(open.mode);
      if (open.mode === "mini" && typeof open.text === "string") {
        setQuery(open.text);
        void search(open.text);
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
      void update(async () => {
        if (!host || !__MN_NATIVE_BRIDGE__) return;
        const archives = await listArchives(host);
        const known = new Set((await library.list()).map((dict) => dict.archiveId).filter(Boolean));
        for (const archive of archives) {
          if (known.has(archive.id)) continue;
          appendLog(`发现备份词典 ${archive.id}（${(archive.size / 1048576).toFixed(1)} MiB），重建索引…`);
          try {
            const blob = await loadArchive(host, archive, appendLog);
            const item = await library.importZip(blob, appendLog,
              (done, total) => setProgress({ done, total }), archive.id);
            appendLog(`重建完成：${item.title}（${item.count.toLocaleString()} 条）`);
          } catch (error) {
            appendLog(`重建失败：${errorText(error)}`);
          }
        }
      });
    }
    return () => {
      active = false;
      removeEventListener(settingsEvent, onOpen);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅挂载时执行一次
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  useEffect(() => {
    if (!host) return;
    host.size(mode === "workspace" ? 480 : 420, mode === "workspace" ? 640 : 420);
  }, [mode]);

  useEffect(() => {
    if (mode !== "mini" || !autoPlay || !result?.matches.length) return;
    const first = result.matches[0] as Match;
    void playAudio(first.term, first.reading, 2);
  }, [result, autoPlay, mode]);

  useEffect(() => { host?.fit(); }, [mode, dictionaries, progress, result, message, pendingDelete, storageError, log]);

  function appendLog(line: string) {
    setLog((lines) => [...lines.slice(-199), line]);
  }

  async function update(action: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await action();
      setDictionaries(await library.list());
      if (result) await search(query);
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

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void search(query);
  }

  if (mode === "mini") return <main className="popup">
    <header className="top"><span>MNDict</span><button type="button" onClick={() => host?.close()}>关闭</button></header>
    {result ? <Results state={result} css={dictCss} /> : <p role="status">正在查词…</p>}
  </main>;

  return <main className="settings">
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
    </section>
    <section className="group"><h2>试查</h2>
      <form className="search" onSubmit={submit}><input aria-label="输入单词" placeholder="输入单词" maxLength={120} value={query} onChange={(event) => setQuery(event.currentTarget.value)} />
        <button type="submit" disabled={busy || !query.trim() || !!storageError}>查询</button></form>
      <Results state={result} css={dictCss} />
    </section>
  </main>;
}
