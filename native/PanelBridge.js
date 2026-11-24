var MNDICT_AUTO_KEY = "io.github.kekeqwq.mndict.lookupSelection";

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

function mndictArchivePut(name, id) {
  var marker = "archivePutChunk:" + id + ":";
  var binary = mndictB64Decode(name.substring(marker.length));
  var data = NSData.dataWithStringEncoding(binary, 5); // NSISOLatin1StringEncoding
  if (!data) return { ok: false };
  var path = mndictArchivePath(id);
  var fm = NSFileManager.defaultManager();
  if (!fm.fileExistsAtPath(path)) {
    return { ok: Boolean(data.writeToFileAtomically(path, true)) };
  }
  var writer = NSFileHandle.fileHandleForWritingAtPath(path);
  if (!writer) return { ok: false };
  writer.seekToEndOfFile();
  writer.writeData(data);
  writer.closeFile();
  return { ok: true };
}

function mndictArchiveRead(id, offset, length) {
  var reader = NSFileHandle.fileHandleForReadingAtPath(mndictArchivePath(id));
  if (!reader) return { ok: false };
  reader.seekToFileOffset(offset);
  var chunk = reader.readDataOfLength(length);
  reader.closeFile();
  return { ok: true, data: chunk ? chunk.base64Encoding() : "" };
}

function mndictPanelMessage(name, payload, openState) {
  if (name === "getOpenState") return openState;
  var parts = String(name).split(":");
  var command = parts[0];
  if (command === "getSettings") {
    return { ok: true, autoLookup: mndictAutoLookup() };
  }
  if (command === "enableAutoLookup" || command === "disableAutoLookup") {
    var value = command === "enableAutoLookup";
    var prefs = NSUserDefaults.standardUserDefaults();
    prefs.setBoolForKey(value, MNDICT_AUTO_KEY);
    prefs.setObjectForKey(value, MNDICT_AUTO_KEY);
    return { ok: true, autoLookup: mndictAutoLookup() };
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
    if (!mndictValidId(parts[1])) return { ok: false };
    mndictEnsureDir();
    return mndictArchivePut(String(name), parts[1]);
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
