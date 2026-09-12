/**
 * One row of Home's leads list.
 *
 * The workspace stores leads of its own, and the eventual CRM (Frappe CRM) is
 * where follow-up state lives, so a row carries `status` only when a CRM gives
 * one: a lead with no CRM state reads as waiting time instead. Kept in its own
 * client-safe module so the server loader, the sample fixtures and the browser
 * component all agree on the shape.
 */
export type HomeLead = {
  id: string;
  name: string;
  suburb: string;
  source: string;
  /** The CRM's own status record name, e.g. Frappe CRM's "New" or "Contacted". */
  status?: string | null;
  createdAt: string;
};
