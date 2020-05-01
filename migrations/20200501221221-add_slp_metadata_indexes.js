module.exports = {
  async up(db) {
    console.log(await db.collection('confirmed').createIndex({ 'out.s4': 1 }));
    console.log(await db.collection('confirmed').createIndex({ 'out.b7': 1 }));
    console.log(await db.collection('unconfirmed').createIndex({ 'out.s4': 1 }));
    console.log(await db.collection('unconfirmed').createIndex({ 'out.b7': 1 }));
  },

  async down(db) {
    console.log(await db.collection('confirmed').dropIndex('out.s4_1'));
    console.log(await db.collection('confirmed').dropIndex('out.b7_1'));
    console.log(await db.collection('unconfirmed').dropIndex('out.s4_1'));
    console.log(await db.collection('unconfirmed').dropIndex('out.b7_1'));
  }
};
