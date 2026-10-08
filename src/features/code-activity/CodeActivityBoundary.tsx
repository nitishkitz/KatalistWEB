import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

interface BoundaryProps {
  children: ReactNode;
  /** Changing this value clears a previous error, for example when the List changes. */
  resetKey?: string;
}
interface BoundaryState {
  failed: boolean;
}

/**
 * Feature-local error boundary. A render failure anywhere inside Code Activity stops here, so
 * Things, Chat, Members, calls, and navigation stay usable. It renders no data of its own.
 */
export class CodeActivityBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    // Log the failure for developers. Nothing from provider data is sent anywhere.
    console.error("[code-activity] render failure contained to this tab", error, info.componentStack);
  }

  componentDidUpdate(prev: BoundaryProps) {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="mx-auto my-10 max-w-md rounded-xl border border-[#eaeffa] bg-white p-6 text-center">
        <div className="text-[16px] font-semibold text-[#000533]">Code Activity hit a problem</div>
        <p className="mt-1.5 text-[13px] text-[#6a769c]">
          Things, Chat, and Members still work. This problem is contained to this tab.
        </p>
        <button
          type="button"
          onClick={() => this.setState({ failed: false })}
          className="mt-4 inline-flex h-[42px] cursor-pointer items-center rounded-[9px] border border-[#eaeffa] bg-white px-4 text-[14px] font-medium text-[#1d1d1d] outline-none hover:bg-[#fafaff] focus-visible:ring-2 focus-visible:ring-[#975ee2]"
        >
          Try again
        </button>
      </div>
    );
  }
}
