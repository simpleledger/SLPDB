import { SlpTransactionDetails, SlpTransactionType, LocalValidator, Utils } from 'slpjs';
import BigNumber from 'bignumber.js';
import { Bitcore, BitcoinRpc } from './vendor';
import BITBOXSDK from 'bitbox-sdk';
import { Config } from './config';
import * as bitcore from 'bitcore-lib-cash';
import { TxnQueryResult, MintQueryResult, Query, TxnQueryResponse } from './query';
import { TxOut } from 'bitbox-sdk/lib/Blockchain';
import { Decimal128 } from 'mongodb';

const RpcClient = require('bitcoin-rpc-promise')
const BITBOX = new BITBOXSDK();

export interface TokenGraph {
    _tokenDetails: SlpTransactionDetails;
    _tokenStats: TokenStats;
    _tokenUtxos: Set<string>;
    _graphTxns: Map<txid, GraphTxn>;
    _addresses: Map<cashAddr, AddressBalance>;
    updateTokenGraphFrom(txid: string): Promise<boolean>;
    initStatistics(): Promise<void>;
}

export interface AddressBalance {
    token_balance: BigNumber, satoshis_balance: number
}

export class SlpTokenGraph implements TokenGraph {
    _lastUpdatedBlock!: number;
    _tokenDetails!: SlpTransactionDetails;
    _tokenStats!: TokenStats;
    _tokenUtxos!: Set<string>;
    _graphTxns!: Map<string, GraphTxn>;
    _addresses!: Map<cashAddr, AddressBalance>;
    _slpValidator!: LocalValidator;
    _rpcClient: BitcoinRpc.RpcClient;
    _network!: string;

    constructor() {
        let connectionString = 'http://'+ Config.rpc.user+':'+Config.rpc.pass+'@'+Config.rpc.host+':'+Config.rpc.port
        this._rpcClient = <BitcoinRpc.RpcClient>(new RpcClient(connectionString));
        this._slpValidator = new LocalValidator(BITBOX, async (txids) => [ await this._rpcClient.getRawTransaction(txids[0]) ])
    }

    async initFromScratch(tokenDetails: SlpTransactionDetails) {
        await Query.init();
        this._network = (await this._rpcClient.getInfo()).testnet ? 'testnet': 'mainnet';
        this._lastUpdatedBlock = 0;
        this._tokenDetails = tokenDetails;
        this._tokenUtxos = new Set<string>();
        this._graphTxns = new Map<string, GraphTxn>();
        this._addresses = new Map<cashAddr, AddressBalance>();

        await this.updateTokenGraphFrom(tokenDetails.tokenIdHex);
        let mints = await Query.getMintTransactions(tokenDetails.tokenIdHex);
        if(mints && mints.length > 0)
            await this.asyncForEach(mints, async (m: MintQueryResult) => await this.updateTokenGraphFrom(m.txid!));

        await this.updateAddresses();
        await this.initStatistics();

        // TODO? creaete rpc cache, and then clear rpc cache here.
    }

    IsValid(): boolean {
        return this._graphTxns.has(this._tokenDetails.tokenIdHex);
    }

    async asyncForEach(array: any[], callback: Function) {
        for (let index = 0; index < array.length; index++) {
          await callback(array[index], index, array);
        }
    }

    async getSpendDetails(txid: string, vout: number): Promise<SpendDetails> {
        let txOut = await this._rpcClient.getTxOut(txid, vout, true);
        //console.log("TXOUT", txOut);
        if(txOut === null) {
            this._tokenUtxos.delete(txid + ":" + vout);
            //console.log("DELETE:", txid,":",vout);
            try {
                let spendTxnInfo = await Query.queryForTxoInput(txid, vout);

                if(spendTxnInfo.txid === null) {
                    return { status: UtxoStatus.SPENT_NON_SLP, txid: null, queryResponse: null };
                }
                if(typeof spendTxnInfo!.txid === 'string') {
                    let valid = this._slpValidator.isValidSlpTxid(spendTxnInfo.txid!, this._tokenDetails.tokenIdHex);
                    if(valid) {
                        return { status: UtxoStatus.SPENT_SAME_TOKEN, txid: spendTxnInfo!.txid, queryResponse: spendTxnInfo };
                    }
                    return { status: UtxoStatus.SPENT_INVALID_SLP, txid: spendTxnInfo!.txid, queryResponse: spendTxnInfo };
                }
            } catch(_) {
                return { status: UtxoStatus.SPENT_INVALID_SLP, txid: null, queryResponse: null };
            }
        } 
        else {
            this._tokenUtxos.add(txid + ":" + vout);
            return { status: UtxoStatus.UNSPENT, txid: null, queryResponse: null };
        }

        throw Error("Unknown Error in SlpTokenGraph");
    }

    async updateTokenGraphFrom(txid: string, isParent=false): Promise<boolean> {        
        if(this._graphTxns.has(txid) && !isParent)
            return true;

        let isValid = await this._slpValidator.isValidSlpTxid(txid, this._tokenDetails.tokenIdHex);
        let txnSlpDetails = this._slpValidator.cachedValidations[txid].details;
        let txn: Bitcore.Transaction = new bitcore.Transaction(this._slpValidator.cachedRawTransactions[txid])

        if (!isValid || !txnSlpDetails) {
            console.log("Not valid token or no token details for", txid);
            return false;
        }

        let graphTxn: GraphTxn;
        if(!this._graphTxns.has(txid))
            graphTxn = { details: txnSlpDetails, outputs: [], timestamp: null, block: null }
        else {
            graphTxn = this._graphTxns.get(txid)!;
            graphTxn.outputs = [];
        }

        // First, lets update the status of the txn's input TXO parents
        if(!isParent) {
            let parentIds = new Set<string>([...txn.inputs.map(i => i.prevTxId.toString('hex'))])
            await this.asyncForEach(Array.from(parentIds), async (txid: string) => {
                if(this._graphTxns.get(txid)!) {
                    await this.updateTokenGraphFrom(txid, true);
                }
            });
        }

        // get block and timestamp of this txn
        let txq: any = await Query.getTransactionDetails(txid);
        if(txq) {
            graphTxn.timestamp = txq.timestamp;
            graphTxn.block = txq.block;
        }

        // Create SLP graph outputs for each new valid SLP output
        if(isValid && (graphTxn.details.transactionType === SlpTransactionType.GENESIS || graphTxn.details.transactionType === SlpTransactionType.MINT)) {
            if(graphTxn.details.genesisOrMintQuantity!.isGreaterThanOrEqualTo(0)) {
                let spendDetails = await this.getSpendDetails(txid, 1);
                let address;
                try { address = Utils.toSlpAddress(BITBOX.Address.fromOutputScript(txn.outputs[1]._scriptBuffer, this._network))
                } catch(_) { address = "multisig or unknown address type"; }
                graphTxn.outputs.push({
                    address: address,
                    vout: 1,
                    bchSatoshis: txn.outputs[1].satoshis, 
                    slpAmount: <any>graphTxn.details.genesisOrMintQuantity!,
                    spendTxid: spendDetails.txid,
                    status: spendDetails.status,
                    invalidReason: spendDetails.txid && spendDetails.status !== UtxoStatus.UNSPENT && spendDetails.status !== UtxoStatus.SPENT_SAME_TOKEN ? this._slpValidator.cachedValidations[spendDetails.txid!].invalidReason : null
                })
            }
        }
        else if(isValid && graphTxn.details.sendOutputs!.length > 0) {
            await this.asyncForEach(graphTxn.details.sendOutputs!, async (output: BigNumber, vout: number) => { 
                if(output.isGreaterThanOrEqualTo(0)) {
                    if(vout > 0) {
                        let spendDetails = await this.getSpendDetails(txid, vout);
                        let address;
                        try { address = Utils.toSlpAddress(BITBOX.Address.fromOutputScript(txn.outputs[vout]._scriptBuffer, this._network))
                        } catch(_) { address = "multisig or unknown address type"; }
                        graphTxn.outputs.push({
                            address: address,
                            vout: vout,
                            bchSatoshis: txn.outputs[vout].satoshis, 
                            slpAmount: <any>graphTxn.details.sendOutputs![vout],
                            spendTxid: spendDetails.txid,
                            status: spendDetails.status,
                            invalidReason: spendDetails.txid && spendDetails.status !== UtxoStatus.UNSPENT && spendDetails.status !== UtxoStatus.SPENT_SAME_TOKEN ? this._slpValidator.cachedValidations[spendDetails.txid!].invalidReason : null
                        })
                    }
                }
            })
        }
        else {
            console.log("[WARNING]: Transaction is not valid or is unknown token type!", txid)
        }

        // Continue to complete graph from output UTXOs
        if(!isParent) {
            await this.asyncForEach(graphTxn.outputs.filter(o => o.spendTxid && o.status === UtxoStatus.SPENT_SAME_TOKEN), async (o: any) => {
                await this.updateTokenGraphFrom(o.spendTxid!);
            });
        }

        this._graphTxns.set(txid, graphTxn);
        this._lastUpdatedBlock = await this._rpcClient.getBlockCount();
        return true;
    }

    async updateAddresses(): Promise<void> {
        this._addresses.clear();

        await this.asyncForEach(Array.from(this._tokenUtxos), async (utxo: string) => {
            let txid = utxo.split(':')[0];
            let vout = parseInt(utxo.split(':')[1]);
            let txout = <TxOut>(await this._rpcClient.getTxOut(txid, vout, true))
            if(txout) {
                let bal;
                let addr = Utils.toSlpAddress(txout.scriptPubKey.addresses[0])
                let txnDetails = this._graphTxns.get(txid)!.details
                if(this._addresses.has(addr)) {
                    bal = this._addresses.get(addr)!
                    bal.satoshis_balance+=txout.value*10**8
                    if(txnDetails.transactionType === SlpTransactionType.SEND)
                        bal.token_balance = bal.token_balance.plus(txnDetails.sendOutputs![vout])
                    else if(vout === 1)
                        bal.token_balance = bal.token_balance.plus(txnDetails.genesisOrMintQuantity!)
                }
                else {
                    if(txnDetails.transactionType === SlpTransactionType.SEND)
                        bal = { satoshis_balance: txout.value*10**8, token_balance: txnDetails.sendOutputs![vout] }
                    else if(vout === 1)
                        bal = { satoshis_balance: txout.value*10**8, token_balance: txnDetails.genesisOrMintQuantity! }
                }

                if(bal) {
                    this._addresses.set(addr, <any>bal);
                }
            }
        });
    }

    async getTotalMintQuantity(): Promise<BigNumber> {
        let qty = this._tokenDetails.genesisOrMintQuantity!;
        let results = await Query.getMintTransactions(this._tokenDetails.tokenIdHex);
        if(results) {
            results.forEach(r => {
                if(r.quantityHex) {
                    let qtyBuf = new Buffer(r.quantityHex, 'hex');
                    let mint = new BigNumber(0);
                    mint = Utils.buffer2BigNumber(qtyBuf);
                    qty = qty.plus(<any>mint);
                }
            })
        }
        return <any>qty;
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

    async initStatistics(): Promise<void> {
        this._tokenStats = <TokenStats> {
            block_created: 0,
            block_last_active_mint: 0,
            block_last_active_send: 0,
            qty_valid_txns_since_genesis: this._graphTxns.size,
            qty_valid_token_utxos: this._tokenUtxos.size,
            qty_valid_token_addresses: this._addresses.size,
            qty_token_minted: await this.getTotalMintQuantity(),
            qty_token_burned: new BigNumber(0),
            qty_token_circulating_supply: this.getTotalHeldByAddresses(),
            qty_satoshis_locked_up: this.getTotalSatoshisLockedUp()
        }

        this._tokenStats.qty_token_burned = this._tokenStats.qty_token_minted.minus(this._tokenStats.qty_token_circulating_supply)
    }

    async updateStatistics(): Promise<void> {
        await this.updateAddresses();
        if(!this._tokenStats)
            await this.initStatistics();
        else {
            let minted = await this.getTotalMintQuantity();
            let addressesTotal = this.getTotalHeldByAddresses()
            this._tokenStats.qty_valid_token_addresses = this._addresses.size;
            this._tokenStats.qty_valid_token_utxos = this._tokenUtxos.size;
            this._tokenStats.qty_valid_txns_since_genesis = this._graphTxns.size;
            this._tokenStats.qty_token_minted = minted;
            this._tokenStats.qty_token_circulating_supply = addressesTotal;
            this._tokenStats.qty_token_burned = minted.minus(addressesTotal);
            this._tokenStats.qty_satoshis_locked_up = this.getTotalSatoshisLockedUp();
        }

        if(this._tokenStats.qty_token_circulating_supply.isGreaterThan(this._tokenStats.qty_token_minted))
            throw Error("Unknown error, cannot have circulating supply larger than mint quantity.");
    }

    logTokenStats(): void {
        //await this.updateStatistics();
        console.log("TOKEN STATS:")
        console.log({
            block_created: 0,                //this._tokenStats.block_created,
            block_last_active_mint: 0,       //this._tokenStats.block_last_active_mint,
            block_last_active_send: 0,       //this._tokenStats.block_last_active_send,
            qty_valid_txns_since_genesis: this._tokenStats.qty_valid_txns_since_genesis,
            qty_valid_token_utxos: this._tokenStats.qty_valid_token_utxos,
            qty_valid_token_addresses: this._tokenStats.qty_valid_token_addresses,
            qty_token_minted: this._tokenStats.qty_token_minted.dividedBy(10**this._tokenDetails.decimals).toFixed(),
            qty_token_burned: this._tokenStats.qty_token_burned.dividedBy(10**this._tokenDetails.decimals).toFixed(),
            qty_token_circulating_supply: this._tokenStats.qty_token_circulating_supply.dividedBy(10**this._tokenDetails.decimals).toFixed(),
            qty_satoshis_locked_up: this._tokenStats.qty_satoshis_locked_up
        })
    }

    logAddressBalances(): void {
        console.log("ADDRESS BALANCES:")
        console.log(Array.from(this._addresses).map((v, _, __) => { return { addr: v[0], bal: v[1].token_balance.dividedBy(10**this._tokenDetails.decimals).toFixed() }}))
    }

    toDbObject(): TokenDBObject {
        let tokenDetails = SlpTokenGraph.MapTokenDetailsToDbo(this._tokenDetails, this._tokenDetails.decimals);
        let graphTxns: GraphTxnDbo[] = [];
        this._graphTxns.forEach((g, k) => {
            graphTxns.push({
                txid: k,
                timestamp: g.timestamp, 
                block: g.block,
                details: SlpTokenGraph.MapTokenDetailsToDbo(this._graphTxns.get(k)!.details, this._tokenDetails.decimals),
                outputs: this.mapGraphTxnOutputsToDbo(this._graphTxns.get(k)!.outputs)
            })
        })
        let result = {
            slpdbVersion: Config.db.schema_version,
            lastUpdatedBlock: this._lastUpdatedBlock,
            tokenDetails: tokenDetails,
            txnGraph: graphTxns,
            addresses: <{ address: cashAddr, satoshis_balance: number, token_balance: Decimal128 }[]>Array.from(this._addresses).map(a => { return { address: a[0], satoshis_balance: a[1].satoshis_balance, token_balance: Decimal128.fromString(a[1].token_balance.dividedBy(10**this._tokenDetails.decimals).toFixed()) } }),
            tokenStats: this.mapTokenStatstoDbo(this._tokenStats),
            tokenUtxos: Array.from(this._tokenUtxos)
        }
        return result;
    }

    mapGraphTxnOutputsToDbo(outputs: GraphTxnOutput[]): GraphTxnOutputDbo[] {
        let mapped: GraphTxnDbo["outputs"] = [];
        outputs.forEach(o => {
            let m = Object.create(o);
            //console.log(m);
            try {
                m.slpAmount = Decimal128.fromString(m.slpAmount.dividedBy(10**this._tokenDetails.decimals).toFixed());
            } catch(_) {
                m.slpAmount = Decimal128.fromString("0");
            }
            mapped.push(m);
        })
        return mapped;
    }

    mapTokenStatstoDbo(stats: TokenStats): TokenStatsDb {
        return {
            block_created: stats.block_created,
            block_last_active_send: stats.block_last_active_send,
            block_last_active_mint: stats.block_last_active_mint,
            qty_valid_txns_since_genesis: stats.qty_valid_txns_since_genesis,
            qty_valid_token_utxos: stats.qty_valid_token_utxos,
            qty_valid_token_addresses: stats.qty_valid_token_addresses,
            qty_token_minted: stats.qty_token_minted.dividedBy(10**this._tokenDetails.decimals).toFixed(),
            qty_token_burned: stats.qty_token_burned.dividedBy(10**this._tokenDetails.decimals).toFixed(),
            qty_token_circulating_supply: stats.qty_token_circulating_supply.dividedBy(10**this._tokenDetails.decimals).toFixed(),
            qty_satoshis_locked_up: stats.qty_satoshis_locked_up
        }
    }

    static MapTokenDetailsToDbo(details: SlpTransactionDetails, decimals: number): SlpTransactionDetailsDbo {
        let res: SlpTransactionDetailsDbo = {
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
            genesisOrMintQuantity: details.genesisOrMintQuantity ? Decimal128.fromString(details.genesisOrMintQuantity!.dividedBy(10**decimals).toFixed()) : null,
            sendOutputs: details.sendOutputs ? details.sendOutputs.map(o => Decimal128.fromString(o.dividedBy(10**decimals).toFixed())) : null
        }

        return res;
    }

    static MapDbTokenDetailsFromDbo(details: SlpTransactionDetailsDbo, decimals: number): SlpTransactionDetails {

        let genesisMintQty = new BigNumber(0);
        if(details.genesisOrMintQuantity)
            try { genesisMintQty = new BigNumber(details.genesisOrMintQuantity.toString()).multipliedBy(10**decimals); } catch(_) { throw Error("Error in mapping database object"); }
        
        let sendOutputs: BigNumber[] = [];
        if(details.sendOutputs)
            try { sendOutputs = details.sendOutputs.map(o => o = <any>new BigNumber(o.toString()).multipliedBy(10**decimals)); } catch(_) { throw Error("Error in mapping database object"); }

        let res = {
            decimals: details.decimals,
            tokenIdHex: details.tokenIdHex,
            timestamp: details.timestamp,
            transactionType: details.transactionType,
            versionType: details.versionType,
            documentUri: details.documentUri,
            documentSha256: details.documentSha256Hex ? new Buffer(details.documentSha256Hex) : null,
            symbol: details.symbol,
            name: details.name,
            batonVout: details.batonVout,
            containsBaton: details.containsBaton,
            genesisOrMintQuantity: details.genesisOrMintQuantity ? genesisMintQty : null,
            sendOutputs: details.sendOutputs ? sendOutputs as any as BigNumber[] : null
        }

        return res;
    }

    static async FromDbObject(doc: TokenDBObject): Promise<SlpTokenGraph> {
        let tg = new SlpTokenGraph();
        await Query.init();
        tg._network = (await tg._rpcClient.getInfo()).testnet ? 'testnet': 'mainnet';

        // Map _tokenDetails
        tg._tokenDetails = this.MapDbTokenDetailsFromDbo(doc.tokenDetails, doc.tokenDetails.decimals);

        // Map _txnGraph
        tg._graphTxns = new Map<txid, GraphTxn>();
        doc.txnGraph.forEach((item, idx) => {
            try { doc.txnGraph[idx].outputs.map(o => o.slpAmount = <any>new BigNumber(o.slpAmount.toString()).multipliedBy(10**tg._tokenDetails.decimals)) } catch(_) { throw Error("Error in mapping database object"); }

            let gt: GraphTxn = {
                timestamp: item.timestamp, 
                block: item.block,
                details: this.MapDbTokenDetailsFromDbo(doc.txnGraph[idx].details, doc.tokenDetails.decimals),
                outputs: doc.txnGraph[idx].outputs as any as GraphTxnOutput[]
            }

            tg._graphTxns.set(item.txid, gt);
        })

        // Map _addresses
        tg._addresses = new Map<string, AddressBalance>();
        doc.addresses.forEach((item, idx) => {
            tg._addresses.set(item.address, {
                satoshis_balance: doc.addresses[idx].satoshis_balance, 
                token_balance: (new BigNumber(doc.addresses[idx].token_balance.toString())).multipliedBy(10**tg._tokenDetails.decimals)
            });
        });


        // Map _lastUpdatedBlock
        tg._lastUpdatedBlock = doc.lastUpdatedBlock;

        // Map _tokenUtxos
        tg._tokenUtxos = new Set(doc.tokenUtxos);

        await tg.updateStatistics();

        return tg;
    }
}

export interface TokenDBObject {
    slpdbVersion: number;
    tokenDetails: SlpTransactionDetailsDbo;
    txnGraph: GraphTxnDbo[];
    addresses: { address: cashAddr, satoshis_balance: number, token_balance: Decimal128 }[];
    tokenStats: TokenStats | TokenStatsDb;
    lastUpdatedBlock: number;
    tokenUtxos: string[]
}

export interface SlpTransactionDetailsDbo {
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
    genesisOrMintQuantity: Decimal128|null;
    sendOutputs: Decimal128[]|null;
}

interface GraphTxnDbo {
    txid: string,
    details: SlpTransactionDetailsDbo;
    timestamp: string|null;
    block: number|null;
    outputs: GraphTxnOutputDbo[]
}

interface GraphTxnOutputDbo { 
    address: string,
    vout: number, 
    bchSatoshis: number, 
    slpAmount: Decimal128, 
    spendTxid: string | null,
    status: UtxoStatus,
    invalidReason: string | null
}

interface GraphTxn {
    details: SlpTransactionDetails;
    timestamp: string|null
    block: number|null;
    outputs: GraphTxnOutput[]
}

interface GraphTxnOutput { 
    address: string,
    vout: number, 
    bchSatoshis: number, 
    slpAmount: BigNumber, 
    spendTxid: string | null,
    status: UtxoStatus,
    invalidReason: string | null
 }

type txid = string;
type cashAddr = string;

interface TokenStats {
    block_created: number;
    block_last_active_send: number;
    block_last_active_mint: number;
    qty_valid_txns_since_genesis: number;
    qty_valid_token_utxos: number;
    qty_valid_token_addresses: number;
    qty_token_minted: BigNumber;
    qty_token_burned: BigNumber;
    qty_token_circulating_supply: BigNumber;
    qty_satoshis_locked_up: number;
}

interface TokenStatsDb {
    block_created: number;
    block_last_active_send: number;
    block_last_active_mint: number;
    qty_valid_txns_since_genesis: number;
    qty_valid_token_utxos: number;
    qty_valid_token_addresses: number;
    qty_token_minted: string;
    qty_token_burned: string;
    qty_token_circulating_supply: string;
    qty_satoshis_locked_up: number;
}

enum UtxoStatus {
    "UNSPENT" = "UNSPENT", 
    "SPENT_SAME_TOKEN" = "SPENT_SAME_TOKEN",
    "SPENT_WRONG_TOKEN" = "SPENT_WRONG_TOKEN", 
    "SPENT_NON_SLP" = "SPENT_NON_SLP",
    "SPENT_INVALID_SLP" = "SPENT_INVALID_SLP"
}

interface SpendDetails {
    status: UtxoStatus;
    txid: string|null;
    queryResponse: TxnQueryResult|null;
}

    // async getTotalBurnedQuantity(): Promise<BigNumber> {
    //     let burned = new BigNumber(0);
        
    //     // Add up the burned quantities resulting from non_slp txns 
    //     this._txnGraph.forEach(txn => {
    //         txn.outputs.forEach(o => {
    //             if(o.status !== UtxoStatus.UNSPENT && o.status !== UtxoStatus.SPENT_SAME_TOKEN)
    //                 burned = burned.plus(o.slpAmount);
    //         })
    //     })

    //     // Add up the amounts burned when SLP outputs is less than SLP inputs
    //     await this.asyncForEach(Array.from(this._txnGraph), async (gtxn: [string, GraphTxn]) => {
    //         //console.log("BURN CALC", gtxn[0])
    //         let txnhex: string;
    //         if(this._slpValidator.cachedRawTransactions[gtxn[0]])
    //             txnhex = this._slpValidator.cachedRawTransactions[gtxn[0]]
    //         else
    //             txnhex = await this._rpcClient.getRawTransaction(gtxn[0])

    //         let txn: Bitcore.Transaction = new bitcore.Transaction(txnhex)
    //         let inputs = txn.inputs.reduce((v, i) => {
    //             if(this._txnGraph.has(i.prevTxId.toString('hex'))) {
    //                 let intxn = this._txnGraph.get(i.prevTxId.toString('hex'))!
    //                 return v.plus(intxn.outputs.filter(o => o.spendTxid === gtxn[0]).reduce((w, j) => w.plus(j.slpAmount), new BigNumber(0)))
    //             }
    //             return v;
    //         }, new BigNumber(0))

    //         let outputs = gtxn[1].outputs.reduce((v, i)=> v.plus(i.slpAmount), new BigNumber(0))
    //         burned = burned.plus(outputs.minus(inputs));
    //     });

    //     return burned;
    // }
