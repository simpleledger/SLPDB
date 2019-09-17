import * as dotenv from 'dotenv';
dotenv.config()

import { Bit } from './bit';
import { Db } from './db';
import { RpcClient } from './rpc';
import { Config } from './config';
import { SlpdbStatus } from './status';
import { Info, ChainSyncCheckpoint } from './info';
import { SlpGraphManager } from './slpgraphmanager';
import { TokenFilterRule, TokenFilter } from './filters';

const db = new Db();
const rpc = new RpcClient({useGrpc: Boolean(Config.grpc.url) });
const bit = new Bit(db, rpc);
new SlpdbStatus(db, rpc);

const daemon = {
    run: async function(start_height?: number) {
        let network!: string;
        try {        
            network = (await rpc.getBlockchainInfo())!.chain === 'test' ? 'testnet' : 'mainnet';
            await Info.setNetwork(network);
            await db.init();
        } catch(err) {
            console.log(err);
            process.exit();
        }

        // persist updated SLPDB status every 10 minutes
        await SlpdbStatus.loadPreviousAttributes();
        setInterval(async function() {
            await SlpdbStatus.saveStatus();
        }, 60000);

        await bit.init();

        // test RPC connection
        console.log("[INFO] Testing RPC connection...");
        await rpc.getBlockCount();
        console.log("[INFO] RPC is initialized.");

        // set start height override
        if(start_height)
            await Info.updateBlockCheckpoint(start_height, null);
        
        await SlpdbStatus.saveStatus();

        // try to load tokens filter yaml
        let filter = TokenFilter.loadFromFile();

        // check for confirmed collection schema update
        let schema = await Info.getConfirmedCollectionSchema();
        if(!schema || schema !== Config.db.confirmed_schema_version) {
            await Info.setConfirmedCollectionSchema(Config.db.confirmed_schema_version);
            await Info.checkpointReset();
            console.log("[INFO] Schema version for the confirmed collection was updated. Reseting block checkpoint reset to", (await Info.getBlockCheckpoint()).height)
        }

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
        await SlpdbStatus.changeStateToStartupBlockSync({ 
            network, getSyncdCheckpoint: async () => await Info.getBlockCheckpoint()
        });
        await bit.processBlocksForTNA();
        await bit.processCurrentMempoolForTNA();
        console.timeEnd('[PERF] Initial Block Sync');
        console.log('[INFO] SLPDB Synchronization with BCH blockchain data complete.', new Date());

        console.log('[INFO] Starting to processing SLP Data.', new Date());
        let currentHeight = await rpc.getBlockCount();
        let tokenManager = new SlpGraphManager(db, currentHeight, network, bit, filter);
        bit._slpGraphManager = tokenManager;
        bit.listenToZmq();
        await bit.checkForMissingMempoolTxns(undefined, true);

        await tokenManager.initAllTokens({ reprocessFrom });

        // // look for burned token transactions every hour after startup
        // setInterval(async function() {
        //     if(tokenManager._startupQueue.size === 0 && tokenManager._startupQueue.pending === 0) {
        //         await tokenManager.searchForNonSlpBurnTransactions();
        //     }
        // }, 3600000);
    }
}

const util = {
    run: async function() {
        await db.init()
        let cmd = process.argv[2]
        if (cmd === 'fix') {
            console.log("Command not implemented");
            let fromHeight: number;
            // if (process.argv.length > 3) {
            // 	fromHeight = parseInt(process.argv[3])
            // 	await util.fix(fromHeight)
            // } else
            // 	console.log("Usage 'node ./index.js fix <block number>'")
            process.exit(1);
        } else if (cmd === 'reset') {
            await db.confirmedReset()
            await db.unconfirmedReset()
            await db.tokenReset()
            await db.graphReset()
            await db.utxoReset()
            await db.addressReset()
            await Info.checkpointReset()
            process.exit(1);
        } else if (cmd === 'index') {
            console.log("Command not implemented");
            //await db.blockindex()
            process.exit(1);
        }
    }, 
    reprocess_token: async function(tokenId: string) {
        let network = (await rpc.getBlockchainInfo())!.chain === 'test' ? 'testnet' : 'mainnet'
        await Info.setNetwork(network);
        await db.init();
        await bit.init();
        console.log('[INFO] Synchronizing SLPDB with BCH blockchain data...', new Date());
        console.time('[PERF] Initial Block Sync');
        await bit.processBlocksForTNA();
        await bit.processCurrentMempoolForTNA();
        console.timeEnd('[PERF] Initial Block Sync');
        console.log('[INFO] SLPDB Synchronization with BCH blockchain data complete.', new Date());
        let currentHeight = await rpc.getBlockCount();
        let tokenManager = new SlpGraphManager(db, currentHeight, network, bit);
        bit._slpGraphManager = tokenManager;
        bit.listenToZmq();
        await tokenManager.initAllTokens({ reprocessFrom: 0, tokenIds: [tokenId], loadFromDb: false });
        await tokenManager._startupQueue.onIdle();
        await tokenManager._tokens.get(tokenId)!.updateStatistics();
        process.exit(1);
    },
    reset_to_block: async function(block_height: number) {  //592340
        let includeTokenIds = [
            "8aab2185354926d72c6a8f6bf7e403daaf1469c02e00a5ad5981b84ea776d980",
        ]
        let filter = new TokenFilter();
        includeTokenIds.forEach(i => {
            filter.addRule(new TokenFilterRule({ name: "unknown", info: i, type: 'include-single'}));
        });
        let network = (await rpc.getBlockchainInfo())!.chain === 'test' ? 'testnet' : 'mainnet';
        await Info.setNetwork(network);
        await db.init();
        let currentHeight = await rpc.getBlockCount();
        let tokenManager = new SlpGraphManager(db, currentHeight, network, bit, filter);
        await tokenManager.initAllTokens({ reprocessFrom: 0, tokenIds: includeTokenIds, reprocessTo: block_height });
        //await tokenManager.initAllTokens({ allowGraphUpdates: false, tokenIds: tokenIdFilter });
        //await tokenManager.simulateOnTransactionHash("06e27bfcd9f8839ea6c7720a6c50f68465e3bc56775c7a683dcb29f799eba24a");
        let blockhash = await rpc.getBlockHash(block_height+1);
        await tokenManager.onBlockHash(blockhash);
        await Info.updateBlockCheckpoint(block_height, null);
        process.exit(1);
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
}

// @ts-ignore
process.on('uncaughtException', async (err: any, origin: any) => {
    var message = err;
    try {
        message = `[${(new Date()).toUTCString()}] ${err.stack}`;
    } catch(_) {}
    await SlpdbStatus.logExitReason(message);
    try {
        console.log('[INFO] Shutting down SLPDB...', new Date().toString());
        await db.exit();
    } catch(_) {}
    process.exit(0);
});

process.on('unhandledRejection', async (err: any, promise: any) => {
    var message = err;
    try {
        message = `[${(new Date()).toUTCString()}] ${err.stack}`;
    } catch(_) {}
    await SlpdbStatus.logExitReason(message);
    try {
        console.log('[INFO] Shutting down SLPDB...', new Date().toString());
        await db.exit();
    } catch(_) {}
    process.exit(0);
});

start();
