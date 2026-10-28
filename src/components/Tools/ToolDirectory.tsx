import tools from '../../content/tools.json'
export function ToolDirectory() {
  return (
    <div className="tool-grid">
      {[
        {
          path: '/',
          heading: 'Document scanner',
          intro:
            'Scan, straighten, enhance, and export document photos as PDFs.',
        },
        ...tools.filter((t) => t.path !== '/tools'),
      ].map((tool) => (
        <a className="tool-card" href={tool.path} key={tool.path}>
          <h2>{tool.heading}</h2>
          <p>{tool.intro}</p>
          <span>Open tool →</span>
        </a>
      ))}
    </div>
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
