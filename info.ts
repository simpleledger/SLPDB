const level = require('level');
var kv = level('./_leveldb');

import { Config } from './config';

/**
* Return the last synchronized checkpoint
*/

export interface ChainSyncCheckpoint {
	height: number, 
	hash: string|null 
}

export module Info {
	export const setNetwork =  async function(network: string): Promise<void> {
		try {
			if(network === 'testnet')
				kv = level('./_leveldb_testnet');
			await kv.put('network', network);
		} catch(_) { }
	}
	export const getNetwork =  async function(): Promise<string> {
		try {
			return await kv.get('network');
		} catch(_) { 
			throw Error("Cannot get network");
		}
	}

	export const getBlockCheckpoint = async function(fallback_index?: number): Promise<ChainSyncCheckpoint> {
		let value: number|null, hash: string|null;
		try {
			value = parseInt(await kv.get('tip'));
		} catch(_) { value = null; }
		
		try {
			hash = await kv.get(value + '-hash');
		} catch(_) { hash = null; }

		if (value && hash) {
			console.log("[INFO] Block checkpoint retrieved: ", value, hash);
			return { height: value!, hash: hash }
		} else if(value) {
			console.log("[INFO] Block checkpoint retrieved without block hash:", value);
			return { height: value!, hash: null }
		} else if(fallback_index) {
			console.log("[INFO] Block checkpoint not found, falling back to block", fallback_index);
			return { height: fallback_index, hash: null }
		}
		throw Error("Could not retrieve checkpoint from storage.");
	}

	export const updateBlockCheckpoint = async function(index: number, hash: string|null): Promise<void> {
		try {
			await kv.put('tip', index);
			await kv.put(index + '-hash', hash);
			console.log("[INFO] Block checkpoint updated to:", index, hash);
		} catch (err) {
			console.log('[ERROR] updateBlockCheckpoint error:', err)
		}
	}

	export const getCheckpointHash = async function(index: number) {
		try {
			return await kv.get(index + '-hash');
		} catch(_) {}
		return null
	}

	// export const deleteTip = async function() {
	// 	try { 
	// 		await kv.del('tip');
	// 		console.log("[INFO] Block checkpoint deleted.");
	// 	} catch(err) {
	// 		console.log('[ERROR] deleteTip err', err)
	// 	}
	// }

	export const deleteBlockCheckpointHash = async function (index: number){
		try { 
			await kv.del(index + '-hash');
	 		console.log("[INFO] Block hash record deleted for", index);
		} catch(err) {
			console.log('[ERROR] deleteTip err', err)
		}
	}
}