// Offline self-check for dsh-plugin-random. Run: node test.mjs
import assert from 'node:assert/strict'
import {
  generateNumbers,
  generateString,
  generateBytes,
  generateUuid,
  generateShuffle,
  mulberry32,
} from './index.js'

const throws = (fn, pattern) => {
  let caught
  try { fn() } catch (error) { caught = error }
  assert.ok(caught instanceof Error, `expected throw: ${pattern}`)
  assert.match(caught.message, pattern)
}

// ── chi-square helper (loose guard against modulo-bias regressions) ──
function chiSquare(counts, expected) {
  return counts.reduce((sum, observed) => sum + (observed - expected) ** 2 / expected, 0)
}

// 1. integer containment + uniformity over a non-power-of-two range (dice)
{
  const n = 6000
  const { values } = generateNumbers({ min: 1, max: 6, integer: true, count: n })
  assert.equal(values.length, n)
  for (const v of values) assert.ok(Number.isInteger(v) && v >= 1 && v <= 6, `out of range: ${v}`)
  const counts = Array(6).fill(0)
  for (const v of values) counts[v - 1]++
  const chi2 = chiSquare(counts, n / 6)
  assert.ok(chi2 < 60, `dice look biased, chi2=${chi2.toFixed(1)} (df=5)`)
}

// 2. range other than [1,6], negative bounds, batch size
{
  const { values } = generateNumbers({ min: -50, max: -5, integer: true, count: 500 })
  for (const v of values) assert.ok(v >= -50 && v <= -5)
}

// 3. float containment + spread across [0, 1)
{
  const n = 10000
  const { values } = generateNumbers({ min: 0, max: 1, integer: false, count: n })
  for (const v of values) assert.ok(v >= 0 && v < 1, `float out of range: ${v}`)
  const bins = Array(10).fill(0)
  for (const v of values) bins[Math.min(9, Math.floor(v * 10))]++
  const chi2 = chiSquare(bins, n / 10)
  assert.ok(chi2 < 80, `floats look biased, chi2=${chi2.toFixed(1)} (df=9)`)
  assert.ok(new Set(values.map(String)).size > n * 0.99, 'floats repeat suspiciously often')
}

// 4. error paths
throws(() => generateNumbers({ min: 10, max: 1 }), /min .*<= max/)
throws(() => generateNumbers({ min: 1, max: 6, count: 0 }), /count/)
throws(() => generateNumbers({ min: 1.5, max: 6, integer: true }), /safe integer/)
throws(() => generateNumbers({ min: 0, max: 1, seed: -1 }), /seed/)

// 5. seed reproducibility + difference
{
  const a = generateNumbers({ min: 1, max: 100, integer: true, count: 8, seed: 42 })
  const b = generateNumbers({ min: 1, max: 100, integer: true, count: 8, seed: 42 })
  const c = generateNumbers({ min: 1, max: 100, integer: true, count: 8, seed: 43 })
  assert.deepEqual(a.values, b.values)
  assert.notDeepEqual(a.values, c.values)
  const d = generateNumbers({ min: 0, max: 1, integer: false, count: 4, seed: 7 })
  assert.deepEqual(d.values, generateNumbers({ min: 0, max: 1, integer: false, count: 4, seed: 7 }).values)
}

// 6. mulberry32 in [0,1)
{
  const next = mulberry32(1)
  for (let i = 0; i < 1000; i++) {
    const v = next()
    assert.ok(v >= 0 && v < 1)
  }
}

// 7. random_string: length, membership, set union/dedupe, custom chars, unicode
{
  const s = generateString({ length: 200, sets: ['digits'] })
  assert.equal(s.value.length, 200)
  assert.match(s.value, /^[0-9]+$/)
  assert.equal(s.charsetSize, 10)

  const mixed = generateString({ length: 500, sets: ['lower', 'digits'] })
  assert.match(mixed.value, /^[a-z0-9]+$/)
  const lowerCount = [...mixed.value].filter((ch) => /[a-z]/.test(ch)).length
  assert.ok(lowerCount > 250 && lowerCount < 400, `expected letter dominance, got ${lowerCount}/500`)

  const deduped = generateString({ length: 8, sets: ['digits', 'hex'] })
  assert.equal(deduped.charsetSize, 16, 'digits+hex union should dedupe to 16')

  const custom = generateString({ length: 50, chars: 'ab' })
  assert.match(custom.value, /^[ab]+$/)

  const unicode = generateString({ length: 20, chars: '骰子🎲' })
  assert.equal([...unicode.value].length, 20)
  assert.match(unicode.value, /^[骰子🎲]+$/u)

  throws(() => generateString({ length: 5, sets: ['nope'] }), /unknown set/)
  throws(() => generateString({ length: 0 }), /length/)
}

// 8. random_bytes: sizes and encodings
{
  const hex = generateBytes({ length: 16 })
  assert.match(hex.value, /^[0-9a-f]{32}$/)
  const b64 = generateBytes({ length: 12, encoding: 'base64' })
  assert.equal(Buffer.from(b64.value, 'base64').length, 12)
  const b64url = generateBytes({ length: 12, encoding: 'base64url' })
  assert.match(b64url.value, /^[A-Za-z0-9\-_]+$/)
  throws(() => generateBytes({ length: 5, encoding: 'bogus' }), /encoding/)
}

// 9. uuid shape + distinctness
{
  const seen = new Set()
  for (let i = 0; i < 200; i++) {
    const { value } = generateUuid()
    assert.match(value, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    seen.add(value)
  }
  assert.equal(seen.size, 200)
}

// 10. shuffle: permutation integrity, input untouched, duplicates survive
{
  const input = [1, 'a', 1, { k: 2 }, null]
  const snapshot = JSON.stringify(input)
  const { items } = generateShuffle({ items: input })
  assert.equal(JSON.stringify(input), snapshot, 'input must not be modified')
  assert.equal(items.length, input.length)
  assert.deepEqual([...items].sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y))),
    [...input].sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y))))
  throws(() => generateShuffle({ items: 'nope' }), /array/)
}

// 11. batch determinism of count vs values length
{
  const single = generateNumbers({ min: 1, max: 1000, integer: true, count: 1 })
  assert.equal(single.values.length, 1)
  assert.equal(single.count, 1)
}

console.log('ok: all dsh-plugin-random checks passed')
