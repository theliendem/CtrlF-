import type { DigLink } from '../shared/types';

const GENERIC_PATH = /^(?:courses?|api|v\d+|www|html?|php|aspx?|index|default|home|files?|download|preview|pages?)$/i;

/** URL path words without generic route names or long numeric IDs. */
export function linkPath(raw: string): string {
  let path: string[] = [];
  try {
    path = decodeURIComponent(new URL(raw).pathname)
      .split(/[/_\-.+]+/)
      .filter((w) => w && !/^\d{3,}$/.test(w) && !GENERIC_PATH.test(w)); // Canvas ids and boilerplate say nothing
  } catch { /* An unreadable URL supplies no path clues. */ }
  return path.join(' ');
}

export function linkText(link: DigLink): string {
  return [link.title, link.heading, linkPath(link.url)].map((s) => s?.trim()).filter(Boolean).join(' · ');
}
