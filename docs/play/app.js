/* app — the Memory page. SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * (c) 2026 Dr Sohil Momin
 *
 * Wiring only: the encryption, the search and the storage live in memory-core.js.
 */
(function () {
  "use strict";

  var M = window.MemoryCore;
  var $ = function (id) { return document.getElementById(id); };

  var K = "memory:store";
  var state = { store: M.emptyStore(), key: null, unreadable: null };

  var els = {
    status: $("status"), pass: $("pass"), unlockBtn: $("unlockBtn"), lockNote: $("lockNote"), lockCard: $("lockCard"),
    captureCard: $("captureCard"), capText: $("capText"), capPlace: $("capPlace"), capKind: $("capKind"),
    capBtn: $("capBtn"), clipBtn: $("clipBtn"), capNote: $("capNote"),
    searchCard: $("searchCard"), q: $("q"), searchBtn: $("searchBtn"), searchSays: $("searchSays"), hitList: $("hitList"),
    ioBar: $("ioBar"), exportBtn: $("exportBtn"), ioNote: $("ioNote")
  };

  function today() {
    var d = new Date();
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return p(d.getDate()) + "/" + p(d.getMonth() + 1) + "/" + d.getFullYear();
  }
  function setStatus(kind, msg) { els.status.className = "status show " + kind; els.status.textContent = msg; }
  function node(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }

  function persist() {
    try {
      window.localStorage.setItem(K, M.serialize(state.store));
      return true;
    } catch (e) {
      /* Capture STOPS and says so, loudly: an always-listening app that fails quietly would record
         nothing for days. */
      setStatus("bad", "CAPTURE STOPPED \u2014 " + (e && e.name === "QuotaExceededError" ? "storage is full" : "storage is unavailable") +
        ". This capture was NOT saved. The oldest unsaved hour is lost; nothing else was overwritten.");
      return false;
    }
  }

  function showWork() {
    els.captureCard.hidden = false;
    els.searchCard.hidden = false;
    els.ioBar.hidden = false;
    els.lockCard.hidden = true;
  }

  async function unlock() {
    var made = await M.deriveKey(els.pass.value, state.store.salt || null);
    if (!made.ok) { setStatus("bad", made.reason); return; }
    state.key = made.key;
    if (!state.store.salt) state.store.salt = made.salt;
    els.pass.value = "";
    showWork();
    els.lockNote.textContent = "";
    var n = state.store.entries.length;
    setStatus("ok", "Unlocked. " + (n ? n + " capture(s) in the store." : "The store is empty.") + " The key is in memory only, and nothing was written.");
    persist();
  }

  async function keep(text, hasAudio, seconds) {
    if (!state.key) { setStatus("bad", "Unlock first."); return; }
    var out = await M.capture(state.store, state.key, {
      text: text, hasAudio: hasAudio, seconds: seconds,
      place: els.capPlace.value, kind: els.capKind.value
    }, Date.now());
    if (!out.ok) { setStatus("bad", out.reason); return; }
    state.store = out.store;
    var saved = persist();
    if (!saved) return;
    els.capText.value = "";
    els.capPlace.value = "";
    els.capNote.textContent = out.says;
    setStatus("ok", out.says);
  }

  async function runSearch() {
    if (!state.key) { setStatus("bad", "Unlock first."); return; }
    var out = await M.search(state.store, state.key, els.q.value);
    if (!out.ok) { setStatus("bad", out.reason); return; }
    els.searchSays.textContent = out.says;
    els.hitList.textContent = "";
    out.hits.forEach(function (h) {
      var li = node("li", null, h.text);
      li.appendChild(node("span", "when", h.atLabel + " \u00b7 score " + h.score));
      els.hitList.appendChild(li);
    });
    setStatus(out.count ? "ok" : "warn", out.says);
  }

  function doExport() {
    var out = M.exportFile("store", { store: state.store }, { when: today() }, function (name, text, mime) {
      if (!window.Export || typeof window.Export.save !== "function") throw new Error("the export kit did not load");
      window.Export.save(name, text, mime);
      return true;
    });
    if (out.ok) { els.ioNote.textContent = "Wrote " + out.filename + " \u2014 ciphertext only. Keep the passphrase with it, or it is unreadable."; setStatus("ok", "Exported, encrypted."); }
    else setStatus("bad", out.reason + ".");
  }

  /* ----------------------------------------------------------------- wire */

  els.unlockBtn.addEventListener("click", unlock);
  els.capBtn.addEventListener("click", function () { keep(els.capText.value, false, 0); });
  els.clipBtn.addEventListener("click", function () { keep("", true, 3); });
  els.searchBtn.addEventListener("click", runSearch);
  els.q.addEventListener("keydown", function (e) { if (e.key === "Enter") runSearch(); });
  els.exportBtn.addEventListener("click", doExport);

  /* ------------------------------------------------------------ start up */

  var raw = null;
  try { raw = window.localStorage.getItem(K); } catch (e) { raw = null; }
  if (raw) {
    var parsed = M.parseState(raw);
    if (parsed.ok) {
      state.store = parsed.store;
      els.lockNote.textContent = state.store.entries.length + " capture(s) waiting behind the passphrase.";
    } else {
      /* Reported, offered for export, and NEVER replaced with a fresh store: a broken store would
         look like a quiet day. */
      state.unreadable = parsed;
      setStatus("bad", parsed.reason);
      var keepBtn = node("button", "small", "Export the unreadable store");
      keepBtn.addEventListener("click", function () {
        var out = M.exportFile("raw", parsed, { when: today() }, function (name, text, mime) {
          if (!window.Export || typeof window.Export.save !== "function") throw new Error("the export kit did not load");
          window.Export.save(name, text, mime);
          return true;
        });
        setStatus(out.ok ? "ok" : "bad", out.ok ? "Wrote " + out.filename + "." : out.reason);
      });
      els.lockNote.parentNode.insertBefore(keepBtn, els.lockNote);
    }
  }

  if (window.Loom && window.Loom.pwa) window.Loom.pwa.register("sw.js");
})();
