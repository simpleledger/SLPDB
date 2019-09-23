import { SlpTokenGraph, TokenDBObject, UtxoDbo, AddressBalancesDbo, GraphTxnDbo } from "./slptokengraph";
import { SlpTransactionType, Slp, SlpTransactionDetails, Primatives } from "slpjs";
import { SyncCompletionInfo, SyncFilterTypes, txid, txhex, SyncType, Bit } from "./bit";
import { Query } from "./query";
import { BITBOX } from 'bitbox-sdk';
import * as bitcore from 'bitcore-lib-cash';
import { Db } from './db';
import { Config } from "./config";
import { TNATxn, TNATxnSlpDetails } from "./tna";
import { Decimal128 } from "mongodb";
import * as zmq from 'zeromq';
import { Info } from "./info";
import * as pQueue from 'p-queue';

const Block = require('bcash/lib/primitives/block');
const BufferReader = require('bufio/lib/reader');

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

import { RpcClient } from './rpc';
import { BlockHeaderResult } from "bitcoin-com-rest";
import { SetCache } from "./cache";
import { SlpdbStatus } from "./status";
import { TokenFilter } from "./filters";

const bitcoin = new BITBOX();
const slp = new Slp(bitcoin);

export class SlpGraphManager {
    db: Db;
    _tokens!: Map<string, SlpTokenGraph>;
    _rpcClient: RpcClient;
    zmqPubSocket?: zmq.Socket;
    _zmqMempoolPubSetList = new SetCache<string>(1000);
    _TnaQueue?: pQueue<pQueue.DefaultAddOptions>;
    _startupQueue = new pQueue<pQueue.DefaultAddOptions>({ concurrency: 4, autoStart: true })
    _updatesQueue = new pQueue<pQueue.DefaultAddOptions>({ concurrency: 1, autoStart: false });
    _bestBlockHeight: number;
    _network: string;
    _startupTokenCount: number;
    _slpMempool = new Map<txid, txhex>();
    _bit: Bit;
    _filter: TokenFilter;

    get TnaSynced(): boolean {
        if(this._TnaQueue)
            return (this._TnaQueue.size === 0 && this._TnaQueue.pending === 0)
        else 
            return true;
    }

    onTransactionHash(syncResult: SyncCompletionInfo) {
        let self = this;
        this._updatesQueue.add(async function() {
            await self._onTransactionHash(syncResult);
        })
    }

    async onBlockHash(hash: string) {
        this._bestBlockHeight = (await Info.getBlockCheckpoint()).height;
        let self = this;
        this._updatesQueue.add(async function() {
            await self._onBlockHash(hash);
        })
    }

    async _onTransactionHash(syncResult: SyncCompletionInfo): Promise<void> {
        if(syncResult && syncResult.filteredContent.size > 0) {
            let txns = Array.from(syncResult.filteredContent.get(SyncFilterTypes.SLP)!);
            await this.asyncForEach(txns, async (txPair: [string, string], index: number) =>
            {
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
                        await this.publishZmqNotification(txPair[0]);
                    }
                    else {
                        console.log("[INFO] Updating graph for:", tokenId);
                        this._tokens.get(tokenId)!.queueTokenGraphUpdateFrom({ txid: txPair[0] } );
                    }
                } else {
                    console.log("[INFO] Skipping: TokenId is being filtered.")
                    await this.updateTxnCollections(txPair[0]);
                }

                // NOTE: The following method is commented out because it is doing redundant work with burn search at  block discovery.
                // If uncommented it would search for burns at mempool acceptance, but only searches SLP transactions
                // -----
                // Based on the spent inputs, look for associated tokenIDs of those inputs and update those token graphs also
                // let inputTokenIds: string[] = [];
                // for(let i = 0; i < txn.inputs.length; i++) {
                //     let inputTokenId = await Query.queryForTxnTokenId(txn.inputs[i].prevTxId.toString('hex'));
                //     if(inputTokenId && inputTokenId !== tokenId && this._tokens.has(inputTokenId) && !inputTokenIds.includes(inputTokenId)) {
                //         inputTokenIds.push(inputTokenId);
                //         this._tokens.get(inputTokenId)!.queueTokenGraphUpdateFrom({txid: txn.inputs[i].prevTxId.toString('hex'), isParent: true});
                //     }
                //     else {
                //         console.log("[INFO] SLP txn input:", i, "does not need updated for txid:", txPair[0]);
                //     }
                // }
            })
        }
    }

    async simulateOnTransactionHash(txid: string) {
        let txhex = <txhex>await this._rpcClient.getRawTransaction(txid);
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
            tokenDetails = slp.parseSlpOutputScript(txn.outputs[0]._scriptBuffer);
        }
        catch (err) {
            tokenDetails = null;
        }
        if (tokenDetails && tokenDetails.transactionType === SlpTransactionType.GENESIS)
            tokenDetails.tokenIdHex = txn.id;
        
        return tokenDetails;
    }

    async _onBlockHash(hash: string): Promise<void> {
        while(!this.TnaSynced) {
            console.log("[INFO] At _onBlockHash() - Waiting for TNA sync to complete before we update tokens included in block.")
            await sleep(1000);
        }
        let blockTxns = await Query.getTransactionsForBlock(hash);
        if(blockTxns) {
            // update tokens collection timestamps on confirmation for Genesis transactions
            let genesisBlockTxns = await Query.getGenesisTransactionsForBlock(hash);
            if(genesisBlockTxns) {
                for(let i = 0; i < genesisBlockTxns.txns.length; i++) {
                    let token = this._tokens.get(genesisBlockTxns.txns[i])
                    if(token)
                        token._tokenDetails.timestamp = genesisBlockTxns.timestamp!;
                }
            }

            // update all statistics for tokens included in this block
            let tokenIds: string[];
            if(this._filter._rules.size > 0) {
                tokenIds = Array.from(new Set<string>([
                    ...blockTxns.txns
                        .filter(t => t.slp && t.slp.valid && this._filter.passesAllFilterRules(t.slp.detail!.tokenIdHex))
                        .map(t => t.slp.detail!.tokenIdHex)
                    ]));
            }
            else {
                tokenIds = Array.from(new Set<string>(
                    [...blockTxns.txns
                        .filter(t => t.slp && t.slp.valid)
                        .map(t => t.slp.detail!.tokenIdHex)
                    ]));
            }

            // update statistics for each token
            await Promise.all(tokenIds.map(async (tokenId) => {
                await this._tokens.get(tokenId)!.UpdateStatistics();
            }));

            // zmq publish block events
            if(this.zmqPubSocket && Config.zmq.outgoing.enable) {
                console.log("[ZMQ-PUB] SLP block txn notification", hash);
                this.zmqPubSocket.send([ 'block', JSON.stringify(blockTxns) ]);
                SlpdbStatus.updateTimeOutgoingBlockZmq();
            }
            await this.fixMissingTokenTimestamps();

            // DO NOT AWAIT: Search for any burned transactions 
            this.searchBlockForBurnedSlpTxos(hash);
        }
        SlpdbStatus.updateSlpProcessedBlockHeight(this._bestBlockHeight);
    }

    constructor(db: Db, currentBestHeight: number, network: string, bit: Bit, filter: TokenFilter = new TokenFilter()) {
        this.db = db;
        this._bestBlockHeight = currentBestHeight;
        this._network = network;
        this._tokens = new Map<string, SlpTokenGraph>();
        this._rpcClient = new RpcClient({useGrpc: Boolean(Config.grpc.url) });
        this._bit = bit;
        this._filter = filter;
        let self = this;
        this._startupTokenCount = 0
        this._startupQueue.on('active', () => {
            console.log(`[INFO] Loading new token.  Loaded: ${self._startupTokenCount++}.  Total: ${this._tokens.size}.  Queue Size: ${this._startupQueue.size}.  Queue Pending: ${this._startupQueue.pending}`);
        })
    }

    async fixMissingTokenTimestamps() {
        let tokens = await Query.queryForConfirmedTokensMissingTimestamps();
        if(tokens) {
            await this.asyncForEach(tokens, async (token: { txid: string, blk: any }) => {
                console.log("[INFO] Checking for missing timestamps for:", token.txid, token.blk.t);
                let timestamp = SlpTokenGraph.FormatUnixToDateString(token.blk.t);
                if (timestamp && this._tokens.has(token.txid)) {
                    let t = this._tokens.get(token.txid)!;
                    t._tokenDetails.timestamp = timestamp;
                    t._tokenStats.block_created = token.blk.i;
                    await this.db.tokenInsertReplace(t.toTokenDbObject());
                    return;
                } 
                await this.createNewTokenGraph({ tokenId: token.txid })
                await this.fixMissingTokenTimestamps();
            })
        }
        return tokens;
    }

    async searchForNonSlpBurnTransactions() {
        await this.asyncForEach(Array.from(this._tokens), async (a: [string, SlpTokenGraph]) => {
            await a[1].searchForNonSlpBurnTransactions();
        })
    }

    async searchBlockForBurnedSlpTxos(block_hash: string) {
        console.log('[INFO] Starting to look for any burned tokens resulting from non-SLP transactions');
        let blockHex = <string>await this._rpcClient.getRawBlock(block_hash);
        let block = Block.fromReader(new BufferReader(Buffer.from(blockHex, 'hex')));
        let graphPromises: Promise<void>[] = [];
        console.time("BlockSearchForBurn-"+block_hash);
        for(let i=1; i < block.txs.length; i++) { // skip coinbase with i=1
            let txnbuf: Buffer = block.txs[i].toRaw();
            let txn: Primatives.Transaction = Primatives.Transaction.parseFromBuffer(txnbuf);
            let inputs: Primatives.TransactionInput[] = txn.inputs;
            for(let j=0; j < inputs.length; j++) {
                var txid: string = inputs[j].previousTxHash!;
                let vout = inputs[j].previousTxOutIndex.toString();
                let graph: SlpTokenGraph|undefined;
                let send_txo: UtxoDbo|undefined;
                this._tokens.forEach(t => {
                    if(t._tokenUtxos.has(txid + ":" + vout)) {
                        send_txo = t.utxoToUtxoDbo(txid, vout);
                        return;
                    }
                })
                if(send_txo) {
                    console.log("Potential burned transaction found (" + txid + ":" + vout + ")");
                    let tokenId = send_txo.tokenDetails.tokenIdHex;
                    graph = this._tokens.get(tokenId);
                    if(graph) {
                        graph.queueTokenGraphUpdateFrom({ txid, isParent: true });
                        graphPromises.push(graph._graphUpdateQueue.onIdle());
                    }
                    continue;
                }
                let mint_txo: TokenDBObject|undefined;
                this._tokens.forEach(t => {
                    if(t._mintBatonUtxo === txid + ":" + vout) {
                        mint_txo = t.toTokenDbObject();
                        return;
                    }
                })
                if(mint_txo) {
                    console.log("Potential burned minting transaction found (" + txid + ":" + vout + ")");
                    let tokenId = mint_txo.tokenDetails.tokenIdHex;
                    graph = this._tokens.get(tokenId);
                    if(graph) {
                        graph.queueTokenGraphUpdateFrom({ txid, isParent: true });
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

    async updateTxnCollections(txid: string, tokenId?: string): Promise<void> {
        let count = 0;
        let collections = [ 'confirmed', 'unconfirmed' ];
        await this.asyncForEach(collections, async (collection: string) => {
            let tna: TNATxn | null = await this.db.db.collection(collection).findOne({ "tx.h": txid });
            if (tna) {
                count++;
                // Here we fix missing block data
                if(collection === 'confirmed' && !tna.blk) {
                    console.log("[INFO] Updating", collection, "TNATxn block data for", txid);
                    let txnBlockhash = <string>await this._rpcClient.getTransactionBlockHash(txid);
                    let block = <BlockHeaderResult>await this._rpcClient.getBlockInfo({ hash: txnBlockhash});
                    tna.blk = {
                        h: txnBlockhash, 
                        i: block.height, 
                        t: block.time
                    }
                    await this.db.db.collection(collection).replaceOne({ "tx.h": txid }, tna);
                }
                // Here we fix missing slp data (should only happen after block sync on startup)
                if(!tna.slp)
                    tna.slp = {} as TNATxnSlpDetails;
                if(tna.slp.schema_version !== Config.db.token_schema_version || !tna.slp.valid) {
                    console.log("[INFO] Updating", collection, "TNATxn SLP data for", txid);
                    let isValid: boolean|null = null;
                    let details: SlpTransactionDetailsTnaDbo|null = null;
                    let invalidReason: string|null = null;
                    let tokenDetails: SlpTransactionDetails|null = null;

                    if(!tokenId) {
                        let txhex = <string>await this._rpcClient.getRawTransaction(tna.tx.h);
                        let bt = new bitcore.Transaction(txhex);
                        try {
                            tokenDetails = slp.parseSlpOutputScript(bt.outputs[0]._scriptBuffer);
                        } catch (err) {
                            isValid = false;
                            invalidReason = "SLP Parsing Error: " + err.message;
                        }
                        if(tokenDetails) {
                            if([SlpTransactionType.MINT, SlpTransactionType.SEND].includes(tokenDetails.transactionType))
                                tokenId = tokenDetails.tokenIdHex;
                            else if(tokenDetails.transactionType === SlpTransactionType.GENESIS)
                                tokenId = txid;
                            else {
                                isValid = null;
                                invalidReason = "Unable to set token ID";
                            }
                        }
                    }

                    if(tokenId && this._tokens.has(tokenId)) {
                        try {
                            let tokenGraph = this._tokens.get(tokenId)!;
                            isValid = await tokenGraph._slpValidator.isValidSlpTxid(txid, tokenGraph._tokenDetails.tokenIdHex);                    
                            let validation = tokenGraph._slpValidator.cachedValidations[txid];
                            invalidReason = validation.invalidReason;
                            let addresses: (string|null)[] = [];
                            if(isValid && validation.details!.transactionType === SlpTransactionType.SEND) {
                                addresses = tna.out.map(o => {
                                    try {
                                        if(o.e!.a)
                                            return o.e!.a;
                                        else return 'scriptPubKey:' + o.e!.s.toString('hex');
                                    } catch(_) { return null; }
                                });
                            }
                            else if(isValid) {
                                try {
                                    if(tna.out[1]!.e!.a)
                                        addresses = [ tna.out[1]!.e!.a ];
                                    else addresses = [ 'scriptPubKey:' + tna.out[1]!.e!.s.toString('hex') ];
                                } catch(_) {  addresses = [ null ]; }
                            }
                            if(validation.details)
                                details = SlpGraphManager.MapTokenDetailsToTnaDbo(validation.details, tokenGraph._tokenDetails, addresses);
                        } catch(err) {
                            if(err.message === "Cannot read property '_slpValidator' of undefined") {
                                isValid = false;
                                details = null;
                                invalidReason = "Invalid Token Genesis";
                            } else {
                                throw err;
                            }
                        }
                        if(isValid! === null) {
                            let msg = `[ERROR] Validitity of ${txid} is null.`;
                            throw msg;
                        }
                    } else if(tokenId && this._startupQueue.size === 0 && this._startupQueue.pending === 0 && this._startupTokenCount > 0) {
                        invalidReason = 'Token is invalid, most likely because it is an invalid Genesis.';
                        isValid = false;
                    } else if(tokenId) {
                        invalidReason = 'Token ID is not currently being tracked because SLPDB is still syncing.';
                        isValid = null;
                    }

                    tna.slp.valid = isValid;
                    tna.slp.detail = details;
                    tna.slp.invalidReason = invalidReason;
                    tna.slp.schema_version = Config.db.token_schema_version;
                    await this.db.db.collection(collection).replaceOne({ "tx.h": txid }, tna);
                    let test = await this.db.db.collection(collection).findOne({ "tx.h": txid }) as TNATxn;
                    if(collection === 'confirmed')
                        await this.db.db.collection('unconfirmed').deleteMany({ "tx.h": txid });
                    if(!test.slp) {
                        let msg = "[ERROR] Did not update SLP object.";
                        throw msg;
                    }
                }
            }
        });
        if(count === 0) {
            try {
                if(tokenId) {
                    let token = this._tokens.get(tokenId);
                    if(token)
                        token._graphTxns.delete(txid);
                }
            } catch(err) {
                console.log(err);
            }
            let checkpoint = await Info.getBlockCheckpoint();
            await Info.updateBlockCheckpoint(checkpoint.height - 1, checkpoint.hash);
            console.log("[ERROR] Transaction not found! Block checkpoint has been updated to ", (checkpoint.height - 1), checkpoint.hash)
        }
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

    async initAllTokens({ reprocessFrom, reprocessTo, loadFromDb = true, allowGraphUpdates = true, onComplete }: { reprocessFrom?: number; reprocessTo?: number; loadFromDb?: boolean; allowGraphUpdates?: boolean; onComplete?: ()=>any } = {}) {
        await Query.init();
        let tokens: SlpTransactionDetails[];
        let tokenIds: Set<string>|undefined;
        if(this._filter._rules.size > 0) {
            tokenIds = new Set<string>();
            this._filter._rules.forEach(f => {
                if(f.type === 'include-single' && !tokenIds!.has(f.info))
                    tokenIds!.add(f.info);
            });
        }
        if(!tokenIds)
            tokens = await Query.queryTokensList();
        else {
            let results = Array.from(tokenIds).map(async id => { return await Query.queryTokensList(id) });
            tokens = (await Promise.all(results)).flat();
        }

        let size = () => { return this._tokens.size; }
        await SlpdbStatus.changeStateToStartupSlpProcessing({
            getSlpTokensCount: size
        });

        // Instantiate all Token Graphs in memory
        let self = this;
        for (let i = 0; i < tokens.length; i++) {
            this._startupQueue.add(async function() {
                await self.initToken({ token: tokens[i], reprocessFrom, reprocessTo, loadFromDb, allowGraphUpdates });
            });
        }

        if(onComplete)
            onComplete();
    }

    private async initToken({ token, reprocessFrom, reprocessTo, loadFromDb = true, allowGraphUpdates = true }: 
        { token: SlpTransactionDetails; reprocessFrom?: number; reprocessTo?: number; loadFromDb?: boolean; allowGraphUpdates?: boolean }) 
    {
        let graph: SlpTokenGraph;
        let tokenState = <TokenDBObject>await this.db.tokenFetch(token.tokenIdHex);
        if (!tokenState) {
            console.log("There is no db record for this token.");
            return await this.createNewTokenGraph({ tokenId: token.tokenIdHex, processUpToBlock: reprocessTo });
        }

        // Reprocess entire DAG if schema version is updated
        if (!tokenState.schema_version || tokenState.schema_version !== Config.db.token_schema_version) {
            console.log("Outdated token graph detected for:", token.tokenIdHex);
            return await this.createNewTokenGraph({ tokenId: token.tokenIdHex, processUpToBlock: reprocessTo });
        }

        // Reprocess entire DAG if reprocessFrom is before token's GENESIS
        if(reprocessFrom && reprocessFrom <= tokenState.tokenStats.block_created!) {
            console.log("Outdated token graph detected for:", token.tokenIdHex);
            return await this.createNewTokenGraph({ tokenId: token.tokenIdHex, processUpToBlock: reprocessTo });
        }

        if(!loadFromDb) {
            console.log("loadFromDb is false.");
            return await this.createNewTokenGraph({ tokenId: token.tokenIdHex, processUpToBlock: reprocessTo });
        }

        if(reprocessTo && reprocessTo >= tokenState.tokenStats.block_created!) {
            console.log("reprocessTo is set.");
            return await this.createNewTokenGraph({ tokenId: token.tokenIdHex, processUpToBlock: reprocessTo });
        } else if (reprocessTo) {
            await this.deleteTokenFromDb(token.tokenIdHex);
            return;
        }

        console.log("########################################################################################################");
        console.log("LOAD FROM DB:", token.tokenIdHex);
        console.log("########################################################################################################");
        let utxos: UtxoDbo[] = await this.db.utxoFetch(token.tokenIdHex);
        let addresses: AddressBalancesDbo[] = await this.db.addressFetch(token.tokenIdHex);
        let dag: GraphTxnDbo[] = await this.db.graphFetch(token.tokenIdHex);
        graph = await SlpTokenGraph.FromDbObjects(tokenState, dag, utxos, addresses, this.db, this, this._network);
        
        let res: string[] = [];
        if(allowGraphUpdates) {
            let potentialReorgFactor = 10; // determine how far back the token graph should be reprocessed
            let updateFromHeight = graph._lastUpdatedBlock - potentialReorgFactor;
            if(reprocessFrom !== undefined && reprocessFrom !== null && reprocessFrom < updateFromHeight)
            updateFromHeight = reprocessFrom;
            console.log("[INFO] Checking for Graph Updates since:", updateFromHeight);
            res.push(...await Query.queryForRecentTokenTxns(graph._tokenDetails.tokenIdHex, updateFromHeight));
            // update graph items
            await this.asyncForEach(res, async (txid: string) => {
                await graph.updateTokenGraphFrom({txid: txid});
                console.log("[INFO] Updated graph from", txid);
            });
            if (res.length === 0)
                console.log("[INFO] No token transactions after block", updateFromHeight, "were found.");
            else {
                console.log("[INFO] Token's graph was updated.");
                await graph.updateStatistics();
            }
        } else {
            console.log("[WARN] Token's graph loaded using allowGraphUpdates=false.");
        }
        await this.updateTxnCollectionsForTokenId(token.tokenIdHex);
        await this.setAndSaveTokenGraph(graph);
    }

    private async deleteTokenFromDb(tokenId: string) {
        await this.db.tokenDelete(tokenId);
        await this.db.graphDelete(tokenId);
        await this.db.utxoDelete(tokenId);
        await this.db.addressDelete(tokenId);
    }

    private async updateTxnCollectionsForTokenId(tokenid: string) {
        console.log("[INFO] Updating confirmed/unconfirmed collections for:", tokenid);
        await this.updateTxnCollections(tokenid, tokenid);
        //let tokenTxns = await Query.queryForRecentTokenTxns(token.tokenIdHex, 0);
        if(this._tokens.has(tokenid)) {
            let tokenTxns = Array.from(this._tokens.get(tokenid)!._graphTxns.keys());
            for (let j = 0; j < tokenTxns.length; j++) {
                await this.updateTxnCollections(tokenTxns[j], tokenid);
            }
        }
    }

    private async setAndSaveTokenGraph(graph: SlpTokenGraph) {
        if(graph.IsValid) {
            let tokenId = graph._tokenDetails.tokenIdHex;
            this._tokens.set(tokenId, graph);
            await this.db.tokenInsertReplace(graph.toTokenDbObject());
            await this.db.graphInsertReplace(graph.toGraphDbObject(), tokenId);
            await this.db.utxoInsertReplace(graph.toUtxosDbObject(), tokenId);
            await this.db.addressInsertReplace(graph.toAddressesDbObject(), tokenId);
        }
    }

    private async createNewTokenGraph({ tokenId, processUpToBlock }: { tokenId: string; processUpToBlock?: number; }): Promise<SlpTokenGraph|null> {
        //await this.deleteTokenFromDb(tokenId);
        let graph = new SlpTokenGraph(this.db, this, this._network);
        let txn = <string>await this._rpcClient.getRawTransaction(tokenId);
        let tokenDetails = this.parseTokenTransactionDetails(txn);

        if(tokenDetails) {
            console.log("########################################################################################################");
            console.log("NEW GRAPH FOR", tokenId);
            console.log("########################################################################################################");
            
            // add timestamp if token is already confirmed
            let timestamp = await Query.getConfirmedTxnTimestamp(tokenId);
            tokenDetails.timestamp = timestamp ? timestamp : undefined;
            
            await graph.initFromScratch({ tokenDetails, processUpToBlock });
            await this.setAndSaveTokenGraph(graph);
            await this.updateTxnCollectionsForTokenId(tokenId);
            return graph;
        }
        return null;
    }

    async asyncForEach(array: any[], callback: Function) {
        for (let index = 0; index < array.length; index++) {
          await callback(array[index], index, array);
        }
    }

    async publishZmqNotification(txid: string) {
        if(this.zmqPubSocket && !this._zmqMempoolPubSetList.has(txid) && Config.zmq.outgoing.enable) {
            this._zmqMempoolPubSetList.push(txid);
            let tna: TNATxn | null = await this.db.db.collection('unconfirmed').findOne({ "tx.h": txid });
            if(tna) {
                console.log("[ZMQ-PUB] SLP mempool notification", tna);
                this.zmqPubSocket.send(['mempool', JSON.stringify(tna)]);
                SlpdbStatus.updateTimeOutgoingTxnZmq();
            }
        }
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
