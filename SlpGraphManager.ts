import { SlpTokenGraph } from "./SlpTokenGraph";
import { SlpTransactionDetails, SlpTransactionType, Slp } from "slpjs";
import BigNumber from "bignumber.js";
import { IZmqSubscriber, SyncCompletionInfo, SyncFilterTypes } from "./bit";
import BITBOXSDK from 'bitbox-sdk/lib/bitbox-sdk';
import * as bitcore from 'bitcore-lib-cash';

const bitqueryd = require('fountainhead-bitqueryd')

const BITBOX = new BITBOXSDK();
const slp = new Slp(BITBOX);

export class SlpGraphManager implements IZmqSubscriber {
    onBlockHash: undefined;
    async onTransactionHash(syncResult: SyncCompletionInfo): Promise<void> {
        // check to see if the transaction is a token, if so then get its tokenId.
        //console.log("GRAPH MANAGER RECEIVED SYNC RESULT");
        if(syncResult) {
            syncResult.filteredContent.get(SyncFilterTypes.SLP)!.forEach((txhex, txid) =>
            {
                //console.log("PROCESSING SLP GRAPH UPDATE...");
                //console.log(syncResult.filteredContent.get(SyncFilterTypes.SLP))
                let tokenId: string;
                let txn = new bitcore.Transaction(txhex);
                let slpMsg = slp.parseSlpOutputScript(txn.outputs[0]._scriptBuffer);
                if(slpMsg.transactionType === SlpTransactionType.GENESIS) {
                    tokenId = txn.id;
                }
                else {
                    tokenId = slpMsg.tokenIdHex;
                }
    
                if(!this._tokens.has(tokenId)) {
                    //console.log("ADDING NEW GRAPH FOR:", tokenId);
                    //console.log(slpMsg);
                    let graph = new SlpTokenGraph();
                    graph.init(tokenId);
                    this._tokens.set(tokenId, graph)
                }
                else {
                    //console.log("UPDATING GRAPH FOR:", tokenId);
                    this._tokens.get(tokenId)!.updateTokenGraphFrom(txid);
                }
            })
            //this._tokens.forEach(token => token.updateTokenGraphFrom(txHash));
        }
    }

    _tokens!: Map<string, SlpTokenGraph>;
    //rpcClient: BitcoinRpc.RpcClient;

    constructor() {
        this._tokens = new Map<string, SlpTokenGraph>();
    }

    async initFromScratch() {
        let tokens = await this.getTokensList();

        for (let index = 0; index < tokens.length; index++) {
            let tokenDetails = this.mapSlpTokenDetails(tokens[index]);
            let graph = new SlpTokenGraph();
            await graph.init(tokenDetails.tokenIdHex);
            this._tokens.set(tokens[index].tokenIdHex, graph);
        }
    }

    async getTokensList() {
        let q = {
            "v": 3,
            "q": {
              "find": { "out.h1": "534c5000", "out.s3": "GENESIS" },
              "limit": 10000,
            },
            "r": { "f": "[ .[] | { tokenIdHex: .tx.h, versionTypeHex: .out[0].h2, timestamp: (if .blk? then (.blk.t | strftime(\"%Y-%m-%d %H:%M\")) else null end), symbol: .out[0].s4, name: .out[0].s5, documentUri: .out[0].s6, documentSha256Hex: .out[0].h7, decimalsHex: .out[0].h8, batonHex: .out[0].h9, quantityHex: .out[0].h10 } ]" }
        }

        let db = await bitqueryd.init();
        let response: GenesisQueryResult | any = await db.read(q);
        console.log(response);
        let tokens: GenesisQueryResult[] = [].concat(response.u).concat(response.c);
        return tokens;
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
