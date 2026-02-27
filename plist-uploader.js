addEventListener("fetch", event => {
  event.respondWith(handleRequest(event))
})

if (!globalThis.PLATFORM_STORE) {
  globalThis.PLATFORM_STORE = new Map()
}

async function handleRequest(event) {
  const request = event.request
  const url = new URL(request.url)
  const store = globalThis.PLATFORM_STORE

  // POST /upload
  if (request.method === "POST" && url.pathname === "/upload") {
    const contentType = request.headers.get("content-type") || ""

    if (!contentType.includes("xml") && !contentType.includes("plist") && !contentType.includes("text")) {
      return new Response("Only plist files allowed", { status: 400 })
    }

    const body = await request.text()

    if (!body.trim().startsWith("<?xml")) {
      return new Response("Invalid plist format", { status: 400 })
    }

    const id = crypto.randomUUID().replace(/-/g, "")
    const expiresAt = Date.now() + 60 * 60 * 1000

    store.set(id, { body: body, expiresAt: expiresAt })

    event.waitUntil(scheduleDeletion(id, 60 * 60 * 1000))

    const link = url.origin + "/" + id

    return new Response(
      "Your plist is hosted at " + link,
      { headers: { "content-type": "text/plain" } }
    )
  }

  // GET /:id
  if (request.method === "GET" && url.pathname.length > 1) {
    const id = url.pathname.slice(1)
    const entry = store.get(id)

    if (!entry) {
      return new Response("Not found", { status: 404 })
    }

    if (Date.now() > entry.expiresAt) {
      store.delete(id)
      return new Response("Expired", { status: 410 })
    }

    return new Response(entry.body, {
      headers: {
        "content-type": "application/xml"
      }
    })
  }

  // DELETE /:id
  if (request.method === "DELETE" && url.pathname.length > 1) {
    const id = url.pathname.slice(1)

    if (!store.has(id)) {
      return new Response("Not found", { status: 404 })
    }

    store.delete(id)
    return new Response("Deleted", { status: 200 })
  }

  return new Response("Invalid route", { status: 404 })
}

async function scheduleDeletion(id, delay) {
  await new Promise(resolve => setTimeout(resolve, delay))
  if (globalThis.PLATFORM_STORE) {
    globalThis.PLATFORM_STORE.delete(id)
  }
}
