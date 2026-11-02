import { createWriteStream, existsSync, renameSync } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGunzip } from 'node:zlib'
import {
  open,
  type AsnResponse,
  type CountryResponse,
  type Reader,
} from 'maxmind'
import { DATA_DIR } from './db.ts'

// IP to country + ASN, from DB-IP's free "lite" databases (CC BY 4.0),
// read locally: no IP is ever sent to a third-party API. Deliberately no
// city: many homeservers run on home connections.

const FILES = { country: 'dbip-country-lite', asn: 'dbip-asn-lite' } as const

let readers: {
  country: Reader<CountryResponse>
  asn: Reader<AsnResponse>
} | null = null

function path(kind: keyof typeof FILES) {
  return `${DATA_DIR}/${FILES[kind]}.mmdb`
}

/** Downloads this month's databases (falls back to last month's). */
export async function refreshGeoDatabases() {
  for (const kind of Object.keys(FILES) as Array<keyof typeof FILES>) {
    const now = new Date()
    const months = [0, 1].map((back) => {
      const d = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1),
      )
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
    })
    let done = false
    for (const month of months) {
      const res = await fetch(
        `https://download.db-ip.com/free/${FILES[kind]}-${month}.mmdb.gz`,
        {
          signal: AbortSignal.timeout(120_000),
        },
      )
      if (!res.ok || !res.body) continue
      const tmp = `${path(kind)}.tmp`
      await pipeline(
        Readable.fromWeb(res.body as never),
        createGunzip(),
        createWriteStream(tmp),
      )
      renameSync(tmp, path(kind))
      done = true
      break
    }
    if (!done) throw new Error(`could not download ${FILES[kind]}`)
  }
  readers = null
}

export function geoDatabasesPresent() {
  return existsSync(path('country')) && existsSync(path('asn'))
}

async function getReaders() {
  if (readers) return readers
  if (!geoDatabasesPresent()) return null
  readers = {
    country: await open<CountryResponse>(path('country')),
    asn: await open<AsnResponse>(path('asn')),
  }
  return readers
}

export interface GeoInfo {
  country: string | null
  countryName: string | null
  asn: number | null
  asOrg: string | null
}

export async function lookupIp(ip: string): Promise<GeoInfo | null> {
  const r = await getReaders()
  if (!r) return null
  const c = r.country.get(ip)
  const a = r.asn.get(ip)
  return {
    country: c?.country?.iso_code ?? null,
    countryName: c?.country?.names?.en ?? null,
    asn: a?.autonomous_system_number ?? null,
    asOrg: a?.autonomous_system_organization ?? null,
  }
}
