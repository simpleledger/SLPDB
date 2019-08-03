import { Config } from "./config";
import { VerboseRawTransactionResult, TxOutResult, NodeInfoResult, BlockchainInfoResult, BlockDetailsResult } from "bitcoin-com-rest";

const _rpcClient = require('bitcoin-rpc-promise');
const connectionString = 'http://' + Config.rpc.user + ':' + Config.rpc.pass + '@' + Config.rpc.host + ':' + Config.rpc.port
const rpc = new _rpcClient(connectionString);

export class RpcClient {
    async getRawTransaction(hash: string, verbose?: number): Promise<string|VerboseRawTransactionResult> { 
        console.log("[INFO] JSON RPC: getRawTransaction", hash, verbose);
        if(verbose)
            return await rpc.getRawTransaction(hash, verbose);
        return await rpc.getRawTransaction(hash);
    }

    async getBlockHash(block_index: number): Promise<string> {
        console.log("[INFO] JSON RPC: getBlockHash", block_index);
        return await rpc.getBlockHash(block_index);
    }

    async getBlock(hash: string, verbose?: boolean): Promise<string|BlockDetailsResult>{
        console.log("[INFO] JSON RPC: getBlock", hash, verbose);
        if(verbose === false)
            return await rpc.getBlock(hash, 0);
        return <BlockDetailsResult>await rpc.getBlock(hash);
    }

    async getBlockCount(): Promise<number> {
        console.log("[INFO] JSON RPC: getBlockCount")
        return await rpc.getBlockCount();
    }

    async getRawMemPool(): Promise<string[]> {
        console.log("[INFO] JSON RPC: getRawMemPool")
        return await rpc.getRawMemPool();
    }

    async getTxOut(hash: string, vout: number, includemempool: boolean): Promise<TxOutResult|null> {
        console.log("[INFO] JSON RPC: getTxOut", hash, vout, includemempool);
        return await rpc.getTxOut(hash, vout, includemempool);
    }

    // DO NOT USE, THIS IS DEPRECIATED ON SOME NODES
    // async getInfo(): Promise<NodeInfoResult> {
    //     console.log("[INFO] JSON RPC: getInfo")
    //     return await rpc.getInfo();
    // }

    async getBlockchainInfo(): Promise<BlockchainInfoResult> {
        console.log("[INFO] JSON RPC: getBlockchainInfo")
        return await rpc.getBlockchainInfo();
    }
}
