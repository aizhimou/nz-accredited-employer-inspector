import "../linkedin-company.content/style.css";
import {
  type CompanyPageAdapter,
  startCompanyPageAdapter,
} from "../../lib/company-page-adapter";
import type { PlatformIdentity } from "../../lib/contracts";
import { isSeekJobSurface } from "../../lib/seek-routes";

const JOB_TITLE_SELECTOR = '[data-automation="job-detail-title"]';
const ADVERTISER_SELECTOR = '[data-automation="advertiser-name"]';
const MOUNT_ANCHOR_ATTRIBUTE = "data-nz-aei-seek-job-anchor";
const MOUNT_ANCHOR_SELECTOR = `[${MOUNT_ANCHOR_ATTRIBUTE}]`;

interface EmployerHeader {
  advertiser: HTMLElement;
  employerRow: HTMLElement;
}

function findEmployerHeader(): EmployerHeader | null {
  const jobTitle = document.querySelector<HTMLElement>(JOB_TITLE_SELECTOR);
  const advertiser = jobTitle?.parentElement?.querySelector<HTMLElement>(ADVERTISER_SELECTOR);
  if (!advertiser?.textContent?.trim()) {
    return null;
  }

  const advertiserControl = advertiser.closest<HTMLElement>("button") ?? advertiser;
  const employerRow = advertiserControl.parentElement;
  if (employerRow === null || employerRow.parentElement !== jobTitle?.parentElement) {
    return null;
  }
  return { advertiser, employerRow };
}

function normalizeName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}

function readIdentity(): PlatformIdentity | null {
  const advertiser = findEmployerHeader()?.advertiser;
  const displayName = advertiser?.textContent?.trim();
  if (!advertiser || !displayName) {
    return null;
  }

  const profileLink = advertiser.closest<HTMLAnchorElement>('a[href*="/companies/"]');
  if (profileLink !== null) {
    const url = new URL(profileLink.href, location.origin);
    const path = url.pathname.replace(/\/$/u, "").toLowerCase();
    if (/^\/companies\/[a-z0-9][a-z0-9-]{0,199}$/u.test(path)) {
      return {
        platform: "seek",
        externalKey: `company:${path}`,
        kind: "seek_company_profile",
        strength: "strong",
        displayName,
        publicUrl: `https://nz.seek.com${path}`,
      };
    }
  }

  const normalizedName = normalizeName(displayName);
  return {
    platform: "seek",
    externalKey: `advertiser:${normalizedName}`,
    kind: "seek_advertiser_name",
    strength: "weak",
    displayName,
    publicUrl: null,
  };
}

function ensureMountAnchor(): HTMLElement | null {
  const existing = document.querySelector<HTMLElement>(MOUNT_ANCHOR_SELECTOR);
  const header = findEmployerHeader();
  if (header === null) {
    return null;
  }

  if (
    existing?.isConnected &&
    existing.tagName === "DIV" &&
    existing.previousElementSibling === header.employerRow &&
    existing.parentElement === header.employerRow.parentElement
  ) {
    return existing;
  }
  existing?.remove();

  const anchor = document.createElement("div");
  anchor.setAttribute(MOUNT_ANCHOR_ATTRIBUTE, "");
  anchor.style.alignSelf = "flex-start";
  header.employerRow.insertAdjacentElement("afterend", anchor);
  return anchor;
}

const adapter: CompanyPageAdapter = {
  id: "seek-job",
  mountLayout: "stacked",
  mountAnchorSelector: MOUNT_ANCHOR_SELECTOR,
  isSupportedPage: isSeekJobSurface,
  getIdentity: readIdentity,
  ensureMountAnchor,
  removeMountAnchor() {
    document.querySelector(MOUNT_ANCHOR_SELECTOR)?.remove();
  },
};

export default defineContentScript({
  matches: ["https://nz.seek.com/*"],
  runAt: "document_idle",
  cssInjectionMode: "ui",

  main(ctx) {
    startCompanyPageAdapter(ctx, adapter);
  },
});
