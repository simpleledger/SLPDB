import { VerboseRawTransactionResult } from 'bitcoin-com-rest'
import { BITBOX } from 'bitbox-sdk';
import { BlockchainInfoResult, TxOutResult } from 'bitcoin-com-rest';
import { NodeInfoResult } from 'bitcoin-com-rest';
import { BlockDetailsResult } from 'bitcoin-com-rest';

export declare module Bitcore {

    export interface BlockTxnInput {
        script: { raw: Buffer; code: { value:number; data:Buffer }[]; }
        prevout: { hash: Buffer; index: number; }
        sequence: number;
    }

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
        serialize(unsafe?: boolean): string
        hash: string;
        id: string;
    }

    // export interface Networks {
    //     livenet: any;
    //     testnet: any;
    // }

    export interface Address {
        toString(format: string): string;
    }
}
