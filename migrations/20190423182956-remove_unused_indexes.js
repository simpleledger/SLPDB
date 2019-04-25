module.exports = {
  async up(db) {
    console.log(await db.collection('graphs').dropIndex('tokenDetails.name_1'))
    console.log(await db.collection('graphs').dropIndex('tokenDetails.symbol_1'))
    console.log(await db.collection('graphs').dropIndex('fulltext'))

    console.log(await db.collection('addresses').dropIndex('tokenDetails.name_1'))
    console.log(await db.collection('addresses').dropIndex('tokenDetails.symbol_1'))
    console.log(await db.collection('addresses').dropIndex('fulltext'))

    console.log(await db.collection('utxos').dropIndex('tokenDetails.name_1'))
    console.log(await db.collection('utxos').dropIndex('tokenDetails.symbol_1'))
    console.log(await db.collection('utxos').dropIndex('fulltext'))
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
