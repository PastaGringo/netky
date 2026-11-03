import { createFileRoute } from '@tanstack/react-router'

import { REPO } from '#/components/site'
import { OFFICIAL_SOURCE } from '#/lib/official'
import { RETIRED_AFTER_DAYS } from '#/lib/retired'

export const Route = createFileRoute('/about')({
  head: () => ({ meta: [{ title: 'How it works · netky' }] }),
  component: About,
})

function H2({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="m-0 mt-12 font-display text-3xl scroll-mt-20">
      <span className="text-dim">$</span> {children}
    </h2>
  )
}

function Code({ children }: { children: string }) {
  return (
    <pre className="mt-3 overflow-x-auto border bg-panel/90 p-4 text-sm">
      <code>{children}</code>
    </pre>
  )
}

function About() {
  return (
    <article className="mx-auto w-full max-w-3xl px-4 pt-12 pb-16 text-pretty sm:px-6">
      <h1 className="m-0 font-display text-6xl leading-none">how it works</h1>
      <p className="mt-5 text-lg">
        Netky lists the Pubky homeservers it can find and checks them every five
        minutes. It is an independent observer, not run by Synonym, and it
        trusts no one&apos;s word about where a user lives: every link comes
        from a record signed by the key itself.
      </p>

      <H2>discovery</H2>
      <p>
        The Mainline DHT cannot be listed: you need a key to read a record. So
        Netky starts from users.
      </p>
      <ol className="space-y-2 pl-5">
        <li>
          It lists user keys from{' '}
          <a
            href="https://nexus.pubky.app"
            className="underline hover:text-red"
          >
            Nexus
          </a>
          , the pubky.app indexer, every six hours.
        </li>
        <li>
          For each user it reads their PKARR record and follows the{' '}
          <code>_pubky</code> entry, which names their homeserver. The signature
          is checked locally, so the relay serving the record cannot forge it.
        </li>
        <li>
          It then reads each homeserver&apos;s own record to learn its domain,
          ports and addresses.
        </li>
      </ol>
      <p>
        <span className="text-amber">Limit:</span> a homeserver with no user
        known to Nexus stays invisible. Netky shows the part of the network that
        is actually used, not every server that exists.
      </p>

      <H2>checks</H2>
      <p>Only what a normal client would do, nothing more:</p>
      <ul className="space-y-2 pl-5">
        <li>
          one HTTPS request on the root page every five minutes (latency,
          status, server header);
        </li>
        <li>
          a plain TCP connect for servers that only publish a Pubky TLS port;
        </li>
        <li>one TLS handshake every six hours to read the certificate;</li>
        <li>
          one request to <code>/signup_tokens/…</code> every six hours with a
          dummy token, to learn whether signups are open or invite only. Nothing
          is ever signed up.
        </li>
        <li>
          every six hours, <code>/info</code> (the features the server
          announces) and a TCP connect to its native PubkyTLS port;
        </li>
        <li>
          once a day, one download of a public file (at most 8 MB) to measure
          read speed.
        </li>
      </ul>
      <p>
        No port scan, no load test, no attempt to log in. Requests carry the
        user agent{' '}
        <code>netky/0.1 (+https://netky.pubky.pastalabs.dev/about)</code>.
        Checks run from a single place, so latency is measured from the
        Netherlands.
      </p>
      <p>
        Location comes from DB-IP&apos;s free databases, read locally: no
        address is sent to a third party. Only the country and network are kept,
        never a city. Servers behind a CDN such as Cloudflare are shown as such,
        since their IP only says where the CDN answered.
      </p>

      <H2 id="activity">activity</H2>
      <p>
        A server that answers is not necessarily used. Every five minutes, Netky
        reads each live homeserver&apos;s public event feed,{' '}
        <code>/events/</code>, the same one Nexus indexes: one line per public
        write or delete. From it come the writes per hour, the active users, the
        mix of posts, follows, tags and files, and the apps writing there (the
        folders under <code>/pub/</code>).
      </p>
      <p>
        The feed carries no dates. New writes are dated when Netky reads them,
        and posts are dated from their IDs, which encode their creation time.
        Older follows or tags cannot be dated, so a server is only called a{' '}
        <strong>ghost</strong> when its last dated activity is over 30 days old
        and Netky saw no write during a week of watching it. While its history
        is being read, a server shows as &quot;indexing&quot;.
      </p>

      <H2 id="retired">servers that go away</H2>
      <p>
        A server that has not answered as a homeserver for {RETIRED_AFTER_DAYS}{' '}
        days leaves the list, the map and the totals. Netky keeps checking it,
        so it comes back by itself at its first answer, and its page and API URL
        stay reachable by key.
      </p>

      <H2 id="security">security score</H2>
      <p>
        A score out of 100, built only from what Netky already observes: nothing
        is tested for it. Each check counts only where it applies, and the score
        is the share of the applicable points.
      </p>
      <ul className="space-y-1 pl-5">
        <li>valid TLS certificate: 30</li>
        <li>certificate valid for 14+ more days: 5</li>
        <li>
          HSTS (<code>strict-transport-security</code>): 15, so browsers never
          fall back to plain HTTP
        </li>
        <li>
          <code>x-content-type-options: nosniff</code>: 15, since homeservers
          host files uploaded by their users
        </li>
        <li>
          native PubkyTLS port answers: 10, TLS authenticated by the
          server&apos;s own key
        </li>
        <li>no software version in the Server header: 5</li>
        <li>no X-Powered-By header: 5</li>
        <li>
          only for servers that publish websites (the <code>websites</code>{' '}
          feature): Content-Security-Policy 10, framing protection 5
        </li>
      </ul>
      <p>
        Grades: A from 90, B from 75, C from 60, D from 40, F below. Headers
        such as CSP matter for web pages, not for an API, which is why they only
        count where the server hosts sites. A good score says the basics are in
        place; it is not an audit.
      </p>

      <H2 id="not-done">what Netky does not do</H2>
      <ul className="space-y-2 pl-5">
        <li>
          <strong>
            No port scan, no load or rate-limit test, no probing of the admin
            endpoint.
          </strong>{' '}
          That is security testing of servers Netky does not own: without the
          operator&apos;s consent it is illegal in many countries, and a load
          test also hurts the people using the server.
        </li>
        <li>
          <strong>No software version.</strong> Homeservers do not announce one;
          the features listed on <code>/info</code> are the closest thing.
        </li>
        <li>
          <strong>No storage size or file count.</strong> Only the admin port,
          never public, exposes them.
        </li>
      </ul>

      <H2 id="official">official homeservers</H2>
      <p>
        Servers marked with the Synonym logo are run by Synonym, the company
        behind Pubky: their production homeserver (where pubky.app users live)
        and their staging one. They are recognised by their key, as listed in
        the{' '}
        <a href={OFFICIAL_SOURCE} className="underline hover:text-red">
          Pubky Ring source code
        </a>
        , never by their domain: anyone can announce{' '}
        <code>homeserver.pubky.app</code> in their own record.
      </p>

      <H2 id="claim">claim your homeserver</H2>
      <p>
        A claim links a homeserver to its operator&apos;s Pubky key. It has two
        sides: one proves you control the server, the other that the key you
        name agrees.
      </p>
      <p>
        <strong>1. The server.</strong> On the domain your homeserver announces
        (the one shown on its Netky page), add a DNS record:
      </p>
      <Code>
        {'_netky.<your homeserver domain>  TXT  "operator=<your pubky key>"'}
      </Code>
      <p>
        That domain comes from the homeserver&apos;s own signed record, so only
        whoever runs the server can set it. If you publish the homeserver&apos;s
        PKARR record yourself, a <code>{'_netky TXT "operator=<key>"'}</code> in
        that record works too. A stock homeserver rewrites its record every
        hour, so for most people DNS is the way.
      </p>
      <p>
        <strong>2. The operator.</strong> From your own Pubky account, confirm
        by publishing a public file that lists the homeservers you run, one key
        per line:
      </p>
      <Code>{'pubky://<your pubky key>/pub/netky/operates.txt'}</Code>
      <p>
        The easy way: open your server&apos;s page on Netky and press{' '}
        <strong>I run this server</strong>. Netky asks Pubky Ring for one
        folder, <code>/pub/netky/</code>, writes that file for you and signs
        out. Your name and avatar show on the server once it is confirmed.
      </p>
      <p>
        A <code>{'_netky TXT "operates=<homeserver key>"'}</code> in your own
        PKARR record works too. Until then, the server shows as claimed with the
        operator &quot;not confirmed&quot;.
      </p>
      <p>
        Netky picks changes up within the hour. To revoke a claim, remove the
        DNS record. The <code>pubky</code> prefix on keys is optional.
      </p>

      <H2>api</H2>
      <p>Everything on the site is available as JSON, free to use:</p>
      <Code>{`GET /api/v1/homeservers
GET /api/v1/homeservers/<pubkey>
GET /api/v1/stats`}</Code>

      <H2>contact</H2>
      <p>
        Something wrong about your server, or want it excluded? Open an issue on{' '}
        <a href={`${REPO}/issues`} className="underline hover:text-red">
          GitHub
        </a>
        . The code is open source.
      </p>
    </article>
  )
}
