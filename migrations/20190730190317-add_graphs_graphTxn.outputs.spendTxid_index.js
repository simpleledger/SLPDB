module.exports = {
  async up(db) {
    console.log(await db.collection('graphs').createIndex({ 'graphTxn.outputs.spendTxid': 1 }))
  },

  async down(db) {
    console.log(await db.collection('graphs').dropIndex('graphTxn.outputs.spendTxid_1'))
  }
};
