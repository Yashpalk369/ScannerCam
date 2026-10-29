# Scanner.cam tools

The scanner keeps `/` and its existing SEO identity. `/tools` lists available tools. Each tool has a canonical, extensionless route, a server-rendered fallback, matching visible FAQ content and structured data, and the shared header/footer. React replaces the initial fallback when JavaScript starts. With JavaScript enabled, the initial HTML shows a loading workspace instead of flashing the FAQ; the complete fallback remains available without JavaScript, and a failed load exposes it with an error.

## Adding a tool

1. Add its route, title, description, heading, introduction, instructions, FAQ, and workspace to `src/content/tools.json`.
2. Implement its workspace in `src/components/Tools` and add the workspace dispatch in `src/App.tsx`. Heavy engines should be lazy-loaded after the tool is chosen; file contents must remain local.
3. Add exact rewrites for its route and trailing-slash alias in `vercel.json`, and its canonical URL in `public/sitemap.xml`.
4. Extend the service-worker navigation denylist in `vite.config.ts` so it cannot receive the scanner homepage as a fallback. The registry automatically generates its own HTML and precache entry.
5. Run the build and relevant browser tests. Check initial HTML with JavaScript disabled, mobile widths, and production navigation after service-worker activation.

`scripts/tool-pages.mjs` renders metadata, WebPage/BreadcrumbList/FAQPage/WebApplication data, and the initial page. Vite serves that template during development and emits each page from the built scanner shell during production builds. Do not replace the homepage title or canonical to implement another tool.

## Current document features

- PDF import renders pages locally with PDF.js, retaining full page bounds. Pages can be combined with photos, reordered, removed, rotated, cropped, and exported. Imported PDFs lose their original text layers, links, forms, and digital signatures; keep the source. Password-protected PDFs are not accepted. Per-file limits: 80 MB and 100 PDF pages, rendered up to a 2,400 px long edge, processed sequentially. Large batches still depend on device memory.
- HEIC/HEIF import first attempts native decoding, then lazy local conversion with heic2any. Unsupported encodings produce JPG-export guidance. No conversion server is used.
- Target-size PDF export measures candidates at progressively lower image settings. An unmet target blocks the PDF download and reports the smallest result; it never silently downloads an oversized file. Size targets use decimal KB/MB for upload portals. OCR text bytes are included in the final target calculation. A first-page preview helps review quality; inspect all exported pages before submitting them.
- Export presets cover job applications (1 MB target), receipts (small), and printing (high quality). Settings remain editable after selection.
- OCR recognizes English, Spanish, French, German, Hindi, and Arabic locally, with pinned per-language downloads on first use. All six languages support UTF-8 text download. Searchable PDF currently supports English, Spanish, French, and German; Hindi and Arabic PDF text embedding is blocked with an explanation. Searchable PDFs place invisible words at the hOCR word bounds; recognition and positions can still be imperfect.
- Applied redactions replace covered image pixels and rebase the working source, so choosing Original or another filter cannot reveal covered content. Exports do not include the pre-redaction source. Undo history and original files remain on the device; users should clear saved scans on shared devices. Pixel coverage rounds outwards to avoid exposing fractional edge pixels.
- Curve correction is a manual vertical resampling tool with top and bottom bend controls and a preview. It helps gentle page curves; it is not automatic 3D book reconstruction. Corrections can be undone.

## Background remover

The existing same-origin U2-Net small model remains unchanged. Users choose or drop a photo and select Remove background; model loading happens automatically on first use. Original and transparent-result previews appear after selection. Processing status is user-facing; engine diagnostics stay in the console. Results preserve existing source alpha and export as PNG. Photo limits are 40 MB and 20 megapixels. Review fine edges before use.

Runtime assets for ONNX and PDF.js are served locally in development and copied from the locked packages at build time. Large HEIC/PDF decoders are cached after use rather than fetched during the initial scanner visit. New tool pages retain their identity on offline reload after caching; processing files may still need a first online download.

Session saves use a revision checked atomically in IndexedDB. If another tab has saved a newer session, the stale tab retains its local pages for export and displays a warning instead of overwriting the shared session. If an older tab blocks the database upgrade, the new tab becomes usable in memory and explains how to recover the saved session.
