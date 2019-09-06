import * as dotenv from 'dotenv';
dotenv.config()

import { Config } from './config';
import { Info, ChainSyncCheckpoint } from './info';
import { Bit } from './bit';
import { Db } from './db';
import { SlpGraphManager } from './slpgraphmanager';

import { RpcClient } from './rpc';
const rpc = new RpcClient({useGrpc: Boolean(Config.grpc.url) });

const db = new Db();
const bit = new Bit();

const daemon = {
    run: async function(start_height?: number) {

        // test RPC connection
        console.log("[INFO] Testing RPC connection...");
        await rpc.getBlockCount();
        console.log("[INFO] RPC is initialized.");

        // set network
        let network = (await rpc.getBlockchainInfo())!.chain === 'test' ? 'testnet' : 'mainnet';
        await Info.setNetwork(network);

        // set start height override
        if(start_height)
            await Info.updateBlockCheckpoint(start_height, null);

        // check for confirmed collection schema update
        let schema = await Info.getConfirmedCollectionSchema();
        if(!schema || schema !== Config.db.confirmed_schema_version) {
            await Info.setConfirmedCollectionSchema(Config.db.confirmed_schema_version);
            await Info.checkpointReset();
            console.log("[INFO] Schema version for the confirmed collection was updated. Reseting block checkpoint reset to", (await Info.getBlockCheckpoint()).height)
        }

        await db.init(rpc);
        await bit.init(db, rpc);

        const lastSynchronized = <ChainSyncCheckpoint>await Info.getBlockCheckpoint((await Info.getNetwork()) === 'mainnet' ? Config.core.from : Config.core.from_testnet);
        let reprocessFrom = lastSynchronized.height;
        if(lastSynchronized.height > await bit.requestheight()) {
            throw Error("Config.core.from or Config.core.from_testnet cannot be larger than the current blockchain height (check the config.ts file)");
        }

        console.time('[PERF] Indexing Keys');
        let from = (await Info.getNetwork()) === 'mainnet' ? Config.core.from : Config.core.from_testnet;
        if (lastSynchronized.height === from) {
            console.log('[INFO] Indexing MongoDB With Configured Keys...', new Date());
            await db.confirmedIndex();
        }
        console.timeEnd('[PERF] Indexing Keys');

        console.log('[INFO] Synchronizing SLPDB with BCH blockchain data...', new Date());
        console.time('[PERF] Initial Block Sync');
        await bit.processBlocksForTNA();
        await bit.processCurrentMempoolForTNA();
        console.timeEnd('[PERF] Initial Block Sync');
        console.log('[INFO] SLPDB Synchronization with BCH blockchain data complete.', new Date());

        console.log('[INFO] Starting to processing SLP Data.', new Date());
        let currentHeight = await rpc.getBlockCount();
        let tokenManager = new SlpGraphManager(db, currentHeight, network);
        bit._slpGraphManager = tokenManager;
        bit.listenToZmq();
        await bit.checkForMissingMempoolTxns(undefined, true);

        await tokenManager.initAllTokens({ reprocessFrom });
        await tokenManager.fixMissingTokenTimestamps();
        await bit.handleConfirmedTxnsMissingSlpMetadata();
        //await tokenManager.searchForNonSlpBurnTransactions();
    }
}

const util = {
    run: async function() {
        const rpc = new RpcClient({useGrpc: Boolean(Config.grpc.url) });
        await db.init(rpc)
        let cmd = process.argv[2]
        if (cmd === 'fix') {
            console.log("Command not implemented");
            let fromHeight: number;
            // if (process.argv.length > 3) {
            // 	fromHeight = parseInt(process.argv[3])
            // 	await util.fix(fromHeight)
            // } else
            // 	console.log("Usage 'node ./index.js fix <block number>'")
            process.exit()
        } else if (cmd === 'reset') {
            await db.confirmedReset()
            await db.unconfirmedReset()
            await db.tokenReset()
            await db.graphReset()
            await db.utxoReset()
            await db.addressReset()
            await Info.checkpointReset()
            process.exit()
        } else if (cmd === 'index') {
            console.log("Command not implemented");
            //await db.blockindex()
            process.exit()
        }
    }, 
    reprocess_token: async function(tokenId: string) {
        let network = (await rpc.getBlockchainInfo())!.chain === 'test' ? 'testnet' : 'mainnet'
        await Info.setNetwork(network);
        await db.init(rpc);
        await bit.init(db, rpc);
        console.log('[INFO] Synchronizing SLPDB with BCH blockchain data...', new Date());
        console.time('[PERF] Initial Block Sync');
        await bit.processBlocksForTNA();
        await bit.processCurrentMempoolForTNA();
        console.timeEnd('[PERF] Initial Block Sync');
        console.log('[INFO] SLPDB Synchronization with BCH blockchain data complete.', new Date());
        let currentHeight = await rpc.getBlockCount();
        let tokenManager = new SlpGraphManager(db, currentHeight, network);
        bit._slpGraphManager = tokenManager;
        bit.listenToZmq();
        await tokenManager.initAllTokens({ reprocessFrom: 0, tokenIds: [tokenId], loadFromDb: false });
        tokenManager._tokens.get(tokenId)!.updateStatistics();
        process.exit();
    },
    reset_to_block: async function(block_height: number) {  //592340
        let tokenIdFilter = [
            "8aab2185354926d72c6a8f6bf7e403daaf1469c02e00a5ad5981b84ea776d980",
        ]
        let network = (await rpc.getBlockchainInfo())!.chain === 'test' ? 'testnet' : 'mainnet';
        await Info.setNetwork(network);
        await db.init(rpc);
        let currentHeight = await rpc.getBlockCount();
        let tokenManager = new SlpGraphManager(db, currentHeight, network);
        await tokenManager.initAllTokens({ reprocessFrom: 0, tokenIds: tokenIdFilter, reprocessTo: block_height });
        //await tokenManager.initAllTokens({ allowGraphUpdates: false, tokenIds: tokenIdFilter });
        //await tokenManager.simulateOnTransactionHash("06e27bfcd9f8839ea6c7720a6c50f68465e3bc56775c7a683dcb29f799eba24a");
        let blockhash = await rpc.getBlockHash(block_height+1);
        await tokenManager.onBlockHash(blockhash, tokenIdFilter);
        await Info.updateBlockCheckpoint(block_height, null);
        process.exit();
    }
    //,
    //fix: async function(height: number) {
        // const rpc = <BitcoinRpc.RpcClient>(new RpcClient({useGrpc: Boolean(Config.grpc.url) }));
        // await bit.init(db, rpc)
        // let tokenManager = new SlpGraphManager(db);
        // bit._zmqSubscribers.push(tokenManager);
        // console.log('[INFO] Clearing all unconfirmed transactions');
        // await db.unconfirmedReset();
        // console.log('[INFO] Fixing SLPDB after block', height);
        // console.time('[PERF] replace')
        // let content = await bit.crawl(height, true)
        // if(content) {
        // 	let array = Array.from(content.values()).map(c => c.tnaTxn)
        // 	await db.confirmedReplace(array, height)
        // }
        // console.log('[INFO] Block', height, 'fixed.')
        // await bit.removeExtraneousMempoolTxns()
        // console.timeEnd('[PERF] replace')
    //}
}

const start = async function() {
    try {
        let args = process.argv;
        if (args.length > 3) {
            if(args[2] === "run")
                await daemon.run(parseInt(process.argv[3]));
            else if(args[2] === "reprocess")
                await util.reprocess_token(process.argv[3]);
            else if(args[2] === "goToBlock")
                await util.reset_to_block(parseInt(process.argv[3]));
        } else if (process.argv.length > 2) {
            await util.run();
        } else {
            await daemon.run();
        }
    } catch(err) {
        console.log(err);
        process.exit();
    }
}

start();
