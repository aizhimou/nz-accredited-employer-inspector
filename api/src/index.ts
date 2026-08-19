import { handleRequest } from "./http";
import { publishOpenDataSnapshot } from "./open-data";
import { handlePublicApiRequest, isPublicApiRequest } from "./public-api";

export default {
  async fetch(request, env, ctx): Promise<Response> {
    if (isPublicApiRequest(request)) {
      return handlePublicApiRequest(request, env, ctx);
    }
    return handleRequest(request, env);
  },
  async scheduled(controller, env, _ctx): Promise<void> {
    try {
      const result = await publishOpenDataSnapshot(
        env.DB,
        env.OPEN_DATA_BUCKET,
        controller.scheduledTime,
      );
      console.log(JSON.stringify({
        message: "open-data snapshot schedule processed",
        ...result,
      }));
    } catch (error) {
      console.error(JSON.stringify({
        message: "open-data snapshot publication failed",
        error: error instanceof Error ? error.message : String(error),
      }));
      throw error;
    }
  },
} satisfies ExportedHandler<Env>;
