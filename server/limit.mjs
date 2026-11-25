// In-memory request limits. They reset when the process restarts.

const buckets = new Map();

function prune(now) {
  if (buckets.size < 4000) return;
  for (const [key, bucket] of buckets) {
    if (now >= bucket.reset) buckets.delete(key);
  }
}

/** True when this call exceeds `max` uses inside `windowMs`. */
export function hit(key, max, windowMs, now = Date.now()) {
  prune(now);
  const bucket = buckets.get(key);
  if (!bucket || now >= bucket.reset) {
    buckets.set(key, { count: 1, reset: now + windowMs, max });
    return false;
  }
  bucket.count += 1;
  return bucket.count > max;
}

/** True when earlier failures already reached `max` and the window is still open. */
export function locked(key, now = Date.now()) {
  const bucket = buckets.get(key);
  return Boolean(bucket && now < bucket.reset && bucket.count >= bucket.max);
}

/** Record one failure. The next check is locked once `max` failures are stored. */
export function fail(key, max, windowMs, now = Date.now()) {
  prune(now);
  const bucket = buckets.get(key);
  if (!bucket || now >= bucket.reset) {
    buckets.set(key, { count: 1, reset: now + windowMs, max });
    return;
  }
  bucket.count += 1;
  bucket.max = max;
}

export function clearLimit(key) {
  buckets.delete(key);
}
