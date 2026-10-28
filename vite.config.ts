import { readFileSync, writeFileSync, existsSync, cpSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToolHtml, tools } from './scripts/tool-pages.mjs'
import { defineConfig, type Plugin, type Connect } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import deployment from './vercel.json' with { type: 'json' }

// Copy the onnxruntime-web WASM backend files into dist/ort-wasm/ at build
// time (version-synced with node_modules; nothing large is committed to the
// repo). The loader fetches exactly ort-wasm-simd-threaded.mjs +
// ort-wasm-simd-threaded.wasm — verified with a request-logging probe
// against the standalone prototype in a plain Chromium.
function copyOrtWasm(): Plugin {
  let root = ''
  return {
    name: 'copy-ort-wasm',
    configureServer(server) {
      server.middlewares.use('/pdf-assets', (request, response, next) => {
        const path = resolve(
          'node_modules/pdfjs-dist',
          '.' + (request.url ?? '').split('?')[0],
        )
        if (
          !['cmaps', 'standard_fonts', 'wasm'].some((directory) =>
            path.startsWith(
              resolve('node_modules/pdfjs-dist', directory) + '/',
            ),
          ) ||
          !existsSync(path)
        )
          return next()
        response.setHeader(
          'Content-Type',
          path.endsWith('.wasm')
            ? 'application/wasm'
            : 'application/octet-stream',
        )
        response.end(readFileSync(path))
      })
      server.middlewares.use('/ort-wasm', (request, response, next) => {
        const file = (request.url ?? '').split('?')[0].replace(/^\//, '')
        if (
          ![
            'ort-wasm-simd-threaded.mjs',
            'ort-wasm-simd-threaded.wasm',
          ].includes(file)
        )
          return next()
        response.setHeader(
          'Content-Type',
          file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript',
        )
        response.end(
          readFileSync(resolve('node_modules/onnxruntime-web/dist', file)),
        )
      })
    },
    configResolved(config) {
      root = config.root
    },
    async writeBundle(options) {
      const { copyFileSync, mkdirSync } = await import('node:fs')
      const { resolve } = await import('node:path')
      const outDir = options.dir ?? 'dist'
      const dest = resolve(outDir, 'ort-wasm')
      mkdirSync(dest, { recursive: true })
      for (const directory of ['cmaps', 'standard_fonts', 'wasm'])
        cpSync(
          resolve(root, 'node_modules/pdfjs-dist', directory),
          resolve(outDir, 'pdf-assets', directory),
          { recursive: true },
        )
      const srcDir = resolve(root, 'node_modules/onnxruntime-web/dist')
      for (const file of [
        'ort-wasm-simd-threaded.mjs',
        'ort-wasm-simd-threaded.wasm',
      ]) {
        copyFileSync(resolve(srcDir, file), resolve(dest, file))
      }
    },
  }
}

// Serve the same extensionless public pages locally as the Vercel deployment.
function publicPageRoutes(): Plugin {
  const routes = deployment.rewrites.map((route) => ({
    pattern: new RegExp(`^${route.source.replace(':slug', '([^/.]+)')}$`),
    destination: route.destination,
  }))
  const middleware: Connect.NextHandleFunction = (request, _response, next) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    for (const route of routes) {
      const match = url.pathname.match(route.pattern)
      if (!match) continue
      request.url =
        route.destination.replace(':slug', match[1] ?? '') + url.search
      break
    }
    next()
  }
  return {
    name: 'public-page-routes',
    configureServer(server) {
      server.middlewares.use(middleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  // Resolve onnxruntime-web to its "extern wasm" build, so the WASM backend
  // files come only from wasmPaths (dist/ort-wasm/, copied at build time)
  // instead of Vite emitting a second hashed copy of the .wasm binary.
  // This matches the tested prototype, which used ort.wasm.min.mjs and
  // fetched exactly the plain simd-threaded pair.
  resolve: {
    conditions: ['onnxruntime-web-use-extern-wasm'],
  },
  plugins: [
    {
      name: 'tool-pages',
      configureServer(server) {
        server.middlewares.use(async (request, response, next) => {
          const path = new URL(
            request.url ?? '/',
            'http://localhost',
          ).pathname.replace(/\/$/, '')
          const tool = tools.find((t) => t.path === path)
          if (!tool) return next()
          try {
            const html = renderToolHtml(
              readFileSync(resolve('index.html'), 'utf8'),
              tool,
            )
            response.setHeader('Content-Type', 'text/html; charset=utf-8')
            response.end(await server.transformIndexHtml(path, html))
          } catch (error) {
            next(error as Error)
          }
        })
      },
      writeBundle(options) {
        const directory = options.dir ?? 'dist'
        const html = readFileSync(resolve(directory, 'index.html'), 'utf8')
        for (const tool of tools)
          writeFileSync(
            resolve(directory, tool.path.slice(1) + '.html'),
            renderToolHtml(html, tool),
          )
      },
    },
    copyOrtWasm(),
    publicPageRoutes(),
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon.svg', 'robots.txt', 'sitemap.xml'],
      manifest: {
        name: 'Scanner.cam — Free Online Document Scanner',
        short_name: 'Scanner.cam',
        description:
          'Free online document scanner and CamScanner alternative. Scan, crop, enhance, and export multi-page PDFs — 100% in your browser, no uploads, no watermarks.',
        theme_color: '#059669',
        background_color: '#f8fafc',
        display: 'standalone',
        orientation: 'any',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: 'icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any maskable',
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
        categories: ['productivity', 'utilities'],
        screenshots: [],
      },
      workbox: {
        // Cache all app shell assets
        additionalManifestEntries: tools.map((t) => ({
          url: t.path,
          revision: new Date().toISOString(),
        })),
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        globIgnores: [
          'assets/heic2any-*.js',
          'assets/pdf-*.js',
          'pdf-assets/**',
        ],
        // Keep document and tool pages from falling back to the scanner shell.
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [
          /^\/(?:tools|remove-background|pdf-editor|compress-pdf|image-to-text|redact-pdf|flatten-page)(?:\/|\.html|$)/,
          /\/api\//,
          /^\/blog(?:\/|$)/,
          /^\/(?:about|privacy|terms|contact)(?:\/|\.html|$)/,
        ],
        runtimeCaching: [
          {
            urlPattern:
              /\/(?:pdf-assets\/|assets\/(?:heic2any-|pdf-|pdf\.worker))/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'document-decoders-v1',
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 90 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // Google Fonts
            urlPattern: /^https:\/\/fonts\.(?:googleapis|gstatic)\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Tesseract.js CDN (lazy OCR — cache after first use)
            urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/npm\/tesseract/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'tesseract-cache',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Background remover WASM backend (same-origin, lazy — cache after first use)
            urlPattern: /\/ort-wasm\/[^/]+$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'remover-wasm-cache',
              expiration: { maxEntries: 5, maxAgeSeconds: 60 * 60 * 24 * 90 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Background remover model (same-origin, lazy — cache after first use)
            urlPattern: /\/models\/[^/]+\.onnx$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'remover-model-cache',
              expiration: { maxEntries: 5, maxAgeSeconds: 60 * 60 * 24 * 90 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Tesseract language data
            urlPattern:
              /^https:\/\/cdn\.jsdelivr\.net\/npm\/@tesseract\.js-data\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'tessdata-cache',
              expiration: { maxEntries: 5, maxAgeSeconds: 60 * 60 * 24 * 90 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  worker: {
    format: 'es',
  },
})
