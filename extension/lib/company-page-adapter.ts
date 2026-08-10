import type { ContentScriptContext } from "wxt/utils/content-script-context";
import {
  mountCompanyWidget,
  type WidgetController,
} from "../entrypoints/linkedin-company.content/ui";
import type { PlatformIdentity } from "./contracts";
import { isExtensionEnabled } from "./settings";

export interface CompanyPageAdapter {
  id: string;
  mountLayout?: "inline" | "stacked";
  mountAnchorSelector: string;
  isSupportedPage(url: URL): boolean;
  getPanelLayout?(url: URL): "overlay" | "in-flow";
  getIdentity(): PlatformIdentity | null;
  ensureMountAnchor(): HTMLElement | null;
  removeMountAnchor(): void;
}

function waitForMountAnchor(
  adapter: CompanyPageAdapter,
  signal: AbortSignal,
): Promise<HTMLElement | null> {
  const existing = adapter.ensureMountAnchor();
  if (existing !== null || signal.aborted) {
    return Promise.resolve(existing);
  }

  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      const anchor = adapter.ensureMountAnchor();
      if (anchor !== null) {
        finish(anchor);
      }
    });

    const finish = (anchor: HTMLElement | null): void => {
      observer.disconnect();
      signal.removeEventListener("abort", onAbort);
      resolve(anchor);
    };
    const onAbort = (): void => finish(null);

    signal.addEventListener("abort", onAbort, { once: true });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  });
}

function identitySignature(identity: PlatformIdentity | null): string | null {
  return identity === null ? null : JSON.stringify(identity);
}

export function shouldRemountCompanyPageUi(
  mountedAnchor: HTMLElement,
  currentAnchor: HTMLElement | null,
  mountedUiConnected: boolean,
  mountedIdentitySignature: string | null,
  currentIdentitySignature: string | null,
): boolean {
  return (
    currentAnchor !== null &&
    (!mountedUiConnected ||
      currentAnchor !== mountedAnchor ||
      (mountedIdentitySignature !== null &&
        currentIdentitySignature !== null &&
        currentIdentitySignature !== mountedIdentitySignature))
  );
}

export function startCompanyPageAdapter(
  ctx: ContentScriptContext,
  adapter: CompanyPageAdapter,
): void {
  let removeActiveUi: (() => void) | undefined;
  let activeSync: AbortController | undefined;
  let mountedIdentitySignature: string | null = null;

  const syncUi = async (url: URL): Promise<void> => {
    activeSync?.abort();
    activeSync = new AbortController();
    const { signal } = activeSync;
    mountedIdentitySignature = null;
    removeActiveUi?.();
    removeActiveUi = undefined;
    adapter.removeMountAnchor();

    if (!adapter.isSupportedPage(url)) {
      return;
    }

    const mountedAnchor = await waitForMountAnchor(adapter, signal);
    if (mountedAnchor === null || signal.aborted) {
      return;
    }

    let mountedShadowHost: HTMLElement | null = null;
    const ui = await createShadowRootUi<WidgetController>(ctx, {
      name: `nz-aei-${adapter.id}`,
      position: "inline",
      anchor: adapter.mountAnchorSelector,
      append: "last",
      isolateEvents: true,
      onMount(container, _shadow, shadowHost) {
        mountedShadowHost = shadowHost;
        const stacked = adapter.mountLayout === "stacked";
        shadowHost.style.setProperty("display", "inline-block", "important");
        shadowHost.style.setProperty(
          "margin-inline-start",
          stacked ? "0" : "0.8rem",
          "important",
        );
        shadowHost.style.setProperty("position", "relative", "important");
        shadowHost.style.setProperty("vertical-align", "middle", "important");
        shadowHost.style.setProperty("z-index", "20", "important");
        const identity = adapter.getIdentity();
        mountedIdentitySignature = identitySignature(identity);
        return mountCompanyWidget(container, identity, {
          panelLayout: adapter.getPanelLayout?.(url) ?? "overlay",
        });
      },
      onRemove(controller) {
        controller?.destroy();
      },
    });

    if (signal.aborted) {
      ui.remove();
      return;
    }

    const anchorObserver = new MutationObserver(() => {
      if (
        !signal.aborted &&
        adapter.isSupportedPage(new URL(location.href))
      ) {
        const anchor = adapter.ensureMountAnchor();
        const currentIdentitySignature = identitySignature(adapter.getIdentity());
        if (
          shouldRemountCompanyPageUi(
            mountedAnchor,
            anchor,
            mountedShadowHost !== null &&
              mountedShadowHost.isConnected &&
              mountedShadowHost.parentElement === anchor,
            mountedIdentitySignature,
            currentIdentitySignature,
          )
        ) {
          runSync(new URL(location.href));
        }
      }
    });
    anchorObserver.observe(document.documentElement, { childList: true, subtree: true });

    removeActiveUi = () => {
      anchorObserver.disconnect();
      ui.remove();
      adapter.removeMountAnchor();
    };
    ui.autoMount();
  };

  const runSync = (url: URL): void => {
    void syncUi(url).catch((error: unknown) => {
      console.error(`[NZ AEI] Could not mount the ${adapter.id} widget.`, error);
    });
  };

  ctx.signal.addEventListener("abort", () => activeSync?.abort(), { once: true });
  void isExtensionEnabled().then((enabled) => {
    if (!enabled || ctx.signal.aborted) {
      return;
    }
    runSync(new URL(location.href));
    ctx.addEventListener(window, "wxt:locationchange", ({ newUrl }) => {
      runSync(newUrl);
    });
  });
}
