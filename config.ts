export interface DbConfig { 
  name: string; 
  url: string; 
  index: { [key: string]: { [key: string]: string[] } };
  schema_version: number;
}

export type CollectionType = { keys: string[], fulltext: string[] }

export interface RpcConfig { 
  protocol: string; user: string; pass: string; host: string; port: string; limit: number; 
}

export class Config {
  static rpc = {
    'protocol': process.env.rpc_protocol ? process.env.rpc_protocol : 'http',
    'user': process.env.rpc_user ? process.env.rpc_user : 'bitcoin',
    'pass': process.env.rpc_pass ? process.env.rpc_pass : 'password',
    'host': process.env.rpc_host ? process.env.rpc_host : '0.0.0.0',
    'port': process.env.rpc_port ? process.env.rpc_port : '8332',
    'limit': Number.parseInt(process.env.rpc_limit ? process.env.rpc_limit : "150")
  }
  static db: DbConfig = {
    name: process.env.db_name ? process.env.db_name : 'slpdb',
    url: process.env.db_url ? process.env.db_url : 'mongodb://localhost:27017',
    schema_version: 1,
    index: {
      confirmed: {
        keys: [
          'tx.h', 'blk.i', 'blk.t', 'blk.h',
          'in.e.a', 'in.e.h', 'in.e.i', 'in.i',
          'out.e.a', 'out.e.i', 'out.e.v', 'out.i',
          'in.b0', 'in.b1', 'in.b2', 'in.b3', //'in.b4', 'in.b5', 'in.b6', 'in.b7', 'in.b8', 'in.b9', 'in.b10', 'in.b11', 'in.b12', 'in.b13', 'in.b14', 'in.b15',
          'out.b0', 'out.b1', 'out.b2', 'out.b3', //'out.b4', 'out.b5', 'out.b6', 'out.b7', 'out.b8', 'out.b9', 'out.b10', 'out.b11', 'out.b12', 'out.b13', 'out.b14', 'out.b15', 'out.b16', 'out.b17', 'out.b18', 'out.b19',
          'out.s0', 'out.s1', 'out.s2', 'out.s3', //'out.s4', 'out.s5'
        ],
        fulltext: ['out.s0', 'out.s1', 'out.s2', 'out.s3']//, 'out.s4', 'out.s5']
      },
      unconfirmed: {
        keys: [
          'tx.h',
          'in.e.a', 'in.e.h', 'in.e.i', 'in.i',
          'out.e.a', 'out.e.i', 'out.e.v', 'out.i',
          'in.b0', 'in.b1', 'in.b2', 'in.b3', //'in.b4', 'in.b5', 'in.b6', 'in.b7', 'in.b8', 'in.b9', 'in.b10', 'in.b11', 'in.b12', 'in.b13', 'in.b14', 'in.b15',
          'out.b0', 'out.b1', 'out.b2', 'out.b3', //'out.b4', 'out.b5', 'out.b6', 'out.b7', 'out.b8', 'out.b9', 'out.b10', 'out.b11', 'out.b12', 'out.b13', 'out.b14', 'out.b15', 'out.b16', 'out.b17', 'out.b18', 'out.b19',
          'out.s0', 'out.s1', 'out.s2', 'out.s3', //'out.s4', 'out.s5'
        ],
        fulltext: ['out.s0', 'out.s1', 'out.s2', 'out.s3'] //, 'out.s4', 'out.s5']
      }
    }
  }
  static zmq = {
    'incoming': {
      'host': process.env.zmq_incoming_host ? process.env.zmq_incoming_host : '0.0.0.0',
      'port': process.env.zmq_incoming_port ? process.env.zmq_incoming_port : '28332'
    },
    'outgoing': {
      'host': process.env.zmq_outgoing_host ? process.env.zmq_outgoing_host : '0.0.0.0',
      'port': process.env.zmq_outgoing_port ? process.env.zmq_outgoing_port : '28339'
    }
  }
  static core = {
    'version': '0.1',
    'from': Number.parseInt(process.env.core_from ? process.env.core_from : "543375")
  }
}
