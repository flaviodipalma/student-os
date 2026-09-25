import "server-only"

// The request body, read up to `limit` bytes (then abandoned).
export async function readLimited(request: Request, limit: number): Promise<Uint8Array<ArrayBuffer> | "too-large"> {
  if (!request.body) return new Uint8Array(new ArrayBuffer(0))
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > limit) {
      await reader.cancel().catch(() => {})
      return "too-large"
    }
    chunks.push(value)
  }
  const body = new Uint8Array(new ArrayBuffer(total))
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}
