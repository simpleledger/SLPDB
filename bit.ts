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
const queue = new pQueue({ concurrency: Config.rpc.limit })

export class Bit {
    db!: Db;
    rpc!: BitcoinRpcClient;
    tna!: TNA;

    constructor(){ }

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
            throw new Error(err)
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
            throw new Error(err)
        }
    }

    async requesttx(hash: string): Promise<any> {
        let content: any = await this.tna.fromHash(hash)
        return content
    }

    async requestmempool() {
        try {
            let res = await this.rpc.getRawMemPool();
            let tasks = []
            const limit = pLimit(Config.rpc.limit)
            let txs = res.result
            //console.log('txs = ', txs.length)
            for(let i=0; i<txs.length; i++) {
                tasks.push(limit(async function() {
                    let content = await res.tx(txs[i])
                    return content
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
            let btxs = await Promise.all(tasks)
            console.log('Block', block_index, ':', txs.length, 'txs |', btxs.length, 'processed txs')
            return btxs
        } else {
            return []
        }
    }

    outsock = zmq.socket('pub')

    listen() {
        let sock = zmq.socket('sub')
        sock.connect('tcp://' + Config.zmq.incoming.host + ':' + Config.zmq.incoming.port)
        sock.subscribe('hashtx')
        sock.subscribe('hashblock')
        //console.log('Subscriber connected to port', Config.zmq.incoming.port)
        
        this.outsock.bindSync('tcp://' + Config.zmq.outgoing.host + ':' + Config.zmq.outgoing.port)
        //console.log('Started publishing to ' + Config.zmq.outgoing.host + ':' + Config.zmq.outgoing.port)
        
        // Listen to ZMQ
        let sync = this.sync;
        sock.on('message', async function(topic, message) {
            if (topic.toString() === 'hashtx') {
            let hash = message.toString('hex')
            //console.log('New mempool hash from ZMQ = ', hash)
            await sync('mempool', hash)
            } else if (topic.toString() === 'hashblock') {
            let hash = message.toString('hex')
            //console.log('New block hash from ZMQ = ', hash)
            await sync('block')
            }
        })
        
        // Don't trust ZMQ. Try synchronizing every 1 minute in case ZMQ didn't fire
        setInterval(async function() {
            await sync('block')
        }, 60000)
        
    }
        
    async sync(type: string, hash?: string) {
        if (type === 'block') {
            try {
                const lastSynchronized = await Info.checkpoint()
                const currentHeight = await this.requestheight()
                //console.log('Last Synchronized = ', lastSynchronized)
                //console.log('Current Height = ', currentHeight)
            
                for(let index: number=lastSynchronized+1; index<=currentHeight; index++) {
                    //console.log('RPC BEGIN ' + index, new Date().toString())
                    console.time('RPC END ' + index)
                    let content = await this.crawl(index)
                    console.timeEnd('RPC END ' + index)
                    //console.log(new Date().toString())
                    //console.log('DB BEGIN ' + index, new Date().toString())
                    console.time('DB Insert ' + index)
            
                    await this.db.blockinsert(content, index)
            
                    await Info.updateTip(index)
                    console.timeEnd('DB Insert ' + index)
                    //console.log('------------------------------------------')
                    //console.log('\n')
            
                    // zmq broadcast
                    let b = { i: index, txs: content }
                    //console.log('Zmq block = ', JSON.stringify(b, null, 2))
                    this.outsock.send(['block', JSON.stringify(b)])
                }
        
                // clear mempool and synchronize
                if (lastSynchronized < currentHeight) {
                    //console.log('Clear mempool and repopulate')
                    let items: MempoolItem[] = <MempoolItem[]>(await this.requestmempool())
                    await this.db.mempoolsync(items)
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
                await this.db.exit()
                process.exit()
            }
        } else if (type === 'mempool') {
            let outsock = this.outsock;
            const self = this;
            queue.add(async function() {
                let content = await self.requesttx(<string>hash)
                try {
                    await self.db.mempoolinsert(content)
                    //console.log('# Q inserted [size: ' + queue.size + ']',  hash)
                    //console.log(content)
                    outsock.send(['mempool', JSON.stringify(content)])
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
        await this.sync('block')
        
        // initial mempool sync
        //console.log('Clear mempool and repopulate')
        let items = await this.requestmempool()
        await this.db.mempoolsync(<any[]>items)
    }
}

// module.exports = {
//   init: init, crawl: crawl, listen: listen, sync: sync, run: run
// }

