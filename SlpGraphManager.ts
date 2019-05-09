import { SlpTokenGraph, TokenDBObject, UtxoDbo, AddressBalancesDbo, GraphTxnDbo } from "./SlpTokenGraph";
import { SlpTransactionType, Slp, SlpTransactionDetails, Utils } from "slpjs";
import { IZmqSubscriber, SyncCompletionInfo, SyncFilterTypes } from "./bit";
import { Query } from "./query";
import BITBOXSDK from 'bitbox-sdk';
import * as bitcore from 'bitcore-lib-cash';
import { Db } from './db';
import { Config } from "./config";
import { TNATxn, TNATxnSlpDetails } from "./tna";
import { BitcoinRpc } from "./vendor";
import { Decimal128 } from "mongodb";
import zmq from 'zeromq';
import { Info } from "./info";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const RpcClient = require('bitcoin-rpc-promise');

const BITBOX = new BITBOXSDK();
const slp = new Slp(BITBOX);

export class SlpGraphManager implements IZmqSubscriber {
    db: Db;
    _rpcClient: BitcoinRpc.RpcClient;
    zmqPubSocket?: zmq.Socket;
    _transaction_lock: boolean = false;

    async onTransactionHash(syncResult: SyncCompletionInfo): Promise<void> {
        if(syncResult && syncResult.filteredContent.size > 0) {
            let txns = Array.from(syncResult.filteredContent.get(SyncFilterTypes.SLP)!)
            await this.asyncForEach(txns, async (txPair: [string, string], index: number) =>
            {
                console.log("PROCESSING SLP GRAPH UPDATE FOR:", txPair[0]);
                let txn = new bitcore.Transaction(txPair[1]);
                let tokenDetails = this.parseTokenTransactionDetails(txPair[1]);
                let tokenId = tokenDetails ? tokenDetails.tokenIdHex : null;

                // Based on Txn output OP_RETURN data, update graph for the tokenId 
                if(tokenDetails && tokenId) {
                    if(!this._tokens.has(tokenId)) {
                        if(tokenDetails) {
                            this._transaction_lock = true;
                            await this.createNewTokenGraph(tokenId);
                            this._transaction_lock = false;
                            await this.publishZmqNotification(txPair[0]);
                        }
                        else {
                            console.log("[INFO] Skipping: No token details are available for this token")
                        }
                    }
                    else {
                        console.log("UPDATING GRAPH FOR:", tokenId);
                        while(this._transaction_lock) {
                            console.log("[INFO] onTransactionHash update is locked until processing for new token graph is completed.")
                            await sleep(1000);
                        }
                        this._tokens.get(tokenId)!.queueTokenGraphUpdateFrom(txPair[0]);
                    }
                }

                // Based on the spent inputs, look for associated tokenIDs of those inputs and update those token graphs also
                let inputTokenIds: string[] = [];
                for(let i = 0; i < txn.inputs.length; i++) {
                    let inputTokenId = await Query.queryForTxnTokenId(txn.inputs[i].prevTxId.toString('hex'));
                    if(inputTokenId && inputTokenId !== tokenId && this._tokens.has(inputTokenId) && !inputTokenIds.includes(inputTokenId)) {
                        inputTokenIds.push(inputTokenId);
                        this._tokens.get(inputTokenId)!.queueTokenGraphUpdateFrom(txPair[0]);
                    }
                    else {
                        console.log("[INFO] SLP txn input:", i, "does not need updated for txid:", txPair[0]);
                    }
                }
            })
        }
    }

    private parseTokenTransactionDetails(txn_hex: string): SlpTransactionDetails|null {
        let txn = new bitcore.Transaction(txn_hex);

        let tokenDetails: SlpTransactionDetails|null;
        try {
            tokenDetails = slp.parseSlpOutputScript(txn.outputs[0]._scriptBuffer);
        }
        catch (err) {
            tokenDetails = null;
        }
        if (tokenDetails && tokenDetails.transactionType === SlpTransactionType.GENESIS)
            tokenDetails.tokenIdHex = txn.id;
        
        return tokenDetails;
    }

    async onBlockHash(hash: string): Promise<void> {

        while(this._transaction_lock) {
            console.log("[INFO] onBlockHash update is locked until processing for new token graph is completed.")
            await sleep(1000);
        }

        let blockTxns = await Query.getTransactionsForBlock(hash);
        if(blockTxns!) {
            // update tokens collection timestamps on confirmation for Genesis transactions
            let genesisBlockTxns = await Query.getGenesisTransactionsForBlock(hash);
            if(genesisBlockTxns) {
                for(let i = 0; i < genesisBlockTxns.txns.length; i++) {
                    this._tokens.get(genesisBlockTxns.txns[i])!._tokenDetails.timestamp = genesisBlockTxns.timestamp!;
                }
            }

            // update all statistics for tokens included in this block
            let tokenIds = Array.from(new Set<string>([...blockTxns!.txns.filter(t => t.slp).map(t => t.slp.detail!.tokenIdHex)]));

            // update statistics for each token
            for(let i = 0; i < tokenIds.length; i++) {
                let token = this._tokens.get(tokenIds[i])!;
                await token.updateStatistics();
            }

            // zmq publish block events
            if(this.zmqPubSocket) {
                console.log("[ZMQ-PUB] SLP block txn notification", hash);
                this.zmqPubSocket.send([ 'block', JSON.stringify(blockTxns) ]);
            }

            // fix any missed token timestamps 
            // await this.fixMissingTokenTimestamps();
        }
    }

    _tokens!: Map<string, SlpTokenGraph>;

    constructor(db: Db) {
        this.db = db;
        this._tokens = new Map<string, SlpTokenGraph>();
        let connectionString = 'http://' + Config.rpc.user + ':' + Config.rpc.pass + '@' + Config.rpc.host + ':' + Config.rpc.port;
        this._rpcClient = <BitcoinRpc.RpcClient>(new RpcClient(connectionString));
    }

    async fixMissingTokenTimestamps() {
        let tokens = await Query.getNullTokenGenesisTimestamps();
        if(tokens) {
            await this.asyncForEach(tokens, async (tokenid: string) => {
                console.log("[INFO] Checking for missing timestamps for:", tokenid);
                let timestamp = await Query.getConfirmedTxnTimestamp(tokenid);
                if (timestamp && this._tokens.has(tokenid)) {
                    let token = this._tokens.get(tokenid)!;
                    token._tokenDetails.timestamp = timestamp;
                    await this.db.tokenInsertReplace(token.toTokenDbObject());
                } else if(!this._tokens.has(tokenid)) {
                    await this.createNewTokenGraph(tokenid);
                }
            })
        }
        return tokens;
    }

    async searchForNonSlpBurnTransactions() {
        await this.asyncForEach(Array.from(this._tokens), async (a: [string, SlpTokenGraph]) => {
            await a[1].searchForNonSlpBurnTransactions();
        })
    }

    async updateTxnCollections(txid: string, tokenId?: string): Promise<void> {
        let count = 0;
        let collections = [ 'confirmed', 'unconfirmed' ];
        await this.asyncForEach(collections, async (collection: string) => {
            let tna: TNATxn | null = await this.db.db.collection(collection).findOne({ "tx.h": txid });
            if (tna) {
                count++;
                // Here we fix missing block data
                if(collection === 'confirmed' && !tna.blk) {
                    console.log("[INFO] Updating", collection, "TNATxn block data for", txid);
                    let txn = await this._rpcClient.getRawTransaction(txid, 1);
                    let block = await this._rpcClient.getBlock(txn.blockhash);
                    tna.blk = {
                        h: txn.blockhash, 
                        i: block.height, 
                        t: block.time
                    }
                    await this.db.db.collection(collection).replaceOne({ "tx.h": txid }, tna);
                }
                // Here we fix missing slp data (should only happen after block sync on startup)
                if(!tna.slp)
                    tna.slp = {} as any;
                if(tna.slp!.schema_version !== Config.db.token_schema_version) {
                    console.log("[INFO] Updating", collection, "TNATxn SLP data for", txid);
                    let isValid: boolean|null = null, details: SlpTransactionDetailsTnaDbo|null, invalidReason: string|null = null;
                    if(!tokenId) {
                        try {
                            let txhex = await this._rpcClient.getRawTransaction(tna.tx.h);
                            let bt = new bitcore.Transaction(txhex);
                            let tokenDetails = slp.parseSlpOutputScript(bt.outputs[0]._scriptBuffer);
                            if(tokenDetails.transactionType === SlpTransactionType.GENESIS || tokenDetails.transactionType === SlpTransactionType.MINT)
                                tokenId = tokenDetails.tokenIdHex;
                            else if(tokenDetails.transactionType !== SlpTransactionType.SEND)
                                tokenId = tna.tx.h;
                            else
                                throw Error("updateTxnCollections: Unknown SLP transaction type")
                        } catch(err) {
                            console.log("[ERROR] updateTxnCollections(): Failed to get tokenId");
                            console.log(err.message);
                            process.exit()
                        }
                    }
                    try {
                        let tokenGraph = this._tokens.get(tokenId!)!;
                        let keys = Object.keys(tokenGraph._slpValidator.cachedValidations);
                        if(!keys.includes(txid)) {
                            await tokenGraph._slpValidator.isValidSlpTxid(txid, tokenGraph._tokenDetails.tokenIdHex);
                        }
                        let validation = tokenGraph._slpValidator.cachedValidations[txid];                        
                        isValid = validation.validity;
                        invalidReason = validation.invalidReason;
                        let addresses: (string|null)[] = [];
                        if(isValid && validation.details!.transactionType === SlpTransactionType.SEND) {
                            addresses = tna.out.map(o => {
                                try {
                                    if(o.e!.a)
                                        return o.e!.a;
                                    else return null;
                                } catch(_) { return null; }
                            });
                        }
                        else if(isValid) {
                            try {
                                if(tna.out[1]!.e!.a)
                                    addresses = [ tna.out[1]!.e!.a ];
                                else addresses = [ null ];
                            } catch(_) { return null; }
                        }
                        if(isValid)
                            details = SlpGraphManager.MapTokenDetailsToTnaDbo(validation.details!, tokenGraph._tokenDetails, addresses);
                        else
                            details = null;
                    } catch(err) {
                        if(err.message === "Cannot read property '_slpValidator' of undefined") {
                            isValid = false;
                            details = null;
                            invalidReason = "Invalid Token Genesis";
                        } else {
                            console.log("[ERROR]", err.message);
                            process.exit();
                        }
                    }
                    if(isValid! === null) {
                        console.log("[ERROR] Validitity of " + txid + " is null.");
                        process.exit();
                    }
                    tna.slp!.valid = isValid;
                    tna.slp!.detail = details!;
                    tna.slp!.invalidReason = invalidReason;
                    tna.slp!.schema_version = Config.db.token_schema_version;
                    await this.db.db.collection(collection).replaceOne({ "tx.h": txid }, tna);
                    let test = await this.db.db.collection(collection).findOne({ "tx.h": txid }) as TNATxn;
                    if(collection === 'confirmed')
                        await this.db.db.collection('unconfirmed').deleteMany({ "tx.h": txid });
                    if(!test.slp) {
                        console.log("[ERROR] Did not update SLP object.");
                        process.exit();
                    }
                }
            }
        });
        if(count === 0) {
            let transaction = await this._rpcClient.getRawTransaction(txid, 1);
            let blockindex = (await this._rpcClient.getBlock(transaction.blockhash)).height;
            Info.updateBlockCheckpoint(blockindex - 1, null);
            console.log("[ERROR] Transaction not found! Block checkpoint has been updated to ", (blockindex - 1))
            process.exit();
        }
    }

    static MapTokenDetailsToTnaDbo(details: SlpTransactionDetails, genesisDetails: SlpTransactionDetails, addresses: (string|null)[]): SlpTransactionDetailsTnaDbo {
        var outputs: any|null = null;
        if(details.sendOutputs) {
            outputs = [];
            details.sendOutputs.forEach((o,i) => {
                if(i > 0)
                    outputs.push({ address: addresses[i], amount: Decimal128.fromString(o.dividedBy(10**genesisDetails.decimals).toFixed())})
            })
        }
        if(details.genesisOrMintQuantity) {
            outputs = [];
            outputs.push({ address: addresses[0], amount: Decimal128.fromString(details.genesisOrMintQuantity!.dividedBy(10**genesisDetails.decimals).toFixed()) })
        }
        let res: SlpTransactionDetailsTnaDbo = {
            decimals: genesisDetails.decimals,
            tokenIdHex: details.tokenIdHex,
            transactionType: details.transactionType,
            versionType: genesisDetails.versionType,
            documentUri: genesisDetails.documentUri,
            documentSha256Hex: genesisDetails.documentSha256 ? genesisDetails.documentSha256.toString('hex')! : null,
            symbol: genesisDetails.symbol,
            name: genesisDetails.name,
            txnBatonVout: details.batonVout,
            txnContainsBaton: details.containsBaton ? true : false,
            outputs: outputs
        }
        return res;
    }

    async initAllTokens(reprocessFrom?: number) {
        await Query.init();
        let tokens = await Query.queryTokensList();

        // Instantiate all Token Graphs in memory
        for (let i = 0; i < tokens.length; i++) {
            await this.initToken(tokens[i], reprocessFrom);
        }

        console.log("[INFO] Init all tokens complete");
    }

    private async initToken(token: SlpTransactionDetails, reprocessFrom?: number) {
        let graph: SlpTokenGraph;
        let throwMsg1 = "There is no db record for this token.";
        let throwMsg2 = "Outdated token graph detected for: ";
        try {
            let tokenState = <TokenDBObject>await this.db.tokenFetch(token.tokenIdHex);
            if (!tokenState)
                throw Error(throwMsg1);

            // Reprocess entire DAG if schema version is updated
            if (!tokenState.schema_version || tokenState.schema_version !== Config.db.token_schema_version) {
                throw Error(throwMsg2 + token.tokenIdHex);
            }

            // Reprocess entire DAG if reprocessFrom is before token's GENESIS
            if(reprocessFrom && reprocessFrom <= tokenState.tokenStats.block_created!) {
                throw Error(throwMsg2 + token.tokenIdHex);
            }

            console.log("########################################################################################################");
            console.log("LOAD FROM DB:", token.tokenIdHex);
            console.log("########################################################################################################");
            let utxos: UtxoDbo[] = await this.db.utxoFetch(token.tokenIdHex);
            let addresses: AddressBalancesDbo[] = await this.db.addressFetch(token.tokenIdHex);
            let dag: GraphTxnDbo[] = await this.db.graphFetch(token.tokenIdHex);
            graph = await SlpTokenGraph.FromDbObjects(tokenState, dag, utxos, addresses, this.db, this);
            
            // determine how far back the token graph should be reprocessed
            let potentialReorgFactor = 10;
            let updateFromHeight = graph._lastUpdatedBlock - potentialReorgFactor;
            if(reprocessFrom && reprocessFrom < updateFromHeight)
                updateFromHeight = reprocessFrom;
            console.log("[INFO] Checking for Graph Updates since:", updateFromHeight);
            let res = await Query.queryForRecentTokenTxns(graph._tokenDetails.tokenIdHex, updateFromHeight);
            
            // reprocess transactions
            await this.asyncForEach(res, async (txid: string) => {
                await graph.updateTokenGraphFrom(txid);
                console.log("[INFO] Updated graph from", txid);
            });
            if (res.length === 0)
                console.log("[INFO] No token transactions after block", updateFromHeight, "were found.");
            else {
                console.log("[INFO] Token's graph was updated.");
                await graph.updateStatistics();
            }
            await this.setAndSaveTokenGraph(graph);
            await this.updateTxnCollectionsForTokenId(token.tokenIdHex);
        }
        catch (err) {
            if (err.message.includes(throwMsg1) || err.message.includes(throwMsg2)) {
                await this.createNewTokenGraph(token.tokenIdHex);
            }
            else {
                console.log(err);
                process.exit();
            }
        }
    }

    private async deleteTokenFromDb(tokenId: string) {
        await this.db.tokenDelete(tokenId);
        await this.db.graphDelete(tokenId);
        await this.db.utxoDelete(tokenId);
        await this.db.addressDelete(tokenId);
    }

    private async updateTxnCollectionsForTokenId(tokenid: string) {
        console.log("[INFO] Updating confirmed/unconfirmed collections for:", tokenid);
        await this.updateTxnCollections(tokenid, tokenid);
        //let tokenTxns = await Query.queryForRecentTokenTxns(token.tokenIdHex, 0);
        if(this._tokens.has(tokenid)) {
            let tokenTxns = Array.from(this._tokens.get(tokenid)!._graphTxns.keys());
            for (let j = 0; j < tokenTxns.length; j++) {
                await this.updateTxnCollections(tokenTxns[j], tokenid);
            }
        }
    }

    private async setAndSaveTokenGraph(graph: SlpTokenGraph) {
        if(graph.IsValid) {
            let tokenId = graph._tokenDetails.tokenIdHex;
            this._tokens.set(tokenId, graph);
            await this.db.tokenInsertReplace(graph.toTokenDbObject());
            await this.db.graphInsertReplace(graph.toGraphDbObject(), tokenId);
            await this.db.utxoInsertReplace(graph.toUtxosDbObject(), tokenId);
            await this.db.addressInsertReplace(graph.toAddressesDbObject(), tokenId);
        }
    }

    private async createNewTokenGraph(tokenId: string): Promise<SlpTokenGraph|null> {
        await this.deleteTokenFromDb(tokenId);
        let graph = new SlpTokenGraph(this.db, this);
        let txn = await this._rpcClient.getRawTransaction(tokenId);
        let tokenDetails = this.parseTokenTransactionDetails(txn);
        if(tokenDetails) {
            console.log("########################################################################################################");
            console.log("NEW GRAPH FOR", tokenId);
            console.log("########################################################################################################");
            await graph.initFromScratch(tokenDetails);
            await this.setAndSaveTokenGraph(graph);
            await this.updateTxnCollectionsForTokenId(tokenId);
            return graph;
        }
        return null;
    }

    async asyncForEach(array: any[], callback: Function) {
        for (let index = 0; index < array.length; index++) {
          await callback(array[index], index, array);
        }
    }

    async publishZmqNotification(txid: string){
        if(this.zmqPubSocket) {
            let tna: TNATxn | null = await this.db.db.collection('unconfirmed').findOne({ "tx.h": txid });
            if(!tna) {
                console.log("[ZMQ-PUB] SLP mempool notification", tna);
                this.zmqPubSocket.send(['mempool', JSON.stringify(tna)]);
            }
        }
    }
}

export interface SlpTransactionDetailsTnaDbo {
    transactionType: SlpTransactionType;
    tokenIdHex: string;
    versionType: number;
    symbol: string;
    name: string;
    documentUri: string; 
    documentSha256Hex: string|null;
    decimals: number;
    txnContainsBaton: boolean;
    txnBatonVout: number|null;
    outputs: { address: string|null, amount: Decimal128|null }[]|null;
}
