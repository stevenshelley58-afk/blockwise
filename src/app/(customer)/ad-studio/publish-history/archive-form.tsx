export function ArchiveForm() {
  return <section className="rounded-(--r-card) border border-border bg-card p-4" aria-label="Archived Instant Form">
    <h3 className="text-sm font-semibold">Instant Form</h3>
    <p className="mt-2 text-xs text-muted-foreground">The historical form editor is replaced with this read-only example. Generation and saving are disabled.</p>
    <dl className="mt-4 space-y-3 text-sm">
      <div><dt className="text-muted-foreground">Introduction</dt><dd>Request the example guide</dd></div>
      <div><dt className="text-muted-foreground">Contact fields</dt><dd>Full name, email, phone</dd></div>
      <div><dt className="text-muted-foreground">Privacy policy</dt><dd>Example only, not a live privacy policy</dd></div>
      <div><dt className="text-muted-foreground">Thank-you action</dt><dd>View guide</dd></div>
    </dl>
  </section>;
}
