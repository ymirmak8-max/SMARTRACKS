import { Component } from 'react';

/**
 * Catches render crashes in a tab so one broken view can't blank the
 * whole dashboard — and surfaces the actual error message on screen
 * instead of leaving an empty page.
 */
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error(`[ErrorBoundary:${this.props.tabName || 'view'}]`, error, info);
  }

  handleRetry = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const message = error?.message || 'Something went wrong loading this view.';
    return (
      <div className="card" role="alert" style={{ padding: '2rem 1.5rem', textAlign: 'center' }}>
        <div className="card-title">This view could not be loaded</div>
        <p style={{ color: 'var(--text-2)', fontSize: '0.84rem', margin: '0.5rem 0 1rem', overflowWrap: 'anywhere' }}>
          {message}
        </p>
        <button type="button" className="action-btn action-btn-primary" onClick={this.handleRetry}>
          Try again
        </button>
      </div>
    );
  }
}

export default ErrorBoundary;
