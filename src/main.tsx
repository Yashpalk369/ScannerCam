import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'

const container = document.getElementById('app')
if (!container) {
  throw new Error('Could not find #app root container in index.html')
}

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
