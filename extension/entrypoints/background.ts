import { updateActionState } from "../lib/action-state";
import { getClientId } from "../lib/client-id";
import {
  type EmployerSearchResponse,
  type ExtensionMessage,
  isExtensionMessage,
  type LookupResponse,
} from "../lib/contracts";
import { associateEmployer, lookupEmployer, searchEmployers } from "../lib/lookup";
import { isExtensionEnabled } from "../lib/settings";

type ExtensionResponse = LookupResponse | EmployerSearchResponse;

async function handleExtensionMessage(message: ExtensionMessage): Promise<ExtensionResponse> {
  const enabled = await isExtensionEnabled();
  if (!enabled) {
    return {
      ok: false,
      error: {
        code: "extension_paused",
        message: "The Inspector is paused. Enable it from the toolbar, then refresh this page.",
        requestId: null,
      },
    };
  }

  const clientId = await getClientId();
  if (message.type === "check-employer") {
    return lookupEmployer(message.identity, clientId);
  }
  if (message.type === "search-employers") {
    return searchEmployers(message.identity, message.query, clientId);
  }
  return associateEmployer(message.identity, message.nzbn, clientId);
}

export default defineBackground(() => {
  void isExtensionEnabled()
    .then(updateActionState)
    .catch((error: unknown) => {
      console.error("[NZ AEI] Could not update the toolbar state.", error);
    });

  browser.runtime.onMessage.addListener((
    message: unknown,
  ): Promise<LookupResponse | EmployerSearchResponse> | undefined => {
    if (!isExtensionMessage(message)) {
      return undefined;
    }

    return handleExtensionMessage(message)
      .catch(() => ({
        ok: false,
        error: {
          code: "client_id_unavailable",
          message: "Could not initialize the extension client ID.",
          requestId: null,
        },
      }));
  });
});
