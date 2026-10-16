# Scanner.cam audit

Baseline: commit `9d9aa59`. The review covers the local production build and source; it does not establish the deployed site's current status or search rankings.

## Confirmed bugs fixed

| Area | Trigger and previous behavior | Fix |
| --- | --- | --- |
| OCR initialization | Tesseract's ESM package exports a default object, but the worker imported a named `createWorker`. Recognition failed before it started. | Import the actual default API; pin runtime, core, and English model assets. Verified recognition of `SCANNER CAM TEST 12345` using the real engine. |
| OCR failures | A worker crash only logged an error and left the export promise pending. Failed initialization was cached indefinitely. | Reject pending work, reset failed workers, clear failed initialization, and time out stuck recognition. |
| Export cancellation | Escape closed the export dialog while recognition continued; a file could download later. | Abort work on close, terminate OCR, check cancellation before downloading, and offer an explicit cancel control. |
| Searchable export | Recognition errors were swallowed and an image-only PDF was reported as a successful searchable export. | Keep the dialog open with an actionable error and retry or OCR-off options. Blank pages may still legitimately produce no text. |
| PDF rendering | The purported invisible text layer actually painted white text over document images. | Use PDF invisible text rendering mode; regression checks inspect the decoded PDF content stream. |
| Batch imports | One corrupt image aborted the batch, discarding earlier successfully processed images and skipping later valid ones. | Process failures individually, retain valid images, and show a failure count. |
| Cropped-page rotation | Rotating a cropped page reset its corners to the full raw image and reintroduced the background. | Rotate the existing crop boundary along with the source. |
| Session recovery | Restored scans were added as an undoable action, allowing Undo immediately after reload to remove the restored session. | Restore a fresh history baseline and wait for recovery before accepting uploads. |
| Crop navigation | Switching active pages could carry the previous page's editable corners into the new page. | Exit crop mode on page changes; global page-navigation shortcuts leave crop editing alone. |
| Keyboard controls | `Ctrl/Cmd+Shift+Z` missed uppercase `Z`; browser modifier shortcuts could trigger scanner actions. | Normalize shortcut keys, respect handled events and editable fields, and preserve unrelated modifier shortcuts. |
| Unsupported uploads | Unsupported dropped files could fail silently. | Show supported-image guidance and explain that PDF import is not supported. |
| Transparent images | JPEG encoding of transparent PNGs produced black backgrounds. | Composite onto white before JPEG encoding and rotation. |
| Preview memory | Undo/redo and discarded restoration results retained unused preview object URLs. | Release replaced or discarded URLs while retaining immutable image blobs for history. |
| Accessibility | Low-contrast labels, duplicate footer landmarks, skipped headings, indistinguishable breadcrumb links, an unfocusable scrolling table, and operable background controls behind modals. | Improve contrast and semantics, label navigation regions, underline breadcrumbs, make the table keyboard-focusable, and make background content inert while a dialog is open. |
| Dependencies | Initial npm audit reported 9 affected packages: 4 high and 5 moderate. | Update compatible locked dependency versions. Final npm audit reports zero known vulnerabilities. This is a dependency advisory check, not a penetration test. |

## SEO, AEO, and GEO corrections completed

Guide and company-page article bodies, page titles, descriptions, canonical links, robots directives, and sitemap entries remain unchanged. The authorized homepage corrections resolve the audit's content inconsistencies:

1. **Correct OCR availability.** The homepage now explains how to enable Searchable PDF in Advanced options, local English recognition, the initial recognition-file download, and approximate text selection positions. The export dialog also describes first-use requirements.
2. **One FAQ source.** `src/content/homepage.json` supplies the React accordion, initial HTML fallback, and FAQPage JSON-LD. All three expose the same twelve questions and answers, including the existing topics and related-guide links. Build-time synchronization prevents future drift. Closed accordion panels remain in the document with `hidden`, maintaining valid accessible controls and available answer text.
3. **Accurate capacity limits.** Answers distinguish the lack of an imposed account/page quota from device memory and browser-storage limits. They advise smaller batches and appropriate PDF quality settings.
4. **Consistent primary heading.** The scanner's visible H1 and initial HTML use the same existing keyword-focused heading; the shared brand wordmark retains its appearance without creating another H1. The initial HTML FAQ anchor also works when JavaScript is unavailable.

Technical checks passed: all 17 sitemap pages load; internal links and fragment targets resolve; canonical URLs match their intended pages; JSON-LD parses; image assets load; robots.txt advertises the sitemap. Static guides remain available as HTML. Local production navigation also resolves correctly after the service worker activates.

These checks do not measure Google indexing, Search Console coverage, real-user Core Web Vitals, or inclusion/citations in AI answers. Those require production access and relevant external measurements.

## Validation

- `npm test`: 25 unit tests.
- `npm run test:browser`: 40 browser tests, including fourteen reliability regressions, two homepage/FAQ checks, and two checks for cross-page branding and navigation consistency.
- `npm run build`: TypeScript checking and production build.
- Axe-core scan with WCAG 2 A/AA, WCAG 2.1 AA, and best-practice rules: no detected violations on all 17 pages, the loaded editor, or export dialog at a mobile viewport. Automated checks do not replace manual assistive-technology testing.
- Site browser tests cover 320, 390, 768, and 1440 px widths, internal links, fragments, images, and footer consistency.
- Actual Tesseract recognition checked against a generated document. Public OCR engine/model assets were fetched through the environment's permitted proxy and supplied to the browser; document pixels remained local. Error/cancellation regressions use controlled worker failures.
- Source comparison verifies unchanged guide/company article bodies and page metadata. Homepage FAQ content and FAQ structured data are synchronized from the authorized shared source; other structured-data entities remain intact.
- Dependency audit: 0 known vulnerabilities after compatible lockfile updates.

## Practical verification limits

The browser suite runs Chromium with simulated camera streams and synthetic documents. Physical phone cameras, iOS Safari, manual screen-reader use, large real-world batches, actual device storage exhaustion, OCR accuracy across varied documents, and live Vercel/search-engine behavior were not exhaustively verified. No audit can establish that every possible bug has been eliminated.

## Shared UI follow-up

The scanner previously rendered its own React header and footer while static pages maintained different layouts, fonts, wordmarks, and mobile navigation. Both now use `site-header.html`, `site-footer.html`, and `public/site-shell.css`. `npm run sync:layout` renders these templates into public HTML; it runs automatically before development and production builds. The React tool imports the same trusted templates directly. Scanner actions remain in their own tool-specific toolbar.

Branding browser tests compare computed logo sizes, typography, colors, header dimensions, navigation, and footer layout across all 17 pages at 390, 1440, and 1920 px. They also navigate from the scanner to a guide, article, company page, and back. Mobile guide and FAQ navigation remain visible.

## Storage failure handling

Unavailable recovery and failed saves now display persistent warnings while in-memory scans remain exportable. Failed initial recovery disables persistence for that session, preventing new scans from overwriting an unread saved session. Failed database opens can retry on subsequent requests. Confirmed clearing also removes undo history so cleared scans cannot be restored by a shortcut. Clearing saved scans must succeed before current pages are removed; failures retain the pages and explain how to retry. Browser regressions exercise unavailable storage, failed write transactions, and failed clearing.

## Release integration

Merged the newer main-branch SEO commits, preserving both new contract/whiteboard guides, their images, the updated sitemap, and corrected FAQ schemas on existing guides. Build-time shell normalization also repairs legacy generated markup and reapplies accessibility styling, branding, and the supplied support email, so regenerated pages retain the shared UI. Final coverage includes 17 sitemap pages.

## Empty-screen control cleanup

Removed the redundant Scanner navigation item. The Open Scanner header CTA appears only away from the tool. The scanner toolbar stays hidden until a page is present, leaving the central Scan Document and Upload Images controls as the starting actions. Regression checks verify toolbar visibility and that camera, upload, and export actions remain available after adding a page.
