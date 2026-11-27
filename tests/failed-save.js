#!/usr/bin/env node
/* failed-save — the app-specific version, because this app's save cannot be reached synchronously.
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0 · (c) 2026 Dr Sohil Momin
 *
 * The general harness in the rest of this fleet clicks every button that writes. It cannot work here: the
 * store is unlocked with a passphrase through async WebCrypto, so a capture only saves after the key
 * derivation resolves - after a synchronous click returns.
 *
 * So this test does the async work explicitly and then checks the one thing that matters: with storage
 * throwing, a capture must say NOT SAVED rather than "kept".
 */
"use strict";
var fs = require("fs"), path = require("path"), { JSDOM } = require("jsdom");
var webcrypto = require("crypto").webcrypto;
var ROOT = path.join(__dirname, ".."), PLAY = path.join(ROOT, "docs", "play");
var passed = 0, failed = [];
function ok(n, c, d) { if (c) { passed++; return; } failed.push(n + (d ? " — " + d : "")); }
function tick(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

async function run(throwing) {
  var dom = new JSDOM(fs.readFileSync(path.join(PLAY, "index.html"), "utf8"), {
    url: "https://example.test/play/index.html", runScripts: "outside-only", pretendToBeVisual: true
  });
  var w = dom.window, wrote = [];
  Object.defineProperty(w, "crypto", { value: webcrypto, configurable: true });
  try { delete w.TextEncoder; } catch (e) {}
  try { delete w.TextDecoder; } catch (e) {}
  w.URL.createObjectURL = function () { return "blob:x"; }; w.URL.revokeObjectURL = function () {};
  w.HTMLAnchorElement.prototype.click = function () {};
  Object.defineProperty(w, "localStorage", { configurable: true, get: function () {
    return {
      getItem: function () { return null; },
      setItem: function (k) { if (throwing) { var e = new Error("full"); e.name = "QuotaExceededError"; throw e; } wrote.push(k); },
      removeItem: function () {}, clear: function () {}
    };
  } });
  ["web-kit.js", "export-kit.js", "memory-core.js", "app.js"].forEach(function (f) {
    var p = path.join(PLAY, f); if (fs.existsSync(p)) w.eval(fs.readFileSync(p, "utf8"));
  });
  var d = w.document;
  d.getElementById("pass").value = "correct horse battery";
  d.getElementById("unlockBtn").click();
  await tick(900);   /* PBKDF2 takes a few hundred milliseconds */
  d.getElementById("capText").value = "the passport is in the blue almirah";
  d.getElementById("capBtn").click();
  await tick(400);
  return { status: d.getElementById("status").textContent || "", wrote: wrote.length };
}

(async function () {
  var healthy = await run(false);
  ok("an unlocked capture writes to storage", healthy.wrote > 0, healthy.wrote + " write(s)");
  ok("and says it was kept", !/not saved/i.test(healthy.status), healthy.status);

  var broken = await run(true);
  ok("a capture with storage throwing says the capture was not saved", /not saved/i.test(broken.status), broken.status || "(no status)");
  ok("and does not claim it was kept", !/\bKept\b/i.test(broken.status), broken.status);

  var total = passed + failed.length;
  if (failed.length) {
    console.error("failed-save: " + passed + "/" + total + " passed, " + failed.length + " FAILED");
    failed.forEach(function (f) { console.error("  FAIL " + f); });
    process.exit(1);
  }
  console.log("failed-save: " + passed + "/" + total + " assertions passed (async unlock + capture)");
})();
