import { SlpTokenGraph } from "./slptokengraph";
import { CacheMap } from "./cache";

type TokenId = string;
export type PruneStack = _PruningStack;
class _PruningStack {
    public static Instance(tokenGraphs?: Map<string, SlpTokenGraph>) {
        return this._instance || (this._instance = new _PruningStack(tokenGraphs));
    }
    private static _instance: _PruningStack;
    private _stack = new CacheMap<number, Map<TokenId, {txids: string[]}>>(10);
    private _graphs?: Map<string, SlpTokenGraph>;
    private constructor(tokenGraphs?: Map<string, SlpTokenGraph>) {
        if (!this._graphs) {
            if (!tokenGraphs) {
                throw Error("Must init PruneStack with token graphs object.");
            }
            this._graphs = tokenGraphs;
            let i = 0;
            while (this._stack.length !== 10) {
                this._stack.set(i++, new Map());
            }
        }
    }

    // This should be at start of block crawl().
    public newBlock(blockIndex: number): IterableIterator<TokenId>|null {
        let nextBlock = Array.from(this._stack.keys())[0];
        let pruneMap = this._stack.get(nextBlock);
        if (!pruneMap) {
            console.log(`[WARN] No pruneMap for ${nextBlock}.`);
            console.log(`[WARN] PruneStack Keys: ${Array.from(this._stack.keys())} before adding ${blockIndex}`);
            this._stack.set(blockIndex, new Map());
            return null;
        }
        console.log(`[INFO] Prune stack at ${blockIndex}, about to pop ${nextBlock}.`);
        this._considerPruningMap(pruneMap, blockIndex);
        this._stack.set(blockIndex, new Map());
        return pruneMap.keys();
    }

    // This should be internal to the SlpTokenGraph.
    public addGraphTxidToPruningStack(blockIndex: number, tokenId: string, txid: string) {
        if (!this._stack.has(blockIndex)) {
            throw Error("Prune stack implementation error, must call 'newBlock' first.");
        }
        let stackItem = this._stack.get(blockIndex);
        if (!stackItem!.has(tokenId)) {
            stackItem!.set(tokenId, { txids: []});
        }
        let tokenTxids = stackItem!.get(tokenId)!;
        tokenTxids.txids.push(txid);
    }

    private _considerPruningMap(pruneMap: Map<TokenId, {txids: string[]}>, pruneHeight: number) {
        for (let [tokenId, tokenTxids] of pruneMap) {
            let graph = this._graphs!.get(tokenId)!;
            graph.considerTxidsForPruning(tokenTxids.txids, pruneHeight);
        }
    }
}

// accessor to a singleton stack for pruning
export const PruneStack = _PruningStack.Instance;
