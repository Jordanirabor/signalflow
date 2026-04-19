import type { PersonSearchResult } from '@/services/peopleSearchService';

/**
 * Represents a single rendered dropdown item with its display text segments.
 */
export interface DropdownItemView {
  /** Primary line: the person's name */
  primaryText: string;
  /** Secondary line: role, company, and email details */
  secondaryText: string;
}

/**
 * Computes the display text for a single search result dropdown item.
 * Mirrors the rendering logic in LeadListView's Search_Dropdown.
 */
export function renderDropdownItem(result: PersonSearchResult): DropdownItemView {
  const secondaryParts: string[] = [result.role];
  if (result.company) {
    secondaryParts.push(` at ${result.company}`);
  }
  if (result.email) {
    secondaryParts.push(` · ${result.email}`);
  }

  return {
    primaryText: result.name,
    secondaryText: secondaryParts.join(''),
  };
}

/**
 * Computes the display views for all search results in the dropdown.
 * Returns one DropdownItemView per result.
 */
export function renderDropdownItems(results: PersonSearchResult[]): DropdownItemView[] {
  return results.map(renderDropdownItem);
}
