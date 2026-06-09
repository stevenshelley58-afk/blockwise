import Script from "next/script";

export const dynamic = "force-static";
export const revalidate = 86400;

const redirectWhenOnline = `
(() => {
  const openHome = () => window.setTimeout(() => {
    window.location.replace("/home?source=pwa");
  }, 350);
  if (navigator.onLine) {
    openHome();
    return;
  }
  window.addEventListener("online", openHome, { once: true });
})();
`;

export default function PwaLaunchPage() {
  return (
    <main
      style={{
        minHeight: "100svh",
        display: "grid",
        placeItems: "center",
        padding: "32px 20px",
        background: "#ffffff",
        color: "#123e75",
        fontFamily:
          "var(--font-inter), ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
      }}
    >
      <Script id="pwa-online-launch" strategy="afterInteractive">
        {redirectWhenOnline}
      </Script>
      <section style={{ width: "min(100%, 420px)", textAlign: "center" }} aria-labelledby="pwa-title">
        <div
          aria-hidden="true"
          style={{
            width: 56,
            height: 56,
            margin: "0 auto 20px",
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 4,
            color: "#123e75",
          }}
        >
          {[2, 4, 5, 6, 7, 8].map((cell) => (
            <span
              key={cell}
              style={{
                gridColumn: (cell % 3) + 1,
                gridRow: Math.floor(cell / 3) + 1,
                borderRadius: 3,
                background: "currentColor",
              }}
            />
          ))}
        </div>
        <h1 id="pwa-title" style={{ margin: 0, fontSize: 28, lineHeight: 1.15, letterSpacing: 0 }}>
          Blockwise
        </h1>
        <p style={{ margin: "12px 0 0", color: "#385b7d", fontSize: 16, lineHeight: 1.55 }}>
          Opening your workspace when the network is available.
        </p>
        <p
          id="pwa-offline-msg"
          role="status"
          style={{ margin: "10px 0 0", color: "#c0392b", fontSize: 14, lineHeight: 1.5, display: "none" }}
        >
          You appear to be offline. This page will open automatically once you reconnect.
        </p>
        <script
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{
            __html: `(function(){var el=document.getElementById('pwa-offline-msg');function update(){if(el)el.style.display=navigator.onLine?'none':'block';}update();window.addEventListener('online',update);window.addEventListener('offline',update);})();`,
          }}
        />
        <p style={{ margin: "24px 0 0" }}>
          <a
            href="/home?source=pwa"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              minHeight: 44,
              padding: "0 18px",
              borderRadius: 6,
              background: "#123e75",
              color: "#ffffff",
              fontWeight: 700,
              textDecoration: "none",
            }}
          >
            Open Blockwise
          </a>
        </p>
      </section>
    </main>
  );
}
