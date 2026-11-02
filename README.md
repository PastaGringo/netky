# netky

The directory of Pubky homeservers: every homeserver we can find, read from
its own signed PKARR record, checked every five minutes.

Live at <https://netky.pubky.pastalabs.dev>.

## How it works

1. **Discovery.** The Mainline DHT cannot be listed, so Netky starts from
   users: it lists user keys from Nexus, reads each user's PKARR record and
   follows the `_pubky` entry to their homeserver. Signatures are checked
   locally, so relays cannot forge records.
2. **Endpoints.** Each homeserver's own record gives its domain, ports and
   addresses. Country and network come from DB-IP's free databases, read
   locally.
3. **Checks.** Passive only: one HTTPS request on `/` every five minutes, a
   TCP connect for servers with no domain, a TLS handshake every six hours,
   and a GET on `/signup_tokens/<dummy>` to tell open signups from invite-only
   ones (nothing is ever signed up).
   No port scan, no load test.

A homeserver that no user known to Nexus points to stays invisible.

## Claiming a homeserver

Two TXT records, one on each side:

```
# in the homeserver's PKARR record
_netky  TXT  "operator=<operator pubky key>"
# in the operator's PKARR record
_netky  TXT  "operates=<homeserver pubky key>"
```

## API

```
GET /api/v1/homeservers?status=up&country=DE&minUptime=99
GET /api/v1/homeservers/<pubkey>
GET /api/v1/stats
```

## Stack

TanStack Start (web + API) and a background worker (`src/worker/main.ts`),
sharing one SQLite file (`node:sqlite`, WAL). One Docker image runs both,
with the data in `/data`.

```sh
pnpm install
pnpm worker   # collect data into ./data
pnpm dev      # http://localhost:3000
```

Requires Node 24+.

The world map in `src/lib/world-map.ts` is generated once from Natural Earth
data with `node scripts/build-map.mjs`; no map library ships to the browser.
