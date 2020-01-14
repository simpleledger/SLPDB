import { SlpTransactionDetails, SlpTransactionType, LocalValidator, 
         Utils, Slp, Primatives, SlpVersionType } from 'slpjs';
import BigNumber from 'bignumber.js';
import { BITBOX } from 'bitbox-sdk';
import * as bitcore from 'bitcore-lib-cash';
import { SendTxnQueryResult, Query } from './query';
import { Db } from './db';
import { RpcClient } from './rpc';
import * as pQueue from 'p-queue';
import { DefaultAddOptions } from 'p-queue';
import { SlpGraphManager } from './slpgraphmanager';
import { CacheMap } from './cache';
import { TokenDBObject, GraphTxnDbo, SlpTransactionDetailsDbo, TokenUtxoStatus,
         BatonUtxoStatus, TokenBatonStatus, GraphTxn } from './interfaces';
import { GraphMap } from './graphmap';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const bitbox = new BITBOX();
const slp = new Slp(bitbox);

import { slpUtxos } from './utxos';
const globalUtxoSet = slpUtxos();

import { pruneStack } from './prunestack';

export class SlpTokenGraph {

    _tokenIdHex: string;
    _tokenIdBuf: Buffer; // NOTE: will need to consider future interaction with lazy loading/garbage collection 
    _lastUpdatedBlock!: number;
    _tokenDetails: SlpTransactionDetails;
    _blockCreated: number|null;
    _mintBatonUtxo = "";
    _mintBatonStatus = TokenBatonStatus.UNKNOWN;
    _nftParentId?: string;      // TODO!
    private _graphTxns: GraphMap;
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
        this._tokenIdBuf = Buffer.from(this._tokenIdHex, "hex");
        this._graphTxns = new GraphMap(this);
        this._db = db;
        this._manager = manager;
        this._network = network;
        this._blockCreated =  blockCreated;
    }

    get graphSize() {
        return this._graphTxns.size;
    }

    public scanDoubleSpendTxids(txidToDelete: string[]): boolean {
        for (let txid of txidToDelete) {
            if (this._graphTxns.has(txid)) {
                RpcClient.transactionCache.delete(txid);
                this._graphTxns.deleteDoubleSpend(txid);
                this.commitToDb();
                return true;
            }
        }
        return false
    }

    markOutputAsBurnedNonSlp(txo: string, burnedInTxid: string) {
        let txid = txo.split(":")[0];
        let vout = Number.parseInt(txo.split(":")[1]);
        let gt = this._graphTxns.get(txid);
        if (gt) {
            let o = gt.outputs.find(o => o.vout === vout);
            if (o) {
                let batonVout;
                if ([SlpTransactionType.GENESIS, SlpTransactionType.MINT].includes(gt.details.transactionType)) {
                    batonVout = gt.details.batonVout;
                }
                if (batonVout === vout) {
                    o.status = BatonUtxoStatus.BATON_SPENT_NON_SLP;
                    this._mintBatonUtxo = "";
                    this._mintBatonStatus = TokenBatonStatus.DEAD_BURNED;
                } else {
                    o.status = TokenUtxoStatus.SPENT_NON_SLP;
                }
                o.spendTxid = burnedInTxid;
                o.invalidReason = "Spent in non-SLP transaction";
                this._graphTxns.SetDirty(txid);
                return true;
            }
        }
        return false;
    }

    public considerTxidsForPruning(txids: string[], pruneHeight: number) {
        for (let txid of txids) {
            let gt = this._graphTxns.get(txid);
            if (gt) {
                let canBePruned = gt.outputs.filter(o => [ 
                                        BatonUtxoStatus.BATON_UNSPENT, 
                                        TokenUtxoStatus.UNSPENT
                                    ].includes(o.status)).length === 0;
                if (canBePruned) {
                    if (!gt.prevPruneHeight || pruneHeight >= gt.prevPruneHeight) {
                        gt.prevPruneHeight = pruneHeight;
                        // no need to set isDirty, will get picked up by pruning stack
                    }
                }
            }
        }
        // commitToDb() should be called block crawl(), so no need to call here
    }

    public async commitToDb() {
        await this._db.graphItemsUpsert(this._graphTxns);
        this._updateComplete = true;
    }

    public async validateTxid(txid: string) {
        await this._slpValidator.isValidSlpTxid(txid, this._tokenIdHex);
        const validation = this._slpValidator.cachedValidations[txid];
        if (!validation.validity) {
            delete this._slpValidator.cachedValidations[txid];
            delete this._slpValidator.cachedRawTransactions[txid];
        }
        return validation;
    }

    public async stop() {
        console.log(`[INFO] Stopping token graph ${this._tokenIdHex}, with ${this._graphTxns.size} loaded.`);

        if (this._graphUpdateQueue.pending || this._graphUpdateQueue.size) {
            console.log(`[INFO] Waiting on ${this._graphUpdateQueue.size} queue items.`);
            if (!this._graphUpdateQueue.isPaused) {
                await this._graphUpdateQueue.onIdle();
                this._graphUpdateQueue.pause();
                console.log(`[INFO] Graph update queue is idle and cleared with ${this._graphUpdateQueue.size} items and ${this._graphUpdateQueue.pending} pending.`);
            }
        }

        let dirtyCount = this._graphTxns.DirtyCount;
        console.log(`[INFO] On stop there are ${dirtyCount} dirty items.`);
        if (dirtyCount > 0) {
            this.commitToDb();
        }

        while (this._graphUpdateQueueOnIdle !== undefined || !this._updateComplete) {
            console.log(`Waiting for UpdateStatistics to finish for ${this._tokenIdHex}`);
            await sleep(500);
        }
        console.log(`[INFO] Stopped token graph ${this._tokenIdHex}`);
    }

    public async setNftParentId() {
        if (this._tokenDetails.versionType === SlpVersionType.TokenVersionType1_NFT_Child) {
            let txnhex = await RpcClient.getRawTransaction(this._tokenIdHex);
            let tx = Primatives.Transaction.parseFromBuffer(Buffer.from(txnhex, 'hex'));
            let nftBurnTxnHex = await RpcClient.getRawTransaction(tx.inputs[0].previousTxHash);
            let nftBurnTxn = Primatives.Transaction.parseFromBuffer(Buffer.from(nftBurnTxnHex, 'hex'));
            let nftBurnSlp = slp.parseSlpOutputScript(Buffer.from(nftBurnTxn.outputs[0].scriptPubKey));
            if (nftBurnSlp.transactionType === SlpTransactionType.GENESIS) {
                this._nftParentId = tx.inputs[0].previousTxHash;
            }
            else {
                this._nftParentId = nftBurnSlp.tokenIdHex;
            }
        }
    }

    public async IsValid(): Promise<boolean> {
        if (this._isValid || this._isValid === false) {
            return this._isValid;
        }
        this._isValid = await this._slpValidator.isValidSlpTxid(this._tokenIdHex);
        return this._isValid;
    }

    public get IsLoaded(): boolean {
        return this._graphTxns.size > 0;
    }

    private async getMintBatonSpentOutputDetails({ txid, vout, txnOutputLength }: { txid: string; vout: number; txnOutputLength: number|null; }): Promise<MintSpendDetails> {
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
        if (!spendTxnInfo) {
            throw Error(`Unable to locate spend details for output ${txid}:${vout}.`);
        }
        let validation = await this.validateTxid(spendTxnInfo.txid!);
        try {
            if (!validation) {
                console.log('SLP Validator is missing transaction', spendTxnInfo.txid, 'for token', this._tokenDetails.tokenIdHex);
            }
            if (validation.validity && validation.details!.transactionType === SlpTransactionType.MINT) {
                globalUtxoSet.delete(`${txid}:${vout}`);
                return { status: BatonUtxoStatus.BATON_SPENT_IN_MINT, txid: spendTxnInfo!.txid, invalidReason: null };
            } else if (validation.validity) {
                this._mintBatonUtxo = '';
                this._mintBatonStatus = TokenBatonStatus.DEAD_BURNED;
                globalUtxoSet.delete(`${txid}:${vout}`);
                return { status: BatonUtxoStatus.BATON_SPENT_NOT_IN_MINT, txid: spendTxnInfo!.txid, invalidReason: "Baton was spent in a non-mint SLP transaction." };
            } else {
                throw Error("Unknown mint baton utxo status");
            }
        } catch(_) {
            this._mintBatonUtxo = '';
            this._mintBatonStatus = TokenBatonStatus.DEAD_BURNED;
            globalUtxoSet.delete(`${txid}:${vout}`);
            if (vout < txnOutputLength!) {
                return { status: BatonUtxoStatus.BATON_SPENT_INVALID_SLP, txid: null, invalidReason: validation.invalidReason };
            }
            this._mintBatonStatus = TokenBatonStatus.DEAD_BURNED;
            return { status: BatonUtxoStatus.BATON_MISSING_BCH_VOUT, txid: null, invalidReason: "SLP output has no corresponding BCH output." };
        }
    }

    private async getSpentOutputDetails({ txid, vout, txnOutputLength }: { txid: string; vout: number; txnOutputLength: number|null; }): Promise<SpendDetails> {
        let spendTxnInfo: SendTxnQueryResult | {txid: string, block: number|null} | undefined
        if (this._startupTxoSendCache) {
            spendTxnInfo = this._startupTxoSendCache.get(txid + ":" + vout);
            if (spendTxnInfo) {
                console.log("[INFO] Used _startupTxoSendCache data", txid, vout);
            }
        }
        if (!spendTxnInfo) {
            spendTxnInfo = this._manager._bit._spentTxoCache.get(txid + ":" + vout);
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
        if (!spendTxnInfo) {
            throw Error(`Unable to locate spend details for output ${txid}:${vout}.`);
        }
        let validation = await this.validateTxid(spendTxnInfo.txid!);
        try {
            if (!validation) {
                console.log('SLP Validator is missing transaction', spendTxnInfo.txid, 'for token', this._tokenDetails.tokenIdHex);
            }
            if (validation.validity && validation.details!.transactionType === SlpTransactionType.SEND) {
                globalUtxoSet.delete(`${txid}:${vout}`);
                return { status: TokenUtxoStatus.SPENT_SAME_TOKEN, txid: spendTxnInfo!.txid, invalidReason: null };
            } else if (validation.validity) {
                globalUtxoSet.delete(`${txid}:${vout}`);
                return { status: TokenUtxoStatus.SPENT_NOT_IN_SEND, txid: spendTxnInfo!.txid, invalidReason: null };
            } else {
                throw Error("Unknown utxo status");
            }
        } catch(_) {
            globalUtxoSet.delete(`${txid}:${vout}`);
            if (vout < txnOutputLength!) {
                return { status: TokenUtxoStatus.SPENT_INVALID_SLP, txid: null, invalidReason: validation.invalidReason };
            }
            return { status: TokenUtxoStatus.MISSING_BCH_VOUT, txid: null, invalidReason: "SLP output has no corresponding BCH output." };
        }
    }

    public async queueAddGraphTransaction({ txid, processUpToBlock }: { txid: string, processUpToBlock?: number; }): Promise<void> {
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
            });
        } else {
            return this._graphUpdateQueue.add(async () => {
                console.log(`[INFO] (queueTokenGraphUpdateFrom) Updating graph from ${txid}`);
                await self.addGraphTransaction({ txid, processUpToBlock });
            });
        }
    }

    public async addGraphTransaction({ txid, processUpToBlock, blockHash }: { txid: string; processUpToBlock?: number; blockHash?: Buffer; }): Promise<boolean|null> {
        if (this._graphTxns.has(txid)) {
            let gt = this._graphTxns.get(txid)!;
            if (!gt.blockHash && blockHash) {
                gt.blockHash = blockHash;
                this._graphTxns.SetDirty(txid);
            }
            return true;
        }

        let isValid = await this._slpValidator.isValidSlpTxid(txid, this._tokenDetails.tokenIdHex);
        let txnSlpDetails = this._slpValidator.cachedValidations[txid].details;
        let txn: bitcore.Transaction = new bitcore.Transaction(await this._slpValidator.retrieveRawTransaction(txid));

        if (!txnSlpDetails) {
            console.log("[WARN] addGraphTransaction: No token details for:", txid);
            return false;
        }

        let graphTxn: GraphTxn = {
            details: txnSlpDetails,
            outputs: [],
            inputs: [],
            blockHash: blockHash ? blockHash : null,
            prevPruneHeight: null
        };

        console.log(`[INFO] Unpruned txn count: ${this._graphTxns.size} (token: ${this._tokenIdHex})`);

        // Update parent items (their output statuses) and add contributing SLP inputs
        if (txid !== this._tokenIdHex) {
            let visited = new Set<string>();

            // update parent input details
            for (let i of txn.inputs) {
                let previd = i.prevTxId.toString('hex');

                if (this._graphTxns.has(previd)) {
                    let ptxn = this._graphTxns.get(previd)!;
                    this._graphTxns.SetDirty(previd);
                    // update the parent's output items
                    console.log("[INFO] addGraphTransaction: update the status of the input txns' outputs");
                    if (!visited.has(previd)) {
                        visited.add(previd);
                        //await this.updateTokenGraphAt({ txid: previd, isParentInfo: {  }, processUpToBlock });
                        let gtos = ptxn!.outputs;
                        let prevOutpoints = txn.inputs.filter(i => i.prevTxId.toString('hex') === previd).map(i => i.outputIndex);
                        for (let vout of prevOutpoints) {
                            let spendInfo: SpendDetails|MintSpendDetails;
                            if ([SlpTransactionType.GENESIS, SlpTransactionType.MINT].includes(ptxn!.details.transactionType) &&
                                ptxn.details.batonVout === vout) {
                                    spendInfo = await this.getMintBatonSpentOutputDetails({ txid: previd, vout, txnOutputLength: null });
                            } else {
                                spendInfo = await this.getSpentOutputDetails({ txid: previd, vout, txnOutputLength: null });
                            }
                            let o = gtos.find(o => o.vout === vout);
                            if (o) {
                                o.spendTxid = txid;
                                o.status = spendInfo.status;
                                o.invalidReason = spendInfo.invalidReason;
                            }
                        }
                        if (processUpToBlock && gtos.filter(o => [ TokenUtxoStatus.UNSPENT, 
                                                                    BatonUtxoStatus.BATON_UNSPENT ].includes(o.status)).length === 0) 
                        {
                            let pruningStack = pruneStack();
                            pruningStack.addGraphTxidToPruningStack(processUpToBlock, this._tokenIdHex, previd);
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
                        this._graphTxns.SetDirty(previd);
                    }
                }
            }

            // visited.clear();

            // // check all inputs
            // for (let i of txn.inputs) {
            //     let previd = i.prevTxId.toString('hex');
            //     let valid;
            //     if (!this._slpValidator.cachedValidations[previd]) {
            //         console.log(`Skipping assumed invalid SLP input: ${previd}:${i.outputIndex} in txn: ${txid}`);
            //         continue;
            //     }

            //     valid = this._slpValidator.cachedValidations[previd].validity;

            //     if (!this._graphTxns.has(previd) && valid) {
            //         //
            //         // NOTE: This branch should only happen in one of the following situations:
            //         //          1) a new graph txn is spending non-SLP inputs from a pruned txn, OR
            //         //          2) a valid NFT1 child is spending a non-SLP output from a valid NFT1 parent
            //         //
            //         // NOTE: A graph in SLPDB is an individual dag with 1 Genesis, whereas in slp-validate the validator for an NFT Child dag
            //         //       will also cache validity data for the NFT group dag.  This is why #2 in the list above occurs.
            //         //
            //         if (!visited.has(previd)) {
            //             visited.add(previd);
            //             let res = await this._db.graphTxnFetch(previd);
            //             if (!res) {
            //                 // NOTE: Since situation #2 (with the NFT1 parent) may not yet have this specific graph item commited to db, so let's 
            //                 //       parse the txn details and check token type !== NFT1_PARENT before we throw.
            //                 let prevTxHex = await RpcClient.getRawTransaction(previd);
            //                 let prevTx = new bitcore.Transaction(prevTxHex);
            //                 let prevTxSlpMessage = slp.parseSlpOutputScript(prevTx.outputs[0]._scriptBuffer);
            //                 if (this._tokenDetails.versionType === SlpVersionType.TokenVersionType1_NFT_Child &&
            //                     prevTxSlpMessage.versionType === SlpVersionType.TokenVersionType1_NFT_Parent) {
            //                     continue;
            //                 }
            //                 throw Error(`Graph txid ${previd} was not found, this should never happen.`);
            //             } else {
            //                 let gt = GraphMap.mapGraphTxnFromDbo(res, this._tokenDetails.decimals);
            //                 let unspentCount = gt.outputs.filter(o => [TokenUtxoStatus.UNSPENT, BatonUtxoStatus.BATON_UNSPENT].includes(o.status)).length
            //                 if (gt.details.tokenIdHex === this._tokenIdHex &&
            //                     unspentCount > 0) {
            //                     throw Error(`Graph txid ${previd} was loaded from db with unspent outputs, this should never happen.`);
            //                 }
            //                 continue;
            //             }
            //         }
            //     }
            // }
        }

        if (!isValid) {
            console.log("[WARN] addGraphTransaction: Not valid token transaction:", txid);
            this.mempoolCommitToDb({});
            return false;
        }

        // Create or update SLP graph outputs for each valid SLP output
        if (graphTxn.details.transactionType === SlpTransactionType.GENESIS || graphTxn.details.transactionType === SlpTransactionType.MINT) {
            if (graphTxn.details.genesisOrMintQuantity!.isGreaterThanOrEqualTo(0)) {
                let address = this.getAddressStringFromTxnOutput(txn, 1);
                globalUtxoSet.set(`${txid}:${1}`, this._tokenIdBuf.slice());
                graphTxn.outputs.push({
                    address: address,
                    vout: 1,
                    bchSatoshis: txn.outputs.length > 1 ? txn.outputs[1].satoshis : 0, 
                    slpAmount: graphTxn.details.genesisOrMintQuantity! as BigNumber,
                    spendTxid: null,
                    status: TokenUtxoStatus.UNSPENT,
                    invalidReason: null
                });
                if (txnSlpDetails.batonVout) {
                    this._mintBatonStatus = TokenBatonStatus.ALIVE;
                    this._mintBatonUtxo = `${txid}:${txnSlpDetails.batonVout}`;
                    let address = this.getAddressStringFromTxnOutput(txn, 1);
                    globalUtxoSet.set(`${txid}:${txnSlpDetails.batonVout}`, this._tokenIdBuf.slice());
                    graphTxn.outputs.push({
                        address: address,
                        vout: txnSlpDetails.batonVout,
                        bchSatoshis: txnSlpDetails.batonVout < txn.outputs.length ? txn.outputs[txnSlpDetails.batonVout].satoshis : 0, 
                        slpAmount: new BigNumber(0),
                        spendTxid: null,
                        status: BatonUtxoStatus.BATON_UNSPENT,
                        invalidReason: null
                    });
                } else if (txnSlpDetails.batonVout === null) {
                    this._mintBatonUtxo = "";
                    this._mintBatonStatus = TokenBatonStatus.DEAD_ENDED;
                }
            }
        }
        else if(graphTxn.details.sendOutputs!.length > 0) {
            let slp_vout = 0;
            for (let output of graphTxn.details.sendOutputs!) {
                if (output.isGreaterThanOrEqualTo(0)) {
                    if (slp_vout > 0) {
                        let address = this.getAddressStringFromTxnOutput(txn, slp_vout);
                        globalUtxoSet.set(`${txid}:${slp_vout}`, this._tokenIdBuf.slice());
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

        if (!blockHash) {
            this.mempoolCommitToDb({ zmqTxid: txid });
        }

        return true;
    }

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

    // async getTotalMintQuantity(): Promise<BigNumber> {
    //     let qty = this._tokenDetails.genesisOrMintQuantity;
    //     if(!qty)
    //         throw Error("Cannot have Genesis without quantity.");
    //     this._graphTxns.forEach(t => {
    //         if(t.details.transactionType === SlpTransactionType.MINT)
    //             qty = qty!.plus(t.details.genesisOrMintQuantity!)
    //     })
    //     return qty;
    // }

    // async getBatonStatus(): Promise<TokenBatonStatus> {
    //     if (!this._tokenDetails.containsBaton) {
    //         return TokenBatonStatus.NEVER_CREATED;
    //     }
    //     else if (this._tokenDetails.containsBaton === true) {
    //         if (this._mintBatonUtxo.includes(this._tokenDetails.tokenIdHex + ":" + this._tokenDetails.batonVout)) {
    //             return TokenBatonStatus.ALIVE;
    //         }
    //         let mintTxids = Array.from(this._graphTxns).filter(o => o[1].details.transactionType === SlpTransactionType.MINT).map(o => o[0]);
    //         let mints = mintTxids.map(i => this._slpValidator.cachedValidations[i])
    //         if (mints) {
    //             for (let i = 0; i < mints!.length; i++) {
    //                 let valid = mints[i].validity;
    //                 let vout = mints[i].details!.batonVout;
    //                 if (valid && vout && this._mintBatonUtxo.includes(mintTxids[i] + ":" + vout)) {
    //                     return TokenBatonStatus.ALIVE;
    //                 }
    //                 if (valid && !vout) {
    //                     return TokenBatonStatus.DEAD_ENDED;
    //                 }
    //             }
    //         }
    //     }
    //     return TokenBatonStatus.DEAD_BURNED;
    // }

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

    private async mempoolCommitToDb({ zmqTxid }: { zmqTxid?: string }): Promise<void> {
        if (zmqTxid) {
            this._graphUpdateQueueNewTxids.add(zmqTxid);
        }
        if (!this._graphUpdateQueueOnIdle) {
            this._updateComplete = false;
            this._graphUpdateQueueOnIdle = async (self: SlpTokenGraph) => {
                self._graphUpdateQueue.pause();
                if (self._graphUpdateQueue.size !== 0 || self._graphUpdateQueue.pending !== 0) {
                    await self._graphUpdateQueue.onIdle();
                }
                let txidToUpdate = Array.from(self._graphUpdateQueueNewTxids);
                self._graphUpdateQueueNewTxids.clear();
                self._graphUpdateQueueOnIdle = null;
                self._updateComplete = false;
                await self.commitToDb();
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

    static async initFromDbos(token: TokenDBObject, dag: GraphTxnDbo[], manager: SlpGraphManager, network: string): Promise<SlpTokenGraph> {
        let tokenDetails = this.MapDbTokenDetailsFromDbo(token.tokenDetails, token.tokenDetails.decimals);
        if (!token.tokenStats.block_created && token.tokenStats.block_created !== 0) {
            throw Error("Must have a block created for token");
        }
        let tg = await manager.getTokenGraph({ 
            tokenIdHex: token.tokenDetails.tokenIdHex, 
            slpMsgDetailsGenesis: tokenDetails, 
            forceValid: true, 
            blockCreated: token.tokenStats?.block_created!,
            nft1ChildParentIdHex: token.nftParentId
        });
        if (!tg) {
            throw Error("This should never happen");
        }
        tg._loadInitiated = true;
        
        // add minting baton
        tg._mintBatonUtxo = token.mintBatonUtxo;
        tg._mintBatonStatus = token.mintBatonStatus;

        // add nft parent id
        if(token.nftParentId) {
            tg._nftParentId = token.nftParentId;
        }

        tg._network = network;

        // Map _txnGraph
        tg!._graphTxns.fromDbos(
            dag, 
            token.pruningState.sendCount,
            token.pruningState.mintCount,
            new BigNumber(token.pruningState.mintQuantity.toString())
        );

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

        // Map _lastUpdatedBlock
        tg._lastUpdatedBlock = token.lastUpdatedBlock;

        return tg;
    }
}

// export interface AddressBalance {
//     token_balance: BigNumber; 
//     satoshis_balance: number;
// }

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
    blockHash: Buffer|null;
}
