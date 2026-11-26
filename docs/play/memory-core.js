/* memory-core — the engine behind Memory.
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * (c) 2026 Dr Sohil Momin
 *
 * ONE JOB: keep what you would otherwise forget, privately, and find it later. Both specs are that:
 * Ambient Memory captures the day by default; Where S My remembers where you put a thing. One
 * searchable store, encrypted at rest, and the export is the only way anything leaves.
 *
 * The privacy here is ARCHITECTURAL, not a promise:
 *   - the text of every capture is encrypted with AES-256-GCM before it is written, so the word you
 *     search for is not in the stored bytes at all;
 *   - the key comes from a passphrase only you hold (PBKDF2-SHA256), and is never stored;
 *   - there is no network code anywhere, so nothing can leave even if asked.
 *
 * Async, because WebCrypto is. No DOM, no storage of its own.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MemoryCore = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var VERSION = "1.0.0";
  var ITERATIONS = 150000;

  function clean(s) { return String(s == null ? "" : s).replace(/\s+/g, " ").trim(); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }


  /* TextEncoder/TextDecoder are not present in every environment this runs in (jsdom's window has
   * neither), so the engine carries a small UTF-8 codec rather than assuming them. */
  function utf8Encode(str) {
    if (typeof TextEncoder === "function") return new TextEncoder().encode(String(str));
    var out = [], i, c, c2, cp;
    var s = String(str);
    for (i = 0; i < s.length; i++) {
      c = s.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c >= 0xd800 && c <= 0xdbff) {
        c2 = s.charCodeAt(++i);
        cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
        out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      } else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return new Uint8Array(out);
  }
  function utf8Decode(buf) {
    if (typeof TextDecoder === "function") return new TextDecoder().decode(buf);
    var b = new Uint8Array(buf), s = "", i = 0, c, cp;
    while (i < b.length) {
      c = b[i++];
      if (c < 0x80) s += String.fromCharCode(c);
      else if (c < 0xe0) s += String.fromCharCode(((c & 31) << 6) | (b[i++] & 63));
      else if (c < 0xf0) s += String.fromCharCode(((c & 15) << 12) | ((b[i++] & 63) << 6) | (b[i++] & 63));
      else {
        cp = ((c & 7) << 18) | ((b[i++] & 63) << 12) | ((b[i++] & 63) << 6) | (b[i++] & 63);
        cp -= 0x10000;
        s += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 1023));
      }
    }
    return s;
  }

  function subtle() {
    var c = (typeof globalThis !== "undefined" && globalThis.crypto) || null;
    return c && c.subtle ? c.subtle : null;
  }

  function bytesToB64(buf) {
    var bytes = new Uint8Array(buf);
    var s = "";
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    if (typeof btoa === "function") return btoa(s);
    return Buffer.from(bytes).toString("base64");
  }
  function b64ToBytes(b64) {
    var bin;
    if (typeof atob === "function") {
      bin = atob(b64);
      var out = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    return new Uint8Array(Buffer.from(b64, "base64"));
  }
  function randomBytes(n) {
    var a = new Uint8Array(n);
    var c = globalThis.crypto;
    c.getRandomValues(a);
    return a;
  }

  /* ---------------------------------------------------------------- crypto */

  async function deriveKey(passphrase, saltB64) {
    var st = subtle();
    if (!st) return { ok: false, reason: "this browser has no WebCrypto, so nothing can be encrypted and nothing will be stored" };
    var pass = String(passphrase || "");
    if (pass.length < 8) return { ok: false, field: "passphrase", reason: "the passphrase needs at least 8 characters: it is the only thing protecting the store" };
    var salt = saltB64 ? b64ToBytes(saltB64) : randomBytes(16);
    var base = await st.importKey("raw", utf8Encode(pass), "PBKDF2", false, ["deriveKey"]);
    var key = await st.deriveKey(
      { name: "PBKDF2", salt: salt, iterations: ITERATIONS, hash: "SHA-256" },
      base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
    );
    return { ok: true, key: key, salt: bytesToB64(salt) };
  }

  async function encrypt(key, text) {
    var st = subtle();
    var iv = randomBytes(12);
    var ct = await st.encrypt({ name: "AES-GCM", iv: iv }, key, utf8Encode(String(text)));
    return { iv: bytesToB64(iv), ct: bytesToB64(ct) };
  }

  async function decrypt(key, blob) {
    var st = subtle();
    try {
      var pt = await st.decrypt({ name: "AES-GCM", iv: b64ToBytes(blob.iv) }, key, b64ToBytes(blob.ct));
      return { ok: true, text: utf8Decode(pt) };
    } catch (e) {
      return { ok: false, reason: "this entry cannot be decrypted with that passphrase" };
    }
  }

  /* ---------------------------------------------------------------- capture */

  function emptyStore() { return { version: VERSION, salt: "", entries: [] }; }

  /* A capture with no words is KEPT and marked, so a gap in the day is visible rather than an empty
   * note that looks like silence. */
  async function capture(store, key, input, now) {
    var text = clean(input && input.text);
    var seconds = Number(input && input.seconds) || 0;
    var hasAudio = !!(input && input.hasAudio);
    if (!text && !hasAudio) {
      return { ok: false, field: "text", reason: "nothing to keep: no words and no clip" };
    }
    /* the place is something the person typed, so it is encrypted with the words, not stored
     * beside them in the clear */
    var enc = await encrypt(key, JSON.stringify({ text: text, place: clean(input && input.place) || "" }));
    var s = {
      version: VERSION,
      salt: (store && store.salt) || "",
      entries: ((store && store.entries) || []).slice()
    };
    var entry = {
      id: "e" + (s.entries.length + 1),
      at: (now || Date.now()),
      atLabel: label(now || Date.now()),
      kind: clean(input && input.kind) || "capture",
      iv: enc.iv, ct: enc.ct,
      noWords: !text,
      seconds: seconds,
      /* no plaintext here: the place lives inside the ciphertext */
      place: ""
    };
    s.entries.push(entry);
    return {
      ok: true, store: s, entry: entry,
      says: text
        ? "Kept, encrypted. " + (input && input.place ? "Place: " + clean(input.place) + ". " : "")
        : "Kept as a clip with no words \u2014 marked \u201cno words heard\u201d, so the gap is visible rather than looking like silence."
    };
  }

  function label(ms) {
    var d = new Date(ms);
    return pad(d.getDate()) + "/" + pad(d.getMonth() + 1) + "/" + d.getFullYear() + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  /* ---------------------------------------------------------------- search */

  function tokens(text) {
    return clean(text).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").split(" ").filter(Boolean);
  }

  /* Search decrypts in memory and ranks: more matching terms first, then the rarer a word is across
   * the store, the more it counts — so a word spoken in only one capture returns that one first. */
  async function search(store, key, query) {
    var q = tokens(query);
    if (!q.length) return { ok: false, reason: "a search with no words in it was refused", hits: [] };
    var decrypted = [];
    for (var i = 0; i < ((store && store.entries) || []).length; i++) {
      var e = store.entries[i];
      var d = await decrypt(key, e);
      var payload = { text: "", place: "" };
      if (d.ok) {
        try { payload = JSON.parse(d.text); } catch (err) { payload = { text: d.text, place: "" }; }
      }
      decrypted.push({ entry: e, text: payload.text || "", place: payload.place || "", failed: !d.ok });
    }
    var df = {};
    decrypted.forEach(function (row) {
      var set = {};
      tokens(row.text).forEach(function (t) { set[t] = true; });
      Object.keys(set).forEach(function (t) { df[t] = (df[t] || 0) + 1; });
    });
    var hits = [];
    decrypted.forEach(function (row) {
      var toks = tokens(row.text);
      var score = 0, matched = 0;
      q.forEach(function (term) {
        var n = toks.filter(function (t) { return t === term || t.indexOf(term) === 0; }).length;
        if (n) {
          matched++;
          score += n * (1 + 1 / Math.max(1, df[term] || 1));
        }
      });
      if (matched) hits.push({ id: row.entry.id, at: row.entry.at, atLabel: row.entry.atLabel, text: row.text, place: row.place, score: Math.round(score * 100) / 100, matched: matched });
    });
    hits.sort(function (a, b) { return b.score - a.score || b.at - a.at; });
    return {
      ok: true, hits: hits, count: hits.length,
      says: hits.length
        ? hits.length + " of " + decrypted.length + " capture(s) match \u201c" + clean(query) + "\u201d, decrypted in memory just now."
        : "Nothing in " + decrypted.length + " capture(s) matches \u201c" + clean(query) + "\u201d."
    };
  }

  /* --------------------------------------------------------------- storage */

  /* What gets written: ciphertext only. The test searches these bytes for a spoken word and must
   * find nothing. */
  function serialize(store) {
    return JSON.stringify({
      version: VERSION,
      salt: (store && store.salt) || "",
      entries: ((store && store.entries) || []).map(function (e) {
        return { id: e.id, at: e.at, atLabel: e.atLabel, kind: e.kind, iv: e.iv, ct: e.ct, noWords: !!e.noWords, seconds: e.seconds, place: e.place };
      })
    }, null, 2);
  }

  /* An unreadable store is reported and offered for export. It is NEVER replaced by a fresh one: a
   * broken key would look like a new install, and a new install looks like a quiet day. */
  function parseState(text) {
    var raw = String(text == null ? "" : text);
    if (!raw.trim()) return { ok: false, empty: true, reason: "there is nothing captured on this device yet", raw: raw };
    var data;
    try { data = JSON.parse(raw); }
    catch (e) {
      return { ok: false, unreadable: true, reason: "The saved store cannot be read. It was NOT replaced with a fresh one: a broken store would look like a quiet day. Export it to keep it.", raw: raw };
    }
    if (!data || !Array.isArray(data.entries)) {
      return { ok: false, unreadable: true, reason: "The saved file holds no store. Nothing was started over it; export it to keep it.", raw: raw };
    }
    return { ok: true, store: { version: data.version || VERSION, salt: String(data.salt || ""), entries: data.entries.map(function (e) {
      return { id: String(e.id), at: Number(e.at) || 0, atLabel: String(e.atLabel || ""), kind: String(e.kind || "capture"), iv: String(e.iv), ct: String(e.ct), noWords: !!e.noWords, seconds: Number(e.seconds) || 0, place: String(e.place || "") };
    }) }, raw: raw };
  }

  function stamp(when) {
    var m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(when || ""));
    return m ? m[3] + "-" + m[2] + "-" + m[1] : "undated";
  }

  /* The export is the only way anything leaves, and it leaves as ciphertext. */
  function exportFile(what, payload, meta, writer) {
    meta = meta || {};
    if (typeof writer !== "function") return { ok: false, reason: "the file was not written: no writer is available in this browser" };
    var name, body, mime = "application/json";
    if (what === "store") { name = "memory-" + stamp(meta.when) + ".json"; body = serialize(payload.store); }
    else if (what === "raw") { name = "memory-unreadable-" + stamp(meta.when) + ".txt"; body = String(payload.raw || ""); mime = "text/plain;charset=utf-8"; }
    else return { ok: false, reason: "nothing was written: unknown export \u201c" + what + "\u201d" };
    try {
      var wrote = writer(name, body, mime);
      if (wrote === false) return { ok: false, filename: name, reason: "the file was not written: the browser refused the save" };
      return { ok: true, filename: name, bytes: body.length };
    } catch (e) {
      var why = e && e.name === "QuotaExceededError" ? "storage is full" : (e && e.message ? e.message : "storage is unavailable");
      return { ok: false, filename: name, reason: "the file was not written: " + why };
    }
  }

  return {
    version: VERSION,
    ITERATIONS: ITERATIONS,
    deriveKey: deriveKey,
    encrypt: encrypt,
    decrypt: decrypt,
    emptyStore: emptyStore,
    capture: capture,
    search: search,
    tokens: tokens,
    serialize: serialize,
    parseState: parseState,
    exportFile: exportFile,
    label: label
  };
});
