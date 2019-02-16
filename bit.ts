import { Bitcore, BitcoinRpc } from './vendor'
const RpcClient = require('bitcoin-rpc-promise')
import zmq from 'zeromq';
import pLimit from 'p-limit';
import pQueue from 'p-queue';
import { Config } from './config';
import { Info, ChainSyncCheckpoint } from './info';
import { Db } from './db';
import { TNA, TNATxn } from './tna';
const BufferReader = require('bufio/lib/reader');
const Block = require('bcash/lib/primitives/block');

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
    onBlockHash: undefined | ((syncInfo: SyncCompletionInfo) => Promise<void>);
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
    queue: pQueue<pQueue.DefaultAddOptions>;
    slpMempool: TransactionPool;
    slpMempoolIgnoreList: string[]; 
    _zmqSubscribers: IZmqSubscriber[];

    constructor() {
        this.outsock = zmq.socket('pub')
        this.queue = new pQueue({ concurrency: Config.rpc.limit })
        this.slpMempool = new Map<txid, txhex>();
        this._zmqSubscribers = [];
        this.slpMempoolIgnoreList = [];
    }

    slp_txn_filter(txnhex: string): boolean {
        if(txnhex.includes('6a04534c5000')) {
            return true
        }
        let txn: Bitcore.Transaction = new bitcore.Transaction(txnhex);
        this.slpMempoolIgnoreList.push(txn.id);
        if(this.slpMempoolIgnoreList.length > 10000)
            this.slpMempoolIgnoreList.pop();
        return false
    }
    
    async init(db: Db) {
        console.log("[INFO] Initializing RPC connection with bitcoind...");
        this.db = db;
        let connectionString = 'http://'+ Config.rpc.user+':'+Config.rpc.pass+'@'+Config.rpc.host+':'+Config.rpc.port
        this.rpc = <BitcoinRpc.RpcClient>(new RpcClient(connectionString));
        console.log("[INFO] Testing RPC connection...");
        let block = await this.requestblock(0);
        console.log("[INFO] JSON-RPC is initialized.");
        this.tna = new TNA(this.rpc);
    }

    async requestblock(block_index: number): Promise<BitcoinRpc.RpcBlockInfo> {
        try {
            let hash = await this.rpc.getBlockHash(block_index);
            return await this.rpc.getBlock(hash);
        } catch(err) {
            //console.log('requestblock Err = ', err)
            throw Error('Check your JSON-RPC connection. Could not get block from full node rpc call.');
        }
    }
    
    async requestheight(): Promise<number> {
        try{
            return await this.rpc.getBlockCount();
        } catch(err){
            //console.log('requestheight Err = ', err)
            throw Error('Check your JSON-RPC connection. Could not get height from full node rpc call.')
        }
    }

    async getSlpMempoolTransaction(txid: string): Promise<Bitcore.Transaction|null> {
        //await this.addTransactionToSlpMempool(txid);
        if(this.slpMempool.has(txid)){
            //console.log("getSlpMempoolTransaction")
            return new bitcore.Transaction(this.slpMempool.get(txid));
        }
        return null;
    }

    async handleWiredSlpTransaction(txid: string): Promise<boolean> {
        // case whien SLP mempool already has txn
        if(this.slpMempool.has(txid))
            return true;  
        // try to add as SLP if not blacklisted
        else if(!this.slpMempoolIgnoreList.includes(txid)) {
            let txhex = await this.rpc.getRawTransaction(txid);
            if(this.slp_txn_filter(txhex)) {
                this.slpMempool.set(txid, txhex);
                return true;
            }
            return false;
        }
        // otherwise, must be blacklisted (non-SL txn)
        //console.log("IGNORE ALREADY SEEN NON-SLP: ", txid);
        return false;
    }

    removeCachedTransaction(txid: string) {
        try { 
            //console.log("REMOVED FROM SLP MEMPOOL:", txid);
            this.slpMempool.delete(txid);
        } catch(_){ } 
    }

    async requestSlpMempool(): Promise<TNATxn[]> {
        try {
            await this.syncSlpMempool();
            let tasks: any[] = []
            const limit = pLimit(Config.rpc.limit)
            let self = this;
            //console.log("This mempool:", this.slpMempool);
            this.slpMempool.forEach((txhex, txid, map) => {
                tasks.push(limit(async function() {
                    let content = <Bitcore.Transaction>(await self.getSlpMempoolTransaction(txid))
                    return self.tna.fromTx(content);
                }))
            })
            let res = await Promise.all(tasks)
            return res;
        } catch(err) {
            throw Error("Any unknown error has occurred when processing mempool transactions.");
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
        //console.log("SLP MEMPOOL", cachedSlpMempoolTxs);
        //console.log("BCH MEMPOOL", currentBchMempoolList);
        await this.asyncForEach(currentBchMempoolList, async (txid: string) => cachedSlpMempoolTxs.includes(txid) ? null : await this.handleWiredSlpTransaction(txid) );
        
        console.log('[INFO] SLP mempool txs =', this.slpMempool.size);
    }

    async crawl(block_index: number): Promise<CrawlResult|null> {
        let result = new Map<txid, CrawlTxnInfo>();
        let block_content = await this.requestblock(block_index)
        let block_hash = block_content.hash
        let block_time = block_content.time
        
        if (block_content) {
            let txs: string[] = block_content.tx
            console.log('[INFO] Crawling block txs:', txs.length)
            let tasks: Promise<any>[] = []
            const limit = pLimit(Config.rpc.limit)
            const self = this;

            let blockHex: string = await this.rpc.getBlock(block_content.hash, false)
            let block = Block.fromReader(new BufferReader(Buffer.from(blockHex, 'hex')));

            for(let i=0; i < txs.length; i++) {
                let txnhex = block.txs[i].toRaw().toString('hex');
                if(this.slp_txn_filter(txnhex)) {
                    tasks.push(limit(async function() {
                        try {
                            let txn: Bitcore.Transaction = new bitcore.Transaction(txnhex);
                            let t: TNATxn = await self.tna.fromTx(txn);
                            result.set(txn.hash, { txHex: txnhex, tnaTxn: t })
                            t.blk = {
                                i: block_index,
                                h: block_hash,
                                t: block_time
                            }
                            return t;
                        } catch(err) {
                            console.log('[Error] crawl error:', err)
                        }
                    }))
                }
            }
            let btxs = await Promise.all(tasks)
            console.log('[INFO] Block', block_index, 'processed :', txs.length, 'BCH txs |', btxs.length, 'SLP txs')
            return result;
        } else {
            return null
        }
    }

    listenToZmq() {
        let sock = zmq.socket('sub')
        sock.connect('tcp://' + Config.zmq.incoming.host + ':' + Config.zmq.incoming.port)
        sock.subscribe('hashtx')
        sock.subscribe('hashblock')

        // TODO: Move this zmq publishing code elsewhere
        //console.log('Subscriber connected to port', Config.zmq.incoming.port)
        this.outsock.bindSync('tcp://' + Config.zmq.outgoing.host + ':' + Config.zmq.outgoing.port)
        //console.log('Started publishing to ' + Config.zmq.outgoing.host + ':' + Config.zmq.outgoing.port)
        
        // Listen to ZMQ
        let sync = Bit.sync;
        let self = this;
        sock.on('message', async function(topic, message) {
            if (topic.toString() === 'hashtx') {
                let hash = message.toString('hex')
                console.log('[ZMQ] Txn hash:', hash)
                let syncResult = await sync(self, 'mempool', hash)
                for (let i = 0; i < self._zmqSubscribers.length; i++) {
                    if(syncResult && self._zmqSubscribers[i].onTransactionHash) {
                        await self._zmqSubscribers[i].onTransactionHash!(syncResult);
                    }
                }
            } else if (topic.toString() === 'hashblock') {
                let hash = message.toString('hex')
                console.log('[ZMQ] Block hash:', hash)
                let syncResult = await sync(self, 'block')
                for (let i = 0; i < self._zmqSubscribers.length; i++) {
                    if(self._zmqSubscribers[i].onBlockHash)
                        await self._zmqSubscribers[i].onBlockHash!(syncResult!)
                }
            }
        })
        console.log('[INFO] Listening for blockchain events...');
        
        // Don't trust ZMQ. Try synchronizing every 10 minutes in case ZMQ didn't fire
        setInterval(async function() {
            console.log('[INFO] ##### Re-checking mempool #####')
            //await Bit.sync(self, 'block')
            await Bit.sync(self, 'mempool')
            console.log('[INFO] ##### Re-checking complete #####')
        }, 60000)
    }
        
    static async sync(self: Bit, type: string, hash?: string): Promise<SyncCompletionInfo|null> {
        let result: SyncCompletionInfo;
        if (type === 'block') {
            result = { syncType: SyncType.Block, filteredContent: new Map<SyncFilterTypes, TransactionPool>() }
            try {
                let lastCheckpoint: ChainSyncCheckpoint = await Info.checkpoint();
                
                // Handle block reorg
                lastCheckpoint = await Bit.checkForReorg(self, lastCheckpoint);

                let currentHeight: number = await self.requestheight()
            
                for(let index: number = lastCheckpoint.height; index <= currentHeight; index++) {
                    //console.log('RPC BEGIN ' + index, new Date().toString())
                    console.time('[PERF] RPC END ' + index)
                    let content = <CrawlResult>(await self.crawl(index))
                    //result.filteredContent.set(SyncFilterTypes.SLP, result.filteredContent.get(SyncFilterTypes.SLP)!.concat(content))
                    console.timeEnd('[PERF] RPC END ' + index)
                    //console.log(new Date().toString())
                    //console.log('DB BEGIN ' + index, new Date().toString())
                    console.time('[PERF] DB Insert ' + index)
            
                    if(content) {
                        let array = Array.from(content.values()).map(c => c.tnaTxn)
                        await self.db.blockinsert(array, index)
                    }

                    await Info.deleteOldTipHash(index - 1);
                    await Info.updateTip(index, await self.rpc.getBlockHash(index))
                    console.timeEnd('[PERF] DB Insert ' + index)
                    //console.log('------------------------------------------')
                    //console.log('\n')
            
                    // zmq broadcast
                    let b = { i: index, txs: content }
                    //console.log('Zmq block = ', JSON.stringify(b, null, 2))
                    self.outsock.send(['block', JSON.stringify(b)])
                }
        
                // clear mempool and synchronize
                if (lastCheckpoint.height < currentHeight) {
                    console.log('[INFO] Re-sync SLP mempool')
                    let items: TNATxn[] = await self.requestSlpMempool();
                    await self.db.mempoolsync(items)
                }
            
                if (lastCheckpoint.height === currentHeight) {
                    //console.log('no update')
                    return result
                } else {
                    //console.log('[finished]')
                    return null;
                }
            } catch (e) {
                console.log('[ERROR] block sync Error', e)
                console.log('[INFO] Shutting down SLPDB...', new Date().toString())
                await self.db.exit()
                process.exit()
            }
        } else if (type === 'mempool') {
            result = { syncType: SyncType.Mempool, filteredContent: new Map<SyncFilterTypes, TransactionPool>() }
            //let outsock = self.outsock;
            if (!hash) {
                await self.syncSlpMempool();
            } else {
                let isSLP = await self.handleWiredSlpTransaction(hash);
                let txn = await self.getSlpMempoolTransaction(hash)
                if(isSLP) {
                    // IS THIS QUEUE REALLY NEEDED?
                    self.queue.add(async function() {
                        if(txn) {
                            let content: TNATxn = await self.tna.fromTx(txn);
                            try {
                                await self.db.mempoolinsert(content)
                                console.log("[INFO] SLP mempool transaction added: ", hash);
                                //console.log('# Q inserted [size: ' + queue.size + ']',  hash)
                                //console.log(content)
                                self.outsock.send(['mempool', JSON.stringify(content)])
                            } catch (e) {
                                // duplicates are ok because they will be ignored
                                if (e.code == 11000) {
                                    console.log('[ERROR] Duplicate mempool item:', content)
                                } else {
                                    console.log('[ERROR] Mempool sync ERR:', e, content)
                                    process.exit()
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
            while (lastCheckedHash !== actualHash && lastCheckedHeight > Config.core.from) {
                lastCheckedHash = await Info.getCheckpointHash(--lastCheckedHeight);
                await Info.updateTip(lastCheckedHeight, null);
                actualHash = (await self.rpc.getBlock(actualHash)).previousblockhash;
            }
            lastCheckpoint = await Info.checkpoint();
        }
        return lastCheckpoint;
    }

    async run() {
        // initial block sync
        await Bit.sync(this, 'block')
        
        // initial mempool sync
        let items = await this.requestSlpMempool()
        await this.db.mempoolsync(items)
    }
}

// module.exports = {
//   init: init, crawl: crawl, listen: listen, sync: sync, run: run
// }