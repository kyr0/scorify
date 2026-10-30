import { ArrangementOptions, SearchProgress, ArrangementResult } from './arrange.mjs';
import { Score } from './model.mjs';
import './profiles.mjs';
import './time-B3MQxqrT.mjs';
import './transforms.mjs';
import './fretted.mjs';
import './fingering.mjs';
import './adapters.mjs';

interface MessagePortLike {
    postMessage(message: unknown): void;
    addEventListener(type: "message", listener: (event: {
        data: unknown;
    }) => void): void;
    removeEventListener(type: "message", listener: (event: {
        data: unknown;
    }) => void): void;
}
type WorkerRequest = {
    type: "arrange";
    id: number;
    score: Score;
    options: ArrangementOptions;
} | {
    type: "cancel";
    id: number;
};
type WorkerResponse = {
    type: "result";
    id: number;
    result: ArrangementResult;
} | {
    type: "progress";
    id: number;
    progress: SearchProgress;
};
/** Install on a dedicated worker global or compatible message port. Returns cleanup. */
declare function installWorkerEndpoint(port: MessagePortLike): () => void;
interface ArrangementClient {
    arrange(score: Score, options?: ArrangementOptions, onProgress?: (progress: SearchProgress) => void): Promise<ArrangementResult>;
    cancel(): void;
    dispose(): void;
}
/** Latest request wins; superseded promises resolve cancelled and stale messages are ignored. */
declare function createWorkerClient(port: MessagePortLike): ArrangementClient;
/** Recompute from an immutable original; never compound simplifications between levels. */
declare function createArrangementSession(source: Score, options?: {
    readonly cacheSize?: number;
}): {
    recompute: (options: ArrangementOptions) => Promise<ArrangementResult>;
    cancel: () => void;
    clearCache: () => void;
};

export { createArrangementSession, createWorkerClient, installWorkerEndpoint };
export type { ArrangementClient, MessagePortLike, WorkerRequest, WorkerResponse };
//# sourceMappingURL=worker.d.mts.map
