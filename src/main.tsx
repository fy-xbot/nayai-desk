import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

type ErrorState = {
  message: string;
  stack?: string;
};

class RootErrorBoundary extends React.Component<
  React.PropsWithChildren,
  { error: ErrorState | null }
> {
  state = { error: null as ErrorState | null };

  static getDerivedStateFromError(error: Error) {
    return {
      error: {
        message: error.message,
        stack: error.stack,
      },
    };
  }

  componentDidCatch(error: Error) {
    console.error("[root-error-boundary]", error);
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <div className="min-h-screen bg-[#f5f4f1] px-5 py-8 text-[#1a1a1a]">
        <div className="mx-auto max-w-xl rounded-3xl border border-red-200 bg-white p-5 shadow-[0_20px_60px_rgba(0,0,0,0.08)]">
          <div className="mb-3 inline-flex rounded-full bg-red-50 px-2.5 py-1 text-[11px] font-medium text-red-600">
            Runtime Error
          </div>
          <h1 className="text-lg font-semibold">前端运行时发生错误</h1>
          <p className="mt-2 text-sm leading-6 text-[#666]">{this.state.error.message}</p>
          {this.state.error.stack && (
            <pre className="mt-4 overflow-auto rounded-2xl bg-[#f6f5f3] p-3 text-[11px] leading-5 text-[#555]">
              {this.state.error.stack}
            </pre>
          )}
        </div>
      </div>
    );
  }
}

const runtimeState: { error: ErrorState | null } = { error: null };

window.addEventListener("error", (event) => {
  runtimeState.error = {
    message: event.error?.message || event.message || "Unknown runtime error",
    stack: event.error?.stack,
  };
  console.error("[window-error]", event.error || event.message);
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  runtimeState.error = {
    message:
      reason instanceof Error
        ? reason.message
        : typeof reason === "string"
          ? reason
          : JSON.stringify(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  };
  console.error("[unhandledrejection]", reason);
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </React.StrictMode>,
);
