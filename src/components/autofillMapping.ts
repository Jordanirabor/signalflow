import type { PersonSearchResult } from '@/services/peopleSearchService';

/**
 * Form shape for the "Add New Lead" form.
 * Mirrors the NewLeadForm interface in LeadListView.
 */
export interface NewLeadForm {
  name: string;
  role: string;
  company: string;
  industry: string;
  geography: string;
  email: string;
}

/**
 * Maps a PersonSearchResult to a NewLeadForm by copying each field.
 * This is the pure autofill mapping logic extracted from LeadListView's
 * handleSelectPerson handler so it can be tested independently.
 */
export function mapPersonToForm(person: PersonSearchResult): NewLeadForm {
  return {
    name: person.name,
    role: person.role,
    company: person.company,
    industry: person.industry,
    geography: person.geography,
    email: person.email,
  };
}

/**
 * Shape of the payload sent to POST /api/leads.
 * Optional fields are omitted when empty/whitespace-only.
 */
export interface LeadSubmissionPayload {
  name: string;
  role?: string;
  company?: string;
  industry?: string;
  geography?: string;
  email?: string;
}

/**
 * Validation errors keyed by form field name.
 */
export type FormErrors = Partial<Record<keyof NewLeadForm, string>>;

/**
 * Pure validation logic extracted from LeadListView's validateNewLead.
 *
 * Returns an object of field-level error messages. An empty object means
 * the form is valid.
 *
 * Rules:
 * - Only name is required (must be non-empty after trimming).
 * - All other fields are optional — the research engine will enrich them.
 */
export function validateLeadForm(form: NewLeadForm, _hasSelectedPerson: boolean): FormErrors {
  const errors: FormErrors = {};
  if (!form.name.trim()) errors.name = 'Name is required';
  return errors;
}

/**
 * Builds the submission payload from the current form state.
 * Extracted from LeadListView's handleAddLead so it can be tested independently.
 *
 * - Trims all fields
 * - Omits industry, geography, and email when they are empty after trimming
 */
export function buildSubmissionPayload(form: NewLeadForm): LeadSubmissionPayload {
  return {
    name: form.name.trim(),
    role: form.role.trim() || undefined,
    company: form.company.trim() || undefined,
    industry: form.industry.trim() || undefined,
    geography: form.geography.trim() || undefined,
    email: form.email.trim() || undefined,
  };
}
