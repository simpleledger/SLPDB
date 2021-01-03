import * as yaml from 'js-yaml';
import * as fs from 'fs';

class _TokenFilterRule {
    name: string;
    type: string;
    info: string;

    constructor({ name, type, info }: { name: string, type: string, info: string }) {
        this.name = name;
        this.type = type;
        this.info = info;
    }

    include(tokenId: string) {
        if(this.type === 'include-single') {
            if(tokenId === this.info) {
                return true;
            } else {
                return false;
            }
        } else if(this.type === 'exclude-single') {
            if(tokenId === this.info) {
                return false;
            } else {
                return true;
            }
        }
    }

    exclude(tokenId: string) {
        return !this.include(tokenId);
    }
}

class _TokenFilter {
    public static Instance() {
        return this._instance || (this._instance = new _TokenFilter());
    }
    private static _instance: _TokenFilter;
    _rules = new Map<string, _TokenFilterRule>();
    _hasIncludeSingle = false;
    _hasExcludeSingle = false;

    constructor() {
        try {
            let o = yaml.safeLoad(fs.readFileSync('filters.yml', 'utf-8')) as { tokens: _TokenFilterRule[] };
            o!.tokens.forEach((f: _TokenFilterRule) => {
                this.addRule(new _TokenFilterRule({ info: f.info, name: f.name, type: f.type }));
                console.log("[INFO] Loaded token filter:", f.name);
            });
        } catch(e) {
            console.log("[INFO] No token filters loaded.");
        }
    }

    addRule(rule: _TokenFilterRule) {
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

    passesAllFilterRules(tokenId: string) {
        if(this._hasIncludeSingle) {
            let r = Array.from(this._rules).filter((v, i) => v[1].type === 'include-single');
            for(let i = 0; i < r.length; i++) {
                if(r[i][1].type === 'include-single' && r[i][1].include(tokenId)) {
                    return true;
                }
            }
            return false;
        } else if(this._hasExcludeSingle) {
            let r = Array.from(this._rules).filter((v, i) => v[1].type === 'exclude-single');
            for(let i = 0; i < r.length; i++) {
                if(r[i][1].type === 'exclude-single' && r[i][1].exclude(tokenId)) {
                    return false;
                }
            }
            return true;
        } else {
            return true;
        }
    }
}

// accessor to a singleton stack for filters
export const TokenFilters = _TokenFilter.Instance;

TokenFilters();