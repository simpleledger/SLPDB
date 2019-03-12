import { SlpTokenGraph, TokenDBObject, UtxosDbObject, AddressesDbObject, GraphDbObject } from "./SlpTokenGraph";
import { SlpTransactionType, Slp, SlpTransactionDetails, Utils } from "slpjs";
import { IZmqSubscriber, SyncCompletionInfo, SyncFilterTypes } from "./bit";
import { Query } from "./query";
import BITBOXSDK from 'bitbox-sdk';
import * as bitcore from 'bitcore-lib-cash';
import { Db } from './db';
import { Config } from "./config";
import { TNATxn } from "./tna";
import { BitcoinRpc } from "./vendor";
import { Decimal128 } from "mongodb";

const RpcClient = require('bitcoin-rpc-promise');

const BITBOX = new BITBOXSDK();
const slp = new Slp(BITBOX);

export class SlpGraphManager implements IZmqSubscriber {
    onBlockHash: undefined;
    db: Db;
    _rpcClient: BitcoinRpc.RpcClient;

    async onTransactionHash(syncResult: SyncCompletionInfo): Promise<void> {
        let tokensUpdate: string[] = [];
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
                await this.db.tokenreplace(token.toTokenDbObject());
                await this.db.addressreplace(token.toAddressesDbObject());
                await this.db.graphreplace(token.toGraphDbObject());
                await this.db.utxoreplace(token.toUtxosDbObject());

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
        let connectionString = 'http://' + Config.rpc.user + ':' + Config.rpc.pass + '@' + Config.rpc.host + ':' + Config.rpc.port;
        this._rpcClient = <BitcoinRpc.RpcClient>(new RpcClient(connectionString));
    }

    private async updateTxnCollections(txid: string, tokenId: string) {
        let count = 0;
        let collections = [ 'confirmed', 'unconfirmed' ];
        await this.asyncForEach(collections, async (collection: string) => {
            let tna: TNATxn | null = await this.db.db.collection(collection).findOne({ "tx.h": txid });
            if (tna) {
                count++;
                if(collection === 'confirmed' && !tna.blk) {
                    let txn = await this._rpcClient.getRawTransaction(txid, 1);
                    let block = await this._rpcClient.getBlock(txn.blockhash);
                    tna.blk = {
                        h: txn.blockhash, 
                        i: block.height, 
                        t: block.time
                    }
                    await this.db.db.collection(collection).replaceOne({ "tx.h": txid }, tna);
                }
                if(!tna.slp)
                    tna.slp = {} as any;
                if(tna.slp!.schema_version !== Config.db.schema_version) {
                    console.log("Updating confirmed/unconfirmed collections for", txid);
                    let isValid: boolean|null, details: SlpTransactionDetailsTnaDbo|null, invalidReason: string|null;
                    let tokenGraph = this._tokens.get(tokenId)!;
                    try {
                        let keys = Object.keys(tokenGraph._slpValidator.cachedValidations);
                        if(!keys.includes(txid)) {
                            await tokenGraph._slpValidator.isValidSlpTxid(txid, tokenGraph._tokenDetails.tokenIdHex);
                        }
                        let validation = tokenGraph._slpValidator.cachedValidations[txid];                        
                        isValid = validation.validity;
                        invalidReason = validation.invalidReason;
                        let addresses: (string|null)[] = [];
                        if(validation.details!.transactionType === SlpTransactionType.SEND) {
                            addresses = tna.out.map(o => {
                                try {
                                    if(o.e!.a && Utils.isCashAddress(o.e!.a))
                                        return Utils.toSlpAddress(o.e!.a); 
                                    else return null;
                                } catch(_) { return null; }
                            });
                        }
                        else {
                            try {
                                if(tna.out[1]!.e!.a && Utils.isCashAddress(tna.out[1]!.e!.a))
                                    addresses = [ Utils.toSlpAddress(tna.out[1]!.e!.a) ];
                                else addresses = [ null ];
                            } catch(_) { return null; }
                        }
                        details = SlpGraphManager.MapTokenDetailsToTnaDbo(validation.details!, tokenGraph._tokenDetails.decimals, addresses);
                    } catch(err) {
                        isValid = false;
                        details = null;
                        invalidReason = "Invalid Token Genesis";
                    }
                    if(isValid === null)
                        throw Error("Validitity of " + txid + " is null.")
                    tna.slp!.valid = isValid
                    tna.slp!.detail = details!;
                    tna.slp!.invalidReason = invalidReason;
                    tna.slp!.schema_version = Config.db.schema_version;
                    await this.db.db.collection(collection).replaceOne({ "tx.h": txid }, tna);
                }
            }
        });
        if(count === 0) {
            throw Error("Transaction not found! " + txid);
        }
    }

    static MapTokenDetailsToTnaDbo(details: SlpTransactionDetails, decimals: number, addresses: (string|null)[]): SlpTransactionDetailsTnaDbo {
        let res: SlpTransactionDetailsTnaDbo = {
            decimals: details.decimals,
            tokenIdHex: details.tokenIdHex,
            timestamp: details.timestamp,
            transactionType: details.transactionType,
            versionType: details.versionType,
            documentUri: details.documentUri,
            documentSha256Hex: details.documentSha256 ? details.documentSha256.toString('hex')! : null,
            symbol: details.symbol,
            name: details.name,
            batonVout: details.batonVout,
            containsBaton: details.containsBaton,
            genesisOrMintQuantity: details.genesisOrMintQuantity ? { address: addresses[0], amount: Decimal128.fromString(details.genesisOrMintQuantity!.dividedBy(10**decimals).toFixed()) } : null,
            sendOutputs: details.sendOutputs ? details.sendOutputs.map((o,i) => { return { address: addresses[i], amount: Decimal128.fromString(o.dividedBy(10**decimals).toFixed()) } })  : null
        }

        return res;
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
                    await this.db.graphdelete(tokens[i].tokenIdHex);
                    await this.db.utxodelete(tokens[i].tokenIdHex);
                    await this.db.addressdelete(tokens[i].tokenIdHex);
                    throw Error("Outdated token graph detected for: " + tokens[i].tokenIdHex);
                }
                let utxos = <UtxosDbObject>await this.db.utxofetch(tokens[i].tokenIdHex);
                let addresses = <AddressesDbObject>await this.db.addressfetch(tokens[i].tokenIdHex);
                let dag = <GraphDbObject>await this.db.graphfetch(tokens[i].tokenIdHex);
                graph = await SlpTokenGraph.FromDbObjects(tokenState, dag, utxos, addresses);
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
                await this.db.tokeninsert(this._tokens.get(tokens[i].tokenIdHex)!.toTokenDbObject());
                await this.db.graphinsert(this._tokens.get(tokens[i].tokenIdHex)!.toGraphDbObject());
                await this.db.utxoinsert(this._tokens.get(tokens[i].tokenIdHex)!.toUtxosDbObject());
                await this.db.addressinsert(this._tokens.get(tokens[i].tokenIdHex)!.toAddressesDbObject());
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
            await this.updateTxnCollections(tokens[i].tokenIdHex, tokens[i].tokenIdHex);
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

export interface SlpTransactionDetailsTnaDbo {
    transactionType: SlpTransactionType;
    tokenIdHex: string;
    versionType: number;
    timestamp: string;
    symbol: string;
    name: string;
    documentUri: string; 
    documentSha256Hex: string|null;
    decimals: number;
    containsBaton: boolean;
    batonVout: number|null;
    genesisOrMintQuantity: { address: string|null, amount: Decimal128|null }|null;
    sendOutputs: { address: string|null, amount: Decimal128|null }[]|null;
}