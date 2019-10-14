module.exports = {
  async up(db) {
    console.log(await db.collection('unconfirmed').createIndex({ 'slp.detail.transactionType': 1 }));
    console.log(await db.collection('confirmed').createIndex({ 'slp.detail.transactionType': 1 }));
  },
  async down(db) {
    console.log(await db.collection('unconfirmed').dropIndex('slp.detail.transactionType_1'));
    console.log(await db.collection('confirmed').dropIndex('slp.detail.transactionType_1'));
  }
};
