import { SlpTokenGraph, TxnQueryResponse, TokenDBObject, SlpTransactionDetailsDb } from "./SlpTokenGraph";
import { SlpTransactionDetails, SlpTransactionType, Slp } from "slpjs";
import BigNumber from "bignumber.js";
import { IZmqSubscriber, SyncCompletionInfo, SyncFilterTypes } from "./bit";
import BITBOXSDK from 'bitbox-sdk/lib/bitbox-sdk';
import * as bitcore from 'bitcore-lib-cash';
import { Db } from './db';
import { Config } from "./config";
import { TNATxn } from "./tna";

const bitqueryd = require('fountainhead-bitqueryd')

const BITBOX = new BITBOXSDK();
const slp = new Slp(BITBOX);

export class SlpGraphManager implements IZmqSubscriber {
    onBlockHash: undefined;
    db: Db;
    dbQuery: any; 

    async onTransactionHash(syncResult: SyncCompletionInfo): Promise<void> {
        let tokensUpdate: string[] = []
        if(syncResult) {
            let txns = Array.from(syncResult.filteredContent.get(SyncFilterTypes.SLP)!)
            await this.asyncForEach(txns, async (txPair: [string, string], index: number) =>
            {
                console.log("PROCESSING SLP GRAPH UPDATE...");
                let tokenId: string;
                let txn = new bitcore.Transaction(txPair[1]);
                let tokenDetails = slp.parseSlpOutputScript(txn.outputs[0]._scriptBuffer);
                tokenId = tokenDetails.tokenIdHex;
                if(tokenDetails.transactionType === SlpTransactionType.GENESIS) {
                    tokenId = txn.id;
                    tokenDetails.tokenIdHex = tokenId;
                }
    
                if(!this._tokens.has(tokenId)) {
                    console.log("ADDING NEW GRAPH FOR:", tokenId);
                    if(tokenDetails) {
                        let graph = new SlpTokenGraph();
                        await graph.initFromScratch(tokenDetails);
                        this._tokens.set(tokenId, graph);
                        tokensUpdate.push(tokenId);
                    }
                    else {
                        console.log("Skipping: No token details are available for this token")
                    }
                }
                else {
                    console.log("UPDATING GRAPH FOR:", tokenId);
                    await this._tokens.get(tokenId)!.updateTokenGraphFrom(txPair[0]);
                    tokensUpdate.push(tokenId);
                }   
                
                // Update the confirmed/unconfirmed collections with token details
                await this.updateTxnCollections(txn.id, tokenId);
            })

            // TODO: put this code in its own processing queue?
            await this.asyncForEach(tokensUpdate, async (tokenId: string) => {
                const token = this._tokens.get(tokenId)!;

                // Update the tokens collection in db
                await token.updateStatistics();
                await this.db.tokenreplace(token.toDbObject());

                console.log("########################################################################################################")
                console.log("TOKEN STATS/ADDRESSES FOR", token._tokenDetails.name, token._tokenDetails.tokenIdHex)
                console.log("########################################################################################################")
                token.logTokenStats();
                token.logAddressBalances();
            });
        }
    }

    _tokens!: Map<string, SlpTokenGraph>;

    constructor(db: Db) {
        this.db = db;
        this._tokens = new Map<string, SlpTokenGraph>();
    }

    private async updateTxnCollections(txid: string, tokenId: string) {
        console.log("Updating confirmed/unconfirmed collections for", txid);
        let isValid: boolean|null, details: SlpTransactionDetailsDb|null, invalidReason: string|null;
        let tokenGraph = this._tokens.get(tokenId)!;
        try {
            let keys = Object.keys(tokenGraph._slpValidator.cachedValidations);
            if(!keys.includes(txid)) {
                await tokenGraph._slpValidator.isValidSlpTxid(txid);
            }
            let validation = tokenGraph._slpValidator.cachedValidations[txid];
            isValid = validation.validity;
            invalidReason = validation.invalidReason;
            details = SlpTokenGraph.MapTokenDetailsToDbo(validation.details!, tokenGraph._tokenDetails.decimals);
        } catch(err) {
            isValid = false;
            details = null;
            invalidReason = "Invalid Token Genesis";
        }
        let collections = [ 'confirmed', 'unconfirmed' ];
        await this.asyncForEach(collections, async (collection: string) => {
            let tna: TNATxn | null = await this.db.db.collection(collection).findOne({ "tx.h": txid });
            if (tna && tna.slp) {
                tna.slp!.valid = isValid
                tna.slp!.detail = details!;
                tna.slp!.invalidReason = invalidReason;
                await this.db.db.collection(collection).replaceOne({ "tx.h": txid }, tna);
            }
        });
    }

    async initAllTokens() {
        this.dbQuery = await bitqueryd.init({ url: Config.db.url, name: Config.db.name });
        let tokens = await this.queryTokensList();

        // Instantiate all Token Graphs in memory
        for (let i = 0; i < tokens.length; i++) {
            let graph: SlpTokenGraph;
            try {
                let tokenState = <TokenDBObject>await this.db.tokenfetch(tokens[i].tokenIdHex);
                if(!tokenState)
                    throw Error("There is no db record for this token.");
                if(!tokenState.slpdbVersion || tokenState.slpdbVersion !== Config.db.schema_version) {
                    await this.db.tokendelete(tokens[i].tokenIdHex);
                    throw Error("Outdated token graph detected for: " + tokens[i].tokenIdHex);
                }
                graph = await SlpTokenGraph.FromDbObject(tokenState);
                console.log("########################################################################################################")
                console.log("LOAD FROM DB:", graph._tokenDetails.tokenIdHex);
                console.log("########################################################################################################")
                let potentialReorgFactor = 10;
                let updateFromHeight = graph._lastUpdatedBlock - potentialReorgFactor;
                console.log("Checking for Graph Updates since token's last update at (height - " + potentialReorgFactor + "):", updateFromHeight);
                let res = await this.queryForRecentTokenTxns(graph._tokenDetails.tokenIdHex, updateFromHeight);

                // TODO: Pre-load validation results into the tokenGraph's local validator.

                await this.asyncForEach(res, async (txid: string) => {
                    await graph.updateTokenGraphFrom(txid);
                    console.log("Updated graph from", txid);
                });
                if(res.length === 0)
                    console.log("No token transactions after block", updateFromHeight, "were found.");
                else
                    console.log("Token's graph is up to date.");
                
            } catch(err) {
                console.log(err.message);
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

        // Print the token information to console.
        for (let i = 0; i < tokens.length; i++) {
            if(this._tokens.get(tokens[i].tokenIdHex)) {
                console.log("########################################################################################################")
                console.log("TOKEN STATS FOR", tokens[i].name, tokens[i].tokenIdHex);
                console.log("########################################################################################################")
                this._tokens.get(tokens[i].tokenIdHex)!.logTokenStats();
                this._tokens.get(tokens[i].tokenIdHex)!.logAddressBalances();
            }

            // Update each entry in confirmed/unconfirmed collections with SLP info
            let tokenTxns = await this.queryForRecentTokenTxns(tokens[i].tokenIdHex, 0);
            for(let j = 0; j < tokenTxns.length; j++) {
                await this.updateTxnCollections(tokenTxns[j], tokens[i].tokenIdHex);
            }
        }
    }

    async queryForRecentTokenTxns(tokenId: string, block: number): Promise<string[]> {
        let q = {
            "v": 3,
            "q": {
                "find": { "out.h1": "534c5000", "out.h4": tokenId, "$or": [{ "blk.i": { "$gte": block } }, { "blk.i": null } ]  }
            },
            "r": { "f": "[ .[] | { txid: .tx.h } ]" }
        }

        let res: TxnQueryResponse = await this.dbQuery.read(q);
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

        let response: GenesisQueryResult | any = await this.dbQuery.read(q);
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

        let response: GenesisQueryResult | any = await this.dbQuery.read(q);
        let tokens: GenesisQueryResult[] = [].concat(response.u).concat(response.c);
        return tokens.length > 0 ? tokens.map(t => this.mapSlpTokenDetailsFromQuery(t))[0] : null;
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
