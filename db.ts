import { MongoClient, Db as MongoDb } from 'mongodb';
import { Config, DbConfig } from './config';
import { TNATxn, TNA } from './tna';
import { UtxoDbo, AddressBalancesDbo, GraphTxnDbo, TokenDBObject } from './SlpTokenGraph';
import { Info } from './info';
import { RpcClient } from './rpc';

export class Db {
    config: DbConfig;
    db!: MongoDb;
    mongo!: MongoClient;
    _rpcClient!: RpcClient;

    constructor() {
        this.config = Config.db;
    }

    async init(rpc: RpcClient) {
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

    async tokenInsertReplace(token: any) {
        await this.db.collection('tokens').deleteMany({ "tokenDetails.tokenIdHex": token.tokenDetails.tokenIdHex })
        return await this.db.collection('tokens').insertMany([ token ]);
    }

    // async tokenreplace(token: any) {
    //     await this.db.collection('tokens').deleteMany({ "tokenDetails.tokenIdHex": token.tokenDetails.tokenIdHex })
    //     return await this.db.collection('tokens').insertMany([ token ]);
    // }

    async tokenDelete(tokenIdHex: string) {
        return await this.db.collection('tokens').deleteMany({ "tokenDetails.tokenIdHex": tokenIdHex })
    }

    async tokenFetch(tokenIdHex: string): Promise<TokenDBObject|null> {
        return await this.db.collection('tokens').findOne({ "tokenDetails.tokenIdHex": tokenIdHex })
    }

    async tokenReset() {
        await this.db.collection('tokens').deleteMany({})
        .catch(function(err) {
            console.log('[ERROR] token collection reset ERR ', err)
            process.exit()
        })
    }

    async graphInsertReplace(graph: GraphTxnDbo[], tokenIdHex: string) {
        await this.db.collection('graphs').deleteMany({ "tokenDetails.tokenIdHex": tokenIdHex })
        if(graph.length > 0) {
            return await this.db.collection('graphs').insertMany(graph);
        }
    }

    // async graphreplace(graph: GraphTxnDbo[]) {
    //     await this.db.collection('graphs').deleteMany({ "tokenDetails.tokenIdHex": graph[0].tokenDetails.tokenIdHex })
    //     return await this.db.collection('graphs').insertMany(graph);
    // }

    async graphDelete(tokenIdHex: string) {
        return await this.db.collection('graphs').deleteMany({ "tokenDetails.tokenIdHex": tokenIdHex })
    }

    async graphFetch(tokenIdHex: string): Promise<GraphTxnDbo[]> {
        return await this.db.collection('graphs').find({ "tokenDetails.tokenIdHex": tokenIdHex }).toArray();
    }

    async graphReset() {
        await this.db.collection('graphs').deleteMany({})
        .catch(function(err) {
            console.log('[ERROR] graphs collection reset ERR ', err)
            process.exit()
        })
    }

    async addressInsertReplace(addresses: AddressBalancesDbo[], tokenIdHex: string) {
        await this.db.collection('addresses').deleteMany({ "tokenDetails.tokenIdHex": tokenIdHex })
        if(addresses.length > 0) {
            return await this.db.collection('addresses').insertMany(addresses);
        }
    }

    // async addressreplace(addresses: AddressBalancesDbo[]) {
    //     await this.db.collection('addresses').deleteMany({ "tokenDetails.tokenIdHex": addresses[0].tokenDetails.tokenIdHex })
    //     return await this.db.collection('addresses').insertMany(addresses);
    // }

    async addressDelete(tokenIdHex: string) {
        return await this.db.collection('addresses').deleteMany({ "tokenDetails.tokenIdHex": tokenIdHex })
    }

    async addressFetch(tokenIdHex: string): Promise<AddressBalancesDbo[]> {
        return await this.db.collection('addresses').find({ "tokenDetails.tokenIdHex": tokenIdHex }).toArray();
    }

    async addressReset() {
        await this.db.collection('addresses').deleteMany({})
        .catch(function(err) {
            console.log('[ERROR] addresses collection reset ERR ', err)
            process.exit()
        })
    }

    async utxoInsertReplace(utxos: UtxoDbo[], tokenIdHex: string) {
        await this.db.collection('utxos').deleteMany({ "tokenDetails.tokenIdHex": tokenIdHex })
        if(utxos.length > 0) {
            return await this.db.collection('utxos').insertMany(utxos);
        }
    }

    // async utxoreplace(utxos: UtxoDbo[]) {
    //     await this.db.collection('utxos').deleteMany({ "tokenDetails.tokenIdHex": utxos[0].tokenDetails.tokenIdHex })
    //     return await this.db.collection('utxos').insertMany(utxos);
    // }

    async utxoDelete(tokenIdHex: string) {
        return await this.db.collection('utxos').deleteMany({ "tokenDetails.tokenIdHex": tokenIdHex })
    }

    async utxoFetch(tokenIdHex: string): Promise<UtxoDbo[]> {
        return await this.db.collection('utxos').find({ "tokenDetails.tokenIdHex": tokenIdHex }).toArray();
    }

    async singleUtxo(utxo: string): Promise<UtxoDbo|null> {
        return await this.db.collection('utxos').findOne({ "utxo": utxo });
    }

    async singleMintUtxo(utxo: string): Promise<TokenDBObject|null> {
        return await this.db.collection('tokens').findOne({ "mintBatonUtxo": utxo });
    }

    async utxoReset() {
        await this.db.collection('utxos').deleteMany({})
        .catch(function(err) {
            console.log('[ERROR] utxos collection reset ERR ', err)
            process.exit()
        })
    }

    async unconfirmedInsert(item: TNATxn) {
        return await this.db.collection('unconfirmed').insertMany([item])
    }

    async unconfirmedReset() {
        await this.db.collection('unconfirmed').deleteMany({})
        .catch(function(err) {
            console.log('[ERROR] mempoolreset ERR ', err)
            process.exit()
        })
    }

    async unconfirmedFetch(txid: string): Promise<TNATxn|null> {
        let res = await this.db.collection('unconfirmed').findOne({ "tx.h": txid }) as TNATxn;
        return res;
    }

    async unconfirmedDelete(txid: string): Promise<any> {
        let res = await this.db.collection('unconfirmed').deleteMany({ "tx.h": txid });
        return res;
    }

    async unconfirmedProcessedSlp(): Promise<string[]> {
        return (await this.db.collection('unconfirmed').find().toArray()).filter((i:TNATxn) => i.slp);
    }

    async unconfirmedSync(items: TNATxn[]) {

        await this.db.collection('unconfirmed').deleteMany({})
        .catch(function(err) {
            console.log('[ERROR] unconfirmedSync ERR ', err)
        })

        while (true) {
            let chunk = items.splice(0, 1000)
            if (chunk.length > 0) {
                await this.db.collection('unconfirmed').insertMany(chunk, { ordered: false }).catch(function(err) {
                    if (err.code !== 11000) {
                        console.log('[ERROR] ## ERR ', err, items)
                        process.exit()
                    }
                })
            } else {
                break
            }
        }
    }

    async confirmedFetch(txid: string): Promise<TNATxn|null> {
        return await this.db.collection('confirmed').findOne({ "tx.h": txid }) as TNATxn;
    }

    async confirmedReset() {
        await this.db.collection('confirmed').deleteMany({}).catch(function(err) {
            console.log('[ERROR] confirmedReset ERR ', err)
            process.exit()
        })
    }

    async confirmedReplace(items: TNATxn[], requireSlpMetadata=true, block_index?: number) {

        if(requireSlpMetadata) {
            if(items.filter(i => !i.slp).length > 0) {
                console.log(items.filter(i => !i.slp).map(i => i.tx.h));
                throw Error("Attempted to add items without SLP property.");
            }
        }

        if(items.filter(i => !i.blk).length > 0) {
            //console.log(items.filter(i => !i.slp).map(i => i.tx.h));
            throw Error("Attempted to add items without BLK property.");
        }

        if(block_index) {
            console.log('[INFO] Deleting confirmed transactions in block:', block_index)
            try {
                await this.db.collection('confirmed').deleteMany({ 'blk.i': block_index })
            } catch(err) {
                console.log('confirmedReplace ERR ', err)
                process.exit()
            }
            console.log('[INFO] Updating block', block_index, 'with', items.length, 'items')
        } else {
            for(let i=0; i < items.length; i++) {
                await this.db.collection('confirmed').deleteMany({ "tx.h": items[i].tx.h })
            }
        }


        let index = 0
        while (true) {
            let chunk = items.slice(index, index+1000)
            if (chunk.length > 0) {
                try {
                    await this.db.collection('confirmed').insertMany(chunk, { ordered: false })
                } catch(err) {
                    // duplicates are ok because they will be ignored
                    if (err.code !== 11000) {
                        console.log('[ERROR] confirmedReplace ERR ', err, items)
                        process.exit()
                    }
                }
                index+=1000
            } else {
                break
            }
        }
    }

    async confirmedInsert(items: TNATxn[], requireSlpMetadata: boolean) {

        if(requireSlpMetadata) {
            if(items.filter(i => !i.slp).length > 0) {
                console.log(items.filter(i => !i.slp).map(i => i.tx.h));
                throw Error("Attempted to add items without SLP property.");
            }
        }

        let index = 0
        while (true) {
            let chunk = items.slice(index, index + 1000)
            if (chunk.length > 0) {
                try {
                    await this.db.collection('confirmed').insertMany(chunk, { ordered: false })
                } catch (e) {
                // duplicates are ok because they will be ignored
                    if (e.code !== 11000) {
                        console.log('[ERROR] confirmedInsert error:', e, items)
                        process.exit()
                    }
                }
                index+=1000
            } else {
                break
            }
        }
    }

    async confirmedIndex() {
        console.log('[INFO] * Indexing MongoDB...')
        console.time('TotalIndex')

        if (this.config.index) {
            let collectionNames = Object.keys(this.config.index)
            for(let j=0; j<collectionNames.length; j++) {
                let collectionName: string = collectionNames[j]
                let keys: string[] = this.config.index[collectionName].keys
                let fulltext: string[] = this.config.index[collectionName].fulltext
                if (keys) {
                    console.log('[INFO] Indexing keys...')
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
                            console.log('[ERROR] blockindex error:', e)
                            process.exit()
                        }
                        console.timeEnd('Index:' + keys[i])
                    }
                }
                if (fulltext && fulltext.length > 0) {
                    console.log('[INFO] Creating full text index...')
                    let o: { [key:string]: string } = {}
                    fulltext.forEach(function(key) {
                        o[key] = 'text'
                    })
                    console.time('Fulltext search for ' + collectionName) //,o)
                    try {
                        await this.db.collection(collectionName).createIndex(o, { name: 'fulltext' })
                    } catch (e) {
                        console.log('[ERROR] blockindex error:', e)
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
            console.log('[INFO] * Error fetching index info ', e)
            process.exit()
        }
    }
}