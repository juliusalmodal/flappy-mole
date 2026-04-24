const { app } = require('@azure/functions')
const { TableClient } = require('@azure/data-tables')
const { OAuth2Client } = require('google-auth-library')

const TABLE = 'flappyScores'
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID

const oauthClient = new OAuth2Client(GOOGLE_CLIENT_ID)

function getClient() {
  const conn = process.env.AZURE_STORAGE_CONNECTION_STRING
  if (!conn) throw new Error('AZURE_STORAGE_CONNECTION_STRING is not configured.')
  return TableClient.fromConnectionString(conn, TABLE)
}

async function ensureTable(client) {
  try { await client.createTable() } catch (e) { if (e.statusCode !== 409) throw e }
}

async function getLeaderboard(client) {
  const rows = []
  for await (const entity of client.listEntities()) rows.push(entity)
  rows.sort((a, b) => b.depth - a.depth)
  return rows.slice(0, 20).map((e, i) => ({
    rank: i + 1,
    sub: e.rowKey,
    name: e.name,
    picture: e.picture || null,
    depth: e.depth,
  }))
}

async function verifyGoogleToken(idToken) {
  if (!GOOGLE_CLIENT_ID) throw new Error('GOOGLE_CLIENT_ID is not configured.')
  const ticket = await oauthClient.verifyIdToken({
    idToken,
    audience: GOOGLE_CLIENT_ID,
  })
  return ticket.getPayload()
}

app.http('flappy-get', {
  methods: ['GET'],
  route: 'flappy',
  authLevel: 'anonymous',
  handler: async () => {
    const cors = { 'Access-Control-Allow-Origin': '*' }
    try {
      const client = getClient()
      await ensureTable(client)
      return { headers: cors, jsonBody: { leaderboard: await getLeaderboard(client) } }
    } catch (err) {
      return { status: 500, headers: cors, jsonBody: { error: err.message } }
    }
  },
})

app.http('flappy-post', {
  methods: ['POST'],
  route: 'flappy',
  authLevel: 'anonymous',
  handler: async (request) => {
    const cors = { 'Access-Control-Allow-Origin': '*' }

    const token = (request.headers.get('x-id-token') || '').trim()
    if (!token) {
      return { status: 401, headers: cors, jsonBody: { error: 'Missing token' } }
    }

    let payload
    try {
      payload = await verifyGoogleToken(token)
    } catch {
      return { status: 401, headers: cors, jsonBody: { error: 'Invalid token' } }
    }

    let body = {}
    try { body = await request.json() } catch {}

    const { depth } = body
    if (typeof depth !== 'number' || depth < 0 || !Number.isFinite(depth)) {
      return { status: 400, headers: cors, jsonBody: { error: 'Invalid depth' } }
    }

    const sub = payload.sub
    const name = (payload.name || payload.email || 'Player').slice(0, 80)
    const email = (payload.email || '').slice(0, 120)
    const picture = payload.picture || null

    try {
      const client = getClient()
      await ensureTable(client)

      let existing = null
      try { existing = await client.getEntity('scores', sub) } catch {}

      const nextDepth = existing ? Math.max(existing.depth, Math.floor(depth)) : Math.floor(depth)
      await client.upsertEntity({
        partitionKey: 'scores',
        rowKey: sub,
        name,
        email,
        picture,
        depth: nextDepth,
      }, 'Replace')

      return { headers: cors, jsonBody: { leaderboard: await getLeaderboard(client) } }
    } catch (err) {
      return { status: 500, headers: cors, jsonBody: { error: err.message } }
    }
  },
})
