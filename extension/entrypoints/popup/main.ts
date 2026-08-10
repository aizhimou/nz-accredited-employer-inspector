import { updateActionState } from "../../lib/action-state";
import {
  isExtensionEnabled,
  setExtensionEnabled,
} from "../../lib/settings";

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`The popup is missing ${selector}.`);
  }
  return element;
}

const toggle = requiredElement<HTMLInputElement>("#enabled-toggle");
const statusTitle = requiredElement<HTMLElement>("#status-title");
const statusDescription = requiredElement<HTMLElement>("#status-description");
const refreshNote = requiredElement<HTMLElement>("#refresh-note");
const saveError = requiredElement<HTMLElement>("#save-error");
const version = requiredElement<HTMLElement>("#extension-version");

let savedEnabled = true;

function renderState(enabled: boolean): void {
  document.body.dataset.enabled = String(enabled);
  toggle.checked = enabled;
  statusTitle.textContent = enabled ? "Inspector enabled" : "Inspector paused";
  statusDescription.textContent = enabled
    ? "Active on supported job sites."
    : "Paused. No new accreditation checks will run.";
}

async function initialise(): Promise<void> {
  savedEnabled = await isExtensionEnabled();
  renderState(savedEnabled);
  const manifestVersion = browser.runtime?.getManifest().version;
  if (manifestVersion !== undefined) {
    version.textContent = `v${manifestVersion}`;
  }
}

toggle.addEventListener("change", () => {
  const nextEnabled = toggle.checked;
  toggle.disabled = true;
  refreshNote.hidden = true;
  saveError.hidden = true;

  void setExtensionEnabled(nextEnabled)
    .then(async () => {
      savedEnabled = nextEnabled;
      renderState(savedEnabled);
      refreshNote.hidden = false;
      try {
        await updateActionState(savedEnabled);
      } catch (error) {
        console.error("[NZ AEI] Could not update the toolbar state.", error);
      }
    })
    .catch(() => {
      renderState(savedEnabled);
      saveError.hidden = false;
    })
    .finally(() => {
      toggle.disabled = false;
    });
});

void initialise();
