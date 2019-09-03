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
import { RpcClient } from './rpc';
import { SetCache } from './cache';
import { SlpGraphManager } from './slpgraphmanager';
import { Notifications } from './notifications';

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
    db!: Db;
    rpc!: RpcClient;
    tna!: TNA;
    outsock = zmq.socket('pub');
    queue = new pQueue({ concurrency: Config.rpc.limit });
    slpMempool = new Map<txid, txhex>();
    slpMempoolIgnoreSetList = new SetCache<string>(Config.core.slp_mempool_ignore_length);
    blockHashIgnoreSetList = new SetCache<string>(10);
    _slpGraphManager!: SlpGraphManager;
    _zmqItemQueue: pQueue<pQueue.DefaultAddOptions>;
    network!: string;
    notifications!: Notifications;

    constructor() { 
        this._zmqItemQueue = new pQueue({ concurrency: 1, autoStart: true });
        this.outsock.bindSync('tcp://' + Config.zmq.outgoing.host + ':' + Config.zmq.outgoing.port);
    }

    slp_txn_filter(txnhex: string): boolean {
        if(txnhex.includes('6a04534c5000')) {
            return true;
        }
        return false;
    }
    
    async init(db: Db, rpc: RpcClient) {
        this.db = db;
        this.rpc = rpc;
        this.network = await Info.getNetwork();
        await this.waitForFullNodeSync();
        this.tna = new TNA();
        //this.lastBlockProcessing = (await Info.getBlockCheckpoint()).height;
    }

    private async waitForFullNodeSync() {
        let bitbox = this.network === 'mainnet' ? new BITBOX({ restURL: `https://rest.bitcoin.com/v2/` }) : new BITBOX({ restURL: `https://trest.bitcoin.com/v2/` });
        let isSyncd = false;
        let lastReportedSyncBlocks = 0;
        while (!isSyncd) {
            let syncdBlocks = (await this.rpc.getBlockchainInfo()).blocks;
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
            return await this.rpc.getBlockCount();
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
        if(!txhex)
            txhex = <string>await this.rpc.getRawTransaction(txid);
        if(this.slp_txn_filter(txhex)) {
            this.slpMempool.set(txid, txhex);
            return { isSlp: true, added: true };
        } else {
            this.slpMempoolIgnoreSetList.push(txid);
        }
        return { isSlp: false, added: false };
    }

    async removeMempoolTransaction(txid: string) {
        if(this.slpMempool.has(txid)) {
            this.slpMempool.delete(txid);
        }
        let tna = await this.db.unconfirmedFetch(txid);
        if(tna) {
            await this.db.unconfirmedDelete(txid);
        }
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
        let currentBchMempoolList = await this.rpc.getRawMemPool();
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
        let block_content = await this.rpc.getBlockInfo({ index: block_index });
        let block_hash = block_content.hash;
        let block_time = block_content.time;
        
        if (block_content) {
            console.log('[INFO] Crawling block', block_index, 'hash:', block_hash);
            let tasks: Promise<any>[] = [];
            const limit = pLimit(Config.rpc.limit);
            const self = this;

            let blockHex = <string>await this.rpc.getRawBlock(block_content.hash);
            let block = Block.fromReader(new BufferReader(Buffer.from(blockHex, 'hex')));
            for(let i=1; i < block.txs.length; i++) { // skip coinbase with i=1
                let txnhex = block.txs[i].toRaw().toString('hex');

                if(this.slp_txn_filter(txnhex) && !this.slpMempool.has(block.txs[i].txid())) {
                    // This is used when SLP transactions are broadcasted for first time with a block 
                    if(triggerSlpProcessing) {
                        console.log("SLP transaction not in mempool:", block.txs[i].txid());
                        await this.handleMempoolTransaction(block.txs[i].txid(), txnhex);
                        let syncResult = await Bit.sync(this, 'mempool', block.txs[i].txid());
                        this._slpGraphManager.onTransactionHash!(syncResult!);
                    }
                    //This is used during startup block sync
                    else {
                        tasks.push(limit(async function() {
                            try {
                                let txn: bitcore.Transaction = new bitcore.Transaction(txnhex);
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
                    tasks.push(limit(async function() {
                        let timeout = 0;
                        let t: TNATxn|null = await self.db.unconfirmedFetch(block.txs[i].txid());
                    
                    // // ******************
                    // // NOTE: The SLP property will be set by the SlpGraphManager after processing is completed.
                    // //       Sometimes a block notification is received while processing a transaction notification is completed, therefore
                    // //       we must wait until processing has completed before the block processing can complete.
                    //     while(!t!.slp) {
                    //         await sleep(1000);
                    //         timeout++;
                    //         // TODO: Can check the zmqSubscriber if SLP processing is underway
                    //         if(timeout > 20) {
                    //             console.log("[ERROR] SLP was not processed within timeout periods", block.txs[i].txid());
                    //             process.exit();
                    //         }
                    //         t = await self.db.unconfirmedFetch(block.txs[i].txid());
                    //     }
                    // // 
                    // // ******************

                        t!.blk = {
                            h: block_hash,
                            i: block_index,
                            t: block_time
                        };
                        result.set(block.txs[i].txid(), { txHex: txnhex, tnaTxn: t! });
                        return t;
                    }))
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
        // Listen to ZMQ
        let sync = Bit.sync;
        this._slpGraphManager._TnaQueue = this._zmqItemQueue;
        let self = this;
        let onBlockHash = function(blockHash: Buffer) {
            self._zmqItemQueue.add(async function() {
                try {
                    let hash = blockHash.toString('hex');
                    if(self.blockHashIgnoreSetList.has(hash)) {
                        console.log('[ZMQ-SUB] Block message ignored:', hash);
                        return;
                    }
                    self.blockHashIgnoreSetList.push(hash);   
                    console.log('[ZMQ-SUB] New block found:', hash);
                    await sync(self, 'block', hash);
                    if(!self._slpGraphManager.zmqPubSocket)
                        self._slpGraphManager.zmqPubSocket = self.outsock;
                    if(self._slpGraphManager.onBlockHash)
                        self._slpGraphManager.onBlockHash!(hash!);
                } catch(err) {
                    console.log(err);
                    process.exit();
                }
            })
        }

        let onRawTxn = function(message: Buffer) {
            self._zmqItemQueue.add(async function() {
                try {
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
                } catch(err) {
                    console.log(err);
                    process.exit();
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
            currentBchMempoolList = await this.rpc.getRawMemPool();

        // add missing SLP transactions and process
        await this.asyncForEach(currentBchMempoolList, async (txid: string) => {
            if((await this.handleMempoolTransaction(txid)).added) {
                let syncResult = await Bit.sync(this, 'mempool', txid, this.slpMempool.get(txid));
                this._slpGraphManager.onTransactionHash!(syncResult!);
            }
        });

        if(recursive) {
            let residualMempoolList = (await this.rpc.getRawMemPool()).filter(id => !this.slpMempoolIgnoreSetList.has(id) && !Array.from(this.slpMempool.keys()).includes(id))
            if(residualMempoolList.length > 0)
                await this.checkForMissingMempoolTxns(residualMempoolList, true, false)
        }

        if(log) {
            console.log('[INFO] BCH mempool txn count:', (await this.rpc.getRawMemPool()).length);
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
        let currentBchMempoolList = await this.rpc.getRawMemPool();
        
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

            // TODO: Handle case where block sync is already underway (e.g., situation where 2 blocks mined together)
            if(hash) {
                console.log("[INFO] Starting to sync block:", hash);
                while(self.queue.size > 0) {
                    console.log("[DEBUG] mempool processing queue size:", self.queue.size);
                    console.log("[INFO] Waiting for mempool processing queue to complete before processing block.");
                    await sleep(1000);
                }
            }

            result = { syncType: SyncType.Block, filteredContent: new Map<SyncFilterTypes, Map<txid, txhex>>() }
            try {
                let lastCheckpoint = hash ? <ChainSyncCheckpoint>await Info.getBlockCheckpoint() : <ChainSyncCheckpoint>await Info.getBlockCheckpoint((await Info.getNetwork()) === 'mainnet' ? Config.core.from : Config.core.from_testnet);
                
                lastCheckpoint = await Bit.checkForBlockReorg(self, lastCheckpoint);

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
                    }

                    await Info.deleteBlockCheckpointHash(index - 11);
                    await Info.updateBlockCheckpoint(index, await self.rpc.getBlockHash(index));
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
                console.log('[INFO] Shutting down SLPDB...', new Date().toString());
                await self.db.exit();
                throw e;
            }
        } else if (type === 'mempool') {
            result = { syncType: SyncType.Mempool, filteredContent: new Map<SyncFilterTypes, Map<txid, txhex>>() }
            if (hash) {
                let txn: bitcore.Transaction|null = await self.getSlpMempoolTransaction(hash);
                if(!txn && !self.slpMempoolIgnoreSetList.has(hash)) {
                    if(!txhex)
                        throw Error("Must provide 'txhex' if txid is not in the SLP mempool")
                    if(self.slp_txn_filter(txhex))
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
                            process.exit();
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

    private static async checkForBlockReorg(self: Bit, lastCheckpoint: ChainSyncCheckpoint): Promise<ChainSyncCheckpoint> {
        let actualHash = await self.rpc.getBlockHash(lastCheckpoint.height);
        // ignore this re-org check if the checkpoint block hash is null
        if (lastCheckpoint.hash) {
            let lastCheckedHash = lastCheckpoint.hash;
            let lastCheckedHeight = lastCheckpoint.height;
            let from = (await Info.getNetwork()) === 'mainnet' ? Config.core.from : Config.core.from_testnet;
            while (lastCheckedHash !== actualHash && lastCheckedHeight > from) {
                await Info.updateBlockCheckpoint(lastCheckedHeight, null);
                lastCheckedHash = await Info.getCheckpointHash(--lastCheckedHeight);
                actualHash = (<BlockHeaderResult>await self.rpc.getBlockInfo({hash: actualHash})).previousblockhash;
            }
            if(lastCheckpoint.hash !== lastCheckedHash)
                await Info.updateBlockCheckpoint(lastCheckedHeight, lastCheckedHash);
        }
        return await Info.getBlockCheckpoint();
    }

    async processBlocksForTNA() {
        await Bit.sync(this, 'block');
    }

    async processCurrentMempoolForTNA() {
        let items = await this.requestSlpMempool();
        await this.db.unconfirmedSync(items);
    }
}
