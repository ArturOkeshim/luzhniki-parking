export const metadata = {
  title: "Подготовка оплаты · Лужники",
  robots: { index: false, follow: false },
};

export default function PaymentPreparingPage() {
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "#f5f5f3" }}>
      <section style={{ width: "min(620px, 100%)", padding: 42, borderTop: "4px solid #ef3340", background: "#fff", boxShadow: "0 18px 60px rgba(17,24,39,.08)" }}>
        <img src="/brand/luzhniki-logo.png" alt="Лужники" width="210" height="37" style={{ display: "block", maxWidth: "100%", height: "auto", marginBottom: 48 }} />
        <p style={{ margin: "0 0 12px", color: "#ef3340", fontSize: 12, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase" }}>Защищённая оплата</p>
        <h1 style={{ margin: 0, fontSize: "clamp(32px, 7vw, 46px)", lineHeight: 1.08 }}>Готовим платёжную форму</h1>
        <p style={{ margin: "18px 0 0", color: "#60656f", fontSize: 18, lineHeight: 1.55 }}>Пожалуйста, подождите. Страница оплаты откроется автоматически.</p>
      </section>
    </main>
  );
}
