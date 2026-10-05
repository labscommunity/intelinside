import { openApiDocument } from '../src/agent-api/contract.js'
export function GET() {
  return Response.json(openApiDocument(), { headers: { 'cache-control': 'public, max-age=300' } })
}
