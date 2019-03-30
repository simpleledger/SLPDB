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

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const RpcClient = require('bitcoin-rpc-promise');

const BITBOX = new BITBOXSDK();
const slp = new Slp(BITBOX);

export class SlpGraphManager implements IZmqSubscriber {
    db: Db;
    _rpcClient: BitcoinRpc.RpcClient;
    zmqPubSocket?: zmq.Socket;

    async onTransactionHash(syncResult: SyncCompletionInfo): Promise<void> {
        let tokensUpdate: string[] = [];
        if(syncResult) {
            let txns = Array.from(syncResult.filteredContent.get(SyncFilterTypes.SLP)!)
            await this.asyncForEach(txns, async (txPair: [string, string], index: number) =>
            {
                console.log("PROCESSING SLP GRAPH UPDATE...");
                let tokenId: string|null;
                let txn = new bitcore.Transaction(txPair[1]);
                let tokenDetails: SlpTransactionDetails|null;

                try {
                    tokenDetails = slp.parseSlpOutputScript(txn.outputs[0]._scriptBuffer);
                } catch(err) {
                    tokenDetails = null;
                }

                if(tokenDetails && tokenDetails.transactionType === SlpTransactionType.GENESIS) {
                    tokenId = txn.id;
                    tokenDetails.tokenIdHex = tokenId;
                } else if(tokenDetails) {
                    tokenId = tokenDetails.tokenIdHex;
                }

                // Based on Txn output OP_RETURN data, update graph for the tokenId 
                if(tokenDetails && tokenId!) {
                    if(!this._tokens.has(tokenId!)) {
                        console.log("ADDING NEW GRAPH FOR:", tokenId!);
                        if(tokenDetails) {
                            let graph = new SlpTokenGraph();
                            await graph.initFromScratch(tokenDetails);
                            this._tokens.set(tokenId!, graph);
                            tokensUpdate.push(tokenId!);
                        }
                        else {
                            console.log("Skipping: No token details are available for this token")
                        }
                    }
                    else {
                        console.log("UPDATING GRAPH FOR:", tokenId!);
                        await this._tokens.get(tokenId!)!.updateTokenGraphFrom(txPair[0]);
                        tokensUpdate.push(tokenId!);
                    }   
                    
                    // Update the confirmed/unconfirmed collections with token details
                    await this.updateTxnCollections(txn.id, tokenId!);
    
                    // zmq publish mempool notifications
                    if(this.zmqPubSocket) {
                        let tna: TNATxn | null = await this.db.db.collection('unconfirmed').findOne({ "tx.h": txn.id });
                        console.log("[ZMQ-PUB] SLP mempool notification", { txid: txn.id, slp: tna!.slp });
                        if(tokenDetails.transactionType === SlpTransactionType.GENESIS)
                            this.zmqPubSocket.send(['mempool-slp-genesis', JSON.stringify({ txid: txn.id, slp: tna!.slp })]);
                        else if(tokenDetails.transactionType === SlpTransactionType.SEND) 
                            this.zmqPubSocket.send(['mempool-slp-send', JSON.stringify({ txid: txn.id, slp: tna!.slp })]);
                        else if(tokenDetails.transactionType === SlpTransactionType.MINT)
                            this.zmqPubSocket.send(['mempool-slp-mint', JSON.stringify({ txid: txn.id, slp: tna!.slp })]);
                    }
                }

                // Based on the inputs, look for associated tokenIDs and update those token graphs from input txid.
                let inputTokenIds: string[] = [];
                for(let i = 0; i < txn.inputs.length; i++) {
                    let inputTokenID = await Query.queryForTxoInputSourceTokenID(txn.hash, i);
                    if(inputTokenID && inputTokenID !== tokenId! && !inputTokenIds.includes(inputTokenID)) {
                        inputTokenIds.push(inputTokenID);
                        await this._tokens.get(inputTokenID)!.updateTokenGraphFrom(txPair[0]);
                        if(!tokensUpdate.includes(inputTokenID)) {
                            console.log("[INFO] Adding token ID to be updated:", inputTokenID);
                            tokensUpdate.push(inputTokenID);
                        }
                    }
                }
            })

            // TODO: put the following code in its own processing queue?
            await this.asyncForEach(tokensUpdate, async (tokenId: string) => {
                const token = this._tokens.get(tokenId)!;

                // Update the tokens collection in db
                await token.updateStatistics();
                await this.db.tokeninsertreplace(token.toTokenDbObject());
                await this.db.addressinsertreplace(token.toAddressesDbObject());
                await this.db.graphinsertreplace(token.toGraphDbObject());
                await this.db.utxoinsertreplace(token.toUtxosDbObject());

                console.log("########################################################################################################")
                console.log("TOKEN STATS/ADDRESSES FOR", token._tokenDetails.name, token._tokenDetails.tokenIdHex)
                console.log("########################################################################################################")
                token.logTokenStats();
                token.logAddressBalances();
            });
        }
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
                console.log("No SLP transactions found in block " + hash + " .");
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
                await this.db.addressinsertreplace(token.toAddressesDbObject());
                await this.db.graphinsertreplace(token.toGraphDbObject());
                await this.db.utxoinsertreplace(token.toUtxosDbObject());

                console.log("########################################################################################################")
                console.log("TOKEN STATS/ADDRESSES FOR", token._tokenDetails.name, token._tokenDetails.tokenIdHex)
                console.log("########################################################################################################")
                token.logTokenStats();
                token.logAddressBalances();
            }

            // zmq publish block events
            for(let i = 0; i < blockTxns!.txns.length; i++) {
                //let tna: TNATxn | null = await this.db.db.collection('confirmed').findOne({ "tx.h": blockTxns.txns[i] });
                if(this.zmqPubSocket) {
                    console.log("[ZMQ-PUB] SLP block txn notification", blockTxns!.txns[i]);
                    if(blockTxns!.txns[i].slp!.detail!.transactionType === SlpTransactionType.GENESIS)
                        this.zmqPubSocket.send([ 'block-slp-genesis', JSON.stringify(blockTxns!.txns[i]) ]);
                    else if(blockTxns!.txns[i].slp!.detail!.transactionType === SlpTransactionType.SEND)
                        this.zmqPubSocket.send([ 'block-slp-send', JSON.stringify(blockTxns!.txns[i]) ]);
                    else if(blockTxns!.txns[i].slp!.detail!.transactionType === SlpTransactionType.MINT)
                        this.zmqPubSocket.send([ 'block-slp-mint', JSON.stringify(blockTxns!.txns[i]) ]);
                }
            }
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
            throw Error("Transaction not found! " + txid);
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
            let graph: SlpTokenGraph;
            let throwMsg1 = "There is no db record for this token.";
            let throwMsg2 = "Outdated token graph detected for: ";
            try {
                let tokenState = <TokenDBObject>await this.db.tokenfetch(tokens[i].tokenIdHex);
                if(!tokenState)
                    throw Error(throwMsg1);
                if(!tokenState.schema_version || tokenState.schema_version !== Config.db.schema_version) {
                    await this.db.tokendelete(tokens[i].tokenIdHex);
                    await this.db.graphdelete(tokens[i].tokenIdHex);
                    await this.db.utxodelete(tokens[i].tokenIdHex);
                    await this.db.addressdelete(tokens[i].tokenIdHex);
                    throw Error(throwMsg2 + tokens[i].tokenIdHex);
                }
                let utxos: UtxoDbo[] = await this.db.utxofetch(tokens[i].tokenIdHex);
                let addresses: AddressBalancesDbo[] = await this.db.addressfetch(tokens[i].tokenIdHex);
                let dag: GraphTxnDbo[] = await this.db.graphfetch(tokens[i].tokenIdHex);
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
                if(err.message.includes(throwMsg1) || err.message.includes(throwMsg2)) {
                    graph = new SlpTokenGraph();
                    console.log("########################################################################################################")
                    console.log("NEW GRAPH FOR", tokens[i].tokenIdHex)
                    console.log("########################################################################################################")
                    await graph.initFromScratch(tokens[i]);
                } else {
                    //console.log(err);
                    throw err;
                }
            }
            
            if(graph.IsValid()) {
                this._tokens.set(tokens[i].tokenIdHex, graph);
                await this.db.tokeninsertreplace(this._tokens.get(tokens[i].tokenIdHex)!.toTokenDbObject());
                await this.db.graphinsertreplace(this._tokens.get(tokens[i].tokenIdHex)!.toGraphDbObject());
                await this.db.utxoinsertreplace(this._tokens.get(tokens[i].tokenIdHex)!.toUtxosDbObject());
                await this.db.addressinsertreplace(this._tokens.get(tokens[i].tokenIdHex)!.toAddressesDbObject());
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
        console.log("[INFO] Init all tokens complete");
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