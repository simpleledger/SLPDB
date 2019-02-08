import { BitcoinRpcClient, Bitcore } from './global'
const RpcClient = require('bitcoin-rpc-promise')
import zmq from 'zeromq';
import pLimit from 'p-limit';
import pQueue from 'p-queue';
import { Config } from './config';
import { Info } from './info';
import { Db, MempoolItem, BlockItem } from './db';
import { TNA, TNATxn } from './tna';
const BufferReader = require('bufio/lib/reader');
const Block = require('bcash/lib/primitives/block');

const bitcore = require('bitcore-lib-cash');

import BITBOXSDK from 'bitbox-sdk/lib/bitbox-sdk';
const BITBOX = new BITBOXSDK();
import { Slp, BitboxNetwork } from 'slpjs';
const slp = new Slp(BITBOX);

const slp_txn_filter = function(txn: Bitcore.Transaction): boolean {
    try {
        slp.parseSlpOutputScript(txn.outputs[0]._scriptBuffer)
        return true
    } catch(_){
        return false
    }
}

const slp_txn_filter2 = function(txnhex: string): boolean {
    if(txnhex.includes('534c5000')) {
        return true
    }
    return false
}


export class Bit {
    db!: Db;
    rpc!: BitcoinRpcClient;
    tna!: TNA;
    outsock: zmq.Socket;
    queue: pQueue<pQueue.DefaultAddOptions>;

    constructor(){ 
        this.outsock = zmq.socket('pub')
        this.queue = new pQueue({ concurrency: Config.rpc.limit })
    }

    async init(db: Db) {
        //console.log("Initializing RPC connection with bitcoind...");
        this.db = db;
        let connectionString = 'http://'+ Config.rpc.user+':'+Config.rpc.pass+'@'+Config.rpc.host+':'+Config.rpc.port
        //console.log('Using:', )
        this.rpc = <BitcoinRpcClient>(new RpcClient(connectionString));
        //console.log("Testing RPC connection...");
        let block = await this.requestblock(0);
        //console.log('block 0 hash:', block.hash);
        //console.log("JSON-RPC is initialized.");
        this.tna = new TNA(this.rpc);
    }

    async requestblock(block_index: number) {
        try {
            let hash = await this.rpc.getBlockHash(block_index);
            return await this.rpc.getBlock(hash);
        } catch(err){
            console.log('requestblock Err = ', err)
        }
    }
      /**
      * Return the current blockchain height
      */
    async requestheight() {
        try{
            return await this.rpc.getBlockCount();
        } catch(err){
            console.log('requestheight Err = ', err)
        }
    }

    async requesttx(hash: string): Promise<any> {
        let txnhex = await this.rpc.getRawTransaction(hash);
        return new bitcore.Transaction(txnhex);
    }

    async requestmempool() {
        try {
            let txs = await this.rpc.getrawmempool();
            let tasks = []
            const limit = pLimit(Config.rpc.limit)
            console.log('txs = ', txs.length)
            let self = this;
            for(let i=0; i<txs.length; i++) {
                tasks.push(limit(async function() {
                    let content = await self.requesttx(txs[i])
                    return self.tna.fromTx(content);
                }))
            }
            return await Promise.all(tasks)
        } catch(err) {
            console.log('requestmempool Err', err)
        }
    }

    async crawl(block_index: number) {
        let block_content = await this.requestblock(block_index)
        let block_hash = block_content.hash
        let block_time = block_content.time
        
        if (block_content) {
            let txs: string[] = block_content.tx
            console.log('crawling txs =', txs.length)
            let tasks: Promise<any>[] = []
            const limit = pLimit(Config.rpc.limit)
            const self = this;

            let blockHex: string = await this.rpc.getBlock(block_content.hash, false)
            let block = Block.fromReader(new BufferReader(Buffer.from(blockHex, 'hex')));

            for(let i=0; i<txs.length; i++) {
                let txnhex = block.txs[i].toRaw().toString('hex');
                if(slp_txn_filter2(txnhex)) {
                    tasks.push(limit(async function() {
                        try {
                            let gene: Bitcore.Transaction = new bitcore.Transaction(txnhex);
                            let t: TNATxn = await self.tna.fromTx(gene);
                            t.blk = {
                                i: block_index,
                                h: block_hash,
                                t: block_time
                            }
                            return t;
                        } catch(err) {
                            console.log('crawl Error =', err)
                        }
                    }))
                }
            }
            let btxs = await Promise.all(tasks)
            console.log('Block', block_index, ':', txs.length, 'txs |', btxs.length, 'processed txs')
            return btxs
        } else {
            return []
        }
    }
    listen() {
        let sock = zmq.socket('sub')
        sock.connect('tcp://' + Config.zmq.incoming.host + ':' + Config.zmq.incoming.port)
        sock.subscribe('hashtx')
        sock.subscribe('hashblock')
        //console.log('Subscriber connected to port', Config.zmq.incoming.port)
        
        this.outsock.bindSync('tcp://' + Config.zmq.outgoing.host + ':' + Config.zmq.outgoing.port)
        //console.log('Started publishing to ' + Config.zmq.outgoing.host + ':' + Config.zmq.outgoing.port)
        
        // Listen to ZMQ
        let sync = Bit.sync;
        let self = this;
        sock.on('message', async function(topic, message) {
            if (topic.toString() === 'hashtx') {
            let hash = message.toString('hex')
            console.log('New mempool hash from ZMQ = ', hash)
            await sync(self, 'mempool', hash)
            } else if (topic.toString() === 'hashblock') {
            let hash = message.toString('hex')
            console.log('New block hash from ZMQ = ', hash)
            await sync(self, 'block')
            }
        })
        
        // Don't trust ZMQ. Try synchronizing every 1 minute in case ZMQ didn't fire
        setInterval(async function() {
            await Bit.sync(self, 'block')
        }, 60000)
        
    }
        
    static async sync(self: Bit, type: string, hash?: string) {
        if (type === 'block') {
            try {
                const lastSynchronized = await Info.checkpoint()
                const currentHeight = await self.requestheight()
                //console.log('Last Synchronized = ', lastSynchronized)
                //console.log('Current Height = ', currentHeight)
            
                for(let index: number=lastSynchronized+1; index<=currentHeight; index++) {
                    //console.log('RPC BEGIN ' + index, new Date().toString())
                    console.time('RPC END ' + index)
                    let content = await self.crawl(index)
                    console.timeEnd('RPC END ' + index)
                    //console.log(new Date().toString())
                    //console.log('DB BEGIN ' + index, new Date().toString())
                    console.time('DB Insert ' + index)
            
                    await self.db.blockinsert(content, index)
            
                    await Info.updateTip(index)
                    console.timeEnd('DB Insert ' + index)
                    //console.log('------------------------------------------')
                    //console.log('\n')
            
                    // zmq broadcast
                    let b = { i: index, txs: content }
                    //console.log('Zmq block = ', JSON.stringify(b, null, 2))
                    self.outsock.send(['block', JSON.stringify(b)])
                }
        
                // clear mempool and synchronize
                if (lastSynchronized < currentHeight) {
                    //console.log('Clear mempool and repopulate')
                    let items: MempoolItem[] = <MempoolItem[]>(await self.requestmempool())
                    await self.db.mempoolsync(items)
                }
            
                if (lastSynchronized === currentHeight) {
                    //console.log('no update')
                    return null
                } else {
                    //console.log('[finished]')
                    return currentHeight
                }
            } catch (e) {
                console.log('block sync Error', e)
                console.log('Shutting down Bitdb...', new Date().toString())
                await self.db.exit()
                process.exit()
            }
        } else if (type === 'mempool') {
            //let outsock = self.outsock;
            self.queue.add(async function() {
                let txn = await self.requesttx(<string>hash)
                let content: TNATxn = await self.tna.fromTx(txn);
                try {
                    await self.db.mempoolinsert(content)
                    //console.log('# Q inserted [size: ' + queue.size + ']',  hash)
                    //console.log(content)
                    self.outsock.send(['mempool', JSON.stringify(content)])
                } catch (e) {
                    // duplicates are ok because they will be ignored
                    if (e.code == 11000) {
                        console.log('Duplicate mempool item: ', content)
                    } else {
                        console.log('mempool sync ERR ', e, content)
                        process.exit()
                    }
                }
            })
            return hash
        }
    }

    async run() {
        // initial block sync
        await Bit.sync(this, 'block')
        
        // initial mempool sync
        //console.log('Clear mempool and repopulate')
        let items = await this.requestmempool()
        await this.db.mempoolsync(<any[]>items)
    }
}

// module.exports = {
//   init: init, crawl: crawl, listen: listen, sync: sync, run: run
// }

