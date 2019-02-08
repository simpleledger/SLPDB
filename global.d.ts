import { runInThisContext } from "vm";

export interface BitcoinRpcClient {
    getBlockHash(block_index: number): string;
    getBlock(hash: string): RpcBlockInfo;
    getBlock(hash: string, verbose: boolean): string;
    getBlockCount(): number;
    getRawTransaction(hash: string): string;
    getRawMemPool(): any;
    getrawmempool(): any;
}

export interface RpcBlockInfo {
    hash: string;
    confirmations: number;
    size: number;
    height: number;
    version: number;
    versionHex: string;
    merkleroot: string;
    tx: string[];
    time: string;
    mediantime: number;
    nonce: number;
    bits: string;
    difficulty: number;
    chainwork: string;
    nextblockhash: string;
    previousblockhash: string;
}

export declare module Bitcore {
    export interface TxnInput {
        script: Script;
        _scriptBuffer: Buffer;
        prevTxId: Buffer;
        outputIndex: number;
        sequenceNumber: number;
    }

    export interface Script {
        fromBuffer(buffer: Buffer): Script;
        toBuffer(): Buffer;
        toAddress(network: any): Address;
        fromAddress(address: Address): Script;
        fromString(hex: string): Script;
        fromASM(asm: string): string;
        toASM(): string;
        fromHex(hex: string): string
        toHex(): string;
        chunks: Chunk[];
    }

    export interface Chunk {
        buf: Buffer;
        len: number;
        opcodenum: number;
    }
    
    export interface TxnOutput {
        _scriptBuffer: Buffer;
        script: Script;
        satoshis: number;
    }
    
    export interface Transaction {
        inputs: TxnInput[];
        outputs: TxnOutput[];
        toObject(): any;
    }

    export interface Networks {
        livenet: any;
    }

    export interface Address {
        toString(format: string): string;
    }
}

export interface SlpTransaction {

}