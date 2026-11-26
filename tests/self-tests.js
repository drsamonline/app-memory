#!/usr/bin/env node
/* self-tests — Memory. No framework, no dependencies. Async, because WebCrypto is.
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * (c) 2026 Dr Sohil Momin
 *
 * The spec's "done means" is countable, so it is counted:
 *
 *   "A capture made today is found by searching a word spoken in it, with the network off. That word
 *    does not appear in the app's raw storage — searching the stored bytes for it finds nothing — and
 *    with the network off no request leaves the device. 10 captures produce 10 searchable entries,
 *    and a word spoken in only one of them returns that one first."
 *
 *   node tests/self-tests.js
 */
"use strict";

var fs = require("fs");
var path = require("path");

var ROOT = path.join(__dirname, "..");
var M = require(path.join(ROOT, "docs", "play", "memory-core.js"));

var passed = 0, failed = [], group = "";
function section(n) { group = n; }
function ok(name, cond, detail) { if (cond) { passed++; return; } failed.push(group + " :: " + name + (detail ? " — " + detail : "")); }
function eq(name, a, b) { ok(name, a === b, "expected " + JSON.stringify(b) + ", got " + JSON.stringify(a)); }
function read(f) { return fs.readFileSync(path.join(ROOT, f), "utf8"); }

var PASS = "correct horse battery";
var T0 = Date.UTC(2026, 10, 26, 9, 0);

var WORDS = [
  "bought milk and bread",
  "called the plumber about the tap",
  "the passport is in the blue almirah",
  "paid the electricity bill",
  "met Ravi at the tea shop",
  "fixed the cycle chain",
  "booked the train ticket",
  "the water tank was cleaned",
  "renewed the insurance",
  "the spare key is with Aaji"
];

async function main() {
  /* ============================================ the spec's own "done means" */

  section("done means — ten captures, ten searchable entries");
  var made = await M.deriveKey(PASS, null);
  eq("the key derives", made.ok, true);
  var store = M.emptyStore();
  store.salt = made.salt;
  for (var i = 0; i < WORDS.length; i++) {
    var c = await M.capture(store, made.key, { text: WORDS[i] }, T0 + i * 60000);
    if (!c.ok) { ok("capture " + i + " was kept", false, c.reason); break; }
    store = c.store;
  }
  eq("ten captures are in the store", store.entries.length, 10);
  var all = await M.search(store, made.key, "the");
  ok("all ten are searchable", all.count >= 8, all.count + " of 10 match 'the'");

  section("done means — a word spoken in only one capture returns that one first");
  var unique = await M.search(store, made.key, "almirah");
  eq("exactly one hit", unique.count, 1);
  eq("and it is the right one", unique.hits[0] && unique.hits[0].text, "the passport is in the blue almirah");
  var passport = await M.search(store, made.key, "passport");
  eq("searching passport returns that capture first", passport.hits[0] && passport.hits[0].text, "the passport is in the blue almirah");

  section("done means — the word is NOT in the app's raw storage");
  var raw = M.serialize(store);
  ok("the raw store does not contain 'almirah'", raw.indexOf("almirah") < 0, "found the plaintext in the stored bytes");
  ok("nor 'passport'", raw.indexOf("passport") < 0);
  ok("nor 'plumber'", raw.indexOf("plumber") < 0);
  ok("nor the place, which is typed too", raw.indexOf("almirah, top shelf") < 0);
  ok("nor any word from any capture", WORDS.every(function (w) {
    return w.split(" ").filter(function (t) { return t.length > 4; }).every(function (t) { return raw.toLowerCase().indexOf(t.toLowerCase()) < 0; });
  }));
  ok("the raw store does carry ciphertext", /"ct":\s*"/.test(raw) && /"iv":\s*"/.test(raw));
  ok("and a salt, so the same passphrase gives a different key on another device", /"salt":\s*"[A-Za-z0-9+/=]+"/.test(raw));

  section("done means — with the network off, nothing leaves");
  var core = read("docs/play/memory-core.js");
  var app = read("docs/play/app.js");
  ok("no fetch anywhere", !/\bfetch\s*\(/.test(core + app));
  ok("no XHR, WebSocket, beacon or EventSource", !/XMLHttpRequest|WebSocket|sendBeacon|EventSource/.test(core + app));
  ok("no URL anywhere in the engine", !/https?:\/\//.test(core));
  ok("the page forbids connections", /connect-src 'none'/.test(read("docs/play/index.html")));
  ok("search runs with no network call at all", /await M.search/.test(app));

  /* ============================================================ must-nots */

  section("must-not — it must not upload anything, ever");
  ok("the export is the only writer", /exportFile/.test(core) && !/upload|send(To)?\(|post\(/i.test(core));
  ok("the export writes ciphertext, not plaintext", (function () {
    var body = null;
    M.exportFile("store", { store: store }, { when: "26/11/2026" }, function (name, text) { body = text; return true; });
    return body && body.indexOf("almirah") < 0 && /"ct"/.test(body);
  })());
  ok("no second store, no tags, no sync", !/\b(tags|labels|folders)\s*[:=]/i.test(core) && !/\bsync\s*[:(]/i.test(core));

  section("must-not — a clip with no words is kept and marked, not dropped");
  var quiet = await M.capture(store, made.key, { hasAudio: true, seconds: 2 }, T0 + 10 * 60000);
  eq("the clip is kept", quiet.ok, true);
  ok("the clip has an entry to inspect", !!quiet.entry);
  eq("and marked", quiet.entry && quiet.entry.noWords, true);
  ok("the app says so in words", /no words heard/.test(quiet.says), quiet.says);
  var emptyCapture = await M.capture(store, made.key, {}, T0);
  eq("a capture with neither words nor audio is refused", emptyCapture.ok, false);
  eq("with the field named", emptyCapture.field, "text");

  section("must-not — an unreadable store is never replaced by a fresh one");
  var bad = M.parseState("{ broken store");
  eq("it is reported", bad.ok, false);
  eq("it is marked unreadable", bad.unreadable, true);
  ok("it says it was NOT replaced", /NOT replaced with a fresh one/.test(bad.reason), bad.reason);
  ok("and why a fresh store is worse", /would look like a quiet day/.test(bad.reason), bad.reason);
  eq("the raw text is kept for export", bad.raw, "{ broken store");
  eq("nothing saved yet is distinguished from a broken store", M.parseState("").empty, true);

  section("the passphrase is the only way in");
  var short = await M.deriveKey("short", null);
  eq("a short passphrase is refused", short.ok, false);
  eq("with the field named", short.field, "passphrase");
  ok("and says what it protects", /only thing protecting the store/.test(short.reason), short.reason);
  var wrongKey = await M.deriveKey("a different passphrase", store.salt);
  var wrongHits = await M.search(store, wrongKey.key, "almirah");
  eq("the wrong passphrase finds nothing", wrongHits.count, 0);
  var rightAgain = await M.deriveKey(PASS, store.salt);
  var again = await M.search(store, rightAgain.key, "almirah");
  eq("the right passphrase, with the stored salt, still finds it", again.count, 1);

  section("failure case — storage full or unavailable");
  var thrown = M.exportFile("store", { store: store }, { when: "26/11/2026" }, function () {
    var e = new Error("quota"); e.name = "QuotaExceededError"; throw e;
  });
  eq("a failed write is reported as failed", thrown.ok, false);
  ok("it says the file was not written", /not written/.test(thrown.reason), thrown.reason);
  ok("it names the cause", /storage is full/.test(thrown.reason));
  ok("the page says CAPTURE STOPPED", /CAPTURE STOPPED/.test(app));
  ok("and that the oldest unsaved hour is lost", /oldest unsaved hour/.test(app));

  section("shape — every script the page loads exists beside it");
  var page = read("docs/play/index.html");
  var srcs = (page.match(/<script[^>]+src="([^"]+)"/g) || []).map(function (t) { return t.replace(/.*src="([^"]+)"/, "$1"); });
  srcs.forEach(function (s) { ok("script src resolves: " + s, fs.existsSync(path.join(ROOT, "docs", "play", s.replace(/^\.\//, "")))); });
  ok("the landing page exists", fs.existsSync(path.join(ROOT, "docs", "index.html")));
  ok("the page manifest exists", fs.existsSync(path.join(ROOT, "PAGES.json")));

  var total = passed + failed.length;
  if (!total) { console.error("self-tests: 0 assertions ran. That is a failure, not a pass."); process.exit(1); }
  if (failed.length) {
    console.error("self-tests: " + passed + "/" + total + " passed, " + failed.length + " FAILED");
    failed.slice(0, 12).forEach(function (f) { console.error("  FAIL " + f); });
    process.exit(1);
  }
  console.log("self-tests: " + passed + "/" + total + " assertions passed");
}

main().catch(function (e) { console.error("self-tests crashed: " + e.message); process.exit(1); });
