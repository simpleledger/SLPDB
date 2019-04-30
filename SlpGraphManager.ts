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

    async onTransactionHash(syncResult: SyncCompletionInfo): Promise<void> {
        if(syncResult) {
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
                        console.log("ADDING NEW GRAPH FOR:", tokenId);
                        if(tokenDetails) {
                            let graph = new SlpTokenGraph(this.db, this);
                            await graph.initFromScratch(tokenDetails);
                            this._tokens.set(tokenId, graph);
                        }
                        else {
                            console.log("Skipping: No token details are available for this token")
                        }
                    }
                    else {
                        console.log("UPDATING GRAPH FOR:", tokenId);
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
                        console.log("[INFO] SLP txn input:", i,"does not need updated for txid:", txPair[0]);
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

        // Wait until the txn count is greater than 0 
        let retries = 0;
        let count = 0;
        let blockTxns: { txns: { txid: string, slp: TNATxnSlpDetails }[], timestamp: string|null }|null; 
        // TODO: Need to test if this while statement is needed.
        while(count === 0 && retries < 5) {
            await sleep(1000);
            blockTxns = await Query.getTransactionsForBlock(hash);
            try {
                count = blockTxns!.txns.length;
            } catch(_){ }
            if(retries > 5) {
                console.log("[INFO] No SLP transactions found in block " + hash + " .");
                return;
            }
            retries++;
        }

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
                await this.db.tokeninsertreplace(token.toTokenDbObject());
                await this.db.addressinsertreplace(token.toAddressesDbObject(), token._tokenDetails.tokenIdHex);
                await this.db.graphinsertreplace(token.toGraphDbObject(), token._tokenDetails.tokenIdHex);
                await this.db.utxoinsertreplace(token.toUtxosDbObject(), token._tokenDetails.tokenIdHex);

                console.log("########################################################################################################")
                console.log("TOKEN STATS/ADDRESSES FOR", token._tokenDetails.name, token._tokenDetails.tokenIdHex)
                console.log("########################################################################################################")
                token.logTokenStats();
                token.logAddressBalances();
            }

            // zmq publish block events
            if(this.zmqPubSocket) {
                console.log("[ZMQ-PUB] SLP block txn notification", hash);
                this.zmqPubSocket.send([ 'block', JSON.stringify(blockTxns) ]);
            }

            // fix any missed token timestamps 
            await this.fixMissingTokenTimestamps();
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
            this.asyncForEach(tokens, async (tokenid: string) => {
                console.log("[INFO] Checking for missing timestamps for:", tokenid);
                let timestamp = await Query.getConfirmedTxnTimestamp(tokenid);
                if (timestamp) {
                    let token = this._tokens.get(tokenid)!;
                    token._tokenDetails.timestamp = timestamp;
                    await this.db.tokeninsertreplace(token.toTokenDbObject());
                } else if(!this._tokens.has(tokenid)) {
                    await this.createNewTokenGraph(tokenid);
                }
                if(this._tokens.has(tokenid)) {
                    await this.updateTxnCollectionsForTokenId(tokenid);
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
                // Here we fix missing slp data
                if(!tna.slp)
                    tna.slp = {} as any;
                if(tna.slp!.schema_version !== Config.db.schema_version) {
                    console.log("[INFO] Updating", collection, "TNATxn SLP data for", txid);
                    let isValid: boolean|null, details: SlpTransactionDetailsTnaDbo|null, invalidReason: string|null;
                    if(!tokenId) {
                        try {
                            let txhex = await this._rpcClient.getRawTransaction(tna.tx.h);
                            let tokenDetails = (slp.parseSlpOutputScript(Buffer.from(txhex, 'hex')));
                            if(tokenDetails.transactionType === SlpTransactionType.GENESIS || tokenDetails.transactionType === SlpTransactionType.MINT)
                                tokenId = tokenDetails.tokenIdHex;
                            else if(tokenDetails.transactionType !== SlpTransactionType.SEND)
                                tokenId = tna.tx.h;
                            else
                                throw Error("updateTxnCollections: Unknown SLP transaction type")
                        } catch(err) {
                            console.log("[ERROR] updateTxnCollections(): Failed to get tokenId");
                            throw Error(err.message);
                        }
                    }
                    let tokenGraph = this._tokens.get(tokenId!)!;
                    try {
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
                                    if(o.e!.a && Utils.isCashAddress(o.e!.a))
                                        return Utils.toSlpAddress(o.e!.a); 
                                    else return null;
                                } catch(_) { return null; }
                            });
                        }
                        else if(isValid) {
                            try {
                                if(tna.out[1]!.e!.a && Utils.isCashAddress(tna.out[1]!.e!.a))
                                    addresses = [ Utils.toSlpAddress(tna.out[1]!.e!.a) ];
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
                            throw err;
                        }
                    }
                    if(isValid === null)
                        throw Error("Validitity of " + txid + " is null.");
                    tna.slp!.valid = isValid;
                    tna.slp!.detail = details!;
                    tna.slp!.invalidReason = invalidReason;
                    tna.slp!.schema_version = Config.db.schema_version;
                    await this.db.db.collection(collection).replaceOne({ "tx.h": txid }, tna);
                    let test = await this.db.db.collection(collection).findOne({ "tx.h": txid }) as TNATxn;
                    if(collection === 'confirmed')
                        await this.db.db.collection('unconfirmed').deleteMany({ "tx.h": txid });
                    if(!test.slp)
                        throw Error("Did not update SLP object.");
                }
            }
        });
        if(count === 0) {
            let transaction = await this._rpcClient.getRawTransaction(txid, 1);
            let blockindex = (await this._rpcClient.getBlock(transaction.blockhash)).height;
            Info.updateBlockCheckpoint(blockindex - 1, null);
            console.log("[ERROR] Transaction not found! Block checkpoint has been updated to ", (blockindex - 1))
            throw Error();
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

    async initAllTokens() {
        await Query.init();
        let tokens = await Query.queryTokensList();

        // Instantiate all Token Graphs in memory
        for (let i = 0; i < tokens.length; i++) {
            await this.initToken(tokens[i]);
        }

        console.log("[INFO] Init all tokens complete");
    }

    private async initToken(token: SlpTransactionDetails) {
        let graph: SlpTokenGraph;
        let throwMsg1 = "There is no db record for this token.";
        let throwMsg2 = "Outdated token graph detected for: ";
        try {
            let tokenState = <TokenDBObject>await this.db.tokenfetch(token.tokenIdHex);
            if (!tokenState)
                throw Error(throwMsg1);
            if (!tokenState.schema_version || tokenState.schema_version !== Config.db.schema_version) {
                await this.db.tokendelete(token.tokenIdHex);
                await this.db.graphdelete(token.tokenIdHex);
                await this.db.utxodelete(token.tokenIdHex);
                await this.db.addressdelete(token.tokenIdHex);
                throw Error(throwMsg2 + token.tokenIdHex);
            }
            console.log("########################################################################################################");
            console.log("LOAD FROM DB:", token.tokenIdHex);
            console.log("########################################################################################################");
            let utxos: UtxoDbo[] = await this.db.utxofetch(token.tokenIdHex);
            let addresses: AddressBalancesDbo[] = await this.db.addressfetch(token.tokenIdHex);
            let dag: GraphTxnDbo[] = await this.db.graphfetch(token.tokenIdHex);
            graph = await SlpTokenGraph.FromDbObjects(tokenState, dag, utxos, addresses, this.db, this);
            this._tokens.set(graph._tokenDetails.tokenIdHex, graph);
            let potentialReorgFactor = 10;
            let updateFromHeight = graph._lastUpdatedBlock - potentialReorgFactor;
            console.log("[INFO] Checking for Graph Updates since token's last update at (height - " + potentialReorgFactor + "):", updateFromHeight);
            let res = await Query.queryForRecentTokenTxns(graph._tokenDetails.tokenIdHex, updateFromHeight);
            // TODO?: Pre-load validation results into the tokenGraph's local validator.
            await this.asyncForEach(res, async (txid: string) => {
                await graph.updateTokenGraphFrom(txid);
                console.log("[INFO] Updated graph from", txid);
            });
            if (res.length === 0)
                console.log("[INFO] No token transactions after block", updateFromHeight, "were found.");
            else {
                console.log("[INFO] Token's graph was updated.");
                await this.setAndSaveTokenGraph(graph);
            }
        }
        catch (err) {
            if (err.message.includes(throwMsg1) || err.message.includes(throwMsg2)) {
                await this.createNewTokenGraph(token.tokenIdHex);
            }
            else {
                throw err;
            }
        }

        // Update each entry in confirmed/unconfirmed collections with SLP info
        await this.updateTxnCollectionsForTokenId(token.tokenIdHex);
    }

    private async updateTxnCollectionsForTokenId(tokenid: string) {
        console.log("[INFO] Updating txn collections for:", tokenid);
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
            await this.db.tokeninsertreplace(this._tokens.get(tokenId)!.toTokenDbObject());
            await this.db.graphinsertreplace(this._tokens.get(tokenId)!.toGraphDbObject(), tokenId);
            await this.db.utxoinsertreplace(this._tokens.get(tokenId)!.toUtxosDbObject(), tokenId);
            await this.db.addressinsertreplace(this._tokens.get(tokenId)!.toAddressesDbObject(), tokenId);
        }
    }

    private async createNewTokenGraph(tokenId: string): Promise<SlpTokenGraph|null> {
        let graph = new SlpTokenGraph(this.db, this);
        let txn = await this._rpcClient.getRawTransaction(tokenId);
        let tokenDetails = this.parseTokenTransactionDetails(txn);
        if(tokenDetails) {
            console.log("########################################################################################################");
            console.log("NEW GRAPH FOR", tokenId);
            console.log("########################################################################################################");
            await graph.initFromScratch(tokenDetails);
            await this.setAndSaveTokenGraph(graph);
            return graph;
        }
        return null;
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
    symbol: string;
    name: string;
    documentUri: string; 
    documentSha256Hex: string|null;
    decimals: number;
    txnContainsBaton: boolean;
    txnBatonVout: number|null;
    outputs: { address: string|null, amount: Decimal128|null }[]|null;
}
