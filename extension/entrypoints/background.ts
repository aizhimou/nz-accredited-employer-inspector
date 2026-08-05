import { getClientId } from "../lib/client-id";
import { isExtensionMessage, type LookupResponse } from "../lib/contracts";
import { associateEmployer, lookupEmployer } from "../lib/lookup";

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message: unknown): Promise<LookupResponse> | undefined => {
    if (!isExtensionMessage(message)) {
      return undefined;
    }

    return getClientId()
      .then((clientId) =>
        message.type === "check-employer"
          ? lookupEmployer(message.identity, clientId)
          : associateEmployer(message.identity, message.nzbn, clientId),
      )
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
