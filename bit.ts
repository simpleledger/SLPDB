import { Info, ChainSyncCheckpoint } from './info';
import { TNA, TNATxn } from './tna';
import { Config } from './config';
import { Db } from './db';

import pLimit = require('p-limit');
import * as pQueue from 'p-queue';
import * as zmq from 'zeromq';
import { BlockHeaderResult } from 'bitcoin-com-rest';
import { BITBOX } from 'bitbox-sdk';
import * as bitcore from 'bitcore-lib-cash';
import { Primatives, SlpTransactionType, SlpTransactionDetails, Validation } from 'slpjs';
import { RpcClient } from './rpc';
import { CacheSet, CacheMap } from './cache';
import { SlpGraphManager, SlpTransactionDetailsTnaDbo } from './slpgraphmanager';
import { Notifications } from './notifications';
import { SlpdbStatus } from './status';
import { SlpTokenGraph } from './slptokengraph';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const filterBuf = Buffer.from("6a04534c5000", "hex");
const Block = require('bcash/lib/primitives/block');
const BufferReader = require('bufio/lib/reader');

const bitbox = new BITBOX();

export enum SyncType {
    "Mempool", "Block"
}

export enum SyncFilterTypes {
    "BCH", "SLP"
}

export interface SyncCompletionInfo {
    syncType: SyncType;
    filteredContent: Map<SyncFilterTypes, Map<txid, txhex>>;
}

export type CrawlResult = CacheMap<txid, CrawlTxnInfo>;

export interface CrawlTxnInfo {
    tnaTxn: TNATxn;
    txHex: string;
    tokenId: string;
}
export type txhex = string;
export type txid = string;

const tna = new TNA();

export class Bit {
    db: Db;
    outsock = zmq.socket('pub');
    slpMempool = new Map<txid, txhex>();
    txoDoubleSpendCache = new CacheMap<string, any>(20);
    doubleSpendCache = new CacheSet<string>(100);
    slpTxnNotificationIgnoreList = new CacheSet<string>(Config.core.slp_mempool_ignore_length); // this allows us to quickly ignore txns on block acceptance notification
    blockHashIgnoreSetList = new CacheSet<string>(10);
    _slpGraphManager!: SlpGraphManager;
    _zmqItemQueue = new pQueue({ concurrency: 1, autoStart: true });
    network!: string;
    notifications!: Notifications;
    _spentTxoCache = new CacheMap<string, { txid: string; block: number|null }>(100000);

    _tokenIdsModified = new Set<string>();
    _isSyncing = false;
    _exit = false;

    constructor(db: Db) {
        this.db = db;
        if (Config.zmq.outgoing.enable) {
            this.outsock.bindSync('tcp://' + Config.zmq.outgoing.host + ':' + Config.zmq.outgoing.port);
        }
    }

    async init() {
        this.network = await Info.getNetwork();
        await this.waitForFullNodeSync();
    }

    async stop() {
        this._exit = true;
        while (this._isSyncing) {
            console.log("Waiting for block/transaction sync to complete");
            await sleep(250);
        }
    }

    slpTransactionFilter(txn: string|Buffer): boolean {
        if (typeof txn !== "string") {
            return (txn as Buffer).includes(filterBuf);
        } else if (txn.includes('6a04534c5000')) {
            return true;
        }
        return false;
    }

    private async waitForFullNodeSync() {
        let bitbox = this.network === 'mainnet' ? 
                        new BITBOX({ restURL: `https://rest.bitcoin.com/v2/` }) : 
                        new BITBOX({ restURL: `https://trest.bitcoin.com/v2/` });

        let isSyncd = false;
        let lastReportedSyncBlocks = 0;
        while (!isSyncd) {
            let info = await RpcClient.getBlockchainInfo();
            let chain = info.chain;
            if (chain === 'regtest') {
                break;
            }
            let syncdBlocks = info.blocks;
            let networkBlocks = (await bitbox.Blockchain.getBlockchainInfo()).blocks;
            isSyncd = syncdBlocks === networkBlocks ? true : false;
            if (syncdBlocks !== lastReportedSyncBlocks) {
                console.log("[INFO] Waiting for bitcoind to sync with network ( on block", syncdBlocks, "of", networkBlocks, ")");
            } else {
                console.log("[WARN] bitcoind sync status did not change, check your bitcoind network connection.");
            }
            lastReportedSyncBlocks = syncdBlocks;
            await sleep(2000);
        }
    }
    
    async requestheight(): Promise<number> {
        try {
            return await RpcClient.getBlockCount();
        } catch(err) {
            console.log('Check your RPC connection. Could not get height from full node rpc call.')
            throw err;
        }
    }

    async getSlpMempoolTransaction(txid: string): Promise<bitcore.Transaction|null> {
        if (this.slpMempool.has(txid)) {
            return new bitcore.Transaction(this.slpMempool.get(txid)!);
        }
        return null;
    }

    async handleMempoolTransaction(txid: string, txnBuf?: Buffer): Promise<{ isSlp: boolean, added: boolean }> {
        if (this.slpMempool.has(txid)) {
            return { isSlp: true, added: false };  
        }
        if (this.slpTxnNotificationIgnoreList.has(txid)) {
            return { isSlp: false, added: false };
        }
        if (!txnBuf) {
            try {
                let txhex = <string>await RpcClient.getRawTransaction(txid);
                txnBuf = Buffer.from(txhex, 'hex');
                if (this.slpTransactionFilter(txnBuf)) {
                    RpcClient.loadTxnIntoCache(txid, txnBuf);
                }
            } catch(err) {
                console.log(`[ERROR] Could not find tranasaction ${txid} in handleMempoolTransaction`);
                return { isSlp: false, added: false }
            }
        }

        // check for double spending of inputs, if found delete double spent txid from the mempool
        // TODO: Need to test how this will work with BCHD!
        let inputTxos = Primatives.Transaction.parseFromBuffer(txnBuf).inputs;
        let txidToDelete: string[] = [];
        inputTxos.forEach(input => {
            let txo = `${input.previousTxHash}:${input.previousTxOutIndex}`
            if (this._spentTxoCache.has(txo)) {
                let doubleSpentTxid = this._spentTxoCache.get(txo)!.txid;
                if (doubleSpentTxid !== txid) {
                    console.log(`[INFO] Detected a double spend ${txo} --> original: ${doubleSpentTxid}, current: ${txid}`);
                    // this.slpMempool.delete(doubleSpentTxid);
                    // RpcClient.transactionCache.delete(doubleSpentTxid);
                    this.db.unconfirmedDelete(doubleSpentTxid); // no need to await
                    this.db.confirmedDelete(doubleSpentTxid);   // no need to await
                    if (this._slpGraphManager._tokens.has(doubleSpentTxid)) {
                        this._slpGraphManager._tokens.delete(doubleSpentTxid);
                        this.db.tokenDelete(doubleSpentTxid);   // no need to await
                        this.db.graphDelete(doubleSpentTxid);   // no need to await
                        this.db.addressDelete(doubleSpentTxid); // no need to await
                        this.db.utxoDelete(doubleSpentTxid);    // no need to await
                    } else {
                        txidToDelete.push(doubleSpentTxid);
                    }
                    let date = new Date();
                    this.txoDoubleSpendCache.set(txo, { originalTxid: doubleSpentTxid, current: txid, time: { utc: date.toUTCString(), unix: Math.floor(date.getTime()/1000) }});
                    this.doubleSpendCache.push(doubleSpentTxid);
                    SlpdbStatus.doubleSpendHistory = Array.from(this.txoDoubleSpendCache.toMap()).map(v => { return { txo: v[0], details: v[1]}});
                }
            }
        });

        let tokenIdToUpdate= new Set<string>();
        if (txidToDelete.length > 0) {
            for (let [tokenId, g ] of this._slpGraphManager._tokens) { 
                let removedAny = g.scanDoubleSpendTxids(txidToDelete);
                if (removedAny) {
                    this.slpMempool.delete(txid);
                    tokenIdToUpdate.add(txid);
                    //tokenIdToUpdate.add(tokenId);
                }
            }
        }
        tokenIdToUpdate.forEach(tokenId => {
            if (this._slpGraphManager._tokens.has(tokenId)) {
                this._slpGraphManager._tokens.get(tokenId)!.UpdateStatistics({});  // no need to await
            }
        });

        if (this.slpTransactionFilter(txnBuf)) {
            this.slpMempool.set(txid, txnBuf.toString("hex"));
            let inputTxos = Primatives.Transaction.parseFromBuffer(txnBuf).inputs;
            for (let txo of inputTxos) {
                if (!txo.previousTxHash.startsWith('0'.repeat(64))) { // ignore coinbase
                    this._spentTxoCache.set(`${txo.previousTxHash}:${txo.previousTxOutIndex}`, { txid, block: null });
                }
            }
            return { isSlp: true, added: true };
        } else {
            this.slpTxnNotificationIgnoreList.push(txid);
        }
        return { isSlp: false, added: false };
    }

    async removeMempoolTransaction(txid: string) {
        console.log(`Deleting unconfirmed ${txid}`);
        let count = await this.db.unconfirmedDelete(txid);
        if (count) {
            this.slpMempool.delete(txid);
        } else {
            console.log(`[WARN] Unconfirmed transaction not deleted.`);

        }
    }

    async syncSlpMempool(currentBchMempoolList?: string[], recursive=false, outerLoop=true) {
        console.log(`[INFO] Syncing SLP Mempool...`);
        if (this._exit) {
            return;
        }

        if (!currentBchMempoolList) {
            currentBchMempoolList = await RpcClient.getRawMemPool();
        }

        console.log('[INFO] BCH mempool txs =', currentBchMempoolList.length);
        
        // Perform a toposort on current bch mempool.
        const mempoolSlpTxs = new Map<string, { deserialized: bitcore.Transaction, serialized: Buffer}>();
        for (let txid of currentBchMempoolList) {
            const serialized: Buffer = Buffer.from(await RpcClient.getRawTransaction(txid), "hex");
            if (this.slpTransactionFilter(serialized)) {
                // @ts-ignore
                const deserialized: bitcore.Transaction = new bitcore.Transaction(serialized);
                const txid = deserialized.hash;
                mempoolSlpTxs.set(txid, {deserialized, serialized});
                RpcClient.transactionCache.set(txid, serialized);
            }
        }
        let sortedStack: string[] = [];
        await this.topologicalSort(mempoolSlpTxs, sortedStack);
        if (sortedStack.length !== mempoolSlpTxs.size) {
            throw Error("Transaction count is incorrect after topological sorting.");
        }

        for (let _ of mempoolSlpTxs) {
            let txid = sortedStack.shift()!;
            await this.handleRawTransaction({ txnBuf: mempoolSlpTxs.get(txid)!.serialized, txid });
        }

        // since this method is async, recursion ensures that we get all mempool txns when the outer loop exits
        if (recursive) {
            let residualMempoolList = (await RpcClient.getRawMemPool()).filter(id => !this.slpTxnNotificationIgnoreList.has(id) && !Array.from(this.slpMempool.keys()).includes(id));
            if(residualMempoolList.length > 0)  {
                await this.syncSlpMempool(residualMempoolList, true, false)
            }
        }

        if (outerLoop) {
            await this.removeExtraneousMempoolTxns();
            console.log('[INFO] BCH mempool txn count:', (await RpcClient.getRawMemPool()).length);
            console.log("[INFO] SLP mempool txn count:", this.slpMempool.size);
        }
    }

    async crawl(blockIndex: number, syncComplete?: boolean): Promise<CrawlResult|null> {
        const result = new CacheMap<txid, CrawlTxnInfo>(-1);
        let blockContent: BlockHeaderResult;
        try {
            blockContent = await RpcClient.getBlockInfo({ index: blockIndex });
        } catch(_) {
            return null;
        }
        const blockHash = blockContent.hash;
        const blockTime = blockContent.time;
        
        if (blockContent) {
            console.log('[INFO] Crawling block', blockIndex, 'hash:', blockHash);
            const blockHex = <string>await RpcClient.getRawBlock(blockContent.hash);
            const block = Block.fromReader(new BufferReader(Buffer.from(blockHex, 'hex')));

            console.time(`Toposort-${blockIndex}`);
            const blockTxCache = new Map<string, { deserialized: bitcore.Transaction, serialized: Buffer}>();
            block.txs.forEach((t: any, i: number) => {
                const serialized: Buffer = t.toRaw();
                if (this.slpTransactionFilter(serialized)) {
                    // @ts-ignore
                    const deserialized: bitcore.Transaction = new bitcore.Transaction(serialized);
                    const txid = deserialized.hash;
                    blockTxCache.set(txid, {deserialized, serialized});
                    RpcClient.transactionCache.set(txid, serialized);
                    deserialized.inputs.forEach((input) => {
                        let prevOutpoint = input.prevTxId.toString("hex") + ":" + input.outputIndex;
                        this._spentTxoCache.set(prevOutpoint, { txid, block: blockIndex });  // TODO: update to only cache slp outpoints?
                        console.log(`[INFO] _spentTxoCache.set ${prevOutpoint} -> ${txid} at ${blockIndex}`);
                        // TODO: Scan for SLP token burns elsewhere... for all block transactoins (is this being done already somewhere else?)
                    });
                }
            });
            let stack: string[] = [];
            await this.topologicalSort(blockTxCache, stack);
            if (stack.length !== blockTxCache.size) {
                throw Error("Transaction count is incorrect after topological sorting.");
            }
            console.timeEnd(`Toposort-${blockIndex}`);

            // We use a recursive async loop so we don't block
            // the event loop and lock out the possibility of user calling SIGINT
            async function crawlInternal(self: Bit, i: number, blockSeenTokenIds: Set<string>) {

                let txid = stack[i];
                const serialized = blockTxCache.get(txid)!.serialized;
                const deserialized = blockTxCache.get(txid)!.deserialized;

                let t: TNATxn = tna.fromTx(deserialized, { network: self.network });
                let slp = await self.setSlpProp(deserialized, txid, blockTime, t, blockIndex, blockSeenTokenIds);

                if (!self.slpMempool.has(txid) && syncComplete) {
                    console.log("SLP transaction not in mempool:", txid);
                    await self.handleMempoolTransaction(txid, serialized);
                    let syncResult = await Bit.sync(self, 'mempool', txid);
                    self._slpGraphManager.onTransactionHash!(syncResult!);
                }

                t.blk = {
                    h: blockHash,
                    i: blockIndex,
                    t: blockTime
                };

                if (slp.detail && slp.detail.tokenIdHex) {
                    result.set(txid, { 
                        txHex: serialized.toString("hex"), 
                        tnaTxn: t, 
                        tokenId: slp.detail.tokenIdHex }
                    );
                }
            }

            let blockSeenTokenIdsForLazyLoading = new Set<string>();
            for (let i = 0; i < stack.length; i++) {
                await crawlInternal(this, i, blockSeenTokenIdsForLazyLoading);
            }

            console.log(`[INFO] Block ${blockIndex} processed : ${block.txs.length} BCH tx | ${stack.length} SLP tx`);
            return result;
    
        } else {
            return null;
        }
    }

    private async setSlpProp(txn: bitcore.Transaction, txid: string, blockTime: number|null, t: TNATxn, blockIndex: number|null, blockSeenTokenIds: Set<string>|null) {
        let slpMsg: SlpTransactionDetails | undefined, slpTokenGraph: SlpTokenGraph | undefined | null, validation: Validation, detail: SlpTransactionDetailsTnaDbo | null = null, invalidReason: string | null = null, valid = false;
        try {
            slpMsg = this._slpGraphManager.slp.parseSlpOutputScript(txn.outputs[0]._scriptBuffer);
        }
        catch (err) {
            invalidReason = err.message;
        }
        if (slpMsg) {
            try {
                if (slpMsg.transactionType === SlpTransactionType.GENESIS) {
                    slpMsg.tokenIdHex = txid;
                    slpTokenGraph = await this._slpGraphManager.getTokenGraph({tokenIdHex: slpMsg.tokenIdHex, slpMsgDetailsGenesis: slpMsg, blockCreated: blockIndex!});
                } else {
                    slpTokenGraph = await this._slpGraphManager.getTokenGraph({tokenIdHex: slpMsg.tokenIdHex});
                }
                if (!slpTokenGraph) {
                    throw Error("Invalid token graph.");
                }
                if (slpMsg.transactionType === SlpTransactionType.GENESIS) {
                    slpTokenGraph._tokenDetails = slpMsg;
                    if (blockTime) {
                        let formatDate = (blockTime: number): string[] => {
                            let d = new Date(blockTime * 1000);
                            let res: string[] = [
                                '0' + d.getUTCMonth(), 
                                '0' + d.getUTCDay(),
                                '0' + d.getUTCHours(),
                                '0' + d.getUTCMinutes(),
                                '0' + d.getUTCSeconds()
                            ].map((c: string) => c.slice(-2));
                            res.unshift(d.getUTCFullYear().toString());
                            return res;
                        }
                        let d: string[] = formatDate(blockTime);
                        slpTokenGraph._tokenDetails.timestamp = d.slice(0,3).join('-') + ' ' + d.slice(3).join(':');
                    }
                }
                validation = await slpTokenGraph.validateTxid(txid);
                valid = valid || validation.validity!;
                invalidReason = validation.invalidReason;
                let addresses: (string | null)[] = [];
                if (valid && validation.details!.transactionType === SlpTransactionType.SEND) {
                    addresses = t.out.map(o => {
                        try {
                            if (o.e!.a) {
                                return o.e!.a;
                            }
                            else {
                                return 'scriptPubKey:' + o.e!.s.toString('hex');
                            }
                        }
                        catch (_) {
                            return null;
                        }
                    });
                }
                else if (valid) {
                    try {
                        if (t.out[1]!.e!.a) {
                            addresses = [t.out[1]!.e!.a];
                        }
                        else {
                            addresses = ['scriptPubKey:' + t.out[1]!.e!.s.toString('hex')];
                        }
                    }
                    catch (_) {
                        addresses = [null];
                    }
                }
                if (validation.details) {
                    detail = SlpGraphManager.MapTokenDetailsToTnaDbo(validation.details, slpTokenGraph._tokenDetails, addresses);
                }
                // if (blockTime && blockIndex && blockSeenTokenIds && !blockSeenTokenIds.has(slpMsg.tokenIdHex)) {
                //     await Info.setLastBlockSeen(slpMsg.tokenIdHex, blockIndex);
                //     blockSeenTokenIds.add(slpMsg.tokenIdHex);
                // }
            } catch (err) {
                if (!slpTokenGraph) {
                    t.slp = {
                        valid,
                        detail,
                        invalidReason,
                        schema_version: Config.db.token_schema_version
                    }
                    return { valid: false, detail, invalidReason: "Invalid token Genesis." };
                }
                console.log(err);
            }
        }

        t.slp = {
            valid,
            detail,
            invalidReason,
            schema_version: Config.db.token_schema_version
        }

        return { valid, detail, invalidReason };
    }

    private async topologicalSort(
        transactions: Map<string, { deserialized: bitcore.Transaction, serialized: Buffer }>,
        stack: string[]
    ): Promise<void> {
        const visited = new Set<string>();

        for (const tx of transactions) {
            if (!visited.has(tx[0])) {
                if (stack.length > 0 && stack.length % 1000 === 0) {
                    let self = this;
                    await self.topologicalSortInternal(0, tx[1].deserialized, transactions, stack, visited);
                } else {
                    await this.topologicalSortInternal(0, tx[1].deserialized, transactions, stack, visited);
                }
            }
        }
    }

    private async topologicalSortInternal(
        // Source: https://github.com/blockparty-sh/cpp_slp_graph_search/blob/master/src/util.cpp#L12
        counter: number,
        tx: bitcore.Transaction, 
        txns: Map<string, { deserialized: bitcore.Transaction, serialized: Buffer }>,
        stack: string[],
        visited: Set<string>)
    {
            visited.add(tx.hash);
            for (const outpoint of tx.inputs) {
                const prevTxid = outpoint.prevTxId.toString("hex");
                if (visited.has(prevTxid) || !txns.has(prevTxid)) {
                    continue;
                }
                if (counter > 0 && counter % 1000 === 0) {
                    let self = this;
                    await self.topologicalSortInternal(++counter, txns.get(prevTxid)!.deserialized, txns, stack, visited);
                } else {
                    await this.topologicalSortInternal(++counter, txns.get(prevTxid)!.deserialized, txns, stack, visited);
                }
            }
            stack.push(tx.hash);
    }

    listenToZmq() {
        let sync = Bit.sync;
        this._slpGraphManager._TnaQueue = this._zmqItemQueue;
        let self = this;
        let onBlockHash = function(blockHash: Buffer) {
            SlpdbStatus.updateTimeIncomingBlockZmq();
            self._zmqItemQueue.add(async function() {
                let hash = blockHash.toString('hex');
                if (self.blockHashIgnoreSetList.has(hash)) {
                    console.log('[ZMQ-SUB] Block message ignored:', hash);
                    return;
                }
                self.blockHashIgnoreSetList.push(hash); 
                console.log('[ZMQ-SUB] New block found:', hash);
                await sync(self, 'block', hash);
                if (!self._slpGraphManager.zmqPubSocket) {
                    self._slpGraphManager.zmqPubSocket = self.outsock;
                }
                if (self._slpGraphManager.onBlockHash) {
                    self._slpGraphManager.onBlockHash!(hash!);
                }
            });
        }

        let onRawTxn = function(message: Buffer) {
            SlpdbStatus.updateTimeIncomingTxnZmq();
            self._zmqItemQueue.add(async function() {
                await self.handleRawTransaction({ txnBuf: message });
            });
        };

        this.notifications = new Notifications({ 
            onRawTxnCb: onRawTxn,
            onBlockHashCb: onBlockHash,
            useGrpc: Boolean(Config.grpc.url)
        });

        console.log('[INFO] Listening for blockchain events...');
    }

    async handleRawTransaction({ txnBuf, txid }: {txnBuf: Buffer; txid?: string}) {
        if (!txid) {
            txid = Buffer.from(bitbox.Crypto.hash256(txnBuf).toJSON().data.reverse()).toString('hex');
        }
        if ((await this.handleMempoolTransaction(txid, txnBuf)).added) {
            console.log('[ZMQ-SUB] Possible SLP transaction added:', txid);
            let syncResult = await Bit.sync(this, 'mempool', txid);
            if (!this._slpGraphManager.zmqPubSocket) //{}
                this._slpGraphManager.zmqPubSocket = this.outsock;
            if (syncResult) {
                this._slpGraphManager.onTransactionHash!(syncResult);
            }
        } else {
            console.log('[INFO] Transaction ignored:', txid);
        }
    }

    async removeExtraneousMempoolTxns() {
        let currentBchMempoolList = await RpcClient.getRawMemPool();
        
        // remove extraneous SLP transactions no longer in the mempool
        let cacheCopyForRemovals = new Map(this.slpMempool);
        let txids = cacheCopyForRemovals.keys();
        for (let i = 0; i < cacheCopyForRemovals.size; i++) {
            let txid = txids.next().value;
            if (!currentBchMempoolList.includes(txid)) {
                await this.removeMempoolTransaction(txid);
            }
        }
    }

    static async sync(self: Bit, type: string, zmqHash?: string, txhex?: string): Promise<SyncCompletionInfo|null> {
        self._isSyncing = true;
        let result: SyncCompletionInfo;
        if (type === 'block') {
            result = { syncType: SyncType.Block, filteredContent: new Map<SyncFilterTypes, Map<txid, txhex>>() }
            let lastCheckpoint = zmqHash ? <ChainSyncCheckpoint>await Info.getBlockCheckpoint() : <ChainSyncCheckpoint>await Info.getBlockCheckpoint((await Info.getNetwork()) === 'mainnet' ? Config.core.from : Config.core.from_testnet);
            
            lastCheckpoint = await Bit.checkForBlockReorg(lastCheckpoint);

            let currentHeight: number = await self.requestheight();

            let startHeight = lastCheckpoint.height;
            
            for (let index: number = startHeight; index <= currentHeight; index++) {
                if (self._exit) {
                    self._isSyncing = false;
                    return null;
                }
                console.time('[PERF] RPC END ' + index);
                let syncComplete = zmqHash ? true : false;
                let crawledTxns = <CrawlResult>(await self.crawl(index, syncComplete));
                console.timeEnd('[PERF] RPC END ' + index);
                console.time('[PERF] DB Insert ' + index);

                let blockHash: Buffer;
                if (!zmqHash) {
                    blockHash = (await RpcClient.getBlockHash(index, true)) as Buffer;
                } else {
                    blockHash = Buffer.from(zmqHash, 'hex');
                }
        
                if (crawledTxns && crawledTxns.size > 0) {
                    let array = Array.from(crawledTxns.values()).map(c => c.tnaTxn);
                    await self.db.confirmedReplace(array, index);
                    if (zmqHash) {
                        for (let tna of array) {
                            await self.removeMempoolTransaction(tna.tx.h);
                        }
                    }

                    for (let [txid, v] of crawledTxns) {
                        if (v.tnaTxn.slp?.valid) {
                            self._tokenIdsModified.add(v.tokenId);
                            let graph = await self._slpGraphManager.getTokenGraph({ tokenIdHex: v.tokenId });
                            if (graph) {
                                await graph!.addGraphTransaction({ txid, processUpToBlock: index, blockHash });
                            }
                        }
                    }
                }
                
                for (let tokenId of self._tokenIdsModified) {
                    let graph = (await self._slpGraphManager.getTokenGraph({ tokenIdHex: tokenId }))!;
                    await graph.commitToDb({ hash: blockHash.toString("hex"), height: index });
                    if (index === currentHeight) {
                        await graph!.UpdateStatistics({});
                    }
                }
                self._tokenIdsModified.clear();

                if (index - 100 > 0) {
                    await Info.deleteBlockCheckpointHash(index - 100);
                }
                await Info.updateBlockCheckpoint(index, blockHash.toString('hex'));
                console.timeEnd('[PERF] DB Insert ' + index);
                currentHeight = await self.requestheight();
            }

            // clear mempool and synchronize
            if (lastCheckpoint.height < currentHeight && zmqHash) {
                await self.removeExtraneousMempoolTxns();
                //await self.checkForMissingMempoolTxns();
            }

            if (lastCheckpoint.height === currentHeight) {
                self._isSyncing = false;
                return result;
            } else {
                self._isSyncing = false;
                return null;
            }
        } else if (type === 'mempool') {
            result = { syncType: SyncType.Mempool, filteredContent: new Map<SyncFilterTypes, Map<txid, txhex>>() }
            if (zmqHash) {
                let txn: bitcore.Transaction|null = await self.getSlpMempoolTransaction(zmqHash);
                if (!txn && !self.slpTxnNotificationIgnoreList.has(zmqHash)) {
                    if (!txhex) {
                        throw Error("Must provide 'txhex' if txid is not in the SLP mempool");
                    }
                    if (self.slpTransactionFilter(txhex)) {
                        txn = new bitcore.Transaction(txhex);
                    }
                }

                if (txn) {
                    let content: TNATxn = tna.fromTx(txn, { network: self.network });

                    await self.setSlpProp(txn, txn.id, null, content, null, null);

                    try {
                        await self.db.unconfirmedInsert(content);
                        console.log("[INFO] SLP mempool transaction added: ", zmqHash);
                    } catch (e) {
                        if (e.code == 11000) {
                            console.log(`[WARN] Mempool item already exists: ${zmqHash}`);
                            //await self.db.mempoolreplace(content);
                        } else {
                            console.log('[ERROR] Mempool sync ERR:', e, content);
                            throw e;
                        }
                    }

                    let pool = new Map<txid, txhex>();
                    pool.set(zmqHash, txn.toString());
                    result.filteredContent.set(SyncFilterTypes.SLP, pool)
                } else {
                    console.log("[INFO] Skipping non-SLP transaction:", zmqHash);
                }
                self._isSyncing = false;
                return result;
            } else {
                throw Error("Mempool transaction missing txid");
            }
        }
        self._isSyncing = false;
        return null;
    }

    static async checkForBlockReorg(lastCheckpoint: ChainSyncCheckpoint): Promise<ChainSyncCheckpoint> {
        // first, find a height with a block hash - should normallly be found on first try, otherwise rollback
        let from = (await Info.getNetwork()) === 'mainnet' ? Config.core.from : Config.core.from_testnet;
        let hadReorg = false;
        let actualHash: string|null = null;
        let maxRollback = 100;
        let rollbackCount = 0;
        while (!actualHash) {
            try {
                console.log(`[INFO] Checking for reorg for ${lastCheckpoint.height}`);
                actualHash = (await RpcClient.getBlockHash(lastCheckpoint.height)) as string;
                console.log(`[INFO] Confirmed actual block hash: ${actualHash} at ${lastCheckpoint.height}`);
            } catch (err) {
                if(lastCheckpoint.height > from) {
                    console.log(`[WARN] Missing actual hash for height ${lastCheckpoint.height}, rolling back.`);
                    lastCheckpoint.hash = null;
                    lastCheckpoint.height--;
                    rollbackCount++;
                    hadReorg = true;
                } else {
                    console.log(`[WARN] Cannot rollback further than ${lastCheckpoint.height}.`);
                }
            }
            if (rollbackCount > 0 && lastCheckpoint.height > from) {
                console.log(`[WARN] Current checkpoint set to ${actualHash} ${lastCheckpoint.height} after rollback.`);
                await Info.updateBlockCheckpoint(lastCheckpoint.height, actualHash);
            } else if(lastCheckpoint.height <= from) {
                return { height: from, hash: null, hadReorg: true };
            }
            if(maxRollback > 0 && rollbackCount > maxRollback) {
                throw Error("A large rollback occurred when trying to find actual block hash, this should not happen, shutting down");
            }
        }

        // Next, we should ensure our previous block hash stored in leveldb 
        // matches the current tip's previous hash, otherwise we need to rollback again
        let prevBlockHash = (<BlockHeaderResult>await RpcClient.getBlockInfo({ hash: actualHash })).previousblockhash;
        let prevBlockHeight = lastCheckpoint.height - 1;

        console.log(`[INFO] Checking previous actual block hash: ${prevBlockHash} for ${prevBlockHeight}`);
        let storedPrevCheckpointHash = await Info.getCheckpointHash(prevBlockHeight);
        console.log(`[INFO] Previously stored hash: ${storedPrevCheckpointHash} at ${prevBlockHeight}`);
        if(storedPrevCheckpointHash) {
            maxRollback = 100;
            rollbackCount = 0;
            while (storedPrevCheckpointHash !== prevBlockHash && prevBlockHeight > from) {
                rollbackCount++;
                hadReorg = true;
                storedPrevCheckpointHash = await Info.getCheckpointHash(--prevBlockHeight);
                prevBlockHash = (<BlockHeaderResult>await RpcClient.getBlockInfo({ hash: prevBlockHash })).previousblockhash;
                console.log(`[WARN] Rolling back to stored previous height ${prevBlockHeight}`);
                console.log(`[WARN] Rollback - actual previous hash ${prevBlockHash}`);
                console.log(`[WARN] Rollback - stored previous hash ${storedPrevCheckpointHash}`);
                if(maxRollback > 0 && rollbackCount > maxRollback) {
                    throw Error("A large rollback occurred when rolling back due to prev hash mismatch, this should not happen, shutting down");
                }
                actualHash = prevBlockHash;
                lastCheckpoint.height = prevBlockHeight;
            }
            if(rollbackCount > 0 && lastCheckpoint.height > from) {
                console.log(`[WARN] Current checkpoint at ${actualHash} ${lastCheckpoint.height}`);
                await Info.updateBlockCheckpoint(lastCheckpoint.height, actualHash);
            } else if(lastCheckpoint.height <= from) {
                return { height: from, hash: null, hadReorg: true }
            }
        }

        // return current checkpoint - if a rollback occured the returned value will be for the matching previous block hash
        return { hash: actualHash, height: lastCheckpoint.height, hadReorg };
    }

    async processBlocksForSLP() {
        await Bit.sync(this, 'block');
    }

    async processCurrentMempoolForSLP() {
        await this.syncSlpMempool();
    }
}

interface SlpPropertyDetails {
    valid: boolean;
    detail: SlpTransactionDetailsTnaDbo | null;
    invalidReason: string | null;
}
