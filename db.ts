import { MongoClient, Db as MongoDb } from 'mongodb';
import { DbConfig } from './config';
import { TNATxn } from './tna';
import { GraphTxnDbo, TokenDBObject } from "./interfaces";
import { GraphMap } from './graphmap';

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
            this.mongo = await MongoClient.connect(this.dbUrl, { useNewUrlParser: true, useUnifiedTopology: true, connectTimeoutMS: 120000 });
            this.db = this.mongo.db(this.dbName);
            return true;
        }
        return false;
    }

    async drop() {
        await this.db.dropDatabase();
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

    private async tokenInsertReplace(token: any) {
        await this.checkClientStatus();
        await this.db.collection('tokens').replaceOne({ "tokenDetails.tokenIdHex": token.tokenDetails.tokenIdHex }, token, { upsert: true });
    }

    async tokenDelete(tokenIdHex: string) {
        await this.checkClientStatus();
        return await this.db.collection('tokens').deleteMany({ "tokenDetails.tokenIdHex": tokenIdHex });
    }

    async tokenFetch(tokenIdHex: string): Promise<TokenDBObject|null> {
        await this.checkClientStatus();
        return await this.db.collection('tokens').findOne({ "tokenDetails.tokenIdHex": tokenIdHex });
    }

    async tokenFetchAll(): Promise<TokenDBObject[]|null> {
        await this.checkClientStatus();
        return await this.db.collection('tokens').find({}).toArray();
    }

    async tokenReset() {
        await this.checkClientStatus();
        await this.db.collection('tokens').deleteMany({})
        .catch(function(err) {
            console.log('[ERROR] token collection reset ERR ', err);
            throw err;
        });
    }

    async graphItemsUpsert(graph: GraphMap) {
        await this.checkClientStatus();        
        console.time("ToDBO");
        let { itemsToUpdate, tokenDbo, txidsToDelete } = GraphMap.toDbos(graph);
        console.timeEnd("ToDBO");
        for (const i of itemsToUpdate) {
            if (txidsToDelete.includes(i.graphTxn.txid)) {
                continue;
            }
            let res = await this.db.collection("graphs").replaceOne({ "tokenDetails.tokenIdHex": i.tokenDetails.tokenIdHex, "graphTxn.txid": i.graphTxn.txid }, i, { upsert: true });
            if (res.modifiedCount) {
                console.log(`[DEBUG] graphItemsUpsert - modified: ${i.graphTxn.txid}`);
            } else if (res.upsertedCount) {
                console.log(`[DEBUG] graphItemsUpsert - inserted: ${i.graphTxn.txid}`);
            } else {
                throw Error(`Graph record was not updated: ${i.graphTxn.txid} (token: ${i.tokenDetails.tokenIdHex})`);
            }
        }
        await this.tokenInsertReplace(tokenDbo);

        for (const txid of txidsToDelete) {
            await this.db.collection("graphs").deleteMany({ "graphTxn.txid": txid });
            await this.db.collection("confirmed").deleteMany({ "tx.h": txid });
            await this.db.collection("unconfirmed").deleteMany({ "tx.h": txid });
        }
    }

    async graphDelete(tokenIdHex: string) {
        await this.checkClientStatus();
        return await this.db.collection('graphs').deleteMany({ "tokenDetails.tokenIdHex": tokenIdHex })
    }

    async graphItemDelete(txid: string) {
        await this.checkClientStatus();
        return await this.db.collection('graphs').deleteMany({ "graphTxn.txid": txid });
    }

    async graphFetch(tokenIdHex: string, lastPrunedHeight?: number): Promise<GraphTxnDbo[]> {
        await this.checkClientStatus();
        if (lastPrunedHeight) {
            return await this.db.collection('graphs').find({
                "tokenDetails.tokenIdHex": tokenIdHex,
                "$or": [ { "graphTxn._pruneHeight": { "$gt": lastPrunedHeight } }, { "graphTxn._pruneHeight": null }, { "graphTxn.txid": tokenIdHex }]
            }).toArray();
        } else {
            return await this.db.collection('graphs').find({
                "tokenDetails.tokenIdHex": tokenIdHex
            }).toArray();
        }
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

    async unconfirmedInsert(item: TNATxn) {
        await this.checkClientStatus();
        console.log(`Added unconfirmed: ${item.tx.h}`);
        return await this.db.collection('unconfirmed').insertMany([item]);
    }

    async unconfirmedReset() {
        await this.checkClientStatus();
        await this.db.collection('unconfirmed').deleteMany({})
        .catch(function(err) {
            console.log('[ERROR] mempoolreset ERR ', err);
            throw err;
        })
    }

    async unconfirmedTxids(): Promise<string[]> {
        await this.checkClientStatus();
        let res: TNATxn[] = await this.db.collection('unconfirmed').find({}).toArray();
        return res.map(u => u.tx.h);
    }

    async unconfirmedFetch(txid: string): Promise<TNATxn|null> {
        await this.checkClientStatus();
        let res = await this.db.collection('unconfirmed').findOne({ "tx.h": txid }) as TNATxn;
        return res;
    }

    async unconfirmedDelete(txids: string[]): Promise<number|undefined> {
        await this.checkClientStatus();
        if (txids.length === 0) {
            return 0;
        }
        let res = (await this.db.collection('unconfirmed').deleteMany({ "$or": txids.map(txid => { return { "tx.h": txid }})})).deletedCount;
        return res;
    }

    async unconfirmedProcessedSlp(): Promise<string[]> {
        await this.checkClientStatus();
        return (await this.db.collection('unconfirmed').find().toArray()).filter((i:TNATxn) => i.slp);
    }

    async confirmedFetch(txid: string): Promise<TNATxn|null> {
        await this.checkClientStatus();
        return await this.db.collection('confirmed').findOne({ "tx.h": txid }) as TNATxn;
    }

    async confirmedDelete(txid: string): Promise<any> {
        await this.checkClientStatus();
        return await this.db.collection('confirmed').deleteMany({ "tx.h": txid });
    }

    async confirmedFetchForReorg(blockIndex: number): Promise<any> {
        await this.checkClientStatus();
        return await this.db.collection('confirmed').find({ "blk.i": { "$gte": blockIndex }}).toArray();
    }

    async confirmedDeleteForReorg(blockIndex: number): Promise<any> {
        await this.checkClientStatus();
        console.log(`[WARN] Deleting all transactions with block greater than or equal to ${blockIndex}.`)
        return await this.db.collection('confirmed').deleteMany({ "blk.i": { "$gte": blockIndex }});
    }

    async confirmedReset() {
        await this.checkClientStatus();
        await this.db.collection('confirmed').deleteMany({}).catch(function(err) {
            console.log('[ERROR] confirmedReset ERR ', err)
            throw err;
        })
    }

    async confirmedReplace(items: TNATxn[], blockIndex: number) {
        await this.checkClientStatus();

        if (items.filter(i => !i.blk).length > 0) {
            throw Error("Attempted to add items without BLK property.");
        }

        if (blockIndex) {
            console.log('[INFO] Updating block', blockIndex, 'with', items.length, 'items');
        }
        
        for (let i=0; i < items.length; i++) {
            await this.db.collection('confirmed').replaceOne({ "tx.h": items[i].tx.h }, items[i], { upsert: true });
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
