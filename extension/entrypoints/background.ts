import { updateActionState } from "../lib/action-state";
import { getClientId } from "../lib/client-id";
import { isExtensionMessage, type LookupResponse } from "../lib/contracts";
import { associateEmployer, lookupEmployer } from "../lib/lookup";
import { isExtensionEnabled } from "../lib/settings";

export default defineBackground(() => {
  void isExtensionEnabled()
    .then(updateActionState)
    .catch((error: unknown) => {
      console.error("[NZ AEI] Could not update the toolbar state.", error);
    });

  browser.runtime.onMessage.addListener((message: unknown): Promise<LookupResponse> | undefined => {
    if (!isExtensionMessage(message)) {
      return undefined;
    }

    return isExtensionEnabled()
      .then((enabled) => {
        if (!enabled) {
          return {
            ok: false,
            error: {
              code: "extension_paused",
              message: "The Inspector is paused. Enable it from the toolbar, then refresh this page.",
              requestId: null,
            },
          } satisfies LookupResponse;
        }
        return getClientId().then((clientId) =>
          message.type === "check-employer"
            ? lookupEmployer(message.identity, clientId)
            : associateEmployer(message.identity, message.nzbn, clientId),
        );
      })
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
