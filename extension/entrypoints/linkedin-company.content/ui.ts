import {
  type AccreditedEmployer,
  type AssociateEmployerMessage,
  type CheckEmployerMessage,
  isLookupResponse,
  type LookupResponse,
  type LookupSuccess,
  type PlatformIdentity,
} from "../../lib/contracts";

export interface WidgetController {
  destroy(): void;
}

const OFFICIAL_LIST_URL =
  "https://www.immigration.govt.nz/work/requirements-for-work-visas/approved-employers/accredited-employer-list/";

function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className !== undefined) {
    element.className = className;
  }
  if (text !== undefined) {
    element.textContent = text;
  }
  return element;
}

function clear(element: HTMLElement): void {
  element.replaceChildren();
}

function formatDate(value: string): string {
  const dateText = value.slice(0, 10);
  const [yearText, monthText, dayText] = dateText.split("-");
  const date = new Date(Date.UTC(Number(yearText), Number(monthText) - 1, Number(dayText)));
  return new Intl.DateTimeFormat("en-NZ", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatVerifiedAt(value: string): string {
  return new Intl.DateTimeFormat("en-NZ", {
    timeZone: "Pacific/Auckland",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function formatObservationAt(value: string): string {
  return new Intl.DateTimeFormat("en-NZ", {
    timeZone: "Pacific/Auckland",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function appendStamp(button: HTMLButtonElement, modifier: string): void {
  const stamp = createElement("span", `stamp ${modifier}`);
  stamp.setAttribute("aria-hidden", "true");
  button.append(stamp);
}

function appendChevron(button: HTMLButtonElement): void {
  const chevron = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  chevron.classList.add("chevron");
  chevron.setAttribute("viewBox", "0 0 16 16");
  chevron.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M4 6l4 4 4-4");
  chevron.append(path);
  button.append(chevron);
}

async function sendMessage(message: CheckEmployerMessage | AssociateEmployerMessage) {
  const response: unknown = await browser.runtime.sendMessage(message);
  if (!isLookupResponse(response)) {
    return {
      ok: false,
      error: {
        code: "invalid_background_response",
        message: "The extension background service returned an invalid response.",
        requestId: null,
      },
    } satisfies LookupResponse;
  }
  return response;
}

function createOfficialLink(): HTMLAnchorElement {
  const link = createElement("a", "official-link", "Check the official INZ list ↗");
  link.href = OFFICIAL_LIST_URL;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  return link;
}

export function mountCompanyWidget(
  container: HTMLElement,
  identity: PlatformIdentity | null,
): WidgetController {
  const root = createElement("div", "widget");
  const button = createElement("button", "check-button idle") as HTMLButtonElement;
  button.type = "button";
  button.setAttribute("aria-haspopup", "dialog");
  button.setAttribute("aria-expanded", "false");

  const panel = createElement("section", "result-panel");
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "New Zealand employer accreditation result");

  const liveRegion = createElement("span", "sr-only");
  liveRegion.setAttribute("aria-live", "polite");
  root.append(button, panel, liveRegion);
  container.append(root);

  let loading = false;
  let hasResult = false;

  const setPanelOpen = (open: boolean): void => {
    panel.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
  };

  const renderIdle = (): void => {
    clear(button);
    button.className = "check-button idle";
    button.disabled = identity === null;
    appendStamp(button, identity === null ? "error" : "idle");
    button.append(
      createElement(
        "span",
        "button-label",
        identity === null ? "Company identity unavailable" : "Check NZ accreditation",
      ),
    );
    setPanelOpen(false);
  };

  const renderLoading = (label = "Checking INZ…"): void => {
    clear(button);
    button.className = "check-button loading";
    const spinner = createElement("span", "spinner");
    spinner.setAttribute("aria-hidden", "true");
    button.append(spinner, createElement("span", "button-label", label));
    button.disabled = true;
    setPanelOpen(false);
    liveRegion.textContent = label;
  };

  const renderEmployer = (
    employer: AccreditedEmployer,
    selectedNzbn: string | null,
    onSelect: (nzbn: string) => void,
  ): HTMLElement => {
    const selected = employer.nzbn === selectedNzbn;
    const row = createElement("li", `result-row ${selected ? "selected" : ""}`);
    const dot = createElement(
      "span",
      `result-dot ${employer.accreditationStatus === "accredited" ? "current" : "expired"}`,
    );
    dot.setAttribute("aria-hidden", "true");

    const content = createElement("div", "result-content");
    const titleLine = createElement("div", "employer-title-line");
    titleLine.append(createElement("strong", "employer-name", employer.employerName));
    if (selected) {
      titleLine.append(createElement("span", "selected-label", "Associated"));
    }
    content.append(titleLine);
    if (employer.tradingName !== null) {
      content.append(createElement("span", "trading-name", `Trading Name: ${employer.tradingName}`));
    }

    const metadata = createElement("div", "result-metadata");
    metadata.append(createElement("span", "nzbn", `NZBN ${employer.nzbn}`));
    metadata.append(
      createElement(
        "span",
        employer.accreditationStatus === "accredited" ? "expiry current" : "expiry expired",
        employer.accreditationStatus === "accredited"
          ? `Accredited to ${formatDate(employer.expiryDateOfAccreditation)}`
          : `Expired ${formatDate(employer.expiryDateOfAccreditation)}`,
      ),
    );
    content.append(metadata);
    content.append(
      createElement("span", "verified-at", `INZ data verified ${formatVerifiedAt(employer.lastVerifiedAt)}`),
    );

    if (!selected) {
      const select = createElement("button", "associate-button", "Use this employer");
      select.type = "button";
      select.addEventListener("click", () => onSelect(employer.nzbn));
      content.append(select);
    }
    row.append(dot, content);
    return row;
  };

  const renderError = (response: Extract<LookupResponse, { ok: false }>): void => {
    clear(button);
    button.disabled = false;
    button.className = "check-button error";
    appendStamp(button, "error");
    button.append(createElement("span", "button-label", "Try again"));

    clear(panel);
    panel.append(
      createElement("strong", "error-title", "Couldn’t check accreditation"),
      createElement("p", "error-message", response.error.message),
      createOfficialLink(),
    );
    if (response.error.requestId !== null) {
      panel.append(createElement("code", "request-id", `Request ${response.error.requestId}`));
    }
    hasResult = false;
    liveRegion.textContent = response.error.message;
    setPanelOpen(true);
  };

  const renderSuccess = (response: LookupSuccess): void => {
    const selected = response.data.selectedEmployer;
    const noPublished =
      response.liveLookupStatus === "no_published_inz_match" ||
      response.data.state === "no_published_inz_match";
    const needsReview =
      response.liveLookupStatus === "verification_required" ||
      response.data.state === "refresh_required";
    const needsConfirmation = response.data.state === "confirmation_required";

    clear(button);
    button.disabled = false;
    let buttonLabel: string;
    let modifier: string;
    if (needsReview) {
      buttonLabel = "Live verification needs review";
      modifier = "not-found";
    } else if (noPublished) {
      buttonLabel = "No published INZ match";
      modifier = "not-found";
    } else if (needsConfirmation) {
      buttonLabel = "Confirm employer match";
      modifier = "not-found";
    } else if (selected?.accreditationStatus === "accredited") {
      buttonLabel = "Accredited in NZ";
      modifier = "accredited";
    } else {
      buttonLabel = "Accreditation expired";
      modifier = "error";
    }
    button.className = `check-button result ${modifier}`;
    appendStamp(button, modifier);
    button.append(createElement("span", "button-label", buttonLabel));
    appendChevron(button);

    clear(panel);
    const header = createElement("header", "panel-header");
    const heading = createElement("div", "panel-heading-group");
    heading.append(
      createElement("span", "panel-kicker", "NZ accredited employer"),
      createElement("strong", "panel-title", response.identity.displayName),
    );
    header.append(
      heading,
      createElement(
        "span",
        "source-badge",
        noPublished && response.data.noMatch !== null
          ? "24h INZ check"
          : response.liveLookupStatus === "updated"
            ? "Live INZ"
            : "Shared data",
      ),
    );
    panel.append(header);

    if (response.data.association !== null) {
      const association = response.data.association;
      const source = association.source === "self"
        ? "Your confirmed association"
        : association.source === "community"
          ? `${association.confirmationCount} community confirmation${association.confirmationCount === 1 ? "" : "s"}`
          : "Community confirmations are tied";
      const provenance = createElement("div", "provenance association-provenance");
      provenance.append(
        createElement("strong", "provenance-label", "Platform association"),
        createElement(
          "span",
          "provenance-value",
          `${source}${association.identityStrength === "weak" ? " · based on advertiser name" : ""}`,
        ),
      );
      if (association.disputed) {
        provenance.append(
          createElement("span", "provenance-warning", "Other users selected a different NZBN."),
        );
      }
      panel.append(provenance);
    }

    if (noPublished && response.data.noMatch !== null) {
      const noMatch = response.data.noMatch;
      const provenance = createElement("div", "provenance no-match-provenance");
      provenance.append(
        createElement("strong", "provenance-label", "INZ name lookup"),
        createElement(
          "span",
          "provenance-value",
          `No published match · Checked ${formatObservationAt(noMatch.checkedAt)}`,
        ),
        createElement(
          "span",
          "provenance-warning",
          `A live lookup will be available after ${formatObservationAt(noMatch.expiresAt)}.`,
        ),
      );
      panel.append(provenance);
    }

    if (noPublished) {
      panel.append(
        createElement(
          "p",
          "empty-state",
          "INZ returned no published match for this company name. This is not proof that the employer is unaccredited; verify the legal name or ask the employer directly.",
        ),
      );
    } else if (needsReview) {
      panel.append(
        createElement(
          "p",
          "warning",
          response.liveLookupStatus === "verification_required"
            ? "INZ returned no published match when refreshing the associated NZBN. The older record below was not deleted or silently treated as current."
            : "The live response did not verify the associated NZBN. Review the dated record and confirm it on the official INZ list.",
        ),
      );
    } else if (needsConfirmation) {
      panel.append(
        createElement(
          "p",
          "confirmation-note",
          "INZ names and this page’s company name may differ. Choose the correct legal employer; this association is community data and can be changed later.",
        ),
      );
    }

    const visibleCandidates = response.data.candidates;
    if (visibleCandidates.length > 0) {
      const list = createElement("ul", "result-list");
      for (const employer of visibleCandidates) {
        list.append(
          renderEmployer(employer, selected?.nzbn ?? null, (nzbn) => {
            void runAssociation(nzbn);
          }),
        );
      }
      panel.append(list);
    }

    const footer = createElement("footer", "panel-footer");
    footer.append(
      createElement("span", "footer-note", "Official accreditation data · Community association"),
      createOfficialLink(),
    );
    panel.append(footer);

    hasResult = true;
    liveRegion.textContent = buttonLabel;
    setPanelOpen(true);
  };

  const runAssociation = async (nzbn: string): Promise<void> => {
    if (loading || identity === null) {
      return;
    }
    loading = true;
    renderLoading("Saving association…");
    try {
      const response = await sendMessage({ type: "associate-employer", identity, nzbn });
      response.ok ? renderSuccess(response) : renderError(response);
    } catch {
      renderError({
        ok: false,
        error: {
          code: "background_unavailable",
          message: "The extension background service is unavailable. Reload the page and try again.",
          requestId: null,
        },
      });
    } finally {
      loading = false;
      button.disabled = false;
    }
  };

  const runLookup = async (): Promise<void> => {
    if (loading || identity === null) {
      return;
    }
    loading = true;
    hasResult = false;
    renderLoading();
    try {
      const response = await sendMessage({ type: "check-employer", identity });
      response.ok ? renderSuccess(response) : renderError(response);
    } catch {
      renderError({
        ok: false,
        error: {
          code: "background_unavailable",
          message: "The extension background service is unavailable. Reload the page and try again.",
          requestId: null,
        },
      });
    } finally {
      loading = false;
      button.disabled = false;
    }
  };

  const onButtonClick = (): void => {
    if (hasResult) {
      setPanelOpen(panel.hasAttribute("hidden"));
      return;
    }
    void runLookup();
  };

  button.addEventListener("click", onButtonClick);
  renderIdle();

  return {
    destroy() {
      button.removeEventListener("click", onButtonClick);
      root.remove();
    },
  };
}
