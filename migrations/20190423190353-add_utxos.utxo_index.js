module.exports = {
  async up(db) {
    console.log(await db.collection('utxos').createIndex({ 'utxo': 1 }))
  },

  async down(db) {
    console.log(await db.collection('utxos').dropIndex('utxo_1'))
  }
};
