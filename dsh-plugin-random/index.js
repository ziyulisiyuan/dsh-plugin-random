import { randomInt, randomBytes, randomUUID } from 'node:crypto'

/** Stable Loader identity. */
export const name = 'dsh-plugin-random'

/** Services this plugin requires. */
export const inject = ['tools', 'systemPrompt']

const MAX_COUNT = 10000
const MAX_STRING_LENGTH = 4096
const MAX_BYTES = 4096
const MAX_SHUFFLE_ITEMS = 10000

const CHARACTER_SETS = {
  digits: '0123456789',
  lower: 'abcdefghijklmnopqrstuvwxyz',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  hex: '0123456789abcdef',
  symbols: '!@#$%^&*()-_=+[]{};:,.<>?/~',
}
const DEFAULT_SETS = ['lower', 'upper', 'digits']

class ToolInputError extends Error {}

const fail = (message) => { throw new ToolInputError(message) }

function integerArg(value, label, min, max) {
  if (typeof value !== 'number' || !Number.isInteger(value)) fail(`${label} must be an integer`)
  if (value < min || value > max) fail(`${label} must be between ${min} and ${max}`)
  return value
}

function finiteNumberArg(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${label} must be a finite number`)
  return value
}

/**
 * mulberry32 seeded PRNG — reproducible, NOT cryptographic.
 * ponytail: only for simulation/test reproducibility; never use seeded
 * output as keys, nonces or passwords.
 */
export function mulberry32(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6D2B79F5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Uniform float in [0, 1) built from 53 CSPRNG bits (full double precision). */
function randomUnit() {
  const buf = randomBytes(7)
  let bits = 0n
  for (let i = 0; i < 7; i++) bits = (bits << 8n) | BigInt(buf[i])
  return Number(bits & ((1n << 53n) - 1n)) / 2 ** 53
}

/**
 * Uniform values in [min, max].
 * integer=true → integers via rejection sampling (exactly uniform, no modulo bias).
 * integer=false → floats in [min, max) mapped from 53 random bits.
 * seed (uint32) → the whole batch comes from one mulberry32 sequence, so the
 * same seed and arguments reproduce the same values.
 * ponytail: seeded integer mode maps a 2^32-lattice PRNG onto the range, so
 * spans near or above 2^32 show lattice gaps; fine for simulations, not for crypto.
 */
export function generateNumbers({ min, max, integer = true, count = 1, seed } = {}) {
  finiteNumberArg(min, 'min')
  finiteNumberArg(max, 'max')
  if (min > max) fail(`min (${min}) must be <= max (${max})`)
  integerArg(count, 'count', 1, MAX_COUNT)
  const seeded = seed !== undefined
  let prng
  if (seeded) {
    integerArg(seed, 'seed', 0, 0xffffffff)
    prng = mulberry32(seed)
  }
  const values = []
  if (integer) {
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max)) {
      fail('integer mode requires min and max to be safe integers')
    }
    if (max === Number.MAX_SAFE_INTEGER) fail('max is too large for integer mode')
    const span = max - min + 1
    for (let i = 0; i < count; i++) {
      values.push(seeded ? min + Math.floor(prng() * span) : randomInt(min, max + 1))
    }
  } else {
    const span = max - min
    for (let i = 0; i < count; i++) {
      const unit = seeded ? prng() : randomUnit()
      let value = min + unit * span
      if (value >= max) value = min // 2^-53 rounding guard at the top edge
      values.push(value)
    }
  }
  return { min, max, integer, count, ...(seeded ? { seed } : {}), values }
}

/**
 * Random string of `length` characters drawn uniformly per character from an
 * alphabet built either from named `sets` (digits / lower / upper / hex /
 * symbols, union + dedupe) or from a literal `chars` string (any Unicode,
 * overrides sets). Per-character uniform: with sets ['lower','digits'] each
 * of the 36 characters is equally likely.
 */
export function generateString({ length, sets, chars } = {}) {
  integerArg(length, 'length', 1, MAX_STRING_LENGTH)
  let alphabet
  if (chars !== undefined) {
    if (typeof chars !== 'string' || chars.length === 0) fail('chars must be a non-empty string')
    alphabet = [...new Set([...chars])]
  } else {
    const wanted = sets === undefined ? DEFAULT_SETS : sets
    if (!Array.isArray(wanted) || wanted.length === 0) fail('sets must be a non-empty array')
    const seen = new Set()
    for (const setName of wanted) {
      const setChars = CHARACTER_SETS[setName]
      if (setChars === undefined) {
        fail(`unknown set "${setName}"; available: ${Object.keys(CHARACTER_SETS).join(', ')}`)
      }
      for (const ch of setChars) seen.add(ch)
    }
    alphabet = [...seen]
  }
  if (alphabet.length === 0) fail('character set is empty')
  let value = ''
  for (let i = 0; i < length; i++) value += alphabet[randomInt(0, alphabet.length)]
  return { length, charsetSize: alphabet.length, value }
}

/** `length` random bytes from the CSPRNG, encoded hex (default), base64 or base64url. */
export function generateBytes({ length, encoding = 'hex' } = {}) {
  integerArg(length, 'length', 1, MAX_BYTES)
  if (!['hex', 'base64', 'base64url'].includes(encoding)) {
    fail('encoding must be one of: hex, base64, base64url')
  }
  return { length, encoding, value: randomBytes(length).toString(encoding) }
}

/** RFC 9562 UUID v4 (crypto.randomUUID preserves version/variant bits). */
export function generateUuid() {
  return { value: randomUUID() }
}

/** Unbiased Fisher-Yates shuffle; returns a new array, input untouched. */
export function generateShuffle({ items } = {}) {
  if (!Array.isArray(items)) fail('items must be an array')
  if (items.length > MAX_SHUFFLE_ITEMS) fail(`items accepts at most ${MAX_SHUFFLE_ITEMS} entries`)
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return { items: out }
}

const text = (value) => [{ type: 'text', text: value }]

const renderJson = (value) => {
  const json = JSON.stringify(value)
  return text(json.length > 2000 ? `${json.slice(0, 2000)}… (truncated)` : json)
}

export function apply(ctx) {
  ctx.effect(() => {
    const disposers = [
      ctx.tools.register({
        name: 'random_number',
        description: 'Generate uniformly distributed random numbers within [min, max] from a CSPRNG — use for 随机数/随机抽取 whenever the range matters. Prefer this tool over inventing random numbers yourself: invented values are biased and can fall outside the requested range. integer=true returns integers in [min, max] (default); integer=false returns floats in [min, max). count returns a batch of independent values. Pass seed (uint32) for a reproducible sequence (simulation/testing only, NOT cryptographic); the whole batch is generated in one call, same seed + same arguments = same values.',
        parameters: {
          type: 'object',
          properties: {
            min: { type: 'number', description: 'Range lower bound (inclusive).' },
            max: { type: 'number', description: 'Range upper bound (inclusive for integers, inclusive up to a 2^-53 rounding probability for floats).' },
            integer: { type: 'boolean', description: 'true → integers; false → floats. Default true.' },
            count: { type: 'integer', description: `Batch size, 1..${MAX_COUNT}. Default 1.` },
            seed: { type: 'integer', description: 'Optional uint32 seed for reproducible output. Not cryptographic.' },
          },
          required: ['min', 'max'],
          additionalProperties: false,
        },
        output: {
          schema: {
            type: 'object',
            properties: {
              min: { type: 'number' },
              max: { type: 'number' },
              integer: { type: 'boolean' },
              count: { type: 'integer' },
              seed: { type: 'integer' },
              values: { type: 'array', items: { type: 'number' } },
            },
            required: ['min', 'max', 'integer', 'count', 'values'],
          },
          render: (_args, value) => text(value.values.map(String).join('\n')),
        },
        execute: async (args) => generateNumbers(args),
      }),
      ctx.tools.register({
        name: 'random_string',
        description: 'Generate a random string of exactly `length` characters, drawn uniformly per character from a chosen alphabet — use for 随机字符串, passwords, API keys, IDs, verification codes. Build the alphabet either from named sets (union, deduplicated): digits, lower, upper, hex, symbols; or pass a literal `chars` string (any Unicode, overrides sets). Every character in the alphabet is equally likely.',
        parameters: {
          type: 'object',
          properties: {
            length: { type: 'integer', description: `String length, 1..${MAX_STRING_LENGTH}.` },
            sets: {
              type: 'array',
              description: 'Named character sets to combine. Default: ["lower","upper","digits"]. Ignored when chars is given.',
              items: { type: 'string', enum: Object.keys(CHARACTER_SETS) },
            },
            chars: { type: 'string', description: 'Literal alphabet (any Unicode characters, deduplicated). Overrides sets.' },
          },
          required: ['length'],
          additionalProperties: false,
        },
        output: {
          schema: {
            type: 'object',
            properties: {
              length: { type: 'integer' },
              charsetSize: { type: 'integer' },
              value: { type: 'string' },
            },
            required: ['length', 'charsetSize', 'value'],
          },
          render: (_args, value) => text(value.value),
        },
        execute: async (args) => generateString(args),
      }),
      ctx.tools.register({
        name: 'random_bytes',
        description: 'Generate `length` cryptographically secure random bytes, returned hex-encoded (default), base64 or base64url — use for nonces, tokens and key material (密钥/随机字节).',
        parameters: {
          type: 'object',
          properties: {
            length: { type: 'integer', description: `Byte count, 1..${MAX_BYTES}.` },
            encoding: { type: 'string', enum: ['hex', 'base64', 'base64url'], description: 'Output encoding. Default hex.' },
          },
          required: ['length'],
          additionalProperties: false,
        },
        output: {
          schema: {
            type: 'object',
            properties: {
              length: { type: 'integer' },
              encoding: { type: 'string' },
              value: { type: 'string' },
            },
            required: ['length', 'encoding', 'value'],
          },
          render: (_args, value) => text(value.value),
        },
        execute: async (args) => generateBytes(args),
      }),
      ctx.tools.register({
        name: 'random_uuid',
        description: 'Generate one RFC 9562 UUID v4 (cryptographically random, version and variant bits set correctly) — use for 随机 ID / 唯一标识.',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
        output: {
          schema: {
            type: 'object',
            properties: { value: { type: 'string' } },
            required: ['value'],
          },
          render: (_args, value) => text(value.value),
        },
        execute: async () => generateUuid(),
      }),
      ctx.tools.register({
        name: 'random_shuffle',
        description: 'Shuffle an array into an unbiased random order (Fisher-Yates, every permutation equally likely) and return a new array — use for 随机排序/抽签/乱序. Input array is not modified.',
        parameters: {
          type: 'object',
          properties: {
            items: { type: 'array', description: `Array to shuffle (JSON), at most ${MAX_SHUFFLE_ITEMS} entries.` },
          },
          required: ['items'],
          additionalProperties: false,
        },
        output: {
          schema: {
            type: 'object',
            properties: { items: { type: 'array' } },
            required: ['items'],
          },
          render: (_args, value) => renderJson(value.items),
        },
        execute: async (args) => generateShuffle(args),
      }),
      ctx.systemPrompt.section({
        name: 'plugin:dsh-plugin-random',
        order: 9500,
        text: [
          '## Random values',
          '',
          'When a task requires random or unpredictable values — a random number within a range, a random string/key/ID of N characters built from specific symbol sets, random bytes, a UUID, or a shuffled order — call the random_* tools (random_number, random_string, random_bytes, random_uuid, random_shuffle) instead of inventing values yourself. Invented values are biased, cannot be audited, and may violate the requested range or alphabet. The tools validate the range and alphabet for you: pass min/max/integer/length/sets, never pre-pick candidate values.',
        ].join('\n'),
      }),
    ]
    return () => {
      for (const dispose of disposers) dispose()
    }
  })
}
