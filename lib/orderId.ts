/**
 * lib/orderId.ts — Human-readable order ID generator ("bravel-somikt")
 */

const CONSONANTS = "bcdfghjklmnprstvz"
const VOWELS = "aeiou"

function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1))
}

function generateWord(minLen: number, maxLen: number): string {
  const len = randomInt(minLen, maxLen)
  let word = ""
  let useConsonant = Math.random() < 0.5
  while (word.length < len) {
    const pool = useConsonant ? CONSONANTS : VOWELS
    word += pool[Math.floor(Math.random() * pool.length)]
    useConsonant = !useConsonant
  }
  return word
}

export function generateOrderId(): string {
  return `${generateWord(4, 6)}-${generateWord(5, 7)}`
}
