module.exports = {
  async up(db) {
    console.log(await db.collection('unconfirmed').createIndex({ 'slp.detail.outputs.address': 1 }));
    console.log(await db.collection('confirmed').createIndex({ 'slp.detail.outputs.address': 1 }));
  },
  async down(db) {
    console.log(await db.collection('unconfirmed').dropIndex('slp.detail.outputs.address_1'));
    console.log(await db.collection('confirmed').dropIndex('slp.detail.outputs.address_1'));
  }
};
