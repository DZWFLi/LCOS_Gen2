import { isIP } from 'node:net'

const PRIVATE_IPV4 = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^0\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
]

const PRIVATE_IPV6 = [
  /^::$/,
  /^::1$/,
  /^fc/i,
  /^fd/i,
  /^fe8/i,
  /^fe9/i,
  /^fea/i,
  /^feb/i,
  /^fec/i,
  /^fed/i,
  /^fee/i,
  /^fef/i,
  /^ff/i,
]

function isPrivateIpLiteral(hostname: string): boolean {
  const ipVersion = isIP(hostname)
  if (ipVersion === 4) {
    return PRIVATE_IPV4.some((pattern) => pattern.test(hostname))
  }
  if (ipVersion === 6) {
    return PRIVATE_IPV6.some((pattern) => pattern.test(hostname))
  }
  return false
}

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsafeUrlError'
  }
}

export function assertSafeHttpUrl(value: string): URL {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 2048) {
    throw new UnsafeUrlError('URL must be a non-empty string under 2048 characters.')
  }
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new UnsafeUrlError('URL is not parseable.')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UnsafeUrlError('URL must use http or https.')
  }
  const hostname = url.hostname.toLocaleLowerCase('en-US')
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new UnsafeUrlError('URL must not target the local machine.')
  }
  if (isPrivateIpLiteral(hostname)) {
    throw new UnsafeUrlError('URL must not target a private or loopback IP address.')
  }
  if (url.username !== '' || url.password !== '') {
    throw new UnsafeUrlError('URL must not contain credentials.')
  }
  return url
}
