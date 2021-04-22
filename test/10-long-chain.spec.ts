// import * as assert from "assert";
// import { Slp, LocalValidator, TransactionHelpers, Utils, SlpAddressUtxoResult, SlpTransactionType } from 'slpjs';
// import * as zmq from 'zeromq';
// import { BITBOX } from 'bitbox-sdk';
// import BigNumber from 'bignumber.js';
// import { step } from 'mocha-steps';

// import { Config } from "../config";
// import { Db } from '../db';
// import { TNATxn, TNATxnSlpDetails } from "../tna";
// import { CacheMap } from "../cache";
// import { TokenDBObject, TokenBatonStatus, GraphTxnDbo, UtxoDbo, AddressBalancesDbo } from "../interfaces";

// const bitbox = new BITBOX();
// const slp = new Slp(bitbox);
// const txnHelpers = new TransactionHelpers(slp);
// const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// const TOKEN_DECIMALS = 9;
// const TOKEN_GENESIS_QTY = 1000000;

// const rawTxnCache = new CacheMap<string, Buffer>(100000);

// // connect to bitcoin regtest network JSON-RPC
// const rpcClient = require('bitcoin-rpc-promise-retry');
// const connectionStringNode1_miner = `http://bitcoin:password@${process.env.RPC1_HOST}:${process.env.RPC1_PORT}`;  // (optional) connect to a miner's rpc on 18444 that is not connected to SLPDB
// const rpcNode1_miner = new rpcClient(connectionStringNode1_miner, { maxRetries: 0 });

// // setup a new local SLP validator instance
// const validator = new LocalValidator(bitbox, async (txids: string[]) => { 
//     let txn;
//     if (rawTxnCache.has(txids[0])) {
//         return [ rawTxnCache.get(txids[0])!.toString("hex") as string ];
//     }
//     try {
//         txn = <string>await rpcNode1_miner.getRawTransaction(txids[0]);
//     } catch(err) {
//         throw Error(`[ERROR] Could not get transaction ${txids[0]} in local validator: ${err}`)
//     }
//     return [ txn ];
// }, console);

// // connect to SLPDB ZMQ notifications
// let slpdbTxnNotifications: TNATxn[] = [];
// let slpdbBlockNotifications: { txns: { slp: TNATxnSlpDetails, txid: string }[], hash: string }[] = [];
// const sock: any = zmq.socket('sub');
// sock.connect('tcp://0.0.0.0:27339');
// sock.subscribe('mempool');
// sock.subscribe('block');
// sock.on('message', async function(topic: string, message: Buffer) {
//     if (topic.toString() === 'mempool') {
//         let obj = JSON.parse(message.toString('utf8'));
//         slpdbTxnNotifications.unshift(obj);
//     } else if (topic.toString() === 'block') {
//         let obj = JSON.parse(message.toString('utf8'));
//         slpdbBlockNotifications.unshift(obj);    
//     }
// });


// // connect to the regtest mongoDB
// let db = new Db({ dbUrl: `mongodb://${process.env.MONGO_HOST}:${process.env.MONGO_PORT}`, dbName: "slpdb_test", config: Config.db });

// // produced and shared between tests.
// let receiverRegtest: string;
// let receiverSlptest: string; // this is same address as receiverRegtest, converted to slptest format
// let txnInputs: SlpAddressUtxoResult[];
// let tokenId: string;
// let txid1: string;
// let txid2: string;

// let lastBlockHash: string;
// let lastBlockIndex: number;
// let perInputAmount: BigNumber;
// let actualInputsCreated: number;
// let fiTxid: string;
// let privKey: string;
// let inputTxnCount: number;

// describe("10-long-chain", () => {

//     step("Initial setup for all tests", async () => {

//         // generate block to clear the mempool (may be dirty from previous tests)
//         lastBlockHash = (await rpcNode1_miner.generate(1))[0];

//         // connect miner node to a full node that is connected to slpdb
//         try {
//             await rpcNode1_miner.addNode("bitcoin2", "onetry");
//         } catch(err) { }

//         // make sure we have coins to use in tests
//         let balance = await rpcNode1_miner.getBalance();
//         while (balance < 1) {
//             lastBlockHash = (await rpcNode1_miner.generate(1))[0];
//             balance = await rpcNode1_miner.getBalance();
//         }

//         // put all the funds on the receiver's address
//         receiverRegtest = await rpcNode1_miner.getNewAddress("0");
//         await rpcNode1_miner.sendToAddress(receiverRegtest, 1, "", "", true);
//         lastBlockHash = (await rpcNode1_miner.generate(1))[0];

//         let unspent = await rpcNode1_miner.listUnspent(0);
//         unspent = unspent.filter((txo: any) => txo.address === receiverRegtest);
//         if (unspent.length === 0) throw Error("No unspent outputs.");
//         unspent.map((txo: any) => txo.cashAddress = txo.address);
//         unspent.map((txo: any) => txo.satoshis = txo.amount*10**8);
//         await Promise.all(unspent.map(async (txo: any) => txo.wif = await rpcNode1_miner.dumpPrivKey(txo.address)));

//         // validate and categorize unspent TXOs
//         let utxos = await slp.processUtxosForSlpAbstract([unspent[0]], validator);
//         txnInputs = utxos.nonSlpUtxos;

//         // create a new token
//         receiverSlptest = Utils.toSlpAddress(receiverRegtest);
//         let genesisTxnHex = txnHelpers.simpleTokenGenesis(
//                                                         "unit-test-4", "ut4", 
//                                                         new BigNumber(TOKEN_GENESIS_QTY).times(10**TOKEN_DECIMALS), 
//                                                         null, null, 
//                                                         TOKEN_DECIMALS, receiverSlptest, receiverSlptest, 
//                                                         receiverSlptest, txnInputs
//                                                         );
//         tokenId = await rpcNode1_miner.sendRawTransaction(genesisTxnHex, true);
//         lastBlockHash = (await rpcNode1_miner.generate(1))[0];
//         lastBlockIndex = (await rpcNode1_miner.getBlock(lastBlockHash, true)).height;
//     });

//     const TXN_COUNT = 5000;
//     const OUTPUT_SIZE = 3;
//     const MAX_UNCONF_CHAIN_SIZE = 25;
//     const FEE_EST = 5000;
//     step("LC-1: create a massively large set of SLP transctions via fan-out", async () => {
//         let txnCount = 0;
//         let txnDepth = 1; // where 0 depth was the Genesis txn
//         while (txnCount < TXN_COUNT) {
//             slpdbBlockNotifications = [];

//             let unspent = await rpcNode1_miner.listUnspent(0);
//             unspent = unspent.filter((txo: any) => txo.address === receiverRegtest);
//             if (unspent.length === 0) throw Error("No unspent outputs.");
//             unspent.map((txo: any) => txo.cashAddress = txo.address);
//             unspent.map((txo: any) => txo.satoshis = txo.amount*10**8);
//             await Promise.all(unspent.map(async (txo: any) => {
//                 if(!privKey) {
//                     privKey = await rpcNode1_miner.dumpPrivKey(txo.address);
//                 }
//                 txo.wif = privKey; 
//             }));

//             let utxos = await slp.processUtxosForSlpAbstract(unspent, validator);
//             let tokenInputs = utxos.slpTokenUtxos[tokenId].sort((a, b) => { return b.slpUtxoJudgementAmount.comparedTo(a.slpUtxoJudgementAmount) });
//             let nonTokenInputs = utxos.nonSlpUtxos.sort((a, b) => b.satoshis - a.satoshis);

//             // create each transaction for this depth
//             for(let i = 0; i < OUTPUT_SIZE**(txnDepth-1); i++) {

//                 if(txnCount > 0 && txnCount % MAX_UNCONF_CHAIN_SIZE === 0) {
//                     console.log("Generating block.")
//                     await rpcNode1_miner.generate(1); // prevent 25 txn chain restriction
//                 }

//                 txnInputs = [ tokenInputs[i], nonTokenInputs[i] ];

//                 let perOutputAmount = tokenInputs[i].slpUtxoJudgementAmount.div(OUTPUT_SIZE).decimalPlaces(0, BigNumber.ROUND_FLOOR);
    
//                 console.log(`Please wait, signing ${txnInputs.length} inputs in ${txnCount}-th transaction.`);
//                 let txnHex = txnHelpers.simpleTokenSend(tokenId, 
//                                                         Array(OUTPUT_SIZE).fill(perOutputAmount),
//                                                         txnInputs, 
//                                                         Array(OUTPUT_SIZE).fill(receiverSlptest), 
//                                                         receiverSlptest,
//                                                         Array(OUTPUT_SIZE).fill({ satoshis: Math.floor((nonTokenInputs[i].satoshis-FEE_EST) / OUTPUT_SIZE), receiverAddress: receiverSlptest })
//                                                         );

//                 fiTxid = await rpcNode1_miner.sendRawTransaction(txnHex, true);
//                 rawTxnCache.set(fiTxid, Buffer.from(txnHex, "hex"));

//                 txnCount++;
//             }
//             txnDepth++;
//         }
//     });
// });
