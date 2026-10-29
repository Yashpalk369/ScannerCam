/** Identify the supported still-image formats and reject APNG before decoding. */
export function inspectImageForMetadataRemoval(bytes: Uint8Array): 'jpeg' | 'png' {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg'
  const png = [137, 80, 78, 71, 13, 10, 26, 10]
  if (!png.every((value, index) => bytes[index] === value)) throw new Error('Choose a JPEG or PNG image.')
  let offset = 8
  while (offset + 12 <= bytes.length) {
    const length = ((bytes[offset] * 0x1000000) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]) >>> 0
    if (offset + length + 12 > bytes.length) throw new Error('This PNG appears incomplete or damaged.')
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8))
    if (type === 'acTL') throw new Error('Animated PNG images are not supported. Choose a still image.')
    if (type === 'IEND') return 'png'
    offset += 12 + length
  }
  throw new Error('This PNG appears incomplete or damaged.')
}
