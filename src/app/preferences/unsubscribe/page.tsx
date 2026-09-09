import type { Metadata } from "next";
import Link from "next/link";
import { unsubscribeEmail } from "./actions";

export const metadata: Metadata = {
  title: "Unsubscribe | Blockwise",
  robots: { index: false, follow: false },
};

type PageProps = {
  searchParams: Promise<{ done?: string; error?: string }>;
};

export default async function UnsubscribePage({ searchParams }: PageProps) {
  const { done, error } = await searchParams;

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#f6f7f9",
        color: "#16181d",
        fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div style={{ width: "100%", maxWidth: 420 }}>
        <Link
          href="/"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            color: "inherit",
            fontWeight: 700,
            fontSize: 20,
            letterSpacing: "-0.035em",
            textDecoration: "none",
          }}
        >
          <span
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3,5px)",
              gap: 2,
              width: 27,
              height: 27,
              padding: "6px 5px",
              borderRadius: 9,
              background: "#16181d",
            }}
          >
            <span style={{ display: "block", height: 9, borderRadius: 2, background: "#fff" }} />
            <span style={{ display: "block", height: 13, borderRadius: 2, background: "#fff" }} />
            <span style={{ display: "block", height: 16, borderRadius: 2, background: "#fff" }} />
          </span>
          blockwise
        </Link>

        <div
          style={{
            marginTop: 32,
            padding: 28,
            borderRadius: 20,
            background: "#fff",
            border: "1px solid #e9ebef",
            boxShadow: "0 1px 2px rgba(16,18,23,.04),0 8px 24px rgba(16,18,23,.06)",
          }}
        >
          <h1
            style={{
              margin: "0 0 8px",
              fontSize: 24,
              fontWeight: 800,
              letterSpacing: "-0.025em",
            }}
          >
            Unsubscribe
          </h1>
          <p style={{ margin: "0 0 20px", color: "#545a66", fontSize: 14, lineHeight: 1.5 }}>
            Enter your email and we will stop sending you advertising snapshots and other outreach
            messages.
          </p>

          {done ? (
            <div
              style={{
                padding: 14,
                borderRadius: 10,
                background: "rgba(42,120,214,.08)",
                border: "1px solid rgba(42,120,214,.24)",
                color: "#16181d",
                fontSize: 14,
              }}
            >
              You have been unsubscribed. If you change your mind, email{" "}
              <a href="mailto:steven@blockwise.sale" style={{ color: "#2a78d6" }}>
                steven@blockwise.sale
              </a>
              .
            </div>
          ) : error ? (
            <div
              style={{
                padding: 14,
                borderRadius: 10,
                background: "rgba(186,26,26,.08)",
                border: "1px solid rgba(186,26,26,.24)",
                color: "#16181d",
                fontSize: 14,
              }}
            >
              Something went wrong. If the issue keeps happening, email{" "}
              <a href="mailto:steven@blockwise.sale" style={{ color: "#ba1a1a" }}>
                steven@blockwise.sale
              </a>
              .
            </div>
          ) : (
            <form action={unsubscribeEmail}>
              <label
                style={{
                  display: "block",
                  fontSize: 13,
                  fontWeight: 700,
                  marginBottom: 6,
                  color: "#16181d",
                }}
              >
                Email address
              </label>
              <input
                type="email"
                name="email"
                required
                placeholder="you@example.com"
                autoComplete="email"
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid #d3d7df",
                  fontSize: 15,
                  outline: "none",
                }}
              />
              <button
                type="submit"
                style={{
                  width: "100%",
                  marginTop: 14,
                  padding: "11px 0",
                  borderRadius: 999,
                  border: 0,
                  background: "#16181d",
                  color: "#fff",
                  fontWeight: 700,
                  fontSize: 14,
                  cursor: "pointer",
                }}
              >
                Unsubscribe
              </button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
