import { SlpTokenGraph } from "./slptokengraph";
import { GraphTxnDbo, GraphTxnDetailsDbo, GraphTxnOutputDbo, TokenUtxoStatus, BatonUtxoStatus, TokenDBObject as TokenDbo, TokenBatonStatus, GraphTxnInput, GraphTxnOutput, GraphTxn, SlpTransactionDetailsDbo } from "./interfaces";
import { Decimal128 } from "mongodb";
import { Config } from "./config";
import { RpcClient } from "./rpc";
import { SlpTransactionType, SlpTransactionDetails, SlpVersionType } from "slpjs";
import BigNumber from "bignumber.js";

import { slpUtxos } from './utxos';
const globalUtxoSet = slpUtxos();

export class GraphMap extends Map<string, GraphTxn> {
    private pruned = new Map<string, GraphTxn>();
    private dirtyItems = new Set<string>();
    private doubleSpent = new Set<string>();
    private _rootId: string;
    private _container: SlpTokenGraph;
    private _prunedSendCount = 0;
    private _graphSendCount = 0;
    private _prunedMintCount = 0;
    private _graphMintCount = 0;
    private _prunedMintQuantity = new BigNumber(0);
    private _graphMintQuantity = new BigNumber(0);
    // private _prunedValidBurnQuantity = new BigNumber(0);
    // private _graphValidBurnQuantity = new BigNumber(0);

    constructor(graph: SlpTokenGraph) {
        super();
        this._rootId = graph._tokenIdHex;
        this._container = graph;
    }

    get DirtyCount() {
        return this.dirtyItems.size;
    }

    get SendCount() {
        return this._prunedSendCount + this._graphSendCount;
    }

    get MintCount() {
        return this._prunedMintCount + this._graphMintCount;
    }

    get TotalSupplyMinted() {
        return this._prunedMintQuantity.plus(this._graphMintQuantity).plus(this._container._tokenDetails.genesisOrMintQuantity!);
    }

    get TotalTransactionCount() {
        return this.SendCount + this.MintCount;
    }

    private _incrementGraphCount(graphTxn: GraphTxn) {
        let txnType = graphTxn.details.transactionType;
        if (txnType === SlpTransactionType.SEND) {
            this._graphSendCount++;
        } else if (txnType === SlpTransactionType.MINT) {
            this._graphMintCount++;
            this._graphMintQuantity.plus(graphTxn.details.genesisOrMintQuantity!);
        }
    }

    public setFromDb(txid: string, graphTxn: GraphTxn) {
        if (!this.has(txid)) {
            this._incrementGraphCount(graphTxn);
        }
        return super.set(txid, graphTxn);
    }

    public set(txid: string, graphTxn: GraphTxn) {
        this.SetDirty(txid);
        if (!this.has(txid)) {
            this._incrementGraphCount(graphTxn);
        }
        return super.set(txid, graphTxn);
    }

    public SetDirty(txid: string) {
        this.dirtyItems.add(txid);
    }

    private _decrementGraphCount(graphTxn: GraphTxn) {
        let txnType = graphTxn.details.transactionType;
        if (txnType === SlpTransactionType.SEND) {
            this._graphSendCount--;
        } else if (txnType === SlpTransactionType.MINT) {
            this._graphMintCount--;
            this._graphMintQuantity.minus(graphTxn.details.genesisOrMintQuantity!);
        }
    }

    public delete(txid: string) {
        if (this.has(txid)) {
            let graphTxn = this.get(txid);
            let deleted = super.delete(txid);
            if (deleted) {
                this._decrementGraphCount(graphTxn!);
                return true;
            }
        }
        return false;
    }

    public deleteDoubleSpend(txid: string) {
        this.doubleSpent.add(txid);
        return this.delete(txid);
    }

    public has(txid: string, includePrunedItems=false): boolean {
        if(includePrunedItems) {
            return super.has(txid) || this.pruned.has(txid);
        }
        return super.has(txid);
    }

    public get(txid: string, includePrunedItems=false): GraphTxn|undefined {
        if(includePrunedItems) {
            return super.get(txid) || this.pruned.get(txid);
        }
        return super.get(txid);
    }

    private prune(txid: string, pruneHeight: number) {
        if (this.has(txid) && txid !== this._rootId) {
            let gt = this.get(txid)!;
            if (!gt.prevPruneHeight || pruneHeight >= gt.prevPruneHeight) {
                this.pruned.set(txid, gt);
                this.delete(txid);
                console.log(`[INFO] Pruned ${txid} with prune height of ${pruneHeight}`);
                if (gt.details.transactionType === SlpTransactionType.SEND) {
                    this._prunedSendCount++;
                } else if (gt.details.transactionType === SlpTransactionType.MINT) {
                    this._prunedMintCount++;
                    this._prunedMintQuantity.plus(gt.outputs.find(o => o.vout === 1)!.slpAmount);
                }
                return true;
            } else if (pruneHeight < gt.prevPruneHeight) {
                console.log(`[INFO] Pruning deferred until ${gt.prevPruneHeight}`);
            }
        }
        return false;
    }

    private _flush() {
        const txids = Array.from(this.pruned.keys());
        this.pruned.forEach((i, txid) => {
            RpcClient.transactionCache.delete(txid);
            delete this._container._slpValidator.cachedRawTransactions[txid];
            delete this._container._slpValidator.cachedValidations[txid];
        });
        this.doubleSpent.clear();
        this.pruned.clear();
        this.dirtyItems.clear();
        return txids;
    }

    public static toDbos(graph: GraphMap): { itemsToUpdate: GraphTxnDbo[], tokenDbo: TokenDbo, itemsToDelete: string[] } {
        let tg = graph._container;
        let itemsToUpdate: GraphTxnDbo[] = [];

        graph.dirtyItems.forEach(txid => {
            let g = graph.get(txid)!;
            let dbo: GraphTxnDbo = {
                tokenDetails: { tokenIdHex: graph._container._tokenIdHex },
                graphTxn: {
                    txid,
                    details: GraphMap._mapTokenDetailsToDbo(g.details, tg._tokenDetails.decimals),
                    outputs: GraphMap._txnOutputsToDbo(tg, g.outputs),
                    inputs: g.inputs.map((i) => {
                        return {
                            address: i.address,
                            txid: i.txid,
                            vout: i.vout,
                            bchSatoshis: i.bchSatoshis,
                            slpAmount: Decimal128.fromString(i.slpAmount.dividedBy(10**tg._tokenDetails.decimals).toFixed())
                        }
                    }),
                    blockHash: g.blockHash,
                    pruneHeight: g.prevPruneHeight
                }
            };
            itemsToUpdate.push(dbo);
        });

        let itemsToDelete = Array.from(graph.doubleSpent);
        
        // Do the pruning here
        itemsToUpdate.forEach(dbo => { if (dbo.graphTxn.pruneHeight) graph.prune(dbo.graphTxn.txid, dbo.graphTxn.pruneHeight)});
        // canBePruned means it can still be pruned later (caused by totally spent transactions which are unaged)
        graph._flush();
        let tokenDbo = GraphMap._mapTokenToDbo(graph);
        return { itemsToUpdate, tokenDbo, itemsToDelete };
    }

    public fromDbos(dag: GraphTxnDbo[], prunedSendCount: number, prunedMintCount: number, prunedMintQuantity: BigNumber) {
        dag.forEach((item, idx) => {
            let gt = GraphMap.mapGraphTxnFromDbo(item, this._container._tokenDetails.decimals);
            gt.outputs.forEach(o => {
                globalUtxoSet.set(`${item.graphTxn.txid}:${o.vout}`, Buffer.from(this._rootId, "hex"));
            });
            this.setFromDb(item.graphTxn.txid, gt);
        });

        this._prunedSendCount = prunedSendCount;
        this._prunedMintCount = prunedMintCount;
        this._prunedMintQuantity = prunedMintQuantity;
    }

    private static _mapTokenToDbo(graph: GraphMap): TokenDbo {
        let tg = graph._container;
        let tokenDetails = GraphMap._mapTokenDetailsToDbo(tg._tokenDetails, tg._tokenDetails.decimals);

        //let stats = graph.ComputeStatistics();

        let result: TokenDbo = {
            schema_version: Config.db.token_schema_version,
            lastUpdatedBlock: tg._lastUpdatedBlock,
            tokenDetails: tokenDetails,
            mintBatonUtxo: tg._mintBatonUtxo,
            mintBatonStatus: tg._mintBatonStatus,
            tokenStats: {
                block_created: tg._blockCreated,       //tg.block_created,
                block_last_active_send: null,          //tg.block_last_active_send,
                block_last_active_mint: null,          //tg.block_last_active_mint,
                qty_valid_txns_since_genesis: graph.SendCount,
                qty_valid_token_utxos: null,           //stats.utxoCount,
                qty_valid_token_addresses: null,       //stats.addressCount,
                qty_token_minted: Decimal128.fromString(graph.TotalSupplyMinted.dividedBy(10**tg._tokenDetails.decimals).toFixed()),
                qty_token_burned: null,                //Decimal128.fromString(graph.BurnQuantity.dividedBy(10**graph._tokenDetails.decimals).toFixed()),
                qty_token_circulating_supply: null,    //Decimal128.fromString(stats..dividedBy(10**tg._tokenDetails.decimals).toFixed()),
                qty_satoshis_locked_up: null,          //stats.qty_satoshis_locked_up,
            },
            pruningState: {
                sendCount: graph._prunedSendCount,
                mintCount: graph._prunedMintCount,
                mintQuantity: Decimal128.fromString(graph._prunedMintQuantity.toFixed())
            }
        }
        if (tg._tokenDetails.versionType === SlpVersionType.TokenVersionType1_NFT_Child) {
            if (!tg._nftParentId) {
                throw Error("Missing NFT1 parent token Id.");
            }
            result.nftParentId = tg._nftParentId;
        }
        return result;
    }

    private static _txnOutputsToDbo(tokenGraph: SlpTokenGraph, outputs: GraphTxnOutput[]): GraphTxnOutputDbo[] {
        let mapped: GraphTxnDetailsDbo["outputs"] = [];
        outputs.forEach(o => {
                let m = Object.create(o);
                //console.log(m);
                try {
                    m.slpAmount = Decimal128.fromString(m.slpAmount.dividedBy(10**tokenGraph._tokenDetails.decimals).toFixed());
                } catch(_) {
                    m.slpAmount = Decimal128.fromString("0");
                }
                mapped.push(m);
        })
        return mapped;
    }

    public static mapGraphTxnFromDbo(dbo: GraphTxnDbo, decimals: number): GraphTxn {
        dbo.graphTxn.outputs.map(o => {
            o.slpAmount = <any>new BigNumber(o.slpAmount.toString()).multipliedBy(10**decimals)
        });
        dbo.graphTxn.inputs.map(o => o.slpAmount = <any>new BigNumber(o.slpAmount.toString()).multipliedBy(10**decimals))
        let gt: GraphTxn = {
            details: SlpTokenGraph.MapDbTokenDetailsFromDbo(dbo.graphTxn.details, decimals),
            outputs: dbo.graphTxn.outputs as any as GraphTxnOutput[],
            inputs: dbo.graphTxn.inputs as any as GraphTxnInput[],
            blockHash: dbo.graphTxn.blockHash, 
            prevPruneHeight: dbo.graphTxn.pruneHeight
        }
        return gt;
    }

    private static _mapTokenDetailsToDbo(details: SlpTransactionDetails, decimals: number): SlpTransactionDetailsDbo {
        let res: SlpTransactionDetailsDbo = {
            decimals: details.decimals,
            tokenIdHex: details.tokenIdHex,
            timestamp: details.timestamp ? details.timestamp : null,
            timestamp_unix: details.timestamp ? this.ConvertToUnixTime(details.timestamp) : null,
            transactionType: details.transactionType,
            versionType: details.versionType,
            documentUri: details.documentUri,
            documentSha256Hex: details.documentSha256 ? details.documentSha256.toString('hex') : null,
            symbol: details.symbol,
            name: details.name,
            batonVout: details.batonVout,
            containsBaton: details.containsBaton ? true : false,
            genesisOrMintQuantity: details.genesisOrMintQuantity ? Decimal128.fromString(details.genesisOrMintQuantity!.dividedBy(10**decimals).toFixed()) : null,
            sendOutputs: details.sendOutputs ? details.sendOutputs.map(o => Decimal128.fromString(o.dividedBy(10**decimals).toFixed())) : null
        }

        return res;
    }

    private static ConvertToUnixTime(Y_m_d_H_M_S: string): number|null {
        // timestamp is formatted as "%Y-%m-%d %H:%M:%S"
        if(Y_m_d_H_M_S) {
            let d = Y_m_d_H_M_S.split(" ")[0] + "T" + Y_m_d_H_M_S.split(" ")[1] + "Z";
            return Date.parse(d)/1000;
        }
        return null;
    }

    // NOTE: this code block is too inefficient to be running in SLPDB
    // public ComputeUtxosAndAddresses() {
    //     let txns = Array.from(this.values());
    //     let outputs = txns.flatMap(txn => txn.outputs);
    //     let utxos = outputs.filter(o => o.status === TokenUtxoStatus.UNSPENT);
    //     let flags: { [key:string]: boolean } = {};
    //     let addresses = utxos.filter(txo => {
    //         if (flags[txo.address]) {
    //             return false;
    //         }
    //         flags[txo.address] = true;
    //         return true;
    //     }).map(o => o.address);

    //     return {
    //         txns,
    //         outputs,
    //         utxos,
    //         addresses
    //     };
    // }

    // NOTE: this code block is too inefficient to be running in SLPDB
    // private ComputeStatistics(): GraphStats {
    //     let flattened = this.ComputeUtxosAndAddresses();
    //     let txns = flattened.txns;
    //     let mints = txns.filter(txn => txn.details.transactionType === SlpTransactionType.MINT);
    //     let mintQuantity = mints.map(txn => txn.outputs
    //                             .find(o => o.vout === 1)!.slpAmount)
    //                             .reduce((p: BigNumber, c:BigNumber) => p.plus(c), this._prunedMintQuantity);
    //     let mintStatus = mints.flatMap(o => o.outputs)
    //                           .filter(o => o.status === BatonUtxoStatus.BATON_UNSPENT)
    //                           .length > 0 ? TokenBatonStatus.ALIVE : TokenBatonStatus.DEAD_ENDED;
    //     let canBePruned = flattened.outputs
    //                                     .filter(o => [ 
    //                                         TokenUtxoStatus.UNSPENT, 
    //                                         BatonUtxoStatus.BATON_UNSPENT 
    //                                     ].includes(o.status)).length < this.size;
    //     return {
    //         raw: flattened, 
    //         mintQuantity,
    //         utxoCount: flattened.utxos.length,
    //         addressCount: flattened.addresses.length, 
    //         mintStatus,
    //         canBePruned
    //     }
    // }

}

interface GraphStats {
    raw: any; 
    mintQuantity: BigNumber;
    utxoCount: number;
    addressCount: number;
    mintStatus: TokenBatonStatus;
    canBePruned: boolean;
}