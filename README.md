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

4. **Activity.** Every five minutes, each live homeserver's public
   `/events/` feed (the one Nexus indexes) gives the writes per hour, active
   users, the mix of posts, follows and tags, and the apps writing under
   `/pub/`. New writes are dated when read; posts are dated from their IDs.
5. **More passive facts.** `/info` features, whether the native PubkyTLS port
   answers, security headers, and a daily read-speed test on one public file.

No port scan, no load or rate-limit test, no probing of admin endpoints.

A homeserver that no user known to Nexus points to stays invisible.

## Claiming a homeserver

Server side, on the domain the homeserver announces in its signed record:

```
_netky.<homeserver domain>  TXT  "operator=<operator pubky key>"
```

(or a `_netky` TXT in the homeserver's own PKARR record, for servers that
publish it themselves: a stock homeserver rewrites its record every hour).

Operator side, optional confirmation: a public file
`pubky://<operator>/pub/netky/operates.txt` listing the homeserver keys, or a
`_netky TXT "operates=<homeserver key>"` in the operator's PKARR record.

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
