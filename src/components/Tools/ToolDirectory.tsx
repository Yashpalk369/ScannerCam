import {
  Eraser,
  FileText,
  Minimize2,
  ScanText,
  ShieldCheck,
  BookOpen,
  Wrench,
  ScanLine,
} from 'lucide-react'
import tools from '../../content/tools.json'
export function ToolDirectory() {
  return (
    <div className="tool-grid">
      {[
        {
          path: '/',
          heading: 'Document scanner',
          description:
            'Scan, straighten, enhance, and export document photos as PDFs.',
        },
        ...tools.filter((t) => t.path !== '/tools'),
      ].map((tool) => {
        const Icon =
          tool.path === '/' ? ScanLine : (toolIcons[tool.path] ?? Wrench)
        return (
          <a className="tool-card" href={tool.path} key={tool.path}>
            <span className="tool-card-icon" aria-hidden="true">
              <Icon size={22} />
            </span>
            <h2>{tool.heading}</h2>
            <p>{tool.description}</p>
            <span>Open tool →</span>
          </a>
        )
      })}
    </div>
  )
}

const toolIcons: Record<string, typeof Wrench> = {
  '/remove-background': Eraser,
  '/pdf-editor': FileText,
  '/compress-pdf': Minimize2,
  '/image-to-text': ScanText,
  '/redact-pdf': ShieldCheck,
  '/flatten-page': BookOpen,
}

export function HomepageTools() {
  const availableTools = tools.filter((tool) => tool.path !== '/tools')
  return (
    <section
      className="homepage-tools"
      aria-labelledby="homepage-tools-heading"
    >
      <div className="homepage-tools-heading">
        <div>
          <h2 id="homepage-tools-heading">More free tools</h2>
          <p>
            Simple tools for your documents and images, right in your browser.
          </p>
        </div>
        <a href="/tools">View all tools →</a>
      </div>
      <div className="homepage-tool-grid">
        {availableTools.map((tool) => {
          const Icon = toolIcons[tool.path] ?? Wrench
          return (
            <a className="homepage-tool-card" href={tool.path} key={tool.path}>
              <span className="homepage-tool-icon">
                <Icon size={22} aria-hidden="true" />
              </span>
              <span className="homepage-tool-copy">
                <strong>{tool.heading}</strong>
                <span>{tool.description}</span>
              </span>
              <span className="homepage-tool-arrow" aria-hidden="true">
                →
              </span>
            </a>
          )
        })}
      </div>
    </section>
  )
}
export function ToolContent({ path }: { path: string }) {
  const tool = tools.find((t) => t.path === path)
  if (!tool) return null
  return (
    <section
      className="tool-explainer"
      aria-label={`${tool.heading}: instructions and questions`}
    >
      <div className="tool-answer">
        <h2>Quick answer</h2>
        <p>{tool.answer}</p>
      </div>
      <h2>How to use {tool.path === '/tools' ? 'these tools' : 'this tool'}</h2>
      <ol className="tool-steps">
        {tool.steps.map((step, index) => (
          <li key={step}>
            <span aria-hidden="true">{index + 1}</span>
            <p>{step}</p>
          </li>
        ))}
      </ol>
      {tool.sections.map((section) => (
        <div className="tool-content-section" key={section.heading}>
          <h2>{section.heading}</h2>
          {section.paragraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
      ))}
      <h2>Frequently asked questions</h2>
      {tool.faqs.map(({ q, a }) => (
        <details key={q}>
          <summary>{q}</summary>
          <p>{a}</p>
        </details>
      ))}
      <nav className="tool-related" aria-label="Related resources">
        <h2>Related resources</h2>
        {tool.related.map((link) => (
          <a key={link.href} href={link.href}>
            {link.label} <span aria-hidden="true">→</span>
          </a>
        ))}
      </nav>
      {path !== '/tools' && (
        <p>
          <a href="/tools">Explore all free tools →</a>
        </p>
      )}
    </section>
  )
}
