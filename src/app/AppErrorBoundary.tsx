import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useTableStore } from '../features/table/store';
import { useTrainingStore } from '../features/practice/store';
import { useGeneratedStore } from '../features/practice/generated-store';

export class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('FeltLab rendering failed', error, info.componentStack);
  }
  recover = () => {
    useTrainingStore.getState().endSession();
    useGeneratedStore.getState().closeSession();
    useTableStore.getState().pause();
    window.location.hash = 'practice';
    this.setState({ failed: false });
  };
  render() {
    return this.state.failed ? (
      <main className="recovery-page">
        <span className="eyebrow">FELTLAB</span>
        <h1>Let’s find a fresh seat.</h1>
        <p>The table encountered an unexpected error. Your recorded decisions stay saved.</p>
        <button className="button button-primary" onClick={this.recover}>
          Return to practice
        </button>
        <button className="button button-secondary" onClick={() => window.location.reload()}>
          Reload app
        </button>
      </main>
    ) : (
      this.props.children
    );
  }
}
