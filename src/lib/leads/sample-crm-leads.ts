import type { HomeLead } from "@/lib/home/home-lead-row";

/**
 * Example leads for the demo tone, shaped like the records Frappe CRM holds.
 *
 * Frappe CRM's `CRM Lead` carries `lead_name` (its title field), `first_name`,
 * `last_name`, `email`, `mobile_no`, `organization`, `job_title`, `territory`,
 * `source`, `status`, `lead_owner`, `converted` and `creation`/`modified`, plus
 * `facebook_lead_id` and `facebook_form_id` for leads synced from Meta lead
 * forms. `source` and `status` are Link fields: they point at `CRM Lead Source`
 * and `CRM Lead Status` records, and `crm/install.py` seeds these defaults.
 *
 * The names below are invented. The source and status values are not: they are
 * Frappe CRM's own defaults, so this data maps onto a real deployment without a
 * translation layer, and a workspace whose CRM renames them keeps working
 * because the row prints whatever the record is called.
 *
 * Creation times are offsets from now, so the demo never looks stale.
 */

export type SampleCrmLead = {
  /** Frappe's title field: the full name shown in a link. */
  lead_name: string;
  first_name: string;
  last_name: string;
  email: string;
  mobile_no: string;
  organization: string | null;
  /** A `CRM Territory` record. In a real-estate deployment these are suburbs. */
  territory: string;
  /** A `CRM Lead Source` record, e.g. "Facebook", "Website", "Reference". */
  source: string;
  /** A `CRM Lead Status` record, e.g. "New", "Contacted", "Nurture". */
  status: string;
  /** The agent who owns the follow-up. */
  lead_owner: string;
  /** Present when the lead arrived through a Meta lead form. */
  facebook_lead_id?: string;
  /** How long ago the lead was created. */
  createdAgoMs: number;
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const SAMPLE_CRM_LEADS: SampleCrmLead[] = [
  {
    lead_name: "Priya Raman",
    first_name: "Priya",
    last_name: "Raman",
    email: "priya.raman@example.com",
    mobile_no: "04•• ••• 218",
    organization: null,
    territory: "Scarborough",
    source: "Facebook",
    status: "New",
    lead_owner: "Alex Morgan",
    facebook_lead_id: "61204388512994",
    createdAgoMs: 3 * HOUR,
  },
  {
    lead_name: "Daniel Okafor",
    first_name: "Daniel",
    last_name: "Okafor",
    email: "d.okafor@example.com",
    mobile_no: "04•• ••• 771",
    organization: null,
    territory: "Nedlands",
    source: "Facebook",
    status: "Contacted",
    lead_owner: "Alex Morgan",
    facebook_lead_id: "61204388513021",
    createdAgoMs: 1 * DAY + 5 * HOUR,
  },
  {
    lead_name: "Hannah Whitfield",
    first_name: "Hannah",
    last_name: "Whitfield",
    email: "hannah.whitfield@example.com",
    mobile_no: "04•• ••• 402",
    organization: null,
    territory: "Subiaco",
    source: "Website",
    status: "Nurture",
    lead_owner: "Alex Morgan",
    createdAgoMs: 3 * DAY + 2 * HOUR,
  },
  {
    lead_name: "Marcus Bell",
    first_name: "Marcus",
    last_name: "Bell",
    email: "marcus.bell@example.com",
    mobile_no: "04•• ••• 655",
    organization: null,
    territory: "Applecross",
    source: "Reference",
    status: "Qualified",
    lead_owner: "Alex Morgan",
    createdAgoMs: 5 * DAY + 6 * HOUR,
  },
];

/** The example leads as Home's rows, dated from `now`. */
export function sampleHomeLeads(now = Date.now()): HomeLead[] {
  return SAMPLE_CRM_LEADS.map((lead, index) => ({
    id: `sample-crm-lead-${index + 1}`,
    name: lead.lead_name,
    suburb: lead.territory,
    source: lead.source,
    status: lead.status,
    createdAt: new Date(now - lead.createdAgoMs).toISOString(),
  }));
}
