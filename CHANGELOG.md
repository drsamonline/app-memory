# Changelog

All notable changes to Memory are recorded here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Dates: dd/mm/yyyy.

## [Unreleased]

## [1.0.0] — 26/11/2026

### Added
- Captures encrypted with **AES-256-GCM** before they are written, with a key derived from the
  passphrase (PBKDF2-SHA256, 150,000 iterations, 128-bit salt). The key is never stored.
- **Search that decrypts in memory** at the moment it is asked, and keeps no index on disk. A word in
  one capture only returns that capture first.
- A clip with **no words heard** is kept and marked, so a gap in the day is visible rather than an
  empty note that looks like silence.
- The **place** a person types is encrypted with the words — it was briefly stored in the clear, and
  the UI test caught it.
- Export is **ciphertext only**; the file is the only way anything leaves the device.
- No network code at all: no `fetch`, no XHR, no WebSocket, no beacon, no URL in the engine, and
  `connect-src 'none'` in the page.
- Refusals: a capture with neither words nor a clip, and a passphrase under eight characters.
- An unreadable store is reported and offered for export, and **never replaced with a fresh one** — a
  broken store would look like a quiet day.
- A failed save says **CAPTURE STOPPED**, loudly, and reports the oldest unsaved hour as lost.
- PWA shell, CI (49 engine assertions + 22 in jsdom with real WebCrypto + page smoke), and the
  app-builder pipeline pinned to the canonical SHA for the EXE/APK/Linux release.

### Not built
- Always-listening audio capture and on-device transcription: there is no speech model in this estate.
  The words are typed, or the clip is kept and marked.
