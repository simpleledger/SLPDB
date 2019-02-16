import { SlpTokenGraph } from "./SlpTokenGraph";
import { SlpTransactionDetails, SlpTransactionType, Slp } from "slpjs";
import BigNumber from "bignumber.js";
import { IZmqSubscriber, SyncCompletionInfo, SyncFilterTypes } from "./bit";
import BITBOXSDK from 'bitbox-sdk/lib/bitbox-sdk';
import * as bitcore from 'bitcore-lib-cash';

const bitqueryd = require('fountainhead-bitqueryd')

const BITBOX = new BITBOXSDK();
const slp = new Slp(BITBOX);

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export class SlpGraphManager implements IZmqSubscriber {
    onBlockHash: undefined;
    async onTransactionHash(syncResult: SyncCompletionInfo): Promise<void> {
        // check to see if the transaction is a token, if so then get its tokenId.
        console.log("GRAPH MANAGER RECEIVED SYNC RESULT");
        if(syncResult) {
            let txns = Array.from(syncResult.filteredContent.get(SyncFilterTypes.SLP)!)
            await this.asyncForEach(txns, async (txPair: [string, string], index: number) =>
            {
                //await sleep(5000);
                console.log("PROCESSING SLP GRAPH UPDATE...");
                let tokenId: string;
                console.log("SLP TXID", txPair[0]);
                console.log("SLP TXHEX", txPair[1]);
                let txn = new bitcore.Transaction(txPair[1]);
                let slpMsg = slp.parseSlpOutputScript(txn.outputs[0]._scriptBuffer);
                if(slpMsg.transactionType === SlpTransactionType.GENESIS) {
                    tokenId = txn.id;
                }
                else {
                    tokenId = slpMsg.tokenIdHex;
                }
    
                if(!this._tokens.has(tokenId)) {
                    console.log("ADDING NEW GRAPH FOR:", tokenId);
                    //console.log(slpMsg);
                    let tokenDetails = await this.getTokenDetails(tokenId);
                    if(tokenDetails) {
                        let graph = new SlpTokenGraph();
                        graph.init(tokenDetails);
                        this._tokens.set(tokenId, graph)
                    }
                    else {
                        //console.log("Skipping: No token details are available for this token")
                    }

                }
                else {
                    //console.log("UPDATING GRAPH FOR:", tokenId);
                    await this._tokens.get(tokenId)!.updateTokenGraphFrom(txPair[0]);
                    await this._tokens.get(tokenId)!.updateStatistics();

                    console.log("########################################################################################################")
                    console.log("TOKEN STATS/ADDRESSES FOR", this._tokens.get(tokenId)!.tokenDetails.name, this._tokens.get(tokenId)!.tokenDetails.tokenIdHex)
                    console.log("########################################################################################################")
                    console.log(this._tokens.get(tokenId)!.getTokenStats())
                    console.log(this._tokens.get(tokenId)!.getAddresses())
                }
            })
            //this._tokens.forEach(token => token.updateTokenGraphFrom(txHash));
        }
    }

    async asyncForEach(array: any[], callback: Function) {
        for (let index = 0; index < array.length; index++) {
          await callback(array[index], index, array);
        }
    }

    _tokens!: Map<string, SlpTokenGraph>;
    //rpcClient: BitcoinRpc.RpcClient;

    constructor() {
        this._tokens = new Map<string, SlpTokenGraph>();
    }

    async initFromScratch() {
        let tokens = await this.getTokensList();
        console.log(tokens);

        for (let index = 0; index < tokens.length; index++) {
            let graph = new SlpTokenGraph();
            console.log("########################################################################################################")
            console.log("NEW GRAPH FOR", tokens[index].tokenIdHex)
            console.log("########################################################################################################")
            await graph.init(tokens[index]);
            this._tokens.set(tokens[index].tokenIdHex, graph);
        }

        for (let index = 0; index < tokens.length; index++) {
            console.log("########################################################################################################")
            console.log("TOKEN STATS FOR", tokens[index].name, tokens[index].tokenIdHex)
            console.log("########################################################################################################")
            console.log(this._tokens.get(tokens[index].tokenIdHex)!.getTokenStats())
        }
    }

    async getTokensList(): Promise<SlpTransactionDetails[]> {
        let q = {
            "v": 3,
            "q": {
              "find": { "out.h1": "534c5000", "out.s3": "GENESIS" },
              //"limit": 2
            },
            "r": { "f": "[ .[] | { tokenIdHex: .tx.h, versionTypeHex: .out[0].h2, timestamp: (if .blk? then (.blk.t | strftime(\"%Y-%m-%d %H:%M\")) else null end), symbol: .out[0].s4, name: .out[0].s5, documentUri: .out[0].s6, documentSha256Hex: .out[0].h7, decimalsHex: .out[0].h8, batonHex: .out[0].h9, quantityHex: .out[0].h10 } ]" }
        }

        let db = await bitqueryd.init();
        let response: GenesisQueryResult | any = await db.read(q);
        let tokens: GenesisQueryResult[] = [].concat(response.u).concat(response.c);
        //console.log(response);
        return tokens.map(t => this.mapSlpTokenDetails(t));
    }

    async getTokenDetails(tokenIdHex: string): Promise<SlpTransactionDetails|null> {
        let q = {
            "v": 3,
            "q": {
                "find": { "tx.h": tokenIdHex, "out.h1": "534c5000", "out.s3": "GENESIS" }
            },
            "r": { "f": "[ .[] | { tokenIdHex: .tx.h, versionTypeHex: .out[0].h2, timestamp: (if .blk? then (.blk.t | strftime(\"%Y-%m-%d %H:%M\")) else null end), symbol: .out[0].s4, name: .out[0].s5, documentUri: .out[0].s6, documentSha256Hex: .out[0].h7, decimalsHex: .out[0].h8, batonHex: .out[0].h9, quantityHex: .out[0].h10 } ]" }
        }

        let db = await bitqueryd.init();
        let response: GenesisQueryResult | any = await db.read(q);
        console.log(response);
        let tokens: GenesisQueryResult[] = [].concat(response.u).concat(response.c);
        return tokens.length === 1 ? tokens.map(t => this.mapSlpTokenDetails(t))[0] : null;
    }

    mapSlpTokenDetails(res: GenesisQueryResult): SlpTransactionDetails {
        let baton: number = parseInt(res.decimalsHex, 16);
        let qtyBuf = Buffer.from(res.quantityHex, 'hex');
        let qty: BigNumber = (new BigNumber(qtyBuf.readUInt32BE(0).toString())).multipliedBy(2**32).plus(qtyBuf.readUInt32BE(4).toString())
        return {
            tokenIdHex: res.tokenIdHex,
            timestamp: <string>res.timestamp,
            transactionType: SlpTransactionType.GENESIS,
            versionType: parseInt(res.versionTypeHex, 16),
            documentUri: res.documentUri,
            documentSha256: Buffer.from(res.documentSha256Hex, 'hex'),
            symbol: res.symbol, 
            name: res.name, 
            batonVout: baton,
            decimals: parseInt(res.decimalsHex, 16),
            containsBaton: baton > 1 && baton < 256 ? true : false,
            genesisOrMintQuantity: qty
        }
    }
}

interface GenesisQueryResult {
    tokenIdHex: string;
    versionTypeHex: string;
    timestamp: string|null;
    symbol: string;
    name: string;
    documentUri: string;
    documentSha256Hex: string; 
    decimalsHex: string;
    batonHex: string;
    quantityHex: string;
}
