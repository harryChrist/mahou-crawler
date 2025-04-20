const ThemasiaTemplate = require('@/template/Themasia.js');

class TsondokuProvider extends ThemasiaTemplate {
    constructor() {
        super('tsondoku', 'https://tsondoku.com', 'novel');
        this.searchUrl = `${this.baseUrl}/novels?titulo=%s`;
    }
}

module.exports = new TsondokuProvider();