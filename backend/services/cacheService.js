let Redis;
try {
  Redis = require("ioredis");
} catch {
  Redis = null;
}

const memoryCache = new Map();
const redisUrl = process.env.REDIS_URL;
const defaultTtlSeconds = Number(process.env.CACHE_TTL_SECONDS || 60);
const redis = Redis && redisUrl ? new Redis(redisUrl) : null;

function memoryGet(key) {
  const record = memoryCache.get(key);
  if (!record) return null;
  if (record.expiresAt && record.expiresAt < Date.now()) {
    memoryCache.delete(key);
    return null;
  }
  return record.value;
}

async function get(key) {
  if (redis) {
    const raw = await redis.get(key);
    return raw ? JSON.parse(raw) : null;
  }
  return memoryGet(key);
}

async function set(key, value, ttlSeconds = defaultTtlSeconds) {
  if (redis) {
    await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
    return;
  }

  memoryCache.set(key, {
    value,
    expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
  });
}

async function del(patternOrKey) {
  if (redis) {
    if (patternOrKey.includes("*")) {
      const keys = await redis.keys(patternOrKey);
      if (keys.length) await redis.del(keys);
      return;
    }
    await redis.del(patternOrKey);
    return;
  }

  if (patternOrKey.includes("*")) {
    const prefix = patternOrKey.split("*")[0];
    for (const key of memoryCache.keys()) {
      if (key.startsWith(prefix)) memoryCache.delete(key);
    }
    return;
  }
  memoryCache.delete(patternOrKey);
}

async function health() {
  if (!redis) {
    return { status: "degraded", provider: "memory", message: "REDIS_URL not configured" };
  }

  await redis.ping();
  return { status: "ok", provider: "redis" };
}

module.exports = {
  get,
  set,
  del,
  health,
};
