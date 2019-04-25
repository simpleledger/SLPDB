module.exports = {
  async up(db) {
    console.log(await db.collection('graphs').createIndex({ 'graphTxn.txid': 1 }))
  },

  async down(db) {
    console.log(await db.collection('graphs').dropIndex('graphTxn.txid_1'))
  }
};
