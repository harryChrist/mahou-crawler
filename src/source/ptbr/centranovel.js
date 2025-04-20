const MangaStream = require('@/template/MangaStream');
const BaseProvider = require('@/template/BaseProvider');

class CentraNovelProvider extends BaseProvider {
    constructor() {
        super('centranovel', 'https://centranovel.com', 'novel');
        this.searchUrl = `${this.baseUrl}/novels?titulo=%s`;
    }
}

module.exports = new CentraNovelProvider();