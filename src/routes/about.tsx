import { createFileRoute } from '@tanstack/react-router'

import { REPO } from '#/components/site'

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
