# NostrScope – Nostr Event Explorer

A standalone browser tool to inspect any Nostr event and discover its entire graph of replies, reactions, reposts, zaps, and more. Paste a note ID, nevent, or URL and explore.

**Live on GitHub Pages** (just open `index.html`).

## Features

- Accepts `note1...`, `nevent1...`, hex IDs, `nostr:` URIs, and client URLs
- Fetches original event + all related events referencing it
- Categorizes: replies, reactions, reposts, quotes, payments
- Profiles with avatars, NIP-05, npub
- Real-time relay connection & multi‑relay search
- Filters by kind, author, relay (UI ready for extension)
- Export to JSON / CSV
- Raw JSON viewer with copy/download
- Completely serverless – runs in your browser

## Supported Event Kinds

- 0 (metadata – profiles)
- 1 (text notes – replies, quotes)
- 6 (reposts)
- 7 (reactions)
- 9734/9735 (zaps)

## Relay Searching

Connects to a configurable list of public relays (default: Damus, Primal, Nos.lol, Nostr.band, Snort). You can edit the list via the ⚙️ Relay Settings button.

The tool first fetches the original event, then subscribes to all events with an `e` tag pointing to the event ID. Deduplication is automatic.

## Limitations

- Relies on public relays; some events may not be found if not broadcast.
- Search timeout is set to 12 seconds; very large event graphs may be incomplete.
- Client‑side only; cannot access private relays or DMs.
- Profile loading is best‑effort (first few profiles found).

## Future Improvements

- Infinite scroll for large timelines
- Advanced filters (by author, date range)
- Graph visualization
- NIP‑05 verification indicator

## License

MIT – do whatever you like.
