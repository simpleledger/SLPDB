import { SlpTokenGraph, TokenDBObject, SlpTransactionDetailsDb } from "./SlpTokenGraph";
import { SlpTransactionType, Slp } from "slpjs";
import { IZmqSubscriber, SyncCompletionInfo, SyncFilterTypes } from "./bit";
import { Query } from "./query";
import BITBOXSDK from 'bitbox-sdk';
import * as bitcore from 'bitcore-lib-cash';
import { Db } from './db';
import { Config } from "./config";
import { TNATxn } from "./tna";

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
                await tokenGraph._slpValidator.isValidSlpTxid(txid, tokenGraph._tokenDetails.tokenIdHex);
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
        await Query.init();
        let tokens = await Query.queryTokensList();

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
                let res = await Query.queryForRecentTokenTxns(graph._tokenDetails.tokenIdHex, updateFromHeight);

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
            let tokenTxns = await Query.queryForRecentTokenTxns(tokens[i].tokenIdHex, 0);
            for(let j = 0; j < tokenTxns.length; j++) {
                await this.updateTxnCollections(tokenTxns[j], tokens[i].tokenIdHex);
            }
        }
    }

    async asyncForEach(array: any[], callback: Function) {
        for (let index = 0; index < array.length; index++) {
          await callback(array[index], index, array);
        }
    }
}