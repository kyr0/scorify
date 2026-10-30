import { installWorkerEndpoint } from "./worker.js";
import type { MessagePortLike } from "./worker.js";
const scope = globalThis as unknown as MessagePortLike;
if (
  typeof scope.addEventListener === "function" &&
  typeof scope.postMessage === "function"
)
  installWorkerEndpoint(scope);
