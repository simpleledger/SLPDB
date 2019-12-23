import { Info, ChainSyncCheckpoint } from './info';
import { TNA, TNATxn } from './tna';
import { Config } from './config';
import { Db } from './db';
import { Query } from './query';

import pLimit = require('p-limit');
import * as pQueue from 'p-queue';
import * as zmq from 'zeromq';
import { BlockHeaderResult } from 'bitcoin-com-rest';
import { BITBOX } from 'bitbox-sdk';
import * as bitcore from 'bitcore-lib-cash';
import { Primatives, SlpTransactionType } from 'slpjs';
import { RpcClient } from './rpc';
import { CacheSet, CacheMap } from './cache';
import { SlpGraphManager } from './slpgraphmanager';
import { Notifications } from './notifications';
import { SlpdbStatus } from './status';
import { GraphTxnDbo } from './interfaces';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

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

export type CrawlResult = Map<txid, CrawlTxnInfo>;

export interface CrawlTxnInfo {
    tnaTxn: TNATxn;
    txHex: string;
}
export type txhex = string;
export type txid = string;
//export type TransactionPool = Map<txid, txhex>;

export class Bit {
    db: Db;
    tna: TNA = new TNA();
    outsock = zmq.socket('pub');
    slpMempool = new Map<txid, txhex>();
    txoDoubleSpendCache = new CacheMap<string, any>(20);
    doubleSpendCache = new CacheSet<string>(100);
    slpMempoolIgnoreSetList = new CacheSet<string>(Config.core.slp_mempool_ignore_length);
    blockHashIgnoreSetList = new CacheSet<string>(10);
    _slpGraphManager!: SlpGraphManager;
    _zmqItemQueue: pQueue<pQueue.DefaultAddOptions>;
    network!: string;
    notifications!: Notifications;
    _spentTxoCache = new CacheMap<string, { txid: string, block: number|null }>(100000);

    constructor(db: Db) { 
        this.db = db;
        this._zmqItemQueue = new pQueue({ concurrency: 1, autoStart: true });
        if(Config.zmq.outgoing.enable)
            this.outsock.bindSync('tcp://' + Config.zmq.outgoing.host + ':' + Config.zmq.outgoing.port);
    }

    async init() {
        this.network = await Info.getNetwork();
        await this.waitForFullNodeSync();
    }

    slpTransactionFilter(txnhex: string): boolean {
        if(txnhex.includes('6a04534c5000')) {
            return true;
        }
        return false;
    }

    private async waitForFullNodeSync() {
        let bitbox = this.network === 'mainnet' ? new BITBOX({ restURL: `https://rest.bitcoin.com/v2/` }) : new BITBOX({ restURL: `https://trest.bitcoin.com/v2/` });
        let isSyncd = false;
        let lastReportedSyncBlocks = 0;
        while (!isSyncd) {
            let info = await RpcClient.getBlockchainInfo();
            let chain = info.chain;
            if(chain === 'regtest') {
                break;
            }
            let syncdBlocks = info.blocks;
            let networkBlocks = (await bitbox.Blockchain.getBlockchainInfo()).blocks;
            isSyncd = syncdBlocks === networkBlocks ? true : false;
            if (syncdBlocks !== lastReportedSyncBlocks)
                console.log("[INFO] Waiting for bitcoind to sync with network ( on block", syncdBlocks, "of", networkBlocks, ")");
            else
                console.log("[WARN] bitcoind sync status did not change, check your bitcoind network connection.");
            lastReportedSyncBlocks = syncdBlocks;
            await sleep(2000);
        }
    }
    
    async requestheight(): Promise<number> {
        try{
            return await RpcClient.getBlockCount();
        } catch(err) {
            console.log('Check your RPC connection. Could not get height from full node rpc call.')
            throw err;
        }
    }

    async getSlpMempoolTransaction(txid: string): Promise<bitcore.Transaction|null> {
        if(this.slpMempool.has(txid)) {
            return new bitcore.Transaction(this.slpMempool.get(txid)!);
        }
        return null;
    }

    async handleMempoolTransaction(txid: string, txhex?: string): Promise<{ isSlp: boolean, added: boolean }> {
        if(this.slpMempool.has(txid))
            return { isSlp: true, added: false };  
        if(this.slpMempoolIgnoreSetList.has(txid))
            return { isSlp: false, added: false };
        if(!txhex) {
            try {
                txhex = <string>await RpcClient.getRawTransaction(txid);
            } catch(err) {
                console.log(`[ERROR] Could not find tranasaction ${txhex} in handleMempoolTransaction: ${err}`);
                return { isSlp: false, added: false }
            }
        }
        let txnBuf = Buffer.from(txhex, 'hex');
        RpcClient.loadTxnIntoCache(txid, txnBuf);

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
                    if(this._slpGraphManager._tokens.has(doubleSpentTxid)) {
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
            if (!txo.startsWith('0'.repeat(64))) { // ignore coinbase
                this._spentTxoCache.set(txo, { txid, block: null });
            }
        });

        let tokenIdToUpdate= new Set<string>();
        if(txidToDelete.length > 0) {
            for (let i = 0; i < txidToDelete.length; i++) {
                for (let [tokenId, g ] of this._slpGraphManager._tokens) { 
                    if (g._graphTxns.has(txidToDelete[i])) {
                        this.slpMempool.delete(txidToDelete[i]);
                        RpcClient.transactionCache.delete(txidToDelete[i]);
                        g._graphTxns.delete(txidToDelete[i]);
                        tokenIdToUpdate.add(txidToDelete[i]);
                        tokenIdToUpdate.add(g._tokenDetails.tokenIdHex);
                        break;
                    }
                }
            }
        }
        tokenIdToUpdate.forEach(tokenId => {
            if (this._slpGraphManager._tokens.has(tokenId)) {
                this._slpGraphManager._tokens.get(tokenId)!.UpdateStatistics();  // no need to await
            }
        });

        if(this.slpTransactionFilter(txhex)) {
            this.slpMempool.set(txid, txhex);
            return { isSlp: true, added: true };
        } else {
            this.slpMempoolIgnoreSetList.push(txid);
        }
        return { isSlp: false, added: false };
    }

    async removeMempoolTransaction(txid: string) {
        this.slpMempool.delete(txid);
        this.db.unconfirmedDelete(txid);
    }

    async requestSlpMempool(): Promise<TNATxn[]> {
        try {
            await this.syncSlpMempool();
            let tasks: any[] = [];
            const limit = pLimit(Config.rpc.limit);
            let self = this;
            this.slpMempool.forEach((txhex, txid, map) => {
                tasks.push(limit(async function() {
                    let content = <bitcore.Transaction>(await self.getSlpMempoolTransaction(txid));
                    return self.tna.fromTx(content, { network: self.network });
                }))
            })
            let res = await Promise.all(tasks);
            return res;
        } catch(err) {
            console.log("An unknown error occurred while processing mempool transactions.");
            throw err;
        }
    }

    async asyncForEach(array: any[], callback: Function) {
        for (let index = 0; index < array.length; index++) {
          await callback(array[index], index, array);
        }
    }

    async syncSlpMempool() {
        let currentBchMempoolList = await RpcClient.getRawMemPool();
        console.log('[INFO] BCH mempool txs =', currentBchMempoolList.length);
        
        // Remove cached txs not in the mempool.
        this.removeExtraneousMempoolTxns();
        
        // Add SLP txs to the mempool not in the cache.
        let cachedSlpMempoolTxs = Array.from(this.slpMempool.keys());
        await this.asyncForEach(currentBchMempoolList, async (txid: string) => cachedSlpMempoolTxs.includes(txid) ? null : await this.handleMempoolTransaction(txid) );
        
        console.log('[INFO] SLP mempool txs =', this.slpMempool.size);
    }

    async crawl(block_index: number, triggerSlpProcessing: boolean): Promise<CrawlResult|null> {
        let result = new Map<txid, CrawlTxnInfo>();
        let block_content: BlockHeaderResult;
        try {
            block_content = await RpcClient.getBlockInfo({ index: block_index });
        } catch(_) {
            return null;
        }
        let block_hash = block_content.hash;
        let block_time = block_content.time;
        
        if (block_content) {
            console.log('[INFO] Crawling block', block_index, 'hash:', block_hash);
            let tasks: Promise<any>[] = [];
            const limit = pLimit(Config.rpc.limit);
            const self = this;

            let blockHex = <string>await RpcClient.getRawBlock(block_content.hash);
            let block = Block.fromReader(new BufferReader(Buffer.from(blockHex, 'hex')));
            for(let i=1; i < block.txs.length; i++) { // skip coinbase with i=1
                let txnBuf: Buffer = block.txs[i].toRaw();
                let txnhex: string = txnBuf.toString('hex');
                let txid = block.txs[i].txid();
                if(this.slpTransactionFilter(txnhex) && !this.slpMempool.has(txid)) {
                    // This is used when SLP transactions are broadcasted for first time with a block 
                    if(triggerSlpProcessing) {
                        console.log("SLP transaction not in mempool:", txid);
                        await this.handleMempoolTransaction(txid, txnhex);
                        let syncResult = await Bit.sync(this, 'mempool', txid);
                        this._slpGraphManager.onTransactionHash!(syncResult!);
                    }
                    // This is used during startup block sync
                    else {
                        RpcClient.transactionCache.set(txid, txnBuf);
                        let seenTokenIds = new Set<string>();
                        tasks.push(limit(async function() {
                            try {
                                let txn: bitcore.Transaction = new bitcore.Transaction(txnhex);
                                try {
                                    let slpMsg = self._slpGraphManager.slp.parseSlpOutputScript(txn.outputs[0]._scriptBuffer);
                                    if(slpMsg.transactionType === SlpTransactionType.GENESIS) {
                                        slpMsg.tokenIdHex = txid;
                                    }
                                    if (!seenTokenIds.has(slpMsg.tokenIdHex)) {
                                        await Info.setLastBlockSeen(slpMsg.tokenIdHex, block_index);
                                        seenTokenIds.add(slpMsg.tokenIdHex);
                                    }
                                } catch(_) { }
                                let t: TNATxn = await self.tna.fromTx(txn, { network: self.network });
                                result.set(txn.hash, { txHex: txnhex, tnaTxn: t })
                                t.blk = {
                                    h: block_hash,
                                    i: block_index,
                                    t: block_time
                                };
                                return t;
                            } catch(err) {
                                console.log('[Error] crawl error:', err.message);
                                throw err;
                            }
                        }))
                    }
                }

                if(this.slpMempool.has(block.txs[i].txid())) {
                    console.log("[INFO] Mempool has txid", block.txs[i].txid());
                    let seenTokenIds = new Set<string>();
                    tasks.push(limit(async function() {
                        let t: TNATxn|null = await self.db.unconfirmedFetch(block.txs[i].txid());
                        if(!t) {
                            let txn: bitcore.Transaction = new bitcore.Transaction(txnhex);
                            try {
                                let slpMsg = self._slpGraphManager.slp.parseSlpOutputScript(txn.outputs[0]._scriptBuffer);
                                if(slpMsg.transactionType === SlpTransactionType.GENESIS) {
                                    slpMsg.tokenIdHex = txid;
                                }
                                if (!seenTokenIds.has(slpMsg.tokenIdHex)) {
                                    await Info.setLastBlockSeen(slpMsg.tokenIdHex, block_index);
                                    seenTokenIds.add(slpMsg.tokenIdHex);
                                }
                            } catch(_) { }
                            t = await self.tna.fromTx(txn, { network: self.network });
                        }
                        t.blk = {
                            h: block_hash,
                            i: block_index,
                            t: block_time
                        };
                        result.set(block.txs[i].txid(), { txHex: txnhex, tnaTxn: t });
                        return t;
                    }));
                }
            }
            let btxs = (await Promise.all(tasks)).filter(i => i);
            console.log('[INFO] Block', block_index, 'processed :', block.txs.length, 'BCH txs |', btxs.length, 'SLP txs');
            return result;
        } else {
            return null;
        }
    }

    listenToZmq() {
        let sync = Bit.sync;
        this._slpGraphManager._TnaQueue = this._zmqItemQueue;
        let self = this;
        let onBlockHash = function(blockHash: Buffer) {
            SlpdbStatus.updateTimeIncomingBlockZmq();
            self._zmqItemQueue.add(async function() {
                let hash = blockHash.toString('hex');
                if(self.blockHashIgnoreSetList.has(hash)) {
                    console.log('[ZMQ-SUB] Block message ignored:', hash);
                    return;
                }
                self.blockHashIgnoreSetList.push(hash); 
                console.log('[ZMQ-SUB] New block found:', hash);
                await sync(self, 'block', hash);
                if(!self._slpGraphManager.zmqPubSocket) {
                    self._slpGraphManager.zmqPubSocket = self.outsock;
                }
                if(self._slpGraphManager.onBlockHash) {
                    self._slpGraphManager.onBlockHash!(hash!);
                }
            });
        }

        let onRawTxn = function(message: Buffer) {
            SlpdbStatus.updateTimeIncomingTxnZmq();
            self._zmqItemQueue.add(async function() {
                let rawtx = message.toString('hex');
                let hash = Buffer.from(bitbox.Crypto.hash256(message).toJSON().data.reverse()).toString('hex');
                if((await self.handleMempoolTransaction(hash, rawtx)).added) {
                    console.log('[ZMQ-SUB] New unconfirmed transaction added:', hash);
                    let syncResult = await sync(self, 'mempool', hash);
                    if(!self._slpGraphManager.zmqPubSocket)
                        self._slpGraphManager.zmqPubSocket = self.outsock;
                    if(syncResult && self._slpGraphManager.onTransactionHash) {
                        self._slpGraphManager.onTransactionHash!(syncResult);
                    }
                } else {
                    console.log('[INFO] Transaction ignored:', hash);
                }
            })
        }
        this.notifications = new Notifications({ 
            onRawTxnCb: onRawTxn, 
            onBlockHashCb: onBlockHash, 
            useGrpc: Boolean(Config.grpc.url) 
        })

        console.log('[INFO] Listening for blockchain events...');
    }

    // This method is called at the end of processing each block
    async handleConfirmedTxnsMissingSlpMetadata() {
        let missing = await Query.queryForConfirmedMissingSlpMetadata();
        if(missing) {
            await this.asyncForEach(missing, async (txid:string) => {
                await this._slpGraphManager.updateTxnCollections(txid);
            })
        }
    }

    async checkForMissingMempoolTxns(currentBchMempoolList?: string[], recursive=false, log=true) {
        if(!currentBchMempoolList)
            currentBchMempoolList = await RpcClient.getRawMemPool();

        // add missing SLP transactions and process
        await this.asyncForEach(currentBchMempoolList, async (txid: string) => {
            if((await this.handleMempoolTransaction(txid)).added) {
                let syncResult = await Bit.sync(this, 'mempool', txid, this.slpMempool.get(txid));
                this._slpGraphManager.onTransactionHash!(syncResult!);
            }
        });

        if(recursive) {
            let residualMempoolList = (await RpcClient.getRawMemPool()).filter(id => !this.slpMempoolIgnoreSetList.has(id) && !Array.from(this.slpMempool.keys()).includes(id))
            if(residualMempoolList.length > 0)
                await this.checkForMissingMempoolTxns(residualMempoolList, true, false)
        }

        if(log) {
            console.log('[INFO] BCH mempool txn count:', (await RpcClient.getRawMemPool()).length);
            console.log("[INFO] SLP mempool txn count:", this.slpMempool.size);
        }
    }

    // async checkCurrentBlockHeight() { 
    //     //let ldb_block = await Info.getBlockCheckpoint();
    //     let rpc_block = await this.rpc.getBlockCount();
    //     if(rpc_block > this.lastBlockProcessing) {

    //     }
    // }

    async removeExtraneousMempoolTxns() {
        let currentBchMempoolList = await RpcClient.getRawMemPool();
        
        // remove extraneous SLP transactions no longer in the mempool
        let cacheCopyForRemovals = new Map(this.slpMempool);
        let txids = cacheCopyForRemovals.keys()
        for(let i = 0; i < cacheCopyForRemovals.size; i++) {
            let txid = txids.next().value
            if(!currentBchMempoolList.includes(txid)) {
                await this.removeMempoolTransaction(txid)
            }
        }     
    }

    static async sync(self: Bit, type: string, hash?: string, txhex?: string): Promise<SyncCompletionInfo|null> {
        let result: SyncCompletionInfo;
        if (type === 'block') {

            result = { syncType: SyncType.Block, filteredContent: new Map<SyncFilterTypes, Map<txid, txhex>>() }
            try {
                let lastCheckpoint = hash ? <ChainSyncCheckpoint>await Info.getBlockCheckpoint() : <ChainSyncCheckpoint>await Info.getBlockCheckpoint((await Info.getNetwork()) === 'mainnet' ? Config.core.from : Config.core.from_testnet);
                
                lastCheckpoint = await Bit.checkForBlockReorg(lastCheckpoint);

                let currentHeight: number = await self.requestheight();
            
                for(let index: number = lastCheckpoint.height + 1; index <= currentHeight; index++) {
                    console.time('[PERF] RPC END ' + index);
                    let requireSlpData = hash ? true : false;
                    let content = <CrawlResult>(await self.crawl(index, requireSlpData));
                    console.timeEnd('[PERF] RPC END ' + index);
                    console.time('[PERF] DB Insert ' + index);
            
                    if(content) {
                        let array = Array.from(content.values()).map(c => c.tnaTxn);
                        await self.db.confirmedReplace(array, requireSlpData, index);
                        array.forEach(tna => {
                            self.removeMempoolTransaction(tna.tx.h);
                        });
                    }
                    if (index - 100 > 0) {
                        await Info.deleteBlockCheckpointHash(index - 100);
                    }
                    try {
                        await Info.updateBlockCheckpoint(index, await RpcClient.getBlockHash(index));
                    } catch(_) {
                        lastCheckpoint = await Bit.checkForBlockReorg(lastCheckpoint);
                        index = lastCheckpoint.height;
                        continue;
                    }
                    console.timeEnd('[PERF] DB Insert ' + index);

                    // re-check current height in case it was updated during crawl()
                    currentHeight = await self.requestheight();
                }

                // clear mempool and synchronize
                if (lastCheckpoint.height < currentHeight && hash) {
                    await self.checkForMissingMempoolTxns();
                    await self.removeExtraneousMempoolTxns();
                    await self.handleConfirmedTxnsMissingSlpMetadata();
                }
            
                if (lastCheckpoint.height === currentHeight) {
                    return result;
                } else {
                    return null;
                }
            } catch (e) {
                console.log('[ERROR] block sync Error');
                throw e;
            }
        } else if (type === 'mempool') {
            result = { syncType: SyncType.Mempool, filteredContent: new Map<SyncFilterTypes, Map<txid, txhex>>() }
            if (hash) {
                let txn: bitcore.Transaction|null = await self.getSlpMempoolTransaction(hash);
                if(!txn && !self.slpMempoolIgnoreSetList.has(hash)) {
                    if(!txhex)
                        throw Error("Must provide 'txhex' if txid is not in the SLP mempool")
                    if(self.slpTransactionFilter(txhex))
                        txn = new bitcore.Transaction(txhex);
                }

                if(txn) {
                    let content: TNATxn = await self.tna.fromTx(txn, { network: self.network });
                    try {
                        await self.db.unconfirmedInsert(content);
                        console.log("[INFO] SLP mempool transaction added: ", hash);
                    } catch (e) {
                        if (e.code == 11000) {
                            console.log('[WARN] Mempool item already exists:', content);
                            //await self.db.mempoolreplace(content);
                        } else {
                            console.log('[ERROR] Mempool sync ERR:', e, content);
                            throw e;
                        }
                    }

                    let pool = new Map<txid, txhex>();
                    pool.set(hash, txn.toString());
                    result.filteredContent.set(SyncFilterTypes.SLP, pool)
                } else {
                    console.log("[INFO] Skipping non-SLP transaction:", hash);
                }

                return result;
            }
        }
        return null;
    }

    static async checkForBlockReorg(lastCheckpoint: ChainSyncCheckpoint): Promise<ChainSyncCheckpoint> {
        // first, find a height with a block hash - should normallly be found on first try, otherwise rollback
        let from = (await Info.getNetwork()) === 'mainnet' ? Config.core.from : Config.core.from_testnet;
        let hadReorg = false;
        let actualHash: string|null = null;
        let maxRollback = 100;
        let rollbackCount = 0;
        while(!actualHash) {
            try {
                console.log(`[INFO] Checking for reorg for ${lastCheckpoint.height}`);
                actualHash = await RpcClient.getBlockHash(lastCheckpoint.height);
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

    async processBlocksForTNA() {
        await Bit.sync(this, 'block');
    }

    async processCurrentMempoolForTNA() {
        let items = await this.requestSlpMempool();
        await this.db.unconfirmedSync(items);
    }
}
