# Memory

Keep the day, privately. **Encrypted at rest with a key only you hold**, and the export is the only way
anything leaves.

- **Demo (the app itself):** https://drsamonline.github.io/app-memory/play/index.html
- **Landing page:** https://drsamonline.github.io/app-memory/
- **Release:** https://github.com/drsamonline/app-memory/releases/tag/app-latest
- **Plan row:** #18 of 37 in `drsamonline/forge` → `QUEUE/PLAN.json`
- **Specs absorbed:** `app-ambient-memory` (lead), `app-where-s-my`
- **Licence:** PolyForm Noncommercial 1.0.0
- **Sponsor:** [github.com/sponsors/drsamonline](https://github.com/sponsors/drsamonline) — free, offline, no account

## Status

| | |
|---|---|
| **Built** | AES-256-GCM over every capture; PBKDF2 key from the passphrase, never stored; in-memory search with no on-disk index; silent clips kept and marked; ciphertext-only export; unreadable store never replaced. |
| **Release** | Windows EXE, Android APK and Linux binary, built from this source by `app-builder` in CI. |
| **Not built** | **Always-listening audio capture and on-device transcription.** There is no speech model anywhere in this estate, so the words are typed or the clip is kept and marked. Said on the page, in the app, and here. |
| **Untested** | The security of the whole thing under a real adversary. WebCrypto is the platform's, the construction is standard (AES-GCM with a per-capture random IV, PBKDF2 at 150k), and the stored bytes are searched in the test — but a security review is not a unit test, and this README will not pretend otherwise. |

## The spec's "done means", counted

> "A capture made today is found by searching a word spoken in it, with the network off. That word does
> not appear in the app's raw storage — searching the stored bytes for it finds nothing — and with the
> network off no request leaves the device. 10 captures produce 10 searchable entries, and a word
> spoken in only one of them returns that one first."

| The spec says | The test |
|---|---|
| found by searching a word in it | `search(store, key, "almirah")` → 1 hit, that capture |
| the word is **not** in the raw storage | the serialised store is searched for `almirah`, `passport`, `plumber` and every word over four letters — none found; the ciphertext and salt are |
| no request leaves | no `fetch`/XHR/WebSocket/beacon in engine or page, no URL in the engine, CSP `connect-src 'none'` |
| 10 captures → 10 searchable | 10 captured, all reachable by a common word |
| a word in only one returns that one first | "almirah" → exactly 1 hit, and it is the passport capture |

## Why the privacy is architectural

- **The key is never stored.** It is derived from the passphrase each time. Losing the passphrase loses the store — the same property that makes it private.
- **The salt is stored; nothing else secret is.** A salt is not a secret.
- **No index on disk.** Search decrypts in memory, at the moment you ask, and throws the plaintext away when the tab closes.
- **No network code at all.** Not "we don't call it" — there is nothing to call it with.

## The bug the UI test caught, and it was the important kind

The **place** a person types ("almirah, top shelf") was being stored **beside** the ciphertext instead of
inside it — so the one field a searcher would use to find something was the one field in the clear. The
engine now encrypts `{text, place}` as one payload, and both suites assert the place is absent from the
stored bytes.

That is exactly the class of mistake this app cannot make, and it was found by a UI test looking at
`localStorage`, not by reading the code.

## What it will not do

- **Upload anything.** Nothing in the app can.
- **Store a typed word in the clear.** Not the words, not the place.
- **Drop a silent clip.** Kept and marked.
- **Start fresh over an unreadable store.** A broken store would look like a quiet day.
- **Keep capturing quietly when storage fails.** It stops and says so.

## When things go wrong

| Case | Behaviour |
|---|---|
| **Bad input** | No words and no clip → refused. Passphrase under 8 characters → refused, with what it protects named. |
| **No network** | Nothing changes; nothing ever leaves. |
| **Storage full or unavailable** | **CAPTURE STOPPED**, loudly, and the oldest unsaved hour reported lost. |
| **Corrupt saved state** | Reported, offered for export, never replaced with a fresh store. |

## Tests

```bash
npm test                      # all three suites
node tests/self-tests.js      # engine — 49 assertions, async, real WebCrypto
node tests/ui-tests.js        # the page in jsdom — 22 assertions (real WebCrypto injected)
node tests/page-smoke.js      # every local src/href resolves, nothing off-origin
```

Mutation-tested six ways on 26/11/2026, each red: plaintext written instead of ciphertext (5 failures),
search ignoring the query (3), a wordless clip dropped (4), a short passphrase accepted (3), a broken
store becoming a fresh one (4), and the salt not being stored (2). Two of them crashed the suite before
I guarded the fixtures — recorded rather than tidied away.

## Layout

```
docs/index.html            landing page
docs/play/index.html       the app — the key, capture, search, export
docs/play/app.js           DOM wiring: unlock, capture, search, export, the capture-stop guard
docs/play/memory-core.js   the engine — WebCrypto, capture, search, storage
docs/play/web-kit.js       vendored kit (unmodified)
docs/play/export-kit.js    vendored kit (unmodified)
tests/self-tests.js        engine suite (49, async)
tests/ui-tests.js          page suite (22, jsdom + Node WebCrypto)
tests/page-smoke.js        shape on disk
PAGES.json                 landing = docs/index.html, app = docs/play/index.html
```

## Where the spec was silent, and what was chosen

- **The passphrase is the key.** A stored key would make the encryption decorative.
- **The salt is stored; the key is not.** That is what a salt is for.
- **Metadata stays readable**: time, kind, clip length, and the "no words heard" flag. Encrypting the timestamp would break the day view, and the spec wants a gap to be visible.
- **Search ranks by term rarity across the store**, so a word spoken once outranks a word spoken in every capture. That is the spec's "returns that one first", done honestly rather than by insertion order.
- **The export is ciphertext.** An export in plaintext would be the one hole in the whole design.

## What is not built, and why

**Always-listening capture and on-device transcription.** There is no speech model in this estate, and a
microphone that records nothing usable is worse than an honest absence. What ships is the part that
can be trusted: the encrypted store, the search, and the export.

**A recovery mechanism.** It would have to be a backdoor. Losing the passphrase loses the store.
