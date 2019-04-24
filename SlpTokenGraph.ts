import { SlpTransactionDetails, SlpTransactionType, LocalValidator, Utils, Validation } from 'slpjs';
import BigNumber from 'bignumber.js';
import { Bitcore, BitcoinRpc } from './vendor';
import BITBOXSDK from 'bitbox-sdk';
import { Config } from './config';
import * as bitcore from 'bitcore-lib-cash';
import { SendTxnQueryResult, MintQueryResult, Query, MintTxnQueryResult } from './query';
import { TxOut } from 'bitbox-sdk/lib/Blockchain';
import { Decimal128 } from 'mongodb';
import { Db } from './db';

const RpcClient = require('bitcoin-rpc-promise')
const BITBOX = new BITBOXSDK();

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export class SlpTokenGraph implements TokenGraph {
    _lastUpdatedBlock!: number;
    _tokenDetails!: SlpTransactionDetails;
    _tokenStats!: TokenStats;
    _tokenUtxos!: Set<string>;
    _mintBatonUtxo!: string;
    _graphTxns!: Map<string, GraphTxn>;
    _addresses!: Map<cashAddr, AddressBalance>;
    _slpValidator!: LocalValidator;
    _rpcClient: BitcoinRpc.RpcClient;
    _network!: string;
    _statisticsUpdateStatus: Set<string>;
    _db: Db;
    _waitingToUpdate: boolean = false;

    constructor(db: Db) {
        let connectionString = 'http://'+ Config.rpc.user+':'+Config.rpc.pass+'@'+Config.rpc.host+':'+Config.rpc.port
        this._rpcClient = <BitcoinRpc.RpcClient>(new RpcClient(connectionString));
        this._slpValidator = new LocalValidator(BITBOX, async (txids) => [ await this._rpcClient.getRawTransaction(txids[0]) ])
        this._statisticsUpdateStatus = new Set<string>();
        this._db = db;
    }

    async initFromScratch(tokenDetails: SlpTransactionDetails) {
        await Query.init();
        this._network = (await this._rpcClient.getInfo()).testnet ? 'testnet': 'mainnet';
        this._lastUpdatedBlock = 0;
        this._tokenDetails = tokenDetails;
        this._tokenUtxos = new Set<string>();
        this._mintBatonUtxo = "";
        this._graphTxns = new Map<string, GraphTxn>();
        this._addresses = new Map<cashAddr, AddressBalance>();

        let valid = await this.updateTokenGraphFrom(tokenDetails.tokenIdHex);
        if(valid) {
            let mints = await Query.getMintTransactions(tokenDetails.tokenIdHex);
            if(mints && mints.length > 0)
                await this.asyncForEach(mints, async (m: MintQueryResult) => await this.updateTokenGraphFrom(m.txid!));
    
            await this.updateAddressesFromScratch();
            await this.initStatistics();
        }
    }

    IsValid(): boolean {
        return this._graphTxns.has(this._tokenDetails.tokenIdHex);
    }

    async asyncForEach(array: any[], callback: Function) {
        for (let index = 0; index < array.length; index++) {
          await callback(array[index], index, array);
        }
    }

    async getMintBatonSpendDetails(txid: string, vout: number, slpOutputLength: number): Promise<MintSpendDetails> {
        let txOut = await this._rpcClient.getTxOut(txid, vout, true);
        if(txOut === null) {
            this._mintBatonUtxo = "";
            try {
                let spendTxnInfo = await Query.queryForTxoInputAsSlpMint(txid, vout);

                if(spendTxnInfo.txid === null) {
                    if(vout < slpOutputLength)
                        return { status: BatonUtxoStatus.BATON_SPENT_NON_SLP, txid: null, queryResponse: null, invalidReason: this._slpValidator.cachedValidations[txid].invalidReason };
                    return { status: BatonUtxoStatus.BATON_MISSING_BCH_VOUT, txid: null, queryResponse: null, invalidReason: "SLP output has no corresponding BCH output." };
                }
                if(typeof spendTxnInfo!.txid === 'string') {
                    let valid = await this._slpValidator.isValidSlpTxid(spendTxnInfo.txid!, this._tokenDetails.tokenIdHex);
                    if(!this._slpValidator.cachedValidations[spendTxnInfo.txid!])
                        console.log('SLP Validator is missing transaction', spendTxnInfo.txid, 'for token', this._tokenDetails.tokenIdHex)
                    if(valid && this._slpValidator.cachedValidations[spendTxnInfo.txid!] && this._slpValidator.cachedValidations[spendTxnInfo.txid!].details!.transactionType === SlpTransactionType.MINT)
                        return { status: BatonUtxoStatus.BATON_SPENT_IN_MINT, txid: spendTxnInfo!.txid, queryResponse: spendTxnInfo, invalidReason: null };
                    else if(valid)
                        return { status: BatonUtxoStatus.BATON_SPENT_NOT_IN_MINT, txid: spendTxnInfo!.txid, queryResponse: spendTxnInfo, invalidReason: "Baton was spent in a non-mint SLP transaction." };
                    return { status: BatonUtxoStatus.BATON_SPENT_NON_SLP, txid: spendTxnInfo!.txid, queryResponse: spendTxnInfo, invalidReason: this._slpValidator.cachedValidations[txid].invalidReason };
                }
            } catch(_) {
                if(vout < slpOutputLength)
                    return { status: BatonUtxoStatus.BATON_SPENT_INVALID_SLP, txid: null, queryResponse: null, invalidReason: this._slpValidator.cachedValidations[txid].invalidReason };
                return { status: BatonUtxoStatus.BATON_MISSING_BCH_VOUT, txid: null, queryResponse: null, invalidReason: "SLP output has no corresponding BCH output." };
            }
        }
        this._mintBatonUtxo = txid + ":" + vout;
        return { status: BatonUtxoStatus.BATON_UNSPENT, txid: null, queryResponse: null, invalidReason: null };
    }

    async getSpendDetails(txid: string, vout: number, slpOutputLength: number): Promise<SpendDetails> {
        let txOut = await this._rpcClient.getTxOut(txid, vout, true);
        if(txOut === null) {
            this._tokenUtxos.delete(txid + ":" + vout);
            try {
                let spendTxnInfo = await Query.queryForTxoInputAsSlpSend(txid, vout);
                if(spendTxnInfo.txid === null) {
                    if(vout < slpOutputLength)
                        return { status: TokenUtxoStatus.SPENT_NON_SLP, txid: null, queryResponse: null, invalidReason: this._slpValidator.cachedValidations[txid].invalidReason };
                    return { status: TokenUtxoStatus.MISSING_BCH_VOUT, txid: null, queryResponse: null, invalidReason: "SLP output has no corresponding BCH output." };
                }
                if(typeof spendTxnInfo!.txid === 'string') {
                    let valid = await this._slpValidator.isValidSlpTxid(spendTxnInfo.txid!, this._tokenDetails.tokenIdHex);
                    if(!this._slpValidator.cachedValidations[spendTxnInfo.txid!])
                        console.log('SLP Validator is missing transaction', spendTxnInfo.txid, 'for token', this._tokenDetails.tokenIdHex)
                    if(valid && this._slpValidator.cachedValidations[spendTxnInfo.txid!] && this._slpValidator.cachedValidations[spendTxnInfo.txid!].details!.transactionType === SlpTransactionType.SEND)
                        return { status: TokenUtxoStatus.SPENT_SAME_TOKEN, txid: spendTxnInfo!.txid, queryResponse: spendTxnInfo, invalidReason: null };
                    else if(valid)
                        return { status: TokenUtxoStatus.SPENT_NOT_IN_SEND, txid: spendTxnInfo!.txid, queryResponse: spendTxnInfo, invalidReason: "Token was not spent in a SEND transaction." }
                    return { status: TokenUtxoStatus.SPENT_INVALID_SLP, txid: spendTxnInfo!.txid, queryResponse: spendTxnInfo, invalidReason: this._slpValidator.cachedValidations[txid].invalidReason };
                }
            } catch(_) {
                if(vout < slpOutputLength)
                    return { status: TokenUtxoStatus.SPENT_INVALID_SLP, txid: null, queryResponse: null, invalidReason: this._slpValidator.cachedValidations[txid].invalidReason };
                return { status: TokenUtxoStatus.MISSING_BCH_VOUT, txid: null, queryResponse: null, invalidReason: "SLP output has no corresponding BCH output." };
            }
        } 
        this._tokenUtxos.add(txid + ":" + vout);
        return { status: TokenUtxoStatus.UNSPENT, txid: null, queryResponse: null, invalidReason: null };
    }

    async updateTokenGraphFrom(txid: string, isParent=false): Promise<boolean> { 
        this._statisticsUpdateStatus.add(txid);       
        if(this._graphTxns.has(txid) && !isParent) {
            this._statisticsUpdateStatus.delete(txid);       
            return true;
        }

        let isValid = await this._slpValidator.isValidSlpTxid(txid, this._tokenDetails.tokenIdHex);
        let txnSlpDetails = this._slpValidator.cachedValidations[txid].details;
        let txn: Bitcore.Transaction = new bitcore.Transaction(this._slpValidator.cachedRawTransactions[txid])

        if (!isValid) {
            console.log("Not valid token transaction:", txid);
            this._statisticsUpdateStatus.delete(txid);       
            return false;
        }

        if(!txnSlpDetails) {
            console.log("No token details for:", txid);
            this._statisticsUpdateStatus.delete(txid);       
            return false;
        }

        let graphTxn: GraphTxn;
        if(!this._graphTxns.has(txid))
            graphTxn = { details: txnSlpDetails, outputs: [], block: null }
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
        let txq: any = await Query.getSendTransactionDetails(txid);
        if(txq) {
            graphTxn.block = txq.block;
        }

        // Create SLP graph outputs for each new valid SLP output
        if(isValid && (graphTxn.details.transactionType === SlpTransactionType.GENESIS || graphTxn.details.transactionType === SlpTransactionType.MINT)) {
            if(graphTxn.details.genesisOrMintQuantity!.isGreaterThanOrEqualTo(0)) {
                let spendDetails = await this.getSpendDetails(txid, 1, txn.outputs.length);
                let address;
                try { address = Utils.toSlpAddress(BITBOX.Address.fromOutputScript(txn.outputs[1]._scriptBuffer, this._network))
                } catch(_) { address = "unknown address type or missing address output"; }
                graphTxn.outputs.push({
                    address: address,
                    vout: 1,
                    bchSatoshis: txn.outputs.length > 1 ? txn.outputs[1].satoshis : 0, 
                    slpAmount: <any>graphTxn.details.genesisOrMintQuantity!,
                    spendTxid: spendDetails.txid,
                    status: spendDetails.status,
                    invalidReason: spendDetails.invalidReason
                })
                if(txnSlpDetails.batonVout) {
                    let mintSpendDetails = await this.getMintBatonSpendDetails(txid, txnSlpDetails.batonVout, txn.outputs.length);
                    let address;
                    try { address = Utils.toSlpAddress(BITBOX.Address.fromOutputScript(txn.outputs[1]._scriptBuffer, this._network))
                    } catch(_) { address = "unknown address type or missing address output"; }
                    graphTxn.outputs.push({
                        address: address,
                        vout: txnSlpDetails.batonVout,
                        bchSatoshis: txnSlpDetails.batonVout < txn.outputs.length ? txn.outputs[txnSlpDetails.batonVout].satoshis : 0, 
                        slpAmount: new BigNumber(0),
                        spendTxid: mintSpendDetails.txid,
                        status: mintSpendDetails.status,
                        invalidReason: mintSpendDetails.invalidReason
                    })
                }
            }
        }
        else if(isValid && graphTxn.details.sendOutputs!.length > 0) {
            await this.asyncForEach(graphTxn.details.sendOutputs!, async (output: BigNumber, slp_vout: number) => { 
                if(output.isGreaterThanOrEqualTo(0)) {
                    if(slp_vout > 0) {
                        let spendDetails = await this.getSpendDetails(txid, slp_vout, txn.outputs.length);
                        let address;
                        try { address = Utils.toSlpAddress(BITBOX.Address.fromOutputScript(txn.outputs[slp_vout]._scriptBuffer, this._network))
                        } catch(_) { address = "unknown address type or missing address output"; }
                        graphTxn.outputs.push({
                            address: address,
                            vout: slp_vout,
                            bchSatoshis: slp_vout < txn.outputs.length ? txn.outputs[slp_vout].satoshis : 0, 
                            slpAmount: <any>graphTxn.details.sendOutputs![slp_vout],
                            spendTxid: spendDetails.txid,
                            status: spendDetails.status,
                            invalidReason: spendDetails.invalidReason
                        })
                    }
                }
            })
        }
        else {
            console.log("[WARNING]: Transaction is not valid or is unknown token type!", txid);
        }

        // Continue to complete graph from output UTXOs
        if(!isParent) {
            await this.asyncForEach(graphTxn.outputs.filter(o => o.spendTxid && (o.status === TokenUtxoStatus.SPENT_SAME_TOKEN || o.status === BatonUtxoStatus.BATON_SPENT_IN_MINT)), async (o: any) => {
                await this.updateTokenGraphFrom(o.spendTxid!);
            });
        }

        this._graphTxns.set(txid, graphTxn);
        this._lastUpdatedBlock = await this._rpcClient.getBlockCount();
        this._statisticsUpdateStatus.delete(txid);       
        return true;
    }

    async updateAddressesFromScratch(): Promise<void> {
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

    async initStatistics(): Promise<void> {
        this._tokenStats = <TokenStats> {
            block_created: await Query.queryTokenGenesisBlock(this._tokenDetails.tokenIdHex),
            block_last_active_mint: await Query.blockLastMinted(this._tokenDetails.tokenIdHex),
            block_last_active_send: await Query.blockLastSent(this._tokenDetails.tokenIdHex),
            qty_valid_txns_since_genesis: this._graphTxns.size,
            qty_valid_token_utxos: this._tokenUtxos.size,
            qty_valid_token_addresses: this._addresses.size,
            qty_token_minted: await this.getTotalMintQuantity(),
            qty_token_burned: new BigNumber(0),
            qty_token_circulating_supply: this.getTotalHeldByAddresses(),
            qty_satoshis_locked_up: this.getTotalSatoshisLockedUp(),
            minting_baton_status: await this.getBatonStatus()
        }

        this._tokenStats.qty_token_burned = this._tokenStats.qty_token_minted.minus(this._tokenStats.qty_token_circulating_supply)
    }

    async getBatonStatus(): Promise<TokenBatonStatus> {
        //console.log("DETAILS 2", this._tokenDetails);
        //console.log("get baton", this._tokenDetails.tokenIdHex);
        //console.log("baton", this._tokenDetails.batonVout);
        if(!this._tokenDetails.containsBaton)
            return TokenBatonStatus.NEVER_CREATED;
        else if(this._tokenDetails.containsBaton === true) {
            if(this._mintBatonUtxo.includes(this._tokenDetails.tokenIdHex + ":" + this._tokenDetails.batonVout))
                return TokenBatonStatus.ALIVE;
            //let mints = await Query.getMintTransactions(this._tokenDetails.tokenIdHex);
            let mintTxids = Array.from(this._graphTxns).filter(o => o[1].details.transactionType === SlpTransactionType.MINT).map(o => o[0]);
            let mints = mintTxids.map(i => this._slpValidator.cachedValidations[i])
            if(mints) {
                for(let i = 0; i < mints!.length; i++) {
                    console.log(mints[i])
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

    async updateStatistics(): Promise<void> {
        await this.updateAddressesFromScratch();

        if(!this._tokenStats)
            await this.initStatistics();
        else {
            let minted = await this.getTotalMintQuantity();
            let addressesTotal = this.getTotalHeldByAddresses()
            this._tokenStats.block_last_active_mint = await Query.blockLastMinted(this._tokenDetails.tokenIdHex),
            this._tokenStats.block_last_active_send = await Query.blockLastSent(this._tokenDetails.tokenIdHex),
            this._tokenStats.qty_valid_token_addresses = this._addresses.size;
            this._tokenStats.qty_valid_token_utxos = this._tokenUtxos.size;
            this._tokenStats.qty_valid_txns_since_genesis = this._graphTxns.size;
            this._tokenStats.qty_token_minted = minted;
            this._tokenStats.qty_token_circulating_supply = addressesTotal;
            this._tokenStats.qty_token_burned = minted.minus(addressesTotal);
            this._tokenStats.qty_satoshis_locked_up = this.getTotalSatoshisLockedUp();
            this._tokenStats.minting_baton_status = await this.getBatonStatus();
        }


        
        if(this._tokenStats.qty_token_circulating_supply.isGreaterThan(this._tokenStats.qty_token_minted)) {
            console.log("[ERROR] Cannot have circulating supply larger than mint quantity.");
            console.log("[INFO] Statistics will be recomputed after transaction queue is cleared.");
            this.updateStatsAfterQueueIsCleared();
        }

        if(!this._tokenStats.qty_token_circulating_supply.isEqualTo(this._tokenStats.qty_token_minted.minus(this._tokenStats.qty_token_burned))) {
            console.log("[WARN] Circulating supply minus burn quantity does not equal minted quantity");
        }

        await this._db.tokeninsertreplace(this.toTokenDbObject());
        await this._db.addressinsertreplace(this.toAddressesDbObject());
        await this._db.graphinsertreplace(this.toGraphDbObject());
        await this._db.utxoinsertreplace(this.toUtxosDbObject());

        if(this._statisticsUpdateStatus.size === 0) {
            console.log("########################################################################################################")
            console.log("TOKEN STATS/ADDRESSES FOR", this._tokenDetails.name, this._tokenDetails.tokenIdHex)
            console.log("########################################################################################################")
            this.logTokenStats();
            this.logAddressBalances();
        }
    }

    async updateStatsAfterQueueIsCleared() {
        if(!this._waitingToUpdate) {
            while(this._statisticsUpdateStatus.size > 0) {
                this._waitingToUpdate = true;
                await sleep(250);
            }
            this._waitingToUpdate = false;
            await this.updateStatistics();
            console.log("Statistics updated since token graph was being updated.")
        }
    }

    logTokenStats(): void {
        //await this.updateStatistics();
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
        console.log(Array.from(this._addresses).map((v) => { return { addr: v[0], bal: v[1].token_balance.dividedBy(10**this._tokenDetails.decimals).toFixed() }}))
    }

    toTokenDbObject(): TokenDBObject {
        let tokenDetails = SlpTokenGraph.MapTokenDetailsToDbo(this._tokenDetails, this._tokenDetails.decimals);

        let result = {
            schema_version: Config.db.schema_version,
            lastUpdatedBlock: this._lastUpdatedBlock,
            tokenDetails: tokenDetails,
            mintBatonUtxo: this._mintBatonUtxo,
            tokenStats: this.mapTokenStatstoDbo(this._tokenStats),
        }
        return result;
    }

    toAddressesDbObject(): AddressBalancesDbo[] {
        let tokenDetails = SlpTokenGraph.MapTokenDetailsToDbo(this._tokenDetails, this._tokenDetails.decimals);
        let result: AddressBalancesDbo[] = [];
        Array.from(this._addresses).forEach(a => { result.push({ tokenDetails: { tokenIdHex: tokenDetails.tokenIdHex }, address: a[0], satoshis_balance: a[1].satoshis_balance, token_balance: Decimal128.fromString(a[1].token_balance.dividedBy(10**this._tokenDetails.decimals).toFixed()) }) })
        return result;
    }

    toUtxosDbObject(): UtxoDbo[] {
        let tokenDetails = SlpTokenGraph.MapTokenDetailsToDbo(this._tokenDetails, this._tokenDetails.decimals);
        let result: UtxoDbo[] = [];
        Array.from(this._tokenUtxos).forEach(u => { result.push({ tokenDetails: { tokenIdHex: tokenDetails.tokenIdHex }, utxo: u })});
        return result;
    }

    toGraphDbObject(): GraphTxnDbo[] {
        let tokenDetails = SlpTokenGraph.MapTokenDetailsToDbo(this._tokenDetails, this._tokenDetails.decimals);
        let result: GraphTxnDbo[] = [];
        Array.from(this._graphTxns).forEach(k => {
            result.push({
                tokenDetails: { tokenIdHex: tokenDetails.tokenIdHex }, 
                graphTxn: {
                    txid: k[0],
                    block: k[1].block,
                    details: SlpTokenGraph.MapTokenDetailsToDbo(this._graphTxns.get(k[0])!.details, this._tokenDetails.decimals),
                    outputs: this.mapGraphTxnOutputsToDbo(this._graphTxns.get(k[0])!.outputs)
                }
            })
        });
        return result;
    }

    mapGraphTxnOutputsToDbo(outputs: GraphTxnOutput[]): GraphTxnOutputDbo[] {
        let mapped: GraphTxnDetailsDbo["outputs"] = [];
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

    mapTokenStatstoDbo(stats: TokenStats): TokenStatsDbo {
        return {
            block_created: stats.block_created,
            block_last_active_send: stats.block_last_active_send,
            block_last_active_mint: stats.block_last_active_mint,
            qty_valid_txns_since_genesis: stats.qty_valid_txns_since_genesis,
            qty_valid_token_utxos: stats.qty_valid_token_utxos,
            qty_valid_token_addresses: stats.qty_valid_token_addresses,
            qty_token_minted: Decimal128.fromString(stats.qty_token_minted.dividedBy(10**this._tokenDetails.decimals).toFixed()),
            qty_token_burned: Decimal128.fromString(stats.qty_token_burned.dividedBy(10**this._tokenDetails.decimals).toFixed()),
            qty_token_circulating_supply: Decimal128.fromString(stats.qty_token_circulating_supply.dividedBy(10**this._tokenDetails.decimals).toFixed()),
            qty_satoshis_locked_up: stats.qty_satoshis_locked_up,
            minting_baton_status: stats.minting_baton_status
        }
    }

    static MapTokenDetailsToDbo(details: SlpTransactionDetails, decimals: number): SlpTransactionDetailsDbo {
        let res: SlpTransactionDetailsDbo = {
            decimals: details.decimals,
            tokenIdHex: details.tokenIdHex,
            timestamp: details.timestamp,
            timestamp_unix: this.ConvertToUnixTime(details.timestamp),
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

    static async FromDbObjects(token: TokenDBObject, dag: GraphTxnDbo[], utxos: UtxoDbo[], addresses: AddressBalancesDbo[], db: Db): Promise<SlpTokenGraph> {
        let tg = new SlpTokenGraph(db);
        await Query.init();
        tg._mintBatonUtxo = token.mintBatonUtxo;
        tg._network = (await tg._rpcClient.getInfo()).testnet ? 'testnet': 'mainnet';

        // Map _tokenDetails
        tg._tokenDetails = this.MapDbTokenDetailsFromDbo(token.tokenDetails, token.tokenDetails.decimals);

        // Map _txnGraph
        tg._graphTxns = new Map<txid, GraphTxn>();
        dag.forEach((item, idx) => {
            try { dag[idx].graphTxn.outputs.map(o => o.slpAmount = <any>new BigNumber(o.slpAmount.toString()).multipliedBy(10**tg._tokenDetails.decimals)) } catch(_) { throw Error("Error in mapping database object"); }

            let gt: GraphTxn = {
                block: item.graphTxn.block,
                details: this.MapDbTokenDetailsFromDbo(dag[idx].graphTxn.details, token.tokenDetails.decimals),
                outputs: dag[idx].graphTxn.outputs as any as GraphTxnOutput[]
            }

            tg._graphTxns.set(item.graphTxn.txid, gt);
        })

        // Preload SlpValidator with cachedValidations
        let txids = Array.from(tg._graphTxns.keys());
        //console.log(tg._slpValidator.cachedValidations);
        txids.forEach(txid => {
            let validation = <Validation>{ validity: null, details: null, invalidReason: "", parents: [] }
            validation.validity = tg._graphTxns.get(txid) ? true : false;
            validation.details = tg._graphTxns.get(txid)!.details;
            if(!validation.details)
                throw Error("No saved details about transaction" + txid);
            //console.log("DETAILS", validation.details);
            //try { tg._slpValidator.cachedValidations[txid].validity = validity } catch(err){ console.log(err.message); }
            //if(validation.validity === true || validation.validity === false)
                //console.log("Validation", validation.validity);
            tg._slpValidator.cachedValidations[txid] = validation;
        });

        // Map _addresses
        tg._addresses = new Map<string, AddressBalance>();
        addresses.forEach((item, idx) => {
            tg._addresses.set(item.address, {
                satoshis_balance: addresses[idx].satoshis_balance, 
                token_balance: (new BigNumber(addresses[idx].token_balance.toString())).multipliedBy(10**tg._tokenDetails.decimals)
            });
        });


        // Map _lastUpdatedBlock
        tg._lastUpdatedBlock = token.lastUpdatedBlock;

        // Map _tokenUtxos
        tg._tokenUtxos = new Set(utxos.map(u => u.utxo));

        await tg.updateStatistics();

        return tg;
    }
}

export interface TokenGraph {
    _tokenDetails: SlpTransactionDetails;
    _tokenStats: TokenStats;
    _tokenUtxos: Set<string>;
    _mintBatonUtxo: string;
    _graphTxns: Map<txid, GraphTxn>;
    _addresses: Map<cashAddr, AddressBalance>;
    updateTokenGraphFrom(txid: string): Promise<boolean>;
    initStatistics(): Promise<void>;
}

export interface AddressBalance {
    token_balance: BigNumber, satoshis_balance: number
}

export interface TokenDBObject {
    schema_version: number;
    tokenDetails: SlpTransactionDetailsDbo;
    tokenStats: TokenStats | TokenStatsDbo;
    mintBatonUtxo: string;
    lastUpdatedBlock: number;
}

export interface GraphTxnDbo {
    tokenDetails: { tokenIdHex: string };
    graphTxn: GraphTxnDetailsDbo;
}

export interface UtxoDbo {
    tokenDetails: { tokenIdHex: string };
    utxo: string;
}

export interface AddressBalancesDbo {
    tokenDetails: { tokenIdHex: string };
    address: cashAddr;
    satoshis_balance: number;
    token_balance: Decimal128;
}

export interface SlpTransactionDetailsDbo {
    transactionType: SlpTransactionType;
    tokenIdHex: string;
    versionType: number;
    timestamp: string|null;
    timestamp_unix: number|null;
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

interface GraphTxnDetailsDbo {
    txid: string,
    details: SlpTransactionDetailsDbo;
    block: number|null;
    outputs: GraphTxnOutputDbo[]
}

interface GraphTxnOutputDbo { 
    address: string,
    vout: number, 
    bchSatoshis: number, 
    slpAmount: Decimal128, 
    spendTxid: string | null,
    status: TokenUtxoStatus|BatonUtxoStatus,
    invalidReason: string | null
}

interface GraphTxn {
    details: SlpTransactionDetails;
    block: number|null;
    outputs: GraphTxnOutput[]
}

interface GraphTxnOutput { 
    address: string,
    vout: number, 
    bchSatoshis: number, 
    slpAmount: BigNumber, 
    spendTxid: string | null,
    status: TokenUtxoStatus|BatonUtxoStatus,
    invalidReason: string | null
 }

type txid = string;
type cashAddr = string;

interface TokenStats {
    block_created: number|null;
    block_last_active_send: number|null;
    block_last_active_mint: number|null;
    qty_valid_txns_since_genesis: number;
    qty_valid_token_utxos: number;
    qty_valid_token_addresses: number;
    qty_token_minted: BigNumber;
    qty_token_burned: BigNumber;
    qty_token_circulating_supply: BigNumber;
    qty_satoshis_locked_up: number;
    minting_baton_status: TokenBatonStatus;
}

interface TokenStatsDbo {
    block_created: number|null;
    block_last_active_send: number|null;
    block_last_active_mint: number|null;
    qty_valid_txns_since_genesis: number;
    qty_valid_token_utxos: number;
    qty_valid_token_addresses: number;
    qty_token_minted: Decimal128;
    qty_token_burned: Decimal128;
    qty_token_circulating_supply: Decimal128;
    qty_satoshis_locked_up: number;
    minting_baton_status: TokenBatonStatus;
}

enum TokenUtxoStatus {
    "UNSPENT" = "UNSPENT", 
    "SPENT_SAME_TOKEN" = "SPENT_SAME_TOKEN",
    "SPENT_WRONG_TOKEN" = "SPENT_WRONG_TOKEN",
    "SPENT_NOT_IN_SEND" = "SPENT_NOT_IN_SEND",
    "SPENT_NON_SLP" = "SPENT_NON_SLP",
    "SPENT_INVALID_SLP" = "SPENT_INVALID_SLP",
    "MISSING_BCH_VOUT" = "MISSING_BCH_VOUT"
}

enum BatonUtxoStatus {
    "BATON_UNSPENT" = "BATON_UNSPENT", 
    "BATON_SPENT_IN_MINT" = "BATON_SPENT_IN_MINT",
    "BATON_SPENT_NOT_IN_MINT" = "BATON_SPENT_NOT_IN_MINT", 
    "BATON_SPENT_NON_SLP" = "BATON_SPENT_NON_SLP",
    "BATON_SPENT_INVALID_SLP" = "BATON_SPENT_INVALID_SLP",
    "BATON_MISSING_BCH_VOUT" = "BATON_MISSING_BCH_VOUT"
}

enum TokenBatonStatus {
    "NEVER_CREATED" = "NEVER_CREATED",
    "ALIVE" = "ALIVE",
    "DEAD_BURNED" = "DEAD_BURNED",
    "DEAD_ENDED" = "DEAD_ENDED"
}

interface SpendDetails {
    status: TokenUtxoStatus;
    txid: string|null;
    queryResponse: SendTxnQueryResult|null;
    invalidReason: string|null;
}

interface MintSpendDetails {
    status: BatonUtxoStatus;
    txid: string|null;
    queryResponse: SendTxnQueryResult|MintTxnQueryResult|null;
    invalidReason: string|null;
}
