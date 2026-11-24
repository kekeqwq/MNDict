var MNDICT_AUTO_KEY = "io.github.kekeqwq.mndict.lookupSelection";
var MNDICT_AUTO_PLAY_KEY = "io.github.kekeqwq.mndict.lookupAutoPlay";

// mn.call 的 payload 跨 JSB 后不可靠，命令参数一律编码进 name，返回值走 JSON。
function mndictBool(value) {
  switch (typeof value) {
    case "boolean":
      return value;
    case "number":
      return value === 1;
    case "string":
      return value === "on" || value === "true" || value === "1";
    case "object": {
      if (!value) return false;
      if ("value" in value) return mndictBool(value.value);
      if ("0" in value) return mndictBool(value[0]);
      for (var key in value) return mndictBool(value[key]);
      return false;
    }
    default:
      return false;
  }
}

function mndictAutoLookup() {
  var prefs = NSUserDefaults.standardUserDefaults();
  return prefs.boolForKey(MNDICT_AUTO_KEY) || mndictBool(prefs.objectForKey(MNDICT_AUTO_KEY));
}

function mndictAutoPlay() {
  var prefs = NSUserDefaults.standardUserDefaults();
  return prefs.boolForKey(MNDICT_AUTO_PLAY_KEY) || mndictBool(prefs.objectForKey(MNDICT_AUTO_PLAY_KEY));
}

function mndictArchiveDir() {
  return Application.sharedInstance().documentPath + "/mndict-dictionaries";
}

function mndictArchivePath(id) {
  return mndictArchiveDir() + "/" + id + ".zip";
}

function mndictValidId(id) {
  return typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id);
}

function mndictEnsureDir() {
  NSFileManager.defaultManager().createDirectoryAtPathWithIntermediateDirectoriesAttributes(
    mndictArchiveDir(), true, null);
}

function mndictTrash(id, path) {
  var fm = NSFileManager.defaultManager();
  var trash = mndictArchiveDir() + "/.trash";
  fm.createDirectoryAtPathWithIntermediateDirectoriesAttributes(trash, true, null);
  fm.moveItemAtPathToPath(path, trash + "/" + id + "." + Date.now() + ".zip");
}

function mndictB64Decode(text) {
  var table = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var out = [];
  var buffer = 0;
  var bits = 0;
  for (var i = 0; i < text.length; i++) {
    var value = table.indexOf(text.charAt(i));
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

function mndictArchiveList() {
  var fm = NSFileManager.defaultManager();
  mndictEnsureDir();
  var files = fm.contentsOfDirectoryAtPath(mndictArchiveDir()) || [];
  var archives = [];
  for (var i = 0; i < files.length; i++) {
    var file = String(files[i]);
    if (!/\.zip$/.test(file)) continue;
    var handle = NSFileHandle.fileHandleForReadingAtPath(mndictArchiveDir() + "/" + file);
    var size = handle ? handle.seekToEndOfFile() : 0;
    if (handle) handle.closeFile();
    archives.push({ id: file.substring(0, file.length - 4), size: size });
  }
  return { ok: true, archives: archives };
}

function mndictArchivePut(name, id, expected) {
  var marker = "archivePutChunk:" + id + ":" + expected + ":";
  var binary = mndictB64Decode(name.substring(marker.length));
  if (binary.length !== expected) {
    return { ok: false, wrote: 0, decoded: binary.length, detail: "传输丢字节" };
  }
  var data = NSData.dataWithStringEncoding(binary, 5); // NSISOLatin1StringEncoding
  if (!data) return { ok: false, wrote: 0, detail: "NSData 转换失败" };
  var path = mndictArchivePath(id);
  var fm = NSFileManager.defaultManager();
  if (!fm.fileExistsAtPath(path)) {
    if (!data.writeToFileAtomically(path, true)) return { ok: false, wrote: 0, detail: "创建文件失败" };
    var fresh = NSFileHandle.fileHandleForReadingAtPath(path);
    var freshSize = fresh ? fresh.seekToEndOfFile() : -1;
    if (fresh) fresh.closeFile();
    return freshSize === expected ? { ok: true, wrote: freshSize } :
      { ok: false, wrote: freshSize, detail: "落盘字节数不符" };
  }
  var writer = NSFileHandle.fileHandleForWritingAtPath(path);
  if (!writer) return { ok: false, wrote: 0, detail: "打开文件失败" };
  var before = writer.seekToEndOfFile();
  writer.writeData(data);
  writer.closeFile();
  var check = NSFileHandle.fileHandleForReadingAtPath(path);
  var after = check ? check.seekToEndOfFile() : before;
  if (check) check.closeFile();
  var grew = after - before;
  return grew === expected ? { ok: true, wrote: grew } :
    { ok: false, wrote: grew, detail: "落盘字节数不符" };
}

function mndictArchiveRead(id, offset, length) {
  var reader = NSFileHandle.fileHandleForReadingAtPath(mndictArchivePath(id));
  if (!reader) return { ok: false };
  reader.seekToFileOffset(offset);
  var chunk = reader.readDataOfLength(length);
  reader.closeFile();
  return { ok: true, data: chunk ? chunk.base64Encoding() : "" };
}

function mndictSpeak(name) {
  var rest = name.substring("speak:".length);
  var cut = rest.indexOf(":");
  var lang = cut >= 0 ? rest.substring(0, cut) : "en-US";
  var text = cut >= 0 ? rest.substring(cut + 1) : rest;
  if (!text || text.length > 200) return { ok: false };
  var manager = SpeechManager.sharedInstance();
  if (!manager) return { ok: false };
  manager.stopSpeech();
  manager.languageCode = lang;
  manager.playText(text);
  return { ok: true };
}

function mndictPanelMessage(name, payload, openState) {
  if (name === "getOpenState") return openState;
  var parts = String(name).split(":");
  var command = parts[0];
  if (command === "speak") return mndictSpeak(String(name));
  if (command === "getSettings") {
    return { ok: true, autoLookup: mndictAutoLookup(), autoPlay: mndictAutoPlay() };
  }
  if (command === "enableAutoLookup" || command === "disableAutoLookup") {
    var value = command === "enableAutoLookup";
    var prefs = NSUserDefaults.standardUserDefaults();
    prefs.setBoolForKey(value, MNDICT_AUTO_KEY);
    prefs.setObjectForKey(value, MNDICT_AUTO_KEY);
    return { ok: true, autoLookup: mndictAutoLookup() };
  }
  if (command === "enableAutoPlay" || command === "disableAutoPlay") {
    var play = command === "enableAutoPlay";
    var playPrefs = NSUserDefaults.standardUserDefaults();
    playPrefs.setBoolForKey(play, MNDICT_AUTO_PLAY_KEY);
    playPrefs.setObjectForKey(play, MNDICT_AUTO_PLAY_KEY);
    return { ok: true, autoPlay: mndictAutoPlay() };
  }
  if (command === "archiveList") return mndictArchiveList();
  if (command === "archivePutBegin") {
    if (!mndictValidId(parts[1])) return { ok: false };
    mndictEnsureDir();
    var existing = mndictArchivePath(parts[1]);
    if (NSFileManager.defaultManager().fileExistsAtPath(existing)) mndictTrash(parts[1], existing);
    return { ok: true };
  }
  if (command === "archivePutChunk") {
    var expected = parseInt(parts[2], 10) || 0;
    if (!mndictValidId(parts[1]) || expected <= 0 || expected > 1024 * 1024) return { ok: false, wrote: 0, detail: "参数错误" };
    mndictEnsureDir();
    return mndictArchivePut(String(name), parts[1], expected);
  }
  if (command === "archiveRead") {
    var offset = parseInt(parts[2], 10) || 0;
    var length = parseInt(parts[3], 10) || 0;
    if (!mndictValidId(parts[1]) || length <= 0 || length > 1024 * 1024) return { ok: false };
    return mndictArchiveRead(parts[1], offset, length);
  }
  if (command === "archiveDrop") {
    if (!mndictValidId(parts[1])) return { ok: false };
    var target = mndictArchivePath(parts[1]);
    if (NSFileManager.defaultManager().fileExistsAtPath(target)) mndictTrash(parts[1], target);
    return { ok: true };
  }
  return { ok: false };
}
