import { SlpTokenGraph } from "./slptokengraph";
import { TokenDBObject, GraphTxnDbo } from "./interfaces";
import { SlpTransactionType, Slp, SlpTransactionDetails, SlpVersionType } from "slpjs";
import { Bit } from "./bit";
import { Query } from "./query";
import { BITBOX } from 'bitbox-sdk';
import * as bitcore from 'bitcore-lib-cash';
import { Db } from './db';
import { Config } from "./config";
import { TNATxn } from "./tna";
import { Decimal128 } from "mongodb";
import * as zmq from 'zeromq';
import { Info } from "./info";
import * as pQueue from 'p-queue';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

import { RpcClient } from './rpc';
import { CacheSet } from "./cache";
import { SlpdbStatus } from "./status";
import { TokenFilters } from "./filters";

const bitcoin = new BITBOX();

type txhex = string;
type txid = string;

export class SlpGraphManager {
    slp = new Slp(bitcoin);
    db: Db;
    _tokens!: Map<string, SlpTokenGraph>;
    zmqPubSocket?: zmq.Socket;
    _zmqMempoolPubSetList = new CacheSet<string>(1000);
    _TnaQueue?: pQueue<pQueue.DefaultAddOptions>;
    _updatesQueue = new pQueue<pQueue.DefaultAddOptions>({ concurrency: 1, autoStart: false });
    _bestBlockHeight: number;
    _network: string;
    _startupTokenCount: number;
    _bit: Bit;
    _exit = false;
    _cacheGraphTxnCount = 0;

    get TnaSynced(): boolean {
        if (this._TnaQueue) {
            return (this._TnaQueue.size === 0 && this._TnaQueue.pending === 0)
        } else {
            return true;
        } 
    }

    async getTokenGraph({ tokenIdHex, slpMsgDetailsGenesis, forceValid, blockCreated, nft1ChildParentIdHex, txid }: { tokenIdHex: string, slpMsgDetailsGenesis?: SlpTransactionDetails, forceValid?: boolean, blockCreated?: number, nft1ChildParentIdHex?: string, txid?: string }): Promise<SlpTokenGraph|null> {

        let filter = TokenFilters();
        if (!filter.passesAllFilterRules(tokenIdHex)) {
            throw Error("Token is filtered and will not be processed, even though it's graph may be loaded.")
        }

        if (! this._tokens.has(tokenIdHex)) {

            if (!slpMsgDetailsGenesis) {
                throw Error(`Token details for a new token GENESIS must be provided (Id: ${tokenIdHex}, txid: ${txid}).`);
            }

            if (slpMsgDetailsGenesis.transactionType !== SlpTransactionType.GENESIS) {
                throw Error(`Missing token details for a non-GENESIS transaction (Id: ${tokenIdHex}, txid: ${txid}).`);
            }

            let tg = new SlpTokenGraph(slpMsgDetailsGenesis, this, blockCreated!, null);
            tg._loadInitiated = true;

            if (nft1ChildParentIdHex) {
                tg._nftParentId = nft1ChildParentIdHex;
            }

            if (!tg._nftParentId && slpMsgDetailsGenesis.versionType === SlpVersionType.TokenVersionType1_NFT_Child) {
                await tg.setNftParentId();
            }

            // If NFT child, then we need make sure the child's validation cache object is from the parent graph
            if (tg._nftParentId) {
                let ptg = await this.getTokenGraph({ tokenIdHex: tg._nftParentId });
                if (! ptg) {
                    throw Error("this should never happen");
                }
                tg._slpValidator.cachedValidations = ptg._slpValidator.cachedValidations;
            }

            if (forceValid) {
                tg._isValid = true;
            } else if (!(await tg.IsValid())) {
                return null;
            }
            this._tokens.set(tokenIdHex, tg);

        } else if (! this._tokens.get(tokenIdHex)!._lazilyLoaded && ! this._tokens.get(tokenIdHex)!._loadInitiated) {

            let tg = this._tokens.get(tokenIdHex!);

            let lastPrunedHeight = tg!._tokenDbo!._pruningState.pruneHeight;
            let checkpoint = await Info.getBlockCheckpoint();
            if (lastPrunedHeight > checkpoint.height) {
                lastPrunedHeight = checkpoint.height;
            }

            console.log(`[INFO] Lazily loading token ${tokenIdHex}`);
            let unspentDag: GraphTxnDbo[] = await this.db.graphFetch(tokenIdHex, lastPrunedHeight);
            if (! tg) {
                throw Error("This should never happen");
            }

            // set loading state
            tg._loadInitiated = true;
            tg._lazilyLoaded = true;

            // add minting baton
            tg._mintBatonUtxo = tg._tokenDbo!.mintBatonUtxo;
            tg._mintBatonStatus = tg._tokenDbo!.mintBatonStatus;

            // Map _txnGraph
            tg._graphTxns.fromDbos(
                unspentDag,
                tg._tokenDbo!._pruningState
            );

            // If NFT child, then we need make sure the child's validation cache object is from the parent graph
            if (tg._nftParentId) {
                let ptg = await this.getTokenGraph({ tokenIdHex: tg._nftParentId });
                if (! ptg) {
                    throw Error("this should never happen");
                }
                tg._slpValidator.cachedValidations = ptg._slpValidator.cachedValidations;
            }

            // preload  with cachedValidations for this tokenID
            for (let [txid, _] of tg._graphTxns) {
                let validation: any = { validity: null, details: null, invalidReason: null, parents: [], waiting: false }
                validation.validity = tg._graphTxns.get(txid) ? true : false;
                validation.details = tg._graphTxns.get(txid)!.details;
                if (!validation.details) {
                    throw Error("No saved details about transaction" + txid);
                }
                tg._slpValidator.cachedValidations[txid] = validation;
            }
    
            console.log(`[INFO] Loaded ${tg._graphTxns.size} validation cache results`);
    
            // Map _lastUpdatedBlock
            tg._lastUpdatedBlock = tg._tokenDbo!.lastUpdatedBlock;
        } else if (slpMsgDetailsGenesis && blockCreated && !this._tokens.get(tokenIdHex)!._blockCreated) {
            this._tokens.get(tokenIdHex)!._blockCreated = blockCreated;
        }
        return this._tokens.get(tokenIdHex)!;
    }

    async onTransactionHash(syncResult: Map<txid, txhex>): Promise<void> {
        let self = this;
        await this._updatesQueue.add(async function() {
            await self._onTransactionHash(syncResult);
        })
    }

    async onBlockHash(hash: string): Promise<void> {
        this._bestBlockHeight = (await Info.getBlockCheckpoint()).height;
        let self = this;
        await this._updatesQueue.add(async function() {
            await self._onBlockHash(hash);
        })
    }

    async _onTransactionHash(syncResult: Map<txid, txhex>): Promise<void> {
        if (syncResult && syncResult.size > 0) {
            for (let [txid, txnHex] of syncResult) {
                console.log("[INFO] Processing graph collection updates for:", txid);
                let tokenDetails = this.parseTokenTransactionDetails(txnHex);
                let tokenId = tokenDetails ? tokenDetails.tokenIdHex : null;

                // Based on Txn output OP_RETURN data, update graph for the tokenId 
                if (tokenId) {
                    let graph: SlpTokenGraph|null;
                    if (tokenDetails?.transactionType === SlpTransactionType.GENESIS) {
                        graph = await this.getTokenGraph({ txid, tokenIdHex: tokenId, slpMsgDetailsGenesis: tokenDetails });
                    } else {
                        try {
                            graph = await this.getTokenGraph({ txid, tokenIdHex: tokenId });
                        } catch (err) {
                            console.log(`[ERROR] Could not get graph for ${txid} at _onTransactionHash`);
                            console.log(err);
                            return;
                        }
                    }
                    
                    if (graph) {
                        graph.queueAddGraphTransaction({ txid });
                    }
                } else {
                    console.log("[INFO] Skipping: TokenId is being filtered.");
                }
            }
        }
    }


    private parseTokenTransactionDetails(txn_hex: string): SlpTransactionDetails|null {
        let txn = new bitcore.Transaction(txn_hex);

        let tokenDetails: SlpTransactionDetails|null;
        try {
            tokenDetails = this.slp.parseSlpOutputScript(txn.outputs[0]._scriptBuffer);
        }
        catch (err) {
            tokenDetails = null;
        }
        if (tokenDetails && tokenDetails.transactionType === SlpTransactionType.GENESIS) {
            tokenDetails.tokenIdHex = txn.id;
        }
        
        return tokenDetails;
    }

    async _onBlockHash(hash: string): Promise<void> {
        // NOTE: When _onBlockHash happens the block has already been crawled (in bit.ts), 
        //      and all of the transactions have already been added to the confirmed collection.
        //      the purpose of this method is to trigger updates in the graphs, addresses, utxos collections.

        while (!this.TnaSynced) {
            console.log("[INFO] At _onBlockHash() - Waiting for TNA sync to complete before we update tokens included in block.");
            await sleep(1000);
        }
        let block = await Query.getTransactionsForBlock(hash);
        if (block) {
            // update tokens collection timestamps on confirmation for Genesis transactions
            let genesisBlockTxns = await Query.getGenesisTransactionsForBlock(hash);
            if (genesisBlockTxns) {
                for (let i = 0; i < genesisBlockTxns.txns.length; i++) {
                    let token = this._tokens.get(genesisBlockTxns.txns[i]);
                    if (token) {
                        token._tokenDetails.timestamp = genesisBlockTxns.timestamp!;
                    }
                }
            }

            for (let i = 0; i < block.txns.length; i++) {
                let tokenDetails;
                try {
                    tokenDetails = this.parseTokenTransactionDetails(await RpcClient.getRawTransaction(block.txns[i]!.txid));
                } catch(err) {
                    console.log(`[ERROR] Could not get transaction ${block.txns[i]!.txid} in _onBlockHash: ${err}`);
                    continue;
                }
                let tokenId = tokenDetails ? tokenDetails.tokenIdHex : null;
                if (tokenId) {
                    let token = await this.getTokenGraph({ txid: block.txns[i]!.txid, tokenIdHex: tokenId });
                    if (token) {
                        await token.addGraphTransaction({ txid: block.txns[i]!.txid });
                    }
                }
            }

            // zmq publish block events
            if (this.zmqPubSocket && Config.zmq.outgoing.enable) {
                console.log("[ZMQ-PUB] SLP block txn notification", hash);
                this.zmqPubSocket.send([ 'block', JSON.stringify(block) ]);
                SlpdbStatus.updateTimeOutgoingBlockZmq();
            }

        }

        SlpdbStatus.updateSlpProcessedBlockHeight(this._bestBlockHeight);
    }

    constructor(db: Db, currentBestHeight: number, network: string, bit: Bit) {
        this.db = db;
        this._bestBlockHeight = currentBestHeight;
        this._network = network;
        this._tokens = new Map<string, SlpTokenGraph>();
        this._bit = bit;
        this._startupTokenCount = 0
    }

    static MapTokenDetailsToTnaDbo(details: SlpTransactionDetails, genesisDetails: SlpTransactionDetails, addresses: (string|null)[]): SlpTransactionDetailsTnaDbo {
        var outputs: any|null = null;
        if (details.sendOutputs) {
            outputs = [];
            details.sendOutputs.forEach((o,i) => {
                if (i > 0) {
                    outputs.push({ address: addresses[i], amount: Decimal128.fromString(o.dividedBy(10**genesisDetails.decimals).toFixed())});
                }
            })
        }
        if (details.genesisOrMintQuantity) {
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

    async initAllTokenGraphs() {
        let tokenDbos = await this.db.tokenFetchAll();
        if (tokenDbos) {
            let count = 0;
            for (let tokenDbo of tokenDbos) {

                if (tokenDbo.schema_version !== Config.db.token_schema_version) {
                    throw Error("DB schema does not match the current version.");
                }

                let tokenIdHex = tokenDbo.tokenDetails.tokenIdHex;

                let filter = TokenFilters();
                if (!filter.passesAllFilterRules(tokenIdHex)) {
                    throw Error("Token is filtered and will not be processed, even though it's graph may be loaded.")
                }

                let tokenDetails = SlpTokenGraph.MapDbTokenDetailsFromDbo(tokenDbo.tokenDetails, tokenDbo.tokenDetails.decimals);
                if (! tokenDetails) {
                    throw Error(`Token details for a new token GENESIS must be provided (Id: ${tokenIdHex}).`);
                }

                if (tokenDetails.transactionType !== SlpTransactionType.GENESIS) {
                    throw Error(`Missing token details for a non-GENESIS transaction (Id: ${tokenIdHex}).`);
                }

                let graph = new SlpTokenGraph(tokenDetails, this, tokenDbo.tokenStats.block_created!, tokenDbo);
                if (tokenDetails.versionType === SlpVersionType.TokenVersionType1_NFT_Child) {
                    graph._nftParentId = tokenDbo.nftParentId;
                }
                this._tokens.set(tokenDbo.tokenDetails.tokenIdHex, graph);

                console.log(`[INFO] Loaded ${tokenIdHex}.`);
                count++;
            }

            console.log(`[INFO] ${count} tokens loaded from db.`);
        }
    }

    async stop() {
        this._exit = true;
        this._updatesQueue.pause();
        this._updatesQueue.clear();
        if (this._updatesQueue.pending) {
            await this._updatesQueue.onIdle();
        }

        let unspentCount = 0;
        for (let [_, token] of this._tokens) {
            await token.stop();
            unspentCount += token.graphSize;
        }
        console.log(`[INFO] Total number of unspent graph items for all tokens: ${unspentCount}`);
    }

    async publishZmqNotificationGraphs(txid: string) {
        if (this.zmqPubSocket && !this._zmqMempoolPubSetList.has(txid) && Config.zmq.outgoing.enable) {
            this._zmqMempoolPubSetList.push(txid);
            let tna: TNATxn | null = await this.db.db.collection('unconfirmed').findOne({ "tx.h": txid });
            if (!tna) {
                tna = await this.db.db.collection('confirmed').findOne({ "tx.h": txid });
            }
            if (tna) {
                console.log("[ZMQ-PUB] SLP mempool notification", txid);
                try {
                    tna.slp?.detail?.outputs?.forEach(o => {
                        // @ts-ignore
                        o.amount = o.amount?.toString();
                    });
                } catch(_) {}
                this.zmqPubSocket.send(['mempool', JSON.stringify(tna)]);
                SlpdbStatus.updateTimeOutgoingTxnZmq();
            } else {
                console.log(`[ZMQ-PUB] Publishing failed ${txid}`);
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
