import { pipeline } from "./pipeline"

// ─── Admin notification API handlers ─────────────────────────────────
//
// Endpoints:
//   GET    /admin/notifications        — list (paginated + filterable)
//   GET    /admin/notifications/:id    — read single notification
//   DELETE /admin/notifications/:id    — delete notification early

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

// ─── Route handler ───────────────────────────────────────────────────

export async function handleAdminNotificationsRequest(
  req: Request,
  requestId: string
): Promise<Response> {
  const url = new URL(req.url)
  const pathname = url.pathname.replace(/\/+$/, "")

  // Extract notification ID from path: /admin/notifications/:id
  const segments = pathname.split("/").filter(Boolean)
  // segments: ["admin", "notifications"] or ["admin", "notifications", ":id"]
  const notificationId = segments.length >= 3 ? segments[2] : null

  try {
    // GET /admin/notifications — list
    if (req.method === "GET" && !notificationId) {
      const offset = Math.max(0, Number(url.searchParams.get("offset") || "0") || 0)
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") || "50") || 50))
      const severity = url.searchParams.get("severity") || undefined
      const category = url.searchParams.get("category") || undefined
      const type = url.searchParams.get("type") || undefined

      console.info(
        `[${requestId}] Admin list notifications: offset=${offset} limit=${limit}` +
        `${severity ? ` severity=${severity}` : ""}` +
        `${category ? ` category=${category}` : ""}` +
        `${type ? ` type=${type}` : ""}`
      )

      const result = await pipeline.listNotifications({
        offset,
        limit,
        severity,
        category,
        type,
      })

      return jsonResponse(200, {
        notifications: result.notifications,
        total: result.total,
        offset,
        limit,
      })
    }

    // GET /admin/notifications/:id — read single
    if (req.method === "GET" && notificationId) {
      console.info(`[${requestId}] Admin get notification: ${notificationId}`)

      const notification = await pipeline.getNotification(notificationId)
      if (!notification) {
        return jsonResponse(404, { error: "Notification not found" })
      }

      return jsonResponse(200, { notification })
    }

    // DELETE /admin/notifications/:id — delete
    if (req.method === "DELETE" && notificationId) {
      console.info(`[${requestId}] Admin delete notification: ${notificationId}`)

      const deleted = await pipeline.deleteNotification(notificationId)
      if (!deleted) {
        return jsonResponse(404, { error: "Notification not found" })
      }

      return jsonResponse(200, { deleted: true })
    }

    return jsonResponse(405, { error: "Method not allowed" })
  } catch (error) {
    console.error(`[${requestId}] Admin notifications error:`, error)
    return jsonResponse(500, { error: "Internal server error" })
  }
}
