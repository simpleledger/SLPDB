import { BlockItem } from "./db";
import { runInThisContext } from "vm";

export interface BitcoinRpcClient {
    getBlockHash(block_index: number): string;
    getBlock(hash: string): BlockItem;
    getBlockCount(): number;
    getRawTransaction(hash: string): string;
    getRawMemPool(): any;
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