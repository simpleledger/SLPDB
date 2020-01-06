import { SlpTokenGraph } from "./slptokengraph";
import { TokenDBObject, UtxoDbo, AddressBalancesDbo, GraphTxnDbo } from "./interfaces";
import { SlpTransactionType, Slp, SlpTransactionDetails, Primatives } from "slpjs";
import { SyncCompletionInfo, SyncFilterTypes, txid, txhex, SyncType, Bit } from "./bit";
import { Query } from "./query";
import { BITBOX } from 'bitbox-sdk';
import * as bitcore from 'bitcore-lib-cash';
import { Db } from './db';
import { Config } from "./config";
import { TNATxn } from "./tna";
import { Decimal128 } from "mongodb";
import * as zmq from 'zeromq';
import { Info } from "./info";
import * as pQueue from 'p-queue';

const Block = require('bcash/lib/primitives/block');
const BufferReader = require('bufio/lib/reader');

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

import { RpcClient } from './rpc';
import { CacheSet, CacheMap } from "./cache";
import { SlpdbStatus } from "./status";
import { TokenFilter } from "./filters";
import { GraphMap } from "./graphmap";

const bitcoin = new BITBOX();

export class SlpGraphManager {
    slp = new Slp(bitcoin);
    db: Db;
    _tokens!: Map<string, SlpTokenGraph>;
    zmqPubSocket?: zmq.Socket;
    _zmqMempoolPubSetList = new CacheSet<string>(1000);
    _TnaQueue?: pQueue<pQueue.DefaultAddOptions>;
    //_startupQueue = new pQueue<pQueue.DefaultAddOptions>({ concurrency: 4, autoStart: true })
    _updatesQueue = new pQueue<pQueue.DefaultAddOptions>({ concurrency: 1, autoStart: false });
    _bestBlockHeight: number;
    _network: string;
    _startupTokenCount: number;
    _bit: Bit;
    _filter: TokenFilter;
    _exit = false;
    _cacheGraphTxnCount = 0;

    get TnaSynced(): boolean {
        if(this._TnaQueue)
            return (this._TnaQueue.size === 0 && this._TnaQueue.pending === 0)
        else 
            return true;
    }

    async getTokenGraph(tokenIdHex: string, tokenDetailsForGenesis?: SlpTransactionDetails): Promise<SlpTokenGraph|null> {
        if(!this._tokens.has(tokenIdHex)) {
            if (!tokenDetailsForGenesis || tokenDetailsForGenesis.transactionType !== SlpTransactionType.GENESIS) {
                throw Error("Token details for a new token GENESIS must be provided.");
            }
            let graph = new SlpTokenGraph(tokenDetailsForGenesis, this.db, this, this._network);
            if (!(await graph.IsValid())) {
                return null;
            }
            this._tokens.set(tokenIdHex, graph);
        }
        return this._tokens.get(tokenIdHex)!;
    }

    async onTransactionHash(syncResult: SyncCompletionInfo): Promise<void> {
        let self = this;
        await this._updatesQueue.add(async function() {
            await self._onTransactionHash(syncResult);
        })
    }

    async onBlockHash(hash: string): Promise<void> {
        this._bestBlockHeight = (await Info.getBlockCheckpoint()).height;
        let self = this;
        await this._updatesQueue.add(async function() {
            await self._onBlockHash(hash);
        })
    }

    async _onTransactionHash(syncResult: SyncCompletionInfo): Promise<void> {
        if(syncResult && syncResult.filteredContent.size > 0) {
            let txns = Array.from(syncResult.filteredContent.get(SyncFilterTypes.SLP)!);
            for (let txPair of txns) {
                console.log("[INFO] Processing possible SLP txn:", txPair[0]);
                let tokenDetails = this.parseTokenTransactionDetails(txPair[1]);
                let tokenId = tokenDetails ? tokenDetails.tokenIdHex : null;

                // check token filters
                if(tokenId && !this._filter.passesAllFilterRules(tokenId)) {
                    console.log("[INFO] Transaction does not pass token filter:", txPair[0]);
                    return;
                }

                // Based on Txn output OP_RETURN data, update graph for the tokenId 
                if(tokenId) {
                    if(!this._tokens.has(tokenId)) {
                        console.log("[INFO] Creating new token graph for tokenId:", tokenId);
                        await this.createNewTokenGraph({ tokenId });
                    }
                    else {
                        console.log(`[INFO] (_onTransactionHash) Queued graph update at ${txPair[0]} for ${tokenId}`);
                        this._tokens.get(tokenId)!.queueUpdateForTokenGraphAt({ txid: txPair[0] } );
                    }
                } else {
                    console.log("[INFO] Skipping: TokenId is being filtered.");
                }
            }
        }
    }

    async simulateOnTransactionHash(txid: string) {
        let txhex = <txhex>await RpcClient.getRawTransaction(txid);
        let txmap = new Map<txid, txhex>();
        txmap.set(txid, txhex);
        let content = new Map<SyncFilterTypes, Map<txid, txhex>>();
        content.set(SyncFilterTypes.SLP, txmap);
        let syncRes = { syncType: SyncType.Mempool, filteredContent: content }
        await this.onTransactionHash(syncRes);
    }

    private parseTokenTransactionDetails(txn_hex: string): SlpTransactionDetails|null {
        let txn = new bitcore.Transaction(txn_hex);

        let tokenDetails: SlpTransactionDetails|null;
        try {
            tokenDetails = this.slp.parseSlpOutputScript(txn.outputs[0]._scriptBuffer);
        }
        catch (err) {
            tokenDetails = null;
        }
        if (tokenDetails && tokenDetails.transactionType === SlpTransactionType.GENESIS)
            tokenDetails.tokenIdHex = txn.id;
        
        return tokenDetails;
    }

    async _onBlockHash(hash: string): Promise<void> {
        // NOTE: When _onBlockHash happens the block has already been crawled (in bit.ts), 
        //      and all of the transactions have already been added to the confirmed collection.
        //      the purpose of this method is to trigger updates in the graphs, addresses, utxos collections.

        while(!this.TnaSynced) {
            console.log("[INFO] At _onBlockHash() - Waiting for TNA sync to complete before we update tokens included in block.");
            await sleep(1000);
        }
        let block = await Query.getTransactionsForBlock(hash);
        if(block) {
            // update tokens collection timestamps on confirmation for Genesis transactions
            let genesisBlockTxns = await Query.getGenesisTransactionsForBlock(hash);
            if(genesisBlockTxns) {
                for(let i = 0; i < genesisBlockTxns.txns.length; i++) {
                    let token = this._tokens.get(genesisBlockTxns.txns[i]);
                    if(token)
                        token._tokenDetails.timestamp = genesisBlockTxns.timestamp!;
                }
            }

            // TODO: NEED TO LOOP THROUGH ALL BLOCK TRANSACTIONS TO UPDATE BLOCK HASH
            let blockTxids = new Set<string>([...block.txns.map(i => i.txid)]);
            for(let i = 0; i < block.txns.length; i++) {
                let tokenDetails;
                try {
                    tokenDetails = this.parseTokenTransactionDetails(await RpcClient.getRawTransaction(block.txns[i]!.txid));
                } catch(err) {
                    console.log(`[ERROR] Could not get transaction ${block.txns[i]!.txid} in _onBlockHash: ${err}`)
                    continue;
                }
                let tokenId = tokenDetails ? tokenDetails.tokenIdHex : null;
                if(tokenId && this._tokens.has(tokenId)) {
                    let token = this._tokens.get(tokenId)!;
                    console.log(`[INFO] (_onBlockHash) Queued graph update at ${block.txns[i]!.txid} for ${tokenId}`);
                    token.queueUpdateForTokenGraphAt({ txid: block.txns[i]!.txid, block: { hash: Buffer.from(hash, 'hex'), transactions: blockTxids } });
                } else if(tokenId && tokenDetails!.transactionType === SlpTransactionType.GENESIS) {
                    await this.createNewTokenGraph({ tokenId });
                }
            }

            // zmq publish block events
            if(this.zmqPubSocket && Config.zmq.outgoing.enable) {
                console.log("[ZMQ-PUB] SLP block txn notification", hash);
                this.zmqPubSocket.send([ 'block', JSON.stringify(block) ]);
                SlpdbStatus.updateTimeOutgoingBlockZmq();
            }
            await this.fixMissingTokenTimestamps();

        }
        // DO NOT AWAIT: Search for any burned transactions 
        this.searchBlockForBurnedSlpTxos(hash);   // NOTE: We need to make sure this is also done on initial block sync.
        SlpdbStatus.updateSlpProcessedBlockHeight(this._bestBlockHeight);
    }

    constructor(db: Db, currentBestHeight: number, network: string, bit: Bit, filter: TokenFilter = new TokenFilter()) {
        this.db = db;
        this._bestBlockHeight = currentBestHeight;
        this._network = network;
        this._tokens = new Map<string, SlpTokenGraph>();
        this._bit = bit;
        this._filter = filter;
        let self = this;
        this._startupTokenCount = 0
        // this._startupQueue.on('active', () => {
        //     console.log(`[INFO] Loading new token.  Loaded: ${self._startupTokenCount++}.  Total: ${this._tokens.size}.  Queue Size: ${this._startupQueue.size}.  Queue Pending: ${this._startupQueue.pending}`);
        // })
    }

    async fixMissingTokenTimestamps() {
        let tokens = await Query.queryForConfirmedTokensMissingTimestamps();
        if(tokens) {
            for (let token of tokens) {
                console.log("[INFO] Checking for missing timestamps for:", token.txid, token.blk.t);
                let timestamp = SlpTokenGraph.FormatUnixToDateString(token.blk.t);
                if (timestamp && this._tokens.has(token.txid)) {
                    let t = this._tokens.get(token.txid)!;
                    t._tokenDetails.timestamp = timestamp;
                    t._tokenStats.block_created = token.blk.i;
                    t.UpdateStatistics();
                } else {
                    await this.createNewTokenGraph({ tokenId: token.txid })
                    await this.fixMissingTokenTimestamps();
                }
            }
        }
        return tokens;
    }

    async searchForNonSlpBurnTransactions() {
        for (let a of this._tokens) {
            await a[1].searchForNonSlpBurnTransactions();
        }
    }

    async searchBlockForBurnedSlpTxos(block_hash: string) {
        console.log('[INFO] Starting to look for any burned tokens resulting from non-SLP transactions');
        let blockHex = <string>await RpcClient.getRawBlock(block_hash);
        let block = Block.fromReader(new BufferReader(Buffer.from(blockHex, 'hex')));
        let graphPromises: Promise<void>[] = [];
        console.time("BlockSearchForBurn-"+block_hash);
        for(let i=1; i < block.txs.length; i++) { // skip coinbase with i=1
            let txnbuf: Buffer = block.txs[i].toRaw();
            let txn: Primatives.Transaction = Primatives.Transaction.parseFromBuffer(txnbuf);
            let inputs: Primatives.TransactionInput[] = txn.inputs;
            for(let j=0; j < inputs.length; j++) {
                let txid: string = inputs[j].previousTxHash!;
                let vout = inputs[j].previousTxOutIndex.toString();
                let graph: SlpTokenGraph|undefined;
                let send_txo: UtxoDbo|undefined;
                this._tokens.forEach(t => {
                    if(t._tokenUtxos.has(txid + ":" + vout)) {
                        send_txo = t.utxoToUtxoDbo(txid, vout);
                        return;
                    }
                });
                if (send_txo) {
                    console.log("Potential burned transaction found (" + txid + ":" + vout + ")");
                    let tokenId = send_txo.tokenDetails.tokenIdHex;
                    graph = this._tokens.get(tokenId);
                    if (graph) {
                        console.log(`[INFO] (searchBlockForBurnedSlpTxos) Queued graph update at ${txid} for ${tokenId}`);
                        graph.queueUpdateForTokenGraphAt({ txid, isParent: true });
                        graphPromises.push(graph._graphUpdateQueue.onIdle());
                    }
                    continue;
                }
                let mint_txo: TokenDBObject|undefined;
                this._tokens.forEach(t => {
                    if(t._mintBatonUtxo === txid + ":" + vout) {
                        mint_txo = GraphMap.tokenDetailstoDbo(t);
                        return;
                    }
                })
                if(mint_txo) {
                    console.log("Potential burned minting transaction found (" + txid + ":" + vout + ")");
                    let tokenId = mint_txo.tokenDetails.tokenIdHex;
                    graph = this._tokens.get(tokenId);
                    if(graph) {
                        console.log(`[INFO] (searchBlockForBurnedSlpTxos 2) Queued graph update at ${txid} for ${tokenId}`);
                        graph.queueUpdateForTokenGraphAt({ txid, isParent: true });
                        graphPromises.push(graph._graphUpdateQueue.onIdle());
                    }
                    continue;
                }
            }
        }
        console.timeEnd("BlockSearchForBurn-"+block_hash);
        console.time("BlockBurnQueueWait-"+block_hash);
        await Promise.all(graphPromises);
        console.timeEnd("BlockBurnQueueWait-"+block_hash);
        console.log('[INFO] Finished looking for burned tokens.');
    }


    static MapTokenDetailsToTnaDbo(details: SlpTransactionDetails, genesisDetails: SlpTransactionDetails, addresses: (string|null)[]): SlpTransactionDetailsTnaDbo {
        var outputs: any|null = null;
        if(details.sendOutputs) {
            outputs = [];
            details.sendOutputs.forEach((o,i) => {
                if(i > 0)
                    outputs.push({ address: addresses[i], amount: Decimal128.fromString(o.dividedBy(10**genesisDetails.decimals).toFixed())})
            })
        }
        if(details.genesisOrMintQuantity) {
            outputs = [];
            outputs.push({ address: addresses[0], amount: Decimal128.fromString(details.genesisOrMintQuantity!.dividedBy(10**genesisDetails.decimals).toFixed()) })
        }
        let res: SlpTransactionDetailsTnaDbo = {
            decimals: genesisDetails.decimals,
            tokenIdHex: details.tokenIdHex,
            transactionType: details.transactionType,
            versionType: genesisDetails.versionType,
            documentUri: genesisDetails.documentUri,
            documentSha256Hex: genesisDetails.documentSha256 ? genesisDetails.documentSha256.toString('hex')! : null,
            symbol: genesisDetails.symbol,
            name: genesisDetails.name,
            txnBatonVout: details.batonVout,
            txnContainsBaton: details.containsBaton ? true : false,
            outputs: outputs
        }
        return res;
    }

    async initAllTokenGraphs() {
        let tokens = await this.db.tokenFetchAll();
        let pruningCutoff = Config.db.pruning ? await (await Info.getBlockCheckpoint()).height - Config.db.block_sync_graph_update_interval - 1 : undefined;
        if (tokens) {
            for (let token of tokens) {
                await this.loadTokenFromDb(token, pruningCutoff);
            }
        }
    }

    async loadTokenFromDb(tokenDbo: TokenDBObject, pruneCutoffHeight?: number) {
        let tokenId = tokenDbo.tokenDetails.tokenIdHex;
        console.log("########################################################################################################");
        console.log(`LOAD FROM DB: ${tokenId}`);
        console.log("########################################################################################################");
        let utxos: UtxoDbo[] = await this.db.utxoFetch(tokenId);
        let unspentDag: GraphTxnDbo[] = await this.db.graphFetch(tokenId, pruneCutoffHeight);
        this._cacheGraphTxnCount += unspentDag.length;
        console.log(`Total loaded: ${this._cacheGraphTxnCount}, using a pruning cutoff height of: ${pruneCutoffHeight} `);
        return await SlpTokenGraph.initFromDbos(tokenDbo, unspentDag, utxos, this, this._network);
    }

    // async updateAllTokenGraphs({ reprocessFrom, reprocessTo, loadFromDb = true, allowGraphUpdates = true, onComplete }: { reprocessFrom?: number; reprocessTo?: number; loadFromDb?: boolean; allowGraphUpdates?: boolean; onComplete?: ()=>any } = {}) {
    //     //let tokens: SlpTransactionDetails[];
    //     // let tokenIds: Set<string>|undefined;
    //     // if(this._filter._rules.size > 0) {
    //     //     tokenIds = new Set<string>();
    //     //     this._filter._rules.forEach(f => {
    //     //         if(f.type === 'include-single' && !tokenIds!.has(f.info))
    //     //             tokenIds!.add(f.info);
    //     //     });
    //     // }
    //     // if(!tokenIds) {
    //     //     tokens = await Query.queryTokensList();
    //     // }
    //     // else {
    //     //     let results = Array.from(tokenIds).map(async id => { return await Query.queryTokensList(id) });
    //     //     tokens = (await Promise.all(results)).flat();
    //     // }

    //     let size = () => { return this._tokens.size; }
    //     await SlpdbStatus.changeStateToStartupSlpProcessing({
    //         getSlpTokensCount: size
    //     });

    //     // Instantiate all Token Graphs in memory
    //     let self = this;
    //     for (let [tokenId, _] of this._tokens) {
    //         this._startupQueue.add(async function() {
    //             await self.updateTokenGraph({ tokenId, reprocessFrom, reprocessTo, loadFromDb, allowGraphUpdates });
    //         });
    //     }

    //     if(onComplete) {
    //         onComplete();
    //     }
    // }

    public async updateTokenIds({ tokenStacks, from, upTo }: { tokenStacks: CacheMap<string, string[]>, from: number, upTo: number }) {
        for (let [tokenId, stack] of tokenStacks) {
            console.log(`Topological ordered updates for TokenId: ${tokenId}`);
            console.log(stack);
            let graph = await this.updateTokenGraph({ tokenId, reprocessFrom: from, reprocessTo: upTo, updateTxidStack: stack });
            if (graph) {
                graph._slpValidator.cachedRawTransactions = {};
            }
        }
    }

    private async updateTokenGraph({ tokenId, reprocessFrom, reprocessTo, allowGraphUpdates = true, updateTxidStack}: 
        { tokenId: string; reprocessFrom?: number; reprocessTo?: number; loadFromDb?: boolean; allowGraphUpdates?: boolean; updateTxidStack?: string[]}) 
    {
        // if(!loadFromDb) {
        //     console.log("loadFromDb is false.");
        //     return await this.createNewTokenGraph({ tokenId, processUpToBlock: reprocessTo });
        // }

        // let tokenDbo = <TokenDBObject>await this.db.tokenFetch(tokenId);
        // if (!tokenDbo) {
        //     console.log("There is no db record for this token.");
        //     return await this.createNewTokenGraph({ tokenId, processUpToBlock: reprocessTo });
        // }

        // Reprocess entire DAG if schema version is updated
        
        // if (!tokenDbo.schema_version || tokenDbo.schema_version !== Config.db.token_schema_version) {
        //     console.log("Outdated token graph detected for:", tokenId);
        //     return await this.createNewTokenGraph({ tokenId, processUpToBlock: reprocessTo });
        // }

        // // Reprocess entire DAG if reprocessFrom is before token's GENESIS
        // if(reprocessFrom && reprocessFrom <= tokenDbo.tokenStats.block_created!) {
        //     console.log("Outdated token graph detected for:", tokenId);
        //     return await this.createNewTokenGraph({ tokenId, processUpToBlock: reprocessTo });
        // }

        // if(reprocessTo && reprocessTo >= tokenDbo.tokenStats.block_created!) {
        //     console.log("reprocessTo is set.");
        //     return await this.createNewTokenGraph({ tokenId, processUpToBlock: reprocessTo });
        // } else if (reprocessTo) {
        //     await this.deleteTokenFromDb(tokenId);
        //     return;
        // }

        // let lazyLoadingCutoff = Config.db.lazy_loading && Config.db.lazy_loading > 0 ? Config.db.lazy_loading : null;
        // let lastActiveBlock;

        // if(lazyLoadingCutoff) {
        //     lastActiveBlock = await Info.getLastBlockSeen(token.tokenIdHex);
        // }

        // if (lazyLoadingCutoff && lastActiveBlock && lastActiveBlock < this._bestBlockHeight-lazyLoadingCutoff) {
        //     console.log("########################################################################################################");
        //     console.log(`[INFO] LAZILY LOADING: ${token.tokenIdHex}`);
        //     console.log("########################################################################################################");
        //     if (this._tokens.has(token.tokenIdHex)) {
        //         throw Error("This should not happen.");
        //     }
        //     await this.getTokenGraph(token.tokenIdHex);
        // } else {
        //     await this.loadTokenFromDb(token.tokenIdHex, tokenDbo);
        //     await this.updateTokenGraph(token.tokenIdHex, allowGraphUpdates, reprocessFrom)
        // }

        return await this._updateTokenGraph(tokenId, allowGraphUpdates, reprocessFrom, reprocessTo, updateTxidStack);
    }

    async _updateTokenGraph(tokenIdHex: string, allowGraphUpdates: boolean, reprocessFrom?: number, processUpTo?: number, updateTxidStack?: string[]) {
        let graph = await this.getTokenGraph(tokenIdHex);
        let res: string[] = [];
        if (graph && allowGraphUpdates) {
            let potentialReorgFactor = 0; // determine how far back the token graph should be reprocessed
            let lastUpdatedBlock = graph._lastUpdatedBlock ? graph._lastUpdatedBlock : 0;
            let updateFromHeight = lastUpdatedBlock - potentialReorgFactor;
            if (reprocessFrom !== undefined && reprocessFrom !== null && reprocessFrom < updateFromHeight) {
                updateFromHeight = reprocessFrom;
            }
            console.log(`[INFO] Checking for Graph Updates since: ${updateFromHeight} (${graph._tokenDetails.tokenIdHex})`);
            if (updateTxidStack && updateTxidStack.length) {
                res.push(...updateTxidStack);
            } else {
                res.push(...await Query.queryForRecentConfirmedTokenTxns(graph._tokenDetails.tokenIdHex, updateFromHeight));
            }
            if (res.length === 0) {
                console.log(`[INFO] No token transactions after block ${updateFromHeight} were found (${graph._tokenDetails.tokenIdHex})`);
            }
            else {
                if(res.length > 0) {
                    graph._startupTxoSendCache = await Query.getTxoInputSlpSendCache(graph._tokenDetails.tokenIdHex);
                }
                console.log(`[INFO] (_updateTokenGraph) queueTokenGraphUpdateFrom for tokenId ${graph._tokenIdHex}`);
                let p = res.map(txid => graph!.queueUpdateForTokenGraphAt({ txid, processUpToBlock: processUpTo }))
                await Promise.all(p);
                console.log(`[INFO] Token graph updated (${graph._tokenDetails.tokenIdHex}).`);
            }
        } else {
            console.log(`[WARN] Token's graph loaded using allowGraphUpdates=false (${graph!._tokenDetails.tokenIdHex})`);
        }
        return graph;
    }

    // private async deleteTokenFromDb(tokenId: string) {
    //     await this.db.tokenDelete(tokenId);
    //     await this.db.graphDelete(tokenId);
    //     await this.db.utxoDelete(tokenId);
    //     await this.db.addressDelete(tokenId);
    // }

    async stop() {
        this._exit = true;
        this._updatesQueue.pause();
        this._updatesQueue.clear();
        if(this._updatesQueue.pending) {
            await this._updatesQueue.onIdle();
        }

        let unspentCount = 0;
        for (let [tokenId, token] of this._tokens) {
            await token.stop();
            unspentCount += token._graphTxns.size
        }
        console.log(`[INFO] Total number of unspent graph items for all tokens: ${unspentCount}`);
    }


    // private async setAndSaveTokenGraph(graph: SlpTokenGraph) {
    //     let tokenId = graph._tokenDetails.tokenIdHex;
    //     if(graph.IsValid && !this._exit) {
    //         if (!this._tokens.has(tokenId)) {
    //             this._tokens.set(tokenId, graph);
    //         }
    //         await this.db.graphItemsInsertReplaceDelete(graph);
    //         await this.db.utxoInsertReplace(graph.toUtxosDbObject(), tokenId);
    //         await this.db.addressInsertReplace(graph.toAddressesDbObject(), tokenId);
    //     } else if (!graph.IsValid && this._tokens.has(tokenId)) {
    //         this._tokens.delete(tokenId);
    //     }
    // }

    public async createNewTokenGraph({ tokenId, processUpToBlock }: { tokenId: string; processUpToBlock?: number; }): Promise<SlpTokenGraph|null> {
        //await this.deleteTokenFromDb(tokenId);
        let txn;
        try {
            txn = <string>await RpcClient.getRawTransaction(tokenId, false);
        } catch(_) {
            console.log(`[WARN] No such parent token ID exists on the blockchain (token ID: ${tokenId}`);
            return null;
        }
        let tokenDetails = this.parseTokenTransactionDetails(txn);

        if(tokenDetails) {
            console.log("########################################################################################################");
            console.log("NEW GRAPH FOR", tokenId);
            console.log("########################################################################################################");
            
            // add timestamp if token is already confirmed
            let timestamp = await Query.getConfirmedTxnTimestamp(tokenId);
            tokenDetails.timestamp = timestamp ? timestamp : undefined;
            let graph = await this.getTokenGraph(tokenId);
            if (graph) {
                await graph.initFromScratch({ tokenDetails, processUpToBlock });
            } else {
                this._tokens.delete(tokenId);
                return null;
            }

            //await this.setAndSaveTokenGraph(graph);
            return graph;
        }
        return null;
    }

    async publishZmqNotificationGraphs(txid: string) {
        if(this.zmqPubSocket && !this._zmqMempoolPubSetList.has(txid) && Config.zmq.outgoing.enable) {
            this._zmqMempoolPubSetList.push(txid);
            let tna: TNATxn | null = await this.db.db.collection('unconfirmed').findOne({ "tx.h": txid });
            if(!tna) {
                tna = await this.db.db.collection('confirmed').findOne({ "tx.h": txid });
            }
            console.log("[ZMQ-PUB] SLP mempool notification", tna);
            this.zmqPubSocket.send(['mempool-graphs', JSON.stringify(tna)]);
            SlpdbStatus.updateTimeOutgoingTxnZmq();
        }
    }

    async publishZmqNotification(txid: string) {
        // TODO: This will be a zmq notification for validity judgement and save to unconfirmed/confirmed collections
        // e.g.,  this.zmqPubSocket.send(['mempool', JSON.stringify(tna)]);
    }
}

export interface SlpTransactionDetailsTnaDbo {
    transactionType: SlpTransactionType;
    tokenIdHex: string;
    versionType: number;
    symbol: string;
    name: string;
    documentUri: string; 
    documentSha256Hex: string|null;
    decimals: number;
    txnContainsBaton: boolean;
    txnBatonVout: number|null;
    outputs: { address: string|null, amount: Decimal128|null }[]|null;
}
