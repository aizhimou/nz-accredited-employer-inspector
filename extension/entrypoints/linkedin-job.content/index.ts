import "../linkedin-company.content/style.css";
import {
  type CompanyPageAdapter,
  startCompanyPageAdapter,
} from "../../lib/company-page-adapter";
import type { PlatformIdentity } from "../../lib/contracts";
import {
  getLinkedInCompanySlug,
  getLinkedInJobSurface,
} from "../../lib/linkedin-routes";

const JOB_LINK_SELECTOR = 'main a[href*="/jobs/view/"]';
const COMPANY_LINK_SELECTOR = 'a[href*="/company/"]';
const MOUNT_ANCHOR_ATTRIBUTE = "data-nz-aei-linkedin-job-anchor";
const MOUNT_ANCHOR_SELECTOR = `[${MOUNT_ANCHOR_ATTRIBUTE}]`;

interface JobHeader {
  companyLink: HTMLAnchorElement;
  container: HTMLElement;
  mountAfter: HTMLElement;
}

function isJobLink(link: HTMLAnchorElement): boolean {
  return getLinkedInJobSurface(new URL(link.href, location.origin)) === "view";
}

function findSearchResultsJobHeader(): JobHeader | null {
  for (const jobLink of document.querySelectorAll<HTMLAnchorElement>(JOB_LINK_SELECTOR)) {
    if (!isJobLink(jobLink)) {
      continue;
    }

    const titleLine = jobLink.closest<HTMLElement>("p");
    const titleContents = titleLine?.closest<HTMLElement>(
      '[data-display-contents="true"]',
    );
    const titleRow = titleContents?.parentElement;
    const container = titleRow?.parentElement;
    if (
      titleLine === null ||
      titleRow === null ||
      titleRow === undefined ||
      container === null ||
      container === undefined
    ) {
      continue;
    }

    for (const companyLink of container.querySelectorAll<HTMLAnchorElement>(
      COMPANY_LINK_SELECTOR,
    )) {
      if (
        companyLink.textContent?.trim() &&
        getLinkedInCompanySlug(new URL(companyLink.href, location.origin)) !== null
      ) {
        return { companyLink, container, mountAfter: titleRow };
      }
    }
  }

  return null;
}

function findJobViewHeader(): JobHeader | null {
  for (const companyLink of document.querySelectorAll<HTMLAnchorElement>(
    `main ${COMPANY_LINK_SELECTOR}`,
  )) {
    if (
      !companyLink.textContent?.trim() ||
      getLinkedInCompanySlug(new URL(companyLink.href, location.origin)) === null
    ) {
      continue;
    }

    const companyContents = companyLink.closest<HTMLElement>(
      '[data-display-contents="true"]',
    );
    const companyRow = companyContents?.parentElement;
    const container = companyRow?.parentElement;
    if (
      companyRow === null ||
      companyRow === undefined ||
      container === null ||
      container === undefined ||
      companyRow.nextElementSibling === null
    ) {
      continue;
    }

    return { companyLink, container, mountAfter: companyRow };
  }

  return null;
}

function findJobHeader(): JobHeader | null {
  const surface = getLinkedInJobSurface(new URL(location.href));
  if (surface === "search-results") {
    return findSearchResultsJobHeader();
  }

  return surface === "view" ? findJobViewHeader() : null;
}

function readIdentity(): PlatformIdentity | null {
  const companyLink = findJobHeader()?.companyLink;
  const displayName = companyLink?.textContent?.trim();
  const slug = companyLink
    ? getLinkedInCompanySlug(new URL(companyLink.href, location.origin))
    : null;
  if (!displayName || slug === null) {
    return null;
  }

  return {
    platform: "linkedin",
    externalKey: `company:${slug}`,
    kind: "linkedin_company_url",
    strength: "strong",
    displayName,
    publicUrl: `https://www.linkedin.com/company/${slug}/`,
  };
}

function ensureMountAnchor(): HTMLElement | null {
  const existing = document.querySelector<HTMLElement>(MOUNT_ANCHOR_SELECTOR);
  const header = findJobHeader();
  if (header === null) {
    return null;
  }

  if (
    existing?.isConnected &&
    existing.tagName === "DIV" &&
    existing.parentElement === header.container &&
    existing.previousElementSibling === header.mountAfter
  ) {
    return existing;
  }

  existing?.remove();
  const anchor = document.createElement("div");
  anchor.setAttribute(MOUNT_ANCHOR_ATTRIBUTE, "");
  anchor.style.alignSelf = "flex-start";
  anchor.style.display = "block";
  header.mountAfter.insertAdjacentElement("afterend", anchor);
  return anchor;
}

const adapter: CompanyPageAdapter = {
  id: "linkedin-job",
  mountLayout: "stacked",
  mountAnchorSelector: MOUNT_ANCHOR_SELECTOR,
  isSupportedPage: (url) => getLinkedInJobSurface(url) !== null,
  getPanelLayout: (url) =>
    getLinkedInJobSurface(url) === "view" ? "in-flow" : "overlay",
  getIdentity: readIdentity,
  ensureMountAnchor,
  removeMountAnchor() {
    document.querySelector(MOUNT_ANCHOR_SELECTOR)?.remove();
  },
};

export default defineContentScript({
  matches: [
    "https://www.linkedin.com/jobs/*",
    "https://www.linkedin.com/comm/jobs/*",
  ],
  runAt: "document_idle",
  cssInjectionMode: "ui",

  main(ctx) {
    startCompanyPageAdapter(ctx, adapter);
  },
});
