import { Config } from "./config";
import { Info } from "./info";
import { SlpTransactionDetails, SlpTransactionType, Utils } from "slpjs";
import BigNumber from "bignumber.js";
import { TNATxnSlpDetails } from "./tna";
import { TokenDBObject } from "./SlpTokenGraph";

const bitqueryd = require('fountainhead-core').slpqueryd

export class Query {

    static dbQuery: any; 
    static async init(): Promise<void> {
        if(!Query.dbQuery) { 
            if((await Info.getNetwork()) === 'mainnet')
                Query.dbQuery = await bitqueryd.init({ url: Config.db.url, name: Config.db.name, log_result: false });
            else
                Query.dbQuery = await bitqueryd.init({ url: Config.db.url, name: Config.db.name_testnet, log_result: false });
        }
        return Query.dbQuery;
    }

    static async getConfirmedTxnTimestamp(txid: string): Promise<string|null> {
        console.log("[Query] getConfirmedTxnTimestamp()")
        let q = {
            "v": 3,
            "q": {
                "db": "c",
                "find": { "tx.h": txid },
                "limit": 1,
                "project": { "blk": 1 }
            },
            "r": { "f": "[ .[] | { timestamp: (if .blk? then (.blk.t | strftime(\"%Y-%m-%d %H:%M:%S\")) else null end) } ]" }
        }

        let res: SendTxnQueryResponse = await this.dbQuery.read(q);
        if(res.c.length === 0)
            return null;
        let response: SendTxnQueryResult[] = [].concat(<any>res.c);
        let a = response.map((r: {timestamp: string|null}) => { return r.timestamp }) as string[];
        return a[0];
    }

    static async getGenesisTransactionsForBlock(blockHash: string): Promise<{ txns: string[], timestamp: string|null }|null> {
        console.log("[Query] getGenesisTransactionsForBlock("+blockHash+")")
        let limit = 1000000;
        let q = {
            "v": 3,
            "q": {
                "db": "c",
                "find": { "blk.h": blockHash, "out.s3": "GENESIS" },
                "limit": limit
            },
            "r": { "f": "[ .[] | { txid: .tx.h, timestamp: (if .blk? then (.blk.t | strftime(\"%Y-%m-%d %H:%M:%S\")) else null end) } ]" }
        }

        let res: SendTxnQueryResponse = await this.dbQuery.read(q);
        if(res.c.length === 0)
            return null;
        let response: SendTxnQueryResult[] = [].concat(<any>res.c);
        let a = Array.from(new Set<string>(response.map((r: any) => { return r.txid })));
        if(a.length === limit)
            throw Error("Query limit is reached, implementation error");
        return { txns: a, timestamp: response[0] ? response[0].timestamp: null };
    }

    static async getTransactionsForBlock(blockHash: string): Promise<{ txns: {txid: string, slp: TNATxnSlpDetails }[], timestamp: string|null }|null> {
        console.log("[Query] getTransactionsForBlock(" + blockHash + ")")
        let limit = 1000000;
        let q = {
            "v": 3,
            "q": {
                "db": "c",
                "find": { "blk.h": blockHash },
                "limit": limit
            },
            "r": { "f": "[ .[] | { txid: .tx.h, timestamp: (if .blk? then (.blk.t | strftime(\"%Y-%m-%d %H:%M:%S\")) else null end), slp: .slp } ]" }
        }

        let res: SendTxnQueryResponse = await this.dbQuery.read(q);
        if(!res.c || res.c.length === 0)
            return null;
        let response = new Set<any>([].concat(<any>res.c).map((r: SendTxnQueryResult) => { return { txid: r.txid, slp: r.slp }}));
        let a = Array.from(response);
        if(a.length === limit)
            throw Error("Query limit is reached, implementation error");
        return { txns: a, timestamp: a[0] ? a[0].timestamp: null, };
    }

    static async queryForRecentTokenTxns(tokenId: string, block: number): Promise<string[]> {
        console.log("[Query] queryForRecentTokenTxns(" + tokenId + "," + block + ")");
        let limit = 100000;
        let q = {
            "v": 3,
            "q": {
                "db": [ "c", "u" ],
                "find": { "out.h1": "534c5000", "out.h4": tokenId, "$or": [{ "blk.i": { "$gte": block } }, { "blk.i": null } ]  },
                "limit": limit
            },
            "r": { "f": "[ .[] | { txid: .tx.h } ]" }
        }

        let res: SendTxnQueryResponse = await this.dbQuery.read(q);
        let response = new Set<any>([].concat(<any>res.c).concat(<any>res.u).map((r: any) => { return r.txid } ));
        let a = Array.from(response);
        if(a.length === limit)
            throw Error("Query limit is reached, implementation error");
        return a;
    }

    static async queryTokensList(tokenId?: string): Promise<SlpTransactionDetails[]> {
        console.log("[Query] queryTokensList()");
        let limit = 100000;
        let q;
        if(tokenId) {
            q = {
                "v": 3,
                "q": {
                  "db": [ "c", "u" ],
                  "find": { "tx.h": tokenId },
                  "limit": limit
                },
                "r": { "f": "[ .[] | { tokenIdHex: .tx.h, versionTypeHex: .out[0].h2, timestamp: (if .blk? then (.blk.t | strftime(\"%Y-%m-%d %H:%M:%S\")) else null end), symbol: .out[0].s4, name: .out[0].s5, documentUri: .out[0].s6, documentSha256Hex: .out[0].h7, decimalsHex: .out[0].h8, batonHex: .out[0].h9, quantityHex: .out[0].h10 } ]" }
            }
        } else {
            q = {
                "v": 3,
                "q": {
                  "db": [ "c", "u" ],
                  "find": { "out.h1": "534c5000", "out.s3": "GENESIS" },
                  "limit": limit
                },
                "r": { "f": "[ .[] | { tokenIdHex: .tx.h, versionTypeHex: .out[0].h2, timestamp: (if .blk? then (.blk.t | strftime(\"%Y-%m-%d %H:%M:%S\")) else null end), symbol: .out[0].s4, name: .out[0].s5, documentUri: .out[0].s6, documentSha256Hex: .out[0].h7, decimalsHex: .out[0].h8, batonHex: .out[0].h9, quantityHex: .out[0].h10 } ]" }
            }
        }

        let response: GenesisQueryResult | any = await this.dbQuery.read(q);
        let tokens: GenesisQueryResult[] = [].concat(response.u).concat(response.c);
        if(tokens.length === limit)
            throw Error("Query limit is reached, implementation error");
        return tokens.map(t => this.mapSlpTokenDetailsFromQuery(t));
    }

    static async blockLastMinted(tokenIdHex: string): Promise<number|null> {
        console.log("[Query] blockLastMinted(" + tokenIdHex + ")");
        let q = {
            "v": 3,
            "q": {
                "db": ["c"],
                "find": { "out.h4": tokenIdHex, "out.h1": "534c5000", "out.s3": "MINT" },
                "sort": { "blk.i": -1 }, 
                "limit": 1
            },
            "r": { "f": "[ .[] | { block: (if .blk? then .blk.i else null end)} ]" }
        }

        let response: SendTxnQueryResponse = await this.dbQuery.read(q);
        let tokens: { block: number }[] = response.c as { block: number }[];
        return tokens.length > 0 ? tokens[0].block : null;
    }

    static async blockLastSent(tokenIdHex: string): Promise<number|null> {
        console.log("[Query] blockLastSent(" + tokenIdHex + ")");
        let q = {
            "v": 3,
            "q": {
                "db": ["c"],
                "find": { "out.h4": tokenIdHex, "out.h1": "534c5000", "out.s3": "SEND" },
                "sort": { "blk.i": -1 }, 
                "limit": 1
            },
            "r": { "f": "[ .[] | { block: (if .blk? then .blk.i else null end)} ]" }
        }

        let response: SendTxnQueryResponse = await this.dbQuery.read(q);
        let tokens: { block: number }[] = response.c as { block: number }[];
        return tokens.length > 0 ? tokens[0].block : null;
    }

    static async queryForConfirmedMissingSlpMetadata(): Promise<string[]|null> {
        console.log("[Query] queryForConfirmedMissingSlpMetadata()")
        let q = {
            "v": 3,
            "q": {
                "db": ["c"],
                "find": {
                    "slp": { "$exists": false }
                },
                "project": {
                    "tx.h": 1
                },
                "limit": 10000
            }
        }

        let response: any = await this.dbQuery.read(q);
        let tokens: any[] = [].concat(response.c).map((i: any) => i.tx.h);
        return tokens.length > 0 ? tokens : null;
    }

    static async queryForConfirmedTokensMissingTimestamps(): Promise<{txid: string, blk: any }[]|null> {
        console.log("[Query] queryForConfirmedTokensMissingTimestamps()");
        let q = {
            "v": 3,
            "q": {
                "db": ["t"],
                "aggregate": [
                    { "$match": { "$or": [{ "tokenStats.block_created": null }, { "tokenDetails.timestamp": null }]} }, 
                    { "$project": { "txid": "$tokenDetails.tokenIdHex", "_id": 0 }},
                    { "$lookup": { "from": "confirmed", "localField": "txid", "foreignField": "tx.h", "as": "txn" }},
                    { "$project": { "txid": "$txn.tx.h", "blk": "$txn.blk" }}, 
                    { "$unwind": "$txid" },
                    { "$unwind": "$blk" }
                ],
                "limit": 10000
            }
        }

        let res: any = await this.dbQuery.read(q);
        let tokens: {txid: string, blk: object }[] = [].concat(res.t);
        return tokens.length > 0 ? tokens : null;
    }

    static async queryTokenGenesisBlock(tokenIdHex: string): Promise<number|null> {
        console.log("[Query] queryTokenGenesisBlock(" + tokenIdHex + ")");
        let q = {
            "v": 3,
            "q": {
                "db": ["c"],
                "find": { "tx.h": tokenIdHex, "out.h1": "534c5000", "out.s3": "GENESIS" },
                "limit": 1
            },
            "r": { "f": "[ .[] | { block: (if .blk? then .blk.i else null end)} ]" }
        }

        let response: any = await this.dbQuery.read(q);
        let tokens: any[] = [].concat(response.c);
        return tokens.length > 0 ? tokens[0].block : null;
    }

    static async queryTokenDetails(tokenIdHex: string): Promise<SlpTransactionDetails|null> {
        console.log("[Query] queryTokenDetails(" + tokenIdHex + ")");
        let q = {
            "v": 3,
            "q": {
                "db": ["c","u"],
                "find": { "tx.h": tokenIdHex, "out.h1": "534c5000", "out.s3": "GENESIS" },
                "limit": 1
            },
            "r": { "f": "[ .[] | { tokenIdHex: .tx.h, versionTypeHex: .out[0].h2, timestamp: (if .blk? then (.blk.t | strftime(\"%Y-%m-%d %H:%M:%S\")) else null end), symbol: .out[0].s4, name: .out[0].s5, documentUri: .out[0].s6, documentSha256Hex: .out[0].h7, decimalsHex: .out[0].h8, batonHex: .out[0].h9, quantityHex: .out[0].h10 } ]" }
        }

        let response: GenesisQueryResult | any = await this.dbQuery.read(q);
        let tokens: GenesisQueryResult[] = [].concat(response.u).concat(response.c);
        return tokens.length > 0 ? tokens.map(t => this.mapSlpTokenDetailsFromQuery(t))[0] : null;
    }

    static mapSlpTokenDetailsFromQuery(res: GenesisQueryResult): SlpTransactionDetails {
        let baton: number|null = res.batonHex ? parseInt(res.batonHex, 16) : null;
        let qtyBuf = res.quantityHex ? Buffer.from(res.quantityHex, 'hex') : Buffer.from("", 'hex');
        let qty: BigNumber|null;
        try {
            qty = Utils.buffer2BigNumber(qtyBuf);
        } catch(_) { qty = null; }
        return {
            tokenIdHex: res.tokenIdHex,
            timestamp: <string>res.timestamp,
            transactionType: SlpTransactionType.GENESIS,
            versionType: parseInt(res.versionTypeHex, 16),
            documentUri: res.documentUri,
            documentSha256: res.documentSha256Hex ? Buffer.from(res.documentSha256Hex, 'hex') : null,
            symbol: res.symbol, 
            name: res.name, 
            batonVout: baton,
            decimals: parseInt(res.decimalsHex, 16),
            containsBaton: baton && baton > 1 && baton < 256 ? true : false,
            genesisOrMintQuantity: qty
        }
    }

    static async queryForTxnTokenId(txid: string): Promise<string|null> {
        console.log("[Query] queryForTxoInputSourceTokenID(" + txid + ")");
        let q = {
            "v": 3,
            "q": {
                "db": ["c","u"],
                "find": { "tx.h": txid }, 
                "limit": 1
            },
            "r": { "f": "[.[] | { type: .out[0].s3, sendOrMintTokenId: .out[0].h4 } ]" }
        }

        let response: { c: any, u: any, errors?: any } = await this.dbQuery.read(q);
        
        if(!response.errors) {
            let results: { type: string, sendOrMintTokenId: string }[] = ([].concat(<any>response.c).concat(<any>response.u));
            if(results.length > 0) {
                if((results[0].type === "SEND" || results[0].type === "MINT") && results[0].sendOrMintTokenId) {
                    return results[0].sendOrMintTokenId;
                }
                else if(results[0].type === "GENESIS") {
                    return txid;
                }
                return null;
            }
            else {
                console.log("Could not find token ID for this transaction: " + txid);
                return null;
            }
        }
        throw Error("Mongo DB ERROR.");
    }

    static async queryForTxoInputAsSlpMint(txid: string, vout: number): Promise<MintTxnQueryResult|null> {
        console.log("[Query] queryForTxoInputSlpMint(" + txid + "," + vout + ")");
        let q = {
            "v": 3,
            "q": {
                "db": ["c","u"],
                "find": { 
                    "in": {
                        "$elemMatch": { "e.h": txid, "e.i": vout } // DO NOT INCLUDE! --> , "out.s3": "MINT" }
                    }
                }, 
                "limit": 1   
            },
            "r": { "f": "[ .[] | { txid: .tx.h, block: (if .blk? then .blk.i else null end), timestamp: (if .blk? then (.blk.t | strftime(\"%Y-%m-%d %H:%M:%S\")) else null end), tokenid: .out[0].h4, batonHex: .out[0].h5, mintQty: .out[0].h6, mintBchQty: .out[1].e.v } ]" }
        }

        let response: MintTxnQueryResponse = await this.dbQuery.read(q);
        
        if(!response.errors) {
            let results: MintTxnQueryResult[] = ([].concat(<any>response.c).concat(<any>response.u));
            if(results.length > 0) {
                let res: MintTxnQueryResult = results[0];
                try {
                    let qtyBuf = Buffer.from(res.mintQty as any as string, 'hex');
                    res.mintQty = Utils.buffer2BigNumber(qtyBuf)
                } catch(err) { 
                    throw err;
                }
                return res;
            }
            else {
                console.log("[INFO] Assumed Token Burn: Could not find the spend transaction: " + txid + ":" + vout);
                return null;
            }
        }
        console.log("[ERROR]",response.errors);
        throw Error("Mongo DB ERROR.")
    }

    static async queryForTxoInputAsSlpSend(txid: string, vout: number): Promise<SendTxnQueryResult|null> {
        console.log("[Query] queryForTxoInputAsSlpSend(" + txid + "," + vout + ")");
        let q = {
            "v": 3,
            "q": {
                "db": ["c","u"],
                "find": { 
                    "in": {
                        "$elemMatch": { "e.h": txid, "e.i": vout } // DO NOT INCLUDE! --> , "out.s3": "SEND" }
                    }
                }, 
                "limit": 1   
            },
            "r": { "f": "[ .[] | { txid: .tx.h, block: (if .blk? then .blk.i else null end), timestamp: (if .blk? then (.blk.t | strftime(\"%Y-%m-%d %H:%M:%S\")) else null end), tokenid: .out[0].h4, slp1: .out[0].h5, slp2: .out[0].h6, slp3: .out[0].h7, slp4: .out[0].h8, slp5: .out[0].h9, slp6: .out[0].h10, slp7: .out[0].h11, slp8: .out[0].h12, slp9: .out[0].h13, slp10: .out[0].h14, slp11: .out[0].h15, slp12: .out[0].h16, slp13: .out[0].h17, slp14: .out[0].h18, slp15: .out[0].h19, slp16: .out[0].h20, slp17: .out[0].h21, slp18: .out[0].h22, slp19: .out[0].h23, bch0: .out[0].e.v, bch1: .out[1].e.v, bch2: .out[2].e.v, bch3: .out[3].e.v, bch4: .out[4].e.v, bch5: .out[5].e.v, bch6: .out[6].e.v, bch7: .out[7].e.v, bch8: .out[8].e.v, bch9: .out[9].e.v, bch10: .out[10].e.v, bch11: .out[11].e.v, bch12: .out[12].e.v, bch13: .out[13].e.v, bch14: .out[14].e.v, bch15: .out[15].e.v, bch16: .out[16].e.v, bch17: .out[17].e.v, bch18: .out[18].e.v, bch19: .out[19].e.v } ]" }
        }

        let response: SendTxnQueryResponse = await this.dbQuery.read(q);
        
        if(!response.errors) {
            let results: SendTxnQueryResult[] = ([].concat(<any>response.c).concat(<any>response.u));
            if(results.length > 0) {
                let res: any = results[0];
                let sendOutputs: { tokenQty: BigNumber, satoshis: number }[] = [];
                res.sendOutputs = sendOutputs;
                res.sendOutputs.push({ tokenQty: new BigNumber(0), satoshis: res.bch0 });
                let keys = Object.keys(res);
                keys.forEach((key, index) => {
                    if(res[key] && key.includes('slp')) {
                        try {
                            let qtyBuf = Buffer.from(res[key], 'hex');
                            res.sendOutputs.push({ tokenQty: Utils.buffer2BigNumber(qtyBuf), satoshis: res["bch" + key.replace('slp', '')] });
                        } catch(err) {
                            throw err;
                        }
                    }
                })
                return res;
            }
            else {
                console.log("[INFO] Assumed Token Burn: Could not find the spend transaction: " + txid + ":" + vout);
                return null;
            }
        }
        console.log("[ERROR]",response.errors);
        throw Error("Mongo DB ERROR.")
    }

    static async getSendTransactionDetails(txid: string): Promise<{ block: number|null, timestamp: string|null} |null> {
        console.log("[Query] getSendTransactionDetails(" + txid + ")");
        let q = {
            "v": 3,
            "q": {
                "db": ["c","u"],
                "find": { "tx.h": txid }, 
                "limit": 1
            },
            "r": { "f": "[ .[] | { block: (if .blk? then .blk.i else null end), timestamp: (if .blk? then (.blk.t | strftime(\"%Y-%m-%d %H:%M:%S\")) else null end) } ]" }
        }

        let res: SendTxnQueryResponse = await Query.dbQuery.read(q);
        
        if(!res.errors) {
            let results: { block: number|null, timestamp: string|null}[] = [];
            results = [ ...([].concat(<any>res.c).concat(<any>res.u))]
            if(results.length > 0) {
                return results[0];
            }
        }
        return null;
    }

    static async getMintTransactions(tokenId: string): Promise<MintQueryResult[]|null> {
        console.log("[Query] getMintTransactions(" + tokenId + ")");
        let limit = 100000;
        let q = {
            "v": 3,
            "q": {
                "db": ["c","u"],
                "find": { "out.h1": "534c5000", "out.s3": "MINT", "out.h4": tokenId }, 
                "sort": {"blk.i": 1},
                "limit": limit
            },
            "r": { "f": "[ .[] | { slp: .slp, txid: .tx.h, versionTypeHex: .out[0].h2, block: (if .blk? then .blk.i else null end), timestamp: (if .blk? then (.blk.t | strftime(\"%Y-%m-%d %H:%M:%S\")) else null end), batonHex: .out[0].h5, quantityHex: .out[0].h6 } ]" }
        }

        let res: SendTxnQueryResponse = await Query.dbQuery.read(q);
        
        if(!res.errors) {
            let results: MintQueryResult[] = [].concat(<any>res.c).concat(<any>res.u);
            if(results.length === limit)
                throw Error("Query limit is reached, implementation error")
            results.forEach((res: MintQueryResult) => {
                let i = results.findIndex(r => r.txid === res.txid);
                if(i < 0)
                    results.push(res);
            });
            if(results.length > 0)
                return results;
        }
        return null;
    }
}

export interface MintTxnQueryResponse {
    c: MintTxnQueryResult[];
    u: MintTxnQueryResult[];
    errors?: any;
}

export interface SendTxnQueryResponse {
    c: SendTxnQueryResult[];
    u: SendTxnQueryResult[]; 
    errors?: any;
}

export interface TokenCollectionQueryResponse {
    t: TokenDBObject[];
    errors?: any;
}


export interface GenesisQueryResult {
    tokenIdHex: string;
    versionTypeHex: string;
    timestamp: string|null;
    symbol: string;
    name: string;
    documentUri: string;
    documentSha256Hex: string; 
    decimalsHex: string;
    batonHex: string;
    quantityHex: string;
}


export interface MintQueryResult {
    txid: string|null;
    block: number|null;
    timestamp: string|null;
    batonHex: string|null;
    quantityHex: string|null;
    versionTypeHex: string|null;
    slp: TNATxnSlpDetails;
}

//batonHex: .out[0].h5, mintQty: .out[0].h6, mintBchQty: 
export interface MintTxnQueryResult {
    txid: string|null;
    block: number|null;
    timestamp: string|null;
    tokenid: string|null;
    batonHex: string|null;
    mintQty: BigNumber|null;
    mintBchQty: number|null;
}

export interface SendTxnQueryResult {
    sendOutputs: { tokenQty: BigNumber, satoshis: number }[];
    //input: {h: string, i: number, a: string };
    txid: string|null;
    block: number|null;
    timestamp: string|null;
    tokenid: string|null,
    bch0?: number;
    bch1?: number|null;
    bch2?: number|null;
    bch3?: number|null;
    bch4?: number|null;
    bch5?: number|null;
    bch6?: number|null;
    bch7?: number|null;
    bch8?: number|null;
    bch9?: number|null;
    bch10?: number|null;
    bch11?: number|null;
    bch12?: number|null;
    bch13?: number|null;
    bch14?: number|null;
    bch15?: number|null;
    bch16?: number|null;
    bch17?: number|null;
    bch18?: number|null;
    bch19?: number|null;
    slp0?: string;
    slp1?: string|null;
    slp2?: string|null;
    slp3?: string|null;
    slp4?: string|null;
    slp5?: string|null;
    slp6?: string|null;
    slp7?: string|null;
    slp8?: string|null;
    slp9?: string|null;
    slp10?: string|null;
    slp11?: string|null;
    slp12?: string|null;
    slp13?: string|null;
    slp14?: string|null;
    slp15?: string|null;
    slp16?: string|null;
    slp17?: string|null;
    slp18?: string|null;
    slp19?: string|null;
    slp?: TNATxnSlpDetails;
}
