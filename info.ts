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
	export const checkpoint = async function(): Promise<ChainSyncCheckpoint> {
		try {
			let value = await kv.get('tip');
			let cp = parseInt(value)
			let hash = await kv.get(value + '-hash');
			if (cp) {
				//console.log('Checkpoint found,', cp)
				return { height: cp, hash: hash }
			}
		} catch(_) { } 
		let from = (await Info.getNetwork()) === 'mainnet' ? Config.core.from : Config.core.from_testnet;
		console.log("[INFO] Checkpoint not found, starting sync at 'Config.core.from' block index", from)
		return { height: from, hash: null }
	}
	export const updateTip = async function(index: number, hash: string|null): Promise<void> {
		try {
			await kv.put('tip', index);
			await kv.put(index + '-hash', hash);
		} catch (err) {
			console.log('[ERROR] updateTip error:', err)
		}
	}
	export const getCheckpointHash = async function(index: number) {
		try {
			return await kv.get(index + '-hash');
		} catch(_) {}
		return null
	}

	export const deleteTip = async function() {
		try { 
			await kv.del('tip');
		} catch(err) {
			console.log('[ERROR] deleteTip err', err)
		}
	}

	export const deleteOldTipHash = async function (index: number){
		try { 
			await kv.del(index + '-hash');
		} catch(err) {
			console.log('[ERROR] deleteTip err', err)
		}
	}
}