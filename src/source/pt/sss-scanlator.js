const ThemasiaTemplate = require('../../template/Themasia.js');

class TsondokuProvider extends ThemasiaTemplate {
    constructor() {
        super('sss-scanlator', 'https://sssscanlator.com.br/');
        this.searchUrl = `${this.baseUrl}?s=%s`;
    }
}

module.exports = new TsondokuProvider();