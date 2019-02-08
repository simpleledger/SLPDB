require('dotenv').config()
import { BitcoinRpcClient, Bitcore } from './global';

const bitcore = require('bitcore-lib-cash')

export class TNA {
    rpc: BitcoinRpcClient;
    constructor(rpcClient: BitcoinRpcClient) {
        this.rpc = rpcClient;
    }

    
    async fromTx(gene: Bitcore.Transaction, options?: any): Promise<TNATxn|null> {
        return await (async function(gene, options) {
            let t = gene.toObject()
            let inputs: Xput[] = [];
            let outputs: Xput[] = [];
            if (gene.inputs) {
                gene.inputs.forEach(function(input, input_index) {
                    if (input.script) {
                        let xput: Xput = { i: input_index }
                        input.script.chunks.forEach(function(c, chunk_index) {
                            if (c.buf) {
                                const key_prefix = (c.buf.length >= 512) ? 'l' : '';
                                xput[key_prefix + "b" + chunk_index] = c.buf.toString('base64')
                                if (options && options.h && options.h > 0) {
                                    xput[key_prefix + "h" + chunk_index] = c.buf.toString('hex')
                                }
                            } else {
                                if (typeof c.opcodenum !== 'undefined') {
                                    xput["b" + chunk_index] = {
                                        op: c.opcodenum
                                    }
                                } else {
                                    const key_prefix = (c.len >= 512) ? 'l' : '';  // NOTE: c.length changed to c.len
                                    xput[key_prefix + "b" + chunk_index] = c;
                                }
                            }
                        })
                        xput.str = input.script.toASM()
                        let sender: Sender = {
                            h: input.prevTxId.toString('hex'),
                            i: input.outputIndex
                        }
                        let address = input.script.toAddress(bitcore.Networks.livenet).toString(bitcore.Address.CashAddrFormat).split(':')[1];
                        if (address && address.length > 0) {
                            sender.a = address;
                        }
                        xput.e = sender;
                        inputs.push(xput)
                    }
                })
            }
            if (gene.outputs) {
                gene.outputs.forEach(function(output, output_index) {
                    if (output.script) {
                        let xput: Xput = { i: output_index }
                        output.script.chunks.forEach(function(c, chunk_index) {
                            if (c.buf) {
                                const key_prefix = (c.buf.length >= 512) ? 'l' : '';
    
                                xput[key_prefix + "b" + chunk_index] = c.buf.toString('base64')
                                xput[key_prefix + "s" + chunk_index] = c.buf.toString('utf8')
                                if (options && options.h && options.h > 0) {
                                    xput[key_prefix + "h" + chunk_index] = c.buf.toString('hex')
                                }
                            } else {
                                if (typeof c.opcodenum !== 'undefined') {
                                    xput["b" + chunk_index] = {
                                    op: c.opcodenum
                                    }
                                } else {
                                    const key_prefix = (c.len >= 512) ? 'l' : '';  // changed c.length to c.len
                                    xput[key_prefix + "b" + chunk_index] = c;
                                }
                            }
                        })
                        xput.str = output.script.toASM()
                        let receiver: Receiver = {
                            v: output.satoshis,
                            i: output_index
                        }
                        let address = output.script.toAddress(bitcore.Networks.livenet).toString(bitcore.Address.CashAddrFormat).split(':')[1];
                        if (address && address.length > 0) {
                            receiver.a = address;
                        }
                        xput.e = receiver;
                        outputs.push(xput)
                    }
                })
            }
            return { tx: { h: t.hash }, in: inputs, out: outputs }   
        })(gene, options);
    }
}

export interface TNATxn {
    tx: { h: string };
    in: Xput[];
    out: Xput[];
    blk?: { h: string; i: number; t: string }
}

export interface Xput {
    [key:string]: any;
    i: number;
    str?: string;
    e?: Sender|Receiver
}

export interface Sender {
    h: string;
    i: number;
    a?: string;
}

export interface Receiver {
    v: number;
    i: number;
    a?: string;
}