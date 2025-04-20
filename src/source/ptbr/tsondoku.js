const ThemasiaTemplate = require('@/template/Themasia.js');
const BaseProvider = require('@/providers/BaseProvider');

class TsondokuProvider extends BaseProvider {
    constructor() {
        super('tsondoku', 'https://tsondoku.com', 'novel');
        this.searchUrl = `${this.baseUrl}/novels?titulo=%s`;
    }
}

module.exports = new TsondokuProvider();