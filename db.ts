import { MongoClient, Db as MongoDb } from 'mongodb';
import { DbConfig } from './config';
import { TNATxn } from './tna';
import { UtxoDbo, AddressBalancesDbo, GraphTxnDbo, TokenDBObject } from "./interfaces";
import { GraphMap } from './graphmap';
import { SlpTokenGraph } from './slptokengraph';
import { Info } from './info';

export class Db {
    db!: MongoDb;
    mongo!: MongoClient;
    dbUrl: string;
    dbName: string;
    config: DbConfig;

    constructor({ dbUrl, dbName, config }: { dbUrl: string, dbName: string, config: DbConfig }) {
        this.dbUrl = dbUrl;
        this.dbName = dbName;
        this.config = config;
    }

    private async checkClientStatus(): Promise<boolean> {
        if (!this.mongo) {
            //let network = await Info.getNetwork();
            //console.log("[INFO] Initializing MongoDB...")
            this.mongo = await MongoClient.connect(this.dbUrl, { useNewUrlParser: true });
            //let dbname = network === 'mainnet' ? this.config.name : this.config.name_testnet;
            this.db = this.mongo.db(this.dbName);
            return true;
        }
        return false;
    }

    async exit() {
        await this.mongo.close();
    }

    async statusUpdate(status: any) {
        await this.checkClientStatus();
        await this.db.collection('statuses').deleteMany({ "context": status.context });
        return await this.db.collection('statuses').insertOne(status);
    }

    async statusFetch(context: string) {
        await this.checkClientStatus();
        return await this.db.collection('statuses').findOne({ "context": context });
    }

    async tokenInsertReplace(token: any) {
        await this.checkClientStatus();
        await this.db.collection('tokens').deleteMany({ "tokenDetails.tokenIdHex": token.tokenDetails.tokenIdHex })
        return await this.db.collection('tokens').insertMany([ token ]);
    }

    // async tokenreplace(token: any) {
    //     await this.db.collection('tokens').deleteMany({ "tokenDetails.tokenIdHex": token.tokenDetails.tokenIdHex })
    //     return await this.db.collection('tokens').insertMany([ token ]);
    // }

    async tokenDelete(tokenIdHex: string) {
        await this.checkClientStatus();
        return await this.db.collection('tokens').deleteMany({ "tokenDetails.tokenIdHex": tokenIdHex })
    }

    async tokenFetch(tokenIdHex: string): Promise<TokenDBObject|null> {
        await this.checkClientStatus();
        return await this.db.collection('tokens').findOne({ "tokenDetails.tokenIdHex": tokenIdHex })
    }

    async tokenReset() {
        await this.checkClientStatus();
        await this.db.collection('tokens').deleteMany({})
        .catch(function(err) {
            console.log('[ERROR] token collection reset ERR ', err)
            throw err;
        })
    }

    async graphItemsInsertReplaceDelete(graph: SlpTokenGraph) {
        let recentBlocks = await Info.getRecentBlocks();

        console.log("Recent Blocks");
        console.log(recentBlocks);

        let [ itemsToUpdate, itemsToDelete ] = GraphMap.toDbo(graph, recentBlocks);
        await this.checkClientStatus();
        console.log(`TO DELETE: ${itemsToDelete}`)
        for (const txid of itemsToDelete) {
            await this.db.collection("graphs").deleteOne({ "tokenDetails.tokenIdHex": graph._tokenDetails.tokenIdHex, "graphTxn.txid": txid });
        }
        console.log(`TO UPDATE: ${itemsToUpdate.map(g=>g.graphTxn.txid)}`)
        for (const g of itemsToUpdate) {
            await this.db.collection("graphs").replaceOne({ "tokenDetails.tokenIdHex": graph._tokenDetails.tokenIdHex, "graphTxn.txid": g.graphTxn.txid }, g, { upsert: true });
        }
    }

    async graphDelete(tokenIdHex: string) {
        await this.checkClientStatus();
        return await this.db.collection('graphs').deleteMany({ "tokenDetails.tokenIdHex": tokenIdHex })
    }

    async graphFetchUnspent(tokenIdHex: string): Promise<GraphTxnDbo[]> {
        await this.checkClientStatus();
        return await this.db.collection('graphs').find({ 
            "tokenDetails.tokenIdHex": tokenIdHex, 
            "$or": [ { "tokenDetails.isAgedAndSpent": false }, { "tokenDetails.isAgedAndSpent": { "$exists": false }}]
        }).toArray();
    }

    async graphTxnFetch(txid: string): Promise<GraphTxnDbo|null> {
        await this.checkClientStatus();
        return await this.db.collection('graphs').findOne({ "graphTxn.txid": txid });
    }

    async graphReset() {
        await this.checkClientStatus();
        await this.db.collection('graphs').deleteMany({})
        .catch(function(err) {
            console.log('[ERROR] graphs collection reset ERR ', err)
            throw err;
        })
    }

    async addressInsertReplace(addresses: AddressBalancesDbo[], tokenIdHex: string) {
        await this.checkClientStatus();
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
        await this.checkClientStatus();
        return await this.db.collection('addresses').deleteMany({ "tokenDetails.tokenIdHex": tokenIdHex })
    }

    async addressFetch(tokenIdHex: string): Promise<AddressBalancesDbo[]> {
        await this.checkClientStatus();
        return await this.db.collection('addresses').find({ "tokenDetails.tokenIdHex": tokenIdHex }).toArray();
    }

    async addressReset() {
        await this.checkClientStatus();
        await this.db.collection('addresses').deleteMany({})
        .catch(function(err) {
            console.log('[ERROR] addresses collection reset ERR ', err)
            throw err;
        })
    }

    async utxoInsertReplace(utxos: UtxoDbo[], tokenIdHex: string) {
        await this.checkClientStatus();
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
        await this.checkClientStatus();
        return await this.db.collection('utxos').deleteMany({ "tokenDetails.tokenIdHex": tokenIdHex })
    }

    async utxoFetch(tokenIdHex: string): Promise<UtxoDbo[]> {
        await this.checkClientStatus();
        return await this.db.collection('utxos').find({ "tokenDetails.tokenIdHex": tokenIdHex }).toArray();
    }

    async singleUtxo(utxo: string): Promise<UtxoDbo|null> {
        await this.checkClientStatus();
        return await this.db.collection('utxos').findOne({ "utxo": utxo });
    }

    async singleMintUtxo(utxo: string): Promise<TokenDBObject|null> {
        await this.checkClientStatus();
        return await this.db.collection('tokens').findOne({ "mintBatonUtxo": utxo });
    }

    async utxoReset() {
        await this.checkClientStatus();
        await this.db.collection('utxos').deleteMany({})
        .catch(function(err) {
            console.log('[ERROR] utxos collection reset ERR ', err);
            throw err;
        })
    }

    async unconfirmedInsert(item: TNATxn) {
        await this.checkClientStatus();
        return await this.db.collection('unconfirmed').insertMany([item])
    }

    async unconfirmedReset() {
        await this.checkClientStatus();
        await this.db.collection('unconfirmed').deleteMany({})
        .catch(function(err) {
            console.log('[ERROR] mempoolreset ERR ', err);
            throw err;
        })
    }

    async unconfirmedFetch(txid: string): Promise<TNATxn|null> {
        await this.checkClientStatus();
        let res = await this.db.collection('unconfirmed').findOne({ "tx.h": txid }) as TNATxn;
        return res;
    }

    async unconfirmedDelete(txid: string): Promise<any> {
        await this.checkClientStatus();
        let res = await this.db.collection('unconfirmed').deleteMany({ "tx.h": txid });
        return res;
    }

    async unconfirmedProcessedSlp(): Promise<string[]> {
        await this.checkClientStatus();
        return (await this.db.collection('unconfirmed').find().toArray()).filter((i:TNATxn) => i.slp);
    }

    async unconfirmedSync(items: TNATxn[]) {
        await this.checkClientStatus();
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
                        throw err;
                    }
                })
            } else {
                break
            }
        }
    }

    async confirmedFetch(txid: string): Promise<TNATxn|null> {
        await this.checkClientStatus();
        return await this.db.collection('confirmed').findOne({ "tx.h": txid }) as TNATxn;
    }

    async confirmedDelete(txid: string): Promise<any> {
        await this.checkClientStatus();
        return await this.db.collection('confirmed').deleteMany({ "tx.h": txid });
    }

    async confirmedReset() {
        await this.checkClientStatus();
        await this.db.collection('confirmed').deleteMany({}).catch(function(err) {
            console.log('[ERROR] confirmedReset ERR ', err)
            throw err;
        })
    }

    async confirmedReplace(items: TNATxn[], requireSlpMetadata=true, block_index?: number) {
        await this.checkClientStatus();

        if(requireSlpMetadata) {
            if(items.filter(i => !i.slp).length > 0) {
                console.log(items.filter(i => !i.slp).map(i => i.tx.h));
                //throw Error("Attempted to add items without SLP property.");
            }
        }

        if(items.filter(i => !i.blk).length > 0) {
            //console.log(items.filter(i => !i.slp).map(i => i.tx.h));
            throw Error("Attempted to add items without BLK property.");
        }

        if(block_index) {
            console.log('[INFO] Deleting confirmed transactions in block (for replacement):', block_index)
            try {
                await this.db.collection('confirmed').deleteMany({ 'blk.i': block_index })
            } catch(err) {
                console.log('confirmedReplace ERR ', err)
                throw err;
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
                        throw err;
                    }
                }
                index+=1000
            } else {
                break
            }
        }
    }

    async confirmedInsert(items: TNATxn[], requireSlpMetadata: boolean) {
        await this.checkClientStatus();

        if(requireSlpMetadata) {
            if(items.filter(i => !i.slp).length > 0) {
                console.log(items.filter(i => !i.slp).map(i => i.tx.h));
                //throw Error("Attempted to add items without SLP property.");
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
                        throw e
                    }
                }
                index+=1000
            } else {
                break
            }
        }
    }

    async confirmedIndex() {        
        await this.checkClientStatus();

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
                            throw e;
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
                        throw e;
                    }
                    console.timeEnd('Fulltext search for ' + collectionName)
                }
            }
        }

        //console.log('* Finished indexing MongoDB...')
        console.timeEnd('TotalIndex')

        try {
            let result = await this.db.collection('confirmed').indexInformation(<any>{ full: true }) // <- No MongoSession passed
            console.log('* Confirmed Index = ', result)
            result = await this.db.collection('unconfirmed').indexInformation(<any>{ full: true }) // <- No MongoSession passed
            console.log('* Unonfirmed Index = ', result)
        } catch (e) {
            console.log('[INFO] * Error fetching index info ', e)
            throw e;
        }
    }
}