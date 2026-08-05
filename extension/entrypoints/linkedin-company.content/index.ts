import "./style.css";
import {
  type CompanyPageAdapter,
  startCompanyPageAdapter,
} from "../../lib/company-page-adapter";
import type { PlatformIdentity } from "../../lib/contracts";

const COMPANY_HOME_PATH = /^\/company\/[^/]+\/?$/u;
const HEADING_SELECTOR = "main h1.org-top-card-summary__title";
const FALLBACK_HEADING_SELECTOR = "main h1";
const MOUNT_ANCHOR_ATTRIBUTE = "data-nz-aei-company-anchor";
const MOUNT_ANCHOR_SELECTOR = `[${MOUNT_ANCHOR_ATTRIBUTE}]`;

function isCompanyHomepage(url: URL): boolean {
  return url.hostname === "www.linkedin.com" && COMPANY_HOME_PATH.test(url.pathname);
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

function readIdentity(): PlatformIdentity | null {
  const displayName = findCompanyHeading()?.textContent?.trim();
  const match = location.pathname.match(/^\/company\/([^/]+)\/?$/u);
  const slug = match?.[1]?.toLowerCase();
  if (!displayName || slug === undefined || !/^[a-z0-9][a-z0-9-]{0,99}$/u.test(slug)) {
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
  if (existing?.isConnected) {
    return existing;
  }

  const heading = findCompanyHeading();
  if (heading === null) {
    return null;
  }

  const anchor = document.createElement("span");
  anchor.setAttribute(MOUNT_ANCHOR_ATTRIBUTE, "");
  heading.insertAdjacentElement("afterend", anchor);
  return anchor;
}

const adapter: CompanyPageAdapter = {
  id: "linkedin-company",
  mountAnchorSelector: MOUNT_ANCHOR_SELECTOR,
  isSupportedPage: isCompanyHomepage,
  getIdentity: readIdentity,
  ensureMountAnchor,
  removeMountAnchor() {
    document.querySelector(MOUNT_ANCHOR_SELECTOR)?.remove();
  },
};

export default defineContentScript({
  matches: ["https://www.linkedin.com/company/*"],
  runAt: "document_idle",
  cssInjectionMode: "ui",

  main(ctx) {
    startCompanyPageAdapter(ctx, adapter);
  },
});
