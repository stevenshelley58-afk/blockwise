export function ServiceRoleRequired() {
  return (
    <div className="surface-card">
      <p className="eyebrow">Configuration required</p>
      <h2>Operator data is unavailable</h2>
      <p>
        Supabase service-role access is not configured for this deployment. Add
        <code> SUPABASE_SERVICE_ROLE_KEY </code>
        before using operator data views.
      </p>
    </div>
  );
}
