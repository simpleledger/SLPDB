import { MongoClient, Db as MongoDb } from 'mongodb';
import { Config, DbConfig } from './config';
import { TNATxn } from './tna';
import { UtxoDbo, AddressBalancesDbo, GraphTxnDbo, TokenDBObject } from './SlpTokenGraph';
import { Info } from './info';
import { BitcoinRpc } from './vendor';

export class Db {
    config: DbConfig;
    db!: MongoDb;
    mongo!: MongoClient;
    _rpcClient!: BitcoinRpc.RpcClient;

    constructor() {
        this.config = Config.db;
    }

    async init(rpc: BitcoinRpc.RpcClient) {
        this._rpcClient = rpc;
        let network = await Info.getNetwork();
        let client: MongoClient;
        console.log("[INFO] Initializing MongoDB...")
        client = await MongoClient.connect(this.config.url, { useNewUrlParser: true })
        let dbname = network === 'mainnet' ? this.config.name : this.config.name_testnet;
        this.db = client.db(dbname);
        this.mongo = <MongoClient>client;
        console.log("[INFO] MongoDB initialized.")
    }

    async exit() {
        await this.mongo.close()
    }

    async tokeninsert(token: any) {
        await this.db.collection('tokens').deleteMany({ "tokenDetails.tokenIdHex": token.tokenDetails.tokenIdHex })
        return await this.db.collection('tokens').insertMany([ token ]);
    }

    async tokenreplace(token: any) {
        await this.db.collection('tokens').deleteMany({ "tokenDetails.tokenIdHex": token.tokenDetails.tokenIdHex })
        return await this.db.collection('tokens').insertMany([ token ]);
    }

    async tokendelete(tokenIdHex: string) {
        return await this.db.collection('tokens').deleteMany({ "tokenDetails.tokenIdHex": tokenIdHex })
    }

    async tokenfetch(tokenIdHex: string): Promise<TokenDBObject|null> {
        return await this.db.collection('tokens').findOne({ "tokenDetails.tokenIdHex": tokenIdHex })
    }

    async graphinsert(graph: GraphTxnDbo[]) {
        if(graph.length > 0) {
            await this.db.collection('graphs').deleteMany({ "tokenDetails.tokenIdHex": graph[0].tokenDetails.tokenIdHex })
            return await this.db.collection('graphs').insertMany(graph);
        }
    }

    async graphreplace(graph: GraphTxnDbo[]) {
        await this.db.collection('graphs').deleteMany({ "tokenDetails.tokenIdHex": graph[0].tokenDetails.tokenIdHex })
        return await this.db.collection('graphs').insertMany(graph);
    }

    async graphdelete(tokenIdHex: string) {
        return await this.db.collection('graphs').deleteMany({ "tokenDetails.tokenIdHex": tokenIdHex })
    }

    async graphfetch(tokenIdHex: string): Promise<GraphTxnDbo[]> {
        return await this.db.collection('graphs').find({ "tokenDetails.tokenIdHex": tokenIdHex }).toArray();
    }

    async addressinsert(addresses: AddressBalancesDbo[]) {
        if(addresses.length > 0) {
            await this.db.collection('addresses').deleteMany({ "tokenDetails.tokenIdHex": addresses[0].tokenDetails.tokenIdHex })
            return await this.db.collection('addresses').insertMany(addresses);
        }
    }

    async addressreplace(addresses: AddressBalancesDbo[]) {
        await this.db.collection('addresses').deleteMany({ "tokenDetails.tokenIdHex": addresses[0].tokenDetails.tokenIdHex })
        return await this.db.collection('addresses').insertMany(addresses);
    }

    async addressdelete(tokenIdHex: string) {
        return await this.db.collection('addresses').deleteMany({ "tokenDetails.tokenIdHex": tokenIdHex })
    }

    async addressfetch(tokenIdHex: string): Promise<AddressBalancesDbo[]> {
        return await this.db.collection('addresses').find({ "tokenDetails.tokenIdHex": tokenIdHex }).toArray();
    }

    async utxoinsert(utxos: UtxoDbo[]) {
        if(utxos.length > 0) {
            await this.db.collection('utxos').deleteMany({ "tokenDetails.tokenIdHex": utxos[0].tokenDetails.tokenIdHex })
            return await this.db.collection('utxos').insertMany(utxos);
        }
    }

    async utxoreplace(utxos: UtxoDbo[]) {
        await this.db.collection('utxos').deleteMany({ "tokenDetails.tokenIdHex": utxos[0].tokenDetails.tokenIdHex })
        return await this.db.collection('utxos').insertMany(utxos);
    }

    async utxodelete(tokenIdHex: string) {
        return await this.db.collection('utxos').deleteMany({ "tokenDetails.tokenIdHex": tokenIdHex })
    }

    async utxofetch(tokenIdHex: string): Promise<UtxoDbo[]> {
        return await this.db.collection('utxos').find({ "tokenDetails.tokenIdHex": tokenIdHex }).toArray();
    }

    async mempoolinsert(item: TNATxn) {
        return await this.db.collection('unconfirmed').insertMany([item])
    }

    async mempoolreset() {
        await this.db.collection('unconfirmed').deleteMany({})
        .catch(function(err) {
            console.log('mempoolreset ERR ', err)
            process.exit()
        })
    }

    async mempoolfetch(txid: string) {
        return await this.db.collection('unconfirmed').findOne({ "tx.h": txid });
    }

    async mempoolsync(items: TNATxn[]) {

        await this.db.collection('unconfirmed').deleteMany({})
        .catch(function(err) {
            console.log('mempoolsync ERR ', err)
        })

        let index = 0
        while (true) {
            let chunk = items.splice(0, 1000)
            if (chunk.length > 0) {
                await this.db.collection('unconfirmed').insertMany(chunk, { ordered: false }).catch(function(err) {
                    if (err.code !== 11000) {
                        console.log('## ERR ', err, items)
                        process.exit()
                    }
                })
                index++
            } else {
                break
            }
        }
    }

    async blockreset() {
        await this.db.collection('confirmed').deleteMany({}).catch(function(err) {
            console.log('blockreset ERR ', err)
            process.exit()
        })
    }

    async blockreplace(items: TNATxn[], block_index: number) {
        console.log('Deleting all blocks greater than or equal to', block_index)
        await this.db.collection('confirmed').deleteMany({
            'blk.i': {
                $gte: block_index
            }
        }).catch(function(err) {
            console.log('blockreplace ERR ', err)
            process.exit()
        })
        console.log('Updating block', block_index, 'with', items.length, 'items')
        let index = 0
        while (true) {
            let chunk = items.slice(index, index+1000)
            if (chunk.length > 0) {
                await this.db.collection('confirmed').insertMany(chunk, { ordered: false }).catch(function(err) {
                    // duplicates are ok because they will be ignored
                    if (err.code !== 11000) {
                        console.log('blockreplace ERR ', err, items)
                        process.exit()
                    }
                })
                //console.log('\tchunk ' + index + ' processed ...')
                index+=1000
            } else {
                break
            }
        }
    }

    async blockinsert(items: TNATxn[], block_index: number) {
        let index = 0
        while (true) {
            let chunk = items.slice(index, index + 1000)
            if (chunk.length > 0) {
                try {
                    await this.db.collection('confirmed').insertMany(chunk, { ordered: false })
                    //console.log('..chunk ' + index + ' processed ...')
                } catch (e) {
                // duplicates are ok because they will be ignored
                    if (e.code !== 11000) {
                        console.log('blockinsert ERR ', e, items, block_index)
                        process.exit()
                    }
                }
                index+=1000
            } else {
                break
            }
        }
        //console.log('Block ' + block_index + ' inserted ')
    }

    async blockindex() {
        console.log('* Indexing MongoDB...')
        console.time('TotalIndex')

        if (this.config.index) {
            let collectionNames = Object.keys(this.config.index)
            for(let j=0; j<collectionNames.length; j++) {
                let collectionName: string = collectionNames[j]
                let keys: string[] = this.config.index[collectionName].keys
                let fulltext: string[] = this.config.index[collectionName].fulltext
                if (keys) {
                    console.log('Indexing keys...')
                    for(let i=0; i<keys.length; i++) {
                        let o: { [key:string]: number } = {}
                        o[keys[i]] = 1
                        console.time('Index:' + keys[i])
                        try {
                        if (keys[i] === 'tx.h') {
                            await this.db.collection(collectionName).createIndex(o, { unique: true })
                            //console.log('* Created unique index for ', keys[i])
                        } else {
                            await this.db.collection(collectionName).createIndex(o)
                            //console.log('* Created index for ', keys[i])
                        }
                        } catch (e) {
                            console.log('blockindex error:', e)
                            process.exit()
                        }
                        console.timeEnd('Index:' + keys[i])
                    }
                }
                if (fulltext) {
                    console.log('Creating full text index...')
                    let o: { [key:string]: string } = {}
                    fulltext.forEach(function(key) {
                        o[key] = 'text'
                    })
                    console.time('Fulltext search for ' + collectionName) //,o)
                    try {
                        await this.db.collection(collectionName).createIndex(o, { name: 'fulltext' })
                    } catch (e) {
                        console.log('blockindex error:', e)
                        process.exit()
                    }
                    console.timeEnd('Fulltext search for ' + collectionName)
                }
            }
        }

        //console.log('* Finished indexing MongoDB...')
        console.timeEnd('TotalIndex')

        try {
            let result = await this.db.collection('confirmed').indexInformation(<any>{ full: true }) // <- No MongoSession passed
            //console.log('* Confirmed Index = ', result)
            result = await this.db.collection('unconfirmed').indexInformation(<any>{ full: true }) // <- No MongoSession passed
            //console.log('* Unonfirmed Index = ', result)
        } catch (e) {
            console.log('* Error fetching index info ', e)
            process.exit()
        }
    }
}