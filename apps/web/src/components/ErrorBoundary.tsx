import { Component, ErrorInfo, ReactNode } from 'react'
import ErrorPage from '../pages/ErrorPage'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
  requestId: string
}

function newRequestId(): string {
  try {
    const c = globalThis.crypto as Crypto | undefined
    if (c && 'randomUUID' in c && typeof c.randomUUID === 'function') return c.randomUUID()
  } catch { /* fall through to fallback */ }
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null, requestId: '' }
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error, requestId: newRequestId() }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // WHY: structured log with request ID — never render raw stacks to users.
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', { requestId: this.state.requestId, error, errorInfo })
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, requestId: '' })
  }

  render() {
    if (this.state.hasError) {
      // Reuse the shared /error page so boundary + route stay identical.
      return (
        <ErrorPage
          requestId={this.state.requestId || undefined}
          onRetry={this.handleRetry}
        />
      )
    }

    return this.props.children
  }
}
