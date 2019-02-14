import { SlpTokenGraph } from "./SlpTokenGraph";
import { SlpTransactionDetails, SlpTransactionType } from "slpjs";
import BigNumber from "bignumber.js";

var bitqueryd = require('fountainhead-bitqueryd')

export class SlpGraphManager {
    _tokens!: Map<string, SlpTokenGraph>;
    //rpcClient: BitcoinRpc.RpcClient;

    constructor() {
        this._tokens = new Map<string, SlpTokenGraph>();
    }

    async init() {
        await this.getTokensList();
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

        // TODO get with mongoDb if token document is already stored.
        // if no token document exists then build from scratch

        for (let index = 0; index < tokens.length; index++) {
            let tokenDetails = this.mapSlpTokenDetails(tokens[index]);
            console.log("STARTING GRAPH FOR:", tokenDetails);
            let graph = new SlpTokenGraph(tokenDetails);
            //graph.init(this.rpcClient.getRawTransaction, this.rpcClient.getTxOut);
            await graph.updateTokenGraphFrom(tokenDetails.tokenIdHex);
            this._tokens.set(tokens[index].tokenIdHex, graph);
        }

        console.log(this._tokens);
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
