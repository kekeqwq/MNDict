// 原生 SQLite 词典库。WebView 的 IndexedDB 在 MN 里会被中途删除且重启后不可靠，
// 查询索引改为原生存储；文件仅经 name 编码的 base64 分块进出，逐块验长度。
var ND_TABLE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
var mndictDbInstance = null;

function ndB64Decode(text) {
  var out = [];
  var buffer = 0;
  var bits = 0;
  for (var i = 0; i < text.length; i++) {
    var value = ND_TABLE.indexOf(text.charAt(i));
    if (value < 0) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push(String.fromCharCode((buffer >> bits) & 255));
    }
  }
  return out.join("");
}

function ndUtf8Decode(binary) {
  var out = [];
  var i = 0;
  while (i < binary.length) {
    var byte = binary.charCodeAt(i++) & 255;
    var code = byte;
    var extra = 0;
    if (byte >= 0xF0) { code = byte & 7; extra = 3; }
    else if (byte >= 0xE0) { code = byte & 15; extra = 2; }
    else if (byte >= 0xC0) { code = byte & 31; extra = 1; }
    while (extra > 0) {
      code = (code << 6) | (binary.charCodeAt(i++) & 63);
      extra -= 1;
    }
    out.push(String.fromCodePoint(code));
  }
  return out.join("");
}

function ndDir() {
  return Application.sharedInstance().documentPath + "/mndict-dictionaries";
}

function ndEnsureDir() {
  NSFileManager.defaultManager().createDirectoryAtPathWithIntermediateDirectoriesAttributes(
    ndDir(), true, null);
}

function ndDb() {
  if (mndictDbInstance) return mndictDbInstance;
  ndEnsureDir();
  var db = SQLiteDatabase.databaseWithPath(ndDir() + "/mndict.sqlite");
  if (!db || !db.open()) throw new Error("无法打开词典数据库");
  db.executeUpdateWithArgumentsInArray(
    "CREATE TABLE IF NOT EXISTS dicts (id TEXT PRIMARY KEY, title TEXT, revision TEXT, sourceLanguage TEXT, css TEXT, enabled INTEGER, ord INTEGER, count INTEGER, archiveId TEXT, parser INTEGER)", []);
  db.executeUpdateWithArgumentsInArray(
    "CREATE TABLE IF NOT EXISTS terms (id INTEGER PRIMARY KEY AUTOINCREMENT, dictId TEXT, key TEXT, term TEXT, reading TEXT, tags TEXT, score REAL, defs TEXT)", []);
  db.executeUpdateWithArgumentsInArray("CREATE INDEX IF NOT EXISTS idx_terms_key ON terms(key)", []);
  db.executeUpdateWithArgumentsInArray("CREATE INDEX IF NOT EXISTS idx_terms_dict ON terms(dictId)", []);
  mndictDbInstance = db;
  return db;
}

function ndText(rs, index) {
  var value = rs.objectForColumnIndex(index);
  return value == null ? "" : String(value);
}

function ndDictRow(rs) {
  return {
    id: ndText(rs, 0), title: ndText(rs, 1), revision: ndText(rs, 2),
    sourceLanguage: ndText(rs, 3), css: ndText(rs, 4),
    enabled: rs.intForColumnIndex(5) === 1, ord: rs.intForColumnIndex(6),
    count: rs.intForColumnIndex(7), archiveId: ndText(rs, 8), parser: rs.intForColumnIndex(9),
  };
}

function ndPutDict(json) {
  var dict = JSON.parse(ndUtf8Decode(ndB64Decode(json)));
  if (!dict || typeof dict.id !== "string") return { ok: false };
  ndDb().executeUpdateWithArgumentsInArray(
    "INSERT OR REPLACE INTO dicts (id,title,revision,sourceLanguage,css,enabled,ord,count,archiveId,parser) VALUES (?,?,?,?,?,?,?,?,?,?)",
    [dict.id, dict.title, dict.revision, dict.sourceLanguage || "", dict.css || "",
      dict.enabled ? 1 : 0, dict.ord || 0, dict.count || 0, dict.archiveId || "", dict.parser || 0]);
  return { ok: true };
}

function ndLookup(keysJson) {
  var keys = JSON.parse(ndUtf8Decode(ndB64Decode(keysJson)));
  if (!Array.isArray(keys) || !keys.length) return { ok: true, rows: [] };
  var marks = keys.map(function () { return "?"; }).join(",");
  var rs = ndDb().executeQueryWithArgumentsInArray(
    "SELECT dictId,key,term,reading,tags,score,defs FROM terms WHERE key IN (" + marks + ") ORDER BY score DESC LIMIT 400", keys);
  var rows = [];
  while (rs.next()) {
    rows.push({
      dictId: ndText(rs, 0), key: ndText(rs, 1), term: ndText(rs, 2), reading: ndText(rs, 3),
      tags: ndText(rs, 4), score: rs.doubleForColumnIndex(5), defs: ndText(rs, 6),
    });
  }
  rs.close();
  return { ok: true, rows: rows };
}

function ndImportTerms(dictId, file) {
  var path = ndDir() + "/staging/" + file;
  var text = NSString.stringWithContentsOfFileEncoding(path, 4); // NSUTF8StringEncoding
  if (!text) return { ok: false };
  var lines = String(text).split("\n");
  var db = ndDb();
  db.beginTransaction();
  var count = 0;
  try {
    for (var i = 0; i < lines.length; i++) {
      if (!lines[i]) continue;
      var row = JSON.parse(lines[i]);
      db.executeUpdateWithArgumentsInArray(
        "INSERT INTO terms (dictId,key,term,reading,tags,score,defs) VALUES (?,?,?,?,?,?,?)",
        [dictId, row[0], row[1], row[2], row[3], row[4], row[5]]);
      count += 1;
    }
    db.commit();
  } catch (error) {
    db.close();
    mndictDbInstance = null;
    return { ok: false, count: count, detail: String(error) };
  }
  NSFileManager.defaultManager();
  NSData.dataWithStringEncoding("", 4).writeToFileAtomically(path, true); // 无删除接口，截断即释放空间
  return { ok: true, count: count };
}

function ndStagePut(name) {
  var rest = name.substring("db:stageChunk:".length);
  var cut1 = rest.indexOf(":");
  var cut2 = rest.indexOf(":", cut1 + 1);
  var file = cut1 < 0 ? "" : rest.substring(0, cut1);
  var expected = cut2 < 0 ? 0 : parseInt(rest.substring(cut1 + 1, cut2), 10) || 0;
  var payload = cut2 < 0 ? "" : rest.substring(cut2 + 1);
  if (!/^[A-Za-z0-9_.-]{1,80}$/.test(file)) return { ok: false, wrote: 0, detail: "文件名非法 " + file };
  var binary = ndB64Decode(payload);
  if (binary.length !== expected) {
    return {
      ok: false, wrote: 0, decoded: binary.length,
      detail: "传输丢字节 got=" + binary.length + " want=" + expected +
        " payload=" + payload.length + " name=" + name.length +
        " tail=" + payload.substring(Math.max(0, payload.length - 10)),
    };
  }
  ndEnsureDir();
  var fm = NSFileManager.defaultManager();
  fm.createDirectoryAtPathWithIntermediateDirectoriesAttributes(ndDir() + "/staging", true, null);
  var path = ndDir() + "/staging/" + file;
  var data = NSData.dataWithStringEncoding(binary, 5); // NSISOLatin1StringEncoding
  if (!data) return { ok: false, wrote: 0, detail: "NSData 转换失败" };
  if (!fm.fileExistsAtPath(path)) {
    if (!data.writeToFileAtomically(path, true)) return { ok: false, wrote: 0, detail: "创建文件失败" };
    return { ok: true, wrote: expected };
  }
  var writer = NSFileHandle.fileHandleForWritingAtPath(path);
  if (!writer) return { ok: false, wrote: 0, detail: "打开文件失败" };
  writer.seekToEndOfFile();
  writer.writeData(data);
  writer.closeFile();
  return { ok: true, wrote: expected };
}

function mndictDbCommand(name, parts) {
  var op = parts[1];
  if (op === "init") { ndDb(); return { ok: true }; }
  if (op === "list") {
    var rs = ndDb().executeQueryWithArgumentsInArray(
      "SELECT id,title,revision,sourceLanguage,css,enabled,ord,count,archiveId,parser FROM dicts ORDER BY ord", []);
    var dicts = [];
    while (rs.next()) dicts.push(ndDictRow(rs));
    rs.close();
    return { ok: true, dictionaries: dicts };
  }
  if (op === "putDict") return ndPutDict(name.substring("db:putDict:".length));
  if (op === "delDict") {
    ndDb().executeUpdateWithArgumentsInArray("DELETE FROM terms WHERE dictId=?", [parts[2]]);
    ndDb().executeUpdateWithArgumentsInArray("DELETE FROM dicts WHERE id=?", [parts[2]]);
    return { ok: true };
  }
  if (op === "clearAll") {
    ndDb().executeUpdateWithArgumentsInArray("DELETE FROM terms", []);
    ndDb().executeUpdateWithArgumentsInArray("DELETE FROM dicts", []);
    return { ok: true };
  }
  if (op === "lookup") return ndLookup(name.substring("db:lookup:".length));
  if (op === "stageBegin") {
    ndEnsureDir();
    return { ok: true };
  }
  if (op === "stageChunk") return ndStagePut(String(name));
  if (op === "stageDrop") {
    var target = ndDir() + "/staging/" + (parts[2] || "");
    if (/^[A-Za-z0-9_.-]+$/.test(parts[2] || "")) {
      NSData.dataWithStringEncoding("", 4).writeToFileAtomically(target, true);
    }
    return { ok: true };
  }
  if (op === "importTerms") return ndImportTerms(parts[2], parts[3]);
  return { ok: false };
}
