import React from "react";
import { RefreshCw, AlertTriangle } from "lucide-react";

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("Uncaught React Error Boundary Exception:", error, errorInfo);
    this.setState({ errorInfo });
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f8fafc",
          padding: 24,
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
        }}>
          <div style={{
            background: "#ffffff",
            borderRadius: 20,
            border: "1px solid #e2e8f0",
            padding: 32,
            maxWidth: 520,
            width: "100%",
            textAlign: "center",
            boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.05)"
          }}>
            <div style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              background: "#ffe4e6",
              color: "#e11d48",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 16px auto"
            }}>
              <AlertTriangle size={28} />
            </div>

            <h2 style={{ fontSize: 20, fontWeight: 800, color: "#0f172a", margin: "0 0 8px 0" }}>
              Application Render Exception
            </h2>
            <p style={{ fontSize: 13, color: "#64748b", margin: "0 0 20px 0", lineHeight: 1.5 }}>
              An unexpected user interface exception occurred. The system isolated the failure to protect active data.
            </p>

            {this.state.error && (
              <div style={{
                background: "#f1f5f9",
                borderRadius: 10,
                padding: "10px 14px",
                fontSize: 12,
                fontFamily: "monospace",
                color: "#991b1b",
                textAlign: "left",
                marginBottom: 20,
                wordBreak: "break-all"
              }}>
                {String(this.state.error.toString())}
              </div>
            )}

            <button
              onClick={this.handleReload}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 20px",
                borderRadius: 10,
                background: "linear-gradient(135deg, #4f46e5 0%, #3730a3 100%)",
                color: "#ffffff",
                fontSize: 13,
                fontWeight: 700,
                border: "none",
                cursor: "pointer",
                boxShadow: "0 4px 12px rgba(79, 70, 229, 0.3)"
              }}
            >
              <RefreshCw size={15} /> Reload Application Workspace
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
