'use strict'

// stdout can split the startup line across chunks. Only accept this server's
// loopback origin and launch token, never arbitrary URLs from plugin logs.
function createLaunchUrlReader(baseUrl) {
  let pending = ''
  let launchUrl = null
  return {
    get url() { return launchUrl },
    push(chunk) {
      pending += String(chunk)
      const lines = pending.split(/\r?\n/)
      pending = lines.pop().slice(-8192)
      for (const line of lines) {
        const match = line.match(/^dsh web: (http:\/\/[^\s]+)/)
        if (!match) continue
        try {
          const url = new URL(match[1])
          if (url.origin !== baseUrl || url.pathname !== '/' || url.username || url.password) continue
          const tokens = url.searchParams.getAll('token')
          if (tokens.length !== 1 || !/^[A-Za-z0-9_-]+$/.test(tokens[0])) continue
          launchUrl = `${baseUrl}/?token=${encodeURIComponent(tokens[0])}`
        } catch { /* ignore malformed startup output */ }
      }
    },
  }
}

function lanLaunchUrl(address, port, launchUrl) {
  if (!launchUrl) return null
  const url = new URL(launchUrl)
  url.hostname = address
  url.port = String(port)
  return url.href
}

function isReadyResponse(statusCode, headers) {
  // DSH 0.1.7 uses directory-relative './'; both forms return to the root
  // of the validated launch URL. Never accept arbitrary redirect targets.
  return statusCode === 200 || (statusCode === 303 &&
    (headers.location === '/' || headers.location === './') &&
    Boolean(headers['set-cookie']?.length))
}

module.exports = { createLaunchUrlReader, lanLaunchUrl, isReadyResponse }
