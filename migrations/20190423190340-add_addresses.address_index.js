module.exports = {
  async up(db) {
    console.log(await db.collection('addresses').createIndex({ 'address': 1 }))
  },

  async down(db) {
    console.log(await db.collection('addresses').dropIndex('address_1'))
  }
};
