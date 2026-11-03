// Homeservers run by Synonym, the company behind Pubky. Matched by key, never
// by domain: anyone can announce homeserver.pubky.app in their own record.
// Source: PRODUCTION_HOMESERVER and STAGING_HOMESERVER in pubky/pubky-ring,
// src/utils/constants.ts (production is also Nexus's default homeserver).
export const OFFICIAL: Record<string, 'production' | 'staging'> = {
  '8um71us3fyw6h8wbcxb5ar3rwusy1a6u49956ikzojg3gcwd1dty': 'production',
  ufibwbmed6jeq9k4p583go95wofakh9fwpp4k734trq79pd9u1uy: 'staging',
}
export const OFFICIAL_SOURCE =
  'https://github.com/pubky/pubky-ring/blob/main/src/utils/constants.ts'
