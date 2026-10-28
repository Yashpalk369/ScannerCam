export interface ImportedImage {
  blob: Blob
  name: string
  preserveFrame: boolean
}
export async function* importFile(file: File): AsyncGenerator<ImportedImage> {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    if (file.size > 80 * 1024 * 1024)
      throw new Error(
        'Use a PDF smaller than 80 MB, or split it into smaller files first.',
      )
    const pdfjs = await import('pdfjs-dist')
    pdfjs.GlobalWorkerOptions.workerSrc = (
      await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
    ).default
    const task = pdfjs.getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
      cMapUrl: '/pdf-assets/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: '/pdf-assets/standard_fonts/',
      wasmUrl: '/pdf-assets/wasm/',
    })
    try {
      const pdf = await task.promise
      if (pdf.numPages > 100)
        throw new Error(
          'Import up to 100 PDF pages at once. Split this file into smaller batches first.',
        )
      for (let number = 1; number <= pdf.numPages; number++) {
        const page = await pdf.getPage(number)
        const initial = page.getViewport({ scale: 1 })
        const viewport = page.getViewport({
          scale: Math.min(2, 2400 / Math.max(initial.width, initial.height)),
        })
        const canvas = document.createElement('canvas')
        canvas.width = Math.ceil(viewport.width)
        canvas.height = Math.ceil(viewport.height)
        try {
          await page.render({ canvas, viewport, background: '#ffffff' }).promise
          const blob = await new Promise<Blob>((resolve, reject) =>
            canvas.toBlob(
              (blob) =>
                blob
                  ? resolve(blob)
                  : reject(new Error('Could not render PDF page.')),
              'image/png',
            ),
          )
          yield {
            blob,
            name: `${file.name.replace(/\.pdf$/i, '')} · ${number}`,
            preserveFrame: true,
          }
        } finally {
          canvas.width = canvas.height = 1
          page.cleanup()
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'PasswordException')
        throw new Error(
          'Password-protected PDFs are not supported. Unlock a copy before importing.',
        )
      throw error
    } finally {
      await task.destroy()
    }
    return
  }
  let blob: Blob = file
  if (/\.(heic|heif)$/i.test(file.name) || /image\/hei[cf]/.test(file.type)) {
    // Prefer the browser decoder on Safari before downloading a conversion library.
    let native = false
    try {
      const image = await createImageBitmap(file)
      image.close()
      native = true
    } catch {
      /* use local converter */
    }
    if (!native) {
      try {
        const { default: convert } = await import('heic2any')
        const result = await convert({
          blob: file,
          toType: 'image/jpeg',
          quality: 0.94,
        })
        blob = Array.isArray(result) ? result[0] : result
      } catch {
        throw new Error(
          'This HEIC photo could not be converted. Export it as JPG from Photos and try again.',
        )
      }
    }
  } else if (!file.type.startsWith('image/'))
    throw new Error('Choose PDF, HEIC, JPG, PNG, or WebP files.')
  yield { blob, name: file.name.replace(/\.[^.]+$/, ''), preserveFrame: false }
}
