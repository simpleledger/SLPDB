import { SlpTransactionDetails, SlpTransactionType, LocalValidator, Utils, Slp, SlpVersionType, Primatives  } from 'slpjs';
import BigNumber from 'bignumber.js';
import { BITBOX } from 'bitbox-sdk';
import { Config } from './config';
import * as bitcore from 'bitcore-lib-cash';
import { SendTxnQueryResult, Query } from './query';
import { Decimal128 } from 'mongodb';
import { Db } from './db';
import { RpcClient } from './rpc';
import * as pQueue from 'p-queue';
import { DefaultAddOptions } from 'p-queue';
import { SlpGraphManager } from './slpgraphmanager';
import { CacheMap } from './cache';
import { SlpdbStatus, SlpdbState } from './status';
import { TokenDBObject, AddressBalancesDbo, UtxoDbo, GraphTxnDbo, 
    SlpTransactionDetailsDbo, TokenUtxoStatus, TokenStats, cashAddr, 
    BatonUtxoStatus, TokenBatonStatus } from './interfaces';
import { GraphMap } from './graphmap';

let cashaddr = require('cashaddrjs-slp');

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const bitbox = new BITBOX();
const slp = new Slp(bitbox);

export class SlpTokenGraph {

    GetTokenStats() {
        if (!this._tokenStats) {
            this._tokenStats = <TokenStats> {
                block_created: this._blockCreated ? this._blockCreated : null,
                block_last_active_mint: null,
                block_last_active_send: null,
                qty_valid_txns_since_genesis: 0,
                qty_valid_token_utxos: 0,
                qty_valid_token_addresses: 0,
                qty_token_minted: new BigNumber(0),
                qty_token_burned: new BigNumber(0),
                qty_token_circulating_supply: new BigNumber(0),
                qty_satoshis_locked_up: 0,
                minting_baton_status: TokenBatonStatus.UNKNOWN
            }
        }
        return this._tokenStats;
    }

    _tokenIdHex: string;
    _lastUpdatedBlock!: number;
    _tokenDetails: SlpTransactionDetails;
    _blockCreated: number|null;
    private _tokenStats!: TokenStats;
    _tokenUtxos = new Set<string>();
    _mintBatonUtxo = "";
    _nftParentId?: string;
    _graphTxns: GraphMap;
    _isGraphTotallyPruned = false;
    _addresses = new Map<cashAddr, AddressBalance>();
    _slpValidator = new LocalValidator(bitbox, async (txids) => {
        if (this._manager._bit.doubleSpendCache.has(txids[0])) {
            return [ Buffer.alloc(60).toString('hex') ];
        }
        let txn;
        try {
            txn = <string>await RpcClient.getRawTransaction(txids[0]);
        } catch(err) {
            console.log(`[ERROR] Could not get transaction ${txids[0]} in local validator: ${err}`);
            return [ Buffer.alloc(60).toString('hex') ];
        }
        return [ txn ];
    }, console);
    _network: string;
    _db: Db;
    _graphUpdateQueue: pQueue<DefaultAddOptions> = new pQueue({ concurrency: 1, autoStart: true });
    _graphUpdateQueueOnIdle?: ((self: this) => Promise<void>) | null;
    _graphUpdateQueueNewTxids = new Set<string>();
    _manager: SlpGraphManager;
    _startupTxoSendCache?: CacheMap<string, SpentTxos>;
    _loadInitiated = false;
    _updateComplete = true;
    _isValid?: boolean;

    constructor(tokenDetails: SlpTransactionDetails, db: Db, manager: SlpGraphManager, network: string, blockCreated: number|null) {
        this._tokenDetails = tokenDetails;
        this._tokenIdHex = tokenDetails.tokenIdHex;
        this._graphTxns = new GraphMap(this);
        this._db = db;
        this._manager = manager;
        this._network = network;
        this._blockCreated =  blockCreated;
    }

    async validateTxid(txid: string) {
        let isValid = await this._slpValidator.isValidSlpTxid(txid, this._tokenIdHex);
        return isValid;
    }

    // async initFromScratch({ processUpToBlock }: { tokenDetails: SlpTransactionDetails, processUpToBlock?: number; }) {
    //     this._loadInitiated = true;

    //     this._lastUpdatedBlock = 0;

    //     this._startupTxoSendCache = await Query.getTxoInputSlpSendCache(this._tokenIdHex);
    //     console.log(`[INFO] (initFromScratch) Updating graph from ${this._tokenDetails.tokenIdHex}`)
    //     let valid = await this.addGraphTransaction({ txid: this._tokenDetails.tokenIdHex, processUpToBlock: processUpToBlock });
    //     if (valid) {
    //         if (this._tokenDetails.versionType === SlpVersionType.TokenVersionType1_NFT_Child) {
    //             await this.setNftParentId();
    //         } else {
    //             let mints = await Query.getMintTransactions(this._tokenDetails.tokenIdHex);
    //             if (mints && mints.length > 0) {
    //                 for (let m of mints) {
    //                     console.log(`[INFO] (initFromScratch minting branch) Updating graph from ${m.txid!}`);
    //                     await this.addGraphTransaction({ txid: m.txid!, processUpToBlock: processUpToBlock });
    //                 }
    //             }
    //         }

    //         // set genesis block hash
    //         let genesisBlockHash = await RpcClient.getTransactionBlockHash(this._tokenDetails.tokenIdHex);
    //         if (genesisBlockHash) {
    //             this._graphTxns.get(this._tokenDetails.tokenIdHex)!.blockHash = Buffer.from(genesisBlockHash, 'hex');
    //         }

    //         this.UpdateStatistics();
    //     }
    //     this._startupTxoSendCache.clear();
    //     this._startupTxoSendCache = undefined;
    //     this._slpValidator.cachedRawTransactions = {};
    //     return valid;
    // }

    async stop() {
        console.log(`[INFO] Stopping token graph ${this._tokenIdHex}, with ${this._graphTxns.size} loaded.`);

        if (this._graphUpdateQueue.pending || this._graphUpdateQueue.size) {
            console.log(`[INFO] Waiting on ${this._graphUpdateQueue.size} queue items.`);
            await this._graphUpdateQueue.onIdle();
            this._graphUpdateQueue.pause();
            console.log(`[INFO] Graph update queue is idle and cleared with ${this._graphUpdateQueue.size} items and ${this._graphUpdateQueue.pending} pending.`);
        }

        let dirtyCount = this._graphTxns.dirtyItems().length;
        console.log(`[INFO] On stop there are ${dirtyCount} dirty items.`);
        if (dirtyCount > 0) {
            this.UpdateStatistics();
        }

        while (this._graphUpdateQueueOnIdle !== undefined || !this._updateComplete) {
            console.log(`Waiting for UpdateStatistics to finish for ${this._tokenIdHex}`);
            await sleep(500);
        }
        console.log(`[INFO] Stopped token graph ${this._tokenIdHex}`);
    }

    private async setNftParentId() {
        let txnhex = (await this._slpValidator.getRawTransactions([this._tokenDetails.tokenIdHex]))[0];
        let tx = Primatives.Transaction.parseFromBuffer(Buffer.from(txnhex, 'hex'));
        let nftBurnTxnHex = (await this._slpValidator.getRawTransactions([tx.inputs[0].previousTxHash]))[0];
        let nftBurnTxn = Primatives.Transaction.parseFromBuffer(Buffer.from(nftBurnTxnHex, 'hex'));
        let nftBurnSlp = slp.parseSlpOutputScript(Buffer.from(nftBurnTxn.outputs[0].scriptPubKey));
        if (nftBurnSlp.transactionType === SlpTransactionType.GENESIS) {
            this._nftParentId = tx.inputs[0].previousTxHash;
        }
        else {
            this._nftParentId = nftBurnSlp.tokenIdHex;
        }
    }

    async IsValid(): Promise<boolean> {
        if (this._isValid || this._isValid === false) {
            return this._isValid;
        }
        this._isValid = await this._slpValidator.isValidSlpTxid(this._tokenIdHex);
        return this._isValid;
    }

    get IsLoaded(): boolean {
        return this._graphTxns.size > 0;
    }

    // async _updateUtxos(txid: string) {
    //     let txnHex = (await this._slpValidator.getRawTransactions([txid]))[0];
    //     let txn = Primatives.Transaction.parseFromBuffer(Buffer.from(txnHex, 'hex'));
    //     let validation = this._slpValidator.cachedValidations[txid];
    //     if(validation.validity && this._graphTxns.has(txid)) {
    //         if(validation!.details!.transactionType === SlpTransactionType.SEND) {
    //             txn.inputs.forEach(txo => {
    //                 if(this._tokenUtxos.delete(`${txo.previousTxHash}:${txo.previousTxOutIndex}`)) {
    //                     console.log(`[INFO] Token UTXO deleted: ${txo.previousTxHash}:${txo.previousTxOutIndex}`);
    //                 }
    //             });
    //             this._graphTxns.get(txid)!.outputs.forEach(o => {
    //                 if(!this._tokenUtxos.has(txid + ":" + o.vout) && 
    //                     o.status !== TokenUtxoStatus.EXCESS_INPUT_BURNED &&
    //                     o.status !== TokenUtxoStatus.MISSING_BCH_VOUT &&
    //                     o.status !== TokenUtxoStatus.SPENT_INVALID_SLP &&
    //                     o.status !== TokenUtxoStatus.SPENT_NON_SLP &&
    //                     o.status !== TokenUtxoStatus.SPENT_NOT_IN_SEND &&
    //                     o.status !== TokenUtxoStatus.SPENT_WRONG_TOKEN
    //                 ){
    //                     console.log(`[INFO] Token UTXO added: ${txid}:${o.vout}`);
    //                     this._tokenUtxos.add(txid + ":" + o.vout);
    //                 }
    //             });
    //         }
    //         else if(validation!.details!.transactionType === SlpTransactionType.MINT) {
    //             console.log(`[INFO] Token UTXO added: ${txid}:1`);
    //             this._tokenUtxos.add(txid + ":" + 1);
    //             txn.inputs.forEach(txo => {
    //                 if(this._mintBatonUtxo === txo.previousTxHash + ':' + txo.previousTxOutIndex) {
    //                     let baton = validation.details!.batonVout;
    //                     let out = this._graphTxns.get(txid)!.outputs.find(o => o.vout === baton);
    //                     if(baton &&
    //                         out!.status !== BatonUtxoStatus.BATON_MISSING_BCH_VOUT &&
    //                         out!.status !== BatonUtxoStatus.BATON_SPENT_INVALID_SLP &&
    //                         out!.status !== BatonUtxoStatus.BATON_SPENT_NON_SLP &&
    //                         out!.status !== BatonUtxoStatus.BATON_SPENT_NOT_IN_MINT
    //                     ){
    //                         this._mintBatonUtxo = txid + ':' + baton;
    //                         console.log(`[INFO] Mint baton replaced: ${txid}:${baton}`);
    //                     } else {
    //                         this._mintBatonUtxo = '';
    //                         console.log(`[INFO] Mint baton ended: ${txo.previousTxHash}:${txo.previousTxOutIndex}`);
    //                     }
    //                 }
    //             });
    //         }
    //         else if(validation!.details!.transactionType === SlpTransactionType.GENESIS) {
    //             if(!this._tokenUtxos.has(txid + ":" + 1)) {
    //                 console.log(`[INFO] Token UTXO added: ${txid}:1`);
    //                 this._tokenUtxos.add(txid + ":" + 1);
    //             }

    //             let baton = validation!.details!.batonVout;
    //             if(baton && this._mintBatonUtxo !== txid + ':' + baton) {
    //                 this._mintBatonUtxo = txid + ':' + baton;
    //                 console.log(`[INFO] Mint baton created: ${txid}:${baton}`);
    //             }
    //         }
    //         else {
    //             throw Error("Unknown transction type");
    //         }
    //     }
    // }

    async getMintBatonSpendDetails({ txid, vout, txnOutputLength, processUpTo }: { txid: string; vout: number; txnOutputLength: number|null; processUpTo?: number }): Promise<MintSpendDetails> {
        let spendTxnInfo: SendTxnQueryResult | {txid: string, block: number|null} | undefined
        if (this._startupTxoSendCache) {
            spendTxnInfo = this._startupTxoSendCache.get(txid + ":" + vout);
            if(spendTxnInfo) {
                console.log("[INFO] Used _startupTxoSendCache data", txid, vout);
            }
        }
        if (!spendTxnInfo) {
            spendTxnInfo = this._manager._bit._spentTxoCache.get(txid + ":" + vout); //this._liveTxoSpendCache.get(txid + ":" + vout);
            if(spendTxnInfo) {
                console.log("[INFO] Used bit._spentTxoCache data", txid, vout);
            }
        }
        // This is a backup to prevent bad data, it should rarely be used and should be removed in the future
        if (!spendTxnInfo) {
            let res = await Query.queryForTxoInputAsSlpMint(txid, vout);
            if (res) {
                spendTxnInfo = { txid: res.txid!, block: res.block };
            }
        }
        if (spendTxnInfo) {
            try {
                if  (processUpTo && (!spendTxnInfo.block || spendTxnInfo.block > processUpTo)) {
                    return { status: BatonUtxoStatus.BATON_UNSPENT, txid: null, invalidReason: null };
                }
                if (typeof spendTxnInfo!.txid === 'string') {
                    let valid = await this._slpValidator.isValidSlpTxid(spendTxnInfo.txid!, this._tokenDetails.tokenIdHex);
                    if (!this._slpValidator.cachedValidations[spendTxnInfo.txid!]) {
                        console.log('SLP Validator is missing transaction', spendTxnInfo.txid, 'for token', this._tokenDetails.tokenIdHex)
                    }
                    if (valid && this._slpValidator.cachedValidations[spendTxnInfo.txid!] && this._slpValidator.cachedValidations[spendTxnInfo.txid!].details!.transactionType === SlpTransactionType.MINT) {
                        return { status: BatonUtxoStatus.BATON_SPENT_IN_MINT, txid: spendTxnInfo!.txid, invalidReason: null };
                    }
                    else if (valid) {
                        this._mintBatonUtxo = '';
                        return { status: BatonUtxoStatus.BATON_SPENT_NOT_IN_MINT, txid: spendTxnInfo!.txid, invalidReason: "Baton was spent in a non-mint SLP transaction." };
                    }
                    this._mintBatonUtxo = '';
                    return { status: BatonUtxoStatus.BATON_SPENT_NON_SLP, txid: spendTxnInfo!.txid, invalidReason: null };
                }
            } catch(_) {
                this._mintBatonUtxo = '';
                if (vout < txnOutputLength!) {
                    return { status: BatonUtxoStatus.BATON_SPENT_INVALID_SLP, txid: null, invalidReason: this._slpValidator.cachedValidations[txid].invalidReason };
                }
                return { status: BatonUtxoStatus.BATON_MISSING_BCH_VOUT, txid: null, invalidReason: "SLP output has no corresponding BCH output." };
            }
        }
        //this._mintBatonUtxo = txid + ":" + vout;
        return { status: BatonUtxoStatus.BATON_UNSPENT, txid: null, invalidReason: null };
    }

    async getSpendDetails({ txid, vout, txnOutputLength, processUpTo }: { txid: string; vout: number; txnOutputLength: number|null; processUpTo?: number; }): Promise<SpendDetails> {
        let spendTxnInfo: SendTxnQueryResult | {txid: string, block: number|null} | undefined
        if (this._startupTxoSendCache) {
            spendTxnInfo = this._startupTxoSendCache.get(txid + ":" + vout);
            if (spendTxnInfo) {
                console.log("[INFO] Used _startupTxoSendCache data", txid, vout);
            }
        }
        if (!spendTxnInfo) {
            spendTxnInfo = this._manager._bit._spentTxoCache.get(txid + ":" + vout); //this._liveTxoSpendCache.get(txid + ":" + vout);
            if (spendTxnInfo) {
                console.log("[INFO] Used bit._spentTxoCache spend data", txid, vout);
            }
        }
        // NOTE: This is a backup to prevent bad data, it should rarely be used and should be removed in the future
        if (!spendTxnInfo) {
            let res = await Query.queryForTxoInputAsSlpSend(txid, vout);
            if (res) {
                console.log(`[DEBUG] OUTPUT INFO ADDED: ${txid}:${vout} -> ${res.txid}`);
                spendTxnInfo = { txid: res.txid!, block: res.block };
            }
        }
        if (spendTxnInfo) {
            try {
                if (processUpTo && (!spendTxnInfo.block || spendTxnInfo.block > processUpTo)) {
                    return { status: TokenUtxoStatus.UNSPENT, txid: null, invalidReason: null };
                }
                if (typeof spendTxnInfo!.txid === 'string') {
                    let valid = await this._slpValidator.isValidSlpTxid(spendTxnInfo.txid!, this._tokenDetails.tokenIdHex);
                    if (!this._slpValidator.cachedValidations[spendTxnInfo.txid!]) {
                        console.log('SLP Validator is missing transaction', spendTxnInfo.txid, 'for token', this._tokenDetails.tokenIdHex)
                    }
                    if (valid && this._slpValidator.cachedValidations[spendTxnInfo.txid!] && this._slpValidator.cachedValidations[spendTxnInfo.txid!].details!.transactionType === SlpTransactionType.SEND) {
                        return { status: TokenUtxoStatus.SPENT_SAME_TOKEN, txid: spendTxnInfo!.txid, invalidReason: null };
                    }
                    else if (valid) {
                        this._tokenUtxos.delete(txid + ":" + vout);
                        return { status: TokenUtxoStatus.SPENT_NOT_IN_SEND, txid: spendTxnInfo!.txid, invalidReason: null };
                    }
                    this._tokenUtxos.delete(txid + ":" + vout);
                    return { status: TokenUtxoStatus.SPENT_INVALID_SLP, txid: spendTxnInfo!.txid, invalidReason: this._slpValidator.cachedValidations[txid].invalidReason };
                }
            } catch(_) {
                this._tokenUtxos.delete(txid + ":" + vout);
                if (vout < txnOutputLength!) {
                    return { status: TokenUtxoStatus.SPENT_INVALID_SLP, txid: null, invalidReason: this._slpValidator.cachedValidations[txid].invalidReason };
                }
                return { status: TokenUtxoStatus.MISSING_BCH_VOUT, txid: null, invalidReason: "SLP output has no corresponding BCH output." };
            }
        }
        return { status: TokenUtxoStatus.UNSPENT, txid: null, invalidReason: null };
    }

    async queueAddGraphTransaction({ txid, processUpToBlock }: { txid: string, processUpToBlock?: number; }): Promise<void> {
        let self = this;

        while (this._loadInitiated && !this.IsLoaded) {
            console.log(`Waiting for token ${this._tokenIdHex} to finish loading...`);
            await sleep(250);
        }

        if (!this._loadInitiated && !this.IsLoaded) {
            this._loadInitiated = true;
            return this._graphUpdateQueue.add(async () => {
                console.log(`[INFO] (queueTokenGraphUpdateFrom) Initiating graph for ${txid}`);
                await self.addGraphTransaction({ txid, processUpToBlock });
                await self._db.graphItemsUpsert(self);

                // console.log("[INFO] UpdateStatistics: queueTokenGraphUpdateFrom");
                // self.UpdateStatistics(txid);
            });
        } else {
            return this._graphUpdateQueue.add(async () => {
                console.log(`[INFO] (queueTokenGraphUpdateFrom) Updating graph from ${txid}`);
                await self.addGraphTransaction({ txid, processUpToBlock });

                // // Update token's statistics
                // if(self._graphUpdateQueue.size === 0 && self._graphUpdateQueue.pending === 1) {
                //     // if block then we should check for double-spends for all graph txns with null blockHash
                //     if(blockHash) {
                //         let txnsWithNoBlock = Array.from(self._graphTxns).filter(i => !i[1].blockHash);
                //         let mempool = await RpcClient.getRawMemPool();
                //         for (let i of txnsWithNoBlock) {
                //             let txid = i[0];
                //             if(!mempool.includes(txid)) {
                //                 try {
                //                     await RpcClient.getRawTransaction(txid);
                //                 } catch(err) {
                //                     console.log(`[ERROR] Could not get transaction ${txid} in queueTokenGraphUpdateFrom: ${err}`)
                //                     self._graphTxns.delete(txid);
                //                     delete self._slpValidator.cachedRawTransactions[txid];
                //                     delete self._slpValidator.cachedValidations[txid];
                //                     //self._liveTxoSpendCache.clear();
                //                 }
                //             }
                //         }
                //     }
                //     //self._liveTxoSpendCache.clear();
                //     console.log("[INFO] UpdateStatistics: queueTokenGraphUpdateFrom");
                //     self.UpdateStatistics(txid);
                // }
            });
        }
    }

    async addGraphTransaction({ txid, processUpToBlock, blockHash }: { txid: string; processUpToBlock?: number; blockHash?: Buffer; }): Promise<boolean|null> {

        if (this._graphTxns.has(txid)) {
            let gt = this._graphTxns.get(txid)!;
            if (!gt.blockHash && blockHash) {
                gt.blockHash = blockHash;
                gt.isDirty = true;
            }
            return true;
        }

        let isValid = await this._slpValidator.isValidSlpTxid(txid, this._tokenDetails.tokenIdHex);
        let txnSlpDetails = this._slpValidator.cachedValidations[txid].details;
        let txn: bitcore.Transaction = new bitcore.Transaction(await this._slpValidator.retrieveRawTransaction(txid));

        if (!isValid) {
            console.log("[WARN] updateTokenGraphFrom: Not valid token transaction:", txid);
            return false;
        }

        if (!txnSlpDetails) {
            console.log("[WARN] updateTokenGraphFrom: No token details for:", txid);
            return false;
        }

        let graphTxn: GraphTxn = { 
            details: txnSlpDetails, 
            outputs: [], 
            inputs: [], 
            blockHash: blockHash ? blockHash : null, 
            isDirty: true 
        };

        console.log(`[INFO] Unprunned txn count: ${this._graphTxns.size}`);

        // Update parent items (their output statuses) and add contributing SLP inputs
        if (txid !== this._tokenIdHex) {
            let visited = new Set<string>();
            for (let i of txn.inputs) {
                let previd = i.prevTxId.toString('hex');

                let valid;
                if (!this._slpValidator.cachedValidations[previd]) {
                    console.log(`Should be invalid SLP: ${previd} for token id: ${this._tokenIdHex}`);
                    valid = await this._slpValidator.isValidSlpTxid(previd, this._tokenDetails.tokenIdHex);
                    if (!valid) {
                        continue;
                    }
                }

                valid = this._slpValidator.cachedValidations[previd].validity;

                if (this._graphTxns.has(previd)) {
                    let ptxn = this._graphTxns.get(previd)!;
                    ptxn.isDirty = true;
                    // update the parent's output items
                    console.log("[INFO] updateTokenGraphFrom: update the status of the input txns' outputs");
                    if (!visited.has(previd)) {
                        visited.add(previd);
                        //await this.updateTokenGraphAt({ txid: previd, isParentInfo: {  }, processUpToBlock });
                        let gtos = ptxn!.outputs;
                        let prevOutpoints = txn.inputs.filter(i => i.prevTxId.toString('hex') === previd).map(i => i.outputIndex);
                        for (let vout of prevOutpoints) {
                            let spendInfo: SpendDetails|MintSpendDetails;
                            if ([SlpTransactionType.GENESIS, SlpTransactionType.MINT].includes(ptxn!.details.transactionType) &&
                                ptxn.details.batonVout === vout) {
                                    spendInfo = await this.getMintBatonSpendDetails({ txid: previd, vout, txnOutputLength: null, processUpTo: processUpToBlock });
                            } else {
                                spendInfo = await this.getSpendDetails({ txid: previd, vout, txnOutputLength: null, processUpTo: processUpToBlock });
                            }
                            let o = gtos.find(o => o.vout === vout);
                            if (o) {
                                o.spendTxid = txid;
                                o.status = spendInfo.status;
                                o.invalidReason = spendInfo.invalidReason;
                            }
                        }
                    }

                    // add the current input item to the current graphTxn object
                    let inputTxn = this._graphTxns.get(previd)!;
                    let o = inputTxn.outputs.find(o => o.vout === i.outputIndex);
                    if (o) {
                        graphTxn.inputs.push({
                            txid: i.prevTxId.toString('hex'),
                            vout: i.outputIndex,
                            slpAmount: o.slpAmount,
                            address: o.address,
                            bchSatoshis: o.bchSatoshis
                        });
                        graphTxn.isDirty = true;
                    }
                } else if (valid) {
                    //
                    // NOTE: This branch should only happen in one of the following situations:
                    //          1) a new graph txn is spending non-SLP inputs from a pruned txn, OR
                    //          2) a valid NFT1 child is spending a non-SLP output from a valid NFT1 parent
                    //
                    // NOTE: A graph in SLPDB is an individual dag with 1 Genesis, whereas in slp-validate the validator for an NFT Child dag
                    //       will also cache validity data for the NFT group dag.  This is why #2 in the list above occurs.
                    //
                    if (!visited.has(previd)) {
                        visited.add(previd);
                        let res = await this._db.graphTxnFetch(previd);
                        if (!res) {
                            // NOTE: Since situation #2 (with the NFT1 parent) may not yet have this specific graph item commited to db, so let's 
                            //       parse the txn details and check token type !== NFT1_PARENT before we throw.
                            let prevTxHex = await RpcClient.getRawTransaction(previd);
                            let prevTx = new bitcore.Transaction(prevTxHex);
                            let prevTxSlpMessage = slp.parseSlpOutputScript(prevTx.outputs[0]._scriptBuffer);
                            if (this._tokenDetails.versionType === SlpVersionType.TokenVersionType1_NFT_Child &&
                                prevTxSlpMessage.versionType === SlpVersionType.TokenVersionType1_NFT_Parent) {
                                continue;
                            }
                            throw Error(`Graph txid ${previd} was not found, this should never happen.`);
                        } else {
                            let gt = SlpTokenGraph.MapGraphTxnFromDbo(res, this._tokenDetails.decimals, this._network);
                            let unspentCount = gt.outputs.filter(o => [TokenUtxoStatus.UNSPENT, BatonUtxoStatus.BATON_UNSPENT].includes(o.status)).length
                            if (gt.details.tokenIdHex === this._tokenIdHex &&
                                unspentCount > 0) {
                                throw Error(`Graph txid ${previd} was loaded from db with unspent outputs, this should never happen.`);
                            }
                            continue;
                        }
                    }
                }
            }
        }

        // Create or update SLP graph outputs for each valid SLP output
        if (graphTxn.details.transactionType === SlpTransactionType.GENESIS || graphTxn.details.transactionType === SlpTransactionType.MINT) {
            if (graphTxn.details.genesisOrMintQuantity!.isGreaterThanOrEqualTo(0)) {
                //let spendDetails = await this.getSpendDetails({ txid, vout: 1, txnOutputLength: txn.outputs.length, processUpTo: processUpToBlock });
                let address = this.getAddressStringFromTxnOutput(txn, 1);
                graphTxn.outputs.push({
                    address: address,
                    vout: 1,
                    bchSatoshis: txn.outputs.length > 1 ? txn.outputs[1].satoshis : 0, 
                    slpAmount: <any>graphTxn.details.genesisOrMintQuantity!,
                    spendTxid: null,                    //spendDetails.txid,
                    status: TokenUtxoStatus.UNSPENT,    //spendDetails.status,
                    invalidReason: null                 //spendDetails.invalidReason
                });
                if(txnSlpDetails.batonVout) {
                    //let mintSpendDetails = await this.getMintBatonSpendDetails({ txid, vout: txnSlpDetails.batonVout, txnOutputLength: txn.outputs.length, processUpTo: processUpToBlock });
                    let address = this.getAddressStringFromTxnOutput(txn, 1);
                    graphTxn.outputs.push({
                        address: address,
                        vout: txnSlpDetails.batonVout,
                        bchSatoshis: txnSlpDetails.batonVout < txn.outputs.length ? txn.outputs[txnSlpDetails.batonVout].satoshis : 0, 
                        slpAmount: new BigNumber(0),
                        spendTxid: null,                        //mintSpendDetails.txid,
                        status: BatonUtxoStatus.BATON_UNSPENT,  //mintSpendDetails.status,
                        invalidReason: null                     //mintSpendDetails.invalidReason
                    });
                }
            }
        }
        else if(graphTxn.details.sendOutputs!.length > 0) {
            let slp_vout = 0;
            for (let output of graphTxn.details.sendOutputs!) {
                if(output.isGreaterThanOrEqualTo(0)) {
                    if (slp_vout > 0) {
                        //let spendDetails = await this.getSpendDetails({ txid, vout: slp_vout, txnOutputLength: txn.outputs.length, processUpTo: processUpToBlock });
                        let address = this.getAddressStringFromTxnOutput(txn, slp_vout);
                        graphTxn.outputs.push({
                            address: address,
                            vout: slp_vout,
                            bchSatoshis: slp_vout < txn.outputs.length ? txn.outputs[slp_vout].satoshis : 0, 
                            slpAmount: graphTxn.details.sendOutputs![slp_vout],
                            spendTxid: null,                    //spendDetails.txid,
                            status: TokenUtxoStatus.UNSPENT,    //spendDetails.status,
                            invalidReason: null                 //spendDetails.invalidReason
                        });
                    }
                }
                slp_vout++;
            }
        }
        else {
            console.log("[WARNING]: Transaction is not valid or is unknown token type!", txid);
        }

        // check for possible inputs burned due to outputs < inputs
        if (SlpTransactionType.GENESIS !== graphTxn.details.transactionType) {
            let outputQty = graphTxn.outputs.reduce((a, c) => a.plus(c.slpAmount), new BigNumber(0));
            let inputQty = graphTxn.inputs.reduce((a, c) => a.plus(c.slpAmount), new BigNumber(0));
            if (outputQty.isGreaterThan(inputQty) && SlpTransactionType.MINT !== graphTxn.details.transactionType) {
                throw Error("Graph item cannot have inputs less than outputs.");
            }
            if (inputQty.isGreaterThan(outputQty)) {
                graphTxn.outputs.push(<any>{
                    slpAmount: inputQty.minus(outputQty),
                    status: TokenUtxoStatus.EXCESS_INPUT_BURNED
                });
            }
        }

        if(!processUpToBlock) {
            this._lastUpdatedBlock = this._manager._bestBlockHeight; //await this._rpcClient.getBlockCount();
        } else {
            this._lastUpdatedBlock = processUpToBlock;
        }

        this._graphTxns.set(txid, graphTxn);

        return true;
    }

    // private deleteAllChildren(txid: string, deleteSelf=false) {
    //     let toDelete = new Set<string>();
    //     let self = this;
    //     let getChildTxids = function(txid: string) {
    //         let n = self._graphTxns.get(txid)!;
    //         if(n) {
    //             n.outputs.forEach((o, i) => { 
    //                 if(o.spendTxid && !toDelete.has(o.spendTxid)) {
    //                     toDelete.add(o.spendTxid);
    //                     getChildTxids(o.spendTxid);
    //                 }
    //             });
    //             n.outputs = [];
    //             //n.isComplete = false;
    //         }
    //     }
    //     getChildTxids(txid);
    //     if(deleteSelf) {
    //         toDelete.add(txid);
    //     }
    //     toDelete.forEach(txid => {
    //         // must find any graphTxn with an output spendTxid equal to txid
    //         this._graphTxns.get(txid)!.inputs.forEach((v, i) => {
    //             if(this._graphTxns.has(v.)) {
    //                 let g = this._graphTxns.get(v.txid)!;
    //                 let output = g.outputs.find(o => o.vout === v.vout);
    //                 output!.spendTxid = null;
    //                 output!.status = TokenUtxoStatus.UNSPENT;
    //                 this._tokenUtxos.add(`${txid}:${v.vout}`);
    //             }
    //         });
    //         this._graphTxns.delete(txid);
    //         delete this._slpValidator.cachedRawTransactions[txid];
    //         delete this._slpValidator.cachedValidations[txid];
    //     });
    //     this._tokenUtxos.forEach(txo => {
    //         let txid = txo.split(':')[0];
    //         if(toDelete.has(txid)) {
    //             this._tokenUtxos.delete(txo);
    //         }
    //     });
    // }

    private getAddressStringFromTxnOutput(txn: bitcore.Transaction, outputIndex: number) {
        let address;
        try {
            address = Utils.toSlpAddress(bitbox.Address.fromOutputScript(txn.outputs[outputIndex]._scriptBuffer, this._network));
        }
        catch (_) {
            try {
                address = 'scriptPubKey:' + txn.outputs[outputIndex]._scriptBuffer.toString('hex');
            }
            catch (_) {
                address = 'Missing transaction output.';
            }
        }
        return address;
    }

    // async updateAddressesFromScratch(): Promise<void> {
    //     this._addresses.clear();

    //     for (let utxo of this._tokenUtxos) {
    //         let txid = utxo.split(':')[0];
    //         let vout = parseInt(utxo.split(':')[1]);

    //         let txout: GraphTxnOutput|undefined;
    //         try {
    //             if (this._graphTxns.has(txid)) {
    //                 txout = this._graphTxns.get(txid)!.outputs.find(o => vout === o.vout);
    //             } else {
    //                 throw Error("This should never happen");
    //             }
    //         } catch(_) {
    //             console.log(`[INFO] (updateAddressesFromScratch) Update graph from ${txid}`);
    //             //await this.updateTokenGraphAt({ txid });
    //             if (!this._tokenUtxos.has(utxo)) {
    //                 return
    //             }
    //             if (!this._graphTxns.has(txid)) {
    //                 this._tokenUtxos.delete(utxo);
    //                 return
    //             }
    //             txout = this._graphTxns.get(txid)!.outputs.find(o => vout === o.vout);
    //         }
            
    //         if (txout) {
    //             let graph = this._graphTxns.get(txid)!
    //             let txnDetails = graph.details;
    //             let addr = txout.address;
    //             let bal;
    //             if (graph.outputs[vout-1].status !== TokenUtxoStatus.UNSPENT && graph.outputs[vout-1].status !== BatonUtxoStatus.BATON_UNSPENT) {
    //                 console.log(graph.outputs);
    //                 console.log(`[INFO] TXO is not unspent (deleting from token UTXO set): ${txid}:${vout}`);
    //                 this._tokenUtxos.delete(utxo);
    //                 return;
    //             }
    //             if (this._addresses.has(addr)) {
    //                 bal = this._addresses.get(addr)!
    //                 bal.satoshis_balance+=txout.bchSatoshis
    //                 if (txnDetails.transactionType === SlpTransactionType.SEND) {
    //                     bal.token_balance = bal.token_balance.plus(txnDetails.sendOutputs![vout])
    //                 }
    //                 else if (vout === 1) {
    //                     bal.token_balance = bal.token_balance.plus(txnDetails.genesisOrMintQuantity!)
    //                 }
    //             }
    //             else {
    //                 if (txnDetails.transactionType === SlpTransactionType.SEND) {
    //                     bal = { satoshis_balance: txout.bchSatoshis, token_balance: txnDetails.sendOutputs![vout] }
    //                 }
    //                 else if (vout === 1) {
    //                     bal = { satoshis_balance: txout.bchSatoshis, token_balance: txnDetails.genesisOrMintQuantity! }
    //                 }
    //             }

    //             if (bal && bal.token_balance.isGreaterThan(0)) {
    //                 this._addresses.set(addr, <any>bal);
    //             }
    //         }
    //     }
    // }

    async getTotalMintQuantity(): Promise<BigNumber> {
        let qty = this._tokenDetails.genesisOrMintQuantity;
        if(!qty)
            throw Error("Cannot have Genesis without quantity.");
        this._graphTxns.forEach(t => {
            if(t.details.transactionType === SlpTransactionType.MINT)
                qty = qty!.plus(t.details.genesisOrMintQuantity!)
        })
        return qty;
    }

    getTotalHeldByAddresses(): BigNumber {
        let qty = new BigNumber(0);
        this._addresses.forEach(a => qty = qty.plus(a.token_balance))
        return qty;
    }

    getTotalSatoshisLockedUp(): number {
        let qty = 0;
        this._addresses.forEach(a => qty+=a.satoshis_balance);
        return Math.round(qty);
    }

    async getBatonStatus(): Promise<TokenBatonStatus> {
        if(!this._tokenDetails.containsBaton)
            return TokenBatonStatus.NEVER_CREATED;
        else if(this._tokenDetails.containsBaton === true) {
            if(this._mintBatonUtxo.includes(this._tokenDetails.tokenIdHex + ":" + this._tokenDetails.batonVout))
                return TokenBatonStatus.ALIVE;
            let mintTxids = Array.from(this._graphTxns).filter(o => o[1].details.transactionType === SlpTransactionType.MINT).map(o => o[0]);
            let mints = mintTxids.map(i => this._slpValidator.cachedValidations[i])
            if(mints) {
                for(let i = 0; i < mints!.length; i++) {
                    let valid = mints[i].validity;
                    let vout = mints[i].details!.batonVout;
                    if(valid && vout && this._mintBatonUtxo.includes(mintTxids[i] + ":" + vout))
                        return TokenBatonStatus.ALIVE;
                    if(valid && !vout)
                        return TokenBatonStatus.DEAD_ENDED;
                }
            }
        }
        return TokenBatonStatus.DEAD_BURNED;
    }

    // async searchForNonSlpBurnTransactions(): Promise<void> {
    //     for (let txo of this._tokenUtxos) {
    //         await this.updateTxoIfSpent(txo)
    //     }
    //     if(this._mintBatonUtxo !== "") {
    //         await this.updateTxoIfSpent(this._mintBatonUtxo);
    //     }
    // }

    // async updateTxoIfSpent(txo: string) {
    //     let txid = txo.split(":")[0];
    //     let vout = parseInt(txo.split(":")[1]);
    //     let txout = null;
    //     try {
    //         txout = await RpcClient.getTxOut(txid, vout);
    //     } catch(_) { }
    //     if (!txout) {
    //         // check for a double spent transaction
    //         let txn;
    //         try {
    //             txn = await RpcClient.getRawTransaction(txid);
    //         } catch(err) {
    //             console.log(`[ERROR] Could not get transaction ${txid} in updateTxoIfSpent: ${err}`);
    //         }
    //         if (txn) {
    //             console.log(`[INFO] (updateTxoIfSpent) Updating graph from ${txo}`);
    //             await this.addGraphTransaction({ txid }); //isParent: true });
    //         } else {
    //             let gt = this._graphTxns.get(txid);
    //             if (gt) {
    //                 this._slpValidator.cachedValidations[txid].validity = false;
    //                 for (let i = 0; i < gt.inputs.length; i++) {
    //                     let igt = this._graphTxns.get(gt.inputs[i].txid)
    //                     if (igt) {
    //                         igt.outputs = [];
    //                     }
    //                     console.log(`[INFO] (updateTxoIfSpent) Updating graph from ${gt.inputs[i].txid}`);
    //                     await this.addGraphTransaction({ txid: gt.inputs[i].txid }); // isParent: true });
    //                 }
    //                 console.log(`[INFO] updateTxoIfSpent(): Removing unknown transaction from token graph ${txo}`);
    //                 let outlength = gt.outputs.length;
    //                 this._graphTxns.delete(txid);
    //                 for (let i = 0; i < outlength; i++) {
    //                     let txo = txid + ":" + vout;
    //                     let deleted = this._tokenUtxos.delete(txo);
    //                     if (deleted) {
    //                         console.log(`[INFO] updateTxoIfSpent(): Removing utxo for unknown transaction ${txo}`);
    //                     }
    //                 }
    //             }
    //         }
    //     }
    // }

    // async _checkGraphBlockHashes() {
    //     // update blockHash for each graph item.
    //     if(this._startupTxoSendCache) {
    //         let blockHashes = new Map<string, Buffer|null>();
    //         this._startupTxoSendCache.toMap().forEach((i, k) => {
    //             blockHashes.set(i.txid, i.blockHash);
    //         });
    //         blockHashes.forEach((v, k) => {
    //             if(this._graphTxns.has(k)) {
    //                 this._graphTxns.get(k)!.blockHash = v;
    //             }
    //         });
    //     }
    //     let count = 0;
    //     for(const [txid, txn] of this._graphTxns) {
    //         if(this._graphTxns.has(txid) &&
    //             !this._graphTxns.get(txid)!.blockHash && 
    //             !this._manager._bit.slpMempool.has(txid))
    //         {
    //             let hash: string;
    //             console.log("[INFO] Querying block hash for graph transaction", txid);
    //             try {
    //                 if (this._manager._bit.doubleSpendCache.has(txid)) {
    //                     this._graphTxns.delete(txid);
    //                     continue;
    //                 }
    //                 hash = await RpcClient.getTransactionBlockHash(txid);
    //                 console.log(`[INFO] Block hash: ${hash} for ${txid}`);
    //                 // add delay to prevent flooding rpc
    //                 if(count++ > 1000) {
    //                     await sleep(1000);
    //                     count = 0;
    //                 }
    //             } catch(_) {
    //                 console.log("[INFO] Removing unknown transaction", txid);
    //                 this._graphTxns.delete(txid);
    //                 continue;
    //             }
    //             if(hash) {
    //                 console.log("[INFO] Updating block hash for", txid);
    //                 this._graphTxns.get(txid)!.blockHash = Buffer.from(hash, 'hex');
    //             } else if (this._manager._bit.slpMempool.has(txid)) {
    //                 continue;
    //             } else {
    //                 console.log("[INFO] Making sure transaction is in BCH mempool.");
    //                 let mempool = await RpcClient.getRawMemPool();
    //                 if (mempool.includes(txid)) {
    //                     continue;
    //                 }
    //                 throw Error(`Unknown error occured in setting blockhash for ${txid})`);
    //             }
    //         }
    //     }

    //     // TODO: remove temporary paranoia
    //     for(const [txid, txn] of this._graphTxns) {
    //         if(!this._graphTxns.get(txid)!.blockHash &&
    //            !this._manager._bit.slpMempool.has(txid)) {
    //             if(SlpdbStatus.state === SlpdbState.RUNNING) {
    //                 throw Error(`No blockhash for ${txid}`);
    //             }
    //             else {
    //                 console.log('[INFO] Allowing missing block hash during startup or deleted conditions.');
    //             }
    //         }
    //     }
    // }

    async UpdateStatistics(zmqTxid?: string): Promise<void> {
        if (zmqTxid) {
            this._graphUpdateQueueNewTxids.add(zmqTxid);
        }
        if (!this._graphUpdateQueueOnIdle) {
            this._updateComplete = false;
            this._graphUpdateQueueOnIdle = async (self: SlpTokenGraph) => {
                self._graphUpdateQueue.pause();
                await self._graphUpdateQueue.onIdle();
                let txidToUpdate = Array.from(self._graphUpdateQueueNewTxids);
                self._graphUpdateQueueNewTxids.clear();
                self._graphUpdateQueueOnIdle = null;
                this._updateComplete = false;
                await self._updateStatistics(true);
                while (txidToUpdate.length > 0) {
                    await self._manager.publishZmqNotificationGraphs(txidToUpdate.pop()!);
                }
                self._graphUpdateQueueOnIdle = undefined;
                self._graphUpdateQueue.start();
                return;
            }
            return this._graphUpdateQueueOnIdle(this); // Do not await this
        }
        return;
    }

    private _buildUtxosFromGraph() {
        //this._tokenUtxos
    }

    async _updateStatistics(saveToDb=true): Promise<void> {
        if (this._isValid === false) {
            return;
        }
        this._updateComplete = false;
        //this._buildUtxosFromGraph();
        //await this.updateAddressesFromScratch();
        //await this._checkGraphBlockHashes();
        let block_created = await Query.queryTokenGenesisBlock(this._tokenDetails.tokenIdHex);
        let block_last_active_mint = await Query.blockLastMinted(this._tokenDetails.tokenIdHex);
        let block_last_active_send = await Query.blockLastSent(this._tokenDetails.tokenIdHex);
        let qty_token_minted = await this.getTotalMintQuantity();
        let minting_baton_status = await this.getBatonStatus();

        this._tokenStats = <TokenStats> {
            block_created: block_created,
            block_last_active_mint: block_last_active_mint,
            block_last_active_send: block_last_active_send,
            qty_valid_txns_since_genesis: this._graphTxns.size,
            qty_valid_token_utxos: this._tokenUtxos.size,
            qty_valid_token_addresses: this._addresses.size,
            qty_token_minted: qty_token_minted,
            qty_token_burned: new BigNumber(0),
            qty_token_circulating_supply: this.getTotalHeldByAddresses(),
            qty_satoshis_locked_up: this.getTotalSatoshisLockedUp(),
            minting_baton_status: minting_baton_status
        }
        this._tokenStats.qty_token_burned = this._tokenStats.qty_token_minted.minus(this._tokenStats.qty_token_circulating_supply)

        if(this._tokenStats.qty_token_circulating_supply.isGreaterThan(this._tokenStats.qty_token_minted)) {
            console.log("[ERROR] Cannot have circulating supply larger than total minted quantity.");
            //console.log("[INFO] Statistics will be recomputed after update queue is cleared.");
            // TODO: handle this condition gracefully.
        }

        if(!this._tokenStats.qty_token_circulating_supply.isEqualTo(this._tokenStats.qty_token_minted.minus(this._tokenStats.qty_token_burned))) {
            console.log("[WARN] Circulating supply minus burn quantity does not equal minted quantity");
            //console.log("[INFO] Statistics will be recomputed after update queue is cleared.");
            // TODO: handle this condition gracefully.
        }

        if(saveToDb) {
            await this._db.graphItemsUpsert(this);
            await this._db.addressInsertReplace(this.toAddressesDbObject(), this._tokenDetails.tokenIdHex);
            await this._db.utxoInsertReplace(this.toUtxosDbObject(), this._tokenDetails.tokenIdHex);
        }

        console.log("########################################################################################################")
        console.log("TOKEN STATS/ADDRESSES FOR", this._tokenDetails.name, this._tokenDetails.tokenIdHex)
        console.log("########################################################################################################")
        this.logTokenStats();
        this.logAddressBalances();
        this._updateComplete = true;
        console.log(`[DEBUG] this._updateComplete = ${this._updateComplete} (${this._tokenIdHex})`);
    }

    logTokenStats(): void {
        console.log("TOKEN STATS:")
        console.log({
            block_created: this._tokenStats.block_created,
            block_last_active_mint: this._tokenStats.block_last_active_mint,
            block_last_active_send: this._tokenStats.block_last_active_send,
            qty_valid_txns_since_genesis: this._tokenStats.qty_valid_txns_since_genesis,
            qty_valid_token_utxos: this._tokenStats.qty_valid_token_utxos,
            qty_valid_token_addresses: this._tokenStats.qty_valid_token_addresses,
            qty_token_minted: this._tokenStats.qty_token_minted.dividedBy(10**this._tokenDetails.decimals).toFixed(),
            qty_token_burned: this._tokenStats.qty_token_burned.dividedBy(10**this._tokenDetails.decimals).toFixed(),
            qty_token_circulating_supply: this._tokenStats.qty_token_circulating_supply.dividedBy(10**this._tokenDetails.decimals).toFixed(),
            qty_satoshis_locked_up: this._tokenStats.qty_satoshis_locked_up,
            minting_baton_status: this._tokenStats.minting_baton_status
        })
    }

    logAddressBalances(): void {
        console.log("ADDRESS BALANCES:")
        console.log(Array.from(this._addresses).map((v, _, __) => { 
                return { 
                    addr: v[0], 
                    bal: v[1].token_balance.dividedBy(10**this._tokenDetails.decimals).toFixed() 
                }
            })
        )
    }

    toAddressesDbObject(): AddressBalancesDbo[] {
        let result: AddressBalancesDbo[] = [];
        this._addresses.forEach((a, k) => { 
            result.push({ 
                tokenDetails: { tokenIdHex: this._tokenIdHex }, 
                address: k, 
                satoshis_balance: a.satoshis_balance, 
                token_balance: Decimal128.fromString(a.token_balance.dividedBy(10**this._tokenDetails.decimals).toFixed()) 
            }) 
        })
        return result;
    }

    toUtxosDbObject(): UtxoDbo[] {
        let result: UtxoDbo[] = [];
        this._tokenUtxos.forEach(u => {
            let txid = u.split(":")[0];
            let vout = u.split(":")[1];
            let output = this.utxoToUtxoDbo(txid, vout);
            if (output) {
                result.push(output);
            }
        });
        return result;
    }

    utxoToUtxoDbo(txid: string, vout: string) {
        if (!this._graphTxns.has(txid)) {
            this._tokenUtxos.delete(`${txid}:${vout}`);
            return undefined;
        }
        let output = this._graphTxns.get(txid)!.outputs.find(o => o.vout == parseInt(vout));
        if (output) {
            return <UtxoDbo>{
                tokenDetails: {
                    tokenIdHex: this._tokenDetails.tokenIdHex
                },
                utxo: txid + ":" + vout,
                txid: txid,
                vout: parseInt(vout),
                address: output.address,
                bchSatoshis: output.bchSatoshis,
                slpAmount: Decimal128.fromString(output.slpAmount.dividedBy(10 ** this._tokenDetails.decimals).toFixed())
            };
        }
        return undefined;
    }

    static MapTokenDetailsToDbo(details: SlpTransactionDetails, decimals: number): SlpTransactionDetailsDbo {
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
    
    static ConvertToUnixTime(Y_m_d_H_M_S: string): number|null {
        // timestamp is formatted as "%Y-%m-%d %H:%M:%S"
        if(Y_m_d_H_M_S) {
            let d = Y_m_d_H_M_S.split(" ")[0] + "T" + Y_m_d_H_M_S.split(" ")[1] + "Z";
            return Date.parse(d)/1000;
        }
        return null;
    }

    static FormatUnixToDateString(unix_time: number): string {
        var date = new Date(unix_time*1000);
        return date.toISOString().replace("T", " ").replace(".000Z", "")
    }

    public static MapDbTokenDetailsFromDbo(details: SlpTransactionDetailsDbo, decimals: number): SlpTransactionDetails {

        let genesisMintQty = new BigNumber(0);
        if(details.genesisOrMintQuantity)
            genesisMintQty = new BigNumber(details.genesisOrMintQuantity.toString()).multipliedBy(10**decimals);
        
        let sendOutputs: BigNumber[] = [];
        if(details.sendOutputs)
            sendOutputs = details.sendOutputs.map(o => o = <any>new BigNumber(o.toString()).multipliedBy(10**decimals));

        let res = {
            decimals: details.decimals,
            tokenIdHex: details.tokenIdHex,
            timestamp: details.timestamp!,
            transactionType: details.transactionType,
            versionType: details.versionType,
            documentUri: details.documentUri,
            documentSha256: details.documentSha256Hex ? Buffer.from(details.documentSha256Hex, 'hex') : null,
            symbol: details.symbol,
            name: details.name,
            batonVout: details.batonVout,
            containsBaton: details.containsBaton,
            genesisOrMintQuantity: details.genesisOrMintQuantity ? genesisMintQty : null,
            sendOutputs: details.sendOutputs ? sendOutputs as any as BigNumber[] : null
        }

        return res;
    }

    public static MapGraphTxnFromDbo(dbo: GraphTxnDbo, decimals: number, network: string): GraphTxn {
        dbo.graphTxn.outputs.map(o => {
            if(o.address && o.address.includes("slptest")) {
                let decoded = cashaddr.decode(o.address);
                o.address = Utils.slpAddressFromHash160(decoded.hash, network);
            }
            o.slpAmount = <any>new BigNumber(o.slpAmount.toString()).multipliedBy(10**decimals)
        });
        dbo.graphTxn.inputs.map(o => o.slpAmount = <any>new BigNumber(o.slpAmount.toString()).multipliedBy(10**decimals))

        let gt: GraphTxn = {
            isDirty: false,
            details: SlpTokenGraph.MapDbTokenDetailsFromDbo(dbo.graphTxn.details, decimals),
            outputs: dbo.graphTxn.outputs as any as GraphTxnOutput[],
            inputs: dbo.graphTxn.inputs as any as GraphTxnInput[],
            blockHash: dbo.graphTxn.blockHash
        }
        return gt;
    };

    static async initFromDbos(token: TokenDBObject, dag: GraphTxnDbo[], utxos: UtxoDbo[], manager: SlpGraphManager, network: string): Promise<SlpTokenGraph> {
        let tokenDetails = this.MapDbTokenDetailsFromDbo(token.tokenDetails, token.tokenDetails.decimals);
        if (!token.tokenStats?.block_created!) {
            throw Error("Must have a block created for token");
        }
        let tg = await manager.getTokenGraph({ tokenIdHex: token.tokenDetails.tokenIdHex, slpMsgDetailsGenesis: tokenDetails, forceValid: true, blockCreated: token.tokenStats?.block_created! });
        if (!tg) {
            throw Error("This should never happen");
        }
        tg._loadInitiated = true;
        
        // add minting baton
        tg._mintBatonUtxo = token.mintBatonUtxo;

        // add nft parent id
        if(token.nftParentId) {
            tg._nftParentId = token.nftParentId;
        }

        if (token.isGraphPruned) {
            tg._isGraphTotallyPruned = token.isGraphPruned;
        }

        tg._network = network;

        // Map _txnGraph
        dag.forEach((item, idx) => {
            let gt = this.MapGraphTxnFromDbo(item, tg!._tokenDetails.decimals, tg!._network);
            tg!._graphTxns.set(item.graphTxn.txid, gt);
        });

        // Preload SlpValidator with cachedValidations
        tg._graphTxns.forEach((_, txid) => {
            let validation: any = { validity: null, details: null, invalidReason: null, parents: [], waiting: false }
            validation.validity = tg!._graphTxns.get(txid) ? true : false;
            validation.details = tg!._graphTxns.get(txid)!.details;
            if(!validation.details)
                throw Error("No saved details about transaction" + txid);
            tg!._slpValidator.cachedValidations[txid] = validation;
        });

        console.log(`[INFO] Loaded ${tg._graphTxns.size} validation cache results`);

        // Map _addresses -- Can comment out since this is reconstructed in call to "updateStatistics()"
        // addresses.forEach((item, idx) => {
        //     tg._addresses.set(item.address, {
        //         satoshis_balance: addresses[idx].satoshis_balance, 
        //         token_balance: (new BigNumber(addresses[idx].token_balance.toString())).multipliedBy(10**tg._tokenDetails.decimals)
        //     });
        // });

        // Map _lastUpdatedBlock
        tg._lastUpdatedBlock = token.lastUpdatedBlock;

        // Map _tokenUtxos
        // TODO : Consider regenerating this from the loaded graph instead
        tg._tokenUtxos = new Set(utxos.map(u => u.utxo));

        return tg;
    }
}

export interface AddressBalance {
    token_balance: BigNumber; 
    satoshis_balance: number;
}

export interface GraphTxn {
    isDirty: boolean;
    //isComplete?: boolean;
    details: SlpTransactionDetails;
    outputs: GraphTxnOutput[];
    inputs: GraphTxnInput[];
    pruneHeight?: number;
    blockHash: Buffer|null;
}

export interface GraphTxnOutput {
    address: string;
    vout: number;
    bchSatoshis: number;
    slpAmount: BigNumber; 
    spendTxid: string | null;
    status: TokenUtxoStatus|BatonUtxoStatus;
    invalidReason: string | null;
 }

 interface GraphTxnInput {
    txid: string;
    vout: number;
    slpAmount: BigNumber; 
    address: string;
    bchSatoshis: number;
}

type txid = string;

interface SpendDetails {
    status: TokenUtxoStatus;
    txid: string|null;
    invalidReason: string|null;
}

interface MintSpendDetails {
    status: BatonUtxoStatus;
    txid: string|null;
    invalidReason: string|null;
}

interface SpentTxos { 
    txid: string;
    block: number|null;
    blockHash: Buffer|null 
}
