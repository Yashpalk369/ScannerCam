import React, { useState } from 'react'
import {
  ShieldCheck,
  Zap,
  Check,
  X,
  FileText,
  Camera,
  Crop,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Lock,
  Smartphone,
  Cpu,
} from 'lucide-react'

export const SeoArticle: React.FC = () => {
  const [openFaq, setOpenFaq] = useState<number | null>(null)

  const toggleFaq = (index: number) => {
    setOpenFaq(openFaq === index ? null : index)
  }

  const faqs = [
    {
      q: 'What is an online scanner and how does it work without cloud uploads?',
      a: 'An online scanner is a browser-based application that digitizes physical paper documents using your smartphone or webcam. Unlike cloud-dependent tools, Scanner.cam processes every pixel locally on your device via client-side Web Workers and HTML5 Canvas. Image de-skewing, perspective correction, and PDF compilation take place in your browser memory, ensuring your sensitive files are never transmitted to any external server.',
    },
    {
      q: 'Is Scanner.cam a free CamScanner alternative with no watermark?',
      a: 'Yes. Scanner.cam is a completely free, watermark-free web alternative to mobile CamScanner. There are no page limitations, no forced premium subscriptions, no account registrations, and no watermarks branded onto your exported PDFs or JPGs.',
    },
    {
      q: 'Can I use this online cam scanner on iPhone, iPad, and Android without installing an app?',
      a: 'Yes. Scanner.cam works seamlessly inside Safari on iOS/iPadOS and Chrome on Android. Simply visit the website, grant camera permissions, frame your paper document, and capture high-resolution scans directly from your mobile browser without visiting an app store.',
    },
    {
      q: 'How does the perspective correction and corner magnifier work?',
      a: 'When you photograph a document at an angle, it appears trapezoidal. Scanner.cam calculates an 8-parameter homography projective matrix to map the four corners of your document back into a perfect flat rectangle. During manual corner adjustments, an integrated 2.5x magnifier loupe displays a zoomed crosshair above your finger, providing sub-millimeter precision.',
    },
    {
      q: 'What document filters are available and which should I choose?',
      a: 'We offer five specialized filters: "Magic Color" (flattens background illumination and removes uneven shadows while keeping color photos vibrant), "Clean B/W" (uses local adaptive thresholding to convert documents into crisp, high-contrast monochrome text), "Enhance" (boosts contrast and ink saturation), "Grayscale", and "Original" raw capture.',
    },
  ]

  return (
    <article className="seo-article-container" itemScope itemType="https://schema.org/Article">
      {/* Article Header */}
      <header className="article-hero-header">
        <div className="article-badge">
          <ShieldCheck size={16} />
          <span>Complete Guide & Free Web Tool</span>
        </div>
        <h2 className="article-title" itemProp="headline">
          Online Scanner: The Complete Guide to Free, Private CamScanner in Your Browser
        </h2>
        <p className="article-subtitle">
          Learn how modern client-side computer vision lets you digitize documents, remove shadows,
          and export high-resolution PDFs directly in your web browser—with zero server uploads and no watermarks.
        </p>
      </header>

      {/* AEO / GEO BLUF Direct Answer Box */}
      <section className="article-section">
        <div className="aeo-answer-box" itemProp="description">
          <div className="aeo-answer-label">
            <Zap size={18} />
            <strong>Quick Answer (AEO Definition):</strong>
          </div>
          <p>
            An <strong>online scanner</strong> (also known as a <em>browser CamScanner</em>) is a
            client-side web utility that turns any phone camera or webcam into a high-precision document
            digitizer. By computing an 8-parameter homography matrix and applying adaptive binarization,
            it automatically straightens skewed angles, removes finger or phone shadows, and compiles
            multi-page PDF documents locally on your device without transmitting data over the internet.
          </p>
        </div>
      </section>

      {/* Why Use a Web Cam Scanner vs Native Mobile Apps */}
      <section className="article-section">
        <h3 className="section-heading">
          Why Choose a Client-Side Online Scanner over Traditional Mobile Apps?
        </h3>
        <p className="section-text">
          Traditional document scanning apps (such as native mobile CamScanner or Adobe Scan) revolutionized mobile
          productivity, but they frequently come with major trade-offs: intrusive subscriptions, watermarks
          on free exports, forced cloud account logins, and serious privacy risks when scanning confidential
          tax forms, contracts, and identity cards.
        </p>

        <div className="features-grid">
          <div className="feature-card">
            <div className="feature-icon text-brand">
              <Lock size={22} />
            </div>
            <h4>100% Client-Side Privacy</h4>
            <p>
              Your camera feed and captured images never leave your local device. All computer vision calculations
              execute in dedicated browser Web Workers.
            </p>
          </div>

          <div className="feature-card">
            <div className="feature-icon text-brand">
              <Smartphone size={22} />
            </div>
            <h4>No App Store Installation</h4>
            <p>
              Instant access on any desktop or mobile browser (iOS Safari, Android Chrome, Edge, Firefox).
              No downloads, storage consumption, or permissions tracking.
            </p>
          </div>

          <div className="feature-card">
            <div className="feature-icon text-brand">
              <Cpu size={22} />
            </div>
            <h4>Hardware-Accelerated Math</h4>
            <p>
              High-speed bilinear perspective warping and Sauvola local thresholding deliver crisp, flat,
              shadow-free scans comparable to dedicated flatbed hardware.
            </p>
          </div>
        </div>
      </section>

      {/* Structured Comparison Matrix (GEO & Perplexity Target) */}
      <section className="article-section">
        <h3 className="section-heading">
          Comparison Matrix: Scanner.cam vs. CamScanner Mobile vs. Adobe Scan
        </h3>
        <p className="section-text">
          Here is how Scanner.cam compares directly against conventional mobile scanning applications on key
          privacy, feature, and pricing metrics:
        </p>

        <div className="table-responsive">
          <table className="comparison-table">
            <thead>
              <tr>
                <th>Feature / Capability</th>
                <th className="highlight-col">Scanner.cam (Web)</th>
                <th>CamScanner (Mobile App)</th>
                <th>Adobe Scan</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>Cloud Upload Required?</strong></td>
                <td className="highlight-col success">
                  <Check size={16} /> <strong>No (100% Local)</strong>
                </td>
                <td className="danger">
                  <X size={16} /> Yes (Cloud Sync)
                </td>
                <td className="danger">
                  <X size={16} /> Yes (Adobe Cloud)
                </td>
              </tr>
              <tr>
                <td><strong>Free Tier Watermark?</strong></td>
                <td className="highlight-col success">
                  <Check size={16} /> <strong>None (Clean PDF)</strong>
                </td>
                <td className="danger">
                  <X size={16} /> Yes ("Scanned by...")
                </td>
                <td className="success">
                  <Check size={16} /> None
                </td>
              </tr>
              <tr>
                <td><strong>Account / Signup Needed?</strong></td>
                <td className="highlight-col success">
                  <Check size={16} /> <strong>Zero Signup</strong>
                </td>
                <td className="danger">
                  <X size={16} /> Mandatory / Prompted
                </td>
                <td className="danger">
                  <X size={16} /> Adobe ID Required
                </td>
              </tr>
              <tr>
                <td><strong>Perspective Rectification</strong></td>
                <td className="highlight-col success">
                  <Check size={16} /> <strong>8-Point Homography</strong>
                </td>
                <td className="success">
                  <Check size={16} /> Yes
                </td>
                <td className="success">
                  <Check size={16} /> Yes
                </td>
              </tr>
              <tr>
                <td><strong>Precision Loupe Magnifier</strong></td>
                <td className="highlight-col success">
                  <Check size={16} /> <strong>Yes (2.5x Crosshair)</strong>
                </td>
                <td className="success">
                  <Check size={16} /> Yes
                </td>
                <td className="danger">
                  <X size={16} /> No
                </td>
              </tr>
              <tr>
                <td><strong>Shadow-Free Adaptive Thresholding</strong></td>
                <td className="highlight-col success">
                  <Check size={16} /> <strong>Sauvola / Bradley B/W</strong>
                </td>
                <td className="success">
                  <Check size={16} /> Proprietary Magic
                </td>
                <td className="success">
                  <Check size={16} /> Clean Text Filter
                </td>
              </tr>
              <tr>
                <td><strong>Multi-Page PDF Compiler</strong></td>
                <td className="highlight-col success">
                  <Check size={16} /> <strong>Unlimited Free</strong>
                </td>
                <td className="warning">Limited on Free</td>
                <td className="success">Unlimited Free</td>
              </tr>
              <tr>
                <td><strong>Price</strong></td>
                <td className="highlight-col success">
                  <strong>100% Free Forever</strong>
                </td>
                <td>$4.99 - $9.99 / mo</td>
                <td>Freemium ($9.99/mo)</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Step-by-Step Guide: How to Scan Documents Online */}
      <section className="article-section">
        <h3 className="section-heading">How to Scan Documents Online in 4 Simple Steps</h3>
        <p className="section-text">
          Whether you are digitizing an invoice, a signed lease agreement, a medical receipt, or a book chapter,
          follow these steps to achieve studio-quality scans:
        </p>

        <div className="steps-container">
          <div className="step-card">
            <div className="step-badge">1</div>
            <div className="step-content">
              <h4>
                <Camera size={18} /> Capture or Upload
              </h4>
              <p>
                Click <strong>Scan Camera</strong> to open the full-screen camera viewfinder with live document
                framing lines, or drag-and-drop existing camera photos directly from your device.
              </p>
            </div>
          </div>

          <div className="step-card">
            <div className="step-badge">2</div>
            <div className="step-content">
              <h4>
                <Crop size={18} /> Align Corners with 2.5x Loupe
              </h4>
              <p>
                Click <strong>Edit Corners</strong>. Drag the four corner handles (Top-Left, Top-Right,
                Bottom-Right, Bottom-Left) to the paper edges. The floating 2.5x magnifying loupe ensures you
                place points with pixel-level precision.
              </p>
            </div>
          </div>

          <div className="step-card">
            <div className="step-badge">3</div>
            <div className="step-content">
              <h4>
                <Sparkles size={18} /> Select Magic Color or Clean B/W
              </h4>
              <p>
                Choose <strong>Magic Color</strong> to eliminate shadows from your hands or smartphone, or
                select <strong>Clean B/W</strong> to produce crisp, high-contrast black text on pure white paper.
              </p>
            </div>
          </div>

          <div className="step-card">
            <div className="step-badge">4</div>
            <div className="step-content">
              <h4>
                <FileText size={18} /> Export Multi-Page PDF
              </h4>
              <p>
                Review your page thumbnails in the sidebar. Reorder or rotate pages as needed, then click{' '}
                <strong>Export</strong> to download your multi-page PDF formatted in standard A4 or US Letter.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Deep Dive Computer Vision Technology */}
      <section className="article-section">
        <h3 className="section-heading">The Computer Vision Technology Behind Scanner.cam</h3>
        <p className="section-text">
          Achieving flatbed scanner quality from a smartphone photo requires solving complex mathematical challenges
          in real time:
        </p>

        <div className="tech-breakdown-box">
          <div className="tech-item">
            <h4>1. Projective Homography & Gaussian Elimination</h4>
            <p>
              When a camera views a document from an angle, parallel lines appear to converge. By mapping the four
              detected corners $(x_i, y_i)$ to an ideal rectangular output canvas $(u_i, v_i)$, Scanner.cam constructs
              an 8-equation linear system solved via Gaussian elimination with partial pivoting. Inverse bilinear
              sampling then warps the distorted quad into a flat, rectified document.
            </p>
          </div>

          <div className="tech-item">
            <h4>2. Sauvola Local Adaptive Thresholding</h4>
            <p>
              Traditional global binarization (such as standard Otsu's method) calculates a single threshold for
              the entire image, causing dark shadow zones to turn into opaque black blobs. Scanner.cam calculates a
              2D integral image to compute local means in $O(1)$ constant time across a moving window, dynamically
              adapting the threshold to preserve crisp text even under heavy phone shadows.
            </p>
          </div>

          <div className="tech-item">
            <h4>3. Illumination Surface Equalization (Magic Color)</h4>
            <p>
              Our Magic Color filter models the background light field by computing block luminance estimates.
              Dividing the local color channels by the estimated illumination field removes warm ambient casts,
              yellow desk tints, and gradients, yielding pure white margins with vivid ink colors.
            </p>
          </div>
        </div>
      </section>

      {/* Frequently Asked Questions (AEO & FAQPage) */}
      <section className="article-section">
        <h3 className="section-heading">Frequently Asked Questions (FAQ)</h3>
        <p className="section-text">
          Direct answers to common questions about using an online cam scanner:
        </p>

        <div className="faq-accordion">
          {faqs.map((faq, index) => {
            const isOpen = openFaq === index
            return (
              <div
                key={faq.q}
                className={`faq-item ${isOpen ? 'open' : ''}`}
                onClick={() => toggleFaq(index)}
              >
                <div className="faq-question">
                  <h4>{faq.q}</h4>
                  <span className="faq-toggle-icon">
                    {isOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                  </span>
                </div>
                {isOpen && (
                  <div className="faq-answer">
                    <p>{faq.a}</p>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>
    </article>
  )
}
