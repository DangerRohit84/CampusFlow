import { Component, ErrorInfo, Fragment, ReactNode } from 'react'
import ErrorPage from '../pages/ErrorPage'
import { queryClient } from '../lib/queryClient'
import { logger } from '../lib/logger'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
  requestId: string
  // WHY retry loop: clearing hasError alone re-rendered the same throwing
  // child, which re-threw synchronously with only a new requestId (user saw
  // "Try again changes ID, same error"). resetKey forces a real remount via
  // Fragment key; retryCount gates the hard-reload escape hatch.
  resetKey: number
  retryCount: number
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
    this.state = { hasError: false, error: null, requestId: '', resetKey: 0, retryCount: 0 }
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    // WHY stable per error instance: ID generated once here (never per render),
    // so support can correlate one ID ↔ one caught error + component stack.
    return { hasError: true, error, requestId: newRequestId() }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // WHY: structured log with request ID — never render raw stacks to users.
    try {
      logger.error('[ErrorBoundary] render failure', {
        requestId: this.state.requestId,
        error,
        componentStack: errorInfo?.componentStack?.slice(0, 2000),
      })
    } catch { /* logger never throws */ }
  }

  handleRetry = () => {
    // WHY true reset (not just flag clear): drop the bad query error cache so
    // a poisoned query cannot re-throw, then remount children via resetKey.
    try {
      queryClient.resetQueries()
    } catch { /* retry must never throw */ }
    this.setState((s) => ({
      hasError: false,
      error: null,
      requestId: '',
      resetKey: s.resetKey + 1,
      retryCount: s.retryCount + 1,
    }))
  }

  handleHome = () => {
    // WHY top-level trap: this boundary wraps <Routes>, so <Link to="/"> alone
    // changed the URL while hasError still rendered ErrorPage. Clearing here
    // lets the home route actually paint.
    this.setState((s) => ({
      hasError: false,
      error: null,
      requestId: '',
      resetKey: s.resetKey + 1,
      retryCount: 0,
    }))
  }

  needsHardReload = (): boolean => this.state.retryCount >= 2

  handleHardReload = () => {
    try {
      window.location.reload()
    } catch { /* noop */ }
  }

  render() {
    if (this.state.hasError) {
      // Reuse the shared /error page so boundary + route stay identical.
      return (
        <ErrorPage
          requestId={this.state.requestId || undefined}
          onRetry={this.handleRetry}
          onHome={this.handleHome}
          retryCount={this.state.retryCount}
          onHardReload={this.handleHardReload}
        />
      )
    }

    return <Fragment key={this.state.resetKey}>{this.props.children}</Fragment>
  }
}
