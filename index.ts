import * as dotenv from 'dotenv';
dotenv.config()

import { Config } from './config';
import { Info } from './info';
import { Bit } from './bit';
import { Db } from './db';
import { SlpGraphManager } from './SlpGraphManager';

const db = new Db();
const bit = new Bit();

const daemon = {
	run: async function() {
		// 1. Initialize
		await db.init();
		await bit.init(db);

		// 2. Bootstrap actions depending on first time
		const lastSynchronized = await Info.checkpoint()

		console.time('[PERF] Indexing Keys')
		if (lastSynchronized.height === Config.core.from) {
			// First time. Try indexing
			console.log('[INFO] Indexing MongoDB With Configured Keys...', new Date())
			await db.blockindex()
		}
		console.timeEnd('[PERF] Indexing Keys')

		// 3. Start synchronizing
		console.log('[INFO] Synchronizing SLPDB with BCH blockchain...', new Date())
		console.time('[PERF] Initial Sync')
		await bit.run()
		console.timeEnd('[PERF] Initial Sync')
		console.log('[INFO] SLPDB Synchronization with BCH blockchain complete.', new Date())

		// 4. Start SLP Token Manager
		let tokenManager = new SlpGraphManager(db);
		
		// load graph state from db, or recreate from scratch
		await tokenManager.initAllTokens();

		// 4. Start listening
		bit._zmqSubscribers.push(tokenManager);
		bit.listenToZmq();
	}
}

const util = {
	run: async function() {
		await db.init()
		let cmd = process.argv[2]
		if (cmd === 'fix') {
			let fromHeight: number;
			if (process.argv.length > 3) {
				fromHeight = parseInt(process.argv[3])
			} else {
				fromHeight = (await Info.checkpoint()).height;
			}
			await util.fix(fromHeight)
			process.exit()
		} else if (cmd === 'reset') {
			await db.blockreset()
			await db.mempoolreset()
			await Info.deleteTip()
			process.exit()
		} else if (cmd === 'index') {
			await db.blockindex()
			process.exit()
		}
	},
	fix: async function(height: number) {
		console.log('[INFO] Restarting sync from index ', height)
		console.time('[PERF] replace')
		await bit.init(db)
		let content = await bit.crawl(height)
		if(content) {
			let array = Array.from(content.values()).map(c => c.tnaTxn)
			await db.blockreplace(array, height)
		}
		console.log('[INFO] Block', height, 'fixed.')
		await Info.updateTip(height, null)
		console.timeEnd('[PERF] replace')
	}
}

const start = async function() {
	if (process.argv.length > 2) {
		util.run()
	} else {
		daemon.run()
	}
}

start()
