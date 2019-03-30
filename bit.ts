import { Info, ChainSyncCheckpoint } from './info';
import { Bitcore, BitcoinRpc } from './vendor';
import { TNA, TNATxn } from './tna';
import { Config } from './config';
import { Db } from './db';

import pLimit from 'p-limit';
import pQueue, { DefaultAddOptions } from 'p-queue';
import zmq from 'zeromq';
import { BlockDetails } from 'bitbox-sdk/lib/Block';
import BITBOXSDK from 'bitbox-sdk';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const Block = require('bcash/lib/primitives/block');
const BufferReader = require('bufio/lib/reader');
const bitcore = require('bitcore-lib-cash');

export enum SyncType {
    "Mempool", "Block"
}

export enum SyncFilterTypes {
    "BCH", "SLP"
}

export interface SyncCompletionInfo {
    syncType: SyncType;
    filteredContent: Map<SyncFilterTypes, TransactionPool>;
}

export interface IZmqSubscriber {
    onTransactionHash: undefined | ((syncInfo: SyncCompletionInfo) => Promise<void>);
    onBlockHash: undefined | ((blockhash: string) => Promise<void>);
    zmqPubSocket?: zmq.Socket; 
}
export type CrawlResult = Map<txid, CrawlTxnInfo>;

export interface CrawlTxnInfo {
    tnaTxn: TNATxn;
    txHex: string;
}
export type txhex = string;
export type txid = string;
export type TransactionPool = Map<txid, txhex>;

export class Bit {
    db!: Db;
    rpc!: BitcoinRpc.RpcClient;
    tna!: TNA;
    outsock: zmq.Socket;
    queue: pQueue<DefaultAddOptions>;
    slpMempool: TransactionPool;
    slpMempoolIgnoreList: string[]; 
    _zmqSubscribers: IZmqSubscriber[];
    network!: string;

    constructor() {
        this.outsock = zmq.socket('pub');
        this.queue = new pQueue({ concurrency: Config.rpc.limit });
        this.slpMempool = new Map<txid, txhex>();
        this._zmqSubscribers = [];
        this.slpMempoolIgnoreList = [];
    }

    slp_txn_filter(txnhex: string, isBlock=false): boolean {
        if(txnhex.includes('6a04534c5000')) {
            return true;
        }
        if(!isBlock) {
            let txn: Bitcore.Transaction = new bitcore.Transaction(txnhex);
            this.slpMempoolIgnoreList.push(txn.id);
            if(this.slpMempoolIgnoreList.length > 10000)
                this.slpMempoolIgnoreList.pop();
        }

        return false;
    }
    
    async init(db: Db, rpc: BitcoinRpc.RpcClient) {
        this.db = db;
        this.rpc = rpc;

        this.network = await Info.getNetwork();
        let BITBOX = this.network === 'mainnet' ? new BITBOXSDK({ restURL: `https://rest.bitcoin.com/v2/` }) : new BITBOXSDK({ restURL: `https://trest.bitcoin.com/v2/` });

        let isSyncd = false;
        let lastReportedSyncBlocks = 0;
        while(!isSyncd) {
            let syncdBlocks = (await this.rpc.getInfo()).blocks;
            let networkBlocks = (await BITBOX.Blockchain.getBlockchainInfo()).blocks;
            isSyncd = syncdBlocks === networkBlocks ? true : false;
            if(syncdBlocks !== lastReportedSyncBlocks)
                console.log("[INFO] Waiting for bitcoind to sync with network ( on block", syncdBlocks, "of", networkBlocks, ")");
            else 
                console.log("[WARN] bitcoind sync status did not change, check your bitcoind network connection.")
            lastReportedSyncBlocks = syncdBlocks;
            await sleep(2000);
        }
        this.tna = new TNA(this.rpc);
    }

    async requestblock(block_index: number): Promise<BlockDetails> {
        try {
            let hash = await this.rpc.getBlockHash(block_index);
            return await this.rpc.getBlock(hash);
        } catch(err) {
            console.log('Check your JSON-RPC connection. Could not get block from full node rpc call.');
            throw err;
        }
    }
    
    async requestheight(): Promise<number> {
        try{
            return await this.rpc.getBlockCount();
        } catch(err) {
            console.log('Check your JSON-RPC connection. Could not get height from full node rpc call.')
            throw err;
        }
    }

    async getSlpMempoolTransaction(txid: string): Promise<Bitcore.Transaction|null> {
        if(this.slpMempool.has(txid)){
            return new bitcore.Transaction(this.slpMempool.get(txid));
        }
        return null;
    }

    async handleWiredSlpTransaction(txid: string): Promise<{ isSlp: boolean, added: boolean }> {
        // case whien SLP mempool already has txn
        if(this.slpMempool.has(txid))
            return { isSlp: true, added: false };  
        // try to add as SLP if not blacklisted
        else if(!this.slpMempoolIgnoreList.includes(txid)) {
            let txhex = await this.rpc.getRawTransaction(txid);
            if(this.slp_txn_filter(txhex)) {
                this.slpMempool.set(txid, txhex);
                return { isSlp: true, added: true };
            }
            return { isSlp: false, added: false };
        }
        // otherwise, must be blacklisted (non-SL txn)
        return { isSlp: false, added: false};
    }

    async removeCachedTransaction(txid: string) {
        try { 
            this.slpMempool.delete(txid);
            await this.db.db.collection('unconfirmed').deleteOne({ "tx.h": txid });
        } catch(err){ 
            console.log(err);
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
                    let content = <Bitcore.Transaction>(await self.getSlpMempoolTransaction(txid));
                    return self.tna.fromTx(content);
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
        let currentBchMempoolList = await this.rpc.getRawMempool();
        console.log('[INFO] BCH mempool txs =', currentBchMempoolList.length);
        
        // Remove cached txs not in the mempool.
        let cacheCopyForRemovals = new Map(this.slpMempool);
        cacheCopyForRemovals.forEach((txhex, txid) => currentBchMempoolList.includes(txid) ? null : this.removeCachedTransaction(txid) );
        
        // Add SLP txs to the mempool not in the cache.
        let cachedSlpMempoolTxs = Array.from(this.slpMempool.keys());
        await this.asyncForEach(currentBchMempoolList, async (txid: string) => cachedSlpMempoolTxs.includes(txid) ? null : await this.handleWiredSlpTransaction(txid) );
        
        console.log('[INFO] SLP mempool txs =', this.slpMempool.size);
    }

    async crawl(block_index: number, listenMode: boolean): Promise<CrawlResult|null> {
        let result = new Map<txid, CrawlTxnInfo>();
        let block_content = await this.requestblock(block_index);
        let block_hash = block_content.hash;
        let block_time = block_content.time;
        
        if (block_content) {
            let txs: string[] = block_content.tx;
            console.log('[INFO] Crawling block', block_index, 'txs:', txs.length);
            let tasks: Promise<any>[] = [];
            const limit = pLimit(Config.rpc.limit);
            const self = this;

            let blockHex: string = await this.rpc.getBlock(block_content.hash, false);
            // let re = /^([A-Fa-f0-9]{2}){80,}$/;
            // if(!re.test(blockHex.slice(0,162)))
            //     throw Error("RPC did not return valid block content, check your RPC connection with bitcoind.");
            let block = Block.fromReader(new BufferReader(Buffer.from(blockHex, 'hex')));
            console.log("Mempool:", this.slpMempool);
            for(let i=0; i < block.txs.length; i++) {
                let txnhex = block.txs[i].toRaw().toString('hex');

                if(listenMode && this.slp_txn_filter(txnhex) && !this.slpMempool.has(block.txs[i].txid())) {
                    while(!this.slpMempool.has(block.txs[i].txid())) {
                        console.log("SLP transaction not in mempool:", block.txs[i].txid());
                        let syncResult = await Bit.sync(this, 'mempool', block.txs[i].txid());
                        await this._zmqSubscribers[0].onTransactionHash!(syncResult!);
                    }
                }
                
                if(this.slp_txn_filter(txnhex) && !this.slpMempool.has(block.txs[i].txid())) {
                    tasks.push(limit(async function() {
                        try {
                            let txn: Bitcore.Transaction = new bitcore.Transaction(txnhex);
                            let t: TNATxn = await self.tna.fromTx(txn);
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
                else if(this.slpMempool.has(block.txs[i].txid())) {
                    console.log("Mempool has txid", block.txs[i].txid());
                    tasks.push(limit(async function() {
                        let t: TNATxn|undefined, tries=0;
                        while(!t) {
                            t = await self.db.mempoolfetch(block.txs[i].txid());
                            if(!t) {
                                if(tries > 5)
                                    throw Error("Cannot find transaction.");
                                await sleep(1000);
                            }
                        }
                        t.blk = {
                            h: block_hash,
                            i: block_index,
                            t: block_time
                        };
                        if(!t.slp) {
                            console.log("[ERROR] Missing SLP in", block.txs[i].txid());
                            throw Error("SLP object is null.")
                        }
                        result.set(block.txs[i].txid(), { txHex: txnhex, tnaTxn: t });
                        return t;
                    }))
                }
            }
            let btxs = await Promise.all(tasks);
            console.log('[INFO] Block', block_index, 'processed :', txs.length, 'BCH txs |', btxs.length, 'SLP txs');
            return result;
        } else {
            return null;
        }
    }

    listenToZmq() {
        let sock = zmq.socket('sub');
        sock.connect('tcp://' + Config.zmq.incoming.host + ':' + Config.zmq.incoming.port);
        sock.subscribe('hashtx');
        sock.subscribe('hashblock');

        this.outsock.bindSync('tcp://' + Config.zmq.outgoing.host + ':' + Config.zmq.outgoing.port);
        
        // Listen to ZMQ
        let sync = Bit.sync;
        let self = this;
        sock.on('message', async function(topic, message) {
            try {
                if (topic.toString() === 'hashtx') {
                    let hash = message.toString('hex');
                    console.log('[ZMQ-SUB] Txn hash:', hash);
                    let syncResult = await sync(self, 'mempool', hash);
                    for (let i = 0; i < self._zmqSubscribers.length; i++) {
                        if(!self._zmqSubscribers[i].zmqPubSocket)
                            self._zmqSubscribers[i].zmqPubSocket = self.outsock;
                        if(syncResult && self._zmqSubscribers[i].onTransactionHash) {
                            await self._zmqSubscribers[i].onTransactionHash!(syncResult);
                        }
                    }
                } else if (topic.toString() === 'hashblock') {
                    let hash = message.toString('hex');
                    console.log('[ZMQ-SUB] Block hash:', hash);
                    await sync(self, 'block', hash);
                    for (let i = 0; i < self._zmqSubscribers.length; i++) {
                        if(self._zmqSubscribers[i].zmqPubSocket === null)
                            self._zmqSubscribers[i].zmqPubSocket = self.outsock;
                        if(self._zmqSubscribers[i].onBlockHash)
                            await self._zmqSubscribers[i].onBlockHash!(hash!);
                    }
                }
            } catch(err) {
                console.log(err);
                process.exit();
            }
        })
        console.log('[INFO] Listening for blockchain events...');
        
        // Don't trust ZMQ. Try synchronizing every 10 minutes in case ZMQ didn't fire
        setInterval(async function() {
            await self.checkForMissingMempoolTxns();
            Array.from(self.slpMempool.keys()).forEach(i => console.log("[INFO] mempool txid:", i));
        }, 60000)
    }

    async checkForMissingMempoolTxns() {
        let currentBchMempoolList = await this.rpc.getRawMempool();
        console.log('[INFO] BCH mempool txn count:', currentBchMempoolList.length);
        let cachedSlpMempoolTxs = Array.from(this.slpMempool.keys());

        // add missing SLP transactions and process
        await this.asyncForEach(currentBchMempoolList, async (txid: string) => {
            if(!cachedSlpMempoolTxs.includes(txid)) {
                let syncResult = await Bit.sync(this, 'mempool', txid);
                await this._zmqSubscribers[0].onTransactionHash!(syncResult!);
            }
        });
        
        // remove extraneous SLP transactions no longer in the mempool
        let cacheCopyForRemovals = new Map(this.slpMempool);
        cacheCopyForRemovals.forEach((txhex, txid) => currentBchMempoolList.includes(txid) ? null : this.removeCachedTransaction(txid) );
        
        console.log("[INFO] SLP mempool txn count:", this.slpMempool.size);
    }

    static async sync(self: Bit, type: string, hash?: string): Promise<SyncCompletionInfo|null> {
        let result: SyncCompletionInfo;
        if (type === 'block') {
            // TODO: Handle case where block sync is already underway (e.g., situation where 2 blocks mined together)
            if(hash) {
                console.log("[INFO] Sync started at block", hash);
                console.log("Queue size", self.queue.size)
                while(self.queue.size > 0) {
                    await sleep(1000);
                    console.log("[DEBUG]", self.queue.size);
                    console.log("[INFO] Waiting for mempool processing queue to complete before processing block.");
                }
            }
            result = { syncType: SyncType.Block, filteredContent: new Map<SyncFilterTypes, TransactionPool>() }
            try {
                let lastCheckpoint: ChainSyncCheckpoint = await Info.checkpoint();
                
                // Handle block reorg
                lastCheckpoint = await Bit.checkForReorg(self, lastCheckpoint);

                let currentHeight: number = await self.requestheight();
            
                for(let index: number = lastCheckpoint.height + 1; index <= currentHeight; index++) {
                    console.time('[PERF] RPC END ' + index);
                    let content = <CrawlResult>(await self.crawl(index, hash ? true : false));
                    console.timeEnd('[PERF] RPC END ' + index);
                    console.time('[PERF] DB Insert ' + index);
            
                    if(content) {
                        let array = Array.from(content.values()).map(c => c.tnaTxn);
                        await self.db.blockinsert(array, index, hash ? true : false);
                    }

                    await Info.deleteOldTipHash(index - 1);
                    await Info.updateTip(index, await self.rpc.getBlockHash(index));
                    console.timeEnd('[PERF] DB Insert ' + index);

                    // re-check current height in case it was updated during crawl()
                    currentHeight = await self.requestheight();
                }

                // clear mempool and synchronize
                if (lastCheckpoint.height < currentHeight && hash) {
                    await self.checkForMissingMempoolTxns();
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
            result = { syncType: SyncType.Mempool, filteredContent: new Map<SyncFilterTypes, TransactionPool>() }
            if (hash) {
                let isInMempool = self.slpMempool.has(hash);
                let isSLP = (await self.handleWiredSlpTransaction(hash)).isSlp;
                let txn = await self.getSlpMempoolTransaction(hash);
                if(isSLP && !isInMempool) {
                    self.queue.add(async function() {
                        if(txn) {
                            let content: TNATxn = await self.tna.fromTx(txn);
                            try {
                                await self.db.mempoolinsert(content);
                                console.log("[INFO] SLP mempool transaction added: ", hash);
                            } catch (e) {
                                if (e.code == 11000) {
                                    console.log('[ERROR] Duplicate mempool item:', content);
                                } else {
                                    console.log('[ERROR] Mempool sync ERR:', e, content);
                                    process.exit();
                                }
                            }
                        }
                        else
                            console.log("[INFO] Skipping non-SLP transaction:", hash);
                    })
                    if(txn) {
                        let pool = new Map<txid, txhex>();
                        pool.set(hash, txn.toString());
                        result.filteredContent.set(SyncFilterTypes.SLP, pool)
                    }
                    return result;
                }
            }
        }
        return null;
    }

    private static async checkForReorg(self: Bit, lastCheckpoint: ChainSyncCheckpoint) {
        let actualHash = await self.rpc.getBlockHash(lastCheckpoint.height);
        if (lastCheckpoint.hash) {
            let lastCheckedHash = lastCheckpoint.hash;
            let lastCheckedHeight = lastCheckpoint.height;
            let from = (await Info.getNetwork()) === 'mainnet' ? Config.core.from : Config.core.from_testnet;
            while (lastCheckedHash !== actualHash && lastCheckedHeight > from) {
                lastCheckedHash = await Info.getCheckpointHash(--lastCheckedHeight);
                await Info.updateTip(lastCheckedHeight, null);
                actualHash = (await self.rpc.getBlock(actualHash)).previousblockhash;
            }
            lastCheckpoint = await Info.checkpoint();
        }
        return lastCheckpoint;
    }

    async processBlocksForTNA() {
        await Bit.sync(this, 'block');
    }

    async processCurrentMempoolForTNA() {
        let items = await this.requestSlpMempool();
        await this.db.mempoolsync(items);
    }
}
