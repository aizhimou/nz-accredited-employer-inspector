import widgetCss from "../entrypoints/linkedin-company.content/style.css?inline";
import type { LookupResponse } from "../lib/contracts";

const previewResponse: LookupResponse = {
  ok: true,
  identity: {
    platform: "linkedin",
    externalKey: "company:onenz",
    kind: "linkedin_company_url",
    strength: "strong",
    displayName: "One New Zealand",
    publicUrl: "https://www.linkedin.com/company/onenz/",
  },
  liveLookupStatus: "not_needed",
  requestId: "preview-request",
  data: {
    state: "associated",
    matchMethod: "platform_association",
    selectedEmployer: {
      employerName: "ONE NEW ZEALAND GROUP LIMITED",
      tradingName: "One New Zealand",
      nzbn: "9429034908822",
      expiryDateOfAccreditation: "2027-08-04T00:00:00",
      lastVerifiedAt: "2026-08-04T09:00:00.000Z",
      accreditationStatus: "accredited",
    },
    candidates: [
      {
        employerName: "ONE NEW ZEALAND GROUP LIMITED",
        tradingName: "One New Zealand",
        nzbn: "9429034908822",
        expiryDateOfAccreditation: "2027-08-04T00:00:00",
        lastVerifiedAt: "2026-08-04T09:00:00.000Z",
        accreditationStatus: "accredited",
      },
    ],
    association: {
      nzbn: "9429034908822",
      source: "self",
      confirmationCount: 1,
      alternativeConfirmationCount: 0,
      disputed: false,
      identityStrength: "strong",
    },
    noMatch: null,
    inzQuery: null,
  },
};

Object.defineProperty(globalThis, "browser", {
  configurable: true,
  value: {
    runtime: {
      sendMessage: async (): Promise<LookupResponse> => previewResponse,
    },
  },
});

const host = document.querySelector<HTMLElement>("#widget-host");
if (host === null) {
  throw new Error("Preview host is missing.");
}

const shadow = host.attachShadow({ mode: "open" });
const style = document.createElement("style");
style.textContent = widgetCss;
const container = document.createElement("div");
shadow.append(style, container);

const { mountCompanyWidget } = await import(
  "../entrypoints/linkedin-company.content/ui"
);
mountCompanyWidget(container, previewResponse.ok ? previewResponse.identity : null);
