import type { ContentScriptContext } from "wxt/utils/content-script-context";
import {
  mountCompanyWidget,
  type WidgetController,
} from "../entrypoints/linkedin-company.content/ui";
import type { PlatformIdentity } from "./contracts";

export interface CompanyPageAdapter {
  id: string;
  mountAnchorSelector: string;
  isSupportedPage(url: URL): boolean;
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

export function startCompanyPageAdapter(
  ctx: ContentScriptContext,
  adapter: CompanyPageAdapter,
): void {
  let removeActiveUi: (() => void) | undefined;
  let activeSync: AbortController | undefined;

  const syncUi = async (url: URL): Promise<void> => {
    activeSync?.abort();
    activeSync = new AbortController();
    const { signal } = activeSync;
    removeActiveUi?.();
    removeActiveUi = undefined;
    adapter.removeMountAnchor();

    if (!adapter.isSupportedPage(url)) {
      return;
    }

    if (await waitForMountAnchor(adapter, signal) === null || signal.aborted) {
      return;
    }

    const ui = await createShadowRootUi<WidgetController>(ctx, {
      name: `nz-aei-${adapter.id}`,
      position: "inline",
      anchor: adapter.mountAnchorSelector,
      append: "last",
      isolateEvents: true,
      onMount(container, _shadow, shadowHost) {
        shadowHost.style.setProperty("display", "inline-block", "important");
        shadowHost.style.setProperty("margin-inline-start", "0.8rem", "important");
        shadowHost.style.setProperty("position", "relative", "important");
        shadowHost.style.setProperty("vertical-align", "middle", "important");
        shadowHost.style.setProperty("z-index", "20", "important");
        return mountCompanyWidget(
          container,
          adapter.getIdentity(),
        );
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
        adapter.ensureMountAnchor();
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
  runSync(new URL(location.href));
  ctx.addEventListener(window, "wxt:locationchange", ({ newUrl }) => {
    runSync(newUrl);
  });
}
