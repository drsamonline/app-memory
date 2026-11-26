#!/usr/bin/env node
/* ui-tests — the Memory page in a real DOM (jsdom), with real WebCrypto from Node.
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * (c) 2026 Dr Sohil Momin
 *
 *   npm install --no-save jsdom && node tests/ui-tests.js
 */
"use strict";

var fs = require("fs");
var path = require("path");
var { JSDOM } = require("jsdom");
var webcrypto = require("crypto").webcrypto;

var ROOT = path.join(__dirname, "..");
var PLAY = path.join(ROOT, "docs", "play");
var PAGE = path.join(PLAY, "index.html");

var passed = 0, failed = [];
function ok(n, c, d) { if (c) { passed++; return; } failed.push(n + (d ? " — " + d : "")); }
function eq(n, a, b) { ok(n, a === b, "expected " + JSON.stringify(b) + ", got " + JSON.stringify(a)); }

function build(seed) {
  var dom = new JSDOM(fs.readFileSync(PAGE, "utf8"), { url: "https://example.test/play/index.html", runScripts: "outside-only", pretendToBeVisual: true });
  var w = dom.window;
  Object.defineProperty(w, "crypto", { value: webcrypto, configurable: true });
  /* CI's jsdom has neither TextEncoder nor TextDecoder; removing them here reproduces that, so the
     engine's own UTF-8 codec is what gets tested rather than Node's global */
  try { delete w.TextEncoder; } catch (e) { w.TextEncoder = undefined; }
  try { delete w.TextDecoder; } catch (e) { w.TextDecoder = undefined; }
  if (seed) Object.keys(seed).forEach(function (k) { w.localStorage.setItem(k, seed[k]); });
  w.URL.createObjectURL = function () { return "blob:x"; };
  w.URL.revokeObjectURL = function () {};
  w.HTMLAnchorElement.prototype.click = function () {};
  ["web-kit.js", "export-kit.js", "memory-core.js", "app.js"].forEach(function (f) {
    w.eval(fs.readFileSync(path.join(PLAY, f), "utf8"));
  });
  return dom;
}

function tick(ms) { return new Promise(function (r) { setTimeout(r, ms || 30); }); }

async function main() {
  var dom = build(null), w = dom.window, d = w.document;
  var $ = function (id) { return d.getElementById(id); };

  ok("the engine loaded", !!w.MemoryCore);
  eq("the work cards are hidden until unlocked", $("captureCard").hidden, true);

  $("pass").value = "short";
  $("unlockBtn").click();
  await tick();
  ok("a short passphrase is refused", /at least 8 characters/.test($("status").textContent), $("status").textContent);

  $("pass").value = "correct horse battery";
  $("unlockBtn").click();
  await tick(700);
  ok("the store unlocks", /Unlocked/.test($("status").textContent), $("status").textContent);
  eq("the work cards appear", $("captureCard").hidden, false);

  $("capText").value = "the passport is in the blue almirah";
  $("capPlace").value = "almirah, top shelf";
  $("capBtn").click();
  await tick(250);
  ok("the capture is kept", /Kept, encrypted/.test($("status").textContent), $("status").textContent);
  ok("the place is mentioned", /almirah, top shelf/.test($("status").textContent));

  var raw = w.localStorage.getItem("memory:store");
  ok("the store was written", !!raw);
  ok("and the words are not in it", raw.indexOf("almirah") < 0 && raw.indexOf("passport") < 0, raw.slice(0, 120));
  ok("nor is the place the person typed", raw.indexOf("top shelf") < 0, raw.slice(0, 200));

  $("q").value = "almirah";
  $("searchBtn").click();
  await tick(250);
  ok("search finds it", /1 of 1 capture\(s\) match/.test($("searchSays").textContent), $("searchSays").textContent);
  ok("the hit shows the words", /blue almirah/.test($("hitList").textContent), $("hitList").textContent);

  $("clipBtn").click();
  await tick(250);
  ok("a clip with no words is kept and marked", /no words heard/.test($("status").textContent), $("status").textContent);

  $("exportBtn").click();
  ok("the export is written", /Wrote memory-\d{4}-\d\d-\d\d\.json/.test($("ioNote").textContent), $("ioNote").textContent);
  ok("and says it is ciphertext only", /ciphertext only/.test($("ioNote").textContent));

  /* reload: the store is still encrypted, and the same passphrase opens it */
  var dom2 = build({ "memory:store": raw });
  var d2 = dom2.window.document;
  ok("the reload reports the captures waiting", /1 capture\(s\) waiting behind the passphrase/.test(d2.getElementById("lockNote").textContent),
    d2.getElementById("lockNote").textContent);
  d2.getElementById("pass").value = "correct horse battery";
  d2.getElementById("unlockBtn").click();
  await tick(700);
  d2.getElementById("q").value = "passport";
  d2.getElementById("searchBtn").click();
  await tick(300);
  ok("and the same passphrase finds it again", /1 of 1 capture/.test(d2.getElementById("searchSays").textContent),
    d2.getElementById("searchSays").textContent);

  /* an unreadable store */
  var dom3 = build({ "memory:store": "{ broken store" });
  var d3 = dom3.window.document;
  ok("an unreadable store is reported", /cannot be read/.test(d3.getElementById("status").textContent), d3.getElementById("status").textContent);
  ok("it was NOT replaced with a fresh one", /NOT replaced with a fresh one/.test(d3.getElementById("status").textContent));
  ok("it offers an export of the unreadable store",
    Array.prototype.some.call(d3.querySelectorAll("button"), function (b) { return /Export the unreadable store/.test(b.textContent); }));

  /* a failed save stops capture and says so */
  var dom4 = build(null), w4 = dom4.window, d4 = dom4.window.document;
  Object.defineProperty(w4, "localStorage", { configurable: true, get: function () {
    return { getItem: function () { return null; }, setItem: function () { var e = new Error("q"); e.name = "QuotaExceededError"; throw e; }, removeItem: function () {}, clear: function () {} };
  } });
  d4.getElementById("pass").value = "correct horse battery";
  d4.getElementById("unlockBtn").click();
  await tick(700);
  d4.getElementById("capText").value = "something";
  d4.getElementById("capBtn").click();
  await tick(250);
  ok("capture stops loudly", /CAPTURE STOPPED/.test(d4.getElementById("status").textContent), d4.getElementById("status").textContent);
  ok("and reports the lost hour", /oldest unsaved hour/.test(d4.getElementById("status").textContent));

  var total = passed + failed.length;
  if (!total) { console.error("ui-tests: 0 assertions ran."); process.exit(1); }
  if (failed.length) { console.error("ui-tests: " + passed + "/" + total + " passed, " + failed.length + " FAILED"); failed.forEach(function (f) { console.error("  FAIL " + f); }); process.exit(1); }
  console.log("ui-tests: " + passed + "/" + total + " assertions passed");
  dom.window.close(); dom2.window.close(); dom3.window.close(); dom4.window.close();
}

main().catch(function (e) { console.error("ui-tests crashed: " + e.message); process.exit(1); });
