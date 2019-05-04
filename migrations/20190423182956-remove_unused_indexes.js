module.exports = {
  async up(db) {
    try { console.log(await db.collection('graphs').dropIndex('tokenDetails.name_1')) } catch(e) { console.log(e); }
    try { console.log(await db.collection('graphs').dropIndex('tokenDetails.symbol_1')) } catch(e) { console.log(e); }
    try { console.log(await db.collection('graphs').dropIndex('fulltext')) } catch(e) { console.log(e); }

    try { console.log(await db.collection('addresses').dropIndex('tokenDetails.name_1')) } catch(e) { console.log(e); }
    try { console.log(await db.collection('addresses').dropIndex('tokenDetails.symbol_1')) } catch(e) { console.log(e); }
    try { console.log(await db.collection('addresses').dropIndex('fulltext')) } catch(e) { console.log(e); }

    try { console.log(await db.collection('utxos').dropIndex('tokenDetails.name_1')) } catch(e) { console.log(e); }
    try { console.log(await db.collection('utxos').dropIndex('tokenDetails.symbol_1')) } catch(e) { console.log(e); }
    try { console.log(await db.collection('utxos').dropIndex('fulltext')) } catch(e) { console.log(e); }
  },

  async down(db) {
    console.log(await db.collection('graphs').createIndex('tokenDetails.name'))
    console.log(await db.collection('graphs').createIndex('tokenDetails.symbol'))
    console.log(await db.collection('graphs').createIndex({
      'tokenDetails.name': 'text',
      'tokenDetails.symbol': 'text'
    }, {
      'name': 'fulltext'
    }))

    console.log(await db.collection('addresses').createIndex('tokenDetails.name'))
    console.log(await db.collection('addresses').createIndex('tokenDetails.symbol'))
    console.log(await db.collection('addresses').createIndex({
      'tokenDetails.name': 'text',
      'tokenDetails.symbol': 'text'
    }, {
      'name': 'fulltext'
    }))

    console.log(await db.collection('utxos').createIndex('tokenDetails.name'))
    console.log(await db.collection('utxos').createIndex('tokenDetails.symbol'))
    console.log(await db.collection('utxos').createIndex({
      'tokenDetails.name': 'text',
      'tokenDetails.symbol': 'text'
    }, {
      'name': 'fulltext'
    }))
  }
};
