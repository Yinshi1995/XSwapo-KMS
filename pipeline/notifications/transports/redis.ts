import Redis from "ioredis"

import type { NotificationEvent, StoredNotification } from "../types"

// ─── Key strategy ────────────────────────────────────────────────────
//
//  notifications:event:{id}              → JSON blob (TTL 86 400s)
//  notifications:idx:all                 → ZSET, score = unix-ms, member = id
//  notifications:idx:severity:{severity} → ZSET
//  notifications:idx:category:{category} → ZSET
//  notifications:idx:type:{eventType}    → ZSET
//
// Every key receives the same TTL so stale data auto-expires.
// Index entries whose event key has expired become orphans and are
// silently ignored on read (mget returns null).

const PFX = "notifications"

const eventKey   = (id: string)       => `${PFX}:event:${id}`
const idxAll     =                       `${PFX}:idx:all`
const idxSeverity = (s: string)       => `${PFX}:idx:severity:${s}`
const idxCategory = (c: string)       => `${PFX}:idx:category:${c}`
const idxType    = (t: string)        => `${PFX}:idx:type:${t}`

// ─── Store implementation ────────────────────────────────────────────

export class RedisNotificationStore {
  private client: Redis
  private ttl: number

  constructor(url: string, ttlSeconds: number) {
    this.client = new Redis(url, {
      maxRetriesPerRequest: 3,
      retryStrategy(times: number) {
        if (times > 5) return null
        return Math.min(times * 200, 2_000)
      },
      lazyConnect: true,
    })
    this.ttl = ttlSeconds

    this.client.on("error", (err: Error) => {
      console.error("[redis] Connection error:", err.message)
    })
  }

  async connect(): Promise<void> {
    await this.client.connect()
    console.info("[redis] Notification store connected")
  }

  async disconnect(): Promise<void> {
    await this.client.quit()
  }

  // ── Write ──────────────────────────────────────────────────────────

  async store(event: NotificationEvent): Promise<void> {
    const stored: StoredNotification = {
      id: event.id,
      sourceEventId: event.sourceEventId,
      type: event.type,
      severity: event.severity,
      category: event.category,
      timestamp: event.timestamp.toISOString(),
      correlationId: event.correlationId,
      summary: event.summary,
      payload: event.payload,
      createdAt: new Date().toISOString(),
    }

    const key = eventKey(event.id)
    const score = event.timestamp.getTime()
    const json = JSON.stringify(stored)

    const pipe = this.client.pipeline()

    pipe.set(key, json, "EX", this.ttl)
    pipe.zadd(idxAll, score, event.id)
    pipe.zadd(idxSeverity(event.severity), score, event.id)
    pipe.zadd(idxCategory(event.category), score, event.id)
    pipe.zadd(idxType(event.type), score, event.id)

    // Refresh TTL on index sets to keep them alive while events flow in
    pipe.expire(idxAll, this.ttl)
    pipe.expire(idxSeverity(event.severity), this.ttl)
    pipe.expire(idxCategory(event.category), this.ttl)
    pipe.expire(idxType(event.type), this.ttl)

    await pipe.exec()
  }

  // ── List (paginated, filterable) ───────────────────────────────────

  async list(params: {
    offset?: number
    limit?: number
    severity?: string
    category?: string
    type?: string
  }): Promise<{ notifications: StoredNotification[]; total: number }> {
    const offset = Math.max(0, params.offset ?? 0)
    const limit = Math.min(Math.max(1, params.limit ?? 50), 200)

    // Pick narrowest matching index
    let index = idxAll
    if (params.type)          index = idxType(params.type)
    else if (params.severity) index = idxSeverity(params.severity)
    else if (params.category) index = idxCategory(params.category)

    const total = await this.client.zcard(index)

    // Reverse chronological (newest first)
    const ids = await this.client.zrevrange(index, offset, offset + limit - 1)
    if (ids.length === 0) {
      return { notifications: [], total }
    }

    const keys = ids.map((id: string) => eventKey(id))
    const values = await this.client.mget(...keys)

    const notifications: StoredNotification[] = []
    for (const raw of values) {
      if (!raw) continue
      try {
        notifications.push(JSON.parse(raw) as StoredNotification)
      } catch {
        // Skip corrupted entries silently
      }
    }

    return { notifications, total }
  }

  // ── Get single ─────────────────────────────────────────────────────

  async get(id: string): Promise<StoredNotification | null> {
    const raw = await this.client.get(eventKey(id))
    if (!raw) return null

    try {
      return JSON.parse(raw) as StoredNotification
    } catch {
      return null
    }
  }

  // ── Delete ─────────────────────────────────────────────────────────

  async delete(id: string): Promise<boolean> {
    const raw = await this.client.get(eventKey(id))
    if (!raw) return false

    let stored: StoredNotification | null = null
    try {
      stored = JSON.parse(raw) as StoredNotification
    } catch {
      // Key exists but corrupt — still delete it
    }

    const pipe = this.client.pipeline()
    pipe.del(eventKey(id))
    pipe.zrem(idxAll, id)

    if (stored) {
      pipe.zrem(idxSeverity(stored.severity), id)
      pipe.zrem(idxCategory(stored.category), id)
      pipe.zrem(idxType(stored.type), id)
    }

    await pipe.exec()
    return true
  }
}
