import { SlpTokenGraph, TokenDBObject, UtxoDbo, AddressBalancesDbo, GraphTxnDbo } from "./SlpTokenGraph";
import { SlpTransactionType, Slp, SlpTransactionDetails, Primatives } from "slpjs";
import { SyncCompletionInfo, SyncFilterTypes, txid, txhex, SyncType } from "./bit";
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
import { BlockDetailsResult, VerboseRawTransactionResult } from "bitcoin-com-rest";
import SetList from "./SetList";

const bitcoin = new BITBOX();
const slp = new Slp(bitcoin);

export class SlpGraphManager {
    db: Db;
    _tokens!: Map<string, SlpTokenGraph>;
    _rpcClient: RpcClient;
    zmqPubSocket?: zmq.Socket;
    _transaction_lock: boolean = false;
    _zmqMempoolPubSetList = new SetList<string>(1000);
    _TnaQueue?: pQueue<pQueue.DefaultAddOptions>;
    _updatesQueue = new pQueue<pQueue.DefaultAddOptions>({ concurrency: 1, autoStart: false })

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

    onBlockHash(hash: string, tokenIdFilter: string[] = []) {
        let self = this;
        this._updatesQueue.add(async function() {
            await self._onBlockHash(hash, tokenIdFilter);
        })
    }

    async _onTransactionHash(syncResult: SyncCompletionInfo): Promise<void> {
        if(syncResult && syncResult.filteredContent.size > 0) {
            let txns = Array.from(syncResult.filteredContent.get(SyncFilterTypes.SLP)!)
            await this.asyncForEach(txns, async (txPair: [string, string], index: number) =>
            {
                console.log("PROCESSING SLP GRAPH UPDATE FOR:", txPair[0]);
                let txn = new bitcore.Transaction(txPair[1]);
                let tokenDetails = this.parseTokenTransactionDetails(txPair[1]);
                let tokenId = tokenDetails ? tokenDetails.tokenIdHex : null;

                // Based on Txn output OP_RETURN data, update graph for the tokenId 
                if(tokenId) {
                    if(!this._tokens.has(tokenId)) {
                        if(tokenDetails) {
                            this._transaction_lock = true;
                            await this.createNewTokenGraph({ tokenId });
                            this._transaction_lock = false;
                            await this.publishZmqNotification(txPair[0]);
                        }
                        else {
                            console.log("[INFO] Skipping: No token details are available for this token")
                        }
                    }
                    else {
                        console.log("UPDATING GRAPH FOR:", tokenId);
                        while(this._transaction_lock) {
                            console.log("[INFO] onTransactionHash update is locked until processing for new token graph is completed.")
                            await sleep(1000);
                        }
                        this._tokens.get(tokenId)!.queueTokenGraphUpdateFrom({ txid: txPair[0]} );
                    }
                } else {
                    await this.updateTxnCollections(txPair[0])
                }

                // Based on the spent inputs, look for associated tokenIDs of those inputs and update those token graphs also
                let inputTokenIds: string[] = [];
                for(let i = 0; i < txn.inputs.length; i++) {
                    let inputTokenId = await Query.queryForTxnTokenId(txn.inputs[i].prevTxId.toString('hex'));
                    if(inputTokenId && inputTokenId !== tokenId && this._tokens.has(inputTokenId) && !inputTokenIds.includes(inputTokenId)) {
                        inputTokenIds.push(inputTokenId);
                        this._tokens.get(inputTokenId)!.queueTokenGraphUpdateFrom({txid: txn.inputs[i].prevTxId.toString('hex'), isParent: true});
                    }
                    else {
                        console.log("[INFO] SLP txn input:", i, "does not need updated for txid:", txPair[0]);
                    }
                }
            })
        }
    }

    async simulateOnTransactionHash(txid: string) {
        let txhex = <txhex>await this._rpcClient.getRawTransaction(txid, 0);
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

    async _onBlockHash(hash: string, tokenIdFilter: string[] = []): Promise<void> {

        while(this._transaction_lock) {
            console.log("[INFO] onBlockHash update is locked until processing for new token graph is completed.")
            await sleep(1000);
        }

        while(!this.TnaSynced) {
            console.log("[INFO] At _onBlockHash() - Waiting for TNA sync to complete before we update tokens included in block.")
            await sleep(1000);
        }

        let blockTxns = await Query.getTransactionsForBlock(hash);
        if(blockTxns!) {
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
            if(tokenIdFilter.length > 0) {
                tokenIds = Array.from(new Set<string>([
                    ...blockTxns!.txns
                        .filter(t => t.slp && t.slp.valid && tokenIdFilter.includes(t.slp.detail!.tokenIdHex))
                        .map(t => t.slp.detail!.tokenIdHex)
                    ]));
            }
            else {
                tokenIds = Array.from(new Set<string>(
                    [...blockTxns!.txns
                        .filter(t => t.slp && t.slp.valid)
                        .map(t => t.slp.detail!.tokenIdHex)
                    ]));
            }


            // update statistics for each token
            for(let i = 0; i < tokenIds.length; i++) {
                let token = this._tokens.get(tokenIds[i])!;
                await token.updateStatistics();
            }

            // Search for any burned transactions 
            console.log('[INFO] Starting to look for any burned tokens resulting from non-SLP transactions');
            await this.searchBlockForBurnedSlpTxos(hash);
            console.log('[INFO] Finished looking for burned tokens.');

            // zmq publish block events
            if(this.zmqPubSocket) {
                console.log("[ZMQ-PUB] SLP block txn notification", hash);
                this.zmqPubSocket.send([ 'block', JSON.stringify(blockTxns) ]);
            }

            // fix any missed token timestamps 
            // await this.fixMissingTokenTimestamps();
        }
    }


    constructor(db: Db) {
        this.db = db;
        this._tokens = new Map<string, SlpTokenGraph>();
        this._rpcClient = new RpcClient();
    }

    async fixMissingTokenTimestamps() {
        let tokens = await Query.getNullTokenGenesisTimestamps();
        if(tokens) {
            await this.asyncForEach(tokens, async (tokenId: string) => {
                console.log("[INFO] Checking for missing timestamps for:", tokenId);
                let timestamp = await Query.getConfirmedTxnTimestamp(tokenId);
                if (timestamp && this._tokens.has(tokenId)) {
                    let token = this._tokens.get(tokenId)!;
                    token._tokenDetails.timestamp = timestamp;
                    await this.db.tokenInsertReplace(token.toTokenDbObject());
                } else if(!this._tokens.has(tokenId)) {
                    await this.createNewTokenGraph({ tokenId });
                }
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
        let blockHex = <string>await this._rpcClient.getBlock(block_hash, false);
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
                    let txn = <VerboseRawTransactionResult>await this._rpcClient.getRawTransaction(txid, 1);
                    let block = <BlockDetailsResult>await this._rpcClient.getBlock(txn.blockhash);
                    tna.blk = {
                        h: txn.blockhash, 
                        i: block.height, 
                        t: block.time
                    }
                    await this.db.db.collection(collection).replaceOne({ "tx.h": txid }, tna);
                }
                // Here we fix missing slp data (should only happen after block sync on startup)
                if(!tna.slp)
                    tna.slp = {} as TNATxnSlpDetails;
                if(tna.slp && (tna.slp.schema_version !== Config.db.token_schema_version || !tna.slp.valid)) {
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
                            try {
                                if(tokenDetails.transactionType === SlpTransactionType.GENESIS || tokenDetails.transactionType === SlpTransactionType.MINT)
                                    tokenId = tokenDetails.tokenIdHex;
                                else if(tokenDetails.transactionType !== SlpTransactionType.SEND)
                                    tokenId = tna.tx.h;
                                else
                                    throw Error("updateTxnCollections: Unknown SLP transaction type")
                            } catch(err) {
                                console.log("[ERROR] updateTxnCollections(): Failed to get tokenId");
                                console.log(err.message);
                                process.exit()
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
                                    else addresses = [ 'scriptPubKey:' + tna.out[1]!.e!.s.toString('hex') ]; // For the case of P2PK and P2MS we allow null
                                } catch(_) { return null; }
                            }
                            if(validation.details)
                                details = SlpGraphManager.MapTokenDetailsToTnaDbo(validation.details, tokenGraph._tokenDetails, addresses);
                        } catch(err) {
                            if(err.message === "Cannot read property '_slpValidator' of undefined") {
                                isValid = false;
                                details = null;
                                invalidReason = "Invalid Token Genesis";
                            } else {
                                console.log("[ERROR]", err.message);
                                process.exit();
                            }
                        }
                        if(isValid! === null) {
                            console.log("[ERROR] Validitity of " + txid + " is null.");
                            process.exit();
                        }
                    } else if(tokenId) {
                        isValid = false;
                        details = null;
                        invalidReason = "TokenId specified is not valid.";
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
                        console.log("[ERROR] Did not update SLP object.");
                        process.exit();
                    }
                }
            }
        });
        if(count === 0) {
            let transaction = <VerboseRawTransactionResult>await this._rpcClient.getRawTransaction(txid, 1);
            let blockindex = (<BlockDetailsResult>await this._rpcClient.getBlock(transaction.blockhash)).height;
            Info.updateBlockCheckpoint(blockindex - 1, null);
            console.log("[ERROR] Transaction not found! Block checkpoint has been updated to ", (blockindex - 1))
            process.exit();
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

    async initAllTokens({ reprocessFrom, reprocessTo, tokenIds, loadFromDb = true, allowGraphUpdates = true }: { reprocessFrom?: number; reprocessTo?: number; tokenIds?: string[]; loadFromDb?: boolean; allowGraphUpdates?: boolean} = {}) {
        await Query.init();
        let tokens: SlpTransactionDetails[]; 
        if(!tokenIds)
            tokens = await Query.queryTokensList();
        else {
            let results = tokenIds.map(async id => { return await Query.queryTokensList(id) })
            tokens = (await Promise.all(results)).flat()
        }

        // Instantiate all Token Graphs in memory
        for (let i = 0; i < tokens.length; i++) {
            await this.initToken({ token: tokens[i], reprocessFrom, reprocessTo, loadFromDb, allowGraphUpdates });
        }

        console.log("[INFO] Init all tokens complete");

        console.log("[INFO] Starting to process graph based on recent mempool and block activity")
        this._updatesQueue.start()
    }

    private async initToken({ token, reprocessFrom, reprocessTo, loadFromDb = true, allowGraphUpdates = true }: { token: SlpTransactionDetails; reprocessFrom?: number; reprocessTo?: number; loadFromDb?: boolean; allowGraphUpdates?: boolean }) {
        let graph: SlpTokenGraph;
        let throwMsg1 = "There is no db record for this token.";
        let throwMsg2 = "Outdated token graph detected for: ";
        let throwMsg3 = "loadFromDb is false."
        let throwMsg4 = "reprocessTo is set."
        try {
            let tokenState = <TokenDBObject>await this.db.tokenFetch(token.tokenIdHex);
            if (!tokenState)
                throw Error(throwMsg1);

            // Reprocess entire DAG if schema version is updated
            if (!tokenState.schema_version || tokenState.schema_version !== Config.db.token_schema_version) {
                throw Error(throwMsg2 + token.tokenIdHex);
            }

            // Reprocess entire DAG if reprocessFrom is before token's GENESIS
            if(reprocessFrom && reprocessFrom <= tokenState.tokenStats.block_created!) {
                throw Error(throwMsg2 + token.tokenIdHex);
            }

            if(!loadFromDb) {
                throw Error(throwMsg3)
            }

            if(reprocessTo && reprocessTo >= tokenState.tokenStats.block_created!) {
                throw Error(throwMsg4)
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
            graph = await SlpTokenGraph.FromDbObjects(tokenState, dag, utxos, addresses, this.db, this);
            
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
            await this.setAndSaveTokenGraph(graph);
            await this.updateTxnCollectionsForTokenId(token.tokenIdHex);
        }
        catch (err) {
            if (err.message.includes(throwMsg1) || err.message.includes(throwMsg2) || err.message.includes(throwMsg3) || err.message.includes(throwMsg4)) {
                await this.createNewTokenGraph({ tokenId: token.tokenIdHex, processUpToBlock: reprocessTo });
            }
            else {
                console.log(err);
                process.exit();
            }
        }
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
        let graph = new SlpTokenGraph(this.db, this);
        let txn = <string>await this._rpcClient.getRawTransaction(tokenId);
        let tokenDetails = this.parseTokenTransactionDetails(txn);
        if(tokenDetails) {
            console.log("########################################################################################################");
            console.log("NEW GRAPH FOR", tokenId);
            console.log("########################################################################################################");
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
        if(this.zmqPubSocket && !this._zmqMempoolPubSetList.has(txid)) {
            this._zmqMempoolPubSetList.push(txid);
            let tna: TNATxn | null = await this.db.db.collection('unconfirmed').findOne({ "tx.h": txid });
            if(tna) {
                console.log("[ZMQ-PUB] SLP mempool notification", tna);
                this.zmqPubSocket.send(['mempool', JSON.stringify(tna)]);
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
