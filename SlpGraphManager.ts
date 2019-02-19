import { SlpTokenGraph, TxnQueryResponse } from "./SlpTokenGraph";
import { SlpTransactionDetails, SlpTransactionType, Slp } from "slpjs";
import BigNumber from "bignumber.js";
import { IZmqSubscriber, SyncCompletionInfo, SyncFilterTypes } from "./bit";
import BITBOXSDK from 'bitbox-sdk/lib/bitbox-sdk';
import * as bitcore from 'bitcore-lib-cash';
import { Db } from './db';

const bitqueryd = require('fountainhead-bitqueryd')

const BITBOX = new BITBOXSDK();
const slp = new Slp(BITBOX);

export class SlpGraphManager implements IZmqSubscriber {
    onBlockHash: undefined;
    db: Db;

    async onTransactionHash(syncResult: SyncCompletionInfo): Promise<void> {
        let tokensUpdate: string[] = []
        if(syncResult) {
            let txns = Array.from(syncResult.filteredContent.get(SyncFilterTypes.SLP)!)
            await this.asyncForEach(txns, async (txPair: [string, string], index: number) =>
            {
                console.log("PROCESSING SLP GRAPH UPDATE...");
                let tokenId: string;
                let txn = new bitcore.Transaction(txPair[1]);
                let slpMsg = slp.parseSlpOutputScript(txn.outputs[0]._scriptBuffer);
                tokenId = slpMsg.tokenIdHex;
                if(slpMsg.transactionType === SlpTransactionType.GENESIS)
                    tokenId = txn.id;
    
                if(!this._tokens.has(tokenId)) {
                    console.log("ADDING NEW GRAPH FOR:", tokenId);
                    let tokenDetails = await this.queryTokenDetails(tokenId);
                    if(tokenDetails) {
                        let graph = new SlpTokenGraph();
                        await graph.initFromScratch(tokenDetails);
                        this._tokens.set(tokenId, graph);
                    }
                    else {
                        console.log("Skipping: No token details are available for this token")
                    }
                }
                else {
                    console.log("UPDATING GRAPH FOR:", tokenId);
                    await this._tokens.get(tokenId)!.updateTokenGraphFrom(txPair[0]);
                }
                tokensUpdate.push(tokenId);
            })

            // TODO: put this code in its own processing queue?
            await this.asyncForEach(tokensUpdate, async (tokenId: string) => {
                await this.db.tokenreplace(this._tokens.get(tokenId)!.toDbObject());

                await this._tokens.get(tokenId)!.updateStatistics();
                console.log("########################################################################################################")
                console.log("TOKEN STATS/ADDRESSES FOR", this._tokens.get(tokenId)!._tokenDetails.name, this._tokens.get(tokenId)!._tokenDetails.tokenIdHex)
                console.log("########################################################################################################")
                console.log(this._tokens.get(tokenId)!.getTokenStats())
                console.log(this._tokens.get(tokenId)!.getAddresses())
            })
        }
    }

    _tokens!: Map<string, SlpTokenGraph>;

    constructor(db: Db) {
        this.db = db;
        this._tokens = new Map<string, SlpTokenGraph>();
    }

    async initAllTokens() {
        let tokens = await this.queryTokensList();

        for (let i = 0; i < tokens.length; i++) {
            let graph: SlpTokenGraph;

            try {
                let tokenState = await this.db.tokenfetch(tokens[i].tokenIdHex);
                if(!tokenState)
                    throw Error("There is no db record for this token.");
                graph = await SlpTokenGraph.FromDbObject(tokenState);
                console.log("########################################################################################################")
                console.log("LOAD FROM DB:", graph._tokenDetails.tokenIdHex);
                console.log("########################################################################################################")
                let potentialReorgFactor = 10;
                let updateFromHeight = graph._lastUpdatedBlock - potentialReorgFactor;
                console.log("Checking for Graph Updates since token's last update at (height - " + potentialReorgFactor + "):", updateFromHeight);
                let res = await this.queryForRecentTokenTxns(graph._tokenDetails.tokenIdHex, updateFromHeight);
                await this.asyncForEach(res, async (txid: string) => {
                    await graph.updateTokenGraphFrom(txid);
                    console.log("Updated graph from", txid);
                });
                if(res.length === 0)
                    console.log("No token transactions after block", updateFromHeight, "werer found.");
                else
                    console.log("Token's graph is up to date.");
            } catch(_) {
                graph = new SlpTokenGraph();
                console.log("########################################################################################################")
                console.log("NEW GRAPH FOR", tokens[i].tokenIdHex)
                console.log("########################################################################################################")
                await graph.initFromScratch(tokens[i]);
            }

            if(graph.IsValid()) {
                this._tokens.set(tokens[i].tokenIdHex, graph);
                await this.db.tokeninsert(this._tokens.get(tokens[i].tokenIdHex)!.toDbObject());
            }
        }

        for (let i = 0; i < tokens.length; i++) {
            if(this._tokens.get(tokens[i].tokenIdHex)) {
                console.log("########################################################################################################")
                console.log("TOKEN STATS FOR", tokens[i].name, tokens[i].tokenIdHex)
                console.log("########################################################################################################")
                console.log(this._tokens.get(tokens[i].tokenIdHex)!.getTokenStats())
            }
        }
    }

    async queryForRecentTokenTxns(tokenId: string, block: number): Promise<{ txid: string}[]> {
        let q = {
            "v": 3,
            "q": {
                "find": { "out.h1": "534c5000", "out.h4": tokenId, "blk.i": { "$gte": block } }
            },
            "r": { "f": "[ .[] | { txid: .tx.h } ]" }
        }

        let db = await bitqueryd.init();
        let res: TxnQueryResponse = await db.read(q);
        let response = new Set<any>([].concat(<any>res.c).concat(<any>res.u).map((r: any) => { return r.txid } ));
        return Array.from(response);
    }

    async queryTokensList(): Promise<SlpTransactionDetails[]> {
        let q = {
            "v": 3,
            "q": {
              "find": { "out.h1": "534c5000", "out.s3": "GENESIS" },
              "limit": 10000,
            },
            "r": { "f": "[ .[] | { tokenIdHex: .tx.h, versionTypeHex: .out[0].h2, timestamp: (if .blk? then (.blk.t | strftime(\"%Y-%m-%d %H:%M\")) else null end), symbol: .out[0].s4, name: .out[0].s5, documentUri: .out[0].s6, documentSha256Hex: .out[0].h7, decimalsHex: .out[0].h8, batonHex: .out[0].h9, quantityHex: .out[0].h10 } ]" }
        }

        let db = await bitqueryd.init();
        let response: GenesisQueryResult | any = await db.read(q);
        let tokens: GenesisQueryResult[] = [].concat(response.u).concat(response.c);
        return tokens.map(t => this.mapSlpTokenDetailsFromQuery(t));
    }

    async queryTokenDetails(tokenIdHex: string): Promise<SlpTransactionDetails|null> {
        let q = {
            "v": 3,
            "q": {
                "find": { "tx.h": tokenIdHex, "out.h1": "534c5000", "out.s3": "GENESIS" }
            },
            "r": { "f": "[ .[] | { tokenIdHex: .tx.h, versionTypeHex: .out[0].h2, timestamp: (if .blk? then (.blk.t | strftime(\"%Y-%m-%d %H:%M\")) else null end), symbol: .out[0].s4, name: .out[0].s5, documentUri: .out[0].s6, documentSha256Hex: .out[0].h7, decimalsHex: .out[0].h8, batonHex: .out[0].h9, quantityHex: .out[0].h10 } ]" }
        }

        let db = await bitqueryd.init();
        let response: GenesisQueryResult | any = await db.read(q);
        console.log(response);
        let tokens: GenesisQueryResult[] = [].concat(response.u).concat(response.c);
        return tokens.length === 1 ? tokens.map(t => this.mapSlpTokenDetailsFromQuery(t))[0] : null;
    }

    mapSlpTokenDetailsFromQuery(res: GenesisQueryResult): SlpTransactionDetails {
        let baton: number = parseInt(res.decimalsHex, 16);
        let qtyBuf = Buffer.from(res.quantityHex, 'hex');
        let qty: BigNumber = (new BigNumber(qtyBuf.readUInt32BE(0).toString())).multipliedBy(2**32).plus(qtyBuf.readUInt32BE(4).toString())
        return {
            tokenIdHex: res.tokenIdHex,
            timestamp: <string>res.timestamp,
            transactionType: SlpTransactionType.GENESIS,
            versionType: parseInt(res.versionTypeHex, 16),
            documentUri: res.documentUri,
            documentSha256: Buffer.from(res.documentSha256Hex, 'hex'),
            symbol: res.symbol, 
            name: res.name, 
            batonVout: baton,
            decimals: parseInt(res.decimalsHex, 16),
            containsBaton: baton > 1 && baton < 256 ? true : false,
            genesisOrMintQuantity: qty
        }
    }

    async asyncForEach(array: any[], callback: Function) {
        for (let index = 0; index < array.length; index++) {
          await callback(array[index], index, array);
        }
    }
}

interface GenesisQueryResult {
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
