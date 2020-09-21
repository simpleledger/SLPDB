require('dotenv').config()
import { SlpTransactionDetailsTnaDbo } from './slpgraphmanager';
import { Utils } from 'slpjs';
import { BITBOX } from 'bitbox-sdk';
import * as Bitcore from 'bitcore-lib-cash';

const bitbox = new BITBOX();
let bitcore = require('bitcore-lib-cash');

export class TNA {
    fromTx(gene: Bitcore.Transaction, options?: any): TNATxn {
        let net = options.network === 'testnet' ? bitcore.Networks.testnet : bitcore.Networks.livenet;
        let t = gene.toObject()
        let inputs: Xput[] = [];
        let outputs: Xput[] = [];
        if (gene.inputs) {
            gene.inputs.forEach(function(input, input_index) {
                if (input.script) {
                    let xput: Xput = { i: input_index };
                    input.script.chunks.forEach(function(c, chunk_index) {
                        if (c.buf) {
                            const key_prefix = (c.buf.length >= 512) ? 'l' : '';
                            xput[key_prefix + "b" + chunk_index] = c.buf.toString('base64');
                            if (options && options.h && options.h > 0) {
                                xput[key_prefix + "h" + chunk_index] = c.buf.toString('hex');
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
                    xput.str = input.script.toASM();
                    let sender: Sender = {
                        h: input.prevTxId.toString('hex'),
                        i: input.outputIndex,
                        s: input._scriptBuffer,
                    }

                    try {
                        if (input.script.toAddress(net).toString(bitcore.Address.CashAddrFormat) !== "false") {
                            // let bitcore-lib-cash encode the address type
                            sender.a = Utils.toSlpAddress(input.script.toAddress(net).toString(bitcore.Address.CashAddrFormat));
                        } else {
                            // encode as p2sh address type	
                            const scriptSigHexArray = input.script.toASM().split(' ')		
                            const redeemScriptHex = scriptSigHexArray[scriptSigHexArray.length-1]		
                            const redeemScriptHash160 = bitbox.Crypto.hash160(Buffer.from(redeemScriptHex, 'hex'))		
                            sender.a = Utils.slpAddressFromHash160(redeemScriptHash160, options.network, "p2sh")
                        }
                    } catch (err) {
                        throw Error(`txid: ${gene.hash}, input: ${input.prevTxId.toString('hex')}:${input.outputIndex}, address: ${input.script.toAddress(net).toString(bitcore.Address.CashAddrFormat)}, script ${input._scriptBuffer.toString("hex")}, err: ${err}`)
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
                    output.script.chunks.forEach((c: Bitcore.Chunk, chunk_index: number) => {
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
                        i: output_index,
                        s: output._scriptBuffer
                    }
                    let address;
                    try { address = Utils.toSlpAddress(output.script.toAddress(net).toString(bitcore.Address.CashAddrFormat));} catch(_) { }
                    if (address && address.length > 0) {
                        receiver.a = address;
                    }
                    xput.e = receiver;
                    outputs.push(xput)
                }
            })
        }
        return { tx: { h: t.hash, raw: gene.toBuffer() }, in: inputs, out: outputs };
    }
}

export interface TNATxn {
    tx: { h: string, raw: Buffer };
    in: Xput[];
    out: Xput[];
    blk?: { h: string; i: number; t: number; };
    slp?: TNATxnSlpDetails;
}

export interface TNATxnSlpDetails {
    valid: boolean, 
    detail: SlpTransactionDetailsTnaDbo|null, 
    invalidReason: string|null,
    schema_version: number 
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
    s: Buffer;  // scriptSig
}

export interface Receiver {
    v: number;
    i: number;
    a?: string;
    s: Buffer;  // scriptPubkey
}
