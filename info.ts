const level = require('level')
const kv = level('./_leveldb')

import { Config } from './config';

/**
* Return the last synchronized checkpoint
*/

export module Info {
	export const checkpoint = async function(): Promise<number> {
		try {
			let value = await kv.get('tip');
			let cp = parseInt(value)
			if (cp) {
				//console.log('Checkpoint found,', cp)
				return cp
			}
			//console.log('Checkpoint not found, starting from GENESIS')
		} catch(err) {
			// console.log('checkpoint err', err);
			// throw err;
		} 
		return Config.core.from;
	}
	export const updateTip = async function(index: any): Promise<void> {
		try {
			let a = await kv.put('tip', index);
			//console.log('Tip updated to', index);
		} catch (err) {
			console.log('updateTip err:',err)
		}
	}
	export const deleteTip = async function() {
		try { 
			await kv.del('tip')
			//console.log('Tip deleted')
		} catch(err) {
			console.log('deleteTip err', err)
		}
	}
}

// module.exports = {
//   checkpoint: checkpoint,
//   updateTip: updateTip,
//   deleteTip: deleteTip
// }
