import handler from "vinext/server/app-router-entry";
import { setRuntimeBindings } from "../app/lib/config";

interface Env {
  ASSETS: Fetcher;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

export default {
  fetch(request: Request, env: Env, context: ExecutionContext) {
    setRuntimeBindings(env as unknown as Record<string, unknown>);
    return handler.fetch(request, env, context);
  },
};
