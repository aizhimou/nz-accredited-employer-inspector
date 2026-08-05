import "../linkedin-company.content/style.css";
import {
  type CompanyPageAdapter,
  startCompanyPageAdapter,
} from "../../lib/company-page-adapter";
import type { PlatformIdentity } from "../../lib/contracts";

const JOB_DETAIL_PATH = /^\/job\/\d+\/?$/u;
const ADVERTISER_SELECTOR = '[data-automation="advertiser-name"]';
const MOUNT_ANCHOR_ATTRIBUTE = "data-nz-aei-seek-job-anchor";
const MOUNT_ANCHOR_SELECTOR = `[${MOUNT_ANCHOR_ATTRIBUTE}]`;

function isSeekJobDetail(url: URL): boolean {
  return url.hostname === "nz.seek.com" && JOB_DETAIL_PATH.test(url.pathname);
}

function findAdvertiserName(): HTMLElement | null {
  const advertiser = document.querySelector<HTMLElement>(ADVERTISER_SELECTOR);
  return advertiser?.textContent?.trim() ? advertiser : null;
}

function normalizeName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}

function readIdentity(): PlatformIdentity | null {
  const advertiser = findAdvertiserName();
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
  if (existing?.isConnected) {
    return existing;
  }

  const advertiser = findAdvertiserName();
  if (advertiser === null) {
    return null;
  }

  const advertiserControl = advertiser.closest("button") ?? advertiser;
  const anchor = document.createElement("span");
  anchor.setAttribute(MOUNT_ANCHOR_ATTRIBUTE, "");
  advertiserControl.insertAdjacentElement("afterend", anchor);
  return anchor;
}

const adapter: CompanyPageAdapter = {
  id: "seek-job",
  mountAnchorSelector: MOUNT_ANCHOR_SELECTOR,
  isSupportedPage: isSeekJobDetail,
  getIdentity: readIdentity,
  ensureMountAnchor,
  removeMountAnchor() {
    document.querySelector(MOUNT_ANCHOR_SELECTOR)?.remove();
  },
};

export default defineContentScript({
  matches: ["https://nz.seek.com/job/*"],
  runAt: "document_idle",
  cssInjectionMode: "ui",

  main(ctx) {
    startCompanyPageAdapter(ctx, adapter);
  },
});
