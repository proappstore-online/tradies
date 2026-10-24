export type Route =
  | { name: 'browse' }
  | { name: 'jobs' }
  | { name: 'job'; id: string }
  | { name: 'listing'; id: string }
  | { name: 'saved' }
  | { name: 'requests' }
  | { name: 'quotes' }
  | { name: 'inbox' }
  | { name: 'mine' }
  | { name: 'new' }
  | { name: 'edit'; id: string }
  | { name: 'messages' }
  | { name: 'thread'; listingId: string; otherId: string }
  | { name: 'workThread'; targetType: 'job' | 'request'; targetId: string; otherId: string }
  | { name: 'settings' }


function parseHash(h: string): Route | undefined {
  let m = h.match(/^#\/l\/([\w:-]+)$/)
  if (m) return { name: 'listing', id: m[1]! }
  m = h.match(/^#\/jobs\/([\w:-]+)$/)
  if (m) return { name: 'job', id: m[1]! }
  m = h.match(/^#\/mine\/([\w:-]+)\/edit$/)
  if (m) return { name: 'edit', id: m[1]! }
  m = h.match(/^#\/messages\/([\w:-]+)\/([\w:.@-]+)$/)
  if (m) return { name: 'thread', listingId: m[1]!, otherId: m[2]! }
  m = h.match(/^#\/work\/(job|request)\/([\w:-]+)\/([\w:.@-]+)$/)
  if (m) return { name: 'workThread', targetType: m[1] as 'job' | 'request', targetId: m[2]!, otherId: m[3]! }
  switch (h) {
    case '#/jobs': return { name: 'jobs' }
    case '#/saved': return { name: 'saved' }
    case '#/requests': return { name: 'requests' }
    case '#/quotes': return { name: 'quotes' }
    case '#/inbox': return { name: 'inbox' }
    case '#/mine': return { name: 'mine' }
    case '#/mine/new': return { name: 'new' }
    case '#/messages': return { name: 'messages' }
    case '#/settings': return { name: 'settings' }
    default: return undefined
  }
}


/** Public record paths reach the host; legacy hash routes keep their original behavior. */
export function parseRoute(input: { hash: string; pathname: string }): Route {
  const legacy = parseHash(input.hash)
  if (legacy) return legacy
  const match = input.pathname.match(/^\/(l|jobs)\/([^/]+)\/?$/)
  if (match) {
    try {
      const id = decodeURIComponent(match[2]!)
      if (/^[\w:-]+$/.test(id)) return { name: match[1] === 'l' ? 'listing' : 'job', id }
    } catch { /* Malformed links fall back to the directory. */ }
  }
  return { name: 'browse' }
}

export const listingPath = (id: string) => `/l/${encodeURIComponent(id).replace(/%3A/g, ':')}`
export const jobPath = (id: string) => `/jobs/${encodeURIComponent(id).replace(/%3A/g, ':')}`
