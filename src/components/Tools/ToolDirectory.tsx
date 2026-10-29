import { Eraser, FileText, Minimize2, ScanText, ShieldCheck, BookOpen, Wrench } from 'lucide-react'
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
      ].map((tool) => (
        <a className="tool-card" href={tool.path} key={tool.path}>
          <h2>{tool.heading}</h2>
          <p>{tool.description}</p>
          <span>Open tool →</span>
        </a>
      ))}
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
    <section className="homepage-tools" aria-labelledby="homepage-tools-heading">
      <div className="homepage-tools-heading">
        <div><h2 id="homepage-tools-heading">More free tools</h2><p>Simple tools for your documents and images, right in your browser.</p></div>
        <a href="/tools">View all tools →</a>
      </div>
      <div className="homepage-tool-grid">
        {availableTools.map((tool) => {
          const Icon = toolIcons[tool.path] ?? Wrench
          return <a className="homepage-tool-card" href={tool.path} key={tool.path}>
            <span className="homepage-tool-icon"><Icon size={22} aria-hidden="true" /></span>
            <span className="homepage-tool-copy"><strong>{tool.heading}</strong><span>{tool.description}</span></span>
            <span className="homepage-tool-arrow" aria-hidden="true">→</span>
          </a>
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
      <h2>How it works</h2>
      <ol>
        {tool.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <h2>Frequently asked questions</h2>
      {tool.faqs.map(({ q, a }) => (
        <details key={q}>
          <summary>{q}</summary>
          <p>{a}</p>
        </details>
      ))}
      <p>
        <a href="/tools">Explore all free tools →</a>
      </p>
    </section>
  )
}
