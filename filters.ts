export class TokenFilterRule {
    name: string;
    type: string;
    info: string;

    constructor({ name, type, info }: { name: string, type: string, info: string }) {
        this.name = name;
        this.type = type;
        this.info = info;
    }

    include(txid: string) {
        if(this.type === 'include-single') {
            if(txid === this.info) {
                return true;
            } else {
                return false;
            }
        } else if(this.type === 'exclude-single') {
            if(txid === this.info) {
                return false;
            } else {
                return true;
            }
        }
    }

    exclude(txid: string) {
        return !this.include(txid);
    }
}

export class TokenFilter {
    _rules = new Map<string, TokenFilterRule>();
    _hasIncludeSingle = false;
    _hasExcludeSingle = false;

    constructor() { }

    addRule(rule: TokenFilterRule) {
        if(this._rules.has(rule.info))
            return;
        if(rule.type === 'include-single') {
            if(this._hasExcludeSingle)
                throw Error('Invalid combination of filter rules.  Filter already has exclude single rules added.');
            this._hasIncludeSingle = true;
        } else if(rule.type === 'exclude-single') {
            if(this._hasIncludeSingle)
                throw Error('Invalid combination of filter rules.  Filter already has include single rules added.');
            this._hasIncludeSingle = true;
        }
        this._rules.set(rule.info, rule);
    }

    passesAllFilterRules(txid: string) {
        if(this._hasIncludeSingle) {
            let r = Array.from(this._rules).filter((v, i) => v[1].type === 'include-single');
            for(let i = 0; i < r.length; i++) {
                if(r[i][1].type === 'include-single' && r[i][1].include(txid)) {
                    return true;
                }
            }
            return false;
        } else if(this._hasExcludeSingle) {
            let r = Array.from(this._rules).filter((v, i) => v[1].type === 'exclude-single');
            for(let i = 0; i < r.length; i++) {
                if(r[i][1].type === 'exclude-single' && r[i][1].exclude(txid)) {
                    return false;
                }
            }
            return true;
        } else {
            return true;
        }
    }
}