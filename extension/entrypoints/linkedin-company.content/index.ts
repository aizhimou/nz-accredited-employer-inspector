import "./style.css";
import {
  type CompanyPageAdapter,
  startCompanyPageAdapter,
} from "../../lib/company-page-adapter";
import type { PlatformIdentity } from "../../lib/contracts";
import { getLinkedInCompanySlug } from "../../lib/linkedin-routes";

const HEADING_SELECTOR = "main h1.org-top-card-summary__title";
const FALLBACK_HEADING_SELECTOR = "main h1";
const COMPANY_NAV_LINK_SELECTOR = 'main nav a[href*="/company/"]';
const TAGLINE_SELECTOR = ":scope > p.org-top-card-summary__tagline";
const INFO_LIST_SELECTOR = ":scope > div.org-top-card-summary-info-list";
const MOUNT_ANCHOR_ATTRIBUTE = "data-nz-aei-company-anchor";
const MOUNT_ANCHOR_SELECTOR = `[${MOUNT_ANCHOR_ATTRIBUTE}]`;

interface CompanyHeader {
  container: HTMLElement;
  followingContent: HTMLElement | null;
}

function isLinkedInPreloadPage(url: URL): boolean {
  return (
    url.hostname === "www.linkedin.com" &&
    url.pathname === "/preload/" &&
    url.searchParams.get("_bprMode") === "vanilla"
  );
}

function findCompanySlug(url = new URL(location.href)): string | null {
  const routeSlug = getLinkedInCompanySlug(url);
  if (routeSlug !== null) {
    return routeSlug;
  }

  for (const link of document.querySelectorAll<HTMLAnchorElement>(
    COMPANY_NAV_LINK_SELECTOR,
  )) {
    const linkSlug = getLinkedInCompanySlug(
      new URL(link.href, location.origin),
    );
    if (linkSlug !== null) {
      return linkSlug;
    }
  }

  return null;
}

function isCompanyPage(url: URL): boolean {
  return getLinkedInCompanySlug(url) !== null || isLinkedInPreloadPage(url);
}

function findCompanyHeading(): HTMLElement | null {
  const primaryHeading = document.querySelector<HTMLElement>(HEADING_SELECTOR);
  if (primaryHeading?.textContent?.trim()) {
    return primaryHeading;
  }

  for (const heading of document.querySelectorAll<HTMLElement>(FALLBACK_HEADING_SELECTOR)) {
    if (heading.textContent?.trim()) {
      return heading;
    }
  }
  return null;
}

function findCompanyHeader(): CompanyHeader | null {
  const heading = findCompanyHeading();
  const container = heading?.parentElement;
  if (
    heading === null ||
    heading === undefined ||
    container === null ||
    container === undefined
  ) {
    return null;
  }

  const followingContent = container.querySelector<HTMLElement>(
    `${TAGLINE_SELECTOR}, ${INFO_LIST_SELECTOR}`,
  );
  return { container, followingContent };
}

function readIdentity(): PlatformIdentity | null {
  const displayName = findCompanyHeading()?.textContent?.trim();
  const slug = findCompanySlug();
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
  if (findCompanySlug() === null) {
    existing?.remove();
    return null;
  }

  const header = findCompanyHeader();
  if (header === null) {
    return null;
  }

  if (
    existing?.isConnected &&
    existing.tagName === "DIV" &&
    existing.parentElement === header.container &&
    (header.followingContent === null ||
      existing.nextElementSibling === header.followingContent)
  ) {
    return existing;
  }

  existing?.remove();

  const anchor = document.createElement("div");
  anchor.setAttribute(MOUNT_ANCHOR_ATTRIBUTE, "");
  anchor.style.display = "block";
  anchor.style.marginBlock = "0.8rem";
  if (header.followingContent === null) {
    header.container.append(anchor);
  } else {
    header.container.insertBefore(anchor, header.followingContent);
  }
  return anchor;
}

const adapter: CompanyPageAdapter = {
  id: "linkedin-company",
  mountLayout: "stacked",
  mountAnchorSelector: MOUNT_ANCHOR_SELECTOR,
  isSupportedPage: isCompanyPage,
  getIdentity: readIdentity,
  ensureMountAnchor,
  removeMountAnchor() {
    document.querySelector(MOUNT_ANCHOR_SELECTOR)?.remove();
  },
};

export default defineContentScript({
  matches: ["https://www.linkedin.com/*"],
  allFrames: true,
  runAt: "document_idle",
  cssInjectionMode: "ui",

  main(ctx) {
    startCompanyPageAdapter(ctx, adapter);
  },
});
