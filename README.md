# nyc-apt-hunt

A scheduled agent that searches StreetEasy for apartments matching a saved
filter, emails you the new matches, and syncs them to a mobile-friendly
tracker where you can mark each one Interested / Toured / Passed.

**Current search:** 2BR, doorman, $6,000–$8,000/mo, in Upper East Side,
Gramercy, Tribeca, Chelsea, Flatiron, or Kips Bay — see
[`agent/config.js`](agent/config.js) to change it. StreetEasy's DOORMAN
filter doesn't distinguish full-time from virtual doorman, and checking
would mean an extra API call per listing — which is what was tripping
StreetEasy's bot detection — so doorman type isn't auto-verified; spot-check
listings before ruling a building in or out.

## How it works

```
launchd (9am / 1pm / 6pm daily)
  → run_agent.sh
    → agent/main.js
        1. search.js       ONE search_rentals call via a local MCP server (stdio)
        2. dedup.js         drop listings already seen (state/seen_listings.json)
        3. email_digest.js  email new matches via Gmail SMTP
        4. firestore_sync.js  push new matches to Firestore (status: "new")
```

Each run makes exactly one StreetEasy API call, deliberately — an earlier
version made a follow-up `get_rental_details` call per new listing (to check
doorman type and amenities), and that per-listing call volume is what was
triggering PerimeterX bot-detection blocks in testing, even from a
legitimate home IP on a properly spaced schedule.

The tracker page ([`docs/index.html`](docs/index.html), hosted on GitHub
Pages at **https://kellypetrino.github.io/nyc-apt-hunt/**) reads/writes that
same Firestore collection directly, so a status you set on your phone shows
up in the data the agent already has — the agent never overwrites a listing
it's already synced.

**Why StreetEasy runs locally, not in the cloud:** StreetEasy blocks
datacenter IPs (PerimeterX bot detection). The MCP server
([`streeteasy-mcp/`](streeteasy-mcp/), vendored from
[Alec2435/streeteasy-mcp](https://github.com/Alec2435/streeteasy-mcp)) only
works reliably run locally, over stdio, from a home connection.

**Why the tracker is a plain webpage, not a Claude Artifact:** Artifacts can
load a script from an allowed CDN, but can't make the raw network calls
(fetch/XHR/WebSocket) Firebase needs to reach Google's servers. A normal
static site has no such restriction.

## Setup

1. **Node 20+** — the system Node may be too old; install via
   [nvm](https://github.com/nvm-sh/nvm) if so:
   ```
   nvm install 20 && nvm use 20
   ```
2. **Build the MCP server:**
   ```
   cd streeteasy-mcp && npm install && npm run build
   ```
3. **Install agent dependencies:**
   ```
   cd agent && npm install
   ```
4. **Gmail:** create an [App Password](https://myaccount.google.com/apppasswords)
   (requires 2-Step Verification), then copy `agent/.env.example` to
   `agent/.env` and fill in `GMAIL_ADDRESS` / `GMAIL_APP_PASSWORD`.
5. **Firebase:**
   - Create a free project at the [Firebase console](https://console.firebase.google.com)
   - Enable **Firestore** (Native mode) and **Anonymous Authentication**
   - Publish the rules in [`firestore.rules`](firestore.rules) (Firestore →
     Rules tab)
   - Project settings → Service accounts → generate a private key, save it
     as `agent/firebase-service-account.json` (gitignored)
   - Project settings → General → add a web app, copy the `firebaseConfig`
     object into the `firebaseConfig` constant in `docs/index.html`
6. **Schedule it:** `launchd/com.kelly.nycapthunt.plist` runs `run_agent.sh`
   at 9am/1pm/6pm daily. Copy it into place and load it:
   ```
   cp launchd/com.kelly.nycapthunt.plist ~/Library/LaunchAgents/
   launchctl load ~/Library/LaunchAgents/com.kelly.nycapthunt.plist
   ```
7. **Host the tracker:** GitHub Pages, serving `/docs` on `main` (already
   enabled for this repo at Settings → Pages).
8. **Keep it awake for the schedule:** `launchd` calendar jobs are silently
   skipped if the Mac is asleep, so two more pieces cover the "open but
   idle" case (a closed lid still sleeps regardless — no local fix for
   that):
   - `launchd/com.kelly.nycapthunt.wake.plist` runs
     `caffeinate -i -t 33060` at 8:56am, holding the Mac awake through the
     last (6pm) run:
     ```
     cp launchd/com.kelly.nycapthunt.wake.plist ~/Library/LaunchAgents/
     launchctl load ~/Library/LaunchAgents/com.kelly.nycapthunt.wake.plist
     ```
   - A daily wake-from-sleep schedule, set once via:
     ```
     sudo pmset repeat wakeorpoweron MTWRFSU 08:55:00
     ```
     Verify with `pmset -g sched`.

## Logs

`agent.log` (repo root) — one line per run, plus any errors. StreetEasy
occasionally 403s (bot detection); the agent logs it and skips that cycle
rather than crashing — the next scheduled run tries again.

## Files that don't get committed

`agent/.env`, `agent/firebase-service-account.json`, `state/seen_listings.json`,
`agent.log` — all gitignored, all local/regenerable except the two secrets,
which you recreate via the setup steps above.
