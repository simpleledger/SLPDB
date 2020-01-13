import * as assert from "assert";
import { Slp, LocalValidator, TransactionHelpers, Utils, SlpAddressUtxoResult, SlpTransactionType } from 'slpjs';
import * as zmq from 'zeromq';
import { BITBOX } from 'bitbox-sdk';
import BigNumber from 'bignumber.js';
import { step } from 'mocha-steps';

import { Config } from "../config";
import { Db } from '../db';
import { TNATxn, TNATxnSlpDetails } from "../tna";
import { TokenBatonStatus } from "../interfaces";
import { GraphTxnDbo, AddressBalancesDbo, UtxoDbo, TokenDBObject } from "../interfaces";

const bitbox = new BITBOX();
const slp = new Slp(bitbox);
const txnHelpers = new TransactionHelpers(slp);
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const TOKEN_DECIMALS = 1;
const TOKEN_GENESIS_QTY = 100;

// connect to bitcoin regtest network JSON-RPC
const rpcClient = require('bitcoin-rpc-promise-retry');
const connectionStringNode1_miner = 'http://bitcoin:password@0.0.0.0:18443';  // (optional) connect to a miner's rpc on 18444 that is not connected to SLPDB
const rpcNode1_miner = new rpcClient(connectionStringNode1_miner, { maxRetries: 0 });
const connectionStringNode2_miner = 'http://bitcoin:password@0.0.0.0:18444';  // (optional) connect to a miner's rpc on 18444 that is not connected to SLPDB
const rpcNode2_miner = new rpcClient(connectionStringNode2_miner, { maxRetries: 0 });

// setup a new local SLP validator instance
const validator = new LocalValidator(bitbox, async (txids) => { 
    let txn;
    try {
        txn = <string>await rpcNode1_miner.getRawTransaction(txids[0]);
    } catch(err) {
        throw Error(`[ERROR] Could not get transaction ${txids[0]} in local validator: ${err}`)
    }
    return [ txn ];
}, console);

// connect to SLPDB ZMQ notifications
let slpdbTxnNotifications: TNATxn[] = [];
let slpdbBlockNotifications: { txns: { slp: TNATxnSlpDetails, txid: string }[], hash: string }[] = [];
const sock: any = zmq.socket('sub');
sock.connect('tcp://0.0.0.0:27339');
sock.subscribe('mempool');
sock.subscribe('block');
sock.on('message', async function(topic: string, message: Buffer) {
    if (topic.toString() === 'mempool') {
        let obj = JSON.parse(message.toString('utf8'));
        slpdbTxnNotifications.unshift(obj);
    } else if (topic.toString() === 'block') {
        let obj = JSON.parse(message.toString('utf8'));
        slpdbBlockNotifications.unshift(obj);    
        //console.log(slpdbBlockNotifications);
    }
});

// connect to the regtest mongoDB
let db = new Db({ dbUrl: "mongodb://0.0.0.0:26017", dbName: "slpdb_test", config: Config.db });

// produced and shared between tests.
let receiverRegtest: string;
let receiverSlptest: string; // this is same address as receiverRegtest, converted to slptest format
let txnInputs: SlpAddressUtxoResult[];
let tokenId: string;
let txid1: string;
let txid2: string;

let lastBlockHash: string;
let lastBlockIndex: number;

describe("3-Double-Spend-Send", () => {

    step("Initial setup for all tests", async () => {

        // generate block to clear the mempool (may be dirty from previous tests)
        lastBlockHash = (await rpcNode1_miner.generate(1))[0];

        // connect miner node to a full node that is connected to slpdb
        try {
            await rpcNode1_miner.addNode("bitcoin1", "onetry");
        } catch(err) { }

        // make sure we have coins to use in tests
        let balance = await rpcNode1_miner.getBalance();
        while (balance < 1) {
            lastBlockHash = (await rpcNode1_miner.generate(1))[0];
            balance = await rpcNode1_miner.getBalance();
        }

        // put all the funds on the receiver's address
        receiverRegtest = await rpcNode1_miner.getNewAddress("0");
        await rpcNode1_miner.sendToAddress(receiverRegtest, 1, "", "", true);
        lastBlockHash = (await rpcNode1_miner.generate(1))[0];

        // check both nodes are on the same block
        let node1Hash = await rpcNode1_miner.getbestblockhash();
        let node2Hash = await rpcNode2_miner.getbestblockhash();

        while(node1Hash !== node2Hash) {
            await sleep(50);
            node2Hash = await rpcNode2_miner.getbestblockhash();
        }
        assert.equal(node1Hash, node2Hash);

        let unspent = await rpcNode1_miner.listUnspent(0);
        unspent = unspent.filter((txo: any) => txo.address === receiverRegtest);
        if (unspent.length === 0) throw Error("No unspent outputs.");
        unspent.map((txo: any) => txo.cashAddress = txo.address);
        unspent.map((txo: any) => txo.satoshis = txo.amount*10**8);
        await Promise.all(unspent.map(async (txo: any) => txo.wif = await rpcNode1_miner.dumpPrivKey(txo.address)));

        // validate and categorize unspent TXOs
        let utxos = await slp.processUtxosForSlpAbstract([unspent[0]], validator);
        txnInputs = utxos.nonSlpUtxos;

        // create a new token
        receiverSlptest = Utils.toSlpAddress(receiverRegtest);
        let genesisTxnHex = txnHelpers.simpleTokenGenesis(
            "unit-test-3", "ut3", new BigNumber(TOKEN_GENESIS_QTY).times(10**TOKEN_DECIMALS), null, null, 
            TOKEN_DECIMALS, receiverSlptest, receiverSlptest, receiverSlptest, txnInputs);
        tokenId = await rpcNode1_miner.sendRawTransaction(genesisTxnHex, true);
        lastBlockHash = (await rpcNode1_miner.generate(1))[0];
        lastBlockIndex = (await rpcNode1_miner.getBlock(lastBlockHash, true)).height;
        let lastBlockHash2 = await rpcNode2_miner.getbestblockhash();
        assert.equal(lastBlockHash, lastBlockHash2);

        // disconnect nodes now
        let peerInfo: any[] = await rpcNode1_miner.getPeerInfo();
        await rpcNode1_miner.disconnectNode("bitcoin1");
        while(peerInfo.length > 0) {
            await sleep(100);
            peerInfo = await rpcNode1_miner.getPeerInfo();
        }
        assert.equal(peerInfo.length === 0, true);
    });

    step("DS-S: Check the new token has been added", async () => {  // NOTE: This takes longer than normal since we're not waiting for ZMQ msg
        let txn = await db.confirmedFetch(tokenId);
        let txn_u = await db.unconfirmedFetch(tokenId);
        while (!txn || !txn!.slp || !txn.slp.valid || txn_u) {
            await sleep(50);
            txn = await db.confirmedFetch(tokenId);
            txn_u = await db.unconfirmedFetch(tokenId);
        }
        let confirmed = await db.db.collection("confirmed").find({ "tx.h": tokenId }).toArray();
        assert.equal(txn!.slp!.valid, true);
        assert.equal(txn!.slp!.detail!.name, "unit-test-3");
        assert.equal(txn!.slp!.detail!.symbol, "ut3");     
        assert.equal(txn!.slp!.detail!.tokenIdHex, txn!.tx.h);
        assert.equal(confirmed.length, 1);
        assert.equal(txn_u, null);
    });

    step("DS-S: Process transaction inputs", async () => {
        // get current address UTXOs
        let unspent = await rpcNode1_miner.listUnspent(0);
        unspent = unspent.filter((txo: any) => txo.address === receiverRegtest);
        if (unspent.length === 0) throw Error("No unspent outputs.");
        unspent.map((txo: any) => txo.cashAddress = txo.address);
        unspent.map((txo: any) => txo.satoshis = txo.amount*10**8);
        await Promise.all(unspent.map(async (txo: any) => txo.wif = await rpcNode1_miner.dumpPrivKey(txo.address)));

        // process raw UTXOs
        let utxos = await slp.processUtxosForSlpAbstract(unspent, validator);

        // select the inputs for transaction
        txnInputs = [ ...utxos.nonSlpUtxos, ...utxos.slpTokenUtxos[tokenId] ];

        assert.equal(txnInputs.length > 1, true);
    });

    step("DS-S: Create two different send transactions", async () => {
        // create and broadcast SLP genesis transaction
        receiverSlptest = Utils.toSlpAddress(receiverRegtest);

        let sendTxnHex1 = txnHelpers.simpleTokenSend(tokenId, new BigNumber(TOKEN_GENESIS_QTY).times(10**TOKEN_DECIMALS),
                                                        txnInputs, receiverSlptest, receiverSlptest);

        let sendTxnHex2 = txnHelpers.simpleTokenSend(tokenId, new BigNumber(TOKEN_GENESIS_QTY-1).times(10**TOKEN_DECIMALS),
                                                        txnInputs, receiverSlptest, receiverSlptest);
    
        txid1 = await rpcNode1_miner.sendRawTransaction(sendTxnHex1, true);
        txid2 = await rpcNode2_miner.sendRawTransaction(sendTxnHex2, true);

        assert.equal(txid1.length === 64, true);
        assert.equal(txid2.length === 64, true);
        assert.equal(txid1 !== txid2, true);
    });

    step("DS-S: Check SLPDB has pre-double spent transaction as unconfirmed", async () => {
        //let txn = await db.unconfirmedFetch(txid1);
        let unconfirmed = await db.db.collection("unconfirmed").find({}).toArray();
        let txn = unconfirmed.find(i => i.tx.h === txid1);
        while (!txn || unconfirmed.length !== 1) {
            await sleep(50);
            unconfirmed = await db.db.collection("unconfirmed").find({}).toArray();
            txn = unconfirmed.find(i => i.tx.h === txid1);
        }
        assert.equal(txn!.slp!.valid, true);
        assert.equal(txn!.slp!.detail!.name, "unit-test-3");
        assert.equal(txn!.slp!.detail!.symbol, "ut3");     
        assert.equal(txn!.slp!.detail!.tokenIdHex, tokenId);
    });

    step("DS-S: Check SLPDB has pre-double spent transaction in graphs", async () => {
        let g: GraphTxnDbo | null = await db.db.collection("graphs").findOne({ "graphTxn.txid": txid1 });
        while(!g || !g.graphTxn) {
            await sleep(50);
            g = await db.db.collection("graphs").findOne({ "graphTxn.txid": txid1 });
        }
        assert.equal(g!.graphTxn.txid, txid1);
        assert.equal(g!.tokenDetails.tokenIdHex, tokenId);
        assert.equal(g!.graphTxn.blockHash, null);

        // TODO: Check unspent outputs.
    });

    step("DS-S: Check SLPDB has pre-double spent transaction in UTXOs", async () => {
        let x: UtxoDbo[] = await db.db.collection("utxos").find({ "tokenDetails.tokenIdHex": tokenId }).toArray();
        while(x.length === 0) {
            await sleep(50);
            x = await db.db.collection("utxos").find({ "tokenDetails.tokenIdHex": tokenId }).toArray();
        }
        assert.equal(x.length, 1);
        assert.equal(x[0].address, receiverSlptest);
        assert.equal(x[0].bchSatoshis, 546);
        // @ts-ignore
        assert.equal(x[0].slpAmount.toString(), TOKEN_GENESIS_QTY.toFixed());
    });

    step("DS-S: Check SLPDB has pre-double spent transaction in addresses", async () => {
        let a: AddressBalancesDbo[] = await db.db.collection("addresses").find({ "tokenDetails.tokenIdHex": tokenId }).toArray();
        while(a.length === 0) {
            await sleep(50);
            a = await db.db.collection("addresses").find({ "tokenDetails.tokenIdHex": tokenId }).toArray();
        }
        assert.equal(a.length, 1);
        assert.equal(a[0].address, receiverSlptest);
        assert.equal(a[0].satoshis_balance, 546);
        // @ts-ignore
        assert.equal(a[0].token_balance.toString(), TOKEN_GENESIS_QTY.toFixed());
    });

    step("DS-S: Check SLPDB has pre-double spent transaction in tokens", async () => {
        let t: TokenDBObject | null = await db.tokenFetch(tokenId);
        assert.equal(t!.tokenDetails.tokenIdHex, tokenId);
        assert.equal(t!.mintBatonUtxo, tokenId + ":2");
        assert.equal(t!.tokenStats!.block_created, lastBlockIndex);
        assert.equal(t!.tokenStats!.block_last_active_mint, null);
        assert.equal(t!.tokenStats!.block_last_active_send, null);
        // assert.equal(t!.tokenStats!.qty_token_burned.toString(), "0");
        // assert.equal(t!.tokenStats!.qty_token_circulating_supply.toString(), TOKEN_GENESIS_QTY.toFixed());
        // assert.equal(t!.tokenStats!.qty_token_minted.toString(), TOKEN_GENESIS_QTY.toFixed());
        assert.equal(t!.mintBatonStatus, TokenBatonStatus.ALIVE);
    });

    step("DS-S: Generate block on node 2 and reconnect the two nodes", async () => {
        // clear ZMQ cache
        slpdbTxnNotifications = [];
        slpdbBlockNotifications = [];

        let peerInfo: any[] = await rpcNode1_miner.getPeerInfo();
        while(peerInfo.length > 0) {
            await sleep(100);
            peerInfo = await rpcNode1_miner.getPeerInfo();
        }
        assert.equal(peerInfo.length === 0, true);

        // use 2nd (non-SLPDB connected node) to generate a block, reconnect to cause double spend
        lastBlockHash = (await rpcNode2_miner.generate(1))[0];
        lastBlockIndex = (await rpcNode2_miner.getBlock(lastBlockHash, true)).height;

        // connect miner node to a full node that is connected to slpdb
        try {
            await rpcNode1_miner.addNode("bitcoin1", "onetry");
        } catch(err) { }

        // reconnect nodes
        peerInfo = await rpcNode1_miner.getPeerInfo();
        while(peerInfo.length < 1) {
            await sleep(100);
            peerInfo = await rpcNode1_miner.getPeerInfo();
        }
        assert.equal(peerInfo.length, 1);
    });

    step("DS-S: produces ZMQ output for the double-spend transaction", async () => {
        // give slpdb time to process
        while(slpdbTxnNotifications.length === 0) {
            await sleep(50);
        }
        // check that SLPDB made proper outgoing ZMQ messages for 
        assert.equal(slpdbTxnNotifications.length, 1);
        assert.equal(slpdbTxnNotifications[0]!.slp!.valid, true);
        assert.equal(slpdbTxnNotifications[0]!.slp!.detail!.name, "unit-test-3");
        assert.equal(slpdbTxnNotifications[0]!.slp!.detail!.symbol, "ut3");
        assert.equal(slpdbTxnNotifications[0]!.slp!.detail!.tokenIdHex, tokenId);
        assert.equal(slpdbTxnNotifications[0]!.slp!.detail!.outputs![0].address, receiverSlptest);
        assert.equal(slpdbTxnNotifications[0]!.slp!.detail!.transactionType, SlpTransactionType.SEND);
        // @ts-ignore
        assert.equal(slpdbTxnNotifications[0]!.slp!.detail!.outputs![0].amount!["$numberDecimal"], (TOKEN_GENESIS_QTY-1).toFixed());
        // @ts-ignore
        assert.equal(slpdbTxnNotifications[0]!.slp!.detail!.outputs![1].amount!["$numberDecimal"], (1).toFixed());
        assert.equal(slpdbTxnNotifications[0]!.blk!.h, lastBlockHash);
        assert.equal(slpdbTxnNotifications[0]!.blk!.i, lastBlockIndex);
        assert.equal(typeof slpdbTxnNotifications[0]!.in, "object");
        assert.equal(typeof slpdbTxnNotifications[0]!.out, "object");
        assert.equal(typeof slpdbTxnNotifications[0]!.tx, "object");
        assert.equal(slpdbTxnNotifications[0]!.tx!.h, txid2);
    });

    step("DS-S: stores double spend txid2 in tokens (immediately after txn ZMQ)", async () => {
        let t: TokenDBObject | null = await db.tokenFetch(tokenId);
        while(!t || t!.tokenStats!.block_last_active_send === null) { // || t!.tokenStats!.qty_token_burned.toString() !== "0") {
            t = await db.tokenFetch(tokenId);
            await sleep(50);
        }
        assert.equal(t!.tokenDetails.tokenIdHex, tokenId);
        assert.equal(t!.mintBatonUtxo, tokenId + ":2");
        assert.equal(t!.tokenStats!.block_created, lastBlockIndex-1);
        assert.equal(t!.tokenStats!.block_last_active_mint, null);
        assert.equal(t!.tokenStats!.block_last_active_send, lastBlockIndex);
        // assert.equal(t!.tokenStats!.qty_token_burned.toString(), "0");
        // assert.equal(t!.tokenStats!.qty_token_circulating_supply.toString(), TOKEN_GENESIS_QTY.toFixed());
        // assert.equal(t!.tokenStats!.qty_token_minted.toString(), TOKEN_GENESIS_QTY.toFixed());
        assert.equal(t!.mintBatonStatus, TokenBatonStatus.ALIVE);
    });

    step("DS-S: produces ZMQ output for the block", async () => {
        while(slpdbBlockNotifications.length === 0) {
            await sleep(50);
        }
        assert.equal(slpdbBlockNotifications.length, 1);
        assert.equal(slpdbBlockNotifications[0].txns.length, 1);
        assert.equal(slpdbBlockNotifications[0].txns[0]!.txid, txid2);
        assert.equal(slpdbBlockNotifications[0].txns[0]!.slp.detail!.tokenIdHex, tokenId);
        assert.equal(slpdbBlockNotifications[0].txns[0]!.slp.detail!.name, "unit-test-3");
        assert.equal(slpdbBlockNotifications[0].txns[0]!.slp.detail!.symbol, "ut3");
        // @ts-ignore
        assert.equal(slpdbBlockNotifications[0]!.txns[0]!.slp!.detail!.outputs![0].amount!, (TOKEN_GENESIS_QTY-1).toFixed());  // this type is not consistent with txn notification
        // @ts-ignore
        assert.equal(slpdbBlockNotifications[0]!.txns[0]!.slp!.detail!.outputs![1].amount!, (1).toFixed());  // this type is not consistent with txn notification
        // TODO: There is not block hash with block zmq notification!
        // assert.equal(typeof slpdbBlockNotifications[0]!.hash, "string");
        // assert.equal(slpdbBlockNotifications[0]!.hash.length, 64);
    });

    step("DS-S: Check that the double spent txn is removed everywhere from SLPDB", async () => {
        //let t: TokenDBObject | null = await db.tokenFetch(tokenId);
        let x: UtxoDbo[] = await db.db.collection("utxos").find({ "tokenDetails.tokenIdHex": tokenId }).toArray();
        let a: AddressBalancesDbo[] = await db.db.collection("addresses").find({ "tokenDetails.tokenIdHex": tokenId }).toArray();
        let g: GraphTxnDbo | null = await db.db.collection("graphs").findOne({ "graphTxn.txid": txid1 });
        let txn_u = await db.unconfirmedFetch(txid1);
        let txn_c = await db.confirmedFetch(txid1);
        while(x.length !== 2 || a.length !== 1 || g || txn_u || txn_c) {
            await sleep(50);
            //t = await db.tokenFetch(txid1);
            x = await db.db.collection("utxos").find({ "tokenDetails.tokenIdHex": tokenId }).toArray();
            a = await db.db.collection("addresses").find({ "tokenDetails.tokenIdHex": tokenId }).toArray();
            g = await db.db.collection("graphs").findOne({ "graphTxn.txid": txid1 });
            txn_u = await db.unconfirmedFetch(txid1);
            txn_c = await db.confirmedFetch(txid1);
        }
        //assert.equal(t, null);
        assert.equal(x.length === 2, true);
        assert.equal(a.length === 1, true);
        assert.equal(g, null);
        assert.equal(txn_c, null);
        assert.equal(txn_u, null);
    });

    step("DS-S: store double spend txid2 in confirmed", async () => {
        let txn = await db.confirmedFetch(txid2);
        while (!txn || !txn!.slp) { // NOTE: This is a problem where the unconfirmed item is first saved without the slp property (but ZMQ should happen only after slp is added)
            await sleep(50);
            txn = await db.confirmedFetch(txid2);
        }
        let confirmed = await db.db.collection("confirmed").find({ "tx.h": txid2 }).toArray();
        assert.equal(txn!.slp!.valid, true);
        assert.equal(txn!.slp!.detail!.name, "unit-test-3");
        assert.equal(txn!.slp!.detail!.symbol, "ut3");    
        assert.equal(txn!.tx.h, txid2); 
        assert.equal(txn!.slp!.detail!.tokenIdHex, tokenId);
        assert.equal(confirmed.length, 1);

        // make sure it is not in unconfirmed
        let txn_u = await db.unconfirmedFetch(txid2);
        assert.equal(txn_u, null);
    });

    step("DS-S: stores double spend txid2 in tokens", async () => {
        let t: TokenDBObject | null = await db.tokenFetch(tokenId);
        assert.equal(t!.tokenDetails.tokenIdHex, tokenId);
        assert.equal(t!.mintBatonUtxo, tokenId + ":2");
        assert.equal(t!.tokenStats!.block_created, lastBlockIndex-1);
        assert.equal(t!.tokenStats!.block_last_active_mint, null);
        assert.equal(t!.tokenStats!.block_last_active_send, lastBlockIndex);
        // assert.equal(t!.tokenStats!.qty_token_burned.toString(), "0");
        // assert.equal(t!.tokenStats!.qty_token_circulating_supply.toString(), TOKEN_GENESIS_QTY.toFixed());
        // assert.equal(t!.tokenStats!.qty_token_minted.toString(), TOKEN_GENESIS_QTY.toFixed());
        assert.equal(t!.mintBatonStatus, TokenBatonStatus.ALIVE);
    });

    step("DS-S: stores double spend txid2 in utxos", async () => {
        let x: UtxoDbo[] = await db.db.collection("utxos").find({ "tokenDetails.tokenIdHex": tokenId }).toArray();
        while(x.length === 0) {
            await sleep(50);
            x = await db.db.collection("utxos").find({ "tokenDetails.tokenIdHex": tokenId }).toArray();
        }
        assert.equal(x.length, 2);
        assert.equal(x[0].address, receiverSlptest);
        assert.equal(x[0].bchSatoshis, 546);
        assert.equal(x[1].address, receiverSlptest);
        assert.equal(x[1].bchSatoshis, 546);

        let amounts = [(TOKEN_GENESIS_QTY-1).toFixed(), (1).toFixed()];
        // @ts-ignore
        assert.equal(amounts.includes(x[0].slpAmount.toString()), true);
        amounts = amounts.filter(a => a !== x[0].slpAmount.toString());
        // @ts-ignore
        assert.equal(amounts.includes(x[1].slpAmount.toString()), true);
    });

    step("DS-S: stores double spend token2 in addresses", async () => {
        let a: AddressBalancesDbo[] = await db.db.collection("addresses").find({ "tokenDetails.tokenIdHex": tokenId }).toArray();
        while(a.length === 0) {
            await sleep(50);
            a = await db.db.collection("addresses").find({ "tokenDetails.tokenIdHex": tokenId }).toArray();
        }
        assert.equal(a.length, 1);
        assert.equal(a[0].address, receiverSlptest);
        assert.equal(a[0].satoshis_balance, 1092);
        // @ts-ignore
        assert.equal(a[0].token_balance.toString(), TOKEN_GENESIS_QTY.toFixed());
    });

    step("DS-S: stores double spend token2 in graphs", async () => {
        let g: GraphTxnDbo | null = await db.db.collection("graphs").findOne({ "graphTxn.txid": txid2 });
        while(!g || !g.graphTxn) {
            await sleep(50);
            g = await db.db.collection("graphs").findOne({ "graphTxn.txid": txid2 });
        }
        assert.equal(g!.graphTxn.txid, txid2);
        assert.equal(g!.tokenDetails.tokenIdHex, tokenId);
        assert.equal(g!.graphTxn.blockHash!.toString("hex"), lastBlockHash);

        // TODO: Check unspent outputs.
    });

    step("Cleanup after tests", async () => {
        // generate block to clear the mempool (may be dirty from previous tests)
        await rpcNode1_miner.generate(1);
        sock.disconnect('tcp://0.0.0.0:27339');
    });
});
