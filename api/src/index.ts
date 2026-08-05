import { handleRequest } from "./http";

export default {
  async fetch(request, env, _ctx): Promise<Response> {
    return handleRequest(request, env);
  },
} satisfies ExportedHandler<Env>;
