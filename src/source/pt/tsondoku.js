const ThemasiaTemplate = require('../../template/Themasia.js');

class TsondokuProvider extends ThemasiaTemplate {
    constructor() {
        super('tsondoku', 'https://tsundoku.com.br/');
        this.searchUrl = `${this.baseUrl}?s=%s`;
    }
}

module.exports = new TsondokuProvider();