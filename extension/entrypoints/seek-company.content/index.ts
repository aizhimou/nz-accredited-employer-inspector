import "../linkedin-company.content/style.css";
import {
  type CompanyPageAdapter,
  startCompanyPageAdapter,
} from "../../lib/company-page-adapter";
import type { PlatformIdentity } from "../../lib/contracts";
import { getSeekCompanyCanonicalPath } from "../../lib/seek-routes";

const COMPANY_LINK_SELECTOR = 'a[href*="/companies/"]';
const MOUNT_ANCHOR_ATTRIBUTE = "data-nz-aei-seek-company-anchor";
const MOUNT_ANCHOR_SELECTOR = `[${MOUNT_ANCHOR_ATTRIBUTE}]`;

function isSeekCompanyPage(url: URL): boolean {
  return getSeekCompanyCanonicalPath(url) !== null;
}

function findCompanyNameLink(): HTMLAnchorElement | null {
  const canonicalPath = getSeekCompanyCanonicalPath(new URL(location.href));
  if (canonicalPath === null) {
    return null;
  }

  for (const link of document.querySelectorAll<HTMLAnchorElement>(COMPANY_LINK_SELECTOR)) {
    const url = new URL(link.href, location.origin);
    const nameRow = link.parentElement;
    if (
      url.origin === location.origin &&
      url.pathname.replace(/\/$/u, "").toLowerCase() === canonicalPath &&
      link.textContent?.trim() &&
      nameRow !== null &&
      getComputedStyle(nameRow).display === "flex" &&
      (nameRow.children.length === 1 ||
        nameRow.querySelector(`:scope > ${MOUNT_ANCHOR_SELECTOR}`) !== null)
    ) {
      return link;
    }
  }
  return null;
}

function readIdentity(): PlatformIdentity | null {
  const canonicalPath = getSeekCompanyCanonicalPath(new URL(location.href));
  const displayName = findCompanyNameLink()?.textContent?.trim();
  if (canonicalPath === null || !displayName) {
    return null;
  }
  return {
    platform: "seek",
    externalKey: `company:${canonicalPath}`,
    kind: "seek_company_profile",
    strength: "strong",
    displayName,
    publicUrl: `https://nz.seek.com${canonicalPath}`,
  };
}

function ensureMountAnchor(): HTMLElement | null {
  const existing = document.querySelector<HTMLElement>(MOUNT_ANCHOR_SELECTOR);
  const companyNameLink = findCompanyNameLink();
  const nameRow = companyNameLink?.parentElement;
  if (companyNameLink === null || nameRow === null || nameRow === undefined) {
    return null;
  }

  if (
    existing?.isConnected &&
    existing.previousElementSibling === companyNameLink &&
    existing.parentElement === nameRow
  ) {
    return existing;
  }

  existing?.remove();

  const anchor = document.createElement("span");
  anchor.setAttribute(MOUNT_ANCHOR_ATTRIBUTE, "");
  anchor.style.alignSelf = "flex-start";
  anchor.style.display = "block";
  anchor.style.marginBlockStart = "0.75rem";
  companyNameLink.insertAdjacentElement("afterend", anchor);
  return anchor;
}

const adapter: CompanyPageAdapter = {
  id: "seek-company",
  mountLayout: "stacked",
  mountAnchorSelector: MOUNT_ANCHOR_SELECTOR,
  isSupportedPage: isSeekCompanyPage,
  getIdentity: readIdentity,
  ensureMountAnchor,
  removeMountAnchor() {
    document.querySelector(MOUNT_ANCHOR_SELECTOR)?.remove();
  },
};

export default defineContentScript({
  matches: ["https://nz.seek.com/companies/*"],
  runAt: "document_idle",
  cssInjectionMode: "ui",

  main(ctx) {
    startCompanyPageAdapter(ctx, adapter);
  },
});
