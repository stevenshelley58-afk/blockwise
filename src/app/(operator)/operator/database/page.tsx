import { DatabaseViewer } from "@/components/operator/database-viewer";
import { PageHeading } from "@/components/page-heading";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";

import "./database.css";

export const dynamic = "force-dynamic";

export default async function OperatorDatabasePage() {
  await requirePageSurfaceAccess("operator");

  return (
    <main className="content">
      <PageHeading
        eyebrow="Internal control plane"
        title="Database Viewer"
        description="Browse and edit every public table, column by column, with image and video thumbnails. Reads and writes run live against the production database under the service role; every edit is recorded in audit_logs."
      />
      <DatabaseViewer />
    </main>
  );
}
